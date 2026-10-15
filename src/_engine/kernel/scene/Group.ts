import * as THREE from 'three/webgpu';
import type { ECSWorld } from '../ecs/ECS';
import { getECSWorld, getEntityIdByAppId } from '../ecs/ECS';
import { getRootScene } from './Scene';
import { ComponentType } from '../ecs/ECSCoreComponents';
import { setTransformFromProps } from '../ecs/ECSHelpers';
import { lerror, lwarn } from '../../utils/Logger';
import type { CoreEntityOpts } from '../../schemas/_HelperSchemas';
import { existsOrThrow } from '../../utils/Assert';
import type { FeatureContext } from '../init/Features';

/**
 * Installs the groups (the kernel, p607): a group entity's deletion disposes its group.
 * @internal
 */
export const installGroups = (ctx: FeatureContext) => {
  ctx.registerComponentHooks(ComponentType.TAG_IS_GROUP, {
    onDeleteEntity: (entityId, world) => disposeGroup(entityId, world),
  });
};

/** What {@link createGroupEntity} makes a group with. */
export type GroupProps = {
  /** The entity's app id (over `entityOpts.appId`); default: the group's uuid, not fixed. */
  appId?: string;
  /** Objects added to the group at once (see {@link addToGroupEntity}). */
  objects?: THREE.Object3D | THREE.Object3D[];
  /** The group's position; an axis left out is 0. */
  position?: { x?: number; y?: number; z?: number };
  /** Euler angles in radians (XYZ order); an axis left out is 0. */
  rotation?: { x?: number; y?: number; z?: number };
  /** The group's rotation, over `rotation`. */
  quaternion?: THREE.Quaternion;
};

/** The entity in `world` whose object is `child` (by its `userData.entityId`), if any */
const getChildEntityId = (child: THREE.Object3D, world: ECSWorld) => {
  const entityId = child.userData.entityId as number | undefined;
  if (entityId === undefined) return undefined;
  return world.getComponent(entityId, ComponentType.OBJECT3D)?.value === child
    ? entityId
    : undefined;
};

/** A group entity's group, or `undefined` (warned) */
const getGroupOfEntity = (entityId: number, world: ECSWorld, fnName: string) => {
  const group = world.getComponent(entityId, ComponentType.OBJECT3D)?.value;
  if (!group || !(group as THREE.Group).isGroup) {
    lwarn(`Entity "${entityId}" has no group (${fnName}).`);
    return undefined;
  }
  return group as THREE.Group;
};

/**
 * Creates a group entity: a `THREE.Group` (in the root scene unless `entityOpts.doNotAddToScene`)
 * with an `OBJECT3D` and a transform. Deleting the entity deletes its children's entities and
 * detaches the rest.
 * @param ecsWorld default: the default world
 * @returns the group's entity id
 * @example
 * ```ts
 * import { addToGroupEntity, createGroupEntity } from 'aekasha';
 *
 * const groupId = createGroupEntity({ appId: 'crates', position: { y: 1 } });
 * addToGroupEntity(groupId, [crateMesh1, crateMesh2]);
 * ```
 */
export const createGroupEntity = (
  props: GroupProps,
  entityOpts?: CoreEntityOpts,
  ecsWorld?: ECSWorld
): number => {
  const world =
    ecsWorld || existsOrThrow(getECSWorld(), 'Could not get ECS world in createGroupEntity.');

  const group = new THREE.Group();
  const appId = props.appId || entityOpts?.appId || group.uuid;

  group.userData.id = appId;
  if (entityOpts?.debugData?.name) {
    group.name = entityOpts.debugData.name;
    group.userData.name = group.name;
  }
  if (entityOpts?.debugData?.description) {
    group.userData.description = entityOpts.debugData.description;
  }

  if (props.objects) addToGroupEntity(group, props.objects);

  if (!entityOpts?.doNotAddToScene) {
    const rootScene = existsOrThrow(
      getRootScene(),
      'Could not find root scene in createGroupEntity.'
    );
    rootScene.add(group);
  }

  // Same as createMeshEntity: a props-only appId is the entity's real (fixed) appId too.
  const explicitAppId = props.appId || entityOpts?.appId;
  const entityId = world.createEntity(
    explicitAppId ? { ...entityOpts, appId: explicitAppId } : entityOpts
  );
  group.userData.entityId = entityId;

  world.addComponent(entityId, ComponentType.OBJECT3D, {
    value: group,
    _lastVersion: -1,
  });
  world.addComponent(entityId, ComponentType.TAG_IS_GROUP, true);
  setTransformFromProps(entityId, group, props, world);

  return entityId;
};

/**
 * Adds objects to a group: an object entity's object (eg. `createMeshEntity`'s, made with
 * `doNotAddToScene`) or a plain one. Its transform is then relative to the group.
 * @param entityIdOrGroup a group entity's id (in `ecsWorld`), or a group object
 * @param ecsWorld the group entity's world; default: the default world
 * @returns the group, or `undefined` (warned) for an entity without one
 * @example
 * ```ts
 * import * as THREE from 'three/webgpu';
 * import { addToGroupEntity, createGroupEntity } from 'aekasha';
 *
 * const groupId = createGroupEntity({ appId: 'crates' });
 * // A mesh entity made with `doNotAddToScene`, and a plain object
 * addToGroupEntity(groupId, [crateMesh, new THREE.Object3D()]);
 * ```
 */
