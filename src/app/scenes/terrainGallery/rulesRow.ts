// The terrain gallery's Rules row (p305 Phase 4): two 64 × 64 m blocks in front of the library on
// one generated terrain (rolling hills and a step whose face is a cliff band), their layers laid by
// the terrain material's procedural rules: grass everywhere, rocks by slope (broken up by the
// macro noise's A), snow above a height on the slopes that face north (−z) and on flat tops (R
// breaking its edge), cliffs on the steep faces. The left block is `RULES` alone; the right one
// paints a sandy path and mud in the hollows into a splat map (`paintedLayers: 3`, one map: R
// sand, G mud) under the same rules (`SPLAT_MAP_AND_RULES`). Code route materials, storage `AUTO`:
// the rules block binds its 4 sets' 8 textures and the noise texture (`SEPARATE`), the combo's 6
// sets go over the budget and take a set array (the scene's `textureSetArrays` lists it). The rules
// read the world height, so the snow line follows the block's lift; the noise is the toolkit's
// `macroNoise` (the code route's default noise texture, which the scene lists).
import * as THREE from 'three/webgpu';
import {
  createMeshEntity,
  getGeometry,
  getMaterialVariant,
  getMeshByAppId,
  getTexture,
  saveBufferGeometry,
  saveTexture,
  setMeshMaterial,
} from 'aekasha';
import { generateTerrain, type TerrainRule } from 'aekasha/toolkit/geometry';
import {
  createTerrainMaterial,
  getTerrainMaterialProps,
  type TerrainMaterialConfig,
} from 'aekasha/toolkit/terrain';
import { BLOCK_GAP, NO_SHADOWS, setMaterialUniform, type GalleryDebugView } from './galleryBlocks';

/** A block's side, metres: hills, a cliff band and a snow line on one block */
export const RULES_BLOCK_SIZE = 64;
/** 0.5 m between vertices */
const SEGMENTS = 128;
const SPLAT_SIZE = 256;
const TERRAIN_SEED = 405;
/** The hills' noise peak, metres either way of its middle: 0 to 8 m of hills */
const MAX_HEIGHT = 4;
const NOISE_OCTAVES = [
  { frequency: 1 / 40, amplitude: 1 },
  { frequency: 1 / 14, amplitude: 0.4 },
];
/** The step's height and its face's half-width, metres: a face of 60° and more */
const STEP_HEIGHT = 7;
const STEP_HALF_WIDTH = 1.6;
/** The metres from the block's edge over which its relief rises from the ground */
const EDGE_FADE = 10;
/** The gallery's ground top (`terrainGallery.ts`' `GROUND_Y`) */
const GROUND_TOP_Y = -0.6;
/** The snow line's default, metres under the block's top */
const SNOW_BELOW_TOP = 4;

const GEOMETRY_ID = 'terrainGalleryRulesBlock';
const SPLAT_ID = 'terrainGalleryRules.splat0';

/** The row's blocks */
export const RULES_KEYS = ['RULES', 'SPLAT_AND_RULES'] as const;
/** One of {@link RULES_KEYS} */
export type RulesKey = (typeof RULES_KEYS)[number];

/** A block of the row: what it shows and where it stands */
export type RulesBlock = {
  key: RulesKey;
  title: string;
  description: string;
  /** The layers' sets, the base first */
  sets: string[];
  x: number;
  z: number;
  geometryId: string;
};

/** The rule layers' sets, after the painted ones */
const RULE_SETS = ['rocks02', 'snow01', 'cliffs01'];
const SETS: Record<RulesKey, string[]> = {
  RULES: ['grass01', ...RULE_SETS],
  SPLAT_AND_RULES: ['grass01', 'sand01', 'mud01', ...RULE_SETS],
};
const DESCRIPTIONS: Record<RulesKey, [string, string]> = {
  RULES: [
    'Rules',
    'Grass, rocks by slope, snow by height and facing (north), cliffs on steep faces',
  ],
  SPLAT_AND_RULES: [
    'Splat map + rules',
    'A sandy path and mud in the hollows painted (one 256² map), the same rules over them',
  ],
};

/** Where the row stands: in front of the library and the Splatting row (+z), two blocks */
const ROW_NEAR_Z = 40 + 2 * BLOCK_GAP;
const ROW_Z = ROW_NEAR_Z + RULES_BLOCK_SIZE / 2;
const PITCH = RULES_BLOCK_SIZE + 2 * BLOCK_GAP;

/** The two blocks, the rules alone left of the combo */
export const RULES_BLOCKS: readonly RulesBlock[] = RULES_KEYS.map((key, i) => ({
  key,
  title: DESCRIPTIONS[key][0],
  description: DESCRIPTIONS[key][1],
  sets: SETS[key],
  x: (i - 0.5) * PITCH,
  z: ROW_Z,
  geometryId: GEOMETRY_ID,
}));

