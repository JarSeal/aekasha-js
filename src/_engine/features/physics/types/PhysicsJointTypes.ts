import type { PhysRotation, PhysVector } from './PhysicsCommonTypes';

/**
 * Joint axes bitmask for GENERIC joints: the axes it ORs together are the ones the joint
 * **locks**, in the joint's frame, whose x axis is `JointParams`' `axis` (e.g.
 * `JointAxesMask.AngX | JointAxesMask.AngY` locks the X and Y rotational axes). Mirrors Rapier's
 * own JointAxesMask bit values (its raw binding names the argument `lockedAxes`) so app-facing
 * code never has to import RAPIER directly — consistent with how RigidBodyTypeAPI decouples app
 * code from raw Rapier enums.
 */
export enum JointAxesMask {
  /** Translation along the joint's x axis. */
  LinX = 1,
  /** Translation along the joint's y axis. */
  LinY = 2,
  /** Translation along the joint's z axis. */
  LinZ = 4,
  /** Rotation around the joint's x axis. */
  AngX = 8,
  /** Rotation around the joint's y axis. */
  AngY = 16,
  /** Rotation around the joint's z axis. */
  AngZ = 32,
}

/** Mirrors Rapier's MotorModel enum as a local string union, decoupling app code from the
 * raw Rapier enum. Only meaningful for Revolute/Prismatic joints: `'ACCELERATION_BASED'`
 * (Rapier's default) reads the motor's stiffness and damping as accelerations, whatever the
 * bodies' mass, `'FORCE_BASED'` as forces. */
export type JointMotorModel = 'ACCELERATION_BASED' | 'FORCE_BASED';

/**
 * Params for creating an impulse joint connecting two rigid bodies (by id). A discriminated
 * union on `type`, mirroring ColliderParams' shape/style. Every type has `body1Id` / `body2Id`
 * (the bodies), `anchor1` / `anchor2` (where it holds each, in that body's local space), `wakeUp`
 * (wake the bodies, default true) and `userData`.
 * - `'FIXED'`: no relative motion; `frame1` / `frame2` are each side's rotation of the joint.
 * - `'REVOLUTE'`: a hinge turning around `axis`.
 * - `'PRISMATIC'`: a slider along `axis`.
 * - `'SPHERICAL'`: a ball joint, free rotation around the anchors.
 * - `'ROPE'`: the anchors at most `length` apart.
 * - `'SPRING'`: the anchors pulled toward `restLength` apart with `stiffness` and `damping`.
 * - `'GENERIC'`: the axes in `axesMask` ({@link JointAxesMask}) locked, in a frame whose x axis is
 *   `axis`.
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

// p250
/**
 * Params for creating a multibody joint: {@link JointParams}' `FIXED`, `REVOLUTE`,
 * `PRISMATIC` and `SPHERICAL` shapes, with `body1Id` the parent and `body2Id` the child. Joined
 * this way, bodies form a tree (a multibody) solved in reduced coordinates: no drift between them.
 * @remarks Rapier panics on what a multibody can't be, so the engine refuses it first, throwing
 * (rejecting on `WORKER_THREAD`): a child that isn't `DYNAMIC` or already has a parent, a parent
 * that isn't `DYNAMIC` unless it's its multibody's root, and a joint closing a loop (an impulse
 * joint closes one). A link with a parent can't be made fixed or kinematic later either
 * (`setBodyType` throws), and ignores `setTranslation` / `setRotation`: move its root, which takes
 * the chain along. A kinematic root ignores kinematic targets and velocities: move it with
 * `setTranslation`.
 */
export type MultibodyJointParams = Extract<
  JointParams,
  { type: 'FIXED' | 'REVOLUTE' | 'PRISMATIC' | 'SPHERICAL' }
>;

// p250
/**
 * A multibody joint connecting a parent and a child rigid body (by id). Rapier's multibody
 * joints have no anchor getters, limits or motors, so it has fewer methods than {@link JointAPI}.
 * @remarks On MAIN_THREAD every query answers at once. On WORKER_THREAD the async forms ask the
 * worker and the `*Sync` twins throw, except `getUserDataSync`, `body1IdSync` and `body2IdSync`,
 * which answer from the proxy's own copy. Setters are one-way: on WORKER_THREAD they apply at the
 * worker's next step.
 */
