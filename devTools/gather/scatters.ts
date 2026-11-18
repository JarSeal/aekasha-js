/**
 * Scatters (p308 D2): pass 1 registers each `*.scatter.json` with its defaults filled in
 * (`SCATTER_DEFAULTS`); the scene pass, after the terrain blocks (they add theirs to the scene's
 * `scatters`) and before the geometries and materials, writes each scatter a scene's `scatters`
 * lists into its data, once (where `instancing()`'s `spawnScatter` reads it), and appends each
 * item's geometry and material, and its LOD levels' `geo` / `mat`, to the scene's `geometries` and
 * `materials` when an asset JSON has the id. Any other id is an import's piece or one code
 * registers: the spawn throws naming it when it isn't registered. A scene with scatters gets
 * `instancing` in its manifest from the part's `scatters` field.
 */
import {
  SCATTER_DEFAULTS,
  ScatterAssetSchema,
  type ScatterAsset,
  type ScatterDef,
} from '../../src/_engine/schemas';
import { claimIds, readAssetJsons, type GatherContext, type Registries } from './context';
import type { TakenIds } from './context';
import { getIdFromFileName } from './gatheredJson';
import type { SceneRun } from './sceneAssets';
import { appendSceneListId } from './terrainBlocks';

/** The scatter with its defaults filled in, as scenes get it */
const toScatterDef = (scatter: ScatterAsset, id: string): ScatterDef => {
  const { items, source, cellSize, lod, debugData } = scatter;
  return {
    id,
    items: items.map((item) => ({
      geometry: item.geometry,
      material: item.material,
      weight: item.weight ?? SCATTER_DEFAULTS.weight,
      castShadow: item.castShadow ?? SCATTER_DEFAULTS.castShadow,
      receiveShadow: item.receiveShadow ?? SCATTER_DEFAULTS.receiveShadow,
    })),
    source:
      source.type === 'PROCEDURAL'
        ? {
            type: 'PROCEDURAL',
            generator: source.generator,
            params: source.params ?? {},
            seed: source.seed ?? SCATTER_DEFAULTS.seed,
          }
        : {
            type: 'PLACEMENTS',
            placements: source.placements,
            seed: source.seed ?? SCATTER_DEFAULTS.seed,
          },
    cellSize: cellSize ?? SCATTER_DEFAULTS.cellSize,
    ...(lod ? { lod } : {}),
    ...(debugData ? { debugData } : {}),
  };
};

/** Pass 1's scatters (before the terrain blocks: a block names its scatters) */
export const readScatters = (ctx: GatherContext, reg: Registries, taken: TakenIds) =>
  readAssetJsons(ctx, 'scatter', ScatterAssetSchema, (scatterJSON, { file, sourcePath }) => {
    const scatterId = scatterJSON.id || getIdFromFileName(file, 'scatter');
    if (!claimIds(ctx, taken.scatters, 'scatter', file, scatterId)) return;
    reg.scatters[scatterId] = { ...toScatterDef(scatterJSON, scatterId), __sourcePath: sourcePath };
  });

/**
 * The scene pass's scatters: each id the scene's `scatters` lists replaced by the scatter's data
 * (each once), its items' and LOD levels' geometry and material JSONs appended to the scene's
 * `geometries` and `materials` (unless listed). An id no scatter has fails the gather. After the
 * terrain blocks, before the geometries and materials (the appended ids resolve as listed ones).
 */
export const resolveScatters = ({ ctx, reg, scene, reportUnknownId }: SceneRun) => {
  if (!Array.isArray(scene.scatters)) return;
  const defs: ScatterDef[] = [];
  for (const scatterId of new Set(scene.scatters)) {
    const scatter = reg.scatters[scatterId];
    if (!scatter) {
      reportUnknownId('scatter', scatterId);
      continue;
    }
    const { __sourcePath, ...def } = scatter;
    if (ctx.isProduction) delete def.debugData;
    defs.push(def);
    const geometryIds = [
      ...def.items.map((item) => item.geometry),
      ...(def.lod?.levels ?? []).flatMap((level) => level.geo ?? []),
    ];
    const materialIds = [
      ...def.items.map((item) => item.material),
      ...(def.lod?.levels ?? []).flatMap((level) => level.mat ?? []),
    ];
    for (const id of geometryIds) {
      if (reg.geometries[id]) appendSceneListId(scene, 'geometries', id);
    }
    for (const id of materialIds) {
      if (reg.materials[id]) appendSceneListId(scene, 'materials', id);
    }
  }
  // The generated data's shape: the definitions in place of the ids
  scene.scatters = defs as unknown as string[];
};
