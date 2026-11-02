import { createTable } from '../../ui/data/Table';
import type { TableColumn, TableGroup, TableTone } from '../../ui/data/TableTypes';
import type { AnyDebuggerTabDef } from '../DebuggerGUI';
import {
  _getStatsSources,
  type ProfilerOverviewMetricEntry,
  type ProfilerSettings,
  type StatsSource,
} from '../Profiler';
import { lerror } from '../../utils/Logger';
import { formatBytes, formatNumber } from '../../kernel/assets/debug/_dbg__AssetStats';
import { _getFrameProbeSummary, type FrameProbeSummary } from './_dbg__FrameProbe';
import {
  PROFILER_SOURCE,
  type DrawStats,
  type GpuFrameStats,
  type GpuMemoryStats,
  type JsMemoryStats,
  type LongTaskStats,
  type PhysicsObjectStats,
  type PhysicsStepStats,
  type PhysicsSubStepStats,
  type PostFxGpuStats,
  type RayStats,
  type SceneCensus,
  type SceneStats,
} from './_dbg__ProfilerSources';
import type { CensusBucket, InViewTotal } from './_dbg__Census';
import { _readStatsSource, createStatsSourceHolder, type StatsReading } from './_dbg__StatsSources';

export const PROFILER_OVERVIEW_TAB_ID = 'profilerOverview';

/** What the metrics read in one refresh. */
type OverviewSample = {
  frame: FrameProbeSummary;
  /** Reads a stats source, once per refresh (rows that share a source share the reading). */
  get: <T>(id: string) => StatsReading<T>;
};

type MetricValue = {
  value: string;
  /** Small secondary text (min / max, "in view / total", a qualifier). */
  sub?: string;
  /** Why the metric has no value right now. */
  na?: string;
  /** Why the figure needs attention, in words (eg. physics sub-steps at their ceiling): the
   * detail's first words, beside the value's warning tone. */
  warn?: string;
};

type OverviewMetric = {
  id: string;
  label: string;
  /** Shown in a new or reset list. */
  defaultVisible: boolean;
  /** The stats sources it reads, held while the row is shown. */
  sources?: string[];
  read: (sample: OverviewSample) => MetricValue;
};

const NO_FRAMES = 'no frames (main loop paused)';
const MEASURING = 'measuring…';

const formatMs = (ms: number) => `${ms < 10 ? ms.toFixed(2) : ms.toFixed(1)} ms`;
const formatAvg = (n: number) => formatNumber(Math.round(n));
const formatRate = (n: number) => (n < 10 ? n.toFixed(1) : formatAvg(n));

/** The frame metrics need at least one rendered frame in the window. */
const fromFrames =
  (read: (frame: FrameProbeSummary, s: OverviewSample) => MetricValue) => (s: OverviewSample) =>
    s.frame.frames ? read(s.frame, s) : { value: '—', na: NO_FRAMES };

/** A metric of one stats source: its n/a reason, "measuring…" until it has a value. */
const fromSource =
  <T>(id: string, read: (value: T) => MetricValue) =>
  (s: OverviewSample): MetricValue => {
    const reading = s.get<T>(id);
    if (reading.na) return { value: '—', na: reading.na };
    return reading.value === null ? { value: '—', sub: MEASURING } : read(reading.value);
  };

/** What a census was counted against, for a row's secondary text ('' for the main camera). */
const censusCountedIn = (c: SceneCensus) => {
  if (c.view) return ` · ${c.view.title}'s view`;
  return c.isDebugCamera ? " · debug camera's view" : '';
};

