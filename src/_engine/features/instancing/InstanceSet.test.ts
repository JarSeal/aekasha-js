import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import * as THREE from 'three/webgpu';

// The renderer's backend, and the GPU backend module: a recording stand-in
const env = vi.hoisted(() => ({
  isWebGPU: true,
  writes: [] as { start: number; matrices: Float32Array; count: number }[],
  disposed: 0,
  params: null as unknown,
}));
vi.mock(import('../../kernel/render/Renderer'), async (importOriginal) => ({
  ...(await importOriginal()),
  isWebGPURenderer: () => env.isWebGPU,
}));
vi.mock(import('./InstanceSetGpu'), () => ({
  createGpuInstanceSetBackend: (params) => {
    env.params = params;
    return {
      writeInstances: (start, matrices, count) =>
        env.writes.push({ start, matrices: matrices.slice(), count }),
      dispose: () => env.disposed++,
    };
  },
}));

import { ECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import { getGeometryRegistry, saveBufferGeometry } from '../../kernel/assets/Geometry';
import type { FeatureContext } from '../../kernel/init/Features';
import type { InstanceSetBackendParams } from './InstanceSetTypes';
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
  env.disposed = 0;
  env.params = null;
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
    expect(env.params).not.toBeNull();
    env.isWebGPU = false;
    env.params = null;
    const cpu = await createInstanceSetAsync({ world, levels: levels(), maxInstances: 4 });
    expect(cpu!.backend).toBe('CPU');
    // Until Phase 4 the CPU backend is an empty one: the GPU module wasn't asked
    expect(env.params).toBeNull();
    expect(cpu!.addInstances([placeAt(0)])).toEqual({ start: 0, count: 1 });
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
