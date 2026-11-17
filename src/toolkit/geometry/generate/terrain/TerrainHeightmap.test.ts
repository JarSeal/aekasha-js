import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateTerrain } from './Terrain';
import { loadTerrainHeightmapAsync, type TerrainHeightmapOptions } from './TerrainHeightmap';

/** A raw R16 file of these texels, little-endian */
const toR16 = (texels: number[]) => {
  const view = new DataView(new ArrayBuffer(texels.length * 2));
  texels.forEach((value, i) => view.setUint16(i * 2, value, true));
  return view.buffer;
};

/** A raw R32F file of these texels, little-endian */
const toR32F = (texels: number[]) => {
  const view = new DataView(new ArrayBuffer(texels.length * 4));
  texels.forEach((value, i) => view.setFloat32(i * 4, value, true));
  return view.buffer;
};

/** `fetch` answering every URL with this file (or this status) */
const stubFetch = (file: ArrayBuffer | number) => {
  const fetch = vi.fn(async () =>
    typeof file === 'number'
      ? new Response(null, { status: file, statusText: 'Not Found' })
      : new Response(file)
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

/** 3 columns × 2 rows, each texel its own value: row 0 is 0, 1, 2 (× 1000), row 1 is 10, 11, 12 */
const TEXELS = [0, 1000, 2000, 10000, 11000, 12000];
const MAP: Omit<TerrainHeightmapOptions, 'format'> = {
  url: '/maps/test.r16',
  size: [3, 2],
  heightRange: [0, 65.535],
  extent: [20, 10],
};

describe('loadTerrainHeightmapAsync (p306 Phase 4)', () => {
  it('reads an R16 file onto the height range', async () => {
    const fetch = stubFetch(toR16([0, 65535, 32768, 1]));
    const map = await loadTerrainHeightmapAsync({
      url: '/maps/a.r16',
      format: 'R16',
      size: 2,
      heightRange: [-10, 30],
      extent: 64,
      center: [32, -32],
    });
    expect(fetch).toHaveBeenCalledWith('/maps/a.r16');
    expect(map).toMatchObject({ cols: 2, rows: 2, width: 64, depth: 64, center: [32, -32] });
    expect(Array.from(map.heights)).toEqual(
      [-10, 30, -10 + (40 * 32768) / 65535, -10 + 40 / 65535].map(Math.fround)
    );
  });

  it('reads an R32F file, 0..1 onto the height range', async () => {
    stubFetch(toR32F([0, 1, 0.25, 2]));
    const map = await loadTerrainHeightmapAsync({
      url: '/maps/a.r32',
      format: 'R32F',
      size: 2,
      heightRange: [100, 104],
      extent: 8,
    });
    expect(Array.from(map.heights)).toEqual([100, 104, 101, 108]);
    expect(map.center).toEqual([0, 0]);
  });

  it('refuses a file whose length is not the size, naming both', async () => {
    stubFetch(toR16(TEXELS));
    await expect(loadTerrainHeightmapAsync({ ...MAP, format: 'R32F' })).rejects.toThrow(
      '/maps/test.r16 is 12 bytes: a 3 × 2 R32F map is 24.'
    );
    await expect(loadTerrainHeightmapAsync({ ...MAP, format: 'R16', size: 3 })).rejects.toThrow(
      'is 12 bytes: a 3 × 3 R16 map is 18.'
    );
  });

  it('refuses a failed fetch, options out of range and a float texel not finite', async () => {
    stubFetch(404);
    await expect(loadTerrainHeightmapAsync({ ...MAP, format: 'R16' })).rejects.toThrow(
      'fetching /maps/test.r16 failed (404 Not Found)'
    );
    stubFetch(toR16(TEXELS));
    const refusals: [Partial<TerrainHeightmapOptions>, string][] = [
      [{ size: [3, 1] }, 'size is 3 × 1'],
      [{ size: 2.5 }, 'size is 2.5 × 2.5'],
      [{ extent: [20, 0] }, 'extent is 20 × 0'],
      [{ heightRange: [0, NaN] }, 'heightRange is [0, NaN]'],
      [{ format: 'R8' as 'R16' }, 'format is R8'],
    ];
    for (const [change, message] of refusals) {
      await expect(loadTerrainHeightmapAsync({ ...MAP, format: 'R16', ...change })).rejects.toThrow(
        message
      );
    }
    stubFetch(toR32F([0, 1, NaN, 0, 0, 0]));
    await expect(loadTerrainHeightmapAsync({ ...MAP, format: 'R32F' })).rejects.toThrow(
      'texel (2, 0) is NaN'
    );
  });
});

describe("generateTerrain's heightmap (p306 Phase 4)", () => {
  it('lays row 0 at −z and column 0 at −x, a vertex per texel on a matching grid', async () => {
    stubFetch(toR16(TEXELS));
    const heightmap = await loadTerrainHeightmapAsync({ ...MAP, format: 'R16' });
    // No maxHeight: the map gives the heights, the noise isn't made
    const terrain = generateTerrain({
      width: 20,
      depth: 10,
      widthSegments: 2,
      depthSegments: 1,
      heightmap,
    });
    expect(Array.from(terrain.heights)).toEqual([0, 1, 2, 10, 11, 12]);
    // Vertex 0 is the (−x, −z) corner, vertex 5 the (+x, +z) one
    const position = terrain.geometry.getAttribute('position');
    expect([position.getX(0), position.getY(0), position.getZ(0)]).toEqual([-10, 0, -5]);
    expect([position.getX(5), position.getY(5), position.getZ(5)]).toEqual([10, 12, 5]);
  });

  it('samples bilinearly between texels, the edge past the edge, at the world (x, z)', async () => {
    stubFetch(toR16(TEXELS));
    const heightmap = await loadTerrainHeightmapAsync({
      ...MAP,
      format: 'R16',
      center: [100, 50],
    });
    // A block over the map's (+x, +z) quarter and past its edges, at its world place
    const terrain = generateTerrain({
      width: 20,
      depth: 10,
      widthSegments: 4,
      depthSegments: 2,
      center: [105, 52.5],
      heightmap,
    });
    // The map's columns are at x 90, 100, 110 and its rows at z 45, 55
    const at = (col: number, row: number) => terrain.heights[row * 5 + col];
    // (95, 47.5): halfway from column 0 to 1, a quarter from row 0 to 1
    expect(at(0, 0)).toBeCloseTo(0.5 + 10 * 0.25, 5);
    // (100, 47.5): on column 1, a quarter along z
    expect(at(1, 0)).toBeCloseTo(1 + 10 * 0.25, 5);
    // (110, 52.5) on the +x edge, three quarters along z; (115, 52.5) past it, the same
    expect(at(3, 1)).toBeCloseTo(2 + 10 * 0.75, 5);
    expect(at(4, 1)).toBe(at(3, 1));
    // (115, 57.5) past both edges: the corner texel
    expect(at(4, 2)).toBeCloseTo(12, 5);
  });

  it('gives neighbouring blocks on one map the same shared edge', async () => {
    // 5 × 5 texels over 40 m, two 20 m blocks across its middle
    stubFetch(toR16(Array.from({ length: 25 }, (_, i) => (i * 7919) % 65536)));
    const heightmap = await loadTerrainHeightmapAsync({
      url: '/maps/b.r16',
      format: 'R16',
      size: 5,
      heightRange: [0, 10],
      extent: 40,
    });
    const block = { width: 20, depth: 20, widthSegments: 8, depthSegments: 8, heightmap };
    const left = generateTerrain({ ...block, center: [-10, 0] });
    const right = generateTerrain({ ...block, center: [10, 0] });
    for (let row = 0; row < 9; row++)
      expect(right.heights[row * 9]).toBe(left.heights[row * 9 + 8]);
    // The map's texel (2, 2), the centre, is the vertex both share at (0, 0)
    expect(left.heights[4 * 9 + 8]).toBe(heightmap.heights[2 * 5 + 2]);
  });

  it('refuses heightFn with it, and a map whose heights do not fill its texels', () => {
    const heightmap = {
      heights: new Float32Array(4),
      cols: 2,
      rows: 2,
      width: 1,
      depth: 1,
      center: [0, 0] as [number, number],
    };
    const grid = { width: 4, depth: 4, widthSegments: 2, depthSegments: 2 };
    expect(() => generateTerrain({ ...grid, heightmap, heightFn: () => 0 })).toThrow(
      'give heightFn or heightmap, not both'
    );
    expect(() =>
      generateTerrain({ ...grid, heightmap: { ...heightmap, heights: new Float32Array(3) } })
    ).toThrow('the heightmap has 3 heights for 2 × 2 texels');
  });
});
