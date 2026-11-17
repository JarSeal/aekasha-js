// The terrain gallery's Splatting row (p305 Phase 3): six 24 × 24 m generated blocks left of the
// library, each blending several texture sets by painted weights. The weights are made here in
// code from one pattern (`paintWeights`: rocky blobs, a sandy path, mud in the hollows, snow on the
// tops, and for the 9-layer block a cliff band, an ice pool, a grass patch and a mud ring): written
// into the blocks' vertex colours and into splat map `DataTexture`s (p306 brings the Blender
// versions). Rows from the back, `LINEAR` left of `HEIGHT`: the vertex colour (`RGBA`, 5 layers),
// the splat map (5 layers), then `RGB_AO` with the vertex AO (4 layers) left of the 9-layer block
// (two splat maps). Each block is a code route material (`createTerrainMaterial`, storage `AUTO`)
// with the gallery's quality table (p305 Phase 6): its tiers' sparse sampling reads the layers
// from a set array, so `AUTO` takes `ARRAY` for every block (one set array per list, which the
// scene's `textureSetArrays` lists, so its load builds them; Phase 3's vertex colour blocks bound
// their 10 textures `SEPARATE`). Not the JSON route's `terrain` with variants: a variant can't drop
// `terrain`'s `layer0` input for `ARRAY`'s `layers`. The debug view and the tier are a variant of
// the block's material.
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
import { generateTerrain } from 'aekasha/toolkit/geometry';
import {
  createTerrainMaterial,
  getTerrainMaterialProps,
  type TerrainMaterialConfig,
  type TerrainMaterialDefine,
} from 'aekasha/toolkit/terrain';
import {
  BLOCK_GAP,
  BLOCK_PITCH,
  getGalleryQuality,
  getTerrainBlockVariant,
  NO_SHADOWS,
  setMaterialUniform,
  type GalleryDebugView,
  type GalleryQuality,
} from './galleryBlocks';

/** A block's side, metres: room for every layer's patch */
export const SPLATTING_BLOCK_SIZE = 24;
const PITCH = SPLATTING_BLOCK_SIZE + BLOCK_GAP;
/** 0.25 m between vertices: the vertex colour's borders */
const SEGMENTS = 96;
/** The splat maps' texels a side: 9.4 cm a texel over a block */
const SPLAT_SIZE = 256;
const TERRAIN_SEED = 305;
/** The terrain's peak height, metres: hollows and tops for the mud and the snow */
const MAX_HEIGHT = 1.6;
const NOISE_OCTAVES = [
  { frequency: 1 / 10, amplitude: 1 },
  { frequency: 1 / 4, amplitude: 0.35 },
];
/** The gallery's ground top (`terrainGallery.ts`' `GROUND_Y`) */
const GROUND_TOP_Y = -0.6;
/** The blocks' lift, so the deepest hollow stands on the ground (the library's 0.4 m noise doesn't
 * reach it) */
export const SPLATTING_BLOCK_Y = GROUND_TOP_Y + MAX_HEIGHT;

/** The layers' sets: the base first, then a set per painted channel */
const SETS_5 = ['grass01', 'rocks01', 'sand01', 'mud01', 'snow01'];
const SETS_9 = [...SETS_5, 'cliffs01', 'ice01', 'grass02', 'mud02'];
/** The splat maps' texture ids */
const SPLAT_5_ID = 'terrainGallerySplat5.splat0';
const SPLAT_9_IDS = ['terrainGallerySplat9.splat0', 'terrainGallerySplat9.splat1'];
const GEOMETRY_RGBA_ID = 'terrainGallerySplatBlock';
const GEOMETRY_RGB_AO_ID = 'terrainGallerySplatBlockAo';

/** The row's blocks */
export const SPLATTING_KEYS = [
  'VERTEX_LINEAR',
  'VERTEX_HEIGHT',
  'SPLAT_LINEAR',
  'SPLAT_HEIGHT',
  'VERTEX_AO',
  'ARRAY_9',
] as const;
/** One of {@link SPLATTING_KEYS} */
export type SplattingKey = (typeof SPLATTING_KEYS)[number];

/** A block of the row: what it shows and where it stands */
export type SplattingBlock = {
  key: SplattingKey;
  title: string;
  description: string;
  /** The layers' sets, the base first */
  sets: string[];
  /** The block's define, without the debug view */
  define: TerrainMaterialDefine;
  x: number;
  z: number;
  geometryId: string;
};

const layersOf = (count: number) => Array.from({ length: count }, () => ({}));

