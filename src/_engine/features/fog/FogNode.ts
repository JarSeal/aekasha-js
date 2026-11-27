// The fog's one graph (p106 D3): every mode's factor, each weighted by a one-hot mode uniform, ×
// the master switch, into three's `fog(color, factor)`, its colour moved toward the sun by the sun
// glow (D4). Switching the mode, the glow or the switch writes uniforms only: the graph, and with
// it every material's fog, never changes, so nothing recompiles (a different `scene.fogNode`, or a
// graph of another shape, recompiles every material in the scene: three r187 keys every draw on
// its cache key).
import * as THREE from 'three/webgpu';
import {
  cameraPosition,
  cameraWorldMatrix,
  densityFogFactor,
  Fn,
  fog,
  mix,
  positionView,
  rangeFogFactor,
  renderGroup,
  select,
  uniform,
  vec4,
} from 'three/tsl';

/**
 * The fog's uniforms and its graph, made once a page load (`getFogNodes`): the `fog()` feature
 * writes the uniforms in place, so a scene's `fogNode` set to `node` never goes stale.
 */
export type FogNodes = {
  /** The fog graph: three's `fog(color, factor)`, what the root scene's `fogNode` is while a
   * scene has a fog */
  readonly node: THREE.Node;
  /** The fog factor `node` mixes toward the fog's colour by, 0 (clear) to 1 (full fog): the
   * current mode's, × the master switch (a float node, for a view or a fog node of one's own) */
  readonly factor: THREE.Node<'float'>;
  /** The fog's colour (linear, as three's colours are) */
  readonly color: THREE.UniformNode<'color', THREE.Color>;
  /** 1 while the fog renders (its own `enabled` and `setFogEnabled`'s switch), else 0 */
  readonly enabled: THREE.UniformNode<'float', number>;
  /** The modes' weights, one of them 1: x `LINEAR`, y `EXP2`, z `HEIGHT` */
  readonly modeWeights: THREE.UniformNode<'vec3', THREE.Vector3>;
  /** `LINEAR`'s near, metres */
  readonly near: THREE.UniformNode<'float', number>;
  /** `LINEAR`'s far, metres (more than `near`) */
  readonly far: THREE.UniformNode<'float', number>;
  /** `EXP2`'s density */
  readonly exp2Density: THREE.UniformNode<'float', number>;
  /** `HEIGHT`'s density per metre at `baseHeight` */
  readonly heightDensity: THREE.UniformNode<'float', number>;
  /** `HEIGHT`'s world Y where the density is `heightDensity` */
  readonly baseHeight: THREE.UniformNode<'float', number>;
  /** `HEIGHT`'s falloff per metre of height */
  readonly falloff: THREE.UniformNode<'float', number>;
  /** `HEIGHT`'s metres from the camera before which there's no fog */
  readonly startDistance: THREE.UniformNode<'float', number>;
  /** `HEIGHT`'s factor's maximum, 0 to 1 */
  readonly maxOpacity: THREE.UniformNode<'float', number>;
  /** The world direction toward the sun, unit length, or zero for no sun (no glow) */
  readonly sunDirection: THREE.UniformNode<'vec3', THREE.Vector3>;
  /** The colour the fog glows toward around the sun (linear) */
  readonly sunColor: THREE.UniformNode<'color', THREE.Color>;
  /** The glow's strength, 0 to 1: 0 with the fog's `sunScattering` off */
  readonly sunStrength: THREE.UniformNode<'float', number>;
  /** The glow's exponent: higher is tighter around the sun (more than 0) */
  readonly sunExponent: THREE.UniformNode<'float', number>;
};

/**
 * The shortest camera-to-fragment distance `HEIGHT` divides by, metres.
 * @internal
 */
export const FOG_MIN_RAY_LENGTH = 1e-6;
/**
 * The largest exponent `HEIGHT`'s density takes (`exp(60)` ≈ 1e26, far from float32's overflow
 * even × a long ray): a camera deep below `baseHeight` gets full fog, not an infinity.
 * @internal
 */
