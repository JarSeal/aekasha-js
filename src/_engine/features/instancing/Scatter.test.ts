import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { getGeometry, saveBufferGeometry, getGeometryRegistry } from '../../kernel/assets/Geometry';
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
import type {
  ImportedAssetManifest,
  ImportedGeometryInfo,
  ImportedInstances,
} from '../../kernel/assets/import/ImportTypes';
import { parseCustomProps } from '../../kernel/assets/import/CustomProps';

// The scene ids and data are stand-ins; the registries, the entities and the cells are real
const fns = vi.hoisted(() => ({
  loadingSceneId: null as string | null,
  currentSceneId: 'scene' as string | null,
  scenes: {} as Record<string, { scatters?: ScatterDef[] }>,
  imports: {} as Record<string, ImportedAssetManifest>,
}));
vi.mock(import('../../kernel/assets/import/ImportRegistry'), async (importOriginal) => ({
  ...(await importOriginal()),
  getImportedAsset: (id: string) => fns.imports[id],
}));
// The colliders' physics entities: plain entities of the world the create names
const physics = vi.hoisted(() => ({
  create: vi.fn(
    async (
      _props: { colliders: unknown; body?: unknown },
      opts: { world: { createEntity: () => number } }
    ) => opts.world.createEntity()
  ),
}));
vi.mock('../physics/PhysicsEntity', () => ({ createPhysicsEntity: physics.create }));
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
  collider: 'NONE' as const,
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
  fns.imports = {};
  installScatters({
    addSceneHooks: (hooks: SceneHooks) => {
      exitHook = hooks.exit as () => void;
    },
    isInstalled: (id: string) => id === 'physics',
  } as unknown as FeatureContext);
  physics.create.mockClear();
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

