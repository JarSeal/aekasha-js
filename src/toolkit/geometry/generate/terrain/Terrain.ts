import * as THREE from 'three/webgpu';
import { createSeededRandom } from 'aekasha';
import { toHeightfieldColliderParams, type HeightFieldData } from 'aekasha/physics';
import type { TerrainAoOptions } from './TerrainAo';
import { buildTerrainData, recordTerrainNoiseDraws, type TerrainData } from './TerrainCore';
import type { TerrainHeightmap } from './TerrainHeightmap';
import type { TerrainRule, TerrainRuleNoiseTexels } from './TerrainRules';

/** One octave of a terrain's height noise ({@link TerrainOptions}' `noiseOctaves`). */
export interface TerrainNoiseOctave {
  /** Noise cycles per world unit: a higher frequency gives smaller, closer bumps. */
  frequency: number;
  /**
   * The octave's weight against the others: the weights are normalized, so the summed height
   * stays within ±`maxHeight`.
   */
  amplitude: number;
}

/**
 * Where a terrain's normals come from ({@link TerrainOptions}' `normals`): `GEOMETRY` the mesh's
 * triangles (`computeVertexNormals`), `HEIGHT_FN` the height function's central differences, its
 * samples past the edge included, so neighbouring blocks' normals agree on their shared edge.
 */
export type TerrainNormalSource = 'GEOMETRY' | 'HEIGHT_FN';

/**
 * {@link TerrainOptions}' `vertexColors`: the terrain material's vertex colour weights
 * (`COLOR_0`, a byte a channel) from its rules evaluated on the CPU, and the AO.
 */
export type TerrainVertexColorOptions = {
  /**
   * The channels, the terrain material's `blend.vertexColor.layout`: `RGB_AO` R, G and B weigh
   * layers 1-3 and A is the AO (`ao`'s, else 1); `RGBA` the four weigh layers 1-4. Layer 0, the
   * base, takes what they leave.
   */
  layout: 'RGB_AO' | 'RGBA';
  /**
   * The rules laid over the base layer at each vertex, in order ({@link evaluateTerrainRulesCPU}:
   * the terrain material's math, from the vertex's normal and its height as generated). None: the
   * base alone.
   */
  rules?: TerrainRule[];
  /** The macro noise texture's texels, which a rule with `noise` needs. */
  noise?: TerrainRuleNoiseTexels;
};

/** {@link generateTerrain}'s options: the size, the grid, the heights and what's built from them. */
export interface TerrainOptions {
  /** The size along x in world units, centred on the origin. */
  width: number;
  /** The size along z in world units, centred on the origin. */
  depth: number;
  /** Grid cells along X, a whole number of 1 or more (rounded, at least 1). Keep low for a "very
   * low poly" look. */
  widthSegments: number;
  /** Grid cells along Z, a whole number of 1 or more (rounded, at least 1). */
  depthSegments: number;
  /**
   * The noise's peak height in world units: heights stay within ±`maxHeight`. Required unless
   * `heightFn` or `heightmap` gives the heights.
   */
  maxHeight?: number;
  /**
   * The height noise's octaves (seeded simplex), default two gentle ones: frequency 1/50 at
   * weight 1, and 1/18 at 0.35, rolling hills.
   */
  noiseOctaves?: TerrainNoiseOctave[];
  /** Deterministic seed, an integer (default 1): the same seed gives the same terrain. */
  seed?: number;
  /**
   * Where the terrain's centre is in the world, `[x, z]` (default `[0, 0]`): the heights are
   * sampled at the world's `center + (x, z)`, so blocks of one seed side by side continue each
   * other. The geometry stays centred on its origin: place the mesh at the centre.
   */
  center?: [number, number];
  /**
   * The height at a world-space (x, z), in place of the noise (custom shapes). With it,
   * `maxHeight`, `noiseOctaves` and `seed` aren't used. Not with `heightmap`.
   */
  heightFn?: (x: number, z: number) => number;
  /**
   * A heightmap ({@link loadTerrainHeightmapAsync}'s) in place of the noise, sampled bilinearly
   * at the vertices' world (x, z) (`center` added), the edge's height past its edge. Plain data,
   * so `generateTerrainAsync` takes it, unlike `heightFn`. With it, `maxHeight`, `noiseOctaves`
   * and `seed` aren't used. Not with `heightFn`.
   */
  heightmap?: TerrainHeightmap;
  /**
   * Reshapes the height per vertex: gets the vertex's world-space (x, z) (`center` added) and its
   * height `h` (the noise's or `heightFn`'s), returns the final height. Applied before the
   * geometry is built, so the mesh, `heights` and `getHeightAt` all agree. Eg. a mask that
   * flattens part of the terrain, or sinks its edges below a ground plane.
   */
  heightModifier?: (x: number, z: number, h: number) => number;
  /** Where the normals come from (default `GEOMETRY`): see {@link TerrainNormalSource}. */
  normals?: TerrainNormalSource;
  /**
   * Horizon AO per vertex (the result's `ao`, and `RGB_AO`'s A): per direction of 8, the highest
   * elevation angle of the surface within `radius`, past the edge included.
   */
  ao?: TerrainAoOptions;
  /** Vertex colours (`COLOR_0`) for the terrain material's `VERTEX_COLOR` blend. */
  vertexColors?: TerrainVertexColorOptions;
  /** Also returns the `HEIGHTFIELD` collider's params (`heightfield`), its cells split as the mesh's. */
  collider?: boolean;
  /**
   * A skirt this deep in world units (default 0: none): a strip down from each edge, hiding the
   * cracks between blocks of different resolutions. Its vertices come after the grid's.
   */
  skirt?: number;
}

