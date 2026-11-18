import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import type { FeatureContext } from '../../kernel/init/Features';
import type { ImportedGeometryInfo } from '../../kernel/assets/import/ImportTypes';
import type { SceneHooks } from '../../kernel/scene/SceneHooks';
import type { TerrainBlockDef } from './TerrainBlockSchema';
import { getTerrainBlock, spawnTerrainBlock } from './TerrainBlocks';
import { terrain } from './TerrainFeature';
import {
  getTerrainGeneratorIds,
  registerTerrainGenerator,
  unregisterTerrainGenerator,
} from './TerrainGenerators';
import { terrainState } from './TerrainState';

// The kernel's scene data, registries and entities, and the collider module, are stand-ins
const fns = vi.hoisted(() => ({
  loadingSceneId: null as string | null,
  currentSceneId: 'scene' as string | null,
  scenes: {} as Record<string, { terrainBlocks?: TerrainBlockDef[] }>,
  imports: {} as Record<string, { geometries: ImportedGeometryInfo[] }>,
  geometries: {} as Record<string, unknown>,
  saveBufferGeometry: vi.fn((geometry: unknown) => geometry),
  getMaterialVariant: vi.fn(() => 'variant'),
  createMeshEntity: vi.fn(() => 7),
  deleteEntity: vi.fn(),
  createCollider: vi.fn(async () => 7 as number | undefined),
  spawnScatter: vi.fn(async (id: string) => ({
    id,
    entityIds: [id.length, id.length + 1],
    colliderIds: [id.length * 10],
    count: 2,
    dispose: vi.fn(),
  })),
}));
vi.mock(import('../../kernel/scene/Scene'), () => ({
  getLoadingSceneId: () => fns.loadingSceneId,
  getCurrentSceneId: () => fns.currentSceneId,
  getGeneratedSceneData: (id: string) => fns.scenes[id] as never,
}));
vi.mock(import('../../kernel/assets/import/ImportRegistry'), () => ({
  getImportedAsset: (id: string) => fns.imports[id] as never,
}));
vi.mock(import('../../kernel/assets/Geometry'), () => ({
  getGeometry: ((id: string) => fns.geometries[id]) as never,
  saveBufferGeometry: fns.saveBufferGeometry as never,
}));
vi.mock(import('../../kernel/assets/Material'), () => ({
  getMaterialVariant: fns.getMaterialVariant as never,
}));
vi.mock(import('../../kernel/mesh/Mesh'), () => ({ createMeshEntity: fns.createMeshEntity }));
vi.mock(import('../../kernel/ecs/ECSHelpers'), () => ({ deleteEntity: fns.deleteEntity }));
vi.mock(import('./TerrainCollider'), () => ({
  createTerrainBlockColliderAsync: fns.createCollider as never,
}));
vi.mock(import('../instancing/Scatter'), () => ({ spawnScatter: fns.spawnScatter as never }));

const block = (fields: Partial<TerrainBlockDef> = {}): TerrainBlockDef => ({
  id: 'coast',
  geometry: { importedAsset: 'ground', node: 'Block' },
  material: 'terrainMat',
  grid: { x: 1, z: -2, size: 64, resolution: 129 },
  collider: { type: 'HEIGHTFIELD' },
  shadows: { cast: true, receive: false },
  ...fields,
});

