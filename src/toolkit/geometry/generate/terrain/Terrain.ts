import * as THREE from 'three/webgpu';
import { SimplexNoise } from 'three/examples/jsm/math/SimplexNoise.js';
import { createSeededRandom } from 'aekasha';
import { toHeightfieldColliderParams, type HeightFieldData } from 'aekasha/physics';
import { computeTerrainAo, getTerrainAoMarch, type TerrainAoOptions } from './TerrainAo';
import {
  evaluateTerrainRulesCPU,
  type TerrainRule,
  type TerrainRuleNoiseTexels,
  type TerrainRulePoint,
} from './TerrainRules';

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
   * `heightFn` gives the heights.
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
   * The height at a world-space (x, z), in place of the noise (custom shapes, a heightmap's
   * reader). With it, `maxHeight`, `noiseOctaves` and `seed` aren't used.
   */
  heightFn?: (x: number, z: number) => number;
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

const DEFAULT_OCTAVES: TerrainNoiseOctave[] = [
  { frequency: 1 / 50, amplitude: 1 },
  { frequency: 1 / 18, amplitude: 0.35 },
];
/** The layers a vertex colour layout weighs, the base included */
const LAYOUT_LAYERS = { RGB_AO: 4, RGBA: 5 } as const;

/** The height at a world (x, z): the noise's or `heightFn`'s, then `heightModifier`'s */
const createHeightSampler = (opts: TerrainOptions) => {
  const { heightFn, heightModifier, maxHeight, noiseOctaves = DEFAULT_OCTAVES, seed = 1 } = opts;
  let base = heightFn;
  if (!base) {
    if (maxHeight === undefined) {
      throw new Error('generateTerrain: give maxHeight (the noise peak) or heightFn.');
    }
    const simplex = new SimplexNoise({ random: createSeededRandom(seed) });
    const totalAmplitude = noiseOctaves.reduce((sum, o) => sum + o.amplitude, 0) || 1;
    base = (x, z) => {
      let h = 0;
      for (const octave of noiseOctaves) {
        h += simplex.noise(x * octave.frequency, z * octave.frequency) * octave.amplitude;
      }
      return (h / totalAmplitude) * maxHeight;
    };
  }
  if (!heightModifier) return base;
  const unmodified = base;
  return (x: number, z: number) => heightModifier(x, z, unmodified(x, z));
};

/** The grid's place and spacing, its border cells included where the AO or normals look past it */
type TerrainGrid = {
  rows: number;
  cols: number;
  border: number;
  dx: number;
  dz: number;
  /** The heights with the border, row-major, `cols + 2 × border` a row */
  values: Float32Array;
};

/** Each vertex's normal from the height grid's central differences (the border's included) */
const getHeightFnNormals = ({ rows, cols, border, dx, dz, values }: TerrainGrid) => {
  const gridCols = cols + border * 2;
  const normals = new Float32Array(rows * cols * 3);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const g = (row + border) * gridCols + col + border;
      const nx = -(values[g + 1] - values[g - 1]) / (2 * dx);
      const nz = -(values[g + gridCols] - values[g - gridCols]) / (2 * dz);
      const length = Math.sqrt(nx * nx + 1 + nz * nz);
      const i = (row * cols + col) * 3;
      normals[i] = nx / length;
      normals[i + 1] = 1 / length;
      normals[i + 2] = nz / length;
    }
  }
  return normals;
};

