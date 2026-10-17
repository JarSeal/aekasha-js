// The Rapier backend's world API object (both targets: on WORKER_THREAD, the worker's).

import type Rapier from '@dimforge/rapier3d-compat';
import type { Collider } from '@dimforge/rapier3d-compat';
import type { RigidBodyAPI, RigidBodyParams } from '../../../types/PhysicsBodyTypes';
import type {
  ColliderAPI,
  ColliderParams,
  InteractionGroupsAPI,
  ShapeParams,
} from '../../../types/PhysicsColliderTypes';
import type { PhysRotation, PhysVector } from '../../../types/PhysicsCommonTypes';
import type { EventQueue, PhysicsHooks } from '../../../types/PhysicsEventTypes';
import type { JointAPI, JointParams } from '../../../types/PhysicsJointTypes';
import type {
  PhysRay,
  QueryFilterFlags,
  RayColliderHitAPI,
  RayColliderIntersectionAPI,
  ShapeCastHitAPI,
} from '../../../types/PhysicsQueryTypes';
import type { WorldAPI } from '../../../types/PhysicsWorldTypes';
import type { RayDebugOpts } from '../../../../../kernel/render/RayDebugTypes';
import { createRigidBody, deleteRigidBody } from '../RapierBodies';
import { createCollider, deleteCollider } from '../RapierColliders';
import { drainAndDispatchEvents } from '../RapierEvents';
import { createJoint, deleteJoint } from '../RapierJoints';
import { paramsToShape } from '../RapierShapes';
import {
  backend,
  getCollider,
  getColliderAPI,
  getColliderAPIWithId,
  getJointAPIWithId,
  getRigidBody,
  getRigidBodyAPIWithId,
} from '../RapierState';

/**
 * The world as a {@link WorldAPI} on Rapier's world (`backend.world`). Its async forms run their
 * `*Sync` twins.
 * @internal
 */
export class EngineWorldProxyAPI implements WorldAPI {
  restoringWorld: boolean = false;

  /** The world's API object; createWorld and restoreSnapshot make one per world. */
  constructor() {}

  // --- Gravity ---
  getGravitySync(): PhysVector {
    return { x: backend.world.gravity.x, y: backend.world.gravity.y, z: backend.world.gravity.z };
  }
  async getGravity(): Promise<PhysVector> {
    return this.getGravitySync();
  }
  setGravity(gravity: PhysVector): void {
    backend.world.gravity = new backend.RAPIER.Vector3(gravity.x, gravity.y, gravity.z);
  }

  // --- Lifecycle ---
  free(): void {
    backend.world.free();
  }

  // --- Snapshots ---
  takeSnapshotSync(): Uint8Array | undefined {
    return backend.world.takeSnapshot();
  }
  async takeSnapshot(): Promise<Uint8Array | undefined> {
    return this.takeSnapshotSync();
  }

  restoreSnapshotSync(data: Uint8Array): WorldAPI {
    this.restoringWorld = true;
    backend.world = backend.RAPIER.World.restoreSnapshot(data);
    // Note: In Rapier, you usually need to re-initialize your local ID maps
    // after a snapshot if the handles changed.
    this.restoringWorld = false;
    return this;
  }
  async restoreSnapshot(data: Uint8Array): Promise<WorldAPI> {
    return this.restoreSnapshotSync(data);
  }

  // --- Stepping & Propagation ---
  step(_eventQueue?: EventQueue, hooks?: PhysicsHooks): void {
    backend.world.step(backend.eventQueue, hooks as Rapier.PhysicsHooks | undefined);
    drainAndDispatchEvents();
  }

  debugRender(
    filterFlags?: QueryFilterFlags,
    filterPredicate?: (collider: ColliderAPI) => boolean
  ): { vertices: Float32Array; colors: Float32Array } {
    const rapierFilterPredicate = filterPredicate
      ? (collider: Collider) => {
          const colliderAPI = getColliderAPI(collider.handle);
          return colliderAPI ? filterPredicate(colliderAPI) : false;
        }
      : undefined;
    return backend.world.debugRender(filterFlags, rapierFilterPredicate);
  }

  propagateModifiedBodyPositionsToColliders(): void {
    backend.world.propagateModifiedBodyPositionsToColliders();
  }

  // --- Parameters ---
  getTimestepSync(): number {
    return backend.world.timestep;
  }
  async getTimestep(): Promise<number> {
    return this.getTimestepSync();
  }
  setTimestep(dt: number): void {
    backend.world.timestep = dt;
  }

  getLengthUnitSync(): number {
    return backend.world.lengthUnit;
  }
  async getLengthUnit(): Promise<number> {
    return this.getLengthUnitSync();
  }
  setLengthUnit(unitsPerMeter: number): void {
    backend.world.lengthUnit = unitsPerMeter;
  }

