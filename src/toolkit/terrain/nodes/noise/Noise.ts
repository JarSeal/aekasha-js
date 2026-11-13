// The noise library's lattice noise (p304 D2): value and gradient noise, fbm and a domain warp, in
// 2D, each periodic (it tiles every `period` cells, so a baked texture repeats without a seam) or
// not (`period` left out: for live use in world space). The cells are hashed by `Hash.ts` (integer
// PCG), never `mx_*`, so it's safe on SwiftShader's WebGL 2 and the same on both backends up to
// float precision.
//
// Value and gradient noise are layout functions (`Fn` with a layout: one shader function, called
// as often as a graph needs it, cached across shaders), a periodic and a plain one each, since the
// period changes the body. fbm and the warp are built inline from them, their octaves unrolled at
// build time.
import { cos, float, floor, Fn, fract, max, mix, round, sin, uint, vec2 } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node } from 'three/webgpu';
import { hashCell12, hashCell22, noiseLayout, toSeedNode, type NoiseSeed } from './Hash';
import { resolveNoisePeriod, wrapCell, type NoisePeriod, type ResolvedPeriod } from './Period';

/** {@link valueNoise}'s and {@link gradientNoise}'s options. */
export type NoiseOptions = {
  /** The period in cells (see {@link NoisePeriod}). Default none: the noise never repeats. */
  period?: NoisePeriod;
  /** Another seed gives another noise. Default 0. */
  seed?: NoiseSeed;
};

/** {@link fbm}'s options. */
export type FbmOptions = NoiseOptions & {
  /** The octaves summed, 1 to 12: each adds finer detail at `lacunarity` times the frequency. */
  octaves: number;
  /** Each octave's frequency over the last one's, at least 1. Default 2. A periodic fbm rounds
   * each octave's period to a whole number, so every octave tiles at any lacunarity. */
  lacunarity?: number;
  /** Each octave's amplitude over the last one's (roughness: lower is smoother). Default 0.5. */
  gain?: number | Node<'float'>;
};

/** {@link domainWarp}'s options. */
export type DomainWarpOptions = Omit<FbmOptions, 'octaves'> & {
  /** How far the warp moves a point, in cells at most (about). */
  strength: number | Node<'float'>;
  /** The warp's fbm octaves, 1 to 12. Default 3. */
  octaves?: number;
};

/** The most octaves an fbm sums: past 12 at lacunarity 2 the detail is below a 4K texel. */
const MAX_OCTAVES = 12;
/** 2D gradient noise with unit gradients peaks at about √½: × √2 for about −1..1. */
const GRADIENT_SCALE = Math.SQRT2;
/** Each octave's seed steps by this (odd, so 2³² steps before one repeats). */
const OCTAVE_SEED_STRIDE = 0x2545f491;
/** The warp's y channel's seed offset from its x channel's. */
const WARP_Y_SEED = 0x51ed27;

/**
 * A periodic fbm's octave periods: the period × lacunarityⁱ, rounded to a whole number (at least
 * 1), so each octave tiles over the same tile. An octave samples the noise at `p × its period /
 * the period`.
 * @internal
 */
export const getOctavePeriods = (period: number, octaves: number, lacunarity: number) =>
  Array.from({ length: octaves }, (_, i) => Math.max(1, Math.round(period * lacunarity ** i)));

const checkOctaves = (octaves: number, lacunarity: number, name: string) => {
  if (!Number.isInteger(octaves) || octaves < 1 || octaves > MAX_OCTAVES) {
    throw new Error(
      `[${name}] octaves is ${octaves}; it takes a whole number from 1 to ${MAX_OCTAVES}.`
    );
  }
  if (!Number.isFinite(lacunarity) || lacunarity < 1) {
    throw new Error(`[${name}] lacunarity is ${lacunarity}; it takes a number of at least 1.`);
  }
};

/** The quintic fade (Perlin's improved noise): its first and second derivatives are 0 at the
 * cell edges, so no creases. */
const fade = (f: Node<'vec2'>): Node<'vec2'> =>
  f
    .mul(f)
    .mul(f)
    .mul(f.mul(f.mul(6).sub(15)).add(10)) as Node<'vec2'>;

