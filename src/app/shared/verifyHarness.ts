import * as THREE from 'three/webgpu';
import { texture, uv } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node, TextureNode } from 'three/webgpu';
import {
  existsOrThrow,
  getActiveCamera,
  getAllTextures,
  getGeneratedAppData,
  getRenderer,
  isWebGPURenderer,
  loadScene,
} from 'aekasha';
import type { TextureProps } from 'aekasha';

// The verification scenes' shared helpers (assetCompare, textureArrays, textureAtlases): the TSL
// shim's real types, frame waits, the expected-error checks and the readouts their results hold.

/** three/tsl's `texture`, with the real types (the shim types it loosely) */
export const sampleTexture = texture as unknown as (
  tex: THREE.Texture,
  uvNode: Node
) => TextureNode;

/** three/tsl's `uv()`, with the real type */
export const meshUv = uv as unknown as () => Node<'vec2'>;

/** Resolves after `count` animation frames (the next one for 1) */
export const nextFrames = (count = 1) =>
  new Promise<void>((resolve) => {
    let left = count;
    const step = () => (--left <= 0 ? resolve() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });

/** An error's message, or the thrown value as a string */
export const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** Runs `fn`, expecting it to throw (or reject): the error's message, or a failure note */
export const expectError = async (fn: () => unknown) => {
  try {
    await fn();
    return 'FAILED: did not throw';
  } catch (error) {
    return getErrorMessage(error);
  }
};

/** Runs `fn`, expecting it to throw at once: the error's message, or a failure note */
export const expectSyncError = (fn: () => unknown) => {
  try {
    fn();
    return 'FAILED: did not throw';
  } catch (error) {
    return getErrorMessage(error);
  }
};

/** The renderer's backend, as the results record it */
export const getBackendName = () => (isWebGPURenderer() ? 'WebGPU' : 'WebGL2');

/** The bytes three counts for `texture` in `renderer.info` (the GPU memory tab's figure: a
 * compressed texture at its uploaded size), or undefined until it was first drawn */
export const getCountedGpuBytes = (tex: THREE.Texture) => {
  // Not in three's types: the per-object sizes behind `renderer.info.memory`
  const info = getRenderer()?.info as unknown as { memoryMap?: WeakMap<object, unknown> };
  const bytes = info?.memoryMap?.get(tex);
  return typeof bytes === 'number' ? bytes : undefined;
};

/** A texture asset's gathered props (`*.texture.json`, `*.textureArray.json`) by its id */
export const getGeneratedTextureProps = (id: string) => {
  // The gathered data types only its scenes: the sections are the gatherer's output
  const textures = getGeneratedAppData().textures as Record<string, TextureProps> | undefined;
  return existsOrThrow(textures?.[id], `No gathered texture "${id}".`);
};

/** A point on the plane `z` in CSS px on the page, through the active camera */
export const projectToScreen = (x: number, y: number, z: number) => {
  const camera = existsOrThrow(getActiveCamera(), 'No active camera.');
  const canvas = existsOrThrow(getRenderer(), 'No renderer.').domElement;
  const point = new THREE.Vector3(x, y, z).project(camera);
  const rect = canvas.getBoundingClientRect();
  return {
    x: rect.left + ((point.x + 1) / 2) * rect.width,
    y: rect.top + ((1 - point.y) / 2) * rect.height,
  };
};

/** The handles every scene's `window` object has, to drive it from the console */
export const getHarnessHandles = () => ({
  /** The registered textures' ids (what a scene exit released) */
  getTextureIds: () => Object.keys(getAllTextures()),
  /** Loads another scene: the scene's exit runs */
  leaveTo: (sceneId: string) => loadScene({ sceneId }),
});
