// The terrain material's static define read by hand (`staticDefines.terrain`, p305 D1): checked
// as it's read and filled with its defaults, for the graph to branch on. Not the Zod schema
// (`TerrainMaterialConfig.ts`): a build carrying the generator would carry zod with it (the texture
// sets' trap, `src/_engine/features/texturesets/CLAUDE.md`). `TerrainDefine.test.ts` keeps the two
// in step: the same keys, values and refusals.
const LAYER_SOURCES = ['TEXTURE'] as const;
const UV_MODES = ['WORLD', 'MESH_UV'] as const;
const BLEND_SOURCES = ['SINGLE'] as const;
const MAX_LAYERS = 16;

/** The keys each object of the define takes (the schema's) */
const DEFINE_KEYS = ['layers', 'uv', 'blend', 'ao'];
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
};

/** The values the hand reader takes, for the test that keeps them the schema's */
export const TERRAIN_DEFINE_VALUES = {
  defineKeys: DEFINE_KEYS,
  layerKeys: LAYER_KEYS,
  blendKeys: BLEND_KEYS,
  aoKeys: AO_KEYS,
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

/**
 * Reads a terrain material's static define (`staticDefines.terrain`), filling its defaults, and
 * throws naming the first field that's wrong or unknown (a later phase's field included).
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
  const blend = define.blend === undefined ? {} : readObject(define.blend, '.blend');
  checkKeys(blend, BLEND_KEYS, '.blend');
  const blendSource = readEnum(blend, 'source', BLEND_SOURCES, '.blend');
  if (blendSource === 'SINGLE' && layers.length !== 1) {
    fail('.layers', `blend.source SINGLE takes one layer, not ${layers.length}.`);
  }
  const ao = define.ao === undefined ? {} : readObject(define.ao, '.ao');
  checkKeys(ao, AO_KEYS, '.ao');
  const aoTextureInfluence = readNumber(
    ao,
    'textureInfluence',
    1,
    { value: 0, isExclusive: false },
    '.ao'
  );
  if (aoTextureInfluence > 1) fail('.ao.textureInfluence', `is ${aoTextureInfluence}: it's 0..1.`);
  return { layers, uv: readEnum(define, 'uv', UV_MODES, ''), blendSource, aoTextureInfluence };
};
