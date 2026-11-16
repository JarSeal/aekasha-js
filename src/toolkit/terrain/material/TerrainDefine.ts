// The terrain material's static define read by hand (`staticDefines.terrain`, p305 D1): checked
// as it's read and filled with its defaults, for the graph to branch on. Not the Zod schema
// (`TerrainMaterialConfig.ts`): a build carrying the generator would carry zod with it (the texture
// sets' trap, `src/_engine/features/texturesets/CLAUDE.md`). `TerrainDefine.test.ts` keeps the two
// in step: the same keys, values and refusals.
const LAYER_SOURCES = ['TEXTURE'] as const;
const UV_MODES = ['WORLD', 'MESH_UV'] as const;
const BLEND_SOURCES = ['SINGLE'] as const;
const MAX_LAYERS = 16;
const QUALITY_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'ULTRA'] as const;
const DEBUG_VIEWS = ['TEXEL_DENSITY', 'NORMALS'] as const;

/** The keys each object of the define takes (the schema's) */
const OVERRIDE_KEYS = ['uv', 'blend', 'ao'];
const DEFINE_KEYS = ['layers', ...OVERRIDE_KEYS, 'quality', 'qualityLevel', 'debugView'];
const LAYER_KEYS = ['source', 'tiling', 'rotation', 'tint', 'normalStrength', 'roughnessScale'];
const BLEND_KEYS = ['source'];
const AO_KEYS = ['textureInfluence'];

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
};

/** The static define with its defaults filled in: what the graph branches on */
export type ResolvedTerrainDefine = {
  layers: TerrainLayerDefine[];
  uv: (typeof UV_MODES)[number];
  blendSource: (typeof BLEND_SOURCES)[number];
  /** The texture AO's influence, 0..1 */
  aoTextureInfluence: number;
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
  overrideKeys: OVERRIDE_KEYS,
  qualityLevels: QUALITY_LEVELS,
  debugViews: DEBUG_VIEWS,
  layerSources: LAYER_SOURCES,
  uvModes: UV_MODES,
  blendSources: BLEND_SOURCES,
  maxLayers: MAX_LAYERS,
};

const fail = (path: string, message: string): never => {
  throw new Error(`[terrain] staticDefines.terrain${path}: ${message}`);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readObject = (value: unknown, path: string) =>
  isRecord(value) ? value : fail(path, `is ${JSON.stringify(value)}, not an object.`);

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

const readNumber = (
  obj: Record<string, unknown>,
  key: string,
  fallback: number,
  min: { value: number; isExclusive: boolean } | null,
  path: string
) => {
  const value = obj[key] ?? fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fail(`${path}.${key}`, `is ${JSON.stringify(value)}, not a number.`);
  }
  if (min && (min.isExclusive ? value <= min.value : value < min.value)) {
    fail(
      `${path}.${key}`,
      `is ${value}: it's ${min.isExclusive ? 'over' : 'at least'} ${min.value}.`
    );
  }
  return value;
};

const readLayer = (value: unknown, index: number): TerrainLayerDefine => {
  const path = `.layers[${index}]`;
  const layer = readObject(value, path);
  checkKeys(layer, LAYER_KEYS, path);
  const tint = layer.tint ?? '#ffffff';
  if (typeof tint !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(tint)) {
    fail(`${path}.tint`, `is ${JSON.stringify(tint)}, not an sRGB "#rrggbb".`);
  }
  return {
    source: readEnum(layer, 'source', LAYER_SOURCES, path),
    tiling: readNumber(layer, 'tiling', 1, { value: 0, isExclusive: true }, path),
    rotation: layer.rotation === undefined ? null : readNumber(layer, 'rotation', 0, null, path),
    tint: tint as string,
    normalStrength: readNumber(layer, 'normalStrength', 1, { value: 0, isExclusive: false }, path),
    roughnessScale: readNumber(layer, 'roughnessScale', 1, { value: 0, isExclusive: false }, path),
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
 * read; a tier that isn't applied is checked for its keys only.
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
  const layers = (rawLayers as unknown[]).map(readLayer);
  const quality = readQualityTable(define);
  const qualityLevel = readOptionalEnum(define, 'qualityLevel', QUALITY_LEVELS, '');
  // The tier's fields over the material's (shallowly), read as the material's own
  const tier = qualityLevel ? quality[qualityLevel] : undefined;
  const fields = tier ? { ...define, ...tier } : define;
  const path = tier ? `.quality.${qualityLevel}` : '';
  const pathOf = (key: string) => (tier && key in tier ? path : '');

  const blend =
    fields.blend === undefined ? {} : readObject(fields.blend, `${pathOf('blend')}.blend`);
  checkKeys(blend, BLEND_KEYS, `${pathOf('blend')}.blend`);
  const blendSource = readEnum(blend, 'source', BLEND_SOURCES, `${pathOf('blend')}.blend`);
  if (blendSource === 'SINGLE' && layers.length !== 1) {
    fail('.layers', `blend.source SINGLE takes one layer, not ${layers.length}.`);
  }
  const aoPath = `${pathOf('ao')}.ao`;
  const ao = fields.ao === undefined ? {} : readObject(fields.ao, aoPath);
  checkKeys(ao, AO_KEYS, aoPath);
  const aoTextureInfluence = readNumber(
    ao,
    'textureInfluence',
    1,
    { value: 0, isExclusive: false },
    aoPath
  );
  if (aoTextureInfluence > 1)
    fail(`${aoPath}.textureInfluence`, `is ${aoTextureInfluence}: it's 0..1.`);
  return {
    layers,
    uv: readEnum(fields, 'uv', UV_MODES, pathOf('uv')),
    blendSource,
    aoTextureInfluence,
    qualityLevel,
    debugView: readOptionalEnum(define, 'debugView', DEBUG_VIEWS, ''),
  };
};
