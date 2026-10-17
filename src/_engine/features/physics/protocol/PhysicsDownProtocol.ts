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
import type { PhysicsUpProtocol } from './PhysicsUpProtocol';

/**
 * Physics worker DOWN protocol (from worker to main thread): each request's reply, under the
 * request's `type` and with its `requestId`, the unsolicited pushes (`TRANSFORMS_PUSH`,
 * `EVENTS_PUSH`, `DEBUG_STATE_PUSH`) and `ERROR`. Plain data, through the physics transport
 * (`transport/PhysicsTransport.ts`, whose contract it keeps).
 * @internal
 */
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
    | { type: PhysicsProtocolType.RIGID_NEXT_TRANSLATION; nextTranslation: PhysVector }
    | { type: PhysicsProtocolType.RIGID_NEXT_ROTATION; nextRotation: PhysRotation }
    | { type: PhysicsProtocolType.RIGID_GRAVITY_SCALE; gravityScale: number }
    | { type: PhysicsProtocolType.RIGID_VELOCITY_AT_POINT; velocityAtPoint: PhysVector }
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
        /** The worker bank's used slots and its header (PhysicsTransformBuffer.copyUsedBank). */
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
 * Helper utility to extract a specific sub-type from the protocol union (the aliases in
 * `PhysicsResponses.ts`).
 * @template T the message type
 * @internal
 */
export type PhysicsResponse<T extends PhysicsProtocolType> = Extract<
  PhysicsDownProtocol,
  { type: T }
>;

/**
 * How the worker and its switches reply to the up message `data`: the reply gets `data`'s
 * `requestId` (a message without one goes out as it is), and an error (`isError`) for a one-way
 * message isn't sent.
 * @internal
 */
export type PhysicsWorkerReply = (
  message: PhysicsDownProtocol,
  data: PhysicsUpProtocol,
  isError?: boolean,
  transfer?: Transferable[]
) => void;
