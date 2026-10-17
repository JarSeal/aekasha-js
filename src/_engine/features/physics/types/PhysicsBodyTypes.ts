import type { ColliderAPI } from './PhysicsColliderTypes';
import type { OmitSync, PhysRotation, PhysVector } from './PhysicsCommonTypes';

/** What a reattached body (p352 REMOVED tier) comes back as; everything else is as detached. */
export type RigidBodyAttachState = { bodyType: RigidBodyTypeAPI; enabled: boolean };

/** Dynamic bodies awake and asleep after the last measured step (step stats, p352). */
export type PhysicsBodyActivity = { awake: number; sleeping: number };

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
export type RigidBodyPose = { pos: PhysVector; rot: PhysRotation };

/** Writable numeric array a pose is read into (see RigidBodyAPI.readPoseInto). */
export type PoseArray = Float32Array | Float64Array | number[];

/**
 * A rigid-body.
 */
export type RigidBodyAPI = {
  /** Rigid body id (a running integer id). */
  readonly id: number;

  // --- Hot Path (Shared Memory / Sync Access) ---
  pos: PhysVector;
  rot: PhysRotation;
  lvel: PhysVector;
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

  isBeingDeleted: boolean;

  // --- Metadata & Validity ---
  uData: Record<string, unknown>;
  getUserData(): Promise<Record<string, unknown>>;
  getUserDataSync(): Record<string, unknown>;
  setUserData(userData?: Record<string, unknown>, addToExisting?: boolean): void;

  isValid(): Promise<boolean>;
  isValidSync(): boolean;

  // --- Transformation & Prediction ---
  translation(): PhysVector;
  rotation(): PhysRotation;

  nextTranslation(): Promise<PhysVector>;
  nextTranslationSync(): PhysVector;
  nextRotation(): Promise<PhysRotation>;
  nextRotationSync(): PhysRotation;

  setTranslation(tra: PhysVector, wakeUp: boolean): void;
  setRotation(rot: PhysRotation, wakeUp: boolean): void;

  /** For kinematic bodies: sets future transform for interpolation. */
  setNextKinematicTranslation(t: PhysVector): void;
  setNextKinematicRotation(rot: PhysRotation): void;

  // --- Mass Properties ---
  mass(): Promise<number>;
  massSync(): number;
  invMass(): Promise<number>;
  invMassSync(): number;
  effectiveInvMass(): Promise<PhysVector>;
  effectiveInvMassSync(): PhysVector;

  localCom(): Promise<PhysVector>;
  localComSync(): PhysVector;
  worldCom(): Promise<PhysVector>;
  worldComSync(): PhysVector;

  invPrincipalInertia(): Promise<PhysVector>;
  invPrincipalInertiaSync(): PhysVector;
  principalInertia(): Promise<PhysVector>;
  principalInertiaSync(): PhysVector;
  principalInertiaLocalFrame(): Promise<PhysRotation>;
  principalInertiaLocalFrameSync(): PhysRotation;

  recomputeMassPropertiesFromColliders(): void;
  setAdditionalMass(mass: number, wakeUp: boolean): void;
  setAdditionalMassProperties(
    mass: number,
    centerOfMass: PhysVector,
    principalAngularInertia: PhysVector,
    angularInertiaLocalFrame: PhysRotation,
    wakeUp: boolean
  ): void;

  // --- Dynamics & Velocity ---
  linvel(): PhysVector;
  angvel(): PhysVector;
  velocityAtPoint(point: PhysVector): Promise<PhysVector>;
  velocityAtPointSync(point: PhysVector): PhysVector;

  setLinvel(vel: PhysVector, wakeUp: boolean): void;
  setAngvel(vel: PhysVector, wakeUp: boolean): void;

  gravityScale(): Promise<number>;
  gravityScaleSync(): number;
  setGravityScale(factor: number, wakeUp: boolean): void;

  linearDamping(): Promise<number>;
  linearDampingSync(): number;
  setLinearDamping(factor: number): void;
  angularDamping(): Promise<number>;
  angularDampingSync(): number;
  setAngularDamping(factor: number): void;

  // --- Forces & Impulses (Fire-and-Forget) ---
  resetForces(wakeUp: boolean): void;
  resetTorques(wakeUp: boolean): void;
  addForce(force: PhysVector, wakeUp: boolean): void;
  addTorque(torque: PhysVector, wakeUp: boolean): void;
  applyImpulse(impulse: PhysVector, wakeUp: boolean): void;
  applyTorqueImpulse(torqueImpulse: PhysVector, wakeUp: boolean): void;
  addForceAtPoint(force: PhysVector, point: PhysVector, wakeUp: boolean): void;
  applyImpulseAtPoint(impulse: PhysVector, point: PhysVector, wakeUp: boolean): void;

  userForce(): Promise<PhysVector>;
  userForceSync(): PhysVector;
  userTorque(): Promise<PhysVector>;
  userTorqueSync(): PhysVector;

  // --- Constraints & Locking ---
  lockTranslations(locked: boolean, wakeUp: boolean): void;
  lockRotations(locked: boolean, wakeUp: boolean): void;
  setEnabledTranslations(x: boolean, y: boolean, z: boolean, wakeUp: boolean): void;
  setEnabledRotations(x: boolean, y: boolean, z: boolean, wakeUp: boolean): void;

  // --- Simulation Configuration ---
  dominanceGroup(): Promise<number>;
  dominanceGroupSync(): number;
  setDominanceGroup(group: number): void;

  additionalSolverIterations(): Promise<number>;
  additionalSolverIterationsSync(): number;
  setAdditionalSolverIterations(iters: number): void;

  enableCcd(enabled: boolean): void;
  isCcdEnabled(): Promise<boolean>;
  isCcdEnabledSync(): boolean;
  setSoftCcdPrediction(distance: number): void;
  softCcdPrediction(): Promise<number>;
  softCcdPredictionSync(): number;

  // --- State & Activation ---
  sleep(): void;
  wakeUp(): void;
  isEnabled(): Promise<boolean>;
  isEnabledSync(): boolean;
  setEnabled(enabled: boolean): void;
  isSleeping(): Promise<boolean>;
  isSleepingSync(): boolean;
  isMoving(): Promise<boolean>;
  isMovingSync(): boolean;

  bodyType(): Promise<RigidBodyTypeAPI>;
  bodyTypeSync(): RigidBodyTypeAPI;
  setBodyType(type: RigidBodyTypeAPI, wakeUp: boolean): void;
  isFixed(): Promise<boolean>;
  isFixedSync(): boolean;
  isKinematic(): Promise<boolean>;
  isKinematicSync(): boolean;
  isDynamic(): Promise<boolean>;
  isDynamicSync(): boolean;

  // --- Colliders ---
  numColliders(): Promise<number>;
  numCollidersSync(): number;
  /** Returns a ColliderAPI (Proxy on Main, Real on Worker) or an ID. */
  collider(i: number): Promise<ColliderAPI | number>;
  colliderSync(i: number): ColliderAPI | number;
};

export type RigidBodyParams = {
  /** Type of rigid body */
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
    force: { x: number; y: number; z: number };
    point: { x: number; y: number; z: number };
  };

  /** Impulse force to be applied */
  impulse?: { x: number; y: number; z: number };

  /** Impulse torque force to be applied */
  torqueImpulse?: { x: number; y: number; z: number };

  /** Impulse at point to be applied (constant force) */
  impulseAtPoint?: {
    force: { x: number; y: number; z: number };
    point: { x: number; y: number; z: number };
  };

  /** Additional mass of the object. Rapier calculates mass = (Volume * Density) + AdditionalMass. Density is set for the collider. */
  additionalMass?: number;

  /** Translation locks */
  lockTranslations?: { x: boolean; y: boolean; z: boolean };

  /** Rotation locks */
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

export type RigidBodyWorkerEngine = OmitSync<RigidBodyAPI>;