/** The row's extent on the ground, for the gallery's ground */
export const RULES_ROW_BOUNDS = {
  minX: -PITCH / 2 - RULES_BLOCK_SIZE / 2,
  maxX: PITCH / 2 + RULES_BLOCK_SIZE / 2,
  minZ: ROW_NEAR_Z,
  maxZ: ROW_NEAR_Z + RULES_BLOCK_SIZE,
};

/** The row's live values, uniforms on both blocks (the tab's) */
export type RulesValues = {
  /** Rocks from this slope, degrees */
  rocksSlope: number;
  /** The rocks' noise amount */
  rocksNoise: number;
  /** Snow from this world height, metres */
  snowHeight: number;
  /** Snow on slopes facing within this many degrees of north */
  snowFacing: number;
  /** Cliffs from this slope, degrees */
  cliffSlope: number;
  heightBlendDepth: number;
};
const DEFAULT_VALUES: Omit<RulesValues, 'snowHeight'> = {
  rocksSlope: 26,
  rocksNoise: 0.35,
  snowFacing: 70,
  cliffSlope: 46,
  heightBlendDepth: 0.2,
};
const values: RulesValues = { ...DEFAULT_VALUES, snowHeight: 0 };
/** This load's: the block's lift and its world heights' range */
const terrainState = { y: 0, top: 0, bottom: 0 };
let debugView: GalleryDebugView = 'NONE';

/** The live values (the tab's fields bind them; {@link applyRulesValues} after a change) */
export const getRulesValues = () => values;
/** The row's defaults, the snow line at this load's terrain */
export const getDefaultRulesValues = (): RulesValues => ({
  ...DEFAULT_VALUES,
  snowHeight: Math.round(terrainState.top - SNOW_BELOW_TOP),
});
/** The block's lift and its world heights' range, metres */
export const getRulesTerrain = (): Readonly<typeof terrainState> => terrainState;

/** A block's mesh entity's app id */
export const getRulesAppId = (key: RulesKey) => `terrainGallery_rules_${key}`;

/**
 * The rules, their layers after `first` painted ones (the rule order and so their uniforms'
 * `r<i>` are the same on both blocks): rocks, snow, cliffs
 */
const getRules = (first: number): TerrainRule[] => [
  {
    layer: first,
    slope: { min: values.rocksSlope, softness: 8 },
    noise: { scale: 18, amount: values.rocksNoise, channel: 'A' },
  },
  {
    layer: first + 1,
    height: { min: values.snowHeight, softness: 3 },
    slope: { max: 38, softness: 8 },
    aspect: { direction: [0, -1], range: values.snowFacing, softness: 35 },
    noise: { scale: 40, amount: 0.25 },
  },
  { layer: first + 2, slope: { min: values.cliffSlope, softness: 6 } },
];

/** A block's code route config: its sets and rules, the combo's splat map; storage `AUTO` */
const getBlockConfig = (block: RulesBlock): TerrainMaterialConfig => {
  const id = `terrainGalleryRules_${block.key}`;
  const layers = block.sets.map((set) => ({ set }));
  if (block.key === 'RULES') {
    return { id, layers, blend: { source: 'RULES', rules: getRules(1) } };
  }
  return {
    id,
    layers,
    blend: { source: 'SPLAT_MAP_AND_RULES', paintedLayers: 3, rules: getRules(3) },
    splatMaps: [SPLAT_ID],
  };
};

/** The storage `AUTO` chose for a block: `ARRAY` binds its sets as one `layers` set array */
export const getRulesStorage = (block: RulesBlock) =>
  'layers' in (getTerrainMaterialProps(getBlockConfig(block)).inputs ?? {}) ? 'ARRAY' : 'SEPARATE';

/** A block's material: its code route material, or that material's variant with the debug view */
const getBlockMaterial = (block: RulesBlock) => {
  const config = getBlockConfig(block);
  const base = createTerrainMaterial(config);
  if (debugView === 'NONE') return base;
  // The material's own define (its rules at the load's values), not the live values': a slider
  // writes uniforms, never another variant
  const terrain = base.userData.terrainDefine as object;
  return getMaterialVariant(config.id, { staticDefines: { terrain: { ...terrain, debugView } } });
};

/** The live values on a block's material (the rules `r0` rocks, `r1` snow, `r2` cliffs) */
const writeValues = (material: THREE.Material) => {
  setMaterialUniform(material, 'terrain_r0_slopeMin', values.rocksSlope);
  setMaterialUniform(material, 'terrain_r0_noiseAmount', values.rocksNoise);
  setMaterialUniform(material, 'terrain_r1_heightMin', values.snowHeight);
  setMaterialUniform(material, 'terrain_r1_aspectRange', values.snowFacing);
  setMaterialUniform(material, 'terrain_r2_slopeMin', values.cliffSlope);
  setMaterialUniform(material, 'terrain_heightBlendDepth', values.heightBlendDepth);
};

/** Writes the live values into both blocks' materials (after a field's change) */
export const applyRulesValues = () => {
  for (const { key } of RULES_BLOCKS) {
    const mesh = getMeshByAppId(getRulesAppId(key));
    if (mesh) writeValues(mesh.material as THREE.Material);
  }
};

