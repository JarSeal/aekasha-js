// The wet response (p307 D2, T1 T2 T6): a surface under the surface conditions' wetness. Rain
// reaches what faces the sky (the geometry normal's world Y: overhangs and undersides stay dry);
// the local wetness rises first in the low points and cavities and last on the peaks; then two
// stages: the pores fill (the albedo darkens by the response's darkening, the roughness falls a
// little toward the response's), then a water film forms over them where water stands (the
// roughness falls to water's, the detail normal flattens toward the geometry's). A porous surface
// fills its pores before any film, a dense one gets the film at once; one that sheds water (grass,
// a cliff face) gets little film or none. Puddles (T3) stand where the puddle level's waterline
// is over the relief, on the flat, filling some patches first; an authored regional wetness (T7)
// keeps its places wet in any weather; while it rains, rings ripple where water stands (T4); on
// steep faces rivulets run down while it rains and stay damp after (T5); along the water level a
// shoreline's bands wash, saturate and dampen the ground (T8); snow covers it by the snow cover,
// flat ground first, frozen dry below 0 °C and slush above, its meltwater wetting the ground around
// (T10); below freezing, frost whitens and roughens it, ice crystals sparkling (T11); under a roof
// (the rain occlusion map, T12) none of the rain's doing reaches it. Every number
// of the response is a node: a terrain material's are its layers' set uniforms
// blended by weight, an app material's its own. The ripples' two fetches, the streaks' one and
// the snow set's are the only ones, each in a branch on the weather (`Ripples.ts`, `Streaks.ts`,
// `Snow.ts`; the patches are the caller's sample).
import {
  cos,
  float,
  max,
  mix,
  normalWorldGeometry,
  positionView,
  positionWorld,
  smoothstep,
  vec2,
  vec3,
} from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node, TextureNode } from 'three/webgpu';
import type { SurfaceConditionNodes } from 'aekasha/surface';
import type { TextureSetInput } from 'aekasha/texturesets';
import { applyFrost, getFrost, getSparkle } from './Frost';
import { sampleRainRipples } from './Ripples';
import { getShoreline } from './Shoreline';
import { sampleSnowCover } from './Snow';
import { sampleRainStreaks } from './Streaks';

/**
 * The roughness of a water film (and of water's surface), which a soaked surface falls to.
 * @internal
 */
export const WET_FILM_ROUGHNESS = 0.05;
/**
 * How far a full film flattens the detail normal toward the geometry's: a film fills the small
 * bumps, not a stone's shape.
 */
const FILM_FLATTEN = 0.6;
/**
 * The share of the wetness the pores take, × the porosity: a fully porous surface fills its pores
 * over the first half and forms the film over the second; a dense one forms the film at once.
 */
const PORE_SHARE = 0.5;
/** The pores' stage at its narrowest: a nearly dense surface glosses over a little wetness, not at once */
const MIN_PORE_STAGE = 0.1;
/** The lowest drying speed the power takes: 0 would show any wetness as full */
const MIN_DRYING_SPEED = 0.05;
/**
 * The roughness of a puddle's water surface, which a puddle falls to.
 * @internal
 */
export const PUDDLE_ROUGHNESS = 0.02;
/**
 * How far a full puddle darkens the soaked albedo beneath it (the water's depth): capped low, so a
 * puddle without nearby reflections (no SSR) doesn't read as a hole.
 */
const PUDDLE_DARKENING = 0.15;
/**
 * How far running water darkens the soaked albedo beneath it: its depth, and on a face whose pores
 * the rain has filled already the cue the streaks read by (a wall's gloss reflects the ground)
 */
const STREAK_DARKENING = 0.25;
/** A relief's height where the surface gives none: neither peak nor hollow */
const FLAT_HEIGHT = 0.5;
const DEG_TO_RAD = Math.PI / 180;
/** The slope below the streaks' `minSlope` over which they fade in, radians */
const STREAK_SLOPE_FADE = 10 * DEG_TO_RAD;
/** The temperature over which snow turns to slush, °C from 0 */
const SLUSH_TEMPERATURE = 3;
/** Slush's albedo against the snow's (grey-blue: the water darkens it, the ice shows through) */
const SLUSH_TINT = [0.72, 0.78, 0.86] as const;
/** Slush's roughness against the snow's */
const SLUSH_ROUGHNESS = 0.6;

/**
 * The default `ApplySurfaceWetnessOpts`' numbers (the terrain material's `wet` defaults too).
 * @internal
 */
export const SURFACE_WETNESS_DEFAULTS = {
  heightInfluence: 0.5,
  cavityInfluence: 0.5,
  shelter: [60, 120],
  puddleMaxSlope: 15,
  puddleEdge: 0.05,
  puddlePatchAmount: 0.75,
  rippleScale: 1.5,
  rippleLifetime: 0.7,
  rippleStrength: 0.5,
  rippleDistance: [10, 30],
  streakMinSlope: 60,
  streakScale: 4,
  streakLength: 8,
  streakSpeed: 1,
  shoreNoise: 0.3,
  shoreRunUpHeight: 0.5,
  shoreRunUpPeriod: 6,
  snowMaxSlope: 55,
  snowNoiseScale: 3,
  snowEdge: 0.08,
  snowTiling: 1,
  frostTemperature: [0, -5],
  frostStrength: 1,
  sparkleDensity: 50,
  sparkleStrength: 3,
  sparkleDistance: [4, 10],
} as const satisfies Record<string, number | readonly [number, number]>;

/** A number as a constant node, or the node given */
const toFloat = (value: Node<'float'> | number) =>
  (typeof value === 'number' ? float(value) : value) as Node<'float'>;

