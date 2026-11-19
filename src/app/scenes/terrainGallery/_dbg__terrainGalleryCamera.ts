// The terrain gallery tab's camera moves: the flight to a block (the lists' click), the presets'
// flyover and the pose the measurement holds a block in. All move the scene's own camera
// (`terrainGalleryCamera`) and its FOV; in the debug camera (F1) the view doesn't follow.
import * as THREE from 'three/webgpu';
import {
  cameraLookAtPoint,
  createSceneMainLooper,
  deleteSceneMainLooper,
  getECSWorld,
  getCameraByAppId,
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

/** The scene camera's FOV (`terrainGalleryCamera.camera.json`): a flight without one eases back
 * to it */
export const GALLERY_DEFAULT_FOV = 50;

/** The running flight's (or flyover's) looper, deleted when it lands or another starts */
let flightLooper: number | null = null;

/** Smoothstep's ease in and out */
const ease = (t: number) => t * t * (3 - 2 * t);

const getCameraId = () => getEntityIdByAppId(TERRAIN_GALLERY_CAMERA_APP_ID, getECSWorld());

const getPerspectiveCamera = () => {
  const camera = getCameraByAppId(TERRAIN_GALLERY_CAMERA_APP_ID);
  return camera instanceof THREE.PerspectiveCamera ? camera : undefined;
};

/** Sets the scene camera's FOV, when it changes (a projection update otherwise every frame) */
const setFov = (camera: THREE.PerspectiveCamera | undefined, fov: number) => {
  if (!camera || camera.fov === fov) return;
  camera.fov = fov;
  camera.updateProjectionMatrix();
};

/** Stops a running flight where it is (a new visit starts with none: its loopers went with the
 * scene, `isSceneLeft`) */
export const stopGalleryFlight = (isSceneLeft = false) => {
  if (flightLooper !== null && !isSceneLeft) {
    deleteSceneMainLooper(flightLooper, TERRAIN_GALLERY_SCENE_ID);
  }
  flightLooper = null;
};

/** A camera pose: where it stands, the point it looks at and its vertical FOV (default
 * {@link GALLERY_DEFAULT_FOV}) */
export type GalleryCameraPose = {
  pos: { x: number; y: number; z: number };
  look: { x: number; y: number; z: number };
  fov?: number;
};

/**
 * An extent's overview: in front of it (+z) and above, looking down at its middle
 * @returns the pose that has the whole extent in view
 */
export const getBoundsPose = (
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number
): GalleryCameraPose => {
  const x = (minX + maxX) / 2;
  const z = (minZ + maxZ) / 2;
  const span = Math.max(maxX - minX, maxZ - minZ);
  return { pos: { x, y: span * 0.7, z: z + span * 0.45 }, look: { x, y: 0, z } };
};

/**
 * Flies the scene's camera to a pose over `FLIGHT_SEC`: its position, its look-at point and its FOV
 * eased from where they are. A flight started meanwhile replaces it.
 * @param pose where the camera ends and what it looks at
 */
export const flyGalleryCamera = (pose: GalleryCameraPose) => {
  const world = getECSWorld();
  const cameraId = getCameraId();
  if (cameraId === undefined) return;
  const transform = world.getTransform(cameraId);
  const fromPos = transform.position.clone();
  const toPos = new THREE.Vector3(pose.pos.x, pose.pos.y, pose.pos.z);
  const toLook = new THREE.Vector3(pose.look.x, pose.look.y, pose.look.z);
  const camera = getPerspectiveCamera();
  const fromFov = camera?.fov ?? GALLERY_DEFAULT_FOV;
  const toFov = pose.fov ?? GALLERY_DEFAULT_FOV;
  // The current look-at point, as far ahead as the target is
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
    setFov(camera, fromFov + (toFov - fromFov) * t);
    if (elapsed < FLIGHT_SEC || flightLooper !== looper) return;
    deleteSceneMainLooper(looper, TERRAIN_GALLERY_SCENE_ID);
    flightLooper = null;
  }, TERRAIN_GALLERY_SCENE_ID);
  flightLooper = looper < 0 ? null : looper;
};

