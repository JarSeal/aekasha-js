// The terrain rules (p305 D4): a layer's coverage from the surface's slope, height and facing,
// broken up by a macro noise channel. The type and its defaults are here, in `geometry`, so the
// terrain material (`aekasha/toolkit/terrain`, which evaluates them per pixel) and the CPU
// evaluation into vertex colours (p306 D4, next to this) share one spec: `terrain` imports
// `geometry`, never the reverse.

/**
 * A rule's range of one measure (degrees of slope, or metres of height): the rule is whole from
 * `min` to `max` and fades out over `softness` past each given end. An end not given is open.
 */
export type TerrainRuleRange = {
  /** The lowest value at which the rule is whole; none: no lower end. */
  min?: number;
  /** The highest value at which the rule is whole; none: no upper end. */
  max?: number;
  /** How far past each end the rule fades out to 0, in the range's units (≥ 0). */
  softness?: number;
};

/**
 * A rule's facing: the surface's downhill direction within `range` degrees of `direction` (eg.
 * north-facing slopes keep their snow), fading out over `softness` degrees past it. Flat ground
 * has no facing and passes.
 */
export type TerrainRuleAspect = {
  /** The facing, a horizontal world direction `[x, z]` (its length doesn't matter, not 0). */
  direction: [number, number];
  /** Degrees either side of `direction` at which the rule is whole, 0..180. */
  range: number;
  /** Degrees past `range` over which the rule fades out to 0, 0..180. */
  softness?: number;
};

/** The macro noise texture's channels a rule's noise reads (the toolkit's `macroNoise`: R, G and A noises, B patches). */
export const TERRAIN_RULE_NOISE_CHANNELS = ['R', 'G', 'B', 'A'] as const;

/**
 * A rule's noise: a channel of the macro noise texture at the world's `(x, −z) / scale`, which
 * raises and lowers the rule's coverage by up to `amount` either way, so its borders break up.
 */
export type TerrainRuleNoise = {
  /** The metres one tile of the noise texture covers (> 0). */
  scale: number;
  /** How far the noise moves the coverage either way, 0..1 (1: a whole rule can vanish, or appear). */
  amount: number;
  /** The macro noise texture's channel (default `R`). */
  channel?: (typeof TERRAIN_RULE_NOISE_CHANNELS)[number];
};

// p305 D4
/**
 * A procedural terrain rule: where the surface's slope, height and facing are in the
 * rule's ranges, its layer covers the layers under it. Its coverage is the product of the tests
 * it gives, moved by its noise and × its `strength`; the rules composite over the incoming
 * weights in order (`w = mix(w, onehot(layer), coverage)`), so a later rule covers an earlier one.
 * The terrain material evaluates them per pixel (`blend.source` `RULES` and the painted sources'
 * `_AND_RULES` combos).
 */
export type TerrainRule = {
  /** The layer this rule lays down, by its index in the material's layers. */
  layer: number;
  /** The slope in degrees (0 flat, 90 a vertical face), from the geometry's normal. */
  slope?: TerrainRuleRange;
  /** The world height in metres. */
  height?: TerrainRuleRange;
  /** The surface's facing. */
  aspect?: TerrainRuleAspect;
  /** The noise that breaks the coverage up: the material's macro noise texture. */
  noise?: TerrainRuleNoise;
  /** The coverage's scale, 0..1 (default 1): under 1 the layers under it show through. */
  strength?: number;
};

/** The defaults of a {@link TerrainRule}'s optional fields. */
export const TERRAIN_RULE_DEFAULTS = {
  /** Degrees of slope past an end. */
  slopeSoftness: 5,
  /** Metres of height past an end. */
  heightSoftness: 2,
  /** Degrees of facing past the range. */
  aspectSoftness: 15,
  noiseChannel: 'R',
  strength: 1,
} as const satisfies Record<string, number | TerrainRuleNoise['channel']>;

// The CPU evaluation (p306 D4): the terrain material's rules (`terrain/nodes/Rules.ts`) in plain
// TypeScript, for a generated terrain's vertex colours. The same math, so a rule lays its layer
// where the shader would, at the vertices; between them the colour is interpolated.

