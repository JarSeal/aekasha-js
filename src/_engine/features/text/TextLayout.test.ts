import { describe, expect, test, vi } from 'vitest';
import type * as THREE from 'three/webgpu';
import { getFontKerningKey, type FontData } from './Fonts';
import { layoutText, TextLayoutBuffer, type TextLayoutParams } from './TextLayout';

const ASCENDER = 0.8;
const DESCENDER = -0.2;
const LINE_HEIGHT = 1.2;

/**
 * A font with round numbers: every inked glyph advances 0.5 em, its quad `0, -0.1, 0.5, 1` from
 * the pen; a space advances 0.25; `AV` kerns −0.1. Its tiles' `u` is the glyph index ÷ 10.
 */
const createTestFont = (): FontData => {
  const codePoints = [0x20, 0x2d, 0x3f, 0x41, 0x42, 0x43, 0x44, 0x45, 0x56, 0x1f600];
  const count = codePoints.length;
  const advances = new Float32Array(count);
  const planeRects = new Float32Array(count * 4);
  const atlasRects = new Float32Array(count * 4);
  codePoints.forEach((codePoint, i) => {
    if (codePoint === 0x20) {
      advances[i] = 0.25;
      return;
    }
    advances[i] = 0.5;
    planeRects.set([0, -0.1, 0.5, 1], i * 4);
    atlasRects.set([i / 10, 0.5, 0.05, 0.1], i * 4);
  });
  return {
    id: 'test',
    type: 'MTSDF',
    atlas: {} as THREE.Texture,
    atlasWidth: 256,
    atlasHeight: 256,
    size: 48,
    pxRange: 8,
    metrics: {
      ascender: ASCENDER,
      descender: DESCENDER,
      lineHeight: LINE_HEIGHT,
      underlineY: -0.1,
      underlineThickness: 0.05,
    },
    glyphCount: count,
    codePoints: new Uint32Array(codePoints),
    advances,
    planeRects,
    atlasRects,
    glyphIndices: new Map(codePoints.map((codePoint, i) => [codePoint, i])),
    fallbackIndex: codePoints.indexOf(0x3f),
    kerning: new Map([[getFontKerningKey(0x41, 0x56), -0.1]]),
  };
};

const font = createTestFont();

const createParams = (overrides: Partial<TextLayoutParams> = {}): TextLayoutParams => ({
  size: 1,
  maxWidth: Infinity,
  lineHeight: LINE_HEIGHT,
  letterSpacing: 0,
  align: 'LEFT',
  anchor: 'TOP_LEFT',
  ...overrides,
});

/** Lays `text` out and returns each glyph's quad `[x, y, w, h]` and tile `u`, and the box */
const layout = (text: string, params: Partial<TextLayoutParams> = {}, out?: TextLayoutBuffer) => {
  const buffer = out ?? new TextLayoutBuffer();
  const count = layoutText(font, text, createParams(params), buffer);
  const quads: number[][] = [];
  const tiles: number[] = [];
  for (let i = 0; i < count; i++) {
    quads.push(Array.from(buffer.planeRects.subarray(i * 4, i * 4 + 4)));
    tiles.push(buffer.atlasRects[i * 4]);
  }
  const box = [buffer.minX, buffer.minY, buffer.maxX, buffer.maxY];
  return { count, quads, tiles, box, lineCount: buffer.lineCount, buffer };
};

/** Each glyph's quad x */
const xs = (quads: number[][]) => quads.map((quad) => quad[0]);
/** Each glyph's quad y */
const ys = (quads: number[][]) => quads.map((quad) => quad[1]);

const expectClose = (actual: number[], expected: number[]) => {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i], 5));
};

/** The tile `u` of the test font's glyph for a code point */
const tileOf = (char: string) => font.glyphIndices.get(char.codePointAt(0)!)! / 10;

/** The first baseline's quad y at TOP_LEFT: the quad's bottom is 0.1 below the baseline */
const LINE_0_Y = -ASCENDER - 0.1;

