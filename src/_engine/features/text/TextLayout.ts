// p392 D3: a text's layout, pure (no three, no DOM, no ECS): code points → glyphs → lines → quads
// in the text's own space. It writes into a reusable `TextLayoutBuffer` and allocates nothing once
// the buffer has grown to the text's size, so a `setText` every frame costs no garbage.
import { getFontKerningKey, type FontData } from './Fonts';
import type { TextAlign, TextAnchor } from './TextTypes';

/** Floats per glyph in each of a layout's rect arrays */
export const TEXT_RECT_FLOATS = 4;

/**
 * What a layout reads besides the font and the string: a text's options resolved to numbers.
 * @internal
 */
export type TextLayoutParams = {
  /** The em's size in the text's unit (metres or CSS pixels); above 0. */
  size: number;
  /** The widest line, in the text's unit; `Infinity` for no wrapping. */
  maxWidth: number;
  /** Baseline to baseline, in em. */
  lineHeight: number;
  /** Between the glyphs of a line, in em. */
  letterSpacing: number;
  /** Each line's place in the box. */
  align: TextAlign;
  /** The box's point at the origin. */
  anchor: TextAnchor;
};

/** Told the first code point of each kind a font lacks, in decoding order (once per layout per
 * occurrence: the caller dedupes) */
export type TextMissingGlyphHandler = (font: FontData, codePoint: number) => void;

const LINE_FEED = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const TAB = 0x09;
const SPACE = 0x20;
const REPLACEMENT_CHARACTER = 0xfffd;
/** A line's width may pass `maxWidth` by this much (em) before it wraps: float noise, not ink */
const WRAP_EPSILON = 1e-4;

/** A hyphen a line may break after: `-`, the hyphen, the en dash */
const isBreakingHyphen = (codePoint: number) =>
  codePoint === 0x2d || codePoint === 0x2010 || codePoint === 0x2013;

/** C0 and C1 control characters and DEL; the line feed and tab are handled before */
const isSkippedControl = (codePoint: number) =>
  codePoint < SPACE || (codePoint >= 0x7f && codePoint <= 0x9f);

/** The box's point at the origin as fractions: x of the box's width, y of the rows */
const ANCHOR_COLUMNS: Record<TextAnchor, number> = {
  TOP_LEFT: 0,
  TOP_CENTER: 0.5,
  TOP_RIGHT: 1,
  MIDDLE_LEFT: 0,
  MIDDLE_CENTER: 0.5,
  MIDDLE_RIGHT: 1,
  BASELINE_LEFT: 0,
  BASELINE_CENTER: 0.5,
  BASELINE_RIGHT: 1,
  BOTTOM_LEFT: 0,
  BOTTOM_CENTER: 0.5,
  BOTTOM_RIGHT: 1,
};
type AnchorRow = 'TOP' | 'MIDDLE' | 'BASELINE' | 'BOTTOM';
const ANCHOR_ROWS: Record<TextAnchor, AnchorRow> = {
  TOP_LEFT: 'TOP',
  TOP_CENTER: 'TOP',
  TOP_RIGHT: 'TOP',
  MIDDLE_LEFT: 'MIDDLE',
  MIDDLE_CENTER: 'MIDDLE',
  MIDDLE_RIGHT: 'MIDDLE',
  BASELINE_LEFT: 'BASELINE',
  BASELINE_CENTER: 'BASELINE',
  BASELINE_RIGHT: 'BASELINE',
  BOTTOM_LEFT: 'BOTTOM',
  BOTTOM_CENTER: 'BOTTOM',
  BOTTOM_RIGHT: 'BOTTOM',
};
const ALIGN_FRACTIONS: Record<TextAlign, number> = { LEFT: 0, CENTER: 0.5, RIGHT: 1 };

