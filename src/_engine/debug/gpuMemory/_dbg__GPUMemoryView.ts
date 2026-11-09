// The GPU memory tab's live sections on the UI kit (p807 D8, D9), out of `_dbg__GPUMemory.ts`
// (the sampling, the peaks and the tab): the total against the budget with the categories and the
// peaks, the frame's counters, by owner with the untracked, and the sources. Built once per mount
// on the tab's scheduler: `update` reads three's figures into the rows the tables read and writes
// the texts in place, and the scheduler's refresh right after writes the tables.
import type { Renderer } from 'three/webgpu';
import { CMP } from '../../ui/core/CMP';
import { createBadge } from '../../ui/components/Badge';
import { createTable } from '../../ui/data/Table';
import type { TableColumn, TableGroup, TableTone } from '../../ui/data/TableTypes';
import { createStackedBar } from '../../ui/data/graphs/StackedBar';
import type { GraphPart } from '../../ui/data/graphs/GraphParts';
import type { BindingScheduler } from '../../ui/forms/binding/BindingScheduler';
import { formatBytes, formatNumber } from '../../kernel/assets/debug/_dbg__AssetStats';
import {
  createNameCell,
  createNote,
  createSection,
  createTextWriter,
  writeSub,
  type TwoLineRow,
} from '../profiler/_dbg__ProfilerParts';
import {
  assetOwnerItem,
  BOOT_OWNER,
  collectGPUAssets,
  groupByOwner,
  type OwnerSums,
} from './_dbg__GPUMemoryOwners';
import {
  collectGPUMemorySources,
  ENGINE_OWNER,
  type GPUMemorySourceRow,
} from './_dbg__GPUMemorySources';
import styles from './GPUMemory.module.scss';

const MB = 1024 * 1024;

/** `info.memory`'s categories with a size: their counts' and sizes' keys. */
export const MEMORY_CATEGORIES = [
  { label: 'Textures', count: 'textures', size: 'texturesSize' },
  { label: 'Attributes', count: 'attributes', size: 'attributesSize' },
  { label: 'Index attributes', count: 'indexAttributes', size: 'indexAttributesSize' },
  { label: 'Storage attributes', count: 'storageAttributes', size: 'storageAttributesSize' },
  {
    label: 'Indirect storage attr.',
    count: 'indirectStorageAttributes',
    size: 'indirectStorageAttributesSize',
  },
  { label: 'Uniform buffers', count: 'uniformBuffers', size: 'uniformBuffersSize' },
  { label: 'Programs (code)', count: 'programs', size: 'programsSize' },
  { label: 'Readback buffers', count: 'readbackBuffers', size: 'readbackBuffersSize' },
] as const;

/** The frame counters, in the order of the sampler's arrays. */
export const FRAME_METRICS = ['Draw calls', 'Triangles', 'Render calls', 'Compute calls'] as const;

type MemoryInfo = Renderer['info']['memory'];

/** A memory peak: its bytes and when it was reached (`Date.now()`, 0: never). */
export type GPUMemoryPeak = { bytes: number; at: number };

/** What the sections read from the tab's sampler (`_dbg__GPUMemory.ts`). */
export type GPUMemoryViewOpts = {
  getRenderer: () => Renderer | null | undefined;
  getCurrentSceneId: () => string | null | undefined;
  getBudgetMB: () => number;
  bootPeak: Readonly<GPUMemoryPeak>;
  scenePeak: Readonly<GPUMemoryPeak>;
  /** The last frame's counters, by `FRAME_METRICS` */
  frameLast: Float64Array;
  /** The last finished window's counters */
  frameWindow: Readonly<{
    min: Float64Array;
    max: Float64Array;
    avg: Float64Array;
    frames: number;
  }>;
  frameWindowMs: number;
  /** No sampled frame for a while: the main loop is paused */
  isPaused: () => boolean;
};

/** An owner as the tables name it (the boot's and the engine's in words). */
export const getOwnerLabel = (owner: string) =>
  owner === BOOT_OWNER
    ? 'boot (before the first scene)'
    : owner === ENGINE_OWNER
      ? 'engine (no scene)'
      : owner;

/** A local time ("14:03:27"), or a dash for never. */
export const formatTime = (at: number) => (at ? new Date(at).toLocaleTimeString() : '—');

