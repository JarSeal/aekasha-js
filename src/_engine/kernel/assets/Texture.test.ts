import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { initEnvironment } from '../config/Config';
import { createRootScene } from '../scene/Scene';
import { getTexture, saveLoadedTexture, saveTexture } from './Texture';

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