/** A typed array at least `length` long: `array` itself, or a copy grown by doubling */
const grow = <T extends Float32Array | Int32Array | Uint32Array>(
  array: T,
  length: number,
  create: (length: number) => T
): T => {
  if (array.length >= length) return array;
  let next = Math.max(1, array.length);
  while (next < length) next *= 2;
  const grown = create(next);
  grown.set(array);
  return grown;
};

/**
 * A layout's output and its scratch, reused from layout to layout. The rects are the inked
 * glyphs' only (a space draws nothing), in the text's own space (x right, y up, the origin the
 * anchor point, the text's unit: `em × size`).
 * @internal
 */
export class TextLayoutBuffer {
  /** Four per glyph: the quad's `x, y, width, height` (its bottom-left corner first). */
  planeRects: Float32Array;
  /** Four per glyph: the atlas tile's `u, v, width, height`, `v` from the top. */
  atlasRects: Float32Array;
  /** Glyphs written (the rects' used length ÷ 4). */
  glyphCount = 0;
  /** Lines laid out: 1 for an empty string. */
  lineCount = 0;
  /** The box's left edge (the widest line's advances, not ink). */
  minX = 0;
  /** The box's bottom edge (the last line's descender). */
  minY = 0;
  /** The box's right edge. */
  maxX = 0;
  /** The box's top edge (the first line's ascender). */
  maxY = 0;

  /** The decoded code points (tab as a space; controls and CR dropped). */
  codePoints: Uint32Array;
  /** Each code point's glyph index (-1 for a line feed). */
  glyphs: Int32Array;
  /** Each line's first code point. */
  lineStarts = new Int32Array(4);
  /** Each line's end (exclusive), trailing spaces trimmed. */
  lineEnds = new Int32Array(4);
  /** Each line's width in em. */
  lineWidths = new Float32Array(4);

  /**
   * An empty buffer; it grows by doubling as a longer string needs.
   * @param capacity the code points (so glyphs) it has room for at first
   */
  constructor(capacity = 16) {
    const length = Math.max(1, capacity);
    this.planeRects = new Float32Array(length * TEXT_RECT_FLOATS);
    this.atlasRects = new Float32Array(length * TEXT_RECT_FLOATS);
    this.codePoints = new Uint32Array(length);
    this.glyphs = new Int32Array(length);
  }

  /** Room for `count` code points (and so glyphs). */
  reserveCodePoints(count: number) {
    this.codePoints = grow(this.codePoints, count, (n) => new Uint32Array(n));
    this.glyphs = grow(this.glyphs, count, (n) => new Int32Array(n));
    this.planeRects = grow(this.planeRects, count * TEXT_RECT_FLOATS, (n) => new Float32Array(n));
    this.atlasRects = grow(this.atlasRects, count * TEXT_RECT_FLOATS, (n) => new Float32Array(n));
  }

  /** Room for `count` lines. */
  reserveLines(count: number) {
    this.lineStarts = grow(this.lineStarts, count, (n) => new Int32Array(n));
    this.lineEnds = grow(this.lineEnds, count, (n) => new Int32Array(n));
    this.lineWidths = grow(this.lineWidths, count, (n) => new Float32Array(n));
  }
}

/** Decodes `text` into the buffer's code points and glyphs; returns their count */
const decode = (
  font: FontData,
  text: string,
  out: TextLayoutBuffer,
  onMissingGlyph: TextMissingGlyphHandler | undefined
) => {
  // A string's UTF-16 length bounds its code point count
  out.reserveCodePoints(text.length);
  const { codePoints, glyphs } = out;
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    let codePoint = text.charCodeAt(i);
    if (codePoint >= 0xd800 && codePoint <= 0xdbff && i + 1 < text.length) {
      const low = text.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        codePoint = (codePoint - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000;
        i++;
      }
    }
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) codePoint = REPLACEMENT_CHARACTER;
    if (codePoint === LINE_FEED) {
      codePoints[count] = LINE_FEED;
      glyphs[count++] = -1;
      continue;
    }
    if (codePoint === TAB) codePoint = SPACE;
    if (codePoint === CARRIAGE_RETURN || isSkippedControl(codePoint)) continue;
    let glyph = font.glyphIndices.get(codePoint);
    if (glyph === undefined) {
      glyph = font.fallbackIndex;
      onMissingGlyph?.(font, codePoint);
    }
    codePoints[count] = codePoint;
    glyphs[count++] = glyph;
  }
  return count;
};

