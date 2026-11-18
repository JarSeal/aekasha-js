// The terrain material's static define read by hand (`staticDefines.terrain`, p305 D1): checked
// as it's read and filled with its defaults, for the graph to branch on. Not the Zod schema
// (`TerrainMaterialConfig.ts`): a build carrying the generator would carry zod with it (the texture
// sets' trap, `src/_engine/features/texturesets/CLAUDE.md`). `TerrainDefine.test.ts` keeps the two
// in step: the same keys, values and refusals. Over 800 lines: one reader mirrors the whole
// schema field by field, so a field and its refusals sit next to its neighbours'.
import { TERRAIN_RULE_DEFAULTS, TERRAIN_RULE_NOISE_CHANNELS } from 'aekasha/toolkit/geometry';
import { SURFACE_WETNESS_DEFAULTS } from '../nodes/Wet';

const LAYER_SOURCES = ['TEXTURE', 'PROCEDURAL_LIVE'] as const;
const LIVE_NORMALS = ['BUMP', 'TAPS'] as const;
const LIVE_AOS = ['NONE', 'CAVITY'] as const;
const UV_MODES = ['WORLD', 'MESH_UV'] as const;
const SPACES = ['WORLD', 'OBJECT'] as const;
const BLEND_SOURCES = [
  'SINGLE',
  'VERTEX_COLOR',
  'SPLAT_MAP',
  'RULES',
  'VERTEX_COLOR_AND_RULES',
  'SPLAT_MAP_AND_RULES',
] as const;
const BLEND_MODES = ['HEIGHT', 'LINEAR'] as const;
const VERTEX_COLOR_LAYOUTS = ['RGB_AO', 'RGBA'] as const;
/** The layers each blend source takes, `[min, max]` (the schema's `TERRAIN_BLEND_LAYER_COUNTS`) */
const BLEND_LAYER_COUNTS = {
  SINGLE: [1, 1],
  VERTEX_COLOR_RGB_AO: [2, 4],
  VERTEX_COLOR_RGBA: [2, 5],
  SPLAT_MAP: [2, 9],
  RULES: [2, 16],
  VERTEX_COLOR_AND_RULES: [2, 16],
  SPLAT_MAP_AND_RULES: [2, 16],
} as const;
const ANTI_TILING_MODES = ['NONE', 'DUAL_SCALE', 'HEX'] as const;
const ANTI_TILING_APPLIES = ['ALL', 'DOMINANT'] as const;
/** The fewest and the most layers sparse sampling keeps (the schema's `TERRAIN_SPARSE_MAX_LAYERS`) */
const SPARSE_MAX_LAYERS = [2, 4] as const;
const PROJECTION_MODES = ['PLANAR', 'BIPLANAR', 'TRIPLANAR'] as const;
const NORMAL_BLENDS = ['WHITEOUT', 'UDN', 'RNM'] as const;
const FAR_MODES = ['NONE', 'AVERAGE_COLOR', 'COLOR_MAP'] as const;
const COLOR_MAP_MODES = ['DETAIL', 'FAR_ONLY'] as const;
const MAX_LAYERS = 16;
const MAX_RULES = 16;
const QUALITY_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'ULTRA'] as const;
const DEBUG_VIEWS = [
  'TEXEL_DENSITY',
  'NORMALS',
  'WEIGHTS',
  'PROJECTION',
  'TAPS',
  'LAYER_COUNT',
  'WETNESS',
] as const;
const WET_QUALITIES = ['FULL', 'SIMPLE'] as const;

/** The keys each object of the define takes (the schema's) */
const OVERRIDE_KEYS = [
  'uv',
  'blend',
  'ao',
  'antiTiling',
  'projection',
  'distance',
  'sparse',
  'wet',
];
/** A tier's keys: the material-wide ones and its layers' overrides */
const TIER_KEYS = [...OVERRIDE_KEYS, 'layers'];
const LAYER_OVERRIDE_KEYS = ['source', 'antiTiling', 'projection'];
const LIVE_KEYS = ['normal', 'ao'];
const SPARSE_KEYS = ['maxLayers'];
const DEFINE_KEYS = [
  'layers',
  'macro',
  'colorMap',
  'space',
  'reservedTextures',
  ...OVERRIDE_KEYS,
  'quality',
  'qualityLevel',
  'debugView',
];
const LAYER_KEYS = [
  'source',
  'live',
  'tiling',
  'rotation',
  'tint',
  'normalStrength',
  'roughnessScale',
  'heightContrast',
  'heightOffset',
  'antiTiling',
  'projection',
];
const BLEND_KEYS: Record<(typeof BLEND_SOURCES)[number], string[]> = {
  SINGLE: ['source'],
  VERTEX_COLOR: ['source', 'vertexColor', 'mode', 'heightBlendDepth'],
  SPLAT_MAP: ['source', 'mode', 'heightBlendDepth'],
  RULES: ['source', 'rules', 'mode', 'heightBlendDepth'],
  VERTEX_COLOR_AND_RULES: [
    'source',
    'vertexColor',
    'paintedLayers',
    'rules',
    'mode',
    'heightBlendDepth',
  ],
  SPLAT_MAP_AND_RULES: ['source', 'paintedLayers', 'rules', 'mode', 'heightBlendDepth'],
};
const RULE_KEYS = ['layer', 'slope', 'height', 'aspect', 'noise', 'strength'];
const RULE_RANGE_KEYS = ['min', 'max', 'softness'];
const RULE_ASPECT_KEYS = ['direction', 'range', 'softness'];
const RULE_NOISE_KEYS = ['scale', 'amount', 'channel'];
const VERTEX_COLOR_KEYS = ['layout'];
const AO_KEYS = ['textureInfluence', 'vertex', 'bakedAlbedoInfluence'];
const ANTI_TILING_KEYS: Record<(typeof ANTI_TILING_MODES)[number], string[]> = {
  NONE: ['mode'],
  DUAL_SCALE: ['mode', 'farScale', 'distance'],
  HEX: ['mode', 'hexContrast', 'hexRotation', 'apply', 'farScale', 'distance'],
};
const PROJECTED_KEYS = ['mode', 'sharpness', 'slopeGate', 'normalBlend'];
const PROJECTION_KEYS: Record<(typeof PROJECTION_MODES)[number], string[]> = {
  PLANAR: ['mode'],
  BIPLANAR: PROJECTED_KEYS,
  TRIPLANAR: PROJECTED_KEYS,
};
const MACRO_KEYS = ['scale', 'brightness', 'hue', 'roughness'];
const DISTANCE_KEYS = ['fade', 'far', 'farBlend'];
const WET_KEYS = [
  'quality',
  'heightInfluence',
  'cavityInfluence',
  'shelter',
  'puddles',
  'regional',
  'ripples',
  'streaks',
  'shoreline',
];
const WET_PUDDLE_KEYS = ['maxSlope', 'edge', 'patches'];
const WET_RIPPLE_KEYS = ['scale', 'lifetime', 'strength', 'distance'];
const WET_STREAK_KEYS = ['minSlope', 'scale', 'length', 'speed'];
const WET_SHORELINE_KEYS = ['band', 'noise', 'runUp'];
const WET_RUN_UP_KEYS = ['height', 'period'];
const WET_PATCH_KEYS = ['scale', 'amount'];
const WET_SPLAT_CHANNELS = ['A'] as const;
/** The vertex attribute a regional wetness reads by default: glTF's `_WETNESS` (GLTFLoader's
 * lowercase name) */
const WET_REGIONAL_ATTRIBUTE = '_wetness';
const COLOR_MAP_KEYS: Record<(typeof COLOR_MAP_MODES)[number], string[]> = {
  DETAIL: ['mode', 'detailDistance'],
  FAR_ONLY: ['mode'],
};

