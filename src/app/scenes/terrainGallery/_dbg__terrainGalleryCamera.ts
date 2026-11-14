// The terrain gallery tab's camera moves: the flight to a block (the lists' click) and the pose the
// measurement holds a block in. Both move the scene's own camera (`terrainGalleryCamera`); in the
// debug camera (F1) the view doesn't follow.
import * as THREE from 'three/webgpu';
import {
  cameraLookAtPoint,
  createSceneMainLooper,
  deleteSceneMainLooper,
  getECSWorld,
  getEntityIdByAppId,
} from 'aekasha';
import { BLOCK_SIZE } from './galleryBlocks';
import { TERRAIN_GALLERY_CAMERA_APP_ID, TERRAIN_GALLERY_SCENE_ID } from './terrainGallery';

/** The camera's flight to a block, seconds */
const FLIGHT_SEC = 0.8;
/** Where the camera stops: in front of the block (+z) and above it, looking at its ramp side */
const VIEW_OFFSET = { y: BLOCK_SIZE * 0.6, z: BLOCK_SIZE * 1.05 };
const LOOK_OFFSET = { y: 0.5, z: -BLOCK_SIZE * 0.1 };
/** The measurement's pose: closer and steeper, the block across the canvas's height */
const MEASURE_OFFSET = { y: BLOCK_SIZE * 0.8, z: BLOCK_SIZE * 0.42 };
const MEASURE_LOOK_OFFSET = { y: 0, z: -BLOCK_SIZE * 0.06 };

/** The running flight's looper, deleted when it lands or another starts */
let flightLooper: number | null = null;

/** Smoothstep's ease in and out */
const ease = (t: number) => t * t * (3 - 2 * t);

const getCameraId = () => getEntityIdByAppId(TERRAIN_GALLERY_CAMERA_APP_ID, getECSWorld());

/** Stops a running flight where it is (a new visit starts with none: its loopers went with the
 * scene, `isSceneLeft`) */
export const stopGalleryFlight = (isSceneLeft = false) => {
  if (flightLooper !== null && !isSceneLeft) {
    deleteSceneMainLooper(flightLooper, TERRAIN_GALLERY_SCENE_ID);
  }
  flightLooper = null;
};

/**
 * Flies the scene's camera to a block over `FLIGHT_SEC`: its position and its look-at point eased
 * from where they are. A flight started meanwhile replaces it.
 * @param block the block's centre on the ground
 */
export const flyToGalleryBlock = (block: { x: number; z: number }) => {
  const world = getECSWorld();
  const cameraId = getCameraId();
  if (cameraId === undefined) return;
  const transform = world.getTransform(cameraId);
  const fromPos = transform.position.clone();
  // The current look-at point, as far ahead as the target is
  const toPos = new THREE.Vector3(block.x, VIEW_OFFSET.y, block.z + VIEW_OFFSET.z);
  const toLook = new THREE.Vector3(block.x, LOOK_OFFSET.y, block.z + LOOK_OFFSET.z);
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(transform.rotation);
  const fromLook = fromPos.clone().addScaledVector(forward, fromPos.distanceTo(toLook));
  const pos = new THREE.Vector3();
  const look = new THREE.Vector3();
  let elapsed = 0;

  stopGalleryFlight();
  const looper = createSceneMainLooper((delta) => {
    elapsed = Math.min(FLIGHT_SEC, elapsed + delta);
    const t = ease(elapsed / FLIGHT_SEC);
    pos.lerpVectors(fromPos, toPos, t);
    look.lerpVectors(fromLook, toLook, t);
    world.setTransform(cameraId, { pos });
    cameraLookAtPoint(cameraId, look, world);
    if (elapsed < FLIGHT_SEC || flightLooper !== looper) return;
    deleteSceneMainLooper(looper, TERRAIN_GALLERY_SCENE_ID);
    flightLooper = null;
  }, TERRAIN_GALLERY_SCENE_ID);
  flightLooper = looper < 0 ? null : looper;
};

/**
 * Puts the scene's camera in the measurement's pose over a block at once (a running flight
 * stops).
 * @param block the block's centre on the ground
 * @returns a function that puts the camera back where it was, or null without the camera
 */
export const holdMeasurePose = (block: { x: number; z: number }) => {
  const world = getECSWorld();
  const cameraId = getCameraId();
  if (cameraId === undefined) return null;
  stopGalleryFlight();
  const transform = world.getTransform(cameraId);
  const pos = transform.position.clone();
  const rot = transform.rotation.clone();
  world.setTransform(cameraId, {
    pos: { x: block.x, y: MEASURE_OFFSET.y, z: block.z + MEASURE_OFFSET.z },
  });
  cameraLookAtPoint(
    cameraId,
    { x: block.x, y: MEASURE_LOOK_OFFSET.y, z: block.z + MEASURE_LOOK_OFFSET.z },
    world
  );
  return () => {
    // The scene was left meanwhile: its camera went with it
    if (getCameraId() !== cameraId) return;
    world.setTransform(cameraId, { pos, rot });
  };
};
