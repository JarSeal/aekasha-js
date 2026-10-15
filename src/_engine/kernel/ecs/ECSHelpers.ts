import * as THREE from 'three/webgpu';

import type { ECSWorld } from './ECS';
import { getECSWorld } from './ECS';
import type { ComponentData, ECSTransformProp, Transform } from './ECSCoreComponents';
import { ComponentType } from './ECSCoreComponents';
import { llog } from '../../utils/Logger';
import { IS_DEBUG_ENV } from '../config/Config';
import type { EntityDebugData } from './ECSRegistry';
import type { CoreEntityOpts } from '../../schemas/_HelperSchemas';

// Reuse scratch objects to prevent GC pressure
const _v1 = new THREE.Vector3();
const _m1 = new THREE.Matrix4();
const _e1 = new THREE.Euler();
const _q1 = new THREE.Quaternion();

/**
 * {@link ECSWorld.createRawEntity}: an entity without components.
 * `ecsWorld` defaults to the default world.
 * @internal
 */
export const createRawEntity = (ecsWorld?: ECSWorld) => {
  const world = ecsWorld || getECSWorld();
  return world.createRawEntity();
};

/**
 * {@link ECSWorld.createEntity}: an entity with the core components (`APP_ID`, `TRANSFORM`, …).
 * `ecsWorld` defaults to the default world.
 * @returns the new entity's id
 */
export const createEntity = (opts?: CoreEntityOpts, ecsWorld?: ECSWorld) => {
  const world = ecsWorld || getECSWorld();
  return world.createEntity(opts);
};

/**
 * {@link ECSWorld.deleteEntity}: runs the entity's `onDeleteEntity` hooks and frees its slot.
 * `ecsWorld` defaults to the default world.
 */
export const deleteEntity = (entityId: number, ecsWorld?: ECSWorld) => {
  const world = ecsWorld || getECSWorld();
  world.deleteEntity(entityId);
};

/**
 * {@link ECSWorld.addComponent}: stores the component and runs its `onAddComponent` hooks.
 * `ecsWorld` defaults to the default world.
 */
export const addComponent = <K extends ComponentType>(
  entityId: number,
  type: K,
  data: ComponentData[K],
  ecsWorld?: ECSWorld
) => {
  const world = ecsWorld || getECSWorld();
  world.addComponent(entityId, type, data);
};

/**
 * {@link ECSWorld.removeComponent}: runs the `onRemoveComponent` hooks, then removes it.
 * `ecsWorld` defaults to the default world.
 */
export const removeComponent = (entityId: number, type: ComponentType, ecsWorld?: ECSWorld) => {
  const world = ecsWorld || getECSWorld();
  world.removeComponent(entityId, type);
};

/**
 * {@link ECSWorld.getComponent}: the entity's component data, or undefined.
 * `ecsWorld` defaults to the default world.
 */
export const getComponent = <K extends ComponentType>(
  entityId: number,
  type: K,
  ecsWorld?: ECSWorld
) => {
  const world = ecsWorld || getECSWorld();
  return world.getComponent(entityId, type);
};

/**
 * {@link ECSWorld.hasComponent}: whether the entity has the component.
 * `ecsWorld` defaults to the default world.
 */
export const hasComponent = (entityId: number, type: ComponentType, ecsWorld?: ECSWorld) => {
  const world = ecsWorld || getECSWorld();
  return world.hasComponent(entityId, type);
};

/**
 * {@link ECSWorld.getStorage}: the type's storage, to iterate every entity that has it.
 * `ecsWorld` defaults to the default world.
 */
export const getStorage = <K extends ComponentType>(type: K, ecsWorld?: ECSWorld) => {
  const world = ecsWorld || getECSWorld();
  return world.getStorage(type);
};

/**
 * {@link ECSWorld.getTransform}: the entity's position, rotation and scale, to read (throws
 * without a `TRANSFORM`).
 * `ecsWorld` defaults to the default world.
 */
export const getTransform = (entityId: number, ecsWorld?: ECSWorld) => {
  const world = ecsWorld || getECSWorld();
  return world.getTransform(entityId);
};

/**
 * {@link ECSWorld.setTransform}: moves and / or rotates the entity, its rigid body included.
 * `ecsWorld` defaults to the default world.
 * @example
 * ```ts
 * import { createEntity, setTransform } from 'aekasha';
 *
 * const crateId = createEntity({ appId: 'crate' });
 * setTransform(crateId, { pos: { x: 0, y: 2, z: 0 } });
 * ```
 */
