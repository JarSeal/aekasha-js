import * as fontkit from 'fontkit';
import type { Font } from 'fontkit';

/**
 * A font file through fontkit (p391 D1): the refusals (WOFF2, a collection, a variable font: what
 * msdfgen-wasm can't read as the font asks), the metrics and the kerning (GPOS, or the legacy
 * `kern` table, through fontkit's layout of each pair). Loaded on a font's first encode only.
 */

/** What every refusal ends with */
const STATIC_FONT_FIX =
  'use a static TTF, OTF or WOFF of the weight you want (most families ship one per weight)';

/** The file's first four bytes as text (its SFNT or WOFF signature) */
const getSignature = (bytes: Uint8Array) => String.fromCharCode(...bytes.subarray(0, 4));

/**
 * Why a font can't be encoded: a variable font (an `fvar` table: msdfgen-wasm reads only its
 * default instance and can't be given another). Null for a static one.
 */
export const getVariableFontError = (font: Font) => {
  const axes = Object.keys(font.variationAxes ?? {});
  // fontkit's table directory (its types leave it out)
  const { directory } = font as Font & { directory?: { tables: Record<string, unknown> } };
  if (!axes.length && !directory?.tables.fvar) return null;
  const named = axes.length ? ` (its axes: ${axes.join(', ')})` : '';
  return `it's a variable font${named}, and the encoder draws only static ones: ${STATIC_FONT_FIX}`;
};

/**
 * Parses a font file, or throws why it can't be encoded: WOFF2 (msdfgen-wasm's FreeType has no
 * brotli), a collection (TTC / OTC), a variable font, or a file fontkit can't read.
 */
export const openFont = (bytes: Uint8Array): Font => {
  const signature = getSignature(bytes);
  if (signature === 'wOF2') {
    throw new Error(`it's a WOFF2 file, which the encoder can't read: ${STATIC_FONT_FIX}`);
  }
  if (signature === 'ttcf') {
    throw new Error(`it's a font collection (TTC / OTC): ${STATIC_FONT_FIX}, one font per file`);
  }
  let font: ReturnType<typeof fontkit.create>;
  try {
    font = fontkit.create(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  } catch (error) {
    throw new Error(`fontkit can't read it: ${(error as Error).message}`);
  }
  if ('fonts' in font) {
    throw new Error(`it's a font collection: ${STATIC_FONT_FIX}, one font per file`);
  }
  const variableError = getVariableFontError(font);
  if (variableError) throw new Error(variableError);
  return font;
};

/** A font's vertical metrics in em (the em is 1): hhea's ascender, descender and line gap, the
 * underline's centre and thickness (post's) */
export const getFontMetrics = (font: Font) => {
  const em = font.unitsPerEm;
  return {
    ascender: font.ascent / em,
    descender: font.descent / em,
    lineHeight: (font.ascent - font.descent + font.lineGap) / em,
    underlineY: (font.underlinePosition - font.underlineThickness / 2) / em,
    underlineThickness: font.underlineThickness / em,
  };
};

/**
 * The features turned off for a pair's layout: the ligatures and contextual alternates would join
 * or swap the two glyphs, and the pair is then no kerning pair of these characters
 */
const PAIR_FEATURES = { liga: false, clig: false, dlig: false, calt: false, rlig: false };

/**
 * The kerning between the characters (each pair of them, the same one twice included), as the
 * font's layout applies it (GPOS pair adjustments, or the legacy `kern` table): the first glyph's
 * advance change, in font units. Grouped by the first code point; a pair with none isn't listed.
 * Phase 1: Latin 1's 36,481 pairs of IBM Plex Sans in under half a second.
 */
export const getFontKerning = (font: Font, codePoints: readonly number[]) => {
  const pairs = new Map<number, [number, number][]>();
  const glyphs = new Map(codePoints.map((cp) => [cp, font.glyphForCodePoint(cp)] as const));
  for (const first of codePoints) {
    const firstGlyph = glyphs.get(first);
    if (!firstGlyph) continue;
    for (const second of codePoints) {
      const secondGlyph = glyphs.get(second);
      if (!secondGlyph) continue;
      const run = font.layout(String.fromCodePoint(first, second), PAIR_FEATURES);
      if (
        run.glyphs.length !== 2 ||
        run.glyphs[0].id !== firstGlyph.id ||
        run.glyphs[1].id !== secondGlyph.id
      ) {
        continue;
      }
      const amount = run.positions[0].xAdvance - firstGlyph.advanceWidth;
      if (!amount) continue;
      let list = pairs.get(first);
      if (!list) pairs.set(first, (list = []));
      list.push([second, amount]);
    }
  }
  return pairs;
};
