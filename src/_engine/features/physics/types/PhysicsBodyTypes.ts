import type { ColliderAPI } from './PhysicsColliderTypes';
import type { OmitSync, PhysRotation, PhysVector } from './PhysicsCommonTypes';

/** What a reattached body (p352 REMOVED tier) comes back as; everything else is as detached. */
export type RigidBodyAttachState = {
  /** The type it comes back with. */
  bodyType: RigidBodyTypeAPI;
  /** Whether it comes back enabled. */
  enabled: boolean;
};

/** Dynamic bodies awake and asleep after the last measured step (step stats, p352). */
export type PhysicsBodyActivity = {
  /** Awake dynamic bodies. */
  awake: number;
  /** Sleeping dynamic bodies. */
  sleeping: number;
};

/**
 * The simulation status of a rigid-body.
 */
export enum RigidBodyTypeAPI {
  /**
   * A `RigidBodyType::Dynamic` body can be affected by all external forces.
   */
  Dynamic = 0,
  /**
   * A `RigidBodyType::Fixed` body cannot be affected by external forces.
   */
  Fixed = 1,
  /**
   * A `RigidBodyType::KinematicPositionBased` body cannot be affected by any external forces but can be controlled
   * by the user at the position level while keeping realistic one-way interaction with dynamic bodies.
   *
   * One-way interaction means that a kinematic body can push a dynamic body, but a kinematic body
   * cannot be pushed by anything. In other words, the trajectory of a kinematic body can only be
   * modified by the user and is independent from any contact or joint it is involved in.
   */
  KinematicPositionBased = 2,
  /**
   * A `RigidBodyType::KinematicVelocityBased` body cannot be affected by any external forces but can be controlled
   * by the user at the velocity level while keeping realistic one-way interaction with dynamic bodies.
   *
   * One-way interaction means that a kinematic body can push a dynamic body, but a kinematic body
   * cannot be pushed by anything. In other words, the trajectory of a kinematic body can only be
   * modified by the user and is independent from any contact or joint it is involved in.
   */
  KinematicVelocityBased = 3,
}

/** A rigid body's translation + rotation as plain data (e.g. in a worker reply). */
export type RigidBodyPose = {
  /** The translation. */
  pos: PhysVector;
  /** The rotation. */
  rot: PhysRotation;
};

/** Writable numeric array a pose is read into (see RigidBodyAPI.readPoseInto). */
export type PoseArray = Float32Array | Float64Array | number[];

/**
 * A rigid body, as `createRigidBody`, `getRigidBody` and a physics entity's `BODY_*` component
 * give it: Rapier's body API behind an engine-agnostic shape, the same in both worker targets.
 * @remarks Every query has an async form and a `*Sync` twin. On MAIN_THREAD both answer at
 * once. On WORKER_THREAD the async form asks the worker (the reply comes a frame or so later)
 * and the `*Sync` twin throws, except `getUserDataSync`, `bodyTypeSync` and `isEnabledSync`, which
 * answer from the proxy's own copy. The pose and velocities (`pos`, `rot`, `lvel`, `avel`, `translation()`,
 * `rotation()`, `linvel()`, `angvel()`, the `read*Into` methods) are synchronous in both: on
 * WORKER_THREAD they read the transform buffer the worker writes after each step, or a value
 * this body set and the buffer hasn't caught up with. Setters are one-way: on WORKER_THREAD they
 * apply at the worker's next step (inside an `APP_PHYSICS_STEP` system, right before that
 * sub-step).
 */
