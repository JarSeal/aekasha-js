// The texture set decode (p303 D7): a set's packed maps as surface values, for one set's bundle
// (`{ textureSet }`) or a set array's layer (`{ textureSetArray }`), and the two normal helpers a
// set's surface needs at any UV: the tangent frame of that UV, and a bump from a height in metres.
import {
  cross,
  dFdx,
  dFdy,
  dot,
  faceDirection,
  float,
  int,
  max,
  normalView,
  positionView,
  vec3,
} from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node, TextureNode } from 'three/webgpu';
import type { TextureSetArrayInput, TextureSetInput, TextureSetPacking } from 'aekasha/texturesets';

/** How {@link sampleTextureSet} samples: an array bundle's layer, explicit gradients. */
export type SampleTextureSetOptions = {
  /**
   * The layer of a `{ textureSetArray }` bundle: an index, or an int node (eg. a splat map's
   * layer). Required for an array bundle, refused for a `{ textureSet }` one.
   */
  layer?: number | Node<'int'>;
  /**
   * The UV's screen-space gradients, for a sample whose UV isn't continuous (an anti-tiling tap's
   * offset, a triplanar fold): the mip level follows them instead of the sampled UV's own.
   */
  grad?: { dx: Node<'vec2'>; dy: Node<'vec2'> };
};

/**
 * A texture set's surface at a UV, decoded from its packing (p303 D2's table). A value the packing
 * doesn't have is null: the caller picks the stand-in (a flat normal or a bump, a roughness).
 */
export type TextureSetSample = {
  /** The packing the bundle holds (each bundle holds one packing's slots). */
  packing: TextureSetPacking;
  /** The albedo, linear (the texture's sRGB is decoded by the sampler); × AO in `LITE` and `MINIMAL`. */
  albedo: Node<'vec3'>;
  /**
   * The tangent-space normal (OpenGL, +Y), unit length: `FULL`'s map, `LITE`'s X and Y with Z
   * reconstructed; null in `MINIMAL` (no normal map: a bump from `height`, {@link bumpNormalView}).
   * To view space with {@link transformTangentNormalToView} at the UV it was sampled at.
   */
  normalTS: Node<'vec3'> | null;
  /** The roughness, 0..1: `FULL`'s `orm.g`, `LITE`'s albedo alpha; null in `MINIMAL`. */
  roughness: Node<'float'> | null;
  /** The ambient occlusion, 0..1: `FULL`'s `orm.r`; null where it's baked into the albedo. */
  ao: Node<'float'> | null;
  /** Whether the albedo has the AO baked in (`LITE`, `MINIMAL`): a material lowers its own AO's influence. */
  isAoBaked: boolean;
  /** The height, 0..1 (remapped per set when packed): × the set's `heightScale` for metres. */
  height: Node<'float'>;
};

type AnyBundle = TextureSetInput | TextureSetArrayInput;

/** A bundle's slot (three's `TextureNode` in the engine's typings), absent outside its packing */
type SlotNode = TextureSetInput['albedoHeight'];

const isArrayBundle = (bundle: AnyBundle): bundle is TextureSetArrayInput =>
  'layerParams' in bundle;

/**
 * The packing of a bundle by its slots: a `{ textureSet }` or `{ textureSetArray }` bundle holds
 * the slots of the packing its input names, no other.
 */
const getBundlePacking = (bundle: AnyBundle): TextureSetPacking => {
  if (bundle.albedoRough && bundle.normalHeight) return 'LITE';
  if (bundle.albedoHeight && bundle.normal && bundle.orm) return 'FULL';
  if (bundle.albedoHeight) return 'MINIMAL';
  throw new Error(
    '[sampleTextureSet] The bundle holds no complete packing (LITE: albedoRough and normalHeight, FULL: albedoHeight, normal and orm, MINIMAL: albedoHeight): pass a { textureSet } or { textureSetArray } input.'
  );
};