const RGBA_BLEND = { source: 'VERTEX_COLOR', vertexColor: { layout: 'RGBA' } } as const;
const DEFINES: Record<SplattingKey, TerrainMaterialDefine> = {
  VERTEX_LINEAR: { layers: layersOf(5), blend: { ...RGBA_BLEND, mode: 'LINEAR' } },
  VERTEX_HEIGHT: { layers: layersOf(5), blend: RGBA_BLEND },
  SPLAT_LINEAR: { layers: layersOf(5), blend: { source: 'SPLAT_MAP', mode: 'LINEAR' } },
  SPLAT_HEIGHT: { layers: layersOf(5), blend: { source: 'SPLAT_MAP' } },
  VERTEX_AO: {
    layers: layersOf(4),
    blend: { source: 'VERTEX_COLOR', vertexColor: { layout: 'RGB_AO' } },
    ao: { vertex: true },
  },
  ARRAY_9: { layers: layersOf(9), blend: { source: 'SPLAT_MAP' } },
};

const DESCRIPTIONS: Record<SplattingKey, [string, string]> = {
  VERTEX_LINEAR: ['Vertex colour, linear', 'RGBA, 5 layers, the weights alone: soft borders'],
  VERTEX_HEIGHT: ['Vertex colour, height', 'RGBA, 5 layers, the heights decide the borders'],
  SPLAT_LINEAR: ['Splat map, linear', '256² RGBA at the mesh UV, 5 layers, the weights alone'],
  SPLAT_HEIGHT: ['Splat map, height', '256² RGBA at the mesh UV, 5 layers, by height'],
  VERTEX_AO: ['Vertex colour + AO', 'RGB_AO, 4 layers, A to aoNode (indirect light), by height'],
  ARRAY_9: ['9 layers', 'Two splat maps, one set array (2 textures for 9 sets), by height'],
};

/** Rows from the back (−z), the left column's block first */
const GRID: [SplattingKey, SplattingKey][] = [
  ['VERTEX_LINEAR', 'VERTEX_HEIGHT'],
  ['SPLAT_LINEAR', 'SPLAT_HEIGHT'],
  ['VERTEX_AO', 'ARRAY_9'],
];
/** The right column's centre: the library's left edge less a gap */
const RIGHT_X = -(2 * BLOCK_PITCH) - BLOCK_GAP / 2 - BLOCK_GAP - SPLATTING_BLOCK_SIZE / 2;

/** The six blocks, by row from the back, left to right */
export const SPLATTING_BLOCKS: readonly SplattingBlock[] = GRID.flatMap((keys, row) =>
  keys.map((key, col) => ({
    key,
    title: DESCRIPTIONS[key][0],
    description: DESCRIPTIONS[key][1],
    sets: key === 'ARRAY_9' ? SETS_9 : SETS_5.slice(0, DEFINES[key].layers.length),
    define: DEFINES[key],
    x: RIGHT_X - (1 - col) * PITCH,
    z: (row - (GRID.length - 1) / 2) * PITCH,
    geometryId: key === 'VERTEX_AO' ? GEOMETRY_RGB_AO_ID : GEOMETRY_RGBA_ID,
  }))
);

/** The row's extent on the ground, for the gallery's ground */
export const SPLATTING_ROW_BOUNDS = {
  minX: RIGHT_X - PITCH - SPLATTING_BLOCK_SIZE / 2,
  maxX: RIGHT_X + SPLATTING_BLOCK_SIZE / 2,
  minZ: -((GRID.length - 1) / 2) * PITCH - SPLATTING_BLOCK_SIZE / 2,
  maxZ: ((GRID.length - 1) / 2) * PITCH + SPLATTING_BLOCK_SIZE / 2,
};

/** The row's live values, uniforms on every block that has them (the tab's) */
export type SplattingValues = {
  heightBlendDepth: number;
  /** Layer 1's (rocks01) `heightOffset` */
  rocksOffset: number;
  vertexAoInfluence: number;
};
export const DEFAULT_SPLATTING_VALUES: Readonly<SplattingValues> = {
  heightBlendDepth: 0.2,
  rocksOffset: 0,
  vertexAoInfluence: 0.5,
};
const values: SplattingValues = { ...DEFAULT_SPLATTING_VALUES };
let debugView: GalleryDebugView = 'NONE';
let quality: GalleryQuality = 'OWN';

/** The live values (the tab's fields bind them; {@link applySplattingValues} after a change) */
export const getSplattingValues = () => values;

