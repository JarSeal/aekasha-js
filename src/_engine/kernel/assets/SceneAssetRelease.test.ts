import { beforeAll, describe, expect, test } from 'vitest';
import * as THREE from 'three/webgpu';
import { createRootScene, getRootScene } from '../scene/Scene';
import { setAssetOwnerScene } from './AssetOwners';
import { releaseSceneOwnedAssets } from './SceneAssetRelease';
import { getTexture, saveTexture } from './Texture';

beforeAll(() => {
  createRootScene();
});

describe('releaseSceneOwnedAssets', () => {
  test("keeps the root scene's background texture, and releases it once it isn't", () => {
    setAssetOwnerScene('releaseTestScene');
    const texture = saveTexture(new THREE.Texture(), 'releaseTestBackground');
    setAssetOwnerScene(null);
    getRootScene()!.background = texture;

    expect(releaseSceneOwnedAssets('releaseTestScene').textures).toEqual([]);
    expect(getTexture('releaseTestBackground')).toBe(texture);

    getRootScene()!.background = null;
    expect(releaseSceneOwnedAssets('releaseTestScene').textures).toEqual(['releaseTestBackground']);
    expect(getTexture('releaseTestBackground')).toBeUndefined();
  });
});
