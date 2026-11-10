import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { ECSWorld } from '../../ecs/ECS';
import { createGeometry } from '../Geometry';
import { createMaterial } from '../Material';
import { setMeshMergeHandler } from '../../mesh/Mesh';
import { createRootScene } from '../../scene/Scene';
import { parseCustomProps } from './CustomProps';
import type { ImportedAssetManifest, ImportedGeometryInfo } from './ImportTypes';
import { spawnImportedAsset } from './SpawnImported';

// The warnings (a physics node without physics()), and the merge handler merging() would set
const fns = vi.hoisted(() => ({ lwarn: vi.fn(), merge: vi.fn() }));
vi.mock(import('../../../utils/Logger'), async (importOriginal) => ({
  ...(await importOriginal()),
  lwarn: fns.lwarn,
}));

let world: ECSWorld;
beforeAll(() => {
  world = new ECSWorld();
  createRootScene();
  createGeometry({ id: 'spawnTest/piece', type: 'BOX', params: {}, isPersistent: true });
  createMaterial({ id: 'spawnTestMat', type: 'BASIC', params: {}, isPersistent: true });
  setMeshMergeHandler(fns.merge);
});

afterEach(() => {
  world.clearWorld();
  fns.merge.mockClear();
});

/** A manifest of nodes sharing the one registered geometry, with the given custom props. */
const createManifest = (nodes: Record<string, Record<string, unknown>>): ImportedAssetManifest => ({
  id: 'spawnTest',
  fileName: 'spawnTest.glb',
  textureIds: [],
  geometries: Object.entries(nodes).map(
    ([nodeName, raw]): ImportedGeometryInfo => ({
      geometryId: 'spawnTest/piece',
      importId: 'spawnTest',
      nodeName,
      parentPath: [],
      transform: {
        position: { x: 0, y: 0, z: 0 },
        quaternion: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
      },
      customProps: parseCustomProps(raw),
      isDracoCompressed: false,
    })
  ),
});

/** The merges the handler got: each piece's index in the spawn's meshes, and its merge. */
const getMerges = (meshEntityIds: number[]) =>
  fns.merge.mock.calls.map(([entityId, def]) => [meshEntityIds.indexOf(entityId as number), def]);

describe("spawnImportedAsset's merge", () => {
  test("the spawn's merge for every piece, a node's custom prop and a meshProps entry win", async () => {
    const manifest = createManifest({ wall: {}, gate: { merge: 'gates' }, roof: {} });
    const { meshEntityIds } = await spawnImportedAsset(manifest, {
      material: 'spawnTestMat',
      merge: 'AUTO',
      meshProps: [{}, {}, { merge: 'roofs' }],
    });
    expect(getMerges(meshEntityIds)).toEqual([
      [0, 'AUTO'],
      [1, 'gates'],
      [2, 'roofs'],
    ]);
  });

  test("leaves out the spawn's merge for a physics group whose body moves", async () => {
    const manifest = createManifest({
      // The nodes without an index are one group, with a fixed body
      ground: { isPhysObj: true, keepMesh: true, rigidType: 'FIXED', colliderType: 'BOX' },
      steps: {},
      // Index 1: a dynamic crate and its lid, which keeps its own merge prop (warned when it joins)
      crate: {
        isPhysObj: true,
        keepMesh: true,
        rigidType: 'DYNAMIC',
        colliderType: 'BOX',
        index: 1,
      },
      lid: { index: 1, merge: 'lids' },
      // Index 2: a fixed group again
      post: { isPhysObj: true, keepMesh: true, rigidType: 'FIXED', colliderType: 'BOX', index: 2 },
    });
    const { meshEntityIds } = await spawnImportedAsset(manifest, {
      material: 'spawnTestMat',
      merge: 'AUTO',
    });
    expect(getMerges(meshEntityIds)).toEqual([
      [0, 'AUTO'],
      [1, 'AUTO'],
      [3, 'lids'],
      [4, 'AUTO'],
    ]);
  });

  test('no merge, no handler call', async () => {
    await spawnImportedAsset(createManifest({ wall: {} }), { material: 'spawnTestMat' });
    expect(fns.merge).not.toHaveBeenCalled();
  });
});