/** {@link generateTerrain}'s result: the mesh's geometry, its grid and its heights. */
export interface GeneratedTerrain {
  /** The terrain's geometry, indexed, with normals and UVs (and colours), not registered. */
  geometry: THREE.BufferGeometry;
  /** The size along x, as given. */
  width: number;
  /** The size along z, as given. */
  depth: number;
  /** The grid's cells along x, as used (rounded, at least 1). */
  widthSegments: number;
  /** The grid's cells along z, as used (rounded, at least 1). */
  depthSegments: number;
  /** The terrain's centre in the world, `[x, z]`, as given (default `[0, 0]`). */
  center: [number, number];
  /**
   * The mesh's height at its own (x, z) (the world's less `center`), clamped to the terrain's
   * extent: inside a grid cell, the height of the cell's triangle under the point (the cells split
   * along the diagonal from (col + 1, row) to (col, row + 1)), so a body placed with it sits on
   * the mesh.
   */
  getHeightAt: (x: number, z: number) => number;
  /**
   * The grid's heights, row-major: row r (along z, from -depth / 2) and column c (along x, from
   * -width / 2) at `r * (widthSegments + 1) + c`.
   * @remarks A `HEIGHTFIELD` collider reads its heights column-major: `collider: true` gives its
   * params (`heightfield`), or `toHeightfieldColliderParams` (`aekasha/physics`) makes them.
   */
  heights: Float32Array;
  /** The horizon AO per vertex, row-major like `heights`, 1 unoccluded (with `ao` only). */
  ao?: Float32Array;
  /**
   * The `HEIGHTFIELD` collider's params, centred like the mesh (with `collider: true` only): give
   * them to `createPhysicsEntity` on a body at the mesh's place.
   */
  heightfield?: HeightFieldData & { type: 'HEIGHTFIELD' };
}

/**
 * The terrain's geometry, `getHeightAt` and collider params from its arrays (`buildTerrainData`'s,
 * on this thread or the terrain worker's).
 * @internal
 */
