import * as THREE from 'three/webgpu';
import {
  ComponentType,
  ECSSystemStage,
  getECSWorld,
  getEntityIdByAppId,
  getLightByAppId,
  getRenderer,
} from 'aekasha';
import {
  CMP,
  createCheckbox,
  createColorField,
  createContextMenu,
  createFieldContextMenu,
  createPropertyGrid,
  createQuaternionField,
  createSlider,
  createSparkline,
  createSplitter,
  createStatTile,
  createTable,
  createTabs,
  createTimeSeries,
  createTree,
  createVectorField,
  openDraggableWindow,
  toggleDraggableWindow,
} from 'aekasha/ui';
import type { CMPHandle, ContextMenu, MenuItem, PropertyGrid, StatTile } from 'aekasha/ui';

/**
 * The UI kit example's inspector (p805 D15): the scene's objects in a tree beside a splitter, and
 * tabs: Properties, a property grid bound to the picked object with the fields' context menu, and
 * Stats, the frame's figures, its frame time as a time series and the meshes in a table. The
 * scene file describes its objects (`InspectorScene`); this module reads and edits them through
 * that, and knows nothing else of the scene.
 */

/** A colour the inspector edits: the scene's own record, its options and the one it starts at */
type InspectedColor = {
  get: () => string;
  /** Sets it while the user drags (`last` false) and once more when they let go */
  set: (color: string, last: boolean) => void;
  options: readonly { value: string; label: string }[];
  default: string;
};

/** An object of the scene the inspector shows */
export type InspectedObject = {
  /** Its key in the tree, the table and the palette */
  key: string;
  /** Its name now (a shape's changes with a rename) */
  name: string;
  /** What it is: the tree's badge and the table's Kind */
  kind: 'Shape' | 'Ground' | 'Light';
  /** Its entity: the position, the visibility and a mesh's triangles are read from it */
  entityId: number;
  /** Its rotation is edited too (a shape's) */
  rotates?: boolean;
  /** Its colour (a material's or a light's) */
  color?: InspectedColor;
  /** A light's intensity, from 0 to `max` */
  intensity?: { get: () => number; set: (value: number) => void; max: number; default: number };
  /** Turns it an eighth (a shape) */
  turn?: () => void;
};

/** A group of the outline: a tree node that opens */
export type InspectedGroup = { key: string; name: string; objects: InspectedObject[] };

/** What the inspector reads of the scene */
export type InspectorScene = {
  /** The outline's groups, read again on each refresh (a rename's new name) */
  getOutline: () => InspectedGroup[];
};

/**
 * A light of the scene as the inspector shows it, by its entity's app id: its colour and its
 * intensity, read from and written to the light itself.
 * @param def its key and name in the outline, its app id, the colour and intensity it starts at
 * (the fields' Reset), and the colours to pick from
 * @returns the light's object for the outline
 */
export const getLightObject = (def: {
  key: string;
  appId: string;
  name: string;
  color: string;
  intensity: number;
  colors: readonly { value: string; label: string }[];
}): InspectedObject => {
  const light = () => getLightByAppId(def.appId);
  return {
    key: def.key,
    name: def.name,
    kind: 'Light',
    entityId: getEntityIdByAppId(def.appId) ?? -1,
    color: {
      get: () => `#${light()?.color.getHexString() ?? 'ffffff'}`,
      set: (color) => light()?.color.set(color),
      options: def.colors,
      default: def.color,
    },
    intensity: {
      get: () => light()?.intensity ?? 0,
      set: (value) => {
        const target = light();
        if (target) target.intensity = value;
      },
      max: def.intensity * 2,
      default: def.intensity,
    },
  };
};

/** The inspector a window shows: its CMP, and what its window's helpers call on it */
type Inspector = {
  cmp: CMPHandle;
  /** Picks an object: selected in the tree, its properties shown */
  select: (key: string) => void;
  /** Reads the outline again (names, visibility) and the picked object's fields */
  refresh: () => void;
};

type OutlineNode = InspectedGroup | InspectedObject;

const isGroup = (node: OutlineNode): node is InspectedGroup => 'objects' in node;

const WINDOW_ID = 'exampleUiKitInspector';

/** The inspector while its window is open */
let openedInspector: Inspector | null = null;

