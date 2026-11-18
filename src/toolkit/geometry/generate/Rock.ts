// Procedural scatter rocks (p308 D5): `generateAsteroid`'s indexed, smooth icosphere without
// craters, squashed, stretched by its seed and cut flat at its base, its origin at the base's
// centre. Three kinds within the scatter's triangle budgets, and the registered variants a
// `*.scatter.json` names (`saveRockGeometries`).
import * as THREE from 'three/webgpu';
import { createSeededRandom, getGeometry, saveBufferGeometry } from 'aekasha';
import {
  computeClosedVolume,
  computeHullVolume,
  generateAsteroid,
  type AsteroidNoiseOptions,
  type GeneratedAsteroid,
} from './Asteroid';

/** A rock's kind ({@link RockOptions}' `kind`): its size, detail and look. */
export type RockKind = 'PEBBLE' | 'ROCK' | 'BOULDER';

/** {@link generateRock}'s options; every one has its kind's default. */
export interface RockOptions {
  /**
   * The preset the other options default from (default `'ROCK'`): `'PEBBLE'` about 12 cm across,
   * 80 triangles; `'ROCK'` about 50 cm, 320; `'BOULDER'` about 2.3 m, 1280 (each within
   * {@link ROCK_TRIANGLE_BUDGETS}).
   */
  kind?: RockKind;
  /** Radius of the sphere before displacement, squash and stretch, metres. */
  radius?: number;
  /**
   * Icosphere subdivision, 1-10: 20·(detail + 1)² triangles (80 at 1, 320 at 3, 1280 at 7).
   */
  detail?: number;
  /** Deterministic seed, an integer (default 1): the same seed and options give the same rock. */
  seed?: number;
  /** The height against the width, 0..1: a rock lies flatter than it's wide. */
  squash?: number;
  /** How much longer than wide the seed may stretch it along x, ≥ 0 (z takes 40 % of it). */
  elongation?: number;
  /** The share of the rock's height cut flat at its base, 0..0.5: it sits on the ground. */
  flatten?: number;
  /** The lumps, each field over the kind's. */
  noise?: AsteroidNoiseOptions;
}

/** {@link generateRock}'s result: the rock's geometry, what physics needs and its height. */
export interface GeneratedRock extends GeneratedAsteroid {
  /** The rock's height from its flat base (its origin's height) to its top, metres. */
  height: number;
}

/**
 * The most triangles a scatter rock of each kind should have (p308 D5): many instances draw it.
 */
export const ROCK_TRIANGLE_BUDGETS: Readonly<Record<RockKind, number>> = {
  PEBBLE: 80,
  ROCK: 400,
  BOULDER: 1500,
};

type RockPreset = Required<Omit<RockOptions, 'kind' | 'seed' | 'noise'>> & {
  noise: Required<AsteroidNoiseOptions>;
};

const ROCK_PRESETS: Readonly<Record<RockKind, RockPreset>> = {
  PEBBLE: {
    radius: 0.06,
    detail: 1,
    squash: 0.6,
    elongation: 0.4,
    // A 42-vertex sphere: under 0.2 of its height the cut takes as few as one vertex, not a base
    flatten: 0.2,
    noise: { frequency: 1, amplitude: 0.3, octaves: 2 },
  },
  ROCK: {
    radius: 0.2,
    detail: 3,
    squash: 0.7,
    elongation: 0.35,
    flatten: 0.15,
    noise: { frequency: 1, amplitude: 0.45, octaves: 3 },
  },
  BOULDER: {
    radius: 1,
    detail: 7,
    squash: 0.75,
    elongation: 0.3,
    flatten: 0.2,
    noise: { frequency: 1.1, amplitude: 0.42, octaves: 4 },
  },
};

/** The stretch's draws, apart from the lumps' stream (`generateAsteroid`'s, from the same seed) */
const STRETCH_SALT = 0x5bd1e995;
/** The share of the elongation z takes */
const Z_ELONGATION = 0.4;
const MAX_FLATTEN = 0.5;

/**
 * Builds a procedural scatter rock (p308 D5): `generateAsteroid`'s seeded lumpy icosphere, indexed
 * with smooth normals and no craters, squashed to `squash` of its width, stretched along x and z
 * by its seed, and cut flat `flatten` of its height up from its lowest point, so it sits on the
 * ground. Its origin is the flat base's centre (the bounding box's x and z centre): a rock placed
 * at the ground's height stands on it. `kind` picks the size, detail and look the other options
 * default from, within the scatter's {@link ROCK_TRIANGLE_BUDGETS}.
 *
 * The geometry has positions and normals, no UVs: pair it with an object-space material such as
 * the toolkit's `rockScatter`. It isn't registered: {@link saveRockGeometries} registers the
 * toolkit's variants, or pass one through `saveBufferGeometry` with an id. `hullVertices` are its
 * points for a `CONVEXHULL` collider (a scatter item's `collider` reads the geometry's own).
 * @example
 * ```ts
 * import { createMeshEntity, saveBufferGeometry } from 'aekasha';
 * import { generateRock } from 'aekasha/toolkit/geometry';
 *
 * // A long, flat boulder standing on the ground at the origin
 * const boulder = generateRock({ kind: 'BOULDER', seed: 4, squash: 0.5, elongation: 0.8 });
 * createMeshEntity({
 *   geo: saveBufferGeometry(boulder.geometry, { id: 'flatBoulder' }),
 *   mat: 'rockScatter',
 * });
 * ```
 */
