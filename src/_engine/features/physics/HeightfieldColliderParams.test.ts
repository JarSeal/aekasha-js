import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { toHeightfieldColliderParams } from './HeightfieldColliderParams';

// The layout is pinned against Rapier itself (its compat build runs in Node): a grid that isn't
// square, with a spike near one corner, so a swapped axis, a flip or a transpose shows.

beforeAll(async () => {
  await RAPIER.init();
});

const ROWS = 5;
const COLS = 9;
const WIDTH = 16;
const DEPTH = 8;
/** The spike's row and column: near the corner of +x and -z. */
const SPIKE = { r: 1, c: 7 };

/** Row-major heights: a gentle slope along x, and the spike. */
const createGrid = () => {
  const heights = new Float32Array(ROWS * COLS);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) heights[r * COLS + c] = c * 0.1 + r * 0.01;
  }
  heights[SPIKE.r * COLS + SPIKE.c] = 5;
  return heights;
};

/** The grid point's x and z on the body. */
const pointOf = (r: number, c: number) => ({
  x: (c / (COLS - 1)) * WIDTH - WIDTH / 2,
  z: (r / (ROWS - 1)) * DEPTH - DEPTH / 2,
});

/** The height of the surface under (x, z), by a ray down onto the collider's world. */
const createCaster = (heights: Float32Array) => {
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  const params = toHeightfieldColliderParams({
    heights,
    rows: ROWS,
    cols: COLS,
    width: WIDTH,
    depth: DEPTH,
  });
  world.createCollider(
    RAPIER.ColliderDesc.heightfield(params.nrows, params.ncols, params.heights, params.scale)
  );
  world.step();
  return (x: number, z: number) => {
    // A hair inside the edges, so the ray never misses the border
    const ix = Math.min(Math.max(x, -WIDTH / 2 + 1e-4), WIDTH / 2 - 1e-4);
    const iz = Math.min(Math.max(z, -DEPTH / 2 + 1e-4), DEPTH / 2 - 1e-4);
    const hit = world.castRay(
      new RAPIER.Ray({ x: ix, y: 100, z: iz }, { x: 0, y: -1, z: 0 }),
      200,
      true
    );
    return hit ? 100 - hit.timeOfImpact : NaN;
  };
};

describe('toHeightfieldColliderParams', () => {
  it('turns a row-major grid into the collider layout', () => {
    // Two rows of three: row 0 at -z, row 1 at +z
    const params = toHeightfieldColliderParams({
      heights: [0, 1, 2, 3, 4, 5],
      rows: 2,
      cols: 3,
      width: 4,
      depth: 2,
    });
    expect(params).toMatchObject({
      type: 'HEIGHTFIELD',
      nrows: 1,
      ncols: 2,
      scale: { x: 4, y: 1, z: 2 },
    });
    expect([...params.heights]).toEqual([0, 3, 1, 4, 2, 5]);
  });

  it('throws on a grid that does not fit', () => {
    const grid = { heights: [0, 0, 0, 0], rows: 2, cols: 2, width: 1, depth: 1 };
    expect(() => toHeightfieldColliderParams({ ...grid, rows: 1, cols: 4 })).toThrow('2 or more');
    expect(() => toHeightfieldColliderParams({ ...grid, rows: 2.5 })).toThrow('2 or more');
    expect(() => toHeightfieldColliderParams({ ...grid, width: 0 })).toThrow('positive');
    expect(() => toHeightfieldColliderParams({ ...grid, heights: [0, 0, 0] })).toThrow(
      '2 × 2 heights expected, got 3'
    );
  });

  it("puts every height where the grid says, on Rapier's surface", () => {
    const heights = createGrid();
    const castAt = createCaster(heights);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const { x, z } = pointOf(r, c);
        expect(castAt(x, z), `row ${r}, column ${c}`).toBeCloseTo(heights[r * COLS + c], 3);
      }
    }
    // The spike is near +x, -z
    expect(castAt(WIDTH / 2 - WIDTH / (COLS - 1), -DEPTH / 2 + DEPTH / (ROWS - 1))).toBeCloseTo(5);
  });

  it('splits each cell along the diagonal from (row + 1, col) to (row, col + 1)', () => {
    const heights = createGrid();
    const castAt = createCaster(heights);
    const h = (r: number, c: number) => heights[r * COLS + c];
    // The spike's cells all around: the plane of the triangle under each sample
    for (let r = SPIKE.r - 1; r <= SPIKE.r; r++) {
      for (let c = SPIKE.c - 1; c <= SPIKE.c; c++) {
        for (const [tx, tz] of [
          [0.25, 0.25],
          [0.75, 0.75],
          [0.2, 0.6],
          [0.6, 0.2],
        ]) {
          const { x, z } = pointOf(r + tz, c + tx);
          const expected =
            tx + tz <= 1
              ? h(r, c) + (h(r, c + 1) - h(r, c)) * tx + (h(r + 1, c) - h(r, c)) * tz
              : h(r + 1, c + 1) +
                (h(r + 1, c) - h(r + 1, c + 1)) * (1 - tx) +
                (h(r, c + 1) - h(r + 1, c + 1)) * (1 - tz);
          expect(castAt(x, z), `cell ${r}, ${c} at ${tx}, ${tz}`).toBeCloseTo(expected, 3);
        }
      }
    }
  });
});
