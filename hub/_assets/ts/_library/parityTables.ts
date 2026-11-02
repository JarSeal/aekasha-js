/**
 * The dev page's "Debugger parity" box's tables (p805 D14): one `createTable` per table of p805
 * §4.1's census that p807 still ports (GPU memory's; p806 ported the assets info window's, p807's
 * Phase 3 the profiler's Overview and Objects), each with the census row's source line and what
 * its port takes that isn't a rename. Out of `parity.ts` for its size.
 */
import { CMP, createBadge, createTable } from 'aekasha/ui';
import type { BindingScheduler, CMPHandle, TableColumn } from 'aekasha/ui';
import { addGroup } from './page';

/** What the box's live run gives a section */
export type ParityLive = {
  /** The box's scheduler: the tables given `rows` as a function read them on its tick */
  scheduler: BindingScheduler;
  /** The live run's step (0 until it runs), which the figures follow */
  getStep: () => number;
  /** Runs `step` on each step of the live run (4 a second) */
  onStep: (step: () => void) => void;
};

/** A row of a section: its census source line and its note as the label, then the piece (if
 * given; else the caller fills the row it returns) */
export const addParityRow = (
  parent: HTMLElement,
  { source, note, cmp, layout }: { source: string; note: string; cmp?: CMPHandle; layout: string[] }
) => {
  const group = addGroup(parent, '');
  group.classList.add(...layout);
  const label = group.firstElementChild as HTMLElement;
  const code = (text: string) => {
    const elem = document.createElement('code');
    elem.textContent = text;
    return elem;
  };
  // The note's `code` spans as code, the rest as text
  label.append(
    code(source),
    ': ',
    ...note.split('`').map((part, i) => (i % 2 ? code(part) : part))
  );
  if (cmp) group.append(cmp.elem);
  return group;
};

/** A table's row in a section (the tables' layout) */
const addTableRow = (parent: HTMLElement, source: string, note: string, cmp: CMPHandle) =>
  addParityRow(parent, { source, note, cmp, layout: ['hubDemoTables', 'hubDemoTableWide'] });

/** A cell of two lines: a name and a dimmed line under it (five of the census' tables) */
const twoLines = (main: string, sub: string, title?: string) => {
  const lines = CMP({ class: 'hubDemoTwoLines', attr: title ? { title } : undefined });
  lines.add({ tag: 'span', text: main });
  lines.add({ tag: 'span', class: 'hubDemoTwoLines__sub', text: sub });
  return lines;
};

