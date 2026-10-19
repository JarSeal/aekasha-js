import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';

// No renderer and no files: the root scene is a plain THREE.Scene, the current scene a fixed id,
// and every texture file load a promise the test settles (a GPU-free activation: without a
// renderer, getPMREMTexture returns the source texture as is)
const m = vi.hoisted(() => ({
  rootScene: null as unknown as THREE.Scene,
  elapsed: 0,
  isLoading: false,
  loads: [] as {
    fileName: unknown;
    resolve: (texture: THREE.Texture) => void;
    reject: (error: Error) => void;
  }[],
}));
vi.mock(import('../../kernel/scene/Scene'), async (importOriginal) => ({
  ...(await importOriginal()),
  getCurrentSceneId: () => 'scene',
  getRootScene: () => m.rootScene,
}));
vi.mock(import('../../kernel/loop/MainLoop'), async (importOriginal) => ({
  ...(await importOriginal()),
  getElapsedTime: () => m.elapsed,
}));
vi.mock(import('../../kernel/scene/SceneLoader'), async (importOriginal) => ({
  ...(await importOriginal()),
  isCurrentlyLoading: () => m.isLoading,
}));
vi.mock(import('../../kernel/assets/Texture'), async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    loadTextureAsync: ((props: { fileName?: unknown }) =>
      new Promise<THREE.Texture>((resolve, reject) => {
        m.loads.push({ fileName: props.fileName, resolve, reject });
      })) as typeof original.loadTextureAsync,
  };
});

import { DEFAULT_ECS_WORLD_ID, ECSWorld, getECSWorld } from '../../kernel/ecs/ECS';
import type { FeatureContext } from '../../kernel/init/Features';
import {
  clearSkyBox,
  getActiveSkyBox,
  onSkyBoxChange,
  registerSkyBox,
  setActiveSkyBox,
  stopSkyBox,
  updateSkyBox,
  type SkyBoxUpdate,
} from './SkyBox';
import { installSkyBoxSystem } from './SkyDayNight';
import type { SkyBoxDef } from './SkyBoxTypes';

const equirect = (file: string) => ({ type: 'EQUIRECTANGULAR' as const, file });

/** A texture that reads as loaded (an image with a height). */
const loadedTexture = () => {
  const texture = new THREE.Texture();
  texture.image = { width: 2, height: 1 };
  return texture;
};

// The sky lights' world (none of these sky boxes has a light)
new ECSWorld({ id: DEFAULT_ECS_WORLD_ID });

beforeEach(() => {
  m.rootScene = new THREE.Scene();
  m.loads.length = 0;
  m.isLoading = false;
  clearSkyBox();
});

describe('updateSkyBox while a structural update loads', () => {
  // S1 (p615): the second update used to merge into the old definition and be dropped when the
  // activation landed
  it('keeps a value change made before the new texture has loaded', async () => {
    registerSkyBox({ id: 'sky', base: equirect('a.png') }, 'scene');
    const activation = setActiveSkyBox('sky');
    m.loads[0].resolve(loadedTexture());
    await activation;

    const structural = updateSkyBox('sky', { base: { file: 'b.png' } });
    const value = updateSkyBox('sky', { env: { backgroundIntensity: 0.5 } });
    expect(m.loads[1].fileName).toBe('b.png');
    m.loads[1].resolve(loadedTexture());
    await Promise.all([structural, value]);

    const active = getActiveSkyBox();
    expect(active?.def.base).toMatchObject({ file: 'b.png' });
    expect(active?.def.env?.backgroundIntensity).toBe(0.5);
    expect(m.rootScene.backgroundIntensity).toBe(0.5);
  });

  it('applies the updates made meanwhile in call order, and settles each caller', async () => {
    registerSkyBox({ id: 'sky', base: equirect('a.png') }, 'scene');
    const activation = setActiveSkyBox('sky');
    m.loads[0].resolve(loadedTexture());
    await activation;

    const structural = updateSkyBox('sky', { base: { file: 'b.png' } });
    const drag = [0.2, 0.4, 0.6].map((value) =>
      updateSkyBox('sky', { env: { backgroundIntensity: value, environmentIntensity: value } })
    );
    const last = updateSkyBox('sky', { env: { environmentIntensity: 0.9 } });
    m.loads[1].resolve(loadedTexture());
    const results = await Promise.all([structural, ...drag, last]);

    // The structural call settles with what its activation showed, the queued ones after them
    expect(results[0]?.def.base).toMatchObject({ file: 'b.png' });
    expect(results.slice(1).every((result) => result === getActiveSkyBox())).toBe(true);
    expect(m.rootScene.backgroundIntensity).toBe(0.6);
    expect(m.rootScene.environmentIntensity).toBe(0.9);
  });

  it('drops an update for a sky box that is no longer active by then', async () => {
    registerSkyBox({ id: 'first', base: equirect('a.png') }, 'scene');
    registerSkyBox({ id: 'second', base: equirect('b.png') }, 'scene');
    const first = setActiveSkyBox('first');
    const update = updateSkyBox('first', { env: { backgroundIntensity: 0.5 } });
    const second = setActiveSkyBox('second');
    m.loads[0].resolve(loadedTexture());
    m.loads[1].resolve(loadedTexture());
    await Promise.all([first, second]);

    expect((await update)?.id).toBe('second');
    expect(getActiveSkyBox()?.def.env?.backgroundIntensity).toBeUndefined();
  });
});

