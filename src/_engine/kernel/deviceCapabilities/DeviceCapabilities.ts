// The device capability check (p240): measures what the device can do, once, keeps the
// measurements in localStorage, and scores them against the targets on every check. Advisory: the
// engine applies none of its recommendations. Nothing here runs unless the boot (`runAtInit`) or
// the app calls the check, and the boot imports this module only then; the benchmark
// (`DeviceBenchmark.ts` and the modules it imports) is `import()`ed only when it measures.
import { getConfig } from '../config/Config';
import { getReadOnlyLoopState, toggleMainPlay } from '../loop/MainLoop';
import { getCanvasSize } from '../render/CanvasSize';
import { lsGetItem, lsRemoveItem, lsSetItem } from '../../utils/LocalAndSessionStorage';
import { hashStringFNV1a } from '../../utils/Hash';
import { lerror, lwarn } from '../../utils/Logger';
import {
  type DeviceProbeEnv,
  probeDeviceAsync,
  type ProbeGpuAdapter,
  readBrowserProbeEnv,
  readDeviceFingerprintInputAsync,
} from './DeviceProbe';
import {
  DEVICE_MEMORY_CAP_GB,
  resolveDeviceLevelThresholds,
  resolveDeviceTargets,
  scoreDeviceCapabilities,
} from './DeviceScoring';
import type {
  DeviceCapabilityCheckPhase,
  DeviceCapabilityMeasurements,
  DeviceCapabilityReport,
  DeviceCapabilityTargets,
  DeviceCapabilityVerdict,
} from './DeviceCapabilitiesTypes';

/**
 * The measuring's version: a stored result of another version is measured again. Bump it when
 * the measurements change shape or meaning.
 * @internal
 */
export const DEVICE_CAPABILITY_REPORT_VERSION = 2;

/**
 * The localStorage key of the stored measurements.
 * @internal
 */
export const DEVICE_CAPABILITIES_LS_KEY = 'AEK_deviceCapabilities';

const DEFAULT_MAX_AGE_DAYS = 30;
const DEFAULT_BENCHMARK_BUDGET_MS = 1500;
const DAY_MS = 24 * 60 * 60 * 1000;
/** The target resolution when the canvas has no size (a hidden container), CSS pixels. */
const FALLBACK_TARGET_SIZE = { width: 1280, height: 720 };
/** The check's progress when the probe is done (the benchmark's steps follow). */
const PROGRESS_PROBE_END = 0.05;

/** What localStorage keeps: the raw measurements, never a verdict (p240 §4). */
type StoredDeviceCapabilities = {
  reportVersion: number;
  fingerprint: string;
  measuredAt: number;
  measurements: DeviceCapabilityMeasurements;
};

/** {@link runDeviceCapabilityCheckAsync}'s options. */
export type DeviceCapabilityCheckOpts = {
  /** Measure again, ignoring a valid stored result. Default false. */
  force?: boolean;
  /** Read and write the stored result. Default `AppConfig.deviceCapabilities.saveToLS`, else true. */
  saveToLS?: boolean;
  /** Targets for this check's verdict, over the config's (`AppConfig.deviceCapabilities.targets`). */
  targets?: DeviceCapabilityTargets;
  /** Run the benchmark when measuring (a stored result without one is then measured again).
   * Default `AppConfig.deviceCapabilities.benchmark.enabled`, else true. */
  benchmark?: boolean;
  /** Pause the main loop while the benchmark runs, so the app's frames don't share the GPU with
   * it; its play state is restored after. Only when the loop is running. Default true. */
  pauseMainLoop?: boolean;
  /** Called as the check goes, with its phase and its share done, 0-1 (it only grows): eg. a
   * settings menu's progress bar. A check from a stored result reports `PROBE` and `DONE` only. */
  onProgress?: (phase: DeviceCapabilityCheckPhase, progress01: number) => void;
};

/** A listener of {@link onDeviceCapabilityReport}. */
export type DeviceCapabilityListener = (report: DeviceCapabilityReport) => void;

