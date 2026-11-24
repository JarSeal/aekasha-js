import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../config/Config';
import type { DeviceProbeEnv } from './DeviceProbe';

// localStorage before anything reads it (the storage helpers check it once): items as own
// properties, as the browser's
const storage = vi.hoisted(() => {
  type Items = { [key: string]: string };
  const ls = Object.create({
    getItem(this: Items, key: string) {
      return Object.prototype.hasOwnProperty.call(this, key) ? this[key] : null;
    },
    setItem(this: Items, key: string, value: string) {
      this[key] = String(value);
    },
    removeItem(this: Items, key: string) {
      delete this[key];
    },
  }) as Storage & Items;
  vi.stubGlobal('localStorage', ls);
  return ls;
});

// The browser's inputs, and a count of the probes that ran (a stored result runs none)
const probe = vi.hoisted(() => ({ env: null as DeviceProbeEnv | null, probeCalls: 0 }));
vi.mock(import('./DeviceProbe'), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    readBrowserProbeEnv: () => probe.env as DeviceProbeEnv,
    probeDeviceAsync: (...args: Parameters<typeof actual.probeDeviceAsync>) => {
      probe.probeCalls++;
      return actual.probeDeviceAsync(...args);
    },
  };
});

const LS_KEY = 'AEK_deviceCapabilities';
const DAY_MS = 24 * 60 * 60 * 1000;

const createEnv = (overrides: Partial<DeviceProbeEnv> = {}): DeviceProbeEnv => ({
  navigator: {
    userAgent: 'TestAgent/1.0',
    hardwareConcurrency: 8,
    deviceMemory: 8,
    gpu: {
      requestAdapter: async () => ({
        features: new Set(['timestamp-query']),
        limits: {},
        info: { vendor: 'nvidia', architecture: 'ampere' },
      }),
    },
  },
  devicePixelRatio: 1,
  screen: { width: 1920, height: 1080 },
  matchMedia: null,
  crossOriginIsolated: true,
  hasOffscreenCanvas: true,
  jsHeapSizeLimit: null,
  createWebGL2Context: null,
  ...overrides,
});

// Fresh modules per test: the check's state (the last report, the listeners) is module-level
const loadAsync = async (config: AppConfig['deviceCapabilities'] = {}) => {
  vi.resetModules();
  const { loadConfig } = await import('../config/Config');
  loadConfig({ deviceCapabilities: config });
  return import('./DeviceCapabilities');
};

const readStored = () => JSON.parse(storage.getItem(LS_KEY) as string);