describe("spawnScatter's IMPORTED source", () => {
  const translations = (...points: [number, number, number][]) => {
    const matrices = new Float32Array(points.length * 16);
    points.forEach((p, i) => new THREE.Matrix4().makeTranslation(...p).toArray(matrices, i * 16));
    return matrices;
  };
  const at = (x: number, z: number) => ({
    position: { x, y: 0, z },
    quaternion: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
  });
  const node = (nodeName: string, geometryId: string, instances: ImportedInstances) =>
    ({
      geometryId,
      importId: 'coast',
      nodeName,
      parentPath: [],
      transform: at(2, 0),
      customProps: parseCustomProps({}),
      isDracoCompressed: false,
      instances,
    }) satisfies ImportedGeometryInfo;

  /** A node of two GPU instances drawing `boulder` at x 2, and three points at z -5 */
  const setImport = (items?: Int32Array) => {
    fns.imports.coast = {
      id: 'coast',
      fileName: 'coast.glb',
      textureIds: [],
      geometries: [
        {
          ...node('Ground', 'pebble', { matrices: translations([0, 0, 0]) }),
          instances: undefined,
        },
        node('Boulders', 'boulder', {
          matrices: translations([1, 0, 0], [0, 0, 1]),
          colors: new Float32Array([1, 0, 0, 0, 1, 0]),
        }),
      ],
      pointClouds: [
        {
          importId: 'coast',
          nodeName: 'Pebbles',
          parentPath: [],
          transform: at(0, -5),
          customProps: parseCustomProps({}),
          instances: {
            matrices: translations([0, 0, 0], [1, 0, 0], [2, 0, 0]),
            ...(items ? { items } : {}),
          },
        },
      ],
    };
  };
  const imported = (nodes?: string[]): ScatterDef['source'] => ({
    type: 'IMPORTED',
    importedAsset: 'coast',
    ...(nodes ? { nodes } : {}),
    seed: 0,
  });

  test("places the GPU instances by their geometry's item and the points by _ITEM, from the target", async () => {
    setImport(new Int32Array([0, 0, 1]));
    fns.scenes.scene.scatters = [scatter({ source: imported() })];
    const spawned = await spawnScatter('rocks', {
      target: { position: { x: 100, y: 0, z: 0 } },
      world,
    });
    expect(spawned?.count).toBe(5);
    expect(positionsOf(spawned!.entityIds).sort()).toEqual([
      'boulder@102,-5',
      'boulder@102,1',
      'boulder@103,0',
      'pebble@100,-5',
      'pebble@101,-5',
    ]);
    // The points have no colours: white beside the node's
    const colors = spawned!.entityIds.flatMap((id) => {
      const mesh = world.getComponent(id, ComponentType.OBJECT3D)!.value as THREE.InstancedMesh;
      return Array.from({ length: mesh.count }, (_, i) =>
        mesh.getColorAt(i, new THREE.Color()).getHexString()
      );
    });
    expect(colors.sort()).toEqual(['00ff00', 'ff0000', 'ffffff', 'ffffff', 'ffffff']);
    spawned?.dispose();
  });

  test("takes the nodes its globs match, and the weights pick the points' items without _ITEM", async () => {
    setImport();
    fns.scenes.scene.scatters = [scatter({ source: imported(['Peb*']) })];
    const spawned = await spawnScatter('rocks', { world });
    expect(spawned?.count).toBe(3);
    expect(
      positionsOf(spawned!.entityIds)
        .map((p) => p.split('@')[1])
        .sort()
    ).toEqual(['0,-5', '1,-5', '2,-5']);
    spawned?.dispose();
  });

  test("draws Blender's per-node mesh copy with the item of a plain node of its mesh, taken by its parent's name", async () => {
    // Blender's GPU Instances export: the instancer's child holds a copy of RockA's mesh
    fns.imports.coast = {
      id: 'coast',
      fileName: 'coast.glb',
      textureIds: [],
      geometries: [
        {
          ...node('RockA', 'boulder', { matrices: translations() }),
          instances: undefined,
          meshName: 'RockA',
        },
        {
          ...node('Scatter0', 'coast/Scatter0', { matrices: translations([1, 0, 0]) }),
          parentPath: ['Scatter'],
          meshName: 'RockA',
        },
      ],
    };
    fns.scenes.scene.scatters = [scatter({ source: imported(['Scatter']) })];
    const spawned = await spawnScatter('rocks', { world });
    expect(positionsOf(spawned!.entityIds)).toEqual(['boulder@3,0']);
    spawned?.dispose();
  });

  test('refuses an import not loaded, an _ITEM past the items, no node taken, a node no item draws and quantized geometries', async () => {
    fns.scenes.scene.scatters = [scatter({ source: imported() })];
    await expect(spawnScatter('rocks', { world })).rejects.toThrow(
      /the import "coast", which isn't loaded/
    );
    setImport(new Int32Array([0, 2, 0]));
    await expect(spawnScatter('rocks', { world })).rejects.toThrow(
      /point cloud "Pebbles" has the _ITEM 2, not one of the 2 items/
    );
    fns.scenes.scene.scatters = [scatter({ source: imported(['Trees*']) })];
    await expect(spawnScatter('rocks', { world })).rejects.toThrow(
      /no node of GPU instances or point cloud matching "Trees\*" \(it has "Boulders", "Pebbles"\)/
    );
    fns.scenes.scene.scatters = [scatter({ items: [item('pebble')], source: imported() })];
    await expect(spawnScatter('rocks', { world })).rejects.toThrow(
      /no item draws its node "Boulders" of GPU instances: an item's geometry is the node's "boulder"/
    );

    // Quantized (an import's default encode): its scale is in a node the scatter doesn't draw
    const quantized = new THREE.BufferGeometry().setAttribute(
      'position',
      new THREE.BufferAttribute(new Int16Array(9), 3, true)
    );
    saveBufferGeometry(quantized, { id: 'coast/Boulders', isPersistent: true });
    fns.scenes.scene.scatters = [scatter({ source: imported() })];
    fns.imports.coast.geometries[1].geometryId = 'coast/Boulders';
    await expect(spawnScatter('rocks', { world })).rejects.toThrow(
      /node "Boulders" of GPU instances has quantized positions.*"quantize": false/
    );
    fns.scenes.scene.scatters = [scatter({ items: [item('pebble'), item('coast/Boulders')] })];
    await expect(spawnScatter('rocks', { world })).rejects.toThrow(
      /item 1's geometry "coast\/Boulders" has quantized positions/
    );
    expect(getGeometryRegistry().pebble?.count).toBe(0);
  });
});

