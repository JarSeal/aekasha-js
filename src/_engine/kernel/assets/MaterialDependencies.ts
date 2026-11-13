// What a material needs loaded before createMaterial builds it (p302 D6): its textures (its
// `params` texture slots and what its TSL inputs name) and its TSL file. A scene's JSON materials
// get theirs from the scene load (the gather's texture closure adds their textures to the scene's
// list); code that creates a material awaits ensureMaterialDependencies first.
import type { MaterialVariantOverrides, MatProps } from './Material';
import { getMaterialInputDependencies } from './MaterialInputResolvers';
import { loadTslMaterialFileAsync } from './MaterialTsl';
import { getTexture, loadTextureAsync, type TextureProps } from './Texture';
import { retagAssetOwner } from './AssetOwners';
import { getAppData } from '../scene/AppData';
import { textureMapKeys } from '../../utils/Constants';
import { lerror, lwarn } from '../../utils/Logger';

/** The fields of a material's props (or a variant's overrides) that name textures */
type MaterialTextureFields = { params?: unknown; inputs?: unknown; nodes?: unknown };

/** An input group's values (`inputs`, or a socket of `nodes`), `staticDefines` aside (defines) */
const addInputGroupTextureIds = (group: unknown, ids: Set<string>) => {
  if (!group || typeof group !== 'object') return;
  for (const [key, value] of Object.entries(group)) {
    if (key === 'staticDefines') continue;
    for (const dependency of getMaterialInputDependencies(value)) {
      if (dependency.type === 'texture') ids.add(dependency.id);
    }
  }
};

/**
 * The texture ids a material's props (or a variant's overrides) name: its `params` texture slots,
 * and its TSL `inputs` and `nodes` values that need a texture (a bare id, an object-form texture
 * ref, what a registered resolver's `dependencies` name).
 * @internal
 * @returns the ids, each once, in the order they're named
 */
export const getMaterialTextureIds = (props: MaterialTextureFields): string[] => {
  const ids = new Set<string>();
  const { params, inputs, nodes } = props;
  if (params && typeof params === 'object') {
    for (const key of textureMapKeys) {
      const id = (params as Record<string, unknown>)[key];
      if (typeof id === 'string') ids.add(id);
    }
  }
  addInputGroupTextureIds(inputs, ids);
  if (nodes && typeof nodes === 'object') {
    for (const socket of Object.values(nodes)) addInputGroupTextureIds(socket, ids);
  }
  return [...ids];
};

type TextureList = (string | TextureProps)[] | undefined;
type GeneratedScene = {
  textures?: TextureList;
  __streaming?: { assets?: { textures?: TextureList } };
};

const findInList = (list: TextureList, id: string) =>
  list?.find((entry): entry is TextureProps => typeof entry !== 'string' && entry.id === id);

/**
 * A texture's declaration in the app's data: the development build's texture section, else the
 * first scene entry with the id (a scene's `textures`, or a streaming scene's cell assets, with
 * that scene's save entry). A production build has only the scenes' entries, so a texture no
 * scene's data names has none.
 * @internal
 */
export const findTextureDeclaration = (id: string): TextureProps | undefined => {
  const json = getAppData().json;
  const section = json.textures as Record<string, TextureProps> | undefined;
  if (section?.[id]) return section[id];
  for (const scene of Object.values(json.scenes) as GeneratedScene[]) {
    const found =
      findInList(scene.textures, id) ?? findInList(scene.__streaming?.assets?.textures, id);
    if (found) return found;
  }
  return undefined;
};

/** Loads a texture id that isn't registered, from its declaration; a registered one is re-tagged
 * to the caller's owner (a cache hit). False when it has no declaration or its load fails. */
const ensureTextureAsync = async (id: string, materialId: string | undefined) => {
  const registered = getTexture(id);
  if (registered) {
    retagAssetOwner(registered);
    return true;
  }
  const declaration = findTextureDeclaration(id);
  if (!declaration) {
    lwarn(
      `ensureMaterialDependencies: no data declares the texture "${id}" of material "${materialId}" (in a production build, a scene's data must name it: list it in a scene's textures).`
    );
    return false;
  }
  try {
    await loadTextureAsync({ ...declaration, throwOnError: true });
    return true;
  } catch (err) {
    lerror(
      `ensureMaterialDependencies: could not load the texture "${id}" of material "${materialId}".`,
      err
    );
    return false;
  }
};

/**
 * Loads what a material needs before `createMaterial` builds it from code: the textures its
 * `params` texture slots and its TSL `inputs` and `nodes` name (a bare id, `{ texture }`, what a
 * registered input resolver's `dependencies` name) that aren't registered, and its TSL file
 * (`tslFile`; a `registerTslMaterial` graph needs none). A scene's JSON materials don't need it:
 * the scene load loads theirs. Pass a variant's overrides (`getMaterialVariant`) to load theirs.
 *
 * The textures load in the caller's owner scope, so they're the loading (or current) scene's, and
 * a registered one is re-tagged to it, as the scene load does. A texture is loaded from the app's
 * data, which in a production build holds only the textures a scene's data names: list one only
 * code uses in a scene's `textures`. A missing or failed texture is logged, and the material then
 * samples one white texel in its place, as with any missing texture.
 *
 * Calls may overlap: each awaits its own loads, and two loads of one texture register one.
 * Re-check the scene after the await before creating the material: a scene switch meanwhile
 * releases what the left scene loaded.
 * @param props the material's props, or a variant's overrides
 * @returns whether everything it names is loaded (false: something was logged)
 * @example
 * ```ts
 * import { createMaterial, ensureMaterialDependencies, type MatProps } from 'aekasha';
 *
 * const props: MatProps = {
 *   id: 'rustyPanel',
 *   type: 'STANDARD',
 *   params: { map: 'rustAlbedo', normalMap: 'rustNormal' },
 * };
 * // The scene's JSON doesn't list the two textures: load them first
 * await ensureMaterialDependencies(props);
 * const material = createMaterial(props);
 * ```
 */
export const ensureMaterialDependencies = async (
  props: MatProps | MaterialVariantOverrides
): Promise<boolean> => {
  const fields = props as MaterialTextureFields & {
    id?: string;
    tslFile?: string;
    tslMaterialId?: string;
  };
  const materialId = fields.id;
  const loads = getMaterialTextureIds(fields).map((id) => ensureTextureAsync(id, materialId));
  const tslMaterialId = fields.tslMaterialId || materialId || '';
  // Only a file the data has: a tslFile without one is a registration's, or createMaterial's error
  if (fields.tslFile && getAppData().tslMaterialFiles[tslMaterialId]) {
    loads.push(
      loadTslMaterialFileAsync(tslMaterialId).catch((err: unknown) => {
        lerror(
          `ensureMaterialDependencies: could not load the TSL file of "${tslMaterialId}".`,
          err
        );
        return false;
      })
    );
  }
  const results = await Promise.all(loads);
  return results.every(Boolean);
};
