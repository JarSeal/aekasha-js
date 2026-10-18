import * as THREE from 'three/webgpu';

import { APP_RENDER_SYNC_ORDER, ECSSystemStage } from '../../kernel/loop/SystemStages';
import type { CoreEntityOpts } from '../../schemas/_HelperSchemas';
import { existsOrThrow } from '../../utils/Assert';
import { lerror, lwarn } from '../../utils/Logger';
import { IS_DEBUG_ENV } from '../../kernel/config/Config';
import type { DebugModuleRef } from '../../kernel/config/DebugModules';
import { loadDebugModuleAsync, useDebug } from '../../kernel/config/DebugModules';
import { type ECSWorld, getECSWorld } from '../../kernel/ecs/ECS';
import type { FeatureContext } from '../../kernel/init/Features';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import type { IComponentStorage } from '../../kernel/ecs/ECSComponentStorage';
import {
  createRigidBodyWithColliders,
  createRigidBodyWithCollidersSync,
  deleteRigidBody,
} from './PhysicsBodies';
import type { RigidBodyWithColliders } from './PhysicsBodies';
import { deleteColliders } from './PhysicsColliders';
import {
  onPhysicsTransformReset,
  physicsInterpolationSystem,
  resetPhysicsInterpolationHistory,
} from './PhysicsInterpolation';
import { endPhysicsRayStatsFrame } from './PhysicsQueryStats';
import { setBodyMovedListener } from './PhysicsRegistry';
import { getPhysicsState } from './PhysicsState';
import { getPhysicsSnapshotStepIndex, getPhysicsWriteVisibleStep } from './PhysicsStepping';
import { flushPhysics } from './PhysicsWorld';
import type { RigidBodyAPI, RigidBodyParams } from './types/PhysicsBodyTypes';
import type { ColliderParams } from './types/PhysicsColliderTypes';
import { deriveColliderDimensionsFromMesh } from './ColliderDimensions';
import {
  getCurrentSceneId,
  getRootScene,
  registerOnAllSceneEnters,
} from '../../kernel/scene/Scene';
import { readStatsClock } from '../../utils/StatsClock';

let debugPhysicsDraw: DebugModuleRef<typeof import('./debug/_dbg__PhysicsDebugDraw')> | null = null;

/**
 * Installs the physics entities' side (the physics feature's install): the transform reset
 * listener, the moved-body listener, the `TAG_IS_PHYSICS_OBJECT` delete hook, and `world`'s
 * physics → transform sync, interpolation and ray stats systems (that world only: the default
 * one).
 * @internal
 */
export const installPhysicsEntities = (ctx: FeatureContext, world: ECSWorld) => {
  ctx.registerTransformResetListener(onPhysicsTransformReset);
  setBodyMovedListener(onBodyMoved);
  ctx.registerComponentHooks(ComponentType.TAG_IS_PHYSICS_OBJECT, {
    onDeleteEntity: (entityId, w) => {
      const body = getPhysicsEntityBody(w, entityId);
      if (body) {
        const owner = bodyOwners.get(body.id);
        if (owner?.world === w && owner.entityId === entityId) bodyOwners.delete(body.id);
      }
      // onDeleteEntity is synchronous; disposal is fire-and-forget (WORKER_THREAD mode
      // has no synchronous delete path, see disposePhysicsEntity).
      disposePhysicsEntity(entityId, w).catch((err) =>
        lerror(`Failed to dispose physics entity ${entityId}.`, err)
      );
      resetPhysicsInterpolationHistory(w, entityId);
    },
  });
  world.addSystem(
    ECSSystemStage.APP_POST_PHYSICS,
    'physicsToTransformSystem',
    physicsToTransformSystem
  );
  world.addSystem(
    ECSSystemStage.APP_RENDER_SYNC,
    'physicsInterpolationSystem',
    physicsInterpolationSystem,
    APP_RENDER_SYNC_ORDER.POSE_PRODUCERS
  );
  // Next to Raycast.ts's rayCastFrameEndSystem (same order), so both ray stats end the same frame
  world.addSystem(
    ECSSystemStage.LATE_MAIN,
    'physicsRayStatsFrameEndSystem',
    () => endPhysicsRayStatsFrame(readStatsClock()),
    -1000
  );
};

