/**
 * A font atlas's packing (p391 D2): each glyph's tile, padded, placed by a skyline bottom-left
 * packer on the smallest page that holds them all. Not the texture atlases' layout
 * (`textureAtlases.ts`, whose cells align to compression blocks for their mip levels: a font atlas
 * has neither) and not msdfgen-wasm's maxrects packer (Phase 1: half its ASCII page empty).
 */

/** A tile to place: its size in pixels, without padding */
export type PackTile = { width: number; height: number };

/** A tile's place: its top-left pixel, inside its padding */
export type PackPlace = { x: number; y: number };

type SkylineNode = { x: number; y: number; width: number };

/**
 * Places the tiles on a `width` × `height` page by a skyline bottom-left packer (here top-left:
 * y grows down), the tallest first. Each tile takes `padding` px on every side, so two tiles are
 * `2 × padding` apart and the page's edge `padding` away. Returns each tile's place in input
 * order, null for one that didn't fit.
 */
export const packSkyline = (
  tiles: readonly PackTile[],
  width: number,
  height: number,
  padding: number
): (PackPlace | null)[] => {
  const order = tiles
    .map((tile, index) => ({ index, w: tile.width + 2 * padding, h: tile.height + 2 * padding }))
    .sort((a, b) => b.h - a.h || b.w - a.w || a.index - b.index);
  const skyline: SkylineNode[] = [{ x: 0, y: 0, width }];
  const places: (PackPlace | null)[] = tiles.map(() => null);
  for (const { index, w, h } of order) {
    let best: { node: number; x: number; y: number } | null = null;
    for (let i = 0; i < skyline.length; i++) {
      const x = skyline[i].x;
      if (x + w > width) break;
      // The tile rests on the highest node it spans
      let y = 0;
      for (let j = i, left = w; left > 0; j++) {
        y = Math.max(y, skyline[j].y);
        left -= skyline[j].width;
      }
      if (y + h > height) continue;
      if (!best || y < best.y || (y === best.y && x < best.x)) best = { node: i, x, y };
    }
    if (!best) continue;
    places[index] = { x: best.x + padding, y: best.y + padding };
    // The tile's top becomes a node; the nodes it covers shrink or go
    const placed: SkylineNode = { x: best.x, y: best.y + h, width: w };
    let i = best.node;
    skyline.splice(i, 0, placed);
    i++;
    while (i < skyline.length && skyline[i].x < placed.x + placed.width) {
      const node = skyline[i];
      const covered = placed.x + placed.width - node.x;
      if (covered < node.width) {
        node.x += covered;
        node.width -= covered;
        break;
      }
      skyline.splice(i, 1);
    }
    // Neighbours of one height join
    for (let j = 0; j < skyline.length - 1; j++) {
      if (skyline[j].y === skyline[j + 1].y) {
        skyline[j].width += skyline[j + 1].width;
        skyline.splice(j + 1, 1);
        j--;
      }
    }
  }
  return places;
};

/** The page sizes tried, smallest first: square, then twice as wide (64², 128 × 64, 128², …) */
const listPageSizes = (maxSize: number) => {
  const sizes: { width: number; height: number }[] = [];
  for (let side = 64; side <= maxSize; side *= 2) {
    if (side > 64) sizes.push({ width: side, height: side / 2 });
    sizes.push({ width: side, height: side });
  }
  return sizes;
};

/** A font atlas's page and its tiles' places, or how many tiles fit on the largest page */
export type FontAtlasPacking =
  | { width: number; height: number; places: PackPlace[] }
  | { error: string; fitted: number };

/**
 * Packs a font's tiles on the smallest page that holds them all: powers of two from 64 up to
 * `maxSize` a side; without `pot`, that page cropped to the tiles (and their padding). Past
 * `maxSize`, an error naming how many fit.
 */
export const packFontAtlas = (
  tiles: readonly PackTile[],
  opts: { maxSize: number; padding: number; pot: boolean }
): FontAtlasPacking => {
  const { maxSize, padding, pot } = opts;
  const area = tiles.reduce(
    (sum, tile) => sum + (tile.width + 2 * padding) * (tile.height + 2 * padding),
    0
  );
  for (const size of listPageSizes(maxSize)) {
    if (size.width * size.height < area) continue;
    const places = packSkyline(tiles, size.width, size.height, padding);
    if (places.some((place) => !place)) continue;
    const placed = places as PackPlace[];
    if (pot) return { ...size, places: placed };
    let width = 1;
    let height = 1;
    tiles.forEach((tile, i) => {
      width = Math.max(width, placed[i].x + tile.width + padding);
      height = Math.max(height, placed[i].y + tile.height + padding);
    });
    return { width, height, places: placed };
  }
  const largest = packSkyline(tiles, maxSize, maxSize, padding);
  const fitted = largest.filter(Boolean).length;
  return {
    error: `its ${tiles.length} glyphs don't fit on a ${maxSize} × ${maxSize} atlas (${fitted} do): ask for fewer characters, lower its size or pxRange, or raise atlas.maxSize`,
    fitted,
  };
};
