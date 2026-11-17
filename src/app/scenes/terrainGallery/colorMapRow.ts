// The terrain gallery's Colour map row (p305 Phase 7): four 64 × 64 m blocks in front of the Cliffs
// row on the Rules row's terrain (the same lift, so the rules' snow line is the same), each the
// Rules row's 8-layer material (`getEightLayersConfig`) or a variant of it with the colour map and
// far techniques (p305 D7): the source; a `DETAIL` colour map (the block's own colour under the
// layers' detail); the far `COLOR_MAP` surface (a `FAR_ONLY` colour map past the detail normals'
// fade); the far `AVERAGE_COLOR` surface (the sets' average colours by weight, no colour map). The
// two colour maps are baked during the load (`bakeTerrainColorMap`, 1024², the loader counts them)
// from the source material on each block's own mesh: the macro and the rules' noise are in world
// space, so a block's map is of its own place. The far blocks start their far surface close (24-40
// m by default: within the block) and take the quality preset's far column on their tiers (p305
// D10, `getTerrainQualityPreset({ far })`); the fades and the band are uniforms the tab writes.
import * as THREE from 'three/webgpu';
import {
  createMeshEntity,
  existsOrThrow,
  getGeometry,
  getMeshByAppId,
  setMeshMaterial,
} from 'aekasha';
import type { BakedTexture } from 'aekasha';
import {
  bakeTerrainColorMap,
  createTerrainMaterial,
  getTerrainQualityPreset,
  type TerrainMaterialConfig,
} from 'aekasha/toolkit/terrain';
import { CLIFFS_ROW_BOUNDS } from './cliffsRow';
import {
  BLOCK_GAP,
  getTerrainBlockVariant,
  NO_SHADOWS,
  setMaterialUniform,
  type GalleryDebugView,
  type GalleryQuality,
} from './galleryBlocks';
import { getEightLayersConfig, getRulesTerrain, RULES_BLOCK_SIZE, RULES_BLOCKS } from './rulesRow';

/** The row's blocks */
export const COLOR_MAP_KEYS = ['SOURCE', 'DETAIL', 'FAR_COLOR_MAP', 'FAR_AVERAGE'] as const;
/** One of {@link COLOR_MAP_KEYS} */
export type ColorMapKey = (typeof COLOR_MAP_KEYS)[number];
/** The blocks with a colour map of their own */
const BAKED_KEYS: readonly ColorMapKey[] = ['DETAIL', 'FAR_COLOR_MAP'];

/** A block of the row: what it shows and where it stands */
export type ColorMapBlock = {
  key: ColorMapKey;
  title: string;
  description: string;
  x: number;
  z: number;
  geometryId: string;
};

const DESCRIPTIONS: Record<ColorMapKey, [string, string]> = {
  SOURCE: ['Source', 'The Rules row’s 8 layers: what the colour maps are baked from'],
  DETAIL: [
    'Colour map + detail',
    'Its own baked colour map at its UV, the layers’ detail over it (faded out far away)',
  ],
  FAR_COLOR_MAP: [
    'Far: colour map',
    'The 8 layers near, its colour map alone past the detail normals’ fade (1 fetch)',
  ],
  FAR_AVERAGE: [
    'Far: average colour',
    'The 8 layers near, the sets’ average colours by weight past the fade (no layer fetch)',
  ],
};

/** The colour maps' size, texels: 6.25 cm a texel on a 64 m block */
const COLOR_MAP_SIZE = 1024;

/** Where the row stands: in front of the Cliffs row (+z), four blocks across x 0 */
const ROW_NEAR_Z = CLIFFS_ROW_BOUNDS.maxZ + 2 * BLOCK_GAP;
const ROW_Z = ROW_NEAR_Z + RULES_BLOCK_SIZE / 2;
const PITCH = RULES_BLOCK_SIZE + 2 * BLOCK_GAP;

