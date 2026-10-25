/**
 * The motion factor an element's styles run at: its `--aek-motion`, which the kit root sets to 0
 * under `prefers-reduced-motion: reduce` and an app may set itself (a "reduce motion" setting).
 * Multiply a JS-timed animation's durations by it, so it stops with the kit's CSS ones. 1 when the
 * property isn't set (an element outside a kit root, or not in the document) or isn't a number ≥ 0.
 * @param elem the element the animation runs on (it reads that element's computed style)
 * @remarks `CMP`'s `anim` phases don't scale on their own: an app's animation can carry meaning
 * (p803 D4), so scale their durations with this where they shouldn't play under reduced motion.
 * @example
 * ```ts
 * import { getHUDRootCMP, getMotionFactor } from 'aekasha/ui';
 *
 * const banner = getHUDRootCMP().add({ class: 'levelBanner', text: 'Level 2' });
 * // 0 under reduced motion: the banner goes at once
 * setTimeout(() => banner.remove(), 1200 * getMotionFactor(banner.elem));
 * ```
 */
export const getMotionFactor = (elem: Element) => {
  // Not in Node's DOM stand-ins (the unit tests): full motion
  if (typeof window.getComputedStyle !== 'function') return 1;
  const value = parseFloat(window.getComputedStyle(elem).getPropertyValue('--aek-motion'));
  return Number.isFinite(value) && value >= 0 ? value : 1;
};
