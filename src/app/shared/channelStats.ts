// An RGBA8 image's channel statistics, for the verification scenes that read a bake back (p304:
// `noiseLibrary`, `proceduralSurfaces`): a channel's mean, spread and range, its largest step
// between neighbours and across the wrap (a seam), and its largest byte. Pure, so unit-tested.

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
      `[channelStats] ${bytes.length} bytes isn't a ${width} × ${height} RGBA8 image without row padding.`
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