/** An in-view census row: the in-view figure, "of <total>", and what it was counted against. */
const censusRow = (
  id: string,
  label: string,
  defaultVisible: boolean,
  pick: (c: SceneCensus) => InViewTotal,
  extra?: (c: SceneCensus) => string
): OverviewMetric => ({
  id,
  label,
  defaultVisible,
  sources: [PROFILER_SOURCE.CENSUS],
  read: fromSource<SceneCensus>(PROFILER_SOURCE.CENSUS, (c) => {
    const { inView, total } = pick(c);
    let sub = `in view, of ${formatNumber(total)}${censusCountedIn(c)}`;
    if (c.isApprox) sub += ' · approx. (BatchedMesh)';
    const more = extra?.(c);
    if (more) sub += ` · ${more}`;
    return { value: formatNumber(inView), sub };
  }),
});

/** The debug helpers the census left out of the scene figures, if any. */
const excludedHelpers = (c: SceneCensus, pick: (b: CensusBucket) => InViewTotal) => {
  const total = c.excludesDebugHelpers ? pick(c.kinds.DEBUG_HELPERS).total : 0;
  return total ? `${formatNumber(total)} in debug helpers (excluded)` : '';
};

const readPhysics = (s: OverviewSample): MetricValue => {
  const step = s.get<PhysicsStepStats>(PROFILER_SOURCE.PHYSICS_STEP);
  const subSteps = s.get<PhysicsSubStepStats>(PROFILER_SOURCE.PHYSICS_SUB_STEPS);
  // Physics off: both sources say so
  if (subSteps.na) return { value: '—', na: subSteps.na };

  const parts: string[] = [];
  const result: MetricValue = { value: '—' };
  if (step.na) {
    result.na = step.na;
  } else if (!step.value) {
    parts.push('waiting for a step');
  } else {
    const { stepMs, dispatchMs, writeBackMs, transport } = step.value;
    result.value = formatMs(stepMs);
    parts.push('step');
    if (dispatchMs !== null) parts.push(`dispatch ${formatMs(dispatchMs)}`);
    if (writeBackMs !== null) {
      // Not the same figure on both transports: never compare them like for like
      const label = transport === 'SHARED_MEMORY' ? 'read latency' : 'transit';
      parts.push(`${label} ${formatMs(writeBackMs)}`);
    }
  }
  if (subSteps.value) {
    const { subSteps: stat, maxSubSteps } = subSteps.value;
    parts.push(`sub-steps ${stat.avg.toFixed(1)}/frame (max ${stat.max})`);
    if (maxSubSteps > 0 && stat.max >= maxSubSteps) {
      result.warn = `sub-steps at the ${maxSubSteps} ceiling`;
    }
  }
  result.sub = parts.join(' · ');
  return result;
};

