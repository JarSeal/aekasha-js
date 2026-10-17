import type { PhysicsResponse } from './PhysicsDownProtocol';
import type { PhysicsProtocolType } from './PhysicsProtocolType';

// Engine
/**
 * The worker's reply to `INIT_PHYSICS`.
 * @internal
 */
export type InitPhysicsResponse = PhysicsResponse<PhysicsProtocolType.INIT_PHYSICS>;
/**
 * The worker's reply to `TAKE_SNAPSHOT`.
 * @internal
 */
export type TakeSnapshotResponse = PhysicsResponse<PhysicsProtocolType.TAKE_SNAPSHOT>;
/**
 * The worker's reply to `RESTORE_SNAPSHOT`.
 * @internal
 */
export type RestoreSnapshotResponse = PhysicsResponse<PhysicsProtocolType.RESTORE_SNAPSHOT>;
/**
 * The worker's reply to `FLUSH`.
 * @internal
 */
export type FlushResponse = PhysicsResponse<PhysicsProtocolType.FLUSH>;
/**
 * The worker's error: the reply to the request whose `requestId` it carries, or alone for a
 * one-way command.
 * @internal
 */
export type ErrorResponse = PhysicsResponse<PhysicsProtocolType.ERROR>;

// World
/**
 * The worker's reply to `CREATE_WORLD`.
 * @internal
 */
export type CreateWorldResponse = PhysicsResponse<PhysicsProtocolType.CREATE_WORLD>;
/**
 * The worker's unsolicited `TRANSFORMS_PUSH` push.
 * @internal
 */
export type TransformsPushMessage = PhysicsResponse<PhysicsProtocolType.TRANSFORMS_PUSH>;
/**
 * The worker's unsolicited `EVENTS_PUSH` push.
 * @internal
 */
export type EventsPushMessage = PhysicsResponse<PhysicsProtocolType.EVENTS_PUSH>;
/**
 * The worker's unsolicited `DEBUG_STATE_PUSH` push.
 * @internal
 */
export type DebugStatePushMessage = PhysicsResponse<PhysicsProtocolType.DEBUG_STATE_PUSH>;
/**
 * The worker's reply to `SET_DEBUG_STATE_TRACKING`.
 * @internal
 */
export type SetDebugStateTrackingResponse =
  PhysicsResponse<PhysicsProtocolType.SET_DEBUG_STATE_TRACKING>;
/**
 * The worker's reply to `DELETE_WORLD`.
 * @internal
 */
export type DeleteWorldResponse = PhysicsResponse<PhysicsProtocolType.DELETE_WORLD>;
/**
 * The worker's reply to `WORLD_GET_GRAVITY`.
 * @internal
 */
export type WorldGravityResponse = PhysicsResponse<PhysicsProtocolType.WORLD_GET_GRAVITY>;
/**
 * The worker's reply to `WORLD_GET_TIMESTEP`.
 * @internal
 */
export type WorldTimestepResponse = PhysicsResponse<PhysicsProtocolType.WORLD_GET_TIMESTEP>;
/**
 * The worker's reply to `WORLD_GET_LENGTH_UNIT`.
 * @internal
 */
export type WorldLengthUnitResponse = PhysicsResponse<PhysicsProtocolType.WORLD_GET_LENGTH_UNIT>;
/**
 * The worker's reply to `WORLD_GET_SOLVER_ITERS`.
 * @internal
 */
export type WorldNumSolverIterationsResponse =
  PhysicsResponse<PhysicsProtocolType.WORLD_GET_SOLVER_ITERS>;
/**
 * The worker's reply to `WORLD_GET_PGS_ITERS`.
 * @internal
 */
export type WorldNumInternalPgsIterationsResponse =
  PhysicsResponse<PhysicsProtocolType.WORLD_GET_PGS_ITERS>;
/**
 * The worker's reply to `WORLD_GET_CCD_SUBSTEPS`.
 * @internal
 */
