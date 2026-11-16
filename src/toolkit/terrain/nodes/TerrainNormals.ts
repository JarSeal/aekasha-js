// The terrain material's normals in world space (p305 D2): a layer's tangent frame (the analytic
// one of planar world tiling, or the derivative one of a mesh's UV), a tangent-space normal into
// world space, a bump from a height in metres, and the blended world normal into view space once
// (the material's `normalNode`). World space, so per-layer normals of different projections and
// frames blend by weight before the one conversion. The view-space forms the baseline material
// uses are `SampleTextureSet.ts`' (`transformTangentNormalToView`, `bumpNormalView`): the same
// constructions on view vectors. Front faces: the geometry normal isn't flipped on a back face.
import {
  cameraViewMatrix,
  cross,
  dFdx,
  dFdy,
  dot,
  faceDirection,
  float,
  max,
  normalWorldGeometry,
  positionWorld,
  vec3,
  vec4,
} from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node } from 'three/webgpu';

/** A tangent frame in world space: the UV's U and V directions and the surface normal */
export type WorldTangentFrame = {
  tangent: Node<'vec3'>;
  bitangent: Node<'vec3'>;
  normal: Node<'vec3'>;
};

/** The geometry's interpolated normal in world space, unit length */
const getGeometryNormal = () => normalWorldGeometry as unknown as Node<'vec3'>;

/**
 * The analytic tangent frame of planar world tiling, the UV `(x, −z)` over a tile size turned by
 * an angle (counter-clockwise from above, as the tiling's rotation): U along `(cos, 0, −sin)`, V
 * along `(−sin, 0, −cos)`, made orthogonal to the geometry normal (Gram–Schmidt). No derivatives,
 * so it holds at any distance and mip. A vertical face has no planar frame: its normal is the
 * geometry's there (planar tiling stretches it anyway; p305 D5 projects it).
 * @internal
 * @param rotation the tiling's angle in radians, or null for none
 */
export const getPlanarTangentFrame = (rotation: Node<'float'> | null): WorldTangentFrame => {
  const normal = getGeometryNormal();
  const axis = rotation
    ? (vec3(rotation.cos(), 0, rotation.sin().negate()) as unknown as Node<'vec3'>)
    : (vec3(1, 0, 0) as unknown as Node<'vec3'>);
  const projected = axis.sub(normal.mul(dot(normal, axis)));
  // A safe normalize: a vertical face's projection is about zero, which then leaves the normal
  const tangent = projected.div(max(projected.length(), float(1e-4))) as Node<'vec3'>;
  return { tangent, bitangent: cross(normal, tangent) as Node<'vec3'>, normal };
};

/**
 * The tangent frame of any UV from its screen-space derivatives (Schüler, "Normal Mapping Without
 * Precomputed Tangents"), in world space: `transformTangentNormalToView`'s construction on world
 * vectors, for a mesh's UV (`MESH_UV`), which has no `tangent` attribute.
 * @internal
 * @param uv the UV the normal map is sampled at
 */
export const getUvTangentFrame = (uv: Node<'vec2'>): WorldTangentFrame => {
  const q0 = dFdx(positionWorld);
  const q1 = dFdy(positionWorld);
  const st0 = dFdx(uv);
  const st1 = dFdy(uv);
  const normal = getGeometryNormal();
  const q1perp = cross(q1, normal);
  const q0perp = cross(normal, q0);
  const t = q1perp.mul(st0.x).add(q0perp.mul(st1.x));
  const b = q1perp.mul(st0.y).add(q0perp.mul(st1.y));
  // One scale for both keeps the frame's handedness and the UV's aspect (three's construction)
  const scale = max(dot(t, t), dot(b, b)).inverseSqrt();
  return {
    tangent: t.mul(scale) as unknown as Node<'vec3'>,
    bitangent: b.mul(scale) as unknown as Node<'vec3'>,
    normal,
  };
};

/**
 * A tangent-space normal (OpenGL, +Y) in world space through a frame, normalized.
 * @internal
 */
export const transformTangentNormalToWorld = (
  normalTS: Node<'vec3'>,
  frame: WorldTangentFrame
): Node<'vec3'> =>
  frame.tangent
    .mul(normalTS.x)
    .add(frame.bitangent.mul(normalTS.y))
    .add(frame.normal.mul(normalTS.z))
    .normalize() as Node<'vec3'>;

/**
 * The geometry normal bumped by a height in metres, in world space: `bumpNormalView`'s
 * construction (Mikkelsen, the surface derivatives unnormalized, so the relief is in world units at
 * any distance) on world vectors. No extra fetch.
 * @internal
 * @param height the height in metres
 */
export const bumpNormalWorld = (height: Node<'float'>): Node<'vec3'> => {
  const sigmaX = dFdx(positionWorld);
  const sigmaY = dFdy(positionWorld);
  const normal = getGeometryNormal();
  const r1 = cross(sigmaY, normal);
  const r2 = cross(normal, sigmaX);
  const det = dot(sigmaX, r1).mul(faceDirection);
  const grad = det.sign().mul(r1.mul(dFdx(height)).add(r2.mul(dFdy(height))));
  return det.abs().mul(normal).sub(grad).normalize() as Node<'vec3'>;
};

/**
 * A world-space normal into view space, a material's `normalNode`: the one conversion of the
 * blended normal (the camera's rotation; its world isn't scaled).
 * @internal
 */
export const transformWorldNormalToView = (normal: Node<'vec3'>): Node<'vec3'> =>
  cameraViewMatrix.mul(vec4(normal, 0)).xyz.normalize() as unknown as Node<'vec3'>;
