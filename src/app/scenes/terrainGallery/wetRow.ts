// The terrain gallery's Wet/dry row (p307 Phase 2): a 12 m block per texture set category, each
// the terrain material with `wet` over one set of the category, and a beach block (sand on the
// flat, rocks on the ramp by a slope rule, height-blended) whose blended response is S4's "a
// beach blends sand's response with rock's"; 3 × 3 left of the Splatting row. Every block is the
// library's generated block (its 35° ramp), so a set's response is judged on the flat and on a
// slope. The wetness and the puddle level are the surface conditions' (the scene's JSON starts
// them `MANUAL`, so nothing dries them); the tab's sliders and steps set them, and switch the
// row's quality (`FULL`, `SIMPLE`) and the `WETNESS` view. Phase 3: every block has puddles
// (filling by its set's `puddleResponse`, in `macroNoise` patches), and the grass block a regional
// wetness along its left edge (a riverbank: its `_wetness` vertex attribute). Code route materials
// (`createTerrainMaterial`): the view and the quality are variants of a block's material.
import * as THREE from 'three/webgpu';
import {
  createMeshEntity,
  existsOrThrow,
  getMaterial,
  getMaterialVariant,
  getMeshByAppId,
  setMeshMaterial,
} from 'aekasha';
import { createTerrainMaterial, type TerrainMaterialConfig } from 'aekasha/toolkit/terrain';
import { BLOCK_GAP, BLOCK_PITCH, BLOCK_SIZE, getBlockGeometry, NO_SHADOWS } from './galleryBlocks';
import { SPLATTING_ROW_BOUNDS } from './splattingRow';

/** A block of the row: a texture set category, or the blended beach */
export type WetKey =
  | 'SAND'
  | 'MUD'
  | 'ROCKS'
  | 'CLIFF'
  | 'SNOW'
  | 'ICE'
  | 'GRASS'
  | 'CONCRETE'
  | 'BEACH';

/** A block of the row: its key, its sets, where it stands and its terrain's seed */
export type WetBlock = {
  key: WetKey;
  title: string;
  sets: readonly string[];
  x: number;
  z: number;
  seed: number;
};

/** The row's quality (`wet.quality`) and view, which the tab switches */
export type WetRowView = { quality: 'FULL' | 'SIMPLE'; debugView: 'NONE' | 'WETNESS' };

/** Each block's sets: a set of each category (its showcase where the library has one), the beach's
 * two */
const BLOCK_SETS: Record<WetKey, readonly string[]> = {
  SAND: ['sand02'],
  MUD: ['mud02'],
  ROCKS: ['rocks01'],
  CLIFF: ['cliffs01'],
  SNOW: ['snow01'],
  ICE: ['ice01'],
  GRASS: ['grass01'],
  CONCRETE: ['concrete02'],
  BEACH: ['sand02', 'rocks01'],
};

/** Rows from the back (−z), left to right */
const GRID: readonly (readonly WetKey[])[] = [
  ['SAND', 'MUD', 'ROCKS'],
  ['CLIFF', 'SNOW', 'ICE'],
  ['GRASS', 'CONCRETE', 'BEACH'],
];
/** The right column's centre: two gaps left of the Splatting row */
const RIGHT_X = SPLATTING_ROW_BOUNDS.minX - 2 * BLOCK_GAP - BLOCK_SIZE / 2;
/** Each block's seed: this plus its index, apart from the other rows' */
const SEED_BASE = 307;
/** The beach's rocks: on slopes past this, degrees (the ramp is 35°, the flat's noise under 10°) */
const BEACH_ROCK_SLOPE = 22;
/** The puddle patches' macro tile, metres: a patch is a fifth of it, about two across a block */
const PUDDLE_PATCH_SCALE = 30;
/** The block with a regional wetness, and its band: fully wet up to the first distance from the
 * left edge, metres, dry past the second */
export const REGIONAL_WET_KEY: WetKey = 'GRASS';
const REGIONAL_WET_BAND = [2, 5] as const;
/** The regional wetness's vertex attribute (the terrain material's default) */
const REGIONAL_WET_ATTRIBUTE = '_wetness';

/** The row's nine blocks, by row from the back and left to right */
export const WET_BLOCKS: readonly WetBlock[] = GRID.flatMap((keys, row) =>
  keys.map((key, col) => ({
    key,
    title: key === 'BEACH' ? 'Beach (sand, rocks)' : `${key.toLowerCase()} (${BLOCK_SETS[key][0]})`,
    sets: BLOCK_SETS[key],
    x: RIGHT_X - (keys.length - 1 - col) * BLOCK_PITCH,
    z: (row - (GRID.length - 1) / 2) * BLOCK_PITCH,
    seed: SEED_BASE + row * keys.length + col,
  }))
);

