// A TSL material's texture set input (p303 D1), as plain data: the form, its predicate and the
// textures it needs. Import-free on purpose: the `textureSets()` feature's resolver and the
// gather's texture closure and streaming manifest share it (devTools/engineImports.test.ts), and
// the dependencies read the set through a lookup, since a slot's texture id is any id: the
// runtime's lookup is the app data, the gather's its registry.
import type { MaterialInputDependency } from '../../kernel/assets/MaterialInputRefs';
import type { TextureSetPacking } from '../../schemas/TextureSetSchema';

/**
 * A TSL input's texture set (p303 D1): `{ "textureSet": "sand01" }` is a bundle of the set's
 * default packing (`"packing"` picks another): each slot's texture node, and uniforms of the set's
 * `physicalSize`, `heightScale` and `surface` fields, by name (`inputs.ground.albedoRough`,
 * `inputs.ground.physicalSize`).
 */
export type TextureSetInputRef = {
  /** The texture set's id (`*.textureSet.json`). */
  textureSet: string;
  /** The packing sampled: `FULL`, `LITE` or `MINIMAL`. Default: the set's `defaultPacking`. */
  packing?: TextureSetPacking;
};

/**
 * What the dependencies read of a set: its default packing and its packings' slot texture ids.
 * @internal
 */
export type TextureSetPackingData = {
  /** The packing an input without `packing` samples. */
  defaultPacking: string;
  /** Each packing's texture ids by slot. */
  packings: Partial<Record<string, Record<string, string>>>;
};

/**
 * Finds a set's data by id, or undefined for an unknown one.
 * @internal
 */
export type TextureSetLookup = (id: string) => TextureSetPackingData | undefined;

/**
 * Whether a TSL input value is a texture set (a `textureSet` string; see
 * {@link TextureSetInputRef}). Its `packing` isn't checked here: the resolver throws on a bad one.
 * @internal
 */
export const isTextureSetInputRef = (value: unknown): value is TextureSetInputRef =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  typeof (value as { textureSet?: unknown }).textureSet === 'string';

/**
 * A set's texture ids of a packing, by slot (in the packing's slot order: the gathered data's),
 * or undefined when the set doesn't have the packing.
 * @internal
 */
export const getTextureSetSlotTextures = (set: TextureSetPackingData, packing: string) =>
  set.packings[packing];

/**
 * The textures a texture set input needs: its packing's (the set's default without one). None
 * for another value, a set the lookup doesn't know, or a packing the set doesn't have.
 * @internal
 */
export const getTextureSetInputDependencies = (
  value: unknown,
  getSet: TextureSetLookup
): MaterialInputDependency[] => {
  if (!isTextureSetInputRef(value)) return [];
  const set = getSet(value.textureSet);
  const slots = set && getTextureSetSlotTextures(set, value.packing ?? set.defaultPacking);
  return slots ? Object.values(slots).map((id) => ({ type: 'texture', id })) : [];
};

/**
 * A TSL input's texture set array (p303 D4): `{ "textureSetArray": ["sand01", "grass01"],
 * "packing": "LITE" }` is a bundle of the packing's array textures, layer `i` from the `i`th set
 * (`inputs.ground.albedoRough.sample(uv).depth(layer)`), and the layers' params (`layerParams`,
 * read with `getTextureSetLayerParams`, and `layerCount`). `{ "textureSetArray": "gallery" }` names
 * a built set array by id (one the scene lists, or one code built). The arrays are built with the
 * scene's load (or by `buildTextureSetArray` before a material from code).
 */
export type TextureSetArrayInputRef =
  | {
      /** The texture sets' ids, layer `i` from the `i`th. */
      textureSetArray: string[];
      /** The packing every layer is in: one array per slot. */
      packing: TextureSetPacking;
    }
  | {
      /** A built set array's id. */
      textureSetArray: string;
    };

/**
 * Whether a TSL input value is a texture set array (a `textureSetArray` string or array; see
 * {@link TextureSetArrayInputRef}). Its other fields aren't checked here: the resolver throws on a
 * bad one.
 * @internal
 */
export const isTextureSetArrayInputRef = (value: unknown): value is TextureSetArrayInputRef => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const sets = (value as { textureSetArray?: unknown }).textureSetArray;
  return typeof sets === 'string' || Array.isArray(sets);
};