/** The Overview rows, in their default order. */
const OVERVIEW_METRICS: OverviewMetric[] = [
  {
    id: 'tfps',
    label: 'TFPS (est.)',
    defaultVisible: true,
    sources: [PROFILER_SOURCE.GPU_FRAME],
    read: fromFrames((f, s) => {
      const gpu = s.get<GpuFrameStats>(PROFILER_SOURCE.GPU_FRAME).value;
      if (gpu) {
        const isGpuBound = gpu.ms.avg > f.cpuAvgMs;
        const boundMs = isGpuBound ? gpu.ms.avg : f.cpuAvgMs;
        return {
          value: boundMs > 0 ? (1000 / boundMs).toFixed(0) : '—',
          sub: `${isGpuBound ? 'GPU' : 'CPU'}-bound est. · 1000 / max(CPU, GPU)`,
        };
      }
      return {
        value: f.cpuAvgMs > 0 ? (1000 / f.cpuAvgMs).toFixed(0) : '—',
        sub: 'CPU-bound est. (no GPU time)',
      };
    }),
  },
  {
    id: 'fps',
    label: 'FPS',
    defaultVisible: true,
    read: fromFrames((f) => ({ value: f.fps.toFixed(0), sub: `${f.frames} frames in 1 s` })),
  },
  {
    id: 'frameTime',
    label: 'Frame time',
    defaultVisible: true,
    read: fromFrames((f) => ({
      value: formatMs(f.frameTimeAvgMs),
      sub: `worst ${formatMs(f.frameTimeMaxMs)}`,
    })),
  },
  {
    id: 'cpu',
    label: 'CPU',
    defaultVisible: true,
    read: fromFrames((f) => ({
      value: formatMs(f.cpuAvgMs),
      sub: `max ${formatMs(f.cpuMaxMs)} · main loop per frame`,
    })),
  },
  {
    id: 'gpu',
    label: 'GPU',
    defaultVisible: true,
    sources: [PROFILER_SOURCE.GPU_FRAME],
    read: fromSource<GpuFrameStats>(PROFILER_SOURCE.GPU_FRAME, (g) => ({
      value: formatMs(g.ms.avg),
      sub: `max ${formatMs(g.ms.max)} · per frame, all passes`,
    })),
  },
  {
    id: 'physics',
    label: 'Physics',
    defaultVisible: true,
    sources: [PROFILER_SOURCE.PHYSICS_STEP, PROFILER_SOURCE.PHYSICS_SUB_STEPS],
    read: readPhysics,
  },
  {
    id: 'drawCalls',
    label: 'Draw calls',
    defaultVisible: true,
    sources: [PROFILER_SOURCE.DRAW],
    read: fromSource<DrawStats>(PROFILER_SOURCE.DRAW, (d) => ({
      value: formatAvg(d.drawCalls.avg),
      sub: `max ${formatNumber(d.drawCalls.max)} · per frame, all passes`,
    })),
  },
  {
    id: 'trianglesDrawn',
    label: 'Triangles drawn',
    defaultVisible: true,
    sources: [PROFILER_SOURCE.DRAW],
    read: fromSource<DrawStats>(PROFILER_SOURCE.DRAW, (d) => {
      let sub = `max ${formatNumber(d.triangles.max)} · per frame, all passes`;
      if (d.points.avg > 0) sub += ` · ${formatAvg(d.points.avg)} points`;
      if (d.lines.avg > 0) sub += ` · ${formatAvg(d.lines.avg)} lines`;
      return { value: formatAvg(d.triangles.avg), sub };
    }),
  },
  censusRow('triangles', 'Triangles', true, (c) => c.meshes.primitives),
  censusRow('vertices', 'Vertices', true, (c) => c.meshes.vertices),
  censusRow(
    'meshes',
    'Meshes',
    true,
    (c) => c.meshes.objects,
    (c) => {
      const helpers = excludedHelpers(c, (b) => b.objects);
      return `${helpers ? `${helpers} · ` : ''}census ${formatMs(c.sampleMs)}`;
    }
  ),
  {
    id: 'entities',
    label: 'Entities',
    defaultVisible: true,
    sources: [PROFILER_SOURCE.CENSUS],
    read: fromSource<SceneCensus>(PROFILER_SOURCE.CENSUS, (c) => {
      // An editor view's scene has no entities, and the worlds are the suspended scene's
      if (c.view) return { value: '—', na: `no ECS entities in ${c.view.title}` };
      const worlds = `${c.worlds} world${c.worlds === 1 ? '' : 's'}`;
      const sub = `own Object3D drawn in view, of ${formatNumber(c.entities.total)} in ${worlds}`;
      return { value: formatNumber(c.entities.inView), sub: sub + censusCountedIn(c) };
    }),
  },
  {
    id: 'memJs',
    label: 'JS heap',
    defaultVisible: true,
    sources: [PROFILER_SOURCE.MEMORY_JS],
    read: fromSource<JsMemoryStats>(PROFILER_SOURCE.MEMORY_JS, (m) => ({
      value: formatBytes(m.usedBytes),
      sub: `used, of a ${formatBytes(m.limitBytes)} limit`,
    })),
  },
  {
    id: 'memGpu',
    label: 'GPU memory (est.)',
    defaultVisible: true,
    sources: [PROFILER_SOURCE.MEMORY_GPU],
    read: fromSource<GpuMemoryStats>(PROFILER_SOURCE.MEMORY_GPU, (m) => ({
      value: formatBytes(m.bytes),
      sub: "three's own estimate",
    })),
  },
  censusRow('instances', 'Instances', false, (c) => c.meshes.instances),
  {
    id: 'lights',
    label: 'Lights',
    defaultVisible: false,
    sources: [PROFILER_SOURCE.CENSUS],
    read: fromSource<SceneCensus>(PROFILER_SOURCE.CENSUS, ({ lights }) => {
      const casters = `${lights.shadowCasters} shadow caster${lights.shadowCasters === 1 ? '' : 's'}`;
      const passes = lights.shadowPasses
        ? ` · ${lights.shadowPasses} shadow pass${lights.shadowPasses === 1 ? '' : 'es'} per frame`
        : '';
      return { value: formatNumber(lights.count), sub: `shown · ${casters}${passes}` };
    }),
  },
  {
    id: 'bodies',
    label: 'Physics bodies',
    defaultVisible: false,
    sources: [PROFILER_SOURCE.PHYSICS_OBJECTS],
    read: fromSource<PhysicsObjectStats>(PROFILER_SOURCE.PHYSICS_OBJECTS, (o) => ({
      value: formatNumber(o.bodies),
      sub: `bodies · ${formatNumber(o.colliders)} colliders · ${formatNumber(o.joints)} joints`,
    })),
  },
  {
    id: 'rays',
    label: 'Ray casts',
    defaultVisible: false,
    sources: [PROFILER_SOURCE.RAYS],
    read: fromSource<RayStats>(PROFILER_SOURCE.RAYS, ({ three, physics }) => {
      if (!physics) {
        return {
          value: formatRate(three.avg),
          sub: `Three.js rays per frame, 3 s avg · last frame ${three.lastFrame}`,
        };
      }
      const pending = physics.pending ? ` · ${physics.pending} pending` : '';
      return {
        value: `${formatRate(three.avg)} · ${formatRate(physics.avg)}`,
        sub:
          `Three.js rays · physics queries per frame, 3 s avg · last frame ` +
          `${three.lastFrame} · ${physics.lastFrame}${pending}`,
      };
    }),
  },
  {
    id: 'postFxGpu',
    label: 'PostFX GPU',
    defaultVisible: false,
    sources: [PROFILER_SOURCE.POSTFX],
    read: fromSource<PostFxGpuStats>(PROFILER_SOURCE.POSTFX, (p) => {
      const sub = `CPU ${formatMs(p.cpuMs)} · ${p.passes} passes + composite, per frame`;
      if (p.gpuMs === null) return { value: '—', na: 'no GPU timestamps', sub };
      return { value: formatMs(p.gpuMs), sub };
    }),
  },
  {
    id: 'longTasks',
    label: 'Long tasks',
    defaultVisible: false,
    sources: [PROFILER_SOURCE.LONG_TASKS],
    read: fromSource<LongTaskStats>(PROFILER_SOURCE.LONG_TASKS, (l) => ({
      value: String(l.count),
      sub: l.count ? `in the last second · longest ${formatMs(l.longestMs)}` : 'in the last second',
      warn: l.count > 0 ? 'the main thread was blocked' : undefined,
    })),
  },
  {
    id: 'scene',
    label: 'Scene',
    defaultVisible: false,
    sources: [PROFILER_SOURCE.SCENE],
    read: fromSource<SceneStats>(PROFILER_SOURCE.SCENE, (sc) => ({
      value: sc.currentId || '—',
      sub: sc.isLoading ? `loading${sc.nextId ? ` → ${sc.nextId}` : ''}` : 'loaded',
    })),
  },
];

