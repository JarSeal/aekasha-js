/**
 * Pass 1's merge material palettes (`*.mergeMaterial.json`, p374 D2): each checked against the
 * merge material's class from its members' material JSONs (D1) and resolved into its slots'
 * arrays (`resolveMergeMaterial`), then registered in the materials' id space, and each slot's
 * array as the texture `<paletteId>.<slot>` with its pipeline output. A class violation fails the
 * gather, naming the member and the property.
 */
import path from 'path';
import {
  MergeMaterialAssetSchema,
  type MergeMaterialAsset,
  type MergeMaterialSlotInfo,
} from '../../src/_engine/schemas';
import { getMergeMaterialSlotGeneratedFields } from '../assetPipeline/generated';
import type { MaterialLookup } from '../assetPipeline/mergeMaterialClass';
import { resolveMergeMaterial } from '../assetPipeline/mergeMaterials';
import { toRepoPath } from '../assetPipeline/sources';
import { getTextureArraySlotSettings, type TextureLookup } from '../assetPipeline/textureArrays';
import {
  claimIds,
  readAssetJsons,
  type GatherContext,
  type Registries,
  type TakenIds,
} from './context';
import { getIdFromFileName } from './gatheredJson';

/** Pass 1's palettes, after the textures and the materials (a palette's members are material
 * JSONs, their maps texture JSONs) */
export const readMergeMaterials = (ctx: GatherContext, reg: Registries, taken: TakenIds) => {
  const findMaterial: MaterialLookup = (id) =>
    reg.materials[id] && {
      jsonFile: path.resolve(ctx.rootDir, reg.materials[id].__sourcePath || ''),
      data: reg.materials[id],
    };
  const findTexture: TextureLookup = (id) =>
    reg.textures[id] && {
      jsonFile: path.resolve(ctx.rootDir, reg.textures[id].__sourcePath || ''),
      data: reg.textures[id],
    };
  readAssetJsons(
    ctx,
    'mergeMaterial',
    MergeMaterialAssetSchema,
    (paletteJSON, { file, fullPath, sourcePath }) => {
      const paletteId = paletteJSON.id || getIdFromFileName(file, 'mergeMaterial');
      const { slots, errors, warnings } = resolveMergeMaterial(
        fullPath,
        paletteId,
        paletteJSON,
        findMaterial,
        findTexture
      );
      for (const { slot, optimize } of slots) {
        try {
          getTextureArraySlotSettings(
            ctx.resolveSettings({ sourcePath: toRepoPath(fullPath), optimize }),
            `a palette's array (slots.${slot})`
          );
        } catch (e) {
          errors.push(`slots.${slot}: ${(e as Error).message}`);
        }
      }
      for (const warning of warnings) ctx.log.warn(`${file}: ${warning}`);
      if (errors.length) {
        for (const error of errors) ctx.log.error(`${file}: ${error}`);
        return;
      }
      const slotIds = slots.map((slot) => slot.id);
      if (!claimIds(ctx, taken.textures, 'texture (or a palette slot)', file, ...slotIds)) return;
      if (!claimIds(ctx, taken.materials, 'material (or merge material)', file, paletteId)) return;
      registerSlots(ctx, reg, paletteJSON, paletteId, slots, { fullPath, sourcePath });
      paletteJSON.id = paletteId;
      paletteJSON.__sourcePath = sourcePath;
      delete paletteJSON.$schema;
      reg.mergeMaterials[paletteId] = paletteJSON;
    }
  );
};

/** Each slot's array as a texture, and the palette's `__slots` */
const registerSlots = (
  ctx: GatherContext,
  reg: Registries,
  paletteJSON: MergeMaterialAsset,
  paletteId: string,
  slots: ReturnType<typeof resolveMergeMaterial>['slots'],
  file: { fullPath: string; sourcePath: string }
) => {
  const info: Partial<Record<(typeof slots)[number]['slot'], MergeMaterialSlotInfo>> = {};
  for (const { slot, id, texOpts, has } of slots) {
    const isSkipped = paletteJSON.slots[slot]?.missing === 'SKIP';
    info[slot] = { texture: id, has, ...(isSkipped ? { missing: 'SKIP' as const } : {}) };
    reg.mergeMaterialSlots[id] = {
      id,
      ...(Object.keys(texOpts).length ? { texOpts } : {}),
      ...(paletteJSON.throwOnError !== undefined ? { throwOnError: paletteJSON.throwOnError } : {}),
      ...(paletteJSON.userData ? { userData: paletteJSON.userData } : {}),
      ...(paletteJSON.debugData ? { debugData: paletteJSON.debugData } : {}),
      __sourcePath: file.sourcePath,
      __layers: [...paletteJSON.materials],
      __mergeMaterial: { id: paletteId, slot },
      ...getMergeMaterialSlotGeneratedFields(ctx.pipeline, file.fullPath, slot),
    };
  }
  paletteJSON.__slots = info;
};
