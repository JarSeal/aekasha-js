// The toolkit's terrain block generators (p306 D4), `noiseTerrain` and `rulesTerrain`: a
// `*.terrainBlock.json`'s `"geometry": { "generator": …, "params": …, "seed": … }` built with
// `generateTerrainAsync`, on the toolkit's terrain worker (p306 Phase 4). Loaded by `registerTerrainGenerators`' generators on a block's first spawn,
// so an app registering them carries none of this before it uses one. The params come from JSON,
// so they're checked here, by hand (no zod in a build), each error naming the block and the param.
import type { TerrainGeneratorOpts, TerrainGeneratorResult } from 'aekasha/terrain';
import {
  generateTerrainAsync,
  type TerrainNoiseOctave,
  type TerrainOptions,
  type TerrainRule,
} from 'aekasha/toolkit/geometry';
import { checkTerrainRule } from '../material/TerrainDefine';
import { readTextureTexelsAsync } from '../textures/ReadTexels';

/** `noiseTerrain`'s params, and the rules generator's first ones */
const NOISE_KEYS = ['maxHeight', 'octaves', 'normals', 'skirt'];
/** `rulesTerrain`'s params past the noise's */
const RULES_KEYS = ['layout', 'rules', 'ao', 'noiseTexture'];
const AO_KEYS = ['radius', 'strength', 'steps'];
const NORMALS = ['HEIGHT_FN', 'GEOMETRY'] as const;
const LAYOUTS = ['RGB_AO', 'RGBA'] as const;
/** The material's limit, the define reader's */
const MAX_RULES = 16;
const DEFAULT_MAX_HEIGHT = 8;
const DEFAULT_NOISE_TEXTURE = 'macroNoise';

/** Reads a block's params, its errors naming the generator, the block and the param */
const createParamReader = (generator: string, { blockId, params }: TerrainGeneratorOpts) => {
  const where = `${generator}: block "${blockId}" params`;
  const fail = (key: string, message: string): never => {
    throw new Error(`${where}.${key}: ${message}`);
  };
  const number = (
    obj: Record<string, unknown>,
    key: string,
    fallback: number | undefined,
    isValid: (value: number) => boolean,
    expected: string,
    path = key
  ) => {
    const value = obj[key] ?? fallback;
    if (typeof value !== 'number' || !Number.isFinite(value) || !isValid(value)) {
      return fail(path, `is ${JSON.stringify(value)}, not ${expected}.`);
    }
    return value;
  };
  const oneOf = <T extends string>(key: string, values: readonly T[], fallback: T): T => {
    const value = params[key] ?? fallback;
    if (!values.includes(value as T)) {
      return fail(key, `is ${JSON.stringify(value)}: use ${values.join(', ')}.`);
    }
    return value as T;
  };
  const checkKeys = (obj: Record<string, unknown>, keys: string[], path = '') => {
    const unknown = Object.keys(obj).find((key) => !keys.includes(key));
    if (unknown) fail(`${path}${unknown}`, `isn't a param here: use ${keys.join(', ')}.`);
  };
  return { where, fail, number, oneOf, checkKeys };
};

type ParamReader = ReturnType<typeof createParamReader>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** `octaves`: `[frequency, amplitude]` pairs, frequencies over 0 */
const readOctaves = (read: ParamReader, value: unknown): TerrainNoiseOctave[] | undefined => {
  if (value === undefined) return undefined;
  const isPair = (pair: unknown) =>
    Array.isArray(pair) &&
    pair.length === 2 &&
    pair.every((n) => typeof n === 'number' && Number.isFinite(n)) &&
    (pair[0] as number) > 0;
  if (!Array.isArray(value) || !value.length || !value.every(isPair)) {
    return read.fail(
      'octaves',
      `is ${JSON.stringify(value)}: give [frequency, amplitude] pairs, frequencies over 0.`
    );
  }
  return (value as [number, number][]).map(([frequency, amplitude]) => ({
    frequency,
    amplitude,
  }));
};

/**
 * The noise terrain's options for a block: its grid's size and resolution, its world-continuous
 * noise (the block's seed as it is, sampled at its place `grid × size`, so blocks of one seed
 * continue each other; p301 §7) and the params' heights, normals and skirt
 */
