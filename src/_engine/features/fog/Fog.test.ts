import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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

/** A frame of the fog's system, as the main loop runs it. */
const frame = () => system!(getECSWorld());

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

  it('warns and keeps the fog for an id the scene doesn’t list', () => {
    switchScene([exp2Fog]);
    expect(setFog('noSuchFog')?.id).toBe('exp2');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('noSuchFog'));
    expect(reasons).toEqual(['set']);
  });

  it('keeps the uniforms drawable whatever the values', () => {
    setFog({ id: 'bad', mode: 'LINEAR', linear: { near: -10, far: -20 }, exp2: { density: -1 } });
    const nodes = getFogNodes()!;
    expect(nodes.near.value).toBe(0);
    expect(nodes.far.value).toBeGreaterThan(0);
    expect(nodes.exp2Density.value).toBe(0);
  });

  it('takes the graph off the root scene at a scene’s exit', () => {
    switchScene([exp2Fog]);
    switchScene();
    expect(rootScene.fogNode).toBeNull();
    expect(getFog()).toBeNull();
    expect(getFogNodes()!.enabled.value).toBe(0);
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
