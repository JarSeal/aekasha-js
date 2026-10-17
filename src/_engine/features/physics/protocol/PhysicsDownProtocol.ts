import type { RigidBodyPose, RigidBodyTypeAPI } from '../types/PhysicsBodyTypes';
import type {
  HeightFieldData,
  InteractionGroupsAPI,
  ShapeType,
} from '../types/PhysicsColliderTypes';
import type { PhysRotation, PhysVector } from '../types/PhysicsCommonTypes';
import type { CollisionEventRecord, ContactForceEventRecord } from '../types/PhysicsEventTypes';
import type {
  RayColliderHitAPI,
  RayColliderIntersectionAPI,
  ShapeCastHitAPI,
} from '../types/PhysicsQueryTypes';
import type { PhysicsProtocolType } from './PhysicsProtocolType';

/** Physics worker DOWN protocol (from worker to main thread) */
export type PhysicsDownProtocol =
  // Engine --------------------------------------
  (
    | {
        type: PhysicsProtocolType.TAKE_SNAPSHOT;
        snapshot: Uint8Array | undefined;
      }
    | {
        type: PhysicsProtocolType.RESTORE_SNAPSHOT;
        worldCreated: boolean;
      }
    | {
        type: PhysicsProtocolType.INIT_PHYSICS;
        worldCreated: boolean;
      }
    | { type: PhysicsProtocolType.FLUSH }
    // World --------------------------------------
    | {
        type: PhysicsProtocolType.CREATE_WORLD;
        worldCreated: boolean;
        /** Which hot-path transport the worker resolved to for this world. */
        transportMode?: 'SHARED_MEMORY' | 'MESSAGE_BATCH';
        /** Only present (and only a SharedArrayBuffer) when transportMode is 'SHARED_MEMORY'. */
        buffer?: ArrayBuffer | SharedArrayBuffer;
        /** Banks in `buffer` (PhysicsTransformBuffer), present with it, so the main-thread
         * wrapper uses the worker's layout instead of assuming one. */
        bankCount?: number;
        /** Step-statistics scratch buffer (p027), present whenever transportMode is
         * 'SHARED_MEMORY', whatever PhysicsState.stepStatsEnabled is, so the flag can be
         * switched at runtime. See PHYSICS_STEP_STATS_SLOTS for its layout. In MESSAGE_BATCH
         * mode the same numbers ride on TRANSFORMS_PUSH instead, so no buffer is handed over. */
        statsBuffer?: SharedArrayBuffer;
      }
    | { type: PhysicsProtocolType.DELETE_WORLD; worldDeleted: boolean }
    | {
        type: PhysicsProtocolType.WORLD_GET_GRAVITY;
        gravity: PhysVector;
      }
    | {
        type: PhysicsProtocolType.WORLD_GET_TIMESTEP;
        dt: number;
      }
    | {
        type: PhysicsProtocolType.WORLD_GET_LENGTH_UNIT;
        unitsPerMeter: number;
      }
    | {
        type: PhysicsProtocolType.WORLD_GET_SOLVER_ITERS;
        solverIterations: number;
      }
    | {
        type: PhysicsProtocolType.WORLD_GET_PGS_ITERS;
        internalPgsIterations: number;
      }
    | { type: PhysicsProtocolType.WORLD_GET_CCD_SUBSTEPS; substeps: number }
    // World query Results --------------------------------------
    | {
        type: PhysicsProtocolType.WORLD_CAST_RAY;
        hit: (Omit<RayColliderHitAPI, 'collider'> & { collider: number }) | null;
      }
    | {
        type: PhysicsProtocolType.WORLD_CAST_SHAPE;
        hit: (Omit<ShapeCastHitAPI, 'collider'> & { collider: number }) | null;
      }
    | {
        type: PhysicsProtocolType.WORLD_CAST_RAY_AND_GET_NORMAL;
        intersection: (Omit<RayColliderIntersectionAPI, 'collider'> & { collider: number }) | null;
      }
    | {
        type: PhysicsProtocolType.WORLD_INTERSECTIONS_WITH_RAY;
        intersections: (Omit<RayColliderIntersectionAPI, 'collider'> & { collider: number })[];
      }
    | { type: PhysicsProtocolType.WORLD_CONTACT_PAIRS_WITH; colliderIds: number[] }
    | { type: PhysicsProtocolType.WORLD_INTERSECTION_PAIRS_WITH; colliderIds: number[] }
    | { type: PhysicsProtocolType.WORLD_INTERSECTION_PAIR; isIntersecting: boolean }
    // Rigid body --------------------------------------
    | {
        type: PhysicsProtocolType.CREATE_RIGID_BODY;
        id: number;
        /** -1 for a FIXED body: it has no transform-buffer slot (p352) */
        slot: number;
        /** The new body's pose as Rapier reports it, readable before any transform write-back */
        pose: RigidBodyPose;
        /** Set (to maxBodies) when the transform buffer was full: nothing was created, and the
         * other fields mean nothing. */
        capacityExceeded?: number;
      }
    | {
        type: PhysicsProtocolType.CREATE_PHYSICS_ENTITY;
        /** The rigid body's id, slot and pose, as in CREATE_RIGID_BODY. Undefined id and pose
         * (and slot -1) when no rigid body was requested. */
        id?: number;
        slot: number;
        pose?: RigidBodyPose;
        colliderIds: number[];
        /** As in CREATE_RIGID_BODY: nothing was created, not even the colliders. */
        capacityExceeded?: number;
      }
    | {
        type: PhysicsProtocolType.CREATE_RIGID_BODIES;
        ids: number[];
        slots: number[];
        /** Per body, same as CREATE_RIGID_BODY's pose */
        poses: RigidBodyPose[];
        /** As in CREATE_RIGID_BODY: none of the bodies was created (all or nothing). */
        capacityExceeded?: number;
      }
    | {
        type: PhysicsProtocolType.DELETE_RIGID_BODY;
        id: number;
        colliderIds: number[];
        jointIds: number[];
      }
    | {
        type: PhysicsProtocolType.RIGID_DETACH;
        /** The detached body's pose; undefined when nothing was detached. */
        pose?: RigidBodyPose;
      }
    | {
        type: PhysicsProtocolType.RIGID_REATTACH;
        /** The body's new transform-buffer slot (-1 when nothing was reattached) */
        slot: number;
        /** The reattached body's pose; undefined when nothing was reattached. */
        pose?: RigidBodyPose;
        /** Set (to maxBodies) when the transform buffer was full: the body stays detached. */
        capacityExceeded?: number;
      }
    | {
        type: PhysicsProtocolType.RIGID_READ_POSITIONS;
        /** x, y, z per requested id (readBodyPositions), transferred */
        positions: Float32Array;
      }
    | {
        type: PhysicsProtocolType.DELETE_RIGID_BODIES;
        ids: number[];
        colliderIds: number[];
        jointIds: number[];
      }
    | { type: PhysicsProtocolType.RIGID_GET_USERDATA; userData: Record<string, unknown> }
    | { type: PhysicsProtocolType.RIGID_IS_VALID; isValid: boolean }
    | { type: PhysicsProtocolType.RIGID_DOMINANCE_GROUP; dominanceGroup: number }
    | { type: PhysicsProtocolType.RIGID_ADDITIONAL_SOLVER_ITERATIONS; additionalIterations: number }
    | { type: PhysicsProtocolType.RIGID_SOFT_CCD_PREDICTION; softCcdPrediction: number }
    | { type: PhysicsProtocolType.RIGID_TRANSLATION; translation: PhysVector }
    | { type: PhysicsProtocolType.RIGID_ROTATION; rotation: PhysRotation }
    | { type: PhysicsProtocolType.RIGID_NEXT_TRANSLATION; nextTranslation: PhysVector }
    | { type: PhysicsProtocolType.RIGID_NEXT_ROTATION; nextRotation: PhysRotation }
    | { type: PhysicsProtocolType.RIGID_GRAVITY_SCALE; gravityScale: number }
    | { type: PhysicsProtocolType.RIGID_LINVEL; linvel: PhysVector }
    | { type: PhysicsProtocolType.RIGID_VELOCITY_AT_POINT; velocityAtPoint: PhysVector }
    | { type: PhysicsProtocolType.RIGID_ANGVEL; angvel: PhysVector }
    | { type: PhysicsProtocolType.RIGID_MASS; mass: number }
    | { type: PhysicsProtocolType.RIGID_EFFECTIVE_INV_MASS; effectiveInvMass: PhysVector }
    | { type: PhysicsProtocolType.RIGID_INV_MASS; invMass: number }
    | { type: PhysicsProtocolType.RIGID_LOCAL_COM; localCom: PhysVector }
    | { type: PhysicsProtocolType.RIGID_WORLD_COM; worldCom: PhysVector }
    | { type: PhysicsProtocolType.RIGID_INV_PRINCIPAL_INERTIA; invPrincipalInertia: PhysVector }
    | { type: PhysicsProtocolType.RIGID_PRINCIPAL_INERTIA; principalInertia: PhysVector }
    | {
        type: PhysicsProtocolType.RIGID_PRINCIPAL_INERTIA_LOCAL_FRAME;
        principalInertiaLocalFrame: PhysRotation;
      }
    | { type: PhysicsProtocolType.RIGID_IS_CCD_ENABLED; isCcdEnabled: boolean }
    | { type: PhysicsProtocolType.RIGID_NUM_COLLIDERS; numColliders: number }
    | { type: PhysicsProtocolType.RIGID_COLLIDER; colliderId: number }
    | { type: PhysicsProtocolType.RIGID_IS_ENABLED; isEnabled: boolean }
    | { type: PhysicsProtocolType.RIGID_BODY_TYPE; bodyType: RigidBodyTypeAPI }
    | { type: PhysicsProtocolType.RIGID_IS_SLEEPING; isSleeping: boolean }
    | { type: PhysicsProtocolType.RIGID_IS_MOVING; isMoving: boolean }
    | { type: PhysicsProtocolType.RIGID_IS_FIXED; isFixed: boolean }
    | { type: PhysicsProtocolType.RIGID_IS_KINEMATIC; isKinematic: boolean }
    | { type: PhysicsProtocolType.RIGID_IS_DYNAMIC; isDynamic: boolean }
    | { type: PhysicsProtocolType.RIGID_LINEAR_DAMPING; linearDamping: number }
    | { type: PhysicsProtocolType.RIGID_ANGULAR_DAMPING; angularDamping: number }
    | { type: PhysicsProtocolType.RIGID_USER_FORCE; userForce: PhysVector }
    | { type: PhysicsProtocolType.RIGID_USER_TORQUE; userTorque: PhysVector }
    // Collider --------------------------------------
    | { type: PhysicsProtocolType.CREATE_COLLIDER; id: number; parentId?: number }
    | { type: PhysicsProtocolType.CREATE_COLLIDERS; ids: number[]; parentIds?: number[] }
    | { type: PhysicsProtocolType.DELETE_COLLIDER; id: number }
    | { type: PhysicsProtocolType.DELETE_COLLIDERS; ids: number[] }
    | { type: PhysicsProtocolType.COLL_GET_USERDATA; userData: Record<string, unknown> }
    | { type: PhysicsProtocolType.COLL_IS_VALID; isValid: boolean }
    | { type: PhysicsProtocolType.COLL_TRANSLATION; translation: PhysVector }
    | { type: PhysicsProtocolType.COLL_ROTATION; rotation: PhysRotation }
    | { type: PhysicsProtocolType.COLL_TRANSLATION_WRT_PARENT; translation: PhysVector | null }
    | { type: PhysicsProtocolType.COLL_ROTATION_WRT_PARENT; rotation: PhysRotation | null }
    | { type: PhysicsProtocolType.COLL_IS_SENSOR; isSensor: boolean }
    | { type: PhysicsProtocolType.COLL_IS_ENABLED; isEnabled: boolean }
    | { type: PhysicsProtocolType.COLL_FRICTION; friction: number }
    | { type: PhysicsProtocolType.COLL_RESTITUTION; restitution: number }
    | { type: PhysicsProtocolType.COLL_MASS; mass: number }
    | { type: PhysicsProtocolType.COLL_DENSITY; density: number }
    | { type: PhysicsProtocolType.COLL_SHAPE_TYPE; shapeType: ShapeType }
    | { type: PhysicsProtocolType.COLL_RADIUS; radius: number }
    | { type: PhysicsProtocolType.COLL_HALF_HEIGHT; halfHeight: number }
    | { type: PhysicsProtocolType.COLL_HALF_EXTENTS; halfExtents: PhysVector }
    | { type: PhysicsProtocolType.COLL_COLLISION_GROUPS; groups: InteractionGroupsAPI }
    | { type: PhysicsProtocolType.COLL_SOLVER_GROUPS; groups: InteractionGroupsAPI }
    | { type: PhysicsProtocolType.COLL_CONTAINS_POINT; isInside: boolean }
    | { type: PhysicsProtocolType.COLL_VERTICES; vertices: Float32Array | null }
    | { type: PhysicsProtocolType.COLL_INDICES; indices: Uint32Array | null }
    | { type: PhysicsProtocolType.COLL_HEIGHTS; heights: HeightFieldData | null }
    | { type: PhysicsProtocolType.COLL_NORMAL; normal: PhysVector | null }
    | { type: PhysicsProtocolType.COLL_BORDER_RADIUS; borderRadius: number }
    // Joint --------------------------------------
    | { type: PhysicsProtocolType.CREATE_JOINT; id: number }
    | { type: PhysicsProtocolType.CREATE_JOINTS; ids: number[] }
    | { type: PhysicsProtocolType.DELETE_JOINT; id: number }
    | { type: PhysicsProtocolType.DELETE_JOINTS; ids: number[] }
    | { type: PhysicsProtocolType.JOINT_IS_VALID; isValid: boolean }
    | { type: PhysicsProtocolType.JOINT_BODY1_ID; body1Id: number }
    | { type: PhysicsProtocolType.JOINT_BODY2_ID; body2Id: number }
    | { type: PhysicsProtocolType.JOINT_ANCHOR1; anchor1: PhysVector }
    | { type: PhysicsProtocolType.JOINT_ANCHOR2; anchor2: PhysVector }
    | { type: PhysicsProtocolType.JOINT_CONTACTS_ENABLED; contactsEnabled: boolean }
    | { type: PhysicsProtocolType.JOINT_LIMITS_ENABLED; limitsEnabled: boolean }
    | { type: PhysicsProtocolType.JOINT_GET_USERDATA; userData: Record<string, unknown> }
    // Debug state tracking (see SET_DEBUG_STATE_TRACKING) ----
    | {
        type: PhysicsProtocolType.SET_DEBUG_STATE_TRACKING;
        /** Which transport the debug-state buffer resolved to. Mirrors CREATE_WORLD's
         * transform-buffer resolution, decided once when the buffer is first allocated. */
        transportMode: 'SHARED_MEMORY' | 'MESSAGE_BATCH';
        /** Only present (and only a SharedArrayBuffer) on the enable that allocated the
         * buffer, and only in 'SHARED_MEMORY' mode. */
        buffer?: SharedArrayBuffer;
      }
    | { type: PhysicsProtocolType.DEBUG_STATE_PUSH; buffer: ArrayBuffer }
    // Transforms hot path (unsolicited push, MESSAGE_BATCH fallback only) ----
    | {
        type: PhysicsProtocolType.TRANSFORMS_PUSH;
        buffer: ArrayBuffer;
        /** Step statistics (p027), only populated when PhysicsState.stepStatsEnabled is on.
         * MESSAGE_BATCH mode only — the SHARED_MEMORY transport has no per-step message, so
         * there it uses the CREATE_WORLD statsBuffer instead. The three stay separate and
         * are never summed: stepDuration is the pure simulation cost, the other two bracket
         * it as messaging overhead. */
        stepDuration?: number;
        dispatchMs?: number;
        stepEndAt?: number;
        /** Awake and sleeping dynamic bodies after the step (p352), with the stats above. */
        awakeBodies?: number;
        sleepingBodies?: number;
      }
    // Events (unsolicited push, only sent when at least one event occurred that step) ----
    | {
        type: PhysicsProtocolType.EVENTS_PUSH;
        collisions: CollisionEventRecord[];
        contactForces: ContactForceEventRecord[];
      }
    // Error --------------------------------------
    | {
        type: PhysicsProtocolType.ERROR;
        message: string;
      }
  ) & { requestId?: number };