/** The four corners of `p`'s cell, wrapped when periodic, the fractional part and its fade. */
const cellCorners = (p: Node<'vec2'>, period: Node<'vec2'> | null) => {
  const cell = floor(p) as Node<'vec2'>;
  const f = fract(p) as Node<'vec2'>;
  const corners = [vec2(0, 0), vec2(1, 0), vec2(0, 1), vec2(1, 1)].map((offset) => {
    const corner = cell.add(offset) as Node<'vec2'>;
    return period ? wrapCell(corner, period) : corner;
  });
  return { corners, f, u: fade(f) };
};

const bilerp = (values: Node<'float'>[], u: Node<'vec2'>): Node<'float'> =>
  mix(mix(values[0], values[1], u.x), mix(values[2], values[3], u.x), u.y) as Node<'float'>;

const valueBody = (p: Node<'vec2'>, seed: Node<'uint'>, period: Node<'vec2'> | null) => {
  const { corners, u } = cellCorners(p, period);
  const values = corners.map((corner) => hashCell12(corner, seed));
  return bilerp(values, u).mul(2).sub(1);
};

const gradientBody = (p: Node<'vec2'>, seed: Node<'uint'>, period: Node<'vec2'> | null) => {
  const { corners, f, u } = cellCorners(p, period);
  const offsets = [vec2(0, 0), vec2(1, 0), vec2(0, 1), vec2(1, 1)];
  const values = corners.map((corner, i) => {
    // A unit gradient at an angle from the corner's hash, dotted with the offset to the point
    const angle = hashCell22(corner, seed).x.mul(Math.PI * 2);
    return vec2(cos(angle), sin(angle)).dot(f.sub(offsets[i])) as Node<'float'>;
  });
  return bilerp(values, u).mul(GRADIENT_SCALE);
};

type PlainNoiseFn = (p: Node<'vec2'>, seed: Node<'uint'>) => Node<'float'>;
type PeriodicNoiseFn = (p: Node<'vec2'>, period: Node<'vec2'>, seed: Node<'uint'>) => Node<'float'>;

const valueNoiseFn = /*@__PURE__*/ Fn(
  ([p, seed]: [Node<'vec2'>, Node<'uint'>]) => valueBody(p, seed, null),
  noiseLayout('aekValueNoise', 'float', { p: 'vec2', seed: 'uint' })
) as unknown as PlainNoiseFn;

const valueNoisePeriodicFn = /*@__PURE__*/ Fn(
  ([p, period, seed]: [Node<'vec2'>, Node<'vec2'>, Node<'uint'>]) => valueBody(p, seed, period),
  noiseLayout('aekValueNoisePeriodic', 'float', { p: 'vec2', period: 'vec2', seed: 'uint' })
) as unknown as PeriodicNoiseFn;

const gradientNoiseFn = /*@__PURE__*/ Fn(
  ([p, seed]: [Node<'vec2'>, Node<'uint'>]) => gradientBody(p, seed, null),
  noiseLayout('aekGradientNoise', 'float', { p: 'vec2', seed: 'uint' })
) as unknown as PlainNoiseFn;

const gradientNoisePeriodicFn = /*@__PURE__*/ Fn(
  ([p, period, seed]: [Node<'vec2'>, Node<'vec2'>, Node<'uint'>]) => gradientBody(p, seed, period),
  noiseLayout('aekGradientNoisePeriodic', 'float', { p: 'vec2', period: 'vec2', seed: 'uint' })
) as unknown as PeriodicNoiseFn;

const callGradient = (p: Node<'vec2'>, period: Node<'vec2'> | null, seed: Node<'uint'>) =>
  period ? gradientNoisePeriodicFn(p, period, seed) : gradientNoiseFn(p, seed);