/**
 * Shows the debug view on the blocks: each swaps to its view's variant (made the first time), the
 * live values written in. The views must be loaded (`loadTerrainDebugViewsAsync`).
 */
export const setRulesDebugView = (view: GalleryDebugView) => {
  debugView = view;
  for (const block of RULES_BLOCKS) {
    const mesh = getMeshByAppId(getRulesAppId(block.key));
    if (!mesh) continue;
    const material = getBlockMaterial(block);
    writeValues(material);
    setMeshMaterial(mesh, material);
  }
};

const smoothstep = (from: number, to: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

/** The step's line: where the cliff band runs, a wavy line across the block */
const getStepDistance = (x: number, z: number) => x * 0.95 - z * 0.3 + 6 * Math.sin(z / 9) - 6;

/** The metres from a point to the block's nearest edge */
const getEdgeDistance = (x: number, z: number) =>
  RULES_BLOCK_SIZE / 2 - Math.max(Math.abs(x), Math.abs(z));

/**
 * The blocks' terrain: rolling hills (the noise shifted to 0 and up) and the step's band raising
 * the right part, the whole relief fading to 0 toward the edges so the block stands on the ground
 */
const generateBlockTerrain = () =>
  generateTerrain({
    width: RULES_BLOCK_SIZE,
    depth: RULES_BLOCK_SIZE,
    widthSegments: SEGMENTS,
    depthSegments: SEGMENTS,
    maxHeight: MAX_HEIGHT,
    noiseOctaves: NOISE_OCTAVES,
    seed: TERRAIN_SEED,
    heightModifier: (x, z, h) => {
      const step =
        STEP_HEIGHT * smoothstep(-STEP_HALF_WIDTH, STEP_HALF_WIDTH, getStepDistance(x, z));
      return (h + MAX_HEIGHT + step) * smoothstep(0, EDGE_FADE, getEdgeDistance(x, z));
    },
  });

type BlockTerrain = ReturnType<typeof generateBlockTerrain>;

/**
 * The splat map (RGBA, linear, mipmapped) at the block's UV: R a sandy path winding across the
 * block's low left part, G mud in the hollows (inside the edges' slope); B and A unused (two
 * painted layers past the base)
 */
const getSplatMap = (terrain: BlockTerrain) => {
  const registered = getTexture(SPLAT_ID);
  if (registered) return registered;
  const data = new Uint8Array(SPLAT_SIZE * SPLAT_SIZE * 4);
  const half = RULES_BLOCK_SIZE / 2;
  for (let row = 0; row < SPLAT_SIZE; row++) {
    const z = ((row + 0.5) / SPLAT_SIZE) * RULES_BLOCK_SIZE - half;
    for (let col = 0; col < SPLAT_SIZE; col++) {
      const x = ((col + 0.5) / SPLAT_SIZE) * RULES_BLOCK_SIZE - half;
      const path = 1 - smoothstep(1.2, 2.6, Math.abs(x + 12 - 7 * Math.sin(z / 10)));
      const hollow = 1 - smoothstep(2.4, 3.4, terrain.getHeightAt(x, z));
      const mud = hollow * smoothstep(EDGE_FADE, EDGE_FADE + 3, getEdgeDistance(x, z));
      const sum = Math.max(1, path + mud);
      const i = (row * SPLAT_SIZE + col) * 4;
      data[i] = Math.round((path / sum) * 255);
      data[i + 1] = Math.round((mud / sum) * 255);
    }
  }
  const map = new THREE.DataTexture(data, SPLAT_SIZE, SPLAT_SIZE, THREE.RGBAFormat);
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.magFilter = THREE.LinearFilter;
  map.generateMipmaps = true;
  map.needsUpdate = true;
  return saveTexture(map, SPLAT_ID);
};

/**
 * Creates the row (the scene's load): the terrain (its edges on the ground), the splat map, then
 * both blocks with their materials, the scene's defaults (the tab applies its view)
 */
export const createRulesRow = () => {
  debugView = 'NONE';
  const terrain = generateBlockTerrain();
  const top = terrain.heights.reduce((high, h) => Math.max(high, h), -Infinity);
  terrainState.y = GROUND_TOP_Y;
  terrainState.bottom = GROUND_TOP_Y;
  terrainState.top = top + GROUND_TOP_Y;
  Object.assign(values, getDefaultRulesValues());
  getSplatMap(terrain);
  const geometry =
    getGeometry(GEOMETRY_ID) ?? saveBufferGeometry(terrain.geometry, { id: GEOMETRY_ID });
  if (geometry !== terrain.geometry) terrain.geometry.dispose();
  for (const block of RULES_BLOCKS) {
    const material = getBlockMaterial(block);
    writeValues(material);
    createMeshEntity(
      {
        geo: geometry,
        mat: material,
        position: { x: block.x, y: terrainState.y, z: block.z },
        ...NO_SHADOWS,
      },
      { appId: getRulesAppId(block.key), debugData: { name: `Rules: ${block.title}` } }
    );
  }
};
