// The fog's one graph (p106 D3): every mode's factor, each weighted by a one-hot mode uniform, ×
// the master switch, into three's `fog(color, factor)`. Switching the mode or the switch writes
// uniforms only: the graph, and with it every material's fog, never changes, so nothing
// recompiles (a different `scene.fogNode`, or a graph of another shape, recompiles every
// material in the scene: three r187 keys every draw on its cache key).
import * as THREE from 'three/webgpu';
import { densityFogFactor, fog, rangeFogFactor, uniform } from 'three/tsl';

/**
 * The fog's uniforms and its graph, made once a page load (`getFogNodes`): the `fog()` feature
 * writes the uniforms in place, so a scene's `fogNode` set to `node` never goes stale.
 */
export type FogNodes = {
  /** The fog graph: three's `fog(color, factor)`, what the root scene's `fogNode` is while a
   * scene has a fog */
  readonly node: THREE.Node;
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
};

/**
 * Makes the fog's uniforms (no fog: `enabled` 0) and its graph over them.
 * @internal
 */
export const createFogNodes = (): FogNodes => {
  const color = uniform(new THREE.Color());
  const enabled = uniform(0);
  const modeWeights = uniform(new THREE.Vector3());
  const near = uniform(0);
  const far = uniform(1);
  const exp2Density = uniform(0);
  // Every mode's factor, each × its weight (a few ALU a pixel): a select would branch on a
  // uniform for the same price
  const factor = rangeFogFactor(near, far)
    .mul(modeWeights.x)
    .add(densityFogFactor(exp2Density).mul(modeWeights.y))
    .mul(enabled);
  return {
    node: fog(color, factor),
    color,
    enabled,
    modeWeights,
    near,
    far,
    exp2Density,
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