describe('a sky box texture that fails to load', () => {
  // S2 (p615): the debug env loaded with throwOnError, so the load rejected, and with it the
  // activation (and the scene load that awaits it in the feature's `created` hook)
  it('shows the sky box with a black base instead of rejecting', async () => {
    registerSkyBox({ id: 'broken', base: equirect('missing.png') }, 'scene');
    // The expectation first, so a rejection is never unhandled
    const result = expect(setActiveSkyBox('broken')).resolves.toMatchObject({ id: 'broken' });
    m.loads[0].reject(new Error('Could not load "missing.png"'));
    await result;
    expect(getActiveSkyBox()?.textures.source).toBeNull();
    expect(m.rootScene.backgroundNode).not.toBeNull();
  });
});

describe('stopSkyBox, for unmount()', () => {
  it('clears the sky box, settles what waits and drops the listeners', async () => {
    registerSkyBox({ id: 'sky', base: equirect('a.png') }, 'scene');
    const shown = setActiveSkyBox('sky');
    m.loads[0].resolve(loadedTexture());
    await shown;
    const listener = vi.fn();
    onSkyBoxChange(listener);

    const pending = setActiveSkyBox('sky');
    const update = updateSkyBox('sky', { env: { backgroundIntensity: 0.5 } });
    stopSkyBox();
    expect(listener).toHaveBeenCalledWith(null, 'clear');
    m.loads[1].resolve(loadedTexture());

    expect(await update).toBeNull();
    expect(await pending).toBeNull(); // Superseded by the stop's clear
    expect(getActiveSkyBox()).toBeNull();
    expect(m.rootScene.backgroundNode).toBeNull();
    expect(m.rootScene.environmentNode).toBeNull();
    listener.mockClear();
    clearSkyBox();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('the sky clock', () => {
  /** skyBoxSystem, as the feature's install registers it. */
  const getSkyBoxSystem = () => {
    let system: ((world: ECSWorld) => void) | null = null;
    const fakeWorld = {
      addSystem: (_stage: unknown, _name: string, fn: typeof system) => (system = fn),
    };
    installSkyBoxSystem({
      registerPlugin: (plugin: (world: unknown) => void) => plugin(fakeWorld),
    } as unknown as FeatureContext);
    return system!;
  };

  it('drifts the clouds with the elapsed time, but not while a scene loads, from 0 per scene', async () => {
    const skyBoxSystem = getSkyBoxSystem();
    const world = getECSWorld();
    // A colour base with an atmosphere and clouds: the composite path, no texture to load
    registerSkyBox(
      { id: 'cloudy', base: { type: 'COLOR', color: '#000000' }, atmosphere: {}, clouds: {} },
      'scene'
    );
    const tick = (elapsed: number) => {
      m.elapsed = elapsed;
      skyBoxSystem(world);
    };
    const cloudsTime = () => getActiveSkyBox()!.uniforms.clouds.time.value;

    tick(10);
    clearSkyBox();
    await setActiveSkyBox('cloudy');
    tick(10.5);
    expect(cloudsTime()).toBeCloseTo(0.5, 9);
    m.isLoading = true;
    tick(12);
    expect(cloudsTime()).toBeCloseTo(0.5, 9);
    m.isLoading = false;
    tick(12.25);
    expect(cloudsTime()).toBeCloseTo(0.75, 9);

    // A structural change (a rebuild) keeps the clock: the clouds don't jump
    await updateSkyBox('cloudy', { ground: {} });
    tick(12.5);
    expect(cloudsTime()).toBeCloseTo(1, 9);

    // The next scene's sky starts from 0
    clearSkyBox();
    await setActiveSkyBox('cloudy');
    tick(13);
    expect(cloudsTime()).toBeCloseTo(0.5, 9);
  });
});

describe('updateSkyBox: new nodes or uniform writes', () => {
  const black = { type: 'COLOR' as const, color: '#000000' };

  /** Shows `def` (a colour base: nothing to load), then updates it with `update`.
   * @returns whether the update gave the background new nodes, and whether it kept the
   * activation's uniforms */
  const update = async (def: Omit<SkyBoxDef, 'id'>, change: SkyBoxUpdate) => {
    registerSkyBox({ id: 'sky', ...def }, 'scene');
    await setActiveSkyBox('sky');
    const before = { node: m.rootScene.backgroundNode, uniforms: getActiveSkyBox()!.uniforms };
    await updateSkyBox('sky', change);
    return {
      rebuilt: m.rootScene.backgroundNode !== before.node,
      keptUniforms: getActiveSkyBox()!.uniforms === before.uniforms,
    };
  };

  it.each<[string, Omit<SkyBoxDef, 'id'>, SkyBoxUpdate]>([
    ["a direct path's value", { base: black }, { base: { color: '#204060' } }],
    ['a layer value', { base: black, atmosphere: {} }, { atmosphere: { turbidity: 8 } }],
    ['a sun moved', { base: black, suns: [{}] }, { suns: { 0: { elevation: -20 } } }],
    [
      'the background blur, staying above 0',
      { base: black, stars: {}, env: { backgroundRoughness: 0.2 } },
      { env: { backgroundRoughness: 0.5 } },
    ],
    ['the env intensities', { base: black, stars: {} }, { env: { environmentIntensity: 0.3 } }],
  ])('writes uniforms for %s', async (_, def, change) => {
    expect(await update(def, change)).toEqual({ rebuilt: false, keptUniforms: true });
  });

  it.each<[string, Omit<SkyBoxDef, 'id'>, SkyBoxUpdate]>([
    ['a first procedural layer (direct to composite)', { base: black }, { ground: {} }],
    [
      'the last one turned off (composite to direct)',
      { base: black, ground: {} },
      { ground: { enabled: false } },
    ],
    ['a layer added (the signature)', { base: black, atmosphere: {} }, { clouds: {} }],
    ['a sun added', { base: black, suns: [{}] }, { suns: [{}, {}] }],
    ['env.size', { base: black, stars: {} }, { env: { size: 64 } }],
    // Day-night's default env size is 128, not 256
    ['day-night without an env.size', { base: black, stars: {} }, { dayNight: {} }],
    [
      'the background blur leaving 0 (the background samples the bake)',
      { base: black, stars: {} },
      { env: { backgroundRoughness: 0.3 } },
    ],
  ])('rebuilds the nodes, keeping the uniforms, for %s', async (_, def, change) => {
    expect(await update(def, change)).toEqual({ rebuilt: true, keptUniforms: true });
  });

  it("writes a direct path's colour without new nodes", async () => {
    await update({ base: black }, { base: { color: '#ff0000' } });
    expect(getActiveSkyBox()!.uniforms.base.color.value.getHexString()).toBe('ff0000');
  });
});
