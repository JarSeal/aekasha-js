import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { createRootScene, getRootScene } from '../scene/Scene';
import { addSceneHooks } from '../scene/SceneHooks';
import { setAppData } from '../scene/AppData';
import {
  createMaterial,
  decMaterialRef,
  incMaterialRef,
  loadTslMaterialFileAsync,
} from './Material';
import { getTexture, saveTexture } from './Texture';

// The warning log is a stand-in
const fns = vi.hoisted(() => ({ lwarn: vi.fn() }));
vi.mock(import('../../utils/Logger'), async (importOriginal) => ({
  ...(await importOriginal()),
  lwarn: fns.lwarn,
}));

beforeAll(() => {
  createRootScene();
});

describe('createMaterial', () => {
  test('gives a TSL texture input with an unregistered id one white texel', async () => {
    setAppData({
      json: { scenes: {} },
      sceneFiles: {},
      tslMaterialFiles: {
        materialTestTsl: async () => ({
          colorNode: (inputs: Record<string, unknown>) => inputs.tex,
        }),
      },
      postFxFiles: {},
    });
    expect(await loadTslMaterialFileAsync('materialTestTsl')).toBe(true);

    const mat = createMaterial({
      id: 'materialTestTsl',
      type: 'BASICNODEMATERIAL',
      tslFile: 'materialTestTsl.tsl.ts',
      nodes: { colorNode: { tex: 'materialTestNoTexture' } },
    });

    const node = mat.userData.uniforms.colorNode_tex as { isTextureNode: boolean; value: unknown };
    expect(node.isTextureNode).toBe(true);
    const texture = node.value as THREE.DataTexture;
    expect(texture).toBeInstanceOf(THREE.DataTexture);
    expect([texture.image.width, texture.image.height]).toEqual([1, 1]);
    expect([...(texture.image.data as Uint8Array)]).toEqual([255, 255, 255, 255]);
    expect(fns.lwarn).toHaveBeenCalledWith(expect.stringContaining('materialTestNoTexture'));
  });
});

describe('decMaterialRef', () => {
  // A registered texture in the map of a registered material holding one ref
  const createTexturedMaterial = (name: string) => {
    const texture = saveTexture(new THREE.Texture(), `${name}Texture`);
    createMaterial({ id: `${name}Material`, type: 'BASIC', params: { map: `${name}Texture` } });
    incMaterialRef(`${name}Material`);
    return texture;
  };

  afterEach(() => {
    getRootScene()!.background = null;
  });

  test('releases a registered texture with the last material holding it', () => {
    createTexturedMaterial('materialTestReleased');
    decMaterialRef('materialTestReleasedMaterial');
    expect(getTexture('materialTestReleasedTexture')).toBeUndefined();
  });

  test("keeps the root scene's background texture", () => {
    const texture = createTexturedMaterial('materialTestBackground');
    getRootScene()!.background = texture;
    decMaterialRef('materialTestBackgroundMaterial');
    expect(getTexture('materialTestBackgroundTexture')).toBe(texture);
  });

  test('keeps a texture a retainedTextures scene hook names', () => {
    const texture = createTexturedMaterial('materialTestRetained');
    const removeHooks = addSceneHooks({ retainedTextures: () => [texture] });
    decMaterialRef('materialTestRetainedMaterial');
    removeHooks();
    expect(getTexture('materialTestRetainedTexture')).toBe(texture);
  });
});