  getNumSolverIterationsSync(): number {
    return backend.world.numSolverIterations;
  }
  async getNumSolverIterations(): Promise<number> {
    return this.getNumSolverIterationsSync();
  }
  setNumSolverIterations(niter: number): void {
    backend.world.numSolverIterations = niter;
  }

  getNumInternalPgsIterationsSync(): number {
    return backend.world.numInternalPgsIterations;
  }
  async getNumInternalPgsIterations(): Promise<number> {
    return this.getNumInternalPgsIterationsSync();
  }
  setNumInternalPgsIterations(niter: number): void {
    backend.world.numInternalPgsIterations = niter;
  }

  getMaxCcdSubstepsSync(): number {
    return backend.world.maxCcdSubsteps;
  }
  async getMaxCcdSubsteps(): Promise<number> {
    return this.getMaxCcdSubstepsSync();
  }
  setMaxCcdSubstepsSync(substeps: number): void {
    backend.world.maxCcdSubsteps = substeps;
  }

  // --- Factories (the create functions of RapierBodies, RapierColliders and RapierJoints) ---
  createRigidBodySync(params: RigidBodyParams): RigidBodyAPI {
    return createRigidBody(params);
  }
  async createRigidBody(params: RigidBodyParams): Promise<RigidBodyAPI> {
    return this.createRigidBodySync(params);
  }

  createColliderSync(params: ColliderParams, parentId?: number): ColliderAPI {
    return createCollider(params, parentId);
  }
  async createCollider(params: ColliderParams, parentId?: number): Promise<ColliderAPI> {
    return this.createColliderSync(params, parentId);
  }

  createJointSync(params: JointParams): JointAPI {
    return createJoint(params);
  }
  async createJoint(params: JointParams): Promise<JointAPI> {
    return this.createJointSync(params);
  }

  // --- Retrieval ---
  getRigidBodySync(id: number): RigidBodyAPI | undefined {
    return getRigidBodyAPIWithId(id);
  }
  async getRigidBody(id: number): Promise<RigidBodyAPI | undefined> {
    return this.getRigidBodySync(id);
  }

  getColliderSync(id: number): ColliderAPI | undefined {
    return getColliderAPIWithId(id);
  }
  async getCollider(id: number): Promise<ColliderAPI | undefined> {
    return this.getColliderSync(id);
  }

  getJointSync(id: number): JointAPI | undefined {
    return getJointAPIWithId(id);
  }
  async getJoint(id: number): Promise<JointAPI | undefined> {
    return this.getJointSync(id);
  }

  // --- Removal ---
  removeRigidBody(bodyOrId: RigidBodyAPI | number): void {
    const id = typeof bodyOrId === 'number' ? bodyOrId : bodyOrId.id;
    deleteRigidBody(id);
  }

  removeCollider(colliderOrId: ColliderAPI | number, wakeUp: boolean): void {
    const id = typeof colliderOrId === 'number' ? colliderOrId : colliderOrId.id;
    deleteCollider(id, wakeUp);
  }

  removeJoint(jointOrId: JointAPI | number, wakeUp: boolean): void {
    const id = typeof jointOrId === 'number' ? jointOrId : jointOrId.id;
    deleteJoint(id, wakeUp);
  }

  // --- Queries ---
  // Only the *Sync forms report to the query observer: the async forms delegate to them, so
  // they are counted once. The worker's engine never has an observer (see setQueryObserver).
  castRaySync(
    ray: PhysRay,
    maxToi: number,
    solid: boolean,
    filterFlags?: QueryFilterFlags,
    filterGroups?: InteractionGroupsAPI,
    filterExcludeCollider?: ColliderAPI | number,
    filterExcludeRigidBody?: RigidBodyAPI | number,
    _filterPredicate?: (collider: ColliderAPI) => boolean,
    debug?: RayDebugOpts
  ): RayColliderHitAPI | null {
    const observer = backend.queryObserver;
    const token = observer ? observer.onQuery('CAST_RAY', ray.origin, ray.dir, maxToi, debug) : 0;
    const rapierRay = new backend.RAPIER.Ray(ray.origin, ray.dir);
    const hit = backend.world.castRay(
      rapierRay,
      maxToi,
      solid,
      filterFlags,
      filterGroups,
      getCollider(filterExcludeCollider),
      getRigidBody(filterExcludeRigidBody)
    );

    const colliderAPI = hit ? getColliderAPI(hit.collider.handle) : undefined;
    const result =
      hit && colliderAPI ? { collider: colliderAPI, timeOfImpact: hit.timeOfImpact } : null;
    if (observer) observer.onResult(token, result ? result.timeOfImpact : null, result ? 1 : 0);
    return result;
  }
  async castRay(
    ray: PhysRay,
    maxToi: number,
    solid: boolean,
    filterFlags?: QueryFilterFlags,
    filterGroups?: InteractionGroupsAPI,
    filterExcludeCollider?: ColliderAPI | number,
    filterExcludeRigidBody?: RigidBodyAPI | number,
    filterPredicate?: (collider: ColliderAPI) => boolean,
    debug?: RayDebugOpts
  ): Promise<RayColliderHitAPI | null> {
    return this.castRaySync(
      ray,
      maxToi,
      solid,
      filterFlags,
      filterGroups,
      filterExcludeCollider,
      filterExcludeRigidBody,
      filterPredicate,
      debug
    );
  }