const RAD_TO_DEG = 180 / Math.PI;
/** A softness's floor, the shader's (its `smoothstep` with equal edges is undefined) */
const MIN_SOFTNESS = 1e-4;
/** The horizontal normal's lengths over which the facing test fades in, the shader's */
const FLAT_FACING: [number, number] = [0.02, 0.1];
const CHANNEL_OFFSETS = { R: 0, G: 1, B: 2, A: 3 } as const;

/**
 * The macro noise texture's texels, for the rules' noise on the CPU ({@link evaluateTerrainRulesCPU}):
 * RGBA, 8 bits a channel (0..255), row 0 at the texture's v = 0 (the first row of an `ImageData`, a
 * `DataTexture` or a render target read back). Sampled bilinear and repeating, like the shader's
 * texture, at its full resolution (the GPU's mips blur it in the distance).
 */
export type TerrainRuleNoiseTexels = {
  /** The texels, `width × height × 4` bytes, row by row. */
  data: ArrayLike<number>;
  /** The texels across, 1 or more. */
  width: number;
  /** The texels down, 1 or more. */
  height: number;
};

/** A surface point the rules measure on the CPU: its world position and its unit normal. */
export type TerrainRulePoint = {
  /** The world x, metres (the noise's u). */
  x: number;
  /** The world height, metres (the rules' `height`). */
  y: number;
  /** The world z, metres (the noise's v is −z). */
  z: number;
  /** The unit normal's x (with `normalZ` the facing). */
  normalX: number;
  /** The unit normal's y (the slope). */
  normalY: number;
  /** The unit normal's z. */
  normalZ: number;
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** GLSL's `smoothstep` */
const smoothstep = (from: number, to: number, value: number) => {
  const t = clamp01((value - from) / (to - from));
  return t * t * (3 - 2 * t);
};

/** 1 within a range, fading to 0 over its softness past each given end */
const getRangeCoverage = (range: TerrainRuleRange, value: number, defaultSoftness: number) => {
  const softness = Math.max(range.softness ?? defaultSoftness, MIN_SOFTNESS);
  let coverage = 1;
  if (range.min !== undefined) coverage *= smoothstep(range.min - softness, range.min, value);
  if (range.max !== undefined) coverage *= 1 - smoothstep(range.max, range.max + softness, value);
  return coverage;
};

/** 1 where the downhill direction is within the facing's range, fading past it; 1 on flat ground */
const getAspectCoverage = (aspect: TerrainRuleAspect, point: TerrainRulePoint) => {
  // Not Math.hypot: several times slower in V8, and this runs per vertex
  const length = Math.sqrt(point.normalX * point.normalX + point.normalZ * point.normalZ);
  const facingLength = Math.max(length, 1e-5);
  const [dx, dz] = aspect.direction;
  const directionLength = Math.sqrt(dx * dx + dz * dz);
  const cosine = (point.normalX * dx + point.normalZ * dz) / (facingLength * directionLength) || 0;
  const angle = Math.acos(Math.min(1, Math.max(-1, cosine))) * RAD_TO_DEG;
  const softness = Math.max(aspect.softness ?? TERRAIN_RULE_DEFAULTS.aspectSoftness, MIN_SOFTNESS);
  const coverage = 1 - smoothstep(aspect.range, aspect.range + softness, angle);
  const flat = smoothstep(FLAT_FACING[0], FLAT_FACING[1], length);
  return 1 + (coverage - 1) * flat;
};

/** A whole number wrapped into 0..size − 1 */
const wrap = (value: number, size: number) => ((value % size) + size) % size;

/** A channel of the texels at a texture coordinate, bilinear and repeating, 0..1 */
const sampleNoise = (texels: TerrainRuleNoiseTexels, u: number, v: number, channel: number) => {
  const { data, width, height } = texels;
  const tx = u * width - 0.5;
  const ty = v * height - 0.5;
  const x0 = Math.floor(tx);
  const y0 = Math.floor(ty);
  const fx = tx - x0;
  const fy = ty - y0;
  const left = wrap(x0, width) * 4 + channel;
  const right = wrap(x0 + 1, width) * 4 + channel;
  const top = wrap(y0, height) * width * 4;
  const bottom = wrap(y0 + 1, height) * width * 4;
  const upper = data[top + left] + (data[top + right] - data[top + left]) * fx;
  const lower = data[bottom + left] + (data[bottom + right] - data[bottom + left]) * fx;
  return (upper + (lower - upper) * fy) / 255;
};

/**
 * A rule's coverage at a point on the CPU, 0..1: the product of its tests, moved by its noise (±
 * `amount` about the channel's middle), clamped, × its strength; the terrain material's math.
 * @param rule the rule, its optional fields at their {@link TERRAIN_RULE_DEFAULTS}
 * @param point the surface point: its world position and unit normal
 * @param noise the macro noise texture's texels, which a rule with `noise` needs
 * @throws for a rule with noise and no texels
 */
export const getTerrainRuleCoverageCPU = (
  rule: TerrainRule,
  point: TerrainRulePoint,
  noise?: TerrainRuleNoiseTexels
) => {
  let coverage = 1;
  if (rule.slope) {
    const slope = Math.acos(Math.min(1, Math.max(-1, point.normalY))) * RAD_TO_DEG;
    coverage *= getRangeCoverage(rule.slope, slope, TERRAIN_RULE_DEFAULTS.slopeSoftness);
  }
  if (rule.height) {
    coverage *= getRangeCoverage(rule.height, point.y, TERRAIN_RULE_DEFAULTS.heightSoftness);
  }
  if (rule.aspect) coverage *= getAspectCoverage(rule.aspect, point);
  if (rule.noise) {
    if (!noise) {
      throw new Error(
        `getTerrainRuleCoverageCPU: the rule of layer ${rule.layer} has noise: give the macro noise texture's texels.`
      );
    }
    const { scale, amount } = rule.noise;
    const channel = CHANNEL_OFFSETS[rule.noise.channel ?? TERRAIN_RULE_DEFAULTS.noiseChannel];
    const value = sampleNoise(noise, point.x / scale, -point.z / scale, channel);
    coverage = clamp01(coverage + (value - 0.5) * 2 * amount);
  }
  return coverage * (rule.strength ?? TERRAIN_RULE_DEFAULTS.strength);
};

// p306 D4
/**
 * The terrain rules on the CPU: composites each rule's coverage over the weights in
 * order (`w = mix(w, onehot(layer), coverage)`), so a later rule covers an earlier one, as the
 * terrain material does per pixel. Raw weights in, raw weights out (their sum kept). Used by
 * `generateTerrain`'s `vertexColors` to lay the rules into a mesh's vertex colours.
 * @param rules the rules, in order
 * @param point the surface point: its world position and unit normal
 * @param weights the incoming weights, one per layer from the base (eg. `[1, 0, 0, 0]`: the base
 * alone), changed in place
 * @param noise the macro noise texture's texels, which a rule with `noise` needs
 * @returns `weights`
 * @throws for a rule whose layer isn't one of the weights', or with noise and no texels
 * @example
 * ```ts
 * import { evaluateTerrainRulesCPU, type TerrainRule } from 'aekasha/toolkit/geometry';
 *
 * // Grass (0), rocks (1) from 30° of slope
 * const rules: TerrainRule[] = [{ layer: 1, slope: { min: 30 } }];
 * const steep = { x: 0, y: 2, z: 0, normalX: 0.6, normalY: 0.8, normalZ: 0 };
 * evaluateTerrainRulesCPU(rules, steep, [1, 0]); // [0, 1]: about 37° of slope
 * ```
 */
export const evaluateTerrainRulesCPU = <T extends { [layer: number]: number; length: number }>(
  rules: readonly TerrainRule[],
  point: TerrainRulePoint,
  weights: T,
  noise?: TerrainRuleNoiseTexels
): T => {
  for (const rule of rules) {
    if (!(rule.layer >= 0 && rule.layer < weights.length)) {
      throw new Error(
        `evaluateTerrainRulesCPU: a rule's layer is ${rule.layer}: there are ${weights.length} layers.`
      );
    }
    const coverage = getTerrainRuleCoverageCPU(rule, point, noise);
    const keep = 1 - coverage;
    for (let i = 0; i < weights.length; i++) weights[i] *= keep;
    weights[rule.layer] += coverage;
  }
  return weights;
};
