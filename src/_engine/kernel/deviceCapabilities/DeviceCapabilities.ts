// The device capability check (p240): measures what the device can do, once, keeps the
// measurements in localStorage, and scores them against the targets on every check. Advisory: the
// engine applies none of its recommendations. Nothing here runs unless the boot (`runAtInit`) or
// the app calls the check, and the boot imports this module only then.
import { getConfig } from '../config/Config';
import { lsGetItem, lsRemoveItem, lsSetItem } from '../../utils/LocalAndSessionStorage';
import { hashStringFNV1a } from '../../utils/Hash';
import { lerror, lwarn } from '../../utils/Logger';
import {
  probeDeviceAsync,
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
export const DEVICE_CAPABILITY_REPORT_VERSION = 1;

/**
 * The localStorage key of the stored measurements.
 * @internal
 */
export const DEVICE_CAPABILITIES_LS_KEY = 'AEK_deviceCapabilities';

const DEFAULT_MAX_AGE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

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
};

/** A listener of {@link onDeviceCapabilityReport}. */
export type DeviceCapabilityListener = (report: DeviceCapabilityReport) => void;

let lastReport: DeviceCapabilityReport | null = null;
let inFlight: Promise<DeviceCapabilityReport> | null = null;
let hasWarnedMemoryCap = false;
const listeners = new Set<DeviceCapabilityListener>();

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
 * and not older than `maxAgeDays`. */
const readStored = (fingerprint: string, now: number) => {
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
    !stored.measurements
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

const runCheckAsync = async (opts: DeviceCapabilityCheckOpts) => {
  const saveToLS = opts.saveToLS ?? getSettings().saveToLS ?? true;
  const env = readBrowserProbeEnv();
  const { text, adapter } = await readDeviceFingerprintInputAsync(env);
  const fingerprint = hashStringFNV1a(text).toString(36);
  const now = Date.now();

  const stored = saveToLS && !opts.force ? readStored(fingerprint, now) : null;
  let measurements: DeviceCapabilityMeasurements;
  let measuredAt: number;
  if (stored) {
    measurements = stored.measurements;
    measuredAt = stored.measuredAt;
  } else {
    measurements = await probeDeviceAsync(env, adapter);
    measuredAt = now;
    if (saveToLS) {
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
  notifyListeners(report);
  return report;
};

/**
 * Checks what the device can do: probes the GPU, memory, CPU, display and page, rates the
 * device's levels (`LOW` to `ULTRA`, the shadow presets' scale), checks the targets and suggests
 * settings. A stored result that's still valid for this device (`saveToLS`) is used without
 * measuring again; its verdict is scored with the current targets. The engine applies nothing:
 * the app reads the report and passes what it wants (eg. to `createRenderer`).
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
