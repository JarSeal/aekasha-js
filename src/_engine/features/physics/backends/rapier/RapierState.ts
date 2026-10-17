// The Rapier backend (p614 D7): the Physics API's backend contract (EngineAPIType) on Rapier, the
// one backend. EngineRapier.ts is the module the facade and the worker load (backends/Engines.ts),
// and re-exports the contract from these modules: this one (the state they share, a leaf),
// RapierEvents, RapierShapes, RapierBodies, RapierColliders, RapierJoints, RapierWorld and
// proxies/ (the API objects).

import type Rapier from '@dimforge/rapier3d-compat';
import type { Collider, RigidBody } from '@dimforge/rapier3d-compat';
import type { RigidBodyAPI } from '../../types/PhysicsBodyTypes';
import type { ColliderAPI } from '../../types/PhysicsColliderTypes';
import type { PhysRotation, PhysVector } from '../../types/PhysicsCommonTypes';
import type { JointAPI } from '../../types/PhysicsJointTypes';
import type { PhysicsQueryObserver } from '../../types/PhysicsQueryTypes';
import type { EngineColliderProxyAPI } from './proxies/EngineColliderProxyAPI';
import type { EngineRigidBodyProxyAPI } from './proxies/EngineRigidBodyProxyAPI';

/**
 * The state the backend's modules share: a leaf module, so none of them can read it before it
 * exists. Each field says which module writes it.
 * @internal
 */
export const backend: {
  /** Rapier's module, set by init() (RapierWorld.ts) before anything else runs. */
  RAPIER: typeof Rapier;
  /** The current world (RapierWorld.ts; a restored snapshot replaces it), or a no-op stub. */
  world: Rapier.World;
  /** Whether the debug-env warnings are on (init()). */
  isDebugEnvironment: boolean;
  /** The world's event queue, made by the first collider with active events (RapierColliders.ts)
   * and freed with the world. */
  eventQueue: Rapier.EventQueue | undefined;
  /** The query observer (stats and debug helpers), MAIN_THREAD only; see setQueryObserver. */
  queryObserver: PhysicsQueryObserver | null;
  /** Told the id of every body moved by setTranslation/setRotation, MAIN_THREAD only; see
   * setBodyMovedObserver. */
  bodyMovedObserver: ((rigidBodyId: number) => void) | null;
} = {
  RAPIER: undefined as unknown as typeof Rapier,
  world: { step: () => {} } as Rapier.World,
  isDebugEnvironment: false,
  eventQueue: undefined,
  queryObserver: null,
  bodyMovedObserver: null,
};

// The maps by running id (next*Id in RapierBodies.ts, RapierColliders.ts and RapierJoints.ts).
// Running ids are never reset, not even by deleteWorld(): physics' scene hooks recreate the world
// on every scene load (resetPhysicsWorld), and a stale id from the previous world (e.g. a late
// delete) must never match a body/collider/joint of the new one.

/**
 * Each live body's Rapier handle, by running id.
 * @internal
 */
export const rigidBodies = new Map<number, number>();
/**
 * Each live collider's Rapier handle, by running id.
 * @internal
 */
export const colliders = new Map<number, number>();
/**
 * Each live joint's Rapier handle, by running id.
 * @internal
 */
export const joints = new Map<number, number>();
/**
 * Each live body's API object, by running id.
 * @internal
 */
export const rigidBodyAPIs = new Map<number, RigidBodyAPI>();
/**
 * Each live collider's API object, by running id.
 * @internal
 */
export const colliderAPIs = new Map<number, ColliderAPI>();
/**
 * Each live joint's API object, by running id.
 * @internal
 */
export const jointAPIs = new Map<number, JointAPI>();
/**
 * Each live collider's running id, by Rapier handle: the reverse of `colliders`, needed because
 * getColliderAPI() is handed Rapier's own raw collider handles (e.g. from event queue drains,
 * raycast/contact-pair query results) — those are Rapier's internal handle values, not our
 * running ids, so colliderAPIs (keyed by id) can't be looked up with them directly.
 * @internal
 */
export const handleToColliderId = new Map<number, number>();
/**
 * Each live joint's running id, by Rapier handle: the reverse of `joints`, needed for the same
 * reason as handleToColliderId — deleteRigidBody reaps attached joint handles via Rapier's own
 * forEachJointHandleAttachedToRigidBody.
 * @internal
 */
export const handleToJointId = new Map<number, number>();

/**
 * A collider of a detached body, as it was when detached (see detachRigidBody).
 * @internal
 */
export type DetachedCollider = {
  api: EngineColliderProxyAPI;
  /** The shape the collider was created with (Rapier caches it on the collider) */
  shape: Rapier.Shape;
  translation: Rapier.Vector;
  rotation: Rapier.Rotation;
  friction: number;
  restitution: number;
  frictionCombineRule: Rapier.CoefficientCombineRule;
  restitutionCombineRule: Rapier.CoefficientCombineRule;
  isSensor: boolean;
  enabled: boolean;
  collisionGroups: number;
  solverGroups: number;
  activeEvents: Rapier.ActiveEvents;
  activeHooks: Rapier.ActiveHooks;
  activeCollisionTypes: Rapier.ActiveCollisionTypes;
  contactForceEventThreshold: number;
  contactSkin: number;
};