const metricsById = new Map(OVERVIEW_METRICS.map((m) => [m.id, m]));

// APP ROWS (p618 D14: every registered stats source that isn't the engine's)

/** An app stats source's metric id is this prefix and the source id. */
export const APP_METRIC_PREFIX = 'app:';

const BUILT_IN_SOURCE_IDS: ReadonlySet<string> = new Set(Object.values(PROFILER_SOURCE));

export const isAppMetricId = (id: string) => id.startsWith(APP_METRIC_PREFIX);

/** The registered app stats source of an app metric id, if it is registered now. */
const getAppSource = (metricId: string) => {
  if (!isAppMetricId(metricId)) return undefined;
  const sourceId = metricId.slice(APP_METRIC_PREFIX.length);
  return BUILT_IN_SOURCE_IDS.has(sourceId) ? undefined : _getStatsSources().get(sourceId);
};

/** The metric ids of the registered app stats sources, in registration order. */
const getAppMetricIds = () => {
  const ids: string[] = [];
  for (const id of _getStatsSources().keys()) {
    if (!BUILT_IN_SOURCE_IDS.has(id)) ids.push(APP_METRIC_PREFIX + id);
  }
  return ids;
};

const formatAppValue = (value: unknown) => {
  if (typeof value === 'number') return value.toFixed(2);
  if (typeof value === 'string') return value;
  return JSON.stringify(value) ?? String(value);
};

