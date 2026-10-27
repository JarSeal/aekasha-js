/**
 * The component library's data display (the Hub's `features/ui-kit/data/` page, p805): the list so
 * far (with virtual rows and reorder); the tree, the table, the graphs and the stat tile join it.
 */
import { createList, createListReorder, createVirtualRows, getSvgIcon } from 'aekasha/ui';
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

/** The data group's demos by their box's key (`data-hub-demo`) */
export const DATA_DEMOS: Record<string, Demo> = {
  list: initListDemo,
};