/**
 * Debug only: loads and installs the per-entity collider wireframes (_dbg__PhysicsDebugDraw.ts:
 * its ECS hooks and system; nothing runs until an entity gets a DEBUG_PHYSICS_WIREFRAME
 * component) and syncs their master visibility on every scene enter.
 * @internal
 */
export const registerPhysicsWireframeDebugAsync = async () => {
  debugPhysicsDraw = await loadDebugModuleAsync(() => import('./debug/_dbg__PhysicsDebugDraw'));
  const draw = useDebug(debugPhysicsDraw);
  // Only with the module (the loader returns null outside the debug env)
  if (!draw) return;
  draw._installPhysicsWireframes();
  registerOnAllSceneEnters('physicsWireframeMasterVisibilitySync', () => {
    const sceneId = getCurrentSceneId();
    if (sceneId) useDebug(debugPhysicsDraw)?.syncWireframeMasterVisibilityFromLS(sceneId);
  });
};

/**
 * Debug only: loads the physics determinism probe (_dbg__PhysicsDeterminism.ts). Must run
 * before the first scene load, so `?physicsProbe=N` also catches the first scene enter.
 * @internal
 */
export const registerPhysicsDeterminismProbe = async () => {
  const probe = await loadDebugModuleAsync(() => import('./debug/_dbg__PhysicsDeterminism'));
  useDebug(probe)?._initPhysicsDeterminismProbe();
};

/** createPhysicsEntity() calls still in flight, so a scene load can wait for them even when the
 * scene code didn't await them (see settlePendingPhysicsEntities). */
const pendingPhysicsEntityCreates = new Set<Promise<number>>();

/**
 * Resolves once every createPhysicsEntity() call made so far has finished, including ones
 * started while waiting (e.g. a character created after its mesh loads), and the physics side
 * has handled everything sent before that (flushPhysics). Physics' scene hooks (`entered`) await
 * this before they release the scene-load stepping hold, so fire-and-forget creates still start
 * on step 0.
 * @internal
 */
export const settlePendingPhysicsEntities = async () => {
  while (pendingPhysicsEntityCreates.size) {
    await Promise.allSettled([...pendingPhysicsEntityCreates]);
  }
  await flushPhysics();
};

/** createPhysicsEntity's entity options: CoreEntityOpts plus the physics ones, which apply to a
 * `target` entity too. */
export type PhysicsEntityOpts = CoreEntityOpts & {
  /** Code only: the entity's simulation tier follows its world's distance policy
   * (PhysicsTierPolicy.ts's setPhysicsTierPolicy, p352). DYNAMIC bodies only. */
  tierPolicy?: boolean;
};