/**
 * How a surface responds to water (a texture set's `surface` fields): each a number or a float
 * node in 0..1.
 */
export type SurfaceWetResponse = {
  /** How much water the surface soaks up: 0 none (ice, metal: a film at once), 1 all (sand). */
  porosity: Node<'float'> | number;
  /** How much the filled pores darken the albedo, 0 none, 1 black. */
  wetDarkening: Node<'float'> | number;
  /** The roughness with the pores full, before the film (never above the dry roughness). */
  wetRoughness: Node<'float'> | number;
  /**
   * How fast the surface dries against the overall wetness, over 0 (default 1): the wetness it
   * shows is the overall one to this power, so under the same weather sand (1.6) shows less of it
   * and mud (0.4) more; 0 and 1 stay as they are.
   */
  dryingSpeed?: Node<'float'> | number;
  /**
   * How readily water stands on the surface, 0..1 (default 1): how far a film forms over the full
   * pores (0: none, a surface that sheds water) and how high its puddles fill (the puddle level ×
   * this: sand's 0.3 puddles only in its lowest relief, a cliff's 0 never).
   */
  puddleResponse?: Node<'float'> | number;
};

/** The surface {@link applySurfaceWetness} wets. */
export type WetSurfaceInput = {
  /** The albedo, linear. */
  albedo: Node<'vec3'>;
  /** The roughness, 0..1. */
  roughness: Node<'float'>;
  /**
   * The shaded (detail) normal, which the film flattens toward `opts.geometryNormal` (in the same
   * space): left out, the result has none (`'SIMPLE'` never flattens).
   */
  normal?: Node<'vec3'>;
  /**
   * The surface's relief height, 0 (its lowest) to 1 (its highest): water gathers low first and
   * leaves the peaks last (`'FULL'` only). Left out: wet alike.
   */
  height?: Node<'float'>;
  /** The cavity, 0 open to 1 enclosed (eg. 1 − the AO): wetter, and drier last (`'FULL'` only). */
  cavity?: Node<'float'>;
  /**
   * An authored wetness, 0..1 (a vertex attribute, a splat channel: riverbanks, swamps): the
   * least wetness the surface shows and the least puddle level it fills to, in any weather and
   * whatever its facing.
   */
  regional?: Node<'float'>;
  /** How the surface responds to water. */
  response: SurfaceWetResponse;
};

/** Options of {@link applySurfaceWetness}. */
export type ApplySurfaceWetnessOpts = {
  /**
   * `'FULL'` (default) the relief and the cavities shape the local wetness and the film flattens
   * the normal; `'SIMPLE'` only the response and the sky exposure (a low tier, stylized looks).
   */
  quality?: 'FULL' | 'SIMPLE';
  /**
   * The geometry normal the film flattens toward, in the shaded normal's space (default the
   * world's, `normalWorldGeometry`).
   */
  geometryNormal?: Node<'vec3'>;
  /**
   * The geometry normal's world Y, which the rain's exposure reads (default
   * `normalWorldGeometry.y`, whatever space the material shades in).
   */
  up?: Node<'float'>;
  /**
   * How far the relief shifts the wetness, ≥ 0 (default 0.5): the low points wet that much ahead
   * of the overall wetness, the peaks behind. 0: the height doesn't count.
   */
  heightInfluence?: Node<'float'> | number;
  /** How much wetter a full cavity is, ≥ 0 (default 0.5), × the wetness: none on dry ground. */
  cavityInfluence?: Node<'float'> | number;
  /**
   * The geometry's angles from straight up in degrees, `[from, to]` (default `[60, 120]`), over
   * which the rain's reach fades out: fully wet up to `from`, a vertical face half, dry past `to`
   * (overhangs, undersides). A vec2 node of the two in degrees, or the numbers.
   */
  shelter?: Node<'vec2'> | readonly [number, number];
  /**
   * Puddles (`'FULL'` only): where the conditions' `puddleLevel` × the response's `puddleResponse`
   * is over the surface's `height` (flat at 0.5 without one), on ground flatter than `maxSlope`.
   * Left out: none.
   */
  puddles?: SurfacePuddleOpts;
  /**
   * Rain ripples (`'FULL'` only, with the shaded `normal`): rings where water stands (the puddles,
   * and a film on ground flatter than the puddles' `maxSlope`) while the conditions' `rain` is over
   * 0, the atlas sampled twice in a dynamic branch. Left out: none.
   */
  ripples?: SurfaceRippleOpts;
  /**
   * Rain streaks: rivulets down faces steeper than `minSlope` that the rain reaches, damp while
   * the conditions' `wetness` is over 0 (drying last) and running while their `rain` is, one
   * fetch of a noise texture in a dynamic branch. Both qualities (they leave the normal to the
   * film). Left out: none.
   */
  streaks?: SurfaceStreakOpts;
  /**
   * A shoreline along the conditions' `waterLevel` (none without one): the waves' wash (standing
   * water), the saturated sand just above it (a film) and a damp band above (the least wetness and
   * puddle level shown, as a regional wetness), all full under the water. Arithmetic only, both
   * qualities (`'SIMPLE'` leaves the normal alone). Left out: none.
   */
  shoreline?: SurfaceShorelineOpts;
  /**
   * Snow cover by the conditions' `snowCoverage`: a texture set over the surface, flat ground
   * first, then the slopes and the high points (`'FULL'`: the relief counts), everything up to
   * `maxSlope` at 1; frozen below 0 °C (the wetness doesn't show on it), slush above (grey-blue,
   * smoother, wet by its set's response), its meltwater the least wetness of the ground around.
   * The set's taps (its packing's slots) are in a dynamic branch on the cover, all of it in one on
   * the coverage. Both qualities (`'SIMPLE'` reads no relief and leaves the normal). Left out: none.
   */
  snow?: SurfaceSnowOpts;
  /**
   * Frost by the conditions' `temperature`: below `temperature[0]` the surface whitens a little and
   * roughens (never smoother: ice loses its mirror), full at `temperature[1]` and below, as far as
   * it takes frost (1 − its porosity: ice fully, sand little) and faces the sky (an underside
   * half); after the wetness. Its `sparkle` (`'FULL'` only) glints on the frost and on frozen
   * snow. Arithmetic, the sparkle in a dynamic branch. Left out: none.
   */
  frost?: SurfaceFrostOpts;
  /**
   * How far the surface is sheltered from the rain, 0 open sky to 1 under cover (eg.
   * `getRainOcclusionNode()` from `aekasha/surface`: roofs, trees, bridges): it scales down the
   * rain's reach (so the wetness, the streaks and the frost's facing), the puddle level, the
   * ripples' rain and the snow cover; not a `regional` wetness, the shoreline or the meltwater.
   * Left out: the facing alone (`shelter`).
   */
  rainOcclusion?: Node<'float'>;
};

