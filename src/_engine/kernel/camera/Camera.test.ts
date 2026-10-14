import { beforeAll, describe, expect, test } from 'vitest';
import * as THREE from 'three/webgpu';
import { ECSWorld } from '../ecs/ECS';
import { ComponentType } from '../ecs/ECSCoreComponents';
import { getMainAppCameraId, getMainCamera, registerCameraManager, setMainCamera } from './Camera';

// The default world (getMainCamera reads it) and the camera hooks, once for this file
let world: ECSWorld;
beforeAll(async () => {
  world = new ECSWorld();
  await registerCameraManager();
});

const createCameraEntity = (target: ECSWorld, appId: string) => {
  const camera = new THREE.PerspectiveCamera();
  const entityId = target.createEntity({ appId });
  target.addComponent(entityId, ComponentType.OBJECT3D, { value: camera, _lastVersion: -1 });
  return { entityId, camera };
};

// p200's cache: the main camera is kept by setMainCamera and the tag's hooks, not queried
describe('the main camera', () => {
  test('follows setMainCamera, and is gone with its entity', () => {
    const first = createCameraEntity(world, 'first');
    const second = createCameraEntity(world, 'second');

    setMainCamera(world, first.entityId);
    expect(getMainCamera()).toBe(first.camera);
    expect(getMainAppCameraId()).toBe('first');

    setMainCamera(world, second.entityId);
    expect(getMainCamera()).toBe(second.camera);
    expect(getMainAppCameraId()).toBe('second');
    expect(world.hasComponent(first.entityId, ComponentType.TAG_IS_MAIN_CAMERA)).toBe(false);

    world.deleteEntity(second.entityId);
    expect(getMainCamera()).toBeUndefined();
    expect(getMainAppCameraId()).toBeNull();
    world.deleteEntity(first.entityId);
  });

  test('another world’s cameras and deletions leave it alone', () => {
    const main = createCameraEntity(world, 'main');
    setMainCamera(world, main.entityId);

    // The same entity id in another world is another entity: reach main's id there (its slot and
    // generation) by reusing the slot
    const other = new ECSWorld({ id: 'camera-test-other', maxEntities: 100 });
    let elsewhere = other.createRawEntity();
    for (let i = 0; i < 4096 && elsewhere !== main.entityId; i++) {
      other.deleteEntity(elsewhere);
      elsewhere = other.createRawEntity();
    }
    expect(elsewhere).toBe(main.entityId);
    other.addComponent(elsewhere, ComponentType.TAG_IS_MAIN_CAMERA, true);
    other.deleteEntity(elsewhere);
    ECSWorld.deleteWorld(other.id);

    expect(getMainCamera()).toBe(main.camera);
    world.deleteEntity(main.entityId);
  });
});
