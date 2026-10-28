/**
 * The component library's data display (the Hub's `features/ui-kit/data/` page, p805): the list
 * (with virtual rows and reorder) and the tree so far; the table, the graphs and the stat tile join
 * them.
 */
import {
  createList,
  createListReorder,
  createTree,
  createVirtualRows,
  getSvgIcon,
} from 'aekasha/ui';
import type { CMPHandle } from 'aekasha/ui';
import { ID_PREFIX, addButton, addGroup, addKitRoot } from './page';
import type { Demo } from './page';

// --- List ---

const LIST_ID = (name: string) => `${ID_PREFIX}List${name}`;

type SceneObject = {
  id: string;
  name: string;
  kind: 'Mesh' | 'Light' | 'Camera' | 'Group';
  entity: number;
  triangles?: number;
};

const OBJECTS: SceneObject[] = [
  { id: 'camera', name: 'Main camera', kind: 'Camera', entity: 1 },
  { id: 'sun', name: 'Sun', kind: 'Light', entity: 2 },
  { id: 'terrain', name: 'Terrain', kind: 'Mesh', entity: 3, triangles: 131072 },
  { id: 'water', name: 'Water', kind: 'Mesh', entity: 4, triangles: 2048 },
  { id: 'player', name: 'Player', kind: 'Group', entity: 5 },
  { id: 'crate', name: 'Crate', kind: 'Mesh', entity: 6, triangles: 12 },
  { id: 'barrel', name: 'Barrel', kind: 'Mesh', entity: 7, triangles: 960 },
  { id: 'lamp', name: 'Street lamp', kind: 'Light', entity: 8 },
  { id: 'fence', name: 'Fence', kind: 'Mesh', entity: 9, triangles: 4320 },
  { id: 'rock', name: 'Rock', kind: 'Mesh', entity: 10, triangles: 6200 },
  { id: 'tree', name: 'Pine tree', kind: 'Mesh', entity: 11, triangles: 18500 },
  { id: 'gate', name: 'Gate', kind: 'Mesh', entity: 12, triangles: 880 },
];

const KIND_ICONS: Record<SceneObject['kind'], string> = {
  Mesh: 'geometry',
  Light: 'lightBulb',
  Camera: 'camera',
  Group: 'objectsCubes',
};

type Layer = { id: string; name: string };

const LAYERS: Layer[] = [
  { id: 'terrain', name: 'Terrain' },
  { id: 'water', name: 'Water' },
  { id: 'props', name: 'Props' },
  { id: 'foliage', name: 'Foliage' },
  { id: 'lights', name: 'Lights' },
];

type DemoLight = { id: string; name: string; type: string; on: boolean; paused: boolean };

const LIGHTS: DemoLight[] = [
  { id: 'sun', name: 'Sun', type: 'DL', on: true, paused: false },
  { id: 'lamp', name: 'Street lamp', type: 'PL', on: false, paused: false },
  { id: 'spot', name: 'Stage spot', type: 'SL', on: true, paused: true },
  { id: 'baked', name: 'Baked fill', type: 'PL', on: true, paused: false },
];

type DrawPass = { id: string; name: string; description: string };

const DRAW_PASSES: DrawPass[] = [
  { id: 'sky', name: 'Sky', description: 'The sky box, behind everything' },
  { id: 'opaque', name: 'Opaque', description: 'The meshes, front to back' },
  { id: 'shadows', name: 'Shadows', description: 'The shadow maps' },
  { id: 'transparent', name: 'Transparent', description: 'Back to front' },
  { id: 'hud', name: 'HUD', description: 'The UI over the canvas' },
];

/** In the page: a static list, a selectable one with a filter field, a multiple selection, one
 * with actions, a virtual one and a reorderable one; what the user selects, opens and presses shows in the status line */
