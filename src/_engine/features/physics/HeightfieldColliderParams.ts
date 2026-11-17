import type { HeightFieldData } from './types/PhysicsColliderTypes';

/** {@link toHeightfieldColliderParams}' grid: row-major heights and the size they span. */
export type HeightfieldGrid = {
  /**
   * The heights, row-major: row r (along +z, from -depth / 2) and column c (along +x, from
   * -width / 2) at `r * cols + c`, in the body's units (they aren't scaled).
   */
  heights: ArrayLike<number>;
  /** The grid's rows: the number of heights along z, 2 or more. */
  rows: number;
  /** The grid's columns: the number of heights along x, 2 or more. */
  cols: number;
  /** The size along x, from the first column to the last, centred on the body. */
  width: number;
  /** The size along z, from the first row to the last, centred on the body. */
  depth: number;
};

/**
 * A `HEIGHTFIELD` collider's shape params from a row-major grid of heights, the layout a terrain
 * generator or an image gives: the one place the grid is turned into the collider's layout
 * (the glTF import's derivation runs on it too). The surface is centred on the body in x and z,
 * and its heights are the body's local y; each cell is split along the diagonal from
 * (row + 1, col) to (row, col + 1), as `generateTerrain`'s mesh is.
 * @param grid the heights, their rows and columns, and the size they span
 * @returns the shape params, ready for `createPhysicsEntity`'s `colliders`
 * @throws when `rows` or `cols` is under 2 or not whole, the sizes aren't positive, or `heights`
 * doesn't hold `rows` × `cols` values
 * @example
 * ```ts
 * import { createPhysicsEntity, toHeightfieldColliderParams } from 'aekasha/physics';
 *
 * // 3 × 2 heights over 4 × 2 m: the far right corner (+x, +z) is 1 m up
 * const collider = toHeightfieldColliderParams({
 *   heights: [0, 0, 0, 0, 0, 1],
 *   rows: 2,
 *   cols: 3,
 *   width: 4,
 *   depth: 2,
 * });
 * await createPhysicsEntity({ colliders: [collider], body: { rigidType: 'FIXED' } });
 * ```
 */
export const toHeightfieldColliderParams = ({
  heights,
  rows,
  cols,
  width,
  depth,
}: HeightfieldGrid): HeightFieldData & { type: 'HEIGHTFIELD' } => {
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 2 || cols < 2) {
    throw new Error(
      `toHeightfieldColliderParams: a grid needs 2 or more whole rows and columns of heights, got ${rows} × ${cols}.`
    );
  }
  if (!(width > 0) || !(depth > 0)) {
    throw new Error(
      `toHeightfieldColliderParams: the width and depth must be positive, got ${width} × ${depth}.`
    );
  }
  if (heights.length !== rows * cols) {
    throw new Error(
      `toHeightfieldColliderParams: ${rows} × ${cols} heights expected, got ${heights.length}.`
    );
  }
  // Rapier's heights are column-major, a row per z and a column per x: (r, c) at r + c * rows
  const columnMajor = new Float32Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) columnMajor[r + c * rows] = heights[r * cols + c];
  }
  return {
    type: 'HEIGHTFIELD',
    nrows: rows - 1,
    ncols: cols - 1,
    heights: columnMajor,
    scale: { x: width, y: 1, z: depth },
  };
};