/**
 * Creates a physics entity: an optional rigid body and its colliders, in the bucket its body
 * type and visual call for (BODY_STATIC / BODY_DYNAMIC_VISUAL / BODY_DYNAMIC_HEADLESS), and
 * resolves with its entity id. A collider without its dimensions takes them from the target
 * mesh's `createGeometry` params (a `BOX` from the box's width, height and depth).
 * Rejects with a `PhysicsCapacityError` (PhysicsBodies.ts) when a `WORKER_THREAD` world's
 * transform buffer is full (`AppConfig.physics.maxBodies`; `FIXED` bodies take no slot), and
 * with the backend's error when a body or collider can't be made (eg. a `TRIMESH` without
 * indices). Then nothing of it exists: a new entity is deleted, an existing `target` entity is
 * left as it was.
 * @param colliderParams the colliders, attached to the body when there is one
 * @param rigidBodyParams the body; none makes the colliders alone (static, in no bucket)
 * @param target an `Object3D` (a new entity gets it as its OBJECT3D and adds it to the root
 * scene unless `entityOpts.doNotAddToScene`), or the id of an existing entity (eg. from
 * `createMeshEntity`) to add the physics components to: its OBJECT3D, if any, picks the
 * visual bucket, and a body without a `translation` starts at its TRANSFORM. None makes a new
 * entity without a visual
 * @param entityOpts the new entity's options (for a `target` id only `tierPolicy` applies)
 * @param ecsWorld the world; the default one when left out
 * @remarks An entity deleted while its `WORKER_THREAD` create is in flight (a scene exit) gets
 * nothing: what the create made is deleted again, and the promise resolves with the deleted
 * entity's id. Check `world.isAlive(id)` after the await before using it.
 * @example
 * ```ts
 * import { createGeometry, createMaterial, createMeshEntity } from 'aekasha';
 * import { createPhysicsEntity } from 'aekasha/physics';
 *
 * const position = { x: 0, y: 5, z: 0 };
 * const geo = createGeometry({ id: 'ball', type: 'SPHERE', params: { radius: 0.4 } });
 * const mat = createMaterial({ id: 'ball', type: 'STANDARD', params: { color: 0xff5533 } });
 * const ballId = createMeshEntity({ geo, mat, position });
 *
 * await createPhysicsEntity(
 *   { type: 'BALL', restitution: 0.6 }, // the radius comes from the sphere
 *   { rigidType: 'DYNAMIC', translation: position },
 *   ballId
 * );
 * ```
 */
export const createPhysicsEntity = (
  colliderParams: ColliderParams | ColliderParams[],
  rigidBodyParams?: RigidBodyParams,
  target?: THREE.Object3D | number,
  entityOpts?: PhysicsEntityOpts,
  ecsWorld?: ECSWorld
): Promise<number> => {
  const creation = createPhysicsEntityNow(
    colliderParams,
    rigidBodyParams,
    target,
    entityOpts,
    ecsWorld
  );
  pendingPhysicsEntityCreates.add(creation);
  const untrack = () => pendingPhysicsEntityCreates.delete(creation);
  creation.then(untrack, untrack);
  return creation;
};

