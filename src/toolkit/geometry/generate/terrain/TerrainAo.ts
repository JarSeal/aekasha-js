// A generated terrain's horizon AO (p306 D4): per vertex, how much of the sky the surface around
// it hides, from the height grid alone. Large-scale occlusion (valleys, under cliffs), the part a
// tiling layer's own AO can't carry; `generateTerrain` writes it into `RGB_AO`'s A.

/** `generateTerrain`'s `ao`: the horizon AO's reach and strength. */
export type TerrainAoOptions = {
  /** How far each direction looks for the horizon, metres (> 0): about the size of the hollows to
   * darken. */
  radius: number;
  /** The darkening at a fully hidden sky, 0..1 (default 1). */
  strength?: number;
  /** The samples along each of the 8 directions, a whole number of 1 or more (default 16). Fewer
   * on a grid whose `radius` spans fewer cells. */
  steps?: number;
};

/** The 8 directions, in grid cells (columns, rows): the axes and the diagonals */
const DIRECTIONS = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
] as const;

/** How the AO marches over the grid: `steps` samples, `stride` cells apart */
export type TerrainAoMarch = { steps: number; stride: number };

/**
 * The march for the options over a grid's spacing: up to `steps` samples a whole number of cells
 * apart, reaching about `radius` along the axes. The grid needs `steps × stride` cells of border.
 * @internal
 * @param spacing the grid's smaller cell side, metres
 */
export const getTerrainAoMarch = (opts: TerrainAoOptions, spacing: number): TerrainAoMarch => {
  const { radius, steps: maxSteps = 16 } = opts;
  if (!(radius > 0)) throw new Error(`generateTerrain: ao.radius is ${radius}, not over 0.`);
  if (!Number.isInteger(maxSteps) || maxSteps < 1) {
    throw new Error(`generateTerrain: ao.steps is ${maxSteps}, not a whole number of 1 or more.`);
  }
  const cells = Math.max(1, Math.round(radius / spacing));
  const steps = Math.min(maxSteps, cells);
  return { steps, stride: Math.max(1, Math.round(cells / steps)) };
};

/**
 * The horizon AO of a grid's inner vertices, row-major, 1 unoccluded (HBAO on the height grid):
 * per direction the highest elevation angle over the samples, never under the surface's own
 * tangent there, and the sky it hides above the tangent (`sin(horizon) − sin(tangent)`), averaged
 * over the 8 directions, × `strength`. A plane, however steep, hides nothing of its own sky. The grid has `border` cells around the vertices measured (heights from
 * the same surface past the terrain's edge, so neighbouring blocks agree on their shared edge).
 * @internal
 * @param grid the heights with their border, row-major, `cols + 2 × border` a row
 * @param size the inner grid's rows and columns of vertices, its border, and its cell sides
 */
export const computeTerrainAo = (
  grid: Float32Array,
  size: { rows: number; cols: number; border: number; dx: number; dz: number },
  march: TerrainAoMarch,
  strength: number
) => {
  const { rows, cols, border, dx, dz } = size;
  const gridCols = cols + border * 2;
  const ao = new Float32Array(rows * cols);
  // Per direction, its unit vector in metres, and each sample's grid offset and 1 / its distance
  const unitX = new Float64Array(DIRECTIONS.length);
  const unitZ = new Float64Array(DIRECTIONS.length);
  const offsets = new Int32Array(DIRECTIONS.length * march.steps);
  const inverseDistances = new Float64Array(DIRECTIONS.length * march.steps);
  DIRECTIONS.forEach(([dc, dr], d) => {
    const length = Math.hypot(dc * dx, dr * dz);
    unitX[d] = (dc * dx) / length;
    unitZ[d] = (dr * dz) / length;
    for (let k = 1; k <= march.steps; k++) {
      const cells = k * march.stride;
      offsets[d * march.steps + k - 1] = cells * (dr * gridCols + dc);
      inverseDistances[d * march.steps + k - 1] = 1 / (cells * Math.hypot(dc * dx, dr * dz));
    }
  });
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const center = (row + border) * gridCols + col + border;
      const height = grid[center];
      // The surface's gradient (central differences: the border is a cell at least)
      const gradientX = (grid[center + 1] - grid[center - 1]) / (2 * dx);
      const gradientZ = (grid[center + gridCols] - grid[center - gridCols]) / (2 * dz);
      let hidden = 0;
      for (let d = 0; d < DIRECTIONS.length; d++) {
        const surfaceTangent = gradientX * unitX[d] + gradientZ * unitZ[d];
        let maxTangent = surfaceTangent;
        for (let k = 0; k < march.steps; k++) {
          const i = d * march.steps + k;
          const tangent = (grid[center + offsets[i]] - height) * inverseDistances[i];
          if (tangent > maxTangent) maxTangent = tangent;
        }
        // An angle's sine from its tangent: tan / √(1 + tan²)
        hidden +=
          maxTangent / Math.sqrt(1 + maxTangent * maxTangent) -
          surfaceTangent / Math.sqrt(1 + surfaceTangent * surfaceTangent);
      }
      ao[row * cols + col] = 1 - strength * (hidden / DIRECTIONS.length);
    }
  }
  return ao;
};
