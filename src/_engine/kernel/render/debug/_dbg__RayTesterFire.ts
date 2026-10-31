// The ray testers' fire (p806 D11: out of _dbg__RayTester.ts): each kind's rays cast through the
// code paths gameplay uses (Raycast.ts, the WorldAPI queries), their hits as plain data in
// `testerResults`.
import * as THREE from 'three/webgpu';
import { getCurrentScene, getRootScene } from '../../scene/Scene';
import { getActiveCamera } from '../../camera/Camera';
import { getECSWorld, getEntityIdByAppId } from '../../ecs/ECS';
import { ComponentType } from '../../ecs/ECSCoreComponents';
import { castRayFromDirection, castRayFromPoints, type RayCastOpts } from '../Raycast';
import { getPhysicsWorld, isPhysicsWorldEnabled } from '../../../features/physics/PhysicsState';
import type { RigidBodyAPI } from '../../../features/physics/types/PhysicsBodyTypes';
import type { ColliderAPI } from '../../../features/physics/types/PhysicsColliderTypes';
import type { PhysVector } from '../../../features/physics/types/PhysicsCommonTypes';
import type { PhysRay, QueryFilterFlags } from '../../../features/physics/types/PhysicsQueryTypes';
import { RAY_TESTER_ID_PREFIX, type RayDebugOpts } from '../RayDebugTypes';
import {
  FILTER_FLAG_BITS,
  getPhysicsState,
  getThreeState,
  testerResults,
  type AimedRay,
  type HitEntityInfo,
  type PhysicsHitRow,
  type PhysicsRayFilterFlags,
  type PhysicsRayParams,
  type RayTesterHelperParams,
  type RayTesterResult,
  type ThreeHitRow,
  type ThreeRayParams,
  type Vec3,
} from './_dbg__RayTesterState';

const FILTER_FLAG_KEYS = Object.keys(FILTER_FLAG_BITS) as (keyof PhysicsRayFilterFlags)[];

const scratchVec = new THREE.Vector3();

/** Writes the ray's origin and normalized direction. Returns an error text, or how far the
 * target point is (Infinity outside TARGET_POINT mode). */
const resolveAim = (
  ray: AimedRay,
  origin: THREE.Vector3,
  dir: THREE.Vector3
): { error: string } | { toTarget: number } => {
  const { aim } = ray;
  if (aim.mode === 'CAMERA_FORWARD') {
    const camera = getActiveCamera();
    if (!camera) return { error: 'No active camera' };
    camera.getWorldPosition(origin);
    camera.getWorldDirection(dir);
    return { toTarget: Infinity };
  }
  origin.set(ray.origin.x, ray.origin.y, ray.origin.z);
  let toTarget = Infinity;
  if (aim.mode === 'TARGET_POINT') {
    dir.set(aim.point.x, aim.point.y, aim.point.z).sub(origin);
    toTarget = dir.length();
    if (toTarget === 0) return { error: 'The target point is at the origin' };
  } else {
    dir.set(aim.dir.x, aim.dir.y, aim.dir.z);
    if (dir.lengthSq() === 0) return { error: 'The direction is zero' };
  }
  dir.normalize();
  return { toTarget };
};

/** Writes the active camera's world position into the ray's origin; false without a camera. */
export const setOriginFromCamera = (ray: AimedRay) => {
  const camera = getActiveCamera();
  if (!camera) return false;
  const pos = camera.getWorldPosition(scratchVec);
  ray.origin.x = pos.x;
  ray.origin.y = pos.y;
  ray.origin.z = pos.z;
  return true;
};

const toRayDebugOpts = (id: string, helper: RayTesterHelperParams): RayDebugOpts => ({
  id,
  color: helper.color,
  inactiveColor: helper.inactiveColor,
  width: helper.width,
  holdMs: helper.holdMs,
  depthTest: helper.depthTest === 'KIND' ? undefined : helper.depthTest === 'ON',
});

