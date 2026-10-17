import type { PhysicsBridge, PhysRotation, PhysVector } from './PhysicsCommonTypes';
import type { TempContactForceEvent } from './PhysicsEventTypes';

/**
 * An enumeration representing the type of a shape.
 */
export enum ShapeType {
  Ball = 0,
  Cuboid = 1,
  Capsule = 2,
  Segment = 3,
  Polyline = 4,
  Triangle = 5,
  TriMesh = 6,
  HeightField = 7,
  ConvexPolyhedron = 9,
  Cylinder = 10,
  Cone = 11,
  RoundCuboid = 12,
  RoundTriangle = 13,
  RoundCylinder = 14,
  RoundCone = 15,
  RoundConvexPolyhedron = 16,
  HalfSpace = 17,
  Voxels = 18,
}

/**
 * Everything needed to reconstruct a HeightField collider's surface, as returned by
 * ColliderAPI.heights(). `heights` is a nrows x ncols matrix in column-major order,
 * along the shape's local y axis; `scale` sizes the local x/z plane it spans.
 */
export type HeightFieldData = {
  nrows: number;
  ncols: number;
  heights: Float32Array;
  scale: PhysVector;
};

/**
 * A geometric entity that can be attached to a body so it can be affected
 * by contacts and proximity queries.
 */
export type ColliderAPI = {
  readonly id: number;
  parentId?: number;

  isBeingDeleted: boolean;

  // --- Metadata ---
  uData: Record<string, unknown>;
  getUserData(): Promise<Record<string, unknown>>;
  getUserDataSync(): Record<string, unknown>;
  setUserData(userData?: Record<string, unknown>, addToExisting?: boolean): void;

  isValid(): Promise<boolean>;
  isValidSync(): boolean;

  // --- Transformation ---
  translation(): Promise<PhysVector>;
  translationSync(): PhysVector;
  translationWrtParent(): Promise<PhysVector | null>;
  translationWrtParentSync(): PhysVector | null;
  rotation(): Promise<PhysRotation>;
  rotationSync(): PhysRotation;
  rotationWrtParent(): Promise<PhysRotation | null>;
  rotationWrtParentSync(): PhysRotation | null;

  setTranslation(tra: PhysVector): void;
  setTranslationWrtParent(tra: PhysVector): void;
  setRotation(rot: PhysRotation): void;
  setRotationWrtParent(rot: PhysRotation): void;

  // --- Physical Properties ---
  isSensor(): Promise<boolean>;
  isSensorSync(): boolean;
  setSensor(isSensor: boolean): void;

  isEnabled(): Promise<boolean>;
  isEnabledSync(): boolean;
  setEnabled(enabled: boolean): void;

  friction(): Promise<number>;
  frictionSync(): number;
  setFriction(friction: number): void;
  restitution(): Promise<number>;
  restitutionSync(): number;
  setRestitution(restitution: number): void;

  mass(): Promise<number>;
  massSync(): number;
  density(): Promise<number>;
  densitySync(): number;
  setDensity(density: number): void;
  setMass(mass: number): void;
  setMassProperties(
    mass: number,
    centerOfMass: PhysVector,
    principalAngularInertia: PhysVector,
    angularInertiaLocalFrame: PhysRotation
  ): void;

  // --- Geometry ---
  shapeType(): Promise<ShapeType>;
  shapeTypeSync(): ShapeType;
  radius(): Promise<number>;
  radiusSync(): number;
  halfHeight(): Promise<number>;
  halfHeightSync(): number;
  halfExtents(): Promise<PhysVector>;
  halfExtentsSync(): PhysVector;

  // --- Geometry (mesh-type shapes) ---
  // The four accessors below exist so a debug visualizer can rebuild a collider's
  // wireframe client-side without Rapier's whole-world debugRender() line soup
  // (Debug/_dbg__PhysicsDebugDraw.ts). They are read-only snapshots of
  // shape data that never changes after creation, so a consumer fetches them once per
  // collider — never per frame. MAIN_THREAD returns the live arrays the shape owns:
  // do not mutate them.

  /** Vertex buffer (3 floats per vertex) of any vertex-based shape — TriMesh,
   * ConvexPolyhedron, RoundConvexPolyhedron, Polyline, and also Segment/Triangle/
   * RoundTriangle, whose points are flattened into the same form. Null otherwise. */
  vertices(): Promise<Float32Array | null>;
  verticesSync(): Float32Array | null;
  /** Index buffer that goes with vertices(). Null for shapes that have none, and also
   * for a ConvexPolyhedron built from an auto-computed convex hull. */
  indices(): Promise<Uint32Array | null>;
  indicesSync(): Uint32Array | null;
  /** Full HeightField description, or null for every other shape type. The bare heights
   * array is not enough to reconstruct the surface — nrows/ncols give it its grid shape
   * and scale its extent. */
  heights(): Promise<HeightFieldData | null>;
  heightsSync(): HeightFieldData | null;
  /** Outward normal of a HalfSpace, or null for every other shape type. */
  normal(): Promise<PhysVector | null>;
  normalSync(): PhysVector | null;
  /** Border radius of a RoundCuboid/RoundCylinder/RoundCone/RoundTriangle/
   * RoundConvexPolyhedron, 0 for every other shape type. */
  borderRadius(): Promise<number>;
  borderRadiusSync(): number;

  // --- Collision Filtering ---
  collisionGroups(): Promise<InteractionGroupsAPI>;
  collisionGroupsSync(): InteractionGroupsAPI;
  setCollisionGroups(groups: InteractionGroupsAPI): void;
  solverGroups(): Promise<InteractionGroupsAPI>;
  solverGroupsSync(): InteractionGroupsAPI;
  setSolverGroups(groups: InteractionGroupsAPI): void;

  // --- Spatial Queries ---
  containsPoint(point: PhysVector): Promise<boolean>;
  containsPointSync(point: PhysVector): boolean;
};