/**
 * Helper utility to extract a specific sub-type from the protocol union
 */
export type PhysicsResponse<T extends PhysicsProtocolType> = Extract<
  PhysicsDownProtocol,
  { type: T }
>;

// --- Extracted Sub-types ---
// Engine
export type InitPhysicsResponse = PhysicsResponse<PhysicsProtocolType.INIT_PHYSICS>;
export type TakeSnapshotResponse = PhysicsResponse<PhysicsProtocolType.TAKE_SNAPSHOT>;
export type RestoreSnapshotResponse = PhysicsResponse<PhysicsProtocolType.RESTORE_SNAPSHOT>;
export type FlushResponse = PhysicsResponse<PhysicsProtocolType.FLUSH>;
export type ErrorResponse = PhysicsResponse<PhysicsProtocolType.ERROR>;
// World
export type CreateWorldResponse = PhysicsResponse<PhysicsProtocolType.CREATE_WORLD>;
export type TransformsPushMessage = PhysicsResponse<PhysicsProtocolType.TRANSFORMS_PUSH>;
export type EventsPushMessage = PhysicsResponse<PhysicsProtocolType.EVENTS_PUSH>;
export type DebugStatePushMessage = PhysicsResponse<PhysicsProtocolType.DEBUG_STATE_PUSH>;
export type SetDebugStateTrackingResponse =
  PhysicsResponse<PhysicsProtocolType.SET_DEBUG_STATE_TRACKING>;
