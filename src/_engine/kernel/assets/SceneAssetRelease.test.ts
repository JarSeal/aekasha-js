import { beforeAll, describe, expect, test, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { createRootScene, getRootScene } from '../scene/Scene';
import {
  getAssetOwners,
  getCellOwnerKey,
  retagAssetOwner,
  runInAssetOwnerScope,
  setAssetOwnerScene,
} from './AssetOwners';
import { decGeometryRef, getGeometry, incGeometryRef, saveBufferGeometry } from './Geometry';
import { releaseCellOwnedAssets, releaseSceneOwnedAssets } from './SceneAssetRelease';
import { deleteTexture, getTexture, saveTexture } from './Texture';

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

describe("releaseSceneOwnedAssets and a texture that takes others with it (a bake's outputs)", () => {
  test('skips a texture an earlier one of the release deleted, without a warning', () => {
    setAssetOwnerScene('releaseBakeScene');
    const first = saveTexture(new THREE.Texture(), 'releaseBake.albedoRough');
    saveTexture(new THREE.Texture(), 'releaseBake.normalHeight');
    setAssetOwnerScene(null);
    // As `bakeTexture`: disposing one output disposes the bake, which deletes the others
    first.addEventListener('dispose', () => deleteTexture('releaseBake.normalHeight'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const released = releaseSceneOwnedAssets('releaseBakeScene');

    expect(released.textures).toEqual(['releaseBake.albedoRough']);
    expect(getTexture('releaseBake.normalHeight')).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('releaseCellOwnedAssets', () => {
  const CELL_1 = getCellOwnerKey('cellWorld', 1);
  const CELL_2 = getCellOwnerKey('cellWorld', 2);

  /** A geometry registered in a cell's owner scope */
  const saveCellGeometry = (owner: string, id: string) =>
    runInAssetOwnerScope(owner, () => saveBufferGeometry(new THREE.BufferGeometry(), { id }));

  test('frees what the cell alone holds and nothing uses', () => {
    setAssetOwnerScene('cellWorld');
    saveCellGeometry(CELL_1, 'cellOnly');
    runInAssetOwnerScope(CELL_1, () => saveTexture(new THREE.Texture(), 'cellOnlyTexture'));
    const released = releaseCellOwnedAssets('cellWorld', 1);
    expect(released.geometries).toEqual(['cellOnly']);
    expect(released.textures).toEqual(['cellOnlyTexture']);
    expect(getGeometry('cellOnly')).toBeUndefined();
    setAssetOwnerScene(null);
  });

  test('leaves an asset another cell or the scene holds too, without the cell', () => {
    setAssetOwnerScene('cellWorld');
    const shared = saveCellGeometry(CELL_1, 'cellShared');
    runInAssetOwnerScope(CELL_2, () => retagAssetOwner(shared));
    const base = saveBufferGeometry(new THREE.BufferGeometry(), { id: 'cellBase' });
    runInAssetOwnerScope(CELL_1, () => retagAssetOwner(base));

    expect(releaseCellOwnedAssets('cellWorld', 1).geometries).toEqual([]);
    expect(getAssetOwners(shared)).toEqual([CELL_2]);
    expect(getAssetOwners(base)).toEqual(['cellWorld']);
    expect(releaseCellOwnedAssets('cellWorld', 2).geometries).toEqual(['cellShared']);
    expect(getGeometry('cellBase')).toBe(base);
    setAssetOwnerScene(null);
  });

  test("keeps an asset in use with the cell, for its next release or its scene's", () => {
    setAssetOwnerScene('cellWorld');
    const inUse = saveCellGeometry(CELL_1, 'cellInUse');
    incGeometryRef('cellInUse');

    expect(releaseCellOwnedAssets('cellWorld', 1).geometries).toEqual([]);
    expect(getAssetOwners(inUse)).toEqual([CELL_1]);
    expect(releaseSceneOwnedAssets('cellWorld').geometries).not.toContain('cellInUse');
    expect(getAssetOwners(inUse)).toEqual([CELL_1]);

    // Its last ref frees it (Geometry.ts), whoever owns it
    decGeometryRef('cellInUse');
    expect(getGeometry('cellInUse')).toBeUndefined();
    setAssetOwnerScene(null);
  });

  test("a layer's release leaves what the cell's other layers hold (p353 Phase 5 D10)", () => {
    setAssetOwnerScene('cellWorld');
    const farKey = getCellOwnerKey('cellWorld', 1, 'far');
    const both = saveCellGeometry(CELL_1, 'cellNearAndFar');
    runInAssetOwnerScope(farKey, () => retagAssetOwner(both));
    saveCellGeometry(farKey, 'cellFarOnly');
    saveCellGeometry(CELL_1, 'cellNearOnly');

    expect(releaseCellOwnedAssets('cellWorld', 1, 'far').geometries).toEqual(['cellFarOnly']);
    expect(getAssetOwners(both)).toEqual([CELL_1]);
    expect(getGeometry('cellNearOnly')).toBeDefined();
    expect(releaseCellOwnedAssets('cellWorld', 1).geometries.sort()).toEqual([
      'cellNearAndFar',
      'cellNearOnly',
    ]);
    setAssetOwnerScene(null);
  });

  test("a scene's release frees what its cells alone hold, not another scene's cells'", () => {
    setAssetOwnerScene('cellWorld');
    saveCellGeometry(CELL_1, 'cellLeftover');
    saveCellGeometry(getCellOwnerKey('cellWorlds', 1), 'otherSceneCell');
    expect(releaseSceneOwnedAssets('cellWorld').geometries).toEqual(['cellLeftover']);
    expect(getGeometry('otherSceneCell')).toBeDefined();
    setAssetOwnerScene(null);
  });
});
