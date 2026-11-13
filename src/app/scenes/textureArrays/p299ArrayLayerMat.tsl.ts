import { mix, step, uv } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { MeshBasicNodeMaterial, Node } from 'three/webgpu';

// three/tsl's `uv()`, with the real type (the shim's is loose)
const meshUv = uv as unknown as () => Node<'vec2'>;

/**
 * The graph of `p299ArrayLayerMat.material.json`, the texture array layer input's check (p299
 * D5): `byName` is `{ "textureArray": "p299TestArray", "layer": "l1" }` and `byIndex` the same
 * layer by its index, each already sampled at the mesh's UV by the engine. The left half shows the
 * one, the right half the other: the same layer, so the halves meet.
 */
export const setup = (
  inputs: { byName: Node<'vec4'>; byIndex: Node<'vec4'> },
  material: MeshBasicNodeMaterial
) => {
  material.colorNode = mix(inputs.byName, inputs.byIndex, step(0.5, meshUv().x));
};
