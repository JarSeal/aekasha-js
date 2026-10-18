// The WORKER_THREAD rigid body: poses and velocities read from the transform buffer, every other
// call a message to the worker.

import { existsOrThrow } from '../../../utils/Assert';
import {
  commandWorker,
  messageWorkerAsync,
  queryWorker,
  throwWorkerSync,
  toPlainRot,
} from '../PhysicsMessaging';
import type { PhysicsCommandFor, PhysicsQueryType } from '../PhysicsMessaging';
import { colliders, getBodyMovedListener } from '../PhysicsRegistry';
import { facade } from '../PhysicsState';
import { getWriteVisibleStep, isWritePending } from '../PhysicsStepping';
import { PhysicsProtocolType } from '../protocol/PhysicsProtocolType';
import type {
  RigidColliderResponse,
  RigidVelocityAtPointResponse,
} from '../protocol/PhysicsResponses';
import { RigidBodyTypeAPI } from '../types/PhysicsBodyTypes';
import type {
  PoseArray,
  RigidBodyAPI,
  RigidBodyAttachState,
  RigidBodyPose,
} from '../types/PhysicsBodyTypes';
import type { ColliderAPI } from '../types/PhysicsColliderTypes';
import type { PhysRotation, PhysVector } from '../types/PhysicsCommonTypes';

/** A value written on the main thread, read back until the transform buffer shows it. */
type PendingWrite<T> = { value: T; visibleAt: number };

/** The `*Sync` twins this proxy can't answer: their value is the worker's. */
const asyncOnly = (getter: string): never => throwWorkerSync('RigidBodyAPI', getter);

/**
 * A rigid body in WORKER_THREAD mode: its pose and velocities read from the transform buffer by
 * slot (with its own writes until they reach it), every other call a message to the worker.
 * @internal
 */
export class RigidBodyProxyAPI implements RigidBodyAPI {
  uData: Record<string, unknown> = {};
  isBeingDeleted: boolean = false;

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