/** The inspector's window: its content made on each open, its handle kept while it's open */
const getWindowProps = (scene: InspectorScene) => ({
  id: WINDOW_ID,
  title: 'Inspector',
  content: () => {
    const inspector = createInspector(scene, 'box');
    openedInspector = inspector;
    const panel = CMP({
      class: 'exampleUiKitInspectorPanel',
      onRemoveCmp: () => {
        if (openedInspector === inspector) openedInspector = null;
      },
    });
    panel.add(inspector.cmp);
    return panel;
  },
  // A % position is the window's centre
  position: { x: 62, y: 56 },
  units: { position: { x: '%' as const, y: '%' as const } },
  size: { w: 600, h: 440 },
  minSize: { w: 420, h: 300 },
  closeOnSceneChange: true,
});

/** Opens the inspector's window, brings it to the front, or closes it when it's on top */
export const toggleInspectorWindow = (scene: InspectorScene) =>
  toggleDraggableWindow(getWindowProps(scene));

/** Opens the inspector's window (or brings it to the front) on an object */
export const openInspector = (scene: InspectorScene, key: string) => {
  openDraggableWindow(getWindowProps(scene));
  openedInspector?.select(key);
};

/** The open inspector reads the scene again: a change made elsewhere (a rename, a colour) */
export const refreshInspector = () => openedInspector?.refresh();

const findObject = (scene: InspectorScene, key: string | null) => {
  for (const group of scene.getOutline()) {
    const object = group.objects.find((o) => o.key === key);
    if (object) return object;
  }
  return null;
};

const isVisible = (object: InspectedObject) => !getECSWorld().isDisabled(object.entityId);

const setVisible = (object: InspectedObject, visible: boolean) =>
  getECSWorld().setDisabled(object.entityId, !visible);

/** A mesh's triangles and vertices, from its geometry (null for a light) */
const getMeshCounts = (object: InspectedObject) => {
  const mesh = getECSWorld().getComponent(object.entityId, ComponentType.OBJECT3D)?.value;
  if (!(mesh instanceof THREE.Mesh)) return null;
  const geometry = mesh.geometry as THREE.BufferGeometry;
  const vertices = geometry.getAttribute('position')?.count ?? 0;
  return { triangles: (geometry.index?.count ?? vertices) / 3, vertices };
};

// #region ui-kit-inspector (shown in the Hub: hub/pages/examples/ui-kit/)
/**
 * Makes the inspector: the outline's tree, the splitter, the tabs and the context menu on the
 * tree. Removing its `cmp` removes them all, the Stats tab's system with it.
 * @param scene what it reads of the scene
 * @param selected the object picked at the start
 */
const createInspector = (scene: InspectorScene, selected?: string): Inspector => {
  // The Properties tab's Visible checkbox mutes the object's row
  const properties = createPropertiesPanel(scene, () => tree.refresh());
  const tree = createTree<OutlineNode>({
    label: 'Scene outline',
    // A function: `refresh()` reads it again, so a renamed shape shows its new name
    roots: () => scene.getOutline(),
    getKey: (node) => node.key,
    getChildren: (node) => (isGroup(node) ? node.objects : null),
    title: (node) => node.name,
    badge: (node) => (isGroup(node) ? null : node.kind),
    // A hidden object's name is muted and in italics
    isPlaceholder: (node) => !isGroup(node) && !isVisible(node),
    expanded: scene.getOutline().map((group) => group.key),
    selection: 'single',
    selected: selected ? [selected] : [],
    onSelectionChange: ([key]) => properties.show(key ?? null),
    filter: { field: true, placeholder: 'Find an object' },
  });

  const tabs = createTabs({
    label: 'Inspector',
    tabs: [
      { key: 'properties', label: 'Properties', content: properties.cmp },
      // Built on its first show: its system runs only once someone looks
      {
        key: 'stats',
        label: 'Stats',
        content: () => createStatsPanel(scene, (key) => select(key)),
      },
    ],
  });

  // The tree's width is the user's: Enter on the separator folds it away
  const splitter = createSplitter({
    first: tree.cmp,
    second: tabs.cmp,
    size: 38,
    min: 20,
    max: 70,
    collapsible: true,
    label: 'Outline width',
  });

  // One context menu for every row: it finds the row's object from the element it opens on
  const rowMenu = createContextMenu({
    target: tree.cmp.elem,
    items: (elem) => getRowMenuItems(findObject(scene, tree.getKeyAt(elem))),
    label: (elem) => `${findObject(scene, tree.getKeyAt(elem))?.name ?? 'Object'} actions`,
  });
  const cmp = CMP({ class: 'exampleUiKitInspector', onRemoveCmp: () => rowMenu.cmp.remove() });
  cmp.add(splitter.cmp);

  const refresh = () => {
    tree.refresh();
    properties.refresh();
  };
  const getRowMenuItems = (object: InspectedObject | null): MenuItem[] => {
    // A group's row has none: the browser's own menu shows
    if (!object) return [];
    const { color, turn } = object;
    const items: MenuItem[] = [
      { label: 'Show its properties', onSelect: () => select(object.key) },
      {
        type: 'checkbox',
        label: 'Visible',
        checked: isVisible(object),
        onCheckedChange: (on) => {
          setVisible(object, on);
          refresh();
        },
      },
    ];
    // A submenu of the colours, the current one checked
    if (color) {
      items.push({
        type: 'submenu',
        label: 'Colour',
        items: [
          {
            type: 'radio',
            label: 'Colour',
            value: color.get(),
            options: [...color.options],
            onValueChange: (value) => {
              color.set(value, true);
              properties.refresh();
            },
          },
        ],
      });
    }
    if (turn) items.push({ label: 'Turn', onSelect: turn });
    items.push(
      { type: 'separator' },
      {
        label: 'Copy the name',
        onSelect: () => void navigator.clipboard?.writeText(object.name).catch(() => undefined),
      }
    );
    return items;
  };

  const select = (key: string) => {
    tree.setSelected([key]);
    tree.scrollToKey(key);
    tabs.select('properties');
    properties.show(key);
  };
  if (selected) properties.show(selected);

  return { cmp, select, refresh };
};
// #endregion ui-kit-inspector

