import type { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

let meshoptDecoder: Promise<typeof MeshoptDecoder> | null = null;

/**
 * Returns three's meshopt decoder (EXT_meshopt_compression), imported on the first call, so apps
 * without meshopt-compressed files never download it. A failed import (a flaky network) rejects
 * the calls waiting for it and is tried again by the next call. (The assets worker's GLTF job
 * module imports it statically: that module itself loads on the worker's first GLTF job.)
 */
export const getMeshoptDecoder = () =>
  (meshoptDecoder ??= import('three/addons/libs/meshopt_decoder.module.js').then(
    ({ MeshoptDecoder }) => MeshoptDecoder,
    (err: unknown) => {
      meshoptDecoder = null;
      throw err;
    }
  ));
