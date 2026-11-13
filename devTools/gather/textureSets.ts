/**
 * Texture sets (p303 D1): pass 1 registers each `*.textureSet.json` with its defaults filled in
 * (`defaultPacking`, every `surface` field), after checking that each slot names a texture asset;
 * the scene pass writes a scene's listed sets inline (a production build has only the scenes'
 * data, where the `textureSets()` feature's `getTextureSet` finds them) and appends each one's
 * default packing's textures to the scene's `textures`; the texture closure appends the sets its
 * materials' inputs name (`appendSceneTextureSets`), and a streaming scene keeps its listed sets'
 * textures in its base (`getListedTextureSetTextureIds`).
 */
import {
  isTextureSetColorSlot,
  TEXTURE_SET_PACKING_PREFERENCE,
  TEXTURE_SET_PACKINGS,
  TEXTURE_SET_SURFACE_DEFAULTS,
  TextureSetAssetSchema,
  type TextureSetAsset,
  type TextureSetDef,
  type TextureSetPacking,
} from '../../src/_engine/schemas';
import path from 'path';
import { getAssetResult } from '../assetPipeline/generated';
import { linearToSrgb } from '../assetPipeline/images';
import {
  claimIds,
  readAssetJsons,
  type GatherContext,
  type Registries,
  type TakenIds,
} from './context';
import { getIdFromFileName } from './gatheredJson';
import type { SceneRun } from './sceneAssets';

/** The packings a set gives, in the default's order (`TEXTURE_SET_PACKING_PREFERENCE`: zod
 * keeps no JSON order) */
const getPackings = (set: Pick<TextureSetAsset, 'packings'>) =>
  TEXTURE_SET_PACKING_PREFERENCE.filter((packing) => set.packings[packing]);

/**
 * A packing's texture ids of a set, in the packing's slot order (`TEXTURE_SET_PACKINGS`), or
 * undefined when the set doesn't have the packing.
 */
export const getTextureSetPackingTextureIds = (
  set: Pick<TextureSetAsset, 'packings'>,
  packing: TextureSetPacking
): string[] | undefined => {
  const slots = set.packings[packing] as Record<string, string> | undefined;
  if (!slots) return undefined;
  return TEXTURE_SET_PACKINGS[packing].map((slot) => slots[slot]);
};

/** What's wrong with a slot's texture id: none for a texture asset */
const getSlotError = (reg: Registries, texId: string) => {
  if (reg.textures[texId]) return null;
  if (reg.textureArrays[texId]) return `"${texId}" is a texture array, not a texture asset`;
  if (reg.atlasSlots[texId] || reg.atlasSlotIds[texId]) {
    return `"${texId}" is a texture atlas or its slot, not a texture asset`;
  }
  if (reg.mergeMaterialSlots[texId])
    return `"${texId}" is a merge material slot, not a texture asset`;
  return `no *.texture.json has the id "${texId}"`;
};

/**
 * Each slot's errors (a texture that isn't a texture asset) and warnings (a colour slot's texture
 * not sRGB, a data slot's sRGB: p303 D2's colour spaces), as `packings.<packing>.<slot>: …`.
 */
const checkSlots = (reg: Registries, set: TextureSetAsset) => {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const packing of getPackings(set)) {
    const slots = set.packings[packing] as Record<string, string>;
    for (const [slot, texId] of Object.entries(slots)) {
      const where = `packings.${packing}.${slot}`;
      const error = getSlotError(reg, texId);
      if (error) {
        errors.push(`${where}: ${error}`);
        continue;
      }
      const isSrgb = reg.textures[texId].texOpts?.colorSpace === 'srgb';
      if (isTextureSetColorSlot(slot) && !isSrgb) {
        warnings.push(
          `${where}: the texture "${texId}" isn't sRGB (texOpts.colorSpace "srgb"): its RGB is colour`
        );
      } else if (!isTextureSetColorSlot(slot) && isSrgb) {
        warnings.push(`${where}: the texture "${texId}" is sRGB, but this slot holds linear data`);
      }
    }
  }
  return { errors, warnings };
};

/** The set with its defaults filled in, as scenes get it (its `$schema` and `id` replaced) */
const toTextureSetDef = (
  set: TextureSetAsset,
  id: string
): TextureSetDef & { __sourcePath?: string } => {
  const { $schema, id: _id, defaultPacking, surface, ...rest } = set;
  return {
    id,
    ...rest,
    defaultPacking: defaultPacking ?? getPackings(set)[0],
    surface: { ...TEXTURE_SET_SURFACE_DEFAULTS, ...surface },
  };
};

/** A linear RGB as the JSON's sRGB `#rrggbb` */
const toSrgbHex = (color: readonly number[]) =>
  `#${color
    .map((v) =>
      Math.round(Math.min(1, Math.max(0, linearToSrgb(v))) * 255)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`;

/**
 * The average colour the asset pipeline measured for the set's albedo (p303 D1): its default
 * packing's colour slot's texture, as encoded (`averageColor`, recorded at the encode), as sRGB
 * `#rrggbb`. Undefined without a run, or for a texture without an encode's measure (passed
 * through, or encoded before p303).
 */
