// The terrain gallery's Rules row (p305 Phase 4): three 64 × 64 m blocks in front of the library on
// one generated terrain (rolling hills and a step whose face is a cliff band), their layers laid by
// the terrain material's procedural rules: grass everywhere, rocks by slope (broken up by the
// macro noise's A), snow above a height on the slopes that face north (−z) and on flat tops (R
// breaking its edge), cliffs on the steep faces (slope-gated `TRIPLANAR`, p305 Phase 5: planar
// tiling streaked them). The left block is `RULES` alone; the right one
// paints a sandy path and mud in the hollows into a splat map (`paintedLayers: 3`, one map: R
// sand, G mud) under the same rules (`SPLAT_MAP_AND_RULES`). The third (p305 Phase 6, the tiers'
// terrain) is the combo with two more rule layers, grass02 patches on the gentle slopes and ice on
// the flat tops facing south, and the macro variation: 8 layers. Code route materials, storage
// `AUTO`, each with the toolkit's quality preset (its cliff layer projected per tier): the tiers'
// sparse sampling reads the layers from a set array, so every block takes one (the scene's
// `textureSetArrays` lists them; Phase 4's rules block bound its 8 textures `SEPARATE`). The rules
// read the world height, so the snow line follows the block's lift; the noise is the toolkit's
// `macroNoise` (the code route's default noise texture and the 8 layers' macro, which the scene
// lists). The debug view and the tier are a variant of the block's material.
import * as THREE from 'three/webgpu';
import {
  createMeshEntity,
  getGeometry,
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
  getTerrainQualityPreset,
  type TerrainMaterialConfig,
  type TerrainProjection,
} from 'aekasha/toolkit/terrain';
import {
  BLOCK_GAP,
  getTerrainBlockVariant,
  NO_SHADOWS,
  setMaterialUniform,
  type GalleryDebugView,
  type GalleryQuality,
} from './galleryBlocks';

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
export const RULES_KEYS = ['RULES', 'SPLAT_AND_RULES', 'EIGHT_LAYERS'] as const;
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
/** The 8 layers' rule layers past the combo's */
const EXTRA_SETS = ['grass02', 'ice01'];
const SETS: Record<RulesKey, string[]> = {
  RULES: ['grass01', ...RULE_SETS],
  SPLAT_AND_RULES: ['grass01', 'sand01', 'mud01', ...RULE_SETS],
  EIGHT_LAYERS: ['grass01', 'sand01', 'mud01', ...RULE_SETS, ...EXTRA_SETS],
};
/** The 8 layers' macro variation: a block's worth of `macroNoise` */
const EIGHT_LAYERS_MACRO = { texture: 'macroNoise', scale: 64 };
const DESCRIPTIONS: Record<RulesKey, [string, string]> = {
  RULES: [
    'Rules',
    'Grass, rocks by slope, snow by height and facing (north), cliffs on steep faces',
  ],
  SPLAT_AND_RULES: [
    'Splat map + rules',
    'A sandy path and mud in the hollows painted (one 256² map), the same rules over them',
  ],
  EIGHT_LAYERS: [
    '8 layers',
    'The splat map + rules, grass02 patches on gentle slopes, ice on flat tops facing south, macro',
  ],
};

/**
 * Where the row stands: in front of the library and the Splatting row (+z), the first two blocks
 * either side of x 0, the third right of them
 */
const ROW_NEAR_Z = 40 + 2 * BLOCK_GAP;
const ROW_Z = ROW_NEAR_Z + RULES_BLOCK_SIZE / 2;
const PITCH = RULES_BLOCK_SIZE + 2 * BLOCK_GAP;

/** The three blocks from the left: the rules alone, the combo, the 8 layers */
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
  maxX: (RULES_KEYS.length - 1.5) * PITCH + RULES_BLOCK_SIZE / 2,
  minZ: ROW_NEAR_Z,
  maxZ: ROW_NEAR_Z + RULES_BLOCK_SIZE,
};

/** The row's live values, uniforms on every block (the tab's) */
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
let quality: GalleryQuality = 'OWN';

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
 * `r<i>` are the same on every block): rocks, snow, cliffs
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

