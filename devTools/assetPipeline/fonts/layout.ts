import type { FontType } from '../../../src/_engine/schemas';
import {
  FONT_LAYOUT_FORMAT,
  type FontLayout,
  type FontLayoutGlyph,
} from '../../../src/_engine/features/text/FontLayoutFormat';

// The format's version and types are the engine's (the runtime parses what this writes)
export { FONT_LAYOUT_FORMAT, type FontLayout, type FontLayoutGlyph };

/**
 * A font's layout JSON (p391 D3): what the text layout needs and nothing else, minified. Em values
 * (the em is 1) rounded to 4 decimals, atlas pixels whole, kerning in font units.
 *
 * - `atlas.file`: the atlas's file name, beside the layout (both are a font's outputs).
 * - `glyphs[codePoint]`: `[advance]` for a glyph with no ink (space), else `[advance, planeLeft,
 *   planeBottom, planeRight, planeTop, atlasX, atlasY, atlasWidth, atlasHeight]`: the plane
 *   bounds in em (y up, the tile's whole quad, its distance range included) and the tile in atlas
 *   pixels from the top left, so `v = y / height` (Phase 1: no flip on either backend).
 * - `kerning[first]`: `[second, amount, second, amount, …]`, the amounts in `kerningUnitsPerEm`
 *   (Phase 1: about half the bytes of em amounts in triples).
 */

/** Rounded to 4 decimals, never -0 */
export const roundEm = (value: number) => Math.round(value * 1e4) / 1e4 || 0;

/** A placed glyph's layout input: em values unrounded */
export type FontLayoutGlyphInput = {
  codePoint: number;
  advance: number;
  /** Absent for a glyph with no ink */
  tile?: {
    plane: [left: number, bottom: number, right: number, top: number];
    atlas: [x: number, y: number, width: number, height: number];
  };
};

/** The layout JSON, by ascending code point */
export const buildFontLayout = (input: {
  type: FontType;
  atlas: FontLayout['atlas'];
  metrics: FontLayout['metrics'];
  fallback: number;
  glyphs: FontLayoutGlyphInput[];
  /** By first code point, ascending; amounts in `unitsPerEm`; null without kerning */
  kerning: { unitsPerEm: number; pairs: Map<number, [number, number][]> } | null;
}): FontLayout => {
  const metrics = Object.fromEntries(
    Object.entries(input.metrics).map(([key, value]) => [key, roundEm(value)])
  ) as FontLayout['metrics'];
  const glyphs: Record<string, FontLayoutGlyph> = {};
  for (const glyph of [...input.glyphs].sort((a, b) => a.codePoint - b.codePoint)) {
    const advance = roundEm(glyph.advance);
    glyphs[glyph.codePoint] = glyph.tile
      ? [
          advance,
          ...(glyph.tile.plane.map(roundEm) as [number, number, number, number]),
          ...glyph.tile.atlas,
        ]
      : [advance];
  }
  const layout: FontLayout = {
    format: FONT_LAYOUT_FORMAT,
    type: input.type,
    atlas: input.atlas,
    metrics,
    fallback: input.fallback,
    glyphs,
  };
  if (input.kerning && input.kerning.pairs.size) {
    layout.kerningUnitsPerEm = input.kerning.unitsPerEm;
    layout.kerning = {};
    for (const first of [...input.kerning.pairs.keys()].sort((a, b) => a - b)) {
      const pairs = [...(input.kerning.pairs.get(first) ?? [])].sort((a, b) => a[0] - b[0]);
      layout.kerning[first] = pairs.flat();
    }
  }
  return layout;
};