const getMeasuredAverageColor = (ctx: GatherContext, reg: Registries, set: TextureSetDef) => {
  if (!ctx.pipeline) return undefined;
  const slots = set.packings[set.defaultPacking] as Record<string, string> | undefined;
  const slot = TEXTURE_SET_PACKINGS[set.defaultPacking].find(isTextureSetColorSlot);
  const texture = slot && slots ? reg.textures[slots[slot]] : undefined;
  if (!texture) return undefined;
  const jsonFile = path.resolve(ctx.rootDir, texture.__sourcePath || '');
  const result = getAssetResult(ctx.pipeline, 'texture', jsonFile, texture);
  const color = result?.status === 'optimized' ? result.textures[0]?.averageColor : undefined;
  return color && toSrgbHex(color);
};

/** Pass 1's texture sets (after the textures: their slots name texture assets) */
export const readTextureSets = (ctx: GatherContext, reg: Registries, taken: TakenIds) =>
  readAssetJsons(ctx, 'textureSet', TextureSetAssetSchema, (setJSON, { file, sourcePath }) => {
    const { errors, warnings } = checkSlots(reg, setJSON);
    if (setJSON.defaultPacking && !setJSON.packings[setJSON.defaultPacking]) {
      errors.push(
        `defaultPacking "${setJSON.defaultPacking}" isn't one of its packings (${getPackings(setJSON).join(', ')})`
      );
    }
    for (const warning of warnings) ctx.log.warn(`${file}: ${warning}`);
    if (errors.length) {
      for (const error of errors) ctx.log.error(`${file}: ${error}`);
      return;
    }
    const setId = setJSON.id || getIdFromFileName(file, 'textureSet');
    if (!claimIds(ctx, taken.textureSets, 'texture set', file, setId)) return;
    const def = toTextureSetDef(setJSON, setId);
    // The JSON's own wins (D1); the measure is the default packing's albedo
    const averageColor = def.averageColor ?? getMeasuredAverageColor(ctx, reg, def);
    reg.textureSets[setId] = {
      ...def,
      ...(averageColor ? { averageColor } : {}),
      __sourcePath: sourcePath,
    };
  });

/** A registered set as a scene gets it: without its source path (and in a production build its
 * debug data) */
const toSceneTextureSet = (ctx: GatherContext, set: Registries['textureSets'][string]) => {
  const { __sourcePath, ...def } = set;
  if (ctx.isProduction) delete def.debugData;
  return def;
};

/** Appends texture ids to a scene's `textures`, each one the list doesn't name by id yet */
export const appendSceneTextureIds = (scene: SceneRun['scene'], ids: readonly string[]) => {
  const listed = new Set(
    (scene.textures ?? []).map((tex) => (typeof tex === 'string' ? tex : tex.id))
  );
  const added = ids.filter((id) => !listed.has(id) && listed.add(id));
  if (added.length) scene.textures = [...(scene.textures ?? []), ...added];
};

/**
 * The scene pass's texture sets: each id a scene lists replaced by the set's data (each once), and
 * its default packing's textures appended to the scene's `textures`. An id no set has fails the
 * gather. Before the texture closure and the textures: the appended ids resolve as listed ones.
 */
export const resolveTextureSets = ({ ctx, reg, scene, reportUnknownId }: SceneRun) => {
  if (!Array.isArray(scene.textureSets)) return;
  const defs: TextureSetDef[] = [];
  for (const setId of new Set(scene.textureSets)) {
    const set = reg.textureSets[setId];
    if (!set) {
      reportUnknownId('texture set', setId);
      continue;
    }
    defs.push(toSceneTextureSet(ctx, set));
    appendSceneTextureIds(scene, getTextureSetPackingTextureIds(set, set.defaultPacking) ?? []);
  }
  // The generated data's shape: the definitions in place of the ids
  scene.textureSets = defs as unknown as string[];
};

/**
 * Appends the sets of these ids to a scene's resolved `textureSets` (the texture closure's: the
 * sets its materials' inputs name), each one it doesn't have yet, without their textures (the
 * closure adds the packings the inputs sample). An id no set has is skipped: the closure reported
 * it.
 */
export const appendSceneTextureSets = ({ ctx, reg, scene }: SceneRun, ids: readonly string[]) => {
  const defs = (scene.textureSets ?? []) as unknown as TextureSetDef[];
  const has = new Set(defs.map((def) => def.id));
  const added = ids
    .filter((id) => reg.textureSets[id] && !has.has(id) && has.add(id))
    .map((id) => toSceneTextureSet(ctx, reg.textureSets[id]));
  if (added.length) scene.textureSets = [...defs, ...added] as unknown as string[];
};

/**
 * The default packing textures of the sets a scene lists for its code (its `textureSets` before
 * the scene pass): a streaming scene keeps them in its base, since code may use them anywhere.
 */
export const getListedTextureSetTextureIds = (reg: Registries, setIds: readonly unknown[]) =>
  setIds.flatMap((id) => {
    const set = typeof id === 'string' ? reg.textureSets[id] : undefined;
    return (set && getTextureSetPackingTextureIds(set, set.defaultPacking)) ?? [];
  });
