// The material input resolvers of texture arrays and atlases (p299 D5): a TSL material's input
// `{ textureArray, layer }` samples an array layer, `{ atlas, slot, cell }` an atlas cell, both at
// the mesh's UV. Not the kernel's install (it would put the array and atlas helpers in every
// build): Texture.ts imports this module (`import()`) and registers both with the first array or
// atlas slot it loads, before that load resolves, so a scene's JSON materials (created after its
// textures) find them. Their dependencies are built-in forms (MaterialInputRefs.ts), known before.
import type * as THREE from 'three/webgpu';
import { texture, uv } from 'three/tsl';
import {
  type AtlasCellInputRef,
  getAtlasCellInputDependencies,
  getAtlasSlotTextureId,
  getTextureArrayInputDependencies,
  isAtlasCellInputRef,
  isTextureArrayInputRef,
  type TextureArrayInputRef,
} from './MaterialInputRefs';
import {
  type MaterialInputContext,
  type MaterialInputResolver,
  registerMaterialInputResolver,
} from './MaterialInputResolvers';
import { getTexture } from './Texture';
import { sampleArrayLayer } from './TextureArray';
import { getTextureAtlasInfo, sampleAtlasCell } from './TextureAtlas';

/** The input's place, for an error */
const describeInput = (ctx: MaterialInputContext) =>
  `input "${ctx.key}" (${ctx.group}) in material "${ctx.materialId}"`;

/** The helper's error, rethrown naming the input */
const withInputError = <T>(ctx: MaterialInputContext, make: () => T): T => {
  try {
    return make();
  } catch (err) {
    throw new Error(`The ${describeInput(ctx)}: ${(err as Error).message}`);
  }
};

/** The mesh's UV, typed as the helpers take it */
const meshUv = () => uv() as unknown as THREE.Node<'vec2'>;

/**
 * The input's texture, or the shared white texel `ctx.getTexture` gives (warned) when none is
 * registered under the id: the caller samples that as a plain texture, as for a bare id.
 */
const getInputTexture = (ctx: MaterialInputContext, id: string) => ({
  resource: ctx.getTexture(id),
  isMissing: !getTexture(id),
});

const isArrayTexture = (tex: THREE.Texture) =>
  Boolean(
    (tex as THREE.CompressedArrayTexture).isCompressedArrayTexture ||
      (tex as THREE.DataArrayTexture).isDataArrayTexture
  );

/** `{ "textureArray": id, "layer": index | name }`: the layer at the mesh's UV */
const TEXTURE_ARRAY_RESOLVER: MaterialInputResolver<TextureArrayInputRef> = {
  kind: 'textureArray',
  match: isTextureArrayInputRef,
  resolve: (value, ctx) => {
    const { textureArray: id, layer } = value;
    if (typeof layer !== 'number' && typeof layer !== 'string') {
      throw new Error(
        `The texture array layer of ${describeInput(ctx)} has no "layer": its index or its name.`
      );
    }
    const { resource, isMissing } = getInputTexture(ctx, id);
    if (isMissing) return texture(resource);
    if (!isArrayTexture(resource)) {
      throw new Error(
        `The texture array layer of ${describeInput(ctx)} names "${id}", which isn't an array texture.`
      );
    }
    return withInputError(ctx, () => sampleArrayLayer(resource, meshUv(), layer));
  },
  dependencies: getTextureArrayInputDependencies,
};

/** `{ "atlas": id, "slot": name, "cell": id, "clampToCell"? }`: the cell at the mesh's UV */
const ATLAS_CELL_RESOLVER: MaterialInputResolver<AtlasCellInputRef> = {
  kind: 'atlasCell',
  match: isAtlasCellInputRef,
  resolve: (value, ctx) => {
    const { atlas, slot, cell, clampToCell = true } = value;
    if (typeof slot !== 'string' || typeof cell !== 'string') {
      throw new Error(
        `The atlas cell of ${describeInput(ctx)} needs a "slot" and a "cell" (strings) besides its "atlas".`
      );
    }
    if (typeof clampToCell !== 'boolean') {
      throw new Error(`The atlas cell of ${describeInput(ctx)} has a "clampToCell" not boolean.`);
    }
    const slotId = getAtlasSlotTextureId(atlas, slot);
    const { resource, isMissing } = getInputTexture(ctx, slotId);
    if (isMissing) return texture(resource);
    if (!getTextureAtlasInfo(resource)) {
      throw new Error(
        `The atlas cell of ${describeInput(ctx)} names "${slotId}", which isn't an atlas slot.`
      );
    }
    return withInputError(ctx, () => sampleAtlasCell(resource, meshUv(), cell, { clampToCell }));
  },
  dependencies: getAtlasCellInputDependencies,
};

/**
 * Registers the texture array and atlas cell input resolvers (again: silent), from Texture.ts'
 * first array or atlas slot load.
 * @internal
 */
export const registerTextureInputResolvers = () => {
  registerMaterialInputResolver(TEXTURE_ARRAY_RESOLVER);
  registerMaterialInputResolver(ATLAS_CELL_RESOLVER);
};
