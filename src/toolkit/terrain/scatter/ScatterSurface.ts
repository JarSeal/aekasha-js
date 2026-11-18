// A terrain block's surface for the scatter (p308 D4): its geometry's grid read back by position,
// so a generated block (its grid first, then its skirt) and an imported one (Blender's vertex
// order, seams' duplicates) read alike, and sampled on the mesh's own triangles (each cell split
// along the diagonal from (col + 1, row) to (col, row + 1), the one `generateTerrain` and the block
// conventions use), so a point's height is the mesh's and its normal and colour are what the GPU
// interpolates there.
import type * as THREE from 'three/webgpu';

/** How far off its grid line a vertex may sit, in cells (the collider's extraction's 1 %) */
const GRID_TOLERANCE = 0.01;
const COLOR_SIZE = 4;

/**
 * A block's grid: heights, unit normals and colours per grid point, row-major (row r along z from
 * `−size / 2`, column c along x), in the block's own space.
 * @internal
 */
export type ScatterSurface = {
  /** The block's side, metres */
  size: number;
  /** Grid points along x */
  cols: number;
  /** Grid points along z */
  rows: number;
  heights: Float32Array;
  /** 3 per point */
  normals: Float32Array;
  /** RGBA 0..1, 4 per point; null when the geometry has no colour attribute */
  colors: Float32Array | null;
};

/**
 * A point of the surface: its height, unit normal and colour (`color` 0..1, white without
 * colours), in the block's space.
 * @internal
 */
export type ScatterSurfaceSample = {
  height: number;
  normalX: number;
  normalY: number;
  normalZ: number;
  color: Float32Array;
};

/** The distinct values of a coordinate, `tolerance` apart at least */
const countDistinct = (values: Float32Array, tolerance: number) => {
  const sorted = Float32Array.from(values).sort();
  let count = sorted.length ? 1 : 0;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] > tolerance) count++;
  }
  return count;
};

/** Each grid point's normal from the heights' central differences (one-sided at the edges) */
const getGridNormals = (heights: Float32Array, cols: number, rows: number, size: number) => {
  const dx = size / (cols - 1);
  const dz = size / (rows - 1);
  const normals = new Float32Array(cols * rows * 3);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const left = heights[row * cols + Math.max(0, col - 1)];
      const right = heights[row * cols + Math.min(cols - 1, col + 1)];
      const back = heights[Math.max(0, row - 1) * cols + col];
      const front = heights[Math.min(rows - 1, row + 1) * cols + col];
      const nx = -(right - left) / ((Math.min(cols - 1, col + 1) - Math.max(0, col - 1)) * dx);
      const nz = -(front - back) / ((Math.min(rows - 1, row + 1) - Math.max(0, row - 1)) * dz);
      const length = Math.sqrt(nx * nx + 1 + nz * nz);
      const i = (row * cols + col) * 3;
      normals[i] = nx / length;
      normals[i + 1] = 1 / length;
      normals[i + 2] = nz / length;
    }
  }
  return normals;
};

/**
 * A block's grid read from its geometry by position: the grid's columns and rows counted from the
 * distinct x and z, each vertex put on the grid point it sits on. Where several vertices share a
 * point (a seam, the skirt under an edge) the highest one is taken. The normals are the
 * geometry's, else the heights'; the colours the `color` attribute's.
 * @internal
 * @param geometry the block's geometry, centred on its origin (the block conventions)
 * @param size the block's side, metres
 * @param where what reads it, for the errors (eg. `terrainScatter: the scatter "rocks"`)
 * @throws for a geometry that isn't a regular grid `size` wide: a vertex off its grid line or past
 * the block, or a grid point without a vertex (overhangs, caves: a `TRIMESH` block)
 */
