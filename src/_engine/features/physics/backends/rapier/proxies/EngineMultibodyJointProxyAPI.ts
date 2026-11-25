// The Rapier backend's multibody joint API object (p250).

import type Rapier from '@dimforge/rapier3d-compat';
import type { MultibodyJointAPI } from '../../../types/PhysicsJointTypes';
import { existsOrThrow } from '../../../../../utils/Assert';
import { getMultibodyJoint, multibodyJoints } from '../RapierState';

/**
 * A multibody joint as a {@link MultibodyJointAPI} on its Rapier joint. Its async forms run their
 * `*Sync` twins.
 * @internal
 */
export class EngineMultibodyJointProxyAPI implements MultibodyJointAPI {
  private joint: Rapier.MultibodyJoint;
  uData: Record<string, unknown> = {};

  isBeingDeleted: boolean = false;

  /** The proxy of a joint createMultibodyJoint just made (its Rapier joint found by `id`). */
  constructor(
    /** The joint's running id. */
    public id: number,
    private _body1Id: number,
    private _body2Id: number,
    userData?: Record<string, unknown>
  ) {
    if (userData) this.uData = userData;
    this.joint = existsOrThrow(
      getMultibodyJoint(id),
      `Could not find multibody joint in the engineAPI with id: ${id}`
    );
  }

  /** The Rapier joint, while the id is live: Rapier's handle is the child body's, so after a
   * delete the joint object would reach a joint made again on that child. */
  private liveJoint() {
    if (!multibodyJoints.has(this.id)) {
      throw new Error(`Multibody joint ${this.id} has been deleted.`);
    }
    return this.joint;
  }

  /**
   * Points the proxy at its copy in a restored world (p500).
   * @internal
   */
  _rebind(joint: Rapier.MultibodyJoint) {
    this.joint = joint;
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

  // Not liveJoint(): a deleted joint is just invalid
  isValidSync() {
    return multibodyJoints.has(this.id) && this.joint.isValid();
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

  contactsEnabledSync() {
    return this.liveJoint().contactsEnabled();
  }
  async contactsEnabled() {
    return this.contactsEnabledSync();
  }
  setContactsEnabled(enabled: boolean) {
    this.liveJoint().setContactsEnabled(enabled);
  }
}