export type DeleteWorldResponse = PhysicsResponse<PhysicsProtocolType.DELETE_WORLD>;
export type WorldGravityResponse = PhysicsResponse<PhysicsProtocolType.WORLD_GET_GRAVITY>;
export type WorldTimestepResponse = PhysicsResponse<PhysicsProtocolType.WORLD_GET_TIMESTEP>;
export type WorldLengthUnitResponse = PhysicsResponse<PhysicsProtocolType.WORLD_GET_LENGTH_UNIT>;
export type WorldNumSolverIterationsResponse =
  PhysicsResponse<PhysicsProtocolType.WORLD_GET_SOLVER_ITERS>;
export type WorldNumInternalPgsIterationsResponse =
  PhysicsResponse<PhysicsProtocolType.WORLD_GET_PGS_ITERS>;
export type WorldMaxCcdSubstepsResponse =
  PhysicsResponse<PhysicsProtocolType.WORLD_GET_CCD_SUBSTEPS>;
// World query
export type WorldCastRayResponse = PhysicsResponse<PhysicsProtocolType.WORLD_CAST_RAY>;
export type WorldCastShapeResponse = PhysicsResponse<PhysicsProtocolType.WORLD_CAST_SHAPE>;
export type WorldCastRayAndGetNormalResponse =
  PhysicsResponse<PhysicsProtocolType.WORLD_CAST_RAY_AND_GET_NORMAL>;
