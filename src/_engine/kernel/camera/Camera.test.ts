import { beforeAll, describe, expect, test, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { ECSWorld } from '../ecs/ECS';
import { ComponentType } from '../ecs/ECSCoreComponents';
import { createFeatureHost } from '../init/Features';
import { createRootScene } from '../scene/Scene';
import {
  createCameraEntity as createRealCameraEntity,
  disposeCamera,
  getActiveCamera,
  getActiveCameraId,
  getMainAppCameraId,
  getMainCamera,
  installCameras,
  setMainCamera,
} from './Camera';

// The canvas's size (the window's, read by createCameraEntity)
vi.hoisted(() => vi.stubGlobal('window', { innerWidth: 1600, innerHeight: 900 }));

// The default world (getMainCamera reads it) and the camera hooks, once for this file
let world: ECSWorld;
beforeAll(() => {
  world = new ECSWorld();
  installCameras(createFeatureHost({}).ctx);
  createRootScene();
});

/** Creates an entity in `target` with `entityId`'s slot and generation (another entity there) */
const createEntityWithId = (target: ECSWorld, entityId: number) => {
  let id = target.createRawEntity();
  for (let i = 0; i < 4096 && id !== entityId; i++) {
    target.deleteEntity(id);
    id = target.createRawEntity();
  }
  expect(id).toBe(entityId);
  return id;
};

// First: the active camera is module state, and these need it unset at the start
describe('createCameraEntity', () => {
  test('applies the zoom to the projection right away', () => {
    for (const type of ['PERSPECTIVE', 'ORTHOGRAPHIC'] as const) {
      const entityId = createRealCameraEntity({ type, zoom: 2 }, { appId: `zoom-${type}` });
      const camera = world.getComponent(entityId, ComponentType.OBJECT3D)!.value as
        | THREE.PerspectiveCamera
        | THREE.OrthographicCamera;
      expect(camera.zoom).toBe(2);
      const updated = camera.clone();
      updated.updateProjectionMatrix();
      expect(camera.projectionMatrix.elements).toEqual(updated.projectionMatrix.elements);
      const unzoomed = camera.clone();
      unzoomed.zoom = 1;
      unzoomed.updateProjectionMatrix();
      expect(camera.projectionMatrix.elements).not.toEqual(unzoomed.projectionMatrix.elements);
      world.deleteEntity(entityId);
    }
  });

  test('another world’s camera never becomes the active one', () => {
    expect(getActiveCameraId()).toBeNull();
    const other = new ECSWorld({ id: 'camera-test-active', maxEntities: 100 });

    // Neither the first camera nor an active one: only the other world's tag moves
    const first = createRealCameraEntity({ type: 'PERSPECTIVE' }, { appId: 'otherFirst' }, other);
    expect(other.hasComponent(first, ComponentType.TAG_IS_MAIN_CAMERA)).toBe(false);
    const active = createRealCameraEntity(
      { type: 'PERSPECTIVE', active: true },
      { appId: 'otherActive' },
      other
    );
    expect(other.hasComponent(active, ComponentType.TAG_IS_MAIN_CAMERA)).toBe(true);
    expect(getActiveCameraId()).toBeNull();
    expect(getMainCamera()).toBeUndefined();

    // The default world's first camera does, and the other world's disposal of the same entity
    // id (its TAG_IS_CAMERA hook's call) leaves it
    const own = createRealCameraEntity({ type: 'PERSPECTIVE' }, { appId: 'own' });
    expect(getActiveCameraId()).toBe(own);
    const ownCamera = getActiveCamera();
    disposeCamera(own, other);
    ECSWorld.deleteWorld(other.id);
    expect(getActiveCameraId()).toBe(own);
    expect(getActiveCamera()).toBe(ownCamera);

    world.deleteEntity(own);
    expect(getActiveCameraId()).toBeNull();
  });
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

    // The same entity id in another world is another entity
    const other = new ECSWorld({ id: 'camera-test-other', maxEntities: 100 });
    const elsewhere = createEntityWithId(other, main.entityId);
    other.addComponent(elsewhere, ComponentType.TAG_IS_MAIN_CAMERA, true);
    other.deleteEntity(elsewhere);
    ECSWorld.deleteWorld(other.id);

    expect(getMainCamera()).toBe(main.camera);
    world.deleteEntity(main.entityId);
  });
});
