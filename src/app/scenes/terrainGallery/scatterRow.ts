// The terrain gallery's Scatter row (p308 Phase 4): one 24 m block in front of the Wet/dry row,
// rocks01 patches over sand02 split down the middle by its vertex colour (R the left half's,
// layer 1; G the right half's, layer 2, the same set), the toolkit's procedural rocks
// (`generateRock`'s pebbles, rocks and boulders, `saveRockGeometries`) on the left half's rock in
// the `rockScatter` material over rocks01, the ground's set, and the toolkit's imported rocks (Poly
// Haven's, `models/nature/`: pebbles, the pebbles scaled into rocks, a boulder) on the right
// half's in `rockScatter` at their own maps' UV, each placed by `terrainScatter` with the same
// params. Right of it, a 12 m patch of grass02 with mud02 patches under the toolkit's leaf litter
// cards (`generateLeafCard` in the `leafLitter` material, a leaf of its atlas per card). The
// grounds' terrain materials, the rocks and the leaves are wet by the surface conditions alike
// (the tab's weather). Code route materials, no shadows (the gallery's).
import * as THREE from 'three/webgpu';
import { SimplexNoise } from 'three/examples/jsm/math/SimplexNoise.js';
import {
  createMeshEntity,
  createSeededRandom,
  getECSWorld,
  getEntityIdByAppId,
  getGeometry,
  saveBufferGeometry,
} from 'aekasha';
import { spawnScatter } from 'aekasha/instancing';
import {
  generateTerrain,
  saveLeafCardGeometry,
  saveRockGeometries,
} from 'aekasha/toolkit/geometry';
import { createTerrainMaterial, type TerrainMaterialConfig } from 'aekasha/toolkit/terrain';
import { BLOCK_GAP, NO_SHADOWS } from './galleryBlocks';
import { SPLATTING_ROW_BOUNDS } from './splattingRow';
import { WET_ROW_BOUNDS } from './wetRow';

export const SCATTER_BLOCK_SIZE = 24;
const LEAF_BLOCK_SIZE = 12;
/** 0.25 m between vertices: the patches' borders */
const SEGMENTS_A_METRE = 4;
const MAX_HEIGHT = 0.8;
const NOISE_OCTAVES = [
  { frequency: 1 / 9, amplitude: 1 },
  { frequency: 1 / 3, amplitude: 0.3 },
];
/** The blocks' lift, so their hollows stand on the ground (`terrainGallery.ts`' top at −0.6 m) */
const LIFT = 0.2;
/** The patches: a seeded simplex over this many metres, painted from the first value to the
 * second */
const PATCH_SCALE = 7;
const PATCH_EDGES = [-0.15, 0.25] as const;
/** The rock block's halves' seam, metres either side of x = 0 over which their layers cross-fade */
const SEAM_HALF_WIDTH = 0.5;
/** The puddle patches' macro tile, metres (the Wet/dry row's) */
const PUDDLE_PATCH_SCALE = 30;
/** The grounds' wet response: the Wet/dry row's blocks' (puddles in patches, ripples, frost) */
const GROUND_WET: TerrainMaterialConfig['wet'] = {
  puddles: { patches: { scale: PUDDLE_PATCH_SCALE } },
  ripples: {},
  frost: { sparkle: {} },
};

/** A block of the row: its terrain, the vertex colour its patches paint, its ground and scatters */
type ScatterRowBlock = {
  appId: string;
  title: string;
  x: number;
  z: number;
  size: number;
  seed: number;
  /** The vertex colour (RGBA, linear) at a point of the block, from its patches' weight there */
  paint: (x: number, z: number, patch: number) => [number, number, number, number];
  ground: Omit<TerrainMaterialConfig, 'id'>;
  scatters: readonly string[];
};

/** The rock block's centre: in front of the Wet/dry row (+z), past the Splatting row's front */
const ROCK_X = (WET_ROW_BOUNDS.minX + WET_ROW_BOUNDS.maxX) / 2;
const ROCK_Z =
  Math.max(WET_ROW_BOUNDS.maxZ, SPLATTING_ROW_BOUNDS.maxZ) + 2 * BLOCK_GAP + SCATTER_BLOCK_SIZE / 2;

/**
 * The row's blocks. The rocks: sand02 and rocks01 by the vertex colour's R (the left half's rock,
 * layer 1: the procedural rocks') and G (the right half's, layer 2, the same set: the imported
 * rocks'). The leaves: grass02 and mud02 by R (layer 1), the cards over both.
 */
