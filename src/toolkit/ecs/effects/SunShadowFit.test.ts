import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { ComponentType, ECSWorld, type ECSStorageMode } from 'aekasha';
import {
  registerSunShadowFitEffect,
  SunShadowFitComponentType,
  type SunShadowFitData,
} from './SunShadowFit';

const worldIds: string[] = [];
afterEach(() => {
  for (const id of worldIds.splice(0)) ECSWorld.deleteWorld(id);
});

const MAP_SIZE = 1024;

// A world with the effect's system (captured from its registration), a main camera at
// (5, 4, 12) looking at (5, 0, 0), and a sun from `sunFrom` toward the origin carrying the effect
const createScene = (
  storageMode: ECSStorageMode,
  sunFrom: THREE.Vector3,
  data: Partial<SunShadowFitData> = {}
) => {
  const id = `sunFit-${storageMode}-${worldIds.length}`;
  worldIds.push(id);
  const world = new ECSWorld({ id, storageMode, maxEntities: 16 });
  const addSystem = vi.spyOn(world, 'addSystem');
  registerSunShadowFitEffect(world);
  const systemFn = addSystem.mock.calls[0][2];

  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.5, 500);
  camera.position.set(5, 4, 12);
  camera.lookAt(5, 0, 0);
  const cameraId = world.createEntity();
  world.addComponent(cameraId, ComponentType.OBJECT3D, { value: camera, _lastVersion: -1 });
  world.addComponent(cameraId, ComponentType.TAG_IS_MAIN_CAMERA, true);

  const light = new THREE.DirectionalLight();
  light.position.copy(sunFrom);
  light.shadow.mapSize.set(MAP_SIZE, MAP_SIZE);
  const lightId = world.createEntity();
  const targetId = world.createEntity();
  world.addComponent(lightId, ComponentType.OBJECT3D, { value: light, _lastVersion: -1 });
  world.addComponent(targetId, ComponentType.OBJECT3D, { value: light.target, _lastVersion: -1 });
  world.addComponent(lightId, ComponentType.TARGET_LINK, { targetId });
  world.addComponent(lightId, SunShadowFitComponentType.SUN_SHADOW_FIT, {
    maxDistance: 40,
    casterExtension: 10,
    ...data,
  });
  return { world, camera, light, lightId, run: () => systemFn(world, 1 / 60) };
};

// The corners of the camera's view slice from its near plane to `far`, in world space
const getSliceCorners = (camera: THREE.PerspectiveCamera, far: number) => {
  const tanY = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  const tanX = tanY * camera.aspect;
  const corners: THREE.Vector3[] = [];
  for (const depth of [camera.near, far]) {
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const corner = new THREE.Vector3(sx * tanX * depth, sy * tanY * depth, -depth);
        corners.push(corner.applyMatrix4(camera.matrixWorld));
      }
    }
  }
  return corners;
};

describe.each<ECSStorageMode>(['MAP', 'TYPED_ARRAY'])('sunShadowFitSystem (%s storage)', (mode) => {
  it("wraps the view slice in the shadow camera's sphere, the light toward the sun", () => {
    const sunFrom = new THREE.Vector3(30, 50, 20);
    const { world, camera, light, lightId, run } = createScene(mode, sunFrom, {
      snapToTexels: false,
    });
    run();

    const shadowCam = light.shadow.camera;
    const radius = shadowCam.right;
    expect([shadowCam.left, shadowCam.top, shadowCam.bottom]).toEqual([-radius, radius, -radius]);
    // Every corner inside the sphere, the farthest on it
    const center = light.target.position;
    const distances = getSliceCorners(camera, 40).map((corner) => corner.distanceTo(center));
    expect(Math.max(...distances)).toBeCloseTo(radius, 9);

    // The light along the sun's direction, at radius + casterExtension + 1: the near plane at 1
    const toLight = light.position.clone().sub(center);
    expect(toLight.clone().normalize().distanceTo(sunFrom.clone().normalize())).toBeLessThan(1e-9);
    expect(toLight.length()).toBeCloseTo(radius + 10 + 1, 9);
    expect(shadowCam.near).toBeCloseTo(1, 9);
    expect(shadowCam.far).toBeCloseTo(toLight.length() + radius, 9);
    // The light's TRANSFORM agrees with its Object3D
    const { position } = world.getComponent(lightId, ComponentType.TRANSFORM)!;
    expect(position.distanceTo(light.position)).toBeLessThan(1e-4);
  });

  it.each([
    ['a slanted sun', new THREE.Vector3(30, 50, 20)],
    ['a sun straight above', new THREE.Vector3(0, 50, 0)],
  ])("snaps the center to whole texels along the shadow camera's axes (%s)", (_, sunFrom) => {
    const { light, run } = createScene(mode, sunFrom);
    run();
    const texel = (light.shadow.camera.right * 2) / MAP_SIZE;
    // The shadow camera's axes, as three builds them for the light looking at its target
    const basis = new THREE.Matrix4().lookAt(light.position, light.target.position, light.up);
    const axisX = new THREE.Vector3().setFromMatrixColumn(basis, 0);
    const axisY = new THREE.Vector3().setFromMatrixColumn(basis, 1);
    for (const axis of [axisX, axisY]) {
      const texels = light.target.position.dot(axis) / texel;
      expect(Math.abs(texels - Math.round(texels))).toBeLessThan(1e-4);
    }
  });

  it('keeps the extents while the camera turns, and moves them when it zooms', () => {
    const { camera, light, run } = createScene(mode, new THREE.Vector3(30, 50, 20));
    run();
    const radius = light.shadow.camera.right;
    camera.lookAt(-20, 3, 4);
    run();
    expect(light.shadow.camera.right).toBe(radius);
    camera.fov = 30;
    camera.updateProjectionMatrix();
    run();
    expect(light.shadow.camera.right).toBeLessThan(radius);
  });
});