export type WorldIntersectionsWithRayResponse =
  PhysicsResponse<PhysicsProtocolType.WORLD_INTERSECTIONS_WITH_RAY>;
export type WorldContactPairsResponse =
  PhysicsResponse<PhysicsProtocolType.WORLD_CONTACT_PAIRS_WITH>;
export type WorldIntersectionPairsWithResponse =
  PhysicsResponse<PhysicsProtocolType.WORLD_INTERSECTION_PAIRS_WITH>;
export type WorldIntersectionPairResponse =
  PhysicsResponse<PhysicsProtocolType.WORLD_INTERSECTION_PAIR>;
// Rigid body
export type CreateRigidBodyResponse = PhysicsResponse<PhysicsProtocolType.CREATE_RIGID_BODY>;
export type CreatePhysicsEntityResponse =
  PhysicsResponse<PhysicsProtocolType.CREATE_PHYSICS_ENTITY>;
export type CreateRigidBodiesResponse = PhysicsResponse<PhysicsProtocolType.CREATE_RIGID_BODIES>;
export type DeleteRigidBodyResponse = PhysicsResponse<PhysicsProtocolType.DELETE_RIGID_BODY>;
export type DeleteRigidBodiesResponse = PhysicsResponse<PhysicsProtocolType.DELETE_RIGID_BODIES>;
export type RigidDetachResponse = PhysicsResponse<PhysicsProtocolType.RIGID_DETACH>;
export type RigidReattachResponse = PhysicsResponse<PhysicsProtocolType.RIGID_REATTACH>;
export type RigidReadPositionsResponse = PhysicsResponse<PhysicsProtocolType.RIGID_READ_POSITIONS>;
export type RigidGetUserDataResponse = PhysicsResponse<PhysicsProtocolType.RIGID_GET_USERDATA>;
export type RigidIsValidResponse = PhysicsResponse<PhysicsProtocolType.RIGID_IS_VALID>;
export type RigidDominanceGroupResponse =
  PhysicsResponse<PhysicsProtocolType.RIGID_DOMINANCE_GROUP>;