export type MultibodyJointAPI = {
  /** Multibody joint id (a running integer id, its own: not an impulse joint's). */
  readonly id: number;

  /** Set when the facade deletes the joint, with a body it joins or its world too: true for a
   * reference kept past the delete. */
  isBeingDeleted: boolean;

  /** The user data as this side last saw it (set here, or fetched by `getUserData`). */
  uData: Record<string, unknown>;
  /** The user data, fetched from the worker on WORKER_THREAD (and kept in `uData`). */
  getUserData(): Promise<Record<string, unknown>>;
  /** The user data as `uData` holds it, in both worker targets. */
  getUserDataSync(): Record<string, unknown>;
  /** Replaces the user data, or merges `userData` into it with `addToExisting`. */
  setUserData(userData?: Record<string, unknown>, addToExisting?: boolean): void;

  /** Whether the joint still exists in the world. */
  isValid(): Promise<boolean>;
  /** `isValid()` without the wait: MAIN_THREAD only. */
  isValidSync(): boolean;

  /** The parent body's id. */
  body1Id(): Promise<number>;
  /** The parent body's id, in both worker targets. */
  body1IdSync(): number;
  /** The child body's id. */
  body2Id(): Promise<number>;
  /** The child body's id, in both worker targets. */
  body2IdSync(): number;

  /** Whether the two bodies collide with each other (true by default). */
  contactsEnabled(): Promise<boolean>;
  /** `contactsEnabled()` without the wait: MAIN_THREAD only. */
  contactsEnabledSync(): boolean;
  /** Lets the two bodies collide with each other or not. */
  setContactsEnabled(enabled: boolean): void;
};

/**
 * An impulse joint connecting two rigid bodies (by id). Covers creation, anchors, contacts,
 * and (for Revolute/Prismatic only) limits and motor config — not every method Rapier
 * exposes (e.g. frameX1()/frameX2() orientation getters/setters are skipped as low-value
 * for v1). The limits/motor methods throw when called on a joint that isn't Revolute or
 * Prismatic (Rapier's UnitImpulseJoint subset).
 * @remarks Every query has an async form and a `*Sync` twin. On MAIN_THREAD both answer at
 * once. On WORKER_THREAD the async form asks the worker and the `*Sync` twin throws, except
 * `getUserDataSync`, `body1IdSync` and `body2IdSync`, which answer from the proxy's own copy.
 * Setters are one-way: on WORKER_THREAD they apply at the worker's next step.
 */
export type JointAPI = {
  /** Joint id (a running integer id). */
  readonly id: number;

  /** Set when the facade deletes the joint, with a body it joins or its world too: true for a
   * reference kept past the delete. */
  isBeingDeleted: boolean;

  /** The user data as this side last saw it (set here, or fetched by `getUserData`). */
  uData: Record<string, unknown>;
  /** The user data, fetched from the worker on WORKER_THREAD (and kept in `uData`). */
  getUserData(): Promise<Record<string, unknown>>;
  /** The user data as `uData` holds it, in both worker targets. */
  getUserDataSync(): Record<string, unknown>;
  /** Replaces the user data, or merges `userData` into it with `addToExisting`. */
  setUserData(userData?: Record<string, unknown>, addToExisting?: boolean): void;

  /** Whether the joint still exists in the world. */
  isValid(): Promise<boolean>;
  /** `isValid()` without the wait: MAIN_THREAD only. */
  isValidSync(): boolean;

  /** The first body's id. */
  body1Id(): Promise<number>;
  /** The first body's id, in both worker targets. */
  body1IdSync(): number;
  /** The second body's id. */
  body2Id(): Promise<number>;
  /** The second body's id, in both worker targets. */
  body2IdSync(): number;

  /** Where the joint holds the first body, in its local space. */
  anchor1(): Promise<PhysVector>;
  /** `anchor1()` without the wait: MAIN_THREAD only. */
  anchor1Sync(): PhysVector;
  /** Where the joint holds the second body, in its local space. */
  anchor2(): Promise<PhysVector>;
  /** `anchor2()` without the wait: MAIN_THREAD only. */
  anchor2Sync(): PhysVector;

  /** Whether the two bodies collide with each other (true by default). */
  contactsEnabled(): Promise<boolean>;
  /** `contactsEnabled()` without the wait: MAIN_THREAD only. */
  contactsEnabledSync(): boolean;
  /** Lets the two bodies collide with each other or not. */
  setContactsEnabled(enabled: boolean): void;

  // Revolute/Prismatic (UnitImpulseJoint) only — throws for every other joint type.
  /** Whether `setLimits` limits the joint (Revolute/Prismatic only). */
  limitsEnabled(): Promise<boolean>;
  /** `limitsEnabled()` without the wait: MAIN_THREAD only. */
  limitsEnabledSync(): boolean;
  /** Limits the angle (Revolute, radians) or the distance (Prismatic) to [min, max]. */
  setLimits(min: number, max: number): void;
  /** Sets how the motor's stiffness and damping are read (Revolute/Prismatic only). */
  configureMotorModel(model: JointMotorModel): void;
  /** Drives the joint toward `targetVel` with the strength `factor` (Revolute/Prismatic only). */
  configureMotorVelocity(targetVel: number, factor: number): void;
  /** Drives the joint toward `targetPos` like a spring (Revolute/Prismatic only). */
  configureMotorPosition(targetPos: number, stiffness: number, damping: number): void;
  /** Drives the joint toward a position and a velocity at once (Revolute/Prismatic only). */
  configureMotor(targetPos: number, targetVel: number, stiffness: number, damping: number): void;
};
