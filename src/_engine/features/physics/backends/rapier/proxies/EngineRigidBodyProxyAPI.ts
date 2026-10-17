// The Rapier backend's rigid body API object.

import type Rapier from '@dimforge/rapier3d-compat';
import {
  type PoseArray,
  type RigidBodyAPI,
  RigidBodyTypeAPI,
} from '../../../types/PhysicsBodyTypes';
import type { PhysRotation, PhysVector } from '../../../types/PhysicsCommonTypes';
import { existsOrThrow } from '../../../../../utils/Assert';
import { lwarn } from '../../../../../utils/Logger';
import { fromRapierBodyType, toRapierBodyType } from '../RapierEnums';
import { backend, getColliderAPI, getRigidBody, toPlainRotation, toPlainVec } from '../RapierState';
/** A body's additional mass, as last set: the mass alone, or full mass properties. */
type AdditionalMass =
  | { mass: number }
  | {
      mass: number;
      centerOfMass: PhysVector;
      principalAngularInertia: PhysVector;
      angularInertiaLocalFrame: PhysRotation;
    };

/**
 * A rigid body as a {@link RigidBodyAPI} on its Rapier body. Its async forms run their `*Sync`
 * twins.
 * @internal
 */
export class EngineRigidBodyProxyAPI implements RigidBodyAPI {
  private rb: Rapier.RigidBody;
  /** Created FIXED (p352): its entity is never synced per frame. A dynamic body switched to
   * FIXED (the STATIC physics tier) is a different case: its entity goes back to a dynamic
   * bucket when it's switched back. */
  private readonly isCreatedFixed: boolean;
  /** State Rapier has no getter for, mirrored from every write, so a detached body (p352
   * REMOVED tier) comes back with it (reattachRigidBody). */
  readonly writeOnly: {
    translationsEnabled: [boolean, boolean, boolean];
    rotationsEnabled: [boolean, boolean, boolean];
    additionalMass: AdditionalMass | null;
  } = {
    translationsEnabled: [true, true, true],
    rotationsEnabled: [true, true, true],
    additionalMass: null,
  };
  uData: Record<string, unknown> = {};

  isBeingDeleted: boolean = false;

  // Lazy getters (main-thread mode has no SharedArrayBuffer to write these back into,
  // so there is no hot path to optimize yet; revisit for worker-thread mode).
  get pos(): PhysVector {
    return this.rb.translation();
  }
  get rot(): PhysRotation {
    return this.rb.rotation();
  }
  readPoseInto(out: PoseArray, offset = 0): void {
    // Rapier's own getters allocate one object each; this is still 2 per read instead of one
    // per component read (up to 7) through pos/rot.
    const t = this.rb.translation();
    const r = this.rb.rotation();
    out[offset] = t.x;
    out[offset + 1] = t.y;
    out[offset + 2] = t.z;
    out[offset + 3] = r.x;
    out[offset + 4] = r.y;
    out[offset + 5] = r.z;
    out[offset + 6] = r.w;
  }
  get lvel(): PhysVector {
    return this.rb.linvel();
  }
  get avel(): PhysVector {
    return this.rb.angvel();
  }
  readVelocitiesInto(out: PoseArray, offset = 0): void {
    // Rapier's own getters allocate one object each (as in readPoseInto)
    const l = this.rb.linvel();
    const a = this.rb.angvel();
    out[offset] = l.x;
    out[offset + 1] = l.y;
    out[offset + 2] = l.z;
    out[offset + 3] = a.x;
    out[offset + 4] = a.y;
    out[offset + 5] = a.z;
  }

  /** The proxy of a body createRigidBody just made (its Rapier body found by `id`). */
  constructor(
    /** The body's running id. */
    public id: number,
    userData?: Record<string, unknown>
  ) {
    if (userData) this.uData = userData;
    const rb = existsOrThrow(
      getRigidBody(id),
      `Could not find rigid body in the engineAPI with id: ${id}`
    );
    this.rb = rb;
    this.isCreatedFixed = rb.isFixed();
  }

  /**
   * Points the proxy at its re-created Rapier body (reattachRigidBody, p352).
   * @internal
   */
  _rebind(rb: Rapier.RigidBody) {
    this.rb = rb;
  }

  getUserDataSync() {
    return this.uData;
  }
  async getUserData() {
    return this.getUserDataSync();
  }

  setUserData(userData: Record<string, unknown>, addToExisting?: boolean) {
    this.uData = addToExisting ? { ...this.uData, ...userData } : userData;
  }

  isValidSync() {
    return this.rb.isValid();
  }
  async isValid() {
    return this.isValidSync();
  }

  lockTranslations(locked: boolean, wakeUp: boolean) {
    this.rb.lockTranslations(locked, wakeUp);
    this.writeOnly.translationsEnabled = [!locked, !locked, !locked];
  }

  lockRotations(locked: boolean, wakeUp: boolean) {
    this.rb.lockRotations(locked, wakeUp);
    this.writeOnly.rotationsEnabled = [!locked, !locked, !locked];
  }

