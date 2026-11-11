/**
 * Pass 1's merge material palettes (`*.mergeMaterial.json`, p374 D2): each checked against the
 * merge material's class from its members' material JSONs (D1, `checkMergeMaterialClass`) and
 * registered in the materials' id space. A class violation fails the gather, naming the member and
 * the property.
 */
import path from 'path';
import { MergeMaterialAssetSchema } from '../../src/_engine/schemas';
import { checkMergeMaterialClass, type MaterialLookup } from '../assetPipeline/mergeMaterialClass';
import {
  claimIds,
  readAssetJsons,
  type GatherContext,
  type Registries,
  type TakenIds,
} from './context';
import { getIdFromFileName } from './gatheredJson';

/** Pass 1's palettes, after the materials (a palette's members are material JSONs) */
export const readMergeMaterials = (ctx: GatherContext, reg: Registries, taken: TakenIds) => {
  const findMaterial: MaterialLookup = (id) =>
    reg.materials[id] && {
      jsonFile: path.resolve(ctx.rootDir, reg.materials[id].__sourcePath || ''),
      data: reg.materials[id],
    };
  readAssetJsons(
    ctx,
    'mergeMaterial',
    MergeMaterialAssetSchema,
    (paletteJSON, { file, sourcePath }) => {
      const { errors, warnings } = checkMergeMaterialClass(paletteJSON, findMaterial);
      for (const warning of warnings) ctx.log.warn(`${file}: ${warning}`);
      if (errors.length) {
        for (const error of errors) ctx.log.error(`${file}: ${error}`);
        return;
      }
      const paletteId = paletteJSON.id || getIdFromFileName(file, 'mergeMaterial');
      const label = 'material (or merge material)';
      if (!claimIds(ctx, taken.materials, label, file, paletteId)) return;
      paletteJSON.id = paletteId;
      paletteJSON.__sourcePath = sourcePath;
      delete paletteJSON.$schema;
      reg.mergeMaterials[paletteId] = paletteJSON;
    }
  );
};
