import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import * as THREE from 'three/webgpu';

// The renderer's backend, and the backend modules: recording stand-ins
const env = vi.hoisted(() => ({
  isWebGPU: true,
  /** The backend's calls: adds, rewrites and removals, and its extent after each change. */
  writes: [] as { start: number; matrices: Float32Array; count: number }[],
  removals: [] as { start: number; count: number }[],
  rewrites: [] as { start: number; matrices: Float32Array; count: number }[],
  extent: 0,
  disposed: 0,
  params: null as unknown,
  /** The module the last backend came from. */
  module: null as 'GPU' | 'CPU' | null,
}));
/** A backend recording what the front asks of it. */
const createStubBackend = vi.hoisted(() => () => ({
  addInstances: (start: number, matrices: Float32Array, count: number) =>
    env.writes.push({ start, matrices: matrices.slice(), count }),
  writeInstances: (start: number, matrices: Float32Array, count: number) =>
    env.rewrites.push({ start, matrices: matrices.slice(), count }),
  removeInstances: (start: number, count: number) => env.removals.push({ start, count }),
  setExtent: (extent: number) => {
    env.extent = extent;
  },
  dispose: () => env.disposed++,
}));
vi.mock(import('../../kernel/render/Renderer'), async (importOriginal) => ({
  ...(await importOriginal()),
  isWebGPURenderer: () => env.isWebGPU,
}));
vi.mock(import('./InstanceSetGpu'), () => ({
  createGpuInstanceSetBackend: (params) => {
    env.params = params;
    env.module = 'GPU';
    return createStubBackend();
  },
}));
vi.mock(import('./InstanceSetCpu'), () => ({
  createCpuInstanceSetBackend: (params) => {
    env.params = params;
    env.module = 'CPU';
    return createStubBackend();
  },
}));

import { ECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import { getGeometryRegistry, saveBufferGeometry } from '../../kernel/assets/Geometry';
import type { FeatureContext } from '../../kernel/init/Features';
import type { InstanceSetBackendParams } from './InstanceSetTypes';
import { initEnvironment } from '../../kernel/config/Config';
import { getLodContentDebugSources } from '../../kernel/ecs/LodTargets';
import { createInstanceSetAsync, installInstanceSets } from './InstanceSet';

let world: ECSWorld;
beforeAll(() => {
  installInstanceSets({
    registerComponentHooks: (type, hooks) => ECSWorld.registerComponentHooks(type, hooks),
  } as Pick<FeatureContext, 'registerComponentHooks'> as FeatureContext);
  world = new ECSWorld();
});
beforeEach(() => {
  env.isWebGPU = true;
  env.writes = [];
  env.removals = [];
  env.rewrites = [];
  env.extent = 0;
  env.disposed = 0;
  env.params = null;
  env.module = null;
});

const material = new THREE.MeshBasicNodeMaterial();
const levels = () => [
  { geometry: new THREE.BoxGeometry(), material, screenSize: 0.1 },
  { geometry: new THREE.BoxGeometry(), material, screenSize: 0 },
];

const placeAt = (x: number, scale = 1) => ({
  position: new THREE.Vector3(x, 0, 0),
  quaternion: new THREE.Quaternion(),
  scale,
});

describe('createInstanceSetAsync: the options', () => {
  test('rejects no levels, a bad maxInstances and a bad maxVisible', async () => {
    await expect(createInstanceSetAsync({ world, levels: [], maxInstances: 10 })).rejects.toThrow(
      'no levels'
    );
    for (const maxInstances of [0, 1.5, -3]) {
      await expect(
        createInstanceSetAsync({ world, levels: levels(), maxInstances })
      ).rejects.toThrow('positive integer');
    }
    await expect(
      createInstanceSetAsync({ world, levels: levels(), maxInstances: 2 ** 24 + 1 })
    ).rejects.toThrow('2^24');
    await expect(
      createInstanceSetAsync({ world, levels: levels(), maxInstances: 10, maxVisible: 0 })
    ).rejects.toThrow('maxVisible');
    for (const maxSlots of [0, 2.5]) {
      await expect(
        createInstanceSetAsync({ world, levels: levels(), maxInstances: 10, maxSlots })
      ).rejects.toThrow('maxSlots');
    }
  });

  test('maxSlots defaults to 8', async () => {
    const set = await createInstanceSetAsync({ world, levels: levels(), maxInstances: 10 });
    expect((env.params as InstanceSetBackendParams).maxSlots).toBe(8);
    const two = await createInstanceSetAsync({
      world,
      levels: levels(),
      maxInstances: 10,
      maxSlots: 2,
    });
    expect((env.params as InstanceSetBackendParams).maxSlots).toBe(2);
    world.deleteEntity(set!.entityId);
    world.deleteEntity(two!.entityId);
  });

  test('takes 2^24 instances, and maxVisible defaults to maxInstances up to 65,536', async () => {
    const big = await createInstanceSetAsync({ world, levels: levels(), maxInstances: 2 ** 24 });
    expect((env.params as InstanceSetBackendParams).maxVisible).toBe(65_536);
    const small = await createInstanceSetAsync({ world, levels: levels(), maxInstances: 100 });
    expect((env.params as InstanceSetBackendParams).maxVisible).toBe(100);
    // Never past maxInstances
    await createInstanceSetAsync({ world, levels: levels(), maxInstances: 100, maxVisible: 500 });
    expect((env.params as InstanceSetBackendParams).maxVisible).toBe(100);
    world.deleteEntity(big!.entityId);
    world.deleteEntity(small!.entityId);
  });

  test('picks the backend by the renderer', async () => {
    const gpu = await createInstanceSetAsync({ world, levels: levels(), maxInstances: 4 });
    expect(gpu!.backend).toBe('GPU');
    expect(env.module).toBe('GPU');
    expect((env.params as InstanceSetBackendParams).world).toBe(world);
    env.isWebGPU = false;
    const cpu = await createInstanceSetAsync({ world, levels: levels(), maxInstances: 4 });
    expect(cpu!.backend).toBe('CPU');
    expect(env.module).toBe('CPU');
    expect(cpu!.addInstances([placeAt(0)])).toEqual({ start: 0, count: 1 });
    expect(env.writes.at(-1)).toMatchObject({ start: 0, count: 1 });
    world.deleteEntity(gpu!.entityId);
    world.deleteEntity(cpu!.entityId);
  });
});

describe('InstanceSet: the ranges', () => {
  test('appends ranges after the last ones and writes them to the backend', async () => {
    const set = (await createInstanceSetAsync({ world, levels: levels(), maxInstances: 5 }))!;
    expect(set.addInstances([placeAt(1), placeAt(2, 2)])).toEqual({ start: 0, count: 2 });
    const matrices = new Float32Array(32);
    new THREE.Matrix4().makeTranslation(3, 0, 0).toArray(matrices, 0);
    new THREE.Matrix4().makeTranslation(4, 0, 0).toArray(matrices, 16);
    expect(set.addInstances(matrices)).toEqual({ start: 2, count: 2 });
    expect(set.count).toBe(4);

    expect(env.writes.map(({ start, count }) => [start, count])).toEqual([
      [0, 2],
      [2, 2],
    ]);
    // A placement's matrix: its position and its uniform scale
    const second = new THREE.Matrix4().fromArray(env.writes[0].matrices, 16);
    expect(new THREE.Vector3().setFromMatrixPosition(second).x).toBe(2);
    expect(second.getMaxScaleOnAxis()).toBeCloseTo(2, 6);
    expect(env.writes[1].matrices[12]).toBe(3);
  });

  test('adds nothing past maxInstances, and an empty add is an empty range', async () => {
    const set = (await createInstanceSetAsync({ world, levels: levels(), maxInstances: 3 }))!;
    set.addInstances([placeAt(0), placeAt(1)]);
    expect(set.addInstances([placeAt(2), placeAt(3)])).toBeNull();
    expect(set.count).toBe(2);
    expect(set.addInstances([])).toEqual({ start: 2, count: 0 });
    expect(set.addInstances([placeAt(2)])).toEqual({ start: 2, count: 1 });
    expect(env.writes).toHaveLength(2);
  });

  test('a removed range stops in the backend, and a later add of its size or smaller takes it', async () => {
    const set = (await createInstanceSetAsync({ world, levels: levels(), maxInstances: 6 }))!;
    const a = set.addInstances([placeAt(0), placeAt(1)])!;
    const b = set.addInstances([placeAt(2), placeAt(3)])!;
    set.addInstances([placeAt(4)]);
    expect(env.extent).toBe(5);

    expect(set.removeInstances(a)).toBe(true);
    expect(env.removals).toEqual([{ start: 0, count: 2 }]);
    expect(set.count).toBe(3);
    // A removed range below the end leaves the extent
    expect(env.extent).toBe(5);
    // Too large for the free range: the end; then one that fits takes it
    expect(set.addInstances([placeAt(5), placeAt(6), placeAt(7)])).toBeNull();
    expect(set.addInstances([placeAt(8)])).toEqual({ start: 0, count: 1 });
    expect(env.writes.at(-1)).toMatchObject({ start: 0, count: 1 });
    expect(env.writes.at(-1)!.matrices[12]).toBe(8);
    expect(set.count).toBe(4);

    // Removing the top ranges lowers the extent
    set.removeInstances(b);
    expect(env.extent).toBe(5);
    set.removeInstances({ start: 4, count: 1 });
    expect(env.extent).toBe(1);
    expect(set.count).toBe(1);
  });

  test("removes only a live range of its own, and nothing once it's disposed", async () => {
    const set = (await createInstanceSetAsync({ world, levels: levels(), maxInstances: 6 }))!;
    const range = set.addInstances([placeAt(0), placeAt(1)])!;
    // In part, or not one it gave
    expect(set.removeInstances({ start: 0, count: 1 })).toBe(false);
    expect(set.removeInstances({ start: 4, count: 2 })).toBe(false);
    expect(set.removeInstances(range)).toBe(true);
    // Twice
    expect(set.removeInstances(range)).toBe(false);
    expect(env.removals).toHaveLength(1);
    // An empty range removes nothing
    expect(set.removeInstances(set.addInstances([])!)).toBe(true);

    const again = set.addInstances([placeAt(0)])!;
    world.deleteEntity(set.entityId);
    expect(set.removeInstances(again)).toBe(false);
    expect(env.removals).toHaveLength(1);
  });

  test('moves instances of a live range from an offset, as placements or matrices', async () => {
    const set = (await createInstanceSetAsync({ world, levels: levels(), maxInstances: 8 }))!;
    set.addInstances([placeAt(0)]);
    const range = set.addInstances([placeAt(1), placeAt(2), placeAt(3)])!;
    expect(set.setInstanceMatrices(range, [placeAt(20, 2)], 2)).toBe(true);
    const matrices = new Float32Array(32);
    new THREE.Matrix4().makeTranslation(10, 0, 0).toArray(matrices, 0);
    new THREE.Matrix4().makeTranslation(11, 0, 0).toArray(matrices, 16);
    expect(set.setInstanceMatrices(range, matrices)).toBe(true);
    expect(env.rewrites.map(({ start, count }) => [start, count])).toEqual([
      [3, 1],
      [1, 2],
    ]);
    expect(env.rewrites[0].matrices[12]).toBe(20);
    expect(new THREE.Matrix4().fromArray(env.rewrites[0].matrices).getMaxScaleOnAxis()).toBeCloseTo(
      2,
      6
    );
    expect(env.rewrites[1].matrices[16 + 12]).toBe(11);
    // Neither added nor removed
    expect(set.count).toBe(4);
    expect(env.writes).toHaveLength(2);
  });

  test('moves nothing outside the range, of a range not live, or once disposed', async () => {
    const set = (await createInstanceSetAsync({ world, levels: levels(), maxInstances: 8 }))!;
    const range = set.addInstances([placeAt(0), placeAt(1)])!;
    expect(() => set.setInstanceMatrices(range, [placeAt(0)], 2)).toThrow("don't fit");
    expect(() => set.setInstanceMatrices(range, [placeAt(0), placeAt(1), placeAt(2)])).toThrow(
      "don't fit"
    );
    expect(() => set.setInstanceMatrices(range, [placeAt(0)], -1)).toThrow("don't fit");
    expect(() => set.setInstanceMatrices(range, new Float32Array(8))).toThrow('16 floats');
    // In part is a range it didn't give
    expect(set.setInstanceMatrices({ start: 1, count: 1 }, [placeAt(0)])).toBe(false);
    set.removeInstances(range);
    expect(set.setInstanceMatrices(range, [placeAt(0)])).toBe(false);
    const again = set.addInstances([placeAt(0)])!;
    world.deleteEntity(set.entityId);
    expect(set.setInstanceMatrices(again, [placeAt(0)])).toBe(false);
    expect(env.rewrites).toEqual([]);
  });

  test("refuses matrices that aren't 16 floats each", async () => {
    const set = (await createInstanceSetAsync({ world, levels: levels(), maxInstances: 3 }))!;
    expect(() => set.addInstances(new Float32Array(20))).toThrow('16 floats');
  });
});

describe('InstanceSet: the owning entity', () => {
  test('deleting it disposes the set, its draws and its refs; the set then adds nothing', async () => {
    const geometry = saveBufferGeometry(new THREE.BoxGeometry(), { id: 'instanceSetTestGeo' });
    const set = (await createInstanceSetAsync({
      world,
      levels: [{ geometry, material, screenSize: 0 }],
      maxInstances: 3,
    }))!;
    const scene = new THREE.Scene();
    scene.add(set.object);
    expect(world.getComponent(set.entityId, ComponentType.INSTANCE_SET)?.object).toBe(set.object);
    const refs = getGeometryRegistry().instanceSetTestGeo.count;
    expect(refs).toBeGreaterThan(0);

    world.deleteEntity(set.entityId);
    expect(env.disposed).toBe(1);
    expect(set.object.parent).toBeNull();
    expect(getGeometryRegistry().instanceSetTestGeo?.count ?? 0).toBe(refs - 1);
    expect(set.addInstances([placeAt(0)])).toBeNull();
  });

  test('removing INSTANCE_SET disposes the set once', async () => {
    const set = (await createInstanceSetAsync({ world, levels: levels(), maxInstances: 3 }))!;
    world.removeComponent(set.entityId, ComponentType.INSTANCE_SET);
    world.deleteEntity(set.entityId);
    expect(env.disposed).toBe(1);
  });

  test('resolves null when the scene exits while the backend loads', async () => {
    const created = createInstanceSetAsync({ world, levels: levels(), maxInstances: 3 });
    // The scene switch: every non-persistent entity goes, the owning one included
    world.clearNonPersistent();
    await expect(created).resolves.toBeNull();
    expect(env.params).toBeNull();
  });

  test('a persistent set outlives the scene switch', async () => {
    const created = createInstanceSetAsync({
      world,
      levels: levels(),
      maxInstances: 3,
      entityOpts: { persistent: true },
    });
    world.clearNonPersistent();
    const set = await created;
    expect(set).not.toBeNull();
    world.deleteEntity(set!.entityId);
  });
});

// p354 D11: the LOD tab lists the live sets, the debug env only (the flags are set for the rest of
// this file, so this runs last)
describe('InstanceSet: the debug list', () => {
  test("lists a live set's label, backend, levels and count in the LOD tab's source", async () => {
    initEnvironment({ search: '?isDebug=true', env: { VITE_APP_ENV: 'development' } });
    // Through import(), as the debug loader loads it
    const { _registerInstanceSetDebugSource } = await import('./debug/_dbg__InstanceSet');
    _registerInstanceSetDebugSource();
    const [source] = getLodContentDebugSources();
    const set = (await createInstanceSetAsync({
      world,
      levels: levels(),
      maxInstances: 3,
      entityOpts: { appId: 'debugListForest' },
    }))!;
    set.addInstances([placeAt(0), placeAt(1)]);
    expect(source.getInfos()).toEqual([
      // No renderer here: no readback (and the stand-in backend has no slots)
      {
        label: 'debugListForest',
        backend: 'GPU',
        levelCount: 2,
        instanceCount: 2,
        cameraCount: 0,
        stats: null,
      },
    ]);

    world.deleteEntity(set.entityId);
    expect(source.getInfos()).toEqual([]);
  });
});