export const FOG_MAX_DENSITY_EXPONENT = 60;
/**
 * Below this `falloff · Δy`, `HEIGHT` takes the mean density as the midpoint of the ray's ends
 * (the closed form's limit, to second order) instead of dividing by it.
 * @internal
 */
export const FOG_FLAT_RAY_EPSILON = 1e-3;

/**
 * Makes the fog's uniforms (no fog: `enabled` 0, no sun) and its graph over them.
 * @internal
 */
export const createFogNodes = (): FogNodes => {
  // In three's `renderGroup` (shared, written once per render call), as three's own `scene.fog`
  // uniforms are, never the default per-object group: three r187 refreshes a classic material's
  // (`MeshStandardMaterial`, the engine's `STANDARD`) per-object uniforms only when the material,
  // the object or the lights change (`NodeMaterialObserver.needsRefresh`), so those draws kept
  // the fog of their first frame (p106 Phase 5)
  const color = uniform(new THREE.Color()).setGroup(renderGroup);
  const enabled = uniform(0).setGroup(renderGroup);
  const modeWeights = uniform(new THREE.Vector3()).setGroup(renderGroup);
  const near = uniform(0).setGroup(renderGroup);
  const far = uniform(1).setGroup(renderGroup);
  const exp2Density = uniform(0).setGroup(renderGroup);
  const heightDensity = uniform(0).setGroup(renderGroup);
  const baseHeight = uniform(0).setGroup(renderGroup);
  const falloff = uniform(0).setGroup(renderGroup);
  const startDistance = uniform(0).setGroup(renderGroup);
  const maxOpacity = uniform(1).setGroup(renderGroup);
  const sunDirection = uniform(new THREE.Vector3()).setGroup(renderGroup);
  const sunColor = uniform(new THREE.Color(1, 1, 1)).setGroup(renderGroup);
  const sunStrength = uniform(0).setGroup(renderGroup);
  const sunExponent = uniform(1).setGroup(renderGroup);

  // The camera-to-fragment ray in world space, from the view position (right for sprites, fat
  // lines and vertex nodes too, as three's fog's view depth is)
  const getRay = () => {
    const ray = cameraWorldMatrix.mul(vec4(positionView, 0)).xyz.toVar();
    return { ray, rayLength: ray.length().max(FOG_MIN_RAY_LENGTH).toVar() };
  };

  const factor = Fn(() => {
    const { ray, rayLength } = getRay();

    // `HEIGHT` (D4): the density `heightDensity · exp(−falloff · (y − baseHeight))` integrated
    // along the ray from `startDistance` on, in closed form; `getHeightFogFactor` is its twin
    const fogLength = rayLength.sub(startDistance).max(0);
    const startY = cameraPosition.y.add(ray.y.mul(startDistance.div(rayLength).min(1)));
    const endY = cameraPosition.y.add(ray.y);
    const startExp = falloff.mul(startY.sub(baseHeight)).negate().min(FOG_MAX_DENSITY_EXPONENT);
    const endExp = falloff.mul(endY.sub(baseHeight)).negate().min(FOG_MAX_DENSITY_EXPONENT);
    const expDelta = startExp.sub(endExp).toVar();
    const startDensity = startExp.exp().toVar();
    const endDensity = endExp.exp().toVar();
    const meanDensity = select(
      expDelta.abs().lessThan(FOG_FLAT_RAY_EPSILON),
      startDensity.add(endDensity).mul(0.5),
      startDensity.sub(endDensity).div(expDelta)
    );
    const heightFactor = heightDensity
      .mul(fogLength)
      .mul(meanDensity)
      .negate()
      .exp()
      .oneMinus()
      .min(maxOpacity);

    // Every mode's factor, each × its weight (a few ALU a pixel): a select would branch on a
    // uniform for the same price
    return rangeFogFactor(near, far)
      .mul(modeWeights.x)
      .add(densityFogFactor(exp2Density).mul(modeWeights.y))
      .add(heightFactor.mul(modeWeights.z))
      .mul(enabled);
  })();

  // The sun glow (D4): the colour toward the sun's around it; a zero sun direction gives none
  const glowColor = Fn(() => {
    const { ray, rayLength } = getRay();
    const sunCos = ray.div(rayLength).dot(sunDirection).max(0);
    const glow = sunStrength.mul(sunCos.pow(sunExponent));
    return mix(color, sunColor, glow);
  })();

  return {
    node: fog(glowColor, factor),
    factor,
    color,
    enabled,
    modeWeights,
    near,
    far,
    exp2Density,
    heightDensity,
    baseHeight,
    falloff,
    startDistance,
    maxOpacity,
    sunDirection,
    sunColor,
    sunStrength,
    sunExponent,
  };
};