export const readScatterSurface = (
  geometry: THREE.BufferGeometry,
  size: number,
  where: string
): ScatterSurface => {
  const position = geometry.getAttribute('position');
  if (!position) throw new Error(`${where}: the surface's geometry has no positions.`);
  const count = position.count;
  const xs = new Float32Array(count);
  const zs = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    xs[i] = position.getX(i);
    zs[i] = position.getZ(i);
  }
  const cols = countDistinct(xs, size * 1e-5);
  const rows = countDistinct(zs, size * 1e-5);
  const notGrid = `${where}: the surface isn't a regular grid ${size} m wide (a TRIMESH block's overhangs and caves can't be scattered on)`;
  if (cols < 2 || rows < 2) throw new Error(`${notGrid}: ${cols} × ${rows} grid lines.`);
  const dx = size / (cols - 1);
  const dz = size / (rows - 1);
  const half = size / 2;

  const heights = new Float32Array(cols * rows).fill(-Infinity);
  const vertexOf = new Int32Array(cols * rows).fill(-1);
  for (let i = 0; i < count; i++) {
    const u = (xs[i] + half) / dx;
    const v = (zs[i] + half) / dz;
    const col = Math.round(u);
    const row = Math.round(v);
    if (
      Math.abs(u - col) > GRID_TOLERANCE ||
      Math.abs(v - row) > GRID_TOLERANCE ||
      col < 0 ||
      col >= cols ||
      row < 0 ||
      row >= rows
    ) {
      throw new Error(
        `${notGrid}: the vertex ${i} at (${xs[i]}, ${zs[i]}) is off the ${cols} × ${rows} grid.`
      );
    }
    const point = row * cols + col;
    const y = position.getY(i);
    if (y > heights[point]) {
      heights[point] = y;
      vertexOf[point] = i;
    }
  }
  const empty = vertexOf.indexOf(-1);
  if (empty >= 0) {
    throw new Error(
      `${notGrid}: the grid point (col ${empty % cols}, row ${Math.floor(empty / cols)}) has no vertex.`
    );
  }

  const normal = geometry.getAttribute('normal');
  let normals: Float32Array;
  if (normal) {
    normals = new Float32Array(cols * rows * 3);
    for (let point = 0; point < vertexOf.length; point++) {
      const i = vertexOf[point];
      normals[point * 3] = normal.getX(i);
      normals[point * 3 + 1] = normal.getY(i);
      normals[point * 3 + 2] = normal.getZ(i);
    }
  } else {
    normals = getGridNormals(heights, cols, rows, size);
  }

  // Normalized byte colours read 0..1 through the getters
  const color = geometry.getAttribute('color');
  let colors: Float32Array | null = null;
  if (color) {
    colors = new Float32Array(cols * rows * COLOR_SIZE);
    for (let point = 0; point < vertexOf.length; point++) {
      const i = vertexOf[point];
      colors[point * 4] = color.getX(i);
      colors[point * 4 + 1] = color.getY(i);
      colors[point * 4 + 2] = color.getZ(i);
      colors[point * 4 + 3] = color.itemSize > 3 ? color.getW(i) : 1;
    }
  }
  return { size, cols, rows, heights, normals, colors };
};

/**
 * A flat surface at height 0, its normal up and no colours: what a target without a surface
 * entity scatters on.
 * @internal
 */
export const createFlatScatterSurface = (size: number): ScatterSurface => ({
  size,
  cols: 2,
  rows: 2,
  heights: new Float32Array(4),
  normals: Float32Array.of(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0),
  colors: null,
});

/**
 * A sample to fill with {@link sampleScatterSurface}.
 * @internal
 */
export const createScatterSurfaceSample = (): ScatterSurfaceSample => ({
  height: 0,
  normalX: 0,
  normalY: 1,
  normalZ: 0,
  color: new Float32Array(COLOR_SIZE).fill(1),
});

/**
 * The surface at a point of the block's space (clamped to the block): the triangle under it
 * interpolated, the normal renormalized.
 * @internal
 * @returns `out`
 */
export const sampleScatterSurface = (
  surface: ScatterSurface,
  x: number,
  z: number,
  out: ScatterSurfaceSample
) => {
  const { size, cols, rows, heights, normals, colors } = surface;
  const u = Math.min(1, Math.max(0, x / size + 0.5)) * (cols - 1);
  const v = Math.min(1, Math.max(0, z / size + 0.5)) * (rows - 1);
  const col = Math.min(Math.floor(u), cols - 2);
  const row = Math.min(Math.floor(v), rows - 2);
  const tx = u - col;
  const tz = v - row;
  const a = row * cols + col;
  const b = a + 1;
  const c = a + cols;
  const d = c + 1;
  // (a, b, c) up to the b–c diagonal, (b, c, d) past it: each point's weight
  let p0 = a;
  let w0 = 1 - tx - tz;
  let w1 = tx;
  let w2 = tz;
  if (tx + tz > 1) {
    p0 = d;
    w0 = tx + tz - 1;
    w1 = 1 - tz;
    w2 = 1 - tx;
  }
  out.height = heights[p0] * w0 + heights[b] * w1 + heights[c] * w2;
  const nx = normals[p0 * 3] * w0 + normals[b * 3] * w1 + normals[c * 3] * w2;
  const ny = normals[p0 * 3 + 1] * w0 + normals[b * 3 + 1] * w1 + normals[c * 3 + 1] * w2;
  const nz = normals[p0 * 3 + 2] * w0 + normals[b * 3 + 2] * w1 + normals[c * 3 + 2] * w2;
  const length = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
  out.normalX = nx / length;
  out.normalY = ny / length;
  out.normalZ = nz / length;
  if (colors) {
    for (let k = 0; k < COLOR_SIZE; k++) {
      out.color[k] = colors[p0 * 4 + k] * w0 + colors[b * 4 + k] * w1 + colors[c * 4 + k] * w2;
    }
  }
  return out;
};
