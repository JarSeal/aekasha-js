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

/**
 * A procedural terrain rule (p305 D4): where the surface's slope, height and facing are in the
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