const getHitEntityInfo = (entityId: number | null): HitEntityInfo => {
  const appIdComp =
    entityId === null ? undefined : getECSWorld().getComponent(entityId, ComponentType.APP_ID);
  return {
    entityId,
    appId: appIdComp?.id ?? null,
    appIdIsFixed: Boolean(appIdComp?.isFixed),
  };
};

const toVec3 = (v: THREE.Vector3Like): Vec3 => ({ x: v.x, y: v.y, z: v.z });

// ----------------------------------------------------------------------------
// Three.js rays
// ----------------------------------------------------------------------------

const scratchOrigin = new THREE.Vector3();
const scratchDir = new THREE.Vector3();
const scratchTo = new THREE.Vector3();
const scratchMatrix = new THREE.Matrix4();
const scratchInstanceMatrix = new THREE.Matrix4();
const scratchNormalMatrix = new THREE.Matrix3();
const scratchNormal = new THREE.Vector3();

/** Casts every ray of the Three.js tester's state into `testerResults.three`. */
export const fireThreeRays = () => {
  const { rays } = getThreeState();
  testerResults.three = rays.map(fireThreeRay);
};

const fireThreeRay = (ray: ThreeRayParams, index: number): RayTesterResult<ThreeHitRow> => {
  const origin = scratchOrigin;
  const dir = scratchDir;
  const aim = resolveAim(ray, origin, dir);
  if ('error' in aim) return { error: aim.error, ray: null, hits: [] };
  const result: RayTesterResult<ThreeHitRow> = {
    ray: { origin: toVec3(origin), dir: toVec3(dir) },
    hits: [],
  };

  const targets = resolveThreeTargets(ray);
  if (typeof targets === 'string') return { ...result, error: targets };

  const opts: RayCastOpts = {
    near: ray.near,
    // The target point ends the ray, unless far is shorter
    far: Math.min(ray.far, aim.toTarget),
    recursive: ray.recursive,
    countInStats: false,
    debug: toRayDebugOpts(`${RAY_TESTER_ID_PREFIX}three_${index}`, ray.helper),
  };
  const hits =
    ray.aim.mode === 'TARGET_POINT'
      ? castRayFromPoints(targets, origin, scratchTo.copy(ray.aim.point), opts)
      : castRayFromDirection(targets, origin, dir, opts);
  result.hits = hits.map(toThreeHitRow);
  return result;
};

/** The ray's target objects, or an error text when there are none. */
const resolveThreeTargets = (ray: ThreeRayParams): THREE.Object3D | THREE.Object3D[] | string => {
  if (ray.target.type === 'CURRENT_SCENE') {
    const targets = collectSceneTargets();
    return targets.length ? targets : 'No current scene';
  }
  const appId = ray.target.appId.trim();
  if (!appId) return 'Enter the target entity app id';
  const world = getECSWorld();
  const entityId = getEntityIdByAppId(appId, world);
  if (entityId === undefined) return `No entity with the app id "${appId}"`;
  const obj = world.getComponent(entityId, ComponentType.OBJECT3D)?.value;
  return obj ?? `The entity "${appId}" has no Object3D`;
};

const sceneTargets: THREE.Object3D[] = [];

/**
 * The current scene's objects. Scene entities are added to the root scene (MeshManager,
 * GroupManager), not to the current scene's group, so these are the root scene's entity-owned
 * children plus that group. The root scene's other children are the debug visuals (light and
 * camera symbols and helpers, grids), which are not entities and must not be hit.
 */
export const collectSceneTargets = () => {
  sceneTargets.length = 0;
  const current = getCurrentScene();
  if (current) sceneTargets.push(current);
  const root = getRootScene();
  if (!root) return sceneTargets;
  for (let i = 0; i < root.children.length; i++) {
    const child = root.children[i];
    if (child !== current && typeof child.userData.entityId === 'number') sceneTargets.push(child);
  }
  return sceneTargets;
};

const toThreeHitRow = (hit: THREE.Intersection): ThreeHitRow => ({
  distance: hit.distance,
  point: toVec3(hit.point),
  normal: getWorldFaceNormal(hit),
  objectName: hit.object.name,
  objectType: hit.object.type,
  instanceId: hit.instanceId ?? null,
  ...getHitEntityInfo(getEntityIdForObject3D(hit.object)),
});

