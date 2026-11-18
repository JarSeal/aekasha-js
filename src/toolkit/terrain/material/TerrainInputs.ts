// The terrain material's inputs (p305 D1, D9): what the setup reads of them, each checked against
// the define (the layers' sets: a `{ textureSet }` bundle each, `layer<i>`, or one
// `{ textureSetArray }` bundle, `layers`; the splat maps `splat<i>`; the macro texture `macro`, of
// the macro variation and the rules' noise; the colour map `colorMap`),
// and what the code route makes of its config. Inputs, not defines: the gather's texture closure
// loads them (and builds the set arrays they name), and a block's variant swaps them without
// another shader.
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node, TextureNode } from 'three/webgpu';
import { IS_DEBUG_ENV, llog } from 'aekasha';
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
import { readLiveSource, type LiveLayerSource } from './TerrainLive';
import { chooseTerrainStorage, TERRAIN_PACKING_SLOTS, type TerrainBinding } from './TerrainStorage';

/** A layer's input key: `layer0`, `layer1`, … */
const getLayerInputKey = (index: number) => `layer${index}`;
/** A splat map's input key: `splat0` (layers 1-4), `splat1` (5-8) */
const getSplatInputKey = (index: number) => `splat${index}`;
/** The macro texture's input key */
const MACRO_INPUT_KEY = 'macro';
/** The colour map's input key */
const COLOR_MAP_INPUT_KEY = 'colorMap';
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
  /** The wet response's (p307): how much water the set soaks up, 0..1 */
  porosity: Node<'float'>;
  /** How much the filled pores darken the albedo, 0..1 */
  wetDarkening: Node<'float'>;
  /** The roughness with the pores full */
  wetRoughness: Node<'float'>;
  /** How fast the set dries against the overall wetness (its power) */
  dryingSpeed: Node<'float'>;
  /** How readily water stands on the set: its film over full pores, its puddles */
  puddleResponse: Node<'float'>;
  /**
   * The set's average colour, linear: a set array's layer always has one (mid-grey for a set
   * without), a `{ textureSet }` bundle only when its set has one
   */
  averageColor?: Node<'vec3'>;
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
  /** A live layer's set and generator (`PROCEDURAL_LIVE`), which it runs instead of sampling */
  live?: LiveLayerSource;
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

/**
 * Whether the define reads the layers' average colours: a `DETAIL` colour map's detail, or the
 * `AVERAGE_COLOR` far surface
 */
const readsAverageColor = (define: ResolvedTerrainDefine) =>
  define.colorMap?.mode === 'DETAIL' || define.far?.mode === 'AVERAGE_COLOR';

/** A `{ textureSet }` bundle of a layer's own input (`layer<i>`), checked for what it must carry */
const readOwnBundle = (
  inputs: Record<string, unknown>,
  key: string,
  define: ResolvedTerrainDefine
) => {
  const bundle = inputs[key] as TextureSetInput | undefined;
  if (!bundle || typeof bundle !== 'object' || !('physicalSize' in bundle)) {
    throw new Error(
      `[terrain] Missing input "${key}": a { "textureSet": id } (the textureSets() feature) for each layer, or a { "textureSetArray": [ids], "packing" } "${ARRAY_INPUT_KEY}" for all (a procedural set's layer keeping its own).`
    );
  }
  if (readsAverageColor(define) && !bundle.averageColor) {
    throw new Error(
      `[terrain] Input "${key}": its texture set has no averageColor, which ${define.colorMap?.mode === 'DETAIL' ? "the DETAIL colour map's detail" : 'the AVERAGE_COLOR far surface'} reads (a procedural set has none): give the set's JSON one, or encode its albedo (yarn assets).`
    );
  }
  return bundle;
};

/**
 * The set array bundle `layers` (`ARRAY` storage) checked: its layer count the array layers'
 * (the layers without an input of their own)
 */
const readArrayBundle = (value: unknown, arrayCount: number) => {
  if (!isArrayBundle(value)) {
    throw new Error(
      `[terrain] Input "${ARRAY_INPUT_KEY}" isn't a texture set array: give { "textureSetArray": [ids], "packing" } (or a built set array's id).`
    );
  }
  if (!arrayCount) {
    throw new Error(
      `[terrain] Input "${ARRAY_INPUT_KEY}" has no layer to hold: every layer has an input of its own (layer<i>).`
    );
  }
  const count = (value.layerCount as unknown as { value?: unknown }).value;
  if (typeof count === 'number' && count !== arrayCount) {
    throw new Error(
      `[terrain] Input "${ARRAY_INPUT_KEY}" has ${count} layers, and ${arrayCount} layers take theirs from it (those without an input "layer<i>" of their own): one set per layer, in the layers' order.`
    );
  }
  return value;
};

