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

/** A UV's scale and turn from coordinates (a slot's tiling of continuous coordinates) */
export type UvMapping = {
  /** The coordinates' units a tile (a layer's tile size) */
  tileSize: Node<'vec2'>;
  /** The turn the UV takes after the scale (its cosine and sine), or null for none */
  turn: { cos: Node<'float'>; sin: Node<'float'> } | null;
};

/**
 * The screen-space derivatives a UV's frame is made of, built before a branch that reads them: the
 * world position's and the UV's (WGSL refuses a derivative in non-uniform control flow)
 */
export type FrameDerivatives = {
  dpdx: Node<'vec3'>;
  dpdy: Node<'vec3'>;
  duvdx: Node<'vec2'>;
  duvdy: Node<'vec2'>;
};

/**
 * The tangent frame of any UV from its screen-space derivatives (Schüler, "Normal Mapping Without
 * Precomputed Tangents"), in world space: `transformTangentNormalToView`'s construction on world
 * vectors, for a mesh's UV (`MESH_UV`), which has no `tangent` attribute. With a mapping, the
 * frame is of the UV `turn(uv / tileSize)` (`(c·x + s·y, c·y − s·x)`), its directions mapped from
 * `uv`'s: a sparse slot's UV jumps where its layer changes, the coordinates don't.
 * @internal
 * @param uv the UV the normal map is sampled at, or the coordinates `mapping` tiles
 * @param mapping the scale and turn from `uv` to the sampled UV, or none
 * @param derivatives the position's and `uv`'s derivatives built before (a branch's), or none: its
 * own
 */
export const getUvTangentFrame = (
  uv: Node<'vec2'>,
  mapping?: UvMapping,
  derivatives?: FrameDerivatives
): WorldTangentFrame => {
  const q0 = derivatives?.dpdx ?? dFdx(positionWorld);
  const q1 = derivatives?.dpdy ?? dFdy(positionWorld);
  const st0 = derivatives?.duvdx ?? dFdx(uv);
  const st1 = derivatives?.duvdy ?? dFdy(uv);
  const normal = getGeometryNormal();
  const q1perp = cross(q1, normal);
  const q0perp = cross(normal, q0);
  let t = q1perp.mul(st0.x).add(q0perp.mul(st1.x)) as unknown as Node<'vec3'>;
  let b = q1perp.mul(st0.y).add(q0perp.mul(st1.y)) as unknown as Node<'vec3'>;
  if (mapping) {
    // The directions are the UV's gradients: linear in the map
    const tScaled = t.div(mapping.tileSize.x) as Node<'vec3'>;
    const bScaled = b.div(mapping.tileSize.y) as Node<'vec3'>;
    const { turn } = mapping;
    t = turn ? (tScaled.mul(turn.cos).add(bScaled.mul(turn.sin)) as Node<'vec3'>) : tScaled;
    b = turn ? (bScaled.mul(turn.cos).sub(tScaled.mul(turn.sin)) as Node<'vec3'>) : bScaled;
  }
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
