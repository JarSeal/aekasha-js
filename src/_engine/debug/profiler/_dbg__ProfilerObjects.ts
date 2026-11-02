import { CMP } from '../../ui/core/CMP';
import type { CMPHandle } from '../../ui/core/CMPTypes';
import { getSvgIcon } from '../../ui/core/icons/SvgIcon';
import { createButton } from '../../ui/components/Button';
import { createList } from '../../ui/data/List';
import { createTable } from '../../ui/data/Table';
import type { TableColumn } from '../../ui/data/TableTypes';
import { createSparkline, type Sparkline } from '../../ui/data/graphs/Sparkline';
import type { BindingScheduler } from '../../ui/forms/binding/BindingScheduler';
import { createSegmentedControl } from '../../ui/forms/RadioGroup';
import { IS_DEBUG_ENV } from '../../kernel/config/Config';
import { getAllECSWorlds } from '../../kernel/ecs/ECS';
import type { AnyDebuggerTabDef } from '../DebuggerGUI';
import {
  _getEntityWindowOpener,
  PROFILER_BAR_MEASURES,
  type ProfilerBarMeasure,
  type ProfilerSettings,
} from '../Profiler';
import { formatNumber } from '../../kernel/assets/debug/_dbg__AssetStats';
import {
  CENSUS_KINDS,
  type CensusBucket,
  type CensusHeavyObject,
  type CensusKind,
  type InViewTotal,
  type SceneCensus,
} from './_dbg__Census';
import {
  createEmpty,
  createNameCell,
  createNote,
  createSection,
  createTextWriter,
  formatCompact,
  formatInViewTotal,
  writeSub,
  type TwoLineRow,
} from './_dbg__ProfilerObjectsParts';
import { PROFILER_SOURCE, type DrawStats } from './_dbg__ProfilerSources';
import { _readStatsSource, createStatsSourceHolder } from './_dbg__StatsSources';

/**
 * The Objects tab (§2.8): the in-view census broken down by kind and by owner (two-tone bars:
 * in view solid, culled faded, the length the share of the scene total), the ECS worlds and
 * component counts, the heaviest objects in view, and a short history of the in-view figures.
 * Refreshed at the update rate while visible; it holds the census and the draw counters while
 * it is mounted. Its sections are the UI kit's (p807 D7), built once per mount on the tab's
 * scheduler: a refresh updates the rows they read (kept by key) and the scheduler's refresh
 * writes what changed.
 */

export const PROFILER_OBJECTS_TAB_ID = 'profilerObjects';

const HELD_SOURCES = [PROFILER_SOURCE.CENSUS, PROFILER_SOURCE.DRAW];

const KIND_LABELS: Record<CensusKind, string> = {
  MESH: 'Mesh',
  INSTANCED_MESH: 'InstancedMesh',
  BATCHED_MESH: 'BatchedMesh',
  SKINNED_MESH: 'SkinnedMesh',
  LINES: 'Lines',
  POINTS: 'Points',
  SPRITES: 'Sprites',
  LIGHTS: 'Lights',
  CAMERAS: 'Cameras',
  DEBUG_HELPERS: 'Debug helpers',
};

/** The primitives of the kinds that aren't triangles (shown under the kind). */
const PRIMITIVE_UNITS: Partial<Record<CensusKind, string>> = {
  LINES: 'segments',
  POINTS: 'points',
  SPRITES: 'quads',
  DEBUG_HELPERS: 'primitives',
};

const MEASURE_LABELS: Record<ProfilerBarMeasure, string> = {
  TRIANGLES: 'Triangles',
  VERTICES: 'Vertices',
  OBJECTS: 'Objects',
};

const getMeasure = (bucket: CensusBucket, measure: ProfilerBarMeasure): InViewTotal =>
  measure === 'TRIANGLES'
    ? bucket.triangles
    : measure === 'VERTICES'
      ? bucket.vertices
      : bucket.objects;

// SAMPLE (read once per refresh, in onRefresh)

