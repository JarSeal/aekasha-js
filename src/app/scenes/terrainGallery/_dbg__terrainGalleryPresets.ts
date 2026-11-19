// The terrain gallery tab's camera presets (p310 §2.2): a camera per game type, posed relative to
// the selected block (the presets' Block select, or the last block or row a list flew to) at its
// FOV, with a line on why it matters. The flight preset loops a flyover along the block's column
// until another flight. They move the scene's camera; movement is the debug camera's (F1). The
// measurement holds one at once (`holdGalleryPreset`: the matrix's figures, from each game type's
// camera; the flight preset's flyover as the pose looking at the block).
import * as THREE from 'three/webgpu';
import { getRootScene } from 'aekasha';
import { updateDebuggerTab, type DebuggerTabSection } from 'aekasha/debug';
import {
  flyGalleryCamera,
  GALLERY_DEFAULT_FOV,
  FLYOVER_LOOK_AHEAD,
  holdGalleryCameraPose,
  startGalleryFlyover,
  type GalleryCameraPose,
  type GalleryFlyover,
} from './_dbg__terrainGalleryCamera';
import { GALLERY_ROWS, type GalleryRowBlock } from './_dbg__terrainGalleryRows';

/** Where a preset puts the camera: a pose, or the flight preset's flyover */
type GalleryPresetView = { pose: GalleryCameraPose } | { flyover: GalleryFlyover };

/** A preset: its label, FOV, why it matters, and its pose or flyover from the block */
type GalleryPreset = {
  id: GalleryPresetId;
  label: string;
  fov: number;
  why: string;
  getView: (block: GalleryRowBlock) => GalleryPresetView;
};

/** The presets' ids (§2.2's game types) */
export type GalleryPresetId =
  | 'firstPerson'
  | 'thirdPerson'
  | 'topDown'
  | 'isometric'
  | 'sideView'
  | 'flight';

const DEG = Math.PI / 180;
/** Above every block, for the ground ray, metres */
const RAY_TOP = 500;
/** The flyover's run past the block either way, metres, and its speed and height */
const FLYOVER = { run: 300, speed: 60, height: 15 };
/** The scene camera's own pose (`terrainGalleryCamera.camera.json`) */
const OVERVIEW_POSE: GalleryCameraPose = {
  pos: { x: 18, y: 50, z: 82 },
  look: { x: 18, y: 0, z: 4 },
};

const raycaster = new THREE.Raycaster();
const rayOrigin = new THREE.Vector3();
const rayDown = new THREE.Vector3(0, -1, 0);

/**
 * The height of the highest visible mesh under a point (the block's surface, a wall, the ground),
 * or `fallback` when nothing is there
 */
const getGroundY = (x: number, z: number, fallback: number) => {
  rayOrigin.set(x, RAY_TOP, z);
  raycaster.set(rayOrigin, rayDown);
  const root = getRootScene();
  if (!root) return fallback;
  const hit = raycaster
    .intersectObjects(root.children, true)
    .find(({ object }) => (object as THREE.Mesh).isMesh && object.visible);
  return hit ? hit.point.y : fallback;
};

/** A pose `distance` from `look`, pitched down `pitch` degrees, turned `yaw` degrees from +z to
 * +x */
const orbit = (
  look: { x: number; y: number; z: number },
  distance: number,
  pitch: number,
  yaw = 0
) => {
  const flat = distance * Math.cos(pitch * DEG);
  return {
    x: look.x + flat * Math.sin(yaw * DEG),
    y: look.y + distance * Math.sin(pitch * DEG),
    z: look.z + flat * Math.cos(yaw * DEG),
  };
};

const PRESETS: readonly GalleryPreset[] = [
  {
    id: 'firstPerson',
    label: 'First person',
    fov: 75,
    why: 'Eye 1.7 m above the ground near the block’s front, 10° down: texel density, anti-tiling and HEX matter most',
    getView: (block) => {
      const z = block.z + block.size * 0.35;
      const eye = { x: block.x, y: getGroundY(block.x, z, block.y) + 1.7, z };
      const look = { x: eye.x, y: eye.y - 10 * Math.sin(10 * DEG), z: z - 10 * Math.cos(10 * DEG) };
      return { pose: { pos: eye, look, fov: 75 } };
    },
  },
  {
    id: 'thirdPerson',
    label: 'Third person',
    fov: 60,
    why: '6 m behind and 2.5 m above a player near the front, looking 1 m above its feet: the common open-world view',
    getView: (block) => {
      const z = block.z + block.size * 0.15;
      const ground = getGroundY(block.x, z, block.y);
      return {
        pose: {
          pos: { x: block.x, y: ground + 2.5, z: z + 6 },
          look: { x: block.x, y: ground + 1, z },
          fov: 60,
        },
      };
    },
  },
  {
    id: 'topDown',
    label: 'Top-down',
    fov: 50,
    why: '30 m above the block’s centre at 55° pitch: ARPG and twin-stick',
    getView: (block) => {
      const look = { x: block.x, y: getGroundY(block.x, block.z, block.y), z: block.z };
      const height = 30;
      return {
        pose: {
          pos: { x: look.x, y: look.y + height, z: look.z + height / Math.tan(55 * DEG) },
          look,
          fov: 50,
        },
      };
    },
  },
  {
    id: 'isometric',
    label: 'Isometric / RTS',
    fov: 20,
    why: '120 m away at 35° pitch, turned 45°: the colour map, far modes and MINIMAL packing',
    getView: (block) => {
      const look = { x: block.x, y: getGroundY(block.x, block.z, block.y), z: block.z };
      return { pose: { pos: orbit(look, 120, 35, 45), look, fov: 20 } };
    },
  },
  {
    id: 'sideView',
    label: 'Side view',
    fov: 45,
    why: 'Level, 15 m out from the block’s +x edge (the Cliffs row’s steep face): a 2.5D platformer, where vertical faces dominate',
    getView: (block) => {
      const edgeX = block.x + block.size / 2;
      const top = getGroundY(block.x, block.z, block.y);
      const foot = getGroundY(edgeX, block.z, block.y);
      const y = (top + foot) / 2 + 1;
      return {
        pose: {
          pos: { x: edgeX + 15, y, z: block.z },
          look: { x: block.x, y, z: block.z },
          fov: 45,
        },
      };
    },
  },
  {
    id: 'flight',
    label: 'Flight / racing',
    fov: 70,
    why: 'A flyover along the block’s column at 60 m/s, 15 m up, looping: far tiling, distance modes, temporal stability',
    getView: (block) => ({
      flyover: {
        x: block.x,
        y: getGroundY(block.x, block.z, block.y),
        fromZ: block.z + FLYOVER.run,
        toZ: block.z - FLYOVER.run,
        height: FLYOVER.height,
        speed: FLYOVER.speed,
        fov: 70,
      },
    }),
  },
];