export type RigidAdditionalSolverIterationsResponse =
  PhysicsResponse<PhysicsProtocolType.RIGID_ADDITIONAL_SOLVER_ITERATIONS>;
export type RigidSoftCcdPredictionResponse =
  PhysicsResponse<PhysicsProtocolType.RIGID_SOFT_CCD_PREDICTION>;
export type RigidTranslationResponse = PhysicsResponse<PhysicsProtocolType.RIGID_TRANSLATION>;
export type RigidRotationResponse = PhysicsResponse<PhysicsProtocolType.RIGID_ROTATION>;
export type RigidNextTranslationResponse =
  PhysicsResponse<PhysicsProtocolType.RIGID_NEXT_TRANSLATION>;
export type RigidNextRotationResponse = PhysicsResponse<PhysicsProtocolType.RIGID_NEXT_ROTATION>;
export type RigidGravityScaleResponse = PhysicsResponse<PhysicsProtocolType.RIGID_GRAVITY_SCALE>;
export type RigidLinvelResponse = PhysicsResponse<PhysicsProtocolType.RIGID_LINVEL>;
export type RigidVelocityAtPointResponse =
  PhysicsResponse<PhysicsProtocolType.RIGID_VELOCITY_AT_POINT>;
export type RigidAngvelResponse = PhysicsResponse<PhysicsProtocolType.RIGID_ANGVEL>;
export type RigidMassResponse = PhysicsResponse<PhysicsProtocolType.RIGID_MASS>;
export type RigidEffectiveInvMassResponse =
  PhysicsResponse<PhysicsProtocolType.RIGID_EFFECTIVE_INV_MASS>;