export const setTransform = (entityId: number, tra: ECSTransformProp, ecsWorld?: ECSWorld) => {
  const world = ecsWorld || getECSWorld();
  world.setTransform(entityId, tra);
};

/**
 * The position and rotation props an object entity is created with (`createMeshEntity`,
 * `createGroupEntity`).
 * @internal
 */
export type ObjectTransformProps = {
  /** Each axis given replaces the object's own. */
  position?: { x?: number; y?: number; z?: number };
  /** Euler angles in radians (XYZ order); each axis given replaces the object's own. */
  rotation?: { x?: number; y?: number; z?: number };
  /** Over `rotation`. */
  quaternion?: { x: number; y: number; z: number; w: number };
};

/**
 * Sets a new object entity's transform from its creation props: the object's own position and
 * rotation, with what the props give replacing it.
 * @internal
 */
export const setTransformFromProps = (
  entityId: number,
  obj: THREE.Object3D,
  props: ObjectTransformProps,
  world: ECSWorld
) => {
  const { position, rotation, quaternion } = props;
  const pos = {
    x: position?.x ?? obj.position.x,
    y: position?.y ?? obj.position.y,
    z: position?.z ?? obj.position.z,
  };
  let rot: { x: number; y: number; z: number; w: number } = obj.quaternion;
  if (quaternion) {
    rot = quaternion;
  } else if (rotation) {
    _e1.set(
      rotation.x ?? obj.rotation.x,
      rotation.y ?? obj.rotation.y,
      rotation.z ?? obj.rotation.z
    );
    rot = _q1.setFromEuler(_e1);
  }
  world.setTransform(entityId, { pos, rot: { x: rot.x, y: rot.y, z: rot.z, w: rot.w } });
};

/**
 * {@link ECSWorld.teleport}: `setTransform` that also zeroes a dynamic body's velocities and forces.
 * `ecsWorld` defaults to the default world.
 */
export const teleport = (entityId: number, tra: ECSTransformProp, ecsWorld?: ECSWorld) => {
  const world = ecsWorld || getECSWorld();
  world.teleport(entityId, tra);
};

/**
 * {@link ECSWorld.getPosition}: the entity's position, to read.
 * `ecsWorld` defaults to the default world.
 */
export const getPosition = (entityId: number, ecsWorld?: ECSWorld) => {
  const world = ecsWorld || getECSWorld();
  return world.getPosition(entityId);
};

/**
 * {@link ECSWorld.getRotation}: the entity's rotation, to read.
 * `ecsWorld` defaults to the default world.
 */
export const getRotation = (entityId: number, ecsWorld?: ECSWorld) => {
  const world = ecsWorld || getECSWorld();
  return world.getRotation(entityId);
};

/**
 * {@link ECSWorld.getScale}: the entity's scale, to read.
 * `ecsWorld` defaults to the default world.
 */
export const getScale = (entityId: number, ecsWorld?: ECSWorld) => {
  const world = ecsWorld || getECSWorld();
  return world.getScale(entityId);
};

/**
 * Performs a one-time rotation update to make any entity face a specific point.
 * This updates the ECS Transform component, which then syncs to the visual object.
 */
export const lookAtPoint = (
  entityId: number,
  point: { x: number; y: number; z: number },
  ecsWorld?: ECSWorld
) => {
  const world = ecsWorld || getECSWorld();
  const transform = world.getComponent(entityId, ComponentType.TRANSFORM);
  if (!transform) return;

  _v1.set(point.x, point.y, point.z);
  _m1.lookAt(transform.position, _v1, THREE.Object3D.DEFAULT_UP);

  transform.quaternion.setFromRotationMatrix(_m1);
  transform.setDirty();
  world.commitTransform(entityId, transform);
};

/** An entity's state for inspecting it ({@link getEntityDiagnosticData}). */
export interface EntityDiagnosticData {
  /** The entity's id. */
  id: number;
  /** Its `APP_ID`. */
  appId?: string;
  /** Whether it has `DISABLED`. */
  isDisabled: boolean;
  /** Whether it has `PERSISTENT`. */
  isPersistent: boolean;
  /** Its `TRANSFORM` (the stored one: in `TYPED_ARRAY` mode a copy). */
  transform?: Transform;
  /** Its Object3D's type and pose, copied, and the Object3D itself. */
  obj3D?: {
    type: string;
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number };
    quaternion: { x: number; y: number; z: number; w: number };
    scale: { x: number; y: number; z: number };
    obj: THREE.Object3D;
  };
  /** Every component type it has, tags included. */
  activeTags: string[];
  /** Its rigid body's kind and linear velocity. */
  physics?: {
    isDynamic: boolean;
    linvel: { x: number; y: number; z: number };
  };
  /** Its `TARGET_LINK` target. */
  targetId?: number;
  /** Its `DEBUG_DATA` (the debug env only). */
  debugData?: EntityDebugData;
}

