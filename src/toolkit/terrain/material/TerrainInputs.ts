// The terrain material's inputs (p305 D1): what the setup reads of them, each checked against the
// define (the layers' set bundles `layer<i>`, the splat maps `splat<i>`, the macro texture
// `macro`), and what the code route makes of its config. Inputs, not defines: the gather's texture
// closure loads them, and a block's variant swaps them without another shader.
import type { TextureNode } from 'three/webgpu';
import type { TextureSetInput } from 'aekasha/texturesets';
import { getSplatMapCount, type ResolvedTerrainDefine } from './TerrainDefine';
import type { TerrainMaterialConfig } from './TerrainMaterialConfig';

/** A layer's input key: `layer0`, `layer1`, … */
const getLayerInputKey = (index: number) => `layer${index}`;
/** A splat map's input key: `splat0` (layers 1-4), `splat1` (5-8) */
const getSplatInputKey = (index: number) => `splat${index}`;
/** The macro texture's input key */
const MACRO_INPUT_KEY = 'macro';

const isTextureNode = (value: unknown): value is TextureNode =>
  Boolean((value as { isTextureNode?: boolean } | undefined)?.isTextureNode);

/** Refuses the inputs of a numbered kind (`layer<i>`, `splat<i>`) past the define's count */
const checkNumberedKeys = (
  inputs: Record<string, unknown>,
  prefix: string,
  keys: string[],
  explain: string
) => {
  const pattern = new RegExp(`^${prefix}\\d+$`);
  for (const key of Object.keys(inputs)) {
    if (pattern.test(key) && !keys.includes(key)) {
      throw new Error(`[terrain] Input "${key}" ${explain}.`);
    }
  }
};

/**
 * The layers' input bundles in the define's order, all present, the input keys none but theirs
 * @internal
 */
export const readLayerBundles = (
  inputs: Record<string, unknown>,
  define: ResolvedTerrainDefine
) => {
  const keys = define.layers.map((_, i) => getLayerInputKey(i));
  checkNumberedKeys(
    inputs,
    'layer',
    keys,
    `has no layer: staticDefines.terrain.layers has ${keys.length}`
  );
  return keys.map((key) => {
    const bundle = inputs[key] as TextureSetInput | undefined;
    if (!bundle || typeof bundle !== 'object' || !('physicalSize' in bundle)) {
      throw new Error(
        `[terrain] Missing input "${key}": a { "textureSet": id } (the textureSets() feature) for each layer.`
      );
    }
    return bundle;
  });
};

/**
 * The splat maps' texture nodes (`SPLAT_MAP`: one per four layers past the base), or none for the
 * other sources, whose inputs may have no `splat<i>`
 * @internal
 */
export const readSplatMaps = (
  inputs: Record<string, unknown>,
  define: ResolvedTerrainDefine
): TextureNode[] => {
  const layerCount = define.layers.length;
  const count = define.blend.source === 'SPLAT_MAP' ? getSplatMapCount(layerCount) : 0;
  const keys = Array.from({ length: count }, (_, i) => getSplatInputKey(i));
  checkNumberedKeys(
    inputs,
    'splat',
    keys,
    count
      ? `has no splat map: ${layerCount} layers take ${count}`
      : 'has no splat map: staticDefines.terrain.blend.source is SPLAT_MAP for splat maps'
  );
  return keys.map((key, i) => {
    const node = inputs[key];
    if (!isTextureNode(node)) {
      throw new Error(
        `[terrain] Missing input "${key}": a splat map's texture ({ "texture": id }) for layers ${i * 4 + 1}-${i * 4 + 4}.`
      );
    }
    return node;
  });
};

/**
 * The macro texture's node when the define has `macro` (which only then takes the input `macro`),
 * else null
 * @internal
 */
export const readMacroTexture = (
  inputs: Record<string, unknown>,
  define: ResolvedTerrainDefine
): TextureNode | null => {
  const input = inputs[MACRO_INPUT_KEY];
  if (!define.macro) {
    if (input === undefined) return null;
    throw new Error(
      `[terrain] Input "${MACRO_INPUT_KEY}" has no macro: give staticDefines.terrain.macro (its scale) to use it.`
    );
  }
  if (!isTextureNode(input)) {
    throw new Error(
      `[terrain] Missing input "${MACRO_INPUT_KEY}": the macro texture ({ "texture": id }, eg. macroNoise) of staticDefines.terrain.macro.`
    );
  }
  return input;
};

/**
 * The code route's inputs: each layer's set (`layer<i>`), the splat maps (`splat<i>`) and the
 * macro texture (`macro`)
 * @internal
 */
export const getTerrainInputs = (config: TerrainMaterialConfig) => {
  const inputs: Record<string, unknown> = Object.fromEntries(
    config.layers.map((layer, i) => [
      getLayerInputKey(i),
      config.packing
        ? { textureSet: layer.set, packing: config.packing }
        : { textureSet: layer.set },
    ])
  );
  config.splatMaps?.forEach((id, i) => {
    inputs[getSplatInputKey(i)] = { texture: id };
  });
  if (config.macro) inputs[MACRO_INPUT_KEY] = { texture: config.macro.texture };
  return inputs;
};
