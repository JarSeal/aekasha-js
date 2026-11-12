import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { initEnvironment } from '../config/Config';
import { createRootScene } from '../scene/Scene';
import { getAssetOwners, runInAssetOwnerScope, setAssetOwnerScene } from './AssetOwners';
import {
  applyTexOpts,
  getTexture,
  loadTextureAsync,
  saveLoadedTexture,
  saveTexture,
} from './Texture';

// The warning log is a stand-in
const fns = vi.hoisted(() => ({ lwarn: vi.fn() }));
vi.mock(import('../../utils/Logger'), async (importOriginal) => ({
  ...(await importOriginal()),
  lwarn: fns.lwarn,
}));

beforeAll(() => {
  createRootScene();
  initEnvironment({ search: '?isDebug=true', env: { VITE_APP_ENV: 'development' } });
});

beforeEach(() => {
  fns.lwarn.mockClear();
});

describe('saveTexture', () => {
  test('registers a texture under its id, or its uuid without one', () => {
    const texture = new THREE.Texture();
    expect(saveTexture(texture, 'textureTestSaved')).toBe(texture);
    expect(getTexture('textureTestSaved')).toBe(texture);
    expect(texture.userData.id).toBe('textureTestSaved');

    const unnamed = new THREE.Texture();
    expect(saveTexture(unnamed)).toBe(unnamed);
    expect(getTexture(unnamed.uuid)).toBe(unnamed);
  });

  test('returns the registered texture for a taken id, and warns in the debug env', () => {
    const registered = saveTexture(new THREE.Texture(), 'textureTestTaken');

    expect(saveTexture(registered, 'textureTestTaken')).toBe(registered);
    expect(fns.lwarn).not.toHaveBeenCalled();

    const other = new THREE.Texture();
    expect(saveTexture(other, 'textureTestTaken')).toBe(registered);
    expect(getTexture('textureTestTaken')).toBe(registered);
    expect(other.userData.id).toBeUndefined();
    expect(fns.lwarn).toHaveBeenCalledWith(expect.stringContaining('"textureTestTaken"'));
  });
});

describe('saveLoadedTexture', () => {
  test('keeps the first of two parallel loads of an id, disposes the other, and warns nothing', () => {
    const first = saveLoadedTexture(new THREE.Texture(), 'textureTestParallel');
    const second = new THREE.Texture();
    const dispose = vi.spyOn(second, 'dispose');

    expect(saveLoadedTexture(second, 'textureTestParallel')).toBe(first);
    expect(dispose).toHaveBeenCalled();
    expect(fns.lwarn).not.toHaveBeenCalled();
  });
});

describe('loadTextureAsync', () => {
  test("registers the texture for the owner scope of its call, after the load's awaits", async () => {
    // A cube texture is three's CubeTextureLoader alone: resolved a few ticks later
    const loadAsync = vi
      .spyOn(THREE.CubeTextureLoader.prototype, 'loadAsync')
      .mockImplementation(async () => {
        await Promise.resolve();
        return new THREE.CubeTexture();
      });
    const faces = ['px', 'nx', 'py', 'ny', 'pz', 'nz'].map((face) => `${face}.png`);
    // Node has no document.baseURI to resolve the files against
    vi.stubGlobal('document', { baseURI: 'https://example.test/' });
    setAssetOwnerScene('textureTestWorld');

    const inCell = runInAssetOwnerScope('textureTestWorld#1', () =>
      loadTextureAsync({ id: 'textureTestCellCube', fileName: faces })
    );
    const inScene = loadTextureAsync({ id: 'textureTestSceneCube', fileName: faces });
    await Promise.all([inCell, inScene]);

    expect(getAssetOwners(getTexture('textureTestCellCube')!)).toEqual(['textureTestWorld#1']);
    expect(getAssetOwners(getTexture('textureTestSceneCube')!)).toEqual(['textureTestWorld']);
    setAssetOwnerScene(null);
    vi.unstubAllGlobals();
    loadAsync.mockRestore();
  });
});

describe('applyTexOpts', () => {
  test('applies every defined value, falsy ones too, and the UV transform', () => {
    const texture = new THREE.Texture();
    texture.anisotropy = 4;
    applyTexOpts(texture, {
      anisotropy: 1,
      flipY: false,
      generateMipmaps: false,
      rotation: 0.5,
      repeat: [4, 2],
      offset: [0.25, 0],
      center: [0.5, 0.5],
      wrapS: THREE.RepeatWrapping,
    });
    expect(texture.anisotropy).toBe(1);
    expect(texture.flipY).toBe(false);
    expect(texture.generateMipmaps).toBe(false);
    expect(texture.rotation).toBe(0.5);
    expect(texture.repeat.toArray()).toEqual([4, 2]);
    expect(texture.offset.toArray()).toEqual([0.25, 0]);
    expect(texture.center.toArray()).toEqual([0.5, 0.5]);
    expect(texture.wrapS).toBe(THREE.RepeatWrapping);
  });

  test('"MAX" anisotropy is 16 before the renderer is initialised', () => {
    const texture = new THREE.Texture();
    applyTexOpts(texture, { anisotropy: 'MAX' });
    expect(texture.anisotropy).toBe(16);
  });

  test('leaves the flip and premultiplied alpha a compressed texture has baked in', () => {
    const texture = new THREE.CompressedTexture([], 4, 4);
    const { flipY, premultiplyAlpha } = texture;
    applyTexOpts(texture, { flipY: !flipY, premultiplyAlpha: !premultiplyAlpha });
    expect(texture.flipY).toBe(flipY);
    expect(texture.premultiplyAlpha).toBe(premultiplyAlpha);
  });

  test('marks a texture with data for upload again, and one without none', () => {
    const loaded = new THREE.Texture();
    loaded.needsUpdate = true;
    const version = loaded.version;
    applyTexOpts(loaded, { flipY: false });
    expect(loaded.version).toBe(version + 1);

    const empty = new THREE.Texture();
    applyTexOpts(empty, { flipY: false });
    expect(empty.version).toBe(0);
  });
});
