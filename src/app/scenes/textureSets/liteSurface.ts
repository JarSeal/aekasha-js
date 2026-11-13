import { float, normalMap } from 'three/tsl';
import { NormalRGPacking } from 'three/webgpu';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { MeshStandardNodeMaterial, Node } from 'three/webgpu';

/** The geometry attribute naming the set array layer a quad draws (the scene sets it per column) */
export const LAYER_ATTRIBUTE = 'setLayer';

/** What {@link applyLiteSurface} shades from: a `LITE` layer's two samples and its fields */
export type LiteSurfaceParts = {
  /** The `albedoRough` sample: RGB albedo × AO, A roughness */
  albedoRough: Node<'vec4'>;
  /** The `normalHeight` sample: RG the normal's X and Y, B height */
  normalHeight: Node<'vec4'>;
  /** The set's `tint` (linear) */
  tint: Node<'vec3'>;
  normalStrength: Node<'float'>;
  roughnessScale: Node<'float'>;
};

/**
 * The `textureSets` scene's `LITE` shading, one graph for both inputs (p303 Phase 3's exit: a set
 * array's layer must render as the set does through `{ textureSet }`): albedo × AO × `tint`,
 * roughness from the albedo's alpha × `roughnessScale`, the normal's X and Y at `normalStrength`
 * (three reconstructs Z), metalness 0.
 * @param material the material `setup` builds
 * @param parts the layer's samples and surface fields
 */
export const applyLiteSurface = (material: MeshStandardNodeMaterial, parts: LiteSurfaceParts) => {
  material.metalnessNode = float(0);
  material.colorNode = parts.albedoRough.rgb.mul(parts.tint);
  material.roughnessNode = parts.albedoRough.a.mul(parts.roughnessScale);
  const normal = normalMap(parts.normalHeight.rgb, parts.normalStrength);
  normal.unpackNormalMode = NormalRGPacking;
  material.normalNode = normal;
};