export const addToGroupEntity = (
  entityIdOrGroup: number | THREE.Group,
  objects: THREE.Object3D | THREE.Object3D[],
  ecsWorld?: ECSWorld
): THREE.Group | undefined => {
  const group =
    typeof entityIdOrGroup === 'number'
      ? getGroupOfEntity(entityIdOrGroup, ecsWorld || getECSWorld(), 'addToGroupEntity')
      : entityIdOrGroup;
  if (!group) return;

  if (Array.isArray(objects)) {
    for (let i = 0; i < objects.length; i++) group.add(objects[i]);
  } else {
    group.add(objects);
  }

  return group;
};

/**
 * Removes children from a group, by their `userData.id` (an object entity's app id) or their
 * index in `group.children` (the indexes before this call's removals).
 * @param entityIdOrGroup a group entity's id (in `ecsWorld`), or a group object
 * @param objectIdOrIndex one child or several (a missing one is warned and skipped)
 * @param ecsWorld the group's world: its entity's, and its children's; default: the default world
 * @returns the group, or `undefined` for an entity without one
 * @example
 * ```ts
 * import { removeFromGroupEntity } from 'aekasha';
 *
 * // Takes the crate out of the group and deletes its entity
 * removeFromGroupEntity(groupId, 'crate1', { deleteMeshes: true });
 * ```
 */
export const removeFromGroupEntity = (
  entityIdOrGroup: number | THREE.Group,
  objectIdOrIndex: string | string[] | number | number[],
  opts?: {
    /** Delete a removed mesh's entity too (in the group's world): its geometry and materials are
     * released like any mesh entity's. A mesh without an entity is only detached: what it holds
     * stays its owner's. */
    deleteMeshes?: boolean;
    /**
     * Never read.
     * @deprecated `deleteMeshes` releases an entity's geometry. Removed in engine 6.0.0.
     */
    deleteGeometries?: boolean;
    /**
     * Never read.
     * @deprecated `deleteMeshes` releases an entity's materials. Removed in engine 6.0.0.
     */
    deleteMaterials?: boolean;
    /**
     * Never read.
     * @deprecated `deleteMeshes` releases an entity's materials, which release their textures.
     * Removed in engine 6.0.0.
     */
    deleteTextures?: boolean;
  },
  ecsWorld?: ECSWorld
): THREE.Group | undefined => {
  const world = ecsWorld || getECSWorld();
  const group =
    typeof entityIdOrGroup === 'number'
      ? getGroupOfEntity(entityIdOrGroup, world, 'removeFromGroupEntity')
      : entityIdOrGroup;
  if (!group) return;

  const objectsToRemove: THREE.Object3D[] = [];
  const targets = Array.isArray(objectIdOrIndex) ? objectIdOrIndex : [objectIdOrIndex];

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    const child =
      typeof target === 'string'
        ? group.children.find((obj) => obj.userData.id === target)
        : group.children[target];

    if (child) {
      objectsToRemove.push(child);
    } else {
      lwarn(`Object "${target}" was not found in group "${group.userData.id}".`);
    }
  }

  for (let i = 0; i < objectsToRemove.length; i++) {
    const child = objectsToRemove[i];
    group.remove(child);
    if (!opts?.deleteMeshes || !(child as THREE.Mesh).isMesh) continue;
    const childEntityId = getChildEntityId(child, world);
    if (childEntityId !== undefined) world.deleteEntity(childEntityId);
  }

  return group;
};

/**
 * A group entity's deletion (its `TAG_IS_GROUP` hook): the children's entities in the same world
 * are deleted, the other children detached, and the group leaves its parent.
 * @internal
 */
export const disposeGroup = (entityId: number, ecsWorld?: ECSWorld) => {
  const world = ecsWorld || getECSWorld();

  const group = world.getComponent(entityId, ComponentType.OBJECT3D)?.value;
  if (!group) return;

  // In reverse: a child's deletion removes it from `children`
  for (let i = group.children.length - 1; i >= 0; i--) {
    const child = group.children[i];
    const childEntityId = getChildEntityId(child, world);
    if (childEntityId !== undefined) world.deleteEntity(childEntityId);
    // Not every object entity's deletion detaches its object (a mesh's does)
    child.removeFromParent();
  }

  group.removeFromParent();
};

/**
 * A group entity's group by its app id.
 * @param ecsWorld default: the default world
 * @returns the group, or `undefined` when no entity has the app id
 * @throws when the entity's object isn't a group
 * @example
 * ```ts
 * import { getGroupByAppId } from 'aekasha';
 *
 * const crates = getGroupByAppId('crates');
 * ```
 */
export const getGroupByAppId = (appId: string, ecsWorld?: ECSWorld) => {
  const world = ecsWorld || getECSWorld();
  const entityId = getEntityIdByAppId(appId, world);
  if (entityId === undefined) return undefined;
  const obj = world.getComponent(entityId, ComponentType.OBJECT3D)?.value;
  if (obj && !(obj as THREE.Group).isGroup) {
    const msg = `Found Object3D is not a group (type: ${obj.type}).`;
    lerror(msg);
    throw new Error(msg);
  }
  return obj as THREE.Group | undefined;
};

/**
 * Deletes a world's group entities but the persistent ones (the scene loader, on a scene's exit).
 * @internal
 * @param ecsWorld default: the default world
 */
export const deleteAllGroupEntities = (ecsWorld?: ECSWorld) => {
  const world = ecsWorld || getECSWorld();
  if (!world) return;
  const storage = world.getStorage(ComponentType.TAG_IS_GROUP);
  const entityIds = Array.from(storage.keys());
  for (let i = 0; i < entityIds.length; i++) {
    if (!world.hasComponent(entityIds[i], ComponentType.PERSISTENT)) {
      world.deleteEntity(entityIds[i]);
    }
  }
};