/** A block's mesh entity's app id */
export const getSplattingAppId = (key: SplattingKey) => `terrainGallery_splatting_${key}`;

// The painted pattern: smooth masks of the block's local x, z (metres from its centre) and height
const smoothstep = (from: number, to: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)));
  return t * t * (3 - 2 * t);
};
const disk = (x: number, z: number, cx: number, cz: number, radius: number) =>
  1 - smoothstep(radius - 0.6, radius + 0.6, Math.hypot(x - cx, z - cz));

/**
 * The painted weights of layers 1 to `count` at a point (layer 0, grass, takes what they leave),
 * scaled to sum to 1 at most: rocks in blobs, a sandy path, mud in the hollows, snow on the tops,
 * then a cliff band, an ice pool, a grass patch and a mud ring
 */
const paintWeights = (x: number, z: number, h: number, count: number) => {
  const masks = [
    smoothstep(0.35, 0.75, Math.sin(0.55 * x + 0.4) * Math.sin(0.47 * z + 1.3)),
    1 - smoothstep(0.9, 2.1, Math.abs(z - 4.5 * Math.sin(0.26 * x + 0.5))),
    1 - smoothstep(-0.95, -0.55, h),
    smoothstep(0.55, 0.95, h),
    1 - smoothstep(0.8, 1.6, Math.abs(x - 8)),
    disk(x, z, -6, 7, 2.6),
    disk(x, z, -7, -6, 3.4),
    1 - smoothstep(0.4, 1, Math.abs(Math.hypot(x, z) - 9.5)),
  ].slice(0, count);
  const sum = masks.reduce((total, mask) => total + mask, 0);
  return sum > 1 ? masks.map((mask) => mask / sum) : masks;
};

/** `RGB_AO`'s baked AO: the hollows darker */
const paintAo = (h: number) => 0.35 + 0.65 * smoothstep(-1.2, 0.4, h);

/** The blocks' terrain (one seed, so every block has the same ground) */
const generateBlockTerrain = () =>
  generateTerrain({
    width: SPLATTING_BLOCK_SIZE,
    depth: SPLATTING_BLOCK_SIZE,
    widthSegments: SEGMENTS,
    depthSegments: SEGMENTS,
    maxHeight: MAX_HEIGHT,
    noiseOctaves: NOISE_OCTAVES,
    seed: TERRAIN_SEED,
  });

type BlockTerrain = ReturnType<typeof generateBlockTerrain>;

/**
 * A block geometry with its vertex colour (`COLOR_0`, RGBA, linear): `RGBA` four layers' weights,
 * `RGB_AO` three and the AO
 */