let census: Readonly<SceneCensus> | null = null;
let censusNa = '';
let draw: Readonly<DrawStats> | null = null;

// HISTORY (the "Over time" sparklines, one sample per census walk)

const HISTORY_LENGTH = 60;

type HistorySeries = {
  label: string;
  values: Float64Array;
  /** The figure of the latest sample (NaN = none). */
  read: () => number;
};

const history: HistorySeries[] = [
  {
    label: 'Triangles in view',
    values: new Float64Array(HISTORY_LENGTH),
    read: () => (census ? census.meshes.triangles.inView : NaN),
  },
  {
    label: 'Meshes in view',
    values: new Float64Array(HISTORY_LENGTH),
    read: () => (census ? census.meshes.objects.inView : NaN),
  },
  {
    label: 'Draw calls',
    values: new Float64Array(HISTORY_LENGTH),
    read: () => (draw ? draw.drawCalls.avg : NaN),
  },
];
let historyHead = 0;
let historyCount = 0;
let lastHistorySampleAt = -Infinity;
/** Counts the samples pushed and the resets, so a mounted tab's sparklines know what to draw. */
let historyPushes = 0;
let historyResets = 0;
/** The editor view the kept samples were counted in (null: the root scene), so a view switch
 * starts a new history instead of mixing two scenes. */
let historyViewId: string | null = null;

const pushHistory = () => {
  for (let i = 0; i < history.length; i++) history[i].values[historyHead] = history[i].read();
  historyHead = (historyHead + 1) % HISTORY_LENGTH;
  if (historyCount < HISTORY_LENGTH) historyCount++;
  historyPushes++;
};

const resetHistory = () => {
  historyHead = 0;
  historyCount = 0;
  lastHistorySampleAt = -Infinity;
  historyResets++;
};

/** The i-th kept sample, oldest first. */
const getHistoryValue = (series: HistorySeries, i: number) =>
  series.values[(historyHead - historyCount + i + HISTORY_LENGTH) % HISTORY_LENGTH];

/** A series' kept samples, oldest first (a sparkline's values at a mount or a reset). */
const getHistoryValues = (series: HistorySeries) => {
  const values: number[] = [];
  for (let i = 0; i < historyCount; i++) values.push(getHistoryValue(series, i));
  return values;
};

const readSample = () => {
  const censusReading = _readStatsSource<SceneCensus>(PROFILER_SOURCE.CENSUS);
  census = censusReading.value;
  censusNa = censusReading.na || '';
  draw = _readStatsSource<DrawStats>(PROFILER_SOURCE.DRAW).value;
  const viewId = census?.view?.id ?? null;
  if (census && viewId !== historyViewId) {
    resetHistory();
    historyViewId = viewId;
  }
  // A refresh between two walks (eg. a bar measure change) reads the cached census
  if (census && census.sampledAt !== lastHistorySampleAt) {
    lastHistorySampleAt = census.sampledAt;
    pushHistory();
  }
};

/** What an empty census table says: why there's no census (or that it's coming), else `text`. */
const getEmptyText = (text: string) => {
  if (census) return text;
  return censusNa ? `n/a (${censusNa})` : 'measuring…';
};

// BREAKDOWNS (by kind, by owner)

type BreakdownRow = TwoLineRow & { id: string; bucket: CensusBucket };