  castShapeSync(
    shapePos: PhysVector,
    shapeRot: PhysRotation,
    shapeVel: PhysVector,
    shape: ShapeParams,
    targetDistance: number,
    maxToi: number,
    stopAtPenetration: boolean,
    filterFlags?: QueryFilterFlags,
    filterGroups?: InteractionGroupsAPI,
    filterExcludeCollider?: ColliderAPI | number,
    filterExcludeRigidBody?: RigidBodyAPI | number,
    _filterPredicate?: (collider: ColliderAPI) => boolean,
    debug?: RayDebugOpts
  ): ShapeCastHitAPI | null {
    const observer = backend.queryObserver;
    const token = observer ? observer.onQuery('CAST_SHAPE', shapePos, shapeVel, maxToi, debug) : 0;
    const rapierShape = paramsToShape(shape);
    const hit = backend.world.castShape(
      shapePos,
      shapeRot,
      shapeVel,
      rapierShape,
      targetDistance,
      maxToi,
      stopAtPenetration,
      filterFlags,
      filterGroups,
      getCollider(filterExcludeCollider),
      getRigidBody(filterExcludeRigidBody)
    );

    const colliderAPI = hit ? getColliderAPI(hit.collider.handle) : undefined;
    const result =
      hit && colliderAPI
        ? {
            collider: colliderAPI,
            timeOfImpact: hit.time_of_impact,
            witness1: hit.witness1,
            witness2: hit.witness2,
            normal1: hit.normal1,
            normal2: hit.normal2,
          }
        : null;
    if (observer) observer.onResult(token, result ? result.timeOfImpact : null, result ? 1 : 0);
    return result;
  }
  async castShape(
    shapePos: PhysVector,
    shapeRot: PhysRotation,
    shapeVel: PhysVector,
    shape: ShapeParams,
    targetDistance: number,
    maxToi: number,
    stopAtPenetration: boolean,
    filterFlags?: QueryFilterFlags,
    filterGroups?: InteractionGroupsAPI,
    filterExcludeCollider?: ColliderAPI | number,
    filterExcludeRigidBody?: RigidBodyAPI | number,
    filterPredicate?: (collider: ColliderAPI) => boolean,
    debug?: RayDebugOpts
  ): Promise<ShapeCastHitAPI | null> {
    return this.castShapeSync(
      shapePos,
      shapeRot,
      shapeVel,
      shape,
      targetDistance,
      maxToi,
      stopAtPenetration,
      filterFlags,
      filterGroups,
      filterExcludeCollider,
      filterExcludeRigidBody,
      filterPredicate,
      debug
    );
  }

  castRayAndGetNormalSync(
    ray: PhysRay,
    maxToi: number,
    solid: boolean,
    filterFlags?: QueryFilterFlags,
    filterGroups?: InteractionGroupsAPI,
    filterExcludeCollider?: ColliderAPI | number,
    filterExcludeRigidBody?: RigidBodyAPI | number,
    _filterPredicate?: (collider: ColliderAPI) => boolean,
    debug?: RayDebugOpts
  ): RayColliderIntersectionAPI | null {
    const observer = backend.queryObserver;
    const token = observer
      ? observer.onQuery('CAST_RAY_AND_GET_NORMAL', ray.origin, ray.dir, maxToi, debug)
      : 0;
    const rapierRay = new backend.RAPIER.Ray(ray.origin, ray.dir);
    const inter = backend.world.castRayAndGetNormal(
      rapierRay,
      maxToi,
      solid,
      filterFlags,
      filterGroups,
      getCollider(filterExcludeCollider),
      getRigidBody(filterExcludeRigidBody)
    );

    const colliderAPI = inter ? getColliderAPI(inter.collider.handle) : undefined;
    const result =
      inter && colliderAPI
        ? {
            collider: colliderAPI,
            timeOfImpact: inter.timeOfImpact,
            normal: inter.normal,
            featureType: inter.featureType,
            featureId: inter.featureId,
          }
        : null;
    if (observer) observer.onResult(token, result ? result.timeOfImpact : null, result ? 1 : 0);
    return result;
  }
  async castRayAndGetNormal(
    ray: PhysRay,
    maxToi: number,
    solid: boolean,
    filterFlags?: QueryFilterFlags,
    filterGroups?: InteractionGroupsAPI,
    filterExcludeCollider?: ColliderAPI | number,
    filterExcludeRigidBody?: RigidBodyAPI | number,
    filterPredicate?: (collider: ColliderAPI) => boolean,
    debug?: RayDebugOpts
  ): Promise<RayColliderIntersectionAPI | null> {
    return this.castRayAndGetNormalSync(
      ray,
      maxToi,
      solid,
      filterFlags,
      filterGroups,
      filterExcludeCollider,
      filterExcludeRigidBody,
      filterPredicate,
      debug
    );
  }