/**
 * The Properties tab: the picked object's grid, made again for each pick (each kind has its own
 * rows), with the fields' context menu (Reset, Copy, Paste) over it.
 * @param onVisibleChange the Visible row's change
 */
const createPropertiesPanel = (scene: InspectorScene, onVisibleChange: () => void) => {
  let shown: { object: InspectedObject; grid: PropertyGrid; fieldsMenu: ContextMenu } | null = null;
  const clear = () => {
    shown?.fieldsMenu.cmp.remove();
    shown = null;
    cmp.removeChildren();
  };
  const cmp = CMP({ class: 'exampleUiKitProperties', onRemoveCmp: clear });

  const show = (key: string | null) => {
    clear();
    const object = findObject(scene, key);
    if (!object) {
      cmp.add({ tag: 'p', class: 'exampleUiKitNote', text: 'Pick an object in the outline.' });
      return;
    }
    cmp.add({ tag: 'h3', text: object.name });
    const grid = createPropertyGrid({
      labelWidth: 34,
      children: createObjectFields(object, onVisibleChange),
    });
    cmp.add(grid.cmp);
    shown = { object, grid, fieldsMenu: createFieldContextMenu({ container: grid.cmp.elem }) };
  };

  return {
    cmp,
    show,
    /** Reads the shown object's rows again (or makes them again when its record changed: a
     * rename's new name) */
    refresh: () => {
      if (!shown) return;
      const object = findObject(scene, shown.object.key);
      if (object?.name === shown.object.name) shown.grid.refresh();
      else show(shown.object.key);
    },
  };
};

// #region ui-kit-inspector-properties (shown in the Hub: hub/pages/examples/ui-kit/)
const ORIGIN = { x: 0, y: 0, z: 0 };
const NO_ROTATION = { x: 0, y: 0, z: 0, w: 1 };

/**
 * The rows of an object's kind, each bound to the scene with a getter and a setter
 * @param onVisibleChange the Visible row's change
 */
const createObjectFields = (object: InspectedObject, onVisibleChange: () => void) => {
  const world = getECSWorld();
  const { entityId, color, intensity } = object;
  return [
    createVectorField({
      label: 'Position',
      get: () => world.getPosition(entityId) ?? ORIGIN,
      set: (pos) => world.setTransform(entityId, { pos }),
      step: 0.1,
    }),
    ...(object.rotates
      ? [
          createQuaternionField({
            label: 'Rotation',
            get: () => world.getRotation(entityId) ?? NO_ROTATION,
            set: (rot) => world.setTransform(entityId, { rot }),
            order: 'YXZ',
            interval: 100,
          }),
        ]
      : []),
    ...(color
      ? [
          createColorField({
            label: 'Colour',
            get: color.get,
            set: (value) => color.set(value, false),
            // The fields' menu's Reset goes back to it
            default: color.default,
            palette: color.options.map((option) => option.value),
            onChange: (value, { last }) => {
              if (last) color.set(value, true);
            },
          }),
        ]
      : []),
    ...(intensity
      ? [
          createSlider({
            label: 'Intensity',
            get: intensity.get,
            set: intensity.set,
            default: intensity.default,
            min: 0,
            max: intensity.max,
            step: 0.1,
          }),
        ]
      : []),
    createCheckbox({
      label: 'Visible',
      get: () => isVisible(object),
      set: (on) => setVisible(object, on),
      default: true,
      onChange: onVisibleChange,
    }),
  ];
};
// #endregion ui-kit-inspector-properties

