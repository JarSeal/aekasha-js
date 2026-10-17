// The WORKER_THREAD impulse joint: each call a message to the worker.

import { commandWorker, queryWorker, throwWorkerSync } from '../PhysicsMessaging';
import type { PhysicsCommandFor, PhysicsQueryType } from '../PhysicsMessaging';
import { PhysicsProtocolType } from '../protocol/PhysicsProtocolType';
import type { PhysVector } from '../types/PhysicsCommonTypes';
import type { JointAPI, JointMotorModel } from '../types/PhysicsJointTypes';

/** The `*Sync` twins this proxy can't answer: their value is the worker's. */
const asyncOnly = (getter: string): never => throwWorkerSync('JointAPI', getter);

/**
 * An impulse joint in WORKER_THREAD mode: each call is a message to the worker, its two bodies
 * known from its creation.
 * @internal
 */
export class JointProxyAPI implements JointAPI {
  uData: Record<string, unknown> = {};

  isBeingDeleted: boolean = false;

  /** The proxy of a joint the worker made: its two bodies are its params', which never change. */
  constructor(
    /** The joint's id. */
    public id: number,
    private _body1Id: number,
    private _body2Id: number,
    userData?: Record<string, unknown>
  ) {
    if (userData) this.uData = userData;
  }

  /** A one-way command about this joint. */
  private command(message: PhysicsCommandFor<'jointId'>) {
    commandWorker(message, 'jointId', this.id);
  }

  /** A query for one of this joint's fields. */
  private ask<T extends PhysicsQueryType<'jointId'>>(type: T) {
    return queryWorker(type, 'jointId', this.id);
  }

  // --- Metadata ---
  async getUserData(): Promise<Record<string, unknown>> {
    const res = await this.ask(PhysicsProtocolType.JOINT_GET_USERDATA);
    this.uData = res.userData;
    return res.userData;
  }
  getUserDataSync(): Record<string, unknown> {
    return this.uData;
  }
  setUserData(userData: Record<string, unknown>, addToExisting?: boolean): void {
    this.uData = addToExisting ? { ...this.uData, ...userData } : userData;
    this.command({
      type: PhysicsProtocolType.JOINT_SET_USERDATA,
      userData,
      addToExisting,
      isOneWay: true,
    });
  }

  async isValid(): Promise<boolean> {
    return (await this.ask(PhysicsProtocolType.JOINT_IS_VALID)).isValid;
  }
  isValidSync(): boolean {
    return asyncOnly('isValid');
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
    return (await this.ask(PhysicsProtocolType.JOINT_ANCHOR1)).anchor1;
  }
  anchor1Sync(): PhysVector {
    return asyncOnly('anchor1');
  }
  async anchor2(): Promise<PhysVector> {
    return (await this.ask(PhysicsProtocolType.JOINT_ANCHOR2)).anchor2;
  }
  anchor2Sync(): PhysVector {
    return asyncOnly('anchor2');
  }

  async contactsEnabled(): Promise<boolean> {
    return (await this.ask(PhysicsProtocolType.JOINT_CONTACTS_ENABLED)).contactsEnabled;
  }
  contactsEnabledSync(): boolean {
    return asyncOnly('contactsEnabled');
  }
  setContactsEnabled(enabled: boolean): void {
    this.command({ type: PhysicsProtocolType.JOINT_SET_CONTACTS_ENABLED, enabled });
  }

  // --- Revolute/Prismatic only ---
  async limitsEnabled(): Promise<boolean> {
    return (await this.ask(PhysicsProtocolType.JOINT_LIMITS_ENABLED)).limitsEnabled;
  }
  limitsEnabledSync(): boolean {
    return asyncOnly('limitsEnabled');
  }
  setLimits(min: number, max: number): void {
    this.command({ type: PhysicsProtocolType.JOINT_SET_LIMITS, min, max });
  }
  configureMotorModel(model: JointMotorModel): void {
    this.command({ type: PhysicsProtocolType.JOINT_CONFIGURE_MOTOR_MODEL, model });
  }
  configureMotorVelocity(targetVel: number, factor: number): void {
    this.command({ type: PhysicsProtocolType.JOINT_CONFIGURE_MOTOR_VELOCITY, targetVel, factor });
  }
  configureMotorPosition(targetPos: number, stiffness: number, damping: number): void {
    this.command({
      type: PhysicsProtocolType.JOINT_CONFIGURE_MOTOR_POSITION,
      targetPos,
      stiffness,
      damping,
    });
  }
  configureMotor(targetPos: number, targetVel: number, stiffness: number, damping: number): void {
    this.command({
      type: PhysicsProtocolType.JOINT_CONFIGURE_MOTOR,
      targetPos,
      targetVel,
      stiffness,
      damping,
    });
  }
}
