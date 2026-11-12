import { mix, step, uv, vec3 } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { MeshBasicNodeMaterial, Node } from 'three/webgpu';
// The shim's texture node: its sample takes the shim's uv()
import type { TextureNode } from 'three/tsl';

// three/tsl's `uv()`, with the real type (the shim's is loose)
const meshUv = uv as unknown as () => Node<'vec2'>;

/**
 * The graph of `p302ChannelMat.material.json`, the object-form texture refs' check (p302 D4):
 * `albedo` is `{ "texture": "testTexture" }`, the texture node a bare id makes, and `mask` is
 * `{ "texture": "testTexture", "channel": "r" }`, its sample's red channel. The left half shows
 * the texture, the right half its red channel in grey, both at the same uv, so the halves meet.
 */
export const setup = (
  inputs: { albedo: TextureNode; mask: Node<'float'> },
  material: MeshBasicNodeMaterial
) => {
  const isRight = step(0.5, meshUv().x);
  material.colorNode = mix(inputs.albedo.sample(uv()).rgb, vec3(inputs.mask), isRight);
};
