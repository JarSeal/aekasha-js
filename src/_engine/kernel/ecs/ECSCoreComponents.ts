import * as THREE from 'three/webgpu';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import type { ColliderAPI, RigidBodyAPI } from '../../features/physics/PhysicsAPITypes';
import type {
  PhysicsSimTierData,
  PhysicsTierPolicyMemberData,
} from '../../features/physics/PhysicsTierTypes';
import type { PhysicsWireframeColors } from '../config/Config';
import type { EntityDebugData, ManagedByData } from './ECSRegistry';
import { CoreComponentType as CoreType } from './ECSRegistry';
import type { CharacterObject } from '../../features/character/CharacterTypes';
import type { LodData } from '../../features/lod/LodTypes';
import type { InstancedMeshSlotData } from '../../features/instancing/InstancedMeshPoolTypes';

/** A position (or any 3D vector) as plain numbers. */
export type ECSPosition = { x: number; y: number; z: number };
/** A rotation as a quaternion's plain numbers. */
export type ECSRotation = { x: number; y: number; z: number; w: number };
/** A pose change: a position, a rotation or both (`setTransform`, `teleport`). */
export type ECSTransformProp =
  | { pos: ECSPosition; rot?: ECSRotation }
  | { pos?: ECSPosition; rot: ECSRotation };
/** The `LIFETIME` component: the entity is deleted when `remaining` reaches 0 (at `LATE_MAIN`). */
export interface LifetimeData {
  /** Seconds until the entity is deleted, counted down by the app loop's delta. */
  remaining: number;
  /** The starting duration in seconds. */
  total: number;
}

/**
 * The engine's own component types' data, by key: the base of {@link ComponentDataMap}. Read a
 * component's data type as `ComponentData[typeof ComponentType.X]`.
 */