/** The anti-tiling defaults (p305 D3) */
const DUAL_SCALE_FAR_SCALE = 0.23;
const DUAL_SCALE_DISTANCE: [number, number] = [6, 40];
const HEX_CONTRAST = 0.5;
const HEX_ROTATION = 1;
/** The projections' sharpness defaults (p305 D5): Quilez's k, and the exponent on the facing */
const PROJECTION_SHARPNESS = { BIPLANAR: 8, TRIPLANAR: 4 } as const;
/** The macro variation's defaults (p305 D7) */
const MACRO_BRIGHTNESS = 0.2;
const MACRO_HUE = 8;
const MACRO_ROUGHNESS = 0.15;
/** The height blend's and the vertex AO's defaults (p305 D4) */
const HEIGHT_BLEND_DEPTH = 0.2;
const BAKED_ALBEDO_INFLUENCE = 0.5;
/** The far surface's band past the fade's end, metres (p305 D7) */
const FAR_BLEND = 4;
/**
 * The texture budget's default reserve (p305 D9: shadow maps, the environment).
 * @internal
 */
export const DEFAULT_RESERVED_TEXTURES = 6;

/** `DUAL_SCALE`'s numbers with their defaults filled in */
export type TerrainDualScaleDefine = { farScale: number; distance: [number, number] };

/**
 * A layer's anti-tiling with its defaults filled in: the mode's fields only; `HEX`'s `dominant` is
 * the other layers' `DUAL_SCALE` with `apply: 'DOMINANT'`, null for `ALL`
 */
export type TerrainAntiTilingDefine =
  | { mode: 'NONE' }
  | ({ mode: 'DUAL_SCALE' } & TerrainDualScaleDefine)
  | {
      mode: 'HEX';
      hexContrast: number;
      hexRotation: number;
      dominant: TerrainDualScaleDefine | null;
    };

/**
 * A layer's projection with its defaults filled in: the projecting modes' sharpness, slope gate
 * (degrees, null for none) and normal blend
 */
export type TerrainProjectionDefine =
  | { mode: 'PLANAR' }
  | {
      mode: 'BIPLANAR' | 'TRIPLANAR';
      sharpness: number;
      slopeGate: [number, number] | null;
      normalBlend: (typeof NORMAL_BLENDS)[number];
    };

/** A live layer's taps with their defaults filled in */
export type TerrainLiveDefine = {
  normal: (typeof LIVE_NORMALS)[number];
  ao: (typeof LIVE_AOS)[number];
};

/** A layer's settings with their defaults filled in */
export type TerrainLayerDefine = {
  /** Its own, else its tier's `layers` entry's */
  source: (typeof LAYER_SOURCES)[number];
  /** A live layer's taps (`PROCEDURAL_LIVE`), null for a sampled one */
  live: TerrainLiveDefine | null;
  tiling: number;
  /** Degrees; null compiles no rotation */
  rotation: number | null;
  /** sRGB `#rrggbb` */
  tint: string;
  normalStrength: number;
  roughnessScale: number;
  /** × the set's, about the height's middle (the height blend's) */
  heightContrast: number;
  /** Added to the height (the height blend's) */
  heightOffset: number;
  /** The layer's own, else the material's (after its tier's override); a live layer's `NONE` */
  antiTiling: TerrainAntiTilingDefine;
  /** The layer's own, else the material's (after its tier's override) */
  projection: TerrainProjectionDefine;
};

/**
 * How the layers are weighed, with its defaults filled in: past `SINGLE`, `heightBlend` is the
 * height blend's depth (null for `LINEAR`), `rules` the rules (none for a painted source alone)
 * and `paintedLayers` a combo's given count (null: as many as the source paints)
 */
export type TerrainBlendDefine =
  | { source: 'SINGLE' }
  | {
      source: 'VERTEX_COLOR' | 'VERTEX_COLOR_AND_RULES';
      layout: (typeof VERTEX_COLOR_LAYOUTS)[number];
      heightBlend: number | null;
      rules: TerrainRuleDefine[];
      paintedLayers: number | null;
    }
  | {
      source: 'SPLAT_MAP' | 'SPLAT_MAP_AND_RULES' | 'RULES';
      heightBlend: number | null;
      rules: TerrainRuleDefine[];
      paintedLayers: number | null;
    };

/** A rule's range with its defaults filled in: an end not given is null (open) */
export type TerrainRuleRangeDefine = { min: number | null; max: number | null; softness: number };

