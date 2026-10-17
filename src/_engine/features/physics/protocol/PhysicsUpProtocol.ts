import type { LoopState } from '../../../kernel/loop/MainLoop';
import type {
  RigidBodyAttachState,
  RigidBodyParams,
  RigidBodyTypeAPI,
} from '../types/PhysicsBodyTypes';
import type {
  ColliderParams,
  InteractionGroupsAPI,
  ShapeParams,
} from '../types/PhysicsColliderTypes';
import type { PhysRotation, PhysVector } from '../types/PhysicsCommonTypes';
import type { PhysicsState } from '../types/PhysicsConfigTypes';
import type { JointMotorModel, JointParams } from '../types/PhysicsJointTypes';
import type { PhysRay, QueryFilterFlags } from '../types/PhysicsQueryTypes';
import type { PhysicsProtocolType } from './PhysicsProtocolType';

/**
 * Physics worker UP protocol (from main thread to worker): the requests (with a `requestId`,
 * answered by a `PhysicsDownProtocol` message of the same `type` or an `ERROR`) and the
 * one-way commands (`isOneWay`, or no reply expected). Plain data, through the physics transport
 * (`transport/PhysicsTransport.ts`, whose contract it keeps).
 * @internal
 */
export type PhysicsUpProtocol =
  // Engine --------------------------------------
  (
    | {
        type: PhysicsProtocolType.TAKE_SNAPSHOT;
      }
    | {
        type: PhysicsProtocolType.RESTORE_SNAPSHOT;
        snapshot: Uint8Array;
      }
    | {
        type: PhysicsProtocolType.INIT_PHYSICS;
        physicsState: PhysicsState;
        isDebugEnvironment: boolean;
        loopState: LoopState;
        doNotCreateWorld?: boolean;
        /** The main thread's `performance.timeOrigin`. A dedicated worker's `performance.now()`
         * counts from the worker's own creation, so the worker uses this to put the step stats'
         * timestamps (STEP `sentAt`, `stepEndAt`) on the main thread's clock. */
        mainTimeOrigin: number;
      }
    | {
        type: PhysicsProtocolType.STEP;
        /** How many fixed-timestep sub-steps to run before the single write-back
         * (computed by the main thread's accumulator in stepPhysics()). Default 1. */
        steps?: number;
        /** Per sub-step (index = sub-step), the one-way commands the main thread's
         * APP_PHYSICS_STEP systems issued for it — replayed right before that sub-step. */
        substepCommands?: PhysicsUpProtocol[][];
        /** Main thread's performance.now() at postMessage time, only stamped when
         * PhysicsState.stepStatsEnabled is on. The worker subtracts it from its own clock,
         * moved onto the main thread's time origin (INIT_PHYSICS `mainTimeOrigin`), to derive
         * the dispatch latency. */
        sentAt?: number;
      }
    | {
        type: PhysicsProtocolType.SET_DEBUG_STATE_TRACKING;
        /** Full replacement of the tracked set, not a delta. A body's/collider's position
         * in these arrays IS its slot in the debug-state buffer, so the sender already
         * knows the mapping and no slot allocator is needed on either side. */
        rigidBodyIds: number[];
        colliderIds: number[];
      }
    | {
        type: PhysicsProtocolType.SET_STEP_STATS;
        /** The worker's PhysicsState.stepStatsEnabled from the next STEP message on. */
        enabled: boolean;
      }
    | { type: PhysicsProtocolType.FLUSH }
    // World --------------------------------------
    | {
        type: PhysicsProtocolType.CREATE_WORLD;
        gravity: PhysVector;
        opts?: {
          timestep?: number;
          numSolverIterations?: number;
          numInternalPgsIterations?: number;
        };
      }
    | { type: PhysicsProtocolType.DELETE_WORLD }
    | { type: PhysicsProtocolType.WORLD_GET_GRAVITY }
    | { type: PhysicsProtocolType.WORLD_SET_GRAVITY; gravity: PhysVector }
    | {
        type: PhysicsProtocolType.WORLD_FREE;
      }
    | {
        type: PhysicsProtocolType.WORLD_PROPAGATE_POSITIONS;
      }
    | { type: PhysicsProtocolType.WORLD_GET_TIMESTEP }
    | {
        type: PhysicsProtocolType.WORLD_SET_TIMESTEP;
        dt: number;
      }
    | { type: PhysicsProtocolType.WORLD_GET_LENGTH_UNIT }
    | {
        type: PhysicsProtocolType.WORLD_SET_LENGTH_UNIT;
        unitsPerMeter: number;
      }
    | { type: PhysicsProtocolType.WORLD_GET_SOLVER_ITERS }
    | {
        type: PhysicsProtocolType.WORLD_SET_SOLVER_ITERS;
        niter: number;
      }
    | { type: PhysicsProtocolType.WORLD_GET_PGS_ITERS }
    | {
        type: PhysicsProtocolType.WORLD_SET_PGS_ITERS;
        niter: number;
      }
    | { type: PhysicsProtocolType.WORLD_GET_CCD_SUBSTEPS }
    | { type: PhysicsProtocolType.WORLD_SET_CCD_SUBSTEPS; substeps: number }
    // World queries --------------------------------------
    | {
        type: PhysicsProtocolType.WORLD_CAST_RAY;
        ray: PhysRay;
        maxToi: number;
        solid: boolean;
        filterFlags?: QueryFilterFlags;
        filterGroups?: InteractionGroupsAPI;
        filterExcludeCollider?: number;
        filterExcludeRigidBody?: number;
      }
    | {
        type: PhysicsProtocolType.WORLD_CAST_SHAPE;
        shapePos: PhysVector;
        shapeRot: PhysRotation;
        shapeVel: PhysVector;
        shape: ShapeParams;
        targetDistance: number;
        maxToi: number;
        stopAtPenetration: boolean;
        filterFlags?: QueryFilterFlags;
        filterGroups?: InteractionGroupsAPI;
        filterExcludeCollider?: number;
        filterExcludeRigidBody?: number;
      }
    | {
        type: PhysicsProtocolType.WORLD_CAST_RAY_AND_GET_NORMAL;
        ray: PhysRay;
        maxToi: number;
        solid: boolean;
        filterFlags?: QueryFilterFlags;
        filterGroups?: InteractionGroupsAPI;
        filterExcludeCollider?: number;
        filterExcludeRigidBody?: number;
      }
    | {
        type: PhysicsProtocolType.WORLD_INTERSECTIONS_WITH_RAY;
        ray: PhysRay;
        maxToi: number;
        solid: boolean;
        filterFlags?: QueryFilterFlags;
        filterGroups?: InteractionGroupsAPI;
        filterExcludeCollider?: number;
        filterExcludeRigidBody?: number;
      }
    | { type: PhysicsProtocolType.WORLD_CONTACT_PAIRS_WITH; colliderId: number }
    | { type: PhysicsProtocolType.WORLD_INTERSECTION_PAIRS_WITH; colliderId: number }
    | {
        type: PhysicsProtocolType.WORLD_INTERSECTION_PAIR;
        colliderId1: number;
        colliderId2: number;
      }
    // RigidBody --------------------------------------
    | { type: PhysicsProtocolType.CREATE_RIGID_BODY; params: RigidBodyParams }
    | {
        type: PhysicsProtocolType.CREATE_PHYSICS_ENTITY;
        rigidBody?: RigidBodyParams;
        /** Their parentId is set to the new body's id by the worker, when there is a body */
        colliders: ColliderParams[];
      }
    | { type: PhysicsProtocolType.CREATE_RIGID_BODIES; params: RigidBodyParams[] }
    | { type: PhysicsProtocolType.DELETE_RIGID_BODY; id: number }
    | { type: PhysicsProtocolType.DELETE_RIGID_BODIES; ids: number[] }
    | { type: PhysicsProtocolType.RIGID_DETACH; id: number }
    | { type: PhysicsProtocolType.RIGID_REATTACH; id: number; state: RigidBodyAttachState }
    | { type: PhysicsProtocolType.RIGID_READ_POSITIONS; ids: number[] }
    | { type: PhysicsProtocolType.RIGID_GET_USERDATA; rigidBodyId: number }
    | {
        type: PhysicsProtocolType.RIGID_SET_USERDATA;
        rigidBodyId: number;
        userData: Record<string, unknown>;
        addToExisting?: boolean;
      }
    | { type: PhysicsProtocolType.RIGID_IS_VALID; rigidBodyId: number }
    | {
        type: PhysicsProtocolType.RIGID_LOCK_TRANSLATIONS;
        rigidBodyId: number;
        locked: boolean;
        wakeUp: boolean;
      }
    | {
        type: PhysicsProtocolType.RIGID_LOCK_ROTATIONS;
        rigidBodyId: number;
        locked: boolean;
        wakeUp: boolean;
      }
    | {
        type: PhysicsProtocolType.RIGID_SET_ENABLED_TRANSLATIONS;
        rigidBodyId: number;
        enableX: boolean;
        enableY: boolean;
        enableZ: boolean;
        wakeUp: boolean;
      }
    | {
        type: PhysicsProtocolType.RIGID_SET_ENABLED_ROTATIONS;
        rigidBodyId: number;
        enableX: boolean;
        enableY: boolean;
        enableZ: boolean;
        wakeUp: boolean;
      }
    | { type: PhysicsProtocolType.RIGID_DOMINANCE_GROUP; rigidBodyId: number }
    | { type: PhysicsProtocolType.RIGID_SET_DOMINANCE_GROUP; group: number; rigidBodyId: number }
    | { type: PhysicsProtocolType.RIGID_ADDITIONAL_SOLVER_ITERATIONS; rigidBodyId: number }
    | {
        type: PhysicsProtocolType.RIGID_SET_ADDITIONAL_SOLVER_ITERATIONS;
        iters: number;
        rigidBodyId: number;
      }
    | { type: PhysicsProtocolType.RIGID_ENABLE_CCD; enabled: boolean; rigidBodyId: number }
    | {
        type: PhysicsProtocolType.RIGID_SET_SOFT_CCD_PREDICTION;
        distance: number;
        rigidBodyId: number;
      }
    | { type: PhysicsProtocolType.RIGID_SOFT_CCD_PREDICTION; rigidBodyId: number }
    | { type: PhysicsProtocolType.RIGID_NEXT_TRANSLATION; rigidBodyId: number }
    | { type: PhysicsProtocolType.RIGID_NEXT_ROTATION; rigidBodyId: number }
    | {
        type: PhysicsProtocolType.RIGID_SET_TRANSLATION;
        tra: PhysVector;
        wakeUp: boolean;
        rigidBodyId: number;
      }
    | {
        type: PhysicsProtocolType.RIGID_SET_LINVEL;
        vel: PhysVector;
        wakeUp: boolean;
        rigidBodyId: number;
      }
    | { type: PhysicsProtocolType.RIGID_GRAVITY_SCALE; rigidBodyId: number }
    | {
        type: PhysicsProtocolType.RIGID_SET_GRAVITY_SCALE;
        factor: number;
        wakeUp: boolean;
        rigidBodyId: number;
      }
    | {
        type: PhysicsProtocolType.RIGID_SET_ROTATION;
        rot: PhysRotation;
        wakeUp: boolean;
        rigidBodyId: number;
      }
    | {
        type: PhysicsProtocolType.RIGID_SET_ANGVEL;
        vel: PhysVector;
        wakeUp: boolean;
        rigidBodyId: number;
      }
    | {
        type: PhysicsProtocolType.RIGID_SET_NEXT_KINEMATIC_TRANSLATION;
        t: PhysVector;
        rigidBodyId: number;
      }
    | {
        type: PhysicsProtocolType.RIGID_SET_NEXT_KINEMATIC_ROTATION;
        rot: PhysRotation;
        rigidBodyId: number;
      }
    | { type: PhysicsProtocolType.RIGID_VELOCITY_AT_POINT; point: PhysVector; rigidBodyId: number }
    | { type: PhysicsProtocolType.RIGID_MASS; rigidBodyId: number }
    | { type: PhysicsProtocolType.RIGID_EFFECTIVE_INV_MASS; rigidBodyId: number }
    | { type: PhysicsProtocolType.RIGID_INV_MASS; rigidBodyId: number }
    | { type: PhysicsProtocolType.RIGID_LOCAL_COM; rigidBodyId: number }
    | { type: PhysicsProtocolType.RIGID_WORLD_COM; rigidBodyId: number }
    | { type: PhysicsProtocolType.RIGID_INV_PRINCIPAL_INERTIA; rigidBodyId: number }
    | { type: PhysicsProtocolType.RIGID_PRINCIPAL_INERTIA; rigidBodyId: number }
    | { type: PhysicsProtocolType.RIGID_PRINCIPAL_INERTIA_LOCAL_FRAME; rigidBodyId: number }
    | { type: PhysicsProtocolType.RIGID_SLEEP; rigidBodyId: number }
    | { type: PhysicsProtocolType.RIGID_WAKE_UP; rigidBodyId: number }
    | { type: PhysicsProtocolType.RIGID_IS_CCD_ENABLED; rigidBodyId: number }
    | { type: PhysicsProtocolType.RIGID_NUM_COLLIDERS; rigidBodyId: number }
    | { type: PhysicsProtocolType.RIGID_COLLIDER; rigidBodyId: number; index: number }
    | { type: PhysicsProtocolType.RIGID_SET_ENABLED; rigidBodyId: number; enabled: boolean }
    | { type: PhysicsProtocolType.RIGID_IS_ENABLED; rigidBodyId: number }
    | { type: PhysicsProtocolType.RIGID_BODY_TYPE; rigidBodyId: number }
    | {
        type: PhysicsProtocolType.RIGID_SET_BODY_TYPE;
        rigidBodyId: number;
        bodyType: RigidBodyTypeAPI;
        wakeUp: boolean;
      }
    | { type: PhysicsProtocolType.RIGID_IS_SLEEPING; rigidBodyId: number }
    | { type: PhysicsProtocolType.RIGID_IS_MOVING; rigidBodyId: number }
    | { type: PhysicsProtocolType.RIGID_IS_FIXED; rigidBodyId: number }
    | { type: PhysicsProtocolType.RIGID_IS_KINEMATIC; rigidBodyId: number }
    | { type: PhysicsProtocolType.RIGID_IS_DYNAMIC; rigidBodyId: number }
    | { type: PhysicsProtocolType.RIGID_LINEAR_DAMPING; rigidBodyId: number }
    | { type: PhysicsProtocolType.RIGID_ANGULAR_DAMPING; rigidBodyId: number }
    | { type: PhysicsProtocolType.RIGID_SET_LINEAR_DAMPING; rigidBodyId: number; factor: number }
    | { type: PhysicsProtocolType.RIGID_SET_ANGULAR_DAMPING; rigidBodyId: number; factor: number }
    | { type: PhysicsProtocolType.RIGID_RECOMPUTE_MASS_PROPERTIES; rigidBodyId: number }
    | {
        type: PhysicsProtocolType.RIGID_SET_ADDITIONAL_MASS;
        rigidBodyId: number;
        mass: number;
        wakeUp: boolean;
      }
    | {
        type: PhysicsProtocolType.RIGID_SET_ADDITIONAL_MASS_PROPERTIES;
        rigidBodyId: number;
        mass: number;
        centerOfMass: PhysVector;
        principalAngularInertia: PhysVector;
        angularInertiaLocalFrame: PhysRotation;
        wakeUp: boolean;
      }
    | { type: PhysicsProtocolType.RIGID_RESET_FORCES; rigidBodyId: number; wakeUp: boolean }
    | { type: PhysicsProtocolType.RIGID_RESET_TORQUES; rigidBodyId: number; wakeUp: boolean }
    | {
        type: PhysicsProtocolType.RIGID_ADD_FORCE;
        rigidBodyId: number;
        force: PhysVector;
        wakeUp: boolean;
      }
    | {
        type: PhysicsProtocolType.RIGID_APPLY_IMPULSE;
        rigidBodyId: number;
        impulse: PhysVector;
        wakeUp: boolean;
      }
    | {
        type: PhysicsProtocolType.RIGID_ADD_TORQUE;
        rigidBodyId: number;
        torque: PhysVector;
        wakeUp: boolean;
      }
    | {
        type: PhysicsProtocolType.RIGID_APPLY_TORQUE_IMPULSE;
        rigidBodyId: number;
        torqueImpulse: PhysVector;
        wakeUp: boolean;
      }
    | {
        type: PhysicsProtocolType.RIGID_ADD_FORCE_AT_POINT;
        rigidBodyId: number;
        force: PhysVector;
        point: PhysVector;
        wakeUp: boolean;
      }
    | {
        type: PhysicsProtocolType.RIGID_APPLY_IMPULSE_AT_POINT;
        rigidBodyId: number;
        impulse: PhysVector;
        point: PhysVector;
        wakeUp: boolean;
      }
    | { type: PhysicsProtocolType.RIGID_USER_FORCE; rigidBodyId: number }
    | { type: PhysicsProtocolType.RIGID_USER_TORQUE; rigidBodyId: number }
    // Collider --------------------------------------
    | { type: PhysicsProtocolType.CREATE_COLLIDER; params: ColliderParams; parentId?: number }
    | { type: PhysicsProtocolType.CREATE_COLLIDERS; params: ColliderParams[]; parentIds?: number[] }
    | { type: PhysicsProtocolType.DELETE_COLLIDER; id: number; wakeUp: boolean }
    | { type: PhysicsProtocolType.DELETE_COLLIDERS; ids: number[]; wakeUps: boolean[] }
    | { type: PhysicsProtocolType.COLL_GET_USERDATA; colliderId: number }
    | {
        type: PhysicsProtocolType.COLL_SET_USERDATA;
        colliderId: number;
        userData: Record<string, unknown>;
        addToExisting?: boolean;
      }
    | { type: PhysicsProtocolType.COLL_IS_VALID; colliderId: number }
    | { type: PhysicsProtocolType.COLL_TRANSLATION; colliderId: number }
    | { type: PhysicsProtocolType.COLL_ROTATION; colliderId: number }
    | { type: PhysicsProtocolType.COLL_TRANSLATION_WRT_PARENT; colliderId: number }
    | { type: PhysicsProtocolType.COLL_ROTATION_WRT_PARENT; colliderId: number }
    | { type: PhysicsProtocolType.COLL_SET_TRANSLATION; colliderId: number; tra: PhysVector }
    | { type: PhysicsProtocolType.COLL_SET_ROTATION; colliderId: number; rot: PhysRotation }
    | {
        type: PhysicsProtocolType.COLL_SET_TRANSLATION_WRT_PARENT;
        colliderId: number;
        tra: PhysVector;
      }
    | {
        type: PhysicsProtocolType.COLL_SET_ROTATION_WRT_PARENT;
        colliderId: number;
        rot: PhysRotation;
      }
    | { type: PhysicsProtocolType.COLL_IS_SENSOR; colliderId: number }
    | { type: PhysicsProtocolType.COLL_SET_SENSOR; colliderId: number; isSensor: boolean }
    | { type: PhysicsProtocolType.COLL_IS_ENABLED; colliderId: number }
    | { type: PhysicsProtocolType.COLL_SET_ENABLED; colliderId: number; enabled: boolean }
    | { type: PhysicsProtocolType.COLL_FRICTION; colliderId: number }
    | { type: PhysicsProtocolType.COLL_SET_FRICTION; colliderId: number; friction: number }
    | { type: PhysicsProtocolType.COLL_RESTITUTION; colliderId: number }
    | { type: PhysicsProtocolType.COLL_SET_RESTITUTION; colliderId: number; restitution: number }
    | { type: PhysicsProtocolType.COLL_MASS; colliderId: number }
    | { type: PhysicsProtocolType.COLL_DENSITY; colliderId: number }
    | { type: PhysicsProtocolType.COLL_SET_DENSITY; colliderId: number; density: number }
    | { type: PhysicsProtocolType.COLL_SET_MASS; colliderId: number; mass: number }
    | {
        type: PhysicsProtocolType.COLL_SET_MASS_PROPERTIES;
        colliderId: number;
        mass: number;
        centerOfMass: PhysVector;
        principalAngularInertia: PhysVector;
        angularInertiaLocalFrame: PhysRotation;
      }
    | { type: PhysicsProtocolType.COLL_SHAPE_TYPE; colliderId: number }
    | { type: PhysicsProtocolType.COLL_RADIUS; colliderId: number }
    | { type: PhysicsProtocolType.COLL_HALF_HEIGHT; colliderId: number }
    | { type: PhysicsProtocolType.COLL_HALF_EXTENTS; colliderId: number }
    | { type: PhysicsProtocolType.COLL_COLLISION_GROUPS; colliderId: number }
    | {
        type: PhysicsProtocolType.COLL_SET_COLLISION_GROUPS;
        colliderId: number;
        groups: InteractionGroupsAPI;
      }
    | { type: PhysicsProtocolType.COLL_SOLVER_GROUPS; colliderId: number }
    | {
        type: PhysicsProtocolType.COLL_SET_SOLVER_GROUPS;
        colliderId: number;
        groups: InteractionGroupsAPI;
      }
    | { type: PhysicsProtocolType.COLL_CONTAINS_POINT; colliderId: number; point: PhysVector }
    | { type: PhysicsProtocolType.COLL_VERTICES; colliderId: number }
    | { type: PhysicsProtocolType.COLL_INDICES; colliderId: number }
    | { type: PhysicsProtocolType.COLL_HEIGHTS; colliderId: number }
    | { type: PhysicsProtocolType.COLL_NORMAL; colliderId: number }
    | { type: PhysicsProtocolType.COLL_BORDER_RADIUS; colliderId: number }
    // Joint --------------------------------------
    | { type: PhysicsProtocolType.CREATE_JOINT; params: JointParams }
    | { type: PhysicsProtocolType.CREATE_JOINTS; params: JointParams[] }
    | { type: PhysicsProtocolType.DELETE_JOINT; id: number; wakeUp?: boolean }
    | { type: PhysicsProtocolType.DELETE_JOINTS; ids: number[]; wakeUps?: boolean[] }
    | { type: PhysicsProtocolType.JOINT_IS_VALID; jointId: number }
    | { type: PhysicsProtocolType.JOINT_BODY1_ID; jointId: number }
    | { type: PhysicsProtocolType.JOINT_BODY2_ID; jointId: number }
    | { type: PhysicsProtocolType.JOINT_ANCHOR1; jointId: number }
    | { type: PhysicsProtocolType.JOINT_ANCHOR2; jointId: number }
    | { type: PhysicsProtocolType.JOINT_SET_CONTACTS_ENABLED; jointId: number; enabled: boolean }
    | { type: PhysicsProtocolType.JOINT_CONTACTS_ENABLED; jointId: number }
    | { type: PhysicsProtocolType.JOINT_LIMITS_ENABLED; jointId: number }
    | { type: PhysicsProtocolType.JOINT_SET_LIMITS; jointId: number; min: number; max: number }
    | {
        type: PhysicsProtocolType.JOINT_CONFIGURE_MOTOR_MODEL;
        jointId: number;
        model: JointMotorModel;
      }
    | {
        type: PhysicsProtocolType.JOINT_CONFIGURE_MOTOR_VELOCITY;
        jointId: number;
        targetVel: number;
        factor: number;
      }
    | {
        type: PhysicsProtocolType.JOINT_CONFIGURE_MOTOR_POSITION;
        jointId: number;
        targetPos: number;
        stiffness: number;
        damping: number;
      }
    | {
        type: PhysicsProtocolType.JOINT_CONFIGURE_MOTOR;
        jointId: number;
        targetPos: number;
        targetVel: number;
        stiffness: number;
        damping: number;
      }
    | { type: PhysicsProtocolType.JOINT_GET_USERDATA; jointId: number }
    | {
        type: PhysicsProtocolType.JOINT_SET_USERDATA;
        jointId: number;
        userData: Record<string, unknown>;
        addToExisting?: boolean;
      }
  ) & { requestId?: number; isOneWay?: boolean };
