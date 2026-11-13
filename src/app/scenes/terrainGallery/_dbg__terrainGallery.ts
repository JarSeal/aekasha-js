import * as THREE from 'three/webgpu';
import { float, floor, mix, mod, positionWorld, vec3 } from 'three/tsl';
import {
  cameraLookAtPoint,
  createMeshEntity,
  createSceneMainLooper,
  deleteSceneMainLooper,
  getECSWorld,
  getEntityIdByAppId,
  getGeometry,
  getMaterial,
  getMaterialVariant,
  getMeshByAppId,
  lerror,
  registerOnSceneExit,
  saveMaterial,
  setMeshMaterial,
} from 'aekasha';
import { createDebuggerTab, debuggerListCMP, updateDebuggerTab } from 'aekasha/debug';
import { getTextureSet, loadTextureSetAsync, type TextureSetPacking } from 'aekasha/texturesets';
import {
  ALL_PACKING_SETS,
  GALLERY_BLOCK_SIZE,
  GALLERY_BLOCKS,
  GALLERY_MATERIAL_ID,
  getBlockAppId,
  getSurfaceOverrides,
  getWallAppId,
  TERRAIN_GALLERY_CAMERA_APP_ID,
  TERRAIN_GALLERY_SCENE_ID,
  type GalleryBlock,
} from './terrainGallery';

const TAB_ID = 'terrainGallery';
const PACKINGS: readonly TextureSetPacking[] = ['LITE', 'FULL', 'MINIMAL'];
/** The camera's flight to a block, seconds */
const FLIGHT_SEC = 0.8;
/** Where the camera stops: in front of the block (+z) and above it, looking at its ramp side */
const VIEW_OFFSET = { y: GALLERY_BLOCK_SIZE * 0.6, z: GALLERY_BLOCK_SIZE * 1.05 };
const LOOK_OFFSET = { y: 0.5, z: -GALLERY_BLOCK_SIZE * 0.1 };
const CHECKER_MATERIAL_ID = 'terrainGalleryChecker';
const CHECKER_OPACITY = 0.25;

/** The tab's saved settings */
type GalleryTabState = { packing: TextureSetPacking; checker: boolean };
const DEFAULT_STATE: GalleryTabState = { packing: 'LITE', checker: false };
const state: GalleryTabState = { ...DEFAULT_STATE };

/** This visit's: false once the scene is left, so an await that ends later does nothing */
let visit = { isCurrent: false };
/** The packing the blocks show (`state.packing` is the one asked for) */
let shownPacking: TextureSetPacking = 'LITE';
/** The block the camera flew to last: the list's selection */
let selectedSetId: string | null = null;
/** The latest packing apply: an older one that finishes later is dropped */
let packingRequest = 0;
/** The running flight's looper, deleted when it lands or another starts */
let flightLooper: number | null = null;

const getBlock = (setId: string) => GALLERY_BLOCKS.find((block) => block.setId === setId);

/** A mesh entity's material swapped to its set's variant, when the mesh exists */
const swapSurface = (appId: string, setId: string, packing: TextureSetPacking, isWall: boolean) => {
  const mesh = getMeshByAppId(appId);
  if (!mesh) return;
  // The set's default packing is the variant the scene's load made (no packing key)
  const isDefault = getTextureSet(setId)?.defaultPacking === packing;
  const overrides = getSurfaceOverrides(setId, {
    packing: isDefault ? undefined : packing,
    isWall,
  });
  setMeshMaterial(mesh, getMaterialVariant(GALLERY_MATERIAL_ID, overrides));
};

/**
 * Shows the packing on the sets that ship every packing (`ALL_PACKING_SETS`): loads its textures
 * (the scene's from then on, released on its exit), then swaps the blocks' and the wall's
 * variants. The latest call wins: an older one that finishes later does nothing, as does one that
 * finishes after the scene was left.
 */
const applyPackingAsync = async (packing: TextureSetPacking) => {
  const request = ++packingRequest;
  const startedOn = visit;
  try {
    await Promise.all(ALL_PACKING_SETS.map((setId) => loadTextureSetAsync(setId, { packing })));
  } catch (error) {
    lerror(`[terrainGallery] The ${packing} packing didn't load:`, error);
    return;
  }
  if (!startedOn.isCurrent || request !== packingRequest) return;
  for (const setId of ALL_PACKING_SETS) {
    swapSurface(getBlockAppId(setId), setId, packing, false);
    if (getBlock(setId)?.hasWall) swapSurface(getWallAppId(setId), setId, packing, true);
  }
  shownPacking = packing;
  updateDebuggerTab(TAB_ID);
};

/**
 * The checker's material: 1 m cells of the world's x and z (the plan's metres, which the blocks'
 * world tiling measures `physicalSize` in), translucent over the block, drawn just in front of it
 */
const getCheckerMaterial = () => {
  const registered = getMaterial(CHECKER_MATERIAL_ID);
  if (registered) return registered;
  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const parity = mod(floor(positionWorld.x).add(floor(positionWorld.z)), 2);
  material.colorNode = mix(vec3(0.05), vec3(1), parity);
  material.opacityNode = float(CHECKER_OPACITY);
  // The scene's from here: released with it
  return saveMaterial(material, CHECKER_MATERIAL_ID) as THREE.Material;
};

const getCheckerAppId = (setId: string) => `${getBlockAppId(setId)}_checker`;

/**
 * Shows or hides the 1 m checker over every block (not the walls: a world XZ checker on a vertical
 * face is stripes), made the first time it's shown on a visit
 */