/** A rule with its defaults filled in: a test not given is null (not built) */
export type TerrainRuleDefine = {
  layer: number;
  /** Degrees */
  slope: TerrainRuleRangeDefine | null;
  /** Metres */
  height: TerrainRuleRangeDefine | null;
  /** The facing `[x, z]` as given, its range and softness in degrees */
  aspect: { direction: [number, number]; range: number; softness: number } | null;
  noise: {
    scale: number;
    amount: number;
    channel: (typeof TERRAIN_RULE_NOISE_CHANNELS)[number];
  } | null;
  strength: number;
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

/** The far surface past the detail normals' fade, with its defaults filled in */
export type TerrainFarDefine = {
  mode: Exclude<(typeof FAR_MODES)[number], 'NONE'>;
  /** The band past the fade's end where the near surface gives way to the far one, metres */
  blend: number;
};

/** The wet response's settings with their defaults filled in (p307 D2) */
export type TerrainWetDefine = {
  quality: (typeof WET_QUALITIES)[number];
  heightInfluence: number;
  cavityInfluence: number;
  /** The angles from up over which the rain's reach fades out, degrees */
  shelter: [number, number];
  /** The puddles (`FULL` only), or null for none */
  puddles: TerrainPuddlesDefine | null;
  /**
   * The regional wetness's source: a float vertex attribute, or the first splat map's A (a splat
   * source painting at most 4 layers); null for none
   */
  regional: { attribute: string } | { splatChannel: (typeof WET_SPLAT_CHANNELS)[number] } | null;
  /** The rain ripples (`FULL` only; the input `ripples`, a ripple atlas), or null for none */
  ripples: TerrainRipplesDefine | null;
  /** The rain streaks (the input `macro`'s R), or null for none */
  streaks: TerrainStreaksDefine | null;
  /** The shoreline along the water level, or null for none */
  shoreline: TerrainShorelineDefine | null;
};

/** The wet response's shoreline with its defaults filled in (p307 T8) */
export type TerrainShorelineDefine = {
  /** The metres above the water level that stay damp */
  band: number;
  /** The metres the waterline wanders along the shore */
  noise: number;
  /** The waves' run-up (the metres they reach, the seconds between them), or null for none */
  runUp: { height: number; period: number } | null;
};

/** The wet response's rain streaks with their defaults filled in (p307 T5) */
export type TerrainStreaksDefine = {
  /** The gentlest face that streaks, degrees from flat */
  minSlope: number;
  /** The metres one macro texture tile covers across the face */
  scale: number;
  /** How many times longer a tile is down the face than across */
  length: number;
  /** How fast the running water's pulses move down, metres a second */
  speed: number;
};

/** The wet response's rain ripples with their defaults filled in (p307 T4) */
export type TerrainRipplesDefine = {
  /** The metres one atlas tile covers */
  scale: number;
  /** The seconds a ring lives */
  lifetime: number;
  /** How far the rings tilt the normal */
  strength: number;
  /** The view distances over which the ripples fade out, metres: none sampled past the second */
  distance: [number, number];
};

/** The wet response's puddles with their defaults filled in (p307 T3) */
export type TerrainPuddlesDefine = {
  /** The steepest ground a puddle stands on, degrees from flat */
  maxSlope: number;
  /** The relief height over which a puddle's rim fades in */
  edge: number;
  /**
   * The macro texture's patches (B) at their own scale (one fetch of the input `macro`), or null
   * for none
   */
  patches: { scale: number; amount: number } | null;
};

/** The colour map's settings with their defaults filled in */
export type TerrainColorMapDefine = {
  mode: (typeof COLOR_MAP_MODES)[number];
  /** `DETAIL`'s fade of the detail, view distances in metres, or null for none */
  detailDistance: [number, number] | null;
};

/** The static define with its defaults filled in: what the graph branches on */
export type ResolvedTerrainDefine = {
  layers: TerrainLayerDefine[];
  /** The space the material samples in: the world's, or the mesh's own (`OBJECT`) */
  space: (typeof SPACES)[number];
  uv: (typeof UV_MODES)[number];
  blend: TerrainBlendDefine;
  /** The texture AO's influence, 0..1 */
  aoTextureInfluence: number;
  /** Whether the vertex colour's A is a baked AO (`RGB_AO` only) */
  aoVertex: boolean;
  /** The vertex AO's influence where the albedo has its AO baked in (`LITE`, `MINIMAL`), 0..1 */
  aoBakedAlbedoInfluence: number;
  /** The sampled textures kept for the rest of the shader: the budget is the limit less these */
  reservedTextures: number;
  /** The macro variation (its texture the input `macro`), or null for none */
  macro: TerrainMacroDefine | null;
  /**
   * Whether the define takes the input `macro`: it has a macro, a rule of its blend or of a
   * tier's has noise, or its wet response or a tier's has puddle patches or streaks (a tier's
   * variant shares the material's inputs)
   */
  takesMacroTexture: boolean;
  /**
   * Whether the define takes the input `ripples` (a ripple atlas): its wet response or a tier's
   * has ripples
   */
  takesRippleTexture: boolean;
  /** The detail normals' fade, view distances in metres, or null for none */
  distanceFade: [number, number] | null;
  /** The far surface past the fade's end (`distance.far`), or null for none (`NONE`) */
  far: TerrainFarDefine | null;
  /** The colour map (its texture the input `colorMap`), or null for none */
  colorMap: TerrainColorMapDefine | null;
  /** The wet response (p307), or null for none: dry */
  wet: TerrainWetDefine | null;
  /**
   * The layers sampled at a pixel in slots sorted by weight there (p305 D6: sparse sampling's kept
   * layers, or every layer for `HEX`'s `DOMINANT`; `ARRAY` storage, each read at a per-pixel
   * index), or null: every layer at its own index. Live layers are sampled beside the slots: they
   * don't count.
   */
  slotCount: number | null;
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
  ruleKeys: RULE_KEYS,
  ruleRangeKeys: RULE_RANGE_KEYS,
  ruleAspectKeys: RULE_ASPECT_KEYS,
  ruleNoiseKeys: RULE_NOISE_KEYS,
  maxRules: MAX_RULES,
  vertexColorKeys: VERTEX_COLOR_KEYS,
  aoKeys: AO_KEYS,
  antiTilingKeys: ANTI_TILING_KEYS,
  projectionKeys: PROJECTION_KEYS,
  macroKeys: MACRO_KEYS,
  distanceKeys: DISTANCE_KEYS,
  wetKeys: WET_KEYS,
  wetQualities: WET_QUALITIES,
  wetPuddleKeys: WET_PUDDLE_KEYS,
  wetPatchKeys: WET_PATCH_KEYS,
  wetRippleKeys: WET_RIPPLE_KEYS,
  wetStreakKeys: WET_STREAK_KEYS,
  wetShorelineKeys: WET_SHORELINE_KEYS,
  wetRunUpKeys: WET_RUN_UP_KEYS,
  wetSplatChannels: WET_SPLAT_CHANNELS,
  colorMapKeys: COLOR_MAP_KEYS,
  farModes: FAR_MODES,
  colorMapModes: COLOR_MAP_MODES,
  overrideKeys: OVERRIDE_KEYS,
  qualityLevels: QUALITY_LEVELS,
  debugViews: DEBUG_VIEWS,
  layerSources: LAYER_SOURCES,
  liveKeys: LIVE_KEYS,
  liveNormals: LIVE_NORMALS,
  liveAos: LIVE_AOS,
  uvModes: UV_MODES,
  spaces: SPACES,
  blendSources: BLEND_SOURCES,
  blendModes: BLEND_MODES,
  vertexColorLayouts: VERTEX_COLOR_LAYOUTS,
  blendLayerCounts: BLEND_LAYER_COUNTS,
  antiTilingModes: ANTI_TILING_MODES,
  antiTilingApplies: ANTI_TILING_APPLIES,
  sparseKeys: SPARSE_KEYS,
  sparseMaxLayers: SPARSE_MAX_LAYERS,
  tierKeys: TIER_KEYS,
  layerOverrideKeys: LAYER_OVERRIDE_KEYS,
  projectionModes: PROJECTION_MODES,
  normalBlends: NORMAL_BLENDS,
  maxLayers: MAX_LAYERS,
};

/** The errors' prefix, before the field's path */
const FAIL_PREFIX = '[terrain] staticDefines.terrain';

function fail(path: string, message: string): never {
  throw new Error(`${FAIL_PREFIX}${path}: ${message}`);
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

/** `DUAL_SCALE`'s numbers (and `HEX`'s for `DOMINANT`'s other layers), with their defaults */
const readDualScale = (obj: Record<string, unknown>, path: string): TerrainDualScaleDefine => {
  const farScale = readNumber(
    obj,
    'farScale',
    DUAL_SCALE_FAR_SCALE,
    { min: { value: 0, isExclusive: true }, max: { value: 1, isExclusive: true } },
    path
  );
  return { farScale, distance: readMetreRange(obj, 'distance', DUAL_SCALE_DISTANCE, path) };
};

/** An anti-tiling object, its mode's fields only, with their defaults */
const readAntiTiling = (value: unknown, path: string): TerrainAntiTilingDefine => {
  const obj = readObject(value, path);
  if (obj.mode === undefined)
    fail(`${path}.mode`, `is missing: use ${ANTI_TILING_MODES.join(', ')}.`);
  const mode = readEnum(obj, 'mode', ANTI_TILING_MODES, path);
  checkKeys(obj, ANTI_TILING_KEYS[mode], path);
  if (mode === 'DUAL_SCALE') return { mode, ...readDualScale(obj, path) };
  if (mode === 'HEX') {
    const contrastBounds = { min: { value: 0.05 }, max: { value: 0.95 } };
    const apply = readEnum(obj, 'apply', ANTI_TILING_APPLIES, path);
    if (apply === 'ALL') {
      for (const key of ['farScale', 'distance']) {
        if (obj[key] !== undefined) {
          fail(`${path}.${key}`, "is for apply DOMINANT (the other layers' DUAL_SCALE).");
        }
      }
    }
    return {
      mode,
      hexContrast: readNumber(obj, 'hexContrast', HEX_CONTRAST, contrastBounds, path),
      hexRotation: readNumber(obj, 'hexRotation', HEX_ROTATION, UNIT, path),
      dominant: apply === 'DOMINANT' ? readDualScale(obj, path) : null,
    };
  }
  return { mode };
};

/** A `[from, to]` field of slopes in degrees, 0..90, `from` under `to`; null when it's absent */
const readSlopeRange = (obj: Record<string, unknown>, key: string, path: string) => {
  const value = obj[key];
  if (value === undefined) return null;
  const isPair =
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 90);
  if (!isPair) {
    fail(`${path}.${key}`, `is ${JSON.stringify(value)}: give [from, to], degrees 0 to 90.`);
  }
  const [from, to] = value as [number, number];
  if (from >= to) {
    fail(`${path}.${key}`, `is [${from}, ${to}]: the first value is under the second.`);
  }
  return [from, to] as [number, number];
};

/** A projection object, its mode's fields only, with their defaults */
const readProjection = (value: unknown, path: string): TerrainProjectionDefine => {
  const obj = readObject(value, path);
  if (obj.mode === undefined) {
    fail(`${path}.mode`, `is missing: use ${PROJECTION_MODES.join(', ')}.`);
  }
  const mode = readEnum(obj, 'mode', PROJECTION_MODES, path);
  checkKeys(obj, PROJECTION_KEYS[mode], path);
  if (mode === 'PLANAR') return { mode };
  const sharpnessBounds = { min: { value: 1 }, max: { value: 32 } };
  return {
    mode,
    sharpness: readNumber(obj, 'sharpness', PROJECTION_SHARPNESS[mode], sharpnessBounds, path),
    slopeGate: readSlopeRange(obj, 'slopeGate', path),
    normalBlend: readEnum(obj, 'normalBlend', NORMAL_BLENDS, path),
  };
};

/** The layer counts a blend takes, `[min, max]`, and its name for an error */
const getBlendLayerCounts = (blend: TerrainBlendDefine) =>
  blend.source === 'VERTEX_COLOR'
    ? {
        counts: BLEND_LAYER_COUNTS[`VERTEX_COLOR_${blend.layout}`],
        name: `VERTEX_COLOR (${blend.layout})`,
      }
    : { counts: BLEND_LAYER_COUNTS[blend.source], name: blend.source };

/**
 * The painted source a blend has: `VERTEX_COLOR`, `SPLAT_MAP` (alone or under rules), or null
 * (`SINGLE`, `RULES`).
 * @internal
 */
export const getPaintedSource = (blend: TerrainBlendDefine) => {
  if (blend.source === 'VERTEX_COLOR' || blend.source === 'VERTEX_COLOR_AND_RULES') {
    return 'VERTEX_COLOR';
  }
  if (blend.source === 'SPLAT_MAP' || blend.source === 'SPLAT_MAP_AND_RULES') return 'SPLAT_MAP';
  return null;
};

/** The most layers a blend's paint weighs: its source's (a layout's), 1 (the base) without paint */
const getMaxPaintedLayers = (blend: TerrainBlendDefine) => {
  if (blend.source === 'VERTEX_COLOR' || blend.source === 'VERTEX_COLOR_AND_RULES') {
    return BLEND_LAYER_COUNTS[`VERTEX_COLOR_${blend.layout}`][1];
  }
  return getPaintedSource(blend) === 'SPLAT_MAP' ? BLEND_LAYER_COUNTS.SPLAT_MAP[1] : 1;
};

/**
 * The layers the blend's paint weighs, from layer 0 (its base): a combo's `paintedLayers`, else the
 * painted source's most, fewer with fewer layers; 1 without paint (the base, which the rules
 * cover).
 * @internal
 */
export const getPaintedLayerCount = (blend: TerrainBlendDefine, layerCount: number) =>
  (blend.source !== 'SINGLE' && blend.paintedLayers) ||
  Math.min(layerCount, getMaxPaintedLayers(blend));

/**
 * The splat maps a blend takes: one per four painted layers past the base (`splat0` layers 1-4,
 * `splat1` 5-8), none without splat maps.
 * @internal
 */
export const getSplatMapCount = (blend: TerrainBlendDefine, layerCount: number) =>
  getPaintedSource(blend) === 'SPLAT_MAP'
    ? Math.ceil((getPaintedLayerCount(blend, layerCount) - 1) / 4)
    : 0;

/** An optional number field: null when it's absent */
const readOptionalNumber = (
  obj: Record<string, unknown>,
  key: string,
  bounds: { min?: Bound; max?: Bound },
  path: string
) => (obj[key] === undefined ? null : readNumber(obj, key, undefined, bounds, path));

/** A rule's range: `min`, `max` or both (`min` at most `max`), its softness defaulted */
const readRuleRange = (
  value: unknown,
  bounds: { min?: Bound; max?: Bound },
  softness: number,
  path: string
): TerrainRuleRangeDefine => {
  const obj = readObject(value, path);
  checkKeys(obj, RULE_RANGE_KEYS, path);
  const min = readOptionalNumber(obj, 'min', bounds, path);
  const max = readOptionalNumber(obj, 'max', bounds, path);
  if (min === null && max === null) fail(path, 'has no end: give min, max or both.');
  if (min !== null && max !== null && min > max) {
    fail(path, `has min ${min} over max ${max}: min is at most max.`);
  }
  return { min, max, softness: readNumber(obj, 'softness', softness, NON_NEGATIVE, path) };
};

/** A rule's facing: a direction that isn't `[0, 0]`, its range and softness in degrees */
const readRuleAspect = (value: unknown, path: string): TerrainRuleDefine['aspect'] => {
  const obj = readObject(value, path);
  checkKeys(obj, RULE_ASPECT_KEYS, path);
  const direction = obj.direction;
  const isPair =
    Array.isArray(direction) &&
    direction.length === 2 &&
    direction.every((n) => typeof n === 'number' && Number.isFinite(n)) &&
    (direction[0] !== 0 || direction[1] !== 0);
  if (!isPair) {
    fail(`${path}.direction`, `is ${JSON.stringify(direction)}: give [x, z], not [0, 0].`);
  }
  const degrees = { min: { value: 0 }, max: { value: 180 } };
  return {
    direction: [...(direction as [number, number])],
    range: readNumber(obj, 'range', undefined, degrees, path),
    softness: readNumber(obj, 'softness', TERRAIN_RULE_DEFAULTS.aspectSoftness, degrees, path),
  };
};

/** A rule's noise: its scale, amount and channel */
const readRuleNoise = (value: unknown, path: string): TerrainRuleDefine['noise'] => {
  const obj = readObject(value, path);
  checkKeys(obj, RULE_NOISE_KEYS, path);
  return {
    scale: readNumber(obj, 'scale', undefined, { min: { value: 0, isExclusive: true } }, path),
    amount: readNumber(obj, 'amount', undefined, UNIT, path),
    channel: readEnum(
      { channel: obj.channel ?? TERRAIN_RULE_DEFAULTS.noiseChannel },
      'channel',
      TERRAIN_RULE_NOISE_CHANNELS,
      path
    ),
  };
};

/** A rule: its layer (checked against the layers later), the tests it gives, its strength */
const readRule = (value: unknown, path: string): TerrainRuleDefine => {
  const obj = readObject(value, path);
  checkKeys(obj, RULE_KEYS, path);
  const layer = readNumber(obj, 'layer', undefined, { min: { value: 0 } }, path);
  if (!Number.isInteger(layer)) fail(`${path}.layer`, `is ${layer}, not a whole number.`);
  const slopeBounds = { min: { value: 0 }, max: { value: 90 } };
  const rule: TerrainRuleDefine = {
    layer,
    slope:
      obj.slope === undefined
        ? null
        : readRuleRange(
            obj.slope,
            slopeBounds,
            TERRAIN_RULE_DEFAULTS.slopeSoftness,
            `${path}.slope`
          ),
    height:
      obj.height === undefined
        ? null
        : readRuleRange(obj.height, {}, TERRAIN_RULE_DEFAULTS.heightSoftness, `${path}.height`),
    aspect: obj.aspect === undefined ? null : readRuleAspect(obj.aspect, `${path}.aspect`),
    noise: obj.noise === undefined ? null : readRuleNoise(obj.noise, `${path}.noise`),
    strength: readNumber(obj, 'strength', TERRAIN_RULE_DEFAULTS.strength, UNIT, path),
  };
  if (!rule.slope && !rule.height && !rule.aspect && !rule.noise) {
    fail(path, 'has no test: give slope, height, aspect or noise.');
  }
  return rule;
};

/**
 * A terrain rule from outside a define (a terrain block generator's params, p306), checked as the
 * define's rules are; the errors name `where` and the path in place of the define's.
 * @internal
 * @param where what holds the rule, eg. `rulesTerrain: block "hills" params`
 * @param path the rule's path under it, eg. `.rules[0]`
 */
export const checkTerrainRule = (value: unknown, where: string, path: string) => {
  try {
    readRule(value, path);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(FAIL_PREFIX)) {
      throw new Error(`${where}${error.message.slice(FAIL_PREFIX.length)}`);
    }
    throw error;
  }
};

