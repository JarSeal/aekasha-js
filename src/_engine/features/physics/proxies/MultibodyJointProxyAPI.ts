// The WORKER_THREAD multibody joint (p250): each call a message to the worker.

import { commandWorker, queryWorker, throwWorkerSync } from '../PhysicsMessaging';
import type { PhysicsCommandFor, PhysicsQueryType } from '../PhysicsMessaging';
import { PhysicsProtocolType } from '../protocol/PhysicsProtocolType';
import type { MultibodyJointAPI } from '../types/PhysicsJointTypes';

/** The `*Sync` twins this proxy can't answer: their value is the worker's. */
const asyncOnly = (getter: string): never => throwWorkerSync('MultibodyJointAPI', getter);

/**
 * A multibody joint in WORKER_THREAD mode: each call is a message to the worker, its two bodies
 * known from its creation.
 * @internal
 */
export class MultibodyJointProxyAPI implements MultibodyJointAPI {
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
  private command(message: PhysicsCommandFor<'multibodyJointId'>) {
    commandWorker(message, 'multibodyJointId', this.id);
  }

  /** A query for one of this joint's fields. */
  private ask<T extends PhysicsQueryType<'multibodyJointId'>>(type: T) {
    return queryWorker(type, 'multibodyJointId', this.id);
  }

  // --- Metadata ---
  async getUserData(): Promise<Record<string, unknown>> {
    const res = await this.ask(PhysicsProtocolType.MULTIBODY_JOINT_GET_USERDATA);
    this.uData = res.userData;
    return res.userData;
  }
  getUserDataSync(): Record<string, unknown> {
    return this.uData;
  }
  setUserData(userData: Record<string, unknown>, addToExisting?: boolean): void {
    this.uData = addToExisting ? { ...this.uData, ...userData } : userData;
    this.command({
      type: PhysicsProtocolType.MULTIBODY_JOINT_SET_USERDATA,
      userData,
      addToExisting,
      isOneWay: true,
    });
  }

  async isValid(): Promise<boolean> {
    return (await this.ask(PhysicsProtocolType.MULTIBODY_JOINT_IS_VALID)).isValid;
  }
  isValidSync(): boolean {
    return asyncOnly('isValid');
  }

  // A joint's bodies never change, so they're known here from its creation params
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

  async contactsEnabled(): Promise<boolean> {
    return (await this.ask(PhysicsProtocolType.MULTIBODY_JOINT_CONTACTS_ENABLED)).contactsEnabled;
  }
  contactsEnabledSync(): boolean {
    return asyncOnly('contactsEnabled');
  }
  setContactsEnabled(enabled: boolean): void {
    this.command({ type: PhysicsProtocolType.MULTIBODY_JOINT_SET_CONTACTS_ENABLED, enabled });
  }
}
