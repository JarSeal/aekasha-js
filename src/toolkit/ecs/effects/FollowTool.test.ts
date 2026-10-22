import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { ComponentType, ECSWorld, type ECSStorageMode } from 'aekasha';
import { FollowToolComponentType, registerFollowToolEffect } from './FollowTool';

const DT = 1 / 60;
const worldIds: string[] = [];
afterEach(() => {
  for (const id of worldIds.splice(0)) ECSWorld.deleteWorld(id);
});

// A world with the effect's system, captured from its registration
const createWorld = (storageMode: ECSStorageMode) => {
  const id = `follow-${storageMode}-${worldIds.length}`;
  worldIds.push(id);
  const world = new ECSWorld({ id, storageMode, maxEntities: 16 });
  const addSystem = vi.spyOn(world, 'addSystem');
  registerFollowToolEffect(world);
  const systemFn = addSystem.mock.calls[0][2];
  return { world, run: () => systemFn(world, DT) };
};

const setPosition = (world: ECSWorld, entityId: number, x: number, y: number, z: number) => {
  const transform = world.getComponent(entityId, ComponentType.TRANSFORM)!;
  transform.position.set(x, y, z);
  world.commitTransform(entityId, transform);
};
const getPosition = (world: ECSWorld, entityId: number) =>
  world.getComponent(entityId, ComponentType.TRANSFORM)!.position.toArray();

// A leader, a follower and the follower's linked target (as a light and its target)
const createFollow = (world: ECSWorld, speed: number) => {
  const leader = world.createEntity();
  const follower = world.createEntity();
  const target = world.createEntity();
  setPosition(world, leader, 10, 0, -4);
  world.addComponent(follower, ComponentType.TARGET_LINK, { targetId: target });
  world.addComponent(follower, FollowToolComponentType.FOLLOW, {
    leaderId: leader,
    offset: new THREE.Vector3(0, 5, 2),
    targetOffset: new THREE.Vector3(1, 0, 0),
    speed,
  });
  return { leader, follower, target };
};

describe.each<ECSStorageMode>(['MAP', 'TYPED_ARRAY'])('followToolSystem (%s storage)', (mode) => {
  it('snaps the entity and its linked target to the leader plus their offsets at speed 0', () => {
    const { world, run } = createWorld(mode);
    const { follower, target } = createFollow(world, 0);
    run();
    expect(getPosition(world, follower)).toEqual([10, 5, -2]);
    expect(getPosition(world, target)).toEqual([11, 0, -4]);
  });

  it('closes 1 - e^(-speed·dt) of the gap per frame', () => {
    const { world, run } = createWorld(mode);
    const { follower, target } = createFollow(world, 3);
    run();
    const alpha = 1 - Math.exp(-3 * DT);
    const [x, y, z] = getPosition(world, follower);
    expect(x).toBeCloseTo(10 * alpha, 6);
    expect(y).toBeCloseTo(5 * alpha, 6);
    expect(z).toBeCloseTo(-2 * alpha, 6);
    expect(getPosition(world, target)[0]).toBeCloseTo(11 * alpha, 6);
  });

  it('leaves both where they are when the leader is gone', () => {
    const { world, run } = createWorld(mode);
    const { leader, follower, target } = createFollow(world, 0);
    world.deleteEntity(leader);
    run();
    expect(getPosition(world, follower)).toEqual([0, 0, 0]);
    expect(getPosition(world, target)).toEqual([0, 0, 0]);
  });
});
