// A runtime decal's patch on a terrain block (p309 Phase 4, D4): the block's own grid points in a
// window around the decal, so its triangles are the block's (each cell split along the block's
// diagonal, `BlockSurface.ts`) and it lies on the block exactly at any grid spacing; only the lift
// along the block's normals parts them. The decal's UVs are projected along its normal (its plane's
// frame turned by its rotation), which is affine in the position and so exact on any triangle: the
// second UV set (`uv1`) runs 0..1 over the decal's rect, the first is that mapped into its atlas
// cell. Cells wholly outside the rect are left out; their vertices stay in the arrays unused (a
// batch draws by index), and a vertex outside the rect has a `uv1` outside 0..1, which the decal
// material's edge fade draws as 0. A window over the arrays' size takes every n-th grid line, its
// points still the block's but its triangles no longer. Writes into arrays the caller keeps, so a
// spawn allocates nothing here.
import type { AtlasCellRect } from 'aekasha';
import { createBlockSurfaceSample, sampleBlockSurface } from '../blocks/BlockSurface';
import type { BlockSurface } from '../blocks/BlockSurface';

/**
 * A patch's arrays, sized for its most vertices; a patch uses the start of each.
 * @internal
 */
export type DecalPatchArrays = {
  /** World space, 3 per vertex */
  positions: Float32Array;
  /** The block's unit normals, 3 per vertex */
  normals: Float32Array;
  /** The atlas cell's UVs, 2 per vertex */
  uvs: Float32Array;
  /** 0..1 over the decal's rect (the `uv1` the edge fade reads), 2 per vertex */
  decalUvs: Float32Array;
  indices: Uint16Array;
};

/**
 * Where a patch goes and what it shows. The centre and the normal are in the block's space.
 * @internal
 */
export type DecalPatchSpec = {
  /** The decal's centre on the block (its height is the block's there) */
  x: number;
  z: number;
  /** The unit normal of the decal's plane, along which its UVs project (default the block's at
   * the centre) */
  normal?: { x: number; y: number; z: number };
  /** Radians around the normal, counter-clockwise seen from its tip; 0 puts u along the plane's
   * x (along +x on flat ground, v toward −z) */
  rotation: number;
  /** The decal's size along u and v, metres */
  width: number;
  height: number;
  /** The atlas cell's UV rect (`getAtlasCell`'s `uv`) */
  cellRect: AtlasCellRect;
  /** How far each vertex is lifted along the block's normal, metres */
  lift: number;
  /** The block's place in the world, added to every position */
  origin: { x: number; y: number; z: number };
};

/**
 * What {@link writeDecalPatch} wrote: its vertices (the window's points), its indices (0: the
 * decal misses the block) and the grid lines' stride (1: every line, the block's triangles).
 * @internal
 */
export type DecalPatchCounts = { vertexCount: number; indexCount: number; stride: number };

/**
 * The most indices a patch of `maxVertices` has: its window of `cols × rows ≤ maxVertices` points
 * has at most `(√maxVertices − 1)²` cells (`cols + rows ≥ 2√(cols · rows)`), two triangles each.
 * @internal
 */
export const getDecalPatchMaxIndices = (maxVertices: number) =>
  6 * Math.floor((Math.sqrt(maxVertices) - 1) ** 2);

/**
 * A patch's arrays for at most `maxVertices` vertices (Uint16 indices: at most 65 536).
 * @internal
 */
export const createDecalPatchArrays = (maxVertices: number): DecalPatchArrays => {
  if (!Number.isInteger(maxVertices) || maxVertices < 4 || maxVertices > 65536) {
    throw new Error(
      `createDecalPatchArrays: maxVertices is ${maxVertices}: use an integer from 4 to 65536.`
    );
  }
  return {
    positions: new Float32Array(maxVertices * 3),
    normals: new Float32Array(maxVertices * 3),
    uvs: new Float32Array(maxVertices * 2),
    decalUvs: new Float32Array(maxVertices * 2),
    indices: new Uint16Array(getDecalPatchMaxIndices(maxVertices)),
  };
};

/** The centre's sample, reused */
const centre = createBlockSurfaceSample();

/** The points a window of `span` grid cells has along an axis at a stride */
const countPoints = (span: number, stride: number) => Math.ceil(span / stride) + 1;

/**
 * Writes a decal's patch on a block into `arrays`.
 * @internal
 * @param surface the block's grid (`readBlockSurface`)
 * @param spec where the decal goes and what it shows
 * @param arrays the patch's arrays; their size bounds the window (see `stride`)
 * @param out filled and returned
 * @returns `out`
 */
