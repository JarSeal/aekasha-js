// The WORKER_THREAD world: a WorldAPI whose calls are messages to the worker.

import type { RayDebugOpts } from '../../../kernel/render/RayDebugTypes';
import { existsOrThrow } from '../../../utils/Assert';
import { lerror } from '../../../utils/Logger';
import { createRigidBody, deleteRigidBody } from '../PhysicsBodies';
import { createCollider, deleteCollider } from '../PhysicsColliders';
import { createJoint, deleteJoint } from '../PhysicsJoints';
import { messageWorker, messageWorkerAsync, toPlainRot } from '../PhysicsMessaging';
import { getPhysicsQueryObserver } from '../PhysicsQueryStats';
import { colliders, joints, rigidBodies } from '../PhysicsRegistry';
import { facade } from '../PhysicsState';
import { getCollOrRigidId } from '../PhysicsUtils';
import { restorePhysicsSnapshot, takePhysicsSnapshot } from '../PhysicsWorld';
import { PhysicsProtocolType } from '../protocol/PhysicsProtocolType';
import type {
  WorldCastRayAndGetNormalResponse,
  WorldCastRayResponse,
  WorldCastShapeResponse,
  WorldContactPairsResponse,
  WorldGravityResponse,
  WorldIntersectionPairResponse,
  WorldIntersectionPairsWithResponse,
  WorldIntersectionsWithRayResponse,
  WorldLengthUnitResponse,
  WorldNumInternalPgsIterationsResponse,
  WorldNumSolverIterationsResponse,
  WorldTimestepResponse,
} from '../protocol/PhysicsResponses';
import type { RigidBodyAPI, RigidBodyParams } from '../types/PhysicsBodyTypes';
import type {
  ColliderAPI,
  ColliderParams,
  InteractionGroupsAPI,
  ShapeParams,
} from '../types/PhysicsColliderTypes';
import type { PhysRotation, PhysVector } from '../types/PhysicsCommonTypes';
import type { JointAPI, JointParams } from '../types/PhysicsJointTypes';
import type {
  PhysRay,
  QueryFilterFlags,
  RayColliderHitAPI,
  RayColliderIntersectionAPI,
  ShapeCastHitAPI,
} from '../types/PhysicsQueryTypes';
import type { WorldAPI } from '../types/PhysicsWorldTypes';

/** Logs a rejected delete that nobody awaits (WorldProxyAPI's removes). */
const logFailedRemove = (err: unknown) =>
  lerror(`Physics remove failed: ${err instanceof Error ? err.message : String(err)}`);

/**
 * The world in WORKER_THREAD mode: each call is a message to the worker, and the settings' sync
 * getters answer from a local copy.
 * @internal
 */
export class WorldProxyAPI implements WorldAPI {
  restoringWorld: boolean;
  // Local cache for sync getters (updated via worker messages or setters)
  private _cache = {
    gravity: facade.state.gravity,
    timestep: facade.state.timestepRatio,
    lengthUnit: 1.0,
    solverIters: facade.state.solverIterations,
    pgsIters: facade.state.internalPgsIterations,
    ccdSubsteps: 1, // TODO: add this as physicsState value, CONFIG value, and physics debugger tab value
  };

  constructor() {
    this.restoringWorld = false;
  }

  // --- Gravity ---
  async getGravity(): Promise<PhysVector> {
    const res = await messageWorkerAsync<WorldGravityResponse>({
      type: PhysicsProtocolType.WORLD_GET_GRAVITY,
    });
    this._cache.gravity = res.gravity;
    return res.gravity;
  }

  getGravitySync(): PhysVector {
    return this._cache.gravity;
  }

  setGravity(gravity: PhysVector): void {
    this._cache.gravity = gravity;
    messageWorker({
      type: PhysicsProtocolType.WORLD_SET_GRAVITY,
      gravity,
      isOneWay: true,
    });
  }

  // --- Lifecycle & Snapshots ---
  free(): void {
    messageWorker({ type: PhysicsProtocolType.WORLD_FREE });
  }

  async takeSnapshot(): Promise<Uint8Array | undefined> {
    return await takePhysicsSnapshot();
  }

  takeSnapshotSync(): Uint8Array | undefined {
    throw new Error(
      'takeSnapshotSync is not supported in Worker thread mode. Use takeSnapshot(data).'
    );
  }