/** The sources whose `format` threw, logged once each. */
const failedFormats = new WeakSet<StatsSource<unknown>>();

/** An app row: the source's value (its `format`), its n/a reason, "measuring…" until it has one. */
const readAppSource = (source: StatsSource<unknown>, sample: OverviewSample): MetricValue => {
  const reading = sample.get<unknown>(source.id);
  if (reading.na) return { value: '—', na: reading.na };
  if (reading.value === null) return { value: '—', sub: MEASURING };
  try {
    return { value: source.format ? source.format(reading.value) : formatAppValue(reading.value) };
  } catch (err) {
    if (!failedFormats.has(source)) {
      failedFormats.add(source);
      lerror(`Stats source "${source.id}" format failed`, err);
    }
    return { value: '—', na: 'format failed' };
  }
};

// METRIC LIST (the Settings tab's order and visibility)

/**
 * A stored metric list made valid: unknown and repeated ids dropped, missing metrics appended
 * with their default visibility, the engine's rows first and the app rows after them. An app
 * row is kept while its source isn't registered (it comes back with it), and a registered app
 * source without a row gets one, shown. Always a new array.
 * @param list (unknown) the stored list
 */
export const sanitizeOverviewMetrics = (list: unknown): ProfilerOverviewMetricEntry[] => {
  const engineRows: ProfilerOverviewMetricEntry[] = [];
  const appRows: ProfilerOverviewMetricEntry[] = [];
  const seen = new Set<string>();
  if (Array.isArray(list)) {
    for (const entry of list as Partial<ProfilerOverviewMetricEntry>[]) {
      const id = entry?.id;
      if (typeof id !== 'string' || seen.has(id)) continue;
      const isEngine = metricsById.has(id);
      if (!isEngine && !(isAppMetricId(id) && id.length > APP_METRIC_PREFIX.length)) continue;
      seen.add(id);
      (isEngine ? engineRows : appRows).push({ id, visible: Boolean(entry.visible) });
    }
  }
  for (let i = 0; i < OVERVIEW_METRICS.length; i++) {
    const { id, defaultVisible } = OVERVIEW_METRICS[i];
    if (!seen.has(id)) engineRows.push({ id, visible: defaultVisible });
  }
  const appIds = getAppMetricIds();
  for (let i = 0; i < appIds.length; i++) {
    if (!seen.has(appIds[i])) appRows.push({ id: appIds[i], visible: true });
  }
  return engineRows.concat(appRows);
};

/**
 * The rows to show and edit: the stored list, with a row appended (shown) for each app source
 * registered since the list was last sanitized. The stored list itself when nothing is missing.
 * @param settings (object) the live profiler settings
 */
export const getOverviewMetricEntries = (
  settings: Readonly<ProfilerSettings>
): ProfilerOverviewMetricEntry[] => {
  const list = settings.overviewMetrics;
  const appIds = getAppMetricIds();
  let missing: ProfilerOverviewMetricEntry[] | null = null;
  for (let i = 0; i < appIds.length; i++) {
    if (list.some((entry) => entry.id === appIds[i])) continue;
    (missing ??= []).push({ id: appIds[i], visible: true });
  }
  return missing ? list.concat(missing) : list;
};