/** A rules source's rules: 1 to 16 */
const readRules = (obj: Record<string, unknown>, path: string) => {
  const rules = obj.rules;
  if (!Array.isArray(rules) || rules.length < 1 || rules.length > MAX_RULES) {
    fail(`${path}.rules`, `is ${JSON.stringify(rules)}: give 1 to ${MAX_RULES} rules.`);
  }
  return (rules as unknown[]).map((rule, i) => readRule(rule, `${path}.rules[${i}]`));
};

/** The blend object (absent: `SINGLE`), its source's fields only, with their defaults */
const readBlend = (value: unknown, path: string): TerrainBlendDefine => {
  if (value === undefined) return { source: 'SINGLE' };
  const obj = readObject(value, path);
  if (obj.source === undefined)
    fail(`${path}.source`, `is missing: use ${BLEND_SOURCES.join(', ')}.`);
  const source = readEnum(obj, 'source', BLEND_SOURCES, path);
  checkKeys(obj, BLEND_KEYS[source], path);
  if (source === 'SINGLE') return { source };
  const mode = readEnum(obj, 'mode', BLEND_MODES, path);
  if (mode === 'LINEAR' && obj.heightBlendDepth !== undefined) {
    fail(`${path}.heightBlendDepth`, 'is for blend.mode HEIGHT, not LINEAR.');
  }
  const depthBounds = { min: { value: 0.02 }, max: { value: 0.5 } };
  const heightBlend =
    mode === 'HEIGHT'
      ? readNumber(obj, 'heightBlendDepth', HEIGHT_BLEND_DEPTH, depthBounds, path)
      : null;
  const rules = BLEND_KEYS[source].includes('rules') ? readRules(obj, path) : [];
  const paintedLayers = readOptionalNumber(
    obj,
    'paintedLayers',
    { min: { value: 2 }, max: { value: BLEND_LAYER_COUNTS.SPLAT_MAP[1] } },
    path
  );
  if (paintedLayers !== null && !Number.isInteger(paintedLayers)) {
    fail(`${path}.paintedLayers`, `is ${paintedLayers}, not a whole number.`);
  }
  if (source !== 'VERTEX_COLOR' && source !== 'VERTEX_COLOR_AND_RULES') {
    return { source, heightBlend, rules, paintedLayers };
  }
  const vertexColorPath = `${path}.vertexColor`;
  const vertexColor = readOptionalObject(obj, 'vertexColor', path);
  checkKeys(vertexColor, VERTEX_COLOR_KEYS, vertexColorPath);
  if (obj.vertexColor !== undefined && vertexColor.layout === undefined) {
    fail(`${vertexColorPath}.layout`, `is missing: use ${VERTEX_COLOR_LAYOUTS.join(', ')}.`);
  }
  const layout = readEnum(vertexColor, 'layout', VERTEX_COLOR_LAYOUTS, vertexColorPath);
  return { source, layout, heightBlend, rules, paintedLayers };
};