// #region ui-kit-inspector-stats (shown in the Hub: hub/pages/examples/ui-kit/)
/** How often the tiles show the last period's figures, in seconds */
const TILE_PERIOD = 0.25;
const STATS_SYSTEM_ID = 'exampleUiKitStats';

/**
 * The Stats tab: three tiles (the frame time with a sparkline, the draw calls, the triangles),
 * the frame time pushed to a time series every frame, and the meshes in a table sorted by their
 * triangles. A system of the world feeds them while the tab's content is in the page.
 * @param onPick a table row's activation: the inspector picks its object
 */
const createStatsPanel = (scene: InspectorScene, onPick: (key: string) => void) => {
  const sparkline = createSparkline({ capacity: 40, min: 0, area: true });
  const tiles: Record<'frame' | 'calls' | 'triangles', StatTile> = {
    frame: createStatTile({
      label: 'Frame time',
      unit: 'ms',
      format: (ms) => ms.toFixed(1),
      sparkline,
    }),
    calls: createStatTile({ label: 'Draw calls' }),
    triangles: createStatTile({ label: 'Triangles', format: (n) => n.toLocaleString() }),
  };
  const series = createTimeSeries({
    series: [{ label: 'Frame time' }],
    unit: 'ms',
    height: 96,
    thresholds: [{ value: 1000 / 60, label: '60 fps', tone: 'warning' }],
  });
  const table = createTable<{
    key: string;
    name: string;
    kind: string;
    triangles: number;
    vertices: number;
  }>({
    caption: 'Meshes',
    columns: [
      { key: 'name', label: 'Name', rowHeader: true, sortable: true },
      { key: 'kind', label: 'Kind', sortable: true },
      { key: 'triangles', label: 'Triangles', sortable: true },
      { key: 'vertices', label: 'Vertices', sortable: true },
    ],
    // Read again on `refresh()`: the outline's names now
    rows: () =>
      scene.getOutline().flatMap((group) =>
        group.objects.flatMap((object) => {
          const counts = getMeshCounts(object);
          return counts
            ? [{ key: object.key, name: object.name, kind: object.kind, ...counts }]
            : [];
        })
      ),
    getKey: (row) => row.key,
    sort: { key: 'triangles', direction: 'descending' },
    striped: true,
    highlight: 'row',
    onRowActivate: (_row, key) => onPick(key),
  });

  // Summed over a period, then shown: nothing allocated per frame
  let elapsed = 0;
  let frames = 0;
  // LATE_MAIN: right after the frame's render, so three's figures are this frame's (it resets
  // them as its next frame starts)
  const world = getECSWorld();
  world.addSystem(ECSSystemStage.LATE_MAIN, STATS_SYSTEM_ID, (_world, delta) => {
    series.push(delta * 1000);
    elapsed += delta;
    frames++;
    if (elapsed < TILE_PERIOD) return;
    const frameTime = (elapsed * 1000) / frames;
    tiles.frame.setValue(frameTime);
    sparkline.push(frameTime);
    const info = getRenderer()?.info.render;
    tiles.calls.setValue(info?.drawCalls ?? null);
    tiles.triangles.setValue(info?.triangles ?? null);
    elapsed = 0;
    frames = 0;
  });

  const panel = CMP({
    class: 'exampleUiKitStats',
    onRemoveCmp: () => world.removeSystem(STATS_SYSTEM_ID),
  });
  const row = panel.add({ class: 'exampleUiKitTiles' });
  for (const tile of Object.values(tiles)) row.add(tile.cmp);
  panel.add(series.cmp);
  panel.add(table.cmp);
  return panel;
};
// #endregion ui-kit-inspector-stats
