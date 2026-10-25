/**
 * `yarn verify:ui`'s settings (p803 D11): the axe-core rules it runs, the violations it allows
 * while p803's Phases 4-6 fix the kit's existing pieces, and the screenshots' tolerance. The list only shrinks: each entry names
 * the phase that removes it, and the plan's Phase 3 As built records them.
 */
import type { SnapshotTolerance } from './scenes.config';

/** axe-core's tags the run checks: WCAG 2.2 A and AA, and axe's best practices */
export const UI_AXE_TAGS = [
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag22aa',
  'best-practice',
] as const;

/** A violation allowed on a piece (a `DEMOS` key): an axe rule id, and the phase that fixes it */
export type UiAllowedViolation = { rule: string; piece: string; until: string };

export const UI_ALLOWED_VIOLATIONS: UiAllowedViolation[] = [];

/**
 * How far a state's screenshot may differ from its baseline: the kit's pixels are the same run to
 * run on one machine (the baselines are local), so a little for antialiasing only
 */
export const UI_SNAPSHOT_TOLERANCE: SnapshotTolerance = {
  maxMeanDelta: 0.2,
  maxChangedRatio: 0.001,
  pixelThreshold: 24,
};
