import type { PhysicsBridge, PhysRotation, PhysVector } from './PhysicsCommonTypes';
import type { TempContactForceEvent } from './PhysicsEventTypes';

/**
 * A collider's shape type, as {@link ColliderAPI.shapeType} returns it (Rapier's numbers).
 */
export enum ShapeType {
  /** A sphere (`'BALL'` / `'SPHERE'`). */
  Ball = 0,
  /** A box (`'CUBOID'` / `'BOX'`). */
  Cuboid = 1,
  /** A capsule (`'CAPSULE'`). */
  Capsule = 2,
  /** A segment (no params type makes one). */
  Segment = 3,
  /** A polyline (no params type makes one). */
  Polyline = 4,
  /** A triangle (`'TRIANGLE'`). */
  Triangle = 5,
  /** A triangle mesh (`'TRIMESH'`). */
  TriMesh = 6,
  /** A height field (`'HEIGHTFIELD'`). */
  HeightField = 7,
  /** A convex hull (`'CONVEXHULL'`). */
  ConvexPolyhedron = 9,
  /** A cylinder (`'CYLINDER'`). */
  Cylinder = 10,
  /** A cone (`'CONE'`). */
  Cone = 11,
  /** A box with rounded edges (`'CUBOID'` with a `borderRadius`). */
  RoundCuboid = 12,
  /** A triangle with rounded edges (`'TRIANGLE'` with a `borderRadius`). */
  RoundTriangle = 13,
  /** A cylinder with rounded edges (`'CYLINDER'` with a `borderRadius`). */
  RoundCylinder = 14,
  /** A cone with rounded edges (`'CONE'` with a `borderRadius`). */
  RoundCone = 15,
  /** A convex hull with rounded edges (no params type makes one). */
  RoundConvexPolyhedron = 16,
  /** An infinite half-space (no params type makes one). */
  HalfSpace = 17,
  /** A voxel shape (no params type makes one). */
  Voxels = 18,
}

/**
 * Everything needed to reconstruct a HeightField collider's surface, as returned by
 * ColliderAPI.heights(). `heights` is a nrows x ncols matrix in column-major order,
 * along the shape's local y axis; `scale` sizes the local x/z plane it spans.
 */
export type HeightFieldData = {
  /** The grid's rows. */
  nrows: number;
  /** The grid's columns. */
  ncols: number;
  /** The heights, `nrows` × `ncols`, column-major. */
  heights: Float32Array;
  /** The size of the surface on x and z, and the heights' scale on y. */
  scale: PhysVector;
};

/**
 * A geometric entity that can be attached to a body so it can be affected
 * by contacts and proximity queries.
 * @remarks Every query has an async form and a `*Sync` twin. On MAIN_THREAD both answer at
 * once. On WORKER_THREAD the async form asks the worker (the reply comes a frame or so later)
 * and the `*Sync` twin throws, except `getUserDataSync`, which answers from the proxy's own copy.
 * Setters are one-way: on WORKER_THREAD they apply at the worker's next step.
 */