/** {@link ApplySurfaceWetnessOpts}' frost. */
export type SurfaceFrostOpts = {
  /**
   * The temperatures where frost starts and where it's full, °C, the first the warmer (default
   * `[0, -5]`): a vec2 node, or the numbers.
   */
  temperature?: Node<'vec2'> | readonly [number, number];
  /** The frost's strength, 0..1 (default 1). */
  strength?: Node<'float'> | number;
  /** Ice crystals glinting toward the camera (`'FULL'` only). Left out: none. */
  sparkle?: SurfaceSparkleOpts;
};

/** {@link SurfaceFrostOpts}' sparkle. */
export type SurfaceSparkleOpts = {
  /** The surface's position, its cells the crystals (default the world's). */
  position?: Node<'vec3'>;
  /** The crystals a metre, over 0 (default 50). */
  density?: Node<'float'> | number;
  /** How bright a glint is, added to the albedo (default 3). */
  strength?: Node<'float'> | number;
  /**
   * The sparkle's share at the pixel, 0..1 (eg. a distance fade: a crystal under a pixel would
   * shimmer; 0 computes none). Default: full to 4 m from the camera, none past 10 m.
   */
  fade?: Node<'float'>;
};

/** {@link ApplySurfaceWetnessOpts}' snow cover. */
export type SurfaceSnowOpts = {
  /**
   * The snow's texture set, a `{ textureSet }` input's bundle (eg. the toolkit's `snow01`): its
   * maps, tint and strengths, and its `surface` wet response, which the snow wets by.
   */
  set: TextureSetInput;
  /**
   * The surface's position, its `(x, −z)` the set's top-down tiling (in the shaded normal's space;
   * default the world's).
   */
  position?: Node<'vec3'>;
  /** The set's tiling, over 0 (default 1): its tile is its `physicalSize` × this. */
  tiling?: Node<'float'> | number;
  /** The steepest slope the snow rests on, degrees from flat (default 55). */
  maxSlope?: Node<'float'> | number;
  /** The drift noise's cell, metres, over 0 (default 3): where the snow gathers first. */
  noiseScale?: Node<'float'> | number;
  /** The share of the cover over which the snow's edge fades in, over 0 (default 0.08). */
  edge?: Node<'float'> | number;
  /**
   * Where the snow is its set's average colour instead of a sample, 0..1 (eg. a far surface's
   * share: 1 samples nothing). Needs the set's `averageColor`. Left out: sampled wherever it shows.
   */
  far?: Node<'float'>;
};

/** {@link ApplySurfaceWetnessOpts}' shoreline. */
export type SurfaceShorelineOpts = {
  /** The metres above the water level that stay damp, over 0. */
  band: Node<'float'> | number;
  /** The metres the waterline wanders up and down along the shore, 0 or more (default 0.3). */
  noise?: Node<'float'> | number;
  /**
   * Waves washing up the shore and back: the metres they reach above the water level (default
   * 0.5) and the seconds between them (default 6), on the surface clock. Left out: a still water
   * line.
   */
  runUp?: { height?: Node<'float'> | number; period?: Node<'float'> | number };
  /** The surface's world position: the water level is the world's (default `positionWorld`). */
  position?: Node<'vec3'>;
};

/** {@link ApplySurfaceWetnessOpts}' rain streaks. */
export type SurfaceStreakOpts = {
  /**
   * A noise texture whose R is an fbm around 0.5, tiling (the toolkit's `macroNoise`, or
   * `bakeMacroNoise`'s): its upper values are the rivulets.
   */
  texture: TextureNode;
  /** The surface's position, its height the fall line (in the shaded normal's space; default the
   * world's). */
  position?: Node<'vec3'>;
  /** The gentlest face that streaks, degrees from flat (default 60; faded in over 10° below it). */
  minSlope?: Node<'float'> | number;
  /** The metres one texture tile covers across the face, over 0 (default 4). */
  scale?: Node<'float'> | number;
  /** How many times longer a tile is down the face than across, over 0 (default 8). */
  length?: Node<'float'> | number;
  /** How fast the running water's pulses move down, metres a second (default 1). */
  speed?: Node<'float'> | number;
};

