// The noise library scene's checks of the toolkit's shared generated textures (p304 D4,
// `bakeMacroNoise` and `bakeRippleAtlas`), on the bytes read back from their bakes. Pure, so the
// rules are unit-tested; the scene reads the bakes back (`sharedTextures.ts`).
import { getChannelStats, type ChannelStats } from '../../shared/channelStats';

/** A shared texture's result: its figures and its failures. */
export type SharedTextureResult = {
  /** The figures the tab shows, by name. */
  figures: Record<string, number>;
  /** What failed, in words; empty when the texture passes. */
  failures: string[];
};

/** The wrap may step this much (2 bytes) past the largest step inside: 8-bit rounding. */
const SEAM_TOLERANCE = 2 / 255;
/** A macro channel's mean: within this of 0.5. */
const MACRO_MEAN_TOLERANCE = 0.1;
/** The broad channels' (R, G, B) smallest spread and range: they use the byte. */
const MACRO_MIN_STD = 0.08;
const MACRO_MIN_RANGE = 0.5;
/** The blue-ish channel's (A) neighbours are unlike each other: their correlation is under this,
 * inside the image and across its wrap (white noise: 0; the high pass: about −0.24). */
const BLUE_MAX_CORRELATION = -0.1;
/** The atlas's mask at a drop: at least this. */
const RIPPLE_MIN_PEAK = 0.9;
/** The share of a cell's ring texels whose direction must point away from its drop. */
const RIPPLE_MIN_OUTWARD = 0.99;

const format = (value: number) => value.toFixed(3);

/**
 * The correlation of a channel's horizontally and vertically neighbouring texels: inside the
 * image, and of the pairs across its wrap (the last column with the first, the last row with the
 * first).
 * @param bytes an RGBA8 image, no row padding
 * @param width its width in texels
 * @param height its height in texels
 * @param channel 0 (r) to 3 (a)
 * @returns the two correlations, −1..1 (0 for a flat channel)
 */
export const getNeighbourCorrelation = (
  bytes: ArrayLike<number>,
  width: number,
  height: number,
  channel: number
) => {
  const at = (x: number, y: number) => bytes[(y * width + x) * 4 + channel] / 255;
  let sum = 0;
  for (let i = channel; i < bytes.length; i += 4) sum += bytes[i] / 255;
  const mean = sum / (width * height);
  let variance = 0;
  const pairs = { inside: 0, insideCount: 0, wrap: 0, wrapCount: 0 };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const value = at(x, y) - mean;
      variance += value * value;
      const right = value * (at((x + 1) % width, y) - mean);
      const down = value * (at(x, (y + 1) % height) - mean);
      if (x === width - 1) pairs.wrap += right;
      else pairs.inside += right;
      if (y === height - 1) pairs.wrap += down;
      else pairs.inside += down;
    }
  }
  variance /= width * height;
  pairs.wrapCount = width + height;
  pairs.insideCount = 2 * width * height - pairs.wrapCount;
  // Flat, but for the mean's rounding
  if (variance < 1e-12) return { inside: 0, wrap: 0 };
  return {
    inside: pairs.inside / pairs.insideCount / variance,
    wrap: pairs.wrap / pairs.wrapCount / variance,
  };
};

const checkBroadChannel = (name: string, stats: ChannelStats, failures: string[]) => {
  if (Math.abs(stats.mean - 0.5) > MACRO_MEAN_TOLERANCE) {
    failures.push(`${name}: its mean is ${format(stats.mean)}, not about 0.5`);
  }
  if (stats.std < MACRO_MIN_STD || stats.max - stats.min < MACRO_MIN_RANGE) {
    failures.push(
      `${name}: flat (σ ${format(stats.std)}, ${format(stats.min)}–${format(stats.max)})`
    );
  }
  if (stats.wrapStep > stats.neighbourStep + SEAM_TOLERANCE) {
    failures.push(
      `${name}: a seam: the wrap steps ${format(stats.wrapStep)}, the largest step inside ${format(stats.neighbourStep)}`
    );
  }
};

/**
 * Checks a macro noise bake: R, G and B are around 0.5, use the byte's range and tile (no step
 * across the wrap past the largest one inside); A is around 0.5 and blue-ish (neighbouring texels
 * unlike each other, across the wrap too).
 * @param bytes the bake's level 0, RGBA8, no row padding
 * @param size its side in texels
 * @returns the figures and the failures in words
 */
export const checkMacroNoise = (bytes: ArrayLike<number>, size: number): SharedTextureResult => {
  const failures: string[] = [];
  const figures: Record<string, number> = {};
  ['R', 'G', 'B'].forEach((name, channel) => {
    const stats = getChannelStats(bytes, size, size, channel);
    figures[`${name} mean`] = stats.mean;
    figures[`${name} σ`] = stats.std;
    figures[`${name} wrap step`] = stats.wrapStep;
    figures[`${name} step inside`] = stats.neighbourStep;
    checkBroadChannel(name, stats, failures);
  });
  const alpha = getChannelStats(bytes, size, size, 3);
  const correlation = getNeighbourCorrelation(bytes, size, size, 3);
  figures['A mean'] = alpha.mean;
  figures['A σ'] = alpha.std;
  figures['A neighbours'] = correlation.inside;
  figures['A neighbours, wrap'] = correlation.wrap;
  if (Math.abs(alpha.mean - 0.5) > 0.02) {
    failures.push(`A: its mean is ${format(alpha.mean)}, not 0.5`);
  }
  if (correlation.inside > BLUE_MAX_CORRELATION || correlation.wrap > BLUE_MAX_CORRELATION) {
    failures.push(
      `A: not blue-ish: neighbours correlate ${format(correlation.inside)} inside, ${format(correlation.wrap)} across the wrap`
    );
  }
  return { figures, failures };
};

