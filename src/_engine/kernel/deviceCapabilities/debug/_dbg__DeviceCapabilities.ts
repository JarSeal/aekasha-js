// The Device capabilities tab (p240 Phase 3): the last check's levels, target checks,
// recommendations and measurements, the buttons that run the check again or clear its stored
// result, the forced levels (a debug override of the levels the report gives, saved per browser)
// and the calibration tool's buttons. Everything is read through getters on a refresh, so the tab
// is kept on a scene change, and every report refreshes it.
import { createDebuggerTab, updateDebuggerTab, addDebugToast } from '../../../debug/DebuggerGUI';
import type { DebuggerPaneItem } from '../../../debug/DebuggerGUI';
import { getNoteItem } from '../../../debug/_dbg__DebugWindowGrid';
import { createTable } from '../../../ui/data/Table';
import type { TableColumn } from '../../../ui/data/TableTypes';
import { lerror } from '../../../utils/Logger';
import { QUALITY_LEVELS, type QualityLevel } from '../../../utils/QualityLevel';
import {
  _getUnforcedDeviceVerdict,
  _setForcedDeviceLevels,
  clearStoredDeviceCapabilityReport,
  runDeviceCapabilityCheckAsync,
} from '../DeviceCapabilities';
import { getDeviceCapabilityReport, onDeviceCapabilityReport } from '../DeviceCapabilityReports';
import type {
  DeviceCapabilityCheckPhase,
  DeviceCapabilityChecks,
  DeviceCapabilityReport,
  DeviceLevelCategory,
} from '../DeviceCapabilitiesTypes';
import type { ForcedDeviceLevels } from '../DeviceScoring';
import styles from './DeviceCapabilitiesDebug.module.scss';

const TAB_ID = 'deviceCapabilitiesControls';
const LS_KEY = 'AEK_debugDeviceCapabilities';
const NONE = '-';

type LevelKey = DeviceLevelCategory | 'overall';
type ForcedChoice = QualityLevel | 'OFF';

const LEVEL_KEYS: readonly LevelKey[] = ['overall', 'gpu', 'cpu', 'memory', 'gpuMemory'];
const LEVEL_LABELS: Record<LevelKey, string> = {
  overall: 'Overall',
  gpu: 'GPU',
  cpu: 'CPU',
  memory: 'Memory',
  gpuMemory: 'GPU memory',
};
const CHECK_LABELS: Record<keyof DeviceCapabilityChecks, string> = {
  fps: 'Frame rate',
  deviceMemory: 'System memory',
  gpuMemory: 'GPU memory',
  cpuCores: 'CPU cores',
  webgpu: 'WebGPU',
  gpuFeatures: 'GPU features',
  minLevels: 'Least levels',
};
const PHASE_TEXTS: Record<DeviceCapabilityCheckPhase, string> = {
  PROBE: 'Probing',
  GPU: 'GPU benchmark',
  CPU: 'CPU benchmark',
  DONE: 'Scoring',
};
const FORCED_OPTIONS = [
  { value: 'OFF', text: 'Off (the device)' },
  ...QUALITY_LEVELS.map((level) => ({ value: level, text: level })),
];

const deviceCapabilitiesState = {
  forced: {
    overall: 'OFF',
    gpu: 'OFF',
    cpu: 'OFF',
    memory: 'OFF',
    gpuMemory: 'OFF',
  } as Record<LevelKey, ForcedChoice>,
};

/** What the tab's buttons last did: shown on the Check row. */
let status = 'Not run from this tab';
let isRunning = false;

const refreshTab = () => updateDebuggerTab(TAB_ID);

const isQualityLevel = (value: unknown): value is QualityLevel =>
  QUALITY_LEVELS.includes(value as QualityLevel);

/** The forced levels the tab's selects choose, without the ones that are off. */
const readForcedLevels = (): ForcedDeviceLevels => {
  const forced: ForcedDeviceLevels = {};
  for (const key of LEVEL_KEYS) {
    const choice = deviceCapabilitiesState.forced[key];
    if (isQualityLevel(choice)) forced[key] = choice;
  }
  return forced;
};

/** A saved value that isn't a choice (an older save, a hand edit) is off. */
const sanitizeForcedState = () => {
  const forced = deviceCapabilitiesState.forced;
  for (const key of LEVEL_KEYS) {
    if (!isQualityLevel(forced[key])) forced[key] = 'OFF';
  }
};

const formatValue = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return NONE;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
};

const round = (n: number, digits = 2) => Math.round(n * 10 ** digits) / 10 ** digits;

/** A monitor of the last report, `-` before one. */
const reportRow = (
  label: string,
  read: (report: DeviceCapabilityReport) => unknown
): DebuggerPaneItem => ({
  label,
  get: () => {
    const report = getDeviceCapabilityReport();
    return report ? formatValue(read(report)) : NONE;
  },
  readonly: true,
  interval: 'refresh',
});

