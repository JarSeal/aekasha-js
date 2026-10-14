import * as THREE from 'three/webgpu';
import {
  createMeshEntity,
  createSceneAppLooper,
  existsOrThrow,
  getECSWorld,
  getMaterial,
  saveBufferGeometry,
} from 'aekasha';

/** Radians per second about the turn's axis */
const TURN_SPEED = 0.25;

// Reused every frame: a looper shouldn't allocate
const axis = new THREE.Vector3(0.3, 1, 0.15).normalize();
const turn = new THREE.Quaternion();

// #region banner-scene (shown in the Hub: hub/pages/examples/embed/)
/**
 * The banner embed's scene (p611 D8), the smallest build an embed can be: a dodecahedron (Plato's
 * solid of the aether) made in code, no loader and no feature. The camera, the light and the
 * material come from the scene JSON; the background stays transparent, so the page shows through.
 */
export const scene = async () => {
  const dodecahedron = new THREE.DodecahedronGeometry(1);
  const geo = saveBufferGeometry(dodecahedron, { id: 'bannerDodecahedron' });
  if (geo !== dodecahedron) dodecahedron.dispose();
  const entityId = createMeshEntity({
    geo,
    mat: existsOrThrow(getMaterial('bannerAether'), 'No bannerAether material.'),
    rotation: { x: 0.4, y: 0.3, z: 0 },
  });

  // Turns it slowly: a scene looper runs every frame while the scene is the current one
  const world = getECSWorld();
  createSceneAppLooper((delta) => {
    const rotation = world.getRotation(entityId);
    if (!rotation) return;
    rotation.multiply(turn.setFromAxisAngle(axis, TURN_SPEED * delta));
    world.setTransform(entityId, { rot: rotation });
  });
};
// #endregion banner-scene
