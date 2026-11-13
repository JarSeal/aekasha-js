import * as THREE from 'three/webgpu';
import {
  createMeshEntity,
  existsOrThrow,
  getGeometry,
  getMaterial,
  saveBufferGeometry,
  type MaterialVariantOverrides,
} from 'aekasha';
import { generateTerrain } from 'aekasha/toolkit/geometry';

/**
 * The terrain gallery (p303 D8): the toolkit's 16 texture sets, one isolated generated block each,
 * drawn by the toolkit's baseline material `textureSetSurface` in the set's default packing. The
 * place p305 compares its techniques against, p307 adds the wet controls to and p310 its camera
 * presets and measurements.
 *
 * - **The grid:** 4 × 4 blocks of 12 × 12 m with 4 m gaps over a dark ground, a row per pair of
 *   categories from the back (−z): sand and mud, rocks and cliffs, snow and ice, grass and
 *   concrete (`GALLERY_BLOCKS`, the debug tab's list).
 * - **A block:** `generateTerrain` at 48 segments, gentle 0.4 m noise, a seed of its own, and its
 *   back edge (−z) raised into a 35° ramp, so the normals' orientation and the sun on a slope can be
 *   judged; `textureSetSurface` tiles it at the world's `(x, −z)` over the set's `physicalSize`.
 * - **The cliffs' walls:** a 6 m wall on the left of each `cliffs*` block, tiled at its UVs in
 *   metres (`tiling: "UV"`).
 * - **The light:** the scene's own DAY_NIGHT sky box standing at 10:00 (`terrainGallerySky`); its
 *   sun and sky are the only lights. No shadows for now (`NO_SHADOWS`).
 *
 * The scene lists the 16 sets (`textureSets`), so their default packing's textures load with it;
 * each block's mesh is a variant of `textureSetSurface` naming its set (`matOverrides.inputs`).
 */

/** A block of the gallery: its set and where it stands */
export type GalleryBlock = {
  setId: string;
  /** The block's centre on the ground (its mesh's position) */
  x: number;
  z: number;
  /** Whether it has a wall (the `cliffs*` sets) */
  hasWall: boolean;
};

/** Rows from the back (−z), the sets of a row left to right */
const ROWS = [
  ['sand01', 'sand02', 'mud01', 'mud02'],
  ['rocks01', 'rocks02', 'cliffs01', 'cliffs02'],
  ['snow01', 'snow02', 'ice01', 'ice02'],
  ['grass01', 'grass02', 'concrete01', 'concrete02'],
];

/** A block's side, metres */
const BLOCK_SIZE = 12;
/** The gap between blocks, metres */
const BLOCK_GAP = 4;
const PITCH = BLOCK_SIZE + BLOCK_GAP;
const BLOCK_SEGMENTS = 48;
/** The noise's peak height, metres */
const NOISE_HEIGHT = 0.4;
/** Noise for a 12 m block: a swell of a few metres and a ripple of about two */
const NOISE_OCTAVES = [
  { frequency: 1 / 6, amplitude: 1 },
  { frequency: 1 / 2, amplitude: 0.3 },
];
/** The ramp: the back 3 m of a block rising at 35° (≈ 2.1 m at the edge) */
const RAMP_DEPTH = 3;
const RAMP_SLOPE = Math.tan(THREE.MathUtils.degToRad(35));
/** The cliffs' wall: 1 m thick, 6 m high, 8 m long, along the block's left edge */
const WALL = { width: 1, height: 6, depth: 8 };
/** How far the wall's foot sinks below the block's zero height, metres */
const WALL_SINK = 0.5;
const GROUND_Y = -0.6;
/** Each block's seed: this plus its index, so no two blocks share their noise */
const SEED_BASE = 303;

const MATERIAL_ID = 'textureSetSurface';

/**
 * No mesh casts or receives shadows: the engine's VSM shadows draw stripes down a sloped receiver
 * that nothing shadows (docs/issues/vsm-stripes-on-unshadowed-slopes.md), which would read as the
 * sets' relief. Back to cast and receive once that's fixed.
 */
const NO_SHADOWS = { castShadow: false, receiveShadow: false } as const;

/** The 16 blocks, by row from the back and left to right */
export const GALLERY_BLOCKS: readonly GalleryBlock[] = ROWS.flatMap((sets, row) =>
  sets.map((setId, col) => ({
    setId,
    x: (col - (sets.length - 1) / 2) * PITCH,
    z: (row - (ROWS.length - 1) / 2) * PITCH,
    hasWall: setId.startsWith('cliffs'),
  }))
);