/** Runs the check from the tab (`force`: measure again), its progress on the Check row. */
const runCheckFromTabAsync = async (force: boolean) => {
  if (isRunning) return;
  isRunning = true;
  status = 'Starting';
  refreshTab();
  try {
    const report = await runDeviceCapabilityCheckAsync({
      force,
      onProgress: (phase, progress01) => {
        status = `${PHASE_TEXTS[phase]} (${Math.round(progress01 * 100)} %)`;
        refreshTab();
      },
    });
    const benchmarkMs = report.measurements.benchmark?.durationMs;
    status = report.fromCache
      ? 'From the stored result'
      : benchmarkMs !== undefined
        ? `Measured (benchmark ${Math.round(benchmarkMs)} ms)`
        : 'Measured (no benchmark)';
  } catch (err) {
    status = `Failed: ${err instanceof Error ? err.message : String(err)}`;
    lerror('Device capabilities: the check failed.', err);
  } finally {
    isRunning = false;
    refreshTab();
  }
};

/** Runs one of the calibration tool's measurements, its result in the console. */
const runCalibrationAsync = async (kind: 'MEASURE' | 'TRACE') => {
  if (isRunning) return;
  isRunning = true;
  status = kind === 'MEASURE' ? 'Calibrating the scene' : 'Tracing the GPU benchmark';
  refreshTab();
  try {
    const calibration = await import('./_dbg__DeviceCalibration');
    if (kind === 'MEASURE') await calibration.measureDeviceCalibrationAsync();
    else await calibration.traceGpuBenchmarkAsync();
    status = 'Calibration logged to the console';
    addDebugToast({ title: 'Device calibration', message: 'Logged to the console' });
  } catch (err) {
    status = `Calibration failed: ${err instanceof Error ? err.message : String(err)}`;
    lerror('Device capabilities: the calibration failed.', err);
  } finally {
    isRunning = false;
    refreshTab();
  }
};

type LevelRow = {
  id: LevelKey;
  label: string;
  level: string;
  measured: string;
  source: string;
  score: string;
  isForced: boolean;
};

const getLevelRows = (): LevelRow[] => {
  const report = getDeviceCapabilityReport();
  if (!report) return [];
  const { levels, scores } = report.verdict;
  const measured = _getUnforcedDeviceVerdict()?.levels ?? levels;
  return LEVEL_KEYS.map((id) => ({
    id,
    label: LEVEL_LABELS[id],
    level: levels[id] ?? 'UNKNOWN',
    measured: measured[id] ?? 'UNKNOWN',
    source: id === 'overall' ? 'The lowest' : levels.sources[id],
    score: id === 'overall' ? '' : formatValue(scores[id]),
    isForced: levels.forced && levels[id] !== measured[id],
  }));
};

const LEVEL_COLUMNS: TableColumn<LevelRow>[] = [
  { key: 'label', label: 'Category', rowHeader: true },
  {
    key: 'level',
    label: 'Level',
    format: (value, row) => (row.isForced ? `${String(value)} (forced)` : String(value)),
    tone: (row) => (row.isForced ? 'warning' : null),
  },
  { key: 'measured', label: 'Measured', headerTooltip: "The device's own level" },
  { key: 'source', label: 'Source' },
  { key: 'score', label: 'Score', align: 'end', headerTooltip: 'Of the highest band, 0-100' },
];

type CheckRow = {
  id: keyof DeviceCapabilityChecks;
  label: string;
  result: string;
  measured: string;
  required: string;
};

const getCheckRows = (): CheckRow[] => {
  const checks = getDeviceCapabilityReport()?.verdict.checks;
  if (!checks) return [];
  return (Object.keys(CHECK_LABELS) as (keyof DeviceCapabilityChecks)[]).map((id) => ({
    id,
    label: CHECK_LABELS[id],
    result: checks[id].result,
    measured: formatValue(checks[id].measured),
    required: formatValue(checks[id].required),
  }));
};

const CHECK_COLUMNS: TableColumn<CheckRow>[] = [
  { key: 'label', label: 'Target', rowHeader: true },
  {
    key: 'result',
    label: 'Result',
    tone: (row) => (row.result === 'PASS' ? 'success' : row.result === 'FAIL' ? 'danger' : 'muted'),
  },
  { key: 'measured', label: 'Measured' },
  { key: 'required', label: 'Required' },
];

/** A table of the last report's rows, read again on every refresh of the tab. */
const tableItem = <T extends { id: string }>(
  caption: string,
  columns: TableColumn<T>[],
  getRows: () => T[]
): DebuggerPaneItem => ({
  type: 'custom',
  build: (container) => {
    const table = createTable<T>({
      caption,
      captionHidden: true,
      columns,
      rows: getRows,
      empty: 'No report yet',
      class: styles.table,
    });
    container.add(table.cmp);
    return () => table.refresh();
  },
});

