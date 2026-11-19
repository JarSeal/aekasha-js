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
import { getTimeOfDay, setTimeOfDay } from 'aekasha/skybox';
import { getTextureSet, loadTextureSetAsync, type TextureSetPacking } from 'aekasha/texturesets';
import {
  createTerrainMaterial,
  getTerrainMaterialVariant,
  loadTerrainDebugViewsAsync,
} from 'aekasha/toolkit/terrain';
import {
  clearAntiTilingSelection,
  getAntiTilingSections,
  startAntiTilingTab,
} from './_dbg__terrainGalleryAntiTiling';
import {
  flyGalleryCamera,
  flyToGalleryBlock,
  stopGalleryFlight,
} from './_dbg__terrainGalleryCamera';
import {
  GALLERY_ROWS,
  getGalleryRow,
  getRowPose,
  hideGallerySignposts,
  setGallerySignposts,
} from './_dbg__terrainGalleryRows';
import { getPresetSections, setPresetBlock, startPresetsTab } from './_dbg__terrainGalleryPresets';
import {
  clearSplattingSelection,
  getSplattingSections,
  startSplattingTab,
} from './_dbg__terrainGallerySplatting';
import { clearRulesSelection, getRulesSections, startRulesTab } from './_dbg__terrainGalleryRules';
import {
  clearCliffsSelection,
  getCliffsSections,
  startCliffsTab,
} from './_dbg__terrainGalleryCliffs';
import {
  clearColorMapSelection,
  getColorMapSections,
  startColorMapTab,
} from './_dbg__terrainGalleryColorMap';
import {
  clearStructuresSelection,
  getStructuresSections,
  startStructuresTab,
} from './_dbg__terrainGalleryStructures';
import { getPatchSections, startPatchTab } from './_dbg__terrainGalleryPatch';
import { getScatterSections } from './_dbg__terrainGalleryScatter';
import { getDecalsSections } from './_dbg__terrainGalleryDecals';
import { startDecalBakeTab } from './_dbg__terrainGalleryDecalBakes';
import { getPadSections, startPadTab } from './_dbg__terrainGalleryPad';
import { PAD_BLOCK_ID } from './padBlock';
import { getOrientationSections, startOrientationTab } from './_dbg__terrainGalleryOrientation';
import {
  getMeasureSections,
  startMeasureTab,
  type MeasureSectionOpts,
} from './_dbg__terrainGalleryMeasure';
import { ORIENTATION_APP_ID } from './orientationBlock';
import { clearWetSelection, getWetSections, startWetTab } from './_dbg__terrainGalleryWet';
import { getLiveSections, startLiveTab, type LiveSectionOpts } from './_dbg__terrainGalleryLive';
import {
  clearGeneratorSelection,
  getProceduralSections,
  refreshProceduralFigures,
  startProceduralTab,
  type ProceduralSectionsOpts,
} from './_dbg__terrainGalleryProcedural';
import {
  BASELINE_MATERIAL_ID,
  GALLERY_MATERIAL_ID,
  getBlockGeometryId,
  getGalleryQuality,
  getSurfaceOverrides,
  type GalleryDebugView,
  type GalleryQuality,
} from './galleryBlocks';
import { ANTI_TILING_BLOCKS, getAntiTilingAppId, setAntiTilingRowState } from './antiTilingRow';
import {
  getSplattingAppId,
  setSplattingView,
  SPLATTING_BLOCK_Y,
  SPLATTING_BLOCKS,
} from './splattingRow';
import { getRulesAppId, getRulesTerrain, RULES_BLOCKS, setRulesView } from './rulesRow';
import { CLIFFS_BLOCK_Y, CLIFFS_BLOCKS, getCliffsAppId, setCliffsDebugView } from './cliffsRow';
import { COLOR_MAP_BLOCKS, getColorMapAppId, setColorMapView } from './colorMapRow';
import {
  getStructuresAppIds,
  getStructuresLeakAppIds,
  setStructuresDebugView,
  STRUCTURES_PIECES,
} from './structuresRow';
import { getPatchAppId, PATCH_BLOCK_IDS, setPatchView } from './patchRow';
import {
  getProceduralAppId,
  getProceduralBakeSettings,
  PROCEDURAL_BLOCKS,
  PROCEDURAL_MODES,
  setProceduralBakeAsync,
} from './proceduralRow';
import { LIVE_APP_ID, setLiveView } from './liveBlock';
import { getPackingAppId, getPackingWallAppId, PACKING_BLOCKS } from './packingRow';
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

