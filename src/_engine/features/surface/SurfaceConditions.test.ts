import { beforeAll, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ elapsed: 0, isLoading: false, isAppPlaying: true }));
vi.mock(import('../../kernel/loop/MainLoop'), async (importOriginal) => ({
  ...(await importOriginal()),
  getElapsedTime: () => m.elapsed,
  isAppPlaying: () => m.isAppPlaying,
}));
vi.mock(import('../../kernel/scene/SceneLoader'), async (importOriginal) => ({
  ...(await importOriginal()),
  isCurrentlyLoading: () => m.isLoading,
}));

import { DEFAULT_ECS_WORLD_ID, ECSWorld, getECSWorld } from '../../kernel/ecs/ECS';
import type { FeatureContext } from '../../kernel/init/Features';
import type { SceneData } from '../../kernel/scene/Scene';
import type { SceneHooks } from '../../kernel/scene/SceneHooks';
import {
  getSurfaceConditionNodes,
  getSurfaceConditions,
  getSurfaceTime,
  setSurfaceConditions,
  setSurfaceSunSource,
  startRain,
  SURFACE_WATER_LEVEL_NONE,
} from './SurfaceConditions';
import { surfaceConditions } from './SurfaceConditionsFeature';
import { SURFACE_CONDITIONS_DEFAULTS, SURFACE_MIN_SUN_FACTOR } from './SurfaceConditionsModel';

new ECSWorld({ id: DEFAULT_ECS_WORLD_ID });

let hooks: SceneHooks = {};
/** surfaceConditionsSystem, as the feature's install registers it */
let system: ((world: ECSWorld) => void) | null = null;

/** Runs the feature's system as the main loop would, `seconds` later. */
const frame = (seconds: number) => {
  m.elapsed += seconds;
  system!(getECSWorld());
};

/** A scene switch: the exit, then the next scene's data. */
const switchScene = (data: Partial<SceneData> = {}) => {
  hooks.exit?.('previous');
  hooks.worldCleared?.(getECSWorld(), 'previous', { id: 'next', ...data } as SceneData);
};

describe('surface conditions without the feature', () => {
  it('returns null from the getters and throws from the setters, naming it', () => {
    expect(getSurfaceConditions()).toBeNull();
    expect(getSurfaceConditionNodes()).toBeNull();
    expect(getSurfaceTime()).toBeNull();
    expect(() => setSurfaceConditions({ rain: 1 })).toThrow(/surfaceConditions\(\)/);
    expect(() => startRain(1)).toThrow(/surfaceConditions\(\)/);
  });
});

describe('surface conditions with the feature', () => {
  beforeAll(async () => {
    const fakeWorld = {
      addSystem: (_stage: unknown, _name: string, fn: typeof system) => (system = fn),
    };
    const ctx = {
      registerPlugin: (plugin: (world: unknown) => void) => plugin(fakeWorld),
      addSceneHooks: (sceneHooks: SceneHooks) => {
        hooks = sceneHooks;
        return () => {};
      },
    } as unknown as FeatureContext;
    await surfaceConditions().install(ctx);
  });

  it('rains, wets and writes the stable uniforms every frame', () => {
    const nodes = getSurfaceConditionNodes();
    expect(nodes).not.toBeNull();
    expect(getSurfaceConditionNodes()).toBe(nodes);
    expect(nodes!.waterLevel.value).toBe(SURFACE_WATER_LEVEL_NONE);
    startRain(1, { rampSec: 10 });
    for (let i = 0; i < 20; i++) frame(1);
    expect(getSurfaceConditions()!.rain).toBe(1);
    expect(getSurfaceConditions()!.wetness).toBeGreaterThan(0);
    expect(nodes!.rain.value).toBe(1);
    expect(nodes!.wetness.value).toBe(getSurfaceConditions()!.wetness);
    expect(nodes!.time.value).toBeCloseTo(20);
    expect(getSurfaceTime()).toBeCloseTo(20);
  });

  it('stands still while the app is paused (APP time source) and while a scene loads', () => {
    switchScene();
    startRain(1);
    m.isAppPlaying = false;
    frame(5);
    expect(getSurfaceTime()).toBe(0);
    expect(getSurfaceConditions()!.wetness).toBe(0);
    m.isAppPlaying = true;
    m.isLoading = true;
    frame(5);
    expect(getSurfaceTime()).toBe(0);
    m.isLoading = false;
    frame(6);
    expect(getSurfaceTime()).toBe(6);
    expect(getSurfaceConditions()!.wetness).toBeCloseTo(0.1);
  });

  it('dries with the sun source', () => {
    switchScene({ surfaceConditions: { wetness: 1 } });
    setSurfaceSunSource(() => -0.5);
    frame(60);
    expect(getSurfaceConditions()!.wetness).toBeCloseTo(1 - 0.1 * SURFACE_MIN_SUN_FACTOR);
    setSurfaceSunSource(null);
  });

  it("resets on every scene exit and applies the next scene's values", () => {
    setSurfaceConditions({ wetness: 0.7, waterLevel: 3 }, { transitionSec: 30 });
    frame(1);
    switchScene({ surfaceConditions: { rain: 0.5, wind: [1, 2], mode: 'MANUAL' } });
    expect(getSurfaceConditions()).toEqual({
      ...SURFACE_CONDITIONS_DEFAULTS,
      rain: 0.5,
      wind: [1, 2],
      mode: 'MANUAL',
    });
    expect(getSurfaceTime()).toBe(0);
    const nodes = getSurfaceConditionNodes()!;
    expect(nodes.rain.value).toBe(0.5);
    expect(nodes.wind.value.toArray()).toEqual([1, 2]);
    // The earlier transition went with the exit
    frame(30);
    expect(getSurfaceConditions()!.wetness).toBe(0);
    switchScene();
    expect(getSurfaceConditions()).toEqual(SURFACE_CONDITIONS_DEFAULTS);
  });
});
