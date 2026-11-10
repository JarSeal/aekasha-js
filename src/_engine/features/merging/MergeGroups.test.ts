import { afterEach, beforeAll, describe, expect, test } from 'vitest';
import * as THREE from 'three/webgpu';
import { getConfig } from '../../kernel/config/Config';
import { ECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import { installCoreSystems } from '../../kernel/ecs/ECSCoreSystems';
import { createFeatureHost } from '../../kernel/init/Features';
import { installMergeGroups } from './MergeGroups';

// The hooks are static, registered once for this file's worlds: the kernel's, then the feature's
beforeAll(() => {
  const { ctx } = createFeatureHost(getConfig());
  installCoreSystems(ctx);
  installMergeGroups(ctx);
});

let worldSeq = 0;
const createdWorldIds: string[] = [];
const createWorld = () => {
  const id = `merge-groups-test-${worldSeq++}`;
  createdWorldIds.push(id);
  return new ECSWorld({ id, maxEntities: 100 });
};

afterEach(() => {
  for (const id of createdWorldIds.splice(0)) ECSWorld.deleteWorld(id);
});

describe('TAG_MERGED', () => {
  test('hides a merged entity whatever else changes, and shows it when it leaves', () => {
    const world = createWorld();
    const id = world.createEntity();
    const object = new THREE.Object3D();
    world.addComponent(id, ComponentType.OBJECT3D, { value: object, _lastVersion: -1 });

    world.addComponent(id, ComponentType.TAG_MERGED, true);
    expect(object.visible).toBe(false);

    // Another reason coming and going doesn't show it
    world.setDisabled(id, true);
    world.setDisabled(id, false);
    world.addComponent(id, ComponentType.TAG_FRUSTUM_CULLED, true);
    world.removeComponent(id, ComponentType.TAG_FRUSTUM_CULLED);
    expect(object.visible).toBe(false);

    world.removeComponent(id, ComponentType.TAG_MERGED);
    expect(object.visible).toBe(true);
  });

  test("leaving the group doesn't show an entity hidden for another reason", () => {
    const world = createWorld();
    const id = world.createEntity();
    const object = new THREE.Object3D();
    world.addComponent(id, ComponentType.OBJECT3D, { value: object, _lastVersion: -1 });

    world.addComponent(id, ComponentType.TAG_MERGED, true);
    world.setDisabled(id, true);
    world.removeComponent(id, ComponentType.TAG_MERGED);
    expect(object.visible).toBe(false);

    world.setDisabled(id, false);
    expect(object.visible).toBe(true);
  });
});
