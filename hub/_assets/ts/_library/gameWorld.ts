/**
 * The component library's game world pieces (the Hub's `features/ui-kit/game/` page, p808): the
 * world anchor layer, the compass and the minimap frame. No engine runs here, so the anchors'
 * camera is a matrix built by hand (in an app the toolkit's `registerWorldAnchorSync` gives the
 * active camera's), and the minimap's map is a picture where a viewport would render.
 */
import { CMP, createCompass, createMinimapFrame, createWorldAnchorLayer } from 'aekasha/ui';
import type { WorldAnchor, WorldAnchorView } from 'aekasha/ui';
import { ID_PREFIX, addButton, addGroup, addKitRoot } from './page';
import type { Demo } from './page';
import { createStatusLine } from './game';

const DEG = Math.PI / 180;

// --- World anchors ---

const ANCHORS_ID = (name: string) => `${ID_PREFIX}Anchors${name}`;

/** The demo's camera: where it stands and its heading (clockwise from north, -z; east is +x) */
type DemoCamera = { x: number; z: number; heading: number };

const FOV = 60 * DEG;
const NEAR = 0.1;
const FAR = 200;
const EYE_HEIGHT = 1.6;

/**
 * Writes a level camera's `projection × view` into `out` in three's column-major order (a
 * `Matrix4`'s `elements`), as the toolkit's sync writes the active camera's
 */
const writeViewProjection = (out: number[], camera: DemoCamera, aspect: number) => {
  const sin = Math.sin(camera.heading);
  const cos = Math.cos(camera.heading);
  // Forward (sin, 0, -cos), right (cos, 0, sin), up (0, 1, 0); the view's rows are right, up
  // and -forward, each with its translation
  const p = [camera.x, EYE_HEIGHT, camera.z];
  const view = [
    [cos, 0, sin, -(cos * p[0] + sin * p[2])],
    [0, 1, 0, -p[1]],
    [-sin, 0, cos, sin * p[0] - cos * p[2]],
    [0, 0, 0, 1],
  ];
  const f = 1 / Math.tan(FOV / 2);
  const projection = [
    [f / aspect, 0, 0, 0],
    [0, f, 0, 0],
    [0, 0, (FAR + NEAR) / (NEAR - FAR), (2 * FAR * NEAR) / (NEAR - FAR)],
    [0, 0, -1, 0],
  ];
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += projection[row][k] * view[k][col];
      out[col * 4 + row] = sum;
    }
  }
};

/** A nameplate: a name over the point */
const createNameplate = (name: string) =>
  CMP({ tag: 'span', class: 'hubDemoNameplate', text: name });

/**
 * In the page: an inline anchor layer over a stage, three nameplates, a crate's label and a
 * waypoint kept at the edge with an arrow when it's off screen; the Hub buttons move the camera
 * and the layer's `update` places them.
 */
const initWorldAnchorsDemo: Demo = (box) => {
  const root = addKitRoot(box);
  const stage = document.createElement('div');
  stage.id = ANCHORS_ID('Stage');
  stage.className = 'hubDemoStage hubDemoWorldStage';
  const layer = createWorldAnchorLayer({ placement: 'inline', cullDistance: 60, depthSort: true });
  stage.append(layer.cmp.elem);
  const group = addGroup(root, 'Nameplates over their points, a waypoint kept at the edge');
  group.append(stage);
  const status = createStatusLine(ANCHORS_ID('Status'));
  root.append(status);

  const add = (name: string, x: number, y: number, z: number, maxDistance = 30) =>
    layer.addAnchor({
      content: createNameplate(name),
      position: { x, y, z },
      align: 'above',
      maxDistance,
    });
  add('Mara', -2, 1.9, -8);
  add('Ivo', 3, 1.9, -13);
  add('Pell', -6, 1.9, -20);
  add('Crate', 1, 0.8, -5, 12);
  const waypointText = CMP({ tag: 'span', class: 'hubDemoWaypoint', text: 'Beacon' });
  const waypoint: WorldAnchor = layer.addAnchor({
    content: waypointText,
    position: { x: -24, y: 3, z: 18 },
    align: 'above',
    offScreen: 'clamp',
    maxDistance: 1000,
  });

  const camera: DemoCamera = { x: 0, z: 0, heading: 0 };
  const matrix = new Array<number>(16).fill(0);
  const view: WorldAnchorView = {
    viewProjection: matrix,
    width: 0,
    height: 0,
    cameraPosition: { x: 0, y: EYE_HEIGHT, z: 0 },
  };
  const update = () => {
    view.width = stage.clientWidth;
    view.height = stage.clientHeight;
    if (!view.width || !view.height) return;
    writeViewProjection(matrix, camera, view.width / view.height);
    view.cameraPosition.x = camera.x;
    view.cameraPosition.z = camera.z;
    layer.update(view);
    const metres = Math.round(waypoint.getDistance());
    waypointText.updateText(`Beacon ${metres} m`);
    status.textContent = `Facing ${Math.round(camera.heading / DEG)}°, the waypoint ${waypoint.getState()}`;
  };
  new ResizeObserver(update).observe(stage);
  update();
  const moves = addGroup(root, 'The camera (an app’s: the sync reads it after each render)');
  const set = (label: string, next: DemoCamera) =>
    addButton(moves, label, () => {
      Object.assign(camera, next);
      update();
    });
  set('Turn right 40°', { x: 0, z: 0, heading: 40 * DEG });
  set('Turn to the beacon', { x: 0, z: 0, heading: -126 * DEG });
  set('Walk 6 m north', { x: 0, z: -6, heading: 0 });
};