/**
 * `LINEAR`'s factor on the CPU (three's `rangeFogFactor`: a smoothstep from `near` to `far` over
 * the view depth), for the tests and the debug tab's readouts.
 * @internal
 */
export const getLinearFogFactor = (near: number, far: number, viewDepth: number) => {
  const t = Math.min(Math.max((viewDepth - near) / (far - near), 0), 1);
  return t * t * (3 - 2 * t);
};

/**
 * `EXP2`'s factor on the CPU (three's `densityFogFactor`: `1 − exp(−(density · depth)²)`), for
 * the tests and the debug tab's readouts.
 * @internal
 */
export const getExp2FogFactor = (density: number, viewDepth: number) => {
  const d = density * viewDepth;
  return 1 - Math.exp(-d * d);
};

/** {@link getHeightFogFactor}'s parameters: the uniforms' values. */
type HeightFogFactorParams = {
  density: number;
  baseHeight: number;
  falloff: number;
  startDistance: number;
  maxOpacity: number;
};

/**
 * `HEIGHT`'s factor on the CPU, the graph's twin step for step (for the tests and the debug
 * tab's readouts): `1 − exp(−∫ density)` along the ray from `startDistance` on, at most
 * `maxOpacity`.
 * @internal
 * @param cameraY the camera's world Y
 * @param rayLength metres from the camera to the point
 * @param rayY the point's world Y less the camera's
 */
export const getHeightFogFactor = (
  params: HeightFogFactorParams,
  cameraY: number,
  rayLength: number,
  rayY: number
) => {
  const { density, baseHeight, falloff, startDistance, maxOpacity } = params;
  const length = Math.max(rayLength, FOG_MIN_RAY_LENGTH);
  const fogLength = Math.max(length - startDistance, 0);
  const startY = cameraY + rayY * Math.min(startDistance / length, 1);
  const endY = cameraY + rayY;
  const startExp = Math.min(-(falloff * (startY - baseHeight)), FOG_MAX_DENSITY_EXPONENT);
  const endExp = Math.min(-(falloff * (endY - baseHeight)), FOG_MAX_DENSITY_EXPONENT);
  const expDelta = startExp - endExp;
  const startDensity = Math.exp(startExp);
  const endDensity = Math.exp(endExp);
  const meanDensity =
    Math.abs(expDelta) < FOG_FLAT_RAY_EPSILON
      ? (startDensity + endDensity) * 0.5
      : (startDensity - endDensity) / expDelta;
  return Math.min(1 - Math.exp(-density * fogLength * meanDensity), maxOpacity);
};

/**
 * The sun glow on the CPU, the graph's twin: how far the fog's colour moves toward the sun's,
 * `strength · max(cos, 0)^exponent`.
 * @internal
 * @param sunCos the cosine of the angle between the view ray and the sun's direction
 */
export const getFogSunGlow = (strength: number, exponent: number, sunCos: number) =>
  strength * Math.max(sunCos, 0) ** exponent;
