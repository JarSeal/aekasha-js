/**
 * The bundle baseline's tolerance (`bundleDiff.ts`, so `verify:baselines` and `yarn sbp`'s diff): a
 * gzip growth over 1 % or 2 kB, and never under 100 B, needs a look.
 */

/** Growth over this share of the size before needs a look */
export const GROWTH_RATIO = 0.01;
/** Growth over this many bytes needs a look, whatever the share */
export const GROWTH_BYTES = 2048;
/** Growth under this many bytes never needs a look */
export const GROWTH_MIN_BYTES = 100;

/** Whether `before` → `after` (gzip bytes) grows past the tolerance */
export const isGrowthToFlag = (before: number, after: number) => {
  const growth = after - before;
  return growth >= GROWTH_MIN_BYTES && (growth > GROWTH_BYTES || growth > before * GROWTH_RATIO);
};
