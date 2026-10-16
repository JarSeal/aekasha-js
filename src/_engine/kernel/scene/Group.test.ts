import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { ECSWorld } from '../ecs/ECS';
import { ComponentType } from '../ecs/ECSCoreComponents';
import { createFeatureHost } from '../init/Features';
import {
  addToGroupEntity,
  createGroupEntity,
  deleteAllGroupEntities,
  getGroupByAppId,
  installGroups,
  removeFromGroupEntity,
} from './Group';

// The default world and the groups' deletion hook, once for this file
let world: ECSWorld;
let other: ECSWorld;
beforeAll(() => {
  world = new ECSWorld();
  other = new ECSWorld({ id: 'group-test-other' });
  installGroups(createFeatureHost({}).ctx);
});
afterAll(() => ECSWorld.deleteWorld(other.id));

/** A mesh with an entity in `target`, as createMeshEntity makes one (without its hooks) */
const createMeshChild = (target: ECSWorld, appId: string) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry());
  const entityId = target.createEntity({ appId });
  target.addComponent(entityId, ComponentType.OBJECT3D, { value: mesh, _lastVersion: -1 });
  mesh.userData.id = appId;
  mesh.userData.entityId = entityId;
  return { mesh, entityId };
};

const createGroup = (appId: string, target = world) =>
  createGroupEntity({ appId }, { doNotAddToScene: true }, target);

const getGroup = (entityId: number, target = world) =>
  target.getComponent(entityId, ComponentType.OBJECT3D)?.value as THREE.Group;

describe('createGroupEntity', () => {
  it('sets the transform from its props, the quaternion over the rotation', () => {
    const turned = createGroupEntity(
      { appId: 'gTurned', position: { y: 2 }, rotation: { y: Math.PI / 2 } },
      { doNotAddToScene: true }
    );
    const pos = world.getPosition(turned)!;
    expect([pos.x, pos.y, pos.z]).toEqual([0, 2, 0]);
    const rot = world.getRotation(turned)!;
    expect(rot.y).toBeCloseTo(Math.SQRT1_2);
    expect(rot.w).toBeCloseTo(Math.SQRT1_2);

    const quat = new THREE.Quaternion(1, 0, 0, 0);
    const both = createGroupEntity(
      { appId: 'gBoth', rotation: { y: 1 }, quaternion: quat },
      { doNotAddToScene: true }
    );
    const bothRot = world.getRotation(both)!;
    expect([bothRot.x, bothRot.y, bothRot.z, bothRot.w]).toEqual([1, 0, 0, 0]);
  });

  it('adds its objects, and is found by its app id', () => {
    const child = new THREE.Object3D();
    const id = createGroupEntity({ appId: 'gFound', objects: child }, { doNotAddToScene: true });
    const group = getGroupByAppId('gFound');
    expect(group).toBe(getGroup(id));
    expect(group?.children).toEqual([child]);
    expect(getGroupByAppId('gMissing')).toBeUndefined();
  });
});

describe('removeFromGroupEntity', () => {
  it("deletes a mesh's entity with deleteMeshes, and only detaches a mesh without one", () => {
    const groupId = createGroup('gRemove');
    const managed = createMeshChild(world, 'gRemoveManaged');
    const unmanaged = new THREE.Mesh(new THREE.BoxGeometry());
    unmanaged.userData.id = 'gRemoveUnmanaged';
    const dispose = vi.spyOn(unmanaged.geometry, 'dispose');
    addToGroupEntity(groupId, [managed.mesh, unmanaged]);

    removeFromGroupEntity(groupId, ['gRemoveManaged', 'gRemoveUnmanaged'], {
      deleteMeshes: true,
    });
    expect(getGroup(groupId).children).toEqual([]);
    expect(world.isAlive(managed.entityId)).toBe(false);
    expect(dispose).not.toHaveBeenCalled();
  });

  it("keeps a removed mesh's entity without deleteMeshes, and removes by index", () => {
    const groupId = createGroup('gKeep');
    const first = createMeshChild(world, 'gKeepFirst');
    const second = createMeshChild(world, 'gKeepSecond');
    addToGroupEntity(groupId, [first.mesh, second.mesh]);

    removeFromGroupEntity(groupId, 1);
    expect(getGroup(groupId).children).toEqual([first.mesh]);
    expect(world.isAlive(second.entityId)).toBe(true);
  });
});

describe("a group entity's deletion", () => {
  it("deletes its children's entities in its own world only", () => {
    const groupId = createGroup('gOther', other);
    const child = createMeshChild(other, 'gOtherChild');
    const plain = new THREE.Object3D();
    addToGroupEntity(groupId, [child.mesh, plain], other);
    // The same app id in the default world: the old lookup (by app id, default world) took it
    const namesake = createMeshChild(world, 'gOtherChild');

    other.deleteEntity(groupId);
    expect(other.isAlive(child.entityId)).toBe(false);
    expect(world.isAlive(namesake.entityId)).toBe(true);
    expect(plain.parent).toBeNull();
    expect(child.mesh.parent).toBeNull();
  });

  it('skips persistent groups when a scene exits', () => {
    const kept = createGroup('gPersistent');
    world.addComponent(kept, ComponentType.PERSISTENT, true);
    const dropped = createGroup('gDropped');

    deleteAllGroupEntities(world);
    expect(world.isAlive(kept)).toBe(true);
    expect(world.isAlive(dropped)).toBe(false);
  });
});
