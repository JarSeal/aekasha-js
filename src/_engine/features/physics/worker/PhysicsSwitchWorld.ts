import type { PhysicsWorkerReply } from '../protocol/PhysicsDownProtocol';
import type {
  WorldCastRayAndGetNormalResponse,
  WorldCastRayResponse,
  WorldCastShapeResponse,
  WorldIntersectionsWithRayResponse,
} from '../protocol/PhysicsResponses';
import { PhysicsProtocolType } from '../protocol/PhysicsProtocolType';
import type { PhysicsUpProtocol } from '../protocol/PhysicsUpProtocol';
import type { RayColliderIntersectionAPI } from '../types/PhysicsQueryTypes';
import type { WorldAPI } from '../types/PhysicsWorldTypes';
import { getCollOrRigidId } from '../PhysicsUtils';

/**
 * The worker's switch for the world's messages (200-399): the world's settings, `free`, the
 * position propagation and the queries (casts, ray intersections, contact and intersection
 * pairs), each answered on the worker's world with a reply of the request's type. A throw
 * reaches `PhysicsWorker.ts`' catch, which replies `ERROR` with the request's id.
 * @internal
 * @param data the message, already routed here by its type's range
 * @param physicsWorldAPI the worker's world
 * @param sendMessage the worker's reply, sent through its transport
 */