export type WorldMaxCcdSubstepsResponse =
  PhysicsResponse<PhysicsProtocolType.WORLD_GET_CCD_SUBSTEPS>;

// World query
/**
 * The worker's reply to `WORLD_CAST_RAY`.
 * @internal
 */
export type WorldCastRayResponse = PhysicsResponse<PhysicsProtocolType.WORLD_CAST_RAY>;
/**
 * The worker's reply to `WORLD_CAST_SHAPE`.
 * @internal
 */
export type WorldCastShapeResponse = PhysicsResponse<PhysicsProtocolType.WORLD_CAST_SHAPE>;
/**
 * The worker's reply to `WORLD_CAST_RAY_AND_GET_NORMAL`.
 * @internal
 */
export type WorldCastRayAndGetNormalResponse =
  PhysicsResponse<PhysicsProtocolType.WORLD_CAST_RAY_AND_GET_NORMAL>;
/**
 * The worker's reply to `WORLD_INTERSECTIONS_WITH_RAY`.
 * @internal
 */
export type WorldIntersectionsWithRayResponse =
  PhysicsResponse<PhysicsProtocolType.WORLD_INTERSECTIONS_WITH_RAY>;
/**
 * The worker's reply to `WORLD_CONTACT_PAIRS_WITH`.
 * @internal
 */
export type WorldContactPairsResponse =
  PhysicsResponse<PhysicsProtocolType.WORLD_CONTACT_PAIRS_WITH>;
/**
 * The worker's reply to `WORLD_INTERSECTION_PAIRS_WITH`.
 * @internal
 */
export type WorldIntersectionPairsWithResponse =
  PhysicsResponse<PhysicsProtocolType.WORLD_INTERSECTION_PAIRS_WITH>;
/**
 * The worker's reply to `WORLD_INTERSECTION_PAIR`.
 * @internal
 */
export type WorldIntersectionPairResponse =
  PhysicsResponse<PhysicsProtocolType.WORLD_INTERSECTION_PAIR>;

// Rigid body
/**
 * The worker's reply to `CREATE_RIGID_BODY`.
 * @internal
 */
export type CreateRigidBodyResponse = PhysicsResponse<PhysicsProtocolType.CREATE_RIGID_BODY>;
/**
 * The worker's reply to `CREATE_PHYSICS_ENTITY`.
 * @internal
 */
export type CreatePhysicsEntityResponse =
  PhysicsResponse<PhysicsProtocolType.CREATE_PHYSICS_ENTITY>;
/**
 * The worker's reply to `CREATE_RIGID_BODIES`.
 * @internal
 */
export type CreateRigidBodiesResponse = PhysicsResponse<PhysicsProtocolType.CREATE_RIGID_BODIES>;
/**
 * The worker's reply to `DELETE_RIGID_BODY`.
 * @internal
 */
export type DeleteRigidBodyResponse = PhysicsResponse<PhysicsProtocolType.DELETE_RIGID_BODY>;
/**
 * The worker's reply to `DELETE_RIGID_BODIES`.
 * @internal
 */
export type DeleteRigidBodiesResponse = PhysicsResponse<PhysicsProtocolType.DELETE_RIGID_BODIES>;
/**
 * The worker's reply to `RIGID_DETACH`.
 * @internal
 */
export type RigidDetachResponse = PhysicsResponse<PhysicsProtocolType.RIGID_DETACH>;
/**
 * The worker's reply to `RIGID_REATTACH`.
 * @internal
 */
export type RigidReattachResponse = PhysicsResponse<PhysicsProtocolType.RIGID_REATTACH>;
/**
 * The worker's reply to `RIGID_READ_POSITIONS`.
 * @internal
 */
export type RigidReadPositionsResponse = PhysicsResponse<PhysicsProtocolType.RIGID_READ_POSITIONS>;
/**
 * The worker's reply to `RIGID_GET_USERDATA`.
 * @internal
 */
