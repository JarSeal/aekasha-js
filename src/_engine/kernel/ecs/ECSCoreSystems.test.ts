import { afterEach, beforeAll, describe, expect, test } from 'vitest';
import * as THREE from 'three/webgpu';
import { getConfig } from '../config/Config';
import { createFeatureHost } from '../init/Features';
import { ECSWorld } from './ECS';
import { ComponentType } from './ECSCoreComponents';
import { installCoreSystems } from './ECSCoreSystems';

// The core hooks are static, registered once for this file's worlds
beforeAll(() => installCoreSystems(createFeatureHost(getConfig()).ctx));

let worldSeq = 0;
const createdWorldIds: string[] = [];
const createWorld = () => {
  const id = `core-systems-test-${worldSeq++}`;
  createdWorldIds.push(id);
  return new ECSWorld({ id, maxEntities: 100 });
};

afterEach(() => {
  for (const id of createdWorldIds.splice(0)) ECSWorld.deleteWorld(id);
});

/** Two entities with an Object3D each, each one's TARGET_LINK pointing at the other */
const createLinkedPair = (world: ECSWorld) => {
  const a = world.createEntity();
  const b = world.createEntity();
  world.addComponent(a, ComponentType.OBJECT3D, { value: new THREE.Object3D(), _lastVersion: -1 });
  world.addComponent(b, ComponentType.OBJECT3D, { value: new THREE.Object3D(), _lastVersion: -1 });
  world.addComponent(a, ComponentType.TARGET_LINK, { targetId: b });
  world.addComponent(b, ComponentType.TARGET_LINK, { targetId: a });
  return { a, b };
};

describe('target links', () => {
  test('disabling one of two entities that target each other disables both, and back', () => {
    const world = createWorld();
    const { a, b } = createLinkedPair(world);

    world.setDisabled(a, true);
    expect(world.isDisabled(a)).toBe(true);
    expect(world.isDisabled(b)).toBe(true);
    expect(world.getComponent(b, ComponentType.OBJECT3D)?.value.visible).toBe(false);

    world.setDisabled(a, false);
    expect(world.isDisabled(a)).toBe(false);
    expect(world.isDisabled(b)).toBe(false);
    expect(world.getComponent(b, ComponentType.OBJECT3D)?.value.visible).toBe(true);
  });

  test('persistence follows a link cycle both ways', () => {
    const world = createWorld();
    const { a, b } = createLinkedPair(world);

    world.addComponent(a, ComponentType.PERSISTENT, true);
    expect(world.hasComponent(b, ComponentType.PERSISTENT)).toBe(true);

    world.removeComponent(a, ComponentType.PERSISTENT);
    expect(world.hasComponent(a, ComponentType.PERSISTENT)).toBe(false);
    expect(world.hasComponent(b, ComponentType.PERSISTENT)).toBe(false);
  });

  test('a link added to a persistent entity makes its target persistent', () => {
    const world = createWorld();
    const looker = world.createEntity();
    const target = world.createEntity();
    world.addComponent(looker, ComponentType.PERSISTENT, true);
    world.addComponent(looker, ComponentType.TARGET_LINK, { targetId: target });
    expect(world.hasComponent(target, ComponentType.PERSISTENT)).toBe(true);
  });
});