/** The kerning between two glyphs in em */
const getKerning = (font: FontData, first: number, second: number) =>
  font.kerning.get(getFontKerningKey(font.codePoints[first], font.codePoints[second])) ?? 0;

/** Adds a line, its trailing spaces trimmed, and returns the line count */
const pushLine = (out: TextLayoutBuffer, lineCount: number, start: number, end: number) => {
  out.reserveLines(lineCount + 1);
  let trimmed = end;
  while (trimmed > start && out.codePoints[trimmed - 1] === SPACE) trimmed--;
  out.lineStarts[lineCount] = start;
  out.lineEnds[lineCount] = trimmed;
  return lineCount + 1;
};

/** Splits the code points into lines: at a line feed, and past `maxWidth` (em) at the last space,
 * after the last hyphen, or between glyphs in a word longer than the line */
const breakLines = (
  font: FontData,
  out: TextLayoutBuffer,
  count: number,
  maxWidth: number,
  letterSpacing: number
) => {
  const { codePoints, glyphs } = out;
  const { advances } = font;
  let lineCount = 0;
  let lineStart = 0;
  let penX = 0;
  let previous = -1;
  /** A glyph other than a space is on the line before the current one */
  let hasWord = false;
  /** The last break opportunity: the line's end there and the next line's start */
  let breakEnd = -1;
  let breakNext = -1;
  let i = 0;
  while (i < count) {
    const codePoint = codePoints[i];
    if (codePoint === LINE_FEED) {
      lineCount = pushLine(out, lineCount, lineStart, i);
      lineStart = i + 1;
      penX = 0;
      previous = -1;
      hasWord = false;
      breakEnd = -1;
      i++;
      continue;
    }
    const glyph = glyphs[i];
    const isSpace = codePoint === SPACE;
    let x = penX;
    if (previous >= 0) x += getKerning(font, previous, glyph) + letterSpacing;
    const right = x + advances[glyph];
    if (!isSpace && hasWord && right > maxWidth + WRAP_EPSILON) {
      if (breakEnd > lineStart) {
        lineCount = pushLine(out, lineCount, lineStart, breakEnd);
        lineStart = breakNext;
      } else {
        lineCount = pushLine(out, lineCount, lineStart, i);
        lineStart = i;
      }
      // A wrapped line starts at its first word
      while (lineStart < count && codePoints[lineStart] === SPACE) lineStart++;
      penX = 0;
      previous = -1;
      hasWord = false;
      breakEnd = -1;
      i = lineStart;
      continue;
    }
    if (isSpace) {
      if (hasWord) {
        breakEnd = i;
        breakNext = i + 1;
      }
    } else {
      // After a hyphen that ends a word, not a leading minus
      if (hasWord && isBreakingHyphen(codePoint) && codePoints[i - 1] !== SPACE) {
        breakEnd = i + 1;
        breakNext = i + 1;
      }
      hasWord = true;
    }
    penX = right;
    previous = glyph;
    i++;
  }
  return pushLine(out, lineCount, lineStart, count);
};

/** A line's width in em: its advances, kerning and letter spacing */
const measureLine = (
  font: FontData,
  out: TextLayoutBuffer,
  start: number,
  end: number,
  letterSpacing: number
) => {
  const { glyphs } = out;
  let penX = 0;
  for (let i = start; i < end; i++) {
    if (i > start) penX += getKerning(font, glyphs[i - 1], glyphs[i]) + letterSpacing;
    penX += font.advances[glyphs[i]];
  }
  return penX;
};