export type RigidGetUserDataResponse = PhysicsResponse<PhysicsProtocolType.RIGID_GET_USERDATA>;
/**
 * The worker's reply to `RIGID_IS_VALID`.
 * @internal
 */
export type RigidIsValidResponse = PhysicsResponse<PhysicsProtocolType.RIGID_IS_VALID>;
/**
 * The worker's reply to `RIGID_DOMINANCE_GROUP`.
 * @internal
 */
export type RigidDominanceGroupResponse =
  PhysicsResponse<PhysicsProtocolType.RIGID_DOMINANCE_GROUP>;
/**
 * The worker's reply to `RIGID_ADDITIONAL_SOLVER_ITERATIONS`.
 * @internal
 */
export type RigidAdditionalSolverIterationsResponse =
  PhysicsResponse<PhysicsProtocolType.RIGID_ADDITIONAL_SOLVER_ITERATIONS>;
/**
 * The worker's reply to `RIGID_SOFT_CCD_PREDICTION`.
 * @internal
 */
export type RigidSoftCcdPredictionResponse =
  PhysicsResponse<PhysicsProtocolType.RIGID_SOFT_CCD_PREDICTION>;
/**
 * The worker's reply to `RIGID_NEXT_TRANSLATION`.
 * @internal
 */
export type RigidNextTranslationResponse =
  PhysicsResponse<PhysicsProtocolType.RIGID_NEXT_TRANSLATION>;
/**
 * The worker's reply to `RIGID_NEXT_ROTATION`.
 * @internal
 */
export type RigidNextRotationResponse = PhysicsResponse<PhysicsProtocolType.RIGID_NEXT_ROTATION>;
/**
 * The worker's reply to `RIGID_GRAVITY_SCALE`.
 * @internal
 */
export type RigidGravityScaleResponse = PhysicsResponse<PhysicsProtocolType.RIGID_GRAVITY_SCALE>;
/**
 * The worker's reply to `RIGID_VELOCITY_AT_POINT`.
 * @internal
 */
export type RigidVelocityAtPointResponse =
  PhysicsResponse<PhysicsProtocolType.RIGID_VELOCITY_AT_POINT>;
/**
 * The worker's reply to `RIGID_MASS`.
 * @internal
 */
export type RigidMassResponse = PhysicsResponse<PhysicsProtocolType.RIGID_MASS>;
/**
 * The worker's reply to `RIGID_EFFECTIVE_INV_MASS`.
 * @internal
 */
export type RigidEffectiveInvMassResponse =
  PhysicsResponse<PhysicsProtocolType.RIGID_EFFECTIVE_INV_MASS>;
/**
 * The worker's reply to `RIGID_INV_MASS`.
 * @internal
 */
export type RigidInvMassResponse = PhysicsResponse<PhysicsProtocolType.RIGID_INV_MASS>;
/**
 * The worker's reply to `RIGID_LOCAL_COM`.
 * @internal
 */
export type RigidLocalComResponse = PhysicsResponse<PhysicsProtocolType.RIGID_LOCAL_COM>;
/**
 * The worker's reply to `RIGID_WORLD_COM`.
 * @internal
 */
export type RigidWorldComResponse = PhysicsResponse<PhysicsProtocolType.RIGID_WORLD_COM>;
/**
 * The worker's reply to `RIGID_INV_PRINCIPAL_INERTIA`.
 * @internal
 */
export type RigidInvPrincipalInertiaResponse =
  PhysicsResponse<PhysicsProtocolType.RIGID_INV_PRINCIPAL_INERTIA>;
/**
 * The worker's reply to `RIGID_PRINCIPAL_INERTIA`.
 * @internal
 */
export type RigidPrincipalInertiaResponse =
  PhysicsResponse<PhysicsProtocolType.RIGID_PRINCIPAL_INERTIA>;
/**
 * The worker's reply to `RIGID_PRINCIPAL_INERTIA_LOCAL_FRAME`.
 * @internal
 */
export type RigidPrincipalInertiaLocalFrameResponse =
  PhysicsResponse<PhysicsProtocolType.RIGID_PRINCIPAL_INERTIA_LOCAL_FRAME>;
