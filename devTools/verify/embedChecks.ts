/**
 * `yarn verify:embed`'s checks (p611 Phase 4), apart from the browser: a mount may change no
 * computed style of the host page, and its boxes must match what the options ask for.
 */

/** The host page's elements whose computed styles are compared, as `embedHost.html` has them */
export const HOST_STYLE_SELECTORS = ['html', 'body', 'h1', 'p', 'a', 'button', 'input', '#inline'];

/** Each selector's computed style: property → value */
export type StyleSnapshot = Record<string, Record<string, string>>;

/** The properties that differ between two snapshots, a line each (`body color: a → b`) */
export const diffComputedStyles = (before: StyleSnapshot, after: StyleSnapshot): string[] => {
  const lines: string[] = [];
  for (const selector of Object.keys(before)) {
    const a = before[selector];
    const b = after[selector];
    if (!b) {
      lines.push(`${selector}: gone`);
      continue;
    }
    for (const prop of Object.keys({ ...a, ...b })) {
      if (a[prop] !== b[prop]) {
        lines.push(`${selector} ${prop}: ${a[prop] ?? '(none)'} → ${b[prop] ?? '(none)'}`);
      }
    }
  }
  return lines;
};

/** An element's or a drawing buffer's size, in CSS pixels or in pixels */
export type Box = { width: number; height: number };

/** Off by more than a pixel (a rounded percentage) */
const PIXEL_TOLERANCE = 1;

/** A box's size against the expected one: null when within a pixel, else the problem */
export const checkBox = (label: string, actual: Box | null, expected: Box): string | null => {
  if (!actual) return `${label}: missing`;
  const isNear = (a: number, b: number) => Math.abs(a - b) <= PIXEL_TOLERANCE;
  if (isNear(actual.width, expected.width) && isNear(actual.height, expected.height)) return null;
  return `${label}: ${actual.width} × ${actual.height}, expected ${expected.width} × ${expected.height}`;
};