  setEnabledTranslations(enableX: boolean, enableY: boolean, enableZ: boolean, wakeUp: boolean) {
    this.rb.setEnabledTranslations(enableX, enableY, enableZ, wakeUp);
    this.writeOnly.translationsEnabled = [enableX, enableY, enableZ];
  }

  setEnabledRotations(enableX: boolean, enableY: boolean, enableZ: boolean, wakeUp: boolean) {
    this.rb.setEnabledRotations(enableX, enableY, enableZ, wakeUp);
    this.writeOnly.rotationsEnabled = [enableX, enableY, enableZ];
  }

  dominanceGroupSync() {
    return this.rb.dominanceGroup();
  }
  async dominanceGroup() {
    return this.dominanceGroupSync();
  }

  setDominanceGroup(group: number) {
    this.rb.setDominanceGroup(group);
  }

  additionalSolverIterationsSync() {
    return this.rb.additionalSolverIterations();
  }
  async additionalSolverIterations() {
    return this.additionalSolverIterationsSync();
  }

  setAdditionalSolverIterations(iters: number) {
    this.rb.setAdditionalSolverIterations(iters);
  }

  enableCcd(enabled: boolean) {
    this.rb.enableCcd(enabled);
  }

  setSoftCcdPrediction(distance: number) {
    this.rb.setSoftCcdPrediction(distance);
  }

  softCcdPredictionSync() {
    return this.rb.softCcdPrediction();
  }
  async softCcdPrediction() {
    return this.softCcdPredictionSync();
  }

  translation() {
    return this.rb.translation();
  }

  rotation() {
    return this.rb.rotation();
  }

  nextTranslationSync() {
    return this.rb.nextTranslation();
  }
  async nextTranslation() {
    return this.nextTranslationSync();
  }

  nextRotationSync() {
    return this.rb.nextRotation();
  }
  async nextRotation() {
    return this.nextRotationSync();
  }

  setTranslation(tra: PhysVector, wakeUp: boolean) {
    this.rb.setTranslation(tra, wakeUp);
    backend.bodyMovedObserver?.(this.id);
  }

  setLinvel(vel: PhysVector, wakeUp: boolean) {
    this.rb.setLinvel(vel, wakeUp);
  }

  gravityScaleSync() {
    return this.rb.gravityScale();
  }
  async gravityScale() {
    return this.gravityScaleSync();
  }

  setGravityScale(factor: number, wakeUp: boolean) {
    this.rb.setGravityScale(factor, wakeUp);
  }

  setRotation(rot: PhysRotation, wakeUp: boolean) {
    this.rb.setRotation(rot, wakeUp);
    backend.bodyMovedObserver?.(this.id);
  }

  setAngvel(vel: PhysVector, wakeUp: boolean) {
    this.rb.setAngvel(vel, wakeUp);
  }

  setNextKinematicTranslation(t: PhysVector) {
    this.rb.setNextKinematicTranslation(t);
  }

  setNextKinematicRotation(rot: PhysRotation) {
    this.rb.setNextKinematicRotation(rot);
  }

  linvel() {
    return this.rb.linvel();
  }

  velocityAtPointSync(point: PhysVector) {
    return this.rb.velocityAtPoint(point);
  }
  async velocityAtPoint(point: PhysVector) {
    return this.velocityAtPointSync(point);
  }

  angvel() {
    return this.rb.angvel();
  }

  massSync() {
    // Rapier only refreshes mass properties on the next step, so without this a body queried
    // right after its colliders were added/enabled/disabled reports its pre-change mass.
    this.rb.recomputeMassPropertiesFromColliders();
    return this.rb.mass();
  }
  async mass() {
    return this.massSync();
  }

  effectiveInvMassSync() {
    return this.rb.effectiveInvMass();
  }
  async effectiveInvMass() {
    return this.effectiveInvMassSync();
  }

  invMassSync() {
    return this.rb.invMass();
  }
  async invMass() {
    return this.invMassSync();
  }

  localComSync() {
    return this.rb.localCom();
  }
  async localCom() {
    return this.localComSync();
  }

  worldComSync() {
    return this.rb.worldCom();
  }
  async worldCom() {
    return this.worldComSync();
  }

  invPrincipalInertiaSync() {
    return this.rb.invPrincipalInertia();
  }
  async invPrincipalInertia() {
    return this.invPrincipalInertiaSync();
  }

  principalInertiaSync() {
    return this.rb.principalInertia();
  }
  async principalInertia() {
    return this.principalInertiaSync();
  }

  principalInertiaLocalFrameSync() {
    return this.rb.principalInertiaLocalFrame();
  }
  async principalInertiaLocalFrame() {
    return this.principalInertiaLocalFrameSync();
  }

  sleep() {
    this.rb.sleep();
  }

  wakeUp() {
    this.rb.wakeUp();
  }

  isCcdEnabledSync() {
    return this.rb.isCcdEnabled();
  }
  async isCcdEnabled() {
    return this.isCcdEnabledSync();
  }

