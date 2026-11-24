import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../config/Config';
import type { DeviceBenchmarkOpts, DeviceBenchmarkResult } from './DeviceBenchmark';
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

// The benchmark: its calls' options, and the result it gives (a stalled one when `isStalled`)
const bench = vi.hoisted(() => ({
  calls: [] as DeviceBenchmarkOpts[],
  isStalled: false,
  // Called while it "runs": what the main loop's state is then
  during: null as (() => void) | null,
}));
vi.mock(import('./DeviceBenchmark'), () => ({
  runDeviceBenchmarkAsync: async (opts: DeviceBenchmarkOpts): Promise<DeviceBenchmarkResult> => {
    bench.calls.push(opts);
    bench.during?.();
    opts.onProgress?.('PROBE', 0.15);
    opts.onProgress?.('GPU', 0.5);
    opts.onProgress?.('CPU', 0.85);
    return {
      refreshHz: 120,
      cpuScore: 20000,
      benchmark: {
        gpu: {
          api: 'WEBGPU',
          width: opts.width,
          height: opts.height,
          fillRateMPixOpsPerMs: 20,
          trianglesPerMs: 1e6,
          usedTimestampQuery: true,
        },
        durationMs: 1200,
        isStalled: bench.isStalled,
      },
    };
  },
}));

// The main loop's play state, which the check pauses and resumes
const loop = vi.hoisted(() => ({
  masterPlay: true,
  isMasterPlaying: false,
  toggles: [] as boolean[],
}));
vi.mock(import('../loop/MainLoop'), () => ({
  getReadOnlyLoopState: () => ({ ...loop }) as never,
  toggleMainPlay: (value?: boolean) => {
    loop.masterPlay = value ?? !loop.masterPlay;
    loop.toggles.push(loop.masterPlay);
  },
}));

// The canvas's size, CSS pixels
const canvas = vi.hoisted(() => ({ width: 800, height: 600 }));
vi.mock(import('../render/CanvasSize'), () => ({
  getCanvasSize: () => ({ ...canvas, aspect: canvas.width / Math.max(1, canvas.height) }),
}));

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
  bench.calls = [];
  bench.isStalled = false;
  bench.during = null;
  Object.assign(loop, { masterPlay: true, isMasterPlaying: false, toggles: [] });
  Object.assign(canvas, { width: 800, height: 600 });
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
    expect(stored).toMatchObject({ reportVersion: 2, measuredAt: report.measuredAt });
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

describe("the debug tab's forced levels", () => {
  it('scores the last report again with them in the debug env, and reports it', async () => {
    const dc = await loadAsync();
    const { initEnvironment } = await import('../config/Config');
    initEnvironment({ search: '?isDebug=true', env: { VITE_APP_ENV: 'development' } });
    await dc.runDeviceCapabilityCheckAsync({ targets: { fps: 30 } });
    const measured = dc.getDeviceCapabilityReport()?.verdict.levels.gpu;
    const listener = vi.fn();
    dc.onDeviceCapabilityReport(listener);

    dc._setForcedDeviceLevels({ gpu: 'LOW' });
    const forced = dc.getDeviceCapabilityReport()?.verdict;
    expect(forced?.levels).toMatchObject({ gpu: 'LOW', forced: true });
    expect(forced?.recommendations.shadowQuality).toBe('LOW');
    // The check's own targets kept
    expect(forced?.targets.fps).toBe(30);
    expect(dc._getUnforcedDeviceVerdict()?.levels.gpu).toBe(measured);
    expect(dc.evaluateDeviceCapabilities({ minLevels: { gpu: 'MEDIUM' } })?.meetsTargets).toBe(
      false
    );
    expect(listener).toHaveBeenCalledOnce();

    // The same levels again change nothing; none puts the device's back
    dc._setForcedDeviceLevels({ gpu: 'LOW' });
    expect(listener).toHaveBeenCalledOnce();
    dc._setForcedDeviceLevels({});
    expect(dc.getDeviceCapabilityReport()?.verdict.levels).toMatchObject({
      gpu: measured,
      forced: false,
    });
    expect(listener).toHaveBeenCalledTimes(2);
    // Stored measurements only: never a forced level
    expect(readStored().verdict).toBeUndefined();
  });

  it('does nothing outside the debug env', async () => {
    const dc = await loadAsync();
    await dc.runDeviceCapabilityCheckAsync();
    dc._setForcedDeviceLevels({ gpu: 'LOW' });
    expect(dc.getDeviceCapabilityReport()?.verdict.levels.forced).toBe(false);
  });
});

