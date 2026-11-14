// The noise library's hashing (p304 D2): a 2D integer PCG hash (Jarzynski and Olano, "Hash
// Functions for GPU Rendering", 2020: pcg2d) of a lattice cell and a seed. Integer maths only, so
// it's exact and the same on WebGPU and WebGL 2 (SwiftShader too), unlike a sine hash or the
// `mx_*` noise. Each component is hashed on its own: WGSL shifts a vector only by a vector.
import { float, Fn, int, uint, uvec2, vec2 } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node } from 'three/webgpu';
import { resolveNoisePeriod, wrapCell, type NoisePeriod } from './Period';

/** A seed: a whole number (0 to 2³² − 1, a negative one wraps), or an int or uint node. */
export type NoiseSeed = number | Node<'uint'> | Node<'int'>;

/** {@link hash12}'s and {@link hash22}'s options. */
export type HashOptions = {
  /** Another seed gives other values for every cell. Default 0. */
  seed?: NoiseSeed;
  /** The period in cells (see {@link NoisePeriod}): cell `x + period` gets cell `x`'s value, so
   * per-cell variation in a baked texture tiles. Default none. */
  period?: NoisePeriod;
};

const PCG_MUL = 1664525;
const PCG_INC = 1013904223;
/** The golden ratio's odd 32-bit constant: spreads the seed over every bit before the hash. */
const SEED_MUL = 0x9e3779b9;
/** A float in [0, 1) from a hash's top 24 bits: exact, never 1 (a float of the whole uint rounds
 * up to 2³² near the top). */
const TO_UNIT = 1 / 2 ** 24;

/**
 * A layout function's full layout, so its shader function has a readable name (`aek…`) instead
 * of `fn<id>`.
 * @internal
 */
export const noiseLayout = (name: string, type: string, inputs: Record<string, string>) => ({
  name,
  type,
  inputs: Object.entries(inputs).map(([inputName, inputType]) => ({
    name: inputName,
    type: inputType,
  })),
});

/** pcg2d: two rounds of the components feeding each other, then an xorshift. */
const pcg2d = /*@__PURE__*/ Fn(
  ([v]: [Node<'uvec2'>]) => {
    const x = v.x.mul(uint(PCG_MUL)).add(uint(PCG_INC)).toVar();
    const y = v.y.mul(uint(PCG_MUL)).add(uint(PCG_INC)).toVar();
    x.addAssign(y.mul(uint(PCG_MUL)));
    y.addAssign(x.mul(uint(PCG_MUL)));
    x.assign(x.bitXor(x.shiftRight(uint(16))));
    y.assign(y.bitXor(y.shiftRight(uint(16))));
    x.addAssign(y.mul(uint(PCG_MUL)));
    y.addAssign(x.mul(uint(PCG_MUL)));
    x.assign(x.bitXor(x.shiftRight(uint(16))));
    y.assign(y.bitXor(y.shiftRight(uint(16))));
    return uvec2(x, y);
  },
  noiseLayout('aekPcg2d', 'uvec2', { v: 'uvec2' })
);

/**
 * A seed as a uint node: a number wrapped to 32 bits, an int node's bits as they are.
 * @internal
 */
export const toSeedNode = (seed: NoiseSeed = 0): Node<'uint'> => {
  if (typeof seed === 'number') {
    if (!Number.isInteger(seed)) {
      throw new Error(`[noise] The seed ${seed} isn't a whole number.`);
    }
    return uint(seed >>> 0) as unknown as Node<'uint'>;
  }
  return (seed.nodeType === 'uint' ? seed : (seed as Node<'int'>).toUint()) as Node<'uint'>;
};

/**
 * A lattice cell's two 32-bit hashes: the cell (whole-numbered floats) through int to uint, so a
 * negative cell keeps its bits (a float straight to uint saturates at 0 on WGSL), the seed mixed
 * into x.
 * @internal
 */
export const hashCellBits = /*@__PURE__*/ Fn(
  ([cell, seed]: [Node<'vec2'>, Node<'uint'>]) => {
    const x = int(cell.x)
      .toUint()
      .bitXor(seed.mul(uint(SEED_MUL)));
    const y = int(cell.y).toUint();
    return pcg2d(uvec2(x, y));
  },
  noiseLayout('aekHashCell', 'uvec2', { cell: 'vec2', seed: 'uint' })
) as unknown as (cell: Node<'vec2'>, seed: Node<'uint'>) => Node<'uvec2'>;

/**
 * A lattice cell's two hashes as floats in [0, 1).
 * @internal
 */
export const hashCell22 = (cell: Node<'vec2'>, seed: Node<'uint'>): Node<'vec2'> => {
  const bits = hashCellBits(cell, seed);
  return vec2(float(bits.x.shiftRight(uint(8))), float(bits.y.shiftRight(uint(8)))).mul(
    TO_UNIT
  ) as unknown as Node<'vec2'>;
};

/**
 * A lattice cell's hash as a float in [0, 1).
 * @internal
 */
export const hashCell12 = (cell: Node<'vec2'>, seed: Node<'uint'>): Node<'float'> =>
  float(hashCellBits(cell, seed).x.shiftRight(uint(8))).mul(TO_UNIT) as unknown as Node<'float'>;

/** The cell of `p`, wrapped by the options' period when it has one. */
const getHashedCell = (p: Node<'vec2'>, options: HashOptions, name: string): Node<'vec2'> => {
  const cell = p.floor() as Node<'vec2'>;
  const period = resolveNoisePeriod(options.period, name);
  return period ? wrapCell(cell, period.node) : cell;
};

/**
 * A random number in [0, 1) for each whole-numbered cell of the plane: the same cell and seed give
 * the same number on every GPU and backend (an integer hash, no `mx_*` or sine). For per-cell
 * variation (a pebble's colour, a tile's offset) and dithering.
 * @param p the point; its cell is `floor(p)`, so every point in a cell gets the cell's number
 * @param options the seed and the period
 * @returns a float in [0, 1)
 * @example
 * ```ts
 * import { floor, uv, vec3 } from 'three/tsl';
 * import type { Node } from 'three/webgpu';
 * import { hash12 } from 'aekasha/toolkit/terrain';
 *
 * // A grey per tile of an 8 × 8 grid that tiles (period 8)
 * const tile = floor((uv() as unknown as Node<'vec2'>).mul(8)) as Node<'vec2'>;
 * const grey = vec3(hash12(tile, { seed: 3, period: 8 }));
 * ```
 */
export const hash12 = (p: Node<'vec2'>, options: HashOptions = {}): Node<'float'> =>
  hashCell12(getHashedCell(p, options, 'hash12'), toSeedNode(options.seed));

/**
 * Two random numbers in [0, 1) for each whole-numbered cell of the plane, independent of each
 * other: the same cell and seed give the same pair on every GPU and backend. For a point jittered
 * inside its cell, or a random direction.
 * @param p the point; its cell is `floor(p)`
 * @param options the seed and the period
 * @returns a vec2 in [0, 1)²
 * @example
 * ```ts
 * import { floor, uv } from 'three/tsl';
 * import type { Node } from 'three/webgpu';
 * import { hash22 } from 'aekasha/toolkit/terrain';
 *
 * // A point somewhere in each cell of a 16 × 16 grid
 * const p = (uv() as unknown as Node<'vec2'>).mul(16) as Node<'vec2'>;
 * const point = floor(p).add(hash22(p, { seed: 7 }));
 * ```
 */
export const hash22 = (p: Node<'vec2'>, options: HashOptions = {}): Node<'vec2'> =>
  hashCell22(getHashedCell(p, options, 'hash22'), toSeedNode(options.seed));
