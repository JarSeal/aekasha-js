// What the LOD selection measures (docs/plans/_DONE_p348_ecs-lod-selection.md): the camera's
// terms, an entity's world position and scale, its screen size. The selection (LodSystem.ts) and
// the debug tools (the overlay and the LOD window, through measureLodEntity / getLodWorldSphere)
// share this code, so they can't drift apart.
import * as THREE from 'three/webgpu';
import type { ECSWorld } from '../../kernel/ecs/ECS';
import type { ComponentData } from '../../kernel/ecs/ECSCoreComponents';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import type { IComponentStorage } from '../../kernel/ecs/ECSComponentStorage';
import { getActiveCamera, getMainCamera } from '../../kernel/camera/Camera';
import { getLodBias, getLodDebugOptions } from './LodSettings';
import type { LodData } from './LodTypes';

/**
 * A camera's terms for the screen size: worldRadius × k / distance (perspective) or
 * worldRadius × k (orthographic), `k` including the global bias.
 * @internal
 */
export type CameraTerms = { k: number; isOrtho: boolean; position: THREE.Vector3 };

/**
 * Computes a camera's terms into `out`. False for a camera that is neither perspective nor
 * orthographic.
 * @internal
 */
export const computeCameraTerms = (camera: THREE.Camera, out: CameraTerms) => {
  if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
    const cam = camera as THREE.PerspectiveCamera;
    out.k = cam.zoom / Math.tan(THREE.MathUtils.DEG2RAD * cam.fov * 0.5);
    out.isOrtho = false;
  } else if ((camera as THREE.OrthographicCamera).isOrthographicCamera) {
    const cam = camera as THREE.OrthographicCamera;
    out.k = (2 * cam.zoom) / (cam.top - cam.bottom);
    out.isOrtho = true;
  } else {
    return false;
  }
  out.k *= getLodBias();
  camera.updateWorldMatrix(true, false);
  out.position.setFromMatrixPosition(camera.matrixWorld);
  return true;
};

/**
 * A component type's storage, as `world.getStorage` returns it.
 * @internal
 */
export type StorageOf<K extends ComponentType> = IComponentStorage<ComponentData[K]>;

/**
 * Writes the world position the selection measures the entity from into `out` and returns its
 * largest scale (-1: nothing to measure). A target's entity (LodTarget) reads its Transform, which
 * is in world space. A mesh directly under the scene (the usual case) reads the local transform
 * object3DSyncSystem wrote, which is the world one; nested, the world matrix. An InstancedMesh
 * measures from its bounds' centre.
 * @internal
 */
export const measureEntity = (
  entityId: number,
  lod: LodData,
  object3Ds: StorageOf<(typeof ComponentType)['OBJECT3D']>,
  transforms: StorageOf<(typeof ComponentType)['TRANSFORM']>,
  out: THREE.Vector3
) => {
  if (lod._target) {
    const transform = transforms.get(entityId);
    if (!transform) return -1;
    out.copy(transform.position);
    const { x, y, z } = transform.scale;
    return Math.max(Math.abs(x), Math.abs(y), Math.abs(z));
  }
  const obj = object3Ds.get(entityId)?.value;
  if (!obj) return -1;
  if (lod._center) {
    obj.updateWorldMatrix(true, false);
    out.copy(lod._center).applyMatrix4(obj.matrixWorld);
    return obj.matrixWorld.getMaxScaleOnAxis();
  }
  if (!obj.parent || !obj.parent.parent) {
    out.copy(obj.position);
    const { x, y, z } = obj.scale;
    return Math.max(Math.abs(x), Math.abs(y), Math.abs(z));
  }
  obj.updateWorldMatrix(true, false);
  out.setFromMatrixPosition(obj.matrixWorld);
  return obj.matrixWorld.getMaxScaleOnAxis();
};

/**
 * The screen size of a sphere of `worldRadius` at `center`, with the global bias (not the
 * entity's).
 * @internal
 */
export const getScreenSize = (center: THREE.Vector3, worldRadius: number, terms: CameraTerms) => {
  if (terms.isOrtho) return worldRadius * terms.k;
  const distance = center.distanceTo(terms.position);
  return distance > 0 ? (worldRadius * terms.k) / distance : Infinity;
};

/**
 * The camera the selection measures against: the main camera, or the active one with the
 * `useActiveCamera` debug option (`setLodDebugOptions`).
 * For the selection, the LOD overlay and entity windows.
 * @internal
 */
export const getLodSelectionCamera = () =>
  getLodDebugOptions().useActiveCamera ? getActiveCamera() : getMainCamera();

/**
 * What the selection measures for an entity, from {@link measureLodEntity}.
 * @internal
 */
export type LodMeasure = {
  /** The world position the distance is measured from. */
  center: THREE.Vector3;
  /** Level 0's bounding radius in world space. */
  worldRadius: number;
  /** From the camera to `center`. */
  distance: number;
  /** What the selection compares with the levels' `screenSize`: the global bias and the
   * definition's `bias` included. */
  screenSize: number;
  /** screenSize = worldRadius × k / distance (perspective) or worldRadius × k (orthographic), both
   * biases included. */
  k: number;
  isOrtho: boolean;
};

/**
 * The sphere the selection measures a `LOD` entity by, in world space (level 0's bounds), without
 * the camera terms: for the debug overlay's per-entity loop. False when there is nothing to
 * measure.
 * @param lod its `LOD` data
 * @param out written in place
 */
export const getLodWorldSphere = (
  entityId: number,
  lod: LodData,
  world: ECSWorld,
  out: THREE.Sphere
) => {
  if (lod._levels.length === 0) return false;
  const maxScale = measureEntity(
    entityId,
    lod,
    world.getStorage(ComponentType.OBJECT3D),
    world.getStorage(ComponentType.TRANSFORM),
    out.center
  );
  if (maxScale < 0) return false;
  out.radius = lod.radius * maxScale;
  return true;
};

const _measureTerms: CameraTerms = { k: 0, isOrtho: false, position: new THREE.Vector3() };

/**
 * Measures a `LOD` entity the way the selection does, against {@link getLodSelectionCamera} now:
 * for the debug tools (the overlay and the LOD window). Writes into `out`; false when there is
 * nothing to measure (no `LOD`, no levels, no mesh or Transform, no usable camera).
 * @internal
 * @param out written in place
 */
export const measureLodEntity = (entityId: number, world: ECSWorld, out: LodMeasure) => {
  const lod = world.getComponent(entityId, ComponentType.LOD);
  if (!lod || lod._levels.length === 0) return false;
  const camera = getLodSelectionCamera();
  if (!camera || !computeCameraTerms(camera, _measureTerms)) return false;
  const maxScale = measureEntity(
    entityId,
    lod,
    world.getStorage(ComponentType.OBJECT3D),
    world.getStorage(ComponentType.TRANSFORM),
    out.center
  );
  if (maxScale < 0) return false;
  const bias = lod.def.bias ?? 1;
  out.worldRadius = lod.radius * maxScale;
  out.distance = out.center.distanceTo(_measureTerms.position);
  out.screenSize = getScreenSize(out.center, out.worldRadius, _measureTerms) * bias;
  out.k = _measureTerms.k * bias;
  out.isOrtho = _measureTerms.isOrtho;
  return true;
};