/** A breakdown's rows, kept by key, and its total (the footer) */
const createBreakdownModel = () => {
  const rowsByKey = new Map<string, BreakdownRow>();
  const total: BreakdownRow = {
    id: 'total',
    label: 'Total',
    sub: '',
    subNode: null,
    bucket: {
      objects: { inView: 0, total: 0 },
      instances: { inView: 0, total: 0 },
      primitives: { inView: 0, total: 0 },
      triangles: { inView: 0, total: 0 },
      vertices: { inView: 0, total: 0 },
    },
  };
  let rows: BreakdownRow[] = [];
  let next: BreakdownRow[] = [];
  const NO_FOOTER: BreakdownRow[] = [];
  const FOOTER = [total];
  const sumInto = (target: InViewTotal, source: InViewTotal) => {
    target.inView += source.inView;
    target.total += source.total;
  };
  return {
    getRows: () => rows,
    getFooter: () => (rows.length ? FOOTER : NO_FOOTER),
    /** Starts the rows of a sample */
    begin: () => {
      next = [];
    },
    add: (key: string, label: string, sub: string, bucket: CensusBucket) => {
      let row = rowsByKey.get(key);
      if (!row) {
        row = { id: key, label, sub, subNode: null, bucket };
        rowsByKey.set(key, row);
      }
      row.bucket = bucket;
      writeSub(row, sub);
      next.push(row);
    },
    /** Ends the sample: the rows read, the total summed, the rows that went forgotten */
    end: () => {
      rows = next;
      const t = total.bucket;
      t.objects.inView = t.objects.total = 0;
      t.triangles.inView = t.triangles.total = 0;
      t.vertices.inView = t.vertices.total = 0;
      for (let i = 0; i < rows.length; i++) {
        sumInto(t.objects, rows[i].bucket.objects);
        sumInto(t.triangles, rows[i].bucket.triangles);
        sumInto(t.vertices, rows[i].bucket.vertices);
      }
      if (rowsByKey.size > rows.length) {
        for (const key of rowsByKey.keys()) {
          if (!rows.some((row) => row.id === key)) rowsByKey.delete(key);
        }
      }
    },
  };
};

type BreakdownModel = ReturnType<typeof createBreakdownModel>;

/** An "in view / total" figure column; `—`, muted, for a measure the rows don't have */
const figureColumn = (
  key: 'objects' | 'triangles' | 'vertices',
  label: string
): TableColumn<BreakdownRow> => ({
  key,
  label,
  align: 'end',
  value: (row) => row.bucket[key].total,
  format: (_, row) => (row.bucket[key].total ? formatInViewTotal(row.bucket[key]) : '—'),
  tone: (row) => (row.bucket[key].total ? null : 'muted'),
});

const createBreakdownTable = (opts: {
  caption: string;
  rowsName: string;
  model: BreakdownModel;
  settings: Readonly<ProfilerSettings>;
  empty: CMPHandle;
  scheduler: BindingScheduler;
}) => {
  const { settings, model } = opts;
  const getPart = (row: BreakdownRow) => getMeasure(row.bucket, settings.objectsBarMeasure);
  return createTable<BreakdownRow>({
    caption: opts.caption,
    captionHidden: true,
    columns: [
      {
        key: 'name',
        label: opts.rowsName,
        rowHeader: true,
        value: (row) => row.label,
        cell: createNameCell,
      },
      figureColumn('objects', 'Objects'),
      figureColumn('triangles', 'Triangles'),
      figureColumn('vertices', 'Vertices'),
      {
        key: 'bar',
        label: 'In view / culled',
        headerTooltip:
          'The measure the Bars switch picks: in view, then culled or hidden; the share of the scene',
        kind: 'bar',
        minWidth: 96,
        value: (row) => {
          const { inView, total } = getPart(row);
          return [inView, total - inView];
        },
        // Each bar's length is its share of the total (the footer's), said as text
        format: (_, row) => {
          const of = getMeasure(
            model.getFooter()[0]?.bucket ?? row.bucket,
            settings.objectsBarMeasure
          ).total;
          return of ? `${((getPart(row).total / of) * 100).toFixed(1)} %` : '';
        },
      },
    ],
    rows: model.getRows,
    footer: model.getFooter,
    empty: opts.empty,
    striped: true,
    class: 'profilerBreakdown',
    scheduler: opts.scheduler,
  });
};

