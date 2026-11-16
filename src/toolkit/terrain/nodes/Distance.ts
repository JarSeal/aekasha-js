// The terrain material's distance effects (p305 D7): the detail normals fade to the geometry's
// over a range of view distances, so a far surface has the mesh's relief alone (no sparkle of
// sub-pixel normals). The far colour modes (`distance.far`: `AVERAGE_COLOR`, `COLOR_MAP`, which
// stop the layers' sampling past the range) are Phase 7's.
import { mix, normalWorldGeometry, smoothstep } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node } from 'three/webgpu';

/**
 * A world-space surface normal faded to the geometry's normal over the view distances `fade`
 * (`[from, to]`, metres): the detail whole before `from`, none past `to`, a smoothstep between
 * @internal
 * @param normal the shaded normal in world space, unit length
 * @param viewDistance the view distance in metres
 * @param fade the range as a uniform, `x` from and `y` to
 */
export const fadeDetailNormal = (
  normal: Node<'vec3'>,
  viewDistance: Node<'float'>,
  fade: Node<'vec2'>
): Node<'vec3'> =>
  mix(
    normal,
    normalWorldGeometry,
    smoothstep(fade.x, fade.y, viewDistance)
  ).normalize() as Node<'vec3'>;
