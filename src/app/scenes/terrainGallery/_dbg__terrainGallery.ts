import * as THREE from 'three/webgpu';
import { float, floor, mix, mod, positionWorld, vec3 } from 'three/tsl';
import {
  createMeshEntity,
  getGeometry,
  getMaterial,
  getMaterialVariant,
  getMeshByAppId,
  lerror,
  saveMaterial,
  setMeshMaterial,
} from 'aekasha';
import {
  createDebuggerTab,
  debuggerListCMP,
  updateDebuggerTab,
  type DebuggerTabSection,
} from 'aekasha/debug';
import { getTextureSet, loadTextureSetAsync, type TextureSetPacking } from 'aekasha/texturesets';
import { createTerrainMaterial } from 'aekasha/toolkit/terrain';
import { flyToGalleryBlock, stopGalleryFlight } from './_dbg__terrainGalleryCamera';
import {
  clearGeneratorSelection,
  getProceduralSections,
  refreshProceduralFigures,
  startProceduralTab,
  type ProceduralSectionsOpts,
} from './_dbg__terrainGalleryProcedural';
import { BASELINE_MATERIAL_ID, GALLERY_MATERIAL_ID, getSurfaceOverrides } from './galleryBlocks';
import {
  getProceduralBakeSettings,
  PROCEDURAL_BLOCKS,
  setProceduralBakeAsync,
} from './proceduralRow';
import {
  addGalleryExitCleanup,
  ALL_PACKING_SETS,
  GALLERY_BLOCKS,
  getBlockAppId,
  getWallAppId,
  TERRAIN_GALLERY_SCENE_ID,
  type GalleryBlock,
} from './terrainGallery';

const TAB_ID = 'terrainGallery';
const PACKINGS: readonly TextureSetPacking[] = ['LITE', 'FULL', 'MINIMAL'];
const CHECKER_MATERIAL_ID = 'terrainGalleryChecker';
const CHECKER_OPACITY = 0.25;

/**
 * The library's material: the terrain material through its JSON route (the scene's `terrain`
 * variants), through its code route (`createTerrainMaterial`, a material per block) or the
 * baseline `textureSetSurface` it's compared against (p305 Phase 1's exit: the three look the same)
 */
type GalleryMaterial = 'TERRAIN' | 'TERRAIN_CODE' | 'BASELINE';
const MATERIALS: readonly { label: string; value: GalleryMaterial }[] = [
  { label: 'Terrain', value: 'TERRAIN' },
  { label: 'Terrain (code)', value: 'TERRAIN_CODE' },
  { label: 'Baseline', value: 'BASELINE' },
];

/** The tab's saved settings */
type GalleryTabState = { packing: TextureSetPacking; checker: boolean; material: GalleryMaterial };
const DEFAULT_STATE: GalleryTabState = { packing: 'LITE', checker: false, material: 'TERRAIN' };
const state: GalleryTabState = { ...DEFAULT_STATE };

/** This visit's: false once the scene is left, so an await that ends later does nothing */
let visit = { isCurrent: false };
/** The packing the blocks show (`state.packing` is the one asked for) */
let shownPacking: TextureSetPacking = 'LITE';
/** The block the camera flew to last: the list's selection */
let selectedSetId: string | null = null;
/** The latest packing apply: an older one that finishes later is dropped */
let packingRequest = 0;

/** Every block the checker covers: the library's and the Procedural row's (its key names its
 * checker's mesh) */
const CHECKER_BLOCKS = [
  ...GALLERY_BLOCKS.map(({ setId, x, z, geometryId }) => ({ key: setId, x, z, geometryId })),
  ...PROCEDURAL_BLOCKS.map(({ generator, x, z, geometryId }) => ({
    key: `proc_${generator.id}`,
    x,
    z,
    geometryId,
  })),
];

const getBlock = (setId: string) => GALLERY_BLOCKS.find((block) => block.setId === setId);

/** The packing a library block shows: the tab's for the sets that ship every packing */
const getBlockPacking = (setId: string): TextureSetPacking | undefined =>
  ALL_PACKING_SETS.includes(setId) ? shownPacking : getTextureSet(setId)?.defaultPacking;

/**
 * A block's material in the material mode: a variant of the scene's `terrain` or
 * `textureSetSurface`, or the code route's own (`createTerrainMaterial`, made once per set, packing
 * and wall, the scene's)
 */
const getBlockMaterial = (
  setId: string,
  packing: TextureSetPacking | undefined,
  isWall: boolean,
  material: GalleryMaterial
) => {
  // The set's default packing is the variant the scene's load made (no packing key)
  const isDefault = !packing || getTextureSet(setId)?.defaultPacking === packing;
  if (material === 'TERRAIN_CODE') {
    return createTerrainMaterial({
      id: `terrainGalleryCode_${setId}_${packing ?? 'default'}${isWall ? '_wall' : ''}`,
      layers: [{ set: setId }],
      ...(isDefault ? {} : { packing }),
      ...(isWall ? { uv: 'MESH_UV' as const } : {}),
    });
  }
  const isBaseline = material === 'BASELINE';
  const overrides = getSurfaceOverrides(setId, {
    packing: isDefault ? undefined : packing,
    isWall,
    isBaseline,
  });
  return getMaterialVariant(isBaseline ? BASELINE_MATERIAL_ID : GALLERY_MATERIAL_ID, overrides);
};

/** A mesh entity's material swapped to its set's, when the mesh exists */
const swapSurface = (appId: string, setId: string, isWall: boolean) => {
  const mesh = getMeshByAppId(appId);
  if (!mesh) return;
  setMeshMaterial(mesh, getBlockMaterial(setId, getBlockPacking(setId), isWall, state.material));
};