// --- Compass ---

const COMPASS_ID = (name: string) => `${ID_PREFIX}Compass${name}`;

/** In the page: an inline compass with a waypoint and an NPC marker; the Hub buttons turn it */
const initCompassDemo: Demo = (box) => {
  const root = addKitRoot(box);
  const compass = createCompass({
    id: COMPASS_ID('Strip'),
    placement: 'inline',
    heading: 0,
    markers: {
      beacon: { bearing: 300 * DEG, label: 'Beacon', color: '#d9c27a' },
      mara: { bearing: 20 * DEG },
      camp: { bearing: 170 * DEG, label: 'Camp', offScreen: 'hide' },
    },
  });
  const group = addGroup(root, 'The bearings and the markers in view; one out of view at an end');
  group.classList.add('hubDemoCompass');
  group.append(compass.cmp.elem);
  const turns = addGroup(root, 'The heading (an app gives it the camera’s yaw)');
  addButton(turns, 'Face east', () => compass.setHeading(90 * DEG));
  addButton(turns, 'Face the beacon', () => compass.setHeading(300 * DEG));
  addButton(turns, 'Face south (the camp)', () => compass.setHeading(180 * DEG));
  addButton(turns, 'Remove the beacon marker', () => compass.removeMarker('beacon'));
};

// --- Minimap frame ---

const MINIMAP_ID = (name: string) => `${ID_PREFIX}Minimap${name}`;

const ZOOMS = [0.6, 1, 1.6];

/**
 * In the page: the frame over a map picture in a square slot (an app appends it into a
 * viewport's `slotElem`, which renders the map there); its zoom buttons scale the picture, as an
 * app's would its viewport's camera.
 */
const initMinimapFrameDemo: Demo = (box) => {
  const root = addKitRoot(box);
  const status = createStatusLine(MINIMAP_ID('Status'));
  const slot = document.createElement('div');
  slot.id = MINIMAP_ID('Slot');
  slot.className = 'hubDemoMinimap';
  let zoom = 1;
  const frame = createMinimapFrame({
    label: 'Map',
    playerHeading: 30 * DEG,
    onZoom: (direction) => {
      zoom = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + direction))];
      slot.style.setProperty('--hub-demo-map-zoom', String(zoom));
      frame.setZoomEnabled({ zoomIn: zoom < ZOOMS[ZOOMS.length - 1], zoomOut: zoom > ZOOMS[0] });
      status.textContent = `Zoom ${zoom}`;
    },
  });
  slot.append(frame.cmp.elem);
  const group = addGroup(root, 'North up: the player’s arrow turns, the north mark stays');
  group.append(slot);
  root.append(status);
  const turns = addGroup(root, 'From code');
  addButton(turns, 'The player faces east', () => frame.setPlayerHeading(90 * DEG));
  addButton(turns, 'The map turns with the player', () => {
    frame.setPlayerHeading(90 * DEG);
    frame.setMapHeading(90 * DEG);
    slot.style.setProperty('--hub-demo-map-turn', '-90deg');
  });
};

/** The game world group's demos by their box's key (`data-hub-demo`) */
export const GAME_WORLD_DEMOS: Record<string, Demo> = {
  worldAnchors: initWorldAnchorsDemo,
  compass: initCompassDemo,
  minimapFrame: initMinimapFrameDemo,
};