/** The entity an object belongs to: its own `userData.entityId`, or the closest ancestor's (the
 * children of imported models aren't tagged); null when no ancestor belongs to an entity. */
const getEntityIdForObject3D = (obj: THREE.Object3D | null): number | null => {
  for (let o = obj; o; o = o.parent) {
    const entityId = o.userData.entityId;
    if (typeof entityId === 'number') return entityId;
  }
  return null;
};

/** The hit face's normal in world space (the normal matrix, so non-uniform scale is right). */
const getWorldFaceNormal = (hit: THREE.Intersection): Vec3 | null => {
  if (!hit.face) return null;
  const obj = hit.object;
  scratchMatrix.copy(obj.matrixWorld);
  if (hit.instanceId !== undefined && (obj as THREE.InstancedMesh).isInstancedMesh) {
    (obj as THREE.InstancedMesh).getMatrixAt(hit.instanceId, scratchInstanceMatrix);
    scratchMatrix.multiply(scratchInstanceMatrix);
  }
  scratchNormalMatrix.getNormalMatrix(scratchMatrix);
  return toVec3(scratchNormal.copy(hit.face.normal).applyMatrix3(scratchNormalMatrix).normalize());
};

// ----------------------------------------------------------------------------
// Physics rays
// ----------------------------------------------------------------------------

/** Bumped per physics fire and per scene enter: a fire whose serial is stale when its results
 * arrive (eg. the scene changed meanwhile) drops them */
let physicsFireSerial = 0;

/** Drops the results of the physics fires in flight (a scene enter). */
export const dropPhysicsFiresInFlight = () => {
  physicsFireSerial++;
  testerResults.isPhysicsFiring = false;
};

/**
 * Casts every ray of the physics tester's state into `testerResults.physics`. The queries run
 * concurrently, so a multi-ray fire in WORKER_THREAD mode still takes about one frame.
 * `onChange` runs when the fire starts and when its results arrive (not for a stale fire's).
 */
export const firePhysicsRaysAsync = async (onChange: () => void) => {
  if (testerResults.isPhysicsFiring) return;
  const serial = ++physicsFireSerial;
  testerResults.isPhysicsFiring = true;
  onChange();
  let results: RayTesterResult<PhysicsHitRow>[] | null = null;
  try {
    const { rays } = getPhysicsState();
    results = await Promise.all(rays.map(firePhysicsRayAsync));
  } finally {
    // Stale: the scene changed while the queries were in flight (its hook reset the state)
    if (serial === physicsFireSerial) {
      testerResults.physics = results;
      testerResults.isPhysicsFiring = false;
      onChange();
    }
  }
};

type RawPhysicsHit = { collider: ColliderAPI; toi: number; normal: PhysVector | null };

