// The terrain material's static define read by hand (`staticDefines.terrain`, p305 D1): checked
// as it's read and filled with its defaults, for the graph to branch on. Not the Zod schema
// (`TerrainMaterialConfig.ts`): a build carrying the generator would carry zod with it (the texture
// sets' trap, `src/_engine/features/texturesets/CLAUDE.md`). `TerrainDefine.test.ts` keeps the two
// in step: the same keys, values and refusals.
const LAYER_SOURCES = ['TEXTURE'] as const;
const UV_MODES = ['WORLD', 'MESH_UV'] as const;
const BLEND_SOURCES = ['SINGLE'] as const;
const ANTI_TILING_MODES = ['NONE', 'DUAL_SCALE', 'HEX'] as const;
const MAX_LAYERS = 16;
const QUALITY_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'ULTRA'] as const;
const DEBUG_VIEWS = ['TEXEL_DENSITY', 'NORMALS'] as const;

/** The keys each object of the define takes (the schema's) */
const OVERRIDE_KEYS = ['uv', 'blend', 'ao', 'antiTiling', 'distance'];
const DEFINE_KEYS = ['layers', 'macro', ...OVERRIDE_KEYS, 'quality', 'qualityLevel', 'debugView'];
const LAYER_KEYS = [
  'source',
  'tiling',
  'rotation',
  'tint',
  'normalStrength',
  'roughnessScale',
  'antiTiling',
];
const BLEND_KEYS = ['source'];
const AO_KEYS = ['textureInfluence'];
const ANTI_TILING_KEYS: Record<(typeof ANTI_TILING_MODES)[number], string[]> = {
  NONE: ['mode'],
  DUAL_SCALE: ['mode', 'farScale', 'distance'],
  HEX: ['mode', 'hexContrast', 'hexRotation'],
};
const MACRO_KEYS = ['scale', 'brightness', 'hue', 'roughness'];
const DISTANCE_KEYS = ['fade'];

/** The anti-tiling defaults (p305 D3) */
const DUAL_SCALE_FAR_SCALE = 0.23;
const DUAL_SCALE_DISTANCE: [number, number] = [6, 40];
const HEX_CONTRAST = 0.5;
const HEX_ROTATION = 1;
/** The macro variation's defaults (p305 D7) */
const MACRO_BRIGHTNESS = 0.2;
const MACRO_HUE = 8;
const MACRO_ROUGHNESS = 0.15;

/** A layer's anti-tiling with its defaults filled in: the mode's fields only */
export type TerrainAntiTilingDefine =
  | { mode: 'NONE' }
  | { mode: 'DUAL_SCALE'; farScale: number; distance: [number, number] }
  | { mode: 'HEX'; hexContrast: number; hexRotation: number };

/** A layer's settings with their defaults filled in */
export type TerrainLayerDefine = {
  source: (typeof LAYER_SOURCES)[number];
  tiling: number;
  /** Degrees; null compiles no rotation */
  rotation: number | null;
  /** sRGB `#rrggbb` */
  tint: string;
  normalStrength: number;
  roughnessScale: number;
  /** The layer's own, else the material's (after its tier's override) */
  antiTiling: TerrainAntiTilingDefine;
};

/** The macro variation with its defaults filled in */
export type TerrainMacroDefine = {
  /** Metres a macro tile covers */
  scale: number;
  brightness: number;
  /** Degrees */
  hue: number;
  roughness: number;
};

/** The static define with its defaults filled in: what the graph branches on */
export type ResolvedTerrainDefine = {
  layers: TerrainLayerDefine[];
  uv: (typeof UV_MODES)[number];
  blendSource: (typeof BLEND_SOURCES)[number];
  /** The texture AO's influence, 0..1 */
  aoTextureInfluence: number;
  /** The macro variation (its texture the input `macro`), or null for none */
  macro: TerrainMacroDefine | null;
  /** The detail normals' fade, view distances in metres, or null for none */
  distanceFade: [number, number] | null;
  /** The tier whose overrides applied, or null for the material's own fields */
  qualityLevel: (typeof QUALITY_LEVELS)[number] | null;
  /** The debug view in place of the surface, or null */
  debugView: (typeof DEBUG_VIEWS)[number] | null;
};

