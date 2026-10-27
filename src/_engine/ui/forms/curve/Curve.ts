// A curve (p804 D8): an easing as CSS's `cubic-bezier()`, or keys joined by cubic Hermite segments
// (the falloff and animation curves p426 needs), its evaluation at a point and its presets. No DOM
// and no allocation per call: an animation may read it every frame.

/**
 * A curve as CSS's `cubic-bezier(x1, y1, x2, y2)` (p804 D8): its two control points, the ends at
 * (0, 0) and (1, 1). The x's are 0-1; the y's may overshoot (a "back" easing).
 */
export type CurveBezier = [x1: number, y1: number, x2: number, y2: number];

/**
 * A curve's key (p804 D8): a point, and the slopes (dy / dx) the curve leaves it with on either
 * side. A missing tangent is its segment's straight slope, so keys without tangents are joined by
 * straight lines.
 */
export type CurveKey = {
  /** Where on the curve's x axis (time, distance). */
  x: number;
  /** The curve's value there. */
  y: number;
  /** The slope arriving from the key before it (default: the straight segment's). */
  inTangent?: number;
  /** The slope leaving towards the key after it (default: the straight segment's). */
  outTangent?: number;
};

/**
 * A curve's value (p804 D8): a CSS-like easing (four numbers) or keys (`{ x, y, inTangent?,
 * outTangent? }[]`, in any order). The value's shape says which.
 */
export type CurveValue = CurveBezier | CurveKey[];

/** A preset {@link getCurvePreset} makes. */
export type CurvePresetName = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'smoothstep';

/**
 * Whether a curve is an easing (four numbers), not keys.
 * @internal
 */
export const isBezierCurve = (curve: Readonly<CurveValue>): curve is CurveBezier =>
  curve.length === 4 && typeof curve[0] === 'number';

const clamp01 = (value: number) => (value > 0 ? (value < 1 ? value : 1) : 0);

/** A cubic-bezier's y at x, as the browsers solve it: Newton's steps on x(t), then bisection */
const evaluateBezier = (curve: Readonly<CurveBezier>, x: number) => {
  const at = clamp01(x);
  const x1 = clamp01(curve[0]);
  const x2 = clamp01(curve[2]);
  // The polynomials' coefficients, with the ends at 0 and 1
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * curve[1];
  const by = 3 * (curve[3] - curve[1]) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  let t = at;
  for (let i = 0; i < 8; i++) {
    const error = sampleX(t) - at;
    if (Math.abs(error) < 1e-7) return ((ay * t + by) * t + cy) * t;
    const slope = (3 * ax * t + 2 * bx) * t + cx;
    if (Math.abs(slope) < 1e-6) break;
    t -= error / slope;
  }
  let low = 0;
  let high = 1;
  t = at;
  for (let i = 0; i < 40 && high - low > 1e-7; i++) {
    if (sampleX(t) < at) low = t;
    else high = t;
    t = (low + high) / 2;
  }
  return ((ay * t + by) * t + cy) * t;
};

/**
 * The key at or before `x` and the one at or after it (indices, -1 for none): the later one in the
 * array below a tie, the first above it, so two keys at one place are a step. Written into `out`.
 * @internal
 */
export const findCurveSegment = (
  keys: readonly Readonly<CurveKey>[],
  x: number,
  out: [low: number, high: number]
) => {
  let low = -1;
  let high = -1;
  for (let i = 0; i < keys.length; i++) {
    const place = keys[i].x;
    if (place <= x && (low < 0 || place >= keys[low].x)) low = i;
    if (place >= x && (high < 0 || place < keys[high].x)) high = i;
  }
  out[0] = low;
  out[1] = high;
  return out;
};

/**
 * A segment's slopes: `from`'s out tangent and `to`'s in tangent, each the straight slope when
 * the key has none. Written into `out`.
 * @internal
 */
export const getSegmentTangents = (
  from: Readonly<CurveKey>,
  to: Readonly<CurveKey>,
  out: [leaving: number, arriving: number]
) => {
  const dx = to.x - from.x;
  const straight = dx > 0 ? (to.y - from.y) / dx : 0;
  out[0] = from.outTangent ?? straight;
  out[1] = to.inTangent ?? straight;
  return out;
};

/** Kept, so a call makes nothing */
const SEGMENT: [number, number] = [-1, -1];
const TANGENTS: [number, number] = [0, 0];

