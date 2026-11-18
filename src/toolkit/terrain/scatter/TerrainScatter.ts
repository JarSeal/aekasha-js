// The toolkit's terrain scatter generator (p308 D4), `terrainScatter`: a `*.scatter.json`'s
// `"source": { "type": "PROCEDURAL", "generator": "terrainScatter", "params": … }`. Poisson-disk
// candidates over the target's square, each kept by the density × a mask (the block's terrain
// layers, slope, height and a clustering noise), placed on the block's mesh (its height and normal
// read from its grid), turned, tilted, sized, sunk and tinted. Loaded by `registerTerrainScatter`'s
// generator on its first spawn. The params come from JSON, so they're checked here, by hand (no
// zod in a build), each error naming the scatter and the param.
import * as THREE from 'three/webgpu';
import { SimplexNoise } from 'three/examples/jsm/math/SimplexNoise.js';
import { ComponentType, createSeededRandom, getGeometry, getRandomSeed } from 'aekasha';
import type { ScatterGeneratorInput, ScatterGeneratorResult } from 'aekasha/instancing';
import {
  getTerrainRuleCoverageCPU,
  type TerrainRule,
  type TerrainRulePoint,
  type TerrainRuleRange,
} from 'aekasha/toolkit/geometry';
import { readTerrainDefine } from '../material/TerrainDefine';
import { readTextureTexelsAsync } from '../textures/ReadTexels';
import { samplePoissonDisk } from './PoissonDisk';
import { createScatterLayerWeigher, type ScatterLayerWeigher } from './ScatterLayerWeights';
import {
  createFlatScatterSurface,
  createScatterSurfaceSample,
  readScatterSurface,
  sampleScatterSurface,
} from './ScatterSurface';

const PARAM_KEYS = [
  'minSpacing',
  'density',
  'mask',
  'scale',
  'alignToNormal',
  'sink',
  'tint',
  'splatMaps',
  'noiseTexture',
];
const MASK_KEYS = ['layers', 'slope', 'height', 'noise'];
const RANGE_KEYS = ['min', 'max', 'softness'];
const NOISE_KEYS = ['scale', 'amount', 'seed'];
const DEFAULT_MIN_SPACING = 0.5;
const DEFAULT_NOISE_TEXTURE = 'macroNoise';
/** The most layers a terrain material has */
const MAX_LAYERS = 16;
/** The Poisson grid's most cells (its arrays' size): about half as many candidates */
const MAX_POISSON_CELLS = 1 << 20;
/** The per-instance draws' stream, apart from the candidates' (so a param change of one doesn't
 * move the other) */
const DRAWS_SALT = 0x9e3779b9;
const MATRIX_SIZE = 16;
const COLOR_SIZE = 3;

/** The clustering noise: a seeded simplex at the world's (x, z) / `scale` */
type ScatterNoise = { scale: number; amount: number; seed: number };

