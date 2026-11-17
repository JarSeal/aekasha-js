// The terrain gallery's Live block (p305 Phase 8): a 48 × 48 m generated terrain right of the
// Procedural row, its layers laid by procedural rules (grass, rocks by slope, snow on the tops) and
// sand ripples in the hollows from the gallery's procedural set `terrainGalleryLiveDunes`
// (`sandRipples`), which the terrain material runs live in the material (`source:
// 'PROCEDURAL_LIVE'`) or samples baked: two code route materials of one config but the layer's
// source, the tab's switch picking one. Both have the toolkit's quality preset, whose sparse
// sampling makes their storage `ARRAY`: the three imported sets in a set array (the scene's
// `textureSetArrays` lists it), the procedural set on its own input `layer3` beside it (a set array
// takes imported sets, D9's mixed sources), sampled beside the slots; the preset's low tiers sample
// the ripples' bake (`liveLayers`), so live and baked differ from `HIGH`. The scene lists the set, so
// its load bakes it (the baked material's, and the live one's generator loaded with it). The live
// values (the generator's numbers and its seed) are uniforms on whichever material a block shows.
import type * as THREE from 'three/webgpu';
import {
  createMeshEntity,
  getGeometry,
  getMeshByAppId,
  saveBufferGeometry,
  setMeshMaterial,
} from 'aekasha';
import { getTextureSet } from 'aekasha/texturesets';
import { generateTerrain, type TerrainRule } from 'aekasha/toolkit/geometry';
import {
  createTerrainMaterial,
  getTerrainMaterialProps,
  getTerrainQualityPreset,
  sandRipples,
  type TerrainMaterialConfig,
} from 'aekasha/toolkit/terrain';
import {
  BLOCK_GAP,
  getTerrainBlockVariant,
  NO_SHADOWS,
  setMaterialUniform,
  type GalleryDebugView,
  type GalleryQuality,
} from './galleryBlocks';
import { PROCEDURAL_ROW_EDGE_X } from './proceduralRow';

/** The block's side, metres */
export const LIVE_BLOCK_SIZE = 48;
/** 0.5 m between vertices */
const SEGMENTS = 96;
const TERRAIN_SEED = 408;
/** The hills' noise peak, metres either way of its middle: 0 to 6 m of hills */
const MAX_HEIGHT = 3;
const NOISE_OCTAVES = [
  { frequency: 1 / 26, amplitude: 1 },
  { frequency: 1 / 9, amplitude: 0.35 },
];
/** The metres from the block's edge over which its relief rises from the ground */
const EDGE_FADE = 8;
/** The gallery's ground top (`terrainGallery.ts`' `GROUND_Y`) */
const GROUND_TOP_Y = -0.6;

const GEOMETRY_ID = 'terrainGalleryLiveBlock';
/** The procedural set the block runs live (its JSON in this folder) */
export const LIVE_SET_ID = 'terrainGalleryLiveDunes';
/** The layers' sets: the base, the rules' rocks and snow, the live ripples last */
export const LIVE_SETS = ['grass01', 'rocks02', 'snow01', LIVE_SET_ID] as const;
/** The live layer's index, its uniforms `terrain_l3_live_<param>` */
export const LIVE_LAYER = LIVE_SETS.length - 1;

/** What the block shows: the ripples live in the material, or their bake */
export const LIVE_MODES = ['LIVE', 'BAKED'] as const;
/** One of {@link LIVE_MODES} */
export type LiveMode = (typeof LIVE_MODES)[number];

/** Where the block stands: right of the Procedural row, level with the library */
export const LIVE_BLOCK = {
  x: PROCEDURAL_ROW_EDGE_X + 2 * BLOCK_GAP + LIVE_BLOCK_SIZE / 2,
  z: 0,
  geometryId: GEOMETRY_ID,
} as const;

