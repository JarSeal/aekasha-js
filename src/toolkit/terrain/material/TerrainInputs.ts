// The terrain material's inputs (p305 D1, D9): what the setup reads of them, each checked against
// the define (the layers' sets: a `{ textureSet }` bundle each, `layer<i>`, or one
// `{ textureSetArray }` bundle, `layers`; the splat maps `splat<i>`; the macro texture `macro`, of
// the macro variation and the rules' noise),
// and what the code route makes of its config. Inputs, not defines: the gather's texture closure
// loads them (and builds the set arrays they name), and a block's variant swaps them without
// another shader.
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node, TextureNode } from 'three/webgpu';
import {
  getTextureSet,
  getTextureSetLayerParams,
  type TextureSetArrayInput,
  type TextureSetInput,
  type TextureSetPacking,
} from 'aekasha/texturesets';
import {
  DEFAULT_RESERVED_TEXTURES,
  getPaintedLayerCount,
  getSplatMapCount,
  readTerrainDefine,
  type ResolvedTerrainDefine,
} from './TerrainDefine';
import type {
  TerrainBlend,
  TerrainMaterialConfig,
  TerrainMaterialDefine,
} from './TerrainMaterialConfig';
import { chooseTerrainStorage, TERRAIN_PACKING_SLOTS, type TerrainBinding } from './TerrainStorage';

/** A layer's input key: `layer0`, `layer1`, … */
const getLayerInputKey = (index: number) => `layer${index}`;
/** A splat map's input key: `splat0` (layers 1-4), `splat1` (5-8) */
const getSplatInputKey = (index: number) => `splat${index}`;
/** The macro texture's input key */
const MACRO_INPUT_KEY = 'macro';
/** The texture the code route's rule noise reads without a `macro` or a `noiseTexture` */
const DEFAULT_NOISE_TEXTURE = 'macroNoise';
/** The layers' set array's input key (`ARRAY` storage) */
const ARRAY_INPUT_KEY = 'layers';

/** Every packing's slots, the keys a set's or a set array's bundle may have */
const SLOT_KEYS = ['albedoHeight', 'normal', 'orm', 'albedoRough', 'normalHeight'] as const;

/** A layer's set params as nodes: a `{ textureSet }` bundle's uniforms, or a set array's layer's */
export type LayerParams = {
  physicalSize: Node<'vec2'>;
  heightScale: Node<'float'>;
  heightContrast: Node<'float'>;
  tint: Node<'vec3'>;
  normalStrength: Node<'float'>;
  roughnessScale: Node<'float'>;
  aoStrength: Node<'float'>;
};

/** A layer's set: the bundle it samples, its layer there (`ARRAY`), its params */
export type LayerSource = {
  bundle: TextureSetInput | TextureSetArrayInput;
  /**
   * The set array's layer (an int node for a slot's: the layer kept there), or undefined for a
   * set's own bundle
   */
  layer: number | Node<'int'> | undefined;
  params: LayerParams;
};

/** The layers' sets as read, and the textures they bind */
export type LayerSources = { isArray: boolean; layers: LayerSource[]; bindings: TerrainBinding[] };

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

/** A bundle's slots, those of its packing */
const getBundleSlots = (bundle: TextureSetInput | TextureSetArrayInput) =>
  SLOT_KEYS.filter((slot) => bundle[slot]);

const isArrayBundle = (value: unknown): value is TextureSetArrayInput =>
  typeof value === 'object' && value !== null && 'layerParams' in value;

/** A `{ textureSet }` bundle's own uniforms as a layer's params */
const getSetParams = (bundle: TextureSetInput) => bundle as unknown as LayerParams;

/** The `ARRAY` storage's layers: each a layer of the one set array bundle `layers` */
const readArraySources = (
  bundle: unknown,
  define: ResolvedTerrainDefine,
  separateKey: string | undefined
): LayerSources => {
  if (separateKey) {
    throw new Error(
      `[terrain] Inputs "${ARRAY_INPUT_KEY}" (ARRAY storage, a set array for every layer) and "${separateKey}" (SEPARATE, a set per layer) are both given: use one.`
    );
  }
  if (!isArrayBundle(bundle)) {
    throw new Error(
      `[terrain] Input "${ARRAY_INPUT_KEY}" isn't a texture set array: give { "textureSetArray": [ids], "packing" } (or a built set array's id).`
    );
  }
  const count = (bundle.layerCount as unknown as { value?: unknown }).value;
  if (typeof count === 'number' && count !== define.layers.length) {
    throw new Error(
      `[terrain] Input "${ARRAY_INPUT_KEY}" has ${count} layers, staticDefines.terrain.layers ${define.layers.length}: one set per layer.`
    );
  }
  const slots = getBundleSlots(bundle);
  return {
    isArray: true,
    layers: define.layers.map((_, i) => ({
      bundle,
      layer: i,
      params: getTextureSetLayerParams(bundle.layerParams, i) as unknown as LayerParams,
    })),
    bindings: [{ name: `${ARRAY_INPUT_KEY} (arrays ${slots.join(', ')})`, count: slots.length }],
  };
};

