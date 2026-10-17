// The WORKER_THREAD rigid body: poses and velocities read from the transform buffer, every other
// call a message to the worker.

import { existsOrThrow } from '../../../utils/Assert';
import { messageWorker, messageWorkerAsync, toPlainRot } from '../PhysicsMessaging';
import { colliders, getBodyMovedListener } from '../PhysicsRegistry';
import { facade } from '../PhysicsState';
import { getWriteVisibleStep, isWritePending } from '../PhysicsStepping';
import { PhysicsProtocolType } from '../protocol/PhysicsProtocolType';
import type {
  RigidAdditionalSolverIterationsResponse,
  RigidAngularDampingResponse,
  RigidBodyTypeResponse,
  RigidColliderResponse,
  RigidDominanceGroupResponse,
  RigidEffectiveInvMassResponse,
  RigidGetUserDataResponse,
  RigidGravityScaleResponse,
  RigidInvMassResponse,
  RigidInvPrincipalInertiaResponse,
  RigidIsCcdEnabledResponse,
  RigidIsDynamicResponse,
  RigidIsEnabledResponse,
  RigidIsFixedResponse,
  RigidIsKinematicResponse,
  RigidIsMovingResponse,
  RigidIsSleepingResponse,
  RigidIsValidResponse,
  RigidLinearDampingResponse,
  RigidLocalComResponse,
  RigidMassResponse,
  RigidNextRotationResponse,
  RigidNextTranslationResponse,
  RigidNumCollidersResponse,
  RigidPrincipalInertiaLocalFrameResponse,
  RigidPrincipalInertiaResponse,
  RigidSoftCcdPredictionResponse,
  RigidUserForceResponse,
  RigidUserTorqueResponse,
  RigidVelocityAtPointResponse,
  RigidWorldComResponse,
} from '../protocol/PhysicsResponses';
import { RigidBodyTypeAPI } from '../types/PhysicsBodyTypes';
import type { PoseArray, RigidBodyPose, RigidBodyWorkerEngine } from '../types/PhysicsBodyTypes';
import type { ColliderAPI } from '../types/PhysicsColliderTypes';
import type { PhysRotation, PhysVector } from '../types/PhysicsCommonTypes';

type PendingWrite<T> = { value: T; visibleAt: number };

/**
 * A rigid body in WORKER_THREAD mode: its pose and velocities read from the transform buffer by
 * slot (with its own writes until they reach it), every other call a message to the worker.
 * @internal
 */
export class RigidBodyProxyAPI implements RigidBodyWorkerEngine {
  uData: Record<string, unknown> = {};
  isBeingDeleted: boolean = false;
  // @CHORE: add isEnabled cache

  // Read-your-writes: a value set here reaches the worker (and then the transform buffer) only
  // a step or more later, but code like a character controller sets a velocity and reads it back
  // within the same sub-step — as it can on MAIN_THREAD, where Rapier applies it immediately.
  // Until the buffer catches up, the reads below return what was last written instead of the
  // stale buffer value (which would otherwise make e.g. a later setLinvel silently undo an
  // earlier one, or an impulse).
  private pendingPos?: PendingWrite<PhysVector>;
  private pendingRot?: PendingWrite<PhysRotation>;
  private pendingLvel?: PendingWrite<PhysVector>;
  private pendingAvel?: PendingWrite<PhysVector>;
  /** Last known mass, for reflecting applyImpulse locally (refreshed by every mass() call) */
  private cachedMass?: number;
  /** A body without a slot (created FIXED, p352) is never written back: it keeps its pose here
   * instead, its creation pose updated by every setTranslation/setRotation, for good. */
  private staticPose?: RigidBodyPose;

  constructor(
    public id: number,
    private slot: number,
    userData?: Record<string, unknown>,
    /** The pose the worker reported at creation. Read until the first transform write-back
     * that includes this body, which (without SAB) can arrive a frame or more later, and
     * until then the slot holds zeros or a deleted body's last pose. */
    initialPose?: RigidBodyPose,
    /** The type the body was created with (bodyTypeSync's start) */
    private cachedBodyType: RigidBodyTypeAPI = RigidBodyTypeAPI.Dynamic
  ) {
    if (userData) this.uData = userData;
    if (initialPose && slot === -1) {
      this.staticPose = { pos: { ...initialPose.pos }, rot: { ...initialPose.rot } };
    } else if (initialPose) {
      const visibleAt = getWriteVisibleStep();
      this.pendingPos = { value: { ...initialPose.pos }, visibleAt };
      this.pendingRot = { value: { ...initialPose.rot }, visibleAt };
    }
  }