const createPhysicsEntityNow = async (
  colliderParams: ColliderParams | ColliderParams[],
  rigidBodyParams?: RigidBodyParams,
  target?: THREE.Object3D | number,
  entityOpts?: PhysicsEntityOpts,
  ecsWorld?: ECSWorld
): Promise<number> => {
  const world =
    ecsWorld || existsOrThrow(getECSWorld(), 'Could not get ECS world in createPhysicsEntity.');

  const object3D = target instanceof THREE.Object3D ? target : undefined;
  const entityId = typeof target === 'number' ? target : world.createEntity(entityOpts);

  world.addComponent(entityId, ComponentType.TAG_IS_PHYSICS_OBJECT, true);

  const isWorkerThread = getPhysicsState().workerTarget === 'WORKER_THREAD';

  // Attaching to an existing entity (e.g. one already positioned by createMeshEntity) whose
  // rigidBodyParams don't specify their own translation/rotation: the new rigid body must
  // spawn at the entity's CURRENT transform, not Rapier's bare origin default — otherwise the
  // transform-from-rigid-body sync below silently teleports the mesh to (0,0,0) instead of
  // the body inheriting where the mesh already is.
  if (rigidBodyParams && typeof target === 'number' && !rigidBodyParams.translation) {
    const existingTransform = world.getComponent(entityId, ComponentType.TRANSFORM);
    if (existingTransform) {
      rigidBodyParams = {
        ...rigidBodyParams,
        translation: {
          x: existingTransform.position.x,
          y: existingTransform.position.y,
          z: existingTransform.position.z,
        },
        rotation: rigidBodyParams.rotation ?? {
          x: existingTransform.quaternion.x,
          y: existingTransform.quaternion.y,
          z: existingTransform.quaternion.z,
          w: existingTransform.quaternion.w,
        },
      };
    }
  }

  // The legacy system auto-derived a primitive collider's dimensions from its target mesh's
  // geometry whenever the caller didn't specify them explicitly (a ground box created as
  // { type: 'BOX' } against a 200x0.2x200 mesh got a 200x0.2x200 collider "for free"). The new
  // Physics API never grew that fallback — a collider created without explicit hx/hy/hz/radius/
  // halfHeight silently defaults to Rapier's own bare 0.5-ish shape default regardless of the
  // mesh's actual size, which is how a huge visual floor/platform ends up with a tiny invisible
  // collider (or none reachable) and characters fall straight through. This can only run here,
  // main-thread-side, before the params cross the WORKER_THREAD postMessage boundary — a
  // THREE.Mesh/BufferGeometry can't be structured-cloned to derive this worker-side.
  const targetMeshForDerivation =
    object3D ?? world.getComponent(entityId, ComponentType.OBJECT3D)?.value;
  const paramsArray = (Array.isArray(colliderParams) ? colliderParams : [colliderParams]).map(
    (params) => deriveColliderDimensionsFromMesh(params, targetMeshForDerivation)
  );

  // Body and colliders together, requested before this function's first await: in
  // WORKER_THREAD mode the worker then creates entities in call order (as MAIN_THREAD does),
  // and no step can land between a body and its colliders.
  let created: RigidBodyWithColliders;
  try {
    created = isWorkerThread
      ? await createRigidBodyWithColliders(rigidBodyParams, paramsArray)
      : createRigidBodyWithCollidersSync(rigidBodyParams, paramsArray);
  } catch (err) {
    // Refused (PhysicsCapacityError) or failed: nothing physics-side exists, so the entity
    // goes back to how it was handed in (a new one is deleted, an existing one loses the tag).
    world.removeComponent(entityId, ComponentType.TAG_IS_PHYSICS_OBJECT);
    if (typeof target !== 'number') world.deleteEntity(entityId);
    throw err;
  }
  // The create's await: the entity may have been deleted meanwhile (a scene exit's
  // deleteAllPhysicsEntities). What the create made goes again, and nothing lands on the entity
  if (isWorkerThread && !world.isAlive(entityId)) {
    await deleteCreatedBodyAndColliders(created);
    return entityId;
  }
  const { rigidBody: rb, colliders: colls } = created;

  // Primes the worker proxy's cached mass (only known once the colliders exist), so even the
  // very first applyImpulse on this body can be reflected in its read-your-writes linvel.
  if (isWorkerThread && rb && rigidBodyParams?.rigidType === 'DYNAMIC') {
    void rb.mass().catch(() => {});
  }

  const transform = world.getComponent(entityId, ComponentType.TRANSFORM);
  if (rb) {
    transform?.position.set(rb.pos.x, rb.pos.y, rb.pos.z);
    transform?.quaternion.set(rb.rot.x, rb.rot.y, rb.rot.z, rb.rot.w);
  } else if (object3D) {
    transform?.position.copy(object3D.position);
    transform?.quaternion.copy(object3D.quaternion);
    transform?.scale.copy(object3D.scale);
  }
  // Persists the in-place mutation above for TYPED_ARRAY storage mode too
  // (ECS.ts's commitTransform doc comment: MAP mode returns a live reference
  // and doesn't strictly need this, TYPED_ARRAY mode does).
  if (transform) world.commitTransform(entityId, transform);

  if (object3D) {
    if (transform) {
      object3D.position.copy(transform.position);
      object3D.quaternion.copy(transform.quaternion);
      object3D.scale.copy(transform.scale);
      object3D.userData._lastVersion = transform.version;
    }
    world.addComponent(entityId, ComponentType.OBJECT3D, { value: object3D, _lastVersion: -1 });
    // A raw Object3D handed in as `target` (eg. a mesh taken straight off a loaded glTF's
    // children, never through createMeshEntity) may have no parent yet — createMeshEntity's own callers get this
    // for free, but this path doesn't, so without it the object becomes this entity's OBJECT3D
    // component and gets correctly positioned, yet never actually renders (no parent = not part
    // of any scene graph). Mirrors createMeshEntity's own default (rootScene.add unless opted out).
    // Always reparent onto the root scene (THREE.Object3D.add() removes from any existing
    // parent first, so this is a safe no-op for an object already correctly parented there —
    // e.g. one already created via createMeshEntity). This has to be unconditional, not just
    // "if it has no parent yet": a mesh taken off a loaded glTF's temporary root group DOES
    // have a parent (that throwaway group), just not one connected to the real scene graph —
    // checking parent-ness alone would wrongly treat it as already placed.
    if (!entityOpts?.doNotAddToScene) {
      existsOrThrow(getRootScene(), 'Could not find root scene in createPhysicsEntity.').add(
        object3D
      );
    }
  }

  world.addComponent(entityId, ComponentType.COLLIDER, colls);

  const hasVisual = world.hasComponent(entityId, ComponentType.OBJECT3D);
  const isStatic = !rb || rigidBodyParams?.rigidType === 'FIXED';
  if (rb) bodyOwners.set(rb.id, { world, entityId, rigidType: rigidBodyParams!.rigidType });
  if (isStatic) {
    if (rb) world.addComponent(entityId, ComponentType.BODY_STATIC, rb);
  } else {
    const bucket = hasVisual
      ? ComponentType.BODY_DYNAMIC_VISUAL
      : ComponentType.BODY_DYNAMIC_HEADLESS;
    world.addComponent(entityId, bucket, rb!);
  }

  // Data only: the policy's system comes with PhysicsTierPolicy.ts, so an app that never sets a
  // policy pays nothing
  if (entityOpts?.tierPolicy) {
    if (rigidBodyParams?.rigidType === 'DYNAMIC') {
      world.addComponent(entityId, ComponentType.PHYSICS_TIER_POLICY, {
        refusedTier: null,
        placed: false,
      });
    } else if (IS_DEBUG_ENV) {
      lwarn(
        `createPhysicsEntity: tierPolicy ignored for entity ${entityId}: only DYNAMIC bodies have physics tiers.`
      );
    }
  }

  return entityId;
};

