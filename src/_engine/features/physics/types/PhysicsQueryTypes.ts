import type { RayDebugOpts } from '../../../kernel/render/RayDebugTypes';
import type { ColliderAPI } from './PhysicsColliderTypes';
import type { PhysVector } from './PhysicsCommonTypes';

/** The physics queries a {@link PhysicsQueryObserver} sees. */
export type PhysicsQueryKind =
  | 'CAST_RAY'
  | 'CAST_RAY_AND_GET_NORMAL'
  | 'INTERSECTIONS_WITH_RAY'
  | 'CAST_SHAPE';

/**
 * Sees every physics query the main thread issues (stats and debug helpers, see PhysicsAPI.ts).
 * Engine-agnostic: a backend calls it from its query methods (MAIN_THREAD), the worker proxy
 * calls it around each query message (WORKER_THREAD). It is never set in the worker.
 *
 * `dir`, `maxToi` and every toi are as the query was issued: toi is in units of `|dir|` (a
 * shape cast's `dir` is its `shapeVel`), so the distance is `toi * |dir|`.
 */
export type PhysicsQueryObserver = {
  /** Called when a query is issued. Returns a token for `onResult`. */
  onQuery: (
    kind: PhysicsQueryKind,
    origin: PhysVector,
    dir: PhysVector,
    maxToi: number,
    debug: RayDebugOpts | undefined
  ) => number;
  /** Called once the query's result is known: right away on MAIN_THREAD, when the worker's
   * reply arrives on WORKER_THREAD. A query whose reply never arrives never calls it.
   * @param firstHitToi the smallest toi of the returned hits, null when nothing was hit
   * @param hitCount how many hits the caller got (0 or 1, or any for INTERSECTIONS_WITH_RAY) */
  onResult: (token: number, firstHitToi: number | null, hitCount: number) => void;
};

/**
 * A ray. This is a directed half-line.
 */
export type PhysRay = {
  /**
   * The starting point of the ray.
   */
  origin: PhysVector;
  /**
   * The direction of propagation of the ray.
   */
  dir: PhysVector;
};

/**
 * The intersection between a ray and a collider (includes the collider handle).
 */
export type RayColliderIntersectionAPI = {
  /**
   * The collider hit by the ray.
   */
  collider: ColliderAPI;
  /**
   * The time-of-impact of the ray with the collider.
   *
   * The hit point is obtained from the ray's origin and direction: `origin + dir * timeOfImpact`.
   */
  timeOfImpact: number;
  /**
   * The normal of the collider at the hit point.
   */
  normal: PhysVector;
  /**
   * The type of the geometric feature the point was projected on.
   */
  featureType: FeatureType;
  /**
   * The id of the geometric feature the point was projected on.
   */
  featureId: number | undefined;
};

/** The first collider a ray hit (`WorldAPI.castRay`), without the normal. */
export type RayColliderHitAPI = {
  /**
   * The collider hit by the ray.
   */
  collider: ColliderAPI;
  /**
   * The time-of-impact of the ray with the collider.
   *
   * The hit point is obtained from the ray's origin and direction: `origin + dir * timeOfImpact`.
   */
  timeOfImpact: number;
};

/** The first collider a cast shape hit (`WorldAPI.castShape`), with the contact on both. */
export type ShapeCastHitAPI = {
  /**
   * The collider hit by the cast shape.
   */
  collider: ColliderAPI;
  /**
   * The time-of-impact of the cast shape with the collider.
   */
  timeOfImpact: number;
  /**
   * The world-space contact point on the hit collider, at the time of impact.
   */
  witness1: PhysVector;
  /**
   * The contact point on the cast shape, at the time of impact, in the cast shape's local space
   * (relative to its position at the time of impact, in its rotation).
   */
  witness2: PhysVector;
  /**
   * The world-space contact normal on the hit collider (pointing out of it, toward the cast
   * shape), at the time of impact.
   */
  normal1: PhysVector;
  /**
   * The contact normal on the cast shape (pointing out of it, toward the hit collider), at the
   * time of impact, in the cast shape's local space.
   */
  normal2: PhysVector;
};

/**
 * The projection of a point on a collider.
 */
export type PointProjection = {
  /**
   * The projection of the point on the collider.
   */
  point: PhysVector;
  /**
   * Is the point inside of the collider?
   */
  isInside: boolean;
};

/** Which part of a shape a ray hit (Rapier's numbers). */
export enum FeatureType {
  /** The ray hit a corner point; `featureId` is its index. */
  Vertex = 0,
  /** The ray hit where two faces meet; `featureId` is its index. */
  Edge = 1,
  /** The ray hit a face's inside; `featureId` is its index. */
  Face = 2,
  /** Not known (some shapes don't tell). */
  Unknown = 3,
}

/**
 * The intersection between a ray and a collider.
 */
export type RayIntersection = {
  /**
   * The time-of-impact of the ray with the collider.
   *
   * The hit point is obtained from the ray's origin and direction: `origin + dir * timeOfImpact`.
   */
  timeOfImpact: number;
  /**
   * The normal of the collider at the hit point.
   */
  normal: PhysVector;
  /**
   * The type of the geometric feature the point was projected on.
   */
  featureType: FeatureType;
  /**
   * The id of the geometric feature the point was projected on.
   */
  featureId: number | undefined;
};

/**
 * Flags for excluding whole sets of colliders from a scene query.
 */
export enum QueryFilterFlags {
  /**
   * Exclude from the query any collider attached to a fixed rigid-body and colliders with no rigid-body attached.
   */
  EXCLUDE_FIXED = 1,
  /**
   * Exclude from the query any collider attached to a kinematic rigid-body.
   */
  EXCLUDE_KINEMATIC = 2,
  /**
   * Exclude from the query any collider attached to a dynamic rigid-body.
   */
  EXCLUDE_DYNAMIC = 4,
  /**
   * Exclude from the query any collider that is a sensor.
   */
  EXCLUDE_SENSORS = 8,
  /**
   * Exclude from the query any collider that is not a sensor.
   */
  EXCLUDE_SOLIDS = 16,
  /**
   * Excludes all colliders not attached to a dynamic rigid-body.
   */
  ONLY_DYNAMIC = 3,
  /**
   * Excludes all colliders not attached to a kinematic rigid-body.
   */
  ONLY_KINEMATIC = 5,
  /**
   * Exclude all colliders attached to a non-fixed rigid-body
   * (this will not exclude colliders not attached to any rigid-body).
   */
  ONLY_FIXED = 6,
}