/**
 * The layers' sets in the define's order: the `{ textureSet }` bundles `layer<i>` (`SEPARATE`,
 * all present, no other `layer<i>`), or with the `{ textureSetArray }` bundle `layers` (`ARRAY`)
 * each layer without an input of its own at its place in the array, in order (D9's mixed sources:
 * a set array takes imported sets, so a procedural set's layer keeps its own `layer<i>`, and a
 * live layer must); and the textures they bind (a live layer's none: it runs its generator)
 * @internal
 */
export const readLayerSources = (
  inputs: Record<string, unknown>,
  define: ResolvedTerrainDefine
): LayerSources => {
  const keys = define.layers.map((_, i) => getLayerInputKey(i));
  checkNumberedKeys(
    inputs,
    'layer',
    keys,
    `has no layer: staticDefines.terrain.layers has ${keys.length}`
  );
  const hasArray = inputs[ARRAY_INPUT_KEY] !== undefined;
  const isOwn = keys.map(
    (key, i) => !hasArray || inputs[key] !== undefined || !!define.layers[i].live
  );
  const arrayCount = isOwn.filter((own) => !own).length;
  const array = hasArray ? readArrayBundle(inputs[ARRAY_INPUT_KEY], arrayCount) : null;
  let arrayLayer = 0;
  const layers = keys.map((key, i): LayerSource => {
    if (!isOwn[i] && array) {
      const layer = arrayLayer++;
      const params = getTextureSetLayerParams(array.layerParams, layer) as unknown as LayerParams;
      return { bundle: array, layer, params };
    }
    const bundle = readOwnBundle(inputs, key, define);
    const live = define.layers[i].live ? readLiveSource(bundle, key) : undefined;
    return { bundle, layer: undefined, params: getSetParams(bundle), ...(live ? { live } : {}) };
  });
  const own = layers.filter((layer) => layer.layer === undefined);
  const live = own.filter((layer) => layer.live).length;
  const ownSlots = own.find((layer) => !layer.live) ?? own[0];
  const ownKeys = keys.filter((_, i) => layers[i].layer === undefined);
  const bindings: TerrainBinding[] = [];
  if (array) {
    const slots = getBundleSlots(array);
    bindings.push({
      name: `${ARRAY_INPUT_KEY} (arrays ${slots.join(', ')})`,
      count: slots.length,
    });
  }
  if (own.length) {
    const range = ownKeys.length > 1 ? `${ownKeys[0]}-${ownKeys.at(-1)}` : ownKeys[0];
    // Beside a set array the own inputs needn't be in a row
    const names = array ? ownKeys.join(', ') : range;
    bindings.push({
      name: `${names} (${getBundleSlots(ownSlots.bundle).join(', ')} each${live ? `, ${live} live none` : ''})`,
      count: own.reduce(
        (total, layer) => total + (layer.live ? 0 : getBundleSlots(layer.bundle).length),
        0
      ),
    });
  }
  return { isArray: array !== null, layers, bindings };
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

/**
 * The colour map's texture node when the define has a colour map, else null; the input is refused
 * without one.
 * @internal
 */
export const readColorMapTexture = (
  inputs: Record<string, unknown>,
  define: ResolvedTerrainDefine
): TextureNode | null => {
  const input = inputs[COLOR_MAP_INPUT_KEY];
  if (!define.colorMap) {
    if (input !== undefined) {
      throw new Error(
        `[terrain] Input "${COLOR_MAP_INPUT_KEY}" has no use: give staticDefines.terrain.colorMap (its mode) to use it.`
      );
    }
    return null;
  }
  if (!isTextureNode(input)) {
    throw new Error(
      `[terrain] Missing input "${COLOR_MAP_INPUT_KEY}": the colour map's texture ({ "texture": id }, at the mesh's UV) that staticDefines.terrain.colorMap reads.`
    );
  }
  return input;
};

/** A code-route layer's packing: the config's, else its set's default; undefined for no data */
const getLayerPacking = (config: TerrainMaterialConfig, setId: string) =>
  config.packing ?? getTextureSet(setId)?.defaultPacking;

/**
 * Whether a code-route layer takes an input of its own beside a set array (D9's mixed sources): a
 * procedural set (a set array takes imported sets), or a layer live in the material or a tier (it
 * runs its set's generator); a set no data has goes in the array (its input throws then)
 */
const takesOwnInput = (config: TerrainMaterialConfig, index: number) => {
  const layer = config.layers[index];
  const tiers = Object.values(config.quality ?? {});
  const isLive = [layer.source, ...tiers.map((tier) => tier?.layers?.[index]?.source)].includes(
    'PROCEDURAL_LIVE'
  );
  return isLive || Boolean(getTextureSet(layer.set)?.procedural);
};

/** The code route's set array packing: the config's, else the sets' defaults, which must agree */
const getArrayPacking = (
  config: TerrainMaterialConfig,
  layers: TerrainMaterialConfig['layers']
): TextureSetPacking => {
  const packings = layers.map((layer) => {
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
      `[terrain] Material "${config.id}": the sets' default packings differ (${layers.map((layer, i) => `${layer.set}: ${packings[i]}`).join(', ')}): give the config's packing.`
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
 * macro, noise or colour map texture (the inputs carry them)
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
    colorMap,
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
  if (colorMap) {
    const { texture: _texture, ...settings } = colorMap;
    define.colorMap = settings;
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
 * material's fields or a tier's), else `SEPARATE` while each layer's packing slots, the splat maps,
 * the macro texture and the colour map fit the budget (a set no data has counts as fitting: its input throws
 * then)
 */
const getStorage = (config: TerrainMaterialConfig, define: TerrainMaterialDefine) => {
  const storage = config.storage ?? 'AUTO';
  if (storage !== 'AUTO') return storage;
  if (takesSlots(define)) return 'ARRAY';
  // A live layer runs its generator: it binds nothing
  const layerSlots = config.layers.map((layer) => {
    const packing = getLayerPacking(config, layer.set);
    const isLive = layer.source === 'PROCEDURAL_LIVE';
    return packing && !isLive ? TERRAIN_PACKING_SLOTS[packing].length : 0;
  });
  const extra =
    (config.splatMaps?.length ?? 0) +
    (getMacroTextureId(config) ? 1 : 0) +
    (config.colorMap ? 1 : 0);
  return chooseTerrainStorage(
    layerSlots,
    extra,
    config.reservedTextures ?? DEFAULT_RESERVED_TEXTURES
  );
};

/** A code-route layer's own input: its set, in the config's packing when it gives one */
const getOwnInput = (config: TerrainMaterialConfig, setId: string) =>
  config.packing ? { textureSet: setId, packing: config.packing } : { textureSet: setId };

/**
 * The code route's layer inputs for `ARRAY` storage: the imported sets in the set array `layers`,
 * a procedural set's layer and a live one on its own `layer<i>` (D9's mixed sources: a set array
 * takes imported sets), said in a dev log when it splits
 */
const getArrayInputs = (config: TerrainMaterialConfig) => {
  const own = config.layers.map((_, i) => takesOwnInput(config, i));
  const arrayLayers = config.layers.filter((_, i) => !own[i]);
  const inputs: Record<string, unknown> = {};
  if (arrayLayers.length) {
    inputs[ARRAY_INPUT_KEY] = {
      textureSetArray: arrayLayers.map((layer) => layer.set),
      packing: getArrayPacking(config, arrayLayers),
    };
  }
  config.layers.forEach((layer, i) => {
    if (own[i]) inputs[getLayerInputKey(i)] = getOwnInput(config, layer.set);
  });
  if (IS_DEBUG_ENV && arrayLayers.length && arrayLayers.length < config.layers.length) {
    const named = config.layers.flatMap((layer, i) =>
      own[i] ? [`${getLayerInputKey(i)} (${layer.set})`] : []
    );
    llog(
      `[terrain] Material "${config.id}": a set array takes imported sets, so ${named.join(', ')} take their own inputs beside it (procedural sets, live layers).`
    );
  }
  return inputs;
};

/**
 * The code route's inputs: the layers' sets (`SEPARATE`: `layer<i>`, `{ textureSet, packing? }`
 * each; `ARRAY`: `layers`, `{ textureSetArray, packing }`, a procedural set's or a live layer
 * keeping its own `layer<i>`; `AUTO` choosing), the splat maps (`splat<i>`), the macro texture
 * (`macro`: the macro variation's, or the rules' noise texture) and the colour map (`colorMap`)
 * @internal
 * @param define the config's static define (`getTerrainDefine`'s): `AUTO` reads its slots
 */
export const getTerrainInputs = (config: TerrainMaterialConfig, define: TerrainMaterialDefine) => {
  const inputs: Record<string, unknown> =
    getStorage(config, define) === 'ARRAY'
      ? getArrayInputs(config)
      : Object.fromEntries(
          config.layers.map((layer, i) => [getLayerInputKey(i), getOwnInput(config, layer.set)])
        );
  config.splatMaps?.forEach((id, i) => {
    inputs[getSplatInputKey(i)] = { texture: id };
  });
  const macroTexture = getMacroTextureId(config);
  if (macroTexture) inputs[MACRO_INPUT_KEY] = { texture: macroTexture };
  if (config.colorMap) inputs[COLOR_MAP_INPUT_KEY] = { texture: config.colorMap.texture };
  return inputs;
};
