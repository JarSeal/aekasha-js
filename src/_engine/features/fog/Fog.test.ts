import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ elapsed: 0, isLoading: false }));
vi.mock(import('../../kernel/loop/MainLoop'), async (importOriginal) => ({
  ...(await importOriginal()),
  getElapsedTime: () => m.elapsed,
}));
vi.mock(import('../../kernel/scene/SceneLoader'), async (importOriginal) => ({
  ...(await importOriginal()),
  isCurrentlyLoading: () => m.isLoading,
}));

import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { DEFAULT_ECS_WORLD_ID, ECSWorld, getECSWorld } from '../../kernel/ecs/ECS';
import type { FeatureContext } from '../../kernel/init/Features';
import { createRootScene, getRootScene, type SceneData } from '../../kernel/scene/Scene';
import type { SceneHooks } from '../../kernel/scene/SceneHooks';
import {
  getFog,
  getFogNodes,
  isFogEnabled,
  onFogChange,
  setFog,
  setFogEnabled,
  updateFog,
  type FogChangeReason,
} from './Fog';
import { fog } from './FogFeature';
import { type FogInput, resolveFogDef } from './FogSchema';

new ECSWorld({ id: DEFAULT_ECS_WORLD_ID });
createRootScene();
const rootScene = getRootScene()!;

let hooks: SceneHooks = {};
/** fogSystem, as the feature's install registers it */
let system: ((world: ECSWorld) => void) | null = null;

/** A frame of the fog's system, as the main loop runs it, `dtSec` after the last. */
const frame = (dtSec = 0) => {
  m.elapsed += dtSec;
  system!(getECSWorld());
};

/** A scene switch: the exit, then the next scene's data with its fogs resolved as the gather does. */
const switchScene = (fogs?: FogInput[]) => {
  hooks.exit?.('previous');
  const data = { id: 'next', ...(fogs ? { fogs: fogs.map(resolveFogDef) } : {}) } as SceneData;
  hooks.worldCleared?.(getECSWorld(), 'previous', data);
};

const exp2Fog: FogInput = { id: 'exp2', mode: 'EXP2', exp2: { density: 0.02 } };
const linearFog: FogInput = {
  id: 'linear',
  mode: 'LINEAR',
  isDefault: true,
  colorSource: 'MANUAL',
  color: '#336699',
  linear: { near: 5, far: 50 },
};

describe('the fog without the feature', () => {
  it('returns null from the getters and throws from the setters, naming it', () => {
    expect(getFog()).toBeNull();
    expect(getFogNodes()).toBeNull();
    expect(isFogEnabled()).toBeNull();
    expect(() => setFog('exp2')).toThrow(/fog\(\)/);
    expect(() => setFogEnabled(false)).toThrow(/fog\(\)/);
    expect(() => onFogChange(() => {})).toThrow(/fog\(\)/);
    expect(() => updateFog({ enabled: false })).toThrow(/fog\(\)/);
  });
});