export const toGeneratedTerrain = (
  data: TerrainData,
  opts: Pick<TerrainOptions, 'width' | 'depth' | 'center' | 'collider'>
): GeneratedTerrain => {
  const { width, depth, center = [0, 0], collider = false } = opts;
  const { widthSegments, depthSegments, heights } = data;
  const cols = widthSegments + 1;
  const rows = depthSegments + 1;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(data.index, 1));
  geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
  if (data.colors) geometry.setAttribute('color', new THREE.BufferAttribute(data.colors, 4, true));
  // The arrays' own bounds (three's computations, done where the arrays were made)
  geometry.boundingBox = new THREE.Box3(
    new THREE.Vector3(...data.boxMin),
    new THREE.Vector3(...data.boxMax)
  );
  geometry.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(...data.sphereCenter),
    data.sphereRadius
  );

  const getHeightAt = (x: number, z: number): number => {
    const u = THREE.MathUtils.clamp((x + width / 2) / width, 0, 1) * widthSegments;
    const v = THREE.MathUtils.clamp((z + depth / 2) / depth, 0, 1) * depthSegments;
    // The cell (the far edge belongs to the last one) and the point's place in it
    const col0 = Math.min(Math.floor(u), widthSegments - 1);
    const row0 = Math.min(Math.floor(v), depthSegments - 1);
    const tx = u - col0;
    const tz = v - row0;

    const h00 = heights[row0 * cols + col0];
    const h10 = heights[row0 * cols + col0 + 1];
    const h01 = heights[(row0 + 1) * cols + col0];
    const h11 = heights[(row0 + 1) * cols + col0 + 1];

    // The plane of the triangle under the point: (a, b, c) up to the b–c diagonal, (b, c, d) past it
    if (tx + tz <= 1) return h00 + (h10 - h00) * tx + (h01 - h00) * tz;
    return h11 + (h01 - h11) * (1 - tx) + (h10 - h11) * (1 - tz);
  };

  const result: GeneratedTerrain = {
    geometry,
    width,
    depth,
    widthSegments,
    depthSegments,
    center,
    getHeightAt,
    heights,
  };
  if (data.ao) result.ao = data.ao;
  if (collider) {
    result.heightfield = toHeightfieldColliderParams({ heights, rows, cols, width, depth });
  }
  return result;
};

/**
 * Builds a low-poly terrain: a grid centred on the origin, its heights from seeded simplex noise,
 * `heightFn` or a heightmap (and `heightModifier`), with `getHeightAt` to place things on it
 * (scattering, spawn points) and the heights as an array. Optionally sampled at a world `center` (blocks that
 * continue each other), with normals from the height function (no lighting seam between blocks),
 * horizon AO, the terrain material's rules as vertex colours, the `HEIGHTFIELD` collider's params
 * and a skirt. The geometry isn't registered: save it with `saveBufferGeometry` to have it
 * disposed with its scene.
 * @throws for none of `maxHeight`, `heightFn` and `heightmap`, both `heightFn` and `heightmap`, a
 * heightmap whose heights don't fill its texels, a negative `skirt`, `ao`'s or a rule's values out
 * of range, or a rule's layer the vertex colour layout doesn't weigh
 * @example
 * ```ts
 * const terrain = generateTerrain({
 *   width: 200,
 *   depth: 200,
 *   widthSegments: 50,
 *   depthSegments: 50,
 *   maxHeight: 6,
 *   seed: 4,
 * });
 * createMeshEntity({
 *   geo: saveBufferGeometry(terrain.geometry, { id: 'terrainGeo' }),
 *   mat: 'grassMat',
 *   receiveShadow: true,
 * });
 * // A 1 m crate standing on the ground at x = 10, z = 20
 * createMeshEntity({
 *   geo: 'crateGeo',
 *   mat: 'crateMat',
 *   position: { x: 10, y: terrain.getHeightAt(10, 20) + 0.5, z: 20 },
 * });
 * ```
 * @example
 * ```ts
 * // The block right of the origin's in a world of 64 m blocks: seamless with its neighbours,
 * // rocks on the slopes in its vertex colours, valley AO, and its collider
 * const block = generateTerrain({
 *   width: 64,
 *   depth: 64,
 *   widthSegments: 128,
 *   depthSegments: 128,
 *   maxHeight: 10,
 *   seed: 11,
 *   center: [64, 0],
 *   normals: 'HEIGHT_FN',
 *   ao: { radius: 12 },
 *   vertexColors: { layout: 'RGB_AO', rules: [{ layer: 1, slope: { min: 28 } }] },
 *   collider: true,
 * });
 * const meshId = createMeshEntity({
 *   geo: saveBufferGeometry(block.geometry, { id: 'block_1_0' }),
 *   mat: 'myVertexColorTerrain',
 *   position: { x: 64, z: 0 },
 * });
 * await createPhysicsEntity({
 *   colliders: [block.heightfield!],
 *   body: { rigidType: 'FIXED' },
 *   target: meshId,
 * });
 * ```
 */
export const generateTerrain = (opts: TerrainOptions): GeneratedTerrain => {
  const { seed = 1, collider: _collider, ...coreOpts } = opts;
  const noiseDraws =
    opts.heightFn || opts.heightmap ? undefined : recordTerrainNoiseDraws(createSeededRandom(seed));
  return toGeneratedTerrain(buildTerrainData({ ...coreOpts, noiseDraws }), opts);
};