/**
 * Checks a ripple atlas bake, cell by cell: the mask peaks at a drop and is 0 on the cell's border
 * texels (no ring is cut, the atlas tiles), the time offset is one value over the cell, the
 * direction is none (0.5) off the ring and points away from the drop on it; and the cells' time
 * offsets differ.
 * @param bytes the bake's level 0, RGBA8, no row padding, the first row v = 0
 * @param size its side in texels
 * @param cells the drops along a side
 * @returns the figures and the failures in words
 */
export const checkRippleAtlas = (
  bytes: ArrayLike<number>,
  size: number,
  cells: number
): SharedTextureResult => {
  const failures: string[] = [];
  const cell = size / cells;
  const at = (x: number, y: number, channel: number) => bytes[(y * size + x) * 4 + channel];
  const times = new Set<number>();
  let minPeak = 1;
  let maxBorder = 0;
  let minOutward = 1;
  let unevenTimes = 0;
  let strayDirections = 0;
  for (let cy = 0; cy < cells; cy++) {
    for (let cx = 0; cx < cells; cx++) {
      // The drop: the mask's centre of mass
      const centre = { x: 0, y: 0, weight: 0 };
      let peak = 0;
      const time = at(cx * cell, cy * cell, 3);
      times.add(time);
      for (let y = cy * cell; y < (cy + 1) * cell; y++) {
        for (let x = cx * cell; x < (cx + 1) * cell; x++) {
          const mask = at(x, y, 2);
          peak = Math.max(peak, mask);
          centre.x += x * mask;
          centre.y += y * mask;
          centre.weight += mask;
          const isBorder =
            x % cell === 0 || x % cell === cell - 1 || y % cell === 0 || y % cell === cell - 1;
          if (isBorder) maxBorder = Math.max(maxBorder, mask);
          if (at(x, y, 3) !== time) unevenTimes++;
          // 0.5 is between two bytes
          const isNone = [at(x, y, 0), at(x, y, 1)].every((byte) => byte === 127 || byte === 128);
          if (mask === 0 && !isNone) strayDirections++;
        }
      }
      minPeak = Math.min(minPeak, peak / 255);
      if (!centre.weight) continue;
      centre.x /= centre.weight;
      centre.y /= centre.weight;
      let ring = 0;
      let outward = 0;
      for (let y = cy * cell; y < (cy + 1) * cell; y++) {
        for (let x = cx * cell; x < (cx + 1) * cell; x++) {
          const mask = at(x, y, 2) / 255;
          if (mask < 0.2 || mask > 0.8) continue;
          ring++;
          const dx = at(x, y, 0) / 255 - 0.5;
          const dy = at(x, y, 1) / 255 - 0.5;
          if (dx * (x - centre.x) + dy * (y - centre.y) > 0) outward++;
        }
      }
      minOutward = Math.min(minOutward, ring ? outward / ring : 0);
    }
  }
  if (minPeak < RIPPLE_MIN_PEAK) {
    failures.push(`a cell's mask peaks at ${format(minPeak)}: no drop in it`);
  }
  if (maxBorder > 0) {
    failures.push(`the mask is ${maxBorder} / 255 on a cell's border: a ring is cut`);
  }
  if (unevenTimes) failures.push(`${unevenTimes} texels' time offset isn't their cell's`);
  if (strayDirections) failures.push(`${strayDirections} texels off the rings have a direction`);
  if (minOutward < RIPPLE_MIN_OUTWARD) {
    failures.push(`only ${format(minOutward)} of a cell's ring texels point away from its drop`);
  }
  // 16 cells drawing from 256 bytes: a few may share one
  if (times.size < Math.ceil(cells * cells * 0.75)) {
    failures.push(`the ${cells * cells} cells have only ${times.size} time offsets`);
  }
  return {
    figures: {
      'mask peak (lowest)': minPeak,
      'mask on borders': maxBorder / 255,
      'outward (lowest share)': minOutward,
      'time offsets': times.size,
    },
    failures,
  };
};

/** How far a committed copy's channel may be from the bake: its mean and its largest difference,
 * in bytes. */
export type CopyTolerance = { mean: number; max: number };

/**
 * Checks a committed copy of a shared texture against its bake, on the bytes of
 * `|bake − copy|`: each channel's mean and largest difference within its tolerance (the copy's
 * block compression; a copy flipped or of another seed is far outside it).
 * @param difference the difference image, RGBA8, no row padding
 * @param tolerances the tolerance per channel, r to a
 * @returns the figures (in bytes) and the failures in words
 */
export const checkCommittedCopy = (
  difference: ArrayLike<number>,
  tolerances: [CopyTolerance, CopyTolerance, CopyTolerance, CopyTolerance]
): SharedTextureResult => {
  const failures: string[] = [];
  const figures: Record<string, number> = {};
  ['R', 'G', 'B', 'A'].forEach((name, channel) => {
    let sum = 0;
    let max = 0;
    for (let i = channel; i < difference.length; i += 4) {
      sum += difference[i];
      max = Math.max(max, difference[i]);
    }
    const mean = sum / (difference.length / 4);
    figures[`${name} mean Δ`] = mean;
    figures[`${name} max Δ`] = max;
    if (mean > tolerances[channel].mean || max > tolerances[channel].max) {
      failures.push(
        `${name}: the committed copy is off by ${format(mean)} bytes on average, ${max} at most (allowed ${tolerances[channel].mean} and ${tolerances[channel].max})`
      );
    }
  });
  return { figures, failures };
};
