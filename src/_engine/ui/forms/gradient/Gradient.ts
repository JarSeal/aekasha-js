// A gradient (p804 D8): its value, colour stops on 0-1, and its evaluation at a point, as CSS's
// `linear-gradient` draws it (premultiplied sRGB), so the editor's preview and a ramp read from it
// agree. No DOM and no allocation per call: a sky's colours may read it every frame.

/** A gradient's stop: its place on 0-1 and its colour as hex (`'#rrggbb'`, `'#rrggbbaa'`). */
export type GradientStop = { t: number; color: string };

/**
 * A gradient's value (p804 D8): its stops, in any order (the editor keeps a moved stop where it
 * is in the array).
 */
export type GradientValue = { stops: GradientStop[] };

/** A colour {@link evaluateGradient} gives: sRGB channels and alpha, each 0-1. */
export type GradientColor = { r: number; g: number; b: number; a: number };

/** A hex digit's value, or -1 */
const readDigit = (code: number) => {
  if (code >= 48 && code <= 57) return code - 48;
  const lower = code | 32;
  return lower >= 97 && lower <= 102 ? lower - 87 : -1;
};

/**
 * Reads a hex colour (`#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`) into `out` without making a string;
 * anything else is opaque black (false).
 * @internal
 */
export const readHexColor = (text: string, out: GradientColor) => {
  const length = text.length - 1;
  const short = length === 3 || length === 4;
  if (text.charCodeAt(0) !== 35 || !(short || length === 6 || length === 8)) {
    out.r = out.g = out.b = 0;
    out.a = 1;
    return false;
  }
  const count = short ? length : length / 2;
  for (let i = 0; i < 4; i++) {
    let value = 255;
    if (i < count) {
      const high = readDigit(text.charCodeAt(1 + (short ? i : i * 2)));
      const low = short ? high : readDigit(text.charCodeAt(2 + i * 2));
      if (high < 0 || low < 0) {
        out.r = out.g = out.b = 0;
        out.a = 1;
        return false;
      }
      value = high * 16 + low;
    }
    const channel = value / 255;
    if (i === 0) out.r = channel;
    else if (i === 1) out.g = channel;
    else if (i === 2) out.b = channel;
    else out.a = channel;
  }
  return true;
};

const clamp01 = (value: number) => (value > 0 ? (value < 1 ? value : 1) : 0);

/** The stops' colours being mixed: kept, so a call makes nothing */
const LOW: GradientColor = { r: 0, g: 0, b: 0, a: 0 };
const HIGH: GradientColor = { r: 0, g: 0, b: 0, a: 0 };

/**
 * A gradient's colour at `t` (0-1, clamped), as CSS's `linear-gradient` draws it: between the
 * nearest stops on either side, mixed in sRGB with premultiplied alpha; before the first stop its
 * colour, after the last its; two stops at one place a hard edge (at it, the later one's colour).
 * The stops may be in any order. No allocation with `out` (a ramp read every frame); an invalid
 * colour reads as opaque black, no stops as transparent black.
 * @param gradient the gradient (a value the editor writes)
 * @param t where on it, 0-1
 * @param out the colour to write into (default a new one)
 * @returns `out`, its channels sRGB 0-1
 * @example
 * ```ts
 * const skyRamp = { stops: [{ t: 0, color: '#0b1d3a' }, { t: 0.5, color: '#f2a65a' }, { t: 1, color: '#9fd3ff' }] };
 * const color = { r: 0, g: 0, b: 0, a: 1 };
 * // Each frame: the sky's colour for the time of day, then into a THREE.Color
 * evaluateGradient(skyRamp, dayFraction, color);
 * skyColor.setRGB(color.r, color.g, color.b, SRGBColorSpace);
 * ```
 */
export const evaluateGradient = (
  gradient: { readonly stops: readonly Readonly<GradientStop>[] },
  t: number,
  out: GradientColor = { r: 0, g: 0, b: 0, a: 0 }
): GradientColor => {
  const { stops } = gradient;
  const at = clamp01(t);
  /** The stop at or before `at` (the later one in the array at a tie), and at or after it */
  let low = -1;
  let high = -1;
  for (let i = 0; i < stops.length; i++) {
    const place = clamp01(stops[i].t);
    if (place <= at && (low < 0 || place >= clamp01(stops[low].t))) low = i;
    if (place >= at && (high < 0 || place < clamp01(stops[high].t))) high = i;
  }
  if (low < 0 && high < 0) {
    out.r = out.g = out.b = out.a = 0;
    return out;
  }
  if (low < 0) low = high;
  if (high < 0) high = low;
  readHexColor(stops[low].color, LOW);
  const lowT = clamp01(stops[low].t);
  const highT = clamp01(stops[high].t);
  if (low === high || highT <= lowT) {
    out.r = LOW.r;
    out.g = LOW.g;
    out.b = LOW.b;
    out.a = LOW.a;
    return out;
  }
  readHexColor(stops[high].color, HIGH);
  const f = (at - lowT) / (highT - lowT);
  const alpha = LOW.a + (HIGH.a - LOW.a) * f;
  if (alpha > 0) {
    // Premultiplied: a transparent stop doesn't tint its neighbour's colour (CSS's rule)
    out.r = (LOW.r * LOW.a + (HIGH.r * HIGH.a - LOW.r * LOW.a) * f) / alpha;
    out.g = (LOW.g * LOW.a + (HIGH.g * HIGH.a - LOW.g * LOW.a) * f) / alpha;
    out.b = (LOW.b * LOW.a + (HIGH.b * HIGH.a - LOW.b * LOW.a) * f) / alpha;
  } else {
    out.r = LOW.r + (HIGH.r - LOW.r) * f;
    out.g = LOW.g + (HIGH.g - LOW.g) * f;
    out.b = LOW.b + (HIGH.b - LOW.b) * f;
  }
  out.a = alpha;
  return out;
};

/**
 * A gradient as CSS (`linear-gradient(to right, …)`), its stops in place order (a tie keeps the
 * array's order, as `evaluateGradient` reads it): the editor's preview.
 * @internal
 */
export const getGradientCss = (gradient: { readonly stops: readonly Readonly<GradientStop>[] }) => {
  const { stops } = gradient;
  if (stops.length === 0) return 'none';
  if (stops.length === 1) return `linear-gradient(${stops[0].color}, ${stops[0].color})`;
  // In place order already (a drag's usual case): no copy, no sort
  let isInOrder = true;
  for (let i = 1; i < stops.length && isInOrder; i++) {
    isInOrder = clamp01(stops[i - 1].t) <= clamp01(stops[i].t);
  }
  if (isInOrder) {
    let css = 'linear-gradient(to right';
    for (const stop of stops) css += `, ${stop.color} ${Math.round(clamp01(stop.t) * 1e5) / 1e3}%`;
    return `${css})`;
  }
  const sorted = stops
    .map((stop, index) => ({ stop, index }))
    .sort((a, b) => clamp01(a.stop.t) - clamp01(b.stop.t) || a.index - b.index);
  const parts = sorted.map(
    ({ stop }) => `${stop.color} ${Math.round(clamp01(stop.t) * 1e5) / 1e3}%`
  );
  return `linear-gradient(to right, ${parts.join(', ')})`;
};