let lastReport: DeviceCapabilityReport | null = null;
let inFlight: Promise<DeviceCapabilityReport> | null = null;
let hasWarnedMemoryCap = false;
const listeners = new Set<DeviceCapabilityListener>();

type ResolvedTargets = ReturnType<typeof resolveDeviceTargets>;

/** The config's section, or none. */
const getSettings = () => getConfig().deviceCapabilities ?? {};

/** The targets: the engine's, the config's, then `targets`. Warns once on a memory target the
 * browser can't report. */
const getTargets = (targets?: DeviceCapabilityTargets) => {
  const resolved = resolveDeviceTargets(getSettings().targets, targets);
  if (resolved.minDeviceMemoryGB > DEVICE_MEMORY_CAP_GB && !hasWarnedMemoryCap) {
    hasWarnedMemoryCap = true;
    lwarn(
      `Device capabilities: minDeviceMemoryGB ${resolved.minDeviceMemoryGB} is over what browsers report (${DEVICE_MEMORY_CAP_GB} GB at most): it's checked against ${DEVICE_MEMORY_CAP_GB}.`
    );
  }
  return resolved;
};

/** The verdict for the measurements and the targets. */
const scoreMeasurements = (
  measurements: DeviceCapabilityMeasurements,
  targets?: DeviceCapabilityTargets
): DeviceCapabilityVerdict =>
  scoreDeviceCapabilities(
    measurements,
    getTargets(targets),
    resolveDeviceLevelThresholds(getSettings().levelThresholds)
  );

/** The stored result when it's valid for this device (p240 §4): the same version and fingerprint,
 * not older than `maxAgeDays`, and benchmarked when the check wants a benchmark. */
const readStored = (fingerprint: string, now: number, wantsBenchmark: boolean) => {
  const stored = lsGetItem(
    DEVICE_CAPABILITIES_LS_KEY,
    {}
  ) as Partial<StoredDeviceCapabilities> | null;
  if (
    !stored ||
    stored.reportVersion !== DEVICE_CAPABILITY_REPORT_VERSION ||
    stored.fingerprint !== fingerprint ||
    typeof stored.measuredAt !== 'number' ||
    typeof stored.measurements !== 'object' ||
    !stored.measurements ||
    (wantsBenchmark && !stored.measurements.benchmark)
  ) {
    return null;
  }
  const maxAgeDays = getSettings().maxAgeDays ?? DEFAULT_MAX_AGE_DAYS;
  const age = now - stored.measuredAt;
  if (age < 0 || (maxAgeDays > 0 && age > maxAgeDays * DAY_MS)) return null;
  return stored as StoredDeviceCapabilities;
};

/** Calls the listeners; one that throws is logged and doesn't stop the others. */
const notifyListeners = (report: DeviceCapabilityReport) => {
  for (const listener of [...listeners]) {
    try {
      listener(report);
    } catch (err) {
      lerror('Device capabilities: a report listener threw.', err);
    }
  }
};

/**
 * The target resolution in pixels: `'CANVAS'` is the canvas's size (`getCanvasSize`: the window,
 * or a mounted engine's container) × `devicePixelRatio`.
 * @internal
 */
export const readTargetPixelSize = (
  resolution: ResolvedTargets['resolution'],
  devicePixelRatio: number
) => {
  if (resolution !== 'CANVAS') return { width: resolution.width, height: resolution.height };
  const canvas = getCanvasSize();
  const size = canvas.width > 0 && canvas.height > 0 ? canvas : FALLBACK_TARGET_SIZE;
  return {
    width: Math.round(size.width * devicePixelRatio),
    height: Math.round(size.height * devicePixelRatio),
  };
};

/** Pauses the main loop when it's running; returns its resume, null when it wasn't paused. */
const pauseRunningMainLoop = () => {
  const { masterPlay, isMasterPlaying } = getReadOnlyLoopState();
  if (!masterPlay || !isMasterPlaying) return null;
  toggleMainPlay(false);
  return () => {
    if (!getReadOnlyLoopState().masterPlay) toggleMainPlay(true);
  };
};

