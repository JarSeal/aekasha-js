/**
 * The motion factor an element's styles run at: its `--aek-motion` (`ui/styles/tokens.css`), which
 * the kit root sets to 0 under `prefers-reduced-motion: reduce` and an app may set itself. JS-timed
 * animations multiply their durations by it, so they stop with the CSS ones. 1 when the property
 * isn't set (an element outside a kit root, or not in the document) or isn't a number ≥ 0.
 * @internal
 */
export const getMotionFactor = (elem: Element) => {
  // Not in Node's DOM stand-ins (the unit tests): full motion
  if (typeof window.getComputedStyle !== 'function') return 1;
  const value = parseFloat(window.getComputedStyle(elem).getPropertyValue('--aek-motion'));
  return Number.isFinite(value) && value >= 0 ? value : 1;
};
