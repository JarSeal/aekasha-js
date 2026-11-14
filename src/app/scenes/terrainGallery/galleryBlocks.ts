// What the terrain gallery's rows share (the library's blocks in `terrainGallery.ts`, the
// Procedural row's in `proceduralRow.ts`): a block's size and spacing, its generated geometry with
// the ramp, the cliffs' wall, and the baseline material's variant for a texture set.
import * as THREE from 'three/webgpu';
import {
  existsOrThrow,
  getGeometry,
  saveBufferGeometry,
  type MaterialVariantOverrides,
} from 'aekasha';
import type { TextureSetPacking } from 'aekasha/texturesets';
import { generateTerrain } from 'aekasha/toolkit/geometry';

/** A block's side, metres */
export const BLOCK_SIZE = 12;
/** The gap between blocks, metres */
export const BLOCK_GAP = 4;
/** From a block's centre to the next one's, metres */
export const BLOCK_PITCH = BLOCK_SIZE + BLOCK_GAP;
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
const WALL_GEOMETRY_ID = 'terrainGalleryWall';

/** The blocks' material for a texture set (the toolkit's baseline), its variants per block */
export const GALLERY_MATERIAL_ID = 'textureSetSurface';

/**
 * No mesh casts or receives shadows: the engine's VSM shadows draw stripes down a sloped receiver
 * that nothing shadows (docs/issues/vsm-stripes-on-unshadowed-slopes.md), which would read as the
 * sets' relief. Back to cast and receive once that's fixed.
 */
export const NO_SHADOWS = { castShadow: false, receiveShadow: false } as const;

/**
 * A block's (or its wall's) variant of `textureSetSurface`: its set, in a packing (none: the set's
 * default, the variant the scene's load made)
 */
export const getSurfaceOverrides = (
  setId: string,
  opts: { packing?: TextureSetPacking; isWall?: boolean } = {}
): MaterialVariantOverrides => ({
  inputs: {
    surface: opts.packing ? { textureSet: setId, packing: opts.packing } : { textureSet: setId },
  },
  ...(opts.isWall ? { staticDefines: { tiling: 'UV' } } : {}),
});

/**
 * A registered geometry by id, built only when it isn't registered yet (a revisit before the
 * previous visit's assets were released returns the registered one)
 */
const getOrBuildGeometry = (id: string, build: () => THREE.BufferGeometry) =>
  getGeometry(id) ?? saveBufferGeometry(build(), { id });

/** The back edge's ramp over the noise: 0 in front of it, rising at 35° to the edge */
const rampHeight = (z: number) => Math.max(0, -BLOCK_SIZE / 2 + RAMP_DEPTH - z) * RAMP_SLOPE;

/** The id of the block geometry of a seed */
export const getBlockGeometryId = (seed: number) => `terrainGalleryBlock${seed}`;

/**
 * A block's geometry: `generateTerrain` at 48 segments with gentle noise of the seed, its back
 * edge (−z) raised into the ramp
 */
export const getBlockGeometry = (seed: number) =>
  getOrBuildGeometry(
    getBlockGeometryId(seed),
    () =>
      generateTerrain({
        width: BLOCK_SIZE,
        depth: BLOCK_SIZE,
        widthSegments: BLOCK_SEGMENTS,
        depthSegments: BLOCK_SEGMENTS,
        maxHeight: NOISE_HEIGHT,
        noiseOctaves: NOISE_OCTAVES,
        seed,
        heightModifier: (_x, z, h) => h + rampHeight(z),
      }).geometry
  );

/**
 * The wall's box with each face's UVs in metres (three's box maps every face to 0..1), so a
 * material tiling at the mesh's UV (`textureSetSurface`'s `tiling: "UV"`) tiles it at a tile's
 * physical size
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

/** The cliffs' wall's geometry, shared by every wall */
export const getWallGeometry = () => getOrBuildGeometry(WALL_GEOMETRY_ID, buildWallGeometry);

/** Where a block's wall stands: along its left edge, from the ramp's foot forward */
export const getWallPosition = (block: { x: number; z: number }) => ({
  x: block.x - BLOCK_SIZE / 2 + WALL.width / 2,
  y: WALL.height / 2 - WALL_SINK,
  z: block.z - BLOCK_SIZE / 2 + RAMP_DEPTH + WALL.depth / 2,
});