const getKindSub = (kind: CensusKind, bucket: CensusBucket) => {
  const parts: string[] = [];
  const unit = PRIMITIVE_UNITS[kind];
  if (unit && bucket.primitives.total) {
    parts.push(`${formatInViewTotal(bucket.primitives)} ${unit}`);
  }
  if ((kind === 'INSTANCED_MESH' || kind === 'BATCHED_MESH') && bucket.instances.total) {
    parts.push(`${formatInViewTotal(bucket.instances)} instances`);
  }
  if (kind === 'LIGHTS' || kind === 'CAMERAS') parts.push('in view = shown');
  return parts.join(' · ');
};

// ECS

type WorldRow = { id: string; name: string; entities: number };
type ComponentRow = { id: string; entities: number };

// HEAVIEST OBJECTS

type HeavyRow = TwoLineRow & {
  id: string;
  rank: number;
  kind: CensusKind;
  triangles: number;
  instances: number;
  worldId: string;
  entityId: number;
};

const findWorld = (worldId: string) => getAllECSWorlds().find((w) => w.id === worldId) || null;

/** The Edit button of a heaviest row whose entity has a window, else nothing. */
const createEditCell = (row: HeavyRow) => {
  const world = IS_DEBUG_ENV && row.entityId !== -1 ? findWorld(row.worldId) : null;
  const opener = world ? _getEntityWindowOpener(world, row.entityId) : null;
  if (!opener) return CMP({ tag: 'span' });
  return createButton({
    label: `${opener.label}: ${row.label}`,
    icon: getSvgIcon('tools'),
    iconOnly: true,
    variant: 'ghost',
    size: 'sm',
    onClick: () => {
      const target = findWorld(row.worldId);
      if (target) _getEntityWindowOpener(target, row.entityId)?.toggle(target, row.entityId);
    },
  }).cmp;
};

/** A heaviest entry's key: its entity and object, numbered when two share one (the row, its cells
 * and its button stay with the object as the ranks change) */
const getHeavyKey = (entry: CensusHeavyObject, seen: Map<string, number>) => {
  const base = `${entry.worldId}:${entry.entityId}:${entry.kind}:${entry.name}`;
  const n = seen.get(base) ?? 0;
  seen.set(base, n + 1);
  return n ? `${base}#${n}` : base;
};

const HEAVY_COLUMNS: TableColumn<HeavyRow>[] = [
  { key: 'rank', label: '#', align: 'end' },
  {
    key: 'name',
    label: 'Object',
    rowHeader: true,
    value: (row) => row.label,
    cell: createNameCell,
  },
  { key: 'kind', label: 'Kind', format: (kind) => KIND_LABELS[kind as CensusKind] },
  { key: 'triangles', label: 'Triangles', format: (n) => formatCompact(n as number) },
  {
    key: 'instances',
    label: 'Instances',
    align: 'end',
    format: (n) => ((n as number) > 1 ? `× ${formatCompact(n as number)}` : ''),
  },
  { key: 'edit', label: 'Edit', cell: createEditCell },
];

// THE SECTIONS

/** The head: the bars' measure (a segmented control on the setting) and what the census counted */
const createHeadSection = (
  { settings, setSettings }: ObjectsTabOpts,
  scheduler: BindingScheduler
) => {
  const measures = createSegmentedControl<ProfilerBarMeasure>({
    label: 'Bars',
    hint: 'What the bars measure',
    get: () => settings.objectsBarMeasure,
    set: (measure) => setSettings({ objectsBarMeasure: measure }),
    options: PROFILER_BAR_MEASURES.map((measure) => ({
      value: measure,
      label: MEASURE_LABELS[measure],
    })),
    scheduler,
  });
  const notes = createNote('profilerObjectsNote');
  const cmp = CMP({ class: 'profilerObjectsHead' });
  cmp.add(measures.cmp);
  cmp.add(notes.cmp);
  const update = () => {
    if (!census) {
      notes.write(getEmptyText(''));
      return;
    }
    const parts: string[] = [];
    if (census.view) parts.push(`Counted in ${census.view.title}'s view`);
    else
      parts.push(census.isDebugCamera ? "Counted in the debug camera's view" : 'Counted in view');
    if (census.isApprox) parts.push('BatchedMesh approx. (counted whole)');
    parts.push(
      census.excludesDebugHelpers
        ? 'debug helpers in their own row'
        : 'debug helpers counted in their kinds'
    );
    parts.push(`census ${census.sampleMs.toFixed(2)} ms`);
    notes.write(parts.join(' · '));
  };
  return { cmp, update };
};