/** The params, checked and with their defaults */
type TerrainScatterParams = {
  minSpacing: number;
  density: number;
  /** The factor per layer index (unnamed layers 0); null: no layer mask */
  layers: Float32Array | null;
  /** The slope (degrees) and height (metres) ranges as one rule's, or null */
  ranges: TerrainRule | null;
  noise: ScatterNoise | null;
  scale: [number, number];
  alignToNormal: number;
  sink: number;
  tint: number;
  splatMaps: string[];
  noiseTexture: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** FNV-1a over a string, from a basis (the clustering noise's seed) */
const hashString = (text: string, basis: number) => {
  let hash = basis;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

/** Reads the params, its errors naming the scatter and the param */
const readParams = (where: string, params: Record<string, unknown>): TerrainScatterParams => {
  const fail = (path: string, message: string): never => {
    throw new Error(`${where}: params.${path} ${message}`);
  };
  const checkKeys = (obj: Record<string, unknown>, keys: string[], path: string) => {
    const unknown = Object.keys(obj).find((key) => !keys.includes(key));
    if (unknown) fail(`${path}${unknown}`, `isn't a param here: use ${keys.join(', ')}.`);
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
  const unit = (obj: Record<string, unknown>, key: string, fallback: number, path = key) =>
    number(obj, key, fallback, (v) => v >= 0 && v <= 1, 'within 0..1', path);
  const record = (value: unknown, path: string) =>
    isRecord(value) ? value : fail(path, `is ${JSON.stringify(value)}, not an object.`);

  checkKeys(params, PARAM_KEYS, '');
  const range = (value: unknown, path: string): TerrainRuleRange | undefined => {
    if (value === undefined) return undefined;
    const obj = record(value, path);
    checkKeys(obj, RANGE_KEYS, `${path}.`);
    const finite = (key: string) =>
      obj[key] === undefined
        ? undefined
        : number(obj, key, undefined, () => true, 'a number', `${path}.${key}`);
    const min = finite('min');
    const max = finite('max');
    if (min !== undefined && max !== undefined && min > max) {
      fail(path, `has min ${min} over max ${max}.`);
    }
    const softness =
      obj.softness === undefined
        ? undefined
        : number(obj, 'softness', undefined, (v) => v >= 0, '0 or more', `${path}.softness`);
    return {
      ...(min !== undefined ? { min } : {}),
      ...(max !== undefined ? { max } : {}),
      ...(softness !== undefined ? { softness } : {}),
    };
  };

  const mask = params.mask === undefined ? {} : record(params.mask, 'mask');
  checkKeys(mask, MASK_KEYS, 'mask.');
  let layers: Float32Array | null = null;
  if (mask.layers !== undefined) {
    const named = record(mask.layers, 'mask.layers');
    layers = new Float32Array(MAX_LAYERS);
    for (const key of Object.keys(named)) {
      const index = Number(key);
      if (!Number.isInteger(index) || index < 0 || index >= MAX_LAYERS || String(index) !== key) {
        fail(`mask.layers.${key}`, `isn't a layer index (0 to ${MAX_LAYERS - 1}).`);
      }
      layers[index] = number(
        named,
        key,
        undefined,
        (v) => v >= 0,
        '0 or more',
        `mask.layers.${key}`
      );
    }
  }
  const slope = range(mask.slope, 'mask.slope');
  const height = range(mask.height, 'mask.height');
  let noise: ScatterNoise | null = null;
  if (mask.noise !== undefined) {
    const obj = record(mask.noise, 'mask.noise');
    checkKeys(obj, NOISE_KEYS, 'mask.noise.');
    noise = {
      scale: number(obj, 'scale', undefined, (v) => v > 0, 'a number over 0', 'mask.noise.scale'),
      amount: unit(obj, 'amount', 1, 'mask.noise.amount'),
      seed: number(obj, 'seed', 0, Number.isInteger, 'a whole number', 'mask.noise.seed'),
    };
  }

  let scale: [number, number] = [1, 1];
  const rawScale = params.scale;
  if (typeof rawScale === 'number' && rawScale > 0) {
    scale = [rawScale, rawScale];
  } else if (
    Array.isArray(rawScale) &&
    rawScale.length === 2 &&
    rawScale.every((v) => typeof v === 'number' && Number.isFinite(v) && v > 0) &&
    (rawScale[0] as number) <= (rawScale[1] as number)
  ) {
    scale = rawScale as [number, number];
  } else if (rawScale !== undefined) {
    fail('scale', `is ${JSON.stringify(rawScale)}: give a number over 0, or [min, max] over 0.`);
  }

  const splatMaps = params.splatMaps ?? [];
  if (
    !Array.isArray(splatMaps) ||
    splatMaps.length > 2 ||
    !splatMaps.every((id) => typeof id === 'string' && id)
  ) {
    fail('splatMaps', `is ${JSON.stringify(splatMaps)}: give 1 or 2 texture ids.`);
  }
  const noiseTexture = params.noiseTexture ?? DEFAULT_NOISE_TEXTURE;
  if (typeof noiseTexture !== 'string' || !noiseTexture) {
    fail('noiseTexture', `is ${JSON.stringify(noiseTexture)}, not a texture id.`);
  }

  return {
    minSpacing: number(params, 'minSpacing', DEFAULT_MIN_SPACING, (v) => v > 0, 'a number over 0'),
    density: unit(params, 'density', 1),
    layers,
    ranges:
      slope || height
        ? { layer: 0, ...(slope ? { slope } : {}), ...(height ? { height } : {}) }
        : null,
    noise,
    scale,
    alignToNormal: unit(params, 'alignToNormal', 0),
    sink: unit(params, 'sink', 0),
    tint: unit(params, 'tint', 0),
    splatMaps: splatMaps as string[],
    noiseTexture: noiseTexture as string,
  };
};

/**
 * The block's layer weigher, from its material's terrain define (none: layer 0 everywhere), with
 * the splat maps and the rules' noise read back from the GPU when its blend reads them
 */
const createWeigherAsync = async (
  where: string,
  mesh: THREE.Mesh | undefined,
  params: TerrainScatterParams,
  layers: Float32Array
): Promise<ScatterLayerWeigher> => {
  const material = Array.isArray(mesh?.material) ? mesh.material[0] : mesh?.material;
  const raw = (material?.userData as Record<string, unknown> | undefined)?.terrainDefine;
  const define = raw ? readTerrainDefine({ terrain: raw }) : null;
  const layerCount = define?.layers.length ?? 1;
  const outside = layers.findIndex((factor, index) => factor > 0 && index >= layerCount);
  if (outside >= 0) {
    throw new Error(
      `${where}: params.mask.layers names the layer ${outside}, but the surface's material has ${layerCount} layer${layerCount > 1 ? 's' : ''}${define ? '' : " (it isn't a terrain material: layer 0 everywhere)"}.`
    );
  }
  const blend = define?.blend ?? null;
  const isSplat = blend && (blend.source === 'SPLAT_MAP' || blend.source === 'SPLAT_MAP_AND_RULES');
  const hasNoise = blend && blend.source !== 'SINGLE' && blend.rules.some((rule) => rule.noise);
  const [splatMaps, noise] = await Promise.all([
    Promise.all((isSplat ? params.splatMaps : []).map((id) => readTextureTexelsAsync(id))),
    hasNoise ? readTextureTexelsAsync(params.noiseTexture) : undefined,
  ]);
  try {
    return createScatterLayerWeigher(blend, layerCount, splatMaps, noise);
  } catch (error) {
    throw new Error(`${where}: ${error instanceof Error ? error.message : String(error)}`);
  }
};

/**
 * The mask at a point, 0..1: the block's layer weights × their factors, summed, × the slope and
 * height ranges' coverage × the clustering noise's
 */
const createMaskAsync = async (
  where: string,
  scatterId: string,
  params: TerrainScatterParams,
  mesh: THREE.Mesh | undefined
) => {
  const { layers, ranges, noise } = params;
  const weigher = layers ? await createWeigherAsync(where, mesh, params, layers) : null;
  const weights = new Float32Array(weigher?.layerCount ?? 1);
  const simplex =
    noise &&
    new SimplexNoise({
      // Not the target's seed: the clusters continue across blocks
      random: createSeededRandom(
        hashString(`${scatterId}|${noise.seed}`, 0x811c9dc5 ^ getRandomSeed())
      ),
    });
  return (color: Float32Array, u: number, v: number, point: TerrainRulePoint) => {
    let coverage = 1;
    if (weigher && layers) {
      weigher.weigh(color, u, v, point, weights);
      coverage = 0;
      for (let layer = 0; layer < weights.length; layer++)
        coverage += weights[layer] * layers[layer];
    }
    if (ranges) coverage *= getTerrainRuleCoverageCPU(ranges, point);
    if (simplex && noise) {
      const value = 0.5 + 0.5 * simplex.noise(point.x / noise.scale, point.z / noise.scale);
      coverage *= 1 - noise.amount * (1 - Math.min(1, Math.max(0, value)));
    }
    return coverage;
  };
};

/** Each item's bottom (its bounding box's min y) and height, for the sink */
const getItemBounds = (items: ScatterGeneratorInput['items']) =>
  items.map((item) => {
    const geometry = getGeometry(item.geometry);
    if (!geometry) return { bottom: 0, height: 0 };
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    return { bottom: box.min.y, height: box.max.y - box.min.y };
  });

const _up = new THREE.Vector3(0, 1, 0);
const _normal = new THREE.Vector3();
const _lift = new THREE.Vector3();
const _position = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _align = new THREE.Quaternion();
const _yaw = new THREE.Quaternion();
const _quaternion = new THREE.Quaternion();
const _matrix = new THREE.Matrix4();

/**
 * `terrainScatter`: places a scatter's instances on its target (a terrain block's mesh, else a flat
 * square at the target's height). See `registerTerrainScatter` for the params.
 * @internal
 * @throws for params that aren't valid, a target without a size, a target entity without a mesh,
 * a surface that isn't a regular grid, a layer mask past the material's layers, a splat material
 * without `splatMaps`, or a `minSpacing` too small for the target
 */
export const generateTerrainScatterAsync = async (
  input: ScatterGeneratorInput
): Promise<ScatterGeneratorResult> => {
  const { scatterId, seed, items, target, world } = input;
  const where = `terrainScatter: the scatter "${scatterId}"`;
  const params = readParams(where, input.params);
  const size = target.size;
  if (!(typeof size === 'number' && size > 0)) {
    throw new Error(`${where}: its target has no size (a terrain block's scatter has).`);
  }
  if (params.minSpacing >= size) {
    throw new Error(
      `${where}: params.minSpacing ${params.minSpacing} isn't under the target's ${size} m.`
    );
  }
  // Inset by half the spacing, so the neighbouring blocks' points keep it across the seam
  const span = size - params.minSpacing;
  const cellsAcross = Math.ceil(span / (params.minSpacing / Math.SQRT2));
  if (cellsAcross * cellsAcross > MAX_POISSON_CELLS) {
    throw new Error(
      `${where}: params.minSpacing ${params.minSpacing} is too small for the target's ${size} m (at most about ${MAX_POISSON_CELLS / 2} candidates): use ${Math.ceil((size / Math.sqrt(MAX_POISSON_CELLS)) * Math.SQRT2 * 1000) / 1000} or more.`
    );
  }

  let mesh: THREE.Mesh | undefined;
  if (target.entityId !== undefined) {
    const object = world.getComponent(target.entityId, ComponentType.OBJECT3D)?.value;
    if (!(object as THREE.Mesh | undefined)?.isMesh) {
      throw new Error(
        `${where}: the target's entity ${target.entityId} has no mesh to scatter on.`
      );
    }
    mesh = object as THREE.Mesh;
  }
  const surface = mesh
    ? readScatterSurface(mesh.geometry, size, where)
    : createFlatScatterSurface(size);
  const getCoverage = await createMaskAsync(where, scatterId, params, mesh);

  const candidates = samplePoissonDisk({
    width: span,
    depth: span,
    radius: params.minSpacing,
    random: createSeededRandom(seed),
  });
  const candidateCount = candidates.length / 2;
  const draws = createSeededRandom(seed ^ DRAWS_SALT);
  const bounds = getItemBounds(items);
  let totalWeight = 0;
  for (const item of items) totalWeight += item.weight;

  const matrices = new Float32Array(candidateCount * MATRIX_SIZE);
  const picked = new Uint8Array(candidateCount);
  const colors = params.tint > 0 ? new Float32Array(candidateCount * COLOR_SIZE) : undefined;
  const sample = createScatterSurfaceSample();
  const point: TerrainRulePoint = { x: 0, y: 0, z: 0, normalX: 0, normalY: 1, normalZ: 0 };
  const { position } = target;
  const half = size / 2;
  const inset = params.minSpacing / 2;
  const [minScale, maxScale] = params.scale;
  let count = 0;
  for (let i = 0; i < candidateCount; i++) {
    // Five draws a candidate whatever it keeps, so one candidate's mask never moves another's
    const keepDraw = draws();
    const yawDraw = draws();
    const scaleDraw = draws();
    const itemDraw = draws();
    const tintDraw = draws();
    if (keepDraw >= params.density) continue;

    const x = inset + candidates[i * 2] - half;
    const z = inset + candidates[i * 2 + 1] - half;
    sampleScatterSurface(surface, x, z, sample);
    point.x = position.x + x;
    point.y = position.y + sample.height;
    point.z = position.z + z;
    point.normalX = sample.normalX;
    point.normalY = sample.normalY;
    point.normalZ = sample.normalZ;
    const coverage = getCoverage(sample.color, x / size + 0.5, z / size + 0.5, point);
    if (keepDraw >= params.density * coverage) continue;

    let item = 0;
    let r = itemDraw * totalWeight;
    while (item < items.length - 1 && r >= items[item].weight) {
      r -= items[item].weight;
      item++;
    }
    const s = minScale + (maxScale - minScale) * scaleDraw;
    _normal.set(point.normalX, point.normalY, point.normalZ);
    _align.setFromUnitVectors(_up, _normal);
    _quaternion.identity().slerp(_align, params.alignToNormal);
    _yaw.setFromAxisAngle(_up, yawDraw * Math.PI * 2);
    // The bounding box's bottom on the surface, then `sink` of its height under it, along the
    // tilted up
    const { bottom, height } = bounds[item];
    _lift
      .copy(_up)
      .applyQuaternion(_quaternion)
      .multiplyScalar((-bottom - params.sink * height) * s);
    _position.set(point.x, point.y, point.z).add(_lift);
    _quaternion.multiply(_yaw);
    _matrix.compose(_position, _quaternion, _scale.setScalar(s));
    _matrix.toArray(matrices, count * MATRIX_SIZE);
    picked[count] = item;
    if (colors)
      colors.fill(1 - params.tint * tintDraw, count * COLOR_SIZE, (count + 1) * COLOR_SIZE);
    count++;
  }

  return {
    matrices: matrices.slice(0, count * MATRIX_SIZE),
    items: picked.slice(0, count),
    ...(colors ? { colors: colors.slice(0, count * COLOR_SIZE) } : {}),
  };
};
