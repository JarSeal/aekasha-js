/**
 * Texture set arrays in the scene pass (p303 D4): a scene's `textureSetArrays` (listed, and the
 * ones its materials' `{ textureSetArray: [...], packing }` inputs name, which the texture closure
 * adds) are built by the `textureSets()` feature with the scene's load, before its materials. The
 * closure checks them (`getTextureSetArrayError`, `getTextureSetArrayInputError`) and writes them
 * with their sets (inline in the scene's `textureSets`, without textures). After the textures,
 * `declareTextureSetArrayMembers` writes each member texture the scene's `textures` doesn't hold
 * into its array's `__textures`, resolved as a listed texture is: the array loads it for itself in
 * a production build, where the scene's data is the only declaration, and the scene never loads it
 * on its own (no upload of its own: p303 D4's Risks).
 */
import type { SceneTextureSetArrayEntry, TextureSetPacking } from '../../src/_engine/schemas';
import type { TextureSetArrayInputRef } from '../../src/_engine/features/texturesets/TextureSetRefs';
import type { Registries } from './context';
import type { SceneRun } from './sceneAssets';
import { getTextureSetPackingTextureIds } from './textureSets';

/** A scene's set array as the gather writes it: its JSON entry, and the members' declarations */
type GatheredArray = SceneTextureSetArrayEntry & { __textures?: unknown[] };

/** A set array's identity for the dedupe: its packing and sets */
const getArrayKey = (packing: string, sets: readonly string[]) => JSON.stringify([packing, sets]);

/** Why a set array's sets don't fit its packing (a set no JSON has, or one without the packing),
 * or undefined */
export const getTextureSetArrayError = (
  reg: Registries,
  sets: readonly string[],
  packing: TextureSetPacking
) => {
  for (const setId of sets) {
    const set = reg.textureSets[setId];
    if (!set) return `no texture set (a *.textureSet.json) has the id "${setId}"`;
    // p304: members are assembled on the CPU, which a baked render target can't be
    if (set.procedural) {
      return `the texture set "${setId}" is procedural (generator "${set.procedural.generator}"), and a set array takes imported sets only (sample it through { textureSet })`;
    }
    if (!set.packings[packing]) {
      return `the texture set "${setId}" has no packing "${packing}" (packings: ${Object.keys(set.packings).join(', ')})`;
    }
  }
  return undefined;
};

/** The ids of the set arrays the scene lists (an entry with an `id`) */
export const getListedTextureSetArrayIds = ({ scene }: SceneRun) =>
  new Set(
    (scene.textureSetArrays ?? []).flatMap((entry) => (entry.id === undefined ? [] : [entry.id]))
  );

/** Why a `{ textureSetArray }` input doesn't fit: an id the scene lists no set array with, or a
 * list's sets, or undefined (the schema checks the shape) */
export const getTextureSetArrayInputError = (
  reg: Registries,
  listedIds: ReadonlySet<string>,
  value: TextureSetArrayInputRef
) => {
  if (typeof value.textureSetArray === 'string') {
    return listedIds.has(value.textureSetArray)
      ? undefined
      : `the scene's textureSetArrays has no set array with the id "${value.textureSetArray}"`;
  }
  if (!('packing' in value)) return `a texture set array list needs its "packing"`;
  return getTextureSetArrayError(reg, value.textureSetArray, value.packing);
};

/**
 * The scene's set arrays checked and completed: its listed ones (each set known with the packing,
 * each `id` once; errors logged, the entry dropped), then the lists its inputs name that no listed
 * entry without an `id` (a non-swappable one, the same derived id) has, each once. Returns the
 * sets they name, for the scene's `textureSets`.
 */
export const resolveTextureSetArrays = (
  run: SceneRun,
  named: readonly { sets: string[]; packing: TextureSetPacking }[]
) => {
  const { ctx, reg, sceneId, scene } = run;
  const arrays: GatheredArray[] = [];
  const keys = new Set<string>();
  const ids = new Set<string>();
  (scene.textureSetArrays ?? []).forEach((entry, i) => {
    const where = `Scene "${sceneId}": textureSetArrays[${i}]`;
    const error = getTextureSetArrayError(reg, entry.sets, entry.packing);
    if (error) {
      ctx.log.error(`${where}: ${error}.`);
      return;
    }
    if (entry.id !== undefined) {
      if (ids.has(entry.id)) {
        ctx.log.error(`${where}: the id "${entry.id}" is another entry's already.`);
        return;
      }
      ids.add(entry.id);
    } else if (!entry.swappable) {
      keys.add(getArrayKey(entry.packing, entry.sets));
    }
    arrays.push({ ...entry });
  });
  for (const { sets, packing } of named) {
    const key = getArrayKey(packing, sets);
    if (keys.has(key)) continue;
    keys.add(key);
    arrays.push({ sets: [...sets], packing });
  }
  scene.textureSetArrays = arrays.length ? arrays : undefined;
  return [...new Set(arrays.flatMap((entry) => entry.sets))];
};

/**
 * Writes each set array's member textures that the scene's resolved `textures` doesn't hold into
 * its `__textures` (each texture once, in the first array naming it), resolved by `resolveTexture`
 * (the scene pass's texture resolution: its save entry, generated fields and ship check). After
 * the textures are resolved.
 */
export const declareTextureSetArrayMembers = (
  run: SceneRun,
  resolveTexture: (texId: string) => unknown
) => {
  const { reg, scene } = run;
  const arrays = (scene.textureSetArrays ?? []) as GatheredArray[];
  if (!arrays.length) return;
  const declared = new Set(
    (scene.textures ?? []).map((tex) => (typeof tex === 'string' ? tex : tex.id))
  );
  for (const entry of arrays) {
    const textures: unknown[] = [];
    for (const setId of entry.sets) {
      const set = reg.textureSets[setId];
      for (const texId of (set && getTextureSetPackingTextureIds(set, entry.packing)) ?? []) {
        if (declared.has(texId)) continue;
        declared.add(texId);
        textures.push(resolveTexture(texId));
      }
    }
    if (textures.length) entry.__textures = textures;
  }
};
