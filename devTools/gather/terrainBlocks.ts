/**
 * Terrain blocks (p306 D2): pass 1 registers each `*.terrainBlock.json` with its defaults filled in
 * (`TERRAIN_BLOCK_DEFAULTS`), after checking that its import and its material are asset JSONs'
 * ids; the scene pass writes the blocks a scene lists into its data (where the `terrain()`
 * feature's `spawnTerrainBlock` finds them) and adds each one's import, material and scatters to
 * the scene's `importedAssets`, `materials` and `scatters`, so they load with the scene (the texture closure adds
 * the textures its `materialInputs` name). A scene listing a block with a collider names `physics`
 * in its manifest (`getTerrainBlockFeatureIds`), so a missing `physics()` fails the boot.
 */
import {
  TERRAIN_BLOCK_DEFAULTS,
  TerrainBlockAssetSchema,
  type TerrainBlockAsset,
  type TerrainBlockDef,
} from '../../src/_engine/schemas';
import {
  claimIds,
  readAssetJsons,
  type GatherContext,
  type Registries,
  type TakenIds,
} from './context';
import { getIdFromFileName } from './gatheredJson';
import type { SceneJSON, SceneRun } from './sceneAssets';

/** What's wrong with a block's import, material and scatter ids: none when all are asset JSONs' */
const getBlockErrors = (reg: Registries, block: TerrainBlockAsset) => {
  const errors: string[] = [];
  const { geometry, material, scatter } = block;
  for (const scatterId of scatter ?? []) {
    if (!reg.scatters[scatterId])
      errors.push(`scatter: no *.scatter.json has the id "${scatterId}"`);
  }
  if ('importedAsset' in geometry && !reg.importedAssets[geometry.importedAsset]) {
    errors.push(
      `geometry.importedAsset: no *.importedAsset.json has the id "${geometry.importedAsset}"`
    );
  }
  if (!reg.materials[material]) {
    errors.push(
      reg.mergeMaterials[material]
        ? `material: "${material}" is a merge material palette, not a material`
        : `material: no *.material.json has the id "${material}"`
    );
  }
  return errors;
};

/** The block with its defaults filled in, as scenes get it */
const toTerrainBlockDef = (block: TerrainBlockAsset, id: string): TerrainBlockDef => {
  const { geometry, material, materialInputs, grid, collider, shadows, scatter, debugData } = block;
  const { friction, restitution } = collider ?? {};
  return {
    id,
    geometry:
      'generator' in geometry
        ? {
            generator: geometry.generator,
            params: geometry.params ?? {},
            seed: geometry.seed ?? TERRAIN_BLOCK_DEFAULTS.seed,
          }
        : {
            importedAsset: geometry.importedAsset,
            ...(geometry.node ? { node: geometry.node } : {}),
          },
    material,
    ...(materialInputs && Object.keys(materialInputs).length ? { materialInputs } : {}),
    grid: {
      x: grid.x ?? TERRAIN_BLOCK_DEFAULTS.grid.x,
      z: grid.z ?? TERRAIN_BLOCK_DEFAULTS.grid.z,
      size: grid.size,
      resolution: grid.resolution,
    },
    collider: {
      type: collider?.type ?? TERRAIN_BLOCK_DEFAULTS.collider.type,
      ...(friction !== undefined ? { friction } : {}),
      ...(restitution !== undefined ? { restitution } : {}),
    },
    shadows: {
      cast: shadows?.cast ?? TERRAIN_BLOCK_DEFAULTS.shadows.cast,
      receive: shadows?.receive ?? TERRAIN_BLOCK_DEFAULTS.shadows.receive,
    },
    ...(scatter?.length ? { scatter: [...new Set(scatter)] } : {}),
    ...(debugData ? { debugData } : {}),
  };
};

/** Pass 1's terrain blocks (after the materials, the imports and the scatters: a block names
 * them) */
export const readTerrainBlocks = (ctx: GatherContext, reg: Registries, taken: TakenIds) =>
  readAssetJsons(
    ctx,
    'terrainBlock',
    TerrainBlockAssetSchema,
    (blockJSON, { file, sourcePath }) => {
      const blockId = blockJSON.id || getIdFromFileName(file, 'terrainBlock');
      const errors = getBlockErrors(reg, blockJSON);
      if (errors.length) {
        for (const error of errors) ctx.log.error(`${file}: ${error}`);
        return;
      }
      if (!claimIds(ctx, taken.terrainBlocks, 'terrain block', file, blockId)) return;
      reg.terrainBlocks[blockId] = {
        ...toTerrainBlockDef(blockJSON, blockId),
        __sourcePath: sourcePath,
      };
    }
  );

/** Appends an id to one of a scene's lists, unless the list names it already (by id or inline) */
export const appendSceneListId = (
  scene: SceneJSON,
  key: 'importedAssets' | 'materials' | 'geometries' | 'scatters',
  id: string
) => {
  const list = (scene[key] ?? []) as readonly (string | { id?: string })[];
  if (list.some((entry) => (typeof entry === 'string' ? entry : entry.id) === id)) return;
  (scene as Record<string, unknown>)[key] = [...list, id];
};

/**
 * The scene pass's terrain blocks: each id a scene lists replaced by the block's data (each once),
 * its import, material and scatters appended to the scene's `importedAssets`, `materials` and
 * `scatters` (unless listed). An id no block has fails the gather. Before the scatters, materials
 * and imports are resolved (the appended ids resolve as listed ones) and the texture closure (it
 * reads the blocks' `materialInputs`).
 */
export const resolveTerrainBlocks = ({ ctx, reg, scene, reportUnknownId }: SceneRun) => {
  if (!Array.isArray(scene.terrainBlocks)) return;
  const defs: TerrainBlockDef[] = [];
  for (const blockId of new Set(scene.terrainBlocks)) {
    const block = reg.terrainBlocks[blockId];
    if (!block) {
      reportUnknownId('terrain block', blockId);
      continue;
    }
    const { __sourcePath, ...def } = block;
    if (ctx.isProduction) delete def.debugData;
    defs.push(def);
    if ('importedAsset' in def.geometry) {
      appendSceneListId(scene, 'importedAssets', def.geometry.importedAsset);
    }
    appendSceneListId(scene, 'materials', def.material);
    for (const scatterId of def.scatter ?? []) appendSceneListId(scene, 'scatters', scatterId);
  }
  // The generated data's shape: the definitions in place of the ids
  scene.terrainBlocks = defs as unknown as string[];
};

/** A resolved scene's terrain blocks (the scene pass wrote their data in place of the ids) */
export const getSceneTerrainBlocks = (scene: { terrainBlocks?: unknown }): TerrainBlockDef[] =>
  Array.isArray(scene.terrainBlocks)
    ? (scene.terrainBlocks as unknown[]).filter(
        (block): block is TerrainBlockDef => !!block && typeof block === 'object'
      )
    : [];

/**
 * The features a resolved scene's terrain blocks need besides `terrain` (which its schema part
 * gives): `physics` when one has a collider, so `InitEngine`'s scene check names `physics()`.
 */
export const getTerrainBlockFeatureIds = (scene: { terrainBlocks?: unknown }): string[] =>
  getSceneTerrainBlocks(scene).some((block) => block.collider.type !== 'NONE') ? ['physics'] : [];