/**
 * The rules' layers against the material's: each rule's one of them, and each layer past the
 * painted ones some rule's (nothing else weighs it)
 */
const checkRuleLayers = (blend: TerrainBlendDefine, layerCount: number, path: string) => {
  if (blend.source === 'SINGLE' || !blend.rules.length) return;
  const most = Math.min(layerCount, getMaxPaintedLayers(blend));
  if (blend.paintedLayers !== null && blend.paintedLayers > most) {
    fail(
      `${path}.paintedLayers`,
      `is ${blend.paintedLayers}: the paint weighs ${most} layers at most here.`
    );
  }
  blend.rules.forEach((rule, i) => {
    if (rule.layer >= layerCount) {
      fail(`${path}.rules[${i}].layer`, `is ${rule.layer}: there are ${layerCount} layers.`);
    }
  });
  for (let layer = getPaintedLayerCount(blend, layerCount); layer < layerCount; layer++) {
    if (!blend.rules.some((rule) => rule.layer === layer)) {
      fail(`.layers[${layer}]`, "is neither painted nor a rule's layer: nothing weighs it.");
    }
  }
};

/** Whether a raw blend (a tier's, not read unless applied) has a rule with noise */
const hasRawRuleNoise = (blend: unknown) => {
  const rules = isRecord(blend) ? blend.rules : undefined;
  return Array.isArray(rules) && rules.some((rule) => isRecord(rule) && rule.noise !== undefined);
};

/** An optional boolean field: false when it's absent */
const readBoolean = (obj: Record<string, unknown>, key: string, path: string) => {
  const value = obj[key] ?? false;
  if (typeof value !== 'boolean')
    fail(`${path}.${key}`, `is ${JSON.stringify(value)}, not true or false.`);
  return value as boolean;
};

/** The material-wide settings a layer's own replace */
type LayerFallbacks = {
  antiTiling: TerrainAntiTilingDefine;
  projection: TerrainProjectionDefine;
};

/** A layer's settings a tier overrides (`quality.<tier>.layers[i]`) */
type LayerSamplingKey = 'source' | 'antiTiling' | 'projection';

/**
 * Where each layer's source, anti-tiling and projection are given: its tier's `layers` entry, else
 * its own, else the material-wide path (the tier's when it gives one); the paths for errors
 */
type LayerPaths = Record<LayerSamplingKey, string>[];

/** A live layer's taps (`live`), its defaults filled in; checked where it isn't live too */
const readLive = (layer: Record<string, unknown>, path: string): TerrainLiveDefine => {
  const livePath = `${path}.live`;
  const live = readOptionalObject(layer, 'live', path);
  checkKeys(live, LIVE_KEYS, livePath);
  return {
    normal: readEnum(live, 'normal', LIVE_NORMALS, livePath),
    ao: readEnum(live, 'ao', LIVE_AOS, livePath),
  };
};

/**
 * A live layer's anti-tiling: `NONE` (its surface never repeats); one given at the layer (its own,
 * its tier's entry) is refused unless `NONE`, a material-wide one doesn't reach it
 */
const readLiveAntiTiling = (given: unknown, path: string): TerrainAntiTilingDefine => {
  if (given === undefined) return { mode: 'NONE' };
  const antiTiling = readAntiTiling(given, `${path}.antiTiling`);
  if (antiTiling.mode !== 'NONE') {
    fail(
      `${path}.antiTiling`,
      `is ${antiTiling.mode} on a live layer (source PROCEDURAL_LIVE): its surface never repeats, so it takes no anti-tiling.`
    );
  }
  return antiTiling;
};

/**
 * A layer, its source, anti-tiling and projection read at the paths that give them (a tier's
 * override, its own, else the material-wide fallback; a live layer's anti-tiling its own or none)
 */
const readLayer = (
  value: unknown,
  index: number,
  fallbacks: LayerFallbacks,
  override: Record<string, unknown> | undefined,
  paths: Record<LayerSamplingKey, string>
): TerrainLayerDefine => {
  const path = `.layers[${index}]`;
  const layer = readObject(value, path);
  checkKeys(layer, LAYER_KEYS, path);
  const given = (key: LayerSamplingKey) => override?.[key] ?? layer[key];
  const source = readEnum({ source: given('source') }, 'source', LAYER_SOURCES, paths.source);
  const live = readLive(layer, path);
  const tint = layer.tint ?? '#ffffff';
  if (typeof tint !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(tint)) {
    fail(`${path}.tint`, `is ${JSON.stringify(tint)}, not an sRGB "#rrggbb".`);
  }
  const isLive = source === 'PROCEDURAL_LIVE';
  return {
    source,
    live: isLive ? live : null,
    tiling: readNumber(layer, 'tiling', 1, { min: { value: 0, isExclusive: true } }, path),
    rotation: layer.rotation === undefined ? null : readNumber(layer, 'rotation', 0, {}, path),
    tint: tint as string,
    normalStrength: readNumber(layer, 'normalStrength', 1, NON_NEGATIVE, path),
    roughnessScale: readNumber(layer, 'roughnessScale', 1, NON_NEGATIVE, path),
    heightContrast: readNumber(layer, 'heightContrast', 1, NON_NEGATIVE, path),
    heightOffset: readNumber(
      layer,
      'heightOffset',
      0,
      { min: { value: -1 }, max: { value: 1 } },
      path
    ),
    antiTiling: isLive
      ? readLiveAntiTiling(given('antiTiling'), paths.antiTiling)
      : given('antiTiling') === undefined
        ? fallbacks.antiTiling
        : readAntiTiling(given('antiTiling'), `${paths.antiTiling}.antiTiling`),
    projection:
      given('projection') === undefined
        ? fallbacks.projection
        : readProjection(given('projection'), `${paths.projection}.projection`),
  };
};