/** A breakdown's section (by kind or by owner): its table on its model */
const createBreakdownSection = (opts: {
  heading: string;
  rowsName: string;
  settings: Readonly<ProfilerSettings>;
  scheduler: BindingScheduler;
  /** Adds the census' rows to the model */
  addRows: (model: BreakdownModel, census: Readonly<SceneCensus>) => void;
}) => {
  const model = createBreakdownModel();
  const empty = createEmpty();
  const table = createBreakdownTable({
    caption: `Objects ${opts.heading.toLowerCase()}`,
    rowsName: opts.rowsName,
    model,
    settings: opts.settings,
    empty: empty.cmp,
    scheduler: opts.scheduler,
  });
  const update = () => {
    model.begin();
    if (census) opts.addRows(model, census);
    model.end();
    empty.write(getEmptyText('The scene is empty.'));
  };
  return { cmp: createSection(opts.heading, [table.cmp]), update };
};

const addKindRows = (model: BreakdownModel, c: Readonly<SceneCensus>) => {
  for (let i = 0; i < CENSUS_KINDS.length; i++) {
    const kind = CENSUS_KINDS[i];
    const bucket = c.kinds[kind];
    if (bucket.objects.total) model.add(kind, KIND_LABELS[kind], getKindSub(kind, bucket), bucket);
  }
};

const addOwnerRows = (model: BreakdownModel, c: Readonly<SceneCensus>) => {
  for (let i = 0; i < c.owners.length; i++) {
    const owner = c.owners[i];
    model.add(owner.key, owner.label, '', owner.bucket);
  }
};

/** ECS: the worlds' entity counts and the component types by entity count (by type value, eg.
 * 'CORE_MANAGED_BY', 'APP_SPIN': app and toolkit types have no engine-side name) */
const createEcsSection = (scheduler: BindingScheduler) => {
  const worldRows = new Map<string, WorldRow>();
  let shownWorlds: WorldRow[] = [];
  const componentRows = new Map<string, ComponentRow>();
  let shownComponents: ComponentRow[] = [];
  const viewNote = createNote();
  const worldsTable = createTable<WorldRow>({
    caption: 'ECS worlds',
    captionHidden: true,
    columns: [
      { key: 'name', label: 'World', rowHeader: true },
      { key: 'entities', label: 'Entities', format: (n) => formatNumber(n as number) },
    ],
    rows: () => shownWorlds,
    scheduler,
  });
  const typesHeading = CMP({ tag: 'h5' });
  const writeTypesHeading = createTextWriter(
    typesHeading.elem.appendChild(document.createTextNode(''))
  );
  const typesList = createList<ComponentRow>({
    label: 'Component types by entity count',
    items: () => shownComponents,
    title: (row) => row.id,
    suffix: (row) => formatNumber(row.entities),
    // The names are cut to the column: the whole one on hover
    tooltip: (row) => row.id,
    empty: 'No components.',
    class: 'profilerComponentList',
    scheduler,
  });

  const update = () => {
    const worlds = getAllECSWorlds();
    const counts = new Map<string, number>();
    const nextWorlds: WorldRow[] = [];
    for (let w = 0; w < worlds.length; w++) {
      const world = worlds[w];
      let row = worldRows.get(world.id);
      if (!row) {
        row = { id: world.id, name: '', entities: 0 };
        worldRows.set(world.id, row);
      }
      row.name = world.name === world.id ? world.id : `${world.name} (${world.id})`;
      row.entities = world.getEntityCount();
      nextWorlds.push(row);
      const types = world.getComponentTypes();
      for (let i = 0; i < types.length; i++) {
        const size = world.getStorage(types[i]).size;
        if (size) counts.set(types[i], (counts.get(types[i]) || 0) + size);
      }
    }
    shownWorlds = nextWorlds;
    const nextComponents: ComponentRow[] = [];
    for (const [type, entities] of counts) {
      let row = componentRows.get(type);
      if (!row) {
        row = { id: type, entities };
        componentRows.set(type, row);
      }
      row.entities = entities;
      nextComponents.push(row);
    }
    nextComponents.sort((a, b) => b.entities - a.entities || a.id.localeCompare(b.id));
    shownComponents = nextComponents;
    writeTypesHeading(`Component types by entity count${worlds.length > 1 ? ' (all worlds)' : ''}`);
    // The census counts the editor view, which has no entities of its own
    viewNote.write(
      census?.view ? `The suspended scene's worlds (${census.view.title} has no entities).` : ''
    );
  };
  return {
    cmp: createSection('ECS', [viewNote.cmp, worldsTable.cmp, typesHeading, typesList.cmp]),
    update,
  };
};