/** The vertex colours (RGBA bytes): the rules' weights of layers 1+, `RGB_AO`'s A the AO */
const getVertexColors = (
  opts: TerrainVertexColorOptions,
  positions: Float32Array,
  normals: ArrayLike<number>,
  center: [number, number],
  ao: Float32Array | undefined
) => {
  const { layout, rules = [], noise } = opts;
  const layerCount = LAYOUT_LAYERS[layout];
  const unknown = rules.find((rule) => !(rule.layer >= 0 && rule.layer < layerCount));
  if (unknown) {
    throw new Error(
      `generateTerrain: a rule's layer is ${unknown.layer}: ${layout} weighs layers 0 to ${layerCount - 1}.`
    );
  }
  const count = positions.length / 3;
  const colors = new Uint8Array(count * 4);
  const weights = new Float32Array(layerCount);
  const point: TerrainRulePoint = { x: 0, y: 0, z: 0, normalX: 0, normalY: 1, normalZ: 0 };
  const toByte = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 255);
  for (let i = 0; i < count; i++) {
    weights.fill(0);
    weights[0] = 1;
    if (rules.length) {
      point.x = center[0] + positions[i * 3];
      point.y = positions[i * 3 + 1];
      point.z = center[1] + positions[i * 3 + 2];
      point.normalX = normals[i * 3];
      point.normalY = normals[i * 3 + 1];
      point.normalZ = normals[i * 3 + 2];
      evaluateTerrainRulesCPU(rules, point, weights, noise);
    }
    for (let channel = 0; channel < 4; channel++) {
      const value =
        channel === 3 && layout === 'RGB_AO' ? (ao ? ao[i] : 1) : weights[channel + 1] ?? 0;
      colors[i * 4 + channel] = toByte(value);
    }
  }
  return colors;
};

/** The grid's edge vertices as one closed loop: the −z edge along +x, then +x, +z and −x */
const getEdgeLoop = (rows: number, cols: number) => {
  const loop: number[] = [];
  for (let col = 0; col < cols; col++) loop.push(col);
  for (let row = 1; row < rows; row++) loop.push(row * cols + cols - 1);
  for (let col = cols - 2; col >= 0; col--) loop.push((rows - 1) * cols + col);
  for (let row = rows - 2; row > 0; row--) loop.push(row * cols);
  return loop;
};

/**
 * The skirt: a copy of each edge vertex `depth` lower (its other attributes copied), and a strip
 * of outward-facing triangles between them
 */
const addSkirt = (
  geometry: THREE.BufferGeometry,
  indices: number[],
  { rows, cols }: { rows: number; cols: number },
  depth: number
) => {
  const loop = getEdgeLoop(rows, cols);
  const count = rows * cols;
  for (const name of Object.keys(geometry.attributes)) {
    const attribute = geometry.getAttribute(name) as THREE.BufferAttribute;
    const size = attribute.itemSize;
    const source = attribute.array as Float32Array | Uint8Array;
    const array = new (source.constructor as Float32ArrayConstructor | Uint8ArrayConstructor)(
      (count + loop.length) * size
    );
    array.set(source);
    loop.forEach((vertex, i) => {
      for (let k = 0; k < size; k++) array[(count + i) * size + k] = source[vertex * size + k];
      if (name === 'position') array[(count + i) * size + 1] -= depth;
    });
    geometry.setAttribute(name, new THREE.BufferAttribute(array, size, attribute.normalized));
  }
  loop.forEach((p, i) => {
    const next = (i + 1) % loop.length;
    const q = loop[next];
    const pSkirt = count + i;
    const qSkirt = count + next;
    indices.push(p, q, pSkirt, q, qSkirt, pSkirt);
  });
};

