// The wet response (p307 D2, T1 T2 T6): a surface under the surface conditions' wetness. Rain
// reaches what faces the sky (the geometry normal's world Y: overhangs and undersides stay dry);
// the local wetness rises first in the low points and cavities and last on the peaks; then two
// stages: the pores fill (the albedo darkens by the porosity, the roughness falls a little toward
// the response's), then a water film forms over them (the roughness falls to water's, the detail
// normal flattens toward the geometry's). A porous surface fills its pores before any film; a
// dense one gets the film at once. Every number of the response is a node: a terrain material's
// are its layers' set uniforms blended by weight, an app material's its own. No texture fetch.
import { float, max, mix, normalWorldGeometry, smoothstep, vec2 } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node } from 'three/webgpu';
import type { SurfaceConditionNodes } from 'aekasha/surface';

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
const DEG_TO_RAD = Math.PI / 180;

/**
 * The default `ApplySurfaceWetnessOpts`' numbers (the terrain material's `wet` defaults too).
 * @internal
 */
export const SURFACE_WETNESS_DEFAULTS = {
  heightInfluence: 0.5,
  cavityInfluence: 0.5,
  shelter: [60, 120],
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
  /** How much the filled pores darken the albedo (× the porosity), 0 none, 1 black. */
  wetDarkening: Node<'float'> | number;
  /** The roughness with the pores full, before the film (never above the dry roughness). */
  wetRoughness: Node<'float'> | number;
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
  /** The film's stage: how far the water film has formed over the full pores. */
  film: Node<'float'>;
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
 * reaches it (the geometry's facing, `shelter`), shifted by the relief (low points first, peaks
 * last) and the cavities, darkens the albedo as the pores fill (`wetDarkening` × `porosity`),
 * lowers the roughness to `wetRoughness` and then, as a film forms over the full pores, to water's
 * (`WET_FILM_ROUGHNESS`, 0.05), and flattens the detail normal under the film. A dense surface
 * (`porosity` 0) gets the film at once, a porous one (1) fills its pores over the first half of
 * its local wetness. Builds no texture fetch and no branch; at wetness 0 the surface is as given.
 * @param surface the dry surface, its relief, cavity and response
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
 *     conditions
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
  const global = (conditions.wetness as unknown as Node<'float'>).mul(exposure) as Node<'float'>;

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

  // T1: the pores over the first share of the wetness (by the porosity), the film over the rest
  const split = porosity.mul(PORE_SHARE) as Node<'float'>;
  const pores = local.div(max(split, MIN_PORE_STAGE)).saturate() as Node<'float'>;
  const film = local.sub(split).div(float(1).sub(split)).saturate() as Node<'float'>;
  const albedo = surface.albedo.mul(
    float(1).sub(darkening.mul(porosity).mul(pores))
  ) as Node<'vec3'>;
  const pored = mix(surface.roughness, surface.roughness.min(wetRoughness), pores) as Node<'float'>;
  const roughness = mix(pored, float(WET_FILM_ROUGHNESS), film) as Node<'float'>;
  const geometryNormal = opts.geometryNormal ?? (normalWorldGeometry as unknown as Node<'vec3'>);
  const normal =
    surface.normal && isFull
      ? (mix(surface.normal, geometryNormal, film.mul(FILM_FLATTEN)).normalize() as Node<'vec3'>)
      : surface.normal;
  return {
    albedo,
    roughness,
    ...(normal ? { normal } : {}),
    masks: { exposure, wetness: local, pores, film },
  };
};