/** Every library block (and wall) in the material mode */
const applyMaterial = () => {
  for (const block of GALLERY_BLOCKS) {
    swapSurface(getBlockAppId(block.setId), block.setId, false);
    if (block.hasWall) swapSurface(getWallAppId(block.setId), block.setId, true);
  }
};

/**
 * Shows the packing on the sets that ship every packing (`ALL_PACKING_SETS`): loads its textures
 * (the scene's from then on, released on its exit), then swaps the blocks' and the wall's
 * variants. The Procedural row's bakes are baked again in it. The latest call wins: an older one
 * that finishes later does nothing, as does one that finishes after the scene was left.
 */
const applyPackingAsync = async (packing: TextureSetPacking) => {
  const request = ++packingRequest;
  const startedOn = visit;
  if (getProceduralBakeSettings().packing !== packing) void setProceduralBakeAsync({ packing });
  try {
    await Promise.all(ALL_PACKING_SETS.map((setId) => loadTextureSetAsync(setId, { packing })));
  } catch (error) {
    lerror(`[terrainGallery] The ${packing} packing didn't load:`, error);
    return;
  }
  if (!startedOn.isCurrent || request !== packingRequest) return;
  shownPacking = packing;
  for (const setId of ALL_PACKING_SETS) {
    swapSurface(getBlockAppId(setId), setId, false);
    if (getBlock(setId)?.hasWall) swapSurface(getWallAppId(setId), setId, true);
  }
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

const getCheckerAppId = (key: string) => `terrainGallery_${key}_checker`;

/**
 * Shows or hides the 1 m checker over every block (not the walls: a world XZ checker on a vertical
 * face is stripes), made the first time it's shown on a visit
 */
const setChecker = (isShown: boolean) => {
  for (const block of CHECKER_BLOCKS) {
    const existing = getMeshByAppId(getCheckerAppId(block.key));
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
        appId: getCheckerAppId(block.key),
        debugData: { name: `1 m checker: ${block.key}` },
      }
    );
  }
};

/** Everything the gallery draws but the Procedural row's blocks: what a measurement hides */
const getOtherAppIds = () => [
  'terrainGallery_ground',
  ...GALLERY_BLOCKS.flatMap(({ setId }) => [getBlockAppId(setId), getWallAppId(setId)]),
  ...CHECKER_BLOCKS.map(({ key }) => getCheckerAppId(key)),
];

/** Flies the scene's camera to a library block and selects it in its list */
const flyToBlock = (block: GalleryBlock) => {
  selectedSetId = block.setId;
  clearGeneratorSelection();
  flyToGalleryBlock(block);
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

/** What the Procedural row's sections need of this tab */
const proceduralOpts: ProceduralSectionsOpts = {
  tabId: TAB_ID,
  onSelect: () => {
    selectedSetId = null;
  },
  getOtherAppIds,
};

/**
 * The gallery's scene tab (p303 D8): the sets, a click flying the scene's camera to the block; the
 * packing of the three sets that ship every packing (and of the Procedural row's bakes); the 1 m
 * checker; and the Procedural row's sections (p304 Phase 6, `_dbg__terrainGalleryProcedural.ts`).
 * The packing and the checker are saved and applied when the tab is made (the scene's load, once
 * its blocks exist).
 */
export const createTerrainGalleryTab = () => {
  const thisVisit = { isCurrent: true };
  visit = thisVisit;
  shownPacking = 'LITE';
  selectedSetId = null;
  stopGalleryFlight(true);
  const endProceduralTab = startProceduralTab(proceduralOpts);
  addGalleryExitCleanup(() => {
    thisVisit.isCurrent = false;
    stopGalleryFlight(true);
    endProceduralTab();
  });

  createDebuggerTab({
    id: TAB_ID,
    title: 'Terrain gallery',
    icon: 'texture',
    sceneId: TERRAIN_GALLERY_SCENE_ID,
    state,
    lsKey: 'AEK_debugTerrainGallery',
    persistKeys: ['packing', 'checker', 'material'],
    refreshIntervalMs: 500,
    onRefresh: refreshProceduralFigures,
    onClearLS: () => {
      Object.assign(state, DEFAULT_STATE);
      setChecker(false);
      applyMaterial();
      void applyPackingAsync(state.packing);
    },
    content: () => [
      {
        pane: true,
        content: [
          {
            key: 'material',
            label: 'Material',
            kind: 'segmented',
            options: MATERIALS.map((option) => ({ ...option })),
            hint: 'The library’s blocks: the terrain material (its JSON route, or createTerrainMaterial) or the baseline textureSetSurface, which should look the same',
            onChange: () => applyMaterial(),
          },
          {
            key: 'packing',
            label: 'Packing',
            kind: 'segmented',
            options: PACKINGS.map((packing) => ({ label: packing, value: packing })),
            hint: `${ALL_PACKING_SETS.join(', ')} (the sets that ship every packing) and the Procedural row's bakes`,
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
            updateDebuggerTab(TAB_ID, { rebuild: true });
          },
        },
        selectedItemId: () => selectedSetId,
        data: () => GALLERY_BLOCKS.map(getBlockRow),
      }),
      // Its fields bind their own targets, none of this tab's state keys
      ...(getProceduralSections(proceduralOpts) as DebuggerTabSection<GalleryTabState>[]),
    ],
  });

  if (state.checker) setChecker(true);
  if (state.material !== 'TERRAIN') applyMaterial();
  if (state.packing !== 'LITE') void applyPackingAsync(state.packing);
};
