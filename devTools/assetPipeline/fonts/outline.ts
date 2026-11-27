/**
 * A glyph's outline as polygons (p391 D1's true SDF): fontkit's path commands in em units (y up),
 * each curve flattened within a tolerance, and the overlap check the true SDF needs (Phase 2: a
 * contour edge inside another contour's fill is no edge of the glyph).
 */

/** A path command as fontkit gives it (font units) */
export type OutlineCommand = {
  command: 'moveTo' | 'lineTo' | 'quadraticCurveTo' | 'bezierCurveTo' | 'closePath';
  args: number[];
};

/** A closed polygon: x0, y0, x1, y1, … (em units, y up), its last point joined to its first */
export type Contour = Float64Array;

/** Line segments per quadratic curve for a chord error within `tolerance`: |P0 − 2P1 + P2| / (4n²) */
const getQuadraticSteps = (d: number, tolerance: number) =>
  Math.max(1, Math.ceil(Math.sqrt(d / (4 * tolerance))));

/** Line segments per cubic curve for a chord error within `tolerance`: 3·max|ΔΔP| / (4n²) */
const getCubicSteps = (d: number, tolerance: number) =>
  Math.max(1, Math.ceil(Math.sqrt((3 * d) / (4 * tolerance))));

/**
 * A glyph's outline as closed polygons, in em units: font units over `unitsPerEm`, curves split
 * into segments whose chord strays at most `tolerance` em from the curve. A repeated point is
 * dropped, and a contour of fewer than three points.
 */
export const flattenOutline = (
  commands: readonly OutlineCommand[],
  unitsPerEm: number,
  tolerance: number
): Contour[] => {
  const contours: Contour[] = [];
  let points: number[] = [];
  let x = 0;
  let y = 0;
  const s = 1 / unitsPerEm;
  const push = (px: number, py: number) => {
    const n = points.length;
    if (n && points[n - 2] === px && points[n - 1] === py) return;
    points.push(px, py);
  };
  const close = () => {
    const n = points.length;
    if (n >= 4 && points[0] === points[n - 2] && points[1] === points[n - 1]) points.length -= 2;
    if (points.length >= 6) contours.push(Float64Array.from(points));
    points = [];
  };
  for (const { command, args } of commands) {
    const a = args.map((value) => value * s);
    if (command === 'moveTo') {
      close();
      [x, y] = a;
      push(x, y);
    } else if (command === 'lineTo') {
      [x, y] = a;
      push(x, y);
    } else if (command === 'quadraticCurveTo') {
      const [cx, cy, ex, ey] = a;
      const steps = getQuadraticSteps(Math.hypot(x - 2 * cx + ex, y - 2 * cy + ey), tolerance);
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const u = 1 - t;
        push(u * u * x + 2 * u * t * cx + t * t * ex, u * u * y + 2 * u * t * cy + t * t * ey);
      }
      [x, y] = [ex, ey];
    } else if (command === 'bezierCurveTo') {
      const [c1x, c1y, c2x, c2y, ex, ey] = a;
      const d = Math.max(
        Math.hypot(x - 2 * c1x + c2x, y - 2 * c1y + c2y),
        Math.hypot(c1x - 2 * c2x + ex, c1y - 2 * c2y + ey)
      );
      const steps = getCubicSteps(d, tolerance);
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const u = 1 - t;
        const b0 = u * u * u;
        const b1 = 3 * u * u * t;
        const b2 = 3 * u * t * t;
        const b3 = t * t * t;
        push(b0 * x + b1 * c1x + b2 * c2x + b3 * ex, b0 * y + b1 * c1y + b2 * c2y + b3 * ey);
      }
      [x, y] = [ex, ey];
    } else {
      close();
    }
  }
  close();
  return contours;
};

/** A contour's signed area: positive counter-clockwise (y up) */
export const getSignedArea = (contour: Contour) => {
  let area = 0;
  const n = contour.length;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n;
    area += contour[i] * contour[j + 1] - contour[j] * contour[i + 1];
  }
  return area / 2;
};

/** A contour's winding number around a point (counter-clockwise +1) */
export const getContourWinding = (contour: Contour, px: number, py: number) => {
  let winding = 0;
  const n = contour.length;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n;
    const ax = contour[i];
    const ay = contour[i + 1];
    const bx = contour[j];
    const by = contour[j + 1];
    const side = (bx - ax) * (py - ay) - (px - ax) * (by - ay);
    if (ay <= py) {
      if (by > py && side > 0) winding++;
    } else if (by <= py && side < 0) {
      winding--;
    }
  }
  return winding;
};

/** Points per contour the overlap check tests, evenly along its length */
const OVERLAP_SAMPLES = 128;

/**
 * Whether an edge of one contour runs inside another contour's fill (non-zero winding): a glyph
 * whose contours overlap (a static font cut from a variable one without removing its overlaps).
 * The fill is right either way; the true SDF isn't, inside near such an edge. A point of a contour
 * is on the glyph's edge when exactly one of its sides is outside: the other contours' winding
 * there is `w`, and its own contour adds its direction on its inner side. The points are spread
 * evenly along each contour (not its segments' midpoints: a long straight edge has one, which may
 * lie outside the part that overlaps).
 */
export const hasOverlappingContours = (contours: readonly Contour[]) => {
  if (contours.length < 2) return false;
  const isOnEdge = (c: number, direction: number, x: number, y: number) => {
    let others = 0;
    for (let o = 0; o < contours.length; o++) {
      if (o !== c) others += getContourWinding(contours[o], x, y);
    }
    return others === 0 || others + direction === 0;
  };
  for (let c = 0; c < contours.length; c++) {
    const contour = contours[c];
    const direction = Math.sign(getSignedArea(contour));
    if (!direction) continue;
    const n = contour.length;
    let perimeter = 0;
    for (let i = 0; i < n; i += 2) {
      const j = (i + 2) % n;
      perimeter += Math.hypot(contour[j] - contour[i], contour[j + 1] - contour[i + 1]);
    }
    const step = perimeter / OVERLAP_SAMPLES;
    // The next sample's distance along the contour: half a step in, so none lands on a vertex
    let next = step / 2;
    let walked = 0;
    for (let i = 0; i < n; i += 2) {
      const j = (i + 2) % n;
      const length = Math.hypot(contour[j] - contour[i], contour[j + 1] - contour[i + 1]);
      while (next < walked + length) {
        const t = (next - walked) / length;
        const x = contour[i] + t * (contour[j] - contour[i]);
        const y = contour[i + 1] + t * (contour[j + 1] - contour[i + 1]);
        if (!isOnEdge(c, direction, x, y)) return true;
        next += step;
      }
      walked += length;
    }
  }
  return false;
};