  /** Whether the body holds a transform-buffer slot (every body not created FIXED, unless it's
   * detached by the REMOVED physics tier). */
  get hasSlot() {
    return this.slot !== -1;
  }

  /** Bumped by every detach and reattach (p352), so a reply to an older one is ignored. */
  private attachGeneration = 0;

  /**
   * detachRigidBody: the slot is the worker's to reuse from now on. Returns the
   * detach's generation.
   * @internal
   */
  _detach() {
    this.slot = -1;
    this.pendingPos = undefined;
    this.pendingRot = undefined;
    this.pendingLvel = undefined;
    this.pendingAvel = undefined;
    return ++this.attachGeneration;
  }

  /**
   * reattachRigidBody, before its request. Returns the reattach's generation.
   * @internal
   */
  _beginReattach() {
    return ++this.attachGeneration;
  }

  /**
   * Whether no detach/reattach has been requested since `generation`'s.
   * @internal
   */
  _isAttachGeneration(generation: number) {
    return this.attachGeneration === generation;
  }

  /**
   * reattachRigidBody's reply: the new slot, and its pose read until a transform
   * write-back includes it (as at creation).
   * @internal
   */
  _attach(slot: number, pose: RigidBodyPose) {
    this.slot = slot;
    const visibleAt = getWriteVisibleStep();
    this.pendingPos = { value: { ...pose.pos }, visibleAt };
    this.pendingRot = { value: { ...pose.rot }, visibleAt };
  }

  // Hot path — reads straight from the shared/latest-pushed transform buffer by slot.
  // Returns zeroed defaults if no buffer has arrived yet (before the first step/push).
  get pos(): PhysVector {
    if (this.staticPose) return { ...this.staticPose.pos };
    if (this.pendingPos) {
      if (isWritePending(this.pendingPos.visibleAt)) return { ...this.pendingPos.value };
      this.pendingPos = undefined;
    }
    if (!facade.transformBuffer || this.slot === -1) return { x: 0, y: 0, z: 0 };
    return facade.transformBuffer.getPosition(this.slot);
  }
  get rot(): PhysRotation {
    if (this.staticPose) return { ...this.staticPose.rot };
    if (this.pendingRot) {
      if (isWritePending(this.pendingRot.visibleAt)) return { ...this.pendingRot.value };
      this.pendingRot = undefined;
    }
    if (!facade.transformBuffer || this.slot === -1) return { x: 0, y: 0, z: 0, w: 0 };
    return facade.transformBuffer.getRotation(this.slot);
  }
  readPoseInto(out: PoseArray, offset = 0): void {
    const staticPose = this.staticPose;
    if (staticPose) {
      out[offset] = staticPose.pos.x;
      out[offset + 1] = staticPose.pos.y;
      out[offset + 2] = staticPose.pos.z;
      out[offset + 3] = staticPose.rot.x;
      out[offset + 4] = staticPose.rot.y;
      out[offset + 5] = staticPose.rot.z;
      out[offset + 6] = staticPose.rot.w;
      return;
    }
    if (this.pendingPos && !isWritePending(this.pendingPos.visibleAt)) this.pendingPos = undefined;
    if (this.pendingRot && !isWritePending(this.pendingRot.visibleAt)) this.pendingRot = undefined;
    if (facade.transformBuffer && this.slot !== -1) {
      facade.transformBuffer.readPoseInto(this.slot, out, offset);
    } else {
      // Same zeroed defaults as the pos/rot getters before the first step/push
      for (let i = 0; i < 7; i++) out[offset + i] = 0;
    }
    const p = this.pendingPos?.value;
    if (p) {
      out[offset] = p.x;
      out[offset + 1] = p.y;
      out[offset + 2] = p.z;
    }
    const r = this.pendingRot?.value;
    if (r) {
      out[offset + 3] = r.x;
      out[offset + 4] = r.y;
      out[offset + 5] = r.z;
      out[offset + 6] = r.w;
    }
  }
  readVelocitiesInto(out: PoseArray, offset = 0): void {
    if (this.pendingLvel && !isWritePending(this.pendingLvel.visibleAt)) {
      this.pendingLvel = undefined;
    }
    if (this.pendingAvel && !isWritePending(this.pendingAvel.visibleAt)) {
      this.pendingAvel = undefined;
    }
    if (facade.transformBuffer && this.slot !== -1) {
      facade.transformBuffer.readVelocitiesInto(this.slot, out, offset);
    } else {
      // Same zeroed defaults as the lvel/avel getters before the first step/push
      for (let i = 0; i < 6; i++) out[offset + i] = 0;
    }
    const l = this.pendingLvel?.value;
    if (l) {
      out[offset] = l.x;
      out[offset + 1] = l.y;
      out[offset + 2] = l.z;
    }
    const a = this.pendingAvel?.value;
    if (a) {
      out[offset + 3] = a.x;
      out[offset + 4] = a.y;
      out[offset + 5] = a.z;
    }
  }
  get lvel(): PhysVector {
    if (this.pendingLvel) {
      if (isWritePending(this.pendingLvel.visibleAt)) return { ...this.pendingLvel.value };
      this.pendingLvel = undefined;
    }
    if (!facade.transformBuffer || this.slot === -1) return { x: 0, y: 0, z: 0 };
    return facade.transformBuffer.getLinvel(this.slot);
  }
  get avel(): PhysVector {
    if (this.pendingAvel) {
      if (isWritePending(this.pendingAvel.visibleAt)) return { ...this.pendingAvel.value };
      this.pendingAvel = undefined;
    }
    if (!facade.transformBuffer || this.slot === -1) return { x: 0, y: 0, z: 0 };
    return facade.transformBuffer.getAngvel(this.slot);
  }