const getGpuKind = ({ gpu }: DeviceCapabilityReport['measurements']) => {
  if (gpu.isFallbackAdapter) return 'Software';
  if (gpu.isUnifiedMemory) return 'Unified memory';
  if (gpu.isIntegrated === true) return 'Integrated';
  if (gpu.isIntegrated === false) return 'Discrete';
  return 'Unknown';
};

const getMeasurementsFolder = (): DebuggerPaneItem => ({
  type: 'folder',
  id: 'measurements',
  title: 'Measurements',
  content: [
    reportRow('Measured at', (r) => new Date(r.measuredAt).toLocaleString()),
    reportRow('From the stored result', (r) => r.fromCache),
    {
      type: 'folder',
      id: 'gpu',
      title: 'GPU',
      expanded: false,
      content: [
        reportRow('API', (r) => r.measurements.gpu.api),
        reportRow('Kind', (r) => getGpuKind(r.measurements)),
        reportRow('Vendor', (r) => r.measurements.gpu.vendor),
        reportRow('Architecture', (r) => r.measurements.gpu.architecture),
        reportRow('Device', (r) => r.measurements.gpu.device),
        reportRow('Description', (r) => r.measurements.gpu.description),
        reportRow('Renderer (WebGL)', (r) => r.measurements.gpu.webgl2?.unmaskedRenderer),
        reportRow('Canvas format', (r) => r.measurements.gpu.preferredCanvasFormat),
        reportRow('WebGPU features', (r) => r.measurements.gpu.features.length),
        reportRow('WebGL2 max texture', (r) => r.measurements.gpu.webgl2?.maxTextureSize),
        reportRow('WebGL2 max samples', (r) => r.measurements.gpu.webgl2?.maxSamples),
      ],
    },
    {
      type: 'folder',
      id: 'benchmark',
      title: 'Benchmark',
      expanded: false,
      content: [
        reportRow('GPU API', (r) => r.measurements.benchmark?.gpu?.api),
        reportRow('Target (px)', (r) => {
          const gpu = r.measurements.benchmark?.gpu;
          return gpu ? `${gpu.width} × ${gpu.height}` : null;
        }),
        reportRow('Fill (MPix-ops/ms)', (r) => {
          const fill = r.measurements.benchmark?.gpu?.fillRateMPixOpsPerMs;
          return fill === undefined ? null : round(fill);
        }),
        reportRow('Triangles (M/ms)', (r) => {
          const tris = r.measurements.benchmark?.gpu?.trianglesPerMs;
          return tris === undefined ? null : round(tris / 1e6, 3);
        }),
        reportRow('Timer queries', (r) => r.measurements.benchmark?.gpu?.usedTimestampQuery),
        reportRow('CPU score', (r) => r.measurements.cpu.benchScore),
        reportRow('Duration (ms)', (r) => {
          const ms = r.measurements.benchmark?.durationMs;
          return ms === undefined ? null : Math.round(ms);
        }),
        reportRow('Stalled', (r) => r.measurements.benchmark?.isStalled),
      ],
    },
    {
      type: 'folder',
      id: 'cpuMemory',
      title: 'CPU and memory',
      expanded: false,
      content: [
        reportRow('CPU cores', (r) => r.measurements.cpu.cores),
        reportRow('System memory (GB)', (r) => r.measurements.memory.deviceMemoryGB),
        reportRow('JS heap limit (MB)', (r) => r.measurements.memory.jsHeapLimitMB),
        reportRow('GPU memory (MB)', (r) => r.measurements.gpuMemoryMB.value),
        reportRow('GPU memory source', (r) => r.measurements.gpuMemoryMB.source),
      ],
    },
    {
      type: 'folder',
      id: 'displayPage',
      title: 'Display and page',
      expanded: false,
      content: [
        reportRow('Screen (CSS px)', (r) => {
          const { width, height } = r.measurements.display;
          return `${width} × ${height}`;
        }),
        reportRow('Pixel ratio', (r) => r.measurements.display.devicePixelRatio),
        reportRow('Refresh rate (Hz)', (r) => r.measurements.display.refreshHz),
        reportRow('HDR', (r) => r.measurements.display.hdr),
        reportRow('Wide gamut (P3)', (r) => r.measurements.display.wideGamut),
        reportRow('Cross-origin isolated', (r) => r.measurements.env.crossOriginIsolated),
        reportRow('OffscreenCanvas', (r) => r.measurements.env.offscreenCanvas),
        reportRow('Mobile', (r) => r.measurements.env.isMobile),
        reportRow('Coarse pointer', (r) => r.measurements.env.coarsePointer),
      ],
    },
  ],
});