/** The block's extent on the ground, for the gallery's ground */
export const LIVE_BLOCK_BOUNDS = {
  minX: LIVE_BLOCK.x - LIVE_BLOCK_SIZE / 2,
  maxX: LIVE_BLOCK.x + LIVE_BLOCK_SIZE / 2,
  minZ: -LIVE_BLOCK_SIZE / 2,
  maxZ: LIVE_BLOCK_SIZE / 2,
};

/** The generator's numbers the tab tunes (its colours keep the set's) */
export const LIVE_PARAMS = ['angle', 'wavelength', 'warp', 'grain'] as const;
/** The live values: the generator's numbers and the seed, uniforms on whichever material shows */
export type LiveValues = Record<(typeof LIVE_PARAMS)[number], number> & { seed: number };

const values: LiveValues = { angle: 0, wavelength: 0, warp: 0, grain: 0, seed: 0 };
/** This load's: the block's lift and its world heights' range */
const terrainState = { y: GROUND_TOP_Y, top: 0, bottom: 0 };
let mode: LiveMode = 'LIVE';
let debugView: GalleryDebugView = 'NONE';
let quality: GalleryQuality = 'OWN';

/** The block's mesh entity's app id */
export const LIVE_APP_ID = 'terrainGallery_live';

/** The set's values (its JSON's params over the generator's defaults, and its seed) */
export const getDefaultLiveValues = (): LiveValues => {
  const procedural = getTextureSet(LIVE_SET_ID)?.procedural;
  const params = procedural?.params ?? {};
  const value = (name: (typeof LIVE_PARAMS)[number]): number => {
    const given = params[name];
    return typeof given === 'number' ? given : sandRipples.params[name].default;
  };
  return {
    angle: value('angle'),
    wavelength: value('wavelength'),
    warp: value('warp'),
    grain: value('grain'),
    seed: procedural?.seed ?? 0,
  };
};

/** The live values (the tab's fields bind them; {@link applyLiveValues} after a change) */
export const getLiveValues = () => values;
/** The block's lift and its world heights' range, metres */
export const getLiveTerrain = (): Readonly<typeof terrainState> => terrainState;
/** What the block shows */
export const getLiveMode = () => mode;

/**
 * The rules over the base grass: rocks02 by slope (`macroNoise`'s A breaking it up), snow01 on the
 * tops, the ripples in the hollows (R moving their edge)
 */
const getRules = (): TerrainRule[] => [
  {
    layer: 1,
    slope: { min: 22, softness: 6 },
    noise: { scale: 14, amount: 0.3, channel: 'A' },
  },
  { layer: 2, height: { min: terrainState.top - 1.2, softness: 0.8 } },
  {
    layer: LIVE_LAYER,
    height: { max: terrainState.bottom + 1.6, softness: 0.8 },
    slope: { max: 24, softness: 6 },
    noise: { scale: 24, amount: 0.3 },
  },
];

/**
 * A mode's code route config: the rules, the quality preset (storage `AUTO`: `ARRAY` for the
 * tiers' sparse sampling, the procedural set on its own input), the ripples live or baked
 */
const getConfig = (shown: LiveMode): TerrainMaterialConfig => ({
  id: `terrainGalleryLive_${shown}`,
  layers: LIVE_SETS.map((set, i) =>
    i === LIVE_LAYER && shown === 'LIVE' ? { set, source: 'PROCEDURAL_LIVE' } : { set }
  ),
  blend: { source: 'RULES', rules: getRules() },
  // LOW and MEDIUM sample the ripples' bake, HIGH and ULTRA run them live
  quality: getTerrainQualityPreset({ liveLayers: [LIVE_LAYER] }),
});

/** The inputs a mode's material takes (the tab's list: the set array and the own input) */
export const getLiveInputs = (shown: LiveMode) =>
  Object.keys(getTerrainMaterialProps(getConfig(shown)).inputs ?? {});