/**
 * The layers' sets in the define's order: the `{ textureSet }` bundles `layer<i>` (`SEPARATE`,
 * all present, no other `layer<i>`), or the `{ textureSetArray }` bundle `layers` (`ARRAY`, its
 * layer count the define's), and the textures they bind
 * @internal
 */
export const readLayerSources = (
  inputs: Record<string, unknown>,
  define: ResolvedTerrainDefine
): LayerSources => {
  const separateKey = Object.keys(inputs).find((key) => /^layer\d+$/.test(key));
  if (inputs[ARRAY_INPUT_KEY] !== undefined) {
    return readArraySources(inputs[ARRAY_INPUT_KEY], define, separateKey);
  }
  const keys = define.layers.map((_, i) => getLayerInputKey(i));
  checkNumberedKeys(
    inputs,
    'layer',
    keys,
    `has no layer: staticDefines.terrain.layers has ${keys.length}`
  );
  const bundles = keys.map((key) => {
    const bundle = inputs[key] as TextureSetInput | undefined;
    if (!bundle || typeof bundle !== 'object' || !('physicalSize' in bundle)) {
      throw new Error(
        `[terrain] Missing input "${key}": a { "textureSet": id } (the textureSets() feature) for each layer, or a { "textureSetArray": [ids], "packing" } "${ARRAY_INPUT_KEY}" for all.`
      );
    }
    return bundle;
  });
  const slots = getBundleSlots(bundles[0]);
  const last = keys.length - 1;
  return {
    isArray: false,
    layers: bundles.map((bundle) => ({ bundle, layer: undefined, params: getSetParams(bundle) })),
    bindings: [
      {
        name: `${last ? `layer0-layer${last}` : 'layer0'} (${slots.join(', ')} each)`,
        count: bundles.reduce((total, bundle) => total + getBundleSlots(bundle).length, 0),
      },
    ],
  };
};

/**
 * The splat maps' texture nodes (`SPLAT_MAP`, `SPLAT_MAP_AND_RULES`: one per four painted layers
 * past the base), or none for the other sources, whose inputs may have no `splat<i>`
 * @internal
 */
