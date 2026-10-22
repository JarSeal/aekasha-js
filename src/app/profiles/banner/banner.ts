import * as THREE from 'three/webgpu';
import {
  createMeshEntity,
  createSceneAppLooper,
  existsOrThrow,
  getECSWorld,
  getGeometry,
  getMaterial,
  saveBufferGeometry,
} from 'aekasha';

// #region banner-scene (shown in the Hub: hub/pages/examples/embed/)
/** Radians per second about the turn's axis */
const TURN_SPEED = 0.25;

// Reused every frame: a looper shouldn't allocate. setTransform copies the rotation it's given.
const axis = new THREE.Vector3(0.3, 1, 0.15).normalize();
const turn = new THREE.Quaternion();
const nextRotation = new THREE.Quaternion();
const patch = { rot: nextRotation };

/**
 * The banner embed's scene, the smallest build an embed can be: a dodecahedron (Plato's solid of
 * the aether) made in code, no loader and no feature. The camera, the light and the material come
 * from the scene JSON; the background stays transparent, so the page shows through.
 */
export const scene = async () => {
  // Registered once: a later visit finds it by its id
  const geo =
    getGeometry('bannerDodecahedron') ??
    saveBufferGeometry(new THREE.DodecahedronGeometry(1), { id: 'bannerDodecahedron' });
  const entityId = createMeshEntity({
    geo,
    mat: existsOrThrow(getMaterial('bannerAether'), 'No bannerAether material.'),
    rotation: { x: 0.4, y: 0.3, z: 0 },
  });

  // Turns it slowly: an app looper runs every frame while the scene is current and the app plays
  // (a mount's pause() stops it)
  const world = getECSWorld();
  createSceneAppLooper((delta) => {
    const rotation = world.getRotation(entityId);
    if (!rotation) return;
    nextRotation.copy(rotation).multiply(turn.setFromAxisAngle(axis, TURN_SPEED * delta));
    world.setTransform(entityId, patch);
  });
};
// #endregion banner-scene
