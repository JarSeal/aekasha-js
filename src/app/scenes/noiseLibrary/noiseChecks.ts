// The noise library scene's checks (p304 Phase 3's exit), on the bytes read back from its bakes:
// the pass rules comparing a periodic bake with the non-periodic one, on the channels' statistics
// (`shared/channelStats.ts`). Pure, so the rules are unit-tested; the scene reads the bakes back.
import type { ChannelStats } from '../../shared/channelStats';

/** A row's result: its periodic and non-periodic stats, its periodicity check and its failures. */
export type NoiseRowResult = {
  periodic: ChannelStats;
  plain: ChannelStats;
  /** The largest byte of `|f(uv) − f(uv + whole tiles)| × 100`: 0 when exactly periodic. */
  periodicityByte: number;
  /** What failed, in words; empty when the row passes. */
  failures: string[];
};

/** How far the periodic and the non-periodic bakes' means may differ (0..1). */
export const MEAN_TOLERANCE = 0.03;
/** How far their standard deviations may differ: this share of the periodic one's, plus 0.01. */
export const STD_TOLERANCE = 0.1;
/** The wrap may step this much (2 bytes) past the largest step inside: 8-bit rounding. */
export const SEAM_TOLERANCE = 2 / 255;
/** The periodicity check's largest byte: one byte of rounding (a difference under 0.00006). */
export const PERIODICITY_TOLERANCE = 1;

const format = (value: number) => value.toFixed(3);

/**
 * Checks a row: the periodic bake tiles (no step across its wrap past the largest one inside),
 * repeats exactly over whole tiles, and matches the non-periodic bake's mean and spread.
 * @param periodic the periodic bake's stats
 * @param plain the non-periodic bake's stats (other cells: an offset)
 * @param periodicityByte the periodicity check's largest byte
 * @returns the result, its failures in words
 */
export const checkNoiseRow = (
  periodic: ChannelStats,
  plain: ChannelStats,
  periodicityByte: number
): NoiseRowResult => {
  const failures: string[] = [];
  if (periodic.wrapStep > periodic.neighbourStep + SEAM_TOLERANCE) {
    failures.push(
      `a seam: the wrap steps ${format(periodic.wrapStep)}, the largest step inside ${format(periodic.neighbourStep)}`
    );
  }
  if (periodicityByte > PERIODICITY_TOLERANCE) {
    failures.push(
      `not periodic: f(uv) and f(uv + whole tiles) differ by up to ${periodicityByte} / 25500`
    );
  }
  if (Math.abs(periodic.mean - plain.mean) > MEAN_TOLERANCE) {
    failures.push(
      `the means differ: periodic ${format(periodic.mean)}, non-periodic ${format(plain.mean)}`
    );
  }
  if (Math.abs(periodic.std - plain.std) > STD_TOLERANCE * periodic.std + 0.01) {
    failures.push(
      `the spreads differ: periodic σ ${format(periodic.std)}, non-periodic σ ${format(plain.std)}`
    );
  }
  return { periodic, plain, periodicityByte, failures };
};
