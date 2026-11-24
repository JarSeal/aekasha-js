// The device capability check's last report and its listeners (p240), apart from the check
// (`DeviceCapabilities.ts`): an app reads the report in its `start` with a static import, and that
// import must not bring the check (the probe, the scoring, the storage) into its first download.
// The check writes the report here; nothing here measures or scores.
import { lerror } from '../../utils/Logger';
import type { DeviceCapabilityReport } from './DeviceCapabilitiesTypes';

/** A listener of {@link onDeviceCapabilityReport}. */
export type DeviceCapabilityListener = (report: DeviceCapabilityReport) => void;

let lastReport: DeviceCapabilityReport | null = null;
const listeners = new Set<DeviceCapabilityListener>();

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
 * Calls `listener` with every report a check makes from now on (not the one there already is:
 * read {@link getDeviceCapabilityReport} for it), and in the debug env with the last report scored
 * again when the debug tab's forced levels change.
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

/**
 * Sets the last report and calls the listeners with it; one that throws is logged and doesn't stop
 * the others. The check calls it.
 * @internal
 */
export const _setDeviceCapabilityReport = (report: DeviceCapabilityReport) => {
  lastReport = report;
  for (const listener of [...listeners]) {
    try {
      listener(report);
    } catch (err) {
      lerror('Device capabilities: a report listener threw.', err);
    }
  }
};
