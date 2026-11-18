// Poisson-disk sampling (p308 D4): Bridson's algorithm over a rectangle, accelerated by a grid of
// cells `radius / √2` wide (at most one point a cell), so O(n). The points go into a typed array.
// A new point is drawn in the annulus `radius..2 · radius` around an active one by rejection from
// its square (no sin / cos), so the points are plain arithmetic on the seeded draws: the same in
// every browser.

/** Candidates tried around an active point before it's retired (Bridson's k) */
const DEFAULT_ATTEMPTS = 30;

/** {@link samplePoissonDisk}'s options. */
export type PoissonDiskOpts = {
  /** The rectangle's width (along x), from 0. */
  width: number;
  /** The rectangle's depth (along z), from 0. */
  depth: number;
  /** No two points closer than this. */
  radius: number;
  /** The seeded draws, in [0, 1). */
  random: () => number;
  /** Candidates per active point (Bridson's k, default 30). */
  attempts?: number;
};

/**
 * Poisson-disk points over `[0, width] × [0, depth]`: none closer than `radius`, and no gap left
 * where another would fit (up to `attempts`' chance), so an even cover with no grid in it.
 * @internal
 * @returns the points, `[x0, z0, x1, z1, …]`, in the order they were found
 */
export const samplePoissonDisk = ({
  width,
  depth,
  radius,
  random,
  attempts = DEFAULT_ATTEMPTS,
}: PoissonDiskOpts): Float32Array => {
  const cellSize = radius / Math.SQRT2;
  const cols = Math.max(1, Math.ceil(width / cellSize));
  const rows = Math.max(1, Math.ceil(depth / cellSize));
  // Each cell's point (its index + 1), 0 for none, with a border of 2 empty cells all round, so a
  // neighbourhood is read without bounds checks
  const gridCols = cols + 4;
  const grid = new Int32Array(gridCols * (rows + 4));
  // A point within `radius` is at most two cells away; a corner cell two away both ways is never
  // closer than `radius` (its nearest point is √2 · 1 cell away on each axis)
  const neighbours: number[] = [];
  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      if (Math.abs(r) + Math.abs(c) < 4) neighbours.push(r * gridCols + c);
    }
  }
  const offsets = Int32Array.from(neighbours);
  // At most one point a cell: the cell count bounds the arrays
  const capacity = cols * rows;
  const points = new Float64Array(capacity * 2);
  const active = new Int32Array(capacity);
  const radiusSq = radius * radius;
  let count = 0;
  let activeCount = 0;

  /** The cell's index in the bordered grid (x and z within the rectangle) */
  const cellOf = (x: number, z: number) =>
    (Math.min(rows - 1, Math.floor(z / cellSize)) + 2) * gridCols +
    Math.min(cols - 1, Math.floor(x / cellSize)) +
    2;

  const isFree = (x: number, z: number) => {
    const cell = cellOf(x, z);
    for (let k = 0; k < offsets.length; k++) {
      const other = grid[cell + offsets[k]] - 1;
      if (other < 0) continue;
      const dx = points[other * 2] - x;
      const dz = points[other * 2 + 1] - z;
      if (dx * dx + dz * dz < radiusSq) return false;
    }
    return true;
  };

  const add = (x: number, z: number) => {
    points[count * 2] = x;
    points[count * 2 + 1] = z;
    grid[cellOf(x, z)] = count + 1;
    active[activeCount++] = count;
    count++;
  };

  add(random() * width, random() * depth);
  while (activeCount) {
    const slot = Math.floor(random() * activeCount);
    const from = active[slot];
    const fromX = points[from * 2];
    const fromZ = points[from * 2 + 1];
    let isFound = false;
    for (let attempt = 0; attempt < attempts; attempt++) {
      // A point of the annulus, by rejection from its square (about 1.7 draws of two numbers)
      let dx = 0;
      let dz = 0;
      let distanceSq = 0;
      do {
        dx = (random() * 4 - 2) * radius;
        dz = (random() * 4 - 2) * radius;
        distanceSq = dx * dx + dz * dz;
      } while (distanceSq < radiusSq || distanceSq > 4 * radiusSq);
      const x = fromX + dx;
      const z = fromZ + dz;
      if (x < 0 || x > width || z < 0 || z > depth || !isFree(x, z)) continue;
      add(x, z);
      isFound = true;
      break;
    }
    // Retired: the last active point takes its slot
    if (!isFound) active[slot] = active[--activeCount];
  }
  return Float32Array.from(points.subarray(0, count * 2));
};