/**
 * The layers' projections against the tiling's coordinates: `BIPLANAR` and `TRIPLANAR` project the
 * world, so they need `uv: 'WORLD'`
 */
const checkProjectionUv = (
  layers: TerrainLayerDefine[],
  uv: (typeof UV_MODES)[number],
  paths: LayerPaths
) => {
  if (uv !== 'MESH_UV') return;
  layers.forEach(({ projection }, i) => {
    if (projection.mode === 'PLANAR') return;
    fail(
      `${paths[i].projection}.projection.mode`,
      `is ${projection.mode}: it projects the world, which needs uv WORLD (not MESH_UV).`
    );
  });
};

/** An anti-tiling as the slots compare it: its mode, and `HEX`'s `apply` */
const describeSlotAntiTiling = (antiTiling: TerrainAntiTilingDefine) => {
  if (antiTiling.mode !== 'HEX') return antiTiling.mode;
  return `HEX ${antiTiling.dominant ? 'DOMINANT' : 'ALL'}`;
};

/** A projecting layer's projection as the slots compare it: its mode and normal blend */
const describeSlotProjection = (projection: TerrainProjectionDefine) =>
  projection.mode === 'PLANAR' ? 'PLANAR' : `${projection.mode} ${projection.normalBlend}`;

/**
 * The layers sampled in slots sorted by weight (p305 D6), or null for every layer at its own
 * index: sparse sampling keeping fewer layers than there are (its `maxLayers` of them), or `HEX`'s
 * `DOMINANT` over two layers or more (every layer). Live layers are sampled beside the slots and
 * don't count. In slots, every sampled layer's anti-tiling is alike (its mode and `apply`) and the
 * projected layers' projection (its mode and normal blend): a slot samples whichever layer weighs
 * most there.
 */
const readSlotCount = (layers: TerrainLayerDefine[], sparse: number | null, paths: LayerPaths) => {
  const sampled = layers.flatMap((layer, i) => (layer.live ? [] : [{ ...layer, i }]));
  const count = sampled.length;
  const isDominant = sampled.some(
    ({ antiTiling }) => antiTiling.mode === 'HEX' && antiTiling.dominant !== null
  );
  if (!((sparse !== null && sparse < count) || (isDominant && count > 1))) return null;
  const first = describeSlotAntiTiling(sampled[0].antiTiling);
  sampled.forEach(({ antiTiling, i }) => {
    const own = describeSlotAntiTiling(antiTiling);
    if (own !== first) {
      fail(
        `${paths[i].antiTiling}.antiTiling`,
        `is ${own}, layer ${sampled[0].i}'s ${first}: sparse sampling and DOMINANT sample every layer alike, so the layers take one anti-tiling mode (their numbers may differ).`
      );
    }
  });
  const projected = sampled.flatMap(({ projection, i }) =>
    projection.mode === 'PLANAR' ? [] : [{ i, kind: describeSlotProjection(projection) }]
  );
  for (const { i, kind } of projected) {
    if (kind !== projected[0].kind) {
      fail(
        `${paths[i].projection}.projection`,
        `is ${kind}, the first projected layer's ${projected[0].kind}: sparse sampling and DOMINANT project every projected layer alike, so they take one mode and normal blend (planar layers mix in).`
      );
    }
  }
  return Math.min(sparse ?? count, count);
};

/** The sparse sampling's kept layers (`maxLayers`, a whole number 2..4), or null for none */
const readSparse = (fields: Record<string, unknown>, path: string) => {
  if (fields.sparse === undefined) return null;
  const sparsePath = `${path}.sparse`;
  const sparse = readObject(fields.sparse, sparsePath);
  checkKeys(sparse, SPARSE_KEYS, sparsePath);
  const [min, max] = SPARSE_MAX_LAYERS;
  const bounds = { min: { value: min }, max: { value: max } };
  const maxLayers = readNumber(sparse, 'maxLayers', undefined, bounds, sparsePath);
  if (!Number.isInteger(maxLayers)) {
    fail(`${sparsePath}.maxLayers`, `is ${maxLayers}, not a whole number.`);
  }
  return maxLayers;
};

/**
 * A tier's per-layer overrides (`layers`, at most one entry a layer, each `antiTiling` and
 * `projection` only), or undefined without
 */
const readTierLayers = (
  tier: Record<string, unknown> | undefined,
  layerCount: number,
  path: string
) => {
  if (tier?.layers === undefined) return undefined;
  const overrides = tier.layers;
  if (!Array.isArray(overrides)) {
    fail(
      `${path}.layers`,
      `is ${JSON.stringify(overrides)}: give one entry a layer ({} for none).`
    );
  }
  if (overrides.length > layerCount) {
    fail(`${path}.layers`, `has ${overrides.length} entries: there are ${layerCount} layers.`);
  }
  return (overrides as unknown[]).map((override, i) => {
    const overridePath = `${path}.layers[${i}]`;
    const obj = readObject(override, overridePath);
    checkKeys(obj, LAYER_OVERRIDE_KEYS, overridePath);
    return obj;
  });
};

/**
 * A layer's `live` taps only where some context samples it live: its own source, or a tier's
 * `layers` entry
 */
