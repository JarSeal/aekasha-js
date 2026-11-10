import { beforeAll, describe, expect, test, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { ECSWorld } from '../ecs/ECS';
import { ComponentType } from '../ecs/ECSCoreComponents';
import { getAssetOwners, getCellOwnerKey, setAssetOwnerScene } from '../assets/AssetOwners';
import { getGeometry, getGeometryRegistry, saveBufferGeometry } from '../assets/Geometry';
import { getMaterial } from '../assets/Material';
import { saveTexture } from '../assets/Texture';
import { createRootScene } from './Scene';
import { createSceneObject3Ds, loadSceneAssetsAsync } from './SceneDataLoader';

// The scene data loader on a part of a scene's data with an owner key (p353 Phase 3: a streaming
// cell's assets and entities), on the real registries

const lerror = vi.hoisted(() => vi.fn());
vi.mock(import('../../utils/Logger'), async (importOriginal) => ({
  ...(await importOriginal()),
  lerror,
}));

let world: ECSWorld;
beforeAll(() => {
  world = new ECSWorld();
  createRootScene();
});

const CELL = getCellOwnerKey('loaderWorld', 7);

describe('loadSceneAssetsAsync', () => {
  test('registers everything in the owner key, also what it creates after its awaits', async () => {
    setAssetOwnerScene('loaderWorld');
    const shared = saveTexture(new THREE.Texture(), 'loaderShared');
    const assets = await loadSceneAssetsAsync(
      {
        textures: ['loaderShared'],
        materials: [{ id: 'loaderMat', type: 'BASIC', params: { map: 'loaderShared' } }],
        geometries: [{ id: 'loaderBox', type: 'BOX' }],
      },
      CELL
    );
    // Created after the textures' await, still the cell's
    const material = getMaterial('loaderMat') as THREE.MeshBasicMaterial;
    expect(assets.materials.loaderMat).toBe(material);
    expect(material.map).toBe(shared);
    expect(getAssetOwners(material)).toEqual([CELL]);
    expect(getAssetOwners(getGeometry('loaderBox')!)).toEqual([CELL]);
    // A cache hit adds the key
    expect(getAssetOwners(shared)).toEqual(['loaderWorld', CELL]);
    setAssetOwnerScene(null);
  });

  test('without an owner key the scene owns them', async () => {
    setAssetOwnerScene('loaderWorld');
    await loadSceneAssetsAsync({ geometries: [{ id: 'loaderSceneBox', type: 'BOX' }] });
    expect(getAssetOwners(getGeometry('loaderSceneBox')!)).toEqual(['loaderWorld']);
    setAssetOwnerScene(null);
  });
});

describe('loadSceneAssetsAsync with MERGED geometries (p371 D2)', () => {
  test('merges after the other geometries, in the owner key, taking no ref on the parts', async () => {
    setAssetOwnerScene('loaderWorld');
    const imported = saveBufferGeometry(new THREE.BoxGeometry(), { id: 'loaderImport/Piece' });
    const assets = await loadSceneAssetsAsync(
      {
        geometries: [
          // Listed before its part: still merged after it
          {
            id: 'loaderMerged',
            type: 'MERGED',
            params: {
              parts: [
                { geo: 'loaderMergeBox' },
                { geo: 'loaderImport/Piece', position: { x: 2 } },
                { geo: 'loaderImport/Piece', position: { x: -2 }, scale: { x: -1, y: 1, z: 1 } },
              ],
            },
          },
          { id: 'loaderMergeBox', type: 'BOX' },
        ],
      },
      CELL
    );
    const merged = getGeometry('loaderMerged')!;
    expect(assets.geometries.loaderMerged).toBe(merged);
    expect(merged.userData.mergeParts).toHaveLength(3);
    expect(getAssetOwners(merged)).toEqual([CELL]);
    // The parts are only read: no refs, their owners as they were
    expect(getGeometryRegistry().loaderMergeBox.count).toBe(0);
    expect(getGeometryRegistry()['loaderImport/Piece'].count).toBe(0);
    expect(getAssetOwners(imported)).toEqual(['loaderWorld']);
    setAssetOwnerScene(null);
  });

  test('logs a merge that fails and leaves it out, loading the rest', async () => {
    setAssetOwnerScene('loaderWorld');
    lerror.mockClear();
    const assets = await loadSceneAssetsAsync({
      geometries: [
        { id: 'loaderBadMerge', type: 'MERGED', params: { parts: [{ geo: 'loaderNoPart' }] } },
        { id: 'loaderAfterBadMerge', type: 'BOX' },
      ],
    });
    expect(assets.geometries.loaderBadMerge).toBeUndefined();
    expect(getGeometry('loaderBadMerge')).toBeUndefined();
    expect(assets.geometries.loaderAfterBadMerge).toBeDefined();
    expect(lerror).toHaveBeenCalledTimes(1);
    expect(String(lerror.mock.calls[0][0])).toMatch(/loaderBadMerge/);
    setAssetOwnerScene(null);
  });
});

describe('createSceneObject3Ds', () => {
  test('creates the lights, then the meshes, returning their ids; skips a mesh it can’t make', () => {
    const ids = createSceneObject3Ds({
      lights: [{ lightProps: { type: 'POINT', position: { x: 1, y: 2, z: 3 } } }],
      meshes: [
        { props: { appId: 'loaderMesh', geo: { type: 'BOX' }, mat: { type: 'BASIC' } } },
        { props: { appId: 'loaderBroken', geo: 'noSuchGeometry', mat: { type: 'BASIC' } } },
      ],
    });
    expect(ids).toHaveLength(2);
    expect(world.getComponent(ids[0], ComponentType.OBJECT3D)?.value).toBeInstanceOf(
      THREE.PointLight
    );
    expect(world.getComponent(ids[1], ComponentType.OBJECT3D)?.value).toBeInstanceOf(THREE.Mesh);
    for (const id of ids) world.deleteEntity(id);
  });
});