  async getUserData(): Promise<Record<string, unknown>> {
    const fetchedUserData = (
      await messageWorkerAsync<RigidGetUserDataResponse>({
        type: PhysicsProtocolType.RIGID_GET_USERDATA,
        rigidBodyId: this.id,
      })
    ).userData;
    this.uData = fetchedUserData;
    return fetchedUserData;
  }
  getUserDataSync(): Record<string, unknown> {
    return this.uData;
  }

  setUserData(userData: Record<string, unknown>, addToExisting?: boolean): void {
    messageWorker({
      type: PhysicsProtocolType.RIGID_SET_USERDATA,
      rigidBodyId: this.id,
      userData,
      addToExisting,
      isOneWay: true,
    });
    if (addToExisting) {
      this.uData = { ...this.uData, ...userData };
    } else {
      this.uData = userData;
    }
  }

  async isValid(): Promise<boolean> {
    return (
      await messageWorkerAsync<RigidIsValidResponse>({
        type: PhysicsProtocolType.RIGID_IS_VALID,
        rigidBodyId: this.id,
      })
    ).isValid;
  }
  isValidSync(): boolean {
    throw new Error(
      'Checking the validity of a rigid body (isValid) cannot be synchronous in the worker mode.'
    );
  }

  lockTranslations(locked: boolean, wakeUp: boolean): void {
    return messageWorker({
      type: PhysicsProtocolType.RIGID_LOCK_TRANSLATIONS,
      rigidBodyId: this.id,
      locked,
      wakeUp,
      isOneWay: true,
    });
  }

  lockRotations(locked: boolean, wakeUp: boolean): void {
    return messageWorker({
      type: PhysicsProtocolType.RIGID_LOCK_ROTATIONS,
      rigidBodyId: this.id,
      locked,
      wakeUp,
      isOneWay: true,
    });
  }

  setEnabledTranslations(
    enableX: boolean,
    enableY: boolean,
    enableZ: boolean,
    wakeUp: boolean
  ): void {
    return messageWorker({
      type: PhysicsProtocolType.RIGID_SET_ENABLED_TRANSLATIONS,
      rigidBodyId: this.id,
      enableX,
      enableY,
      enableZ,
      wakeUp,
      isOneWay: true,
    });
  }

  setEnabledRotations(enableX: boolean, enableY: boolean, enableZ: boolean, wakeUp: boolean): void {
    return messageWorker({
      type: PhysicsProtocolType.RIGID_SET_ENABLED_ROTATIONS,
      rigidBodyId: this.id,
      enableX,
      enableY,
      enableZ,
      wakeUp,
      isOneWay: true,
    });
  }

  async dominanceGroup(): Promise<number> {
    return (
      await messageWorkerAsync<RigidDominanceGroupResponse>({
        type: PhysicsProtocolType.RIGID_DOMINANCE_GROUP,
        rigidBodyId: this.id,
      })
    ).dominanceGroup;
  }
  dominanceGroupSync(): number {
    throw new Error(
      'Getting the dominance group of a rigid body (dominanceGroup) cannot be synchronous in the worker mode.'
    );
  }