const DEBUG_VIEWS: readonly { label: string; value: GalleryDebugView }[] = [
  { label: 'None', value: 'NONE' },
  { label: 'Texel density', value: 'TEXEL_DENSITY' },
  { label: 'Normals', value: 'NORMALS' },
  { label: 'Weights', value: 'WEIGHTS' },
  { label: 'Projection', value: 'PROJECTION' },
  { label: 'Taps', value: 'TAPS' },
  { label: 'Layer count', value: 'LAYER_COUNT' },
];

const QUALITIES: readonly { label: string; value: GalleryQuality }[] = [
  { label: 'Own', value: 'OWN' },
  { label: 'Low', value: 'LOW' },
  { label: 'Medium', value: 'MEDIUM' },
  { label: 'High', value: 'HIGH' },
  { label: 'Ultra', value: 'ULTRA' },
];

/** The tab's saved settings */
type GalleryTabState = {
  packing: TextureSetPacking;
  checker: boolean;
  material: GalleryMaterial;
  debugView: GalleryDebugView;
  quality: GalleryQuality;
  signposts: boolean;
};
const DEFAULT_STATE: GalleryTabState = {
  packing: 'LITE',
  checker: false,
  material: 'TERRAIN',
  debugView: 'NONE',
  quality: 'OWN',
  signposts: true,
};
const state: GalleryTabState = { ...DEFAULT_STATE };

/** This visit's: false once the scene is left, so an await that ends later does nothing */
let visit = { isCurrent: false };
/** The packing the blocks show (`state.packing` is the one asked for) */
let shownPacking: TextureSetPacking = 'LITE';
/** The block the camera flew to last: the list's selection */
let selectedSetId: string | null = null;
/** The row the camera flew over last: the Rows list's selection */
let selectedRowId: string | null = null;
/** The latest packing apply: an older one that finishes later is dropped */
let packingRequest = 0;

/** A block the checker covers: its key, where it stands (`y` only when lifted) and its geometry */
type CheckerBlock = { key: string; x: number; y?: number; z: number; geometryId: string };

const CHECKER_BLOCKS: CheckerBlock[] = [
  ...GALLERY_BLOCKS.map(({ setId, x, z, geometryId }) => ({ key: setId, x, z, geometryId })),
  ...PACKING_BLOCKS.map(({ key, x, z, seed }) => ({
    key: `packing_${key}`,
    x,
    z,
    geometryId: getBlockGeometryId(seed),
  })),
  ...ANTI_TILING_BLOCKS.map(({ mode, x, z, geometryId }) => ({
    key: `antiTiling_${mode}`,
    x,
    z,
    geometryId,
  })),
  ...SPLATTING_BLOCKS.map(({ key, x, z, geometryId }) => ({
    key: `splatting_${key}`,
    x,
    y: SPLATTING_BLOCK_Y,
    z,
    geometryId,
  })),
  ...RULES_BLOCKS.map(({ key, x, z, geometryId }) => ({
    key: `rules_${key}`,
    x,
    // Read when the checker is made: the row's lift is its load's
    get y() {
      return getRulesTerrain().y;
    },
    z,
    geometryId,
  })),
  ...CLIFFS_BLOCKS.map(({ key, x, z, geometryId }) => ({
    key: `cliffs_${key}`,
    x,
    y: CLIFFS_BLOCK_Y,
    z,
    geometryId,
  })),
  ...COLOR_MAP_BLOCKS.map(({ key, x, z, geometryId }) => ({
    key: `colorMap_${key}`,
    x,
    // The Rules row's lift, read when the checker is made
    get y() {
      return getRulesTerrain().y;
    },
    z,
    geometryId,
  })),
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
 * `textureSetSurface`, or the code route's own (`createTerrainMaterial`, made once per set, packing,
 * wall and view, the scene's); the terrain's at the tab's quality tier (the gallery's table)
 */