export type RigidInvMassResponse = PhysicsResponse<PhysicsProtocolType.RIGID_INV_MASS>;
export type RigidLocalComResponse = PhysicsResponse<PhysicsProtocolType.RIGID_LOCAL_COM>;
export type RigidWorldComResponse = PhysicsResponse<PhysicsProtocolType.RIGID_WORLD_COM>;
export type RigidInvPrincipalInertiaResponse =
  PhysicsResponse<PhysicsProtocolType.RIGID_INV_PRINCIPAL_INERTIA>;
export type RigidPrincipalInertiaResponse =
  PhysicsResponse<PhysicsProtocolType.RIGID_PRINCIPAL_INERTIA>;
export type RigidPrincipalInertiaLocalFrameResponse =
  PhysicsResponse<PhysicsProtocolType.RIGID_PRINCIPAL_INERTIA_LOCAL_FRAME>;
export type RigidIsCcdEnabledResponse = PhysicsResponse<PhysicsProtocolType.RIGID_IS_CCD_ENABLED>;
export type RigidNumCollidersResponse = PhysicsResponse<PhysicsProtocolType.RIGID_NUM_COLLIDERS>;
export type RigidColliderResponse = PhysicsResponse<PhysicsProtocolType.RIGID_COLLIDER>;
export type RigidIsEnabledResponse = PhysicsResponse<PhysicsProtocolType.RIGID_IS_ENABLED>;
export type RigidBodyTypeResponse = PhysicsResponse<PhysicsProtocolType.RIGID_BODY_TYPE>;
export type RigidIsSleepingResponse = PhysicsResponse<PhysicsProtocolType.RIGID_IS_SLEEPING>;
export type RigidIsMovingResponse = PhysicsResponse<PhysicsProtocolType.RIGID_IS_MOVING>;
export type RigidIsFixedResponse = PhysicsResponse<PhysicsProtocolType.RIGID_IS_FIXED>;
export type RigidIsKinematicResponse = PhysicsResponse<PhysicsProtocolType.RIGID_IS_KINEMATIC>;
export type RigidIsDynamicResponse = PhysicsResponse<PhysicsProtocolType.RIGID_IS_DYNAMIC>;
export type RigidLinearDampingResponse = PhysicsResponse<PhysicsProtocolType.RIGID_LINEAR_DAMPING>;
export type RigidAngularDampingResponse =
  PhysicsResponse<PhysicsProtocolType.RIGID_ANGULAR_DAMPING>;