export type ColliderAPI = {
  /** Collider id (a running integer id). */
  readonly id: number;
  /** The id of the body it's attached to, if any. */
  parentId?: number;

  /** Set when the facade deletes the collider, with its body or its world too: true for a
   * reference kept past the delete. */
  isBeingDeleted: boolean;

  // --- Metadata ---
  /** The user data as this side last saw it (set here, or fetched by `getUserData`). */
  uData: Record<string, unknown>;
  /** The user data, fetched from the worker on WORKER_THREAD (and kept in `uData`). */
  getUserData(): Promise<Record<string, unknown>>;
  /** The user data as `uData` holds it, in both worker targets. */
  getUserDataSync(): Record<string, unknown>;
  /** Replaces the user data, or merges `userData` into it with `addToExisting`. */
  setUserData(userData?: Record<string, unknown>, addToExisting?: boolean): void;

  /** Whether the collider still exists in the world. */
  isValid(): Promise<boolean>;
  /** `isValid()` without the wait: MAIN_THREAD only. */
  isValidSync(): boolean;

  // --- Transformation ---
  /** The world-space translation. */
  translation(): Promise<PhysVector>;
  /** `translation()` without the wait: MAIN_THREAD only. */
  translationSync(): PhysVector;
  /** The translation relative to the parent body, null without one. */
  translationWrtParent(): Promise<PhysVector | null>;
  /** `translationWrtParent()` without the wait: MAIN_THREAD only. */
  translationWrtParentSync(): PhysVector | null;
  /** The world-space rotation. */
  rotation(): Promise<PhysRotation>;
  /** `rotation()` without the wait: MAIN_THREAD only. */
  rotationSync(): PhysRotation;
  /** The rotation relative to the parent body, null without one. */
  rotationWrtParent(): Promise<PhysRotation | null>;
  /** `rotationWrtParent()` without the wait: MAIN_THREAD only. */
  rotationWrtParentSync(): PhysRotation | null;

  /** Sets the world-space translation; an attached collider's goes through
   * `setTranslationWrtParent`. */
  setTranslation(tra: PhysVector): void;
  /** Sets the translation relative to the parent body. */
  setTranslationWrtParent(tra: PhysVector): void;
  /** Sets the world-space rotation; an attached collider's goes through `setRotationWrtParent`. */
  setRotation(rot: PhysRotation): void;
  /** Sets the rotation relative to the parent body. */
  setRotationWrtParent(rot: PhysRotation): void;

  // --- Physical Properties ---
  /** Whether it's a sensor (detects intersections, pushes nothing). */
  isSensor(): Promise<boolean>;
  /** `isSensor()` without the wait: MAIN_THREAD only. */
  isSensorSync(): boolean;
  /** Makes it a sensor or a solid collider. */
  setSensor(isSensor: boolean): void;

  /** Whether it takes part in contacts and queries. */
  isEnabled(): Promise<boolean>;
  /** `isEnabled()` without the wait: MAIN_THREAD only. */
  isEnabledSync(): boolean;
  /** Turns it on or off (off: no contacts, no queries, no mass on its body). */
  setEnabled(enabled: boolean): void;

  /** The friction coefficient. */
  friction(): Promise<number>;
  /** `friction()` without the wait: MAIN_THREAD only. */
  frictionSync(): number;
  /** Sets the friction coefficient (0 is frictionless). */
  setFriction(friction: number): void;
  /** The restitution (bounciness) coefficient. */
  restitution(): Promise<number>;
  /** `restitution()` without the wait: MAIN_THREAD only. */
  restitutionSync(): number;
  /** Sets the restitution coefficient. */
  setRestitution(restitution: number): void;

  /** The mass it gives its body. */
  mass(): Promise<number>;
  /** `mass()` without the wait: MAIN_THREAD only. */
  massSync(): number;
  /** The density its mass comes from (mass = volume × density). */
  density(): Promise<number>;
  /** `density()` without the wait: MAIN_THREAD only. */
  densitySync(): number;
  /** Sets the density (the mass follows from the volume). */
  setDensity(density: number): void;
  /** Sets the mass (the density follows from the volume). */
  setMass(mass: number): void;
  /** Sets the mass properties outright, instead of from the shape. */
  setMassProperties(
    mass: number,
    centerOfMass: PhysVector,
    principalAngularInertia: PhysVector,
    angularInertiaLocalFrame: PhysRotation
  ): void;

  // --- Geometry ---
  /** The shape's type. */
  shapeType(): Promise<ShapeType>;
  /** `shapeType()` without the wait: MAIN_THREAD only. */
  shapeTypeSync(): ShapeType;
  /** The radius of a ball, capsule, cylinder or cone. */
  radius(): Promise<number>;
  /** `radius()` without the wait: MAIN_THREAD only. */
  radiusSync(): number;
  /** The half height of a capsule, cylinder or cone. */
  halfHeight(): Promise<number>;
  /** `halfHeight()` without the wait: MAIN_THREAD only. */
  halfHeightSync(): number;
  /** The half extents of a cuboid. */
  halfExtents(): Promise<PhysVector>;
  /** `halfExtents()` without the wait: MAIN_THREAD only. */
  halfExtentsSync(): PhysVector;

  // --- Geometry (mesh-type shapes) ---
  // The four accessors below exist so a debug visualizer can rebuild a collider's
  // wireframe client-side without Rapier's whole-world debugRender() line soup
  // (debug/_dbg__PhysicsDebugDraw.ts). They are read-only snapshots of
  // shape data that never changes after creation, so a consumer fetches them once per
  // collider — never per frame. MAIN_THREAD returns the live arrays the shape owns:
  // do not mutate them.

  /** Vertex buffer (3 floats per vertex) of any vertex-based shape — TriMesh,
   * ConvexPolyhedron, RoundConvexPolyhedron, Polyline, and also Segment/Triangle/
   * RoundTriangle, whose points are flattened into the same form. Null otherwise. */
  vertices(): Promise<Float32Array | null>;
  /** `vertices()` without the wait: MAIN_THREAD only. */
  verticesSync(): Float32Array | null;
  /** Index buffer that goes with vertices(). Null for shapes that have none, and also
   * for a ConvexPolyhedron built from an auto-computed convex hull. */
  indices(): Promise<Uint32Array | null>;
  /** `indices()` without the wait: MAIN_THREAD only. */
  indicesSync(): Uint32Array | null;
  /** Full HeightField description, or null for every other shape type. The bare heights
   * array is not enough to reconstruct the surface — nrows/ncols give it its grid shape
   * and scale its extent. */
  heights(): Promise<HeightFieldData | null>;
  /** `heights()` without the wait: MAIN_THREAD only. */
  heightsSync(): HeightFieldData | null;
  /** Outward normal of a HalfSpace, or null for every other shape type. */
  normal(): Promise<PhysVector | null>;
  /** `normal()` without the wait: MAIN_THREAD only. */
  normalSync(): PhysVector | null;
  /** Border radius of a RoundCuboid/RoundCylinder/RoundCone/RoundTriangle/
   * RoundConvexPolyhedron, 0 for every other shape type. */
  borderRadius(): Promise<number>;
  /** `borderRadius()` without the wait: MAIN_THREAD only. */
  borderRadiusSync(): number;

  // --- Collision Filtering ---
  /** The groups and mask contacts and queries are filtered by ({@link InteractionGroupsAPI}). */
  collisionGroups(): Promise<InteractionGroupsAPI>;
  /** `collisionGroups()` without the wait: MAIN_THREAD only. */
  collisionGroupsSync(): InteractionGroupsAPI;
  /** Sets the collision groups and mask. */
  setCollisionGroups(groups: InteractionGroupsAPI): void;
  /** The groups and mask the solver's contact forces are filtered by (contacts still detected). */
  solverGroups(): Promise<InteractionGroupsAPI>;
  /** `solverGroups()` without the wait: MAIN_THREAD only. */
  solverGroupsSync(): InteractionGroupsAPI;
  /** Sets the solver groups and mask. */
  setSolverGroups(groups: InteractionGroupsAPI): void;

  // --- Spatial Queries ---
  /** Whether the world-space `point` is inside the shape. */
  containsPoint(point: PhysVector): Promise<boolean>;
  /** `containsPoint()` without the wait: MAIN_THREAD only. */
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
 * A rule applied to combine two colliders' friction or restitution coefficients in a contact
 * (Rapier's numbers). `ColliderParams` takes the same rules as strings
 * (`frictionCombineRule`, `restitutionCombineRule`); nothing in the API takes this enum yet.
 */
export enum CoefficientCombineRule {
  /** The mean of the two. */
  Average = 0,
  /** The smaller of the two. */
  Min = 1,
  /** The product of the two. */
  Multiply = 2,
  /** The larger of the two. */
  Max = 3,
}

/**
 * Which `PhysicsHooks` filters a collider asks for (Rapier's flags). No `ColliderParams`
 * field sets them yet, so no collider asks for any.
 */
export enum ActiveHooks {
  /** No filter. */
  NONE = 0,
  /** Run `filterContactPair` for this collider's contact pairs. */
  FILTER_CONTACT_PAIRS = 1,
  /** Run `filterIntersectionPair` for this collider's intersection pairs. */
  FILTER_INTERSECTION_PAIRS = 2,
}

/**
 * Flags indicating what events are enabled for colliders (Rapier's). `ColliderParams` sets them
 * through `enableCollisionActiveEvents`, `enableContactForceActiveEvents` and the callbacks.
 */
export enum ActiveEvents {
  /** No events. */
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
 * depending on the type of rigid-bodies they are attached to (Rapier's). No `ColliderParams` field
 * sets them yet: every collider has `DEFAULT`.
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
      /** Half the size on x (default 0.5; 0 means the default). */
      hx?: number;
      /** Half the size on y (default 0.5; 0 means the default). */
      hy?: number;
      /** Half the size on z (default 0.5; 0 means the default). */
      hz?: number;
      /** Rounds the edges (a `RoundCuboid`) by this radius. */
      borderRadius?: number;
    }
  | {
      /** Means the same thing (alias) */
      type: 'BALL' | 'SPHERE';
      /** The radius (default 0.5; 0 means the default). */
      radius?: number;
    }
  | {
      /** Three different shapes (they just have the same props), along the local y axis */
      type: 'CAPSULE' | 'CONE' | 'CYLINDER';
      /** Half the height (default 0.25, a cylinder's 0.5; 0 means the default); a capsule's
       * without its caps. */
      halfHeight?: number;
      /** The radius (default 0.25, a cylinder's 1; 0 means the default). */
      radius?: number;
      /** Rounds a cone's or a cylinder's edges by this radius (a capsule ignores it). */
      borderRadius?: number;
    }
  | {
      type: 'TRIANGLE';
      /** The first corner. */
      a: PhysVector;
      /** The second corner. */
      b: PhysVector;
      /** The third corner. */
      c: PhysVector;
      /** Rounds the edges (a `RoundTriangle`) by this radius. */
      borderRadius?: number;
    }
  | {
      type: 'TRIMESH';
      /** The vertices, 3 floats each. Required: the create throws without them. */
      vertices?: Float32Array;
      /** The triangles' vertex indices, 3 per triangle. Required: the create throws without them. */
      indices?: Uint32Array;
    }
  | {
      /** A grid of heights on the local x / z plane (see {@link HeightFieldData}); every field
       * is required, the create throws without one. */
      type: 'HEIGHTFIELD';
      /** The grid's rows (rounded). */
      nrows?: number;
      /** The grid's columns (rounded). */
      ncols?: number;
      /** The size of the surface on x and z, and the heights' scale on y. */
      scale?: PhysVector;
      /** The heights, `nrows` × `ncols`, column-major. */
      heights?: Float32Array;
    }
  | {
      type: 'CONVEXHULL';
      /** The points to wrap, 3 floats each. Required: the create throws without them. */
      vertices?: Float32Array;
    };

/**
 * What `createCollider` and `createPhysicsEntity` make a collider from: a shape
 * ({@link ShapeParams}) and its placement, material and events. Everything but the shape's `type`
 * is optional and left at Rapier's default when not given.
 */
export type ColliderParams = ShapeParams & {
  /** Enabled (default true)  */
  enabled?: boolean;

  /** Density (default 1.0, Rapier's): the collider gives its body volume × density of mass */
  density?: number;

  /** Translation (position): relative to the parent body when there is one, world space otherwise */
  translation?: { x: number; y: number; z: number };

  /** Rotation in quaternion: relative to the parent body when there is one, world space otherwise.
   * Applied after the shape's own `orientation`. */
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

  /**
   * The shape's own rotation, applied before {@link ColliderParams.rotation}: Rapier's capsule, cone
   * and cylinder stand on Y, and the importer turns an imported node's onto its `spineAxis` custom
   * prop (`'x'` or `'z'`) with it. Code-made colliders set `rotation` instead.
   */
  orientation?: PhysRotation;
};

/**
 * {@link ColliderAPI} as a worker proxy would look with every getter async (unused so far).
 * @internal
 */
export type ColliderProxyAPIType = PhysicsBridge<ColliderAPI>;