/** Deletes what a create made for an entity deleted before it finished (createPhysicsEntityNow).
 * Both deletes are quiet no-ops once the world is gone. */
const deleteCreatedBodyAndColliders = async ({ rigidBody, colliders }: RigidBodyWithColliders) => {
  if (rigidBody) await deleteRigidBody(rigidBody.id);
  else if (colliders.length) await deleteColliders(colliders.map((c) => c.id));
};

/**
 * The entity's body, also while a REMOVED physics tier (p352) has taken its bucket component
 * away (or one in flight back has none yet): the body keeps its id, and deleting it frees what
 * the engine kept of it. Undefined for an entity without a body.
 * @internal
 */
export const getPhysicsEntityBody = (world: ECSWorld, entityId: number): RigidBodyAPI | undefined =>
  world.getRigidBody(entityId) ??
  world.getComponent(entityId, ComponentType.PHYSICS_SIM_TIER)?.body;

/** Deletes the entity's body (with its colliders), or its colliders when it has no body: the
 * TAG_IS_PHYSICS_OBJECT delete hook's, which can't await it. */
const disposePhysicsEntity = async (entityId: number, world: ECSWorld) => {
  const rb = getPhysicsEntityBody(world, entityId);
  // One call either way, so in WORKER_THREAD mode every delete is posted synchronously, in
  // deletion order, ahead of whatever the next scene creates. Deleting a body also deletes
  // its colliders (they're all attached to it, see createPhysicsEntity).
  if (rb) {
    await deleteRigidBody(rb.id);
    return;
  }
  const colls = world.getComponent(entityId, ComponentType.COLLIDER);
  if (colls?.length) await deleteColliders(colls.map((c) => c.id));
};