export interface CoreComponentData {
  /** The entity's app id (`createEntity`'s `appId`, else a generated UUID: `isFixed` false), found
   * with `getEntityIdByAppId`. Don't change `id` in place: add a new `APP_ID` instead. */
  [CoreType.APP_ID]: { id: string; isFixed: boolean };
  /** The entity's position, rotation and scale ({@link Transform}). */
  [CoreType.TRANSFORM]: Transform;
  /** Present: the entity is disabled (`setDisabled`): hidden, its body disabled. */
  [CoreType.DISABLED]: boolean;
  /** Present: the entity survives a scene switch (`clearNonPersistent`), and so does its
   * `TARGET_LINK` target. */
  [CoreType.PERSISTENT]: boolean;
  /** The app's own data for the entity (`createEntity`'s `userData`). */
  [CoreType.USER_DATA]: Record<string, unknown>;
  /** Deletes the entity when it runs out ({@link LifetimeData}). */
  [CoreType.LIFETIME]: LifetimeData;
  /** The entity's Object3D, which `TRANSFORM` is synced to; `_lastVersion` is the transform
   * version last copied. Adding it tags the entity by kind (`TAG_IS_MESH`, …). */
  [CoreType.OBJECT3D]: { value: THREE.Object3D; _lastVersion: number };
  /** The entity it faces (`lookAtSystem`), eg. a light's target; disabling or making this entity
   * persistent does the same to the target. */
  [CoreType.TARGET_LINK]: { targetId: number };
  /** A camera's settings (`createCameraEntity`). */
  [CoreType.CAMERA_SETTINGS]: {
    type: 'PERSPECTIVE' | 'ORTHOGRAPHIC';
    fov: number; // Only for Perspective
    near: number;
    far: number;
    zoom: number;
    frustumSize: number; // Only for Orthographic (Standard vertical size)
    responsiveAspect: boolean; // Hor+ aspect-ratio compensation (both camera types)
    referenceAspect: number; // Aspect ratio the base fov/frustumSize were authored for
  };
  /** A camera's OrbitControls and the scene they were made for. */
  [CoreType.ORBIT_CONTROLS]: {
    controls: OrbitControls;
    sceneId: string;
  };
  /** A line bound to this entity (`features/lines/Lines.ts`' createLineEntity / bindLineToEntity):
   * the entity's deletion disposes it. Holds the id, not the LineObject or its Object3D — a
   * line swaps its Object3D when it moves between the thin and thick backends, so a stored
   * object would go stale. Resolve it with getLineForEntity. */
  [CoreType.LINE]: { lineId: string };
  /** The manager that owns the entity ({@link ManagedByData}, `CoreEntityOpts.managedBy`). */
  [CoreType.MANAGED_BY]: ManagedByData;
  /** A character's registry entry (`aekasha/character`'s `createCharacter`). */
  [CoreType.CHARACTER]: CharacterObject;
  // Physics
  /** The entity's colliders (`aekasha/physics`' `createPhysicsEntity`). */
  [CoreType.COLLIDER]: ColliderAPI[];
  /** A dynamic body with an Object3D: synced to `TRANSFORM` every frame. */
  [CoreType.BODY_DYNAMIC_VISUAL]: RigidBodyAPI;
  /** A dynamic body without an Object3D: synced to `TRANSFORM` every frame. */
  [CoreType.BODY_DYNAMIC_HEADLESS]: RigidBodyAPI;
  /** A fixed body, or a dynamic one a `STATIC` or `DISABLED` physics tier froze: not synced per
   * frame. */
  [CoreType.BODY_STATIC]: RigidBodyAPI;
  /** Set by requestPhysicsTier (features/physics/PhysicsTiers.ts): don't add it directly. */
  [CoreType.PHYSICS_SIM_TIER]: PhysicsSimTierData;
  /** Added by createPhysicsEntity's `tierPolicy` option or setPhysicsTierPolicyMember
   * (features/physics/PhysicsTierPolicy.ts). */
  [CoreType.PHYSICS_TIER_POLICY]: PhysicsTierPolicyMemberData;
  // Tags: present means yes. The kind tags come from the OBJECT3D's add hook
  /** The Object3D is a mesh (also a thick engine line). */
  [CoreType.TAG_IS_MESH]: boolean;
  /** The Object3D is a group. */
  [CoreType.TAG_IS_GROUP]: boolean;
  /** The Object3D is a line (a thin one, or a thick engine line, re-tagged by the lines feature). */
  [CoreType.TAG_IS_LINE]: boolean;
  /** The Object3D is a light. */
  [CoreType.TAG_IS_LIGHT]: boolean;
  /** The Object3D is an ambient light. */
  [CoreType.TAG_IS_AMBIENT_LIGHT]: boolean;
  /** The Object3D is a hemisphere light. */
  [CoreType.TAG_IS_HEMISPHERE_LIGHT]: boolean;
  /** The Object3D is a point light. */
  [CoreType.TAG_IS_POINT_LIGHT]: boolean;
  /** The Object3D is a directional light. */
  [CoreType.TAG_IS_DIRECTIONAL_LIGHT]: boolean;
  /** The Object3D is a spot light. */
  [CoreType.TAG_IS_SPOT_LIGHT]: boolean;
  /** The Object3D is a camera. */
  [CoreType.TAG_IS_CAMERA]: boolean;
  /** The scene's main camera (one at a time, `setMainCamera`): culling and LOD measure from it,
   * whatever camera renders (the debug camera's doesn't count). */
  [CoreType.TAG_IS_MAIN_CAMERA]: boolean;
  /** A character's entity. */
  [CoreType.TAG_IS_CHARACTER]: boolean;
  /** A physics entity (its Object3D's `userData.isPhysicsObject`, or `createPhysicsEntity`). */
  [CoreType.TAG_IS_PHYSICS_OBJECT]: boolean;
  // Frustum culling
  /** Opt-in: the entity is hidden while outside the main camera's frustum (a mesh, a point or a
   * spot light). */
  [CoreType.FRUSTUM_CULLING_ENABLED]: boolean;
  /** Runtime state: the entity is frustum culled now. Don't add it. */
  [CoreType.TAG_FRUSTUM_CULLED]: boolean;
  // Object (contribution) culling
  /** Opt-in: a light is turned off while it lights nothing in view (`spatial()`'s light culling). */
  [CoreType.OBJECT_CULLING_ENABLED]: boolean;
  /** Runtime state: the light is object culled now. Don't add it. */
  [CoreType.TAG_OBJECT_CULLED]: boolean;
  /** Opt-in: the entity is in the world's `DEFAULT` spatial domain (`spatial()`). A plain marker:
   * the spatial grid (features/spatial/SpatialIndexSystem.ts) owns the position and radius. */
  [CoreType.SPATIAL_INDEXED]: boolean;
  /** Bit i = member of the world's spatial domain with bit index i. Kept by
   * joinSpatialDomain/leaveSpatialDomain (features/spatial/SpatialIndexSystem.ts): don't add it
   * directly. */
  [CoreType.SPATIAL_DOMAINS]: { mask: number };
  // LOD selection
  /** Opt-in: the entity's LOD levels and its selected and applied level (`lod()`). */
  [CoreType.LOD]: LodData;
  /** Runtime state: the entity is beyond its last LOD level, hidden. Don't add it. */
  [CoreType.TAG_LOD_CULLED]: boolean;
  /** Runtime state: a LOD cross-fade is running on the entity. Don't add it. */
  [CoreType.TAG_LOD_TRANSITIONING]: boolean;
  /** An instanced mesh pool's slot, set by the pool's spawn (`instancing()`). */
  [CoreType.INSTANCED_MESH_SLOT]: InstancedMeshSlotData;
  // Debug
  /** What the debug tools show for the entity ({@link EntityDebugData}); stored only in the debug
   * env and prod test mode. */
  [CoreType.DEBUG_DATA]: EntityDebugData;
  /** A light's debug helper (and its shadow camera's). Debug env only. */
  [CoreType.DEBUG_LIGHT_HELPER]: {
    value: THREE.PointLightHelper | THREE.DirectionalLightHelper | THREE.SpotLightHelper;
    camHelper?: THREE.CameraHelper;
  };
  /** A camera's debug helper. Debug env only. */
  [CoreType.DEBUG_CAMERA_HELPER]: { value: THREE.CameraHelper };
  /** The entity's 3D debug symbol, and whether the user switched it on. Debug env only. */
  [CoreType.DEBUG_SYMBOL]: { value: THREE.Group | THREE.Mesh; userVisible: boolean };
  /** Opt-in, per-entity collider wireframe.
   * Its presence IS the on/off toggle — absent on every physics entity by default. The
   * THREE objects it drives are owned by features/physics/debug/_dbg__PhysicsDebugDraw.ts rather
   * than stored here, because they're built asynchronously (WORKER_THREAD mode fetches the
   * collider's shape over RPC) and addComponent is synchronous. */
  [CoreType.DEBUG_PHYSICS_WIREFRAME]: {
    /** Seeds this entity's color overrides, each key falling back to the global tab
     * value and then to AppConfig.debugPhysicsWireframe.colors. Read once when the
     * component is added — _dbg__PhysicsDebugDraw.ts then owns them, so they outlive
     * the wireframe being switched off and back on. */
    colorOverrides?: PhysicsWireframeColors;
  };
  /** The scene debug camera's entity. Debug env only. */
  [CoreType.DEBUG_TAG_IS_DEBUG_CAMERA]: boolean;
  /** An ECS stress test entity drawn as one instance of the test's InstancedMesh
   * (kernel/ecs/debug/ECSStressTest.ts). */
  [CoreType.DEBUG_STRESS_TEST_INSTANCE]: { mesh: THREE.InstancedMesh; index: number };
  /** An ECS stress test entity's bobbing (kernel/ecs/debug/ECSStressTest.ts). */
  [CoreType.DEBUG_STRESS_TEST_HOVER]: {
    speed: number;
    amplitude: number;
    baseY: number;
    time: number;
  };
}