  async restoreSnapshot(data: Uint8Array): Promise<WorldAPI> {
    return restorePhysicsSnapshot(data);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  restoreSnapshotSync(_data: Uint8Array): WorldAPI {
    throw new Error(
      'restoreSnapshotSync is not supported in Worker thread mode. Use restoreSnapshot(data).'
    );
  }

  propagateModifiedBodyPositionsToColliders(): void {
    messageWorker({ type: PhysicsProtocolType.WORLD_PROPAGATE_POSITIONS });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  step(_eventQueue?: unknown, _hooks?: unknown): void {
    throw new Error('step is not yet implemented in Worker thread mode.');
  }

  debugRender(): { vertices: Float32Array; colors: Float32Array } {
    throw new Error('debugRender is not yet implemented in Worker thread mode.');
  }

  // --- Parameters (Timestep, Units, Solver) ---
  async getTimestep(): Promise<number> {
    const res = await messageWorkerAsync<WorldTimestepResponse>({
      type: PhysicsProtocolType.WORLD_GET_TIMESTEP,
    });
    this._cache.timestep = res.dt;
    return res.dt;
  }
  getTimestepSync(): number {
    return this._cache.timestep;
  }
  setTimestep(dt: number): void {
    this._cache.timestep = dt;
    messageWorker({ type: PhysicsProtocolType.WORLD_SET_TIMESTEP, dt });
  }

  async getLengthUnit(): Promise<number> {
    const res = await messageWorkerAsync<WorldLengthUnitResponse>({
      type: PhysicsProtocolType.WORLD_GET_LENGTH_UNIT,
    });
    this._cache.lengthUnit = res.unitsPerMeter;
    return res.unitsPerMeter;
  }
  getLengthUnitSync(): number {
    return this._cache.lengthUnit;
  }
  setLengthUnit(unitsPerMeter: number): void {
    this._cache.lengthUnit = unitsPerMeter;
    messageWorker({ type: PhysicsProtocolType.WORLD_SET_LENGTH_UNIT, unitsPerMeter });
  }

  async getNumSolverIterations(): Promise<number> {
    const res = await messageWorkerAsync<WorldNumSolverIterationsResponse>({
      type: PhysicsProtocolType.WORLD_GET_SOLVER_ITERS,
    });
    this._cache.solverIters = res.solverIterations;
    return res.solverIterations;
  }
  getNumSolverIterationsSync(): number {
    return this._cache.solverIters;
  }
  setNumSolverIterations(niter: number): void {
    this._cache.solverIters = niter;
    messageWorker({ type: PhysicsProtocolType.WORLD_SET_SOLVER_ITERS, niter });
  }

  async getNumInternalPgsIterations(): Promise<number> {
    const res = await messageWorkerAsync<WorldNumInternalPgsIterationsResponse>({
      type: PhysicsProtocolType.WORLD_GET_PGS_ITERS,
    });
    this._cache.pgsIters = res.internalPgsIterations;
    return res.internalPgsIterations;
  }
  getNumInternalPgsIterationsSync(): number {
    return this._cache.pgsIters;
  }
  setNumInternalPgsIterations(niter: number): void {
    this._cache.pgsIters = niter;
    messageWorker({ type: PhysicsProtocolType.WORLD_SET_PGS_ITERS, niter });
  }

  async getMaxCcdSubsteps(): Promise<number> {
    const res = await messageWorkerAsync<{ substeps: number }>({
      type: PhysicsProtocolType.WORLD_GET_CCD_SUBSTEPS,
    });
    this._cache.ccdSubsteps = res.substeps;
    return res.substeps;
  }
  getMaxCcdSubstepsSync(): number {
    return this._cache.ccdSubsteps;
  }
  setMaxCcdSubstepsSync(substeps: number): void {
    this._cache.ccdSubsteps = substeps;
    messageWorker({ type: PhysicsProtocolType.WORLD_SET_CCD_SUBSTEPS, substeps });
  }

  // --- Factories ---
  async createRigidBody(params: RigidBodyParams): Promise<RigidBodyAPI> {
    return await createRigidBody(params);
  }

  createRigidBodySync(params: RigidBodyParams): RigidBodyAPI {
    if (facade.state.workerTarget === 'MAIN_THREAD') {
      return existsOrThrow(
        facade.engAPI?.createRigidBody(params),
        `Could not create a rigid body ("MAIN_THREAD"). Params: ${JSON.stringify(params)}. Has engineAPI: ${Boolean(facade.engAPI)}`
      );
    } else if (facade.state.workerTarget === 'WORKER_THREAD') {
      const msg =
        'Synchronous creation is not supported in Worker thread mode. Use createRigidBody(params).';
      lerror(msg);
      throw new Error(msg);
    }
    // Should not get here
    const msg = `Unknown facade.state.workerTarget: "${facade.state.workerTarget}".`;
    lerror(msg);
    throw new Error(msg);
  }

  async createCollider(params: ColliderParams, parentId?: number): Promise<ColliderAPI> {
    return await createCollider(params, parentId);
  }

  createColliderSync(params: ColliderParams, parentId?: number): ColliderAPI {
    if (facade.state.workerTarget === 'MAIN_THREAD') {
      return existsOrThrow(
        facade.engAPI?.createCollider(params, parentId),
        `Could not create a collider ("MAIN_THREAD"). Params: ${JSON.stringify(params)}. Has engineAPI: ${Boolean(facade.engAPI)}`
      );
    } else if (facade.state.workerTarget === 'WORKER_THREAD') {
      const msg =
        'Synchronous creation is not supported in Worker thread mode. Use createCollider(params, parent?).';
      lerror(msg);
      throw new Error(msg);
    }
    // Should not get here
    const msg = `Unknown facade.state.workerTarget: "${facade.state.workerTarget}".`;
    lerror(msg);
    throw new Error(msg);
  }

  async createJoint(params: JointParams): Promise<JointAPI> {
    return await createJoint(params);
  }

  createJointSync(params: JointParams): JointAPI {
    if (facade.state.workerTarget === 'MAIN_THREAD') {
      return existsOrThrow(
        facade.engAPI?.createJoint(params),
        `Could not create a joint ("MAIN_THREAD"). Params: ${JSON.stringify(params)}. Has engineAPI: ${Boolean(facade.engAPI)}`
      );
    } else if (facade.state.workerTarget === 'WORKER_THREAD') {
      const msg =
        'Synchronous creation is not supported in Worker thread mode. Use createJoint(params).';
      lerror(msg);
      throw new Error(msg);
    }
    // Should not get here
    const msg = `Unknown facade.state.workerTarget: "${facade.state.workerTarget}".`;
    lerror(msg);
    throw new Error(msg);
  }

  // --- Retrieval ---
  /** Returns the main thread rigid body registry rigidBodyAPI promise.
   * It is suggested to use getRigidBodySync(id) method instead of this
   * as it is synchronous and faster.
   */
  async getRigidBody(id: number): Promise<RigidBodyAPI | undefined> {
    // Checks a local registry Map<number, RigidBodyProxy>
    return rigidBodies.get(id);
  }

  /** Returns the main thread rigid body registry rigidBodyAPI. */
  getRigidBodySync(id: number): RigidBodyAPI | undefined {
    return rigidBodies.get(id);
  }

  /** Returns the main thread collider registry colliderAPI as promise.
   * It is suggested to use getColliderSync(id) method instead of this
   * as it is synchronous and faster.
   */
  async getCollider(id: number): Promise<ColliderAPI | undefined> {
    return colliders.get(id);
  }

  /** Returns the main thread collider registry colliderAPI. */
  getColliderSync(id: number): ColliderAPI | undefined {
    return colliders.get(id);
  }

  /** Returns the main thread joint registry jointAPI as promise.
   * It is suggested to use getJointSync(id) method instead of this
   * as it is synchronous and faster.
   */
  async getJoint(id: number): Promise<JointAPI | undefined> {
    return joints.get(id);
  }

  /** Returns the main thread joint registry jointAPI. */
  getJointSync(id: number): JointAPI | undefined {
    return joints.get(id);
  }

  // --- Removal ---
  // Fire and forget (the WorldAPI's removes return nothing), so a failed delete is logged here
  removeRigidBody(bodyOrId: RigidBodyAPI | number): void {
    const id = typeof bodyOrId === 'number' ? bodyOrId : bodyOrId.id;
    deleteRigidBody(id).catch(logFailedRemove);
  }

  removeCollider(colliderOrId: ColliderAPI | number, wakeUp: boolean): void {
    const id = typeof colliderOrId === 'number' ? colliderOrId : colliderOrId.id;
    deleteCollider(id, wakeUp).catch(logFailedRemove);
  }

  removeJoint(jointOrId: JointAPI | number, wakeUp: boolean): void {
    const id = typeof jointOrId === 'number' ? jointOrId : jointOrId.id;
    deleteJoint(id, wakeUp).catch(logFailedRemove);
  }

  // --- Queries (Raycasting) ---
  // Each query reports to the query observer captured when it was issued: onQuery before the
  // message, onResult when the reply arrives (≥1 frame later). `debug` never crosses to the
  // worker.
  async castRay(
    ray: PhysRay,
    maxToi: number,
    solid: boolean,
    filterFlags?: QueryFilterFlags,
    filterGroups?: InteractionGroupsAPI,
    filterExcludeCollider?: ColliderAPI | number,
    filterExcludeRigidBody?: RigidBodyAPI | number,
    _filterPredicate?: (collider: ColliderAPI) => boolean,
    debug?: RayDebugOpts
  ): Promise<RayColliderHitAPI | null> {
    const observer = getPhysicsQueryObserver();
    const token = observer ? observer.onQuery('CAST_RAY', ray.origin, ray.dir, maxToi, debug) : 0;
    const response = (
      await messageWorkerAsync<WorldCastRayResponse>({
        type: PhysicsProtocolType.WORLD_CAST_RAY,
        ray,
        maxToi,
        solid,
        filterFlags,
        filterGroups,
        filterExcludeCollider: getCollOrRigidId(filterExcludeCollider),
        filterExcludeRigidBody: getCollOrRigidId(filterExcludeRigidBody),
      })
    ).hit;
    const coll = response ? colliders.get(response.collider) : undefined;
    const result = response && coll ? { ...response, collider: coll } : null;
    if (observer) observer.onResult(token, result ? result.timeOfImpact : null, result ? 1 : 0);
    return result;
  }

  castRaySync(): RayColliderHitAPI | null {
    throw new Error('Raycasting must be async in Worker mode.');
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
    _filterPredicate?: (collider: ColliderAPI) => boolean,
    debug?: RayDebugOpts
  ): Promise<ShapeCastHitAPI | null> {
    const observer = getPhysicsQueryObserver();
    const token = observer ? observer.onQuery('CAST_SHAPE', shapePos, shapeVel, maxToi, debug) : 0;
    const response = (
      await messageWorkerAsync<WorldCastShapeResponse>({
        type: PhysicsProtocolType.WORLD_CAST_SHAPE,
        shapePos,
        shapeRot: toPlainRot(shapeRot),
        shapeVel,
        shape,
        targetDistance,
        maxToi,
        stopAtPenetration,
        filterFlags,
        filterGroups,
        filterExcludeCollider: getCollOrRigidId(filterExcludeCollider),
        filterExcludeRigidBody: getCollOrRigidId(filterExcludeRigidBody),
      })
    ).hit;
    const coll = response ? colliders.get(response.collider) : undefined;
    const result = response && coll ? { ...response, collider: coll } : null;
    if (observer) observer.onResult(token, result ? result.timeOfImpact : null, result ? 1 : 0);
    return result;
  }

  castShapeSync(): ShapeCastHitAPI | null {
    throw new Error('Shape casting must be async in Worker mode.');
  }

  async castRayAndGetNormal(
    ray: PhysRay,
    maxToi: number,
    solid: boolean,
    filterFlags?: QueryFilterFlags,
    filterGroups?: InteractionGroupsAPI,
    filterExcludeCollider?: ColliderAPI | number,
    filterExcludeRigidBody?: RigidBodyAPI | number,
    _filterPredicate?: (collider: ColliderAPI) => boolean,
    debug?: RayDebugOpts
  ): Promise<RayColliderIntersectionAPI | null> {
    const observer = getPhysicsQueryObserver();
    const token = observer
      ? observer.onQuery('CAST_RAY_AND_GET_NORMAL', ray.origin, ray.dir, maxToi, debug)
      : 0;
    const intersection = (
      await messageWorkerAsync<WorldCastRayAndGetNormalResponse>({
        type: PhysicsProtocolType.WORLD_CAST_RAY_AND_GET_NORMAL,
        ray,
        maxToi,
        solid,
        filterFlags,
        filterGroups,
        filterExcludeCollider: getCollOrRigidId(filterExcludeCollider),
        filterExcludeRigidBody: getCollOrRigidId(filterExcludeRigidBody),
      })
    ).intersection;
    const coll = intersection ? colliders.get(intersection.collider) : undefined;
    const result = intersection && coll ? { ...intersection, collider: coll } : null;
    if (observer) observer.onResult(token, result ? result.timeOfImpact : null, result ? 1 : 0);
    return result;
  }

  castRayAndGetNormalSync(): RayColliderIntersectionAPI | null {
    throw new Error('Raycasting must be async in Worker mode.');
  }

  // --- Interaction Pairs ---
  async intersectionsWithRay(
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
  ): Promise<void> {
    const observer = getPhysicsQueryObserver();
    const token = observer
      ? observer.onQuery('INTERSECTIONS_WITH_RAY', ray.origin, ray.dir, maxToi, debug)
      : 0;
    const intersections = (
      await messageWorkerAsync<WorldIntersectionsWithRayResponse>({
        type: PhysicsProtocolType.WORLD_INTERSECTIONS_WITH_RAY,
        ray,
        maxToi,
        solid,
        filterFlags,
        filterGroups,
        filterExcludeCollider: getCollOrRigidId(filterExcludeCollider),
        filterExcludeRigidBody: getCollOrRigidId(filterExcludeRigidBody),
      })
    ).intersections;
    let hitCount = 0;
    let firstHitToi = Infinity;
    for (let i = 0; i < intersections.length; i++) {
      const intersectTransfer = intersections[i];
      const collider = colliders.get(intersectTransfer.collider);
      if (!collider) continue;
      hitCount++;
      if (intersectTransfer.timeOfImpact < firstHitToi) {
        firstHitToi = intersectTransfer.timeOfImpact;
      }
      // The worker collects every hit, so `false` (stop) is applied here, as on MAIN_THREAD
      if (callback({ ...intersectTransfer, collider }) === false) break;
    }
    if (observer) observer.onResult(token, hitCount ? firstHitToi : null, hitCount);
  }

  intersectionsWithRaySync(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _ray: PhysRay,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _maxToi: number,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _solid: boolean,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _callback: (intersect: RayColliderIntersectionAPI) => boolean,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _filterFlags?: QueryFilterFlags,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _filterGroups?: InteractionGroupsAPI,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _filterExcludeCollider?: ColliderAPI | number,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _filterExcludeRigidBody?: RigidBodyAPI | number,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _filterPredicate?: (collider: ColliderAPI) => boolean,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _debug?: RayDebugOpts
  ): void {
    throw new Error('Raycasting must be async in Worker mode.');
  }

  async contactPairsWith(
    collider1: ColliderAPI | number,
    f: (collider2: ColliderAPI) => void
  ): Promise<void> {
    const coll1Id = getCollOrRigidId(collider1);
    if (coll1Id === undefined) return;
    const colliderIds = (
      await messageWorkerAsync<WorldContactPairsResponse>({
        type: PhysicsProtocolType.WORLD_CONTACT_PAIRS_WITH,
        colliderId: coll1Id,
      })
    ).colliderIds;
    for (let i = 0; i < colliderIds.length; i++) {
      const coll2 = colliders.get(colliderIds[i]);
      if (coll2) f(coll2);
    }
  }

  contactPairsWithSync(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _collider1: ColliderAPI | number,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _f: (collider2: ColliderAPI) => void
  ): void {
    throw new Error('Contact pairing must be async in Worker mode.');
  }

  async intersectionPairsWith(
    collider1: ColliderAPI | number,
    f: (collider2: ColliderAPI) => void
  ): Promise<void> {
    const coll1Id = getCollOrRigidId(collider1);
    if (coll1Id === undefined) return;
    const colliderIds = (
      await messageWorkerAsync<WorldIntersectionPairsWithResponse>({
        type: PhysicsProtocolType.WORLD_INTERSECTION_PAIRS_WITH,
        colliderId: coll1Id,
      })
    ).colliderIds;
    for (let i = 0; i < colliderIds.length; i++) {
      const coll2 = colliders.get(colliderIds[i]);
      if (coll2) f(coll2);
    }
  }

  intersectionPairsWithSync(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _collider1: ColliderAPI | number,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _f: (collider2: ColliderAPI) => void
  ): void {
    throw new Error('Intersection pairing must be async in Worker mode.');
  }

  async intersectionPair(
    collider1: ColliderAPI | number,
    collider2: ColliderAPI | number
  ): Promise<boolean> {
    return (
      await messageWorkerAsync<WorldIntersectionPairResponse>({
        type: PhysicsProtocolType.WORLD_INTERSECTION_PAIR,
        colliderId1: typeof collider1 === 'number' ? collider1 : collider1.id,
        colliderId2: typeof collider2 === 'number' ? collider2 : collider2.id,
      })
    ).isIntersecting;
  }

  intersectionPairSync(): boolean {
    throw new Error('Intersection pairing must be async in Worker mode.');
  }
}