const nodeInfo = (nodeName: string, transform?: Partial<ImportedGeometryInfo['transform']>) =>
  ({
    geometryId: `ground/${nodeName}`,
    importId: 'ground',
    nodeName,
    transform: {
      position: { x: 0, y: 0, z: 0 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
      ...transform,
    },
  }) as ImportedGeometryInfo;

let exitHook: (() => void) | undefined;

/** Installs the feature with a stand-in context (`physics()` and `instancing()` before it or
 * not) */
const install = (hasPhysics = true, hasInstancing = true) => {
  const ctx = {
    isInstalled: (id: string) =>
      (hasPhysics && id === 'physics') || (hasInstancing && id === 'instancing'),
    addSceneHooks: (hooks: SceneHooks) => {
      exitHook = hooks.exit as () => void;
    },
  } as unknown as FeatureContext;
  void terrain().install(ctx);
};

beforeEach(() => {
  vi.clearAllMocks();
  fns.loadingSceneId = null;
  fns.currentSceneId = 'scene';
  fns.scenes = { scene: { terrainBlocks: [block()] } };
  fns.imports = { ground: { geometries: [nodeInfo('Block')] } };
  fns.geometries = { 'ground/Block': new THREE.BufferGeometry() };
  install();
});

afterEach(() => {
  for (const id of getTerrainGeneratorIds()) unregisterTerrainGenerator(id);
  Object.assign(terrainState, { isInstalled: false, hasPhysics: false, hasInstancing: false });
});

describe('getTerrainBlock', () => {
  test('reads the loading scene’s data first, then the current one’s', () => {
    fns.scenes.next = { terrainBlocks: [block({ material: 'next' })] };
    expect(getTerrainBlock('coast')?.material).toBe('terrainMat');
    fns.loadingSceneId = 'next';
    expect(getTerrainBlock('coast')?.material).toBe('next');
    expect(getTerrainBlock('coast', 'scene')?.material).toBe('terrainMat');
    expect(getTerrainBlock('nope')).toBeUndefined();
  });
});

describe('spawnTerrainBlock', () => {
  test('throws without the feature, a scene, or the block in the scene’s list', async () => {
    terrainState.isInstalled = false;
    await expect(spawnTerrainBlock('coast')).rejects.toThrow(/terrain\(\) from 'aekasha\/terrain'/);
    install();
    await expect(spawnTerrainBlock('nope')).rejects.toThrow(
      /scene "scene" doesn't list the terrain block "nope"/
    );
    fns.currentSceneId = null;
    await expect(spawnTerrainBlock('coast')).rejects.toThrow(/no scene is loading or current/);
  });

  test('spawns an imported block at its grid place, with its shadows and collider', async () => {
    const spawned = await spawnTerrainBlock('coast');
    expect(fns.createMeshEntity).toHaveBeenCalledWith({
      geo: fns.geometries['ground/Block'],
      mat: 'terrainMat',
      castShadow: true,
      receiveShadow: false,
      position: { x: 64, y: 0, z: -128 },
      appId: 'terrainBlock/coast',
    });
    expect(fns.createCollider).toHaveBeenCalledWith({
      block: block(),
      geometry: fns.geometries['ground/Block'],
      info: fns.imports.ground.geometries[0],
      heightfield: undefined,
      meshEntityId: 7,
    });
    expect(spawned).toMatchObject({ id: 'coast', meshEntityId: 7, physicsEntityId: 7 });
    expect(spawned).toMatchObject({ scatterIds: [], decalIds: [] });
    spawned?.dispose();
    expect(fns.deleteEntity).toHaveBeenCalledWith(7);
  });

  test('gives the mesh its inputs’ material variant, and the app id asked for', async () => {
    fns.scenes.scene.terrainBlocks = [block({ materialInputs: { splatMap: 'splat' } })];
    await spawnTerrainBlock('coast', { appId: 'second' });
    expect(fns.getMaterialVariant).toHaveBeenCalledWith('terrainMat', {
      inputs: { splatMap: 'splat' },
    });
    expect(fns.createMeshEntity).toHaveBeenCalledWith(
      expect.objectContaining({ mat: 'variant', appId: 'second' })
    );
  });

  test('takes an import’s only mesh without a node, and refuses two or a wrong node', async () => {
    fns.scenes.scene.terrainBlocks = [block({ geometry: { importedAsset: 'ground' } })];
    await spawnTerrainBlock('coast');
    expect(fns.createMeshEntity).toHaveBeenCalledTimes(1);

    fns.imports.ground.geometries.push(nodeInfo('Rocks'));
    await expect(spawnTerrainBlock('coast')).rejects.toThrow(
      /has 2 meshes \(Block, Rocks\): name the block's in its geometry.node/
    );
    fns.scenes.scene.terrainBlocks = [block({ geometry: { importedAsset: 'ground', node: 'X' } })];
    await expect(spawnTerrainBlock('coast')).rejects.toThrow(/has no node "X"/);
    delete fns.imports.ground;
    await expect(spawnTerrainBlock('coast')).rejects.toThrow(/import "ground", which isn't loaded/);
  });

  test('refuses an import’s quantized positions, whose scale is in the node', async () => {
    const quantized = new THREE.BufferGeometry();
    quantized.setAttribute('position', new THREE.BufferAttribute(new Int16Array(3), 3, true));
    fns.geometries['ground/Block'] = quantized;
    await expect(spawnTerrainBlock('coast')).rejects.toThrow(
      /quantized positions .* "optimize": \{ "profile": "terrainBlock" \}/
    );
  });

  test('warns on a node transform, which the grid place replaces', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fns.imports.ground.geometries = [nodeInfo('Block', { scale: { x: 2, y: 1, z: 2 } })];
    await spawnTerrainBlock('coast');
    expect(warn.mock.calls.flat().join(' ')).toMatch(/has a transform, which the block ignores/);
    warn.mockRestore();
  });

  test('spawns a generated block from its registered generator, its heightfield passed on', async () => {
    const geometry = new THREE.BufferGeometry();
    const heightfield = { type: 'HEIGHTFIELD' as const, nrows: 1, ncols: 1, heights: [0, 0, 0, 0] };
    const generator = vi.fn(() => ({ geometry, heightfield }) as never);
    registerTerrainGenerator('noise', generator);
    const generated = block({ geometry: { generator: 'noise', params: { h: 2 }, seed: 5 } });
    fns.scenes.scene.terrainBlocks = [generated];
    await spawnTerrainBlock('coast');
    expect(generator).toHaveBeenCalledWith({
      blockId: 'coast',
      params: { h: 2 },
      seed: 5,
      grid: generated.grid,
    });
    expect(fns.saveBufferGeometry).toHaveBeenCalledWith(geometry, expect.anything());
    expect(fns.createCollider).toHaveBeenCalledWith(
      expect.objectContaining({ geometry, heightfield, info: undefined })
    );
  });

  test('names the registered generators for an unknown one', async () => {
    registerTerrainGenerator('noise', () => ({ geometry: new THREE.BufferGeometry() }));
    fns.scenes.scene.terrainBlocks = [block({ geometry: { generator: 'x', params: {}, seed: 0 } })];
    await expect(spawnTerrainBlock('coast')).rejects.toThrow(
      /generator "x", which isn't registered \(registered: noise\)/
    );
  });

  test('needs physics() for a collider, and makes none for NONE', async () => {
    install(false);
    await expect(spawnTerrainBlock('coast')).rejects.toThrow(/needs physics\(\) listed before/);
    fns.scenes.scene.terrainBlocks = [block({ collider: { type: 'NONE' } })];
    const spawned = await spawnTerrainBlock('coast');
    expect(fns.createCollider).not.toHaveBeenCalled();
    expect(spawned?.physicsEntityId).toBeUndefined();
  });

  test('returns null and deletes what it made when the scene leaves while it spawns', async () => {
    // Left during the generator: the geometry is disposed, nothing registered or made
    const geometry = new THREE.BufferGeometry();
    const dispose = vi.spyOn(geometry, 'dispose');
    registerTerrainGenerator('slow', () => {
      exitHook?.();
      return { geometry };
    });
    fns.scenes.scene.terrainBlocks = [
      block({ geometry: { generator: 'slow', params: {}, seed: 0 } }),
    ];
    await expect(spawnTerrainBlock('coast')).resolves.toBeNull();
    expect(dispose).toHaveBeenCalled();
    expect(fns.saveBufferGeometry).not.toHaveBeenCalled();
    expect(fns.createMeshEntity).not.toHaveBeenCalled();

    // Left during the collider's create: the mesh entity (and its body) goes
    fns.scenes.scene.terrainBlocks = [block()];
    fns.createCollider.mockImplementationOnce(async () => {
      exitHook?.();
      return 7;
    });
    await expect(spawnTerrainBlock('coast')).resolves.toBeNull();
    expect(fns.deleteEntity).toHaveBeenCalledWith(7);
  });
});

describe('spawnTerrainBlock: scatters (p308 D2)', () => {
  test('spawns each scatter on the block, and its dispose deletes their cells and colliders too', async () => {
    fns.scenes.scene.terrainBlocks = [block({ scatter: ['rocks', 'pebbles'] })];
    const spawned = await spawnTerrainBlock('coast');
    const target = {
      position: { x: 64, y: 0, z: -128 },
      grid: { x: 1, z: -2 },
      size: 64,
      entityId: 7,
    };
    expect(fns.spawnScatter.mock.calls).toEqual([
      ['rocks', { target, appId: 'terrainBlock/coast/scatter/rocks' }],
      ['pebbles', { target, appId: 'terrainBlock/coast/scatter/pebbles' }],
    ]);
    // Each scatter's cells, then its colliders
    expect(spawned?.scatterIds).toEqual([5, 6, 50, 7, 8, 70]);
    spawned?.dispose();
    for (const { value } of fns.spawnScatter.mock.results) {
      expect((await value).dispose).toHaveBeenCalledOnce();
    }
    expect(fns.deleteEntity).toHaveBeenCalledWith(7);
  });

  test('throws without instancing(), and deletes the block when a scatter throws', async () => {
    fns.scenes.scene.terrainBlocks = [block({ scatter: ['rocks'] })];
    install(true, false);
    await expect(spawnTerrainBlock('coast')).rejects.toThrow(/need instancing\(\) listed before/);
    expect(fns.createMeshEntity).not.toHaveBeenCalled();

    install();
    fns.spawnScatter.mockRejectedValueOnce(new Error('no generator'));
    await expect(spawnTerrainBlock('coast')).rejects.toThrow('no generator');
    expect(fns.deleteEntity).toHaveBeenCalledWith(7);
  });

  test('deletes the block and resolves null when the scene is left while a scatter spawns', async () => {
    fns.scenes.scene.terrainBlocks = [block({ scatter: ['rocks'], collider: { type: 'NONE' } })];
    fns.spawnScatter.mockImplementationOnce(async (id: string) => {
      exitHook?.();
      return { id, entityIds: [1], colliderIds: [], count: 1, dispose: vi.fn() };
    });
    expect(await spawnTerrainBlock('coast')).toBeNull();
    expect(fns.deleteEntity).toHaveBeenCalledWith(7);
    expect((await fns.spawnScatter.mock.results[0].value).dispose).toHaveBeenCalledOnce();
  });
});