/** The probe's measurements with the benchmark's added; without them when its module fails to
 * load (warned). */
const benchmarkAsync = async (
  measurements: DeviceCapabilityMeasurements,
  env: DeviceProbeEnv,
  adapter: ProbeGpuAdapter | null,
  opts: DeviceCapabilityCheckOpts,
  reportProgress: NonNullable<DeviceCapabilityCheckOpts['onProgress']>
): Promise<DeviceCapabilityMeasurements> => {
  let benchmarkModule: typeof import('./DeviceBenchmark');
  try {
    benchmarkModule = await import('./DeviceBenchmark');
  } catch (err) {
    lwarn('Device capabilities: the benchmark failed to load (measured without it).', err);
    return measurements;
  }
  const resume = opts.pauseMainLoop ?? true ? pauseRunningMainLoop() : null;
  try {
    const { width, height } = readTargetPixelSize(
      getTargets(opts.targets).resolution,
      env.devicePixelRatio
    );
    const result = await benchmarkModule.runDeviceBenchmarkAsync({
      probeEnv: env,
      adapter,
      gpu: measurements.gpu,
      width,
      height,
      budgetMs: getSettings().benchmark?.budgetMs ?? DEFAULT_BENCHMARK_BUDGET_MS,
      onProgress: reportProgress,
    });
    return {
      ...measurements,
      display: { ...measurements.display, refreshHz: result.refreshHz },
      cpu: { ...measurements.cpu, benchScore: result.cpuScore },
      benchmark: result.benchmark,
    };
  } finally {
    resume?.();
  }
};

/** The option's progress callback, its throws logged (a broken progress bar doesn't fail the
 * check), its progress never going down. */
const createProgressReporter = (onProgress: DeviceCapabilityCheckOpts['onProgress']) => {
  let last = 0;
  return (phase: DeviceCapabilityCheckPhase, progress01: number) => {
    if (!onProgress) return;
    last = Math.max(last, Math.min(1, progress01));
    try {
      onProgress(phase, last);
    } catch (err) {
      lerror('Device capabilities: an onProgress callback threw.', err);
    }
  };
};

const runCheckAsync = async (opts: DeviceCapabilityCheckOpts) => {
  const settings = getSettings();
  const saveToLS = opts.saveToLS ?? settings.saveToLS ?? true;
  const wantsBenchmark = opts.benchmark ?? settings.benchmark?.enabled ?? true;
  const reportProgress = createProgressReporter(opts.onProgress);
  reportProgress('PROBE', 0);
  const env = readBrowserProbeEnv();
  const { text, adapter } = await readDeviceFingerprintInputAsync(env);
  const fingerprint = hashStringFNV1a(text).toString(36);
  const now = Date.now();

  const stored = saveToLS && !opts.force ? readStored(fingerprint, now, wantsBenchmark) : null;
  let measurements: DeviceCapabilityMeasurements;
  let measuredAt: number;
  if (stored) {
    measurements = stored.measurements;
    measuredAt = stored.measuredAt;
  } else {
    measurements = await probeDeviceAsync(env, adapter);
    reportProgress('PROBE', PROGRESS_PROBE_END);
    if (wantsBenchmark) {
      measurements = await benchmarkAsync(measurements, env, adapter, opts, reportProgress);
    }
    measuredAt = now;
    // A stalled benchmark's readings are suspect: the next check measures again
    if (saveToLS && !measurements.benchmark?.isStalled) {
      const toStore: StoredDeviceCapabilities = {
        reportVersion: DEVICE_CAPABILITY_REPORT_VERSION,
        fingerprint,
        measuredAt,
        measurements,
      };
      lsSetItem(DEVICE_CAPABILITIES_LS_KEY, toStore);
    }
  }

  const report: DeviceCapabilityReport = {
    reportVersion: DEVICE_CAPABILITY_REPORT_VERSION,
    measuredAt,
    fromCache: Boolean(stored),
    measurements,
    verdict: scoreMeasurements(measurements, opts.targets),
  };
  lastReport = report;
  reportProgress('DONE', 1);
  notifyListeners(report);
  return report;
};

