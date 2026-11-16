// The space the terrain material samples in (p305 D8): `WORLD` (the world's position and geometry
// normal: seamless across pieces, for static ground and structures) or `OBJECT` (the mesh's own,
// scaled back to metres, so the texture sticks to a piece that moves or turns: the toolkit's
// `triplanarProjection` with `alignToObject`). The graph computes its coordinates, projections,
// frames, bump, rules and macro in the space, and turns its shaded normal into world space once
// (`toWorld`) before the one conversion to view space. Each space's nodes are made on first use
// and shared: TSL nodes are graph descriptions, reusable by every material.
import {
  modelScale,
  modelWorldMatrix,
  normalLocal,
  normalWorldGeometry,
  positionLocal,
  positionWorld,
  vec4,
} from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node } from 'three/webgpu';

/**
 * A space's surface: its position in metres, its geometry normal (unit length), and a normal of
 * the space into world space.
 * @internal
 */
export type SurfaceSpace = {
  position: Node<'vec3'>;
  normal: Node<'vec3'>;
  /** A normal of the space in world space, unit length; the identity for `WORLD` */
  toWorld: (normal: Node<'vec3'>) => Node<'vec3'>;
};

/** The spaces a terrain material samples in */
export type SurfaceSpaceName = 'WORLD' | 'OBJECT';

const spaces: Partial<Record<SurfaceSpaceName, SurfaceSpace>> = {};

/** The world's position and geometry normal */
const createWorldSpace = (): SurfaceSpace => ({
  position: positionWorld as unknown as Node<'vec3'>,
  normal: normalWorldGeometry as unknown as Node<'vec3'>,
  toWorld: (normal) => normal,
});

/**
 * The mesh's own position × its scale (metres, the rotation the mesh's) and its normal in that
 * scaled space; back to world through the model matrix's rotation: `mat3(M) · (n / scale)` is
 * `R · n` for `M = T · R · S`. An `InstancedMesh`'s instances share its space (three applies the
 * instance matrix to `positionLocal`).
 */
const createObjectSpace = (): SurfaceSpace => {
  const scale = modelScale as unknown as Node<'vec3'>;
  return {
    position: (positionLocal as unknown as Node<'vec3'>).mul(scale) as Node<'vec3'>,
    normal: (normalLocal as unknown as Node<'vec3'>).div(scale).normalize() as Node<'vec3'>,
    toWorld: (normal) =>
      (modelWorldMatrix as unknown as Node<'mat4'>)
        .mul(vec4(normal.div(scale), 0))
        .xyz.normalize() as unknown as Node<'vec3'>,
  };
};

/**
 * The space's surface nodes, made on first use and shared by every material.
 * @internal
 * @param name `WORLD` or `OBJECT`
 */
export const getSurfaceSpace = (name: SurfaceSpaceName = 'WORLD'): SurfaceSpace =>
  (spaces[name] ??= name === 'OBJECT' ? createObjectSpace() : createWorldSpace());