/**
 * A body of the REMOVED physics tier (p352) and its colliders: their state, read when detached,
 * and their proxies, which keep their ids and come back with them (reattachRigidBody).
 * @internal
 */
export type DetachedBody = {
  api: EngineRigidBodyProxyAPI;
  translation: Rapier.Vector;
  rotation: Rapier.Rotation;
  linvel: Rapier.Vector;
  angvel: Rapier.Vector;
  isSleeping: boolean;
  gravityScale: number;
  linearDamping: number;
  angularDamping: number;
  dominanceGroup: number;
  isCcdEnabled: boolean;
  softCcdPrediction: number;
  additionalSolverIterations: number;
  userForce: Rapier.Vector;
  userTorque: Rapier.Vector;
  userData: unknown;
  colliders: DetachedCollider[];
};
/**
 * The detached bodies (the REMOVED tier), by running id: outside the live maps, so nothing
 * iterates or finds them.
 * @internal
 */
export const detachedBodies = new Map<number, DetachedBody>();

/**
 * Get Rapier.RigidBody with RigidBodyAPI or id
 * @internal
 */
export const getRigidBody = (bodyOrId?: RigidBodyAPI | number): RigidBody | undefined => {
  if (bodyOrId === undefined) return undefined;
  const id = typeof bodyOrId === 'number' ? bodyOrId : bodyOrId.id;
  const handle = rigidBodies.get(id);
  return handle !== undefined ? backend.world.getRigidBody(handle) : undefined;
};

/**
 * Get Rapier.Collider with ColliderAPI or id
 * @internal
 */
export const getCollider = (collOrId?: ColliderAPI | number): Collider | undefined => {
  if (collOrId === undefined) return undefined;
  const id = typeof collOrId === 'number' ? collOrId : collOrId.id;
  const handle = colliders.get(id);
  return handle !== undefined ? backend.world.getCollider(handle) : undefined;
};

/**
 * Get colliderAPI with a Rapier.Collider or a Rapier.Collider.handle
 * @internal
 */
export const getColliderAPI = (collOrHandle?: Collider | number): ColliderAPI | undefined => {
  if (collOrHandle === undefined) return undefined;
  const handle = typeof collOrHandle === 'number' ? collOrHandle : collOrHandle.handle;
  const id = handleToColliderId.get(handle);
  return id !== undefined ? colliderAPIs.get(id) : undefined;
};

/**
 * Get Rapier.ImpulseJoint with JointAPI or id
 * @internal
 */
export const getJoint = (jointOrId?: JointAPI | number): Rapier.ImpulseJoint | undefined => {
  if (jointOrId === undefined) return undefined;
  const id = typeof jointOrId === 'number' ? jointOrId : jointOrId.id;
  const handle = joints.get(id);
  return handle !== undefined ? backend.world.impulseJoints.get(handle) ?? undefined : undefined;
};

/**
 * Get jointAPI with a Rapier.ImpulseJoint or a Rapier.ImpulseJoint.handle
 * @internal
 */
export const getJointAPI = (jointOrHandle?: Rapier.ImpulseJoint | number): JointAPI | undefined => {
  if (jointOrHandle === undefined) return undefined;
  const handle = typeof jointOrHandle === 'number' ? jointOrHandle : jointOrHandle.handle;
  const id = handleToJointId.get(handle);
  return id !== undefined ? jointAPIs.get(id) : undefined;
};

/**
 * Get rigidBodyAPI with an id (running id).
 * @internal
 */
export const getRigidBodyAPIWithId = (id: number): RigidBodyAPI | undefined =>
  rigidBodyAPIs.get(id);

/**
 * Get colliderAPI with an id (running id).
 * @internal
 */
export const getColliderAPIWithId = (id: number): ColliderAPI | undefined => colliderAPIs.get(id);

/**
 * Get jointAPI with an id (running id).
 * @internal
 */
export const getJointAPIWithId = (id: number): JointAPI | undefined => jointAPIs.get(id);

/**
 * Enumerates the ids of all currently-live rigid bodies.
 * @internal
 */
export const getAllRigidBodyIds = (): IterableIterator<number> => rigidBodyAPIs.keys();

/**
 * Sets (or clears, with null) the observer the query methods report to. Only the facade sets it, on
 * the main thread: the worker's engine never has one, so worker queries cost nothing extra.
 * @internal
 */
export const setQueryObserver = (observer: PhysicsQueryObserver | null) => {
  backend.queryObserver = observer;
};

/**
 * Sets (or clears, with null) the observer told about moved bodies. Only the facade sets it, on the
 * main thread, where it brings the move to the body's entity (p352: BODY_STATIC bodies aren't
 * synced per frame). The worker's engine never has one.
 * @internal
 */
export const setBodyMovedObserver = (observer: ((rigidBodyId: number) => void) | null) => {
  backend.bodyMovedObserver = observer;
};

/**
 * A plain copy of a vector (a Rapier one included), for state kept past the call.
 * @internal
 */
export const toPlainVec = (v: PhysVector): PhysVector => ({ x: v.x, y: v.y, z: v.z });
/**
 * A plain copy of a rotation (a Rapier one included), for state kept past the call.
 * @internal
 */
export const toPlainRotation = (r: PhysRotation): PhysRotation => ({
  x: r.x,
  y: r.y,
  z: r.z,
  w: r.w,
});