const getBlockGeometry = (terrain: BlockTerrain, id: string, isRgbAo: boolean) => {
  const registered = getGeometry(id);
  if (registered) return registered;
  const geometry = terrain.geometry.clone();
  // A copy shares its source's userData (three's `copy`): its own, for its registry id
  geometry.userData = {};
  const positions = geometry.getAttribute('position');
  const colors = new Float32Array(positions.count * 4);
  for (let i = 0; i < positions.count; i++) {
    const h = positions.getY(i);
    const weights = paintWeights(positions.getX(i), positions.getZ(i), h, isRgbAo ? 3 : 4);
    colors.set(isRgbAo ? [...weights, paintAo(h)] : weights, i * 4);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
  return saveBufferGeometry(geometry, { id });
};

/**
 * A splat map of the pattern's layers `first` to `first + 3` (RGBA, linear, mipmapped), its texel
 * centres at the block's UV (`generateTerrain`'s: U along +x, V along +z from the −x, −z corner),
 * registered as the scene's
 */
const getSplatMap = (terrain: BlockTerrain, id: string, first: number, count: number) => {
  const registered = getTexture(id);
  if (registered) return registered;
  const data = new Uint8Array(SPLAT_SIZE * SPLAT_SIZE * 4);
  const half = SPLATTING_BLOCK_SIZE / 2;
  for (let row = 0; row < SPLAT_SIZE; row++) {
    const z = ((row + 0.5) / SPLAT_SIZE) * SPLATTING_BLOCK_SIZE - half;
    for (let col = 0; col < SPLAT_SIZE; col++) {
      const x = ((col + 0.5) / SPLAT_SIZE) * SPLATTING_BLOCK_SIZE - half;
      const weights = paintWeights(x, z, terrain.getHeightAt(x, z), count).slice(first, first + 4);
      weights.forEach((w, channel) => {
        data[(row * SPLAT_SIZE + col) * 4 + channel] = Math.round(w * 255);
      });
    }
  }
  const map = new THREE.DataTexture(data, SPLAT_SIZE, SPLAT_SIZE, THREE.RGBAFormat);
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.magFilter = THREE.LinearFilter;
  map.generateMipmaps = true;
  map.needsUpdate = true;
  return saveTexture(map, id);
};

/** A block's code route config: its sets, splat maps and define, storage `AUTO` */
const getBlockConfig = (block: SplattingBlock): TerrainMaterialConfig => {
  // The row's defines have no macro or colour map (the code route's take their texture ids)
  const { layers, macro: _macro, colorMap: _colorMap, ...settings } = block.define;
  const isSplat = settings.blend?.source === 'SPLAT_MAP';
  return {
    id: `terrainGallerySplatting_${block.key}`,
    layers: block.sets.map((set, i) => ({ set, ...layers[i] })),
    ...(isSplat ? { splatMaps: block.key === 'ARRAY_9' ? SPLAT_9_IDS : [SPLAT_5_ID] } : {}),
    ...settings,
    quality: getGalleryQuality(),
  };
};

/** The storage `AUTO` chose for a block: `ARRAY` binds its sets as one `layers` set array */
export const getSplattingStorage = (block: SplattingBlock) =>
  'layers' in (getTerrainMaterialProps(getBlockConfig(block)).inputs ?? {}) ? 'ARRAY' : 'SEPARATE';

/**
 * A block's material: its code route material, or that material's variant with the debug view and
 * the quality tier
 */
const getBlockMaterial = (block: SplattingBlock) => {
  const config = getBlockConfig(block);
  createTerrainMaterial(config);
  return getTerrainBlockVariant(config.id, { debugView, quality });
};

/** The live values on a block's material: the uniforms it has */
const writeValues = (material: THREE.Material) => {
  setMaterialUniform(material, 'terrain_heightBlendDepth', values.heightBlendDepth);
  setMaterialUniform(material, 'terrain_l1_heightOffset', values.rocksOffset);
  setMaterialUniform(material, 'terrain_aoVertexInfluence', values.vertexAoInfluence);
};

/** Writes the live values into every block's material (after a field's change) */
export const applySplattingValues = () => {
  for (const { key } of SPLATTING_BLOCKS) {
    const mesh = getMeshByAppId(getSplattingAppId(key));
    if (mesh) writeValues(mesh.material as THREE.Material);
  }
};

/**
 * Shows the debug view and the quality tier on the blocks: each swaps to its variant (made the
 * first time), the live values written in. The views must be loaded (`loadTerrainDebugViewsAsync`).
 */
export const setSplattingView = (view: GalleryDebugView, tier: GalleryQuality) => {
  debugView = view;
  quality = tier;
  for (const block of SPLATTING_BLOCKS) {
    const mesh = getMeshByAppId(getSplattingAppId(block.key));
    if (!mesh) continue;
    const material = getBlockMaterial(block);
    writeValues(material);
    setMeshMaterial(mesh, material);
  }
};

/**
 * Creates the row (the scene's load): the two geometries and three splat maps painted, then the
 * six blocks with their materials, the scene's defaults (the tab applies its view)
 */
export const createSplattingRow = () => {
  debugView = 'NONE';
  quality = 'OWN';
  Object.assign(values, DEFAULT_SPLATTING_VALUES);
  const terrain = generateBlockTerrain();
  const geometries: Record<string, THREE.BufferGeometry> = {
    [GEOMETRY_RGBA_ID]: getBlockGeometry(terrain, GEOMETRY_RGBA_ID, false),
    [GEOMETRY_RGB_AO_ID]: getBlockGeometry(terrain, GEOMETRY_RGB_AO_ID, true),
  };
  getSplatMap(terrain, SPLAT_5_ID, 0, 4);
  SPLAT_9_IDS.forEach((id, i) => getSplatMap(terrain, id, i * 4, 8));
  terrain.geometry.dispose();
  for (const block of SPLATTING_BLOCKS) {
    const material = getBlockMaterial(block);
    writeValues(material);
    createMeshEntity(
      {
        geo: geometries[block.geometryId],
        mat: material,
        position: { x: block.x, y: SPLATTING_BLOCK_Y, z: block.z },
        ...NO_SHADOWS,
      },
      { appId: getSplattingAppId(block.key), debugData: { name: `Splatting: ${block.title}` } }
    );
  }
};