  intersectionsWithRaySync(
    ray: PhysRay,
    maxToi: number,
    solid: boolean,
    callback: (intersect: RayColliderIntersectionAPI) => boolean,
    filterFlags?: QueryFilterFlags,
    filterGroups?: InteractionGroupsAPI,
    filterExcludeCollider?: ColliderAPI | number,
    filterExcludeRigidBody?: RigidBodyAPI | number,
    _filterPredicate?: (collider: ColliderAPI) => boolean,
    debug?: RayDebugOpts
  ): void {
    const observer = backend.queryObserver;
    const token = observer
      ? observer.onQuery('INTERSECTIONS_WITH_RAY', ray.origin, ray.dir, maxToi, debug)
      : 0;
    let hitCount = 0;
    let firstHitToi = Infinity;
    backend.world.intersectionsWithRay(
      new backend.RAPIER.Ray(ray.origin, ray.dir),
      maxToi,
      solid,
      (inter) => {
        const colliderAPI = getColliderAPI(inter.collider.handle);
        if (!colliderAPI) return true;
        hitCount++;
        if (inter.timeOfImpact < firstHitToi) firstHitToi = inter.timeOfImpact;
        return callback({
          collider: colliderAPI,
          timeOfImpact: inter.timeOfImpact,
          normal: inter.normal,
          featureType: inter.featureType,
          featureId: inter.featureId,
        });
      },
      filterFlags,
      filterGroups,
      getCollider(filterExcludeCollider),
      getRigidBody(filterExcludeRigidBody)
    );
    if (observer) observer.onResult(token, hitCount ? firstHitToi : null, hitCount);
  }
  async intersectionsWithRay(
    ray: PhysRay,
    maxToi: number,
    solid: boolean,
    callback: (intersect: RayColliderIntersectionAPI) => boolean,
    filterFlags?: QueryFilterFlags,
    filterGroups?: InteractionGroupsAPI,
    filterExcludeCollider?: ColliderAPI | number,
    filterExcludeRigidBody?: RigidBodyAPI | number,
    filterPredicate?: (collider: ColliderAPI) => boolean,
    debug?: RayDebugOpts
  ): Promise<void> {
    this.intersectionsWithRaySync(
      ray,
      maxToi,
      solid,
      callback,
      filterFlags,
      filterGroups,
      filterExcludeCollider,
      filterExcludeRigidBody,
      filterPredicate,
      debug
    );
  }
  // --- Interaction Pairs ---
  contactPairsWithSync(collider1: ColliderAPI | number, f: (collider2: ColliderAPI) => void): void {
    const coll = getCollider(collider1);
    if (!coll) return;
    backend.world.contactPairsWith(coll, (otherColl) => {
      const api = getColliderAPI(otherColl.handle);
      if (api) f(api);
    });
  }
  async contactPairsWith(
    collider1: ColliderAPI | number,
    f: (collider2: ColliderAPI) => void
  ): Promise<void> {
    this.contactPairsWithSync(collider1, f);
  }

  intersectionPairsWithSync(
    collider1: ColliderAPI | number,
    f: (collider2: ColliderAPI) => void
  ): void {
    const coll = getCollider(collider1);
    if (!coll) return;
    backend.world.intersectionPairsWith(coll, (otherColl) => {
      const api = getColliderAPI(otherColl.handle);
      if (api) f(api);
    });
  }
  async intersectionPairsWith(
    collider1: ColliderAPI | number,
    f: (collider2: ColliderAPI) => void
  ): Promise<void> {
    this.intersectionPairsWithSync(collider1, f);
  }

  intersectionPairSync(collider1: ColliderAPI | number, collider2: ColliderAPI | number): boolean {
    const c1 = getCollider(collider1);
    const c2 = getCollider(collider2);
    return c1 && c2 ? backend.world.intersectionPair(c1, c2) : false;
  }
  async intersectionPair(
    collider1: ColliderAPI | number,
    collider2: ColliderAPI | number
  ): Promise<boolean> {
    return this.intersectionPairSync(collider1, collider2);
  }
}
