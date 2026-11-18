import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import type { FeatureContext } from '../../kernel/init/Features';
import type {
  ImportedGeometryInfo,
  SpawnImportedParams,
} from '../../kernel/assets/import/ImportTypes';
import type { SceneHooks } from '../../kernel/scene/SceneHooks';
import type { DecalSetDef } from './DecalSetSchema';
import { getDecalSet, spawnDecalSet } from './DecalSets';
import { terrain } from './TerrainFeature';
import { terrainState } from './TerrainState';

// The kernel's scene data, registries, entities and import spawn are stand-ins
const fns = vi.hoisted(() => ({
  loadingSceneId: null as string | null,
  currentSceneId: 'scene' as string | null,
  scenes: {} as Record<string, { decalSets?: DecalSetDef[] }>,
  imports: {} as Record<string, { id: string; geometries: ImportedGeometryInfo[] }>,
  geometries: {} as Record<string, unknown>,
  materials: {} as Record<string, unknown>,
  deleteEntity: vi.fn(),
  onSpawn: undefined as (() => void) | undefined,
  spawnImportedAsset: vi.fn(
    async (manifest: { geometries: ImportedGeometryInfo[] }, params: SpawnImportedParams) => {
      fns.onSpawn?.();
      const nodes = manifest.geometries.filter((info) => params.filter?.(info) ?? true);
      return { meshEntityIds: nodes.map((_, i) => 20 + i), physicsEntityIds: [] };
    }
  ),
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
}));
vi.mock(import('../../kernel/assets/Material'), () => ({
  getMaterial: ((id: string) => fns.materials[id]) as never,
}));
vi.mock(import('../../kernel/assets/import/SpawnImported'), () => ({
  spawnImportedAsset: fns.spawnImportedAsset as never,
}));
vi.mock(import('../../kernel/ecs/ECSHelpers'), () => ({ deleteEntity: fns.deleteEntity }));

/** The set's decal material */
const MATERIAL = 'decalsGround_blend';

const decalSet = (fields: Partial<DecalSetDef> = {}): DecalSetDef => ({
  id: 'tracks',
  importedAsset: 'tracksMesh',
  material: MATERIAL,
  renderOrder: 10,
  receiveShadow: true,
  ...fields,
});

const nodeInfo = (nodeName: string, info: Partial<ImportedGeometryInfo> = {}) =>
  ({
    geometryId: `tracksMesh/${nodeName}`,
    importId: 'tracksMesh',
    nodeName,
    customProps: { isPhysObj: false },
    ...info,
  }) as ImportedGeometryInfo;

/** A decal's geometry: with `uv1`, or without */
const decalGeometry = (hasUv1 = true) => {
  const geometry = new THREE.BufferGeometry();
  if (hasUv1) geometry.setAttribute('uv1', new THREE.BufferAttribute(new Float32Array(2), 2));
  return geometry;
};

let exitHook: (() => void) | undefined;

const install = () => {
  const ctx = {
    isInstalled: () => false,
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
  fns.onSpawn = undefined;
  fns.scenes = { scene: { decalSets: [decalSet()] } };
  fns.imports = {
    tracksMesh: { id: 'tracksMesh', geometries: [nodeInfo('TrackA'), nodeInfo('TrackB')] },
  };
  fns.geometries = {
    'tracksMesh/TrackA': decalGeometry(),
    'tracksMesh/TrackB': decalGeometry(),
  };
  fns.materials = { [MATERIAL]: {} };
  install();
});

afterEach(() => {
  Object.assign(terrainState, { isInstalled: false, hasPhysics: false, hasInstancing: false });
});

describe('getDecalSet', () => {
  test('reads the loading scene’s data first, then the current one’s', () => {
    fns.scenes.next = { decalSets: [decalSet({ material: 'next' })] };
    expect(getDecalSet('tracks')?.material).toBe('decalsGround_blend');
    fns.loadingSceneId = 'next';
    expect(getDecalSet('tracks')?.material).toBe('next');
    expect(getDecalSet('tracks', 'scene')?.material).toBe('decalsGround_blend');
    expect(getDecalSet('nope')).toBeUndefined();
  });
});

describe('spawnDecalSet', () => {
  test('throws without the feature, a scene, the set in the scene’s list, its import or material', async () => {
    terrainState.isInstalled = false;
    await expect(spawnDecalSet('tracks')).rejects.toThrow(/terrain\(\) from 'aekasha\/terrain'/);
    install();
    await expect(spawnDecalSet('nope')).rejects.toThrow(
      /scene "scene" doesn't list the decal set "nope"/
    );
    delete fns.materials[MATERIAL];
    await expect(spawnDecalSet('tracks')).rejects.toThrow(
      /material "decalsGround_blend", which isn't loaded/
    );
    delete fns.imports.tracksMesh;
    await expect(spawnDecalSet('tracks')).rejects.toThrow(
      /import "tracksMesh", which isn't loaded/
    );
    fns.currentSceneId = null;
    await expect(spawnDecalSet('tracks')).rejects.toThrow(/no scene is loading or current/);
    expect(fns.spawnImportedAsset).not.toHaveBeenCalled();
  });

  test('spawns the import in its material and render order, casting no shadows', async () => {
    fns.scenes.scene.decalSets = [decalSet({ renderOrder: 12, receiveShadow: false })];
    const transform = { position: { x: 64, y: 0, z: -128 } };
    const spawned = await spawnDecalSet('tracks', { transform });
    expect(fns.spawnImportedAsset).toHaveBeenCalledWith(fns.imports.tracksMesh, {
      transform,
      material: MATERIAL,
      castShadow: false,
      receiveShadow: false,
      meshProps: [{ renderOrder: 12 }, { renderOrder: 12 }],
      filter: expect.any(Function),
      entityOpts: { appId: 'decalSet/tracks' },
    });
    expect(spawned).toMatchObject({ id: 'tracks', meshEntityIds: [20, 21] });
    spawned?.dispose();
    expect(fns.deleteEntity.mock.calls).toEqual([[20], [21]]);

    await spawnDecalSet('tracks', { appId: 'second' });
    expect(fns.spawnImportedAsset).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ entityOpts: { appId: 'second' } })
    );
  });

  test('skips a node with physics or GPU instances, and warns of a decal without uv1', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fns.imports.tracksMesh.geometries = [
      nodeInfo('TrackA'),
      nodeInfo('Collider', { customProps: { isPhysObj: true } as never }),
      nodeInfo('Prints', { instances: {} as never }),
      nodeInfo('TrackB'),
    ];
    fns.geometries['tracksMesh/TrackB'] = decalGeometry(false);
    const spawned = await spawnDecalSet('tracks');
    expect(spawned?.meshEntityIds).toEqual([20, 21]);
    const warnings = warn.mock.calls.flat().join('\n');
    expect(warnings).toMatch(/node "Collider" has physics custom props, .* skipped/);
    expect(warnings).toMatch(/node "Prints" has GPU instances, .* skipped/);
    expect(warnings).toMatch(/node "TrackB" has no second UV set \(uv1/);
    expect(warnings).not.toMatch(/TrackA/);
    warn.mockRestore();
  });

  test('deletes its meshes and resolves null when the scene is left while it spawns', async () => {
    fns.onSpawn = () => exitHook?.();
    expect(await spawnDecalSet('tracks')).toBeNull();
    expect(fns.deleteEntity.mock.calls).toEqual([[20], [21]]);
  });
});