describe("spawnScatter's colliders (p308 D2)", () => {
  /** Hand-placed boulders (items 1 and 2) and a pebble (item 0, none) */
  const boulders = (collider: 'CONVEXHULL' | 'BALL') =>
    scatter({
      items: [
        item('pebble'),
        { ...item('boulder'), collider },
        { ...item('pebble'), collider: 'BALL' },
      ],
      source: {
        type: 'PLACEMENTS',
        placements: [
          { position: [0, 1, 0], item: 1, scale: 2, yaw: Math.PI / 2 },
          { position: [4, 0, 0], item: 0 },
          { position: [8, 0, 0], item: 2, scale: 3 },
        ],
        seed: 0,
      },
    });
  type CreateCall = {
    colliders: { type: string; vertices?: Float32Array; radius?: number };
    body: {
      rigidType: string;
      translation: { x: number; y: number; z: number };
      rotation: { x: number; y: number; z: number; w: number };
    };
  };
  const calls = () => physics.create.mock.calls.map(([props]) => props as unknown as CreateCall);

  test('makes a FIXED body per instance of a collider item, in instance order, scaled and turned as it is', async () => {
    fns.scenes.scene.scatters = [boulders('CONVEXHULL')];
    const spawned = await spawnScatter('rocks', {
      world,
      target: { position: { x: 10, y: 0, z: 0 } },
    });
    expect(spawned?.colliderIds).toHaveLength(2);
    const [hull, ball] = calls();
    expect(hull.body.rigidType).toBe('FIXED');
    expect(hull.body.translation).toEqual({ x: 10, y: 1, z: 0 });
    expect(hull.body.rotation.y).toBeCloseTo(Math.SQRT1_2, 6);
    expect(hull.body.rotation.w).toBeCloseTo(Math.SQRT1_2, 6);
    // The sphere's points, each once, twice as far out
    expect(hull.colliders.type).toBe('CONVEXHULL');
    const sphere = getGeometry('boulder')!.getAttribute('position');
    const unique = new Set(
      Array.from(
        { length: sphere.count },
        (_, i) => `${sphere.getX(i)},${sphere.getY(i)},${sphere.getZ(i)}`
      )
    );
    expect(hull.colliders.vertices).toHaveLength(unique.size * 3);
    const radii = new Set<number>();
    for (let i = 0; i < hull.colliders.vertices!.length; i += 3) {
      const [x, y, z] = hull.colliders.vertices!.subarray(i, i + 3);
      radii.add(Math.round(Math.hypot(x, y, z) * 1e4) / 1e4);
    }
    expect([...radii]).toEqual([2]);
    // The pebble's ball: its box's bounding sphere at 3 times its size
    expect(ball.body.translation).toEqual({ x: 18, y: 0, z: 0 });
    expect(ball.colliders).toMatchObject({ type: 'BALL', translation: { x: 0, y: 0, z: 0 } });
    expect(ball.colliders.radius).toBeCloseTo(Math.sqrt(0.75) * 3, 6);
    for (const entityId of spawned!.colliderIds) expect(world.isAlive(entityId)).toBe(true);
    spawned?.dispose();
    for (const entityId of spawned!.colliderIds) expect(world.isAlive(entityId)).toBe(false);
  });

  test('warns and makes none without physics(), and warns past 200 colliders', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    scatterState.hasPhysics = false;
    fns.scenes.scene.scatters = [boulders('BALL')];
    const spawned = await spawnScatter('rocks', { world });
    expect(spawned?.colliderIds).toEqual([]);
    expect(spawned?.entityIds.length).toBeGreaterThan(0);
    expect(physics.create).not.toHaveBeenCalled();
    expect(warn.mock.calls.flat().join('\n')).toMatch(
      /"rocks" has 2 instances of items with a collider, which need physics\(\)/
    );
    spawned?.dispose();

    scatterState.hasPhysics = true;
    warn.mockClear();
    fns.scenes.scene.scatters = [
      scatter({
        items: [{ ...item('boulder'), collider: 'BALL' }],
        source: { type: 'PROCEDURAL', generator: 'grid', params: { side: 15 }, seed: 1 },
      }),
    ];
    const many = await spawnScatter('rocks', { world });
    expect(many?.colliderIds).toHaveLength(225);
    expect(warn.mock.calls.flat().join('\n')).toMatch(/makes 225 colliders on its target/);
    many?.dispose();
    warn.mockRestore();
  });

  test('deletes the cells and the colliders made when one fails, and when the scene is left meanwhile', async () => {
    fns.scenes.scene.scatters = [boulders('BALL')];
    const before = world.getEntityCount();
    physics.create.mockImplementationOnce(async (_props, opts) => opts.world.createEntity());
    physics.create.mockRejectedValueOnce(new Error('no shape'));
    await expect(spawnScatter('rocks', { world })).rejects.toThrow(
      /the scatter "rocks"'s colliders: no shape/
    );
    expect(getGeometryRegistry().pebble?.count).toBe(0);
    expect(getGeometryRegistry().boulder?.count).toBe(0);
    expect(world.getEntityCount()).toBe(before);

    physics.create.mockImplementationOnce(async (_props, opts) => {
      exitHook?.();
      return opts.world.createEntity();
    });
    expect(await spawnScatter('rocks', { world })).toBeNull();
    expect(getGeometryRegistry().pebble?.count).toBe(0);
    expect(world.getEntityCount()).toBe(before);
  });
});
