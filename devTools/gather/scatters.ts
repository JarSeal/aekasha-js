/**
 * Scatters (p308 D2): pass 1 registers each `*.scatter.json` with its defaults filled in
 * (`SCATTER_DEFAULTS`); the scene pass, after the terrain blocks (they add theirs to the scene's
 * `scatters`) and before the geometries and materials, writes each scatter a scene's `scatters`
 * lists into its data, once (where `instancing()`'s `spawnScatter` reads it), and appends each
 * item's geometry and material, and its LOD levels' `geo` / `mat`, to the scene's `geometries` and
 * `materials` when an asset JSON has the id, and an `IMPORTED` source's import to its
 * `importedAssets` (pass 1 fails on an import id no JSON has). Any other id is an import's piece
 * or one code registers: the spawn throws naming it when it isn't registered. A scene with scatters gets
 * `instancing` in its manifest from the part's `scatters` field, and `physics` when an item has a
 * collider (`getScatterFeatureIds`). Pass 1 warns on a `PLACEMENTS` source that can make over 200
 * colliders (a procedural or imported source's count is the spawn's to warn on).
 */
import {
  SCATTER_COLLIDER_WARNING,
  SCATTER_DEFAULTS,
  ScatterAssetSchema,
  type ScatterAsset,
  type ScatterDef,
  type ScatterSourceDef,
} from '../../src/_engine/schemas';
import { claimIds, readAssetJsons, type GatherContext, type Registries } from './context';
import type { TakenIds } from './context';
import { getIdFromFileName } from './gatheredJson';
import type { SceneRun } from './sceneAssets';
import { appendSceneListId } from './terrainBlocks';

/** The source with its seed (and a generator's params) filled in */
const toSourceDef = (source: ScatterAsset['source']): ScatterSourceDef => {
  const seed = source.seed ?? SCATTER_DEFAULTS.seed;
  switch (source.type) {
    case 'PROCEDURAL':
      return { type: 'PROCEDURAL', generator: source.generator, params: source.params ?? {}, seed };
    case 'PLACEMENTS':
      return { type: 'PLACEMENTS', placements: source.placements, seed };
    case 'IMPORTED':
      return {
        type: 'IMPORTED',
        importedAsset: source.importedAsset,
        ...(source.nodes ? { nodes: source.nodes } : {}),
        seed,
      };
  }
};

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
      collider: item.collider ?? SCATTER_DEFAULTS.collider,
    })),
    source: toSourceDef(source),
    cellSize: cellSize ?? SCATTER_DEFAULTS.cellSize,
    ...(lod ? { lod } : {}),
    ...(debugData ? { debugData } : {}),
  };
};

/**
 * The colliders a `PLACEMENTS` source can make: its placements naming a collider item, and those
 * naming none when an item has one (the spawn picks theirs by weight); 0 for the other sources,
 * whose counts only the spawn knows (it warns then)
 */
const countPlacementColliders = ({ items, source }: ScatterAsset) => {
  if (source.type !== 'PLACEMENTS') return 0;
  const hasCollider = (index: number) => (items[index].collider ?? 'NONE') !== 'NONE';
  const anyCollider = items.some((_, index) => hasCollider(index));
  return source.placements.filter((placement) =>
    placement.item === undefined ? anyCollider : hasCollider(placement.item)
  ).length;
};

/** Pass 1's scatters (after the imports: an `IMPORTED` source names one; before the terrain
 * blocks: a block names its scatters) */
export const readScatters = (ctx: GatherContext, reg: Registries, taken: TakenIds) =>
  readAssetJsons(ctx, 'scatter', ScatterAssetSchema, (scatterJSON, { file, sourcePath }) => {
    const { source } = scatterJSON;
    if (source.type === 'IMPORTED' && !reg.importedAssets[source.importedAsset]) {
      ctx.log.error(
        `${file}: source.importedAsset: no *.importedAsset.json has the id "${source.importedAsset}"`
      );
      return;
    }
    const scatterId = scatterJSON.id || getIdFromFileName(file, 'scatter');
    if (!claimIds(ctx, taken.scatters, 'scatter', file, scatterId)) return;
    const colliders = countPlacementColliders(scatterJSON);
    if (colliders > SCATTER_COLLIDER_WARNING) {
      ctx.log.warn(
        `${file}: its placements make up to ${colliders} colliders, a FIXED body each (over ${SCATTER_COLLIDER_WARNING}): keep the colliders to the large pieces.`
      );
    }
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
    if (def.source.type === 'IMPORTED') {
      appendSceneListId(scene, 'importedAssets', def.source.importedAsset);
    }
  }
  // The generated data's shape: the definitions in place of the ids
  scene.scatters = defs as unknown as string[];
};

/**
 * The features a resolved scene's scatters need besides `instancing` (which its schema part gives):
 * `physics` when an item has a collider, so `InitEngine`'s scene check names `physics()`.
 */
export const getScatterFeatureIds = (scene: { scatters?: unknown }): string[] =>
  Array.isArray(scene.scatters) &&
  (scene.scatters as (ScatterDef | string)[]).some(
    (scatter) =>
      typeof scatter === 'object' && scatter.items.some((item) => item.collider !== 'NONE')
  )
    ? ['physics']
    : [];
