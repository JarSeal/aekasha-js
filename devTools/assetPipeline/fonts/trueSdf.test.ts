import { describe, expect, it } from 'vitest';
import { flattenOutline, type OutlineCommand } from './outline';
import { generateTrueSdf } from './trueSdf';

// p391 Phase 2 section 3: the true SDF on a shape whose distances are known (D1's mapping:
// `distance / range + 0.5`, the byte `clamp(256 x)`, inside positive, rows top first). The glyphs
// against their outline are encodeFont.test.ts'.

/** A unit square (em), counter-clockwise or clockwise: the field mustn't care */
const squareOf = (clockwise: boolean): OutlineCommand[] => {
  const corners = [
    [0, 0],
    [1000, 0],
    [1000, 1000],
    [0, 1000],
  ];
  if (clockwise) corners.reverse();
  return [
    { command: 'moveTo', args: corners[0] },
    ...corners.slice(1).map((args) => ({ command: 'lineTo' as const, args })),
    { command: 'closePath', args: [] },
  ];
};

/** The byte msdfgen-wasm writes for a value (a Uint8ClampedArray's rounding) */
const toByte = (value: number) => Uint8ClampedArray.of(value * 256)[0];

describe('generateTrueSdf', () => {
  // 10 px per em, the square at (1, 1) px of a 12 × 12 tile, a range of 4 px (0.4 em)
  const projection = { scale: 10, xTranslate: 0.1, yTranslate: 0.1, range: 0.4 };

  for (const clockwise of [false, true]) {
    it(`maps the signed distance as msdfgen does (${clockwise ? 'clockwise' : 'counter-clockwise'})`, () => {
      const contours = flattenOutline(squareOf(clockwise), 1000, 1e-6);
      const field = generateTrueSdf(contours, projection, 12, 12);
      const at = (x: number, rowFromTop: number) => field[rowFromTop * 12 + x];
      // Pixel (x, row) samples em ((x + 0.5) / 10 − 0.1, (12 − row − 0.5) / 10 − 0.1)
      // The centre (x 5, row 6: em 0.45, 0.45): 0.45 em inside
      expect(at(5, 6)).toBe(toByte(0.45 / 0.4 + 0.5));
      // Just inside the left edge (x 1: em 0.05), mid-height: 0.05 em in
      expect(at(1, 6)).toBe(toByte(0.05 / 0.4 + 0.5));
      // Just outside it (x 0: em −0.05): 0.05 em out
      expect(at(0, 6)).toBe(toByte(-0.05 / 0.4 + 0.5));
      // Outside a corner (x 0, row 11: em (−0.05, −0.05)): to the corner, diagonally
      expect(at(0, 11)).toBe(toByte(-Math.hypot(0.05, 0.05) / 0.4 + 0.5));
      // The bottom row is the shape's bottom (y up): row 10 is em y 0.05, inside
      expect(at(5, 10)).toBe(toByte(0.05 / 0.4 + 0.5));
    });
  }

  it('clamps far distances to 0 and 255', () => {
    const contours = flattenOutline(squareOf(false), 1000, 1e-6);
    const far = { scale: 10, xTranslate: 3, yTranslate: 0.1, range: 0.2 };
    const field = generateTrueSdf(contours, far, 2, 12);
    expect(field[6 * 2]).toBe(0);
    const inside = generateTrueSdf(contours, { ...projection, range: 0.1 }, 12, 12);
    expect(inside[6 * 12 + 5]).toBe(255);
  });
});
