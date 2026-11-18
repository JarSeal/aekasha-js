import { beforeAll, describe, expect, test } from 'vitest';
import * as THREE from 'three/webgpu';
import { ECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import type { FeatureContext } from '../../kernel/init/Features';
import { getGeometryRegistry, saveBufferGeometry } from '../../kernel/assets/Geometry';
import { getMaterialRegistry, saveMaterial } from '../../kernel/assets/Material';
import { createMeshEntity, installMeshes } from '../../kernel/mesh/Mesh';
import { createRootScene, getRootScene } from '../../kernel/scene/Scene';
import {
  createInstancedMeshEntity,
  createStaticInstances,
  spawnImportedInstances,
} from './StaticInstances';

let world: ECSWorld;
beforeAll(() => {
  // The mesh tag's delete hook, which gives the refs back
  installMeshes({
    registerComponentHooks: (type, hooks) => ECSWorld.registerComponentHooks(type, hooks),
  } as Pick<FeatureContext, 'registerComponentHooks'> as FeatureContext);
  world = new ECSWorld();
  createRootScene();
});

const placeAt = (x: number, z = 0) => ({
  position: new THREE.Vector3(x, 0, z),
  quaternion: new THREE.Quaternion(),
  scale: 1,
});

const getMesh = (entityId: number) =>
  world.getComponent(entityId, ComponentType.OBJECT3D)!.value as THREE.InstancedMesh;

const getRefs = (geoId: string, matId: string) => ({
  geometry: getGeometryRegistry()[geoId]?.count,
  material: getMaterialRegistry()[matId]?.count,
});

/** A registered box geometry and material under these ids */
const saveAssets = (geoId: string, matId: string) => {
  saveBufferGeometry(new THREE.BoxGeometry(), { id: geoId });
  saveMaterial(new THREE.MeshBasicNodeMaterial(), matId);
};

describe('createInstancedMeshEntity', () => {
  test('writes the matrices and bounds over every instance, outside the spatial index', () => {
    saveAssets('siBoundsGeo', 'siBoundsMat');
    const entityId = createInstancedMeshEntity(
      {
        geo: 'siBoundsGeo',
        mat: 'siBoundsMat',
        instances: [placeAt(-5), placeAt(5)],
        castShadow: true,
        appId: 'siBounds',
      },
      { world }
    );
    const mesh = getMesh(entityId);
    expect(mesh).toBeInstanceOf(THREE.InstancedMesh);
    expect(mesh.count).toBe(2);
    expect(mesh.castShadow).toBe(true);
    expect(mesh.parent).toBe(getRootScene());
    expect(mesh.userData.entityId).toBe(entityId);
    expect(world.hasComponent(entityId, ComponentType.TAG_IS_MESH)).toBe(true);
    expect(world.hasComponent(entityId, ComponentType.SPATIAL_INDEXED)).toBe(false);
    for (const x of [-5.5, 5.5]) {
      expect(mesh.boundingSphere!.containsPoint(new THREE.Vector3(x, 0, 0))).toBe(true);
      expect(mesh.boundingBox!.containsPoint(new THREE.Vector3(x, 0, 0))).toBe(true);
    }
    world.deleteEntity(entityId);
  });

  test('takes the refs and gives them back on delete, keeping a geometry another mesh uses', () => {
    saveAssets('siSharedGeo', 'siSharedMat');
    const meshId = createMeshEntity({ geo: 'siSharedGeo', mat: 'siSharedMat' }, { world });
    const cellId = createInstancedMeshEntity(
      { geo: 'siSharedGeo', mat: 'siSharedMat', instances: [placeAt(0)] },
      { world }
    );
    expect(getRefs('siSharedGeo', 'siSharedMat')).toEqual({ geometry: 2, material: 2 });

    world.deleteEntity(cellId);
    expect(getRefs('siSharedGeo', 'siSharedMat')).toEqual({ geometry: 1, material: 1 });

    world.deleteEntity(meshId);
    expect(getRefs('siSharedGeo', 'siSharedMat')).toEqual({
      geometry: undefined,
      material: undefined,
    });
  });

  test('takes matrices and colours, copied', () => {
    saveAssets('siArrayGeo', 'siArrayMat');
    const matrices = new Float32Array(32);
    new THREE.Matrix4().makeTranslation(1, 2, 3).toArray(matrices, 0);
    new THREE.Matrix4().makeTranslation(4, 5, 6).toArray(matrices, 16);
    const colors = new Float32Array([1, 0, 0, 0, 1, 0]);
    const entityId = createInstancedMeshEntity(
      { geo: 'siArrayGeo', mat: 'siArrayMat', instances: matrices, colors },
      { world }
    );
    const mesh = getMesh(entityId);
    matrices.fill(0);
    colors.fill(0);
    const position = new THREE.Vector3().setFromMatrixPosition(
      mesh.getMatrixAt(1, new THREE.Matrix4())
    );
    expect(position.toArray()).toEqual([4, 5, 6]);
    expect(mesh.getColorAt(1, new THREE.Color()).toArray()).toEqual([0, 1, 0]);
    world.deleteEntity(entityId);
  });

  test('refuses no instances, a partial matrix and colours that are not one per instance', () => {
    saveAssets('siRefusedGeo', 'siRefusedMat');
    const props = { geo: 'siRefusedGeo', mat: 'siRefusedMat' };
    expect(() => createInstancedMeshEntity({ ...props, instances: [] }, { world })).toThrow(
      'no instances'
    );
    expect(() =>
      createInstancedMeshEntity({ ...props, instances: new Float32Array(20) }, { world })
    ).toThrow('16 per matrix');
    expect(() =>
      createInstancedMeshEntity(
        { ...props, instances: [placeAt(0)], colors: new Float32Array(6) },
        { world }
      )
    ).toThrow('3 per instance');
    // Nothing taken
    expect(getRefs('siRefusedGeo', 'siRefusedMat')).toEqual({ geometry: 0, material: 0 });
  });
});

describe('createStaticInstances', () => {
  // A 64 m block's grid, 2 m apart: 16 cells of 16 m, 64 instances each
  const createBlockPlacements = () => {
    const placements = [];
    for (let z = 0; z < 32; z++) {
      for (let x = 0; x < 32; x++) placements.push(placeAt(x * 2 + 1, z * 2 + 1));
    }
    return placements;
  };

  test('splits the instances into cells, each placed at its centre with its own bounds', () => {
    saveAssets('siCellsGeo', 'siCellsMat');
    const placements = createBlockPlacements();
    const colors = new Float32Array(placements.length * 3).map((_, i) => (i % 3) / 2);
    const cells = createStaticInstances({
      id: 'siCells',
      geometry: 'siCellsGeo',
      material: 'siCellsMat',
      instances: placements,
      colors,
      lod: { levels: [{ screenSize: 0 }], cullScreenSize: 0.01 },
      world,
    });

    expect(cells.count).toBe(1024);
    expect(cells.entityIds).toHaveLength(16);
    expect(getRefs('siCellsGeo', 'siCellsMat')).toEqual({ geometry: 16, material: 16 });

    // Every instance back at its world position, in the cell it falls in
    const seen = new Set<string>();
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    for (const entityId of cells.entityIds) {
      const mesh = getMesh(entityId);
      const transform = world.getComponent(entityId, ComponentType.TRANSFORM)!;
      expect(mesh.count).toBe(64);
      expect(transform.position.x % 16).toBe(8);
      expect(transform.position.z % 16).toBe(8);
      expect(world.hasComponent(entityId, ComponentType.LOD)).toBe(true);
      expect(mesh.boundingSphere!.radius).toBeLessThan(16);
      for (let i = 0; i < mesh.count; i++) {
        position.setFromMatrixPosition(mesh.getMatrixAt(i, matrix));
        expect(Math.abs(position.x)).toBeLessThan(8);
        expect(Math.abs(position.z)).toBeLessThan(8);
        position.add(transform.position);
        seen.add(`${position.x},${position.z}`);
        // The colour went with its instance (the third channel is 1 for every one)
        expect(mesh.getColorAt(i, new THREE.Color()).b).toBe(1);
      }
    }
    expect(seen.size).toBe(1024);
    expect(placements.every((p) => seen.has(`${p.position.x},${p.position.z}`))).toBe(true);

    cells.dispose();
    expect(cells.entityIds.some((entityId) => world.isAlive(entityId))).toBe(false);
    expect(getRefs('siCellsGeo', 'siCellsMat')).toEqual({
      geometry: undefined,
      material: undefined,
    });
    // Deleted already: a no-op
    cells.dispose();
  });

  test('negative positions fall in their own cells, and no instances make no cell', () => {
    saveAssets('siNegativeGeo', 'siNegativeMat');
    const cells = createStaticInstances({
      id: 'siNegative',
      geometry: 'siNegativeGeo',
      material: 'siNegativeMat',
      instances: [placeAt(-1, -1), placeAt(1, 1)],
      cellSize: 4,
      world,
    });
    const origins = cells.entityIds.map((entityId) => {
      const { x, z } = world.getComponent(entityId, ComponentType.TRANSFORM)!.position;
      return [x, z];
    });
    expect(origins).toEqual([
      [-2, -2],
      [2, 2],
    ]);
    cells.dispose();

    const none = createStaticInstances({
      id: 'siNone',
      geometry: { type: 'BOX', params: { width: 1, height: 1, depth: 1 } },
      material: 'siNegativeMat',
      instances: [],
      world,
    });
    expect(none).toMatchObject({ entityIds: [], count: 0 });
    expect(() =>
      createStaticInstances({
        id: 'siZero',
        geometry: 'siNegativeGeo',
        material: 'siNegativeMat',
        instances: [placeAt(0)],
        cellSize: 0,
        world,
      })
    ).toThrow("isn't positive");
  });
});

describe('spawnImportedInstances', () => {
  test("an import's instances in 16 m cells named by its id, in the default world", () => {
    saveAssets('siImportGeo', 'siImportMat');
    const matrices = new Float32Array(32);
    new THREE.Matrix4().makeTranslation(1, 0, 1).toArray(matrices, 0);
    new THREE.Matrix4().makeTranslation(20, 0, 1).toArray(matrices, 16);
    const entityIds = spawnImportedInstances({
      id: 'grove/rocks',
      geometry: 'siImportGeo',
      material: 'siImportMat',
      matrices,
      colors: new Float32Array([1, 0, 0, 0, 1, 0]),
      castShadow: true,
    });
    expect(
      entityIds.map((entityId) => world.getComponent(entityId, ComponentType.APP_ID)?.id)
    ).toEqual(['grove/rocks/0,0', 'grove/rocks/1,0']);
    const mesh = getMesh(entityIds[1]);
    expect(mesh.castShadow).toBe(true);
    expect([...mesh.instanceColor!.array]).toEqual([0, 1, 0]);
  });
});
