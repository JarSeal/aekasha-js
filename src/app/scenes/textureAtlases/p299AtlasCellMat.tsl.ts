// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { MeshBasicNodeMaterial, Node } from 'three/webgpu';

/**
 * The graph of `p299AtlasCellMat.material.json`, the atlas cell input's check (p299 D5): `cell` is
 * `{ "atlas": "p299TestAtlas", "slot": "albedo", "cell": "checker" }`, the slot already sampled by
 * the engine at the mesh's UV mapped into the cell's rect, so the colour is the input as it is.
 */
export const setup = (inputs: { cell: Node<'vec4'> }, material: MeshBasicNodeMaterial) => {
  material.colorNode = inputs.cell;
};