export const generateRock = (opts: RockOptions = {}): GeneratedRock => {
  const preset = ROCK_PRESETS[opts.kind ?? 'ROCK'];
  const {
    radius = preset.radius,
    detail = preset.detail,
    seed = 1,
    squash = preset.squash,
    elongation = preset.elongation,
  } = opts;
  const flatten = THREE.MathUtils.clamp(opts.flatten ?? preset.flatten, 0, MAX_FLATTEN);
  const random = createSeededRandom((seed ^ STRETCH_SALT) >>> 0);
  const stretch = Math.max(0, elongation);
  const shape: [number, number, number] = [
    1 + stretch * random(),
    squash,
    1 + stretch * Z_ELONGATION * random(),
  ];
  const { geometry } = generateAsteroid({
    radius,
    detail,
    seed,
    shape,
    noise: { ...preset.noise, ...opts.noise },
    craters: { count: 0 },
    flatShading: false,
  });

  // The base: every vertex below the cut lifted onto it, then the base's centre to the origin
  geometry.computeBoundingBox();
  const box = geometry.boundingBox as THREE.Box3;
  const cut = box.min.y + flatten * (box.max.y - box.min.y);
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let v = 0; v < position.count; v++) {
    if (position.getY(v) < cut) position.setY(v, cut);
  }
  geometry.translate(-(box.min.x + box.max.x) / 2, -cut, -(box.min.z + box.max.z) / 2);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const hullVertices = new Float32Array(position.array as Float32Array);
  const points: THREE.Vector3[] = [];
  let boundingRadius = 0;
  for (let v = 0; v < position.count; v++) {
    const point = new THREE.Vector3().fromBufferAttribute(position, v);
    points.push(point);
    boundingRadius = Math.max(boundingRadius, point.length());
  }
  return {
    geometry,
    hullVertices,
    volume: computeClosedVolume(geometry, 'generateRock'),
    hullVolume: computeHullVolume(points),
    boundingRadius,
    height: (geometry.boundingBox as THREE.Box3).max.y,
  };
};

/** The toolkit's registered rock variants (p308 D5): their ids, kinds and seeds */
const ROCK_VARIANTS: readonly { id: string; kind: RockKind; seed: number }[] = [
  { id: 'rockPebble_a', kind: 'PEBBLE', seed: 11 },
  { id: 'rockPebble_b', kind: 'PEBBLE', seed: 12 },
  { id: 'rockPebble_c', kind: 'PEBBLE', seed: 13 },
  { id: 'rockSmall_a', kind: 'ROCK', seed: 21 },
  { id: 'rockSmall_b', kind: 'ROCK', seed: 22 },
  { id: 'rockSmall_c', kind: 'ROCK', seed: 23 },
  { id: 'boulder_a', kind: 'BOULDER', seed: 31 },
  { id: 'boulder_b', kind: 'BOULDER', seed: 32 },
];

/**
 * Registers the toolkit's scatter rocks (p308 D5) for the scene loading (or current), so a
 * `*.scatter.json`'s items can name them: `rockPebble_a`, `_b`, `_c` (`'PEBBLE'`), `rockSmall_a`,
 * `_b`, `_c` (`'ROCK'`) and `boulder_a`, `_b` (`'BOULDER'`), each {@link generateRock} with a seed
 * of its own. Call it in the scene's code before its scatters spawn (before `spawnTerrainBlock`
 * for a block's scatters): a scatter's spawn throws on an item's geometry that isn't registered.
 * A variant registered already is kept, so a second call builds nothing.
 * @param opts the kinds to register (default all three)
 * @returns the ids registered (or kept), in the order above
 * @example
 * ```ts
 * import { spawnTerrainBlock } from 'aekasha/terrain';
 * import { saveRockGeometries } from 'aekasha/toolkit/geometry';
 *
 * // A scene file: the rocks its block's scatter names, then the block
 * export const scene = async () => {
 *   saveRockGeometries({ kinds: ['PEBBLE', 'ROCK'] });
 *   await spawnTerrainBlock('quarryBlock');
 * };
 * ```
 */
export const saveRockGeometries = (opts: { kinds?: readonly RockKind[] } = {}): string[] => {
  const { kinds = ['PEBBLE', 'ROCK', 'BOULDER'] } = opts;
  return ROCK_VARIANTS.filter((variant) => kinds.includes(variant.kind)).map(
    ({ id, kind, seed }) => {
      if (!getGeometry(id)) {
        saveBufferGeometry(generateRock({ kind, seed }).geometry, {
          id,
          debugData: { name: `Rock: ${id}`, description: `generateRock, ${kind}, seed ${seed}.` },
        });
      }
      return id;
    }
  );
};