/**
 * Decodes a texture set's packed maps at a UV into surface values (p303 D2's packings): the shared
 * first step of the toolkit's texture set materials (`textureSetSurface`) and p305's terrain
 * techniques. It samples only the bundle's slots, once each, and applies none of the set's
 * `surface` fields: scale them in (`tint`, `normalStrength`, `roughnessScale`, `aoStrength`, the
 * `heightScale`), as the material's look needs.
 * @param bundle a `{ textureSet }` input's bundle, or a `{ textureSetArray }` input's with
 * `options.layer`
 * @param uv the UV to sample at, in tiles (eg. `positionWorld.xz` over the set's `physicalSize`)
 * @param options an array bundle's layer, explicit gradients
 * @returns the decoded values by name, null where the packing has none
 * @example
 * ```ts
 * import { positionWorld, vec2, vec3 } from 'three/tsl';
 * import type { MeshStandardNodeMaterial } from 'three/webgpu';
 * import type { TextureSetInput } from 'aekasha/texturesets';
 * import { sampleTextureSet, transformTangentNormalToView } from 'aekasha/toolkit/terrain';
 *
 * export const setup = (inputs: { surface: TextureSetInput }, material: MeshStandardNodeMaterial) => {
 *   const set = inputs.surface;
 *   const tileUv = vec2(positionWorld.x, positionWorld.z.negate()).div(set.physicalSize);
 *   const surface = sampleTextureSet(set, tileUv);
 *   material.colorNode = surface.albedo.mul(set.tint);
 *   if (surface.roughness) material.roughnessNode = surface.roughness;
 *   if (surface.normalTS) {
 *     material.normalNode = transformTangentNormalToView(surface.normalTS, tileUv);
 *   }
 * };
 * ```
 */
export const sampleTextureSet = (
  bundle: TextureSetInput | TextureSetArrayInput,
  uv: Node<'vec2'>,
  options: SampleTextureSetOptions = {}
): TextureSetSample => {
  const { layer, grad } = options;
  const isArray = isArrayBundle(bundle);
  if (isArray && layer === undefined) {
    throw new Error(
      '[sampleTextureSet] A { textureSetArray } bundle needs options.layer (an index or an int node).'
    );
  }
  if (!isArray && layer !== undefined) {
    throw new Error(
      '[sampleTextureSet] options.layer is for a { textureSetArray } bundle; this is a { textureSet } one.'
    );
  }
  const packing = getBundlePacking(bundle);

  const sample = (slot: SlotNode): Node<'vec4'> => {
    let node = (slot as unknown as TextureNode).sample(uv);
    if (layer !== undefined) node = node.depth(typeof layer === 'number' ? int(layer) : layer);
    if (grad) node = node.grad(grad.dx, grad.dy);
    return node as unknown as Node<'vec4'>;
  };

  if (packing === 'LITE') {
    const albedoRough = sample(bundle.albedoRough);
    const normalHeight = sample(bundle.normalHeight);
    const xy = normalHeight.xy.mul(2).sub(1) as Node<'vec2'>;
    // Z of a unit normal; the max keeps a filtered texel past the unit circle from going NaN
    const z = max(float(0), float(1).sub(dot(xy, xy))).sqrt();
    return {
      packing,
      albedo: albedoRough.rgb,
      normalTS: vec3(xy, z) as unknown as Node<'vec3'>,
      roughness: albedoRough.a,
      ao: null,
      isAoBaked: true,
      height: normalHeight.b,
    };
  }
  const albedoHeight = sample(bundle.albedoHeight);
  if (packing === 'FULL') {
    const orm = sample(bundle.orm);
    return {
      packing,
      albedo: albedoHeight.rgb,
      // Mip filtering shortens the averaged normals
      normalTS: sample(bundle.normal).rgb.mul(2).sub(1).normalize() as Node<'vec3'>,
      roughness: orm.g,
      ao: orm.r,
      isAoBaked: false,
      height: albedoHeight.a,
    };
  }
  return {
    packing,
    albedo: albedoHeight.rgb,
    normalTS: null,
    roughness: null,
    ao: null,
    isAoBaked: true,
    height: albedoHeight.a,
  };
};