/**
 * Builds a low-poly terrain: a grid centred on the origin, its heights from seeded simplex noise
 * or `heightFn` (and `heightModifier`), with `getHeightAt` to place things on it (scattering,
 * spawn points) and the heights as an array. Optionally sampled at a world `center` (blocks that
 * continue each other), with normals from the height function (no lighting seam between blocks),
 * horizon AO, the terrain material's rules as vertex colours, the `HEIGHTFIELD` collider's params
 * and a skirt. The geometry isn't registered: save it with `saveBufferGeometry` to have it
 * disposed with its scene.
 * @throws for neither `maxHeight` nor `heightFn`, a negative `skirt`, `ao`'s or a rule's values
 * out of range, or a rule's layer the vertex colour layout doesn't weigh
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
  // The vertices are built here, not by a rotated PlaneGeometry, so the grid's (row, col) → world
  // (x, z) mapping is the one getHeightAt reads back (a rotated plane's vertex order would mirror
  // the sampled heights against the mesh)
  const {
    width,
    depth,
    widthSegments: rawWidthSegments,
    depthSegments: rawDepthSegments,
    center = [0, 0],
    normals: normalSource = 'GEOMETRY',
    ao: aoOpts,
    vertexColors,
    collider = false,
    skirt = 0,
  } = opts;
  if (!(skirt >= 0)) throw new Error(`generateTerrain: skirt is ${skirt}, not 0 or more.`);
  const aoStrength = aoOpts?.strength ?? 1;
  if (!(aoStrength >= 0 && aoStrength <= 1)) {
    throw new Error(`generateTerrain: ao.strength is ${aoStrength}, not within 0..1.`);
  }
  const sampleHeight = createHeightSampler(opts);

  // The grid's cell counts: whole numbers of 1 or more, which the arrays below are sized by
  const widthSegments = Math.max(1, Math.round(rawWidthSegments));
  const depthSegments = Math.max(1, Math.round(rawDepthSegments));
  const cols = widthSegments + 1;
  const rows = depthSegments + 1;
  const dx = width / widthSegments;
  const dz = depth / depthSegments;

  // The heights, with a border of the same surface past the edge where the normals or the AO
  // look past it
  const march = aoOpts ? getTerrainAoMarch(aoOpts, Math.min(dx, dz)) : null;
  const border = Math.max(
    normalSource === 'HEIGHT_FN' ? 1 : 0,
    march ? march.steps * march.stride : 0
  );
  const gridCols = cols + border * 2;
  const gridRows = rows + border * 2;
  const grid = new Float32Array(gridCols * gridRows);
  for (let gridRow = 0; gridRow < gridRows; gridRow++) {
    const z = ((gridRow - border) / depthSegments) * depth - depth / 2;
    for (let gridCol = 0; gridCol < gridCols; gridCol++) {
      const x = ((gridCol - border) / widthSegments) * width - width / 2;
      grid[gridRow * gridCols + gridCol] = sampleHeight(center[0] + x, center[1] + z);
    }
  }
  const terrainGrid: TerrainGrid = { rows, cols, border, dx, dz, values: grid };

  const heights = border ? new Float32Array(cols * rows) : grid;
  const positions = new Float32Array(cols * rows * 3);
  const uvs = new Float32Array(cols * rows * 2);
  for (let row = 0; row < rows; row++) {
    const z = (row / depthSegments) * depth - depth / 2;
    for (let col = 0; col < cols; col++) {
      const x = (col / widthSegments) * width - width / 2;
      const i = row * cols + col;
      const h = grid[(row + border) * gridCols + col + border];
      heights[i] = h;
      positions[i * 3] = x;
      positions[i * 3 + 1] = h;
      positions[i * 3 + 2] = z;
      uvs[i * 2] = col / widthSegments;
      uvs[i * 2 + 1] = row / depthSegments;
    }
  }

  const indices: number[] = [];
  for (let row = 0; row < depthSegments; row++) {
    for (let col = 0; col < widthSegments; col++) {
      const a = row * cols + col;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      // Winding chosen so the computed normal faces +Y before computeVertexNormals()
      // re-derives the real (slope-aware) normals. The two triangles share the b–c diagonal,
      // which getHeightAt follows.
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  if (normalSource === 'HEIGHT_FN') {
    geometry.setAttribute('normal', new THREE.BufferAttribute(getHeightFnNormals(terrainGrid), 3));
  } else {
    geometry.computeVertexNormals();
  }

  const ao = march ? computeTerrainAo(grid, terrainGrid, march, aoStrength) : undefined;
  if (vertexColors) {
    const normals = geometry.getAttribute('normal').array;
    const colors = getVertexColors(vertexColors, positions, normals, center, ao);
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4, true));
  }
  if (skirt > 0) {
    addSkirt(geometry, indices, { rows, cols }, skirt);
    geometry.setIndex(indices);
  }
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();

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
  if (ao) result.ao = ao;
  if (collider) {
    result.heightfield = toHeightfieldColliderParams({ heights, rows, cols, width, depth });
  }
  return result;
};