/** A preset's label, or null when the id names none */
export const getGalleryPresetLabel = (presetId: GalleryPresetId) =>
  PRESETS.find(({ id }) => id === presetId)?.label ?? null;

/**
 * Puts the scene's camera at a preset over a block at once, for a measurement: the ground under
 * the pose is read from what's visible now. The flight preset holds its flyover's pose looking at
 * the block's centre (`FLYOVER_LOOK_AHEAD` before it, at its height), not the moving flyover:
 * a sample's frames are a different stretch of the loop each time
 * @param presetId which game type's camera
 * @param block the block it poses from
 * @returns a function that puts the camera back, or null without the camera or the preset
 */
export const holdGalleryPreset = (presetId: GalleryPresetId, block: GalleryRowBlock) => {
  const preset = PRESETS.find(({ id }) => id === presetId);
  if (!preset) return null;
  const view = preset.getView(block);
  if ('pose' in view) return holdGalleryCameraPose(view.pose);
  const { x, y, height, fov } = view.flyover;
  return holdGalleryCameraPose({
    pos: { x, y: y + height, z: block.z + FLYOVER_LOOK_AHEAD },
    look: { x, y, z: block.z },
    fov,
  });
};

/** The presets' state: the block they pose from (`<row id>/<block key>`), the last preset's line */
const presetState = { block: 'library/grass01', why: '-' };

const getBlockValue = (rowId: string, key: string) => `${rowId}/${key}`;

/** Every block of every row as the Block select's options */
const getBlockOptions = () =>
  GALLERY_ROWS.flatMap((row) =>
    row.getBlocks().map((block) => ({
      label: `${row.letter} ${row.title}: ${block.label}`,
      value: getBlockValue(row.id, block.key),
    }))
  );

/** The selected block, or the first row's first when the value names none (a removed row) */
/**
 * The presets' selected block and its row's id (the measurement's block too), or the first row's
 * first block when the value names none (a removed row)
 */
export const getPresetSelection = () => {
  for (const row of GALLERY_ROWS) {
    for (const block of row.getBlocks()) {
      if (getBlockValue(row.id, block.key) === presetState.block) return { rowId: row.id, block };
    }
  }
  return { rowId: GALLERY_ROWS[0].id, block: GALLERY_ROWS[0].getBlocks()[0] };
};

const getSelectedBlock = () => getPresetSelection().block;

/**
 * Makes a block the presets' (a list flew to it)
 * @param rowId its row's id (`GALLERY_ROWS`)
 * @param key its key in the row; none: the row's first block
 */
export const setPresetBlock = (rowId: string, key?: string) => {
  const row = GALLERY_ROWS.find(({ id }) => id === rowId);
  const block = key ?? row?.getBlocks()[0]?.key;
  if (!row || block === undefined) return;
  presetState.block = getBlockValue(row.id, block);
};

/** Resets the presets for a visit (the scene's defaults) */
export const startPresetsTab = () => {
  presetState.block = 'library/grass01';
  presetState.why = '-';
};

/**
 * The tab's Camera presets section: the block, a button per preset (§2.2) and the overview, and
 * the last preset's line
 * @param tabId the tab, refreshed when a preset starts
 * @returns the section
 */
export const getPresetSections = (tabId: string): DebuggerTabSection[] => [
  {
    pane: true,
    title: 'Camera presets',
    id: 'terrainGalleryPresets',
    content: [
      {
        key: 'block',
        target: presetState,
        label: 'Block',
        kind: 'select',
        options: getBlockOptions(),
        hint: 'The block the presets pose from; a list’s click selects its block (the Rows list its first). The presets move the scene’s camera: in the debug camera (F1) the view doesn’t follow',
      },
      ...PRESETS.map((preset) => ({
        type: 'button' as const,
        title: `${preset.label} (${preset.fov}°)`,
        onClick: () => {
          presetState.why = preset.why;
          const view = preset.getView(getSelectedBlock());
          if ('pose' in view) flyGalleryCamera(view.pose);
          else startGalleryFlyover(view.flyover);
          updateDebuggerTab(tabId);
        },
      })),
      {
        type: 'button',
        title: `Overview (${GALLERY_DEFAULT_FOV}°)`,
        onClick: () => {
          presetState.why = '-';
          flyGalleryCamera(OVERVIEW_POSE);
          updateDebuggerTab(tabId);
        },
      },
      { key: 'why', target: presetState, label: 'Why', readonly: true },
    ],
  },
];