const initListDemo: Demo = (box) => {
  const root = addKitRoot(box);
  const status = document.createElement('p');
  status.id = LIST_ID('Status');
  status.className = 'hubDemoLine';
  status.setAttribute('role', 'status');
  const report = (text: string) => (status.textContent = text);
  // The state buttons first: a click scrolls its button to the viewport's middle, which would put
  // a list above it under the Hub's sticky header (axe's target-size then sees a cut field)
  const states = addGroup(root, 'From code: a query with no match, a list with no items');
  const row = (label: string, cmp: CMPHandle) => {
    const group = addGroup(root, label);
    group.classList.add('hubDemoLists');
    group.append(cmp.elem);
    return group;
  };

  row(
    'Static: an icon, a badge, a sub title, a description and a suffix; an unnamed object',
    createList<SceneObject>({
      id: LIST_ID('Parts'),
      label: 'Heaviest meshes',
      items: [
        ...OBJECTS.filter((object) => object.triangles),
        { ...OBJECTS[5], id: 'unnamed', name: '' },
      ]
        .sort((a, b) => (b.triangles ?? 0) - (a.triangles ?? 0))
        .slice(0, 4),
      title: (object) => object.name || 'Unnamed mesh',
      isPlaceholder: (object) => !object.name,
      subTitle: (object) => `Entity ${object.entity}`,
      icon: (object) => getSvgIcon(KIND_ICONS[object.kind]),
      badge: (object) => (object.kind === 'Mesh' ? 'GLB' : null),
      description: (object) => (object.id === 'terrain' ? 'Generated: 256 × 256 cells' : null),
      suffix: (object) => `${(object.triangles ?? 0).toLocaleString('en')} tris`,
    }).cmp
  );

  const objects = createList<SceneObject>({
    id: LIST_ID('Objects'),
    heading: 'Scene objects',
    headingLevel: 3,
    items: OBJECTS,
    title: (object) => object.name,
    icon: (object) => getSvgIcon(KIND_ICONS[object.kind]),
    suffix: (object) => object.kind,
    selection: 'single',
    onSelectionChange: (keys) => report(`Selected: ${keys.join(', ') || 'none'}`),
    onActivate: (object) => report(`Opened: ${object.name}`),
    filter: { field: true, fieldLabel: 'Filter the scene objects', placeholder: 'Filter objects' },
  });
  row(
    'Selectable, with a filter field: Enter or a click opens and selects; the box scrolls',
    objects.cmp
  );
  objects.cmp.elem.classList.add('hubDemoListScroll');
  addButton(states, 'Filter by “zz”', () => objects.setQuery('zz'));

  row(
    'Several selected: Space toggles, Shift + arrows a range, Ctrl / ⌘ + A every row',
    createList<Layer>({
      id: LIST_ID('Layers'),
      label: 'Layers',
      items: LAYERS,
      title: (layer) => layer.name,
      selection: 'multiple',
      selected: ['water', 'props'],
      onSelectionChange: (keys) => report(`Layers: ${keys.join(', ') || 'none'}`),
    }).cmp
  );

  const lights = createList<DemoLight>({
    id: LIST_ID('Lights'),
    heading: 'Lights',
    headingLevel: 3,
    items: LIGHTS.map((light) => ({ ...light })),
    title: (light) => light.name,
    badge: (light) => light.type,
    disabled: (light) => light.id === 'baked',
    description: (light) => (light.id === 'baked' ? 'Baked into the light map' : null),
    selection: 'single',
    onActivate: (light) => report(`Opened: ${light.name}`),
    actions: [
      {
        key: 'on',
        label: (light) => `${light.name} on`,
        icon: getSvgIcon('lightBulb'),
        pressed: (light) => light.on,
        onPress: (light) => {
          light.on = !light.on;
          report(`${light.name} ${light.on ? 'on' : 'off'}`);
        },
      },
      {
        key: 'animate',
        label: (light) => `Animate ${light.name}`,
        icon: getSvgIcon('pause'),
        iconOff: getSvgIcon('playFill'),
        pressed: (light) => !light.paused,
        hidden: (light) => light.type === 'DL',
        onPress: (light) => {
          light.paused = !light.paused;
          report(`${light.name} ${light.paused ? 'paused' : 'animated'}`);
        },
      },
    ],
    empty: 'No lights in this scene',
  });
  row('With actions: a grid, Left and Right between a row’s cells; a disabled row', lights.cmp);
  addButton(states, 'Empty the lights', () => lights.setItems([]));

  const assets: SceneObject[] = Array.from({ length: 5000 }, (_, i) => {
    const object = OBJECTS[i % OBJECTS.length];
    return { ...object, id: `asset${i}`, name: `${object.name} ${i + 1}`, entity: i + 1 };
  });
  row(
    'Virtual rows: 5,000 assets, only the rows the box shows rendered; the filter finds any',
    createList<SceneObject>({
      id: LIST_ID('Assets'),
      heading: 'Assets',
      headingLevel: 3,
      items: assets,
      title: (asset) => asset.name,
      icon: (asset) => getSvgIcon(KIND_ICONS[asset.kind]),
      suffix: (asset) => asset.kind,
      selection: 'single',
      onActivate: (asset) => report(`Opened: ${asset.name}`),
      filter: { field: true, fieldLabel: 'Filter the assets', placeholder: 'Filter assets' },
      virtual: createVirtualRows(),
    }).cmp
  );

  let passes = [...DRAW_PASSES];
  const order = createList<DrawPass>({
    id: LIST_ID('Order'),
    label: 'Draw order',
    items: () => passes,
    title: (pass) => pass.name,
    description: (pass) => pass.description,
    reorder: createListReorder({
      onReorder: ({ from, to }) => {
        const next = passes.slice();
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        passes = next;
        order.refresh();
        report(`Moved ${moved.name} to ${to + 1}`);
      },
    }),
  });
  row(
    'Reorder: Alt + ArrowUp or ArrowDown, or a drag (by the handle on a touch screen)',
    order.cmp
  );
  root.append(status);
};