  setDominanceGroup(group: number): void {
    return messageWorker({
      type: PhysicsProtocolType.RIGID_SET_DOMINANCE_GROUP,
      rigidBodyId: this.id,
      group,
    });
  }

  async additionalSolverIterations(): Promise<number> {
    return (
      await messageWorkerAsync<RigidAdditionalSolverIterationsResponse>({
        type: PhysicsProtocolType.RIGID_ADDITIONAL_SOLVER_ITERATIONS,
        rigidBodyId: this.id,
      })
    ).additionalIterations;
  }
  additionalSolverIterationsSync(): number {
    throw new Error(
      'Checking the additional solver iteration of a rigid body (additionalSolverIterations) cannot be synchronous in the worker mode.'
    );
  }

  setAdditionalSolverIterations(iters: number): void {
    return messageWorker({
      type: PhysicsProtocolType.RIGID_SET_ADDITIONAL_SOLVER_ITERATIONS,
      rigidBodyId: this.id,
      iters,
    });
  }

  enableCcd(enabled: boolean): void {
    return messageWorker({
      type: PhysicsProtocolType.RIGID_ENABLE_CCD,
      rigidBodyId: this.id,
      enabled,
    });
  }

  setSoftCcdPrediction(distance: number): void {
    return messageWorker({
      type: PhysicsProtocolType.RIGID_SET_SOFT_CCD_PREDICTION,
      rigidBodyId: this.id,
      distance,
    });
  }

  async softCcdPrediction(): Promise<number> {
    return (
      await messageWorkerAsync<RigidSoftCcdPredictionResponse>({
        type: PhysicsProtocolType.RIGID_SOFT_CCD_PREDICTION,
        rigidBodyId: this.id,
      })
    ).softCcdPrediction;
  }
  softCcdPredictionSync(): number {
    throw new Error(
      'Checking the soft CCD prediction number of a rigid body (softCcdPrediction) cannot be synchronous in the worker mode.'
    );
  }

  translation(): PhysVector {
    return this.pos;
  }

  rotation(): PhysRotation {
    return this.rot;
  }

  async nextTranslation(): Promise<PhysVector> {
    return (
      await messageWorkerAsync<RigidNextTranslationResponse>({
        type: PhysicsProtocolType.RIGID_NEXT_TRANSLATION,
        rigidBodyId: this.id,
      })
    ).nextTranslation;
  }
  nextTranslationSync(): PhysVector {
    throw new Error(
      'Checking the next translation of a rigid body (nextTranslation) cannot be synchronous in the worker mode.'
    );
  }

  async nextRotation(): Promise<PhysRotation> {
    return (
      await messageWorkerAsync<RigidNextRotationResponse>({
        type: PhysicsProtocolType.RIGID_NEXT_ROTATION,
        rigidBodyId: this.id,
      })
    ).nextRotation;
  }
  nextRotationSync(): PhysRotation {
    throw new Error(
      'Checking the next rotation of a rigid body (nextRotation) cannot be synchronous in the worker mode.'
    );
  }

  setTranslation(tra: PhysVector, wakeUp: boolean): void {
    if (this.staticPose) {
      const pos = this.staticPose.pos;
      pos.x = tra.x;
      pos.y = tra.y;
      pos.z = tra.z;
    } else {
      this.pendingPos = {
        value: { x: tra.x, y: tra.y, z: tra.z },
        visibleAt: getWriteVisibleStep(),
      };
    }
    getBodyMovedListener()?.(this.id);
    return messageWorker({
      type: PhysicsProtocolType.RIGID_SET_TRANSLATION,
      rigidBodyId: this.id,
      tra,
      wakeUp,
    });
  }

  setLinvel(vel: PhysVector, wakeUp: boolean): void {
    this.pendingLvel = {
      value: { x: vel.x, y: vel.y, z: vel.z },
      visibleAt: getWriteVisibleStep(),
    };
    return messageWorker({
      type: PhysicsProtocolType.RIGID_SET_LINVEL,
      rigidBodyId: this.id,
      vel,
      wakeUp,
    });
  }

  async gravityScale(): Promise<number> {
    return (
      await messageWorkerAsync<RigidGravityScaleResponse>({
        type: PhysicsProtocolType.RIGID_GRAVITY_SCALE,
        rigidBodyId: this.id,
      })
    ).gravityScale;
  }
  gravityScaleSync(): number {
    throw new Error(
      'Checking the gravity scale of a rigid body (gravityScale) cannot be synchronous in the worker mode.'
    );
  }