/**
 * The worker's reply to `RIGID_IS_CCD_ENABLED`.
 * @internal
 */
export type RigidIsCcdEnabledResponse = PhysicsResponse<PhysicsProtocolType.RIGID_IS_CCD_ENABLED>;
/**
 * The worker's reply to `RIGID_NUM_COLLIDERS`.
 * @internal
 */
export type RigidNumCollidersResponse = PhysicsResponse<PhysicsProtocolType.RIGID_NUM_COLLIDERS>;
/**
 * The worker's reply to `RIGID_COLLIDER`.
 * @internal
 */
export type RigidColliderResponse = PhysicsResponse<PhysicsProtocolType.RIGID_COLLIDER>;
/**
 * The worker's reply to `RIGID_IS_ENABLED`.
 * @internal
 */
export type RigidIsEnabledResponse = PhysicsResponse<PhysicsProtocolType.RIGID_IS_ENABLED>;
/**
 * The worker's reply to `RIGID_BODY_TYPE`.
 * @internal
 */
export type RigidBodyTypeResponse = PhysicsResponse<PhysicsProtocolType.RIGID_BODY_TYPE>;
/**
 * The worker's reply to `RIGID_IS_SLEEPING`.
 * @internal
 */
export type RigidIsSleepingResponse = PhysicsResponse<PhysicsProtocolType.RIGID_IS_SLEEPING>;
/**
 * The worker's reply to `RIGID_IS_MOVING`.
 * @internal
 */
export type RigidIsMovingResponse = PhysicsResponse<PhysicsProtocolType.RIGID_IS_MOVING>;
/**
 * The worker's reply to `RIGID_IS_FIXED`.
 * @internal
 */
export type RigidIsFixedResponse = PhysicsResponse<PhysicsProtocolType.RIGID_IS_FIXED>;
/**
 * The worker's reply to `RIGID_IS_KINEMATIC`.
 * @internal
 */
export type RigidIsKinematicResponse = PhysicsResponse<PhysicsProtocolType.RIGID_IS_KINEMATIC>;
/**
 * The worker's reply to `RIGID_IS_DYNAMIC`.
 * @internal
 */
export type RigidIsDynamicResponse = PhysicsResponse<PhysicsProtocolType.RIGID_IS_DYNAMIC>;
/**
 * The worker's reply to `RIGID_LINEAR_DAMPING`.
 * @internal
 */
export type RigidLinearDampingResponse = PhysicsResponse<PhysicsProtocolType.RIGID_LINEAR_DAMPING>;
/**
 * The worker's reply to `RIGID_ANGULAR_DAMPING`.
 * @internal
 */
export type RigidAngularDampingResponse =
  PhysicsResponse<PhysicsProtocolType.RIGID_ANGULAR_DAMPING>;
/**
 * The worker's reply to `RIGID_USER_FORCE`.
 * @internal
 */
export type RigidUserForceResponse = PhysicsResponse<PhysicsProtocolType.RIGID_USER_FORCE>;
/**
 * The worker's reply to `RIGID_USER_TORQUE`.
 * @internal
 */
export type RigidUserTorqueResponse = PhysicsResponse<PhysicsProtocolType.RIGID_USER_TORQUE>;

// Collider
/**
 * The worker's reply to `CREATE_COLLIDER`.
 * @internal
 */
export type CreateColliderResponse = PhysicsResponse<PhysicsProtocolType.CREATE_COLLIDER>;
/**
 * The worker's reply to `CREATE_COLLIDERS`.
 * @internal
 */
export type CreateCollidersResponse = PhysicsResponse<PhysicsProtocolType.CREATE_COLLIDERS>;
/**
 * The worker's reply to `DELETE_COLLIDER`.
 * @internal
 */
export type DeleteColliderResponse = PhysicsResponse<PhysicsProtocolType.DELETE_COLLIDER>;
/**
 * The worker's reply to `DELETE_COLLIDERS`.
 * @internal
 */
