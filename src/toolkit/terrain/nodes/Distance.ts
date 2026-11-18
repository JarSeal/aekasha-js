// The terrain material's distance effects (p305 D7): the detail normals fade to the geometry's
// over a range of view distances, so a far surface has the mesh's relief alone (no sparkle of
// sub-pixel normals); and past that range the far surface (`distance.far`), where the layers
// aren't sampled: its share of the surface over the `farBlend` band, and its colour and roughness
// from the layers' weights alone (`AVERAGE_COLOR`: each set's average colour; `COLOR_MAP`: the
// colour map's sample). The branch that skips the layers is `material/TerrainFar.ts`.
import { mix, normalWorldGeometry, smoothstep } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node } from 'three/webgpu';

/** The band's floor in metres: a `farBlend` of 0 is a hard switch, `smoothstep`'s edges distinct */
const MIN_FAR_BLEND = 1e-4;

/**
 * A surface normal faded to the geometry's normal over the view distances `fade` (`[from, to]`,
 * metres): the detail whole before `from`, none past `to`, a smoothstep between
 * @internal
 * @param normal the shaded normal in the material's space, unit length
 * @param viewDistance the view distance in metres
 * @param fade the range as a uniform, `x` from and `y` to
 * @param geometryNormal the geometry's normal in that space (default the world's)
 */
export const fadeDetailNormal = (
  normal: Node<'vec3'>,
  viewDistance: Node<'float'>,
  fade: Node<'vec2'>,
  geometryNormal: Node<'vec3'> = normalWorldGeometry as unknown as Node<'vec3'>
): Node<'vec3'> =>
  mix(normal, geometryNormal, smoothstep(fade.x, fade.y, viewDistance)).normalize() as Node<'vec3'>;

/**
 * The far surface's share of the surface: 0 before `from` (the detail normals' fade's end), 1
 * past `from + blend`, a smoothstep over the band (a step for a `blend` of 0)
 * @internal
 * @param viewDistance the view distance in metres
 * @param from where the far surface starts, metres (`distance.fade`'s end)
 * @param blend the band's width in metres (`terrain_farBlend`)
 */
export const getFarShare = (
  viewDistance: Node<'float'>,
  from: Node<'float'>,
  blend: Node<'float'>
): Node<'float'> =>
  smoothstep(from, from.add(blend.max(MIN_FAR_BLEND)), viewDistance) as unknown as Node<'float'>;

/**
 * Values summed by the weights (which sum to 1): the far surface's per-layer colours or roughness
 * @internal
 */
export const sumByWeights = <T extends Node<'float'> | Node<'vec3'> | Node<'vec4'>>(
  values: T[],
  weights: Node<'float'>[]
): T =>
  values
    .map((value, i) => value.mul(weights[i]) as unknown as T)
    .reduce((total, value) => total.add(value) as unknown as T);
