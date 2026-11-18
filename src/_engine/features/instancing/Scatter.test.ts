import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { saveBufferGeometry, getGeometryRegistry } from '../../kernel/assets/Geometry';
import { saveMaterial } from '../../kernel/assets/Material';
import { ECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import type { FeatureContext } from '../../kernel/init/Features';
import { installMeshes } from '../../kernel/mesh/Mesh';
import type { SceneHooks } from '../../kernel/scene/SceneHooks';
import { createRootScene } from '../../kernel/scene/Scene';
import { setRandomSeed } from '../../utils/RandomStreams';
import { getScatter, getScatterSeed, spawnScatter } from './Scatter';
import {
  getScatterGeneratorIds,
  installScatters,
  registerScatterGenerator,
  scatterState,
  unregisterScatterGenerator,
  type ScatterGenerator,
} from './ScatterGenerators';
import type { ScatterDef } from './ScatterSchema';

// The scene ids and data are stand-ins; the registries, the entities and the cells are real
const fns = vi.hoisted(() => ({
  loadingSceneId: null as string | null,
  currentSceneId: 'scene' as string | null,
  scenes: {} as Record<string, { scatters?: ScatterDef[] }>,
}));
vi.mock(import('../../kernel/scene/Scene'), async (importOriginal) => ({
  ...(await importOriginal()),
  getLoadingSceneId: () => fns.loadingSceneId,
  getCurrentSceneId: () => fns.currentSceneId,
  getGeneratedSceneData: (id: string) => fns.scenes[id] as never,
}));

let world: ECSWorld;
let exitHook: (() => void) | undefined;
beforeAll(() => {
  installMeshes({
    registerComponentHooks: (type, hooks) => ECSWorld.registerComponentHooks(type, hooks),
  } as Pick<FeatureContext, 'registerComponentHooks'> as FeatureContext);
  world = new ECSWorld();
  createRootScene();
  saveBufferGeometry(new THREE.BoxGeometry(), { id: 'pebble', isPersistent: true });
  saveBufferGeometry(new THREE.SphereGeometry(), { id: 'boulder', isPersistent: true });
  saveMaterial(new THREE.MeshBasicNodeMaterial(), 'stone', true);
});

const item = (geometry: string, weight = 1) => ({
  geometry,
  material: 'stone',
  weight,
  castShadow: false,
  receiveShadow: true,
});

const scatter = (fields: Partial<ScatterDef> = {}): ScatterDef => ({
  id: 'rocks',
  items: [item('pebble', 3), item('boulder')],
  source: { type: 'PROCEDURAL', generator: 'grid', params: { side: 8 }, seed: 1 },
  cellSize: 16,
  ...fields,
});

/** `side` × `side` instances 4 m apart over the target's square from its corner, with no items */
const gridGenerator: ScatterGenerator = ({ params, target }) => {
  const side = Number(params.side);
  const matrices = new Float32Array(side * side * 16);
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < side * side; i++) {
    const x = target.position.x - 16 + (i % side) * 4 + 2;
    const z = target.position.z - 16 + Math.floor(i / side) * 4 + 2;
    matrix.makeTranslation(x, target.position.y, z).toArray(matrices, i * 16);
  }
  return { matrices };
};

const positionsOf = (entityIds: readonly number[]) =>
  entityIds.flatMap((entityId) => {
    const mesh = world.getComponent(entityId, ComponentType.OBJECT3D)!.value as THREE.InstancedMesh;
    const origin = world.getComponent(entityId, ComponentType.TRANSFORM)!.position;
    return Array.from({ length: mesh.count }, (_, i) => {
      const p = new THREE.Vector3().setFromMatrixPosition(mesh.getMatrixAt(i, new THREE.Matrix4()));
      return `${mesh.geometry.userData.id}@${p.x + origin.x},${p.z + origin.z}`;
    });
  });