const checkLiveTaps = (rawLayers: unknown[], tiers: Record<string, unknown>[]) => {
  rawLayers.forEach((layer, i) => {
    if (!isRecord(layer) || layer.live === undefined) return;
    const tierSources = tiers.map((tier) =>
      Array.isArray(tier.layers) && isRecord(tier.layers[i]) ? tier.layers[i].source : undefined
    );
    if ([layer.source, ...tierSources].includes('PROCEDURAL_LIVE')) return;
    fail(
      `.layers[${i}].live`,
      "is for a live layer: give source PROCEDURAL_LIVE (the layer's, or a tier's layers entry)."
    );
  });
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

/** The colour map, its mode's fields only, or null without one */
const readColorMap = (define: Record<string, unknown>): TerrainColorMapDefine | null => {
  if (define.colorMap === undefined) return null;
  const path = '.colorMap';
  const colorMap = readObject(define.colorMap, path);
  if (colorMap.mode === undefined) {
    fail(`${path}.mode`, `is missing: use ${COLOR_MAP_MODES.join(', ')}.`);
  }
  const mode = readEnum(colorMap, 'mode', COLOR_MAP_MODES, path);
  checkKeys(colorMap, COLOR_MAP_KEYS[mode], path);
  const detailDistance =
    colorMap.detailDistance === undefined
      ? null
      : readMetreRange(colorMap, 'detailDistance', undefined, path);
  return { mode, detailDistance };
};

/**
 * The distance's fade and far surface (`distance`, the tier's when it gives one): the far mode
 * with its band (`farBlend` refused without one), `COLOR_MAP` only with a colour map,
 * `AVERAGE_COLOR` not with a `DETAIL` one
 */
const readDistance = (
  value: unknown,
  colorMap: TerrainColorMapDefine | null,
  path: string
): { fade: [number, number]; far: TerrainFarDefine | null } | null => {
  if (value === undefined) return null;
  const distance = readObject(value, path);
  checkKeys(distance, DISTANCE_KEYS, path);
  const fade = readMetreRange(distance, 'fade', undefined, path);
  const mode = readEnum(distance, 'far', FAR_MODES, path);
  if (mode === 'NONE') {
    if (distance.farBlend !== undefined) {
      fail(`${path}.farBlend`, 'is for a far mode (distance.far AVERAGE_COLOR or COLOR_MAP).');
    }
    return { fade, far: null };
  }
  if (mode === 'COLOR_MAP' && !colorMap) {
    fail(`${path}.far`, 'is COLOR_MAP: give a colorMap (its texture the input colorMap).');
  }
  if (mode === 'AVERAGE_COLOR' && colorMap?.mode === 'DETAIL') {
    fail(
      `${path}.far`,
      "is AVERAGE_COLOR with a DETAIL colour map, whose colour the layers' averages would drop far away: use COLOR_MAP."
    );
  }
  return {
    fade,
    far: { mode, blend: readNumber(distance, 'farBlend', FAR_BLEND, NON_NEGATIVE, path) },
  };
};

/**
 * A `FAR_ONLY` colour map against the far modes: the material's distance or a tier's must be
 * `COLOR_MAP` (a tier's variant shares the material's inputs), else nothing reads it
 */
const checkFarOnly = (
  colorMap: TerrainColorMapDefine | null,
  define: Record<string, unknown>,
  tiers: Record<string, unknown>[]
) => {
  if (colorMap?.mode !== 'FAR_ONLY') return;
  const isFarColorMap = (distance: unknown) => isRecord(distance) && distance.far === 'COLOR_MAP';
  if ([define, ...tiers].some((fields) => isFarColorMap(fields.distance))) return;
  fail(
    '.colorMap.mode',
    "is FAR_ONLY: give distance.far COLOR_MAP (the material's or a tier's), else nothing reads it."
  );
};

/**
 * The wet response (`wet`, the tier's when it gives one), its defaults filled in; null without:
 * the shelter's angles within 0..180, the first under the second
 */
const readWet = (value: unknown, path: string): TerrainWetDefine | null => {
  if (value === undefined) return null;
  const wet = readObject(value, path);
  checkKeys(wet, WET_KEYS, path);
  const shelter = wet.shelter ?? SURFACE_WETNESS_DEFAULTS.shelter;
  const isPair =
    Array.isArray(shelter) &&
    shelter.length === 2 &&
    shelter.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 180);
  if (!isPair) {
    fail(`${path}.shelter`, `is ${JSON.stringify(shelter)}: give [from, to], degrees 0 to 180.`);
  }
  const [from, to] = shelter as [number, number];
  if (from >= to) {
    fail(`${path}.shelter`, `is [${from}, ${to}]: the first value is under the second.`);
  }
  const { heightInfluence, cavityInfluence } = SURFACE_WETNESS_DEFAULTS;
  const quality = readEnum(wet, 'quality', WET_QUALITIES, path);
  if (quality === 'SIMPLE' && wet.puddles !== undefined) {
    fail(`${path}.puddles`, 'is for quality FULL: SIMPLE reads no relief to fill.');
  }
  if (quality === 'SIMPLE' && wet.ripples !== undefined) {
    fail(`${path}.ripples`, 'is for quality FULL: SIMPLE leaves the normal alone.');
  }
  return {
    quality,
    heightInfluence: readNumber(wet, 'heightInfluence', heightInfluence, NON_NEGATIVE, path),
    cavityInfluence: readNumber(wet, 'cavityInfluence', cavityInfluence, NON_NEGATIVE, path),
    shelter: [from, to],
    puddles: readPuddles(wet.puddles, `${path}.puddles`),
    regional: readRegional(wet.regional, `${path}.regional`),
    ripples: readRipples(wet.ripples, `${path}.ripples`),
    streaks: readStreaks(wet.streaks, `${path}.streaks`),
    shoreline: readShoreline(wet.shoreline, `${path}.shoreline`),
  };
};

/** The shoreline's numbers (p307 T8), their defaults filled in (`band` required); null without */
const readShoreline = (value: unknown, path: string): TerrainShorelineDefine | null => {
  if (value === undefined) return null;
  const shoreline = readObject(value, path);
  checkKeys(shoreline, WET_SHORELINE_KEYS, path);
  const { shoreNoise, shoreRunUpHeight, shoreRunUpPeriod } = SURFACE_WETNESS_DEFAULTS;
  const over0 = { min: { value: 0, isExclusive: true } };
  const runUpPath = `${path}.runUp`;
  const runUp = shoreline.runUp === undefined ? null : readObject(shoreline.runUp, runUpPath);
  if (runUp) checkKeys(runUp, WET_RUN_UP_KEYS, runUpPath);
  return {
    band: readNumber(shoreline, 'band', undefined, over0, path),
    noise: readNumber(shoreline, 'noise', shoreNoise, NON_NEGATIVE, path),
    runUp: runUp && {
      height: readNumber(runUp, 'height', shoreRunUpHeight, over0, runUpPath),
      period: readNumber(runUp, 'period', shoreRunUpPeriod, over0, runUpPath),
    },
  };
};

/** The rain streaks' numbers (p307 T5), their defaults filled in; null without */
const readStreaks = (value: unknown, path: string): TerrainStreaksDefine | null => {
  if (value === undefined) return null;
  const streaks = readObject(value, path);
  checkKeys(streaks, WET_STREAK_KEYS, path);
  const { streakMinSlope, streakScale, streakLength, streakSpeed } = SURFACE_WETNESS_DEFAULTS;
  const over0 = { min: { value: 0, isExclusive: true } };
  return {
    minSlope: readNumber(
      streaks,
      'minSlope',
      streakMinSlope,
      { ...over0, max: { value: 90 } },
      path
    ),
    scale: readNumber(streaks, 'scale', streakScale, over0, path),
    length: readNumber(streaks, 'length', streakLength, over0, path),
    speed: readNumber(streaks, 'speed', streakSpeed, NON_NEGATIVE, path),
  };
};

/** The rain ripples' numbers (p307 T4), their defaults filled in; null without */
const readRipples = (value: unknown, path: string): TerrainRipplesDefine | null => {
  if (value === undefined) return null;
  const ripples = readObject(value, path);
  checkKeys(ripples, WET_RIPPLE_KEYS, path);
  const { rippleScale, rippleLifetime, rippleStrength, rippleDistance } = SURFACE_WETNESS_DEFAULTS;
  const over0 = { min: { value: 0, isExclusive: true } };
  return {
    scale: readNumber(ripples, 'scale', rippleScale, over0, path),
    lifetime: readNumber(ripples, 'lifetime', rippleLifetime, over0, path),
    strength: readNumber(ripples, 'strength', rippleStrength, NON_NEGATIVE, path),
    distance: readMetreRange(ripples, 'distance', [...rippleDistance], path),
  };
};

/** The puddles' numbers (p307 T3), their defaults filled in; null without */
const readPuddles = (value: unknown, path: string): TerrainPuddlesDefine | null => {
  if (value === undefined) return null;
  const puddles = readObject(value, path);
  checkKeys(puddles, WET_PUDDLE_KEYS, path);
  const { puddleMaxSlope, puddleEdge, puddlePatchAmount } = SURFACE_WETNESS_DEFAULTS;
  const over0 = { min: { value: 0, isExclusive: true } };
  const patches =
    puddles.patches === undefined ? null : readObject(puddles.patches, `${path}.patches`);
  if (patches) checkKeys(patches, WET_PATCH_KEYS, `${path}.patches`);
  return {
    maxSlope: readNumber(
      puddles,
      'maxSlope',
      puddleMaxSlope,
      { ...over0, max: { value: 45 } },
      path
    ),
    edge: readNumber(puddles, 'edge', puddleEdge, { ...over0, max: { value: 1 } }, path),
    patches: patches && {
      scale: readNumber(patches, 'scale', undefined, over0, `${path}.patches`),
      amount: readNumber(patches, 'amount', puddlePatchAmount, UNIT, `${path}.patches`),
    },
  };
};

/** The regional wetness's source (p307 T7): `{ attribute? }` or `{ splatChannel: 'A' }`; null without */
const readRegional = (value: unknown, path: string): TerrainWetDefine['regional'] => {
  if (value === undefined) return null;
  const regional = readObject(value, path);
  if (regional.splatChannel !== undefined) {
    checkKeys(regional, ['splatChannel'], path);
    return { splatChannel: readEnum(regional, 'splatChannel', WET_SPLAT_CHANNELS, path) };
  }
  checkKeys(regional, ['attribute'], path);
  const { attribute = WET_REGIONAL_ATTRIBUTE } = regional;
  if (typeof attribute !== 'string' || !attribute) {
    fail(`${path}.attribute`, `is ${JSON.stringify(attribute)}: give a vertex attribute's name.`);
  }
  return { attribute: attribute as string };
};