/** {@link ApplySurfaceWetnessOpts}' rain ripples. */
export type SurfaceRippleOpts = {
  /** A ripple atlas's texture node: `bakeRippleAtlas`'s, or the toolkit's `rippleAtlas`. */
  atlas: TextureNode;
  /**
   * The surface's position, its XZ the atlas's tiling (in the shaded normal's space; default the
   * world's).
   */
  position?: Node<'vec3'>;
  /** The metres one atlas tile covers, over 0 (default 1.5: 16 drops in 1.5 m). */
  scale?: Node<'float'> | number;
  /** The seconds a ring lives, over 0 (default 0.7). */
  lifetime?: Node<'float'> | number;
  /** How far the rings tilt the normal (default 0.5). */
  strength?: Node<'float'> | number;
  /**
   * The ripples' share at the pixel, 0..1 (eg. a distance fade: the atlas is close-up detail, and
   * 0 samples nothing). Default: full to 10 m from the camera, none past 30 m.
   */
  fade?: Node<'float'>;
};

/** {@link ApplySurfaceWetnessOpts}' puddles. */
export type SurfacePuddleOpts = {
  /**
   * The steepest ground a puddle stands on, degrees from flat (default 15): full puddles up to
   * half of it, none past it.
   */
  maxSlope?: Node<'float'> | number;
  /** The relief height over which a puddle's rim fades in, above 0 (default 0.05). */
  edge?: Node<'float'> | number;
  /**
   * Patches, 0..1 around 0.5 (eg. the macro noise's B at a large scale), where the puddles fill
   * ahead (over 0.5) or behind (under): the waterline × `1 + (patches − 0.5) · 2 · patchAmount`.
   * Left out: the same everywhere.
   */
  patches?: Node<'float'>;
  /** How far the patches move the waterline, 0..1 (default 0.75): 1 keeps a 0 patch dry. */
  patchAmount?: Node<'float'> | number;
};

/**
 * The masks {@link applySurfaceWetness} wet the surface by, each 0..1 at the pixel (what the
 * terrain material's `WETNESS` debug view shows).
 */
export type SurfaceWetnessMasks = {
  /**
   * How much the rain reaches the surface: its facing (1 up, 0 an underside), × the open sky above
   * with `opts.rainOcclusion`.
   */
  exposure: Node<'float'>;
  /** The local wetness: the conditions' × the exposure, shifted by the relief and the cavity. */
  wetness: Node<'float'>;
  /** The pores' stage: how full they are. */
  pores: Node<'float'>;
  /**
   * The film's stage: how far the water film has formed over the full pores (× `puddleResponse`),
   * running water's and the shore's saturated sand's included.
   */
  film: Node<'float'>;
  /**
   * The puddle: how far water stands over the surface (a puddle, the shoreline's wash; 0 without
   * `opts.puddles` and `opts.shoreline`).
   */
  puddle: Node<'float'>;
  /**
   * The ripples' weight: standing water × the fade × the rain (0 without `opts.ripples`); where
   * it's over 0, the atlas is sampled.
   */
  ripple: Node<'float'>;
  /**
   * The streaks' weight: a steep face the rain reaches × the rain or the wetness (0 without
   * `opts.streaks`); where it's over 0, the texture is sampled. The rivulets show in `pores` (damp)
   * and `film` (running).
   */
  streak: Node<'float'>;
  /** The snow's cover (0 without `opts.snow`); where it's over 0, the snow set is sampled. */
  snow: Node<'float'>;
  /** The frost (0 without `opts.frost`). */
  frost: Node<'float'>;
};

/** The wet surface: the albedo, the roughness, the normal (when given) and the masks. */
export type WetSurface = {
  albedo: Node<'vec3'>;
  roughness: Node<'float'>;
  /** The flattened normal, or undefined when the input had none. */
  normal?: Node<'vec3'>;
  masks: SurfaceWetnessMasks;
};

// p307 T1, T2, T6
/**
 * Wets a surface by the surface conditions: the conditions' `wetness` where rain
 * reaches it (the geometry's facing, `shelter`), to the power of its `dryingSpeed`, shifted by the
 * relief (low points first, peaks last) and the cavities, darkens the albedo as the pores fill
 * (`wetDarkening`), lowers the roughness to `wetRoughness` and then, as a film forms over the full
 * pores (as far as water stands on it, `puddleResponse`), to water's (`WET_FILM_ROUGHNESS`, 0.05;
 * neither ever raises it), and flattens the detail normal under the film. A dense surface
 * (`porosity` 0) gets the film at once, a porous one (1) fills its pores over the first half of
 * its local wetness. With `opts.puddles` (T3), water stands where the conditions' `puddleLevel` ×
 * `puddleResponse` (× the patches' share) is over the relief on flat ground: soaked, a little
 * darker, water's roughness (`PUDDLE_ROUGHNESS`, 0.02) and the geometry's normal. A `regional`
 * wetness (T7) is the least wetness and puddle level shown. With `opts.ripples` (T4), rain rings
 * tilt the normal where water stands, the atlas's two fetches in a dynamic branch on the rain; with
 * `opts.streaks` (T5), rivulets run down steep faces while it rains (a film) and stay damp while
 * it's wet (the pores), one fetch in a dynamic branch on the weather; with `opts.shoreline` (T8),
 * the ground along the conditions' `waterLevel` is washed (a puddle), saturated (a film) and damp
 * above (a regional wetness), arithmetic only; with `opts.snow` (T10), a texture set covers the
 * surface by the conditions' `snowCoverage` (flat ground first, nothing past `maxSlope`), frozen
 * dry below 0 °C and slush above (its meltwater wetting the ground around), its taps in a dynamic
 * branch on the cover; with `opts.frost` (T11), below freezing the surface whitens a little and
 * roughens by 1 − its porosity, its `sparkle` glinting in a dynamic branch; with
 * `opts.rainOcclusion` (T12), the rain, the puddles, the ripples and the snow don't reach under
 * cover (the caller's sample, eg. `getRainOcclusionNode()`); nothing else fetches or branches. At wetness, puddle level, rain and snow cover 0, above the frost's temperature,
 * without a regional wetness the surface is as given.
 * @param input the dry surface, its relief, cavity, regional wetness and response
 * @param conditions the surface conditions' uniforms (`getSurfaceConditionNodes()`)
 * @returns the wet surface and its masks
 * @example
 * ```ts
 * import { getSurfaceConditionNodes } from 'aekasha/surface';
 * import { applySurfaceWetness } from 'aekasha/toolkit/terrain';
 *
 * // A TSL material's setup: a set's surface, wet by the weather (dry without the feature)
 * const conditions = getSurfaceConditionNodes();
 * if (conditions) {
 *   const wet = applySurfaceWetness(
 *     { albedo, roughness, height: sample.height, response: { porosity: 0.7, wetDarkening: 0.6, wetRoughness: 0.15 } },
 *     conditions,
 *     { puddles: { maxSlope: 10 } }
 *   );
 *   material.colorNode = wet.albedo;
 *   material.roughnessNode = wet.roughness;
 * }
 * ```
 */
