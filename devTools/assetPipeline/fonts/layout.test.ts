import { describe, expect, it } from 'vitest';
import { buildFontLayout, FONT_LAYOUT_FORMAT, roundEm } from './layout';

// p391 Phase 2 section 3: the layout JSON's shape and rounding (D3)

const layoutOf = (kerning: Parameters<typeof buildFontLayout>[0]['kerning']) =>
  buildFontLayout({
    type: 'MTSDF',
    atlas: { file: 'a.atlas.12345678.ktx2', width: 256, height: 128, size: 48, pxRange: 8 },
    metrics: {
      ascender: 1.025,
      descender: -0.275,
      lineHeight: 1.3,
      underlineY: -0.12149999,
      underlineThickness: 0.077,
    },
    fallback: 63,
    glyphs: [
      {
        codePoint: 65,
        advance: 0.662,
        tile: { plane: [-0.06133333, -0.0833333, 0.72333331, 0.78133333], atlas: [10, 20, 38, 42] },
      },
      { codePoint: 32, advance: 0.23600000000000002 },
    ],
    kerning,
  });

describe('roundEm', () => {
  it('rounds to 4 decimals and never writes -0', () => {
    expect(roundEm(0.123456)).toBe(0.1235);
    expect(roundEm(-0.00004)).toBe(0);
    expect(Object.is(roundEm(-0.00004), -0)).toBe(false);
  });
});

describe('buildFontLayout', () => {
  it('writes the glyphs by code point: [advance] without ink, else the plane and atlas rects', () => {
    expect(layoutOf(null)).toEqual({
      format: FONT_LAYOUT_FORMAT,
      type: 'MTSDF',
      atlas: { file: 'a.atlas.12345678.ktx2', width: 256, height: 128, size: 48, pxRange: 8 },
      metrics: {
        ascender: 1.025,
        descender: -0.275,
        lineHeight: 1.3,
        underlineY: -0.1215,
        underlineThickness: 0.077,
      },
      fallback: 63,
      glyphs: {
        32: [0.236],
        65: [0.662, -0.0613, -0.0833, 0.7233, 0.7813, 10, 20, 38, 42],
      },
    });
    expect(Object.keys(layoutOf(null).glyphs)).toEqual(['32', '65']);
  });

  it('groups the kerning by the first code point in font units, both levels ascending', () => {
    const layout = layoutOf({
      unitsPerEm: 1000,
      pairs: new Map([
        [86, [[65, -40]]],
        [
          65,
          [
            [87, -40],
            [86, -47],
          ],
        ],
      ]),
    });
    expect(layout.kerningUnitsPerEm).toBe(1000);
    expect(layout.kerning).toEqual({ 65: [86, -47, 87, -40], 86: [65, -40] });
    expect(Object.keys(layout.kerning ?? {})).toEqual(['65', '86']);
  });

  it('leaves the kerning out when there is none', () => {
    const layout = layoutOf({ unitsPerEm: 1000, pairs: new Map() });
    expect('kerning' in layout || 'kerningUnitsPerEm' in layout).toBe(false);
  });
});