const formatMetric = (value: unknown) => formatNumber(Math.round(value as number));
const formatSize = (value: unknown) =>
  typeof value === 'number' ? formatBytes(value) : value == null ? '' : String(value);

const getBackendLabel = (renderer: Renderer) =>
  (renderer.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend
    ? 'WebGPU'
    : 'WebGL2';

/**
 * A list of rows kept by key: `take` reuses a key's row (made by `create` the first time), `end`
 * forgets the rows not taken since `begin` and returns the taken ones in order.
 * @internal
 */
export const createRowPool = <R extends { id: string }>(create: (id: string) => R) => {
  const byKey = new Map<string, R>();
  let next: R[] = [];
  return {
    begin: () => {
      next = [];
    },
    take: (id: string) => {
      let row = byKey.get(id);
      if (!row) {
        row = create(id);
        byKey.set(id, row);
      }
      next.push(row);
      return row;
    },
    end: () => {
      if (byKey.size > next.length) {
        for (const key of byKey.keys()) if (!next.some((row) => row.id === key)) byKey.delete(key);
      }
      return next;
    },
  };
};

/** The tables' common parts: a hidden caption (a heading or the tab says it), a module class */
const tableProps = (caption: string, className: string) => ({
  caption,
  captionHidden: true,
  class: className,
});

const sizeColumn = <R>(
  key: string,
  label: string,
  value?: (row: R) => unknown
): TableColumn<R> => ({ key, label, align: 'end', format: formatSize, ...(value && { value }) });

// --- THE TOTAL, THE CATEGORIES, THE PEAKS ---

type CategoryRow = { id: string; label: string; size: number | string; count: number };

const createTotalsSection = (opts: GPUMemoryViewOpts, scheduler: BindingScheduler) => {
  const noRenderer = createNote();
  const body = CMP({ class: styles.gpuMemoryTotals });

  const head = body.add({ class: styles.gpuMemoryTotalRow });
  head.add({ tag: 'span', text: 'Total' });
  const writeTotal = createTextWriter(
    head.add({ tag: 'strong' }).elem.appendChild(document.createTextNode(''))
  );

  const inUse: GraphPart = { label: 'In use', value: 0 };
  const budgetParts = [inUse];
  const budgetBar = createStackedBar({
    label: 'GPU memory against the budget',
    parts: budgetParts,
    total: opts.getBudgetMB() * MB,
    format: (bytes) => formatBytes(bytes),
  });
  body.add(budgetBar.cmp);
  const budgetText = body.add({ tag: 'p', class: styles.gpuMemoryBudgetText });
  const writeBudgetText = createTextWriter(
    budgetText.elem.appendChild(document.createTextNode(''))
  );

  const categories: CategoryRow[] = MEMORY_CATEGORIES.map((c) => ({
    id: c.count,
    label: c.label,
    size: 0,
    count: 0,
  }));
  // Counted in the categories above: their size is a word, which the sort leaves in their group
  const elsewhere: CategoryRow[] = [
    { id: 'renderTargets', label: 'Render targets', size: 'in textures', count: 0 },
    { id: 'geometries', label: 'Geometries', size: 'in attributes', count: 0 },
  ];
  const elsewhereGroups: TableGroup<CategoryRow>[] = [
    { key: 'elsewhere', label: 'Counted elsewhere', rows: elsewhere },
  ];
  const categoriesTable = createTable<CategoryRow>({
    ...tableProps('GPU memory by category', 'gpuMemoryCategories'),
    columns: [
      { key: 'label', label: 'Category', rowHeader: true },
      {
        ...sizeColumn<CategoryRow>('size', 'Size'),
        sortable: true,
        tone: (row) => (typeof row.size === 'string' ? 'muted' : null),
      },
      { key: 'count', label: 'Count', align: 'end', format: formatMetric, sortable: true },
    ],
    rows: () => categories,
    groups: () => elsewhereGroups,
    sort: { key: 'size', direction: 'descending' },
    striped: true,
    scheduler,
  });
  body.add(categoriesTable.cmp);

  type PeakRow = { id: string; label: string; peak: Readonly<GPUMemoryPeak> };
  const peaks: PeakRow[] = [
    { id: 'boot', label: 'Since boot', peak: opts.bootPeak },
    { id: 'scene', label: 'Since scene enter', peak: opts.scenePeak },
  ];
  const peaksTable = createTable<PeakRow>({
    ...tableProps('GPU memory peaks', 'gpuMemoryPeaks'),
    columns: [
      { key: 'label', label: 'Peak', rowHeader: true },
      sizeColumn<PeakRow>('size', 'Size', (row) => row.peak.bytes),
      // A wall-clock time: the scene runner masks it (DEBUGGER_LIVE_MASKS)
      {
        key: 'at',
        label: 'Reached',
        align: 'end',
        value: (row) => row.peak.at,
        format: (at) => formatTime(at as number),
      },
    ],
    rows: () => peaks,
    scheduler,
  });
  body.add(peaksTable.cmp);
  const backendNote = createNote();
  body.add(backendNote.cmp);

  const section = CMP({ class: ['profilerSection', styles.gpuMemorySection] });
  section.add(noRenderer.cmp);
  section.add(body);

  const update = (memory: MemoryInfo | null, renderer: Renderer | null) => {
    noRenderer.write(renderer ? '' : 'No renderer yet.');
    if (body.elem.hidden !== !renderer) body.elem.toggleAttribute('hidden', !renderer);
    if (!memory || !renderer) return;
    const budgetMB = opts.getBudgetMB();
    const budgetBytes = budgetMB * MB;
    const ratio = budgetBytes > 0 ? memory.total / budgetBytes : 0;
    const isOver = ratio > 1;
    writeTotal(formatBytes(memory.total));
    inUse.value = memory.total;
    budgetBar.setParts(budgetParts, budgetBytes);
    writeBudgetText(
      `${(ratio * 100).toFixed(0)} % of the ${budgetMB} MB budget${isOver ? ' (over budget)' : ''}`
    );
    if (budgetText.elem.hasAttribute('data-over') !== isOver) {
      budgetText.elem.toggleAttribute('data-over', isOver);
    }
    for (let i = 0; i < MEMORY_CATEGORIES.length; i++) {
      categories[i].size = memory[MEMORY_CATEGORIES[i].size];
      categories[i].count = memory[MEMORY_CATEGORIES[i].count];
    }
    elsewhere[0].count = memory.renderTargets;
    elsewhere[1].count = memory.geometries;
    backendNote.write(
      `${getBackendLabel(renderer)} backend. three's own estimate of what it created, since boot, not a driver measurement. Compressed textures (KTX2) count their uploaded mip levels, in the format this device transcodes to (three r186 and r187 count them as 1 B).`
    );
  };
  return { cmp: section, update, tables: [categoriesTable, peaksTable] };
};

// --- THE FRAME ---

type FrameRow = { id: string; index: number };

const createFrameSection = (opts: GPUMemoryViewOpts, scheduler: BindingScheduler) => {
  const paused = createNote('gpuMemoryPaused');
  const rows: FrameRow[] = FRAME_METRICS.map((label, index) => ({ id: label, index }));
  const { frameLast, frameWindow } = opts;
  const figure = (key: string, label: string, values: Float64Array): TableColumn<FrameRow> => ({
    key,
    label,
    align: 'end',
    value: (row) => values[row.index],
    format: formatMetric,
  });
  const table = createTable<FrameRow>({
    ...tableProps('Frame counters', 'gpuMemoryFrame'),
    columns: [
      { key: 'id', label: 'Counter', rowHeader: true },
      figure('last', 'Last', frameLast),
      figure('min', 'Min', frameWindow.min),
      figure('avg', 'Avg', frameWindow.avg),
      figure('max', 'Max', frameWindow.max),
    ],
    rows: () => rows,
    striped: true,
    scheduler,
  });
  const note = createNote();
  const update = () => {
    paused.write(
      opts.isPaused() ? 'The main loop is paused: the figures are its last frames’.' : ''
    );
    note.write(
      `Min / avg / max over the last ${opts.frameWindowMs} ms (${frameWindow.frames} frames). Includes every render of the frame: shadow maps, PostFX passes, sky bakes and viewports. The axes gizmo (F10) and the environment ball (F9) are viewports and add their own draw calls; the drawer itself is DOM and adds none.`
    );
  };
  return {
    cmp: createSection('Frame', [paused.cmp, table.cmp, note.cmp], styles.gpuMemorySection),
    update,
    tables: [table],
  };
};

// --- BY OWNER, THE UNTRACKED ---

type OwnerRow = {
  id: string;
  label: string;
  /** 0: an owner, 1: one of its cells (indented) */
  level: 0 | 1;
  isCurrent: boolean;
  /** The "current" badge's element, once the row's cell is made */
  badge: HTMLElement | null;
  /** null: no figure (the untracked and total rows' textures and geometry) */
  textures: number | null;
  geometries: number | null;
  total: number;
  items: string;
  isUntracked: boolean;
};

const createOwnerRow = (id: string): OwnerRow => ({
  id,
  label: '',
  level: 0,
  isCurrent: false,
  badge: null,
  textures: 0,
  geometries: 0,
  total: 0,
  items: '',
  isUntracked: false,
});

/** An owner's name, indented by its level, and the current scene's badge (shown while it is). */
const createOwnerCell = (row: OwnerRow) => {
  const cell = CMP({
    tag: 'span',
    class: styles.gpuMemoryOwner,
    attr: { 'data-level': String(row.level) },
  });
  cell.add({ tag: 'span', text: row.label });
  if (row.level === 0 && !row.isUntracked && row.id !== 'total') {
    const badge = createBadge({ label: 'current' });
    // A space for the row header's name ("sceneA current"); a flex box draws none
    cell.elem.append(' ');
    cell.add(badge.cmp);
    row.badge = badge.cmp.elem;
    row.badge.toggleAttribute('hidden', !row.isCurrent);
  }
  return cell;
};

const writeCurrent = (row: OwnerRow, isCurrent: boolean) => {
  row.isCurrent = isCurrent;
  if (row.badge && row.badge.hidden === isCurrent) row.badge.toggleAttribute('hidden', !isCurrent);
};

const writeSums = (row: OwnerRow, sums: OwnerSums) => {
  row.textures = sums.textures;
  row.geometries = sums.geometries;
  row.total = sums.total;
  row.items = formatNumber(sums.count);
};

const untrackedTone = (row: OwnerRow): TableTone | null => (row.isUntracked ? 'muted' : null);

const OWNER_COLUMNS: TableColumn<OwnerRow>[] = [
  { key: 'label', label: 'Owner', rowHeader: true, cell: createOwnerCell, tone: untrackedTone },
  { ...sizeColumn<OwnerRow>('textures', 'Textures'), tone: untrackedTone },
  { ...sizeColumn<OwnerRow>('geometries', 'Geometry'), tone: untrackedTone },
  { ...sizeColumn<OwnerRow>('total', 'Total'), tone: untrackedTone },
  { key: 'items', label: 'Items', align: 'end', tone: untrackedTone },
];

type UntrackedRow = { id: string; bytes: number };

/** What the owners' and the sources' sections read, once per refresh */
type OwnersSample = {
  memory: MemoryInfo;
  assets: ReturnType<typeof collectGPUAssets>;
  sources: GPUMemorySourceRow[];
};

const createOwnersSection = (opts: GPUMemoryViewOpts, scheduler: BindingScheduler) => {
  const ownerRows = createRowPool(createOwnerRow);
  let shownOwners: OwnerRow[] = [];
  const total: OwnerRow = {
    ...createOwnerRow('total'),
    label: 'Total',
    textures: null,
    geometries: null,
  };
  const footer = [total];
  const none = createNote();
  const table = createTable<OwnerRow>({
    ...tableProps('GPU memory by owner', 'gpuMemoryOwners'),
    columns: OWNER_COLUMNS,
    rows: () => shownOwners,
    footer: () => footer,
    scheduler,
  });
  const cubeNote = createNote();

  const untrackedRows = createRowPool((id): UntrackedRow => ({ id, bytes: 0 }));
  let shownUntracked: UntrackedRow[] = [];
  const untrackedTable = createTable<UntrackedRow>({
    ...tableProps('Untracked GPU memory', 'gpuMemoryUntracked'),
    columns: [
      { key: 'id', label: 'Untracked', rowHeader: true },
      { ...sizeColumn<UntrackedRow>('bytes', 'Size'), sortable: true },
    ],
    rows: () => shownUntracked,
    sort: { key: 'bytes', direction: 'descending' },
    empty: 'Nothing untracked.',
    scheduler,
  });
  const note = createNote();

  const update = ({ memory, assets, sources }: OwnersSample) => {
    const groups = groupByOwner([
      ...assets.map(assetOwnerItem),
      ...sources.map((source) => {
        const textures = source.bySize.texturesSize ?? 0;
        return { owner: source.owner, textures, geometries: source.bytes - textures };
      }),
    ]);
    const currentSceneId = opts.getCurrentSceneId();
    let trackedTotal = 0;
    ownerRows.begin();
    for (const group of groups) {
      trackedTotal += group.total;
      const row = ownerRows.take(`owner:${group.owner}`);
      row.label = getOwnerLabel(group.owner);
      writeSums(row, group);
      writeCurrent(row, group.owner === currentSceneId);
      for (const cell of group.cells) {
        const cellRow = ownerRows.take(`owner:${cell.owner}`);
        cellRow.level = 1;
        cellRow.label = cell.owner.slice(group.owner.length + 1);
        writeSums(cellRow, cell);
      }
    }
    const untracked = ownerRows.take('untracked');
    untracked.label = 'Untracked';
    untracked.isUntracked = true;
    untracked.textures = untracked.geometries = null;
    untracked.total = memory.total - trackedTotal;
    untracked.items = `${((memory.total > 0 ? untracked.total / memory.total : 0) * 100).toFixed(0)} %`;
    shownOwners = ownerRows.end();
    total.total = memory.total;
    none.write(groups.length ? '' : 'No registered assets or sources on the GPU.');

    // What neither the registries nor the sources name: unregistered geometry, render targets
    // without a source, uniform buffers, shader code
    let assetTextures = 0;
    let assetGeometries = 0;
    let notOnGPU = 0;
    let uncounted = 0;
    for (const asset of assets) {
      if (asset.kind === 'texture') assetTextures += asset.bytes;
      else assetGeometries += asset.bytes;
      if (!asset.bytes) notOnGPU++;
      uncounted += asset.uncounted;
    }
    for (const source of sources) uncounted += source.uncounted;
    /** Bytes the sources count in an `info.memory` size category */
    const sourceBytes = (sizeKey: string) =>
      sources.reduce((sum, source) => sum + (source.bySize[sizeKey] ?? 0), 0);
    untrackedRows.begin();
    const addUntracked = (label: string, bytes: number) => {
      if (bytes > 0) untrackedRows.take(label).bytes = bytes;
    };
    addUntracked('Textures', memory.texturesSize - assetTextures - sourceBytes('texturesSize'));
    addUntracked(
      'Attributes + index',
      memory.attributesSize +
        memory.indexAttributesSize -
        assetGeometries -
        sourceBytes('attributesSize') -
        sourceBytes('indexAttributesSize')
    );
    for (const c of MEMORY_CATEGORIES) {
      if (c.size === 'texturesSize' || c.size === 'attributesSize') continue;
      if (c.size === 'indexAttributesSize') continue;
      addUntracked(c.label, memory[c.size] - sourceBytes(c.size));
    }
    shownUntracked = untrackedRows.end();

    cubeNote.write(
      uncounted
        ? `Cube textures: about +${formatBytes(uncounted)} more on the GPU, in none of the figures here. three (r186, r187) counts a cube's faces as 1×1 each; the estimate uses its formula at the real face size.`
        : ''
    );
    note.write(
      `Registered textures and geometries, the textures a material holds alone (eg. clones) and the sources below, summed per owner with three's own byte counts. Geometry includes every buffer (attributes, index, storage). ${notOnGPU ? `${formatNumber(notOnGPU)} registered asset${notOnGPU === 1 ? ' is' : 's are'} not on the GPU (never drawn, or not uploaded yet). ` : ''}Untracked is everything else: unregistered geometry, uniform buffers, shader code, small instance counts (three keeps those in uniform buffers) and render targets no source names. A large or growing figure is a finding.`
    );
  };
  return {
    cmp: createSection(
      'By owner',
      [none.cmp, table.cmp, cubeNote.cmp, untrackedTable.cmp, note.cmp],
      styles.gpuMemorySection
    ),
    update,
    tables: [table, untrackedTable],
  };
};

// --- THE SOURCES ---

type SourceRow = TwoLineRow & { id: string; bytes: number; count: number | null };

const createSourcesSection = (scheduler: BindingScheduler) => {
  const sourceRows = createRowPool(
    (id): SourceRow => ({ id, label: '', sub: '', subNode: null, bytes: 0, count: 0 })
  );
  let shown: SourceRow[] = [];
  const total: SourceRow = {
    id: 'total',
    label: 'Total',
    sub: '',
    subNode: null,
    bytes: 0,
    count: null,
  };
  const footer = [total];
  const noFooter: SourceRow[] = [];
  // A registered source holding nothing on the GPU: muted
  const emptyTone = (row: SourceRow): TableTone | null =>
    row.id !== 'total' && !row.bytes ? 'muted' : null;
  const table = createTable<SourceRow>({
    ...tableProps('GPU memory sources', 'gpuMemorySources'),
    columns: [
      {
        key: 'label',
        label: 'Source (owner · id)',
        rowHeader: true,
        cell: createNameCell,
        tone: emptyTone,
      },
      { ...sizeColumn<SourceRow>('bytes', 'Size'), sortable: true, tone: emptyTone },
      {
        key: 'count',
        label: 'GPU objects',
        align: 'end',
        format: (count) => (count === null ? '' : formatMetric(count)),
        sortable: true,
        tone: emptyTone,
      },
    ],
    rows: () => shown,
    footer: () => (shown.length ? footer : noFooter),
    empty: 'No sources registered.',
    sortUnset: true,
    scheduler,
  });
  const note = createNote();
  note.write(
    'GPU resources that aren\'t registered assets, named with registerGPUMemorySource (debug/GPUMemory.ts) and counted in "By owner" under their owner. A render target counts its textures and depth buffer, an attribute every buffer three made from its array. A GPU object an asset or an earlier source already counts is not counted again (the InstancedMesh catch-all counts last).'
  );
  const update = (sources: GPUMemorySourceRow[]) => {
    sourceRows.begin();
    total.bytes = 0;
    for (const source of sources) {
      const row = sourceRows.take(source.id);
      row.label = source.label;
      row.bytes = source.bytes;
      row.count = source.count;
      total.bytes += source.bytes;
      writeSub(
        row,
        `${getOwnerLabel(source.owner)} · ${source.id}${source.uncounted ? ` · about +${formatBytes(source.uncounted)} not counted (cube)` : ''}`
      );
    }
    shown = sourceRows.end();
  };
  return {
    cmp: createSection('Sources', [table.cmp, note.cmp], styles.gpuMemorySection),
    update,
    tables: [table],
  };
};

// --- THE VIEW ---

/**
 * The tab's live sections, built once per mount; `update` reads three's figures (once) into what
 * their parts read and writes their texts (the tab's scheduler writes the tables after it).
 * @internal
 */
export const createGPUMemoryView = (opts: GPUMemoryViewOpts, scheduler: BindingScheduler) => {
  const totals = createTotalsSection(opts, scheduler);
  const frame = createFrameSection(opts, scheduler);
  const owners = createOwnersSection(opts, scheduler);
  const sources = createSourcesSection(scheduler);
  // Returns the assets it read (the snapshot's diff reads them too), null without a renderer
  const update = () => {
    const renderer = opts.getRenderer() ?? null;
    const memory = renderer ? renderer.info.memory : null;
    totals.update(memory, renderer);
    frame.update();
    if (!renderer || !memory) return null;
    // Assets first: a GPU object an asset holds is never counted again by a source
    const counted = new Set<object>();
    const assets = collectGPUAssets(renderer, counted);
    const sourceList = collectGPUMemorySources(renderer, counted);
    owners.update({ memory, assets, sources: sourceList });
    sources.update(sourceList);
    return assets;
  };
  update();
  // The tab host's first refresh comes an interval after the mount: the tables read the first
  // figures now, not the empty rows they were made with
  for (const section of [totals, frame, owners, sources]) {
    for (const table of section.tables) table.refresh();
  }
  return { update, cmps: [totals.cmp, frame.cmp, owners.cmp, sources.cmp] };
};
