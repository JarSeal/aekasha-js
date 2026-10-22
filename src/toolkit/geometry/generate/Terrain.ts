import * as THREE from 'three/webgpu';
import { SimplexNoise } from 'three/examples/jsm/math/SimplexNoise.js';
import { createSeededRandom } from 'aekasha';

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

/** {@link generateTerrain}'s options: the size, the grid and the height noise. */
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
  /** The noise's peak height in world units: heights stay within ±`maxHeight`. */
  maxHeight: number;
  /**
   * The height noise's octaves (seeded simplex), default two gentle ones: frequency 1/50 at
   * weight 1, and 1/18 at 0.35, rolling hills.
   */
  noiseOctaves?: TerrainNoiseOctave[];
  /** Deterministic seed, an integer (default 1): the same seed gives the same terrain. */
  seed?: number;
  /**
   * Reshapes the noise height per vertex: gets the vertex's world-space (x, z) and its noise
   * height `h`, returns the final height. Applied before the geometry is built, so the mesh,
   * `heights` and `getHeightAt` all agree. Eg. a mask that flattens part of the terrain, or sinks
   * its edges below a ground plane.
   */
  heightModifier?: (x: number, z: number, h: number) => number;
}

/** {@link generateTerrain}'s result: the mesh's geometry, its grid and its heights. */
export interface GeneratedTerrain {
  /** The terrain's geometry, indexed, with normals and UVs, not registered. */
  geometry: THREE.BufferGeometry;
  /** The size along x, as given. */
  width: number;
  /** The size along z, as given. */
  depth: number;
  /** The grid's cells along x, as used (rounded, at least 1). */
  widthSegments: number;
  /** The grid's cells along z, as used (rounded, at least 1). */
  depthSegments: number;
  /**
   * The mesh's height at world-space (x, z), clamped to the terrain's extent: inside a grid cell,
   * the height of the cell's triangle under the point (the cells split along the diagonal from
   * (col + 1, row) to (col, row + 1)), so a body placed with it sits on the mesh.
   */
  getHeightAt: (x: number, z: number) => number;
  /**
   * The grid's heights, row-major: row r (along z, from -depth / 2) and column c (along x, from
   * -width / 2) at `r * (widthSegments + 1) + c`.
   * @remarks A `HEIGHTFIELD` collider reads its heights column-major: transpose them (or use a
   * `TRIMESH` of `geometry`, which matches the mesh exactly).
   */
  heights: Float32Array;
}

/**
 * Builds a low-poly terrain: a grid centred on the origin, its heights from seeded simplex noise
 * (and `heightModifier`), with `getHeightAt` to place things on it (scattering, spawn points) and
 * the heights as an array. The geometry isn't registered: save it with `saveBufferGeometry` to
 * have it disposed with its scene.
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
    maxHeight,
    noiseOctaves = [
      { frequency: 1 / 50, amplitude: 1 },
      { frequency: 1 / 18, amplitude: 0.35 },
    ],
    seed = 1,
    heightModifier,
  } = opts;

  // The grid's cell counts: whole numbers of 1 or more, which the arrays below are sized by
  const widthSegments = Math.max(1, Math.round(rawWidthSegments));
  const depthSegments = Math.max(1, Math.round(rawDepthSegments));

  const random = createSeededRandom(seed);
  const simplex = new SimplexNoise({ random });
  const totalAmplitude = noiseOctaves.reduce((sum, o) => sum + o.amplitude, 0) || 1;

  const cols = widthSegments + 1;
  const rows = depthSegments + 1;
  const heights = new Float32Array(cols * rows);
  const positions = new Float32Array(cols * rows * 3);
  const uvs = new Float32Array(cols * rows * 2);

  for (let row = 0; row < rows; row++) {
    const z = (row / depthSegments) * depth - depth / 2;
    for (let col = 0; col < cols; col++) {
      const x = (col / widthSegments) * width - width / 2;

      let h = 0;
      for (const octave of noiseOctaves) {
        h += simplex.noise(x * octave.frequency, z * octave.frequency) * octave.amplitude;
      }
      h = (h / totalAmplitude) * maxHeight;
      if (heightModifier) h = heightModifier(x, z, h);

      const i = row * cols + col;
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
  geometry.computeVertexNormals();
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

  return { geometry, width, depth, widthSegments, depthSegments, getHeightAt, heights };
};