/**
 * A registered geometry by id, built only when it isn't registered yet (a revisit before the
 * previous visit's assets were released returns the registered one)
 */
const getOrBuildGeometry = (id: string, build: () => THREE.BufferGeometry) =>
  getGeometry(id) ?? saveBufferGeometry(build(), { id });

/** The back edge's ramp over the noise: 0 in front of it, rising at 35° to the edge */
const rampHeight = (z: number) => Math.max(0, -BLOCK_SIZE / 2 + RAMP_DEPTH - z) * RAMP_SLOPE;

const buildBlockGeometry = (seed: number) =>
  generateTerrain({
    width: BLOCK_SIZE,
    depth: BLOCK_SIZE,
    widthSegments: BLOCK_SEGMENTS,
    depthSegments: BLOCK_SEGMENTS,
    maxHeight: NOISE_HEIGHT,
    noiseOctaves: NOISE_OCTAVES,
    seed,
    heightModifier: (_x, z, h) => h + rampHeight(z),
  }).geometry;

/**
 * The wall's box with each face's UVs in metres (three's box maps every face to 0..1), so
 * `textureSetSurface`'s `tiling: "UV"` tiles it at the set's `physicalSize`
 */
const buildWallGeometry = () => {
  const { width, height, depth } = WALL;
  const geometry = new THREE.BoxGeometry(width, height, depth);
  // Per face (three's group order: +x, −x, +y, −y, +z, −z), the metres its U and V span
  const faceSpans = [
    [depth, height],
    [depth, height],
    [width, depth],
    [width, depth],
    [width, height],
    [width, height],
  ];
  const uvs = geometry.getAttribute('uv') as THREE.BufferAttribute;
  const index = existsOrThrow(geometry.getIndex(), 'A box geometry is indexed.');
  const scaled = new Set<number>();
  geometry.groups.forEach((group, face) => {
    const [u, v] = faceSpans[face];
    for (let i = group.start; i < group.start + group.count; i++) {
      const vertex = index.getX(i);
      if (scaled.has(vertex)) continue;
      scaled.add(vertex);
      uvs.setXY(vertex, uvs.getX(vertex) * u, uvs.getY(vertex) * v);
    }
  });
  return geometry;
};

const createBlock = (block: GalleryBlock, seed: number) => {
  const mat = existsOrThrow(
    getMaterial(MATERIAL_ID),
    `The terrainGallery scene needs the "${MATERIAL_ID}" material.`
  );
  const surface: MaterialVariantOverrides = {
    inputs: { surface: { textureSet: block.setId } },
  };
  createMeshEntity(
    {
      geo: getOrBuildGeometry(`terrainGalleryBlock${seed}`, () => buildBlockGeometry(seed)),
      mat,
      matOverrides: surface,
      position: { x: block.x, z: block.z },
      ...NO_SHADOWS,
    },
    { appId: `terrainGallery_${block.setId}`, debugData: { name: `Block: ${block.setId}` } }
  );
  if (!block.hasWall) return;
  createMeshEntity(
    {
      geo: getOrBuildGeometry('terrainGalleryWall', buildWallGeometry),
      mat,
      matOverrides: { ...surface, staticDefines: { tiling: 'UV' } },
      position: {
        x: block.x - BLOCK_SIZE / 2 + WALL.width / 2,
        y: WALL.height / 2 - WALL_SINK,
        // From the ramp's foot forward
        z: block.z - BLOCK_SIZE / 2 + RAMP_DEPTH + WALL.depth / 2,
      },
      ...NO_SHADOWS,
    },
    {
      appId: `terrainGallery_${block.setId}_wall`,
      debugData: { name: `Wall: ${block.setId}` },
    }
  );
};

export const scene = async () => {
  const extent = ROWS.length * PITCH + BLOCK_GAP;
  createMeshEntity(
    {
      geo: {
        id: 'terrainGalleryGround',
        type: 'BOX',
        params: { width: extent, height: 0.2, depth: extent },
      },
      mat: {
        id: 'terrainGalleryGround',
        type: 'STANDARD',
        params: { color: '#2e2f31', roughness: 0.95 },
      },
      position: { y: GROUND_Y - 0.1 },
      ...NO_SHADOWS,
    },
    { appId: 'terrainGallery_ground', debugData: { name: 'Gallery ground' } }
  );
  GALLERY_BLOCKS.forEach((block, i) => createBlock(block, SEED_BASE + i));
};