/** The material the block shows: the mode's, or its variant with the debug view and the tier */
const getBlockMaterial = () => {
  const config = getConfig(mode);
  createTerrainMaterial(config);
  return getTerrainBlockVariant(config.id, { debugView, quality });
};

/** The live values on a material: the live layer's uniforms (none on the baked one) */
const writeValues = (material: THREE.Material) => {
  for (const name of LIVE_PARAMS) {
    setMaterialUniform(material, `terrain_l${LIVE_LAYER}_live_${name}`, values[name]);
  }
  setMaterialUniform(material, `terrain_l${LIVE_LAYER}_live_seed`, values.seed);
};

/** Shows the mode's material (or its view's and tier's variant), the live values written in */
const showMaterial = () => {
  const mesh = getMeshByAppId(LIVE_APP_ID);
  if (!mesh) return;
  const material = getBlockMaterial();
  writeValues(material);
  setMeshMaterial(mesh, material);
};

/** Writes the live values into the shown material (after a field's change) */
export const applyLiveValues = () => {
  const mesh = getMeshByAppId(LIVE_APP_ID);
  if (mesh) writeValues(mesh.material as THREE.Material);
};

/** Shows the ripples live or baked (the mode's material, the live values written in) */
export const setLiveMode = (shown: LiveMode) => {
  mode = shown;
  showMaterial();
};

/**
 * Shows the debug view and the quality tier on the block (its mode's variant). The views must be
 * loaded (`loadTerrainDebugViewsAsync`).
 */
export const setLiveView = (view: GalleryDebugView, tier: GalleryQuality) => {
  debugView = view;
  quality = tier;
  showMaterial();
};

const smoothstep = (from: number, to: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

/** Rolling hills (the noise shifted to 0 and up), fading to 0 toward the edges */
const generateBlockTerrain = () =>
  generateTerrain({
    width: LIVE_BLOCK_SIZE,
    depth: LIVE_BLOCK_SIZE,
    widthSegments: SEGMENTS,
    depthSegments: SEGMENTS,
    maxHeight: MAX_HEIGHT,
    noiseOctaves: NOISE_OCTAVES,
    seed: TERRAIN_SEED,
    heightModifier: (x, z, h) => {
      const edge = LIVE_BLOCK_SIZE / 2 - Math.max(Math.abs(x), Math.abs(z));
      return (h + MAX_HEIGHT) * smoothstep(0, EDGE_FADE, edge);
    },
  });

/**
 * Creates the block (the scene's load): the terrain (its edges on the ground) and the live
 * material, the scene's defaults (the tab applies its view)
 */
export const createLiveBlock = () => {
  mode = 'LIVE';
  debugView = 'NONE';
  quality = 'OWN';
  const terrain = generateBlockTerrain();
  const heights = terrain.heights;
  const top = heights.reduce((high, h) => Math.max(high, h), -Infinity);
  // The hollows' floor: the lowest point inside the edges' slope
  const inner = LIVE_BLOCK_SIZE / 2 - EDGE_FADE;
  let bottom = Infinity;
  for (let x = -inner; x <= inner; x += 1) {
    for (let z = -inner; z <= inner; z += 1) bottom = Math.min(bottom, terrain.getHeightAt(x, z));
  }
  terrainState.top = top + GROUND_TOP_Y;
  terrainState.bottom = bottom + GROUND_TOP_Y;
  Object.assign(values, getDefaultLiveValues());
  const geometry =
    getGeometry(GEOMETRY_ID) ?? saveBufferGeometry(terrain.geometry, { id: GEOMETRY_ID });
  if (geometry !== terrain.geometry) terrain.geometry.dispose();
  const material = getBlockMaterial();
  writeValues(material);
  createMeshEntity(
    {
      geo: geometry,
      mat: material,
      position: { x: LIVE_BLOCK.x, y: terrainState.y, z: LIVE_BLOCK.z },
      ...NO_SHADOWS,
    },
    { appId: LIVE_APP_ID, debugData: { name: 'Live: rules + live ripples' } }
  );
};