export const physicsSwitchWorld = async (
  data: PhysicsUpProtocol,
  physicsWorldAPI: WorldAPI,
  // Typed against the down protocol, as every switch is, so a reply whose payload doesn't match
  // its type's response shape fails tsc. Every reply must use the narrowed `data.type` of its
  // case, not the widened `type` below.
  sendMessage: PhysicsWorkerReply
) => {
  const type = data.type;

  switch (data.type) {
    // WorldAPI ---------------------------
    case PhysicsProtocolType.WORLD_GET_GRAVITY:
      // WORLD_GET_GRAVITY
      const gravity = physicsWorldAPI.getGravitySync();
      return sendMessage({ type: data.type, gravity }, data);
    case PhysicsProtocolType.WORLD_SET_GRAVITY:
      // WORLD_SET_GRAVITY
      return physicsWorldAPI.setGravity(data.gravity);
    case PhysicsProtocolType.WORLD_FREE:
      // WORLD_FREE
      return physicsWorldAPI.free();
    case PhysicsProtocolType.WORLD_PROPAGATE_POSITIONS:
      // WORLD_PROPAGATE_MODIFIED_BODY_POSITIONS_TO_COLLIDERS
      return physicsWorldAPI.propagateModifiedBodyPositionsToColliders();
    case PhysicsProtocolType.WORLD_GET_TIMESTEP:
      // WORLD_GET_TIMESTEP
      const dt = physicsWorldAPI.getTimestepSync();
      return sendMessage({ type: data.type, dt }, data);
    case PhysicsProtocolType.WORLD_SET_TIMESTEP:
      // WORLD_SET_TIMESTEP
      return physicsWorldAPI.setTimestep(data.dt);
    case PhysicsProtocolType.WORLD_GET_LENGTH_UNIT:
      // WORLD_GET_LENGTH_UNIT
      const unitsPerMeter = physicsWorldAPI.getLengthUnitSync();
      return sendMessage({ type: data.type, unitsPerMeter }, data);
    case PhysicsProtocolType.WORLD_SET_LENGTH_UNIT:
      // WORLD_SET_LENGTH_UNIT
      return physicsWorldAPI.setLengthUnit(data.unitsPerMeter);
    case PhysicsProtocolType.WORLD_GET_SOLVER_ITERS:
      // WORLD_GET_SOLVER_ITERS
      const solverIterations = physicsWorldAPI.getNumSolverIterationsSync();
      return sendMessage({ type: data.type, solverIterations }, data);
    case PhysicsProtocolType.WORLD_SET_SOLVER_ITERS:
      // WORLD_SET_SOLVER_ITERS
      return physicsWorldAPI.setNumSolverIterations(data.niter);
    case PhysicsProtocolType.WORLD_GET_PGS_ITERS:
      // WORLD_GET_PGS_ITERS
      const internalPgsIterations = physicsWorldAPI.getNumInternalPgsIterationsSync();
      return sendMessage({ type: data.type, internalPgsIterations }, data);
    case PhysicsProtocolType.WORLD_SET_PGS_ITERS:
      // WORLD_SET_PGS_ITERS
      return physicsWorldAPI.setNumInternalPgsIterations(data.niter);
    case PhysicsProtocolType.WORLD_GET_CCD_SUBSTEPS:
      // WORLD_GET_CCD_SUBSTEPS
      const substeps = physicsWorldAPI.getMaxCcdSubstepsSync();
      return sendMessage({ type: data.type, substeps }, data);
    case PhysicsProtocolType.WORLD_SET_CCD_SUBSTEPS:
      // WORLD_SET_CCD_SUBSTEPS
      return physicsWorldAPI.setMaxCcdSubstepsSync(data.substeps);
    case PhysicsProtocolType.WORLD_CAST_RAY:
      // WORLD_CAST_RAY
      let hitTransfer: WorldCastRayResponse['hit'] = null;
      const hit = physicsWorldAPI.castRaySync(
        data.ray,
        data.maxToi,
        data.solid,
        data.filterFlags,
        data.filterGroups,
        data.filterExcludeCollider,
        data.filterExcludeRigidBody
      );
      if (hit) {
        const colliderId = getCollOrRigidId(hit.collider);
        if (colliderId !== undefined) {
          hitTransfer = { ...hit, collider: colliderId };
        }
      }
      return sendMessage({ type: data.type, hit: hitTransfer }, data);
    case PhysicsProtocolType.WORLD_CAST_SHAPE: {
      // WORLD_CAST_SHAPE
      let shapeHitTransfer: WorldCastShapeResponse['hit'] = null;
      const shapeHit = physicsWorldAPI.castShapeSync(
        data.shapePos,
        data.shapeRot,
        data.shapeVel,
        data.shape,
        data.targetDistance,
        data.maxToi,
        data.stopAtPenetration,
        data.filterFlags,
        data.filterGroups,
        data.filterExcludeCollider,
        data.filterExcludeRigidBody
      );
      if (shapeHit) {
        const colliderId = getCollOrRigidId(shapeHit.collider);
        if (colliderId !== undefined) {
          shapeHitTransfer = { ...shapeHit, collider: colliderId };
        }
      }
      return sendMessage({ type: data.type, hit: shapeHitTransfer }, data);
    }
    case PhysicsProtocolType.WORLD_CAST_RAY_AND_GET_NORMAL: {
      // WORLD_CAST_RAY_AND_GET_NORMAL
      let intersectionTransfer: WorldCastRayAndGetNormalResponse['intersection'] = null;
      const intersection = physicsWorldAPI.castRayAndGetNormalSync(
        data.ray,
        data.maxToi,
        data.solid,
        data.filterFlags,
        data.filterGroups,
        data.filterExcludeCollider,
        data.filterExcludeRigidBody
      );
      if (intersection) {
        const colliderId = getCollOrRigidId(intersection.collider);
        if (colliderId !== undefined) {
          intersectionTransfer = { ...intersection, collider: colliderId };
        }
      }
      return sendMessage({ type: data.type, intersection: intersectionTransfer }, data);
    }
    case PhysicsProtocolType.WORLD_INTERSECTIONS_WITH_RAY: {
      // WORLD_INTERSECTIONS_WITH_RAY
      const intersections: WorldIntersectionsWithRayResponse['intersections'] = [];
      physicsWorldAPI.intersectionsWithRaySync(
        data.ray,
        data.maxToi,
        data.solid,
        (intersect: RayColliderIntersectionAPI) => {
          const colliderId = getCollOrRigidId(intersect.collider);
          if (colliderId !== undefined) {
            intersections.push({ ...intersect, collider: colliderId });
          }
          return true;
        },
        data.filterFlags,
        data.filterGroups,
        data.filterExcludeCollider,
        data.filterExcludeRigidBody
      );
      return sendMessage({ type: data.type, intersections }, data);
    }
    case PhysicsProtocolType.WORLD_CONTACT_PAIRS_WITH: {
      // WORLD_CONTACT_PAIRS_WITH
      const colliderIds: number[] = [];
      physicsWorldAPI.contactPairsWithSync(data.colliderId, (collider2) => {
        const coll2Id = getCollOrRigidId(collider2);
        if (coll2Id !== undefined) colliderIds.push(coll2Id);
      });
      return sendMessage({ type: data.type, colliderIds }, data);
    }
    case PhysicsProtocolType.WORLD_INTERSECTION_PAIRS_WITH: {
      // WORLD_INTERSECTION_PAIRS_WITH
      const colliderIds: number[] = [];
      physicsWorldAPI.intersectionPairsWithSync(data.colliderId, (collider2) => {
        const coll2Id = getCollOrRigidId(collider2);
        if (coll2Id !== undefined) colliderIds.push(coll2Id);
      });
      return sendMessage({ type: data.type, colliderIds }, data);
    }
    case PhysicsProtocolType.WORLD_INTERSECTION_PAIR: {
      // WORLD_INTERSECTION_PAIR
      const isIntersecting = physicsWorldAPI.intersectionPairSync(
        data.colliderId1,
        data.colliderId2
      );
      return sendMessage({ type: data.type, isIntersecting }, data);
    }

    default:
      // ERROR
      sendMessage(
        {
          type: PhysicsProtocolType.ERROR,
          message: `Unknown physics worker (up) protocol type: ${type} (in WORLD sub type)`,
        },
        data
      );
  }
};
