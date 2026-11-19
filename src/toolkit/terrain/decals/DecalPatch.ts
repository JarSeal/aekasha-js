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
import type * as THREE from 'three/webgpu';
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

/**
 * A decal's frame: the unit directions its u and v run along (u × v is its normal).
 * @internal
 */
export type DecalFrame = { ux: number; uy: number; uz: number; vx: number; vy: number; vz: number };

/**
 * A decal's frame from its plane's unit normal and its rotation: u along the plane's x (+x less its
 * share along the normal; +z for a normal along x) and v the normal × u (−z on flat ground, so the
 * cell's top is away from +z; up a wall facing +z), both turned counter-clockwise seen from the
 * normal's tip.
 * @internal
 * @returns `out`
 */
export const getDecalFrame = (
  nx: number,
  ny: number,
  nz: number,
  rotation: number,
  out: DecalFrame
) => {
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
  const b0x = ny * t0z - nz * t0y;
  const b0y = nz * t0x - nx * t0z;
  const b0z = nx * t0y - ny * t0x;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  out.ux = t0x * cos + b0x * sin;
  out.uy = t0y * cos + b0y * sin;
  out.uz = t0z * cos + b0z * sin;
  out.vx = b0x * cos - t0x * sin;
  out.vy = b0y * cos - t0y * sin;
  out.vz = b0z * cos - t0z * sin;
  return out;
};

/** The centre's sample and the frame, reused */
const centre = createBlockSurfaceSample();
const frame: DecalFrame = { ux: 1, uy: 0, uz: 0, vx: 0, vy: 0, vz: -1 };

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
  getDecalFrame(
    spec.normal?.x ?? centre.normalX,
    spec.normal?.y ?? centre.normalY,
    spec.normal?.z ?? centre.normalZ,
    spec.rotation,
    frame
  );
  // u and v per metre: the frame over the decal's size
  const ux = frame.ux / width;
  const uy = frame.uy / width;
  const uz = frame.uz / width;
  const vx = frame.vx / height;
  const vy = frame.vy / height;
  const vz = frame.vz / height;

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

/**
 * Writes a decal projected onto a mesh (three's `DecalGeometry`: world-space triangles, not
 * indexed, its UVs 0..1 over the decal) into `arrays`: the positions lifted along the normals, the
 * normals (each face's own where the source has none), its UVs as the decal's (`uv1`) and mapped
 * into the cell, and an index listing every vertex in order.
 * @internal
 * @param source the projected geometry
 * @param cellRect the atlas cell's UV rect
 * @param lift metres along the normals
 * @param arrays the patch's arrays, at least as large as the source
 * @param out filled and returned (`stride` 1)
 * @returns `out`
 * @throws when the arrays are smaller than the source
 */
export const writeMeshDecalPatch = (
  source: THREE.BufferGeometry,
  cellRect: AtlasCellRect,
  lift: number,
  arrays: DecalPatchArrays,
  out: DecalPatchCounts
) => {
  const position = source.getAttribute('position');
  const normal = source.getAttribute('normal');
  const uv = source.getAttribute('uv');
  const count = position ? position.count : 0;
  const { positions, normals, uvs, decalUvs, indices } = arrays;
  if (count * 3 > positions.length || count > indices.length) {
    throw new Error(
      `writeMeshDecalPatch: the decal's ${count} vertices don't fit arrays of ${positions.length / 3}.`
    );
  }
  const [u0, v0, u1, v1] = cellRect;
  let nx = 0;
  let ny = 1;
  let nz = 0;
  for (let i = 0; i < count; i++) {
    if (normal) {
      nx = normal.getX(i);
      ny = normal.getY(i);
      nz = normal.getZ(i);
    } else if (i % 3 === 0) {
      // The face's: (b − a) × (c − a)
      const ax = position.getX(i);
      const ay = position.getY(i);
      const az = position.getZ(i);
      const bx = position.getX(i + 1) - ax;
      const by = position.getY(i + 1) - ay;
      const bz = position.getZ(i + 1) - az;
      const cx = position.getX(i + 2) - ax;
      const cy = position.getY(i + 2) - ay;
      const cz = position.getZ(i + 2) - az;
      nx = by * cz - bz * cy;
      ny = bz * cx - bx * cz;
      nz = bx * cy - by * cx;
      const length = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= length;
      ny /= length;
      nz /= length;
    }
    positions[i * 3] = position.getX(i) + nx * lift;
    positions[i * 3 + 1] = position.getY(i) + ny * lift;
    positions[i * 3 + 2] = position.getZ(i) + nz * lift;
    normals[i * 3] = nx;
    normals[i * 3 + 1] = ny;
    normals[i * 3 + 2] = nz;
    const u = uv.getX(i);
    const v = uv.getY(i);
    decalUvs[i * 2] = u;
    decalUvs[i * 2 + 1] = v;
    uvs[i * 2] = u0 + u * (u1 - u0);
    uvs[i * 2 + 1] = v0 + v * (v1 - v0);
    indices[i] = i;
  }
  out.vertexCount = count;
  out.indexCount = count;
  out.stride = 1;
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
