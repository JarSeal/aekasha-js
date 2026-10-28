import * as THREE from 'three/webgpu';
import {
  createSceneAppLooper,
  deleteSceneAppLooper,
  getECSWorld,
  getEntityIdByAppId,
  getMaterial,
} from 'aekasha';
import {
  CMP,
  createList,
  createSparkline,
  createStatTile,
  createTable,
  createTabs,
} from 'aekasha/ui';

/**
 * The uiKit embed's data window (p805 D13): tabs of a sortable, selectable table of shades that
 * colours the box, a list of the scene's objects with a visibility toggle each, and the frame
 * time as a stat tile with a sparkline. Its own module, which the window's button imports on its
 * first press, so a build gives the data display its own chunk (`assets/uiKitEmbedData.js`): what
 * a table, a list and a figure cost on top of the HUD.
 */

type Shade = { id: string; name: string; hex: string; lightness: number };
type SceneObject = { id: string; title: string; kind: string; appId?: string };

/** The table's shades, with their HSL lightness in % */
const SHADES: Shade[] = [
  { id: 'teal', name: 'Teal', hex: '#3fa7a0', lightness: 45 },
  { id: 'dawn', name: 'Dawn', hex: '#e8a87c', lightness: 70 },
  { id: 'dusk', name: 'Dusk', hex: '#8f6bd1', lightness: 62 },
  { id: 'moss', name: 'Moss', hex: '#5f7356', lightness: 39 },
  { id: 'sand', name: 'Sand', hex: '#d8c49a', lightness: 73 },
];

/** The eye icons of the list's visibility toggle: the kit's built-in icons register only in the
 * debug env, so an app brings its own */
const EYE_ICON =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z"/><circle cx="8" cy="8" r="2"/></svg>';
const EYE_OFF_ICON =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z"/><path d="m2.5 2.5 11 11"/></svg>';

/** How often the frame time is shown, in seconds */
const FRAME_PERIOD = 0.25;

/**
 * The data window's tabs, bound to the box: the shades' table sets its colour, the objects' list
 * hides and shows the box and the light, and the Frame tab shows the frame time while it's in the
 * page (a looper of the scene, removed with it).
 * @param sceneId the scene the looper runs in
 * @param boxId the box's entity id
 * @param materialId its material's id
 */
export const createDataTabs = (sceneId: string, boxId: number, materialId: string) => {
  const material = getMaterial(materialId);
  const standard = material instanceof THREE.MeshStandardMaterial ? material : null;
  const world = getECSWorld();

  const shadeTable = createTable<Shade>({
    caption: 'Shades',
    captionHidden: true,
    columns: [
      { key: 'name', label: 'Shade', rowHeader: true, sortable: true },
      { key: 'hex', label: 'Colour' },
      { key: 'lightness', label: 'Lightness', sortable: true, format: (value) => `${value} %` },
    ],
    rows: SHADES,
    selection: 'single',
    // The box's colour now, if it's one of these (the dialog's form may have set another)
    selected: SHADES.filter((shade) => standard?.color.getHexString() === shade.hex.slice(1)).map(
      (shade) => shade.id
    ),
    onSelectionChange: ([id]) => {
      const shade = SHADES.find((s) => s.id === id);
      if (shade) standard?.color.set(shade.hex);
    },
    striped: true,
    highlight: 'row',
  });

  const objects: SceneObject[] = [
    { id: 'box', title: 'Box', kind: 'Mesh' },
    { id: 'light', title: 'Light', kind: 'Directional light', appId: 'uiKitEmbedLight' },
  ];
  const getEntityId = (object: SceneObject) =>
    object.appId ? getEntityIdByAppId(object.appId) ?? -1 : boxId;
  const objectList = createList<SceneObject>({
    items: objects,
    label: 'Objects',
    title: (object) => object.title,
    description: (object) => object.kind,
    actions: [
      {
        key: 'visible',
        label: 'Visible',
        icon: EYE_ICON,
        iconOff: EYE_OFF_ICON,
        pressed: (object) => !world.isDisabled(getEntityId(object)),
        onPress: (object) => {
          const id = getEntityId(object);
          world.setDisabled(id, !world.isDisabled(id));
        },
      },
    ],
  });

  const tabs = createTabs({
    label: 'Data',
    tabs: [
      { key: 'shades', label: 'Shades', content: shadeTable.cmp },
      { key: 'objects', label: 'Objects', content: objectList.cmp },
      // Built on its first show: its looper runs only from then on
      { key: 'frame', label: 'Frame', content: () => createFramePanel(sceneId) },
    ],
  });
  return tabs;
};

/** The Frame tab: the frame time, averaged over a period, as a figure and a sparkline */
const createFramePanel = (sceneId: string) => {
  const sparkline = createSparkline({ capacity: 40, min: 0, area: true });
  const tile = createStatTile({
    label: 'Frame time',
    unit: 'ms',
    format: (ms) => ms.toFixed(1),
    goodDirection: 'down',
    sparkline,
  });
  // Summed over a period, then shown: nothing allocated per frame
  let elapsed = 0;
  let frames = 0;
  let last = 0;
  const looper = createSceneAppLooper((delta) => {
    elapsed += delta;
    frames++;
    if (elapsed < FRAME_PERIOD) return;
    const frameTime = (elapsed * 1000) / frames;
    tile.setValue(frameTime);
    // The change against the period before, in %
    tile.setDelta(last ? ((frameTime - last) / last) * 100 : null);
    sparkline.push(frameTime);
    last = frameTime;
    elapsed = 0;
    frames = 0;
  }, sceneId);
  const panel = CMP({
    class: 'uiKitEmbedFrame',
    onRemoveCmp: () => deleteSceneAppLooper(looper, sceneId),
  });
  panel.add(tile.cmp);
  return panel;
};
