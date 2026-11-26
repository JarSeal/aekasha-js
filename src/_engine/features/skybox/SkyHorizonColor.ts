// The sky's colour at the horizon, on the CPU (p106 D5): what the composite shows there in a
// direction, from the layers' CPU twins (layers/Atmosphere.ts, layers/Ground.ts), for the fog's
// colour (the app wires it, AppECSPlugins.ts) and any game code that matches the sky. Not in
// SkyColor.ts: every layer imports that file, and this one imports the layers.
import * as THREE from 'three/webgpu';
import type { SkyBoxDef } from './SkyBoxTypes';
import { getActiveSkyBox } from './SkyBox';
import {
  getSunCount,
  isAtmosphereEnabled,
  isGroundEnabled,
  isSunEnabled,
  type SkyUniforms,
} from './SkyComposite';
import { computeAtmosphereColor } from './layers/Atmosphere';
import { ENV_DEFAULTS } from './layers/Base';
import { computeGroundColor } from './layers/Ground';
import { addSunGlow } from './layers/Sun';

/** Options of {@link getSkyHorizonColor}. */
export type SkyHorizonColorOpts = {
  /** Whose horizon: its horizontal part is used (its height is ignored), so a camera's forward
   * vector reads the horizon it faces. Default (and for a vertical one): away from the primary
   * sun. */
  direction?: THREE.Vector3;
};

/** The horizon read when neither the direction nor the sun has a horizontal part (with the sun
 * straight up or down, every horizon direction reads the same). */
const FALLBACK_DIRECTION = new THREE.Vector3(0, 0, -1);
const MIN_HORIZONTAL_LENGTH_SQ = 1e-12;

const _dir = new THREE.Vector3();
const _behind = new THREE.Color();

/** `from`'s horizontal part × `sign`, unit length, into `out`, or null when it has none. */
const toHorizontal = (from: THREE.Vector3, sign: number, out: THREE.Vector3) => {
  out.set(from.x * sign, 0, from.z * sign);
  const lengthSq = out.lengthSq();
  return lengthSq > MIN_HORIZONTAL_LENGTH_SQ ? out.multiplyScalar(1 / Math.sqrt(lengthSq)) : null;
};

/**
 * A sky box's horizon colour from its definition and uniforms, into `out` (getSkyHorizonColor's
 * work, for the tests without an active sky box). Allocates nothing.
 * @internal
 * @param direction see {@link SkyHorizonColorOpts}
 * @returns `out`, or null (a texture base without the atmosphere: `out` untouched)
 */
export const computeSkyHorizonColor = (
  def: SkyBoxDef,
  u: SkyUniforms,
  out: THREE.Color,
  direction?: THREE.Vector3
): THREE.Color | null => {
  const hasAtmosphere = isAtmosphereEnabled(def);
  const isColorBase = def.base.type === 'COLOR';
  if (!isColorBase && !hasAtmosphere) return null;
  const sunDirection = u.suns[0].direction.value;
  const dir =
    (direction && toHorizontal(direction, 1, _dir)) ??
    toHorizontal(sunDirection, -1, _dir) ??
    _dir.copy(FALLBACK_DIRECTION);
  // The layers behind the atmosphere: a COLOR base, else black (a texture can't be read here),
  // and the suns' halos; the stars, nebulae, moons and the suns' discs are left out (a fog
  // shouldn't take a disc's radiance)
  const behind = isColorBase
    ? _behind.copy(u.base.color.value).multiplyScalar(u.base.intensity.value)
    : _behind.setRGB(0, 0, 0);
  for (let i = 0; i < getSunCount(def); i++) {
    if (isSunEnabled(def, i)) addSunGlow(dir, u.suns[i], behind);
  }
  const color = hasAtmosphere
    ? computeAtmosphereColor(dir, behind, u.atmosphere, sunDirection, out)
    : out.copy(behind);
  if (isGroundEnabled(def)) computeGroundColor(dir.y, color, u.ground, color);
  // three's background multiplies the node by the scene's backgroundIntensity (activation's)
  return color.multiplyScalar(def.env?.backgroundIntensity ?? ENV_DEFAULTS.backgroundIntensity);
};

/**
 * The active sky box's colour at the horizon (linear, HDR: it can pass 1, as the sky does before
 * tone mapping), into `out`: the atmosphere over a `COLOR` base and the suns' halos, and the
 * ground where its horizon line is above the horizon; without the atmosphere, a `COLOR` base's
 * colour and the halos. It follows
 * the day-night cycle and every update. The fog's `SKY` colour reads it (the app wires it with
 * `setFogColorSource`).
 * @param out the colour written
 * @param opts.direction whose horizon (default: away from the primary sun)
 * @returns `out`, or null (no active sky box, or a texture base without the atmosphere: `out` is
 * untouched)
 * @remarks Computed on the CPU from the sky's uniforms, the same maths as the sky's shader, but
 * a texture base counts as black behind the atmosphere, and the stars, nebulae, moons and the
 * suns' discs are left out. Allocates nothing, so it can run every frame.
 * @example
 * ```ts
 * import * as THREE from 'three/webgpu';
 * import { getSkyHorizonColor } from 'aekasha/skybox';
 *
 * // A HUD tint that follows the sky's horizon (scratch colour: no allocation per frame)
 * const horizon = new THREE.Color();
 * if (getSkyHorizonColor(horizon)) myHud.setTint(horizon.getStyle());
 * ```
 */
export const getSkyHorizonColor = (out: THREE.Color, opts?: SkyHorizonColorOpts) => {
  const active = getActiveSkyBox();
  return active ? computeSkyHorizonColor(active.def, active.uniforms, out, opts?.direction) : null;
};
