// The curve editor's geometry (CurveEditor.ts), out of its module for its size: the keys' value
// kind, their order along x with each key's neighbours and acting tangents, and the plot's SVG
// paths and tangent handles' places in its 0-100 box (y down). No DOM.
import type { BindingValueKind } from '../binding/Binding';
import type { NumberRules } from '../binding/ValueText';
import { getSegmentTangents, type CurveBezier, type CurveKey } from './Curve';

/**
 * Keys compared key by key; copied into the array and the keys that are there (in place, a
 * missing tangent deleted).
 * @internal
 */
export const CURVE_KEYS_KIND: BindingValueKind<CurveKey[]> = {
  equals: (a, b) => {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      const x = a[i];
      const y = b[i];
      if (
        x.x !== y.x ||
        x.y !== y.y ||
        x.inTangent !== y.inTangent ||
        x.outTangent !== y.outTangent
      ) {
        return false;
      }
    }
    return true;
  },
  copy: (from, into) => {
    const out = into ?? [];
    for (let i = 0; i < from.length; i++) {
      const key = from[i];
      const kept = out[i] ?? (out[i] = { x: 0, y: 0 });
      kept.x = key.x;
      kept.y = key.y;
      if (key.inTangent === undefined) delete kept.inTangent;
      else kept.inTangent = key.inTangent;
      if (key.outTangent === undefined) delete kept.outTangent;
      else kept.outTangent = key.outTangent;
    }
    out.length = from.length;
    return out;
  },
};

/** A tangent's handle: this far from its key, as a share of the plot */
const TANGENT_REACH = 0.15;

const clamp01 = (value: number) => (value > 0 ? (value < 1 ? value : 1) : 0);
/** A view coordinate to a thousandth (an SVG's numbers, a percent) */
const round3 = (value: number) => Math.round(value * 1000) / 1000;

/**
 * A tangent handle's place, in percent of the plot.
 * @internal
 */
export type TangentPlace = { left: number; top: number };

/**
 * The plot's geometry for an x and a y range (each `min` and `max` set): the shares a value is
 * at, the keys' order along x (kept, sorted in place by `sortKeys`; what the neighbours, the
 * tangents and the keys' path read), the curve's and the arms' paths, and a tangent handle's place.
 * @internal
 */
export const createCurvePlot = (xRules: NumberRules, yRules: NumberRules) => {
  const xMin = xRules.min!;
  const xSize = xRules.max! - xMin;
  const yMin = yRules.min!;
  const ySize = yRules.max! - yMin;
  /** Where on the plot, as shares from the left and the bottom (not clamped) */
  const toFx = (x: number) => (xSize > 0 ? (x - xMin) / xSize : 0);
  const toFy = (y: number) => (ySize > 0 ? (y - yMin) / ySize : 0);
  const vx = (x: number) => round3(toFx(x) * 100);
  const vy = (y: number) => round3((1 - toFy(y)) * 100);

  /** The keys in x order (their indices), a tie in array order */
  const order: number[] = [];
  let sorted: readonly CurveKey[] = [];
  const byX = (a: number, b: number) => sorted[a].x - sorted[b].x || a - b;
  const neighbours: [before: number, after: number] = [-1, -1];
  const segment: [number, number] = [0, 0];

  const sortKeys = (keys: readonly CurveKey[]) => {
    sorted = keys;
    order.length = keys.length;
    for (let i = 0; i < keys.length; i++) order[i] = i;
    order.sort(byX);
  };

  /** The key before and after `index` along x (-1: none), as `sortKeys` last sorted them */
  const findNeighbours = (index: number) => {
    const at = order.indexOf(index);
    neighbours[0] = at > 0 ? order[at - 1] : -1;
    neighbours[1] = at >= 0 && at < order.length - 1 ? order[at + 1] : -1;
    return neighbours;
  };

  return {
    xSize,
    ySize,
    toFx,
    toFy,
    sortKeys,
    findNeighbours,
    /** A key's in tangent as it acts: its own, else the straight slope from the key before (0
     * for the first) */
    getInTangent: (keys: readonly CurveKey[], index: number) => {
      const own = keys[index].inTangent;
      if (own !== undefined) return own;
      const before = findNeighbours(index)[0];
      return before < 0 ? 0 : getSegmentTangents(keys[before], keys[index], segment)[1];
    },
    /** A key's out tangent as it acts: its own, else the straight slope to the key after (0 for
     * the last) */
    getOutTangent: (keys: readonly CurveKey[], index: number) => {
      const own = keys[index].outTangent;
      if (own !== undefined) return own;
      const after = findNeighbours(index)[1];
      return after < 0 ? 0 : getSegmentTangents(keys[index], keys[after], segment)[0];
    },
    /** A point's place in percent from the left and the top, clamped to the plot */
    getLeft: (x: number) => round3(clamp01(toFx(x)) * 100),
    getTop: (y: number) => round3((1 - clamp01(toFy(y))) * 100),
    /** An easing's path, its x's clamped to 0-1 (CSS's) */
    getBezierPath: ([x1, y1, x2, y2]: Readonly<CurveBezier>) =>
      `M${vx(0)} ${vy(0)}C${vx(clamp01(x1))} ${vy(y1)} ${vx(clamp01(x2))} ${vy(y2)} ${vx(1)} ${vy(1)}`,
    /** An easing's arms: from each end to its control point */
    getBezierArms: ([x1, y1, x2, y2]: Readonly<CurveBezier>) =>
      `M${vx(0)} ${vy(0)}L${vx(clamp01(x1))} ${vy(y1)}M${vx(1)} ${vy(1)}L${vx(clamp01(x2))} ${vy(y2)}`,
    /** The keys' path, as `sortKeys` last sorted them: flat from the plot's left edge to the first
     * key and from the last to the right edge, each segment a cubic Bézier (a Hermite segment's
     * control points are a third along its tangents), a step where two keys share an x */
    getKeysPath: (keys: readonly CurveKey[]) => {
      if (keys.length === 0) return `M0 ${vy(0)}H100`;
      let from = keys[order[0]];
      let path = `M0 ${vy(from.y)}L${vx(from.x)} ${vy(from.y)}`;
      for (let i = 1; i < order.length; i++) {
        const to = keys[order[i]];
        const dx = to.x - from.x;
        if (dx > 0) {
          const [m0, m1] = getSegmentTangents(from, to, segment);
          path += `C${vx(from.x + dx / 3)} ${vy(from.y + (m0 * dx) / 3)} ${vx(to.x - dx / 3)} ${vy(to.y - (m1 * dx) / 3)} ${vx(to.x)} ${vy(to.y)}`;
        } else {
          path += `L${vx(to.x)} ${vy(to.y)}`;
        }
        from = to;
      }
      return `${path}H100`;
    },
    /** A tangent handle's place into `out`: along the slope from the key at (x, y), a fixed
     * share of the plot, `sign` -1 for the in side; returns its arm's path */
    placeTangent: (x: number, y: number, slope: number, sign: number, out: TangentPlace) => {
      const fx = toFx(x);
      const fy = toFy(y);
      // The slope in the plot's shares, so the handle sits on the drawn tangent
      const m = ySize > 0 ? (slope * xSize) / ySize : 0;
      const d = (sign * TANGENT_REACH) / Math.sqrt(1 + m * m);
      out.left = round3((fx + d) * 100);
      out.top = round3((1 - (fy + m * d)) * 100);
      return `M${vx(x)} ${vy(y)}L${out.left} ${out.top}`;
    },
  };
};

/**
 * The plot `createCurvePlot` made.
 * @internal
 */
export type CurvePlot = ReturnType<typeof createCurvePlot>;
