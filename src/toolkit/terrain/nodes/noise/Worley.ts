// The noise library's cellular noise (p304 D2): Worley (Voronoi) distances to the nearest and
// second-nearest feature points, one point jittered inside each lattice cell, and the nearest
// point's cell id. Periodic (the cells wrapped before they're hashed, so a baked texture tiles) or
// not. A layout function per variant searches the 3 × 3 neighbouring cells, which finds F1 exactly
// at any jitter up to 1 (F2 can miss a point two cells away where the jitter is high: a slightly
// short distance far from any cell edge, never a seam).
import { float, Fn, floor, fract, min, select, uint, vec2, vec3 } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node } from 'three/webgpu';
import { hashCell12, hashCell22, noiseLayout, toSeedNode, type NoiseSeed } from './Hash';
import { resolveNoisePeriod, wrapCell, type NoisePeriod } from './Period';

/** {@link worley}'s options. */
export type WorleyOptions = {
  /** The period in cells (see {@link NoisePeriod}). Default none: the cells never repeat. */
  period?: NoisePeriod;
  /** Another seed gives other points and ids. Default 0. */
  seed?: NoiseSeed;
  /** How far each cell's point may stray from the cell's centre, 0 (a regular grid) to 1 (anywhere
   * in the cell). Default 1. */
  jitter?: number | Node<'float'>;
};

/** {@link worley}'s result, in cells. */
export type WorleySample = {
  /** The distance to the nearest point: 0 at a point, about 0.5 between two (pebbles, bubbles). */
  f1: Node<'float'>;
  /** The distance to the second-nearest point: `f2 − f1` is 0 on a cell's edge (cracks, plates). */
  f2: Node<'float'>;
  /** The nearest point's cell as a number in [0, 1), the same over the whole cell: a per-cell
   * colour, height or variant. */
  cellId: Node<'float'>;
};

/** The id hash's seed offset from the points', so a cell's id doesn't follow its point. */
const ID_SEED = 0x68e31da4;
/** A distance past any point a 3 × 3 search can find (√8 ≈ 2.83). */
const FAR = 8;

/** Writes f1, f2 and the id of the cell closest to `p` (a vec3), searching the 3 × 3 cells. */
const worleyBody = (
  p: Node<'vec2'>,
  seed: Node<'uint'>,
  jitter: Node<'float'>,
  period: Node<'vec2'> | null
) => {
  const cell = floor(p) as Node<'vec2'>;
  const f = fract(p) as Node<'vec2'>;
  const f1 = float(FAR).toVar();
  const f2 = float(FAR).toVar();
  const nearest = vec2(0, 0).toVar();
  for (let y = -1; y <= 1; y++) {
    for (let x = -1; x <= 1; x++) {
      const offset = vec2(x, y);
      const neighbour = cell.add(offset) as Node<'vec2'>;
      const hashed = period ? wrapCell(neighbour, period) : neighbour;
      // The point, relative to `p`'s cell: the neighbour's centre, moved by its hash × jitter
      const point = offset.add(hashCell22(hashed, seed).sub(0.5).mul(jitter)).add(0.5);
      const d = point.sub(f).length().toVar();
      const isNearest = d.lessThan(f1);
      f2.assign(select(isNearest, f1, min(f2, d)));
      nearest.assign(select(isNearest, hashed, nearest));
      f1.assign(min(f1, d));
    }
  }
  return vec3(f1, f2, hashCell12(nearest, seed.add(uint(ID_SEED)) as Node<'uint'>));
};

type PlainWorleyFn = (p: Node<'vec2'>, seed: Node<'uint'>, jitter: Node<'float'>) => Node<'vec3'>;
type PeriodicWorleyFn = (
  p: Node<'vec2'>,
  period: Node<'vec2'>,
  seed: Node<'uint'>,
  jitter: Node<'float'>
) => Node<'vec3'>;

const worleyFn = /*@__PURE__*/ Fn(
  ([p, seed, jitter]: [Node<'vec2'>, Node<'uint'>, Node<'float'>]) =>
    worleyBody(p, seed, jitter, null),
  noiseLayout('aekWorley', 'vec3', { p: 'vec2', seed: 'uint', jitter: 'float' })
) as unknown as PlainWorleyFn;

const worleyPeriodicFn = /*@__PURE__*/ Fn(
  ([p, period, seed, jitter]: [Node<'vec2'>, Node<'vec2'>, Node<'uint'>, Node<'float'>]) =>
    worleyBody(p, seed, jitter, period),
  noiseLayout('aekWorleyPeriodic', 'vec3', {
    p: 'vec2',
    period: 'vec2',
    seed: 'uint',
    jitter: 'float',
  })
) as unknown as PeriodicWorleyFn;

/**
 * Worley (cellular, Voronoi) noise: one point in each whole-numbered cell, jittered by its hash,
 * and the distances from `p` to the nearest two (`f1`, `f2`) with the nearest one's cell id. `f1`
 * makes pebbles and bubbles, `f2 − f1` cracks and plate edges, `cellId` a per-cell colour or
 * height. Periodic, the cells repeat every `period` cells, so a baked texture tiles.
 * @param p the point, in cells (eg. a baked texture's `uv × 12` for 12 cells over the tile)
 * @param options the period, the seed and the jitter
 * @returns the distances (in cells) and the cell id, read from one search
 * @remarks One call is one 3 × 3 search (9 hashes and one for the id): read every value from the
 * same result rather than calling it again.
 * @example
 * ```ts
 * import { smoothstep, vec3 } from 'three/tsl';
 * import { bakeTexture } from 'aekasha';
 * import { worley } from 'aekasha/toolkit/terrain';
 *
 * // Dried mud: plates with a crack along every cell edge, each plate a shade of its own
 * await bakeTexture({
 *   id: 'mudPlates',
 *   size: 512,
 *   outputs: [{ name: 'albedo', colorSpace: 'SRGB' }],
 *   build: ({ uv }) => {
 *     const cells = worley(uv.mul(10), { period: 10, seed: 4, jitter: 0.8 });
 *     const crack = smoothstep(0, 0.06, cells.f2.sub(cells.f1));
 *     const shade = cells.cellId.mul(0.15).add(0.45);
 *     return { albedo: vec3(shade, shade.mul(0.8), shade.mul(0.6)).mul(crack) };
 *   },
 * });
 * ```
 */
export const worley = (p: Node<'vec2'>, options: WorleyOptions = {}): WorleySample => {
  const period = resolveNoisePeriod(options.period, 'worley');
  const seed = toSeedNode(options.seed);
  if (typeof options.jitter === 'number' && !(options.jitter >= 0 && options.jitter <= 1)) {
    throw new Error(
      `[worley] jitter is ${options.jitter}; it takes 0 to 1 (past 1 a point leaves its cell, and the 3 × 3 search can miss the nearest).`
    );
  }
  const jitter = (
    typeof options.jitter === 'number' || options.jitter === undefined
      ? float(options.jitter ?? 1)
      : options.jitter
  ) as Node<'float'>;
  // One search: the three values read the same variable
  const result = (
    period ? worleyPeriodicFn(p, period.node, seed, jitter) : worleyFn(p, seed, jitter)
  ).toVar() as Node<'vec3'>;
  return {
    f1: result.x as Node<'float'>,
    f2: result.y as Node<'float'>,
    cellId: result.z as Node<'float'>,
  };
};