/** The heaviest objects in view: a row per object, kept by its key as the ranks change */
const createHeaviestSection = (scheduler: BindingScheduler) => {
  const rowsByKey = new Map<string, HeavyRow>();
  let shown: HeavyRow[] = [];
  const empty = createEmpty();
  const table = createTable<HeavyRow>({
    caption: 'Heaviest objects in view',
    captionHidden: true,
    columns: HEAVY_COLUMNS,
    rows: () => shown,
    empty: empty.cmp,
    striped: true,
    class: 'profilerHeaviest',
    scheduler,
  });
  const update = () => {
    const next: HeavyRow[] = [];
    if (census) {
      const seen = new Map<string, number>();
      for (let i = 0; i < census.heaviest.length; i++) {
        const entry = census.heaviest[i];
        const key = getHeavyKey(entry, seen);
        let row = rowsByKey.get(key);
        if (!row) {
          row = {
            id: key,
            label: entry.name,
            sub: entry.entityName,
            subNode: null,
            rank: 0,
            kind: entry.kind,
            triangles: 0,
            instances: 0,
            worldId: entry.worldId,
            entityId: entry.entityId,
          };
          rowsByKey.set(key, row);
        }
        writeSub(row, entry.entityName);
        row.rank = i + 1;
        row.triangles = entry.triangles;
        row.instances = entry.instances;
        next.push(row);
      }
    }
    shown = next;
    for (const key of rowsByKey.keys()) {
      if (!shown.some((row) => row.id === key)) rowsByKey.delete(key);
    }
    empty.write(getEmptyText('No meshes in view.'));
  };
  return { cmp: createSection('Heaviest objects in view', [table.cmp]), update };
};