/**
 * The 8 layers' extra rules, after the shared ones (their uniforms `r3`, `r4`, at the load's
 * values): grass02 where the macro noise's R (an fbm: B's Worley cells would cut straight edges) is
 * high on gentle slopes above the hollows, ice on the flat tops facing south
 */
const getExtraRules = (first: number): TerrainRule[] => [
  {
    layer: first,
    slope: { max: 15, softness: 5 },
    height: { min: terrainState.bottom + 2, softness: 1 },
    noise: { scale: 30, amount: 1, channel: 'R' },
  },
  {
    layer: first + 1,
    height: { min: values.snowHeight - 1, softness: 1 },
    slope: { max: 10, softness: 4 },
    aspect: { direction: [0, 1], range: 80, softness: 30 },
  },
];

/**
 * The cliffs' layer's projection (p305 Phase 5): planar world tiling streaks on its steep faces, so
 * it's projected past the gate (the other layers lie on gentler slopes: planar)
 */
const CLIFF_PROJECTION: TerrainProjection = { mode: 'TRIPLANAR', slopeGate: [35, 50] };

/**
 * A block's code route config: its sets and rules, the combo's splat map, the 8 layers' extra
 * rules and macro, the toolkit's quality preset with its cliff layer; storage `AUTO`
 */
const getBlockConfig = (block: RulesBlock): TerrainMaterialConfig => {
  const id = `terrainGalleryRules_${block.key}`;
  const layers = block.sets.map((set) =>
    set === 'cliffs01' ? { set, projection: CLIFF_PROJECTION } : { set }
  );
  const quality = getTerrainQualityPreset({ cliffLayers: [block.sets.indexOf('cliffs01')] });
  if (block.key === 'RULES') {
    return { id, layers, blend: { source: 'RULES', rules: getRules(1) }, quality };
  }
  const isEight = block.key === 'EIGHT_LAYERS';
  const rules = isEight ? [...getRules(3), ...getExtraRules(6)] : getRules(3);
  return {
    id,
    layers,
    blend: { source: 'SPLAT_MAP_AND_RULES', paintedLayers: 3, rules },
    splatMaps: [SPLAT_ID],
    ...(isEight ? { macro: EIGHT_LAYERS_MACRO } : {}),
    quality,
  };
};

/**
 * The 8-layer block's code route config at the load's values (the Colour map row's source): its
 * sets and rules, the splat map, the macro, the quality preset
 */
export const getEightLayersConfig = () =>
  getBlockConfig(RULES_BLOCKS.find(({ key }) => key === 'EIGHT_LAYERS') as RulesBlock);

/** The storage `AUTO` chose for a block: `ARRAY` binds its sets as one `layers` set array */
export const getRulesStorage = (block: RulesBlock) =>
  'layers' in (getTerrainMaterialProps(getBlockConfig(block)).inputs ?? {}) ? 'ARRAY' : 'SEPARATE';

/**
 * A block's material: its code route material, or that material's variant with the debug view and
 * the quality tier (over its own define, its rules at the load's values, not the live values': a
 * slider writes uniforms, never another variant)
 */
const getBlockMaterial = (block: RulesBlock) => {
  const config = getBlockConfig(block);
  createTerrainMaterial(config);
  return getTerrainBlockVariant(config.id, { debugView, quality });
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

/** Writes the live values into the blocks' materials (after a field's change) */
export const applyRulesValues = () => {
  for (const { key } of RULES_BLOCKS) {
    const mesh = getMeshByAppId(getRulesAppId(key));
    if (mesh) writeValues(mesh.material as THREE.Material);
  }
};

/**
 * Shows the debug view and the quality tier on the blocks: each swaps to its variant (made the
 * first time), the live values written in. The views must be loaded (`loadTerrainDebugViewsAsync`).
 */
export const setRulesView = (view: GalleryDebugView, tier: GalleryQuality) => {
  debugView = view;
  quality = tier;
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
 * the blocks with their materials, the scene's defaults (the tab applies its view)
 */
export const createRulesRow = () => {
  debugView = 'NONE';
  quality = 'OWN';
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