  setGravityScale(factor: number, wakeUp: boolean): void {
    return messageWorker({
      type: PhysicsProtocolType.RIGID_SET_GRAVITY_SCALE,
      rigidBodyId: this.id,
      factor,
      wakeUp,
    });
  }

  setRotation(rot: PhysRotation, wakeUp: boolean): void {
    if (this.staticPose) {
      this.staticPose.rot = toPlainRot(rot);
    } else {
      this.pendingRot = { value: toPlainRot(rot), visibleAt: getWriteVisibleStep() };
    }
    getBodyMovedListener()?.(this.id);
    return messageWorker({
      type: PhysicsProtocolType.RIGID_SET_ROTATION,
      rigidBodyId: this.id,
      rot: toPlainRot(rot),
      wakeUp,
    });
  }

  setAngvel(vel: PhysVector, wakeUp: boolean): void {
    this.pendingAvel = {
      value: { x: vel.x, y: vel.y, z: vel.z },
      visibleAt: getWriteVisibleStep(),
    };
    return messageWorker({
      type: PhysicsProtocolType.RIGID_SET_ANGVEL,
      rigidBodyId: this.id,
      vel,
      wakeUp,
    });
  }

  setNextKinematicTranslation(t: PhysVector): void {
    return messageWorker({
      type: PhysicsProtocolType.RIGID_SET_NEXT_KINEMATIC_TRANSLATION,
      rigidBodyId: this.id,
      t,
    });
  }

  setNextKinematicRotation(rot: PhysRotation): void {
    return messageWorker({
      type: PhysicsProtocolType.RIGID_SET_NEXT_KINEMATIC_ROTATION,
      rigidBodyId: this.id,
      rot: toPlainRot(rot),
    });
  }

  linvel(): PhysVector {
    return this.lvel;
  }

  async velocityAtPoint(point: PhysVector): Promise<PhysVector> {
    return (
      await messageWorkerAsync<RigidVelocityAtPointResponse>({
        type: PhysicsProtocolType.RIGID_VELOCITY_AT_POINT,
        rigidBodyId: this.id,
        point,
      })
    ).velocityAtPoint;
  }
  velocityAtPointSync(): PhysVector {
    throw new Error(
      'Checking the velocity at point of a rigid body (velocityAtPoint) cannot be synchronous in the worker mode.'
    );
  }

  angvel(): PhysVector {
    return this.avel;
  }

  async mass(): Promise<number> {
    const mass = (
      await messageWorkerAsync<RigidMassResponse>({
        type: PhysicsProtocolType.RIGID_MASS,
        rigidBodyId: this.id,
      })
    ).mass;
    this.cachedMass = mass;
    return mass;
  }
  massSync(): number {
    throw new Error(
      'Checking the mass of a rigid body (mass) cannot be synchronous in the worker mode.'
    );
  }

  async effectiveInvMass(): Promise<PhysVector> {
    return (
      await messageWorkerAsync<RigidEffectiveInvMassResponse>({
        type: PhysicsProtocolType.RIGID_EFFECTIVE_INV_MASS,
        rigidBodyId: this.id,
      })
    ).effectiveInvMass;
  }
  effectiveInvMassSync(): PhysVector {
    throw new Error(
      'Checking the mass of a rigid body (effectiveInvMass) cannot be synchronous in the worker mode.'
    );
  }

  async invMass(): Promise<number> {
    return (
      await messageWorkerAsync<RigidInvMassResponse>({
        type: PhysicsProtocolType.RIGID_INV_MASS,
        rigidBodyId: this.id,
      })
    ).invMass;
  }
  invMassSync(): number {
    throw new Error(
      'Checking the mass of a rigid body (invMass) cannot be synchronous in the worker mode.'
    );
  }

  async localCom(): Promise<PhysVector> {
    return (
      await messageWorkerAsync<RigidLocalComResponse>({
        type: PhysicsProtocolType.RIGID_LOCAL_COM,
        rigidBodyId: this.id,
      })
    ).localCom;
  }
  localComSync(): PhysVector {
    throw new Error(
      'Checking the local com of a rigid body (localCom) cannot be synchronous in the worker mode.'
    );
  }