export const readSplatMaps = (
  inputs: Record<string, unknown>,
  define: ResolvedTerrainDefine
): TextureNode[] => {
  const count = getSplatMapCount(define.blend, define.layers.length);
  const keys = Array.from({ length: count }, (_, i) => getSplatInputKey(i));
  checkNumberedKeys(
    inputs,
    'splat',
    keys,
    count
      ? `has no splat map: ${getPaintedLayerCount(define.blend, define.layers.length)} painted layers take ${count}`
      : 'has no splat map: staticDefines.terrain.blend.source is SPLAT_MAP or SPLAT_MAP_AND_RULES for splat maps'
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

/** Whether the define's blend (as read, its tier's) has a rule with noise */
const hasRuleNoise = (define: ResolvedTerrainDefine) =>
  define.blend.source !== 'SINGLE' && define.blend.rules.some((rule) => rule.noise);

/**
 * The macro texture's node when the define reads it (`macro`, or a rule's noise), else null. The
 * input is refused where nothing in the define (its tiers included) takes it.
 * @internal
 */
export const readMacroTexture = (
  inputs: Record<string, unknown>,
  define: ResolvedTerrainDefine
): TextureNode | null => {
  const input = inputs[MACRO_INPUT_KEY];
  if (!define.takesMacroTexture && input !== undefined) {
    throw new Error(
      `[terrain] Input "${MACRO_INPUT_KEY}" has no use: give staticDefines.terrain.macro (its scale) or a rule's noise to use it.`
    );
  }
  if (!define.macro && !hasRuleNoise(define)) return null;
  if (!isTextureNode(input)) {
    throw new Error(
      `[terrain] Missing input "${MACRO_INPUT_KEY}": the macro texture ({ "texture": id }, eg. macroNoise) that staticDefines.terrain.macro and the rules' noise read.`
    );
  }
  return input;
};

/** A code-route layer's packing: the config's, else its set's default; undefined for no data */
const getLayerPacking = (config: TerrainMaterialConfig, setId: string) =>
  config.packing ?? getTextureSet(setId)?.defaultPacking;

/** The code route's set array packing: the config's, else the sets' defaults, which must agree */
const getArrayPacking = (config: TerrainMaterialConfig): TextureSetPacking => {
  const packings = config.layers.map((layer) => {
    const packing = getLayerPacking(config, layer.set);
    if (!packing) {
      throw new Error(
        `[terrain] Material "${config.id}": ARRAY storage needs its sets' packing, and no data has the texture set "${layer.set}" (give the config's packing, or list the set in the scene).`
      );
    }
    return packing;
  });
  if (packings.some((packing) => packing !== packings[0])) {
    throw new Error(
      `[terrain] Material "${config.id}": the sets' default packings differ (${config.layers.map((layer, i) => `${layer.set}: ${packings[i]}`).join(', ')}): give the config's packing.`
    );
  }
  return packings[0];
};

/** Whether a blend of the code route's config (the material's or a tier's) has rule noise */
const hasConfigRuleNoise = (blend: TerrainBlend | undefined) =>
  Boolean(blend && 'rules' in blend && blend.rules.some((rule) => rule.noise));

/**
 * The code route's macro texture id: `macro`'s, else the rules' `noiseTexture` (default
 * `macroNoise`) when a rule of the material's or a tier's has noise; undefined for none
 */
const getMacroTextureId = (config: TerrainMaterialConfig) => {
  if (config.macro) return config.macro.texture;
  const tiers = Object.values(config.quality ?? {}).map((tier) => tier?.blend);
  const hasNoise = [config.blend, ...tiers].some(hasConfigRuleNoise);
  return hasNoise ? config.noiseTexture ?? DEFAULT_NOISE_TEXTURE : undefined;
};

/**
 * The config's static define: no id, no packing, no layer sets, no storage, no splat maps and no
 * macro or noise texture (the inputs carry them)
 * @internal
 */
export const getTerrainDefine = (config: TerrainMaterialConfig): TerrainMaterialDefine => {
  const {
    id: _id,
    packing: _packing,
    splatMaps: _splatMaps,
    noiseTexture: _noiseTexture,
    storage: _storage,
    layers,
    macro,
    ...rest
  } = config;
  const define: TerrainMaterialDefine = {
    ...rest,
    layers: layers.map(({ set: _set, ...settings }) => settings),
  };
  if (macro) {
    const { texture: _texture, ...settings } = macro;
    define.macro = settings;
  }
  return define;
};

/**
 * Whether the define samples the layers in slots (sparse, `HEX`'s `DOMINANT`) at its own fields or
 * at a tier of its `quality` table: a tier's variant shares the material's inputs, so the
 * material's storage must suit every tier
 */
const takesSlots = (define: TerrainMaterialDefine) =>
  [define.qualityLevel, ...Object.keys(define.quality ?? {})].some(
    (qualityLevel) => readTerrainDefine({ terrain: { ...define, qualityLevel } }).slotCount !== null
  );

/**
 * The code route's storage: `AUTO` (the default) is `ARRAY` where the layers sample in slots (the
 * material's fields or a tier's), else `SEPARATE` while each layer's packing slots, the splat maps
 * and the macro texture fit the budget (a set no data has counts as fitting: its input throws
 * then)
 */
const getStorage = (config: TerrainMaterialConfig, define: TerrainMaterialDefine) => {
  const storage = config.storage ?? 'AUTO';
  if (storage !== 'AUTO') return storage;
  if (takesSlots(define)) return 'ARRAY';
  const layerSlots = config.layers.map((layer) => {
    const packing = getLayerPacking(config, layer.set);
    return packing ? TERRAIN_PACKING_SLOTS[packing].length : 0;
  });
  const extra = (config.splatMaps?.length ?? 0) + (getMacroTextureId(config) ? 1 : 0);
  return chooseTerrainStorage(
    layerSlots,
    extra,
    config.reservedTextures ?? DEFAULT_RESERVED_TEXTURES
  );
};

/**
 * The code route's inputs: the layers' sets (`SEPARATE`: `layer<i>`, `{ textureSet, packing? }`
 * each; `ARRAY`: `layers`, `{ textureSetArray, packing }`, `AUTO` choosing), the splat maps
 * (`splat<i>`) and the macro texture (`macro`: the macro variation's, or the rules' noise
 * texture)
 * @internal
 * @param define the config's static define (`getTerrainDefine`'s): `AUTO` reads its slots
 */
export const getTerrainInputs = (config: TerrainMaterialConfig, define: TerrainMaterialDefine) => {
  const inputs: Record<string, unknown> =
    getStorage(config, define) === 'ARRAY'
      ? {
          [ARRAY_INPUT_KEY]: {
            textureSetArray: config.layers.map((layer) => layer.set),
            packing: getArrayPacking(config),
          },
        }
      : Object.fromEntries(
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
  const macroTexture = getMacroTextureId(config);
  if (macroTexture) inputs[MACRO_INPUT_KEY] = { texture: macroTexture };
  return inputs;
};