const firePhysicsRayAsync = async (
  ray: PhysicsRayParams,
  index: number
): Promise<RayTesterResult<PhysicsHitRow>> => {
  if (!isPhysicsWorldEnabled()) return { error: 'No physics world', ray: null, hits: [] };
  // Not the shared scratch vectors: the rays are in flight together
  const origin = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const aim = resolveAim(ray, origin, dir);
  if ('error' in aim) return { error: aim.error, ray: null, hits: [] };
  const physRay: PhysRay = { origin: toVec3(origin), dir: toVec3(dir) };
  const result: RayTesterResult<PhysicsHitRow> = { ray: physRay, hits: [] };

  const exclude = resolvePhysicsExclusion(ray);
  if (typeof exclude === 'string') return { ...result, error: exclude };

  // The direction is normalized, so toi is the distance: the target point ends the ray, unless
  // maxToi is shorter
  const maxToi = Math.min(ray.maxToi, aim.toTarget);
  const flags = getFilterFlags(ray.filterFlags);
  const groups = ray.useFilterGroups ? ray.filterGroups : undefined;
  const debug = toRayDebugOpts(`${RAY_TESTER_ID_PREFIX}physics_${index}`, ray.helper);
  const world = getPhysicsWorld();
  const hits: RawPhysicsHit[] = [];
  try {
    if (ray.query === 'CAST_RAY') {
      const hit = await world.castRay(
        physRay,
        maxToi,
        ray.solid,
        flags,
        groups,
        exclude.collider,
        exclude.body,
        undefined,
        debug
      );
      if (hit) hits.push({ collider: hit.collider, toi: hit.timeOfImpact, normal: null });
    } else if (ray.query === 'CAST_RAY_AND_GET_NORMAL') {
      const hit = await world.castRayAndGetNormal(
        physRay,
        maxToi,
        ray.solid,
        flags,
        groups,
        exclude.collider,
        exclude.body,
        undefined,
        debug
      );
      if (hit) hits.push({ collider: hit.collider, toi: hit.timeOfImpact, normal: hit.normal });
    } else {
      await world.intersectionsWithRay(
        physRay,
        maxToi,
        ray.solid,
        (hit) => {
          hits.push({ collider: hit.collider, toi: hit.timeOfImpact, normal: hit.normal });
          return true;
        },
        flags,
        groups,
        exclude.collider,
        exclude.body,
        undefined,
        debug
      );
      // Reported in no particular order
      hits.sort((a, b) => a.toi - b.toi);
    }
  } catch (err) {
    return { ...result, error: `The query failed: ${err instanceof Error ? err.message : err}` };
  }

  const colliderEntities = getColliderEntityMap();
  result.hits = hits.map((hit) => toPhysicsHitRow(hit, physRay, colliderEntities));
  return result;
};

const getFilterFlags = (filterFlags: PhysicsRayFilterFlags): QueryFilterFlags | undefined => {
  let flags = 0;
  for (const key of FILTER_FLAG_KEYS) if (filterFlags[key]) flags |= FILTER_FLAG_BITS[key];
  return flags || undefined;
};

/** The excluded entity's rigid body, or its collider when it has one collider and no body.
 * Returns an error text when the entity can't be excluded. */
const resolvePhysicsExclusion = (
  ray: PhysicsRayParams
): { body?: RigidBodyAPI; collider?: ColliderAPI } | string => {
  const appId = ray.excludeAppId.trim();
  if (!appId) return {};
  const world = getECSWorld();
  const entityId = getEntityIdByAppId(appId, world);
  if (entityId === undefined) return `No entity with the app id "${appId}" to exclude`;
  const body = world.getRigidBody(entityId);
  if (body) return { body };
  const colliders = world.getComponent(entityId, ComponentType.COLLIDER);
  if (colliders?.length === 1) return { collider: colliders[0] };
  return `The entity "${appId}" has no rigid body${colliders?.length ? ` and ${colliders.length} colliders` : ''}: only a body or a single collider can be excluded`;
};

/** Collider id → entity id, from the physics entities' COLLIDER components (there is no
 * reverse lookup: the tester builds it per fire). Colliders without a body are covered too. */
const getColliderEntityMap = () => {
  const map = new Map<number, number>();
  const world = getECSWorld();
  for (const entityId of world.getEntitiesWith(ComponentType.COLLIDER)) {
    const colliders = world.getComponent(entityId, ComponentType.COLLIDER);
    if (!colliders) continue;
    for (let i = 0; i < colliders.length; i++) map.set(colliders[i].id, entityId);
  }
  return map;
};

const toPhysicsHitRow = (
  hit: RawPhysicsHit,
  ray: PhysRay,
  colliderEntities: Map<number, number>
): PhysicsHitRow => ({
  toi: hit.toi,
  point: {
    x: ray.origin.x + ray.dir.x * hit.toi,
    y: ray.origin.y + ray.dir.y * hit.toi,
    z: ray.origin.z + ray.dir.z * hit.toi,
  },
  normal: hit.normal ? toVec3(hit.normal) : null,
  colliderId: hit.collider.id,
  bodyId: hit.collider.parentId ?? null,
  ...getHitEntityInfo(colliderEntities.get(hit.collider.id) ?? null),
});