/**
 * Pairwise filtering using bit masks.
 *
 * This filtering method is based on two 16-bit values:
 * - The interaction groups (the 16 left-most bits of `self.0`).
 * - The interaction mask (the 16 right-most bits of `self.0`).
 *
 * An interaction is allowed between two filters `a` and `b` two conditions
 * are met simultaneously:
 * - The interaction groups of `a` has at least one bit set to `1` in common with the interaction mask of `b`.
 * - The interaction groups of `b` has at least one bit set to `1` in common with the interaction mask of `a`.
 * In other words, interactions are allowed between two filter iff. the following condition is met:
 *
 * ```
 * ((a >> 16) & b) != 0 && ((b >> 16) & a) != 0
 * ```
 */
export type InteractionGroupsAPI = number;

/**
 * A rule applied to combine coefficients.
 *
 * Use this when configuring the `ColliderDesc` to specify
 * how friction and restitution coefficient should be combined
 * in a contact.
 */
export enum CoefficientCombineRule {
  Average = 0,
  Min = 1,
  Multiply = 2,
  Max = 3,
}

export enum ActiveHooks {
  NONE = 0,
  FILTER_CONTACT_PAIRS = 1,
  FILTER_INTERSECTION_PAIRS = 2,
}

/**
 * Flags indicating what events are enabled for colliders.
 */
export enum ActiveEvents {
  NONE = 0,
  /**
   * Enable collision events.
   */
  COLLISION_EVENTS = 1,
  /**
   * Enable contact force events.
   */
  CONTACT_FORCE_EVENTS = 2,
}

/**
 * Flags affecting whether collision-detection happens between two colliders
 * depending on the type of rigid-bodies they are attached to.
 */
export enum ActiveCollisionTypes {
  /**
   * Enable collision-detection between a collider attached to a dynamic body
   * and another collider attached to a dynamic body.
   */
  DYNAMIC_DYNAMIC = 1,
  /**
   * Enable collision-detection between a collider attached to a dynamic body
   * and another collider attached to a kinematic body.
   */
  DYNAMIC_KINEMATIC = 12,
  /**
   * Enable collision-detection between a collider attached to a dynamic body
   * and another collider attached to a fixed body (or not attached to any body).
   */
  DYNAMIC_FIXED = 2,
  /**
   * Enable collision-detection between a collider attached to a kinematic body
   * and another collider attached to a kinematic body.
   */
  KINEMATIC_KINEMATIC = 52224,
  /**
   * Enable collision-detection between a collider attached to a kinematic body
   * and another collider attached to a fixed body (or not attached to any body).
   */
  KINEMATIC_FIXED = 8704,
  /**
   * Enable collision-detection between a collider attached to a fixed body (or
   * not attached to any body) and another collider attached to a fixed body (or
   * not attached to any body).
   */
  FIXED_FIXED = 32,
  /**
   * The default active collision types, enabling collisions between a dynamic body
   * and another body of any type, but not enabling collisions between two non-dynamic bodies.
   */
  DEFAULT = 15,
  /**
   * Enable collisions between any kind of rigid-bodies (including between two non-dynamic bodies).
   */
  ALL = 60943,
}