const getBlockMaterial = (
  setId: string,
  packing: TextureSetPacking | undefined,
  isWall: boolean,
  material: GalleryMaterial
) => {
  // The set's default packing is the variant the scene's load made (no packing key)
  const isDefault = !packing || getTextureSet(setId)?.defaultPacking === packing;
  const { debugView, quality } = state;
  if (material === 'TERRAIN_CODE') {
    const view = debugView === 'NONE' ? '' : `_${debugView}`;
    const id = `terrainGalleryCode_${setId}_${packing ?? 'default'}${isWall ? '_wall' : ''}${view}`;
    const code = createTerrainMaterial({
      id,
      layers: [{ set: setId }],
      ...(isDefault ? {} : { packing }),
      ...(isWall ? { uv: 'MESH_UV' as const } : {}),
      ...(debugView === 'NONE' ? {} : { debugView }),
      quality: getGalleryQuality(),
    });
    return quality === 'OWN' ? code : getTerrainMaterialVariant(id, quality);
  }
  const isBaseline = material === 'BASELINE';
  const overrides = getSurfaceOverrides(setId, {
    packing: isDefault ? undefined : packing,
    isWall,
    isBaseline,
    debugView,
    quality,
  });
  return getMaterialVariant(isBaseline ? BASELINE_MATERIAL_ID : GALLERY_MATERIAL_ID, overrides);
};

/** A mesh entity's material swapped to its set's (in a packing: the library's by default), when
 * the mesh exists */
const swapSurface = (
  appId: string,
  setId: string,
  isWall: boolean,
  packing = getBlockPacking(setId)
) => {
  const mesh = getMeshByAppId(appId);
  if (!mesh) return;
  setMeshMaterial(mesh, getBlockMaterial(setId, packing, isWall, state.material));
};

/**
 * The debug view on the library's terrain blocks (not the baseline's): the views load first (once),
 * then the blocks swap, unless the scene was left meanwhile
 */
const applyDebugViewAsync = async () => {
  const startedOn = visit;
  if (state.debugView !== 'NONE' && !(await loadTerrainDebugViewsAsync())) return;
  if (startedOn.isCurrent) applyMaterial();
};

/**
 * Every library block (and wall) in the material mode, and the Anti-tiling, Splatting, Rules,
 * Cliffs, Colour map and Structures rows in the view; the library, the Splatting, the Rules and the Colour map
 * rows at the quality tier
 */
const applyMaterial = () => {
  for (const block of GALLERY_BLOCKS) {
    swapSurface(getBlockAppId(block.setId), block.setId, false);
    if (block.hasWall) swapSurface(getWallAppId(block.setId), block.setId, true);
  }
  for (const { key, setId, packing, hasWall } of PACKING_BLOCKS) {
    swapSurface(getPackingAppId(key), setId, false, packing);
    if (hasWall) swapSurface(getPackingWallAppId(key), setId, true, packing);
  }
  setAntiTilingRowState({ debugView: state.debugView });
  setSplattingView(state.debugView, state.quality);
  setRulesView(state.debugView, state.quality);
  setCliffsDebugView(state.debugView);
  setColorMapView(state.debugView, state.quality);
  setStructuresDebugView(state.debugView);
  setLiveView(state.debugView, state.quality);
  setPatchView({ debugView: state.debugView });
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
        position: { x: block.x, y: block.y ?? 0, z: block.z },
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
  ...PACKING_BLOCKS.flatMap(({ key }) => [getPackingAppId(key), getPackingWallAppId(key)]),
  ...ANTI_TILING_BLOCKS.map(({ mode }) => getAntiTilingAppId(mode)),
  ...SPLATTING_BLOCKS.map(({ key }) => getSplattingAppId(key)),
  ...RULES_BLOCKS.map(({ key }) => getRulesAppId(key)),
  ...CLIFFS_BLOCKS.map(({ key }) => getCliffsAppId(key)),
  ...COLOR_MAP_BLOCKS.map(({ key }) => getColorMapAppId(key)),
  ...STRUCTURES_PIECES.flatMap(({ key }) => getStructuresAppIds(key)),
  ...getStructuresLeakAppIds(),
  ...CHECKER_BLOCKS.map(({ key }) => getCheckerAppId(key)),
  ...PATCH_BLOCK_IDS.map(getPatchAppId),
  `terrainBlock/${PAD_BLOCK_ID}`,
  ORIENTATION_APP_ID,
  LIVE_APP_ID,
];

/** What the Live block's measurement hides: everything else, the Procedural row's blocks too */
const getAllButLiveAppIds = () => [
  ...getOtherAppIds().filter((appId) => appId !== LIVE_APP_ID),
  ...PROCEDURAL_BLOCKS.flatMap(({ generator }) =>
    PROCEDURAL_MODES.flatMap((mode) => [
      getProceduralAppId(generator.id, mode),
      getProceduralAppId(generator.id, mode, true),
    ])
  ),
];