describe('layoutText', () => {
  test('one line: the pen advances, the quads scale with size, a tile per glyph', () => {
    const { quads, tiles, box, lineCount } = layout('ABC', { size: 2 });
    expect(lineCount).toBe(1);
    expectClose(xs(quads), [0, 1, 2]);
    expectClose(ys(quads), [LINE_0_Y * 2, LINE_0_Y * 2, LINE_0_Y * 2]);
    expectClose(quads[0], [0, LINE_0_Y * 2, 1, 2]);
    expectClose(tiles, [tileOf('A'), tileOf('B'), tileOf('C')]);
    expectClose(box, [0, (DESCENDER - ASCENDER) * 2, 3, 0]);
  });

  test('a space advances without a quad', () => {
    const { count, quads } = layout('A B');
    expect(count).toBe(2);
    expectClose(xs(quads), [0, 0.75]);
  });

  test('kerning pairs and letter spacing move the pen', () => {
    expectClose(xs(layout('AV').quads), [0, 0.4]);
    expectClose(xs(layout('VA').quads), [0, 0.5]);
    expectClose(xs(layout('AVA', { letterSpacing: 0.05 }).quads), [0, 0.45, 1]);
    // Spacing goes between glyphs, not after the last: the box ends at the last advance
    expect(layout('AB', { letterSpacing: 0.1 }).box[2]).toBeCloseTo(1.1, 5);
  });

  test('a line feed starts a line one line height down', () => {
    const { quads, lineCount } = layout('AB\nC');
    expect(lineCount).toBe(2);
    expectClose(xs(quads), [0, 0.5, 0]);
    expectClose(ys(quads), [LINE_0_Y, LINE_0_Y, LINE_0_Y - LINE_HEIGHT]);
  });

  test('wraps at the last space past maxWidth, dropping the spaces at the break', () => {
    const { quads, lineCount } = layout('AB  CD E', { maxWidth: 1.8 });
    expect(lineCount).toBe(2);
    expectClose(xs(quads), [0, 0.5, 0, 0.5, 1.25]);
    expectClose(ys(quads).slice(1, 3), [LINE_0_Y, LINE_0_Y - LINE_HEIGHT]);
  });

  test('maxWidth is in the text unit: em × size', () => {
    expect(layout('AB CD', { size: 2, maxWidth: 2.2 }).lineCount).toBe(2);
    expect(layout('AB CD', { size: 2, maxWidth: 4.5 }).lineCount).toBe(1);
  });

  test('wraps after a hyphen that ends a word, keeping it on the first line', () => {
    const { quads, lineCount } = layout('AB-CD', { maxWidth: 1.6 });
    expect(lineCount).toBe(2);
    expectClose(xs(quads), [0, 0.5, 1, 0, 0.5]);
    expectClose(ys(quads).slice(2, 4), [LINE_0_Y, LINE_0_Y - LINE_HEIGHT]);
  });

  test('a word longer than the line breaks between glyphs, a glyph a line at least', () => {
    expect(layout('ABCDE', { maxWidth: 1.1 }).lineCount).toBe(3);
    expect(layout('ABC', { maxWidth: 0 }).lineCount).toBe(3);
    // A leading minus is no break: the word breaks by glyph
    const { quads } = layout('-ABC', { maxWidth: 1.1 });
    expectClose(xs(quads), [0, 0.5, 0, 0.5]);
  });

  test('aligns each line in the box of the widest', () => {
    expectClose(xs(layout('ABC\nA', { align: 'CENTER' }).quads), [0, 0.5, 1, 0.5]);
    expectClose(xs(layout('ABC\nA', { align: 'RIGHT' }).quads), [0, 0.5, 1, 1]);
    // Trailing spaces aren't the line's width
    expectClose(xs(layout('ABC\nA  ', { align: 'RIGHT' }).quads), [0, 0.5, 1, 1]);
  });

  test('the anchor is the box point at the origin', () => {
    const height = ASCENDER - DESCENDER + LINE_HEIGHT;
    const middle = layout('AB\nAB', { anchor: 'MIDDLE_CENTER' });
    expectClose(middle.box, [-0.5, -height / 2, 0.5, height / 2]);
    expect(middle.quads[0][0]).toBeCloseTo(-0.5, 5);
    expect(middle.quads[0][1]).toBeCloseTo(height / 2 + LINE_0_Y, 5);

    const baseline = layout('AB', { anchor: 'BASELINE_LEFT', size: 2 });
    expectClose(baseline.box, [0, DESCENDER * 2, 2, ASCENDER * 2]);
    expect(baseline.quads[0][1]).toBeCloseTo(-0.2, 5);

    const bottomRight = layout('AB\nAB', { anchor: 'BOTTOM_RIGHT' });
    expectClose(bottomRight.box, [-1, 0, 0, height]);
    expect(bottomRight.quads[3][0]).toBeCloseTo(-0.5, 5);
  });

  test('joins a surrogate pair into one code point; a missing one draws the fallback', () => {
    const onMissingGlyph = vi.fn();
    const buffer = new TextLayoutBuffer();
    const count = layoutText(font, 'A😀😁', createParams(), buffer, onMissingGlyph);
    expect(count).toBe(3);
    expectClose(xs([0, 1, 2].map((i) => [buffer.planeRects[i * 4]])), [0, 0.5, 1]);
    expect(buffer.atlasRects[4]).toBeCloseTo(font.glyphIndices.get(0x1f600)! / 10, 5);
    expect(buffer.atlasRects[8]).toBeCloseTo(tileOf('?'), 5);
    expect(onMissingGlyph).toHaveBeenCalledTimes(1);
    expect(onMissingGlyph).toHaveBeenCalledWith(font, 0x1f601);

    // A lone surrogate is U+FFFD, which the font lacks too
    onMissingGlyph.mockClear();
    layoutText(font, '\ud83dA', createParams(), buffer, onMissingGlyph);
    expect(onMissingGlyph).toHaveBeenCalledWith(font, 0xfffd);
  });

  test('an empty string: no glyph, one line, the box a line high', () => {
    const { count, lineCount, box } = layout('');
    expect(count).toBe(0);
    expect(lineCount).toBe(1);
    expectClose(box, [0, DESCENDER - ASCENDER, 0, 0]);
  });

  test('two line feeds: three empty lines', () => {
    const { count, lineCount, box } = layout('\n\n');
    expect(count).toBe(0);
    expect(lineCount).toBe(3);
    expectClose(box, [0, DESCENDER - ASCENDER - 2 * LINE_HEIGHT, 0, 0]);
  });

  test('a tab is a space; a carriage return and other control characters are dropped', () => {
    expectClose(xs(layout('A\tB').quads), [0, 0.75]);
    const crlf = layout('A\r\nB\u0007C');
    expect(crlf.lineCount).toBe(2);
    expectClose(xs(crlf.quads), [0, 0, 0.5]);
  });

  test('a reused buffer keeps its arrays and replaces its contents', () => {
    const buffer = new TextLayoutBuffer();
    layout('ABCDE ABCDE ABCDE ABCDE', {}, buffer);
    const { planeRects, codePoints } = buffer;
    const second = layout('AB', {}, buffer);
    expect(second.count).toBe(2);
    expect(buffer.planeRects).toBe(planeRects);
    expect(buffer.codePoints).toBe(codePoints);
    expectClose(second.box, [0, DESCENDER - ASCENDER, 1, 0]);
  });
});