const count = (value: unknown) => (value as number).toLocaleString('en');
const bytes = (value: unknown) => {
  const mb = (value as number) / 1048576;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round((value as number) / 1024)} kB`;
};
const signedBytes = (value: unknown) =>
  `${(value as number) > 0 ? '+' : (value as number) < 0 ? '−' : ''}${bytes(Math.abs(value as number))}`;
/** A size cell's value: bytes, or a text standing in for them ("in textures") */
const sizeOrText = (value: unknown) => (typeof value === 'string' ? value : bytes(value));
const MB = 1048576;

// --- GPU memory ---

type SizeRow = { id: string; label: string; size: number | string; count?: number };

const CATEGORIES: SizeRow[] = [
  { id: 'textures', label: 'Textures', size: 402 * MB, count: 214 },
  { id: 'attributes', label: 'Attributes', size: 96 * MB, count: 1840 },
  { id: 'index', label: 'Index', size: 18 * MB, count: 612 },
  { id: 'storage', label: 'Storage buffers', size: 4.5 * MB, count: 12 },
  { id: 'indirect', label: 'Indirect', size: 0.2 * MB, count: 3 },
];

const ELSEWHERE: SizeRow[] = [
  { id: 'targets', label: 'Render targets', size: 'in textures', count: 9 },
  { id: 'geometries', label: 'Geometries', size: 'in attributes', count: 588 },
];

type FrameRow = { id: string; last: number; min: number; avg: number; max: number };

const FRAME_LABELS = ['Draw calls', 'Triangles', 'Compute calls', 'Textures bound'];

/** The frame table's rows at a step: every figure moves a little */
const getFrameRows = (step: number): FrameRow[] =>
  FRAME_LABELS.map((id, i) => {
    const base = [412, 1284000, 6, 96][i];
    const last = Math.round(base * (1 + 0.05 * Math.sin(step / 2 + i)));
    return { id, last, min: Math.round(base * 0.95), avg: base, max: Math.round(base * 1.05) };
  });

type SourceRow = { id: string; source: string; owner: string; size: number; objects: number };

const SOURCES: SourceRow[] = [
  { id: 'shadow:sun', source: 'Sun shadow map', owner: 'kernel/light', size: 64 * MB, objects: 1 },
  {
    id: 'postfx:bloom',
    source: 'Bloom targets',
    owner: 'features/postfx',
    size: 22 * MB,
    objects: 6,
  },
  {
    id: 'sky:env',
    source: 'Sky box env bake',
    owner: 'features/skybox',
    size: 12 * MB,
    objects: 2,
  },
  { id: 'lines:debug', source: 'Debug lines', owner: 'features/lines', size: 0, objects: 0 },
];

const sumSources = (key: 'size' | 'objects') => SOURCES.reduce((total, row) => total + row[key], 0);

type OwnerRow = {
  id: string;
  name: string;
  level: 0 | 1;
  current?: boolean;
  textures?: number;
  geometry?: number;
  total: number;
  items: string;
};

const OWNERS: OwnerRow[] = [
  {
    id: 'scene01',
    name: 'scene01',
    level: 0,
    current: true,
    textures: 210 * MB,
    geometry: 64 * MB,
    total: 274 * MB,
    items: '312',
  },
  {
    id: 'scene01:terrain',
    name: 'terrain',
    level: 1,
    textures: 96 * MB,
    geometry: 22 * MB,
    total: 118 * MB,
    items: '4',
  },
  {
    id: 'scene01:castle',
    name: 'castle.glb',
    level: 1,
    textures: 48 * MB,
    geometry: 18 * MB,
    total: 66 * MB,
    items: '61',
  },
  {
    id: 'kernel',
    name: 'Kernel',
    level: 0,
    textures: 96 * MB,
    geometry: 30 * MB,
    total: 126 * MB,
    items: '48',
  },
  {
    id: 'kernel:sky',
    name: 'Sky box',
    level: 1,
    textures: 64 * MB,
    geometry: 1 * MB,
    total: 65 * MB,
    items: '3',
  },
  { id: 'untracked', name: 'Untracked', level: 0, total: 41 * MB, items: '9 %' },
];

const OWNERS_TOTAL: OwnerRow = { id: 'total', name: 'Total', level: 0, total: 441 * MB, items: '' };

type LeftRow = { id: string; name: string; where: string; count: number; size: number };

const LEFT_BEHIND: LeftRow[] = Array.from({ length: 12 }, (_, i) => ({
  id: `left${i}`,
  name: ['Texture', 'BufferGeometry', 'RenderTarget'][i % 3],
  where: `lodShowcase · visit ${1 + (i % 2)} · ${['Impostors.ts:212', 'Lanes.ts:88', 'LOD.ts:340'][i % 3]}`,
  count: 1 + ((i * 5) % 7),
  size: ((i * 37) % 90) * 65536 + 4096,
}));

const LEFT_MORE: LeftRow = { id: 'more', name: '+4 more', where: '', count: 9, size: 3 * MB };
const LEFT_TOTAL: LeftRow = {
  id: 'total',
  name: 'Total',
  where: '',
  count: LEFT_BEHIND.reduce((total, row) => total + row.count, 0) + LEFT_MORE.count,
  size: LEFT_BEHIND.reduce((total, row) => total + row.size, 0) + LEFT_MORE.size,
};

type DiffRow = { id: string; asset: string; kindOwner: string; then: number; now: number };

const ASSET_DIFF: DiffRow[] = [
  { id: 'rock', asset: 'rockAlbedo', kindOwner: 'Texture · largeWorld', then: 0, now: 5.3 * MB },
  {
    id: 'impostor',
    asset: 'pineImpostor',
    kindOwner: 'Texture · lodShowcase',
    then: 2 * MB,
    now: 8 * MB,
  },
  { id: 'castle', asset: 'castle', kindOwner: 'Model · scene01', then: 18 * MB, now: 0 },
];

/** GPU memory's nine tables: the frame's rows a function on the box's scheduler (500 ms) */
export const buildGpuMemoryTables = (parent: HTMLElement, live: ParityLive) => {
  const sizeColumn: TableColumn<SizeRow> = { key: 'size', label: 'Size', format: sizeOrText };
  addTableRow(
    parent,
    '_dbg__GPUMemory.ts:214',
    'the categories, sorted by size; the two rows counted elsewhere (text in the Size cell) a group, which the sort leaves after them',
    createTable<SizeRow>({
      caption: 'Categories',
      columns: [
        { key: 'label', label: 'Category', rowHeader: true },
        { ...sizeColumn, sortable: true },
        { key: 'count', label: 'Count', format: count },
      ],
      rows: CATEGORIES,
      groups: [{ key: 'elsewhere', label: 'Counted elsewhere', rows: ELSEWHERE }],
      sort: { key: 'size', direction: 'descending' },
    }).cmp
  );

  addTableRow(
    parent,
    ':221',
    'the peaks',
    createTable<{ id: string; size: number; at: string }>({
      caption: 'Peaks',
      captionHidden: true,
      columns: [
        { key: 'id', label: 'Peak', rowHeader: true },
        { key: 'size', label: 'Size', format: bytes },
        { key: 'at', label: 'Reached' },
      ],
      rows: [
        { id: 'Since boot', size: 640 * MB, at: '00:42.1' },
        { id: 'Since scene enter', size: 612 * MB, at: '00:12.8' },
      ],
    }).cmp
  );

  addTableRow(
    parent,
    ':242',
    'the frame’s last, min, avg and max, `rows` a function on the box’s scheduler at 500 ms (the live run). The heading’s “(main loop paused)” isn’t the caption, which is fixed: a line beside the table',
    createTable<FrameRow>({
      caption: 'This frame',
      columns: [
        { key: 'id', label: 'Measure', rowHeader: true },
        ...(['last', 'min', 'avg', 'max'] as const).map(
          (key): TableColumn<FrameRow> => ({
            key,
            label: key[0].toUpperCase() + key.slice(1),
            format: count,
          })
        ),
      ],
      rows: () => getFrameRows(live.getStep()),
      scheduler: live.scheduler,
      interval: 500,
    }).cmp
  );

  addTableRow(
    parent,
    ':276',
    'the sources. The source and its owner a `cell` with the id as its `title`; the Total the footer; the untracked class at 0 B has no row form (a `cell` can dim its text); the empty row’s text `empty`',
    createTable<SourceRow>({
      caption: 'Sources',
      columns: [
        {
          key: 'source',
          label: 'Source',
          rowHeader: true,
          cell: (row) => twoLines(row.source, row.owner, row.id),
        },
        { key: 'size', label: 'Size', format: bytes },
        { key: 'objects', label: 'GPU objects', format: count },
      ],
      rows: SOURCES,
      footer: [
        {
          id: 'total',
          source: 'Total',
          owner: '',
          size: sumSources('size'),
          objects: sumSources('objects'),
        },
      ],
      empty: 'No sources registered.',
    }).cmp
  );

  addTableRow(
    parent,
    ':359',
    'by owner: an owner, then its assets indented. No tree in a table (D1 left the treegrid out): the levels by a `cell`, and no sort (it would break them). The current scene a badge in its cell (no row class); the Untracked row’s % in Items; the Total the footer',
    createTable<OwnerRow>({
      caption: 'By owner',
      columns: [
        {
          key: 'name',
          label: 'Owner',
          rowHeader: true,
          cell: (row) => {
            const cell = CMP({
              class: 'hubDemoParityCell',
              attr: { 'data-level': String(row.level) },
            });
            cell.add({ tag: 'span', text: row.name });
            if (row.current) cell.add(createBadge({ label: 'current' }).cmp);
            return cell;
          },
        },
        { key: 'textures', label: 'Textures', format: (v) => (v === undefined ? '' : bytes(v)) },
        { key: 'geometry', label: 'Geometry', format: (v) => (v === undefined ? '' : bytes(v)) },
        { key: 'total', label: 'Total', format: bytes },
        { key: 'items', label: 'Items', align: 'end' },
      ],
      rows: OWNERS,
      footer: [OWNERS_TOTAL],
    }).cmp
  );

  addTableRow(
    parent,
    ':367',
    'the untracked, sorted by size',
    createTable<SizeRow>({
      caption: 'Untracked',
      captionHidden: true,
      columns: [{ key: 'label', label: 'Untracked', rowHeader: true }, sizeColumn],
      rows: [
        { id: 'uniforms', label: 'Uniform buffers', size: 22 * MB },
        { id: 'geometry', label: 'Attributes + index', size: 12 * MB },
        { id: 'shaders', label: 'Shader code', size: 4 * MB },
        { id: 'targets', label: 'Render targets', size: 3 * MB },
      ],
      sort: { key: 'size', direction: 'descending' },
    }).cmp
  );

  addTableRow(
    parent,
    ':449',
    'a snapshot’s categories: signed deltas by `format`',
    createTable<SizeRow>({
      caption: 'Since the snapshot',
      columns: [
        { key: 'label', label: 'Category', rowHeader: true },
        { key: 'size', label: 'Size', format: signedBytes },
        {
          key: 'count',
          label: 'Count',
          format: (v) => `${(v as number) > 0 ? '+' : ''}${count(v)}`,
        },
      ],
      rows: [
        { id: 'textures', label: 'Textures', size: 38 * MB, count: 12 },
        { id: 'attributes', label: 'Attributes', size: -6 * MB, count: -40 },
        { id: 'index', label: 'Index', size: 0, count: 0 },
      ],
    }).cmp
  );

  addTableRow(
    parent,
    ':457',
    'left behind: the allocation and its scene, visit and site a `cell`; at most 12 rows, and the “+N more” `colspan` row a footer row before the Total (no row spans the columns; virtual rows could drop the cap)',
    createTable<LeftRow>({
      caption: 'Left behind',
      columns: [
        {
          key: 'name',
          label: 'Allocation',
          rowHeader: true,
          cell: (row) =>
            row.where ? twoLines(row.name, row.where) : CMP({ tag: 'span', text: row.name }),
        },
        { key: 'count', label: 'Count', format: count },
        { key: 'size', label: 'Size', format: bytes },
      ],
      rows: LEFT_BEHIND,
      footer: [LEFT_MORE, LEFT_TOTAL],
    }).cmp
  );

  addTableRow(
    parent,
    ':466',
    'the asset diff: the asset and its kind and owner a `cell`, the change by `format`. The counts the header carries today (“Then (14)”) can’t: a column’s label is fixed, so they go in a line above',
    createTable<DiffRow>({
      caption: 'Assets since the snapshot',
      columns: [
        {
          key: 'asset',
          label: 'Asset',
          rowHeader: true,
          cell: (row) => twoLines(row.asset, row.kindOwner),
        },
        { key: 'then', label: 'Then', format: bytes },
        { key: 'now', label: 'Now', format: bytes },
        {
          key: 'change',
          label: 'Change',
          value: (row) => row.now - row.then,
          format: signedBytes,
        },
      ],
      rows: ASSET_DIFF,
    }).cmp
  );
};
