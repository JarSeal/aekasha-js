// The WORKER_THREAD impulse joint: each call a message to the worker.

import { messageWorker, messageWorkerAsync } from '../PhysicsMessaging';
import { PhysicsProtocolType } from '../protocol/PhysicsProtocolType';
import type {
  JointAnchor1Response,
  JointAnchor2Response,
  JointContactsEnabledResponse,
  JointGetUserDataResponse,
  JointIsValidResponse,
  JointLimitsEnabledResponse,
} from '../protocol/PhysicsResponses';
import type { PhysVector } from '../types/PhysicsCommonTypes';
import type { JointAPI, JointMotorModel } from '../types/PhysicsJointTypes';

/**
 * An impulse joint in WORKER_THREAD mode: each call is a message to the worker, its two bodies
 * known from its creation.
 * @internal
 */
export class JointProxyAPI implements JointAPI {
  uData: Record<string, unknown> = {};

  isBeingDeleted: boolean = false;

  constructor(
    public id: number,
    private _body1Id: number,
    private _body2Id: number,
    userData?: Record<string, unknown>
  ) {
    if (userData) this.uData = userData;
  }

  // --- Metadata ---
  async getUserData(): Promise<Record<string, unknown>> {
    const res = await messageWorkerAsync<JointGetUserDataResponse>({
      type: PhysicsProtocolType.JOINT_GET_USERDATA,
      jointId: this.id,
    });
    this.uData = res.userData;
    return res.userData;
  }
  getUserDataSync(): Record<string, unknown> {
    return this.uData;
  }
  setUserData(userData: Record<string, unknown>, addToExisting?: boolean): void {
    this.uData = addToExisting ? { ...this.uData, ...userData } : userData;
    messageWorker({
      type: PhysicsProtocolType.JOINT_SET_USERDATA,
      jointId: this.id,
      userData,
      addToExisting,
      isOneWay: true,
    });
  }

  async isValid(): Promise<boolean> {
    return (
      await messageWorkerAsync<JointIsValidResponse>({
        type: PhysicsProtocolType.JOINT_IS_VALID,
        jointId: this.id,
      })
    ).isValid;
  }
  isValidSync(): boolean {
    throw new Error('Sync isValid not supported on Proxy');
  }

  // A joint's bodies never change, so they're known here from its creation params (p352: joint
  // groups are resolved on the main thread) and need no round trip.
  async body1Id(): Promise<number> {
    return this._body1Id;
  }
  body1IdSync(): number {
    return this._body1Id;
  }
  async body2Id(): Promise<number> {
    return this._body2Id;
  }
  body2IdSync(): number {
    return this._body2Id;
  }

  async anchor1(): Promise<PhysVector> {
    return (
      await messageWorkerAsync<JointAnchor1Response>({
        type: PhysicsProtocolType.JOINT_ANCHOR1,
        jointId: this.id,
      })
    ).anchor1;
  }
  anchor1Sync(): PhysVector {
    throw new Error('Sync anchor1 not supported on Proxy');
  }
  async anchor2(): Promise<PhysVector> {
    return (
      await messageWorkerAsync<JointAnchor2Response>({
        type: PhysicsProtocolType.JOINT_ANCHOR2,
        jointId: this.id,
      })
    ).anchor2;
  }
  anchor2Sync(): PhysVector {
    throw new Error('Sync anchor2 not supported on Proxy');
  }

  async contactsEnabled(): Promise<boolean> {
    return (
      await messageWorkerAsync<JointContactsEnabledResponse>({
        type: PhysicsProtocolType.JOINT_CONTACTS_ENABLED,
        jointId: this.id,
      })
    ).contactsEnabled;
  }
  contactsEnabledSync(): boolean {
    throw new Error('Sync contactsEnabled not supported on Proxy');
  }
  setContactsEnabled(enabled: boolean): void {
    messageWorker({
      type: PhysicsProtocolType.JOINT_SET_CONTACTS_ENABLED,
      jointId: this.id,
      enabled,
    });
  }

  // --- Revolute/Prismatic only ---
  async limitsEnabled(): Promise<boolean> {
    return (
      await messageWorkerAsync<JointLimitsEnabledResponse>({
        type: PhysicsProtocolType.JOINT_LIMITS_ENABLED,
        jointId: this.id,
      })
    ).limitsEnabled;
  }
  limitsEnabledSync(): boolean {
    throw new Error('Sync limitsEnabled not supported on Proxy');
  }
  setLimits(min: number, max: number): void {
    messageWorker({ type: PhysicsProtocolType.JOINT_SET_LIMITS, jointId: this.id, min, max });
  }
  configureMotorModel(model: JointMotorModel): void {
    messageWorker({
      type: PhysicsProtocolType.JOINT_CONFIGURE_MOTOR_MODEL,
      jointId: this.id,
      model,
    });
  }
  configureMotorVelocity(targetVel: number, factor: number): void {
    messageWorker({
      type: PhysicsProtocolType.JOINT_CONFIGURE_MOTOR_VELOCITY,
      jointId: this.id,
      targetVel,
      factor,
    });
  }
  configureMotorPosition(targetPos: number, stiffness: number, damping: number): void {
    messageWorker({
      type: PhysicsProtocolType.JOINT_CONFIGURE_MOTOR_POSITION,
      jointId: this.id,
      targetPos,
      stiffness,
      damping,
    });
  }
  configureMotor(targetPos: number, targetVel: number, stiffness: number, damping: number): void {
    messageWorker({
      type: PhysicsProtocolType.JOINT_CONFIGURE_MOTOR,
      jointId: this.id,
      targetPos,
      targetVel,
      stiffness,
      damping,
    });
  }
}
