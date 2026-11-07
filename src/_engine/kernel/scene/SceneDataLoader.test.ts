import { beforeAll, describe, expect, test } from 'vitest';
import * as THREE from 'three/webgpu';
import { ECSWorld } from '../ecs/ECS';
import { ComponentType } from '../ecs/ECSCoreComponents';
import { getAssetOwners, getCellOwnerKey, setAssetOwnerScene } from '../assets/AssetOwners';
import { getGeometry } from '../assets/Geometry';
import { getMaterial } from '../assets/Material';
import { saveTexture } from '../assets/Texture';
import { createRootScene } from './Scene';
import { createSceneObject3Ds, loadSceneAssetsAsync } from './SceneDataLoader';

// The scene data loader on a part of a scene's data with an owner key (p353 Phase 3: a streaming
// cell's assets and entities), on the real registries

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