const setChecker = (isShown: boolean) => {
  for (const block of GALLERY_BLOCKS) {
    const existing = getMeshByAppId(getCheckerAppId(block.setId));
    if (existing) {
      existing.visible = isShown;
      continue;
    }
    const geo = getGeometry(block.geometryId);
    if (!isShown || !geo) continue;
    createMeshEntity(
      {
        geo,
        mat: getCheckerMaterial(),
        position: { x: block.x, z: block.z },
        castShadow: false,
        receiveShadow: false,
      },
      {
        appId: getCheckerAppId(block.setId),
        debugData: { name: `1 m checker: ${block.setId}` },
      }
    );
  }
};

/** Smoothstep's ease in and out */
const ease = (t: number) => t * t * (3 - 2 * t);

/**
 * Flies the scene's camera to a block over `FLIGHT_SEC`: its position and its look-at point eased
 * from where they are. A flight started meanwhile replaces it. In the debug camera (F1) the
 * scene's camera moves, not the view.
 */
const flyToBlock = (block: GalleryBlock) => {
  selectedSetId = block.setId;
  const world = getECSWorld();
  const cameraId = getEntityIdByAppId(TERRAIN_GALLERY_CAMERA_APP_ID, world);
  if (cameraId === undefined) return;
  const transform = world.getTransform(cameraId);
  const fromPos = transform.position.clone();
  // The current look-at point, as far ahead as the target is
  const toPos = new THREE.Vector3(block.x, VIEW_OFFSET.y, block.z + VIEW_OFFSET.z);
  const toLook = new THREE.Vector3(block.x, LOOK_OFFSET.y, block.z + LOOK_OFFSET.z);
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(transform.rotation);
  const fromLook = fromPos.clone().addScaledVector(forward, fromPos.distanceTo(toLook));
  const pos = new THREE.Vector3();
  const look = new THREE.Vector3();
  let elapsed = 0;

  if (flightLooper !== null) deleteSceneMainLooper(flightLooper, TERRAIN_GALLERY_SCENE_ID);
  const looper = createSceneMainLooper((delta) => {
    elapsed = Math.min(FLIGHT_SEC, elapsed + delta);
    const t = ease(elapsed / FLIGHT_SEC);
    pos.lerpVectors(fromPos, toPos, t);
    look.lerpVectors(fromLook, toLook, t);
    world.setTransform(cameraId, { pos });
    cameraLookAtPoint(cameraId, look, world);
    if (elapsed < FLIGHT_SEC || flightLooper !== looper) return;
    deleteSceneMainLooper(looper, TERRAIN_GALLERY_SCENE_ID);
    flightLooper = null;
  }, TERRAIN_GALLERY_SCENE_ID);
  flightLooper = looper < 0 ? null : looper;
};

const getBlockRow = (block: GalleryBlock) => {
  const set = getTextureSet(block.setId);
  const size = set?.physicalSize ?? [0, 0];
  const isSwitched = ALL_PACKING_SETS.includes(block.setId);
  return {
    itemId: block.setId,
    title: block.setId,
    subTitle: set
      ? `${set.category.toLowerCase()}, ${size[0]} × ${size[1]} m a tile`
      : 'not loaded',
    suffix: isSwitched ? shownPacking : set?.defaultPacking ?? '',
    description: set?.debugData?.name,
  };
};

/**
 * The gallery's scene tab (p303 D8): the sets, a click flying the scene's camera to the block; the
 * packing of the three sets that ship every packing; the 1 m checker. The packing and the checker
 * are saved and applied when the tab is made (the scene's load, once its blocks exist).
 */
export const createTerrainGalleryTab = () => {
  const thisVisit = { isCurrent: true };
  visit = thisVisit;
  shownPacking = 'LITE';
  selectedSetId = null;
  flightLooper = null;
  registerOnSceneExit(TERRAIN_GALLERY_SCENE_ID, () => {
    thisVisit.isCurrent = false;
    flightLooper = null;
  });

  createDebuggerTab({
    id: TAB_ID,
    title: 'Terrain gallery',
    icon: 'texture',
    sceneId: TERRAIN_GALLERY_SCENE_ID,
    state,
    lsKey: 'AEK_debugTerrainGallery',
    persistKeys: ['packing', 'checker'],
    onClearLS: () => {
      Object.assign(state, DEFAULT_STATE);
      setChecker(false);
      void applyPackingAsync(state.packing);
    },
    content: () => [
      {
        pane: true,
        content: [
          {
            key: 'packing',
            label: 'Packing',
            kind: 'segmented',
            options: PACKINGS.map((packing) => ({ label: packing, value: packing })),
            hint: `${ALL_PACKING_SETS.join(', ')}: the sets that ship every packing`,
            onChange: (value) => void applyPackingAsync(value as TextureSetPacking),
          },
          {
            key: 'checker',
            label: '1 m checker',
            kind: 'switch',
            hint: 'World 1 m cells over the blocks, against each set’s physicalSize',
            onChange: (value) => setChecker(Boolean(value)),
          },
        ],
      },
      debuggerListCMP({
        id: 'terrainGallerySets',
        heading: 'Texture sets',
        perItemConfig: {
          onClick: (setId) => {
            const block = getBlock(setId);
            if (block) flyToBlock(block);
            updateDebuggerTab(TAB_ID);
          },
        },
        selectedItemId: () => selectedSetId,
        data: () => GALLERY_BLOCKS.map(getBlockRow),
      }),
    ],
  });

  if (state.checker) setChecker(true);
  if (state.packing !== 'LITE') void applyPackingAsync(state.packing);
};