/**
 * Every component type's data, by its key: the engine's own, plus the keys app and toolkit
 * modules add by augmenting `'aekasha'`.
 * @remarks Augment only `'aekasha'`, never a deep path to this file: the same interface augmented
 * through two specifiers in one program loses keys without an error.
 * @example
 * ```ts
 * export const SpinComponentType = { SPIN: 'APP_SPIN' } as const;
 *
 * declare module 'aekasha' {
 *   interface ComponentDataMap {
 *     [SpinComponentType.SPIN]: { speed: number };
 *   }
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- the declaration merging target
export interface ComponentDataMap extends CoreComponentData {}

/** The engine's own component keys (the same object as `CoreComponentType`). App and
 * toolkit keys live in their own modules' key objects. */
export const ComponentType = CoreType;
/** Any component key the program knows: the engine's and every augmented one. */
export type ComponentType = keyof ComponentDataMap;
/** Every component type's data, by its key ({@link ComponentDataMap}: augment that, not this). */
export type ComponentData = ComponentDataMap;

/**
 * The tags `OBJECT3D`'s add hook gives an entity, by the Object3D's `is*` flag (a mesh gets
 * `TAG_IS_MESH`, …), so systems find each kind by its tag instead of testing every Object3D.
 * @internal
 */
export const OBJECT3D_TAGS = [
  { prop: 'isMesh', tag: ComponentType.TAG_IS_MESH },
  { prop: 'isGroup', tag: ComponentType.TAG_IS_GROUP },
  { prop: 'isLight', tag: ComponentType.TAG_IS_LIGHT },
  { prop: 'isCamera', tag: ComponentType.TAG_IS_CAMERA },
  { prop: 'isAmbientLight', tag: ComponentType.TAG_IS_AMBIENT_LIGHT },
  { prop: 'isHemisphereLight', tag: ComponentType.TAG_IS_HEMISPHERE_LIGHT },
  { prop: 'isPointLight', tag: ComponentType.TAG_IS_POINT_LIGHT },
  { prop: 'isDirectionalLight', tag: ComponentType.TAG_IS_DIRECTIONAL_LIGHT },
  { prop: 'isSpotLight', tag: ComponentType.TAG_IS_SPOT_LIGHT },
  // Any THREE.Line/LineSegments/LineLoop. A thick engine line (features/lines/) is a Mesh
  // instead, so this rule misses it and `isMesh` tags it TAG_IS_MESH — the lines feature re-tags
  // those entities itself (features/lines/LineEntity.ts' retagLineEntity).
  { prop: 'isLine', tag: ComponentType.TAG_IS_LINE },
] as const;

