/**
 * The dev page's "Debugger parity" box's tables (p805 D14): one `createTable` per table of p805
 * §4.1's census (the profiler's, GPU memory's and the assets info window's), each with the census
 * row's source line and what its port takes that isn't a rename. Out of `parity.ts` for its size.
 */
import {
  CMP,
  createBadge,
  createButton,
  createSegmentedControl,
  createTable,
  getSvgIcon,
} from 'aekasha/ui';
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

// --- The profiler ---

type OverviewRow = {
  id: string;
  label: string;
  value: string;
  sub: string;
  warn?: boolean;
  action?: string;
};

const OVERVIEW: OverviewRow[] = [
  { id: 'fps', label: 'FPS', value: '60', sub: 'avg over 1 s' },
  { id: 'frame', label: 'Frame time', value: '14.2 ms', sub: 'budget 16.7 ms' },
  { id: 'gpu', label: 'GPU time', value: '–', sub: 'n/a (timestamp queries off)' },
  { id: 'draws', label: 'Draw calls', value: '412', sub: '38 instanced' },
  { id: 'tris', label: 'Triangles', value: '1,284,000', sub: 'in view' },
  { id: 'memory', label: 'GPU memory', value: '612 MB', sub: 'over the 512 MB budget', warn: true },
  { id: 'objects', label: 'Objects', value: '780', sub: '506 in view', action: 'Objects' },
];

const OVERVIEW_APP: OverviewRow[] = [
  { id: 'enemies', label: 'Enemies', value: '24', sub: 'app source' },
  { id: 'bullets', label: 'Bullets', value: '310', sub: 'pooled' },
];

type ObjectKind = { id: string; name: string; sub: string; inView: number[]; all: number[] };

const OBJECT_KINDS: ObjectKind[] = [
  {
    id: 'mesh',
    name: 'Meshes',
    sub: 'Mesh',
    inView: [412, 1284000, 902000],
    all: [592, 1690000, 1180000],
  },
  {
    id: 'instanced',
    name: 'Instanced',
    sub: 'InstancedMesh',
    inView: [96, 410000, 260000],
    all: [118, 498000, 316000],
  },
  {
    id: 'lines',
    name: 'Lines',
    sub: 'Line, LineSegments',
    inView: [14, 0, 2800],
    all: [17, 0, 3400],
  },
  { id: 'sprites', name: 'Sprites', sub: 'Sprite', inView: [38, 76, 152], all: [99, 198, 396] },
  {
    id: 'impostors',
    name: 'Impostors',
    sub: 'cross-quads',
    inView: [220, 520, 1040],
    all: [260, 620, 1240],
  },
  { id: 'points', name: 'Points', sub: 'Points', inView: [2, 0, 8000], all: [2, 0, 8000] },
];

const sumKinds = (part: 'inView' | 'all') =>
  [0, 1, 2].map((i) => OBJECT_KINDS.reduce((total, kind) => total + kind[part][i], 0));

const OBJECT_KINDS_TOTAL: ObjectKind = {
  id: 'total',
  name: 'Total',
  sub: '',
  inView: sumKinds('inView'),
  all: sumKinds('all'),
};

const MEASURES = ['Objects', 'Triangles', 'Vertices'] as const;

type Heavy = {
  id: string;
  rank: number;
  name: string;
  entity: string;
  kind: string;
  tris: number;
  instances: number;
};

const HEAVIEST: Heavy[] = [
  ['terrain', 'Terrain', 'Entity 3 · terrain', 'Mesh', 131072, 1],
  ['trees', 'Pine trees', 'Entity 41 · foliage', 'InstancedMesh', 96000, 400],
  ['rocks', 'Rocks', 'Entity 52 · largeWorldRock', 'InstancedMesh', 64000, 120],
  ['castle', 'Castle', 'Entity 12 · castle.glb', 'Mesh', 48210, 1],
  ['player', 'Player', 'Entity 5 · character', 'SkinnedMesh', 12400, 1],
].map(([id, name, entity, kind, tris, instances], i) => ({
  id: id as string,
  rank: i + 1,
  name: name as string,
  entity: entity as string,
  kind: kind as string,
  tris: tris as number,
  instances: instances as number,
}));

