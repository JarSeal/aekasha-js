import { lerror, lwarn } from '../../../utils/Logger';
import type { ColliderParams } from '../types/PhysicsColliderTypes';
import type { ImportedGeometryInfo } from '../../../kernel/assets/import/ImportTypes';
import { toHeightfieldColliderParams } from '../HeightfieldColliderParams';

// A HEIGHTFIELD collider read from an imported node's grid (p306 D3): each vertex goes to the
// grid point its x and z fall on, so the vertex order (Blender's rows run along -z, three's
// planes along +z, a reorder by an optimizer) doesn't matter, and the grid is centred on the
// node's origin by a collider translation when its bounds aren't.

/** How far a vertex may sit off its grid line in x or z, as a share of the spacing. */
const GRID_TOLERANCE = 0.01;
/** How far apart in height two vertices on one grid point may be (m): a seam's duplicates. */
const HEIGHT_TOLERANCE = 1e-3;
// p306 D1
/** A terrain block's offset from its origin (m) past which the import warns. */
const BLOCK_CENTRE_TOLERANCE = 1e-3;

/**
 * The grid lines along one axis: the distinct values, a new line wherever the sorted values
 * jump by more than half the largest jump (a regular grid's jumps are its spacing or about 0).
 */
const countGridLines = (values: Float64Array) => {
  values.sort();
  let maxGap = 0;
  for (let i = 1; i < values.length; i++) maxGap = Math.max(maxGap, values[i] - values[i - 1]);
  let lines = 1;
  for (let i = 1; i < values.length; i++) {
    if (values[i] - values[i - 1] > maxGap / 2) lines++;
  }
  return lines;
};

/** A cell count: the one given (custom props `nCols` / `nRows`), else counted from the grid. */
const getCells = (given: number | undefined, values: Float64Array) =>
  given ?? countGridLines(values) - 1;

/**
 * Warns when the mesh splits cells along the other diagonal than the collider's, from
 * (row, col) to (row + 1, col + 1): between their vertices, the collider then misses the mesh by
 * up to half the two diagonals' height difference (Rapier's heightfield has one diagonal).
 */
const warnOnOtherDiagonal = (
  index: ArrayLike<number> | null,
  pointOf: Int32Array,
  heights: Float32Array,
  cols: number,
  info: ImportedGeometryInfo
) => {
  const isOther = new Uint8Array(heights.length);
  let cells = 0;
  let worstGap = 0;
  // Unindexed: the triangles are the vertices three by three
  const length = index ? index.length : pointOf.length;
  for (let t = 0; t + 2 < length; t += 3) {
    const a = pointOf[index ? index[t] : t];
    const b = pointOf[index ? index[t + 1] : t + 1];
    const c = pointOf[index ? index[t + 2] : t + 2];
    // The cell's first grid point (lowest row and column), and its far corner on that diagonal
    const first = Math.min(a, b, c);
    const row = Math.floor(first / cols);
    const col = Math.min(a % cols, b % cols, c % cols);
    const k00 = row * cols + col;
    const k11 = k00 + cols + 1;
    const hasK00 = a === k00 || b === k00 || c === k00;
    const hasK11 = a === k11 || b === k11 || c === k11;
    if (!hasK00 || !hasK11 || isOther[k00]) continue;
    isOther[k00] = 1;
    cells++;
    const gap = Math.abs(heights[k00] + heights[k11] - heights[k00 + 1] - heights[k00 + cols]) / 2;
    worstGap = Math.max(worstGap, gap);
  }
  if (cells && worstGap > HEIGHT_TOLERANCE) {
    lwarn(
      `Import "${info.importId}", node "${info.nodeName}": ${cells} of the HEIGHTFIELD's cells are split along the other diagonal than the collider's, which then misses the mesh by up to ${worstGap.toFixed(3)} m inside them. Split each quad from its (-x, +z) corner to its (+x, -z) corner (Blender's (-x, -y) to (+x, +y)), or use a TRIMESH.`
    );
  }
};

/**
 * The HEIGHTFIELD collider of a node's grid: its positions (in the node's space × its scale)
 * bucketed into rows along z and columns along x by position, then `toHeightfieldColliderParams`.
 * `ncols` counts the cells along x and `nrows` those along z; a count not given is counted from
 * the vertices' distinct x or z. Duplicates on one grid point (a seam's) must agree in height.
 * Warns when the triangles split cells along the other diagonal than the collider's.
 * @internal
 * @returns the params, or null (logged) when the vertices make no regular grid
 */
