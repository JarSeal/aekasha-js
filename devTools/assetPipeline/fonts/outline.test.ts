import { describe, expect, it } from 'vitest';
import {
  flattenOutline,
  getContourWinding,
  getSignedArea,
  hasOverlappingContours,
  type OutlineCommand,
} from './outline';

// p391 Phase 2 section 3: the true SDF's outline (D1): curves flattened within the tolerance, and
// the overlap check

/** A square path in font units, counter-clockwise unless `clockwise` */
const square = (x: number, y: number, size: number, clockwise = false): OutlineCommand[] => {
  const corners = [
    [x, y],
    [x + size, y],
    [x + size, y + size],
    [x, y + size],
  ];
  if (clockwise) corners.reverse();
  return [
    { command: 'moveTo', args: corners[0] },
    ...corners.slice(1).map((args) => ({ command: 'lineTo' as const, args })),
    { command: 'closePath', args: [] },
  ];
};

describe('flattenOutline', () => {
  it('scales to em, drops the closing point and splits each contour at moveTo', () => {
    const contours = flattenOutline([...square(0, 0, 500), ...square(600, 0, 100)], 1000, 0.001);
    const expected = [
      [0, 0, 0.5, 0, 0.5, 0.5, 0, 0.5],
      [0.6, 0, 0.7, 0, 0.7, 0.1, 0.6, 0.1],
    ];
    expect(contours.map((contour) => contour.length)).toEqual([8, 8]);
    contours.forEach((contour, c) =>
      contour.forEach((value, i) => expect(value).toBeCloseTo(expected[c][i], 12))
    );
  });

  it('keeps a quadratic and a cubic curve within the tolerance of their chords', () => {
    const tolerance = 0.0005;
    for (const curve of [
      { command: 'quadraticCurveTo' as const, args: [500, 1000, 1000, 0] },
      { command: 'bezierCurveTo' as const, args: [0, 1000, 1000, 1000, 1000, 0] },
    ]) {
      const [contour] = flattenOutline(
        [{ command: 'moveTo', args: [0, 0] }, curve],
        1000,
        tolerance
      );
      const at = (t: number) => {
        const u = 1 - t;
        const a = curve.args.map((value) => value / 1000);
        return a.length === 4
          ? [2 * u * t * a[0] + t * t * a[2], 2 * u * t * a[1] + t * t * a[3]]
          : [
              3 * u * u * t * a[0] + 3 * u * t * t * a[2] + t * t * t * a[4],
              3 * u * u * t * a[1] + 3 * u * t * t * a[3] + t * t * t * a[5],
            ];
      };
      // Every point of the curve is near a segment of the polygon
      let worst = 0;
      for (let i = 0; i <= 1000; i++) {
        const [px, py] = at(i / 1000);
        let nearest = Infinity;
        for (let j = 0; j < contour.length; j += 2) {
          const k = (j + 2) % contour.length;
          const [ax, ay, bx, by] = [contour[j], contour[j + 1], contour[k], contour[k + 1]];
          const lengthSq = (bx - ax) ** 2 + (by - ay) ** 2;
          const t = Math.max(
            0,
            Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / lengthSq)
          );
          nearest = Math.min(nearest, Math.hypot(px - ax - t * (bx - ax), py - ay - t * (by - ay)));
        }
        worst = Math.max(worst, nearest);
      }
      expect(worst).toBeLessThanOrEqual(tolerance);
      expect(contour.length / 2).toBeGreaterThan(10);
    }
  });
});

describe('winding and area', () => {
  it('count a counter-clockwise contour +1, a clockwise one −1', () => {
    const [ccw] = flattenOutline(square(0, 0, 1000), 1000, 0.001);
    const [cw] = flattenOutline(square(0, 0, 1000, true), 1000, 0.001);
    expect(getSignedArea(ccw)).toBeCloseTo(1);
    expect(getSignedArea(cw)).toBeCloseTo(-1);
    expect(getContourWinding(ccw, 0.5, 0.5)).toBe(1);
    expect(getContourWinding(cw, 0.5, 0.5)).toBe(-1);
    expect(getContourWinding(ccw, 1.5, 0.5)).toBe(0);
  });
});

describe('hasOverlappingContours', () => {
  const contoursOf = (...paths: OutlineCommand[][]) => flattenOutline(paths.flat(), 1000, 0.001);

  it('finds two contours of one direction that overlap', () => {
    expect(hasOverlappingContours(contoursOf(square(0, 0, 600), square(400, 400, 600)))).toBe(true);
    // One inside the other, of one direction: its whole edge is inside the fill
    expect(hasOverlappingContours(contoursOf(square(0, 0, 1000), square(300, 300, 300)))).toBe(
      true
    );
  });

  it('passes a hole (a contour of the other direction inside) and contours apart', () => {
    expect(
      hasOverlappingContours(contoursOf(square(0, 0, 1000), square(300, 300, 300, true)))
    ).toBe(false);
    expect(hasOverlappingContours(contoursOf(square(0, 0, 400), square(600, 0, 400)))).toBe(false);
    expect(hasOverlappingContours(contoursOf(square(0, 0, 400)))).toBe(false);
  });
});
