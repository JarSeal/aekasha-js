// Heightmaps for generated terrain (p306 Phase 4): a raw file from a terrain tool (Gaea, World
// Machine, World Creator) read into plain data, which `generateTerrain(Async)`'s `heightmap`
// option samples. Worker-safe: no imports, so the terrain worker samples it too.

/** A raw heightmap's texel format: unsigned 16-bit integers or 32-bit floats, little-endian. */
export type TerrainHeightmapFormat = 'R16' | 'R32F';

/**
 * A heightmap as plain data ({@link loadTerrainHeightmapAsync}'s result), which
 * {@link TerrainOptions}' `heightmap` samples: a grid of heights over a rectangle of the world, its
 * corner texels on the rectangle's corners. Plain arrays and numbers, so it goes to the terrain
 * worker (sent once per object), and one map can serve every block it covers.
 */
export type TerrainHeightmap = {
  /**
   * The heights in world units, row-major: row r (along z, row 0 at the map's −z edge) and column
   * c (along x, column 0 at its −x edge) at `r * cols + c`.
   */
  heights: Float32Array;
  /** The texels per row (along x), 2 or more. */
  cols: number;
  /** The rows (along z), 2 or more. */
  rows: number;
  /** The world size the map covers along x: its first and last columns are its edges. */
  width: number;
  /** The world size the map covers along z. */
  depth: number;
  /** The map's centre in the world, `[x, z]`. */
  center: [number, number];
};

/** {@link loadTerrainHeightmapAsync}'s options: the file, its layout, where it lies in the world. */
export type TerrainHeightmapOptions = {
  /** The raw file's URL, fetched as an `ArrayBuffer`: no header, `size` texels, little-endian. */
  url: string;
  /** The texels' format: see {@link TerrainHeightmapFormat}. */
  format: TerrainHeightmapFormat;
  /**
   * The texels per side, or `[columns, rows]` for a map that isn't square (the file has no
   * header to read it from; its length must match).
   */
  size: number | [number, number];
  /**
   * The world heights `[min, max]` the texels map onto: `R16`'s 0 to 65535, `R32F`'s 0 to 1
   * (a float map already in world units takes `[0, 1]`).
   */
  heightRange: [number, number];
  /**
   * The world size the map covers, or `[width, depth]`: its corner texels on the corners. A map
   * of `resolution` texels over a block of that size gives the block's vertices exactly.
   */
  extent: number | [number, number];
  /** The map's centre in the world, `[x, z]` (default `[0, 0]`). */
  center?: [number, number];
};

const BYTES_PER_TEXEL: Record<TerrainHeightmapFormat, number> = { R16: 2, R32F: 4 };

/** A `number | [number, number]` option as its pair */
const toPair = (value: number | [number, number]): [number, number] =>
  typeof value === 'number' ? [value, value] : value;

/**
 * A raw file's texels as a heightmap (`loadTerrainHeightmapAsync`'s work after the fetch).
 * @internal
 * @param source what the file is called in an error: its URL
 * @throws for options out of range, a file whose length isn't the size's, or a float texel that
 * isn't finite
 */
export const parseTerrainHeightmap = (
  buffer: ArrayBuffer,
  opts: Omit<TerrainHeightmapOptions, 'url'>,
  source: string
): TerrainHeightmap => {
  const { format, heightRange, center = [0, 0] } = opts;
  const [cols, rows] = toPair(opts.size);
  const [width, depth] = toPair(opts.extent);
  const fail = (message: string) => {
    throw new Error(`loadTerrainHeightmapAsync: ${message}`);
  };
  const bytesPerTexel = BYTES_PER_TEXEL[format];
  if (!bytesPerTexel) fail(`format is ${String(format)}, not R16 or R32F.`);
  if (![cols, rows].every((n) => Number.isInteger(n) && n >= 2)) {
    fail(`size is ${cols} × ${rows}: give whole numbers of 2 or more texels.`);
  }
  if (!(width > 0 && depth > 0)) fail(`extent is ${width} × ${depth}, not over 0.`);
  if (!heightRange.every(Number.isFinite)) {
    fail(`heightRange is [${heightRange.join(', ')}], not two finite numbers.`);
  }
  const expectedBytes = cols * rows * bytesPerTexel;
  if (buffer.byteLength !== expectedBytes) {
    fail(
      `${source} is ${buffer.byteLength} bytes: a ${cols} × ${rows} ${format} map is ${expectedBytes}. Check its size and format (a raw file, no header).`
    );
  }

  const [min, max] = heightRange;
  const view = new DataView(buffer);
  const heights = new Float32Array(cols * rows);
  if (format === 'R16') {
    const scale = (max - min) / 65535;
    for (let i = 0; i < heights.length; i++) heights[i] = min + view.getUint16(i * 2, true) * scale;
  } else {
    const scale = max - min;
    for (let i = 0; i < heights.length; i++) {
      const value = view.getFloat32(i * 4, true);
      if (!Number.isFinite(value)) {
        fail(`${source}'s texel (${i % cols}, ${Math.floor(i / cols)}) is ${value}.`);
      }
      heights[i] = min + value * scale;
    }
  }
  return { heights, cols, rows, width, depth, center };
};

