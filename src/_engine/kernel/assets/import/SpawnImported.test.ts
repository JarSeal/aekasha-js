import { Matrix4, Vector3 } from 'three/webgpu';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { ECSWorld } from '../../ecs/ECS';
import { createGeometry } from '../Geometry';
import { createMaterial } from '../Material';
import { setMeshMergeHandler } from '../../mesh/Mesh';
import { createRootScene } from '../../scene/Scene';
import { parseCustomProps } from './CustomProps';
import { type ImportInstancesSpawn, registerImportExtension } from './ImportExtensions';
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

describe("spawnImportedAsset's GPU instances", () => {
  /** A `rocks` node of two instances, at x 1, turned 90° about y and scaled 2, and a point cloud */
  const createInstancedManifest = (raw: Record<string, unknown> = {}) => {
    const manifest = createManifest({ wall: {}, rocks: raw });
    const half = Math.SQRT1_2;
    manifest.geometries[1].transform = {
      position: { x: 1, y: 0, z: 0 },
      quaternion: { x: 0, y: half, z: 0, w: half },
      scale: { x: 2, y: 2, z: 2 },
    };
    const matrices = new Float32Array(32);
    new Matrix4().makeTranslation(1, 0, 0).toArray(matrices, 0);
    new Matrix4().makeTranslation(0, 1, 0).toArray(matrices, 16);
    manifest.geometries[1].instances = { matrices, colors: new Float32Array([1, 0, 0, 0, 1, 0]) };
    manifest.pointClouds = [
      {
        importId: 'spawnTest',
        nodeName: 'points',
        parentPath: [],
        transform: manifest.geometries[0].transform,
        customProps: parseCustomProps({}),
        instances: { matrices: new Float32Array(16) },
      },
    ];
    return manifest;
  };

  test('without instancing(): warns once and draws the geometry once, at the node', async () => {
    fns.lwarn.mockClear();
    const { meshEntityIds } = await spawnImportedAsset(createInstancedManifest(), {
      material: 'spawnTestMat',
    });
    // The wall and the rocks' one mesh: the point cloud spawns nothing
    expect(meshEntityIds).toHaveLength(2);
    expect(fns.lwarn).toHaveBeenCalledWith(expect.stringMatching(/GPU instances.*'instancing'/));
  });

  test("with instancing(): the instances in world space, the node's meshProps, no physics or merge", async () => {
    const spawns: ImportInstancesSpawn[] = [];
    const physicsNodes: string[][] = [];
    registerImportExtension({
      id: 'instancing',
      spawnInstances: (spawn) => {
        spawns.push(spawn);
        return [101, 102];
      },
    });
    registerImportExtension({
      id: 'physics',
      spawnPhysics: async ({ nodes }) => {
        physicsNodes.push(nodes.map((node) => node.info.nodeName));
        return [];
      },
    });
    fns.lwarn.mockClear();
    const physics = { isPhysObj: true, keepMesh: true, colliderType: 'BOX', merge: 'rocks' };
    const manifest = createInstancedManifest(physics);
    manifest.geometries[0].customProps = parseCustomProps(physics);
    const { meshEntityIds } = await spawnImportedAsset(manifest, {
      material: 'spawnTestMat',
      transform: { position: { x: 0, y: 0, z: 5 } },
      castShadow: true,
      meshProps: {
        'spawnTest/piece': { receiveShadow: true, lod: { levels: [{ screenSize: 0 }] } },
      },
      entityOpts: { appId: 'grove', persistent: true },
    });

    expect(meshEntityIds.slice(1)).toEqual([101, 102]);
    expect(spawns).toHaveLength(1);
    const [spawn] = spawns;
    expect(spawn).toMatchObject({
      id: 'grove/rocks',
      geometry: 'spawnTest/piece',
      castShadow: true,
      receiveShadow: true,
      lod: { levels: [{ screenSize: 0 }] },
      entityOpts: { persistent: true },
    });
    expect(spawn.entityOpts).not.toHaveProperty('appId');
    expect([...spawn.colors!]).toEqual([1, 0, 0, 0, 1, 0]);
    // (1, 0, 0) turned to (0, 0, -1), scaled 2, at x 1, then the root's z 5; (0, 1, 0) to y 2
    const positions = [0, 1].map((i) =>
      new Vector3().setFromMatrixPosition(new Matrix4().fromArray(spawn.matrices, i * 16)).toArray()
    );
    expect(positions[0].map((v) => Number(v.toFixed(5)))).toEqual([1, 0, 3]);
    expect(positions[1].map((v) => Number(v.toFixed(5)))).toEqual([1, 2, 5]);

    // The wall's physics only; the rocks' props warn
    expect(physicsNodes).toEqual([['wall']]);
    expect(fns.lwarn).toHaveBeenCalledWith(
      expect.stringMatching(/"rocks" .* GPU instances, which get no physics or merge/)
    );
  });
});
