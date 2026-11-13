import { attribute, int, uv } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { MeshStandardNodeMaterial, Node, TextureNode } from 'three/webgpu';
import { getTextureSetLayerParams, type TextureSetArrayInput } from 'aekasha/texturesets';
import { applyLiteSurface, LAYER_ATTRIBUTE } from './liteSurface';

/**
 * The graph of the `textureSets` scene's set array materials (`p303ArrayPngMat`,
 * `p303ArrayKtxMat`), p303 Phase 3's exit: `surface` is a `{ textureSetArray }` input in `LITE`,
 * so the bundle holds the two slots' array textures and the layers' params. The layer comes from
 * the mesh's `setLayer` attribute (one per quad, so four quads share one material), and the layer's
 * own `physicalSize`, `tint`, `normalStrength` and `roughnessScale` come from the shared params,
 * shaded by the graph `{ textureSet }` uses (`applyLiteSurface`): each quad must match the quad
 * drawing its set through `p303SetLiteMat`'s graph.
 */
export const setup = (
  inputs: { surface: TextureSetArrayInput },
  material: MeshStandardNodeMaterial
) => {
  const set = inputs.surface;
  // Constant per quad; rounded, since an interpolated 2 may arrive as 1.9999
  const layer = int(
    (attribute(LAYER_ATTRIBUTE, 'float') as unknown as Node<'float'>).round()
  ) as unknown as Node<'int'>;
  const params = getTextureSetLayerParams(set.layerParams, layer);
  const tileUv = (uv() as unknown as Node<'vec2'>).div(params.physicalSize as Node<'vec2'>);
  const sample = (node: TextureNode) => node.sample(tileUv).depth(layer) as unknown as Node<'vec4'>;
  applyLiteSurface(material, {
    albedoRough: sample(set.albedoRough as TextureNode),
    normalHeight: sample(set.normalHeight as TextureNode),
    tint: params.tint as Node<'vec3'>,
    normalStrength: params.normalStrength as Node<'float'>,
    roughnessScale: params.roughnessScale as Node<'float'>,
  });
};