// --- Tree ---

const TREE_ID = (name: string) => `${ID_PREFIX}Tree${name}`;

type OutlineNode = {
  id: string;
  name: string;
  kind: SceneObject['kind'];
  triangles?: number;
  children?: OutlineNode[];
};

const group = (id: string, name: string, children: OutlineNode[]): OutlineNode => ({
  id,
  name,
  kind: 'Group',
  children,
});
const mesh = (id: string, name: string, triangles: number): OutlineNode => ({
  id,
  name,
  kind: 'Mesh',
  triangles,
});

const OUTLINE: OutlineNode[] = [
  group('world', 'World', [
    { id: 'camera', name: 'Main camera', kind: 'Camera' },
    { id: 'sun', name: 'Sun', kind: 'Light' },
    mesh('terrain', 'Terrain', 131072),
    group('props', 'Props', [
      mesh('crate', 'Crate', 12),
      mesh('barrel', 'Barrel', 960),
      mesh('fence', 'Fence', 4320),
      mesh('gate', 'Gate', 880),
    ]),
    group('vegetation', 'Vegetation', [
      mesh('pine', 'Pine tree', 18500),
      mesh('rock', 'Rock', 6200),
    ]),
    mesh('water', 'Water', 2048),
  ]),
  group('player', 'Player', [
    mesh('body', 'Body', 9400),
    { id: 'rig', name: 'Camera rig', kind: 'Camera' },
  ]),
  group('ui', 'UI', [mesh('hud', 'HUD', 0), mesh('pause', 'Pause menu', 0)]),
];

type AssetNode = { id: string; name: string; isFile?: boolean };

const ASSET_FOLDERS: AssetNode[] = [
  { id: 'textures', name: 'Textures' },
  { id: 'models', name: 'Models' },
  { id: 'remote', name: 'Remote library' },
  { id: 'archive', name: 'Archive (slow)' },
];

const ASSET_FILES: Record<string, AssetNode[]> = {
  textures: [
    { id: 'textures/stone', name: 'Stone' },
    { id: 'textures/grass.ktx2', name: 'grass.ktx2', isFile: true },
    { id: 'textures/sand.ktx2', name: 'sand.ktx2', isFile: true },
  ],
  'textures/stone': [
    { id: 'textures/stone/albedo.ktx2', name: 'albedo.ktx2', isFile: true },
    { id: 'textures/stone/normal.ktx2', name: 'normal.ktx2', isFile: true },
  ],
  models: [
    { id: 'models/crate.glb', name: 'crate.glb', isFile: true },
    { id: 'models/barrel.glb', name: 'barrel.glb', isFile: true },
  ],
  remote: [{ id: 'remote/props.glb', name: 'props.glb', isFile: true }],
};

/** A folder's files after a short wait; the remote library fails every other try, the archive
 * takes a minute (its loading row stays for the page's shots) */