/** Over time: a sparkline per series with its latest figure and its max beside it */
const createOverTimeSection = (settings: Readonly<ProfilerSettings>) => {
  const note = createNote();
  const seconds = Math.round(HISTORY_LENGTH / settings.updateRateHz);
  note.write(
    `The last ${HISTORY_LENGTH} samples (${seconds} s at ${settings.updateRateHz} Hz) while ` +
      'this tab is open. Draw calls per frame, 1 s average.'
  );
  let seenPushes = historyPushes;
  let seenResets = historyResets;
  const lines = history.map((s) => {
    const line = CMP({ class: 'profilerSpark' });
    const head = line.add({ class: 'profilerSpark__head' });
    head.add({ tag: 'span', text: s.label });
    const latest = head.add({ tag: 'b', class: 'profilerSpark__latest' });
    const max = head.add({ tag: 'span', class: 'profilerSpark__max' });
    const sparkline: Sparkline = createSparkline({
      values: getHistoryValues(s),
      capacity: HISTORY_LENGTH,
      min: 0,
      area: true,
      class: 'profilerSparkline',
    });
    line.add(sparkline.cmp);
    return {
      cmp: line,
      sparkline,
      writeLatest: createTextWriter(latest.elem.appendChild(document.createTextNode(''))),
      writeMax: createTextWriter(max.elem.appendChild(document.createTextNode(''))),
    };
  });

  /** The new sample pushed, or the history drawn again after a reset or missed samples */
  const update = () => {
    const isReset = seenResets !== historyResets;
    const isOnePush = !isReset && historyPushes === seenPushes + 1;
    for (let s = 0; s < history.length; s++) {
      const { sparkline, writeLatest, writeMax } = lines[s];
      if (isOnePush) sparkline.push(getHistoryValue(history[s], historyCount - 1));
      else if (isReset || historyPushes !== seenPushes) {
        sparkline.setValues(getHistoryValues(history[s]));
      }
      let max = 0;
      let latest = NaN;
      for (let i = 0; i < historyCount; i++) {
        const value = getHistoryValue(history[s], i);
        if (Number.isNaN(value)) continue;
        if (value > max) max = value;
        latest = value;
      }
      writeLatest(Number.isNaN(latest) ? '—' : formatCompact(latest));
      writeMax(`max ${formatCompact(max)}`);
    }
    seenPushes = historyPushes;
    seenResets = historyResets;
  };
  return { cmp: createSection('Over time', [note.cmp, ...lines.map((l) => l.cmp)]), update };
};

/** The tab's sections, built once per mount; `update` reads the sample into what their parts read
 * and writes their texts (the tab's scheduler writes the kit's parts after it) */
const createObjectsView = (opts: ObjectsTabOpts, scheduler: BindingScheduler) => {
  const { settings } = opts;
  const sections = [
    createHeadSection(opts, scheduler),
    createBreakdownSection({
      heading: 'By kind',
      rowsName: 'Kind',
      settings,
      scheduler,
      addRows: addKindRows,
    }),
    createBreakdownSection({
      heading: 'By owner',
      rowsName: 'Owner',
      settings,
      scheduler,
      addRows: addOwnerRows,
    }),
    createEcsSection(scheduler),
    createHeaviestSection(scheduler),
    createOverTimeSection(settings),
  ];
  const update = () => {
    for (let i = 0; i < sections.length; i++) sections[i].update();
  };
  update();
  return { update, cmps: sections.map((section) => section.cmp) };
};

// TAB

type ObjectsTabOpts = {
  /** The live profiler settings (update rate, bar measure). */
  settings: Readonly<ProfilerSettings>;
  /** Changes settings: persists and applies them. */
  setSettings: (partial: Partial<ProfilerSettings>) => void;
};

/**
 * The Objects tab: the census breakdowns, ECS counts, heaviest objects and a short history.
 * @param opts ({@link ObjectsTabOpts})
 */
export const createProfilerObjectsTabDef = (opts: ObjectsTabOpts): AnyDebuggerTabDef => {
  const { settings } = opts;
  const sources = createStatsSourceHolder();
  let view: ReturnType<typeof createObjectsView> | null = null;
  const onClose = () => {
    sources.releaseAll();
    resetHistory();
    census = null;
    draw = null;
  };
  return {
    id: PROFILER_OBJECTS_TAB_ID,
    title: 'Objects',
    icon: 'objectsCubes',
    orderNr: 10,
    get refreshIntervalMs() {
      return 1000 / settings.updateRateHz;
    },
    // Kept (the focus and the scroll stay); the history is the last scene's, so it starts again
    keepOnSceneChange: true,
    onSceneChange: resetHistory,
    // One census read for every section; the tab's scheduler then writes the kit's parts
    onRefresh: () => {
      readSample();
      view?.update();
    },
    // The holds are taken here, not in onRefresh, which also runs for a build that can fail
    // before this cleanup exists
    onOpen: () => {
      sources.set(HELD_SOURCES);
      return onClose;
    },
    content: ({ scheduler }) => {
      view = createObjectsView(opts, scheduler);
      return view.cmps;
    },
  };
};
