import { beforeAll, describe, expect, test } from 'vitest';
import * as THREE from 'three/webgpu';
import { getAssetOwners, getCellOwnerKey } from '../../kernel/assets/AssetOwners';
import { getMaterial } from '../../kernel/assets/Material';
import { countReleasedAssets, releaseCellOwnedAssets } from '../../kernel/assets/SceneAssetRelease';
import { ECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import { createRootScene } from '../../kernel/scene/Scene';
import { packCellKey } from '../../utils/CellKey';
import {
  createStreamingRuntime,
  decideStreamingCells,
  pumpStreamingCells,
  type StreamingBudgets,
} from './StreamingCells';
import type { StreamingCellContext } from './StreamingContent';
import { createStreamingDataContent } from './StreamingDataContent';
import type { StreamingManifest } from './StreamingManifest';
import { resolveStreamingSettings } from './StreamingSettings';

// A scene's JSON cell content (p353 Phase 3 D7) on the real kernel: the default world and the
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

const mesh = (appId: string, x: number, mat = 'dcMat') => ({
  props: { appId, geo: { type: 'BOX' as const }, mat, position: { x, y: 0, z: 10 } },
});

const createManifest = (sceneId: string): StreamingManifest => ({
  cellSize: 64,
  meshes: [
    ...Array.from({ length: 10 }, (_, i) => mesh(`${sceneId}-m${i}`, 5 + i)),
    // In both cells: oversized
    mesh(`${sceneId}-bridge`, 64, 'dcSharedMat'),
  ],
  lights: [{ lightProps: { type: 'POINT', position: { x: 20, y: 2, z: 20 } } }],
  assets: {
    textures: [],
    materials: [
      { id: `${sceneId}-mat`, type: 'BASIC' },
      { id: 'dcSharedMat', type: 'BASIC' },
    ],
    geometries: [],
    importedAssets: [],
  },
  cells: {
    [String(A)]: {
      meshes: [...Array.from({ length: 10 }, (_, i) => i), 10],
      lights: [0],
      materials: [0, 1],
      bounds: [0, 0, 64, 64],
      bytesEstimate: 0,
    },
    [String(B)]: { meshes: [10], materials: [1], bounds: [64, 0, 128, 64], bytesEstimate: 0 },
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
  test('a cell’s units: its assets, then its entries a few a unit (the first waiting), then its shared meshes', () => {
    const content = createStreamingDataContent('dcUnits', manifestFor('dcUnits'));
    const units = content.getUnits(A);
    expect(units.map((unit) => unit.waits)).toEqual([false, true, false, false]);
    expect(content.getUnits(A)).toBe(units);
    expect(content.getUnits(packCellKey(9, 0, 9))).toEqual([]);
  });

  test('a shared mesh: the first holder creates it, the last to unload deletes it', async () => {
    const content = createStreamingDataContent('dcShared', manifestFor('dcShared'));
    // Its material first: the cell's asset unit
    await content.getUnits(A)[0].content.load(ctxFor(A));
    const sharedOf = (cellKey: number) => {
      const units = content.getUnits(cellKey);
      return units[units.length - 1].content;
    };
    const fromA = sharedOf(A).load(ctxFor(A)) as number[];
    expect(fromA).toHaveLength(1);
    expect(sharedOf(B).load(ctxFor(B))).toEqual([]);
    sharedOf(A).unload?.(fromA, ctxFor(A));
    expect(world.isAlive(fromA[0])).toBe(true);
    sharedOf(B).unload?.([], ctxFor(B));
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
      (cellKey) => countReleasedAssets(releaseCellOwnedAssets(sceneId, cellKey))
    );
    rt.dataContent = createStreamingDataContent(sceneId, manifestFor(sceneId)).getUnits;
    const budgets: StreamingBudgets = { maxConcurrentLoads: 4, maxCreateMsPerFrame: 1000 };

    decideStreamingCells(rt, 32, 32);
    pumpStreamingCells(rt, budgets);
    await new Promise((resolve) => setTimeout(resolve, 0));
    pumpStreamingCells(rt, budgets);
    const cell = rt.cells.get(A);
    expect(cell?.phase).toBe('LOADED');
    // 10 meshes and the light, and the bridge
    const ids = cell?.units.flatMap((unit) => unit.entityIds ?? []) ?? [];
    expect(ids).toHaveLength(12);
    const material = getMaterial(`${sceneId}-mat`);
    expect(material && getAssetOwners(material)).toEqual([getCellOwnerKey(sceneId, A)]);
    expect(world.getComponent(ids[0], ComponentType.OBJECT3D)?.value).toBeInstanceOf(
      THREE.PointLight
    );

    decideStreamingCells(rt, 5000, 5000);
    pumpStreamingCells(rt, budgets);
    expect(rt.cells.has(A)).toBe(false);
    expect(ids.every((id) => !world.isAlive(id))).toBe(true);
    expect(rt.stats.assetReleases).toBe(1);
  });
});