beforeEach(() => {
  fns.loadingSceneId = null;
  fns.currentSceneId = 'scene';
  fns.scenes = { scene: { scatters: [scatter()] } };
  installScatters({
    addSceneHooks: (hooks: SceneHooks) => {
      exitHook = hooks.exit as () => void;
    },
  } as unknown as FeatureContext);
  registerScatterGenerator('grid', gridGenerator);
});

afterEach(() => {
  for (const id of getScatterGeneratorIds()) unregisterScatterGenerator(id);
  scatterState.isInstalled = false;
});

describe('getScatter', () => {
  test('reads the loading scene’s data first, then the current one’s', () => {
    fns.scenes.next = { scatters: [scatter({ cellSize: 8 })] };
    expect(getScatter('rocks')?.cellSize).toBe(16);
    fns.loadingSceneId = 'next';
    expect(getScatter('rocks')?.cellSize).toBe(8);
    expect(getScatter('rocks', 'scene')?.cellSize).toBe(16);
    expect(getScatter('nope')).toBeUndefined();
  });
});

describe('spawnScatter', () => {
  test('throws without the feature, a scene, the scatter, its generator or an item’s asset', async () => {
    scatterState.isInstalled = false;
    await expect(spawnScatter('rocks')).rejects.toThrow(
      /instancing\(\) from 'aekasha\/instancing'/
    );
    scatterState.isInstalled = true;
    await expect(spawnScatter('nope')).rejects.toThrow(/doesn't have the scatter "nope"/);
    unregisterScatterGenerator('grid');
    await expect(spawnScatter('rocks')).rejects.toThrow(/generator "grid", which isn't registered/);
    fns.scenes.scene.scatters = [scatter({ items: [item('pebble'), item('nope')] })];
    await expect(spawnScatter('rocks')).rejects.toThrow(/item 1 names the geometry "nope"/);
    fns.currentSceneId = null;
    await expect(spawnScatter('rocks')).rejects.toThrow(/no scene is loading or current/);
  });

  test('places a generator’s instances in cells per item, picked by the weights', async () => {
    const target = { position: { x: 64, y: 2, z: 0 }, grid: { x: 1, z: 0 }, size: 32 };
    const spawned = await spawnScatter('rocks', { target, world });
    expect(spawned?.count).toBe(64);
    // A 32 m square from (48, -16): 4 cells of 16 m for each item
    expect(spawned?.entityIds).toHaveLength(8);
    const appIds = spawned!.entityIds.map((id) => world.getComponent(id, ComponentType.APP_ID));
    expect(appIds.map((appId) => appId?.id)).toContain('scatter/rocks/1/3,-1');

    const positions = positionsOf(spawned!.entityIds);
    expect(new Set(positions.map((p) => p.split('@')[1])).size).toBe(64);
    const pebbles = positions.filter((p) => p.startsWith('pebble@')).length;
    // About three quarters by the weights
    expect(pebbles).toBeGreaterThan(36);
    expect(pebbles).toBeLessThan(60);

    // The same seed and grid place give the same placements
    const again = await spawnScatter('rocks', { target, world, appId: 'again' });
    expect(positionsOf(again!.entityIds).sort()).toEqual([...positions].sort());

    spawned?.dispose();
    again?.dispose();
    expect(spawned!.entityIds.some((id) => world.isAlive(id))).toBe(false);
  });

  test('combines the seed with the world seed, the grid place and the id', () => {
    const seed = getScatterSeed('rocks', 1, { x: 0, z: 0 });
    expect(getScatterSeed('rocks', 1, { x: 0, z: 0 })).toBe(seed);
    expect(getScatterSeed('rocks', 1, { x: 1, z: 0 })).not.toBe(seed);
    expect(getScatterSeed('rocks', 1, { x: 0, z: 1 })).not.toBe(seed);
    expect(getScatterSeed('rocks', 2, { x: 0, z: 0 })).not.toBe(seed);
    expect(getScatterSeed('stones', 1, { x: 0, z: 0 })).not.toBe(seed);
    setRandomSeed(42);
    expect(getScatterSeed('rocks', 1, { x: 0, z: 0 })).not.toBe(seed);
    setRandomSeed(0x9e3779b9);
  });

  test('gives the generator the combined seed, and keeps its items and colours', async () => {
    const generator = vi.fn<ScatterGenerator>(() => ({
      matrices: new Float32Array([
        ...new THREE.Matrix4().toArray(),
        ...new THREE.Matrix4().toArray(),
      ]),
      items: new Uint8Array([1, 1]),
      colors: new Float32Array([1, 0, 0, 0, 1, 0]),
    }));
    unregisterScatterGenerator('grid');
    registerScatterGenerator('grid', generator);
    const spawned = await spawnScatter('rocks', { world });
    expect(generator).toHaveBeenCalledWith(
      expect.objectContaining({
        scatterId: 'rocks',
        params: { side: 8 },
        seed: getScatterSeed('rocks', 1, { x: 0, z: 0 }),
        target: { position: { x: 0, y: 0, z: 0 }, grid: { x: 0, z: 0 } },
      })
    );
    expect(positionsOf(spawned!.entityIds)).toEqual(['boulder@0,0', 'boulder@0,0']);
    const mesh = world.getComponent(spawned!.entityIds[0], ComponentType.OBJECT3D)!
      .value as THREE.InstancedMesh;
    expect(mesh.getColorAt(1, new THREE.Color()).toArray()).toEqual([0, 1, 0]);
    spawned?.dispose();
  });

  test('refuses a generator’s instances that don’t fit its items', async () => {
    unregisterScatterGenerator('grid');
    registerScatterGenerator('grid', () => ({
      matrices: new Float32Array(16),
      items: new Uint8Array([2]),
    }));
    await expect(spawnScatter('rocks', { world })).rejects.toThrow(/an item past the scatter's 2/);
  });

  test('places the placements from the target, with their items, rotations and scales', async () => {
    fns.scenes.scene.scatters = [
      scatter({
        source: {
          type: 'PLACEMENTS',
          seed: 0,
          placements: [
            { position: [1, 0, 2], item: 1, yaw: Math.PI / 2, scale: 2 },
            { position: [-1, 0, -2], item: 0, quaternion: [0, 0, 0, 1] },
          ],
        },
      }),
    ];
    const spawned = await spawnScatter('rocks', {
      target: { position: { x: 100, y: 5, z: 0 } },
      world,
    });
    expect(spawned?.count).toBe(2);
    expect(positionsOf(spawned!.entityIds).sort()).toEqual(['boulder@101,2', 'pebble@99,-2']);
    const boulderCell = spawned!.entityIds.find(
      (id) =>
        (world.getComponent(id, ComponentType.OBJECT3D)!.value as THREE.InstancedMesh).geometry
          .userData.id === 'boulder'
    )!;
    const matrix = (
      world.getComponent(boulderCell, ComponentType.OBJECT3D)!.value as THREE.InstancedMesh
    ).getMatrixAt(0, new THREE.Matrix4());
    const scale = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    matrix.decompose(new THREE.Vector3(), quaternion, scale);
    expect(scale.x).toBeCloseTo(2);
    expect(
      quaternion.angleTo(
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)
      )
    ).toBeCloseTo(0);
    spawned?.dispose();
    // Persistent here: released, not disposed
    expect(getGeometryRegistry().boulder?.count).toBe(0);
  });

  test('makes nothing and resolves null when the scene is left while the generator runs', async () => {
    let finish: () => void = () => {};
    unregisterScatterGenerator('grid');
    registerScatterGenerator(
      'grid',
      (input) =>
        new Promise((resolve) => {
          finish = () => resolve(gridGenerator(input));
        })
    );
    const pending = spawnScatter('rocks', { world });
    await Promise.resolve();
    exitHook?.();
    finish();
    expect(await pending).toBeNull();
    expect(getGeometryRegistry().pebble?.count).toBe(0);
  });
});