beforeEach(() => {
  storage.removeItem(LS_KEY);
  probe.env = createEnv();
  probe.probeCalls = 0;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('runDeviceCapabilityCheckAsync', () => {
  it('measures, stores the measurements and reports to the listeners', async () => {
    const dc = await loadAsync();
    expect(dc.getDeviceCapabilityReport()).toBeNull();
    const listener = vi.fn();
    dc.onDeviceCapabilityReport(listener);

    const report = await dc.runDeviceCapabilityCheckAsync();
    expect(probe.probeCalls).toBe(1);
    expect(report.fromCache).toBe(false);
    expect(report.measurements.gpu).toMatchObject({ api: 'WEBGPU', vendor: 'nvidia' });
    expect(report.verdict.levels.overall).toBe('HIGH');
    expect(listener).toHaveBeenCalledWith(report);
    expect(dc.getDeviceCapabilityReport()).toBe(report);

    const stored = readStored();
    expect(stored).toMatchObject({ reportVersion: 1, measuredAt: report.measuredAt });
    expect(stored.measurements).toEqual(report.measurements);
    // Only the measurements are stored, never a verdict
    expect(stored.verdict).toBeUndefined();
  });

  it('reuses a valid stored result, and measures again with force', async () => {
    await (await loadAsync()).runDeviceCapabilityCheckAsync();
    const dc = await loadAsync();
    const cached = await dc.runDeviceCapabilityCheckAsync();
    expect(probe.probeCalls).toBe(1);
    expect(cached.fromCache).toBe(true);

    const forced = await dc.runDeviceCapabilityCheckAsync({ force: true });
    expect(probe.probeCalls).toBe(2);
    expect(forced.fromCache).toBe(false);
  });

  it('measures again on another device, browser or display', async () => {
    await (await loadAsync()).runDeviceCapabilityCheckAsync();
    probe.env = createEnv({ devicePixelRatio: 2 });
    const report = await (await loadAsync()).runDeviceCapabilityCheckAsync();
    expect(probe.probeCalls).toBe(2);
    expect(report.fromCache).toBe(false);
  });

  it('measures again past maxAgeDays, and never with 0', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    await (await loadAsync()).runDeviceCapabilityCheckAsync();

    vi.setSystemTime(new Date('2026-01-01T00:00:00Z').getTime() + 10 * DAY_MS);
    expect(
      (await (await loadAsync({ maxAgeDays: 30 })).runDeviceCapabilityCheckAsync()).fromCache
    ).toBe(true);
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z').getTime() + 40 * DAY_MS);
    expect(
      (await (await loadAsync({ maxAgeDays: 0 })).runDeviceCapabilityCheckAsync()).fromCache
    ).toBe(true);
    expect((await (await loadAsync()).runDeviceCapabilityCheckAsync()).fromCache).toBe(false);
  });

  it('measures again when the stored result is of another version or broken', async () => {
    await (await loadAsync()).runDeviceCapabilityCheckAsync();
    storage.setItem(LS_KEY, JSON.stringify({ ...readStored(), reportVersion: 0 }));
    expect((await (await loadAsync()).runDeviceCapabilityCheckAsync()).fromCache).toBe(false);

    storage.setItem(LS_KEY, JSON.stringify({ ...readStored(), measurements: null }));
    expect((await (await loadAsync()).runDeviceCapabilityCheckAsync()).fromCache).toBe(false);
    expect(probe.probeCalls).toBe(3);
  });

  it('neither reads nor writes the stored result with saveToLS off', async () => {
    const dc = await loadAsync({ saveToLS: false });
    await dc.runDeviceCapabilityCheckAsync();
    expect(storage.getItem(LS_KEY)).toBeNull();

    await dc.runDeviceCapabilityCheckAsync({ saveToLS: true });
    const report = await dc.runDeviceCapabilityCheckAsync();
    expect(report.fromCache).toBe(false);
    expect(probe.probeCalls).toBe(3);
  });

  it('shares one check between overlapping calls', async () => {
    const dc = await loadAsync();
    const first = dc.runDeviceCapabilityCheckAsync();
    const second = dc.runDeviceCapabilityCheckAsync({ force: true });
    expect(second).toBe(first);
    await first;
    expect(probe.probeCalls).toBe(1);
    // A call after it ends runs a new check
    await dc.runDeviceCapabilityCheckAsync({ force: true });
    expect(probe.probeCalls).toBe(2);
  });

  it("scores a call's targets over the config's", async () => {
    const dc = await loadAsync({ targets: { minCpuCores: 16, fps: 30 } });
    const report = await dc.runDeviceCapabilityCheckAsync({ targets: { fps: 90 } });
    expect(report.verdict.targets).toMatchObject({ minCpuCores: 16, fps: 90 });
    expect(report.verdict.failedTargets).toEqual(['cpuCores']);
  });

  it('warns once on a memory target over what browsers report', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const dc = await loadAsync({ targets: { minDeviceMemoryGB: 16 } });
    await dc.runDeviceCapabilityCheckAsync();
    await dc.runDeviceCapabilityCheckAsync({ force: true });
    expect(warn).toHaveBeenCalledOnce();
  });

  it('keeps calling the listeners when one throws, and stops a removed one', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const dc = await loadAsync();
    const after = vi.fn();
    const removed = vi.fn();
    dc.onDeviceCapabilityReport(() => {
      throw new Error('listener');
    });
    dc.onDeviceCapabilityReport(after);
    dc.onDeviceCapabilityReport(removed)();
    await dc.runDeviceCapabilityCheckAsync();
    expect(after).toHaveBeenCalledOnce();
    expect(removed).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledOnce();
  });
});

describe('evaluateDeviceCapabilities and clearStoredDeviceCapabilityReport', () => {
  it('scores the last measurements against other targets without measuring', async () => {
    const dc = await loadAsync();
    expect(dc.evaluateDeviceCapabilities({ fps: 30 })).toBeNull();
    await dc.runDeviceCapabilityCheckAsync();

    const ultra = dc.evaluateDeviceCapabilities({ minLevels: { overall: 'ULTRA' } });
    expect(ultra?.meetsTargets).toBe(false);
    expect(ultra?.failedTargets).toEqual(['minLevels']);
    expect(dc.evaluateDeviceCapabilities({ minLevels: { gpu: 'HIGH' } })?.meetsTargets).toBe(true);
    expect(probe.probeCalls).toBe(1);
  });

  it('removes the stored result, keeping the last report', async () => {
    const dc = await loadAsync();
    await dc.runDeviceCapabilityCheckAsync();
    dc.clearStoredDeviceCapabilityReport();
    expect(storage.getItem(LS_KEY)).toBeNull();
    expect(dc.getDeviceCapabilityReport()).not.toBeNull();
    expect((await dc.runDeviceCapabilityCheckAsync()).fromCache).toBe(false);
  });
});
