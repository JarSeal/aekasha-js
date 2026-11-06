// A streaming scene's JSON cell content (p353 Phase 3 D7): the gatherer's manifest
// (`SceneData.__streaming`, StreamingManifest.ts) turned into the units the machine
// (StreamingCells.ts) runs ahead of a cell's code-registered ones. Per cell: one async unit loading
// its cell-only assets in its owner key, then its lights and meshes a few a unit, the first of
// them waiting for the assets. An oversized mesh (in several cells' lists) is a unit of its own,
// counted across them: the first cell to load creates it, the last to unload deletes it.
import { getCellOwnerKey } from '../../kernel/assets/AssetOwners';
import { createSceneObject3Ds, loadSceneAssetsAsync } from '../../kernel/scene/SceneDataLoader';
import type { StreamingCellUnitSource } from './StreamingCells';
import type { StreamingCellContent } from './StreamingContent';
import type { StreamingManifest, StreamingManifestCell } from './StreamingManifest';

/** Entries (lights and meshes) per unit: a unit is the slice a frame's budget can't split */
const ENTRIES_PER_UNIT = 8;

const NO_UNITS: readonly StreamingCellUnitSource[] = [];

/** A shared (oversized) mesh's entity and how many of its cells hold it */
type SharedEntity = { entityId: number; holders: number };

/**
 * A scene's JSON cell content: the units per cell, built on a cell's first load and kept (the
 * data doesn't change), and its shared meshes' entities.
 * @internal
 */
export type StreamingDataContent = {
  /** The manifest it's built from. */
  readonly manifest: StreamingManifest;
  /** The cell's units, run ahead of its code-registered ones (none for a cell without data). */
  getUnits(cellKey: number): readonly StreamingCellUnitSource[];
  /** The shared meshes' entities alive, by manifest mesh index (the debug tab's). */
  readonly shared: ReadonlyMap<number, Readonly<SharedEntity>>;
};

const pick = <T>(list: readonly T[], indices: readonly number[] | undefined): T[] | undefined =>
  indices?.map((index) => list[index]);

/** The cell's cell-only assets as the loader's lists, or null without any */
const getCellAssetLists = (manifest: StreamingManifest, cell: StreamingManifestCell) => {
  const { assets } = manifest;
  if (!cell.textures && !cell.materials && !cell.geometries && !cell.importedAssets) return null;
  return {
    textures: pick(assets.textures, cell.textures),
    materials: pick(assets.materials, cell.materials),
    geometries: pick(assets.geometries, cell.geometries),
    importedAssets: pick(assets.importedAssets, cell.importedAssets),
  };
};

/** Which meshes more than one cell lists (oversized, D4) */
const findSharedMeshes = (manifest: StreamingManifest) => {
  const seen = new Set<number>();
  const shared = new Set<number>();
  for (const cell of Object.values(manifest.cells)) {
    for (const index of cell.meshes ?? []) {
      if (seen.has(index)) shared.add(index);
      seen.add(index);
    }
  }
  return shared;
};

/**
 * The units of a scene's JSON cell content, from its manifest.
 * @internal
 */
export const createStreamingDataContent = (
  sceneId: string,
  manifest: StreamingManifest
): StreamingDataContent => {
  const sharedMeshes = findSharedMeshes(manifest);
  const shared = new Map<number, SharedEntity>();
  const unitsByCell = new Map<number, readonly StreamingCellUnitSource[]>();

  /** A shared mesh's unit: created by its first holder, which gets its id (and primes it); the
   * others hold it without one. The last holder's unload deletes it. */
  const createSharedMeshUnit = (cellKey: number, index: number): StreamingCellContent => ({
    sceneId,
    cellKey,
    load: () => {
      const alive = shared.get(index);
      if (alive) {
        alive.holders++;
        return [];
      }
      const [entityId] = createSceneObject3Ds({ meshes: [manifest.meshes[index]] });
      if (entityId === undefined) return [];
      shared.set(index, { entityId, holders: 1 });
      return [entityId];
    },
    unload: (_entityIds, ctx) => {
      const alive = shared.get(index);
      if (!alive || --alive.holders > 0) return;
      shared.delete(index);
      if (ctx.world.isAlive(alive.entityId)) ctx.world.deleteEntity(alive.entityId);
    },
  });

  const buildUnits = (cellKey: number): readonly StreamingCellUnitSource[] => {
    const cell = manifest.cells[String(cellKey)];
    if (!cell) return NO_UNITS;
    const units: StreamingCellUnitSource[] = [];
    const assetLists = getCellAssetLists(manifest, cell);
    if (assetLists) {
      const ownerKey = getCellOwnerKey(sceneId, cellKey);
      units.push({
        waits: false,
        content: {
          sceneId,
          cellKey,
          load: async () => {
            await loadSceneAssetsAsync(assetLists, ownerKey);
            return [];
          },
        },
      });
    }
    // Lights first, then the meshes of this cell alone, a few a unit; the first waits for the
    // assets (and so does everything after it)
    const entries: ({ light: number } | { mesh: number })[] = [
      ...(cell.lights ?? []).map((light) => ({ light })),
      ...(cell.meshes ?? []).filter((mesh) => !sharedMeshes.has(mesh)).map((mesh) => ({ mesh })),
    ];
    const waits = () => !!assetLists && units.length === 1;
    for (let start = 0; start < entries.length; start += ENTRIES_PER_UNIT) {
      const chunk = entries.slice(start, start + ENTRIES_PER_UNIT);
      const lists = {
        lights: chunk.flatMap((e) => ('light' in e ? [manifest.lights[e.light]] : [])),
        meshes: chunk.flatMap((e) => ('mesh' in e ? [manifest.meshes[e.mesh]] : [])),
      };
      units.push({
        waits: waits(),
        content: { sceneId, cellKey, load: () => createSceneObject3Ds(lists) },
      });
    }
    for (const index of cell.meshes ?? []) {
      if (sharedMeshes.has(index)) {
        units.push({ waits: waits(), content: createSharedMeshUnit(cellKey, index) });
      }
    }
    return units;
  };

  return {
    manifest,
    shared,
    getUnits: (cellKey) => {
      let units = unitsByCell.get(cellKey);
      if (!units) {
        units = buildUnits(cellKey);
        unitsByCell.set(cellKey, units);
      }
      return units;
    },
  };
};
