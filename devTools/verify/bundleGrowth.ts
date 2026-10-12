/**
 * The bundle baseline's tolerance (`baselines.ts`), shared with p608's `compareBaselines.ts`: a
 * gzip growth over 1 % or 2 kB, and never under 100 B, needs a look.
 */

/** Gzip growth that needs a look: over 1 % or 2 kB, and never under 100 B */
export const GROWTH_RATIO = 0.01;
export const GROWTH_BYTES = 2048;
export const GROWTH_MIN_BYTES = 100;

/** Whether `before` → `after` (gzip bytes) grows past the tolerance */
export const isGrowthToFlag = (before: number, after: number) => {
  const growth = after - before;
  return growth >= GROWTH_MIN_BYTES && (growth > GROWTH_BYTES || growth > before * GROWTH_RATIO);
};
