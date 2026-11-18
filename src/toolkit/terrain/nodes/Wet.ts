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
// steep faces rivulets run down while it rains and stay damp after (T5). Every number of the
// response is a node: a terrain material's are its layers' set uniforms blended by weight, an app
// material's its own. The ripples' two fetches and the streaks' one are the only ones, each in a
// branch on the weather (`Ripples.ts`, `Streaks.ts`; the patches are the caller's sample).
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
} from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node, TextureNode } from 'three/webgpu';
import type { SurfaceConditionNodes } from 'aekasha/surface';
import { sampleRainRipples } from './Ripples';
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
  /** How much the rain reaches the surface: its facing (1 up, 0 an underside). */
  exposure: Node<'float'>;
  /** The local wetness: the conditions' × the exposure, shifted by the relief and the cavity. */
  wetness: Node<'float'>;
  /** The pores' stage: how full they are. */
  pores: Node<'float'>;
  /** The film's stage: how far the water film has formed over the full pores (× `puddleResponse`). */
  film: Node<'float'>;
  /** The puddle: how far water stands over the surface (0 without `opts.puddles`). */
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
};

/** The wet surface: the albedo, the roughness, the normal (when given) and the masks. */
export type WetSurface = {
  albedo: Node<'vec3'>;
  roughness: Node<'float'>;
  /** The flattened normal, or undefined when the input had none. */
  normal?: Node<'vec3'>;
  masks: SurfaceWetnessMasks;
};

/**
 * Wets a surface by the surface conditions (p307 T1, T2, T6): the conditions' `wetness` where rain
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
 * it's wet (the pores), one fetch in a dynamic branch on the weather; nothing else fetches or
 * branches. At wetness, puddle level and rain 0 without a regional
 * wetness the surface is as given.
 * @param surface the dry surface, its relief, cavity, regional wetness and response
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
  surface: WetSurfaceInput,
  conditions: SurfaceConditionNodes,
  opts: ApplySurfaceWetnessOpts = {}
): WetSurface => {
  const isFull = (opts.quality ?? 'FULL') === 'FULL';
  const porosity = toFloat(surface.response.porosity);
  const darkening = toFloat(surface.response.wetDarkening);
  const wetRoughness = toFloat(surface.response.wetRoughness);

  // T6: the rain's reach by the geometry's facing, the angles' cosines (n.y = cos of the angle)
  const up = opts.up ?? ((normalWorldGeometry as unknown as Node<'vec3'>).y as Node<'float'>);
  const shelter = opts.shelter ?? SURFACE_WETNESS_DEFAULTS.shelter;
  const angles = ('isNode' in shelter
    ? shelter
    : vec2(shelter[0], shelter[1])) as unknown as Node<'vec2'>;
  const cosines = angles.mul(DEG_TO_RAD).cos() as Node<'vec2'>;
  const exposure = smoothstep(cosines.y, cosines.x, up) as unknown as Node<'float'>;
  let global = (conditions.wetness as unknown as Node<'float'>).mul(exposure) as Node<'float'>;
  // T7: an authored wetness, whatever the weather and the facing
  if (surface.regional) global = max(global, surface.regional) as unknown as Node<'float'>;
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
  const geometryNormal = opts.geometryNormal ?? (normalWorldGeometry as unknown as Node<'vec3'>);
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
  // Running water is a film whether water stands on the surface or not
  if (streaks) film = max(film, streaks.running) as unknown as Node<'float'>;
  // T3: a puddle soaks what's beneath it (its pores and film full)
  const flat = getFlatGate(up, opts.puddles?.maxSlope);
  const puddle = isFull && opts.puddles ? getPuddle(surface, conditions, flat, opts.puddles) : null;
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
    const rippled = applyRipples(normal, water, conditions, opts.ripples);
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
    },
  };
};

/** The ground's flatness: 1 up to half of `maxSlope` (degrees from flat), 0 past it */
const getFlatGate = (up: Node<'float'>, maxSlopeDegrees: Node<'float'> | number | undefined) => {
  const maxSlope = toFloat(maxSlopeDegrees ?? SURFACE_WETNESS_DEFAULTS.puddleMaxSlope).mul(
    DEG_TO_RAD
  );
  return smoothstep(cos(maxSlope), cos(maxSlope.mul(0.5)), up) as unknown as Node<'float'>;
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
  opts: SurfaceRippleOpts
) => {
  const defaults = SURFACE_WETNESS_DEFAULTS;
  const [from, to] = defaults.rippleDistance;
  const viewDistance = (positionView as unknown as Node<'vec3'>).length();
  const fade =
    opts.fade ?? (float(1).sub(smoothstep(from, to, viewDistance)) as unknown as Node<'float'>);
  const weight = water.mul(fade) as Node<'float'>;
  const rain = conditions.rain as unknown as Node<'float'>;
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

/**
 * The puddle mask (T3): the waterline (the puddle level, at least the regional wetness, ×
 * `puddleResponse`, × the patches' share) over the relief, faded in over `edge`, on ground
 * flatter than `maxSlope` (full up to half of it)
 */
const getPuddle = (
  surface: WetSurfaceInput,
  conditions: SurfaceConditionNodes,
  flat: Node<'float'>,
  opts: SurfacePuddleOpts
) => {
  const defaults = SURFACE_WETNESS_DEFAULTS;
  const puddleLevel = conditions.puddleLevel as unknown as Node<'float'>;
  const level = (
    surface.regional ? max(puddleLevel, surface.regional) : puddleLevel
  ) as Node<'float'>;
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