export type DeleteCollidersResponse = PhysicsResponse<PhysicsProtocolType.DELETE_COLLIDERS>;
/**
 * The worker's reply to `COLL_GET_USERDATA`.
 * @internal
 */
export type CollUserDataResponse = PhysicsResponse<PhysicsProtocolType.COLL_GET_USERDATA>;
/**
 * The worker's reply to `COLL_IS_VALID`.
 * @internal
 */
export type CollIsValidResponse = PhysicsResponse<PhysicsProtocolType.COLL_IS_VALID>;
/**
 * The worker's reply to `COLL_TRANSLATION`.
 * @internal
 */
export type CollTranslationResponse = PhysicsResponse<PhysicsProtocolType.COLL_TRANSLATION>;
/**
 * The worker's reply to `COLL_ROTATION`.
 * @internal
 */
export type CollRotationResponse = PhysicsResponse<PhysicsProtocolType.COLL_ROTATION>;
/**
 * The worker's reply to `COLL_TRANSLATION_WRT_PARENT`.
 * @internal
 */
export type CollWrtParentTranslationResponse =
  PhysicsResponse<PhysicsProtocolType.COLL_TRANSLATION_WRT_PARENT>;
/**
 * The worker's reply to `COLL_ROTATION_WRT_PARENT`.
 * @internal
 */
export type CollWrtParentRotationResponse =
  PhysicsResponse<PhysicsProtocolType.COLL_ROTATION_WRT_PARENT>;
/**
 * The worker's reply to `COLL_IS_SENSOR`.
 * @internal
 */
export type CollIsSensorResponse = PhysicsResponse<PhysicsProtocolType.COLL_IS_SENSOR>;
/**
 * The worker's reply to `COLL_IS_ENABLED`.
 * @internal
 */
export type CollIsEnabledResponse = PhysicsResponse<PhysicsProtocolType.COLL_IS_ENABLED>;
/**
 * The worker's reply to `COLL_FRICTION`.
 * @internal
 */
export type CollFrictionResponse = PhysicsResponse<PhysicsProtocolType.COLL_FRICTION>;
/**
 * The worker's reply to `COLL_RESTITUTION`.
 * @internal
 */
export type CollRestitutionResponse = PhysicsResponse<PhysicsProtocolType.COLL_RESTITUTION>;
/**
 * The worker's reply to `COLL_MASS`.
 * @internal
 */
export type CollMassResponse = PhysicsResponse<PhysicsProtocolType.COLL_MASS>;
/**
 * The worker's reply to `COLL_DENSITY`.
 * @internal
 */
export type CollDensityResponse = PhysicsResponse<PhysicsProtocolType.COLL_DENSITY>;
/**
 * The worker's reply to `COLL_SHAPE_TYPE`.
 * @internal
 */
export type CollShapeTypeResponse = PhysicsResponse<PhysicsProtocolType.COLL_SHAPE_TYPE>;
/**
 * The worker's reply to `COLL_RADIUS`.
 * @internal
 */
export type CollRadiusResponse = PhysicsResponse<PhysicsProtocolType.COLL_RADIUS>;
/**
 * The worker's reply to `COLL_HALF_HEIGHT`.
 * @internal
 */
export type CollHalfHeightResponse = PhysicsResponse<PhysicsProtocolType.COLL_HALF_HEIGHT>;
/**
 * The worker's reply to `COLL_HALF_EXTENTS`.
 * @internal
 */
export type CollHalfExtentsResponse = PhysicsResponse<PhysicsProtocolType.COLL_HALF_EXTENTS>;
/**
 * The worker's reply to `COLL_COLLISION_GROUPS`.
 * @internal
 */
export type CollCollisionGroupsResponse =
  PhysicsResponse<PhysicsProtocolType.COLL_COLLISION_GROUPS>;
/**
 * The worker's reply to `COLL_SOLVER_GROUPS`.
 * @internal
 */
