import { describe, expect, it } from 'vitest';
import { packFontAtlas, packSkyline, type PackPlace, type PackTile } from './pack';

// p391 Phase 2 section 3: the font atlas's packer (D2): no two padded tiles overlap, all inside the
// page, the smallest page that holds them, and the error past `maxSize`

/** Tiles of a seeded spread of sizes, like a font's (wide, tall, small) */
const makeTiles = (count: number, seed = 1): PackTile[] => {
  let state = seed;
  const next = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
  return Array.from({ length: count }, () => ({
    width: 8 + Math.floor(next() * 40),
    height: 8 + Math.floor(next() * 48),
  }));
};

/** Throws when two padded tiles overlap or one leaves the page */
const checkPlaces = (
  tiles: readonly PackTile[],
  places: readonly PackPlace[],
  size: { width: number; height: number },
  padding: number
) => {
  const rects = tiles.map((tile, i) => ({
    x0: places[i].x - padding,
    y0: places[i].y - padding,
    x1: places[i].x + tile.width + padding,
    y1: places[i].y + tile.height + padding,
  }));
  for (const [i, a] of rects.entries()) {
    expect(a.x0 >= 0 && a.y0 >= 0 && a.x1 <= size.width && a.y1 <= size.height, `tile ${i}`).toBe(
      true
    );
    for (const b of rects.slice(i + 1)) {
      const isApart = a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0;
      expect(isApart, `tiles overlap: ${JSON.stringify([a, b])}`).toBe(true);
    }
  }
};

describe('packSkyline', () => {
  it('places every tile apart, padded, inside the page', () => {
    const tiles = makeTiles(120);
    const places = packSkyline(tiles, 512, 512, 2);
    expect(places.every(Boolean)).toBe(true);
    checkPlaces(tiles, places as PackPlace[], { width: 512, height: 512 }, 2);
  });

  it('leaves out (null) what doesn’t fit, the rest still apart', () => {
    const tiles = makeTiles(300, 7);
    const places = packSkyline(tiles, 256, 256, 1);
    const placed = places.flatMap((place, i) => (place ? [{ place, tile: tiles[i] }] : []));
    expect(placed.length).toBeGreaterThan(0);
    expect(placed.length).toBeLessThan(tiles.length);
    checkPlaces(
      placed.map(({ tile }) => tile),
      placed.map(({ place }) => place),
      { width: 256, height: 256 },
      1
    );
  });
});

describe('packFontAtlas', () => {
  it('takes the smallest power-of-two page, wide before tall', () => {
    expect(
      packFontAtlas([{ width: 30, height: 30 }], { maxSize: 2048, padding: 2, pot: true })
    ).toMatchObject({
      width: 64,
      height: 64,
      places: [{ x: 2, y: 2 }],
    });
    const two = packFontAtlas(
      [
        { width: 60, height: 60 },
        { width: 60, height: 60 },
      ],
      { maxSize: 2048, padding: 2, pot: true }
    );
    expect(two).toMatchObject({ width: 128, height: 64 });
  });

  it('packs a font-sized set tightly enough: within twice its padded area', () => {
    const tiles = makeTiles(191, 3);
    const packing = packFontAtlas(tiles, { maxSize: 2048, padding: 2, pot: true });
    if ('error' in packing) throw new Error(packing.error);
    checkPlaces(tiles, packing.places, packing, 2);
    const area = tiles.reduce((sum, t) => sum + (t.width + 4) * (t.height + 4), 0);
    expect(packing.width * packing.height).toBeLessThanOrEqual(2 * area * 1.25);
  });

  it('crops the page to the tiles without pot', () => {
    const packing = packFontAtlas([{ width: 30, height: 10 }], {
      maxSize: 2048,
      padding: 2,
      pot: false,
    });
    expect(packing).toMatchObject({ width: 34, height: 14 });
  });

  it('fails past maxSize, naming how many fit', () => {
    const packing = packFontAtlas(makeTiles(200, 5), { maxSize: 128, padding: 2, pot: true });
    expect('error' in packing && packing.fitted).toBeGreaterThan(0);
    expect('error' in packing && packing.error).toMatch(
      /^its 200 glyphs don't fit on a 128 × 128 atlas \(\d+ do\): .*raise atlas\.maxSize$/
    );
  });
});