export type RigidBodyAPI = {
  /** Rigid body id (a running integer id). */
  readonly id: number;

  // --- Hot Path (Shared Memory / Sync Access) ---
  /** The translation (a new object per read; `readPoseInto` allocates nothing). */
  pos: PhysVector;
  /** The rotation (a new object per read). */
  rot: PhysRotation;
  /** The linear velocity (a new object per read; `readVelocitiesInto` allocates nothing). */
  lvel: PhysVector;
  /** The angular velocity (a new object per read). */
  avel: PhysVector;
  /** Allocation-free read of the pose for per-frame hot paths: writes the same values as
   * `pos`/`rot` (including a still-pending write in WORKER_THREAD mode) into `out` as
   * [posX, posY, posZ, rotX, rotY, rotZ, rotW], starting at `offset` (default 0) — instead of
   * two fresh objects per `pos`/`rot` read. */
  readPoseInto(out: PoseArray, offset?: number): void;
  /** The velocity twin of `readPoseInto`: writes the same values as `lvel`/`avel` (including a
   * still-pending write in WORKER_THREAD mode) into `out` as
   * [linvelX, linvelY, linvelZ, angvelX, angvelY, angvelZ], starting at `offset` (default 0). */
  readVelocitiesInto(out: PoseArray, offset?: number): void;

  /** Set when the facade deletes the body, its world included: true for a reference kept past
   * the delete. */
  isBeingDeleted: boolean;

  // --- Metadata & Validity ---
  /** The user data as this side last saw it (set here, or fetched by `getUserData`). */
  uData: Record<string, unknown>;
  /** The user data, fetched from the worker on WORKER_THREAD (and kept in `uData`). */
  getUserData(): Promise<Record<string, unknown>>;
  /** The user data as `uData` holds it, in both worker targets. */
  getUserDataSync(): Record<string, unknown>;
  /** Replaces the user data, or merges `userData` into it with `addToExisting`. */
  setUserData(userData?: Record<string, unknown>, addToExisting?: boolean): void;

  /** Whether the body still exists in the world. */
  isValid(): Promise<boolean>;
  /** `isValid()` without the wait: MAIN_THREAD only. */
  isValidSync(): boolean;

  // --- Transformation & Prediction ---
  /** The translation, as `pos`. */
  translation(): PhysVector;
  /** The rotation, as `rot`. */
  rotation(): PhysRotation;

  /** A kinematic body's translation at the end of the next step (its current one otherwise). */
  nextTranslation(): Promise<PhysVector>;
  /** `nextTranslation()` without the wait: MAIN_THREAD only. */
  nextTranslationSync(): PhysVector;
  /** A kinematic body's rotation at the end of the next step (its current one otherwise). */
  nextRotation(): Promise<PhysRotation>;
  /** `nextRotation()` without the wait: MAIN_THREAD only. */
  nextRotationSync(): PhysRotation;

  /** Teleports the body to `tra`, waking it when `wakeUp`. */
  setTranslation(tra: PhysVector, wakeUp: boolean): void;
  /** Sets the rotation at once, waking the body when `wakeUp`. */
  setRotation(rot: PhysRotation, wakeUp: boolean): void;

  /** For kinematic bodies: sets future transform for interpolation. */
  setNextKinematicTranslation(t: PhysVector): void;
  /** A position-based kinematic body's rotation to reach at the end of the next step. */
  setNextKinematicRotation(rot: PhysRotation): void;

  // --- Mass Properties ---
  /** The mass: its colliders' (volume × density) plus the additional mass. */
  mass(): Promise<number>;
  /** `mass()` without the wait: MAIN_THREAD only. */
  massSync(): number;
  /** The inverse of the mass (0 for an infinite mass). */
  invMass(): Promise<number>;
  /** `invMass()` without the wait: MAIN_THREAD only. */
  invMassSync(): number;
  /** The inverse mass per axis, after the translation locks (0 on a locked axis). */
  effectiveInvMass(): Promise<PhysVector>;
  /** `effectiveInvMass()` without the wait: MAIN_THREAD only. */
  effectiveInvMassSync(): PhysVector;

  /** The centre of mass in the body's local space. */
  localCom(): Promise<PhysVector>;
  /** `localCom()` without the wait: MAIN_THREAD only. */
  localComSync(): PhysVector;
  /** The centre of mass in world space. */
  worldCom(): Promise<PhysVector>;
  /** `worldCom()` without the wait: MAIN_THREAD only. */
  worldComSync(): PhysVector;

  /** The inverse of the principal angular inertia, per axis. */
  invPrincipalInertia(): Promise<PhysVector>;
  /** `invPrincipalInertia()` without the wait: MAIN_THREAD only. */
  invPrincipalInertiaSync(): PhysVector;
  /** The principal angular inertia, per axis. */
  principalInertia(): Promise<PhysVector>;
  /** `principalInertia()` without the wait: MAIN_THREAD only. */
  principalInertiaSync(): PhysVector;
  /** The rotation of the principal inertia's axes in the body's local space. */
  principalInertiaLocalFrame(): Promise<PhysRotation>;
  /** `principalInertiaLocalFrame()` without the wait: MAIN_THREAD only. */
  principalInertiaLocalFrameSync(): PhysRotation;

  /** Recomputes the mass properties from the colliders now, instead of at the next step. */
  recomputeMassPropertiesFromColliders(): void;
  /** Sets the mass added to the colliders' own, waking the body when `wakeUp`. */
  setAdditionalMass(mass: number, wakeUp: boolean): void;
  /** Sets the mass properties added to the colliders' own, waking the body when `wakeUp`. */
  setAdditionalMassProperties(
    mass: number,
    centerOfMass: PhysVector,
    principalAngularInertia: PhysVector,
    angularInertiaLocalFrame: PhysRotation,
    wakeUp: boolean
  ): void;

  // --- Dynamics & Velocity ---
  /** The linear velocity, as `lvel`. */
  linvel(): PhysVector;
  /** The angular velocity, as `avel`. */
  angvel(): PhysVector;
  /** The velocity of the body's point at `point` (world space). */
  velocityAtPoint(point: PhysVector): Promise<PhysVector>;
  /** `velocityAtPoint()` without the wait: MAIN_THREAD only. */
  velocityAtPointSync(point: PhysVector): PhysVector;

  /** Sets the linear velocity, waking the body when `wakeUp`. */
  setLinvel(vel: PhysVector, wakeUp: boolean): void;
  /** Sets the angular velocity, waking the body when `wakeUp`. */
  setAngvel(vel: PhysVector, wakeUp: boolean): void;

  /** The factor gravity is multiplied by for this body (1 by default). */
  gravityScale(): Promise<number>;
  /** `gravityScale()` without the wait: MAIN_THREAD only. */
  gravityScaleSync(): number;
  /** Sets the gravity factor, waking the body when `wakeUp`. */
  setGravityScale(factor: number, wakeUp: boolean): void;

  /** How fast the linear velocity decays (0 by default). */
  linearDamping(): Promise<number>;
  /** `linearDamping()` without the wait: MAIN_THREAD only. */
  linearDampingSync(): number;
  /** Sets how fast the linear velocity decays. */
  setLinearDamping(factor: number): void;
  /** How fast the angular velocity decays (0 by default). */
  angularDamping(): Promise<number>;
  /** `angularDamping()` without the wait: MAIN_THREAD only. */
  angularDampingSync(): number;
  /** Sets how fast the angular velocity decays. */
  setAngularDamping(factor: number): void;

  // --- Forces & Impulses (Fire-and-Forget) ---
  /** Removes the forces added with `addForce` / `addForceAtPoint`. */
  resetForces(wakeUp: boolean): void;
  /** Removes the torques added with `addTorque`. */
  resetTorques(wakeUp: boolean): void;
  /** Adds a force applied on every step until `resetForces`. */
  addForce(force: PhysVector, wakeUp: boolean): void;
  /** Adds a torque applied on every step until `resetTorques`. */
  addTorque(torque: PhysVector, wakeUp: boolean): void;
  /** Applies an impulse at the centre of mass once (a velocity change scaled by the mass). */
  applyImpulse(impulse: PhysVector, wakeUp: boolean): void;
  /** Applies an angular impulse once. */
  applyTorqueImpulse(torqueImpulse: PhysVector, wakeUp: boolean): void;
  /** Adds a force at a world-space point, applied on every step until `resetForces`. */
  addForceAtPoint(force: PhysVector, point: PhysVector, wakeUp: boolean): void;
  /** Applies an impulse at a world-space point once. */
  applyImpulseAtPoint(impulse: PhysVector, point: PhysVector, wakeUp: boolean): void;

  /** The sum of the forces added and not reset. */
  userForce(): Promise<PhysVector>;
  /** `userForce()` without the wait: MAIN_THREAD only. */
  userForceSync(): PhysVector;
  /** The sum of the torques added and not reset. */
  userTorque(): Promise<PhysVector>;
  /** `userTorque()` without the wait: MAIN_THREAD only. */
  userTorqueSync(): PhysVector;

  // --- Constraints & Locking ---
  /** Locks (or unlocks) every translation axis. */
  lockTranslations(locked: boolean, wakeUp: boolean): void;
  /** Locks (or unlocks) every rotation axis. */
  lockRotations(locked: boolean, wakeUp: boolean): void;
  /** Which translation axes the body may move along (false locks one). */
  setEnabledTranslations(x: boolean, y: boolean, z: boolean, wakeUp: boolean): void;
  /** Which rotation axes the body may turn around (false locks one). */
  setEnabledRotations(x: boolean, y: boolean, z: boolean, wakeUp: boolean): void;

  // --- Simulation Configuration ---
  /** The dominance group, -127 to 127: contacts never push a body of a higher group than the
   * other's. */
  dominanceGroup(): Promise<number>;
  /** `dominanceGroup()` without the wait: MAIN_THREAD only. */
  dominanceGroupSync(): number;
  /** Sets the dominance group, -127 to 127. */
  setDominanceGroup(group: number): void;

  /** Solver iterations this body adds to its island's (0 by default). */
  additionalSolverIterations(): Promise<number>;
  /** `additionalSolverIterations()` without the wait: MAIN_THREAD only. */
  additionalSolverIterationsSync(): number;
  /** Sets the solver iterations this body adds to its island's. */
  setAdditionalSolverIterations(iters: number): void;

  /** Turns continuous collision detection on or off (fast bodies through thin colliders). */
  enableCcd(enabled: boolean): void;
  /** Whether continuous collision detection is on. */
  isCcdEnabled(): Promise<boolean>;
  /** `isCcdEnabled()` without the wait: MAIN_THREAD only. */
  isCcdEnabledSync(): boolean;
  /** Sets the soft CCD prediction distance (0 turns it off): contacts predicted this far ahead. */
  setSoftCcdPrediction(distance: number): void;
  /** The soft CCD prediction distance. */
  softCcdPrediction(): Promise<number>;
  /** `softCcdPrediction()` without the wait: MAIN_THREAD only. */
  softCcdPredictionSync(): number;

  // --- State & Activation ---
  /** Puts the body to sleep. */
  sleep(): void;
  /** Wakes the body up. */
  wakeUp(): void;
  /** Whether the body takes part in the simulation (`setEnabled`). */
  isEnabled(): Promise<boolean>;
  /** `isEnabled()` without the wait: in both targets (WORKER_THREAD answers from the proxy's copy,
   * kept by `setEnabled` and the REMOVED tier's reattach). */
  isEnabledSync(): boolean;
  /** Takes the body (with its colliders) out of the simulation or puts it back, keeping it. */
  setEnabled(enabled: boolean): void;
  /** Whether the body sleeps. */
  isSleeping(): Promise<boolean>;
  /** `isSleeping()` without the wait: MAIN_THREAD only. */
  isSleepingSync(): boolean;
  /** Whether the body moved (or is set to move) this step. */
  isMoving(): Promise<boolean>;
  /** `isMoving()` without the wait: MAIN_THREAD only. */
  isMovingSync(): boolean;

  /** The body's type. */
  bodyType(): Promise<RigidBodyTypeAPI>;
  /** The body's type: on WORKER_THREAD from the proxy's copy (its creation type, and the
   * `setBodyType`s and REMOVED tier reattaches since). */
  bodyTypeSync(): RigidBodyTypeAPI;
  /** Changes the body's type, waking it when `wakeUp`. */
  setBodyType(type: RigidBodyTypeAPI, wakeUp: boolean): void;
  /** Whether the body is `Fixed`. */
  isFixed(): Promise<boolean>;
  /** `isFixed()` without the wait: MAIN_THREAD only. */
  isFixedSync(): boolean;
  /** Whether the body is one of the kinematic types. */
  isKinematic(): Promise<boolean>;
  /** `isKinematic()` without the wait: MAIN_THREAD only. */
  isKinematicSync(): boolean;
  /** Whether the body is `Dynamic`. */
  isDynamic(): Promise<boolean>;
  /** `isDynamic()` without the wait: MAIN_THREAD only. */
  isDynamicSync(): boolean;

  // --- Colliders ---
  /** How many colliders the body has. */
  numColliders(): Promise<number>;
  /** `numColliders()` without the wait: MAIN_THREAD only. */
  numCollidersSync(): number;
  /** Returns a ColliderAPI (Proxy on Main, Real on Worker) or an ID. */
  collider(i: number): Promise<ColliderAPI | number>;
  /** `collider(i)` without the wait: MAIN_THREAD only. */
  colliderSync(i: number): ColliderAPI | number;
};