/** The values the hand reader takes, for the test that keeps them the schema's */
export const TERRAIN_DEFINE_VALUES = {
  defineKeys: DEFINE_KEYS,
  layerKeys: LAYER_KEYS,
  blendKeys: BLEND_KEYS,
  aoKeys: AO_KEYS,
  antiTilingKeys: ANTI_TILING_KEYS,
  macroKeys: MACRO_KEYS,
  distanceKeys: DISTANCE_KEYS,
  overrideKeys: OVERRIDE_KEYS,
  qualityLevels: QUALITY_LEVELS,
  debugViews: DEBUG_VIEWS,
  layerSources: LAYER_SOURCES,
  uvModes: UV_MODES,
  blendSources: BLEND_SOURCES,
  antiTilingModes: ANTI_TILING_MODES,
  maxLayers: MAX_LAYERS,
};

function fail(path: string, message: string): never {
  throw new Error(`[terrain] staticDefines.terrain${path}: ${message}`);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readObject = (value: unknown, path: string) =>
  isRecord(value) ? value : fail(path, `is ${JSON.stringify(value)}, not an object.`);

/** An optional object field: `{}` when it's absent */
const readOptionalObject = (obj: Record<string, unknown>, key: string, path: string) =>
  obj[key] === undefined ? {} : readObject(obj[key], `${path}.${key}`);

const checkKeys = (obj: Record<string, unknown>, keys: readonly string[], path: string) => {
  for (const key of Object.keys(obj)) {
    if (!keys.includes(key)) {
      fail(path, `has no field "${key}" (fields: ${keys.join(', ')}).`);
    }
  }
};

const readEnum = <T extends string>(
  obj: Record<string, unknown>,
  key: string,
  values: readonly T[],
  path: string
): T => {
  const value = obj[key] ?? values[0];
  if (!values.includes(value as T)) {
    fail(`${path}.${key}`, `is ${JSON.stringify(value)}: use ${values.join(', ')}.`);
  }
  return value as T;
};

/** An enum field without a default: null when it's absent */
const readOptionalEnum = <T extends string>(
  obj: Record<string, unknown>,
  key: string,
  values: readonly T[],
  path: string
): T | null => (obj[key] === undefined ? null : readEnum(obj, key, values, path));

/** A number's bound, the value itself allowed unless exclusive */
type Bound = { value: number; isExclusive?: boolean };

const isPast = (value: number, bound: Bound, isMin: boolean) => {
  if (bound.isExclusive) return isMin ? value <= bound.value : value >= bound.value;
  return isMin ? value < bound.value : value > bound.value;
};

const describeBound = (bound: Bound, isMin: boolean) =>
  `${isMin ? (bound.isExclusive ? 'over' : 'at least') : bound.isExclusive ? 'under' : 'at most'} ${bound.value}`;

/** A number field in its bounds; `fallback` undefined makes it required */
const readNumber = (
  obj: Record<string, unknown>,
  key: string,
  fallback: number | undefined,
  bounds: { min?: Bound; max?: Bound },
  path: string
) => {
  const value = obj[key] ?? fallback;
  if (value === undefined) return fail(`${path}.${key}`, 'is missing: give a number.');
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fail(`${path}.${key}`, `is ${JSON.stringify(value)}, not a number.`);
  }
  const { min, max } = bounds;
  if ((min && isPast(value, min, true)) || (max && isPast(value, max, false))) {
    const said = [min && describeBound(min, true), max && describeBound(max, false)];
    fail(`${path}.${key}`, `is ${value}: it's ${said.filter(Boolean).join(' and ')}.`);
  }
  return value;
};