/**
 * Value noise: a random value at each whole-numbered lattice point, blended smoothly (a quintic
 * fade) across each cell. Blockier than {@link gradientNoise}, and cheaper: a mottling, a base for
 * cell-sized variation.
 * @param p the point, in cells (eg. a baked texture's `uv × 8` for 8 cells over the tile)
 * @param options the period (it tiles every `period` cells) and the seed
 * @returns a float in −1..1
 * @example
 * ```ts
 * import { vec3 } from 'three/tsl';
 * import { bakeTexture } from 'aekasha';
 * import { valueNoise } from 'aekasha/toolkit/terrain';
 *
 * // 8 cells over a tile that repeats without a seam
 * await bakeTexture({
 *   id: 'mottling',
 *   size: 256,
 *   outputs: [{ name: 'value' }],
 *   build: ({ uv }) => {
 *     const n = valueNoise(uv.mul(8), { period: 8, seed: 1 }).mul(0.5).add(0.5);
 *     return { value: vec3(n) };
 *   },
 * });
 * ```
 */
export const valueNoise = (p: Node<'vec2'>, options: NoiseOptions = {}): Node<'float'> => {
  const period = resolveNoisePeriod(options.period, 'valueNoise');
  const seed = toSeedNode(options.seed);
  return period ? valueNoisePeriodicFn(p, period.node, seed) : valueNoiseFn(p, seed);
};

/**
 * Gradient (Perlin) noise: a random unit gradient at each whole-numbered lattice point, blended
 * with a quintic fade. Smooth, with no blocky lattice: the base of {@link fbm}.
 * @param p the point, in cells (eg. a baked texture's `uv × 8` for 8 cells over the tile)
 * @param options the period (it tiles every `period` cells) and the seed
 * @returns a float in about −1..1 (0 on every lattice point)
 * @example
 * ```ts
 * import { positionWorld, vec2 } from 'three/tsl';
 * import type { Node } from 'three/webgpu';
 * import { gradientNoise } from 'aekasha/toolkit/terrain';
 *
 * // Live in world space, a cell every 4 m: no period, so it never repeats
 * const ground = vec2(positionWorld.x, positionWorld.z).div(4) as unknown as Node<'vec2'>;
 * const n = gradientNoise(ground, { seed: 5 });
 * ```
 */
export const gradientNoise = (p: Node<'vec2'>, options: NoiseOptions = {}): Node<'float'> =>
  callGradient(
    p,
    resolveNoisePeriod(options.period, 'gradientNoise')?.node ?? null,
    toSeedNode(options.seed)
  );

/** fbm with its period resolved and its seed a node: what {@link fbm} and the warp share. */
const buildFbm = (
  p: Node<'vec2'>,
  period: ResolvedPeriod,
  seed: Node<'uint'>,
  octaves: number,
  lacunarity: number,
  gain: number | Node<'float'>
): Node<'float'> => {
  const constantPeriods = period?.constant
    ? [
        getOctavePeriods(period.constant[0], octaves, lacunarity),
        getOctavePeriods(period.constant[1], octaves, lacunarity),
      ]
    : null;
  let sum: Node<'float'> = float(0) as unknown as Node<'float'>;
  let amplitude: Node<'float'> = float(1) as unknown as Node<'float'>;
  let amplitudes: Node<'float'> = float(0) as unknown as Node<'float'>;
  for (let i = 0; i < octaves; i++) {
    const octaveSeed =
      i === 0 ? seed : (seed.add(uint((i * OCTAVE_SEED_STRIDE) >>> 0)) as Node<'uint'>);
    let octavePeriod: Node<'vec2'> | null = null;
    let octaveP: Node<'vec2'>;
    if (!period) {
      octaveP = p.mul(lacunarity ** i) as Node<'vec2'>;
    } else if (constantPeriods && period.constant) {
      const [px, py] = [constantPeriods[0][i], constantPeriods[1][i]];
      octavePeriod = vec2(px, py) as unknown as Node<'vec2'>;
      octaveP = p.mul(vec2(px / period.constant[0], py / period.constant[1])) as Node<'vec2'>;
    } else {
      // A node period: the same rounding, in the shader
      octavePeriod = max(round(period.node.mul(lacunarity ** i)), vec2(1, 1)) as Node<'vec2'>;
      octaveP = p.mul(octavePeriod).div(period.node) as Node<'vec2'>;
    }
    sum = sum.add(callGradient(octaveP, octavePeriod, octaveSeed).mul(amplitude)) as Node<'float'>;
    amplitudes = amplitudes.add(amplitude) as Node<'float'>;
    amplitude = amplitude.mul(gain) as Node<'float'>;
  }
  return sum.div(amplitudes) as Node<'float'>;
};

