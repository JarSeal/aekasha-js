import { beforeAll, describe, expect, test, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { ECSWorld, getEntityIdByAppId } from '../ecs/ECS';
import { ComponentType } from '../ecs/ECSCoreComponents';
import { getAssetOwners, getCellOwnerKey, setAssetOwnerScene } from '../assets/AssetOwners';
import { getGeometry, getGeometryRegistry, saveBufferGeometry } from '../assets/Geometry';
import { getMaterial } from '../assets/Material';
import { saveTexture } from '../assets/Texture';
import { createCameraEntity, getActiveCameraId } from '../camera/Camera';
import { createRootScene, type SceneData } from './Scene';
import {
  createCameras,
  createSceneObject3Ds,
  loadSceneAssetsAsync,
  type SceneObject3DLists,
} from './SceneDataLoader';

// The scene data loader on a part of a scene's data with an owner key (p353 Phase 3: a streaming
// cell's assets and entities), on the real registries

// The canvas's size (the window's, read by createCameraEntity)
vi.hoisted(() => vi.stubGlobal('window', { innerWidth: 1600, innerHeight: 900 }));

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

// docs/issues/_DONE_i060_entity-persistent-flag-not-applied.md
describe('persistent JSON entities', () => {
  const countAppId = (appId: string) =>
    Array.from(world.getStorage(ComponentType.APP_ID)).filter(([, data]) => data.id === appId)
      .length;

  test('a later load reuses a persistent light and mesh, and creates the others again', () => {
    const data: SceneObject3DLists = {
      lights: [
        { lightProps: { type: 'POINT', appId: 'keptLamp' }, entityOpts: { persistent: true } },
      ],
      meshes: [
        {
          props: { appId: 'keptBox', geo: { type: 'BOX' }, mat: { type: 'BASIC' } },
          entityOpts: { persistent: true },
        },
        { props: { appId: 'sceneBox', geo: { type: 'BOX' }, mat: { type: 'BASIC' } } },
      ],
    };
    const [lampId, keptBoxId] = createSceneObject3Ds(data);
    expect(world.hasComponent(lampId, ComponentType.PERSISTENT)).toBe(true);
    expect(world.hasComponent(keptBoxId, ComponentType.PERSISTENT)).toBe(true);

    // The scene switch, then the next visit's load
    world.clearNonPersistent();
    const ids = createSceneObject3Ds(data);
    expect(ids).toHaveLength(1);
    expect(world.getComponent(ids[0], ComponentType.APP_ID)?.id).toBe('sceneBox');
    expect(getEntityIdByAppId('keptLamp')).toBe(lampId);
    expect(getEntityIdByAppId('keptBox')).toBe(keptBoxId);
    expect(countAppId('keptLamp')).toBe(1);
    expect(countAppId('keptBox')).toBe(1);
    for (const id of [lampId, keptBoxId, ids[0]]) world.deleteEntity(id);
  });

  test('a live entity with the id that isn’t persistent is no reason to skip', () => {
    const plain = world.createEntity({ appId: 'plainLamp' });
    const ids = createSceneObject3Ds({
      lights: [
        { lightProps: { type: 'POINT', appId: 'plainLamp' }, entityOpts: { persistent: true } },
      ],
    });
    expect(ids).toHaveLength(1);
    for (const id of [plain, ids[0]]) world.deleteEntity(id);
  });

  test('a later load reuses a persistent camera and makes it active again', () => {
    const data = {
      id: 'loaderCameras',
      cameras: [
        {
          camProps: { type: 'PERSPECTIVE', appId: 'keptCam', active: true },
          entityOpts: { persistent: true },
        },
      ],
    } as SceneData;
    createCameras(data);
    const keptCamId = getEntityIdByAppId('keptCam')!;
    expect(getActiveCameraId()).toBe(keptCamId);

    // Another scene's camera takes over, then the switch back
    const otherCamId = createCameraEntity({ type: 'PERSPECTIVE', active: true });
    expect(getActiveCameraId()).toBe(otherCamId);
    world.clearNonPersistent();
    createCameras(data);
    expect(getActiveCameraId()).toBe(keptCamId);
    expect(countAppId('keptCam')).toBe(1);
    world.deleteEntity(keptCamId);
  });
});