/** The four blocks, left to right */
export const COLOR_MAP_BLOCKS: readonly ColorMapBlock[] = COLOR_MAP_KEYS.map((key, i) => ({
  key,
  title: DESCRIPTIONS[key][0],
  description: DESCRIPTIONS[key][1],
  x: (i - (COLOR_MAP_KEYS.length - 1) / 2) * PITCH,
  z: ROW_Z,
  geometryId: RULES_BLOCKS[0].geometryId,
}));

/** The row's extent on the ground, for the gallery's ground */
export const COLOR_MAP_ROW_BOUNDS = {
  minX: COLOR_MAP_BLOCKS[0].x - RULES_BLOCK_SIZE / 2,
  maxX: COLOR_MAP_BLOCKS[COLOR_MAP_BLOCKS.length - 1].x + RULES_BLOCK_SIZE / 2,
  minZ: ROW_NEAR_Z,
  maxZ: ROW_NEAR_Z + RULES_BLOCK_SIZE,
};

/** The row's live values, uniforms on the blocks that have them (the tab's) */
export type ColorMapValues = {
  /** The detail normals' fade, metres: the far surface starts at its end */
  fadeFrom: number;
  fadeTo: number;
  /** The band past the fade's end where the near surface gives way to the far one, metres */
  farBlend: number;
  /** The colour map's detail fades out over these, metres */
  detailFrom: number;
  detailTo: number;
};
/** The row's defaults: the far surface within a block, seen from its edge */
export const DEFAULT_COLOR_MAP_VALUES: Readonly<ColorMapValues> = {
  fadeFrom: 24,
  fadeTo: 40,
  farBlend: 4,
  detailFrom: 30,
  detailTo: 90,
};
const values: ColorMapValues = { ...DEFAULT_COLOR_MAP_VALUES };
let debugView: GalleryDebugView = 'NONE';
let quality: GalleryQuality = 'OWN';
/** This load's bakes, by block */
const bakes = new Map<ColorMapKey, BakedTexture>();

/** The live values (the tab's fields bind them; {@link applyColorMapValues} after a change) */
export const getColorMapValues = () => values;

/** A block's mesh entity's app id */
export const getColorMapAppId = (key: ColorMapKey) => `terrainGallery_colorMap_${key}`;

/** A block's colour map's bake id: its texture is `<id>.color` */
const getBakeId = (key: ColorMapKey) => `terrainGalleryColorMap_${key}`;

/** The source's config: the Rules row's 8-layer block's, its material the same (one shader) */
const getSourceConfig = (): TerrainMaterialConfig => getEightLayersConfig();

/**
 * A block's code route config: the source's, with its colour map (its own bake) and far surface,
 * the far blocks' tiers the preset's far column
 */
const getBlockConfig = (key: ColorMapKey): TerrainMaterialConfig => {
  const source = getSourceConfig();
  if (key === 'SOURCE') return source;
  const id = `terrainGalleryColorMap_${key}`;
  const texture = `${getBakeId(key)}.color`;
  const { fadeFrom, fadeTo, detailFrom, detailTo } = DEFAULT_COLOR_MAP_VALUES;
  if (key === 'DETAIL') {
    return {
      ...source,
      id,
      colorMap: { mode: 'DETAIL', texture, detailDistance: [detailFrom, detailTo] },
    };
  }
  const cliffLayers = [source.layers.findIndex(({ set }) => set === 'cliffs01')];
  const far = key === 'FAR_COLOR_MAP' ? 'COLOR_MAP' : 'AVERAGE_COLOR';
  return {
    ...source,
    id,
    ...(far === 'COLOR_MAP' ? { colorMap: { mode: 'FAR_ONLY' as const, texture } } : {}),
    distance: { fade: [fadeFrom, fadeTo], far },
    quality: getTerrainQualityPreset({ cliffLayers, far }),
  };
};

/**
 * A block's material: its code route material, or its variant with the debug view and the quality
 * tier (a debug view shows the near surface everywhere: the far branch isn't built)
 */