export type RigidUserForceResponse = PhysicsResponse<PhysicsProtocolType.RIGID_USER_FORCE>;
export type RigidUserTorqueResponse = PhysicsResponse<PhysicsProtocolType.RIGID_USER_TORQUE>;

// Collider
export type CreateColliderResponse = PhysicsResponse<PhysicsProtocolType.CREATE_COLLIDER>;
export type CreateCollidersResponse = PhysicsResponse<PhysicsProtocolType.CREATE_COLLIDERS>;
export type DeleteColliderResponse = PhysicsResponse<PhysicsProtocolType.DELETE_COLLIDER>;
export type DeleteCollidersResponse = PhysicsResponse<PhysicsProtocolType.DELETE_COLLIDERS>;
export type CollUserDataResponse = PhysicsResponse<PhysicsProtocolType.COLL_GET_USERDATA>;
export type CollIsValidResponse = PhysicsResponse<PhysicsProtocolType.COLL_IS_VALID>;
export type CollTranslationResponse = PhysicsResponse<PhysicsProtocolType.COLL_TRANSLATION>;
export type CollRotationResponse = PhysicsResponse<PhysicsProtocolType.COLL_ROTATION>;
export type CollWrtParentTranslationResponse =
  PhysicsResponse<PhysicsProtocolType.COLL_TRANSLATION_WRT_PARENT>;
