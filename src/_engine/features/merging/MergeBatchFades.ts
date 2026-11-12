// A batched merge group's LOD fades (docs/plans/_DONE_p375_batched-mesh-batches.md Phase 2 S4): one
// signed fade per instance (`kernel/render/LodFade.ts`' encoding, LOD_FADE_OPAQUE while it isn't
// fading) in a float texture the size of the batch's instance capacity, which the batch's
// dither-enabled material reads at the drawn instance (`batchIndirectIndex`, three's varying) as the
// object's own LOD fade node (`setObjectLodFadeNode`, read in the shadow pass too). Each batch
// builds its own shaders (three keys a batch's build by its matrices texture), so its node can
// read its own texture. Growing the batch swaps the node's texture and its width uniform: one node
// a batch, the same shader code, no new pipeline (MergeBatch.ts' `growInstances` rebuilds the
// batch's render objects for three's own textures). Part of the lazy batch code.
import * as THREE from 'three/webgpu';
import { batchIndirectIndex, int, ivec2, textureLoad, uniform } from 'three/tsl';
import { LOD_FADE_OPAQUE, setObjectLodFadeNode } from '../../kernel/render/LodFade';

/**
 * A batch's fades: the texture and its data, one float per instance id, and the node's texture and
 * width inputs (swapped when it grows).
 * @internal
 */
export type BatchFades = {
  texture: THREE.DataTexture;
  data: Float32Array;
  textureNode: { value: THREE.Texture };
  width: { value: number };
};

/**
 * Makes a batch's fades for `capacity` instances (its `maxInstanceCount`), opaque, and registers
 * their node as the batch's LOD fade (before its first build); or grows `previous` to it, its
 * values kept, its texture disposed and its node reading the new one.
 * @internal
 */
export const createBatchFades = (
  batch: THREE.BatchedMesh,
  capacity: number,
  previous?: BatchFades
): BatchFades => {
  const size = Math.max(Math.ceil(Math.sqrt(capacity)), 1);
  const data = new Float32Array(size * size).fill(LOD_FADE_OPAQUE);
  const texture = new THREE.DataTexture(data, size, size, THREE.RedFormat, THREE.FloatType);
  texture.needsUpdate = true;
  if (previous) {
    data.set(previous.data.subarray(0, Math.min(previous.data.length, data.length)));
    previous.texture.dispose();
    previous.textureNode.value = texture;
    previous.width.value = size;
    return { ...previous, texture, data };
  }
  // The fade at the drawn instance: its texel, by the instance id three's batch node passes on
  const width = uniform(size);
  const id = int(batchIndirectIndex);
  const w = int(width);
  const textureNode = textureLoad(texture, ivec2(id.mod(w), id.div(w)));
  setObjectLodFadeNode(batch, textureNode.x as THREE.Node<'float'>);
  return { texture, data, textureNode, width };
};

/**
 * Sets an instance's signed fade (uploaded with the texture at the next render, only when it
 * changed).
 * @internal
 */
export const setInstanceFade = (fades: BatchFades, instanceId: number, fade: number) => {
  if (fades.data[instanceId] === fade) return;
  fades.data[instanceId] = fade;
  fades.texture.needsUpdate = true;
};