  numCollidersSync() {
    return this.rb.numColliders();
  }
  async numColliders() {
    return this.numCollidersSync();
  }

  colliderSync(i: number) {
    const coll = this.rb.collider(i);
    const collAPI = existsOrThrow(
      getColliderAPI(coll.handle),
      `Could not find collider in ColliderAPI.collider(${i}).`
    );
    return collAPI;
  }
  async collider(i: number) {
    return this.colliderSync(i);
  }

  setEnabled(enabled: boolean) {
    this.rb.setEnabled(enabled);
  }

  isEnabledSync() {
    return this.rb.isEnabled();
  }
  async isEnabled() {
    return this.isEnabledSync();
  }

  bodyTypeSync() {
    return fromRapierBodyType(this.rb.bodyType());
  }
  async bodyType() {
    return this.bodyTypeSync();
  }

  setBodyType(type: RigidBodyTypeAPI, wakeUp: boolean) {
    if (backend.isDebugEnvironment && type !== RigidBodyTypeAPI.Fixed && this.isCreatedFixed) {
      // p352: a body created FIXED has no transform-buffer slot (WORKER_THREAD) and its entity
      // sits in BODY_STATIC, which isn't synced per frame, so its new motion never reaches it.
      lwarn(
        `Rigid body ${this.id} changed from FIXED to another type with setBodyType: a body created FIXED isn't synced to its entity while it moves. Create it with the type it moves as.`
      );
    }
    this.rb.setBodyType(toRapierBodyType(type), wakeUp);
  }

  isSleepingSync() {
    return this.rb.isSleeping();
  }
  async isSleeping() {
    return this.isSleepingSync();
  }

  isMovingSync() {
    return this.rb.isMoving();
  }
  async isMoving() {
    return this.isMovingSync();
  }

  isFixedSync() {
    return this.rb.isFixed();
  }
  async isFixed() {
    return this.isFixedSync();
  }

  isKinematicSync() {
    return this.rb.isKinematic();
  }
  async isKinematic() {
    return this.isKinematicSync();
  }

  isDynamicSync() {
    return this.rb.isDynamic();
  }
  async isDynamic() {
    return this.isDynamicSync();
  }

  linearDampingSync() {
    return this.rb.linearDamping();
  }
  async linearDamping() {
    return this.linearDampingSync();
  }

  angularDampingSync() {
    return this.rb.angularDamping();
  }
  async angularDamping() {
    return this.angularDampingSync();
  }

  setLinearDamping(factor: number) {
    this.rb.setLinearDamping(factor);
  }

  recomputeMassPropertiesFromColliders() {
    this.rb.recomputeMassPropertiesFromColliders();
  }

  setAdditionalMass(mass: number, wakeUp: boolean) {
    this.rb.setAdditionalMass(mass, wakeUp);
    this.writeOnly.additionalMass = { mass };
  }

  setAdditionalMassProperties(
    mass: number,
    centerOfMass: PhysVector,
    principalAngularInertia: PhysVector,
    angularInertiaLocalFrame: PhysRotation,
    wakeUp: boolean
  ) {
    this.rb.setAdditionalMassProperties(
      mass,
      centerOfMass,
      principalAngularInertia,
      angularInertiaLocalFrame,
      wakeUp
    );
    this.writeOnly.additionalMass = {
      mass,
      centerOfMass: toPlainVec(centerOfMass),
      principalAngularInertia: toPlainVec(principalAngularInertia),
      angularInertiaLocalFrame: toPlainRotation(angularInertiaLocalFrame),
    };
  }

  setAngularDamping(factor: number) {
    this.rb.setAngularDamping(factor);
  }

  resetForces(wakeUp: boolean) {
    this.rb.resetForces(wakeUp);
  }

  resetTorques(wakeUp: boolean) {
    this.rb.resetTorques(wakeUp);
  }

  addForce(force: PhysVector, wakeUp: boolean) {
    this.rb.addForce(force, wakeUp);
  }

  applyImpulse(impulse: PhysVector, wakeUp: boolean) {
    this.rb.applyImpulse(impulse, wakeUp);
  }

  addTorque(torque: PhysVector, wakeUp: boolean) {
    this.rb.addTorque(torque, wakeUp);
  }

  applyTorqueImpulse(torqueImpulse: PhysVector, wakeUp: boolean) {
    this.rb.applyTorqueImpulse(torqueImpulse, wakeUp);
  }

  addForceAtPoint(force: PhysVector, point: PhysVector, wakeUp: boolean) {
    this.rb.addForceAtPoint(force, point, wakeUp);
  }

  applyImpulseAtPoint(impulse: PhysVector, point: PhysVector, wakeUp: boolean) {
    this.rb.applyImpulseAtPoint(impulse, point, wakeUp);
  }

  userForceSync() {
    return this.rb.userForce();
  }
  async userForce() {
    return this.userForceSync();
  }

  userTorqueSync() {
    return this.rb.userTorque();
  }
  async userTorque() {
    return this.userTorqueSync();
  }
}