/** The default order and visibility. */
export const getDefaultOverviewMetrics = () => sanitizeOverviewMetrics([]);

/** A row's label: the engine metric's, or the app source's (its id while it isn't registered). */
export const getOverviewMetricLabel = (id: string) => {
  const metric = metricsById.get(id);
  if (metric) return metric.label;
  if (!isAppMetricId(id)) return id;
  const source = getAppSource(id);
  return source ? source.label : `${id.slice(APP_METRIC_PREFIX.length)} (not registered)`;
};

// THE TABLE (p807 D6: built once per mount, its figures written by `setCell` where they changed)

/** A shown row: its metric id, and its label, figures and value's tone as last written to the
 * table. */
type OverviewRow = {
  id: string;
  label: string;
  value: string;
  detail: string;
  tone: TableTone | null;
};

/** What a metric without a value shows in the Value column (its reason is the detail's text). */
const NA_VALUE = 'n/a';

const OVERVIEW_COLUMNS: TableColumn<OverviewRow>[] = [
  { key: 'label', label: 'Metric', rowHeader: true },
  // A warning's tone, or n/a muted (the word, its reason the detail's)
  { key: 'value', label: 'Value', align: 'end', tone: (row) => row.tone },
  { key: 'detail', label: 'Detail' },
];

const NO_GROUPS: TableGroup<OverviewRow>[] = [];

/** A metric's detail: its warning's words, its n/a reason, then its secondary text. */
const getDetail = ({ sub, na, warn }: MetricValue) => {
  let detail = warn ?? '';
  if (na) detail += detail ? ` · ${na}` : na;
  if (sub) detail += detail ? ` · ${sub}` : sub;
  return detail;
};

/** The shown rows: the engine metrics, then the registered app sources, each in list order. */
const getVisibleRows = (settings: ProfilerSettings) => {
  const metrics: OverviewMetric[] = [];
  const appSources: StatsSource<unknown>[] = [];
  const entries = getOverviewMetricEntries(settings);
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry.visible) continue;
    const metric = metricsById.get(entry.id);
    if (metric) {
      metrics.push(metric);
      continue;
    }
    const source = getAppSource(entry.id);
    if (source) appSources.push(source);
  }
  return { metrics, appSources };
};

type VisibleRows = ReturnType<typeof getVisibleRows>;

const getVisibleSourceIds = ({ metrics, appSources }: VisibleRows) => {
  const ids: string[] = [];
  for (let i = 0; i < metrics.length; i++) ids.push(...(metrics[i].sources || []));
  for (let i = 0; i < appSources.length; i++) ids.push(appSources[i].id);
  return ids;
};

const createSample = (): OverviewSample => {
  const readings = new Map<string, StatsReading<unknown>>();
  return {
    frame: _getFrameProbeSummary(),
    get: <T>(id: string) => {
      let reading = readings.get(id);
      if (!reading) {
        reading = _readStatsSource<unknown>(id);
        readings.set(id, reading);
      }
      return reading as StatsReading<T>;
    },
  };
};

const isSameRows = (a: readonly OverviewRow[], b: readonly OverviewRow[]) =>
  a.length === b.length && a.every((row, i) => row === b[i]);

/**
 * The Overview's table and its rows, kept by metric id: a refresh writes the figures that changed
 * (`setCell`), and gives the table new rows (`setRows`, `setGroups`, kept by key) only when the
 * shown rows changed (the Settings tab's reorder or visibility, an app source registered).
 */
