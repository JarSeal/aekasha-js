// The asset references in a TSL material's input values, as plain data (p302 D4, D6): which
// values are texture refs and which assets an input needs. Import-free on purpose: the runtime's
// resolvers (MaterialInputResolvers.ts) and the gather's dependency closure (p302 Phase 5) share
// it, and the dev tools load no three code (devTools/engineImports.test.ts).

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

/**
 * The textures a TSL input value of the built-in forms needs: a bare texture id (a string not
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