/**
 * Lays a string out in a font: each inked glyph's quad and atlas tile into `out`, the lines'
 * box with it. Code points the font lacks draw its fallback glyph (`onMissingGlyph` is told).
 * Allocates nothing once `out` has room.
 * @internal
 * @param font the loaded font
 * @param text the string: `\n` breaks a line, a tab is a space, `\r` and other control
 *   characters are dropped
 * @param params the text's size, wrapping, spacing, alignment and anchor
 * @param out the buffer written (its previous contents replaced)
 * @param onMissingGlyph told each code point the font lacks
 * @returns the glyphs written (`out.glyphCount`)
 */
export const layoutText = (
  font: FontData,
  text: string,
  params: TextLayoutParams,
  out: TextLayoutBuffer,
  onMissingGlyph?: TextMissingGlyphHandler
) => {
  const { size, letterSpacing, lineHeight } = params;
  // A negative or NaN width wraps nothing; 0 puts each word's glyphs on lines of their own
  const maxWidth = params.maxWidth / size >= 0 ? params.maxWidth / size : Infinity;
  const count = decode(font, text, out, onMissingGlyph);
  const lineCount = breakLines(font, out, count, maxWidth, letterSpacing);

  let boxWidth = 0;
  for (let line = 0; line < lineCount; line++) {
    const width = measureLine(font, out, out.lineStarts[line], out.lineEnds[line], letterSpacing);
    out.lineWidths[line] = width;
    if (width > boxWidth) boxWidth = width;
  }

  const { ascender, descender } = font.metrics;
  const boxHeight = ascender - descender + (lineCount - 1) * lineHeight;
  const anchorX = ANCHOR_COLUMNS[params.anchor] * boxWidth;
  const row = ANCHOR_ROWS[params.anchor];
  const anchorY =
    row === 'TOP'
      ? 0
      : row === 'MIDDLE'
        ? -boxHeight / 2
        : row === 'BASELINE'
          ? -ascender
          : -boxHeight;
  const alignFraction = ALIGN_FRACTIONS[params.align];

  const { glyphs, planeRects, atlasRects } = out;
  const fontPlanes = font.planeRects;
  const fontTiles = font.atlasRects;
  let written = 0;
  for (let line = 0; line < lineCount; line++) {
    const start = out.lineStarts[line];
    const end = out.lineEnds[line];
    const baseline = -ascender - line * lineHeight - anchorY;
    let penX = (boxWidth - out.lineWidths[line]) * alignFraction - anchorX;
    for (let i = start; i < end; i++) {
      const glyph = glyphs[i];
      if (i > start) penX += getKerning(font, glyphs[i - 1], glyph) + letterSpacing;
      const source = glyph * TEXT_RECT_FLOATS;
      const width = fontPlanes[source + 2];
      if (width > 0) {
        const target = written * TEXT_RECT_FLOATS;
        planeRects[target] = (penX + fontPlanes[source]) * size;
        planeRects[target + 1] = (baseline + fontPlanes[source + 1]) * size;
        planeRects[target + 2] = width * size;
        planeRects[target + 3] = fontPlanes[source + 3] * size;
        atlasRects[target] = fontTiles[source];
        atlasRects[target + 1] = fontTiles[source + 1];
        atlasRects[target + 2] = fontTiles[source + 2];
        atlasRects[target + 3] = fontTiles[source + 3];
        written++;
      }
      penX += font.advances[glyph];
    }
  }

  out.glyphCount = written;
  out.lineCount = lineCount;
  // 0 − x, not −x: no −0 in the box (a box at the origin compares equal to zeros)
  out.minX = (0 - anchorX) * size;
  out.maxX = (boxWidth - anchorX) * size;
  out.maxY = (0 - anchorY) * size;
  out.minY = (-boxHeight - anchorY) * size;
  return written;
};