/**
 * The `TRANSFORM` component: an entity's position, rotation and scale. Its `version` goes up with
 * every `setDirty()`, and the sync to the Object3D (`object3DSyncSystem`, at `MAIN`) copies only a
 * transform whose version changed.
 * @remarks Change one in place, call `setDirty()`, then `world.commitTransform(entityId, transform)`:
 * in `TYPED_ARRAY` mode the transform `getComponent` returns is a copy.
 */
export class Transform {
  /** Where the entity is, in its parent's space (world space for a root object). */
  readonly position = new THREE.Vector3(0, 0, 0);
  /** How the entity is turned, as a quaternion. */
  readonly quaternion = new THREE.Quaternion(0, 0, 0, 1);
  /** The entity's size factor per axis (1: unchanged). */
  readonly scale = new THREE.Vector3(1, 1, 1);
  /** Goes up with each `setDirty()`: the Object3D sync compares it with the one it last copied. */
  version = 0;

  /** A transform at `pos`, `rot` and `scale` (default: the origin, no rotation, scale 1). */
  constructor(opts?: {
    pos?: ECSPosition;
    rot?: ECSRotation;
    scale?: { x: number; y: number; z: number };
  }) {
    if (opts?.pos) this.position.set(opts.pos.x, opts.pos.y, opts.pos.z);
    if (opts?.rot) this.quaternion.set(opts.rot.x, opts.rot.y, opts.rot.z, opts.rot.w);
    if (opts?.scale) this.scale.set(opts.scale.x, opts.scale.y, opts.scale.z);
  }

  /** Marks the transform changed (call it after changing position, rotation or scale). */
  setDirty() {
    this.version++;
  }

  /** Copies `other`'s position, rotation and scale, and marks this transform changed. */
  copy(other: Transform) {
    this.position.copy(other.position);
    this.quaternion.copy(other.quaternion);
    this.scale.copy(other.scale);
    this.setDirty();
  }
}