/**
 * What `createRigidBody` and `createPhysicsEntity` make a body from. Everything but `rigidType`
 * is optional and left at Rapier's default when not given.
 */
export type RigidBodyParams = {
  /** Type of rigid body: `'POS_BASED'` and `'VELO_BASED'` are the kinematic types
   * (`RigidBodyTypeAPI.KinematicPositionBased` / `KinematicVelocityBased`). */
  rigidType: 'FIXED' | 'DYNAMIC' | 'POS_BASED' | 'VELO_BASED';

  /** Enabled */
  enabled?: boolean;

  /** Translation (position) */
  translation?: { x: number; y: number; z: number };

  /** Rotation (position) in quaternion */
  rotation?: { x: number; y: number; z: number; w: number };

  /** Linear (translation) velocity */
  linvel?: { x: number; y: number; z: number };

  /** Angular (rotation) velocity */
  angvel?: { x: number; y: number; z: number };

  /** Gravity scale */
  gravityScale?: number;

  /** Force to be applied (constant force) */
  force?: { x: number; y: number; z: number };

  /** Torque force to be applied (constant force) */
  torqueForce?: { x: number; y: number; z: number };

  /** Force at point to be applied (constant force) */
  forceAtPoint?: {
    /** The force. */
    force: { x: number; y: number; z: number };
    /** The world-space point it acts at. */
    point: { x: number; y: number; z: number };
  };

  /** Impulse force to be applied */
  impulse?: { x: number; y: number; z: number };

  /** Impulse torque force to be applied */
  torqueImpulse?: { x: number; y: number; z: number };

  /** Impulse at point to be applied once at creation */
  impulseAtPoint?: {
    /** The impulse. */
    force: { x: number; y: number; z: number };
    /** The world-space point it acts at. */
    point: { x: number; y: number; z: number };
  };

  /** Additional mass of the object. Rapier calculates mass = (Volume * Density) + AdditionalMass. Density is set for the collider. */
  additionalMass?: number;

  /** Translation locks: true locks the axis */
  lockTranslations?: { x: boolean; y: boolean; z: boolean };

  /** Rotation locks: true locks the axis */
  lockRotations?: { x: boolean; y: boolean; z: boolean };

  /** Linear damping (slowing down of movement, eg. air friction) */
  linearDamping?: number;

  /** Angular damping (slowing down of rotation, eg. air friction) */
  angularDamping?: number;

  /** Dominance group, from -127 to 127 (default 0) */
  dominance?: number;

  /** Continuous Collision Detection (CCD) enabled (default false) */
  ccdEnabled?: boolean;

  /** Soft CCD prediction distance */
  softCcdDistance?: number;

  /** Whether the body should be waken up or not (default true) */
  wakeUp?: boolean;

  /** User data to be added to the rigid body */
  userData?: Record<string, unknown>;
};

/**
 * What the worker proxy of a rigid body implements: {@link RigidBodyAPI} without the `*Sync`
 * twins, which it implements apart (most throw).
 * @internal
 */
export type RigidBodyWorkerEngine = OmitSync<RigidBodyAPI>;