/**
 * Loads a raw heightmap (`.r16`, `.raw`, `.r32`: Gaea, World Machine and World Creator export
 * them) as plain data for {@link generateTerrain}'s or {@link generateTerrainAsync}'s `heightmap`
 * option, a terrain from a terrain tool without Blender. The file is raw little-endian texels,
 * row 0 at the map's −z edge and column 0 at its −x edge, scaled onto `heightRange` and spread
 * over `extent` around `center`. A terrain sampling it reads it bilinearly at its vertices' world
 * (x, z), the edge's height past the edge, so several blocks (each its `center`) can share one map.
 * @returns the heights, in world units
 * @throws (rejects) for a failed fetch, options out of range, a file whose length isn't the size's
 * at that format, or a float texel that isn't finite
 * @remarks 16-bit PNGs can't take this route: browsers decode them to 8 bits a channel. Export a
 * raw file instead. A file in an app folder is reached with `new URL('./map.r16',
 * import.meta.url).href`, so the build copies it.
 * @example
 * ```ts
 * import { createMeshEntity, saveBufferGeometry } from 'aekasha';
 * import { createPhysicsEntity } from 'aekasha/physics';
 * import { generateTerrainAsync, loadTerrainHeightmapAsync } from 'aekasha/toolkit/geometry';
 *
 * // A 1025² Gaea export covering 1 km, heights 0-180 m; the block at its centre
 * const heightmap = await loadTerrainHeightmapAsync({
 *   url: new URL('./valley.r16', import.meta.url).href,
 *   format: 'R16',
 *   size: 1025,
 *   heightRange: [0, 180],
 *   extent: 1024,
 * });
 * const block = await generateTerrainAsync({
 *   width: 256,
 *   depth: 256,
 *   widthSegments: 256,
 *   depthSegments: 256,
 *   heightmap,
 *   normals: 'HEIGHT_FN',
 *   collider: true,
 * });
 * const meshId = createMeshEntity({
 *   geo: saveBufferGeometry(block.geometry, { id: 'valleyBlock' }),
 *   mat: 'valleyGround',
 * });
 * await createPhysicsEntity({
 *   colliders: [block.heightfield!],
 *   body: { rigidType: 'FIXED' },
 *   target: meshId,
 * });
 * ```
 */
export const loadTerrainHeightmapAsync = async (
  opts: TerrainHeightmapOptions
): Promise<TerrainHeightmap> => {
  const { url, ...layout } = opts;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `loadTerrainHeightmapAsync: fetching ${url} failed (${response.status} ${response.statusText}).`
    );
  }
  return parseTerrainHeightmap(await response.arrayBuffer(), layout, url);
};

/**
 * The heightmap's bilinear height at a world (x, z), the edge's past the edge.
 * @internal
 * @throws for a map whose `heights` isn't `cols × rows`, or fewer than 2 texels a side
 */
export const createTerrainHeightmapSampler = (map: TerrainHeightmap) => {
  const { heights, cols, rows, width, depth, center } = map;
  if (!(cols >= 2 && rows >= 2 && heights.length === cols * rows)) {
    throw new Error(
      `generateTerrain: the heightmap has ${heights.length} heights for ${cols} × ${rows} texels (2 or more a side).`
    );
  }
  const left = center[0] - width / 2;
  const back = center[1] - depth / 2;
  const toColumns = (cols - 1) / width;
  const toRows = (rows - 1) / depth;
  return (x: number, z: number) => {
    const u = Math.min(Math.max((x - left) * toColumns, 0), cols - 1);
    const v = Math.min(Math.max((z - back) * toRows, 0), rows - 1);
    // The texel cell (the far edge belongs to the last one) and the point's place in it
    const col = Math.min(Math.floor(u), cols - 2);
    const row = Math.min(Math.floor(v), rows - 2);
    const tx = u - col;
    const tz = v - row;
    const i = row * cols + col;
    const near = heights[i] + (heights[i + 1] - heights[i]) * tx;
    const far = heights[i + cols] + (heights[i + cols + 1] - heights[i + cols]) * tx;
    return near + (far - near) * tz;
  };
};