/** Each list's selection clearer, by the row it lists */
const SELECTION_CLEARERS = {
  library: () => {
    selectedSetId = null;
  },
  rows: () => {
    selectedRowId = null;
  },
  procedural: clearGeneratorSelection,
  antiTiling: clearAntiTilingSelection,
  splatting: clearSplattingSelection,
  rules: clearRulesSelection,
  cliffs: clearCliffsSelection,
  colorMap: clearColorMapSelection,
  structures: clearStructuresSelection,
  wet: clearWetSelection,
};

/** Drops every list's selection but the row's (its block was picked) */
const clearSelectionsBut = (row: keyof typeof SELECTION_CLEARERS) => {
  for (const [key, clear] of Object.entries(SELECTION_CLEARERS)) {
    if (key !== row) clear();
  }
};

/** Flies the scene's camera to a library block and selects it in its list */
const flyToBlock = (block: GalleryBlock) => {
  selectedSetId = block.setId;
  clearSelectionsBut('library');
  setPresetBlock('library', block.setId);
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
  onSelect: () => clearSelectionsBut('procedural'),
  getOtherAppIds,
};

/** What the measurement needs of this tab: the tier through its Quality, a block's packing */
const measureOpts: MeasureSectionOpts = {
  tabId: TAB_ID,
  getQuality: () => state.quality,
  setQuality: (quality) => {
    state.quality = quality;
    applyMaterial();
    updateDebuggerTab(TAB_ID);
  },
  getPacking: (rowId, blockKey) => {
    if (rowId === 'library') return getBlockPacking(blockKey) ?? '';
    if (rowId === 'packing')
      return PACKING_BLOCKS.find(({ key }) => key === blockKey)?.packing ?? '';
    return '';
  },
};