export type CollWrtParentRotationResponse =
  PhysicsResponse<PhysicsProtocolType.COLL_ROTATION_WRT_PARENT>;
export type CollIsSensorResponse = PhysicsResponse<PhysicsProtocolType.COLL_IS_SENSOR>;
export type CollIsEnabledResponse = PhysicsResponse<PhysicsProtocolType.COLL_IS_ENABLED>;
export type CollFrictionResponse = PhysicsResponse<PhysicsProtocolType.COLL_FRICTION>;
export type CollRestitutionResponse = PhysicsResponse<PhysicsProtocolType.COLL_RESTITUTION>;
export type CollMassResponse = PhysicsResponse<PhysicsProtocolType.COLL_MASS>;
export type CollDensityResponse = PhysicsResponse<PhysicsProtocolType.COLL_DENSITY>;
export type CollShapeTypeResponse = PhysicsResponse<PhysicsProtocolType.COLL_SHAPE_TYPE>;
export type CollRadiusResponse = PhysicsResponse<PhysicsProtocolType.COLL_RADIUS>;
export type CollHalfHeightResponse = PhysicsResponse<PhysicsProtocolType.COLL_HALF_HEIGHT>;
export type CollHalfExtentsResponse = PhysicsResponse<PhysicsProtocolType.COLL_HALF_EXTENTS>;
export type CollCollisionGroupsResponse =
  PhysicsResponse<PhysicsProtocolType.COLL_COLLISION_GROUPS>;
export type CollSolverGroupsResponse = PhysicsResponse<PhysicsProtocolType.COLL_SOLVER_GROUPS>;
export type CollContainsPointResponse = PhysicsResponse<PhysicsProtocolType.COLL_CONTAINS_POINT>;
export type CollVerticesResponse = PhysicsResponse<PhysicsProtocolType.COLL_VERTICES>;
export type CollIndicesResponse = PhysicsResponse<PhysicsProtocolType.COLL_INDICES>;
export type CollHeightsResponse = PhysicsResponse<PhysicsProtocolType.COLL_HEIGHTS>;
export type CollNormalResponse = PhysicsResponse<PhysicsProtocolType.COLL_NORMAL>;
export type CollBorderRadiusResponse = PhysicsResponse<PhysicsProtocolType.COLL_BORDER_RADIUS>;
// Joint
export type CreateJointResponse = PhysicsResponse<PhysicsProtocolType.CREATE_JOINT>;
export type CreateJointsResponse = PhysicsResponse<PhysicsProtocolType.CREATE_JOINTS>;
export type DeleteJointResponse = PhysicsResponse<PhysicsProtocolType.DELETE_JOINT>;
export type DeleteJointsResponse = PhysicsResponse<PhysicsProtocolType.DELETE_JOINTS>;
export type JointIsValidResponse = PhysicsResponse<PhysicsProtocolType.JOINT_IS_VALID>;
export type JointBody1IdResponse = PhysicsResponse<PhysicsProtocolType.JOINT_BODY1_ID>;
export type JointBody2IdResponse = PhysicsResponse<PhysicsProtocolType.JOINT_BODY2_ID>;
export type JointAnchor1Response = PhysicsResponse<PhysicsProtocolType.JOINT_ANCHOR1>;
export type JointAnchor2Response = PhysicsResponse<PhysicsProtocolType.JOINT_ANCHOR2>;
export type JointContactsEnabledResponse =
  PhysicsResponse<PhysicsProtocolType.JOINT_CONTACTS_ENABLED>;
export type JointLimitsEnabledResponse = PhysicsResponse<PhysicsProtocolType.JOINT_LIMITS_ENABLED>;
export type JointGetUserDataResponse = PhysicsResponse<PhysicsProtocolType.JOINT_GET_USERDATA>;
