import { beforeAll, describe, expect, test } from 'vitest';
import * as THREE from 'three/webgpu';
import { getAssetOwners, getCellOwnerKey } from '../../kernel/assets/AssetOwners';
import { getMaterial } from '../../kernel/assets/Material';
import { countReleasedAssets, releaseCellOwnedAssets } from '../../kernel/assets/SceneAssetRelease';
import { ECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import type { MeshProps } from '../../kernel/mesh/Mesh';
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

const mesh = (appId: string, x: number, mat = 'dcMat'): { props: MeshProps } => ({
  props: { appId, geo: { type: 'BOX' }, mat, position: { x, y: 0, z: 10 } },
});

/** The near meshes the far group by entries names: a rotation, a quaternion over a rotation and
 * a scale (p377 D3) */
const transformed = (meshes: ReturnType<typeof mesh>[]) => {
  meshes[1].props = { ...meshes[1].props, rotation: { y: 1 } };
  meshes[2].props = {
    ...meshes[2].props,
    rotation: { x: 1 },
    quaternion: { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 },
    scale: { x: 2, y: 2, z: 2 },
  };
  return meshes;
};

const createManifest = (sceneId: string): StreamingManifest => ({
  cellSize: 64,
  meshes: [
    ...transformed(Array.from({ length: 10 }, (_, i) => mesh(`${sceneId}-m${i}`, 5 + i))),
    // In both cells: oversized
    mesh(`${sceneId}-bridge`, 64, 'dcSharedMat'),
  ],
  lights: [{ lightProps: { type: 'POINT', position: { x: 20, y: 2, z: 20 } } }],
  farMeshes: [
    // A group of three by its near entries, a mesh of its own, and a group of two by the
    // deprecated instances (p377 D3: still drawn)
    {
      props: { geo: `${sceneId}-farGeo`, mat: `${sceneId}-farMat`, castShadow: true },
      entries: [0, 1, 2],
    },
    { props: { geo: { type: 'BOX' }, mat: `${sceneId}-farMat`, position: { x: 9, y: 0, z: 9 } } },
    {
      props: { geo: `${sceneId}-farGeo`, mat: `${sceneId}-farMat` },
      instances: [
        { position: { x: 20, y: 0, z: 10 } },
        { position: { x: 21, y: 0, z: 10 }, rotation: { y: 1 }, scale: { x: 3, y: 3, z: 3 } },
      ],
    },
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
      far: { meshes: [0, 1, 2], materials: [2], geometries: [0], bytesEstimate: 0 },
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

  test('a far layer: a group is one InstancedMesh entity of its near entries, the rest meshes', async () => {
    const sceneId = 'dcFar';
    const manifest = manifestFor(sceneId);
    const content = createStreamingDataContent(sceneId, manifest);
    const [assets, entries] = content.getUnits(A, 'FAR');
    await assets.content.load(ctxFor(A));
    const material = getMaterial(`${sceneId}-farMat`);
    expect(material && getAssetOwners(material)).toEqual([getCellOwnerKey(sceneId, A, 'far')]);
    const [groupId, ownId, oldGroupId] = entries.content.load(ctxFor(A)) as number[];
    const groupOf = (id: number) =>
      world.getComponent(id, ComponentType.OBJECT3D)?.value as THREE.InstancedMesh;
    const group = groupOf(groupId);
    expect(group.isInstancedMesh).toBe(true);
    expect(group.count).toBe(3);
    expect(group.castShadow).toBe(true);
    expect(group.userData.entityId).toBe(groupId);
    // Each instance at its near entry's transform, as an Object3D of its props would be
    const expectInstanceAt = (
      instanced: THREE.InstancedMesh,
      i: number,
      props: Pick<MeshProps, 'position' | 'rotation' | 'quaternion' | 'scale'>
    ) => {
      const object = new THREE.Object3D();
      const { position: p, rotation: r, quaternion: q, scale } = props;
      object.position.set(p?.x ?? 0, p?.y ?? 0, p?.z ?? 0);
      if (q) object.quaternion.set(q.x, q.y, q.z, q.w);
      else object.rotation.set(r?.x ?? 0, r?.y ?? 0, r?.z ?? 0);
      if (scale) object.scale.set(scale.x, scale.y, scale.z);
      object.updateMatrix();
      const matrix = new THREE.Matrix4();
      instanced.getMatrixAt(i, matrix);
      matrix.elements.forEach((value, at) => expect(value).toBeCloseTo(object.matrix.elements[at]));
    };
    for (let i = 0; i < 3; i++) expectInstanceAt(group, i, manifest.meshes[i].props);
    // The quaternion over the rotation: a quarter turn about y, scaled 2×
    const matrix = new THREE.Matrix4();
    group.getMatrixAt(2, matrix);
    expect(new THREE.Vector3().setFromMatrixScale(matrix).x).toBeCloseTo(2);
    expect(new THREE.Vector3(1, 0, 0).transformDirection(matrix).z).toBeCloseTo(-1);
    // Over every instance (their boxes, the one scaled 2× reaching to x = 9)
    expect(group.boundingSphere?.center.x).toBeGreaterThan(5.5);
    expect(group.boundingSphere?.radius).toBeGreaterThan(2);
    expect(world.getComponent(ownId, ComponentType.OBJECT3D)?.value).toBeInstanceOf(THREE.Mesh);
    // The deprecated instances still draw
    const oldGroup = groupOf(oldGroupId);
    expect(oldGroup.isInstancedMesh).toBe(true);
    expect(oldGroup.count).toBe(2);
    expect(oldGroup.castShadow).toBe(false);
    for (const [i, instance] of (manifest.farMeshes?.[2].instances ?? []).entries()) {
      expectInstanceAt(oldGroup, i, instance);
    }
  });

  test('a shared mesh: the first holder creates it, every holder gets it, the last to unload deletes it', async () => {
    const content = createStreamingDataContent('dcShared', manifestFor('dcShared'));
    // Its material first: the kept layer's asset unit
    await content.getUnits(A, 'NEAR_AND_FAR')[0].content.load(ctxFor(A));
    const sharedOf = (cellKey: number) => {
      const units = content.getUnits(cellKey, 'NEAR_AND_FAR');
      return units[units.length - 1].content;
    };
    const fromA = sharedOf(A).load(ctxFor(A)) as number[];
    expect(fromA).toHaveLength(1);
    // Every holder gets its id; the holders in load order tell the machine who draws it (D8)
    expect(sharedOf(B).load(ctxFor(B))).toEqual(fromA);
    expect(content.getHolders(fromA[0])).toEqual([A, B]);
    sharedOf(A).unload?.(fromA, ctxFor(A));
    expect(world.isAlive(fromA[0])).toBe(true);
    expect(content.getHolders(fromA[0])).toEqual([B]);
    sharedOf(B).unload?.(fromA, ctxFor(B));
    expect(content.getHolders(fromA[0])).toBeNull();
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
