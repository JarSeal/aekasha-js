// The dequantization the asset pipeline records for a quantized mesh (i020). Import-free: the
// pipeline writes it in Node without loading three (devTools/engineImports.test.ts keeps it so).

/**
 * Bump on a change to {@link GLTFQuantizationExtras}: a node with another version is imported as
 * it is (its geometry quantized, its dequantization in its transform). In the asset pipeline's
 * cache key of a quantized GLB, so those are built again.
 * @internal
 */
export const GLTF_QUANTIZATION_FORMAT_VERSION = 1;

/**
 * The key of a quantized mesh's dequantization in its node's extras.
 * @internal
 */
export const GLTF_QUANTIZATION_EXTRAS_KEY = 'aekQuantization';

/**
 * Where gltf-transform's `quantize()` put a mesh's dequantization: into the node's own matrix
 * (`NODE`), into a new child node that it moved the mesh into because the node has children or
 * is animated (`PIVOT`: the extras are on that child, its parent is the source's node), or into
 * each GPU instance's matrix (`INSTANCES`, `EXT_mesh_gpu_instancing`).
 * @internal
 */
export type GLTFDequantizationTarget = 'NODE' | 'PIVOT' | 'INSTANCES';

/**
 * A quantized mesh's dequantization, in the extras of a node using it: the quantized positions
 * times `scale`, plus `offset`, are the source's positions in the node's space. Written by the
 * asset pipeline (`devTools/assetPipeline/gltfQuantization.ts`), read by the import's extract.
 * A skinned node gets none (its dequantization is in its inverse bind matrices).
 * @internal
 */
export type GLTFQuantizationExtras = {
  version: number;
  offset: [number, number, number];
  scale: number;
  target: GLTFDequantizationTarget;
};
