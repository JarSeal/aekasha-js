// The asset references in a TSL material's input values, as plain data (p302 D4, D6): which
// values are texture refs, texture array layers or atlas cells (p299 D5), and which assets an
// input needs. Import-free on purpose: the runtime's resolvers (MaterialInputResolvers.ts,
// TextureInputResolvers.ts) and the gather's dependency closure (p302 Phase 5) share it, and the
// dev tools load no three code (devTools/engineImports.test.ts). The array and atlas forms'
// dependencies are built in here, though their resolvers register only with the first array or
// atlas slot loaded: a material naming one that isn't loaded yet still lists it.

/**
 * An asset a material input needs loaded before the material is created: its type and id. A
 * resolver's `dependencies` returns these (`registerMaterialInputResolver`).
 */
export type MaterialInputDependency = {
  /** The asset type: a texture (`*.texture.json`). */
  type: 'texture';
  /** The asset's id. */
  id: string;
};

/**
 * A TSL input's object-form texture ref: `{ "texture": "id" }` is the texture node the bare id
 * string makes, and `"channel"` samples it and keeps those channels (`"r"`, `"a"`, `"rgb"`, …).
 */
export type TextureInputRef = {
  /** The texture's id. */
  texture: string;
  /** One to four of `r`, `g`, `b`, `a`: the sample's channels (a swizzle), instead of the
   * texture node. */
  channel?: string;
};

/**
 * A TSL input's texture array layer (p299 D5): `{ "textureArray": "id", "layer": "rock" }` is the
 * layer sampled at the mesh's UV. The node keeps its layer through `.sample(uv)`.
 */
export type TextureArrayInputRef = {
  /** The texture array's id: a texture array asset (`*.textureArray.json`), or in code any
   * registered array texture (`buildTextureArray`). */
  textureArray: string;
  /** The layer: its index, or its name (an asset's layer name, a runtime array's member). */
  layer: number | string;
};

/**
 * A TSL input's atlas cell (p299 D5): `{ "atlas": "id", "slot": "albedo", "cell": "fern" }` is the
 * slot sampled at the mesh's UV mapped into the cell's rect, so the mesh needs no remapped UVs.
 * The node is that sample: `.sample(uv)` on it would read the whole slot.
 */
export type AtlasCellInputRef = {
  /** The atlas's id (`*.textureAtlas.json`). */
  atlas: string;
  /** The slot's name: the texture sampled is `<atlas>.<slot>`. */
  slot: string;
  /** The cell's id. */
  cell: string;
  /** Keeps the sample half a texel inside the cell's content rect (`sampleAtlasCell`'s option).
   * Default true. */
  clampToCell?: boolean;
};

/**
 * The channels a texture ref's `channel` may name: a swizzle of one to four.
 * @internal
 */
export const TEXTURE_INPUT_CHANNEL_RE = /^[rgba]{1,4}$/;

/**
 * Whether a TSL input value is an object-form texture ref (a `texture` string; see
 * {@link TextureInputRef}). Its `channel` isn't checked here: the resolver throws on a bad one.
 * @internal
 */
export const isTextureInputRef = (value: unknown): value is TextureInputRef =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  typeof (value as { texture?: unknown }).texture === 'string';

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Whether a TSL input value is a texture array layer (a `textureArray` string; see
 * {@link TextureArrayInputRef}). Its `layer` isn't checked here: the resolver throws on a bad one.
 * @internal
 */
export const isTextureArrayInputRef = (value: unknown): value is TextureArrayInputRef =>
  isPlainObject(value) && typeof value.textureArray === 'string';

/**
 * Whether a TSL input value is an atlas cell (an `atlas` string; see {@link AtlasCellInputRef}).
 * Its `slot` and `cell` aren't checked here: the resolver throws on a bad one.
 * @internal
 */
export const isAtlasCellInputRef = (value: unknown): value is AtlasCellInputRef =>
  isPlainObject(value) && typeof value.atlas === 'string';

/**
 * An atlas slot's texture id, `<atlas>.<slot>` (as the gatherer registers each slot).
 * @internal
 */
export const getAtlasSlotTextureId = (atlas: string, slot: string) => `${atlas}.${slot}`;

/**
 * The texture a texture array layer input needs: the array.
 * @internal
 */
export const getTextureArrayInputDependencies = (value: unknown): MaterialInputDependency[] =>
  isTextureArrayInputRef(value) ? [{ type: 'texture', id: value.textureArray }] : [];

/**
 * The texture an atlas cell input needs: its slot's (none without a `slot` string).
 * @internal
 */
export const getAtlasCellInputDependencies = (value: unknown): MaterialInputDependency[] =>
  isAtlasCellInputRef(value) && typeof value.slot === 'string'
    ? [{ type: 'texture', id: getAtlasSlotTextureId(value.atlas, value.slot) }]
    : [];

/**
 * The textures a TSL input value of the texture ref forms needs: a bare texture id (a string not
 * starting with `#`) and an object-form texture ref. Any other value needs none.
 * @internal
 */
export const getTextureInputDependencies = (value: unknown): MaterialInputDependency[] => {
  if (typeof value === 'string') {
    return value.startsWith('#') ? [] : [{ type: 'texture', id: value }];
  }
  if (isTextureInputRef(value)) return [{ type: 'texture', id: value.texture }];
  return [];
};

/**
 * The textures a TSL input value of the built-in forms needs: a bare texture id, an object-form
 * texture ref, a texture array layer (the array) and an atlas cell (its slot). Any other value
 * needs none.
 * @internal
 */
export const getBuiltInInputDependencies = (value: unknown): MaterialInputDependency[] => {
  if (isTextureArrayInputRef(value)) return getTextureArrayInputDependencies(value);
  if (isAtlasCellInputRef(value)) return getAtlasCellInputDependencies(value);
  return getTextureInputDependencies(value);
};