const BLOCKS: readonly ScatterRowBlock[] = [
  {
    appId: 'terrainGallery_scatterBlock',
    title: 'rocks',
    x: ROCK_X,
    z: ROCK_Z,
    size: SCATTER_BLOCK_SIZE,
    seed: 308,
    paint: (x, _z, patch) => {
      const left = 1 - THREE.MathUtils.smoothstep(x, -SEAM_HALF_WIDTH, SEAM_HALF_WIDTH);
      return [patch * left, patch * (1 - left), 0, 1];
    },
    ground: {
      layers: [{ set: 'sand02' }, { set: 'rocks01' }, { set: 'rocks01' }],
      blend: { source: 'VERTEX_COLOR', vertexColor: { layout: 'RGB_AO' } },
      wet: GROUND_WET,
    },
    scatters: [
      'terrainGalleryScatterPebbles',
      'terrainGalleryScatterRocks',
      'terrainGalleryScatterBoulders',
      'terrainGalleryScatterImportedPebbles',
      'terrainGalleryScatterImportedRocks',
      'terrainGalleryScatterImportedBoulders',
    ],
  },
  {
    appId: 'terrainGallery_scatterLeafBlock',
    title: 'leaves',
    x: ROCK_X + SCATTER_BLOCK_SIZE / 2 + BLOCK_GAP + LEAF_BLOCK_SIZE / 2,
    z: ROCK_Z + (SCATTER_BLOCK_SIZE - LEAF_BLOCK_SIZE) / 2,
    size: LEAF_BLOCK_SIZE,
    seed: 309,
    paint: (_x, _z, patch) => [patch, 0, 0, 1],
    ground: {
      layers: [{ set: 'grass02' }, { set: 'mud02' }],
      blend: { source: 'VERTEX_COLOR', vertexColor: { layout: 'RGB_AO' } },
      wet: GROUND_WET,
    },
    scatters: ['terrainGalleryScatterLeaves'],
  },
];

/** The row's extent on the ground, metres */
export const SCATTER_ROW_BOUNDS = {
  minX: Math.min(...BLOCKS.map((block) => block.x - block.size / 2)),
  maxX: Math.max(...BLOCKS.map((block) => block.x + block.size / 2)),
  minZ: Math.min(...BLOCKS.map((block) => block.z - block.size / 2)),
  maxZ: Math.max(...BLOCKS.map((block) => block.z + block.size / 2)),
};

/** The rock block's centre and size, and the leaf block's, for the tab's camera */
export const SCATTER_BLOCK = { x: BLOCKS[0].x, z: BLOCKS[0].z, size: BLOCKS[0].size };
export const LEAF_BLOCK = { x: BLOCKS[1].x, z: BLOCKS[1].z, size: BLOCKS[1].size };

/** The row's scatters, every block's */
export const SCATTER_ROW_SCATTERS = BLOCKS.flatMap((block) => block.scatters);

const getGeometryId = (block: ScatterRowBlock) => `${block.appId}_geometry`;
const getMaterialId = (block: ScatterRowBlock) => `${block.appId}_ground`;

/** A block's geometry with its vertex colour: its patches (a seeded simplex) painted */
const buildBlockGeometry = (block: ScatterRowBlock) => {
  const segments = block.size * SEGMENTS_A_METRE;
  const { geometry } = generateTerrain({
    width: block.size,
    depth: block.size,
    widthSegments: segments,
    depthSegments: segments,
    maxHeight: MAX_HEIGHT,
    noiseOctaves: NOISE_OCTAVES,
    seed: block.seed,
  });
  const noise = new SimplexNoise({ random: createSeededRandom(block.seed) });
  const positions = geometry.getAttribute('position');
  const colors = new Float32Array(positions.count * 4);
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    const patch = THREE.MathUtils.smoothstep(
      noise.noise(x / PATCH_SCALE, z / PATCH_SCALE),
      ...PATCH_EDGES
    );
    colors.set(block.paint(x, z, patch), i * 4);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
  return geometry;
};

/**
 * Creates the row: the toolkit's rocks and leaf card registered, then each block and its scatters,
 * one after another. Resolves early when the scene is left meanwhile.
 * @param isCurrent whether the visit that started it is still the scene's
 */
export const createScatterRowAsync = async (isCurrent: () => boolean) => {
  saveRockGeometries();
  saveLeafCardGeometry();
  for (const block of BLOCKS) {
    const materialId = getMaterialId(block);
    createTerrainMaterial({ id: materialId, ...block.ground });
    const position = { x: block.x, y: LIFT, z: block.z };
    const geometryId = getGeometryId(block);
    createMeshEntity(
      {
        geo:
          getGeometry(geometryId) ??
          saveBufferGeometry(buildBlockGeometry(block), { id: geometryId }),
        mat: materialId,
        position,
        ...NO_SHADOWS,
      },
      { appId: block.appId, debugData: { name: `Scatter: ${block.title}` } }
    );
    const entityId = getEntityIdByAppId(block.appId, getECSWorld());
    for (const id of block.scatters) {
      const spawned = await spawnScatter(id, {
        target: { position, grid: { x: 0, z: 0 }, size: block.size, entityId },
      });
      if (!spawned || !isCurrent()) return;
    }
  }
};
