import { beforeAll, describe, expect, test } from 'vitest';
import type * as THREE from 'three/webgpu';
import { ECSWorld } from '../ecs/ECS';
import { ComponentType } from '../ecs/ECSCoreComponents';
import { createRootScene } from '../scene/Scene';
import { createLightEntity } from './Light';

// The default world (createLightEntity's) and the root scene, once for this file
let world: ECSWorld;
beforeAll(() => {
  world = new ECSWorld();
  createRootScene();
});

const getShadow = (entityId: number) =>
  (world.getComponent(entityId, ComponentType.OBJECT3D)!.value as THREE.SpotLight).shadow;

describe('createLightEntity', () => {
  test('applies the shadow preset named by its string, MEDIUM by default', () => {
    const high = createLightEntity({ type: 'SPOT', castShadow: true, shadowPreset: 'HIGH' });
    expect(getShadow(high).mapSize.toArray()).toEqual([2048, 2048]);
    expect(getShadow(high).blurSamples).toBe(16);

    const medium = createLightEntity({ type: 'POINT', castShadow: true });
    expect(getShadow(medium).mapSize.toArray()).toEqual([1024, 1024]);

    // A light's own value wins over its preset's
    const tuned = createLightEntity({
      type: 'DIRECTIONAL',
      shadowPreset: 'LOW',
      shadowMapSize: [256, 128],
    });
    expect(getShadow(tuned).mapSize.toArray()).toEqual([256, 128]);
    expect(getShadow(tuned).radius).toBe(1);

    for (const entityId of [high, medium, tuned]) world.deleteEntity(entityId);
  });

  test("takes the JSON's { r, g, b } colours (three would ignore the plain object)", () => {
    const entityId = createLightEntity({
      type: 'HEMISPHERE',
      color: { r: 255, g: 0, b: 0 },
      groundColor: { r: 0, g: 0, b: 255 },
    });
    const light = world.getComponent(entityId, ComponentType.OBJECT3D)!
      .value as THREE.HemisphereLight;
    expect(light.color.getHex()).toBe(0xff0000);
    expect(light.groundColor.getHex()).toBe(0x0000ff);
    world.deleteEntity(entityId);
  });
});
