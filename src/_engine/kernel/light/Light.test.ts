import { beforeAll, describe, expect, test } from 'vitest';
import * as THREE from 'three/webgpu';
import { ECSWorld } from '../ecs/ECS';
import { ComponentType } from '../ecs/ECSCoreComponents';
import { createRootScene } from '../scene/Scene';
import { getRendererOptions } from '../render/Renderer';
import { createLightEntity, SHADOW_PRESETS, VSM_PRESET_BIAS } from './Light';

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

  test("limits a preset's bias under VSM, not a light's own (i010)", () => {
    const options = getRendererOptions();
    const shadowMapType = options.shadowMapType;
    try {
      options.shadowMapType = THREE.PCFShadowMap;
      const pcf = createLightEntity({ type: 'DIRECTIONAL', castShadow: true });
      expect(getShadow(pcf).bias).toBe(SHADOW_PRESETS.MEDIUM.bias);

      options.shadowMapType = THREE.VSMShadowMap;
      const medium = createLightEntity({ type: 'DIRECTIONAL', castShadow: true });
      expect(getShadow(medium).bias).toBe(VSM_PRESET_BIAS);
      // A preset with a bigger bias keeps its own
      const low = createLightEntity({ type: 'SPOT', castShadow: true, shadowPreset: 'LOW' });
      expect(getShadow(low).bias).toBe(Math.min(SHADOW_PRESETS.LOW.bias, VSM_PRESET_BIAS));
      const own = createLightEntity({ type: 'DIRECTIONAL', castShadow: true, shadowBias: -0.0001 });
      expect(getShadow(own).bias).toBe(-0.0001);

      for (const entityId of [pcf, medium, low, own]) world.deleteEntity(entityId);
    } finally {
      options.shadowMapType = shadowMapType;
    }
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
