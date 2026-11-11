/**
 * Pass 1's merge material palettes (`*.mergeMaterial.json`, p374 D2): each checked against the
 * merge material's class from its members' material JSONs (D1) and resolved into its slots'
 * arrays (`resolveMergeMaterial`), then registered in the materials' id space with its members'
 * parameter table entries (`__entries`, D3), and each slot's array as the texture
 * `<paletteId>.<slot>` with its pipeline output. A class violation fails the gather, naming the
 * member and the property. The scene pass inlines the palettes a scene lists
 * (`resolveSceneMergeMaterials`, p374 Phase 2).
 */
import path from 'path';
import {
  MergeMaterialAssetSchema,
  type MergeMaterialAsset,
  type MergeMaterialSlotInfo,
  type SceneMergeMaterial,
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
import type { SceneRun } from './sceneAssets';

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
      const { slots, entries, state, errors, warnings } = resolveMergeMaterial(
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
      paletteJSON.__entries = entries;
      if (Object.keys(state).length) paletteJSON.__state = state;
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

/**
 * Fails the gather on a scene's `mergeGroups` entry naming a palette the scene doesn't list in
 * `mergeMaterials` (p374 Phase 3): only a listed palette's merge material is made in the scene.
 * Runs before the list is resolved (its ids).
 */
const checkMergeGroupPalettes = ({ ctx, sceneId, scene }: SceneRun) => {
  const listed = new Set(scene.mergeMaterials ?? []);
  for (const entry of scene.mergeGroups ?? []) {
    const paletteId = 'palette' in entry ? entry.palette : undefined;
    if (paletteId === undefined || listed.has(paletteId)) continue;
    ctx.log.error(
      `Scene "${sceneId}": its mergeGroups entry "${entry.id}" names the palette "${paletteId}", which the scene's mergeMaterials doesn't list: add "${paletteId}" there.`
    );
  }
};

/**
 * A scene's `mergeMaterials` (p374 Phase 2): each palette id replaced by its palette without the
 * build-time fields (`slots`, `optimize`; a production build without `debugData`), and its slot
 * textures added to the scene's `textures` (an id the scene lists already isn't added again), so
 * they load with them and get the production output check. Runs before the textures are
 * resolved.
 */
export const resolveSceneMergeMaterials = (run: SceneRun) => {
  const { ctx, reg, scene, reportUnknownId } = run;
  checkMergeGroupPalettes(run);
  if (!Array.isArray(scene.mergeMaterials)) return;
  const palettes: SceneMergeMaterial[] = [];
  const slotIds: string[] = [];
  for (const paletteId of scene.mergeMaterials) {
    const palette = reg.mergeMaterials[paletteId];
    if (!palette) {
      reportUnknownId('merge material', paletteId);
      continue;
    }
    const { materials, throwOnError, userData, debugData, __slots = {}, __entries = [] } = palette;
    const { __state } = palette;
    palettes.push({
      id: paletteId,
      materials,
      ...(throwOnError !== undefined ? { throwOnError } : {}),
      ...(userData ? { userData } : {}),
      ...(debugData && !ctx.isProduction ? { debugData } : {}),
      __slots,
      __entries,
      ...(__state ? { __state } : {}),
    });
    for (const info of Object.values(__slots)) slotIds.push(info.texture);
  }
  // The generated data's shape: the palettes in place of the ids
  scene.mergeMaterials = palettes as unknown as string[];
  const listed = new Set((scene.textures ?? []).filter((texId) => typeof texId === 'string'));
  const added = slotIds.filter((texId) => !listed.has(texId));
  if (added.length) scene.textures = [...(scene.textures ?? []), ...added];
};