const getNoiseOptions = (opts: TerrainGeneratorOpts, read: ParamReader): TerrainOptions => {
  const { params, seed, grid } = opts;
  const segments = grid.resolution - 1;
  return {
    width: grid.size,
    depth: grid.size,
    widthSegments: segments,
    depthSegments: segments,
    seed,
    center: [grid.x * grid.size, grid.z * grid.size],
    maxHeight: read.number(
      params,
      'maxHeight',
      DEFAULT_MAX_HEIGHT,
      (v) => v > 0,
      'a number over 0'
    ),
    noiseOctaves: readOctaves(read, params.octaves),
    normals: read.oneOf('normals', NORMALS, 'HEIGHT_FN'),
    skirt: read.number(params, 'skirt', 0, (v) => v >= 0, 'a number of 0 or more'),
    collider: true,
  };
};

/**
 * The geometry, generated on the terrain worker, and its heightfield (cheap: the heights
 * transposed on this thread; a `TRIMESH` block ignores it)
 */
const toResultAsync = async (options: TerrainOptions): Promise<TerrainGeneratorResult> => {
  const terrain = await generateTerrainAsync(options);
  return { geometry: terrain.geometry, heightfield: terrain.heightfield };
};

/**
 * `noiseTerrain`: seeded simplex octaves over the world, so neighbouring blocks of one seed
 * continue each other in their heights and (with `HEIGHT_FN` normals) their lighting.
 * @internal
 */
export const generateNoiseTerrainBlockAsync = async (opts: TerrainGeneratorOpts) => {
  const read = createParamReader('noiseTerrain', opts);
  read.checkKeys(opts.params, NOISE_KEYS);
  return toResultAsync(getNoiseOptions(opts, read));
};

/** `rules`: 1 to 16 rules, each checked as the terrain material's are */
const readRules = (read: ParamReader, value: unknown): TerrainRule[] => {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_RULES) {
    return read.fail('rules', `is ${JSON.stringify(value)}: give 1 to ${MAX_RULES} rules.`);
  }
  value.forEach((rule, i) => checkTerrainRule(rule, read.where, `.rules[${i}]`));
  return value as TerrainRule[];
};

/** `ao`: the horizon AO's radius, strength and steps, or none */
const readAo = (read: ParamReader, value: unknown): TerrainOptions['ao'] => {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return read.fail('ao', `is ${JSON.stringify(value)}, not an object.`);
  read.checkKeys(value, AO_KEYS, 'ao.');
  const isWhole = (v: number) => Number.isInteger(v) && v >= 1;
  return {
    radius: read.number(value, 'radius', undefined, (v) => v > 0, 'a number over 0', 'ao.radius'),
    strength: read.number(
      value,
      'strength',
      1,
      (v) => v >= 0 && v <= 1,
      'within 0..1',
      'ao.strength'
    ),
    steps: read.number(value, 'steps', 16, isWhole, 'a whole number of 1 or more', 'ao.steps'),
  };
};

/**
 * `rulesTerrain`: `noiseTerrain`'s heights with the terrain material's rules evaluated per vertex
 * into its vertex colours (a `VERTEX_COLOR` blend's), and the horizon AO in `RGB_AO`'s A. A rule
 * with noise reads the texture `noiseTexture` (default `macroNoise`, which the scene lists) read
 * back from the GPU once.
 * @internal
 */
export const generateRulesTerrainBlockAsync = async (opts: TerrainGeneratorOpts) => {
  const read = createParamReader('rulesTerrain', opts);
  const { params } = opts;
  read.checkKeys(params, [...NOISE_KEYS, ...RULES_KEYS]);
  const rules = readRules(read, params.rules);
  const layout = read.oneOf('layout', LAYOUTS, 'RGB_AO');
  const ao = readAo(read, params.ao);
  const textureId = params.noiseTexture ?? DEFAULT_NOISE_TEXTURE;
  if (typeof textureId !== 'string' || !textureId) {
    return read.fail('noiseTexture', `is ${JSON.stringify(textureId)}, not a texture id.`);
  }
  const options = getNoiseOptions(opts, read);
  const noise = rules.some((rule) => rule.noise)
    ? await readTextureTexelsAsync(textureId)
    : undefined;
  return toResultAsync({ ...options, ao, vertexColors: { layout, rules, noise } });
};
