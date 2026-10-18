import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';

// No renderer and no files: the root scene is a plain THREE.Scene, the current scene a fixed id,
// and every texture file load a promise the test settles (a GPU-free activation: without a
// renderer, getPMREMTexture returns the source texture as is)
const m = vi.hoisted(() => ({
  rootScene: null as unknown as THREE.Scene,
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

import { DEFAULT_ECS_WORLD_ID, ECSWorld } from '../../kernel/ecs/ECS';
import {
  clearSkyBox,
  getActiveSkyBox,
  registerSkyBox,
  setActiveSkyBox,
  updateSkyBox,
} from './SkyBox';

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
