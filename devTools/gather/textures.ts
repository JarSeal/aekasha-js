/**
 * Pass 1's textures: texture assets, texture arrays and atlases (one id space, every one a
 * texture at runtime), and the impostors exported into atlases.
 */
import path from 'path';
import {
  getAtlasSlotTextureId,
  ImpostorAssetSchema,
  TextureArrayAssetSchema,
  TextureAssetSchema,
  TextureAtlasAssetSchema,
} from '../../src/_engine/schemas';
import {
  getImpostorDefSlots,
  IMPOSTOR_EXPORT_FORMAT_VERSION,
} from '../../src/_engine/features/lod/impostors/ImpostorFormat';
import {
  GENERATED_FIELD_KEYS,
  getTextureArrayGeneratedFields,
  getTextureAtlasSlotGeneratedFields,
} from '../assetPipeline/generated';
import { toRepoPath } from '../assetPipeline/sources';
import {
  getTextureArraySlotSettings,
  resolveTextureArrayLayers,
  type TextureLookup,
} from '../assetPipeline/textureArrays';
import { getAtlasCellTable, resolveTextureAtlas } from '../assetPipeline/textureAtlases';
import {
  claimIds,
  readAssetJsons,
  type GatherContext,
  type Registries,
  type TakenIds,
} from './context';
import { getIdFromFileName } from './gatheredJson';
import { checkAssetSources, getSourceFileSize, setGeneratedFields } from './sources';

const readTextures = (ctx: GatherContext, reg: Registries, taken: TakenIds) =>
  readAssetJsons(ctx, 'texture', TextureAssetSchema, (texJSON, { file, fullPath, sourcePath }) => {
    if (!checkAssetSources(ctx, file, fullPath, texJSON)) return;
    const texId = texJSON.id || getIdFromFileName(file, 'texture');
    if (!claimIds(ctx, taken.textures, 'texture', file, texId)) return;
    texJSON.__sourcePath = sourcePath;
    texJSON.__fileSize = getSourceFileSize(fullPath, texJSON.fileName, texJSON.path);
    setGeneratedFields(ctx, texJSON, 'texture', fullPath);
    texJSON.id = texId;
    delete texJSON.$schema;
    reg.textures[texId] = texJSON;
  });

// Texture arrays (p299 D2): textures at runtime, in the textures' registry and id space. After
// the textures: a layer can be a texture asset's source.
const readTextureArrays = (
  ctx: GatherContext,
  reg: Registries,
  taken: TakenIds,
  findTexture: TextureLookup
) =>
  readAssetJsons(
    ctx,
    'textureArray',
    TextureArrayAssetSchema,
    (arrayJSON, { file, fullPath, sourcePath }) => {
      const { layers, errors } = resolveTextureArrayLayers(
        fullPath,
        arrayJSON.layers,
        findTexture,
        { isSrgb: arrayJSON.texOpts?.colorSpace === 'srgb' }
      );
      try {
        getTextureArraySlotSettings(
          ctx.resolveSettings({ sourcePath: toRepoPath(fullPath), optimize: arrayJSON.optimize })
        );
      } catch (e) {
        errors.push((e as Error).message);
      }
      if (errors.length) {
        for (const error of errors) ctx.log.error(`${file}: ${error}`);
        return;
      }
      const arrayId = arrayJSON.id || getIdFromFileName(file, 'textureArray');
      if (!claimIds(ctx, taken.textures, 'texture (or texture array)', file, arrayId)) return;
      arrayJSON.__sourcePath = sourcePath;
      arrayJSON.__layers = layers.map((layer) => layer.key);
      for (const key of GENERATED_FIELD_KEYS) delete (arrayJSON as Record<string, unknown>)[key];
      Object.assign(arrayJSON, getTextureArrayGeneratedFields(ctx.pipeline, fullPath));
      arrayJSON.id = arrayId;
      delete arrayJSON.$schema;
      reg.textureArrays[arrayId] = arrayJSON;
    }
  );