  /**
   * The proxy of a body the worker made, from its create's reply.
   * @param slot its transform-buffer slot, -1 for a body created FIXED
   * @param initialPose the pose the worker reported at creation. Read until the first transform
   * write-back that includes this body, which (without SAB) can arrive a frame or more later, and
   * until then the slot holds zeros or a deleted body's last pose.
   * @param cachedBodyType the type it was created with ({@link bodyTypeSync}'s start)
   * @param cachedEnabled whether it was created enabled ({@link isEnabledSync}'s start)
   */
  constructor(
    /** The body's id. */
    public id: number,
    private slot: number,
    userData?: Record<string, unknown>,
    initialPose?: RigidBodyPose,
    private cachedBodyType: RigidBodyTypeAPI = RigidBodyTypeAPI.Dynamic,
    private cachedEnabled = true
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

  /** A one-way command about this body. */
  private command(message: PhysicsCommandFor<'rigidBodyId'>) {
    commandWorker(message, 'rigidBodyId', this.id);
  }

  /** A query for one of this body's fields. */
  private ask<T extends PhysicsQueryType<'rigidBodyId'>>(type: T) {
    return queryWorker(type, 'rigidBodyId', this.id);
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
   * reattachRigidBody's reply: the new slot, and its pose read until a transform write-back
   * includes it (as at creation). The body comes back with `state`'s type and enabled state.
   * @internal
   */
  _attach(slot: number, pose: RigidBodyPose, state: RigidBodyAttachState) {
    this.slot = slot;
    this.cachedBodyType = state.bodyType;
    this.cachedEnabled = state.enabled;
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
    this.uData = (await this.ask(PhysicsProtocolType.RIGID_GET_USERDATA)).userData;
    return this.uData;
  }
  getUserDataSync(): Record<string, unknown> {
    return this.uData;
  }

  setUserData(userData: Record<string, unknown>, addToExisting?: boolean): void {
    this.command({
      type: PhysicsProtocolType.RIGID_SET_USERDATA,
      userData,
      addToExisting,
      isOneWay: true,
    });
    this.uData = addToExisting ? { ...this.uData, ...userData } : userData;
  }

  async isValid(): Promise<boolean> {
    return (await this.ask(PhysicsProtocolType.RIGID_IS_VALID)).isValid;
  }
  isValidSync(): boolean {
    return asyncOnly('isValid');
  }

  lockTranslations(locked: boolean, wakeUp: boolean): void {
    this.command({
      type: PhysicsProtocolType.RIGID_LOCK_TRANSLATIONS,
      locked,
      wakeUp,
      isOneWay: true,
    });
  }

  lockRotations(locked: boolean, wakeUp: boolean): void {
    this.command({
      type: PhysicsProtocolType.RIGID_LOCK_ROTATIONS,
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
    this.command({
      type: PhysicsProtocolType.RIGID_SET_ENABLED_TRANSLATIONS,
      enableX,
      enableY,
      enableZ,
      wakeUp,
      isOneWay: true,
    });
  }

  setEnabledRotations(enableX: boolean, enableY: boolean, enableZ: boolean, wakeUp: boolean): void {
    this.command({
      type: PhysicsProtocolType.RIGID_SET_ENABLED_ROTATIONS,
      enableX,
      enableY,
      enableZ,
      wakeUp,
      isOneWay: true,
    });
  }

  async dominanceGroup(): Promise<number> {
    return (await this.ask(PhysicsProtocolType.RIGID_DOMINANCE_GROUP)).dominanceGroup;
  }
  dominanceGroupSync(): number {
    return asyncOnly('dominanceGroup');
  }

  setDominanceGroup(group: number): void {
    this.command({ type: PhysicsProtocolType.RIGID_SET_DOMINANCE_GROUP, group });
  }

  async additionalSolverIterations(): Promise<number> {
    return (await this.ask(PhysicsProtocolType.RIGID_ADDITIONAL_SOLVER_ITERATIONS))
      .additionalIterations;
  }
  additionalSolverIterationsSync(): number {
    return asyncOnly('additionalSolverIterations');
  }

  setAdditionalSolverIterations(iters: number): void {
    this.command({ type: PhysicsProtocolType.RIGID_SET_ADDITIONAL_SOLVER_ITERATIONS, iters });
  }

  enableCcd(enabled: boolean): void {
    this.command({ type: PhysicsProtocolType.RIGID_ENABLE_CCD, enabled });
  }

  setSoftCcdPrediction(distance: number): void {
    this.command({ type: PhysicsProtocolType.RIGID_SET_SOFT_CCD_PREDICTION, distance });
  }

  async softCcdPrediction(): Promise<number> {
    return (await this.ask(PhysicsProtocolType.RIGID_SOFT_CCD_PREDICTION)).softCcdPrediction;
  }
  softCcdPredictionSync(): number {
    return asyncOnly('softCcdPrediction');
  }

  translation(): PhysVector {
    return this.pos;
  }

  rotation(): PhysRotation {
    return this.rot;
  }

  async nextTranslation(): Promise<PhysVector> {
    return (await this.ask(PhysicsProtocolType.RIGID_NEXT_TRANSLATION)).nextTranslation;
  }
  nextTranslationSync(): PhysVector {
    return asyncOnly('nextTranslation');
  }

  async nextRotation(): Promise<PhysRotation> {
    return (await this.ask(PhysicsProtocolType.RIGID_NEXT_ROTATION)).nextRotation;
  }
  nextRotationSync(): PhysRotation {
    return asyncOnly('nextRotation');
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
    this.command({ type: PhysicsProtocolType.RIGID_SET_TRANSLATION, tra, wakeUp });
  }

  setLinvel(vel: PhysVector, wakeUp: boolean): void {
    this.pendingLvel = {
      value: { x: vel.x, y: vel.y, z: vel.z },
      visibleAt: getWriteVisibleStep(),
    };
    this.command({ type: PhysicsProtocolType.RIGID_SET_LINVEL, vel, wakeUp });
  }

  async gravityScale(): Promise<number> {
    return (await this.ask(PhysicsProtocolType.RIGID_GRAVITY_SCALE)).gravityScale;
  }
  gravityScaleSync(): number {
    return asyncOnly('gravityScale');
  }

  setGravityScale(factor: number, wakeUp: boolean): void {
    this.command({ type: PhysicsProtocolType.RIGID_SET_GRAVITY_SCALE, factor, wakeUp });
  }

  setRotation(rot: PhysRotation, wakeUp: boolean): void {
    if (this.staticPose) {
      this.staticPose.rot = toPlainRot(rot);
    } else {
      this.pendingRot = { value: toPlainRot(rot), visibleAt: getWriteVisibleStep() };
    }
    getBodyMovedListener()?.(this.id);
    this.command({ type: PhysicsProtocolType.RIGID_SET_ROTATION, rot: toPlainRot(rot), wakeUp });
  }

  setAngvel(vel: PhysVector, wakeUp: boolean): void {
    this.pendingAvel = {
      value: { x: vel.x, y: vel.y, z: vel.z },
      visibleAt: getWriteVisibleStep(),
    };
    this.command({ type: PhysicsProtocolType.RIGID_SET_ANGVEL, vel, wakeUp });
  }

  setNextKinematicTranslation(t: PhysVector): void {
    this.command({ type: PhysicsProtocolType.RIGID_SET_NEXT_KINEMATIC_TRANSLATION, t });
  }

  setNextKinematicRotation(rot: PhysRotation): void {
    this.command({
      type: PhysicsProtocolType.RIGID_SET_NEXT_KINEMATIC_ROTATION,
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the interface's signature
  velocityAtPointSync(_point: PhysVector): PhysVector {
    return asyncOnly('velocityAtPoint');
  }

  angvel(): PhysVector {
    return this.avel;
  }

  async mass(): Promise<number> {
    const { mass } = await this.ask(PhysicsProtocolType.RIGID_MASS);
    this.cachedMass = mass;
    return mass;
  }
  massSync(): number {
    return asyncOnly('mass');
  }

  async effectiveInvMass(): Promise<PhysVector> {
    return (await this.ask(PhysicsProtocolType.RIGID_EFFECTIVE_INV_MASS)).effectiveInvMass;
  }
  effectiveInvMassSync(): PhysVector {
    return asyncOnly('effectiveInvMass');
  }

  async invMass(): Promise<number> {
    return (await this.ask(PhysicsProtocolType.RIGID_INV_MASS)).invMass;
  }
  invMassSync(): number {
    return asyncOnly('invMass');
  }

  async localCom(): Promise<PhysVector> {
    return (await this.ask(PhysicsProtocolType.RIGID_LOCAL_COM)).localCom;
  }
  localComSync(): PhysVector {
    return asyncOnly('localCom');
  }

  async worldCom(): Promise<PhysVector> {
    return (await this.ask(PhysicsProtocolType.RIGID_WORLD_COM)).worldCom;
  }
  worldComSync(): PhysVector {
    return asyncOnly('worldCom');
  }

  async invPrincipalInertia(): Promise<PhysVector> {
    return (await this.ask(PhysicsProtocolType.RIGID_INV_PRINCIPAL_INERTIA)).invPrincipalInertia;
  }
  invPrincipalInertiaSync(): PhysVector {
    return asyncOnly('invPrincipalInertia');
  }

  async principalInertia(): Promise<PhysVector> {
    return (await this.ask(PhysicsProtocolType.RIGID_PRINCIPAL_INERTIA)).principalInertia;
  }
  principalInertiaSync(): PhysVector {
    return asyncOnly('principalInertia');
  }

  async principalInertiaLocalFrame(): Promise<PhysRotation> {
    return (await this.ask(PhysicsProtocolType.RIGID_PRINCIPAL_INERTIA_LOCAL_FRAME))
      .principalInertiaLocalFrame;
  }
  principalInertiaLocalFrameSync(): PhysRotation {
    return asyncOnly('principalInertiaLocalFrame');
  }

  sleep(): void {
    this.command({ type: PhysicsProtocolType.RIGID_SLEEP });
  }

  wakeUp(): void {
    this.command({ type: PhysicsProtocolType.RIGID_WAKE_UP });
  }

  async isCcdEnabled(): Promise<boolean> {
    return (await this.ask(PhysicsProtocolType.RIGID_IS_CCD_ENABLED)).isCcdEnabled;
  }
  isCcdEnabledSync(): boolean {
    return asyncOnly('isCcdEnabled');
  }

  async numColliders(): Promise<number> {
    return (await this.ask(PhysicsProtocolType.RIGID_NUM_COLLIDERS)).numColliders;
  }
  numCollidersSync(): number {
    return asyncOnly('numColliders');
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the interface's signature
  colliderSync(_i: number): ColliderAPI {
    return asyncOnly('collider');
  }

  setEnabled(enabled: boolean): void {
    this.cachedEnabled = enabled;
    this.command({ type: PhysicsProtocolType.RIGID_SET_ENABLED, enabled });
  }

  async isEnabled(): Promise<boolean> {
    return (await this.ask(PhysicsProtocolType.RIGID_IS_ENABLED)).isEnabled;
  }
  /** Whether the body was created enabled or last set so through `setEnabled` (or the REMOVED
   * tier's reattach), the only ways it changes, so no worker round trip (see
   * {@link bodyTypeSync}). */
  isEnabledSync(): boolean {
    return this.cachedEnabled;
  }

  async bodyType(): Promise<RigidBodyTypeAPI> {
    return (await this.ask(PhysicsProtocolType.RIGID_BODY_TYPE)).bodyType;
  }
  /** The type this body was created with or last set to through `setBodyType` (or the REMOVED
   * tier's reattach), the only ways its type changes, so no worker round trip: what a step's
   * code (eg. a character's sensor) reads synchronously, the same on every target. */
  bodyTypeSync(): RigidBodyTypeAPI {
    return this.cachedBodyType;
  }

  setBodyType(bodyType: RigidBodyTypeAPI, wakeUp: boolean): void {
    this.cachedBodyType = bodyType;
    this.command({ type: PhysicsProtocolType.RIGID_SET_BODY_TYPE, bodyType, wakeUp });
  }

  async isSleeping(): Promise<boolean> {
    return (await this.ask(PhysicsProtocolType.RIGID_IS_SLEEPING)).isSleeping;
  }
  isSleepingSync(): boolean {
    return asyncOnly('isSleeping');
  }

  async isMoving(): Promise<boolean> {
    return (await this.ask(PhysicsProtocolType.RIGID_IS_MOVING)).isMoving;
  }
  isMovingSync(): boolean {
    return asyncOnly('isMoving');
  }

  async isFixed(): Promise<boolean> {
    return (await this.ask(PhysicsProtocolType.RIGID_IS_FIXED)).isFixed;
  }
  isFixedSync(): boolean {
    return asyncOnly('isFixed');
  }

  async isKinematic(): Promise<boolean> {
    return (await this.ask(PhysicsProtocolType.RIGID_IS_KINEMATIC)).isKinematic;
  }
  isKinematicSync(): boolean {
    return asyncOnly('isKinematic');
  }

  async isDynamic(): Promise<boolean> {
    return (await this.ask(PhysicsProtocolType.RIGID_IS_DYNAMIC)).isDynamic;
  }
  isDynamicSync(): boolean {
    return asyncOnly('isDynamic');
  }

  async linearDamping(): Promise<number> {
    return (await this.ask(PhysicsProtocolType.RIGID_LINEAR_DAMPING)).linearDamping;
  }
  linearDampingSync(): number {
    return asyncOnly('linearDamping');
  }

  async angularDamping(): Promise<number> {
    return (await this.ask(PhysicsProtocolType.RIGID_ANGULAR_DAMPING)).angularDamping;
  }
  angularDampingSync(): number {
    return asyncOnly('angularDamping');
  }

  setLinearDamping(factor: number): void {
    this.command({ type: PhysicsProtocolType.RIGID_SET_LINEAR_DAMPING, factor });
  }

  setAngularDamping(factor: number): void {
    this.command({ type: PhysicsProtocolType.RIGID_SET_ANGULAR_DAMPING, factor });
  }

  recomputeMassPropertiesFromColliders(): void {
    this.command({ type: PhysicsProtocolType.RIGID_RECOMPUTE_MASS_PROPERTIES });
  }

  setAdditionalMass(mass: number, wakeUp: boolean): void {
    this.command({ type: PhysicsProtocolType.RIGID_SET_ADDITIONAL_MASS, mass, wakeUp });
  }

  setAdditionalMassProperties(
    mass: number,
    centerOfMass: PhysVector,
    principalAngularInertia: PhysVector,
    angularInertiaLocalFrame: PhysRotation,
    wakeUp: boolean
  ): void {
    this.command({
      type: PhysicsProtocolType.RIGID_SET_ADDITIONAL_MASS_PROPERTIES,
      mass,
      centerOfMass,
      principalAngularInertia,
      angularInertiaLocalFrame,
      wakeUp,
    });
  }

  resetForces(wakeUp: boolean): void {
    this.command({ type: PhysicsProtocolType.RIGID_RESET_FORCES, wakeUp });
  }

  resetTorques(wakeUp: boolean): void {
    this.command({ type: PhysicsProtocolType.RIGID_RESET_TORQUES, wakeUp });
  }

  addForce(force: PhysVector, wakeUp: boolean): void {
    this.command({ type: PhysicsProtocolType.RIGID_ADD_FORCE, force, wakeUp });
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
    this.command({ type: PhysicsProtocolType.RIGID_APPLY_IMPULSE, impulse, wakeUp });
  }

  addTorque(torque: PhysVector, wakeUp: boolean): void {
    this.command({ type: PhysicsProtocolType.RIGID_ADD_TORQUE, torque, wakeUp });
  }

  applyTorqueImpulse(torqueImpulse: PhysVector, wakeUp: boolean): void {
    this.command({ type: PhysicsProtocolType.RIGID_APPLY_TORQUE_IMPULSE, torqueImpulse, wakeUp });
  }

  addForceAtPoint(force: PhysVector, point: PhysVector, wakeUp: boolean): void {
    this.command({ type: PhysicsProtocolType.RIGID_ADD_FORCE_AT_POINT, force, point, wakeUp });
  }

  applyImpulseAtPoint(impulse: PhysVector, point: PhysVector, wakeUp: boolean): void {
    this.command({
      type: PhysicsProtocolType.RIGID_APPLY_IMPULSE_AT_POINT,
      impulse,
      point,
      wakeUp,
    });
  }

  async userForce(): Promise<PhysVector> {
    return (await this.ask(PhysicsProtocolType.RIGID_USER_FORCE)).userForce;
  }
  userForceSync(): PhysVector {
    return asyncOnly('userForce');
  }

  async userTorque(): Promise<PhysVector> {
    return (await this.ask(PhysicsProtocolType.RIGID_USER_TORQUE)).userTorque;
  }
  userTorqueSync(): PhysVector {
    return asyncOnly('userTorque');
  }
}