/** The pure shape-geometry portion of {@link ColliderParams} (no placement/physics fields) —
 * also used standalone by `castShape`/`castShapeSync` to describe the shape being cast, since
 * a shape cast has no collider of its own to draw its geometry from. */
export type ShapeParams =
  | {
      /** Means the same thing (alias) */
      type: 'CUBOID' | 'BOX';
      hx?: number;
      hy?: number;
      hz?: number;
      borderRadius?: number;
    }
  | {
      /** Means the same thing (alias) */
      type: 'BALL' | 'SPHERE';
      radius?: number;
    }
  | {
      /** Three different shapes (they just have the same props) */
      type: 'CAPSULE' | 'CONE' | 'CYLINDER';
      halfHeight?: number;
      radius?: number;
      borderRadius?: number;
    }
  | {
      type: 'TRIANGLE';
      a: PhysVector;
      b: PhysVector;
      c: PhysVector;
      borderRadius?: number;
    }
  | {
      type: 'TRIMESH';
      vertices?: Float32Array;
      indices?: Uint32Array;
    }
  | {
      type: 'HEIGHTFIELD';
      nrows?: number;
      ncols?: number;
      scale?: PhysVector;
      heights?: Float32Array;
    }
  | {
      type: 'CONVEXHULL';
      vertices?: Float32Array;
    };

export type ColliderParams = ShapeParams & {
  /** Enabled (default true)  */
  enabled?: boolean;

  /** Mass (default 1.0) */
  density?: number;

  /** Translation (position), only has affect if there is no rigid body */
  translation?: { x: number; y: number; z: number };

  /** Rotation (position) in quaternion, only has affect if there is no rigid body */
  rotation?: { x: number; y: number; z: number; w: number };

  /** Object's friction value, usually between 0 to 1 but can me more (default 0.5, Rapier's) */
  friction?: number;

  /** How two colliding objects apply friction (default AVERAGE). The following precedence is used: MAX > MULTIPLY > MIN > AVERAGE. */
  frictionCombineRule?: 'MAX' | 'MULTIPLY' | 'MIN' | 'AVERAGE';

  /** Object restitution (bounce) value, usually between 0 to 1 but can me more (default 0, Rapier's) */
  restitution?: number;

  /** How two colliding objects apply restitution (default AVERAGE). The following precedence is used: MAX > MULTIPLY > MIN > AVERAGE. */
  restitutionCombineRule?: 'MAX' | 'MULTIPLY' | 'MIN' | 'AVERAGE';

  /** Whether the collider is a sensor or not */
  isSensor?: boolean;

  /** Enables collision events, if collisionEventFn is defined this is enabled automatically */
  enableCollisionActiveEvents?: boolean;

  /** Enables collision events, if collisionEventFn is defined this is enabled automatically */
  enableContactForceActiveEvents?: boolean;

  /** Do not set manually! Whether the collider has a collision event function or not */
  hasCollisionEventFn?: boolean;

  /** Creates a collision event callback, automatically sets enableCollisionActiveEvents to true for the collider */
  collisionEventFn?: (collider1: ColliderAPI, collider2: ColliderAPI, started: boolean) => void;

  /** Do not set manually! Whether the collider has a contact force event function or not */
  hasContactForceEventFn?: boolean;

  /** Creates a contact force event callback, automatically sets enableContactForceActiveEvents to true for the collider */
  contactForceEventFn?: (e: TempContactForceEvent) => void;

  /** User data to be added to the collider */
  userData?: Record<string, unknown>;

  /** Possible parent id (rigid body) to attach the collider to */
  parentId?: number;

  /** Do not set manually! Orientation to set for imported models (custom property "orientation: 'x' | 'z'" defines this). */
  orientation?: PhysRotation;
};

export type ColliderProxyAPIType = PhysicsBridge<ColliderAPI>;