describe('the fog with the feature', () => {
  const reasons: FogChangeReason[] = [];
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

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
    await fog().install(ctx);
    onFogChange((_fog, reason) => reasons.push(reason));
  });

  beforeEach(() => {
    switchScene();
    setFogEnabled(true);
    rootScene.background = null;
    rootScene.backgroundNode = null;
    reasons.length = 0;
  });

  it('shows a scene’s default fog, its graph on the root scene before the scene code', () => {
    switchScene([exp2Fog, linearFog]);
    expect(getFog()?.id).toBe('linear');
    expect(reasons).toEqual(['set']);
    const nodes = getFogNodes()!;
    expect(rootScene.fogNode).toBe(nodes.node);
    expect(nodes.enabled.value).toBe(1);
    expect(nodes.modeWeights.value.toArray()).toEqual([1, 0, 0]);
    expect(nodes.near.value).toBe(5);
    expect(nodes.far.value).toBe(50);
    expect(nodes.color.value.equals(new THREE.Color('#336699'))).toBe(true);
  });

  it('starts with the first fog without an isDefault, and none without fogs', () => {
    switchScene([exp2Fog, { ...linearFog, isDefault: false }]);
    expect(getFog()?.id).toBe('exp2');
    switchScene([]);
    expect(getFog()).toBeNull();
    expect(rootScene.fogNode).toBeNull();
    expect(reasons).toEqual(['set', 'clear']);
  });

  it('switches modes, the master switch and to none without changing the graph', () => {
    switchScene([exp2Fog, linearFog]);
    const node = rootScene.fogNode;
    const nodes = getFogNodes()!;

    expect(setFog('exp2')?.id).toBe('exp2');
    expect(nodes.modeWeights.value.toArray()).toEqual([0, 1, 0]);
    expect(nodes.exp2Density.value).toBe(0.02);

    setFogEnabled(false);
    expect(isFogEnabled()).toBe(false);
    expect(nodes.enabled.value).toBe(0);
    setFogEnabled(true);
    expect(nodes.enabled.value).toBe(1);

    expect(setFog(null)).toBeNull();
    expect(getFog()).toBeNull();
    expect(nodes.enabled.value).toBe(0);

    expect(setFog({ id: 'code', mode: 'LINEAR', enabled: false })?.id).toBe('code');
    expect(nodes.enabled.value).toBe(0);
    expect(rootScene.fogNode).toBe(node);
    expect(getFogNodes()).toBe(nodes);
    expect(reasons).toEqual(['set', 'set', 'enabled', 'enabled', 'clear', 'set']);
  });

  it('resolves a fog made in code, its sun glow from its mode', () => {
    const def = setFog({ id: 'mist', mode: 'HEIGHT' })!;
    expect(def.sunScattering.enabled).toBe(true);
    expect(def.color).toBe('#b4c0cc');
    // A scene that started without a fog gets the graph with its first
    expect(rootScene.fogNode).toBe(getFogNodes()!.node);
  });

  it('writes HEIGHT’s parameters and the sun glow’s', () => {
    const nodes = getFogNodes()!;
    setFog({
      id: 'valley',
      mode: 'HEIGHT',
      height: { density: 0.05, baseHeight: -3, falloff: 0.2, startDistance: 15, maxOpacity: 0.8 },
      sunScattering: { strength: 0.7, exponent: 16 },
    });
    expect(nodes.modeWeights.value.toArray()).toEqual([0, 0, 1]);
    expect(nodes.heightDensity.value).toBe(0.05);
    expect(nodes.baseHeight.value).toBe(-3);
    expect(nodes.falloff.value).toBe(0.2);
    expect(nodes.startDistance.value).toBe(15);
    expect(nodes.maxOpacity.value).toBe(0.8);
    expect(nodes.sunStrength.value).toBe(0.7);
    expect(nodes.sunExponent.value).toBe(16);

    // LINEAR's glow is off by default: its strength is kept, the uniform's 0
    setFog({ id: 'plain', mode: 'LINEAR', sunScattering: { strength: 0.7 } });
    expect(nodes.sunStrength.value).toBe(0);
    setFog({ id: 'glowing', mode: 'LINEAR', sunScattering: { enabled: true, strength: 0.7 } });
    expect(nodes.sunStrength.value).toBe(0.7);
  });

  it('warns and keeps the fog for an id the scene doesn’t list', () => {
    switchScene([exp2Fog]);
    expect(setFog('noSuchFog')?.id).toBe('exp2');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('noSuchFog'));
    expect(reasons).toEqual(['set']);
  });

  it('keeps the uniforms drawable whatever the values', () => {
    setFog({
      id: 'bad',
      mode: 'LINEAR',
      linear: { near: -10, far: -20 },
      exp2: { density: -1 },
      height: { density: -1, falloff: -1, startDistance: -5, maxOpacity: 2 },
      sunScattering: { enabled: true, strength: 3, exponent: 0 },
    });
    const nodes = getFogNodes()!;
    expect(nodes.near.value).toBe(0);
    expect(nodes.far.value).toBeGreaterThan(0);
    expect(nodes.exp2Density.value).toBe(0);
    expect(nodes.heightDensity.value).toBe(0);
    expect(nodes.falloff.value).toBe(0);
    expect(nodes.startDistance.value).toBe(0);
    expect(nodes.maxOpacity.value).toBe(1);
    expect(nodes.sunStrength.value).toBe(1);
    expect(nodes.sunExponent.value).toBeGreaterThan(0);
  });

  it('takes the graph off the root scene at a scene’s exit', () => {
    switchScene([exp2Fog]);
    switchScene();
    expect(rootScene.fogNode).toBeNull();
    expect(getFog()).toBeNull();
    expect(getFogNodes()!.enabled.value).toBe(0);
  });

  describe('updateFog', () => {
    it('changes the values at once, the scene’s data kept', () => {
      const sceneData = resolveFogDef(linearFog);
      hooks.exit?.('previous');
      hooks.worldCleared?.(getECSWorld(), 'previous', {
        id: 'next',
        fogs: [sceneData],
      } as SceneData);
      const nodes = getFogNodes()!;
      const def = updateFog({ linear: { far: 80 }, mode: 'EXP2', color: { r: 255, g: 0, b: 0 } })!;
      expect(def.linear).toEqual({ near: 5, far: 80 });
      expect(getFog()).toBe(def);
      expect(sceneData.linear.far).toBe(50);
      expect(sceneData.mode).toBe('LINEAR');
      expect(nodes.far.value).toBe(80);
      expect(nodes.modeWeights.value.toArray()).toEqual([0, 1, 0]);
      expect(nodes.color.value.equals(new THREE.Color('#ff0000'))).toBe(true);
      expect(reasons).toEqual(['set', 'update']);
      // The scene's next visit starts from its data
      setFog('linear');
      expect(getFog()!.linear.far).toBe(50);
    });

    it('moves the numbers and the colour over transitionSec, getFog the target at once', () => {
      switchScene([linearFog]);
      const nodes = getFogNodes()!;
      frame();
      updateFog(
        { linear: { far: 150 }, color: '#ffffff', mode: 'HEIGHT', height: { density: 0.1 } },
        { transitionSec: 10 }
      );
      expect(getFog()!.linear.far).toBe(150);
      // The mode switches at once, the numbers wait for the clock
      expect(nodes.modeWeights.value.toArray()).toEqual([0, 0, 1]);
      expect(nodes.far.value).toBe(50);
      expect(nodes.heightDensity.value).toBe(0.02);

      frame(2.5);
      expect(nodes.far.value).toBeCloseTo(75);
      expect(nodes.heightDensity.value).toBeCloseTo(0.04);
      // The colour moves in linear space
      const from = new THREE.Color('#336699');
      expect(nodes.color.value.r).toBeCloseTo(from.r + (1 - from.r) * 0.25);
      expect(reasons).toEqual(['set', 'update']);

      // Standing still while a scene loads
      m.isLoading = true;
      frame(5);
      m.isLoading = false;
      expect(nodes.far.value).toBeCloseTo(75);

      frame(7.5);
      expect(nodes.far.value).toBe(150);
      expect(nodes.color.value.equals(new THREE.Color(1, 1, 1))).toBe(true);
    });

    it('fades the sun glow in when switched on', () => {
      switchScene([linearFog]);
      const nodes = getFogNodes()!;
      updateFog({ sunScattering: { enabled: true, strength: 0.8 } }, { transitionSec: 4 });
      expect(nodes.sunStrength.value).toBe(0);
      frame(1);
      expect(nodes.sunStrength.value).toBeCloseTo(0.2);
    });

    it('lets the latest call win per value', () => {
      switchScene([linearFog]);
      const nodes = getFogNodes()!;
      updateFog({ linear: { near: 15, far: 150 } }, { transitionSec: 10 });
      frame(5);
      // far again, over 1 s from where it is; near keeps its 10 s
      updateFog({ linear: { far: 50 } }, { transitionSec: 1 });
      frame(1);
      expect(nodes.far.value).toBe(50);
      expect(nodes.near.value).toBeCloseTo(11);
      // At once: near jumps, its transition dropped
      updateFog({ linear: { near: 1 } });
      expect(nodes.near.value).toBe(1);
      frame(10);
      expect(nodes.near.value).toBe(1);
    });

    it('keeps the far past the near while both move', () => {
      switchScene([linearFog]);
      const nodes = getFogNodes()!;
      updateFog({ linear: { near: 200, far: 300 } }, { transitionSec: 10 });
      updateFog({ linear: { far: 300 } }, { transitionSec: 1 });
      frame(1);
      // near 5 → 200 over 10 s is at 24.5; far 50 → 300 over 10 s too (its target didn't change)
      expect(nodes.far.value).toBeGreaterThan(nodes.near.value);
      updateFog({ linear: { far: 10 } });
      expect(nodes.far.value).toBeGreaterThan(nodes.near.value);
    });

    it('ignores what isn’t finite', () => {
      switchScene([linearFog]);
      const def = updateFog({
        linear: { near: NaN, far: 70 },
        color: { r: Infinity, g: 0, b: 0 },
        height: { density: -Infinity },
      })!;
      expect(def.linear).toEqual({ near: 5, far: 70 });
      expect(def.color).toBe('#336699');
      expect(def.height.density).toBe(0.02);
    });

    it('ends its transitions with another fog or the scene’s exit', () => {
      switchScene([linearFog, exp2Fog]);
      const nodes = getFogNodes()!;
      updateFog({ exp2: { density: 0.5 } }, { transitionSec: 10 });
      setFog('exp2');
      frame(5);
      expect(nodes.exp2Density.value).toBe(0.02);

      updateFog({ exp2: { density: 0.5 } }, { transitionSec: 10 });
      switchScene([exp2Fog]);
      frame(5);
      expect(nodes.exp2Density.value).toBe(0.02);
    });

    it('warns and changes nothing without a fog', () => {
      expect(updateFog({ enabled: false })).toBeNull();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('updateFog'));
      expect(reasons).toEqual([]);
    });
  });

  describe('FOG_COLOR', () => {
    const colorFog: FogInput = { ...linearFog, background: 'FOG_COLOR' };

    it('takes the background while the fog renders, and gives the scene’s back', () => {
      switchScene([colorFog]);
      const sceneColor = new THREE.Color('red');
      rootScene.background = sceneColor;
      frame();
      const fogColor = rootScene.background as THREE.Color;
      expect(fogColor).not.toBe(sceneColor);
      expect(fogColor.equals(new THREE.Color('#336699'))).toBe(true);

      setFogEnabled(false);
      frame();
      expect(rootScene.background).toBe(sceneColor);
      setFogEnabled(true);
      frame();
      expect(rootScene.background).toBe(fogColor);

      switchScene();
      expect(rootScene.background).toBe(sceneColor);
    });

    it('lets go under a sky box’s background or a texture', () => {
      switchScene([colorFog]);
      frame();
      expect(rootScene.background).not.toBeNull();
      rootScene.backgroundNode = uniform(new THREE.Color());
      frame();
      expect(rootScene.background).toBeNull();

      rootScene.backgroundNode = null;
      const texture = new THREE.Texture();
      rootScene.background = texture;
      frame();
      expect(rootScene.background).toBe(texture);
    });

    it('leaves the background alone with NONE', () => {
      switchScene([linearFog]);
      frame();
      expect(rootScene.background).toBeNull();
    });
  });
});