const getBlockMaterial = (key: ColorMapKey) => {
  const config = getBlockConfig(key);
  createTerrainMaterial(config);
  return getTerrainBlockVariant(config.id, { debugView, quality });
};

/** The live values on a block's material (each sets those its material has) */
const writeValues = (material: THREE.Material) => {
  const to = Math.max(values.fadeTo, values.fadeFrom + 0.5);
  setMaterialUniform(material, 'terrain_distanceFade', new THREE.Vector2(values.fadeFrom, to));
  setMaterialUniform(material, 'terrain_farBlend', values.farBlend);
  const detailTo = Math.max(values.detailTo, values.detailFrom + 0.5);
  setMaterialUniform(
    material,
    'terrain_detailDistance',
    new THREE.Vector2(values.detailFrom, detailTo)
  );
};

/** Writes the live values into the blocks' materials (after a field's change) */
export const applyColorMapValues = () => {
  for (const key of COLOR_MAP_KEYS) {
    const mesh = getMeshByAppId(getColorMapAppId(key));
    if (mesh) writeValues(mesh.material as THREE.Material);
  }
};

/**
 * Shows the debug view and the quality tier on the blocks: each swaps to its variant (made the
 * first time), the live values written in. The views must be loaded (`loadTerrainDebugViewsAsync`).
 */
export const setColorMapView = (view: GalleryDebugView, tier: GalleryQuality) => {
  debugView = view;
  quality = tier;
  for (const key of COLOR_MAP_KEYS) {
    const mesh = getMeshByAppId(getColorMapAppId(key));
    if (!mesh) continue;
    const material = getBlockMaterial(key);
    writeValues(material);
    setMeshMaterial(mesh, material);
  }
};

/** What a block shows, for its list row: its far surface, its colour map */
export const getColorMapSummary = (key: ColorMapKey) => {
  const config = getBlockConfig(key);
  const parts = [
    config.colorMap ? `${config.colorMap.mode} colour map` : null,
    config.distance?.far ? `far ${config.distance.far}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : '8 layers';
};

/**
 * Bakes the colour maps again from the source material on each block's mesh (its uniforms as made:
 * the Rules tab's live values don't reach it)
 */
export const rebakeColorMapsAsync = () =>
  Promise.all([...bakes.values()].map((bake) => bake.rebake()));

/**
 * Creates the row (the scene's load, after the Rules row: its terrain and lift): the blocks with
 * the source material, the two colour maps' bakes started (their textures exist at once), then
 * the blocks' own materials; resolves once both are baked.
 */
export const createColorMapRowAsync = async () => {
  debugView = 'NONE';
  quality = 'OWN';
  Object.assign(values, DEFAULT_COLOR_MAP_VALUES);
  bakes.clear();
  const geometry = existsOrThrow(
    getGeometry(RULES_BLOCKS[0].geometryId),
    'The Colour map row needs the Rules row’s terrain.'
  );
  const source = createTerrainMaterial(getSourceConfig());
  const { y } = getRulesTerrain();
  for (const block of COLOR_MAP_BLOCKS) {
    createMeshEntity(
      { geo: geometry, mat: source, position: { x: block.x, y, z: block.z }, ...NO_SHADOWS },
      { appId: getColorMapAppId(block.key), debugData: { name: `Colour map: ${block.title}` } }
    );
  }
  const baking = BAKED_KEYS.map((key) => {
    const mesh = existsOrThrow(getMeshByAppId(getColorMapAppId(key)), `No block ${key}.`);
    const bake = bakeTerrainColorMap({
      id: getBakeId(key),
      mesh,
      material: source,
      size: COLOR_MAP_SIZE,
    });
    return bake.then((baked) => bakes.set(key, baked));
  });
  for (const key of COLOR_MAP_KEYS) {
    const mesh = getMeshByAppId(getColorMapAppId(key));
    if (!mesh) continue;
    const material = getBlockMaterial(key);
    writeValues(material);
    setMeshMaterial(mesh, material);
  }
  await Promise.all(baking);
};