/**
 * Checks what the device can do: probes the GPU, memory, CPU, display and page, benchmarks the
 * GPU and the CPU and samples the refresh rate (within `benchmark.budgetMs`, the main loop paused
 * meanwhile when it runs, a hidden page waited for), rates the device's levels (`LOW` to `ULTRA`,
 * the shadow presets' scale), checks the targets and suggests settings. A stored result that's
 * still valid for this device (`saveToLS`) is used without measuring again (and without
 * downloading the benchmark); its verdict is scored with the current targets. The engine applies
 * nothing: the app reads the report and passes what it wants (eg. to `createRenderer`).
 * @param opts what to measure and score against ({@link DeviceCapabilityCheckOpts})
 * @returns the report, which {@link getDeviceCapabilityReport} also returns from then on
 * @remarks Overlapping calls share one check: a call made while one runs gets that check's report,
 * its own options ignored. A report reaches the {@link onDeviceCapabilityReport} listeners before
 * the promise resolves. The browser's readings are fingerprinting-grade data: the engine never
 * sends them anywhere.
 * @example
 * ```ts
 * import { runDeviceCapabilityCheckAsync } from 'aekasha';
 *
 * const report = await runDeviceCapabilityCheckAsync({ force: true });
 * if (!report.verdict.meetsTargets) console.log(report.verdict.failedTargets);
 * ```
 */
export const runDeviceCapabilityCheckAsync = (
  opts: DeviceCapabilityCheckOpts = {}
): Promise<DeviceCapabilityReport> => {
  if (inFlight) return inFlight;
  const run = runCheckAsync(opts).finally(() => {
    if (inFlight === run) inFlight = null;
  });
  inFlight = run;
  return run;
};

/**
 * The last check's report (the boot's with `runAtInit`, or the app's), or null before one has run.
 * @returns the report; don't change it, it's the one every caller gets
 * @example
 * ```ts
 * import { createRenderer, getDeviceCapabilityReport } from 'aekasha';
 *
 * const recommended = getDeviceCapabilityReport()?.verdict.recommendations;
 * await createRenderer({
 *   devicePixelRatio: recommended?.pixelRatio,
 *   antialias: recommended?.antialias,
 * });
 * ```
 */
export const getDeviceCapabilityReport = () => lastReport;

/**
 * Scores the last check's measurements against other targets, without measuring: eg. whether the
 * device meets a settings preset's targets.
 * @param targets the targets, over the config's
 * @returns the verdict, or null before a check has run
 * @example
 * ```ts
 * import { evaluateDeviceCapabilities } from 'aekasha';
 *
 * const canRunUltra = evaluateDeviceCapabilities({ minLevels: { gpu: 'ULTRA' } })?.meetsTargets;
 * ```
 */
export const evaluateDeviceCapabilities = (
  targets: DeviceCapabilityTargets
): DeviceCapabilityVerdict | null =>
  lastReport ? scoreMeasurements(lastReport.measurements, targets) : null;

/**
 * Removes the stored measurements, so the next check measures again. The last report stays.
 * @example
 * ```ts
 * import { clearStoredDeviceCapabilityReport, runDeviceCapabilityCheckAsync } from 'aekasha';
 *
 * clearStoredDeviceCapabilityReport();
 * await runDeviceCapabilityCheckAsync();
 * ```
 */
export const clearStoredDeviceCapabilityReport = () => lsRemoveItem(DEVICE_CAPABILITIES_LS_KEY);

/**
 * Calls `listener` with every report a check makes from now on (not the one there already is:
 * read {@link getDeviceCapabilityReport} for it).
 * @param listener called with the report
 * @returns the remover
 * @example
 * ```ts
 * import { onDeviceCapabilityReport } from 'aekasha';
 *
 * const stop = onDeviceCapabilityReport((report) => console.log(report.verdict.levels.overall));
 * ```
 */
export const onDeviceCapabilityReport = (listener: DeviceCapabilityListener) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