export const applySurfaceWetness = (
  input: WetSurfaceInput,
  conditions: SurfaceConditionNodes,
  opts: ApplySurfaceWetnessOpts = {}
): WetSurface => {
  const isFull = (opts.quality ?? 'FULL') === 'FULL';
  const up = opts.up ?? ((normalWorldGeometry as unknown as Node<'vec3'>).y as Node<'float'>);
  const geometryNormal = opts.geometryNormal ?? (normalWorldGeometry as unknown as Node<'vec3'>);
  // T12: the share of open sky above (a roof keeps the rain and the snow off), or null for all
  const open = opts.rainOcclusion ? (float(1).sub(opts.rainOcclusion) as Node<'float'>) : null;
  // T10: the snow over the dry surface, which the rest wets (slush)
  const snow = opts.snow
    ? coverWithSnow(input, { up, geometryNormal, isFull, conditions, open, opts: opts.snow })
    : null;
  const surface = snow?.surface ?? input;
  const porosity = toFloat(surface.response.porosity);
  const darkening = toFloat(surface.response.wetDarkening);
  const wetRoughness = toFloat(surface.response.wetRoughness);

  // T6: the rain's reach by the geometry's facing, the angles' cosines (n.y = cos of the angle)
  const shelter = opts.shelter ?? SURFACE_WETNESS_DEFAULTS.shelter;
  const angles = ('isNode' in shelter
    ? shelter
    : vec2(shelter[0], shelter[1])) as unknown as Node<'vec2'>;
  const cosines = angles.mul(DEG_TO_RAD).cos() as Node<'vec2'>;
  const facing = smoothstep(cosines.y, cosines.x, up) as unknown as Node<'float'>;
  const exposure = open ? (facing.mul(open) as Node<'float'>) : facing;
  let global = (conditions.wetness as unknown as Node<'float'>).mul(exposure) as Node<'float'>;
  // Frozen snow shows no wetness: only as far as it's slush
  if (snow) global = global.mul(snow.wettable) as Node<'float'>;
  // T8: the shoreline's bands; its damp one a regional wetness, hidden by frozen snow like the
  // weather's, and the snow's meltwater one too
  const shore = opts.shoreline ? getShore(conditions, opts.shoreline) : null;
  const authored = maxOf([surface.regional, shore?.damp]);
  const regional = maxOf([
    authored && snow ? (authored.mul(snow.wettable) as Node<'float'>) : authored,
    snow?.meltwater,
  ]);
  // T7: an authored wetness, whatever the weather and the facing
  if (regional) global = max(global, regional) as unknown as Node<'float'>;
  // The surface's own drying: the wetness it shows, the overall one to its drying speed
  const { dryingSpeed } = surface.response;
  if (dryingSpeed !== undefined && dryingSpeed !== 1) {
    global = global.pow(max(toFloat(dryingSpeed), MIN_DRYING_SPEED)) as Node<'float'>;
  }

  // T2: the low points ahead of the overall wetness, the peaks behind (w + k·(w − h): 0 stays dry,
  // 1 wets every height), the cavities wetter by their share of it
  let local = global;
  if (isFull && surface.height) {
    const shift = global
      .sub(surface.height)
      .mul(toFloat(opts.heightInfluence ?? SURFACE_WETNESS_DEFAULTS.heightInfluence));
    local = local.add(shift) as Node<'float'>;
  }
  if (isFull && surface.cavity) {
    const cavity = surface.cavity
      .mul(toFloat(opts.cavityInfluence ?? SURFACE_WETNESS_DEFAULTS.cavityInfluence))
      .mul(global);
    local = local.add(cavity) as Node<'float'>;
  }
  local = local.saturate() as Node<'float'>;
  // T5: rivulets down a steep face, damp (the pores) while it's wet, running (a film) while it rains
  const streaks = opts.streaks
    ? getStreaks(up, exposure, geometryNormal, conditions, opts.streaks)
    : null;

  // T1: the pores over the first share of the wetness (by the porosity), the film over the rest
  const split = porosity.mul(PORE_SHARE) as Node<'float'>;
  let pores = local.div(max(split, MIN_PORE_STAGE)).saturate() as Node<'float'>;
  // A damp rivulet fills the pores alone: no film forms without running water
  if (streaks) pores = max(pores, streaks.damp) as unknown as Node<'float'>;
  // As far as water stands on it: a surface that sheds water films little or not at all
  const { puddleResponse } = surface.response;
  const filmStage = local.sub(split).div(float(1).sub(split)).saturate() as Node<'float'>;
  let film = (
    puddleResponse === undefined || puddleResponse === 1
      ? filmStage
      : filmStage.mul(toFloat(puddleResponse))
  ) as Node<'float'>;
  // Running water is a film whether water stands on the surface or not, and so is the shore's
  // saturated sand
  if (streaks) film = max(film, streaks.running) as unknown as Node<'float'>;
  if (shore) film = max(film, shore.saturated) as unknown as Node<'float'>;
  // T3: a puddle soaks what's beneath it (its pores and film full); the shore's wash is one
  const flat = getFlatGate(up, opts.puddles?.maxSlope);
  const pooled =
    isFull && opts.puddles
      ? getPuddle(surface, { regional, open, conditions, flat }, opts.puddles)
      : null;
  const puddle =
    pooled && shore
      ? (max(pooled, shore.wash) as unknown as Node<'float'>)
      : pooled ?? shore?.wash ?? null;
  const soaked = puddle ? (max(pores, puddle) as unknown as Node<'float'>) : pores;
  const filmed = puddle ? (max(film, puddle) as unknown as Node<'float'>) : film;
  let albedo = surface.albedo.mul(float(1).sub(darkening.mul(soaked))) as Node<'vec3'>;
  const pored = mix(
    surface.roughness,
    surface.roughness.min(wetRoughness),
    soaked
  ) as Node<'float'>;
  // A film is water's roughness, which never roughens a smoother surface (ice, polish)
  let roughness = mix(pored, pored.min(WET_FILM_ROUGHNESS), filmed) as Node<'float'>;
  // A puddle's water is flat: the geometry's normal under a full one
  const flatten = film.mul(FILM_FLATTEN) as Node<'float'>;
  let normal =
    surface.normal && isFull
      ? (mix(
          surface.normal,
          geometryNormal,
          puddle ? max(flatten, puddle) : flatten
        ).normalize() as Node<'vec3'>)
      : surface.normal;
  // T4: where water stands (a puddle, a film on the flat), while it rains
  let ripple: Node<'float'> | null = null;
  if (normal && isFull && opts.ripples) {
    const standing = film.mul(flat) as Node<'float'>;
    const water = puddle ? (max(standing, puddle) as unknown as Node<'float'>) : standing;
    const rippled = applyRipples(normal, water, conditions, open, opts.ripples);
    normal = rippled.normal;
    ripple = rippled.weight;
  }
  if (streaks) {
    albedo = albedo.mul(float(1).sub(streaks.running.mul(STREAK_DARKENING))) as Node<'vec3'>;
  }
  if (puddle) {
    albedo = albedo.mul(float(1).sub(puddle.mul(PUDDLE_DARKENING))) as Node<'vec3'>;
    roughness = mix(roughness, roughness.min(PUDDLE_ROUGHNESS), puddle) as Node<'float'>;
  }
  // T11: frost over it all, its sparkle on the frost and on frozen snow
  let frost: Node<'float'> | null = null;
  if (opts.frost) {
    frost = getSurfaceFrost(porosity, exposure, conditions, opts.frost);
    ({ albedo, roughness } = applyFrost(albedo, roughness, frost));
    const { sparkle } = opts.frost;
    if (isFull && sparkle) {
      const frozen = snow ? (max(frost, snow.frozen) as unknown as Node<'float'>) : frost;
      albedo = albedo.add(getSurfaceSparkle(frozen, sparkle)) as Node<'vec3'>;
    }
  }
  return {
    albedo,
    roughness,
    ...(normal ? { normal } : {}),
    masks: {
      exposure,
      wetness: local,
      pores,
      film,
      puddle: puddle ?? (float(0) as unknown as Node<'float'>),
      ripple: ripple ?? (float(0) as unknown as Node<'float'>),
      streak: streaks?.weight ?? (float(0) as unknown as Node<'float'>),
      snow: snow?.cover ?? (float(0) as unknown as Node<'float'>),
      frost: frost ?? (float(0) as unknown as Node<'float'>),
    },
  };
};