export type CollSolverGroupsResponse = PhysicsResponse<PhysicsProtocolType.COLL_SOLVER_GROUPS>;
/**
 * The worker's reply to `COLL_CONTAINS_POINT`.
 * @internal
 */
export type CollContainsPointResponse = PhysicsResponse<PhysicsProtocolType.COLL_CONTAINS_POINT>;
/**
 * The worker's reply to `COLL_VERTICES`.
 * @internal
 */
export type CollVerticesResponse = PhysicsResponse<PhysicsProtocolType.COLL_VERTICES>;
/**
 * The worker's reply to `COLL_INDICES`.
 * @internal
 */
export type CollIndicesResponse = PhysicsResponse<PhysicsProtocolType.COLL_INDICES>;
/**
 * The worker's reply to `COLL_HEIGHTS`.
 * @internal
 */
export type CollHeightsResponse = PhysicsResponse<PhysicsProtocolType.COLL_HEIGHTS>;
/**
 * The worker's reply to `COLL_NORMAL`.
 * @internal
 */
export type CollNormalResponse = PhysicsResponse<PhysicsProtocolType.COLL_NORMAL>;
/**
 * The worker's reply to `COLL_BORDER_RADIUS`.
 * @internal
 */
export type CollBorderRadiusResponse = PhysicsResponse<PhysicsProtocolType.COLL_BORDER_RADIUS>;

// Joint
/**
 * The worker's reply to `CREATE_JOINT`.
 * @internal
 */
export type CreateJointResponse = PhysicsResponse<PhysicsProtocolType.CREATE_JOINT>;
/**
 * The worker's reply to `CREATE_JOINTS`.
 * @internal
 */
export type CreateJointsResponse = PhysicsResponse<PhysicsProtocolType.CREATE_JOINTS>;
/**
 * The worker's reply to `DELETE_JOINT`.
 * @internal
 */
export type DeleteJointResponse = PhysicsResponse<PhysicsProtocolType.DELETE_JOINT>;
/**
 * The worker's reply to `DELETE_JOINTS`.
 * @internal
 */
export type DeleteJointsResponse = PhysicsResponse<PhysicsProtocolType.DELETE_JOINTS>;
/**
 * The worker's reply to `JOINT_IS_VALID`.
 * @internal
 */
export type JointIsValidResponse = PhysicsResponse<PhysicsProtocolType.JOINT_IS_VALID>;
/**
 * The worker's reply to `JOINT_BODY1_ID`.
 * @internal
 */
export type JointBody1IdResponse = PhysicsResponse<PhysicsProtocolType.JOINT_BODY1_ID>;
/**
 * The worker's reply to `JOINT_BODY2_ID`.
 * @internal
 */
export type JointBody2IdResponse = PhysicsResponse<PhysicsProtocolType.JOINT_BODY2_ID>;
/**
 * The worker's reply to `JOINT_ANCHOR1`.
 * @internal
 */
export type JointAnchor1Response = PhysicsResponse<PhysicsProtocolType.JOINT_ANCHOR1>;
/**
 * The worker's reply to `JOINT_ANCHOR2`.
 * @internal
 */
export type JointAnchor2Response = PhysicsResponse<PhysicsProtocolType.JOINT_ANCHOR2>;
/**
 * The worker's reply to `JOINT_CONTACTS_ENABLED`.
 * @internal
 */
export type JointContactsEnabledResponse =
  PhysicsResponse<PhysicsProtocolType.JOINT_CONTACTS_ENABLED>;
/**
 * The worker's reply to `JOINT_LIMITS_ENABLED`.
 * @internal
 */
export type JointLimitsEnabledResponse = PhysicsResponse<PhysicsProtocolType.JOINT_LIMITS_ENABLED>;
/**
 * The worker's reply to `JOINT_GET_USERDATA`.
 * @internal
 */
export type JointGetUserDataResponse = PhysicsResponse<PhysicsProtocolType.JOINT_GET_USERDATA>;
