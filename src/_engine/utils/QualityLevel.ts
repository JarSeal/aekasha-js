// The engine's one quality scale (p240 §3.1): the shadow presets' keys and the device levels.
// Pure, without zod, so a module that compares levels (the device capability check) doesn't load
// the schemas; `schemas/_HelperSchemas.ts`' `QualityLevelSchema` is built from the same list.

/** The quality levels, lowest first: `LOW`, `MEDIUM`, `HIGH`, `ULTRA`. */
export const QUALITY_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'ULTRA'] as const;

/**
 * A quality level, `LOW` to `ULTRA`: the scale of a light's `shadowPreset` (`SHADOW_PRESETS`) and
 * of the device capability check's levels, so a device level can be used as a preset key.
 */
export type QualityLevel = (typeof QUALITY_LEVELS)[number];

/**
 * Compares two quality levels by their place on the scale, for sorting.
 * @returns a negative number when `a` is lower than `b`, 0 when they're equal, positive when higher
 * @example
 * ```ts
 * import { compareQualityLevels } from 'aekasha';
 *
 * const canRunUltraShadows = compareQualityLevels(gpuLevel, 'HIGH') >= 0;
 * ```
 */
export const compareQualityLevels = (a: QualityLevel, b: QualityLevel) =>
  QUALITY_LEVELS.indexOf(a) - QUALITY_LEVELS.indexOf(b);

/**
 * The lowest of the levels given; `null` and `undefined` are skipped (an unknown level never
 * lowers the result).
 * @returns the lowest level, or null when none was given
 * @example
 * ```ts
 * import { minQualityLevel } from 'aekasha';
 *
 * const shadowLevel = minQualityLevel(levels.gpu, levels.gpuMemory) ?? 'MEDIUM';
 * ```
 */
export const minQualityLevel = (
  ...levels: (QualityLevel | null | undefined)[]
): QualityLevel | null => {
  let min: QualityLevel | null = null;
  for (const level of levels) {
    if (!level) continue;
    if (min === null || compareQualityLevels(level, min) < 0) min = level;
  }
  return min;
};
