/**
 * `yarn verify:embed`'s checks (p611 Phase 4), apart from the browser: a mount may change no
 * computed style of the host page, its boxes must match what the options ask for, and the UI
 * kit's elements must stay inside the mount's container (p801 D9).
 */

/** The host page's elements whose computed styles are compared, as `embedHost.html` has them */
export const HOST_STYLE_SELECTORS = ['html', 'body', 'h1', 'p', 'a', 'button', 'input', '#inline'];

/** Each selector's computed style: property → value */
export type StyleSnapshot = Record<string, Record<string, string>>;

/**
 * The custom properties a stylesheet registers (`@property --aek-base { … }`). A registered
 * property with an `initial-value` is in every element's computed style, the host page's too:
 * CSS has no scoped registration. The UI kit's tokens register two (`ui/styles/tokens.css`, p801
 * D4), namespaced, which a host page sees only if it reads them, so the style check skips exactly
 * those names: a token declared on the host's elements still fails it.
 */
export const readRegisteredProperties = (css: string): string[] =>
  [...css.matchAll(/@property\s+(--[\w-]+)/g)].map((match) => match[1]);

/**
 * The properties that differ between two snapshots, a line each (`body color: a → b`)
 * @param ignored properties left out (the registered ones, {@link readRegisteredProperties})
 */
export const diffComputedStyles = (
  before: StyleSnapshot,
  after: StyleSnapshot,
  ignored: string[] = []
): string[] => {
  const skip = new Set(ignored);
  const lines: string[] = [];
  for (const selector of Object.keys(before)) {
    const a = before[selector];
    const b = after[selector];
    if (!b) {
      lines.push(`${selector}: gone`);
      continue;
    }
    for (const prop of Object.keys({ ...a, ...b })) {
      if (a[prop] !== b[prop] && !skip.has(prop)) {
        lines.push(`${selector} ${prop}: ${a[prop] ?? '(none)'} → ${b[prop] ?? '(none)'}`);
      }
    }
  }
  return lines;
};

/** An element's or a drawing buffer's size, in CSS pixels or in pixels */
export type Box = { width: number; height: number };

/** An element's box on the page: its viewport position too */
export type Rect = Box & { x: number; y: number };

/** Off by more than a pixel (a rounded percentage) */
const PIXEL_TOLERANCE = 1;

/** A box's size against the expected one: null when within a pixel, else the problem */
export const checkBox = (label: string, actual: Box | null, expected: Box): string | null => {
  if (!actual) return `${label}: missing`;
  const isNear = (a: number, b: number) => Math.abs(a - b) <= PIXEL_TOLERANCE;
  if (isNear(actual.width, expected.width) && isNear(actual.height, expected.height)) return null;
  return `${label}: ${actual.width} × ${actual.height}, expected ${expected.width} × ${expected.height}`;
};

/** A box inside another one (an element inside the mount's container): null when it is, within a
 * pixel, else the problem */
export const checkInside = (label: string, actual: Rect | null, container: Rect): string | null => {
  if (!actual) return `${label}: missing`;
  const isInside =
    actual.x >= container.x - PIXEL_TOLERANCE &&
    actual.y >= container.y - PIXEL_TOLERANCE &&
    actual.x + actual.width <= container.x + container.width + PIXEL_TOLERANCE &&
    actual.y + actual.height <= container.y + container.height + PIXEL_TOLERANCE;
  if (isInside) return null;
  const at = (r: Rect) => `${r.width} × ${r.height} at ${r.x}, ${r.y}`;
  return `${label}: ${at(actual)}, outside the container's ${at(container)}`;
};

/** A box's position against the expected one: null when within a pixel, else the problem */
export const checkPosition = (
  label: string,
  actual: Rect | null,
  expected: { x: number; y: number }
): string | null => {
  if (!actual) return `${label}: missing`;
  const isNear = (a: number, b: number) => Math.abs(a - b) <= PIXEL_TOLERANCE;
  if (isNear(actual.x, expected.x) && isNear(actual.y, expected.y)) return null;
  return `${label}: at ${actual.x}, ${actual.y}, expected ${expected.x}, ${expected.y}`;
};