export const writeDecalPatch = (
  surface: BlockSurface,
  spec: DecalPatchSpec,
  arrays: DecalPatchArrays,
  out: DecalPatchCounts
) => {
  const { size, cols, rows, heights, normals } = surface;
  const { width, height, lift, origin, cellRect } = spec;
  const { positions, normals: outNormals, uvs, decalUvs, indices } = arrays;
  const maxVertices = positions.length / 3;
  out.vertexCount = 0;
  out.indexCount = 0;
  out.stride = 1;

  sampleBlockSurface(surface, spec.x, spec.z, centre);
  const cx = spec.x;
  const cy = centre.height;
  const cz = spec.z;
  const nx = spec.normal?.x ?? centre.normalX;
  const ny = spec.normal?.y ?? centre.normalY;
  const nz = spec.normal?.z ?? centre.normalZ;
  // The plane's x: +x less its share along the normal (+z when the normal is along x)
  let t0x = 1 - nx * nx;
  let t0y = -nx * ny;
  let t0z = -nx * nz;
  let length = Math.sqrt(t0x * t0x + t0y * t0y + t0z * t0z);
  if (length < 1e-3) {
    t0x = -nz * nx;
    t0y = -nz * ny;
    t0z = 1 - nz * nz;
    length = Math.sqrt(t0x * t0x + t0y * t0y + t0z * t0z);
  }
  t0x /= length;
  t0y /= length;
  t0z /= length;
  // n × t0: −z on flat ground, so v points to the back (the cell's top away from +z)
  const b0x = ny * t0z - nz * t0y;
  const b0y = nz * t0x - nx * t0z;
  const b0z = nx * t0y - ny * t0x;
  const cos = Math.cos(spec.rotation);
  const sin = Math.sin(spec.rotation);
  // u and v per metre: the frame turned, over the decal's size
  const ux = (t0x * cos + b0x * sin) / width;
  const uy = (t0y * cos + b0y * sin) / width;
  const uz = (t0z * cos + b0z * sin) / width;
  const vx = (b0x * cos - t0x * sin) / height;
  const vy = (b0y * cos - t0y * sin) / height;
  const vz = (b0z * cos - t0z * sin) / height;

  // The window: the grid cells under the rect's corners' x and z, inside the block
  const halfX = (Math.abs(ux) * width * width + Math.abs(vx) * height * height) / 2;
  const halfZ = (Math.abs(uz) * width * width + Math.abs(vz) * height * height) / 2;
  const dx = size / (cols - 1);
  const dz = size / (rows - 1);
  const half = size / 2;
  const colMin = Math.max(0, Math.floor((cx - halfX + half) / dx));
  const colMax = Math.min(cols - 1, Math.ceil((cx + halfX + half) / dx));
  const rowMin = Math.max(0, Math.floor((cz - halfZ + half) / dz));
  const rowMax = Math.min(rows - 1, Math.ceil((cz + halfZ + half) / dz));
  if (colMax <= colMin || rowMax <= rowMin) return out;
  let stride = 1;
  while (
    countPoints(colMax - colMin, stride) * countPoints(rowMax - rowMin, stride) >
    maxVertices
  ) {
    stride++;
  }
  const pointCols = countPoints(colMax - colMin, stride);
  const pointRows = countPoints(rowMax - rowMin, stride);

  const [u0, v0, u1, v1] = cellRect;
  let vertex = 0;
  for (let j = 0; j < pointRows; j++) {
    const row = Math.min(rowMin + j * stride, rowMax);
    for (let k = 0; k < pointCols; k++) {
      const col = Math.min(colMin + k * stride, colMax);
      const point = row * cols + col;
      const x = col * dx - half;
      const y = heights[point];
      const z = row * dz - half;
      const pnx = normals[point * 3];
      const pny = normals[point * 3 + 1];
      const pnz = normals[point * 3 + 2];
      positions[vertex * 3] = origin.x + x + pnx * lift;
      positions[vertex * 3 + 1] = origin.y + y + pny * lift;
      positions[vertex * 3 + 2] = origin.z + z + pnz * lift;
      outNormals[vertex * 3] = pnx;
      outNormals[vertex * 3 + 1] = pny;
      outNormals[vertex * 3 + 2] = pnz;
      const u = (x - cx) * ux + (y - cy) * uy + (z - cz) * uz + 0.5;
      const v = (x - cx) * vx + (y - cy) * vy + (z - cz) * vz + 0.5;
      decalUvs[vertex * 2] = u;
      decalUvs[vertex * 2 + 1] = v;
      uvs[vertex * 2] = u0 + u * (u1 - u0);
      uvs[vertex * 2 + 1] = v0 + v * (v1 - v0);
      vertex++;
    }
  }

  // The cells with any of the rect: not all four corners past the same edge of it
  let index = 0;
  for (let j = 0; j < pointRows - 1; j++) {
    for (let k = 0; k < pointCols - 1; k++) {
      const a = j * pointCols + k;
      const b = a + 1;
      const c = a + pointCols;
      const d = c + 1;
      if (
        isPastEdge(decalUvs, a, b, c, d, 0, -1) ||
        isPastEdge(decalUvs, a, b, c, d, 0, 1) ||
        isPastEdge(decalUvs, a, b, c, d, 1, -1) ||
        isPastEdge(decalUvs, a, b, c, d, 1, 1)
      ) {
        continue;
      }
      // The block's split: (a, c, b) up to the b–c diagonal, (b, c, d) past it; both face up
      indices[index++] = a;
      indices[index++] = c;
      indices[index++] = b;
      indices[index++] = b;
      indices[index++] = c;
      indices[index++] = d;
    }
  }
  out.vertexCount = vertex;
  out.indexCount = index;
  out.stride = stride;
  return out;
};

/** Whether four vertices' decal UV on `axis` (0: u, 1: v) are all under 0 (`side` −1) or over 1 */
const isPastEdge = (
  decalUvs: Float32Array,
  a: number,
  b: number,
  c: number,
  d: number,
  axis: 0 | 1,
  side: -1 | 1
) => {
  const edge = side < 0 ? 0 : 1;
  return (
    (decalUvs[a * 2 + axis] - edge) * side > 0 &&
    (decalUvs[b * 2 + axis] - edge) * side > 0 &&
    (decalUvs[c * 2 + axis] - edge) * side > 0 &&
    (decalUvs[d * 2 + axis] - edge) * side > 0
  );
};
