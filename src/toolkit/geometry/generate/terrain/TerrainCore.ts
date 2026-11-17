// A generated terrain's arrays (p306 Phase 4): `generateTerrain`'s work on plain typed arrays, so
// the toolkit's terrain worker runs it too. It imports no three but `SimplexNoise` (a file of its
// own), its siblings and no engine entry: the dev server doesn't tree-shake, so a worker
// importing `aekasha` would load the whole engine, styles included. Its callers make the geometry, the seeded draws
// and the collider's params (`Terrain.ts`).
import { SimplexNoise } from 'three/examples/jsm/math/SimplexNoise.js';
import type { TerrainOptions, TerrainNoiseOctave, TerrainVertexColorOptions } from './Terrain';
import { computeTerrainAo, getTerrainAoMarch } from './TerrainAo';
import { createTerrainHeightmapSampler } from './TerrainHeightmap';
import { evaluateTerrainRulesCPU, type TerrainRulePoint } from './TerrainRules';

/**
 * The core's options: `generateTerrain`'s, the seed's draws in place of the seed (`recordTerrainNoiseDraws`).
 * @internal
 */
export type TerrainCoreOptions = Omit<TerrainOptions, 'seed' | 'collider'> & {
  /** The seeded random numbers the noise's `SimplexNoise` draws when made (the noise only) */
  noiseDraws?: Float64Array;
};

/**
 * The terrain's arrays: the geometry's attributes, index and bounds (three's own computations',
 * the same numbers), the heights and the AO.
 * @internal
 */
export type TerrainData = {
  /** The grid's cells along x, as used (rounded, at least 1) */
  widthSegments: number;
  /** The grid's cells along z, as used */
  depthSegments: number;
  positions: Float32Array;
  uvs: Float32Array;
  normals: Float32Array;
  /** RGBA bytes, normalized (with `vertexColors` only) */
  colors?: Uint8Array;
  /** `Uint32Array` when a vertex's index reaches 65535, as three's `setIndex` picks */
  index: Uint16Array | Uint32Array;
  /** The grid's heights, row-major, without the skirt */
  heights: Float32Array;
  /** The horizon AO, row-major like `heights` (with `ao` only) */
  ao?: Float32Array;
  /** The positions' bounding box's corners, `computeBoundingBox`'s */
  boxMin: [number, number, number];
  boxMax: [number, number, number];
  /** The bounding sphere, `computeBoundingSphere`'s */
  sphereCenter: [number, number, number];
  sphereRadius: number;
};

const DEFAULT_OCTAVES: TerrainNoiseOctave[] = [
  { frequency: 1 / 50, amplitude: 1 },
  { frequency: 1 / 18, amplitude: 0.35 },
];
/** The layers a vertex colour layout weighs, the base included */
const LAYOUT_LAYERS = { RGB_AO: 4, RGBA: 5 } as const;

/**
 * The numbers a `SimplexNoise` draws from `random` when it's made, recorded (counted, not assumed:
 * 256 in three r187), so a thread without the seeded generator makes the same noise.
 * @internal
 */
export const recordTerrainNoiseDraws = (random: () => number) => {
  const draws: number[] = [];
  new SimplexNoise({
    random: () => {
      const value = random();
      draws.push(value);
      return value;
    },
  });
  return Float64Array.from(draws);
};

/** The noise made from recorded draws: the one `recordTerrainNoiseDraws`' generator made */
const replayNoise = (draws: Float64Array) => {
  let next = 0;
  return new SimplexNoise({
    random: () => {
      if (next >= draws.length) {
        throw new Error(
          `generateTerrain: the noise drew more than its ${draws.length} recorded numbers.`
        );
      }
      return draws[next++];
    },
  });
};

