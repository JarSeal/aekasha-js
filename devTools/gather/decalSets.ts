/**
 * Decal sets (p309 D3): pass 1 registers each `*.decalSet.json` with its defaults filled in
 * (`DECAL_SET_DEFAULTS`), after checking that its import and its material are asset JSONs' ids;
 * the scene pass, after the terrain blocks (they add theirs to the scene's `decalSets`) and before
 * the materials and imports, writes each set a scene's `decalSets` lists into its data, once (where
 * the `terrain()` feature's `spawnDecalSet` reads it), and appends its import and material to the
 * scene's `importedAssets` and `materials`. The part's `decalSets` field puts `terrain` in the
 * manifest.
 */
import {
  DECAL_SET_DEFAULTS,
  DecalSetAssetSchema,
  type DecalSetAsset,
  type DecalSetDef,
} from '../../src/_engine/schemas';
import {
  claimIds,
  readAssetJsons,
  type GatherContext,
  type Registries,
  type TakenIds,
} from './context';
import { getIdFromFileName } from './gatheredJson';
import type { SceneRun } from './sceneAssets';
import { appendSceneListId } from './terrainBlocks';

/** What's wrong with a set's import and material ids: none when both are asset JSONs' */
const getDecalSetErrors = (reg: Registries, { importedAsset, material }: DecalSetAsset) => {
  const errors: string[] = [];
  if (!reg.importedAssets[importedAsset]) {
    errors.push(`importedAsset: no *.importedAsset.json has the id "${importedAsset}"`);
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

/** The set with its defaults filled in, as scenes get it */
const toDecalSetDef = (decalSet: DecalSetAsset, id: string): DecalSetDef => {
  const { importedAsset, material, renderOrder, receiveShadow, debugData } = decalSet;
  return {
    id,
    importedAsset,
    material,
    renderOrder: renderOrder ?? DECAL_SET_DEFAULTS.renderOrder,
    receiveShadow: receiveShadow ?? DECAL_SET_DEFAULTS.receiveShadow,
    ...(debugData ? { debugData } : {}),
  };
};

/** Pass 1's decal sets (after the materials and the imports: a set names them; before the terrain
 * blocks: a block names its sets) */
export const readDecalSets = (ctx: GatherContext, reg: Registries, taken: TakenIds) =>
  readAssetJsons(ctx, 'decalSet', DecalSetAssetSchema, (decalSetJSON, { file, sourcePath }) => {
    const errors = getDecalSetErrors(reg, decalSetJSON);
    if (errors.length) {
      for (const error of errors) ctx.log.error(`${file}: ${error}`);
      return;
    }
    const decalSetId = decalSetJSON.id || getIdFromFileName(file, 'decalSet');
    if (!claimIds(ctx, taken.decalSets, 'decal set', file, decalSetId)) return;
    reg.decalSets[decalSetId] = {
      ...toDecalSetDef(decalSetJSON, decalSetId),
      __sourcePath: sourcePath,
    };
  });

/**
 * The scene pass's decal sets: each id the scene's `decalSets` lists replaced by the set's data
 * (each once), its import and material appended to the scene's `importedAssets` and `materials`
 * (unless listed). An id no set has fails the gather. After the terrain blocks, before the
 * materials and imports (the appended ids resolve as listed ones).
 */
export const resolveDecalSets = ({ ctx, reg, scene, reportUnknownId }: SceneRun) => {
  if (!Array.isArray(scene.decalSets)) return;
  const defs: DecalSetDef[] = [];
  for (const decalSetId of new Set(scene.decalSets)) {
    const decalSet = reg.decalSets[decalSetId];
    if (!decalSet) {
      reportUnknownId('decal set', decalSetId);
      continue;
    }
    const { __sourcePath, ...def } = decalSet;
    if (ctx.isProduction) delete def.debugData;
    defs.push(def);
    appendSceneListId(scene, 'importedAssets', def.importedAsset);
    appendSceneListId(scene, 'materials', def.material);
  }
  // The generated data's shape: the definitions in place of the ids
  scene.decalSets = defs as unknown as string[];
};