/**
 * A regional wetness from the splat maps reads the first map's A, which must weigh no layer: a
 * splat source painting at most 4 layers (the base and R, G, B)
 */
const checkWetSplatChannel = (
  wet: TerrainWetDefine | null,
  blend: TerrainBlendDefine,
  layerCount: number,
  path: string
) => {
  if (!wet?.regional || !('splatChannel' in wet.regional)) return;
  if (getPaintedSource(blend) === 'SPLAT_MAP' && getPaintedLayerCount(blend, layerCount) <= 4) {
    return;
  }
  fail(
    `${path}.regional.splatChannel`,
    "is A: give blend.source SPLAT_MAP or SPLAT_MAP_AND_RULES painting at most 4 layers, so the first splat map's A weighs none."
  );
};

/**
 * Whether a wet response (the material's or a tier's, as given) reads the input `macro`: its
 * puddle patches or its streaks
 */
const hasWetMacroNoise = (wet: unknown) =>
  isRecord(wet) &&
  ((isRecord(wet.puddles) && wet.puddles.patches !== undefined) || wet.streaks !== undefined);

/** Whether a wet response (the material's or a tier's, as given) has ripples: the input `ripples` */
const hasRipples = (wet: unknown) => isRecord(wet) && wet.ripples !== undefined;

/**
 * The `WETNESS` debug view against the wet response: the material's `wet` or a tier's must be
 * there (a tier's variant shares the material's define)
 */
const checkWetView = (define: Record<string, unknown>, tiers: Record<string, unknown>[]) => {
  if (define.debugView !== 'WETNESS') return;
  if ([define, ...tiers].some((fields) => fields.wet !== undefined)) return;
  fail(
    '.debugView',
    "is WETNESS: give wet (the material's or a tier's), else there's nothing to show."
  );
};

/** The texture budget's reserve: a whole number 0..15 */
const readReservedTextures = (define: Record<string, unknown>) => {
  const bounds = { min: { value: 0 }, max: { value: 15 } };
  const value = readNumber(define, 'reservedTextures', DEFAULT_RESERVED_TEXTURES, bounds, '');
  if (!Number.isInteger(value)) fail('.reservedTextures', `is ${value}, not a whole number.`);
  return value;
};

/** The `quality` table: each tier's overrides checked for their keys (read when applied) */
const readQualityTable = (define: Record<string, unknown>) => {
  const table = define.quality === undefined ? {} : readObject(define.quality, '.quality');
  checkKeys(table, QUALITY_LEVELS, '.quality');
  const tiers: Partial<Record<(typeof QUALITY_LEVELS)[number], Record<string, unknown>>> = {};
  for (const level of QUALITY_LEVELS) {
    if (table[level] === undefined) continue;
    const tier = readObject(table[level], `.quality.${level}`);
    checkKeys(tier, TIER_KEYS, `.quality.${level}`);
    tiers[level] = tier;
  }
  return tiers;
};

/**
 * Reads a terrain material's static define (`staticDefines.terrain`), filling its defaults, and
 * throws naming the first field that's wrong or unknown (a later phase's field included). With a
 * `qualityLevel`, that tier's overrides replace the material's fields (shallowly) before they're
 * read; a tier that isn't applied is checked for its keys only. A layer's own `antiTiling` and
 * `projection` replace the material's (the tier's, when it gives one), and the tier's `layers`
 * entry replaces the layer's own.
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
  // The tier's fields over the material's (shallowly), read as the material's own; its layers'
  // overrides over the layers' own settings
  const tier = qualityLevel ? quality[qualityLevel] : undefined;
  const { layers: _tierLayers, ...tierFields } = tier ?? {};
  const fields = tier ? { ...define, ...tierFields } : define;
  const path = tier ? `.quality.${qualityLevel}` : '';
  const pathOf = (key: string) => (tier && key in tier ? path : '');
  const overrides = readTierLayers(tier, (rawLayers as unknown[]).length, path);
  const paths: LayerPaths = (rawLayers as unknown[]).map((raw, i) => {
    const whereGiven = (key: LayerSamplingKey) => {
      if (overrides?.[i]?.[key] !== undefined) return `${path}.layers[${i}]`;
      return isRecord(raw) && raw[key] !== undefined ? `.layers[${i}]` : pathOf(key);
    };
    return {
      source: whereGiven('source'),
      antiTiling: whereGiven('antiTiling'),
      projection: whereGiven('projection'),
    };
  });

  const antiTiling: TerrainAntiTilingDefine =
    fields.antiTiling === undefined
      ? { mode: 'NONE' }
      : readAntiTiling(fields.antiTiling, `${pathOf('antiTiling')}.antiTiling`);
  const projection: TerrainProjectionDefine =
    fields.projection === undefined
      ? { mode: 'PLANAR' }
      : readProjection(fields.projection, `${pathOf('projection')}.projection`);
  const layers = (rawLayers as unknown[]).map((layer, i) =>
    readLayer(layer, i, { antiTiling, projection }, overrides?.[i], paths[i])
  );
  checkLiveTaps(rawLayers as unknown[], Object.values(quality));
  const uv = readEnum(fields, 'uv', UV_MODES, pathOf('uv'));
  checkProjectionUv(layers, uv, paths);
  const slotCount = readSlotCount(layers, readSparse(fields, pathOf('sparse')), paths);

  const blend = readBlend(fields.blend, `${pathOf('blend')}.blend`);
  const { counts, name } = getBlendLayerCounts(blend);
  if (layers.length < counts[0] || layers.length > counts[1]) {
    fail(
      '.layers',
      `blend.source ${name} takes ${counts.join(' to ')} layers, not ${layers.length}.`
    );
  }
  checkRuleLayers(blend, layers.length, `${pathOf('blend')}.blend`);
  const aoPath = `${pathOf('ao')}.ao`;
  const ao = readOptionalObject(fields, 'ao', pathOf('ao'));
  checkKeys(ao, AO_KEYS, aoPath);
  const aoTextureInfluence = readNumber(ao, 'textureInfluence', 1, UNIT, aoPath);
  const aoVertex = readBoolean(ao, 'vertex', aoPath);
  if (
    aoVertex &&
    !(getPaintedSource(blend) === 'VERTEX_COLOR' && 'layout' in blend && blend.layout === 'RGB_AO')
  ) {
    fail(
      `${aoPath}.vertex`,
      'needs blend.source VERTEX_COLOR or VERTEX_COLOR_AND_RULES with the RGB_AO layout.'
    );
  }
  const colorMap = readColorMap(define);
  checkFarOnly(colorMap, define, Object.values(quality));
  const distance = readDistance(fields.distance, colorMap, `${pathOf('distance')}.distance`);
  const debugView = readOptionalEnum(define, 'debugView', DEBUG_VIEWS, '');
  checkWetView(define, Object.values(quality));
  const wet = readWet(fields.wet, `${pathOf('wet')}.wet`);
  checkWetSplatChannel(wet, blend, layers.length, `${pathOf('wet')}.wet`);
  return {
    layers,
    space: readEnum(define, 'space', SPACES, ''),
    uv,
    blend,
    aoTextureInfluence,
    aoVertex,
    aoBakedAlbedoInfluence: readNumber(
      ao,
      'bakedAlbedoInfluence',
      BAKED_ALBEDO_INFLUENCE,
      UNIT,
      aoPath
    ),
    macro: readMacro(define),
    takesMacroTexture:
      define.macro !== undefined ||
      [define.blend, ...Object.values(quality).map((tier) => tier.blend)].some(hasRawRuleNoise) ||
      [define.wet, ...Object.values(quality).map((tier) => tier.wet)].some(hasWetMacroNoise),
    takesRippleTexture: [define.wet, ...Object.values(quality).map((tier) => tier.wet)].some(
      hasRipples
    ),
    reservedTextures: readReservedTextures(define),
    distanceFade: distance?.fade ?? null,
    far: distance?.far ?? null,
    colorMap,
    wet,
    slotCount,
    qualityLevel,
    debugView,
  };
};