/**
 * Flies the scene's camera to a 12 m block (the lists' click): in front of it and above, looking
 * at its ramp side
 * @param block the block's centre on the ground
 */
export const flyToGalleryBlock = (block: { x: number; z: number }) =>
  flyGalleryCamera({
    pos: { x: block.x, y: VIEW_OFFSET.y, z: block.z + VIEW_OFFSET.z },
    look: { x: block.x, y: LOOK_OFFSET.y, z: block.z + LOOK_OFFSET.z },
  });

/** A flyover's line: along −z at `x`, `height` over `y`, from `fromZ` to `toZ` and again */
export type GalleryFlyover = {
  x: number;
  y: number;
  fromZ: number;
  toZ: number;
  height: number;
  /** Metres a second */
  speed: number;
  fov: number;
};

/** How far ahead of the camera a flyover looks, metres (its pitch: about 15 m down over 60) */
const FLYOVER_LOOK_AHEAD = 60;

/**
 * Starts a flyover: the scene's camera on its line at its speed, looking ahead and down to the
 * ground, back to the start at the end, until another flight (or `stopGalleryFlight`) replaces it
 * @param flyover the line, its speed and the FOV
 */
export const startGalleryFlyover = (flyover: GalleryFlyover) => {
  const world = getECSWorld();
  const cameraId = getCameraId();
  if (cameraId === undefined) return;
  const length = flyover.fromZ - flyover.toZ;
  const pos = new THREE.Vector3(flyover.x, flyover.y + flyover.height, flyover.fromZ);
  const look = new THREE.Vector3(flyover.x, flyover.y, 0);
  let travelled = 0;

  stopGalleryFlight();
  setFov(getPerspectiveCamera(), flyover.fov);
  const looper = createSceneMainLooper((delta) => {
    travelled = (travelled + delta * flyover.speed) % length;
    pos.z = flyover.fromZ - travelled;
    look.z = pos.z - FLYOVER_LOOK_AHEAD;
    world.setTransform(cameraId, { pos });
    cameraLookAtPoint(cameraId, look, world);
  }, TERRAIN_GALLERY_SCENE_ID);
  flightLooper = looper < 0 ? null : looper;
};

/**
 * Puts the scene's camera in a pose at once (a running flight stops), at the pose's FOV
 * @param pose where the camera stands and what it looks at
 * @returns a function that puts the camera back where it was (its FOV too), or null without the
 * camera
 */
export const holdGalleryCameraPose = (pose: GalleryCameraPose) => {
  const world = getECSWorld();
  const cameraId = getCameraId();
  if (cameraId === undefined) return null;
  stopGalleryFlight();
  const transform = world.getTransform(cameraId);
  const pos = transform.position.clone();
  const rot = transform.rotation.clone();
  const camera = getPerspectiveCamera();
  const fov = camera?.fov ?? GALLERY_DEFAULT_FOV;
  world.setTransform(cameraId, { pos: pose.pos });
  cameraLookAtPoint(cameraId, pose.look, world);
  setFov(camera, pose.fov ?? GALLERY_DEFAULT_FOV);
  return () => {
    // The scene was left meanwhile: its camera went with it
    if (getCameraId() !== cameraId) return;
    world.setTransform(cameraId, { pos, rot });
    setFov(camera, fov);
  };
};

/**
 * Puts the scene's camera in the measurement's pose over a block at once (a running flight
 * stops).
 * @param block the block's centre on the ground
 * @returns a function that puts the camera back where it was, or null without the camera
 */
export const holdMeasurePose = (block: { x: number; z: number }) =>
  holdGalleryCameraPose({
    pos: { x: block.x, y: MEASURE_OFFSET.y, z: block.z + MEASURE_OFFSET.z },
    look: { x: block.x, y: MEASURE_LOOK_OFFSET.y, z: block.z + MEASURE_LOOK_OFFSET.z },
  });