const forcedSelect = (key: LevelKey): DebuggerPaneItem<typeof deviceCapabilitiesState> => ({
  key: `forced.${key}` as const,
  label: LEVEL_LABELS[key],
  options: FORCED_OPTIONS,
  onChange: () => {
    _setForcedDeviceLevels(readForcedLevels());
    refreshTab();
  },
});

const getContent = (): DebuggerPaneItem<typeof deviceCapabilitiesState>[] => [
  getNoteItem(() =>
    getDeviceCapabilityReport()
      ? ''
      : 'No check has run in this page: run one here, or set AppConfig.deviceCapabilities.runAtInit.'
  ),
  { label: 'Check', get: () => status, readonly: true, interval: 'refresh' },
  {
    type: 'button',
    title: 'Run the check',
    disabled: () => isRunning,
    onClick: () => void runCheckFromTabAsync(false),
  },
  {
    type: 'button',
    title: 'Measure again',
    disabled: () => isRunning,
    onClick: () => void runCheckFromTabAsync(true),
  },
  {
    type: 'button',
    title: 'Clear the stored result',
    onClick: () => {
      clearStoredDeviceCapabilityReport();
      status = 'Stored result cleared: the next check measures';
      refreshTab();
    },
  },
  { type: 'separator' },
  {
    type: 'folder',
    id: 'levels',
    title: 'Levels',
    content: [tableItem('Device levels', LEVEL_COLUMNS, getLevelRows)],
  },
  {
    type: 'folder',
    id: 'forcedLevels',
    title: 'Forced levels',
    content: [
      getNoteItem(
        "Debug only: the report's levels, least-level check and recommendations as if the device rated these. A forced overall sets every category not forced on its own. Saved in this browser."
      ),
      ...LEVEL_KEYS.map(forcedSelect),
      {
        type: 'button',
        title: 'Clear the forced levels',
        disabled: () => Object.keys(readForcedLevels()).length === 0,
        onClick: () => clearForcedLevels(),
      },
    ],
  },
  {
    type: 'folder',
    id: 'targets',
    title: 'Targets',
    content: [
      reportRow('Estimated FPS', (r) => r.verdict.estimatedFps),
      reportRow('FPS target', (r) => r.verdict.effectiveFpsTarget),
      reportRow('Meets the targets', (r) => r.verdict.meetsTargets),
      tableItem('Target checks', CHECK_COLUMNS, getCheckRows),
    ],
  },
  {
    type: 'folder',
    id: 'recommendations',
    title: 'Recommendations',
    content: [
      reportRow('Pixel ratio', (r) => r.verdict.recommendations.pixelRatio),
      reportRow('Antialias', (r) => r.verdict.recommendations.antialias),
      reportRow('Shadow quality', (r) => r.verdict.recommendations.shadowQuality),
      reportRow('PostFX', (r) => r.verdict.recommendations.postFx),
      reportRow('Render backend', (r) => r.verdict.recommendations.renderBackend),
      reportRow('Physics worker', (r) => r.verdict.recommendations.physicsWorkerTarget),
    ],
  },
  getMeasurementsFolder(),
  {
    type: 'folder',
    id: 'calibration',
    title: 'Calibration',
    expanded: false,
    content: [
      getNoteItem(
        "Measures the running scene's frame time at three pixel ratios against the reference frame's prediction, or traces the GPU benchmark's batches: the results go to the console (p240 Phase 2)."
      ),
      {
        type: 'button',
        title: 'Measure the scene',
        disabled: () => isRunning,
        onClick: () => void runCalibrationAsync('MEASURE'),
      },
      {
        type: 'button',
        title: 'Trace the GPU benchmark',
        disabled: () => isRunning,
        onClick: () => void runCalibrationAsync('TRACE'),
      },
    ],
  },
];

const clearForcedLevels = () => {
  for (const key of LEVEL_KEYS) deviceCapabilitiesState.forced[key] = 'OFF';
  _setForcedDeviceLevels(null);
  refreshTab();
};

/**
 * Registers the Device capabilities tab, applies its saved forced levels and refreshes it on every
 * report. `registerDeviceCapabilitiesDebugGUI` calls it once.
 * @internal
 */
export const initDeviceCapabilitiesDebugGUI = () => {
  createDebuggerTab({
    id: TAB_ID,
    title: 'Device capabilities',
    icon: 'cpu',
    // Everything is read through getters on a refresh
    keepOnSceneChange: true,
    lsKey: LS_KEY,
    state: deviceCapabilitiesState,
    persistKeys: ['forced'],
    onClearLS: clearForcedLevels,
    content: () => [{ pane: true, content: getContent() }],
  });
  // Hydrated by createDebuggerTab
  sanitizeForcedState();
  _setForcedDeviceLevels(readForcedLevels());
  onDeviceCapabilityReport(refreshTab);
};