/**
 * Fractal Brownian motion: {@link gradientNoise} summed over octaves, each at `lacunarity` times
 * the last one's frequency and `gain` times its amplitude, normalized by the amplitudes' sum. The
 * workhorse of natural surfaces: drifts, mottling, height. Periodic, every octave tiles over the
 * same tile (each octave's period rounded to a whole number), and each octave has its own seed.
 * @param p the point, in cells of the first octave
 * @param options the octaves, lacunarity, gain, period and seed
 * @returns a float in about −1..1 (mostly within ±0.5: a sum of octaves averages out)
 * @remarks Each octave is one gradient noise call: a periodic fbm costs the same as a plain one.
 * A `gain` node can change at runtime; `octaves` and `lacunarity` are build time.
 * @example
 * ```ts
 * import { uniform, vec3 } from 'three/tsl';
 * import { bakeTexture } from 'aekasha';
 * import { fbm } from 'aekasha/toolkit/terrain';
 *
 * const roughness = uniform(0.5);
 * const baked = await bakeTexture({
 *   id: 'drifts',
 *   size: 512,
 *   outputs: [{ name: 'height' }],
 *   build: ({ uv }) => {
 *     const h = fbm(uv.mul(4), { period: 4, octaves: 6, gain: roughness, seed: 2 });
 *     return { height: vec3(h.mul(0.5).add(0.5)) };
 *   },
 * });
 * // Later: roughness.value = 0.6; baked.rebake();
 * ```
 */
export const fbm = (p: Node<'vec2'>, options: FbmOptions): Node<'float'> => {
  const { octaves, lacunarity = 2, gain = 0.5 } = options;
  checkOctaves(octaves, lacunarity, 'fbm');
  const period = resolveNoisePeriod(options.period, 'fbm');
  return buildFbm(p, period, toSeedNode(options.seed), octaves, lacunarity, gain);
};

/**
 * A domain warp: the point moved by two {@link fbm}s (one per axis, seeded apart), so the noise
 * sampled at the result swirls into folds and streaks instead of blobs. Periodic, the warp tiles
 * with the same period, so a periodic noise at the warped point still tiles.
 * @param p the point, in cells
 * @param options the strength (in cells), the fbm's octaves (default 3), lacunarity, gain, period
 * and seed
 * @returns the warped point, a vec2
 * @example
 * ```ts
 * import { vec3 } from 'three/tsl';
 * import { bakeTexture } from 'aekasha';
 * import { domainWarp, fbm } from 'aekasha/toolkit/terrain';
 *
 * await bakeTexture({
 *   id: 'swirls',
 *   size: 512,
 *   outputs: [{ name: 'height' }],
 *   build: ({ uv }) => {
 *     const warped = domainWarp(uv.mul(4), { period: 4, strength: 0.8, seed: 9 });
 *     const h = fbm(warped, { period: 4, octaves: 5, seed: 1 });
 *     return { height: vec3(h.mul(0.5).add(0.5)) };
 *   },
 * });
 * ```
 */
export const domainWarp = (p: Node<'vec2'>, options: DomainWarpOptions): Node<'vec2'> => {
  const { octaves = 3, lacunarity = 2, gain = 0.5, strength } = options;
  checkOctaves(octaves, lacunarity, 'domainWarp');
  const period = resolveNoisePeriod(options.period, 'domainWarp');
  const seed = toSeedNode(options.seed);
  const seedY = seed.add(uint(WARP_Y_SEED)) as Node<'uint'>;
  const offset = vec2(
    buildFbm(p, period, seed, octaves, lacunarity, gain),
    buildFbm(p, period, seedY, octaves, lacunarity, gain)
  );
  return p.add(offset.mul(strength)) as Node<'vec2'>;
};