const createOverviewTable = () => {
  const table = createTable<OverviewRow>({
    caption: 'Overview',
    captionHidden: true,
    columns: OVERVIEW_COLUMNS,
    empty: 'No rows are shown. Pick them in the Settings tab.',
    striped: true,
    class: 'profilerOverview',
  });
  const rowsById = new Map<string, OverviewRow>();
  let shownRows: OverviewRow[] = [];
  let shownAppRows: OverviewRow[] = [];

  const getRow = (id: string) => {
    let row = rowsById.get(id);
    if (!row) {
      row = { id, label: '', value: '', detail: '', tone: null };
      rowsById.set(id, row);
    }
    return row;
  };

  /** Writes a row's figures: to the table's cells that changed when it shows the row (`isShown`),
   * else to the row only (the table reads it with the new rows) */
  const writeRow = (
    row: OverviewRow,
    label: string,
    metricValue: MetricValue,
    isShown: boolean
  ) => {
    const value = metricValue.na ? NA_VALUE : metricValue.value;
    const detail = getDetail(metricValue);
    const tone = metricValue.warn ? 'warning' : metricValue.na ? 'muted' : null;
    if (row.label !== label) {
      row.label = label;
      if (isShown) table.setCell(row.id, 'label', label);
    }
    // The tone is read from the row when its cell is written
    if (row.value !== value || row.tone !== tone) {
      row.value = value;
      row.tone = tone;
      if (isShown) table.setCell(row.id, 'value', value);
    }
    if (row.detail !== detail) {
      row.detail = detail;
      if (isShown) table.setCell(row.id, 'detail', detail);
    }
  };

  const update = ({ metrics, appSources }: VisibleRows) => {
    const rows = metrics.map((metric) => getRow(metric.id));
    const appRows = appSources.map((source) => getRow(APP_METRIC_PREFIX + source.id));
    const isNewList = !isSameRows(rows, shownRows) || !isSameRows(appRows, shownAppRows);
    const sample = createSample();
    for (let i = 0; i < metrics.length; i++) {
      writeRow(rows[i], metrics[i].label, metrics[i].read(sample), !isNewList);
    }
    for (let i = 0; i < appSources.length; i++) {
      const source = appSources[i];
      writeRow(appRows[i], source.label, readAppSource(source, sample), !isNewList);
    }
    if (!isNewList) return;
    shownRows = rows;
    shownAppRows = appRows;
    table.setRows(rows);
    table.setGroups(appRows.length ? [{ key: 'app', label: 'App', rows: appRows }] : NO_GROUPS);
  };

  return { cmp: table.cmp, update };
};

/**
 * The Overview tab: the key figures in one table, refreshed at the update rate while visible. It
 * holds the stats sources of its shown rows while it is mounted.
 * @param settings (object) the live profiler settings (rows, and the refresh rate read on every
 * mount)
 */
export const createProfilerOverviewTabDef = (settings: ProfilerSettings): AnyDebuggerTabDef => {
  const sources = createStatsSourceHolder();
  let overview: ReturnType<typeof createOverviewTable> | null = null;
  let isOpen = false;
  return {
    id: PROFILER_OVERVIEW_TAB_ID,
    title: 'Overview',
    icon: 'profiler',
    orderNr: 0,
    get refreshIntervalMs() {
      return 1000 / settings.updateRateHz;
    },
    // Nothing of a scene's: the rows, the focus and the scroll stay
    keepOnSceneChange: true,
    // A row shown, hidden or moved in Settings (or an app source registered) applies here. Only
    // once the tab is open: a build can fail before onOpen's cleanup exists, which would leak the
    // holds.
    onRefresh: () => {
      if (!isOpen) return;
      const visible = getVisibleRows(settings);
      sources.set(getVisibleSourceIds(visible));
      overview?.update(visible);
    },
    onOpen: () => {
      isOpen = true;
      sources.set(getVisibleSourceIds(getVisibleRows(settings)));
      return () => {
        isOpen = false;
        sources.releaseAll();
      };
    },
    content: () => {
      overview = createOverviewTable();
      overview.update(getVisibleRows(settings));
      return [overview.cmp];
    },
  };
};