  async worldCom(): Promise<PhysVector> {
    return (
      await messageWorkerAsync<RigidWorldComResponse>({
        type: PhysicsProtocolType.RIGID_WORLD_COM,
        rigidBodyId: this.id,
      })
    ).worldCom;
  }
  worldComSync(): PhysVector {
    throw new Error(
      'Checking the world com of a rigid body (worldCom) cannot be synchronous in the worker mode.'
    );
  }

  async invPrincipalInertia(): Promise<PhysVector> {
    return (
      await messageWorkerAsync<RigidInvPrincipalInertiaResponse>({
        type: PhysicsProtocolType.RIGID_INV_PRINCIPAL_INERTIA,
        rigidBodyId: this.id,
      })
    ).invPrincipalInertia;
  }
  invPrincipalInertiaSync(): PhysVector {
    throw new Error(
      'Checking the inertia of a rigid body (invPrincipalInertia) cannot be synchronous in the worker mode.'
    );
  }

  async principalInertia(): Promise<PhysVector> {
    return (
      await messageWorkerAsync<RigidPrincipalInertiaResponse>({
        type: PhysicsProtocolType.RIGID_PRINCIPAL_INERTIA,
        rigidBodyId: this.id,
      })
    ).principalInertia;
  }
  principalInertiaSync(): PhysVector {
    throw new Error(
      'Checking the inertia of a rigid body (principalInertia) cannot be synchronous in the worker mode.'
    );
  }

  async principalInertiaLocalFrame(): Promise<PhysRotation> {
    return (
      await messageWorkerAsync<RigidPrincipalInertiaLocalFrameResponse>({
        type: PhysicsProtocolType.RIGID_PRINCIPAL_INERTIA_LOCAL_FRAME,
        rigidBodyId: this.id,
      })
    ).principalInertiaLocalFrame;
  }
  principalInertiaLocalFrameSync(): PhysRotation {
    throw new Error(
      'Checking the inertia of a rigid body (principalInertiaLocalFrame) cannot be synchronous in the worker mode.'
    );
  }

  sleep(): void {
    messageWorker({
      type: PhysicsProtocolType.RIGID_SLEEP,
      rigidBodyId: this.id,
    });
  }

  wakeUp(): void {
    messageWorker({
      type: PhysicsProtocolType.RIGID_WAKE_UP,
      rigidBodyId: this.id,
    });
  }

  async isCcdEnabled(): Promise<boolean> {
    return (
      await messageWorkerAsync<RigidIsCcdEnabledResponse>({
        type: PhysicsProtocolType.RIGID_IS_CCD_ENABLED,
        rigidBodyId: this.id,
      })
    ).isCcdEnabled;
  }
  isCcdEnabledSync(): boolean {
    throw new Error(
      'Checking the CCD of a rigid body (isCcdEnabled) cannot be synchronous in the worker mode.'
    );
  }

  async numColliders(): Promise<number> {
    return (
      await messageWorkerAsync<RigidNumCollidersResponse>({
        type: PhysicsProtocolType.RIGID_NUM_COLLIDERS,
        rigidBodyId: this.id,
      })
    ).numColliders;
  }
  numCollidersSync(): number {
    throw new Error(
      'Checking the number of colliders of a rigid body (numColliders) cannot be synchronous in the worker mode.'
    );
  }