/** The most of the nodes given, or undefined for none */
const maxOf = (nodes: (Node<'float'> | undefined)[]) =>
  nodes
    .filter((node): node is Node<'float'> => node !== undefined)
    .reduce<
      Node<'float'> | undefined
    >((most, node) => (most ? (max(most, node) as unknown as Node<'float'>) : node), undefined);

/** What {@link coverWithSnow} reads beside the surface */
type SnowContext = {
  up: Node<'float'>;
  geometryNormal: Node<'vec3'>;
  isFull: boolean;
  conditions: SurfaceConditionNodes;
  /** The share of open sky above, or null for all (`opts.rainOcclusion`) */
  open: Node<'float'> | null;
  opts: SurfaceSnowOpts;
};

/**
 * The surface under the snow (`Snow.ts`): its albedo, roughness, normal (`'FULL'`), relief and
 * response mixed toward the snow's by its cover, the snow's turning to slush above 0 °C; how far
 * the wetness shows (the frozen snow none) and the snow's meltwater (its fringe while it melts)
 */
const coverWithSnow = (surface: WetSurfaceInput, ctx: SnowContext) => {
  const { opts, conditions } = ctx;
  const defaults = SURFACE_WETNESS_DEFAULTS;
  const { set } = opts;
  const height = ctx.isFull ? surface.height : undefined;
  const snow = sampleSnowCover({
    set,
    position: opts.position ?? (positionWorld as unknown as Node<'vec3'>),
    normal: ctx.geometryNormal,
    up: ctx.up,
    height: height ?? (float(FLAT_HEIGHT) as unknown as Node<'float'>),
    coverage: (ctx.open
      ? conditions.snowCoverage.mul(ctx.open)
      : conditions.snowCoverage) as unknown as Node<'float'>,
    maxSlope: toFloat(opts.maxSlope ?? defaults.snowMaxSlope).mul(DEG_TO_RAD) as Node<'float'>,
    noiseScale: toFloat(opts.noiseScale ?? defaults.snowNoiseScale),
    edge: toFloat(opts.edge ?? defaults.snowEdge),
    tiling: toFloat(opts.tiling ?? defaults.snowTiling),
    far: opts.far ?? null,
  });
  const { cover } = snow;
  // Slush: above 0 °C the snow greys and smooths (and the wetness shows on it)
  const melt = smoothstep(
    0,
    SLUSH_TEMPERATURE,
    conditions.temperature as unknown as Node<'float'>
  ) as unknown as Node<'float'>;
  const albedo = snow.albedo.mul(mix(vec3(1), vec3(...SLUSH_TINT), melt)) as Node<'vec3'>;
  const roughness = snow.roughness.mul(mix(float(1), float(SLUSH_ROUGHNESS), melt));
  const toSnow = <T extends Node<'float'> | Node<'vec3'>>(ground: T, onSnow: T) =>
    mix(ground, onSnow, cover) as unknown as T;
  const { response } = surface;
  const params = set as unknown as Record<keyof SurfaceWetResponse, Node<'float'>>;
  const covered: WetSurfaceInput = {
    ...surface,
    albedo: toSnow(surface.albedo, albedo),
    roughness: toSnow(surface.roughness, roughness as Node<'float'>),
    ...(surface.normal
      ? {
          normal: ctx.isFull
            ? (toSnow(surface.normal, snow.normal).normalize() as Node<'vec3'>)
            : surface.normal,
        }
      : {}),
    ...(height ? { height: toSnow(height, snow.height) } : {}),
    response: {
      porosity: toSnow(toFloat(response.porosity), params.porosity),
      wetDarkening: toSnow(toFloat(response.wetDarkening), params.wetDarkening),
      wetRoughness: toSnow(toFloat(response.wetRoughness), params.wetRoughness),
      dryingSpeed: toSnow(toFloat(response.dryingSpeed ?? 1), params.dryingSpeed),
      puddleResponse: toSnow(toFloat(response.puddleResponse ?? 1), params.puddleResponse),
    },
  };
  return {
    surface: covered,
    cover,
    // The wetness shows on the ground and on slush, not on frozen snow
    wettable: float(1).sub(cover.mul(float(1).sub(melt))) as Node<'float'>,
    meltwater: snow.fringe.mul(melt) as Node<'float'>,
    frozen: cover.mul(float(1).sub(melt)) as Node<'float'>,
  };
};