/** A `[from, to]` field of metres, `from` under `to`; `fallback` undefined makes it required */
const readMetreRange = (
  obj: Record<string, unknown>,
  key: string,
  fallback: [number, number] | undefined,
  path: string
): [number, number] => {
  const value = obj[key] ?? fallback;
  const isPair =
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0);
  if (!isPair) {
    fail(`${path}.${key}`, `is ${JSON.stringify(value)}: give [from, to], metres of 0 or more.`);
  }
  const [from, to] = value as [number, number];
  if (from >= to)
    fail(`${path}.${key}`, `is [${from}, ${to}]: the first value is under the second.`);
  return [from, to];
};

const NON_NEGATIVE: { min: Bound } = { min: { value: 0 } };
const UNIT: { min: Bound; max: Bound } = { min: { value: 0 }, max: { value: 1 } };

/** An anti-tiling object, its mode's fields only, with their defaults */
const readAntiTiling = (value: unknown, path: string): TerrainAntiTilingDefine => {
  const obj = readObject(value, path);
  if (obj.mode === undefined)
    fail(`${path}.mode`, `is missing: use ${ANTI_TILING_MODES.join(', ')}.`);
  const mode = readEnum(obj, 'mode', ANTI_TILING_MODES, path);
  checkKeys(obj, ANTI_TILING_KEYS[mode], path);
  if (mode === 'DUAL_SCALE') {
    const farScale = readNumber(
      obj,
      'farScale',
      DUAL_SCALE_FAR_SCALE,
      { min: { value: 0, isExclusive: true }, max: { value: 1, isExclusive: true } },
      path
    );
    return { mode, farScale, distance: readMetreRange(obj, 'distance', DUAL_SCALE_DISTANCE, path) };
  }
  if (mode === 'HEX') {
    const contrastBounds = { min: { value: 0.05 }, max: { value: 0.95 } };
    return {
      mode,
      hexContrast: readNumber(obj, 'hexContrast', HEX_CONTRAST, contrastBounds, path),
      hexRotation: readNumber(obj, 'hexRotation', HEX_ROTATION, UNIT, path),
    };
  }
  return { mode };
};

const readLayer = (
  value: unknown,
  index: number,
  antiTiling: TerrainAntiTilingDefine
): TerrainLayerDefine => {
  const path = `.layers[${index}]`;
  const layer = readObject(value, path);
  checkKeys(layer, LAYER_KEYS, path);
  const tint = layer.tint ?? '#ffffff';
  if (typeof tint !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(tint)) {
    fail(`${path}.tint`, `is ${JSON.stringify(tint)}, not an sRGB "#rrggbb".`);
  }
  return {
    source: readEnum(layer, 'source', LAYER_SOURCES, path),
    tiling: readNumber(layer, 'tiling', 1, { min: { value: 0, isExclusive: true } }, path),
    rotation: layer.rotation === undefined ? null : readNumber(layer, 'rotation', 0, {}, path),
    tint: tint as string,
    normalStrength: readNumber(layer, 'normalStrength', 1, NON_NEGATIVE, path),
    roughnessScale: readNumber(layer, 'roughnessScale', 1, NON_NEGATIVE, path),
    antiTiling:
      layer.antiTiling === undefined
        ? antiTiling
        : readAntiTiling(layer.antiTiling, `${path}.antiTiling`),
  };
};

/** The macro variation, or null without one */
const readMacro = (define: Record<string, unknown>): TerrainMacroDefine | null => {
  if (define.macro === undefined) return null;
  const macro = readObject(define.macro, '.macro');
  checkKeys(macro, MACRO_KEYS, '.macro');
  return {
    scale: readNumber(
      macro,
      'scale',
      undefined,
      { min: { value: 0, isExclusive: true } },
      '.macro'
    ),
    brightness: readNumber(macro, 'brightness', MACRO_BRIGHTNESS, UNIT, '.macro'),
    hue: readNumber(macro, 'hue', MACRO_HUE, { min: { value: 0 }, max: { value: 180 } }, '.macro'),
    roughness: readNumber(macro, 'roughness', MACRO_ROUGHNESS, UNIT, '.macro'),
  };
};