const createAssetLoader = () => {
  let remoteTries = 0;
  return (folder: AssetNode) => {
    if (folder.id === 'remote' && ++remoteTries % 2 === 1) {
      return Promise.reject(new Error('Couldn’t reach the library.'));
    }
    const delay = folder.id === 'archive' ? 60000 : 300;
    return new Promise<AssetNode[]>((resolve) => {
      setTimeout(() => resolve(ASSET_FILES[folder.id] ?? []), delay);
    });
  };
};

type Tile = { id: string; name: string; children?: Tile[] };

/** In the page: a scene outline (single selection, a filter field), lazy asset folders (one
 * failing, one slow) and 5,000 tiles with virtual rows; what the user selects and opens shows in
 * the status line */
const initTreeDemo: Demo = (box) => {
  const root = addKitRoot(box);
  const status = document.createElement('p');
  status.id = TREE_ID('Status');
  status.className = 'hubDemoLine';
  status.setAttribute('role', 'status');
  const report = (text: string) => (status.textContent = text);
  const states = addGroup(root, 'From code: a filter, a running and a failed load');
  const row = (label: string, cmp: CMPHandle) => {
    const group = addGroup(root, label);
    group.classList.add('hubDemoLists');
    group.append(cmp.elem);
    return group;
  };

  const outline = createTree<OutlineNode>({
    id: TREE_ID('Outline'),
    heading: 'Scene',
    headingLevel: 3,
    roots: OUTLINE,
    getChildren: (node) => node.children,
    title: (node) => node.name,
    icon: (node) => getSvgIcon(KIND_ICONS[node.kind]),
    suffix: (node) =>
      node.children
        ? String(node.children.length)
        : node.triangles
          ? `${node.triangles.toLocaleString('en')} tris`
          : null,
    expanded: ['world'],
    selection: 'single',
    onSelectionChange: (keys) => report(`Selected: ${keys.join(', ') || 'none'}`),
    onActivate: (node) => report(`Opened: ${node.name}`),
    filter: { field: true, fieldLabel: 'Filter the scene', placeholder: 'Filter the scene' },
  });
  row(
    'A scene outline: Right and Left open and close, Enter or a click opens and selects',
    outline.cmp
  );
  outline.cmp.elem.classList.add('hubDemoListScroll');
  addButton(states, 'Filter by “ro”', () => outline.setQuery('ro'));

  const assets = createTree<AssetNode>({
    id: TREE_ID('Assets'),
    label: 'Assets',
    roots: ASSET_FOLDERS,
    getChildren: () => undefined,
    loadChildrenAsync: createAssetLoader(),
    hasChildren: (node) => !node.isFile,
    title: (node) => node.name,
    icon: (node) => getSvgIcon(node.isFile ? 'texture' : 'assets'),
    errorText: (error) => (error as Error).message,
  });
  row(
    'Lazy children: loaded on the first open, a loading row meanwhile, a failure’s row retries',
    assets.cmp
  );
  addButton(states, 'Open the slow and the failing folders', () => {
    assets.expand('archive');
    assets.expand('remote');
  });

  const tiles: Tile[] = Array.from({ length: 40 }, (_, c) => ({
    id: `c${c}`,
    name: `Chunk ${c}`,
    children: Array.from({ length: 125 }, (_, t) => ({ id: `c${c}t${t}`, name: `Tile ${c}.${t}` })),
  }));
  row(
    'Virtual rows: 40 chunks of 125 tiles, only the rows the box shows rendered; * opens them all',
    createTree<Tile>({
      id: TREE_ID('Tiles'),
      heading: 'Tiles',
      headingLevel: 3,
      roots: tiles,
      getChildren: (tile) => tile.children,
      title: (tile) => tile.name,
      expanded: ['c0'],
      selection: 'multiple',
      onSelectionChange: (keys) => report(`Tiles: ${keys.length} selected`),
      filter: { field: true, fieldLabel: 'Filter the tiles', placeholder: 'Filter tiles' },
      virtual: createVirtualRows(),
    }).cmp
  );
  root.append(status);
};

/** The data group's demos by their box's key (`data-hub-demo`) */
export const DATA_DEMOS: Record<string, Demo> = {
  list: initListDemo,
  tree: initTreeDemo,
};
