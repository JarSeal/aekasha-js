// The Rapier backend's impulse joint API object.

import type Rapier from '@dimforge/rapier3d-compat';
import type { JointAPI, JointMotorModel } from '../../../types/PhysicsJointTypes';
import type { PhysVector } from '../../../types/PhysicsCommonTypes';
import { existsOrThrow } from '../../../../../utils/Assert';
import { backend, getJoint } from '../RapierState';

/**
 * An impulse joint as a {@link JointAPI} on its Rapier joint. Its async forms run their `*Sync`
 * twins.
 * @internal
 */
export class EngineJointProxyAPI implements JointAPI {
  private joint: Rapier.ImpulseJoint;
  uData: Record<string, unknown> = {};

  isBeingDeleted: boolean = false;

  /** The proxy of a joint createJoint just made (its Rapier joint found by `id`). */
  constructor(
    /** The joint's running id. */
    public id: number,
    private _body1Id: number,
    private _body2Id: number,
    userData?: Record<string, unknown>
  ) {
    if (userData) this.uData = userData;
    this.joint = existsOrThrow(
      getJoint(id),
      `Could not find joint in the engineAPI with id: ${id}`
    );
  }

  /** Revolute/Prismatic only (Rapier's UnitImpulseJoint). Throws for every other joint type. */
  private asUnitJoint(): Rapier.UnitImpulseJoint {
    return existsOrThrow(
      this.joint instanceof backend.RAPIER.UnitImpulseJoint ? this.joint : undefined,
      `Joint (id: ${this.id}) is not a Revolute or Prismatic joint — limits/motor config is not available on this joint type.`
    );
  }

  // --- Metadata ---
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
    return this.joint.isValid();
  }
  async isValid() {
    return this.isValidSync();
  }

  body1IdSync(): number {
    return this._body1Id;
  }
  async body1Id() {
    return this.body1IdSync();
  }
  body2IdSync(): number {
    return this._body2Id;
  }
  async body2Id() {
    return this.body2IdSync();
  }

  anchor1Sync(): PhysVector {
    const a = this.joint.anchor1();
    return { x: a.x, y: a.y, z: a.z };
  }
  async anchor1() {
    return this.anchor1Sync();
  }
  anchor2Sync(): PhysVector {
    const a = this.joint.anchor2();
    return { x: a.x, y: a.y, z: a.z };
  }
  async anchor2() {
    return this.anchor2Sync();
  }

  contactsEnabledSync() {
    return this.joint.contactsEnabled();
  }
  async contactsEnabled() {
    return this.contactsEnabledSync();
  }
  setContactsEnabled(enabled: boolean) {
    this.joint.setContactsEnabled(enabled);
  }

  // --- Revolute/Prismatic only ---
  limitsEnabledSync() {
    return this.asUnitJoint().limitsEnabled();
  }
  async limitsEnabled() {
    return this.limitsEnabledSync();
  }
  setLimits(min: number, max: number) {
    this.asUnitJoint().setLimits(min, max);
  }
  configureMotorModel(model: JointMotorModel) {
    this.asUnitJoint().configureMotorModel(
      model === 'FORCE_BASED'
        ? backend.RAPIER.MotorModel.ForceBased
        : backend.RAPIER.MotorModel.AccelerationBased
    );
  }
  configureMotorVelocity(targetVel: number, factor: number) {
    this.asUnitJoint().configureMotorVelocity(targetVel, factor);
  }
  configureMotorPosition(targetPos: number, stiffness: number, damping: number) {
    this.asUnitJoint().configureMotorPosition(targetPos, stiffness, damping);
  }
  configureMotor(targetPos: number, targetVel: number, stiffness: number, damping: number) {
    this.asUnitJoint().configureMotor(targetPos, targetVel, stiffness, damping);
  }
}
