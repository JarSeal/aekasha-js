// The noise library scene's checks (p304 Phase 3's exit), on the bytes read back from its bakes:
// a channel's statistics and its seam, and the pass rules comparing a periodic bake with the
// non-periodic one. Pure, so the rules are unit-tested; the scene reads the bakes back.

/** One channel of an RGBA8 image, summed up. */
export type ChannelStats = {
  /** The mean and the standard deviation, 0..1. */
  mean: number;
  std: number;
  min: number;
  max: number;
  /** The largest step between neighbouring texels, inside the image. */
  neighbourStep: number;
  /** The largest step across the wrap: the first column (row) against the last. */
  wrapStep: number;
};

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

/**
 * A channel's stats in an RGBA8 image (rows of `width` texels, 4 bytes each, no padding).
 * @param bytes the image
 * @param width its width in texels
 * @param height its height in texels
 * @param channel 0 (r) to 3 (a)
 * @returns the channel's stats, 0..1
 */
export const getChannelStats = (
  bytes: ArrayLike<number>,
  width: number,
  height: number,
  channel: number
): ChannelStats => {
  if (bytes.length !== width * height * 4) {
    throw new Error(
      `[noiseChecks] ${bytes.length} bytes isn't a ${width} × ${height} RGBA8 image without row padding.`
    );
  }
  const at = (x: number, y: number) => bytes[(y * width + x) * 4 + channel] / 255;
  let sum = 0;
  let squares = 0;
  let min = 1;
  let max = 0;
  let neighbourStep = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const value = at(x, y);
      sum += value;
      squares += value * value;
      min = Math.min(min, value);
      max = Math.max(max, value);
      if (x < width - 1) neighbourStep = Math.max(neighbourStep, Math.abs(value - at(x + 1, y)));
      if (y < height - 1) neighbourStep = Math.max(neighbourStep, Math.abs(value - at(x, y + 1)));
    }
  }
  let wrapStep = 0;
  for (let y = 0; y < height; y++) {
    wrapStep = Math.max(wrapStep, Math.abs(at(0, y) - at(width - 1, y)));
  }
  for (let x = 0; x < width; x++) {
    wrapStep = Math.max(wrapStep, Math.abs(at(x, 0) - at(x, height - 1)));
  }
  const count = width * height;
  const mean = sum / count;
  return {
    mean,
    std: Math.sqrt(Math.max(0, squares / count - mean * mean)),
    min,
    max,
    neighbourStep,
    wrapStep,
  };
};

/**
 * The largest byte of a channel (the periodicity check's difference).
 * @param bytes an RGBA8 image
 * @param channel 0 (r) to 3 (a)
 * @returns the byte, 0 to 255
 */
export const getChannelMaxByte = (bytes: ArrayLike<number>, channel: number) => {
  let max = 0;
  for (let i = channel; i < bytes.length; i += 4) max = Math.max(max, bytes[i]);
  return max;
};

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