describe('the benchmark', () => {
  it('adds its measurements, at the canvas size × the pixel ratio', async () => {
    probe.env = createEnv({ devicePixelRatio: 2 });
    const report = await (await loadAsync()).runDeviceCapabilityCheckAsync();
    expect(bench.calls).toHaveLength(1);
    expect(bench.calls[0]).toMatchObject({ width: 1600, height: 1200, budgetMs: 1500 });
    expect(report.measurements.display.refreshHz).toBe(120);
    expect(report.measurements.cpu.benchScore).toBe(20000);
    expect(report.measurements.benchmark).toMatchObject({ durationMs: 1200, isStalled: false });
    expect(readStored().measurements.benchmark.gpu.fillRateMPixOpsPerMs).toBe(20);
  });

  it("measures a target resolution as given, and a canvas with no size at 1280×720's", async () => {
    await (
      await loadAsync({ targets: { resolution: { width: 1920, height: 1080 } } })
    ).runDeviceCapabilityCheckAsync();
    expect(bench.calls[0]).toMatchObject({ width: 1920, height: 1080 });

    Object.assign(canvas, { width: 0, height: 0 });
    await (
      await loadAsync({ benchmark: { budgetMs: 800 } })
    ).runDeviceCapabilityCheckAsync({
      force: true,
    });
    expect(bench.calls[1]).toMatchObject({ width: 1280, height: 720, budgetMs: 800 });
  });

  it("doesn't run when off, and a stored result without one is measured again when on", async () => {
    const report = await (
      await loadAsync({ benchmark: { enabled: false } })
    ).runDeviceCapabilityCheckAsync();
    expect(bench.calls).toHaveLength(0);
    expect(report.measurements.benchmark).toBeNull();
    expect(report.measurements.display.refreshHz).toBeNull();

    // The option wins over the config
    const dc = await loadAsync({ benchmark: { enabled: false } });
    expect((await dc.runDeviceCapabilityCheckAsync()).fromCache).toBe(true);
    expect((await dc.runDeviceCapabilityCheckAsync({ benchmark: true })).fromCache).toBe(false);
    expect(bench.calls).toHaveLength(1);
    // A benchmarked result serves a check without one
    expect((await dc.runDeviceCapabilityCheckAsync()).fromCache).toBe(true);
  });

  it("doesn't store a stalled run", async () => {
    bench.isStalled = true;
    const report = await (await loadAsync()).runDeviceCapabilityCheckAsync();
    expect(report.measurements.benchmark?.isStalled).toBe(true);
    expect(storage.getItem(LS_KEY)).toBeNull();
  });

  it('pauses a running main loop meanwhile and resumes it', async () => {
    loop.isMasterPlaying = true;
    let masterPlayDuring: boolean | null = null;
    bench.during = () => (masterPlayDuring = loop.masterPlay);
    const dc = await loadAsync();
    await dc.runDeviceCapabilityCheckAsync();
    expect(masterPlayDuring).toBe(false);
    expect(loop.toggles).toEqual([false, true]);

    // Not with pauseMainLoop off, nor when paused already, nor from a stored result
    loop.toggles = [];
    await dc.runDeviceCapabilityCheckAsync({ force: true, pauseMainLoop: false });
    loop.masterPlay = false;
    await dc.runDeviceCapabilityCheckAsync({ force: true });
    loop.masterPlay = true;
    await dc.runDeviceCapabilityCheckAsync();
    expect(loop.toggles).toEqual([]);
  });

  it("doesn't start a main loop that isn't running yet (the boot's check)", async () => {
    await (await loadAsync()).runDeviceCapabilityCheckAsync();
    expect(loop.toggles).toEqual([]);
  });

  it('reports its progress, growing only, and a throwing callback fails nothing', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const progress: [string, number][] = [];
    const dc = await loadAsync();
    await dc.runDeviceCapabilityCheckAsync({ onProgress: (...args) => progress.push(args) });
    expect(progress).toEqual([
      ['PROBE', 0],
      ['PROBE', 0.05],
      ['PROBE', 0.15],
      ['GPU', 0.5],
      ['CPU', 0.85],
      ['DONE', 1],
    ]);

    progress.length = 0;
    await dc.runDeviceCapabilityCheckAsync({ onProgress: (...args) => progress.push(args) });
    expect(progress).toEqual([
      ['PROBE', 0],
      ['DONE', 1],
    ]);

    const report = await dc.runDeviceCapabilityCheckAsync({
      force: true,
      onProgress: () => {
        throw new Error('progress');
      },
    });
    expect(report.fromCache).toBe(false);
    expect(error).toHaveBeenCalledTimes(6);
  });
});