/**
 * A tangent-space normal sampled at `uv`, in view space (a material's `normalNode`): the tangent
 * frame of that UV, from its screen-space derivatives (Schüler, "Normal Mapping Without
 * Precomputed Tangents", as three's own frame), around the surface's normal.
 * @param normalTS the tangent-space normal (OpenGL, +Y), eg. {@link TextureSetSample}'s `normalTS`
 * scaled by a strength (`vec3(n.xy.mul(strength), n.z)`); normalized here
 * @param uv the UV the normal was sampled at
 * @returns the view-space normal, unit length
 * @remarks Three's `normalMap()` builds its frame from the mesh's `uv()` (without a `tangent`
 * attribute), so a map sampled at any other UV (world tiling, a triplanar plane, an anti-tiling
 * offset that turns the UV) would get the mesh UV's orientation: the relief lit from the wrong
 * side, or mirrored. Pass the UV the normal was sampled at; an offset or a uniform scale of it
 * keeps the frame. Mirrored world tiling (`positionWorld.xz` seen from above) shades correctly too,
 * but shows the map mirrored: tile at `(x, −z)` for the provider's orientation.
 * @example
 * ```ts
 * import { positionWorld, vec2, vec3 } from 'three/tsl';
 * import type { MeshStandardNodeMaterial } from 'three/webgpu';
 * import type { TextureSetInput } from 'aekasha/texturesets';
 * import { sampleTextureSet, transformTangentNormalToView } from 'aekasha/toolkit/terrain';
 *
 * export const setup = (inputs: { surface: TextureSetInput }, material: MeshStandardNodeMaterial) => {
 *   const set = inputs.surface;
 *   const tileUv = vec2(positionWorld.x, positionWorld.z.negate()).div(set.physicalSize);
 *   const n = sampleTextureSet(set, tileUv).normalTS;
 *   if (n) {
 *     const scaled = vec3(n.xy.mul(set.normalStrength), n.z);
 *     material.normalNode = transformTangentNormalToView(scaled, tileUv);
 *   }
 * };
 * ```
 */
export const transformTangentNormalToView = (
  normalTS: Node<'vec3'>,
  uv: Node<'vec2'>
): Node<'vec3'> => {
  const q0 = dFdx(positionView);
  const q1 = dFdy(positionView);
  const st0 = dFdx(uv);
  const st1 = dFdy(uv);
  const n = normalView;
  const q1perp = cross(q1, n);
  const q0perp = cross(n, q0);
  const t = q1perp.mul(st0.x).add(q0perp.mul(st1.x));
  const b = q1perp.mul(st0.y).add(q0perp.mul(st1.y));
  // One scale for both keeps the frame's handedness and the UV's aspect (three's construction)
  const scale = max(dot(t, t), dot(b, b)).inverseSqrt();
  return t
    .mul(scale)
    .mul(normalTS.x)
    .add(b.mul(scale).mul(normalTS.y))
    .add(n.mul(normalTS.z))
    .normalize() as Node<'vec3'>;
};

/**
 * A view-space normal (a material's `normalNode`) bumped by a height in metres: Mikkelsen, "Bump
 * Mapping Unparametrized Surfaces on the GPU", with the surface derivatives unnormalized, so the
 * relief is in world units at any distance (`MINIMAL`'s normal: the height × the set's
 * `heightScale`). No extra fetch: the height's screen-space derivatives.
 * @param height the height in metres (view-space units: the camera's world isn't scaled)
 * @returns the view-space normal, unit length
 * @remarks Not three's `bumpMap()`: it normalizes the derivatives, so its scale is height per
 * screen pixel and the bump changes with the distance.
 * @example
 * ```ts
 * import { positionWorld, vec2 } from 'three/tsl';
 * import type { MeshStandardNodeMaterial } from 'three/webgpu';
 * import type { TextureSetInput } from 'aekasha/texturesets';
 * import { bumpNormalView, sampleTextureSet } from 'aekasha/toolkit/terrain';
 *
 * export const setup = (inputs: { surface: TextureSetInput }, material: MeshStandardNodeMaterial) => {
 *   const set = inputs.surface;
 *   const tileUv = vec2(positionWorld.x, positionWorld.z.negate()).div(set.physicalSize);
 *   const surface = sampleTextureSet(set, tileUv);
 *   if (!surface.normalTS) {
 *     material.normalNode = bumpNormalView(surface.height.mul(set.heightScale));
 *   }
 * };
 * ```
 */
export const bumpNormalView = (height: Node<'float'>): Node<'vec3'> => {
  const sigmaX = dFdx(positionView);
  const sigmaY = dFdy(positionView);
  const n = normalView;
  const r1 = cross(sigmaY, n);
  const r2 = cross(n, sigmaX);
  const det = dot(sigmaX, r1).mul(faceDirection);
  const grad = det.sign().mul(r1.mul(dFdx(height)).add(r2.mul(dFdy(height))));
  return det.abs().mul(n).sub(grad).normalize() as Node<'vec3'>;
};