export const deriveHeightfield = (
  colliderParams: ColliderParams & { type: 'HEIGHTFIELD' },
  positions: Float32Array,
  index: ArrayLike<number> | null,
  info: ImportedGeometryInfo
): ColliderParams | null => {
  const node = `Import "${info.importId}", node "${info.nodeName}": HEIGHTFIELD collider skipped`;
  const count = positions.length / 3;
  const xs = new Float64Array(count);
  const zs = new Float64Array(count);
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < count; i++) {
    xs[i] = positions[i * 3];
    zs[i] = positions[i * 3 + 2];
    minX = Math.min(minX, xs[i]);
    maxX = Math.max(maxX, xs[i]);
    minZ = Math.min(minZ, zs[i]);
    maxZ = Math.max(maxZ, zs[i]);
  }
  const width = maxX - minX;
  const depth = maxZ - minZ;
  const ncols = getCells(colliderParams.ncols, xs);
  const nrows = getCells(colliderParams.nrows, zs);
  if (!(width > 0) || !(depth > 0) || !Number.isInteger(ncols) || !Number.isInteger(nrows)) {
    lerror(
      `${node}, its ${count} vertices make no grid of 1 × 1 cells or more (${ncols} × ${nrows} cells, ${width} × ${depth} m). Give it whole nCols (cells along x) and nRows (along z) custom properties, or none.`
    );
    return null;
  }
  if (ncols < 1 || nrows < 1) {
    lerror(`${node}, a grid needs 1 × 1 cells or more (${ncols} × ${nrows}).`);
    return null;
  }

  const cols = ncols + 1;
  const rows = nrows + 1;
  const dx = width / ncols;
  const dz = depth / nrows;
  const heights = new Float32Array(rows * cols);
  const isFilled = new Uint8Array(rows * cols);
  const pointOf = new Int32Array(count);
  for (let i = 0; i < count; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    const colAt = (x - minX) / dx;
    const rowAt = (z - minZ) / dz;
    const col = Math.round(colAt);
    const row = Math.round(rowAt);
    if (Math.abs(colAt - col) > GRID_TOLERANCE || Math.abs(rowAt - row) > GRID_TOLERANCE) {
      lerror(
        `${node}, not a regular grid of ${ncols} × ${nrows} cells: the vertex at x ${x}, z ${z} is off its column and row (was a vertex moved in x or z?). A heightfield's vertices only move in y; use a TRIMESH for anything else.`
      );
      return null;
    }
    const k = row * cols + col;
    pointOf[i] = k;
    if (!isFilled[k]) {
      heights[k] = y;
      isFilled[k] = 1;
    } else if (Math.abs(heights[k] - y) > HEIGHT_TOLERANCE) {
      lerror(
        `${node}, two heights (${heights[k]} and ${y}) at x ${x}, z ${z} (row ${row}, column ${col}): an overhang or a vertical wall, which a heightfield can't hold. Use a TRIMESH.`
      );
      return null;
    }
  }
  const empty = isFilled.indexOf(0);
  if (empty >= 0) {
    const row = Math.floor(empty / cols);
    const col = empty % cols;
    lerror(
      `${node}, not a regular grid of ${ncols} × ${nrows} cells: no vertex at x ${minX + col * dx}, z ${minZ + row * dz} (row ${row}, column ${col}). Check the nCols and nRows custom properties, or the grid for a missing or moved vertex.`
    );
    return null;
  }
  warnOnOtherDiagonal(index, pointOf, heights, cols, info);

  // The collider is centred on the body: a grid whose bounds aren't centred on its node's origin
  // is moved back under its mesh
  const centreX = (minX + maxX) / 2;
  const centreZ = (minZ + maxZ) / 2;
  if (
    info.customProps.raw.aekBlockSize !== undefined &&
    Math.max(Math.abs(centreX), Math.abs(centreZ)) > BLOCK_CENTRE_TOLERANCE
  ) {
    lwarn(
      `Import "${info.importId}", node "${info.nodeName}": a terrain block's grid is centred on its origin, this one's centre is at x ${centreX}, z ${centreZ}. Set the origin to the grid's centre (and apply the transforms) before the export.`
    );
  }
  const isOffset = centreX !== 0 || centreZ !== 0;
  return {
    ...colliderParams,
    ...toHeightfieldColliderParams({ heights, rows, cols, width, depth }),
    ...(isOffset && !colliderParams.translation
      ? { translation: { x: centreX, y: 0, z: centreZ } }
      : {}),
  };
};