/**
 * Gathers an entity's ECS and engine state into one object, for logging or a debug view. Returns
 * null if the entity is dead/recycled. `ecsWorld` defaults to the default world.
 */
export const getEntityDiagnosticData = (
  id: number,
  ecsWorld?: ECSWorld
): EntityDiagnosticData | null => {
  const world = ecsWorld || getECSWorld();
  if (!world.isAlive(id)) return null;

  const data: EntityDiagnosticData = {
    id,
    appId: world.getComponent(id, ComponentType.APP_ID)?.id,
    isDisabled: world.isDisabled(id),
    isPersistent: world.hasComponent(id, ComponentType.PERSISTENT),
    activeTags: [],
  };

  // Transform (ECS Source of Truth)
  const transform = world.getComponent(id, ComponentType.TRANSFORM);
  if (transform) data.transform = transform;

  // Visuals (Three.js Sync State)
  const obj3D = world.getComponent(id, ComponentType.OBJECT3D);
  if (obj3D) {
    data.obj3D = {
      type: obj3D.value.type,
      position: { ...obj3D.value.position },
      rotation: { ...obj3D.value.rotation },
      quaternion: { ...obj3D.value.quaternion },
      scale: { ...obj3D.value.scale },
      obj: obj3D.value,
    };
  }

  // Component Inventory (Iteration through registry)
  const types = world.getComponentTypes();
  for (let i = 0; i < types.length; i++) {
    if (world.hasComponent(id, types[i])) data.activeTags.push(types[i]);
  }

  // Physics
  const rb = world.getRigidBody(id);
  if (rb) {
    data.physics = {
      isDynamic: world.isEntityDynamic(id),
      linvel: rb.linvel(),
    };
  }

  // Links
  const link = world.getComponent(id, ComponentType.TARGET_LINK);
  if (link) data.targetId = link.targetId;

  // Debug data
  if (IS_DEBUG_ENV) {
    const debugData = world.getComponent(id, ComponentType.DEBUG_DATA);
    if (debugData) data.debugData = debugData;
  }

  return data;
};

/**
 * Logs an entity ({@link getEntityDiagnosticData}): `compact` logs the title and the data object,
 * `dataOnly` the data object alone, `includeAllData` adds it to the full log. `ecsWorld` defaults to
 * the default world.
 */
export const inspectEntity = (
  id: number,
  opts?: { compact?: boolean; dataOnly?: boolean; includeAllData?: boolean; ecsWorld?: ECSWorld }
) => {
  const data = getEntityDiagnosticData(id, opts?.ecsWorld);

  if (opts?.dataOnly) {
    llog(data);
    return;
  }

  if (!data) {
    llog(`%c--- INSPECTING ENTITY [ID: ${id}] ---`, 'color: #ff4444; font-weight: bold;');
    llog('Status: DEAD / RECYCLED');
    return;
  }

  const title = `--- INSPECTING ENTITY [ID: ${data.id} | Name: ${data.appId || 'Unnamed'}] ---`;
  llog(`%c${title}`, 'color: #00d4ff; font-weight: bold;');
  if (!opts?.compact) {
    llog(`Disabled: ${data.isDisabled} | Persistent: ${Boolean(data.isPersistent)}`);
    llog(`Tags and components: ${data.activeTags.join(' | ')}`);
    if (data.transform) {
      llog('ECS Transform:', {
        position: data.transform.position,
        quaternion: data.transform.quaternion,
        version: data.transform.version,
      });
    }
    if (data.obj3D) {
      llog('Three.js Object:', {
        type: data.obj3D.type,
        position: data.obj3D.position,
        rotation: data.obj3D.rotation,
        quaternion: data.obj3D.quaternion,
        scale: data.obj3D.scale,
        obj: data.obj3D,
      });
    }
    if (data.physics) {
      llog('Physics Body:', {
        type: data.physics.isDynamic ? 'DYNAMIC' : 'STATIC',
        linvel: data.physics.linvel,
      });
    }
    if (data.targetId) llog(`Target link ID: ${data.targetId}`);
  }
  if (opts?.includeAllData || opts?.compact) llog('All data:', data);
  llog(`%c--- [END INSPECTING ENTITY] ---`, 'color: #136f82; font-weight: bold;');
};