/**
 * The physics entity of the default world that has `appId` (its `APP_ID.id`), or undefined: also
 * when the entity with the id is no physics entity (`createPhysicsEntity` didn't make it or add to
 * it). An entity counts from the createPhysicsEntity call on, before its body exists.
 * @example
 * ```ts
 * import { getECSWorld } from 'aekasha';
 * import { getPhysicsEntityByAppId } from 'aekasha/physics';
 *
 * const ballId = getPhysicsEntityByAppId('ball');
 * const ball = ballId === undefined ? undefined : getECSWorld().getRigidBody(ballId);
 * ball?.applyImpulse({ x: 0, y: 5, z: 0 }, true);
 * ```
 */
export const getPhysicsEntityByAppId = (appId: string): number | undefined => {
  const world = getECSWorld();
  const entityId = world.getEntityIdByAppId(appId);
  return entityId !== undefined && world.hasComponent(entityId, ComponentType.TAG_IS_PHYSICS_OBJECT)
    ? entityId
    : undefined;
};

/**
 * Deletes every physics-tagged entity in the given world (or the default one): physics' scene
 * hooks (`exit`) run it before the next scene loads. Most physics entities already go with their
 * mesh or group entity's deletion (TAG_IS_PHYSICS_OBJECT's onDeleteEntity hook), but a meshless
 * physics-only entity has no mesh or group for that deletion to reach, so it needs this sweep.
 * @internal
 */
export const deleteAllPhysicsEntities = (ecsWorld?: ECSWorld) => {
  const world = ecsWorld || existsOrThrow(getECSWorld(), 'Could not get ECS world.');
  const ids = [...world.getEntitiesWith(ComponentType.TAG_IS_PHYSICS_OBJECT)];
  for (const id of ids) world.deleteEntity(id);
};

/**
 * The entity of a createPhysicsEntity body and the type it was created as.
 * @internal
 */
export type PhysicsBodyOwner = {
  world: ECSWorld;
  entityId: number;
  rigidType: RigidBodyParams['rigidType'];
};

/** The entity of every createPhysicsEntity body, by body id (body ids are unique across ECS
 * worlds): a moved BODY_STATIC body is synced alone through it, and physics tiers resolve joint
 * groups with it (p352). */
const bodyOwners = new Map<number, PhysicsBodyOwner>();

/**
 * The entity a rigid body was created for by createPhysicsEntity, and its created type;
 * undefined for a body made through the bare Physics API.
 * @internal
 */
export const getPhysicsBodyOwner = (rigidBodyId: number): Readonly<PhysicsBodyOwner> | undefined =>
  bodyOwners.get(rigidBodyId);

/** Per world: BODY_STATIC entities to sync, each until the snapshot step that shows its change
 * (getPhysicsWriteVisibleStep at the change). */
const movedStaticEntities = new WeakMap<ECSWorld, Map<number, number>>();

/**
 * Syncs `entityId`'s BODY_STATIC body into its TRANSFORM in every physicsToTransformSystem until
 * the visible snapshot includes what changed it now (a move, or a physics tier freezing it): in
 * WORKER_THREAD mode the snapshot a frame reads can predate that change.
 * @internal
 */
export const queueStaticBodySync = (world: ECSWorld, entityId: number) => {
  let moved = movedStaticEntities.get(world);
  if (!moved) {
    moved = new Map();
    movedStaticEntities.set(world, moved);
  }
  moved.set(entityId, getPhysicsWriteVisibleStep());
};

/** setBodyMovedListener's listener, called for every moved body: only a BODY_STATIC one (not
 * synced per frame) is queued for its world's next sync. */