/** The frost (`Frost.ts`): the response 1 − the porosity, the facing the rain's exposure */
const getSurfaceFrost = (
  porosity: Node<'float'>,
  exposure: Node<'float'>,
  conditions: SurfaceConditionNodes,
  opts: SurfaceFrostOpts
) => {
  const defaults = SURFACE_WETNESS_DEFAULTS;
  const range = opts.temperature ?? defaults.frostTemperature;
  return getFrost({
    temperature: conditions.temperature as unknown as Node<'float'>,
    range: ('isNode' in range ? range : vec2(range[0], range[1])) as unknown as Node<'vec2'>,
    strength: toFloat(opts.strength ?? defaults.frostStrength),
    response: float(1).sub(porosity) as Node<'float'>,
    exposure,
  });
};

/** The sparkle's glints (`Frost.ts`) × its strength, white: on the weight × the fade */
const getSurfaceSparkle = (weight: Node<'float'>, opts: SurfaceSparkleOpts) => {
  const defaults = SURFACE_WETNESS_DEFAULTS;
  const [from, to] = defaults.sparkleDistance;
  const viewDistance = (positionView as unknown as Node<'vec3'>).length();
  const fade =
    opts.fade ?? (float(1).sub(smoothstep(from, to, viewDistance)) as unknown as Node<'float'>);
  const glint = getSparkle({
    position: opts.position ?? (positionWorld as unknown as Node<'vec3'>),
    density: toFloat(opts.density ?? defaults.sparkleDensity),
    weight: weight.mul(fade) as Node<'float'>,
  });
  return vec3(glint.mul(toFloat(opts.strength ?? defaults.sparkleStrength)));
};

/** The ground's flatness: 1 up to half of `maxSlope` (degrees from flat), 0 past it */
const getFlatGate = (up: Node<'float'>, maxSlopeDegrees: Node<'float'> | number | undefined) => {
  const maxSlope = toFloat(maxSlopeDegrees ?? SURFACE_WETNESS_DEFAULTS.puddleMaxSlope).mul(
    DEG_TO_RAD
  );
  return smoothstep(cos(maxSlope), cos(maxSlope.mul(0.5)), up) as unknown as Node<'float'>;
};