const evaluateKeys = (keys: readonly Readonly<CurveKey>[], x: number) => {
  let [low, high] = findCurveSegment(keys, x, SEGMENT);
  if (low < 0 && high < 0) return 0;
  if (low < 0) low = high;
  if (high < 0) high = low;
  const from = keys[low];
  const to = keys[high];
  const dx = to.x - from.x;
  if (low === high || dx <= 0) return from.y;
  const [m0, m1] = getSegmentTangents(from, to, TANGENTS);
  // Cubic Hermite on the segment
  const t = (x - from.x) / dx;
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * from.y +
    (t3 - 2 * t2 + t) * dx * m0 +
    (-2 * t3 + 3 * t2) * to.y +
    (t3 - t2) * dx * m1
  );
};

/**
 * A curve's value at `x`. An easing (four numbers) is CSS's `cubic-bezier()`: `x` clamped to 0-1,
 * solved as the browsers do. Keys are joined by cubic Hermite segments (a missing tangent the
 * straight slope), flat before the first key and after the last; two keys at one `x` are a step
 * (at it, the later one's value); no keys is 0. The keys may be in any order. No allocation.
 * @param curve the curve (a value the curve editor writes, or a preset)
 * @param x where on it
 * @returns its y there
 * @example
 * ```ts
 * const falloff = [{ x: 0, y: 1, outTangent: 0 }, { x: 10, y: 0, inTangent: 0 }];
 * // Each frame: a light's strength at the player's distance
 * light.intensity = baseIntensity * evaluateCurve(falloff, distance);
 * // An easing, with getCurvePreset or as CSS writes it
 * mesh.position.y = evaluateCurve([0.42, 0, 0.58, 1], progress) * jumpHeight;
 * ```
 */
export const evaluateCurve = (curve: Readonly<CurveValue>, x: number): number =>
  isBezierCurve(curve)
    ? evaluateBezier(curve, x)
    : evaluateKeys(curve as readonly Readonly<CurveKey>[], x);

/** CSS's keywords, and smoothstep (its control points even along x, so x is t) */
const BEZIER_PRESETS: Readonly<Record<CurvePresetName, Readonly<CurveBezier>>> = {
  linear: [0, 0, 1, 1],
  easeIn: [0.42, 0, 1, 1],
  easeOut: [0, 0, 0.58, 1],
  easeInOut: [0.42, 0, 0.58, 1],
  smoothstep: [1 / 3, 0, 2 / 3, 1],
};

/** The quadratic easings, exact as Hermite segments, and smoothstep (flat at both ends) */
const KEY_PRESETS: Readonly<Record<CurvePresetName, readonly Readonly<CurveKey>[]>> = {
  linear: [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ],
  easeIn: [
    { x: 0, y: 0, outTangent: 0 },
    { x: 1, y: 1, inTangent: 2 },
  ],
  easeOut: [
    { x: 0, y: 0, outTangent: 2 },
    { x: 1, y: 1, inTangent: 0 },
  ],
  easeInOut: [
    { x: 0, y: 0, outTangent: 0 },
    { x: 0.5, y: 0.5, inTangent: 2, outTangent: 2 },
    { x: 1, y: 1, inTangent: 0 },
  ],
  smoothstep: [
    { x: 0, y: 0, outTangent: 0 },
    { x: 1, y: 1, inTangent: 0 },
  ],
};

/**
 * The presets' names, in the editor's menu order.
 * @internal
 */
export const CURVE_PRESET_NAMES: readonly CurvePresetName[] = [
  'linear',
  'easeIn',
  'easeOut',
  'easeInOut',
  'smoothstep',
];

/**
 * A preset curve, a new value each call, from (0, 0) to (1, 1). As an easing: `'linear'`, CSS's
 * `ease-in`, `ease-out` and `ease-in-out`, and `'smoothstep'` (`3x² - 2x³`). As keys: `'linear'`,
 * the quadratic easings (`x²`, its mirror, and the two halves joined at the middle) and
 * `'smoothstep'` (two keys with flat tangents), each exact.
 * @param name which of the five
 * @param mode `'bezier'` for four numbers, `'keys'` for keys
 * @returns a new value in that mode's shape
 * @example
 * ```ts
 * const curves = { fadeIn: getCurvePreset('easeOut', 'bezier') };
 * const opacity = evaluateCurve(curves.fadeIn, elapsed / duration);
 * ```
 */
export function getCurvePreset(name: CurvePresetName, mode: 'bezier'): CurveBezier;
export function getCurvePreset(name: CurvePresetName, mode: 'keys'): CurveKey[];
export function getCurvePreset(name: CurvePresetName, mode: 'bezier' | 'keys'): CurveValue;
export function getCurvePreset(name: CurvePresetName, mode: 'bezier' | 'keys'): CurveValue {
  if (mode === 'bezier') return [...BEZIER_PRESETS[name]] as CurveBezier;
  return KEY_PRESETS[name].map((key) => ({ ...key }));
}