/** The `quality` table: each tier's overrides checked for their keys (read when applied) */
const readQualityTable = (define: Record<string, unknown>) => {
  const table = define.quality === undefined ? {} : readObject(define.quality, '.quality');
  checkKeys(table, QUALITY_LEVELS, '.quality');
  const tiers: Partial<Record<(typeof QUALITY_LEVELS)[number], Record<string, unknown>>> = {};
  for (const level of QUALITY_LEVELS) {
    if (table[level] === undefined) continue;
    const tier = readObject(table[level], `.quality.${level}`);
    checkKeys(tier, OVERRIDE_KEYS, `.quality.${level}`);
    tiers[level] = tier;
  }
  return tiers;
};

/**
 * Reads a terrain material's static define (`staticDefines.terrain`), filling its defaults, and
 * throws naming the first field that's wrong or unknown (a later phase's field included). With a
 * `qualityLevel`, that tier's overrides replace the material's fields (shallowly) before they're
 * read; a tier that isn't applied is checked for its keys only. A layer's own `antiTiling`
 * replaces the material's (the tier's, when it gives one).
 * @internal
 */
export const readTerrainDefine = (
  staticDefines: Record<string, unknown> | undefined
): ResolvedTerrainDefine => {
  const raw = staticDefines?.terrain;
  if (raw === undefined) {
    throw new Error(
      '[terrain] Missing static define "terrain": the material\'s config without its id and sets (createTerrainMaterial makes it).'
    );
  }
  const define = readObject(raw, '');
  checkKeys(define, DEFINE_KEYS, '');
  const rawLayers = define.layers;
  if (!Array.isArray(rawLayers) || rawLayers.length < 1 || rawLayers.length > MAX_LAYERS) {
    fail('.layers', `is ${JSON.stringify(rawLayers)}: give 1 to ${MAX_LAYERS} layers.`);
  }
  const quality = readQualityTable(define);
  const qualityLevel = readOptionalEnum(define, 'qualityLevel', QUALITY_LEVELS, '');
  // The tier's fields over the material's (shallowly), read as the material's own
  const tier = qualityLevel ? quality[qualityLevel] : undefined;
  const fields = tier ? { ...define, ...tier } : define;
  const path = tier ? `.quality.${qualityLevel}` : '';
  const pathOf = (key: string) => (tier && key in tier ? path : '');

  const antiTiling: TerrainAntiTilingDefine =
    fields.antiTiling === undefined
      ? { mode: 'NONE' }
      : readAntiTiling(fields.antiTiling, `${pathOf('antiTiling')}.antiTiling`);
  const layers = (rawLayers as unknown[]).map((layer, i) => readLayer(layer, i, antiTiling));

  const blendPath = pathOf('blend');
  const blend = readOptionalObject(fields, 'blend', blendPath);
  checkKeys(blend, BLEND_KEYS, `${blendPath}.blend`);
  const blendSource = readEnum(blend, 'source', BLEND_SOURCES, `${blendPath}.blend`);
  if (blendSource === 'SINGLE' && layers.length !== 1) {
    fail('.layers', `blend.source SINGLE takes one layer, not ${layers.length}.`);
  }
  const aoPath = `${pathOf('ao')}.ao`;
  const ao = readOptionalObject(fields, 'ao', pathOf('ao'));
  checkKeys(ao, AO_KEYS, aoPath);
  const aoTextureInfluence = readNumber(ao, 'textureInfluence', 1, UNIT, aoPath);
  const distancePath = `${pathOf('distance')}.distance`;
  const distance = fields.distance === undefined ? null : readObject(fields.distance, distancePath);
  if (distance) checkKeys(distance, DISTANCE_KEYS, distancePath);
  return {
    layers,
    uv: readEnum(fields, 'uv', UV_MODES, pathOf('uv')),
    blendSource,
    aoTextureInfluence,
    macro: readMacro(define),
    distanceFade: distance ? readMetreRange(distance, 'fade', undefined, distancePath) : null,
    qualityLevel,
    debugView: readOptionalEnum(define, 'debugView', DEBUG_VIEWS, ''),
  };
};