  async collider(i: number): Promise<ColliderAPI> {
    const response = await messageWorkerAsync<RigidColliderResponse>({
      type: PhysicsProtocolType.RIGID_COLLIDER,
      rigidBodyId: this.id,
      index: i,
    });
    return existsOrThrow(
      colliders.get(response.colliderId),
      `Could not find collider in ColliderAPI.collider(${i}).`
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  colliderSync(_i: number): ColliderAPI {
    throw new Error(
      'Getting a collider of a rigid body (colllider) cannot be synchronous in the worker mode.'
    );
  }

  setEnabled(enabled: boolean): void {
    messageWorker({
      type: PhysicsProtocolType.RIGID_SET_ENABLED,
      rigidBodyId: this.id,
      enabled,
    });
  }

  async isEnabled(): Promise<boolean> {
    return (
      await messageWorkerAsync<RigidIsEnabledResponse>({
        type: PhysicsProtocolType.RIGID_IS_ENABLED,
        rigidBodyId: this.id,
      })
    ).isEnabled;
  }
  isEnabledSync(): boolean {
    throw new Error(
      'Checking the enabled state of a rigid body (isEnabled) cannot be synchronous in the worker mode.'
    );
  }

  async bodyType(): Promise<RigidBodyTypeAPI> {
    return (
      await messageWorkerAsync<RigidBodyTypeResponse>({
        type: PhysicsProtocolType.RIGID_BODY_TYPE,
        rigidBodyId: this.id,
      })
    ).bodyType;
  }
  /** The type this body was created with or last set to through `setBodyType` (the only way its
   * type changes), so no worker round trip: what a step's code (eg. a character's sensor) reads
   * synchronously, the same on every target. */
  bodyTypeSync(): RigidBodyTypeAPI {
    return this.cachedBodyType;
  }

  setBodyType(bodyType: RigidBodyTypeAPI, wakeUp: boolean): void {
    this.cachedBodyType = bodyType;
    messageWorker({
      type: PhysicsProtocolType.RIGID_SET_BODY_TYPE,
      rigidBodyId: this.id,
      bodyType,
      wakeUp,
    });
  }

  async isSleeping(): Promise<boolean> {
    return (
      await messageWorkerAsync<RigidIsSleepingResponse>({
        type: PhysicsProtocolType.RIGID_IS_SLEEPING,
        rigidBodyId: this.id,
      })
    ).isSleeping;
  }
  isSleepingSync(): boolean {
    throw new Error(
      'Checking the sleeping state of a rigid body (isSleeping) cannot be synchronous in the worker mode.'
    );
  }

  async isMoving(): Promise<boolean> {
    return (
      await messageWorkerAsync<RigidIsMovingResponse>({
        type: PhysicsProtocolType.RIGID_IS_MOVING,
        rigidBodyId: this.id,
      })
    ).isMoving;
  }
  isMovingSync(): boolean {
    throw new Error(
      'Checking the moving state of a rigid body (isMoving) cannot be synchronous in the worker mode.'
    );
  }

  async isFixed(): Promise<boolean> {
    return (
      await messageWorkerAsync<RigidIsFixedResponse>({
        type: PhysicsProtocolType.RIGID_IS_FIXED,
        rigidBodyId: this.id,
      })
    ).isFixed;
  }
  isFixedSync(): boolean {
    throw new Error(
      'Checking the fixed state of a rigid body (isFixed) cannot be synchronous in the worker mode.'
    );
  }

  async isKinematic(): Promise<boolean> {
    return (
      await messageWorkerAsync<RigidIsKinematicResponse>({
        type: PhysicsProtocolType.RIGID_IS_KINEMATIC,
        rigidBodyId: this.id,
      })
    ).isKinematic;
  }
  isKinematicSync(): boolean {
    throw new Error(
      'Checking the kinematic state of a rigid body (isKinematic) cannot be synchronous in the worker mode.'
    );
  }

  async isDynamic(): Promise<boolean> {
    return (
      await messageWorkerAsync<RigidIsDynamicResponse>({
        type: PhysicsProtocolType.RIGID_IS_DYNAMIC,
        rigidBodyId: this.id,
      })
    ).isDynamic;
  }
  isDynamicSync(): boolean {
    throw new Error(
      'Checking the dynamic state of a rigid body (isDynamic) cannot be synchronous in the worker mode.'
    );
  }

  async linearDamping(): Promise<number> {
    return (
      await messageWorkerAsync<RigidLinearDampingResponse>({
        type: PhysicsProtocolType.RIGID_LINEAR_DAMPING,
        rigidBodyId: this.id,
      })
    ).linearDamping;
  }
  linearDampingSync(): number {
    throw new Error(
      'Getting the linear damping of a rigid body (linearDamping) cannot be synchronous in the worker mode.'
    );
  }

  async angularDamping(): Promise<number> {
    return (
      await messageWorkerAsync<RigidAngularDampingResponse>({
        type: PhysicsProtocolType.RIGID_ANGULAR_DAMPING,
        rigidBodyId: this.id,
      })
    ).angularDamping;
  }
  angularDampingSync(): number {
    throw new Error(
      'Getting the angular damping of a rigid body (angularDamping) cannot be synchronous in the worker mode.'
    );
  }

  setLinearDamping(factor: number): void {
    messageWorker({
      type: PhysicsProtocolType.RIGID_SET_LINEAR_DAMPING,
      rigidBodyId: this.id,
      factor,
    });
  }

  setAngularDamping(factor: number): void {
    messageWorker({
      type: PhysicsProtocolType.RIGID_SET_ANGULAR_DAMPING,
      rigidBodyId: this.id,
      factor,
    });
  }

  recomputeMassPropertiesFromColliders(): void {
    messageWorker({
      type: PhysicsProtocolType.RIGID_RECOMPUTE_MASS_PROPERTIES,
      rigidBodyId: this.id,
    });
  }

  setAdditionalMass(mass: number, wakeUp: boolean): void {
    messageWorker({
      type: PhysicsProtocolType.RIGID_SET_ADDITIONAL_MASS,
      rigidBodyId: this.id,
      mass,
      wakeUp,
    });
  }

  setAdditionalMassProperties(
    mass: number,
    centerOfMass: PhysVector,
    principalAngularInertia: PhysVector,
    angularInertiaLocalFrame: PhysRotation,
    wakeUp: boolean
  ): void {
    messageWorker({
      type: PhysicsProtocolType.RIGID_SET_ADDITIONAL_MASS_PROPERTIES,
      rigidBodyId: this.id,
      mass,
      centerOfMass,
      principalAngularInertia,
      angularInertiaLocalFrame,
      wakeUp,
    });
  }

  resetForces(wakeUp: boolean): void {
    messageWorker({
      type: PhysicsProtocolType.RIGID_RESET_FORCES,
      rigidBodyId: this.id,
      wakeUp,
    });
  }

  resetTorques(wakeUp: boolean): void {
    messageWorker({
      type: PhysicsProtocolType.RIGID_RESET_TORQUES,
      rigidBodyId: this.id,
      wakeUp,
    });
  }

  addForce(force: PhysVector, wakeUp: boolean): void {
    messageWorker({
      type: PhysicsProtocolType.RIGID_ADD_FORCE,
      rigidBodyId: this.id,
      force,
      wakeUp,
    });
  }

  applyImpulse(impulse: PhysVector, wakeUp: boolean): void {
    // Reflected locally as the velocity change it causes (Rapier applies an impulse straight to
    // the velocity too), using the last known mass — refreshed here for the next impulse.
    if (this.cachedMass) {
      const v = this.lvel;
      this.pendingLvel = {
        value: {
          x: v.x + impulse.x / this.cachedMass,
          y: v.y + impulse.y / this.cachedMass,
          z: v.z + impulse.z / this.cachedMass,
        },
        visibleAt: getWriteVisibleStep(),
      };
    }
    void this.mass().catch(() => {});
    messageWorker({
      type: PhysicsProtocolType.RIGID_APPLY_IMPULSE,
      rigidBodyId: this.id,
      impulse,
      wakeUp,
    });
  }

  addTorque(torque: PhysVector, wakeUp: boolean): void {
    messageWorker({
      type: PhysicsProtocolType.RIGID_ADD_TORQUE,
      rigidBodyId: this.id,
      torque,
      wakeUp,
    });
  }

  applyTorqueImpulse(torqueImpulse: PhysVector, wakeUp: boolean): void {
    messageWorker({
      type: PhysicsProtocolType.RIGID_APPLY_TORQUE_IMPULSE,
      rigidBodyId: this.id,
      torqueImpulse,
      wakeUp,
    });
  }

  addForceAtPoint(force: PhysVector, point: PhysVector, wakeUp: boolean): void {
    messageWorker({
      type: PhysicsProtocolType.RIGID_ADD_FORCE_AT_POINT,
      rigidBodyId: this.id,
      force,
      point,
      wakeUp,
    });
  }

  applyImpulseAtPoint(impulse: PhysVector, point: PhysVector, wakeUp: boolean): void {
    messageWorker({
      type: PhysicsProtocolType.RIGID_APPLY_IMPULSE_AT_POINT,
      rigidBodyId: this.id,
      impulse,
      point,
      wakeUp,
    });
  }

  async userForce(): Promise<PhysVector> {
    return (
      await messageWorkerAsync<RigidUserForceResponse>({
        type: PhysicsProtocolType.RIGID_USER_FORCE,
        rigidBodyId: this.id,
      })
    ).userForce;
  }
  userForceSync(): PhysVector {
    throw new Error(
      'Getting the user force of a rigid body (userForce) cannot be synchronous in the worker mode.'
    );
  }

  async userTorque(): Promise<PhysVector> {
    return (
      await messageWorkerAsync<RigidUserTorqueResponse>({
        type: PhysicsProtocolType.RIGID_USER_TORQUE,
        rigidBodyId: this.id,
      })
    ).userTorque;
  }
  userTorqueSync(): PhysVector {
    throw new Error(
      'Getting the user torque of a rigid body (userTorque) cannot be synchronous in the worker mode.'
    );
  }
}
