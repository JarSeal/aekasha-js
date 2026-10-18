import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';

// No renderer and no files: the root scene is a plain THREE.Scene, the current scene a fixed id,
// and every texture load a promise the test settles (a GPU-free activation: without a renderer,
// getPMREMTexture returns the source texture as is)
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
vi.mock(import('../../kernel/assets/Texture'), async (importOriginal) => ({
  ...(await importOriginal()),
  getTexture: () => undefined,
  loadTextureAsync: ((props: { fileName: unknown }) =>
    new Promise<THREE.Texture>((resolve, reject) => {
      m.loads.push({ fileName: props.fileName, resolve, reject });
    })) as never,
}));

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
  // S1 (p615): the second update merges into the old definition and is dropped when the
  // activation lands
  it.fails('keeps a value change made before the new texture has loaded', async () => {
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
});

describe('a sky box texture that fails to load', () => {
  // S2 (p615): the debug env loads with throwOnError, so the load rejects, and with it the
  // activation (and the scene load that awaits it in the feature's `created` hook)
  it.fails('shows the sky box with a black base instead of rejecting', async () => {
    registerSkyBox({ id: 'broken', base: equirect('missing.png') }, 'scene');
    // The expectation first, so a rejection is never unhandled
    const result = expect(setActiveSkyBox('broken')).resolves.toMatchObject({ id: 'broken' });
    m.loads[0].reject(new Error('Could not load "missing.png"'));
    await result;
    expect(getActiveSkyBox()?.textures.source).toBeNull();
    expect(m.rootScene.backgroundNode).not.toBeNull();
  });
});