/** What the Live block's section needs of this tab */
const liveOpts: LiveSectionOpts = { tabId: TAB_ID, getOtherAppIds: getAllButLiveAppIds };

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
  selectedRowId = null;
  stopGalleryFlight(true);
  startPresetsTab();
  startAntiTilingTab();
  startSplattingTab();
  startRulesTab();
  startCliffsTab();
  startColorMapTab();
  startStructuresTab();
  startWetTab();
  startPatchTab();
  const endProceduralTab = startProceduralTab(proceduralOpts);
  const endLiveTab = startLiveTab(liveOpts);
  const endDecalBakeTab = startDecalBakeTab();
  const endPadTab = startPadTab();
  startOrientationTab();
  const endMeasureTab = startMeasureTab(measureOpts);
  addGalleryExitCleanup(() => {
    thisVisit.isCurrent = false;
    stopGalleryFlight(true);
    hideGallerySignposts();
    endProceduralTab();
    endLiveTab();
    endDecalBakeTab();
    endPadTab();
    endMeasureTab();
  });

  createDebuggerTab({
    id: TAB_ID,
    title: 'Terrain gallery',
    icon: 'texture',
    sceneId: TERRAIN_GALLERY_SCENE_ID,
    state,
    lsKey: 'AEK_debugTerrainGallery',
    persistKeys: ['packing', 'checker', 'material', 'debugView', 'quality', 'signposts'],
    refreshIntervalMs: 500,
    onRefresh: refreshProceduralFigures,
    onClearLS: () => {
      Object.assign(state, DEFAULT_STATE);
      setChecker(false);
      setGallerySignposts(state.signposts);
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
            key: 'debugView',
            label: 'Debug view',
            kind: 'select',
            options: DEBUG_VIEWS.map((option) => ({ ...option })),
            hint: 'The terrain material’s debug view on the library (not the baseline), the Anti-tiling, Splatting, Rules, Cliffs, Colour map and Structures rows (a far mode shows the near surface everywhere): texel density (a 1 m checker in bands of texels a metre, blue under 128 to red from 2048), the shaded normal in world space, the layers’ weights (layer 0 white, 1 red, 2 green, 3 blue, 4 yellow, …), the projections’ planes (X red, Y green, Z blue; a slope gate’s band striped), the material’s own texture fetches a pixel (up to 2 dark blue, 4 blue, 8 cyan, 12 green, 16 yellow, 24 orange, 32 red, more magenta) or the layers weighing in a pixel (1 dark blue, 2 green, 3 yellow, 4 orange, 5+ red; striped where sparse sampling drops one)',
            onChange: () => void applyDebugViewAsync(),
          },
          {
            key: 'quality',
            label: 'Quality',
            kind: 'segmented',
            options: QUALITIES.map((option) => ({ ...option })),
            hint: 'The quality tier (getTerrainQualityPreset, p305 D10) on the library, the Splatting, the Rules and the Colour map rows (its far blocks with the preset’s far surface: from 60 m on low, 120 on medium, 200 on high, none on ultra): low (no anti-tiling, 2 layers a pixel, cliffs biplanar slope-gated), medium (dual scale, 3, triplanar gated), high (hex on the dominant layer, 3, triplanar gated), ultra (hex on all, 4, triplanar); own: the materials’ own fields. The Anti-tiling, Cliffs and Structures rows compare one technique each and keep theirs',
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
          {
            label: 'Time of day',
            get: () => getTimeOfDay() ?? 10,
            set: (hours: unknown) => setTimeOfDay(Number(hours)),
            kind: 'slider',
            min: 5,
            max: 20,
            step: 0.25,
            unit: 'h',
            hint: 'The standing sky’s hour (the scene’s 10:00 on every visit). A low sun shows the Packing row’s difference: LITE and MINIMAL carry the AO in their albedo, FULL shades it by the light',
          },
          {
            key: 'signposts',
            label: 'Signposts',
            kind: 'switch',
            hint: 'Each row’s letter (the p310 plan’s table) and title over its front edge',
            onChange: (value) => setGallerySignposts(Boolean(value)),
          },
        ],
      },
      debuggerListCMP({
        id: 'terrainGalleryRows',
        heading: 'Rows',
        perItemConfig: {
          onClick: (rowId) => {
            const row = getGalleryRow(rowId);
            if (!row) return;
            selectedRowId = rowId;
            clearSelectionsBut('rows');
            setPresetBlock(rowId);
            flyGalleryCamera(getRowPose(row));
            updateDebuggerTab(TAB_ID, { rebuild: true });
          },
        },
        selectedItemId: () => selectedRowId,
        data: () =>
          GALLERY_ROWS.map((row) => ({
            itemId: row.id,
            title: `${row.letter} ${row.title}`,
            subTitle: row.shows,
            suffix: String(row.getBlocks().length),
          })),
      }),
      // Its fields bind their own targets, none of this tab's state keys
      ...(getPresetSections(TAB_ID) as DebuggerTabSection<GalleryTabState>[]),
      ...(getMeasureSections(measureOpts) as DebuggerTabSection<GalleryTabState>[]),
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
      // Their fields bind their own targets, none of this tab's state keys
      ...(getAntiTilingSections(TAB_ID, () =>
        clearSelectionsBut('antiTiling')
      ) as DebuggerTabSection<GalleryTabState>[]),
      ...(getSplattingSections(TAB_ID, () =>
        clearSelectionsBut('splatting')
      ) as DebuggerTabSection<GalleryTabState>[]),
      ...(getRulesSections(TAB_ID, () =>
        clearSelectionsBut('rules')
      ) as DebuggerTabSection<GalleryTabState>[]),
      ...(getCliffsSections(TAB_ID, () =>
        clearSelectionsBut('cliffs')
      ) as DebuggerTabSection<GalleryTabState>[]),
      ...(getColorMapSections(TAB_ID, () =>
        clearSelectionsBut('colorMap')
      ) as DebuggerTabSection<GalleryTabState>[]),
      ...(getStructuresSections(TAB_ID, () =>
        clearSelectionsBut('structures')
      ) as DebuggerTabSection<GalleryTabState>[]),
      ...(getWetSections(TAB_ID, () =>
        clearSelectionsBut('wet')
      ) as DebuggerTabSection<GalleryTabState>[]),
      ...(getPatchSections(TAB_ID) as DebuggerTabSection<GalleryTabState>[]),
      ...(getScatterSections(TAB_ID) as DebuggerTabSection<GalleryTabState>[]),
      ...(getDecalsSections(TAB_ID) as DebuggerTabSection<GalleryTabState>[]),
      ...(getPadSections(TAB_ID) as DebuggerTabSection<GalleryTabState>[]),
      ...(getOrientationSections() as DebuggerTabSection<GalleryTabState>[]),
      // Its fields bind their own targets, none of this tab's state keys
      ...(getProceduralSections(proceduralOpts) as DebuggerTabSection<GalleryTabState>[]),
      ...(getLiveSections(liveOpts) as DebuggerTabSection<GalleryTabState>[]),
    ],
  });

  if (state.checker) setChecker(true);
  if (state.signposts) setGallerySignposts(true);
  if (state.debugView !== 'NONE') void applyDebugViewAsync();
  else if (state.material !== 'TERRAIN' || state.quality !== 'OWN') applyMaterial();
  if (state.packing !== 'LITE') void applyPackingAsync(state.packing);
};