// Texture atlases (p299 D3): each slot is a texture at runtime (`<atlasId>.<slot>`), in the
// textures' registry and id space; the atlas id is taken too (a scene lists it for every slot).
// After the textures: a cell's source can be a texture asset's.
const readTextureAtlases = (
  ctx: GatherContext,
  reg: Registries,
  taken: TakenIds,
  findTexture: TextureLookup
) =>
  readAssetJsons(
    ctx,
    'textureAtlas',
    TextureAtlasAssetSchema,
    (atlasJSON, { file, fullPath, sourcePath }) => {
      const { layout, errors, warnings } = resolveTextureAtlas(fullPath, atlasJSON, findTexture);
      for (const [slot, { optimize }] of Object.entries(atlasJSON.slots)) {
        try {
          getTextureArraySlotSettings(
            ctx.resolveSettings({ sourcePath: toRepoPath(fullPath), optimize }),
            'an atlas slot'
          );
        } catch (e) {
          errors.push(`slots.${slot}: ${(e as Error).message}`);
        }
      }
      for (const warning of warnings) ctx.log.warn(`${file}: ${warning}`);
      if (errors.length || !layout) {
        for (const error of errors) ctx.log.error(`${file}: ${error}`);
        return;
      }
      const atlasId = atlasJSON.id || getIdFromFileName(file, 'textureAtlas');
      const slotIds = Object.keys(atlasJSON.slots).map((slot) =>
        getAtlasSlotTextureId(atlasId, slot)
      );
      const label = 'texture (or a texture atlas or its slot)';
      if (!claimIds(ctx, taken.textures, label, file, atlasId, ...slotIds)) return;
      reg.atlasSlotIds[atlasId] = slotIds;
      const cells = getAtlasCellTable(layout);
      for (const [slot, slotJSON] of Object.entries(atlasJSON.slots)) {
        const slotId = getAtlasSlotTextureId(atlasId, slot);
        const userData = { ...atlasJSON.userData, ...slotJSON.userData };
        const debugData = slotJSON.debugData ?? atlasJSON.debugData;
        reg.atlasSlots[slotId] = {
          id: slotId,
          ...(slotJSON.texOpts ? { texOpts: slotJSON.texOpts } : {}),
          ...(atlasJSON.throwOnError !== undefined ? { throwOnError: atlasJSON.throwOnError } : {}),
          ...(Object.keys(userData).length ? { userData } : {}),
          ...(debugData ? { debugData } : {}),
          __sourcePath: sourcePath,
          __atlas: {
            id: atlasId,
            slot,
            size: layout.size,
            padding: layout.padding,
            levels: layout.levels,
            ...(layout.mipChain === 'FULL' ? { mipChain: 'FULL' as const } : {}),
            ...(slotJSON.image ? { fromImage: true as const } : {}),
            cells,
          },
          ...getTextureAtlasSlotGeneratedFields(ctx.pipeline, fullPath, slot),
        };
      }
    }
  );

// Exported impostors (p351 Phase 4), in their own id space. After the atlases: an impostor's
// atlas must have its kind's slots, at its layout's size.
const readImpostors = (ctx: GatherContext, reg: Registries, taken: TakenIds) =>
  readAssetJsons(ctx, 'impostor', ImpostorAssetSchema, (impostorJSON, { file, sourcePath }) => {
    const errors: string[] = [];
    const slotIds = reg.atlasSlotIds[impostorJSON.atlas];
    if (!slotIds) {
      errors.push(`its atlas "${impostorJSON.atlas}" isn't a *.textureAtlas.json id`);
    } else {
      const slots = new Set(slotIds.map((id) => reg.atlasSlots[id].__atlas.slot));
      const reads = getImpostorDefSlots(impostorJSON);
      const missing = reads.filter((slot) => !slots.has(slot));
      if (missing.length) {
        errors.push(
          `its atlas "${impostorJSON.atlas}" has no slot ${missing.map((slot) => `"${slot}"`).join(', ')} (this ${impostorJSON.kind} impostor reads ${reads.join(', ')})`
        );
      }
      const { atlasSize } = impostorJSON.layout;
      const [layoutWidth, layoutHeight] =
        typeof atlasSize === 'number' ? [atlasSize, atlasSize] : atlasSize;
      const [width, height] = reg.atlasSlots[slotIds[0]].__atlas.size;
      if (width !== layoutWidth || height !== layoutHeight) {
        errors.push(
          `its atlas "${impostorJSON.atlas}" is ${width}×${height}, its layout's atlasSize is ${layoutWidth}×${layoutHeight}`
        );
      }
    }
    if (errors.length) {
      for (const error of errors) ctx.log.error(`${file}: ${error}`);
      return;
    }
    // The runtime refuses another format and bakes instead: valid, but worth a re-export
    if (impostorJSON.formatVersion !== IMPOSTOR_EXPORT_FORMAT_VERSION) {
      ctx.log.warn(
        `${file}: export format ${impostorJSON.formatVersion}, the engine's is ${IMPOSTOR_EXPORT_FORMAT_VERSION}. Scenes listing it don't load it, and the runtime bakes it instead: re-export it (the LOD tab's Impostors).`
      );
    }
    const impostorId = impostorJSON.id || getIdFromFileName(file, 'impostor');
    if (!claimIds(ctx, taken.impostors, 'impostor', file, impostorId)) return;
    impostorJSON.id = impostorId;
    impostorJSON.__sourcePath = sourcePath;
    delete impostorJSON.$schema;
    reg.impostors[impostorId] = impostorJSON;
  });

/** Pass 1's textures, arrays, atlases and impostors, in that order (each reads the ones before) */
export const readTextureAssets = (ctx: GatherContext, reg: Registries, taken: TakenIds) => {
  readTextures(ctx, reg, taken);
  // A texture asset by id, for the arrays' layers and the atlases' cells
  const findTexture: TextureLookup = (id) =>
    reg.textures[id] && {
      jsonFile: path.resolve(ctx.rootDir, reg.textures[id].__sourcePath || ''),
      data: reg.textures[id],
    };
  readTextureArrays(ctx, reg, taken, findTexture);
  readTextureAtlases(ctx, reg, taken, findTexture);
  readImpostors(ctx, reg, taken);
};
