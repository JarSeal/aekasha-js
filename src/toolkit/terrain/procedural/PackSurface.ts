// A procedural surface packed into a texture set packing's slots (p304 D3, p303 D2's table), so a
// baked procedural set holds what an imported one holds, channel for channel, and decodes through
// the same `sampleTextureSet`.
import { float, vec4 } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node } from 'three/webgpu';
import type { BakeOutput } from 'aekasha';
import type { TextureSetPacking } from 'aekasha/texturesets';

/** A surface's values at a point, ready to pack: what a generator's surface resolves to. */
export type PackableSurface = {
  /** The albedo, linear colour (the bake writes it as sRGB). */
  albedo: Node<'vec3'>;
  /** The height, 0..1 (the set's `heightScale` metres at 1). */
  height: Node<'float'>;
  /** The roughness, 0..1. */
  roughness: Node<'float'>;
  /** The ambient occlusion, 0..1 (1 open). */
  ao: Node<'float'>;
  /** The tangent-space normal (OpenGL, +Y along +v), unit length. Needed by `FULL` and `LITE`. */
  normal?: Node<'vec3'>;
};

/** Each packing's slots, in `TEXTURE_SET_PACKINGS`' order (repeated here: the schema's value
 * would bring zod). */
const PACKING_SLOTS = {
  FULL: ['albedoHeight', 'normal', 'orm'],
  LITE: ['albedoRough', 'normalHeight'],
  MINIMAL: ['albedoHeight'],
} as const satisfies Record<TextureSetPacking, readonly string[]>;

/**
 * Whether a packing stores a normal map (`FULL`, `LITE`); `MINIMAL`'s normal comes from its
 * height at runtime.
 * @returns true when packing the surface needs its `normal`
 */
export const doesPackingStoreNormal = (packing: TextureSetPacking) => packing !== 'MINIMAL';

/**
 * A packing's slots as bake outputs, in the packing's order: the albedo slots sRGB, the rest
 * linear, all 8-bit (what `bakeTexture` takes as `outputs`).
 * @returns the outputs, one per slot
 * @example
 * ```ts
 * import { getSurfacePackingOutputs } from 'aekasha/toolkit/terrain';
 *
 * // [{ name: 'albedoRough', colorSpace: 'SRGB' }, { name: 'normalHeight', colorSpace: 'LINEAR' }]
 * const outputs = getSurfacePackingOutputs('LITE');
 * ```
 */
export const getSurfacePackingOutputs = (packing: TextureSetPacking): BakeOutput[] =>
  PACKING_SLOTS[packing].map((name) => ({
    name,
    colorSpace: name.startsWith('albedo') ? 'SRGB' : 'LINEAR',
  }));

const saturate = <T extends Node<'float'> | Node<'vec3'>>(node: T) => node.clamp(0, 1) as T;

/** A unit normal stored in 0..1, as a normal map holds it. */
const encodeNormal = (normal: Node<'vec3'>) => normal.mul(0.5).add(0.5) as Node<'vec3'>;

/**
 * Packs a surface into a texture set packing's slots (p303 D2): the graphs a bake writes, by slot
 * name, so a baked procedural set is channel for channel an imported one.
 *
 * - `FULL`: `albedoHeight` (RGB albedo, A height), `normal` (RGB), `orm` (R AO, G roughness, B
 *   metalness 0).
 * - `LITE`: `albedoRough` (RGB albedo × AO, A roughness), `normalHeight` (RG the normal's X and Y,
 *   B height, A 1).
 * - `MINIMAL`: `albedoHeight` (RGB albedo × AO, A height).
 *
 * Every value is clamped to 0..1 first.
 * @param surface the surface's values (its `normal` for `FULL` and `LITE`)
 * @param packing the packing to write
 * @returns a vec4 graph per slot, by slot name: the albedo slots linear colour (bake them sRGB,
 * {@link getSurfacePackingOutputs})
 * @throws for `FULL` or `LITE` without a `normal`
 * @example
 * ```ts
 * import { float, vec3 } from 'three/tsl';
 * import { bakeTexture } from 'aekasha';
 * import { fbm, getSurfacePackingOutputs, packSurfaceOutputs } from 'aekasha/toolkit/terrain';
 *
 * await bakeTexture({
 *   id: 'greySand',
 *   size: 512,
 *   outputs: getSurfacePackingOutputs('MINIMAL'),
 *   build: ({ uv }) => {
 *     const height = fbm(uv.mul(8), { period: 8, octaves: 4 }).mul(0.5).add(0.5);
 *     const surface = { albedo: vec3(0.5), height, roughness: float(0.9), ao: float(1) };
 *     return packSurfaceOutputs(surface, 'MINIMAL');
 *   },
 * });
 * ```
 */
export const packSurfaceOutputs = (
  surface: PackableSurface,
  packing: TextureSetPacking
): Record<string, Node<'vec4'>> => {
  const albedo = saturate(surface.albedo);
  const height = saturate(surface.height);
  const roughness = saturate(surface.roughness);
  const ao = saturate(surface.ao);
  if (packing === 'MINIMAL') {
    return { albedoHeight: vec4(albedo.mul(ao), height) as unknown as Node<'vec4'> };
  }
  if (!surface.normal) {
    throw new Error(`[packSurfaceOutputs] The ${packing} packing stores a normal: give one.`);
  }
  const normal = encodeNormal(surface.normal);
  if (packing === 'FULL') {
    return {
      albedoHeight: vec4(albedo, height) as unknown as Node<'vec4'>,
      normal: vec4(normal, 1) as unknown as Node<'vec4'>,
      orm: vec4(ao, roughness, float(0), 1) as unknown as Node<'vec4'>,
    };
  }
  return {
    albedoRough: vec4(albedo.mul(ao), roughness) as unknown as Node<'vec4'>,
    normalHeight: vec4(normal.xy, height, 1) as unknown as Node<'vec4'>,
  };
};
