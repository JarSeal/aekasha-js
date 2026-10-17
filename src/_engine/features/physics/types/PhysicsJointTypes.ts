import type { PhysRotation, PhysVector } from './PhysicsCommonTypes';

/**
 * Joint axes bitmask for GENERIC joints. ORed together to select which axes stay free
 * (e.g. `JointAxesMask.AngX | JointAxesMask.AngY` frees the X and Y rotational axes).
 * Mirrors Rapier's own JointAxesMask bit values
 * (node_modules/@dimforge/rapier3d-compat/dynamics/impulse_joint.d.ts) so app-facing code
 * never has to import RAPIER directly — consistent with how RigidBodyTypeAPI decouples app
 * code from raw Rapier enums.
 */
export enum JointAxesMask {
  LinX = 1,
  LinY = 2,
  LinZ = 4,
  AngX = 8,
  AngY = 16,
  AngZ = 32,
}

/** Mirrors Rapier's MotorModel enum as a local string union, decoupling app code from the
 * raw Rapier enum. Only meaningful for Revolute/Prismatic joints. */
export type JointMotorModel = 'ACCELERATION_BASED' | 'FORCE_BASED';

/**
 * Params for creating an impulse joint connecting two rigid bodies (by id). A discriminated
 * union on `type`, mirroring ColliderParams' shape/style.
 */
export type JointParams =
  | {
      type: 'FIXED';
      body1Id: number;
      body2Id: number;
      anchor1: PhysVector;
      frame1: PhysRotation;
      anchor2: PhysVector;
      frame2: PhysRotation;
      wakeUp?: boolean;
      userData?: Record<string, unknown>;
    }
  | {
      type: 'REVOLUTE';
      body1Id: number;
      body2Id: number;
      anchor1: PhysVector;
      anchor2: PhysVector;
      axis: PhysVector;
      wakeUp?: boolean;
      userData?: Record<string, unknown>;
    }
  | {
      type: 'PRISMATIC';
      body1Id: number;
      body2Id: number;
      anchor1: PhysVector;
      anchor2: PhysVector;
      axis: PhysVector;
      wakeUp?: boolean;
      userData?: Record<string, unknown>;
    }
  | {
      type: 'SPHERICAL';
      body1Id: number;
      body2Id: number;
      anchor1: PhysVector;
      anchor2: PhysVector;
      wakeUp?: boolean;
      userData?: Record<string, unknown>;
    }
  | {
      type: 'ROPE';
      body1Id: number;
      body2Id: number;
      length: number;
      anchor1: PhysVector;
      anchor2: PhysVector;
      wakeUp?: boolean;
      userData?: Record<string, unknown>;
    }
  | {
      type: 'SPRING';
      body1Id: number;
      body2Id: number;
      restLength: number;
      stiffness: number;
      damping: number;
      anchor1: PhysVector;
      anchor2: PhysVector;
      wakeUp?: boolean;
      userData?: Record<string, unknown>;
    }
  | {
      type: 'GENERIC';
      body1Id: number;
      body2Id: number;
      anchor1: PhysVector;
      anchor2: PhysVector;
      axis: PhysVector;
      axesMask: number;
      wakeUp?: boolean;
      userData?: Record<string, unknown>;
    };

/**
 * An impulse joint connecting two rigid bodies (by id). Covers creation, anchors, contacts,
 * and (for Revolute/Prismatic only) limits and motor config — not every method Rapier
 * exposes (e.g. frameX1()/frameX2() orientation getters/setters are skipped as low-value
 * for v1). The limits/motor methods throw when called on a joint that isn't Revolute or
 * Prismatic (Rapier's UnitImpulseJoint subset).
 */
export type JointAPI = {
  readonly id: number;

  isBeingDeleted: boolean;

  uData: Record<string, unknown>;
  getUserData(): Promise<Record<string, unknown>>;
  getUserDataSync(): Record<string, unknown>;
  setUserData(userData?: Record<string, unknown>, addToExisting?: boolean): void;

  isValid(): Promise<boolean>;
  isValidSync(): boolean;

  body1Id(): Promise<number>;
  body1IdSync(): number;
  body2Id(): Promise<number>;
  body2IdSync(): number;

  anchor1(): Promise<PhysVector>;
  anchor1Sync(): PhysVector;
  anchor2(): Promise<PhysVector>;
  anchor2Sync(): PhysVector;

  contactsEnabled(): Promise<boolean>;
  contactsEnabledSync(): boolean;
  setContactsEnabled(enabled: boolean): void;

  // Revolute/Prismatic (UnitImpulseJoint) only — throws for every other joint type.
  limitsEnabled(): Promise<boolean>;
  limitsEnabledSync(): boolean;
  setLimits(min: number, max: number): void;
  configureMotorModel(model: JointMotorModel): void;
  configureMotorVelocity(targetVel: number, factor: number): void;
  configureMotorPosition(targetPos: number, stiffness: number, damping: number): void;
  configureMotor(targetPos: number, targetVel: number, stiffness: number, damping: number): void;
};