/** The profiler's Overview and Objects tabs: the Overview's figures live by `setCell` */
export const buildProfilerTables = (parent: HTMLElement, live: ParityLive) => {
  const overviewColumns: TableColumn<OverviewRow>[] = [
    { key: 'label', label: 'Metric', rowHeader: true },
    { key: 'value', label: 'Value', align: 'end', tone: (row) => (row.warn ? 'warning' : null) },
    {
      key: 'sub',
      label: 'Details',
      cell: (row) => {
        const cell = CMP({ class: 'hubDemoParityCell', text: row.sub });
        if (row.action) {
          cell.add(
            createButton({ label: row.action, size: 'sm', variant: 'ghost', onClick: () => {} }).cmp
          );
        }
        return cell;
      },
    },
  ];
  const overview = createTable<OverviewRow>({
    caption: 'Overview',
    columns: overviewColumns,
    rows: OVERVIEW,
    groups: [{ key: 'app', label: 'App', rows: OVERVIEW_APP }],
    striped: true,
  });
  live.onStep(() => {
    const step = live.getStep();
    overview.setCell('fps', 'value', String(58 + (step % 3)));
    overview.setCell('frame', 'value', `${(14 + Math.sin(step / 3)).toFixed(1)} ms`);
    overview.setCell('bullets', 'value', String(300 + ((step * 17) % 60)));
  });
  addTableRow(
    parent,
    '_dbg__ProfilerOverview.ts:579',
    'the Overview. The debugger’s table has no header row: the labels are new. A row’s isWarn is the value’s tone (no row class), isNA a dash and its reason, the row’s action a `cell` button (one handler on the table today), the “App” group a group; the figures live by `setCell` (the live run)',
    overview.cmp
  );

  let measure = 0;
  const kinds = createTable<ObjectKind>({
    caption: 'Objects by kind',
    columns: [
      {
        key: 'name',
        label: 'Kind',
        rowHeader: true,
        cell: (kind) => twoLines(kind.name, kind.sub),
      },
      ...MEASURES.map(
        (label, i): TableColumn<ObjectKind> => ({
          key: label.toLowerCase(),
          label,
          value: (kind) => kind.all[i],
          format: (_, kind) => `${count(kind.inView[i])} / ${count(kind.all[i])}`,
        })
      ),
      {
        key: 'bar',
        label: 'In view and culled',
        kind: 'bar',
        value: (kind) => [kind.inView[measure], kind.all[measure] - kind.inView[measure]],
        format: () => '',
        minWidth: 96,
      },
    ],
    rows: OBJECT_KINDS,
    footer: [OBJECT_KINDS_TOTAL],
    striped: true,
  });
  const measures = createSegmentedControl<number>({
    label: 'Bars',
    value: 0,
    options: MEASURES.map((label, i) => ({ value: i, label })),
    onChange: (value) => {
      measure = value;
      kinds.refresh();
    },
  });
  const kindsBox = CMP();
  kindsBox.add(measures.cmp);
  kindsBox.add(kinds.cmp);
  addTableRow(
    parent,
    '…Objects.ts:261',
    "by kind and by owner (one template). The label and its sub line a `cell`; the bar `kind: 'bar'` of in view and culled; the Total row (in the `<tbody>` today) the footer; the “Bars” switch above a segmented control and the table’s `refresh()`",
    kindsBox
  );

  addTableRow(
    parent,
    '…Objects.ts:340',
    'the ECS worlds. No header row today (“entities” was the third cell’s word): the column labels say it',
    createTable<{ id: string; entities: number }>({
      caption: 'ECS worlds',
      captionHidden: true,
      columns: [
        { key: 'id', label: 'World', rowHeader: true },
        { key: 'entities', label: 'Entities', format: count },
      ],
      rows: [{ id: 'main', entities: 2318 }],
    }).cmp
  );

  addTableRow(
    parent,
    '…Objects.ts:386',
    'the heaviest objects. The rank a column of its own (it stays the row’s), the object and its entity line a `cell`, Edit a `cell` button (`data-heavy` today; or the grid’s `onRowActivate`)',
    createTable<Heavy>({
      caption: 'Heaviest objects',
      columns: [
        { key: 'rank', label: '#', width: 32 },
        {
          key: 'name',
          label: 'Object',
          rowHeader: true,
          cell: (row) => twoLines(row.name, row.entity),
        },
        { key: 'kind', label: 'Kind' },
        { key: 'tris', label: 'Triangles', format: count },
        { key: 'instances', label: 'Instances', format: count },
        {
          key: 'edit',
          label: 'Edit',
          cell: (row) =>
            createButton({
              label: `Edit ${row.name}`,
              iconOnly: true,
              icon: getSvgIcon('tools'),
              variant: 'ghost',
              size: 'sm',
              onClick: () => {},
            }).cmp,
        },
      ],
      rows: HEAVIEST,
    }).cmp
  );
};

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

// --- The assets info window ---

/** The assets info window's `table()` helper, twice: a texture array's layers, an atlas's cells */
export const buildAssetTables = (parent: HTMLElement) => {
  addTableRow(
    parent,
    '_dbg__TextureInfoItems.ts:130',
    'a texture array’s layers: a rename, built with the window',
    createTable<{ id: string; layer: string; source: string }>({
      caption: 'Layers',
      columns: [
        { key: 'id', label: '#', width: 32 },
        { key: 'layer', label: 'Layer', rowHeader: true },
        { key: 'source', label: 'Source' },
      ],
      rows: ['grass', 'dirt', 'rock', 'snow'].map((layer, i) => ({
        id: String(i),
        layer,
        source: `textures/terrain/${layer}.ktx2`,
      })),
      getKey: (row) => row.id,
    }).cmp
  );

  addTableRow(
    parent,
    ':209',
    'an atlas’s cells: a rename',
    createTable<{ id: string; at: string; size: string; uv: string }>({
      caption: 'Cells',
      columns: [
        { key: 'id', label: 'Cell', rowHeader: true },
        { key: 'at', label: 'At' },
        { key: 'size', label: 'Size' },
        { key: 'uv', label: 'UV rect' },
      ],
      rows: ['pine', 'oak', 'birch'].map((id, i) => ({
        id,
        at: `${i * 256}, 0`,
        size: '256 × 512',
        uv: `${(i / 4).toFixed(2)}, 0, ${((i + 1) / 4).toFixed(2)}, 1`,
      })),
    }).cmp
  );
};