/** The row's extent on the ground, metres */
export const WET_ROW_BOUNDS = {
  minX: RIGHT_X - (GRID[0].length - 1) * BLOCK_PITCH - BLOCK_SIZE / 2,
  maxX: RIGHT_X + BLOCK_SIZE / 2,
  minZ: -((GRID.length - 1) / 2) * BLOCK_PITCH - BLOCK_SIZE / 2,
  maxZ: ((GRID.length - 1) / 2) * BLOCK_PITCH + BLOCK_SIZE / 2,
};

/** A block's mesh entity's app id */
export const getWetAppId = (key: WetKey) => `terrainGallery_wet_${key}`;

/** A block's code route config: its sets, wet (`FULL`, puddles in patches; the grass block's
 * regional wetness); the beach's rocks by slope */
const getBlockConfig = (block: WetBlock): TerrainMaterialConfig => ({
  id: `terrainGalleryWet_${block.key}`,
  layers: block.sets.map((set) => ({ set })),
  ...(block.sets.length > 1
    ? {
        blend: {
          source: 'RULES',
          rules: [{ layer: 1, slope: { min: BEACH_ROCK_SLOPE, softness: 8 } }],
        },
      }
    : {}),
  wet: {
    puddles: { patches: { scale: PUDDLE_PATCH_SCALE } },
    ...(block.key === REGIONAL_WET_KEY ? { regional: {} } : {}),
  },
});

/**
 * A block's material for the view: its code route material, or that material's variant with the
 * quality and the debug view (one shader per variant, made on first use)
 */
const getBlockMaterial = (block: WetBlock, view: WetRowView): THREE.Material => {
  const config = getBlockConfig(block);
  createTerrainMaterial(config);
  const base = existsOrThrow(
    getMaterial(config.id),
    `[terrainGallery] No material "${config.id}".`
  );
  if (view.quality === 'FULL' && view.debugView === 'NONE') return base;
  const terrain = base.userData.terrainDefine as { wet?: { puddles?: object } };
  // SIMPLE has no puddles (no relief to fill)
  const { puddles, ...wet } = terrain.wet ?? {};
  return getMaterialVariant(config.id, {
    staticDefines: {
      terrain: {
        ...terrain,
        wet: { ...wet, ...(view.quality === 'FULL' ? { puddles } : {}), quality: view.quality },
        ...(view.debugView === 'NONE' ? {} : { debugView: view.debugView }),
      },
    },
  });
};

/**
 * Switches the row's blocks to the view's quality and debug view (`WETNESS` needs the terrain
 * debug views loaded first: `loadTerrainDebugViewsAsync`)
 */
export const setWetRowView = (view: WetRowView) => {
  for (const block of WET_BLOCKS) {
    const mesh = getMeshByAppId(getWetAppId(block.key));
    if (mesh) setMeshMaterial(mesh, getBlockMaterial(block, view));
  }
};

/**
 * A block geometry with the regional wetness's band along its left edge (−x), once: the
 * geometry is the block's own (its seed's), kept across visits
 */
const withRegionalWetness = (geometry: THREE.BufferGeometry) => {
  if (geometry.getAttribute(REGIONAL_WET_ATTRIBUTE)) return geometry;
  const positions = geometry.getAttribute('position');
  const wetness = new Float32Array(positions.count);
  const [wet, dry] = REGIONAL_WET_BAND;
  for (let i = 0; i < positions.count; i++) {
    const fromEdge = positions.getX(i) + BLOCK_SIZE / 2;
    wetness[i] = 1 - THREE.MathUtils.smoothstep(fromEdge, wet, dry);
  }
  geometry.setAttribute(REGIONAL_WET_ATTRIBUTE, new THREE.BufferAttribute(wetness, 1));
  return geometry;
};

/** Creates the row's blocks, each on the library's generated block with its own seed */
export const createWetRow = () => {
  for (const block of WET_BLOCKS) {
    const geometry = getBlockGeometry(block.seed);
    createMeshEntity(
      {
        geo: block.key === REGIONAL_WET_KEY ? withRegionalWetness(geometry) : geometry,
        mat: getBlockMaterial(block, { quality: 'FULL', debugView: 'NONE' }),
        position: { x: block.x, z: block.z },
        ...NO_SHADOWS,
      },
      { appId: getWetAppId(block.key), debugData: { name: `Wet/dry: ${block.title}` } }
    );
  }
};
