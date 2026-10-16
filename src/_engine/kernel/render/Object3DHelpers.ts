// Worker-safe: only three's types, so the assets worker can use these too.
import type * as THREE from 'three/webgpu';

/**
 * The `userData` flag `markDebugHelper` (`aekasha/debug`) sets on a debug helper's root.
 * @internal
 */
export const DEBUG_HELPER_USER_DATA_KEY = 'aekDebugHelper';

/**
 * Whether an object is a debug helper: marked with `markDebugHelper`, a 3D symbol, or one of
 * three's `*Helper`s. Snapshots hide them, the profiler's census counts them apart.
 * @internal
 */
export const isDebugHelperObject = (obj: THREE.Object3D) =>
  Boolean(obj.userData[DEBUG_HELPER_USER_DATA_KEY]) ||
  Boolean(obj.userData.isHelperSymbol) ||
  obj.type.endsWith('Helper');

/** Whether an object is a plain Object3D (eg. an empty), not a mesh, group, light, camera or
 * texture. */
export const isOnlyObject3D = (
  obj: THREE.Object3D | THREE.Mesh | THREE.Group | THREE.Light | THREE.Camera | THREE.Texture
) =>
  'isObject3D' in obj &&
  obj.isObject3D &&
  !('isMesh' in obj) &&
  !('isGroup' in obj) &&
  !('isLight' in obj) &&
  !('isCamera' in obj) &&
  !('isTexture' in obj);