/** The shoreline's bands (`Shoreline.ts`) along the conditions' water level */
const getShore = (conditions: SurfaceConditionNodes, opts: SurfaceShorelineOpts) => {
  const defaults = SURFACE_WETNESS_DEFAULTS;
  const { runUp } = opts;
  return getShoreline({
    waterLevel: conditions.waterLevel as unknown as Node<'float'>,
    band: toFloat(opts.band),
    noise: toFloat(opts.noise ?? defaults.shoreNoise),
    runUp: runUp
      ? {
          height: toFloat(runUp.height ?? defaults.shoreRunUpHeight),
          period: toFloat(runUp.period ?? defaults.shoreRunUpPeriod),
        }
      : null,
    time: conditions.time as unknown as Node<'float'>,
    ...(opts.position ? { position: opts.position } : {}),
  });
};

/**
 * The rain streaks (`Streaks.ts`): their weight a face steeper than `minSlope` (faded in over 10°
 * below it) × the rain's reach doubled (a vertical face's full, an underside's none); the damp and
 * running rivulets, and the weight × the rain or wetness (the streak mask)
 */
const getStreaks = (
  up: Node<'float'>,
  exposure: Node<'float'>,
  normal: Node<'vec3'>,
  conditions: SurfaceConditionNodes,
  opts: SurfaceStreakOpts
) => {
  const defaults = SURFACE_WETNESS_DEFAULTS;
  const minSlope = toFloat(opts.minSlope ?? defaults.streakMinSlope).mul(DEG_TO_RAD);
  const gentle = smoothstep(cos(minSlope), cos(max(minSlope.sub(STREAK_SLOPE_FADE), 0)), up);
  const weight = float(1).sub(gentle).mul(exposure.mul(2).saturate()) as Node<'float'>;
  const rain = conditions.rain as unknown as Node<'float'>;
  const wetness = conditions.wetness as unknown as Node<'float'>;
  const rivulets = sampleRainStreaks({
    texture: opts.texture,
    position: opts.position ?? (positionWorld as unknown as Node<'vec3'>),
    normal,
    scale: toFloat(opts.scale ?? defaults.streakScale),
    length: toFloat(opts.length ?? defaults.streakLength),
    speed: toFloat(opts.speed ?? defaults.streakSpeed),
    rain,
    wetness,
    time: conditions.time as unknown as Node<'float'>,
    weight,
  });
  return {
    damp: rivulets.x as Node<'float'>,
    running: rivulets.y as Node<'float'>,
    weight: weight.mul(max(rain, wetness)) as Node<'float'>,
  };
};

/**
 * The normal tilted by the rain's rings (`Ripples.ts`), their weight the standing water × the
 * fade, and that weight × the rain (the ripple mask)
 */
const applyRipples = (
  normal: Node<'vec3'>,
  water: Node<'float'>,
  conditions: SurfaceConditionNodes,
  open: Node<'float'> | null,
  opts: SurfaceRippleOpts
) => {
  const defaults = SURFACE_WETNESS_DEFAULTS;
  const [from, to] = defaults.rippleDistance;
  const viewDistance = (positionView as unknown as Node<'vec3'>).length();
  const fade =
    opts.fade ?? (float(1).sub(smoothstep(from, to, viewDistance)) as unknown as Node<'float'>);
  const weight = water.mul(fade) as Node<'float'>;
  // No rings under a roof: the rain there is the open sky's share of it
  const rain = (open ? conditions.rain.mul(open) : conditions.rain) as unknown as Node<'float'>;
  const offset = sampleRainRipples({
    atlas: opts.atlas,
    position: opts.position ?? (positionWorld as unknown as Node<'vec3'>),
    scale: toFloat(opts.scale ?? defaults.rippleScale),
    lifetime: toFloat(opts.lifetime ?? defaults.rippleLifetime),
    strength: toFloat(opts.strength ?? defaults.rippleStrength),
    rain,
    time: conditions.time as unknown as Node<'float'>,
    weight,
  });
  return {
    normal: normal.add(offset).normalize() as Node<'vec3'>,
    weight: weight.mul(rain) as Node<'float'>,
  };
};

/** What {@link getPuddle} reads beside the surface */
type PuddleContext = {
  /** The regional wetness (with the shoreline's damp band and the meltwater), if any */
  regional: Node<'float'> | undefined;
  /** The share of open sky above, or null for all (`opts.rainOcclusion`) */
  open: Node<'float'> | null;
  conditions: SurfaceConditionNodes;
  flat: Node<'float'>;
};

/**
 * The puddle mask (T3): the waterline (the puddle level where the rain reaches, at least the
 * regional wetness and the shoreline's damp band, × `puddleResponse`, × the patches' share) over
 * the relief, faded in over `edge`, on ground flatter than `maxSlope` (full up to half of it)
 */
const getPuddle = (surface: WetSurfaceInput, ctx: PuddleContext, opts: SurfacePuddleOpts) => {
  const defaults = SURFACE_WETNESS_DEFAULTS;
  const { regional, open, conditions, flat } = ctx;
  const puddleLevel = (open
    ? conditions.puddleLevel.mul(open)
    : conditions.puddleLevel) as unknown as Node<'float'>;
  const level = (regional ? max(puddleLevel, regional) : puddleLevel) as Node<'float'>;
  const { puddleResponse } = surface.response;
  let waterline =
    puddleResponse === undefined ? level : (level.mul(toFloat(puddleResponse)) as Node<'float'>);
  if (opts.patches) {
    const amount = toFloat(opts.patchAmount ?? defaults.puddlePatchAmount);
    const share = max(opts.patches.sub(0.5).mul(amount).mul(2).add(1), 0);
    waterline = waterline.mul(share) as Node<'float'>;
  }
  const depth = waterline.sub(surface.height ?? FLAT_HEIGHT);
  const rim = smoothstep(0, toFloat(opts.edge ?? defaults.puddleEdge), depth);
  return rim.mul(flat) as unknown as Node<'float'>;
};
