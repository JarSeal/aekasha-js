import { beforeAll, describe, expect, test } from 'vitest';
import * as THREE from 'three/webgpu';
import { getAssetOwners, getCellOwnerKey } from '../../kernel/assets/AssetOwners';
import { getMaterial } from '../../kernel/assets/Material';
import { countReleasedAssets, releaseCellOwnedAssets } from '../../kernel/assets/SceneAssetRelease';
import { ECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import { createRootScene } from '../../kernel/scene/Scene';
import { packCellKey } from '../../utils/CellKey';
import {
  createStreamingRuntime,
  decideStreamingCells,
  getStreamingCellEntityIds,
  pumpStreamingCells,
  type StreamingBudgets,
} from './StreamingCells';
import type { StreamingCellContext } from './StreamingContent';
import { createStreamingDataContent } from './StreamingDataContent';
import type { StreamingManifest } from './StreamingManifest';
import { resolveStreamingSettings } from './StreamingSettings';

// A scene's JSON cell content (p353 Phase 3 D7, Phase 5 D7-D9) on the real kernel: the default world and the
// asset registries, a handmade manifest. A bare world runs none of the kernel's component hooks,
// so a deleted mesh keeps its refs here: the cell's material outlives its release (the ref counts'
// part is Phase 2's, tested with the release).

let world: ECSWorld;
beforeAll(() => {
  world = new ECSWorld();
  createRootScene();
});

const A = packCellKey(0, 0, 0);
const B = packCellKey(1, 0, 0);

const mesh = (appId: string, x: number, mat = 'dcMat') => ({
  props: { appId, geo: { type: 'BOX' as const }, mat, position: { x, y: 0, z: 10 } },
});

const createManifest = (sceneId: string): StreamingManifest => ({
  cellSize: 64,
  meshes: [
    ...Array.from({ length: 10 }, (_, i) => mesh(`${sceneId}-m${i}`, 5 + i)),
    // In both cells: oversized
    mesh(`${sceneId}-bridge`, 64, 'dcSharedMat'),
  ],
  lights: [{ lightProps: { type: 'POINT', position: { x: 20, y: 2, z: 20 } } }],
  farMeshes: [
    // A group of three, and a mesh of its own
    {
      props: { geo: `${sceneId}-farGeo`, mat: `${sceneId}-farMat`, castShadow: true },
      instances: [
        { position: { x: 5, y: 0, z: 10 } },
        { position: { x: 6, y: 0, z: 10 }, rotation: { y: 1 } },
        { position: { x: 7, y: 0, z: 10 }, scale: { x: 2, y: 2, z: 2 } },
      ],
    },
    { props: { geo: { type: 'BOX' }, mat: `${sceneId}-farMat`, position: { x: 9, y: 0, z: 9 } } },
  ],
  assets: {
    textures: [],
    materials: [
      { id: `${sceneId}-mat`, type: 'BASIC' },
      { id: 'dcSharedMat', type: 'BASIC' },
      { id: `${sceneId}-farMat`, type: 'BASIC' },
    ],
    geometries: [{ id: `${sceneId}-farGeo`, type: 'BOX' }],
    importedAssets: [],
  },
  cells: {
    [String(A)]: {
      meshes: Array.from({ length: 10 }, (_, i) => i),
      lights: [0],
      materials: [0],
      bounds: [0, 0, 64, 64],
      bytesEstimate: 0,
      far: { meshes: [0, 1], materials: [2], geometries: [0], bytesEstimate: 0 },
      kept: { meshes: [10], materials: [1], bytesEstimate: 0 },
    },
    [String(B)]: {
      bounds: [64, 0, 128, 64],
      bytesEstimate: 0,
      kept: { meshes: [10], materials: [1], bytesEstimate: 0 },
    },
  },
});

/** The manifest with its meshes on its own material id */
const manifestFor = (sceneId: string) => {
  const manifest = createManifest(sceneId);
  for (const entry of manifest.meshes.slice(0, 10)) entry.props.mat = `${sceneId}-mat`;
  return manifest;
};

const ctxFor = (cellKey: number) => ({ world, cellKey }) as unknown as StreamingCellContext;

describe('createStreamingDataContent', () => {
  test('a layer’s units: its assets, then its entries a few a unit (the first waiting)', () => {
    const content = createStreamingDataContent('dcUnits', manifestFor('dcUnits'));
    const units = content.getUnits(A, 'NEAR');
    expect(units.map((unit) => unit.waits)).toEqual([false, true, false]);
    expect(content.getUnits(A, 'NEAR')).toBe(units);
    expect(content.getUnits(A, 'NEAR_AND_FAR').map((unit) => unit.waits)).toEqual([false, true]);
    expect(content.getUnits(A, 'FAR').map((unit) => unit.content.loadedAt)).toEqual(['FAR', 'FAR']);
    expect(content.getUnits(B, 'NEAR')).toEqual([]);
    expect(content.getUnits(B, 'FAR')).toEqual([]);
    expect(content.getUnits(packCellKey(9, 0, 9), 'NEAR')).toEqual([]);
  });

  test('a far layer: a group is one InstancedMesh entity of its instances, the rest meshes', async () => {
    const sceneId = 'dcFar';
    const content = createStreamingDataContent(sceneId, manifestFor(sceneId));
    const [assets, entries] = content.getUnits(A, 'FAR');
    await assets.content.load(ctxFor(A));
    const material = getMaterial(`${sceneId}-farMat`);
    expect(material && getAssetOwners(material)).toEqual([getCellOwnerKey(sceneId, A, 'far')]);
    const [groupId, ownId] = entries.content.load(ctxFor(A)) as number[];
    const group = world.getComponent(groupId, ComponentType.OBJECT3D)?.value as THREE.InstancedMesh;
    expect(group.isInstancedMesh).toBe(true);
    expect(group.count).toBe(3);
    expect(group.castShadow).toBe(true);
    expect(group.userData.entityId).toBe(groupId);
    const matrix = new THREE.Matrix4();
    group.getMatrixAt(2, matrix);
    expect(new THREE.Vector3().setFromMatrixScale(matrix).x).toBeCloseTo(2);
    // Over every instance (their boxes, the one scaled 2× reaching to x = 9)
    expect(group.boundingSphere?.center.x).toBeGreaterThan(5.5);
    expect(group.boundingSphere?.radius).toBeGreaterThan(2);
    expect(world.getComponent(ownId, ComponentType.OBJECT3D)?.value).toBeInstanceOf(THREE.Mesh);
  });

  test('a shared mesh: the first holder creates it, the last to unload deletes it', async () => {
    const content = createStreamingDataContent('dcShared', manifestFor('dcShared'));
    // Its material first: the kept layer's asset unit
    await content.getUnits(A, 'NEAR_AND_FAR')[0].content.load(ctxFor(A));
    const sharedOf = (cellKey: number) => {
      const units = content.getUnits(cellKey, 'NEAR_AND_FAR');
      return units[units.length - 1].content;
    };
    const fromA = sharedOf(A).load(ctxFor(A)) as number[];
    expect(fromA).toHaveLength(1);
    expect(sharedOf(B).load(ctxFor(B))).toEqual([]);
    sharedOf(A).unload?.(fromA, ctxFor(A));
    expect(world.isAlive(fromA[0])).toBe(true);
    sharedOf(B).unload?.([], ctxFor(B));
    expect(world.isAlive(fromA[0])).toBe(false);
    expect(content.shared.size).toBe(0);
  });

  test('through the machine: a cell loads its assets in its key, then its entities; its unload frees them', async () => {
    const sceneId = 'dcMachine';
    const rt = createStreamingRuntime(
      sceneId,
      resolveStreamingSettings({ cellSize: 64, rings: { resident: 0, nearby: 0, far: 0 } }),
      world,
      () => 0,
      (cellKey, layer) => countReleasedAssets(releaseCellOwnedAssets(sceneId, cellKey, layer))
    );
    rt.dataContent = createStreamingDataContent(sceneId, manifestFor(sceneId)).getUnits;
    const budgets: StreamingBudgets = { maxConcurrentLoads: 4, maxCreateMsPerFrame: 1000 };

    decideStreamingCells(rt, 32, 32);
    pumpStreamingCells(rt, budgets);
    await new Promise((resolve) => setTimeout(resolve, 0));
    pumpStreamingCells(rt, budgets);
    const cell = rt.cells.get(A);
    expect(cell?.phase).toBe('LOADED');
    // 10 meshes and the light, and the bridge (its kept layer)
    const ids = cell ? getStreamingCellEntityIds(cell) : [];
    expect(ids).toHaveLength(12);
    const material = getMaterial(`${sceneId}-mat`);
    expect(material && getAssetOwners(material)).toEqual([getCellOwnerKey(sceneId, A)]);
    const objects = ids.map((id) => world.getComponent(id, ComponentType.OBJECT3D)?.value);
    expect(objects.filter((object) => object instanceof THREE.PointLight)).toHaveLength(1);

    decideStreamingCells(rt, 5000, 5000);
    pumpStreamingCells(rt, budgets);
    expect(rt.cells.has(A)).toBe(false);
    expect(ids.every((id) => !world.isAlive(id))).toBe(true);
    // Its near and kept layers'
    expect(rt.stats.assetReleases).toBe(2);
  });
});