/** The height at a world (x, z): the noise's, `heightFn`'s or `heightmap`'s, then the modifier's */
const createHeightSampler = (opts: TerrainCoreOptions) => {
  const { heightFn, heightmap, heightModifier, maxHeight, noiseOctaves = DEFAULT_OCTAVES } = opts;
  if (heightFn && heightmap) {
    throw new Error('generateTerrain: give heightFn or heightmap, not both.');
  }
  let base = heightFn ?? (heightmap ? createTerrainHeightmapSampler(heightmap) : undefined);
  if (!base) {
    const { noiseDraws } = opts;
    if (maxHeight === undefined) {
      throw new Error('generateTerrain: give maxHeight (the noise peak), heightFn or heightmap.');
    }
    if (!noiseDraws) throw new Error('generateTerrain: the noise has no recorded draws.');
    const simplex = replayNoise(noiseDraws);
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

/**
 * The triangles' normals summed per vertex and normalized: three's `computeVertexNormals` (r187)
 * step for step, float64 sums stored per triangle into the `Float32Array`, so the same numbers
 */
const getGeometryNormals = (positions: Float32Array, index: ArrayLike<number>) => {
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < index.length; i += 3) {
    const a = index[i] * 3;
    const b = index[i + 1] * 3;
    const c = index[i + 2] * 3;
    // cb × ab, cb = C − B and ab = A − B
    const cbX = positions[c] - positions[b];
    const cbY = positions[c + 1] - positions[b + 1];
    const cbZ = positions[c + 2] - positions[b + 2];
    const abX = positions[a] - positions[b];
    const abY = positions[a + 1] - positions[b + 1];
    const abZ = positions[a + 2] - positions[b + 2];
    const nX = cbY * abZ - cbZ * abY;
    const nY = cbZ * abX - cbX * abZ;
    const nZ = cbX * abY - cbY * abX;
    normals[a] += nX;
    normals[a + 1] += nY;
    normals[a + 2] += nZ;
    normals[b] += nX;
    normals[b + 1] += nY;
    normals[b + 2] += nZ;
    normals[c] += nX;
    normals[c + 1] += nY;
    normals[c + 2] += nZ;
  }
  for (let i = 0; i < normals.length; i += 3) {
    const x = normals[i];
    const y = normals[i + 1];
    const z = normals[i + 2];
    const scale = 1 / (Math.sqrt(x * x + y * y + z * z) || 1);
    normals[i] = x * scale;
    normals[i + 1] = y * scale;
    normals[i + 2] = z * scale;
  }
  return normals;
};

/** The vertex colours (RGBA bytes): the rules' weights of layers 1+, `RGB_AO`'s A the AO */
const getVertexColors = (
  opts: TerrainVertexColorOptions,
  positions: Float32Array,
  normals: Float32Array,
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

/** An attribute's array with a copy of each loop vertex's item appended (`lower` the y drop) */
const appendLoop = <T extends Float32Array | Uint8Array>(
  source: T,
  size: number,
  loop: number[],
  lower = 0
): T => {
  const count = source.length / size;
  const array = new (source.constructor as new (length: number) => T)((count + loop.length) * size);
  array.set(source);
  loop.forEach((vertex, i) => {
    for (let k = 0; k < size; k++) array[(count + i) * size + k] = source[vertex * size + k];
    if (lower) array[(count + i) * size + 1] -= lower;
  });
  return array;
};

/** The positions' bounds, three's `computeBoundingBox` and `computeBoundingSphere` (r187) */
const getBounds = (positions: Float32Array) => {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], positions[i + k]);
      max[k] = Math.max(max[k], positions[i + k]);
    }
  }
  const center: [number, number, number] = [
    (min[0] + max[0]) * 0.5,
    (min[1] + max[1]) * 0.5,
    (min[2] + max[2]) * 0.5,
  ];
  let maxRadiusSq = 0;
  for (let i = 0; i < positions.length; i += 3) {
    const dx = center[0] - positions[i];
    const dy = center[1] - positions[i + 1];
    const dz = center[2] - positions[i + 2];
    maxRadiusSq = Math.max(maxRadiusSq, dx * dx + dy * dy + dz * dz);
  }
  return { boxMin: min, boxMax: max, sphereCenter: center, sphereRadius: Math.sqrt(maxRadiusSq) };
};

/**
 * `generateTerrain`'s arrays (its JSDoc has the options' effects): the heights on the grid and its
 * border, then the vertices, triangles, normals, AO, colours, skirt and bounds.
 * @internal
 * @throws for neither `maxHeight` nor `heightFn`, a negative `skirt`, `ao`'s or a rule's values
 * out of range, or a rule's layer the vertex colour layout doesn't weigh
 */
export const buildTerrainData = (opts: TerrainCoreOptions): TerrainData => {
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
  let positions = new Float32Array(cols * rows * 3);
  let uvs = new Float32Array(cols * rows * 2);
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

  const loop = skirt > 0 ? getEdgeLoop(rows, cols) : [];
  const vertexCount = cols * rows + loop.length;
  const triangleCount = widthSegments * depthSegments * 2 + loop.length * 2;
  const index =
    vertexCount - 1 >= 65535
      ? new Uint32Array(triangleCount * 3)
      : new Uint16Array(triangleCount * 3);
  let next = 0;
  for (let row = 0; row < depthSegments; row++) {
    for (let col = 0; col < widthSegments; col++) {
      const a = row * cols + col;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      // Winding chosen so the computed normal faces +Y. The two triangles share the b–c diagonal,
      // which getHeightAt follows.
      index[next++] = a;
      index[next++] = c;
      index[next++] = b;
      index[next++] = b;
      index[next++] = c;
      index[next++] = d;
    }
  }
  const gridIndexCount = next;

  let normals =
    normalSource === 'HEIGHT_FN'
      ? getHeightFnNormals(terrainGrid)
      : getGeometryNormals(positions, index.subarray(0, gridIndexCount));

  const ao = march ? computeTerrainAo(grid, terrainGrid, march, aoStrength) : undefined;
  let colors = vertexColors
    ? getVertexColors(vertexColors, positions, normals, center, ao)
    : undefined;

  // The skirt: a copy of each edge vertex `skirt` lower (its other attributes copied), and a strip
  // of outward-facing triangles between them
  if (loop.length) {
    const count = cols * rows;
    positions = appendLoop(positions, 3, loop, skirt);
    uvs = appendLoop(uvs, 2, loop);
    normals = appendLoop(normals, 3, loop);
    if (colors) colors = appendLoop(colors, 4, loop);
    loop.forEach((p, i) => {
      const following = (i + 1) % loop.length;
      const q = loop[following];
      const pSkirt = count + i;
      const qSkirt = count + following;
      index[next++] = p;
      index[next++] = q;
      index[next++] = pSkirt;
      index[next++] = q;
      index[next++] = qSkirt;
      index[next++] = pSkirt;
    });
  }

  const data: TerrainData = {
    widthSegments,
    depthSegments,
    positions,
    uvs,
    normals,
    index,
    heights,
    ...getBounds(positions),
  };
  if (colors) data.colors = colors;
  if (ao) data.ao = ao;
  return data;
};