const onBodyMoved = (rigidBodyId: number) => {
  const owner = bodyOwners.get(rigidBodyId);
  if (!owner || !owner.world.hasComponent(owner.entityId, ComponentType.BODY_STATIC)) return;
  queueStaticBodySync(owner.world, owner.entityId);
};

// [pos xyz, quat xyzw] scratch every body's pose is read into — Float64 so TRANSFORM gets the
// exact values, and one readPoseInto() per body instead of 7 object-allocating pos/rot reads.
const transformSyncPose = new Float64Array(7);

/** Copies one body's pose into its entity's TRANSFORM, and marks it dirty only when it changed:
 * a sleeping body costs a read and a compare, no object3DSyncSystem copy or spatial churn. */
const syncBodyPose = (world: ECSWorld, entityId: number, rb: RigidBodyAPI) => {
  const p = transformSyncPose;
  const transformStore = world.getTypedTransformStore();
  if (transformStore) {
    const slot = transformStore.getSlot(entityId);
    if (slot === -1) return;
    rb.readPoseInto(p);
    // Exact compares: both sides hold the same float32 values the last sync wrote
    if (
      transformStore.posX[slot] === p[0] &&
      transformStore.posY[slot] === p[1] &&
      transformStore.posZ[slot] === p[2] &&
      transformStore.quatX[slot] === p[3] &&
      transformStore.quatY[slot] === p[4] &&
      transformStore.quatZ[slot] === p[5] &&
      transformStore.quatW[slot] === p[6]
    ) {
      return;
    }
    transformStore.setPosition(slot, p[0], p[1], p[2]);
    transformStore.setQuaternion(slot, p[3], p[4], p[5], p[6]);
    return;
  }

  const transform = world.getComponent(entityId, ComponentType.TRANSFORM);
  if (!transform) return;
  rb.readPoseInto(p);
  const { position: pos, quaternion: q } = transform;
  if (
    pos.x === p[0] &&
    pos.y === p[1] &&
    pos.z === p[2] &&
    q.x === p[3] &&
    q.y === p[4] &&
    q.z === p[5] &&
    q.w === p[6]
  ) {
    return;
  }
  pos.set(p[0], p[1], p[2]);
  q.set(p[3], p[4], p[5], p[6]);
  // Mark as changed so the Render System knows to update the Mesh
  transform.setDirty();
};

/**
 * The physics → TRANSFORM sync (APP_POST_PHYSICS): every BODY_DYNAMIC_VISUAL body's pose into its
 * entity's TRANSFORM, and the queued BODY_STATIC ones (queueStaticBodySync).
 * @internal
 */
export const physicsToTransformSystem = (world: ECSWorld) => {
  // Dynamic/kinematic bodies move every step. BODY_STATIC bodies (created FIXED, or frozen by a
  // STATIC/DISABLED physics tier) don't move under simulation, so they aren't walked (p352): an
  // explicit move (setTranslation/setRotation, eg. an imported level piece snapped into place
  // once) queues its entity through onBodyMoved, and only those are synced here.
  // keys() + get(): destructuring the storage's own iterator allocates a [key, value] array
  // per entry, per frame.
  const dynamicVisuals: IComponentStorage<RigidBodyAPI> = world.getStorage(
    ComponentType.BODY_DYNAMIC_VISUAL
  );
  for (const entityId of dynamicVisuals.keys()) {
    syncBodyPose(world, entityId, dynamicVisuals.get(entityId)!);
  }

  const moved = movedStaticEntities.get(world);
  if (!moved?.size) return;
  const snapshotStep = getPhysicsSnapshotStepIndex();
  for (const [entityId, untilStep] of moved) {
    const rb = world.getComponent(entityId, ComponentType.BODY_STATIC);
    if (rb) syncBodyPose(world, entityId, rb);
    if (!rb || snapshotStep >= untilStep) moved.delete(entityId);
  }
};
