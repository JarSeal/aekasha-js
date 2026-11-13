import { PACK_TARGETS, type TexturePack } from '../../src/_engine/schemas';
import {
  createImage,
  extractChannel,
  extractChannels,
  getSampleIndex,
  readSourceImage,
  resizeImage,
  type Img,
  type SourceImage,
} from './images';

/**
 * Channel packing (p300 DD5): a texture JSON's `pack` combines channels of several source images
 * into one image, eg. ORM from three greyscale maps, or AO multiplied into the albedo with
 * roughness in alpha (p303's LITE).
 *
 * Order of work, so that resizing never filters what it shouldn't:
 * - Each channel is computed at the pack size (`pack.size`, else the sources' common size):
 *   decode (sRGB → linear), remap, invert, multiply. Then it is resized to the output size.
 * - A `normal` source is resized as unit vectors on its own, straight to the output size, and
 *   its channels are taken from that (then inverted, if asked). Packing first would lose its Z
 *   (eg. LITE's `normalHeight` keeps only X and Y), which the renormalization needs.
 * - A `cavity` (p303 D2) turns a height channel into an AO term at the pack size, after `remap`
 *   and `invert`, before `multiply` (a multiply factor's own `cavity` too).
 */

/**
 * Bump when what a `cavity` writes changes: the key of every pack that uses one has it
 * ({@link getPackKeyParams}), so only those encode again.
 */
export const PACK_CAVITY_VERSION = 1;

/**
 * A `cavity`'s defaults (`PackCavitySchema`): sigma 24 px at the pack size, strength 4. Fitted to
 * ambientCG Ground080's 2K scan, whose own AO it was compared with (p303 Phase 2 section 3): a
 * mean of 0.91 against the scan's 0.88, correlation 0.76 (sigma 8: 0.67). Slightly lighter, since
 * it stacks with screen-space AO (D2). A 1K source wants about half the radius.
 */
export const PACK_CAVITY_DEFAULTS = { radius: 24, strength: 4 };

/** Turns a pack `src` into an absolute file path; throws when it can't be used. */
export type PackFileResolver = (src: string) => string;

type PackChannel = Exclude<
  NonNullable<TexturePack['channels'][keyof TexturePack['channels']]>,
  number
>;

/** `buildPackedImage`'s options: how a `src` resolves, the colour space and the output size */
export type PackBuildOpts = {
  resolveFile: PackFileResolver;
  /** The texture is sRGB (texOpts.colorSpace): its colour channels' sources default to sRGB */
  isSrgb: boolean;
  /** The output size for the pack size (default: the pack size, no resize) */
  getSize?: (width: number, height: number) => { width: number; height: number };
};

/** The pack's targets in channel order, with the letters each one fills */
const listTargets = (pack: TexturePack) =>
  PACK_TARGETS.filter((target) => pack.channels[target] !== undefined)
    .map((target) => ({ target, spec: pack.channels[target]! }))
    .sort((a, b) => 'rgba'.indexOf(a.target[0]) - 'rgba'.indexOf(b.target[0]));

/** Every source file a pack reads, as written in the JSON */
export const listPackFiles = (pack: TexturePack) => {
  const files = new Set<string>();
  for (const { spec } of listTargets(pack)) {
    if (typeof spec === 'number') continue;
    files.add(spec.src);
    if (typeof spec.multiply === 'object') files.add(spec.multiply.src);
  }
  return [...files];
};

/** Whether a pack derives a cavity term anywhere (a channel's or a multiply factor's) */
const usesCavity = (pack: TexturePack) =>
  listTargets(pack).some(
    ({ spec }) =>
      typeof spec !== 'number' &&
      (!!spec.cavity || (typeof spec.multiply === 'object' && !!spec.multiply.cavity))
  );

/**
 * A pack as a cache key has it: the pack, and {@link PACK_CAVITY_VERSION} when it uses a
 * `cavity` (so the keys of the packs without one didn't change)
 */
export const getPackKeyParams = (pack: TexturePack) => ({
  pack,
  ...(usesCavity(pack) ? { cavity: PACK_CAVITY_VERSION } : {}),
});

/** The pack's output channel count: its targets cover r, rg, rgb or rgba (the schema checks it) */
export const getPackChannelCount = (pack: TexturePack) =>
  listTargets(pack).reduce((count, { target }) => count + target.length, 0);

const remapInPlace = (planes: Img[], remap: NonNullable<PackChannel['remap']>) => {
  let [min, max] = remap === 'auto' ? [Infinity, -Infinity] : remap;
  if (remap === 'auto') {
    for (const plane of planes) {
      for (const v of plane.data) {
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
    }
  }
  for (const plane of planes) {
    for (let i = 0; i < plane.data.length; i++) {
      plane.data[i] = (plane.data[i] - min) / (max - min || 1);
    }
  }
};

/** One box blur pass along rows (`isVertical` false) or columns, wrapping at the edges */
const boxBlurPass = (
  src: Float32Array,
  dst: Float32Array,
  w: number,
  h: number,
  b: number,
  isVertical: boolean
) => {
  const [lines, length, step] = isVertical ? [w, h, w] : [h, w, 1];
  const lineStep = isVertical ? 1 : w;
  const size = 2 * b + 1;
  for (let line = 0; line < lines; line++) {
    const start = line * lineStep;
    const at = (i: number) => src[start + (((i % length) + length) % length) * step];
    let sum = 0;
    for (let i = -b; i <= b; i++) sum += at(i);
    for (let i = 0; i < length; i++) {
      dst[start + i * step] = sum / size;
      sum += at(i + b + 1) - at(i - b);
    }
  }
};

/**
 * A Gaussian blur of a one-channel image (sigma `radius` px) as three box passes each way,
 * wrapping at the edges: a tiling map's crevice at one edge sees the other side.
 */
export const blurWrapped = (plane: Img, radius: number): Img => {
  const { width: w, height: h } = plane;
  // Three boxes of width wb have variance 3 × (wb² − 1) / 12 = sigma²
  const b = Math.max(0, Math.round((Math.sqrt(4 * radius * radius + 1) - 1) / 2));
  let a = Float32Array.from(plane.data);
  let c = new Float32Array(a.length);
  if (b > 0) {
    for (const isVertical of [false, true]) {
      for (let pass = 0; pass < 3; pass++) {
        boxBlurPass(a, c, w, h, b, isVertical);
        [a, c] = [c, a];
      }
    }
  }
  return { ...plane, data: a };
};

/**
 * A height plane's cavity term (p303 D2), in place: `1 − strength × max(0, blur(h) − h)`, `h`
 * normalized to 0..1 first, clamped to 0..1.
 */
export const applyCavity = (plane: Img, cavity: { radius?: number; strength?: number }) => {
  const radius = cavity.radius ?? PACK_CAVITY_DEFAULTS.radius;
  const strength = cavity.strength ?? PACK_CAVITY_DEFAULTS.strength;
  remapInPlace([plane], 'auto');
  const blurred = blurWrapped(plane, radius).data;
  for (let i = 0; i < plane.data.length; i++) {
    const depth = Math.max(0, blurred[i] - plane.data[i]);
    plane.data[i] = Math.min(1, Math.max(0, 1 - strength * depth));
  }
};

/**
 * Builds the packed image, linear values. Throws for a source that can't be read, sources of
 * different sizes without `pack.size`, and a channel the source doesn't have (alpha).
 */
export const buildPackedImage = async (pack: TexturePack, opts: PackBuildOpts): Promise<Img> => {
  const targets = listTargets(pack);

  const sources = new Map<string, SourceImage>();
  for (const src of listPackFiles(pack)) {
    const file = opts.resolveFile(src);
    try {
      sources.set(src, await readSourceImage(file));
    } catch (error) {
      throw new Error(`pack source "${src}" can't be read: ${(error as Error).message}`);
    }
  }

  const sizes = [...sources.entries()].map(([src, image]) => ({ src, ...image }));
  let packWidth = pack.size?.[0];
  let packHeight = pack.size?.[1];
  if (!packWidth || !packHeight) {
    if (!sizes.length) throw new Error('a pack of constants only needs a "size"');
    const [first] = sizes;
    const other = sizes.find((s) => s.width !== first.width || s.height !== first.height);
    if (other) {
      throw new Error(
        `the pack sources differ in size ("${first.src}" ${first.width}×${first.height}, "${other.src}" ${other.width}×${other.height}): set "size"`
      );
    }
    packWidth = first.width;
    packHeight = first.height;
  }
  const out = opts.getSize?.(packWidth, packHeight) ?? { width: packWidth, height: packHeight };

  const getSampleIndexOf = (src: string, letter: string) => {
    const index = getSampleIndex(sources.get(src)!, letter);
    if (index < 0) {
      throw new Error(
        `"${src}" has no alpha channel: name the channel to take ("channel"), or use a constant`
      );
    }
    return index;
  };

  /** A source channel at the pack size */
  const readPlane = (src: string, letter: string, isSrgb: boolean) => {
    const image = sources.get(src)!;
    const plane = extractChannel(image, getSampleIndexOf(src, letter), isSrgb && letter !== 'a');
    return image.width === packWidth && image.height === packHeight
      ? plane
      : resizeImage(plane, packWidth!, packHeight!);
  };

  const normals = new Map<string, Img>();
  const getNormal = (src: string) => {
    let normal = normals.get(src);
    if (!normal) {
      const image = sources.get(src)!;
      if (image.channels < 3)
        throw new Error(`"${src}" is a normal map with fewer than 3 channels`);
      normal = resizeImage(extractChannels(image, 3), out.width, out.height, true);
      normals.set(src, normal);
    }
    return normal;
  };

  const channelCount = getPackChannelCount(pack);
  const result = createImage(out.width, out.height, channelCount);
  const setChannel = (channel: number, plane: Img) => {
    for (let i = 0; i < plane.data.length; i++)
      result.data[i * channelCount + channel] = plane.data[i];
  };

  for (const { target, spec } of targets) {
    const first = 'rgba'.indexOf(target[0]);

    if (typeof spec === 'number') {
      const plane = createImage(out.width, out.height, 1);
      plane.data.fill(spec);
      for (let c = 0; c < target.length; c++) setChannel(first + c, plane);
      continue;
    }

    const letters = spec.channel ?? target;
    if (spec.normal) {
      const normal = getNormal(spec.src);
      for (let c = 0; c < target.length; c++) {
        const index = 'rgb'.indexOf(letters[c]);
        const plane = createImage(out.width, out.height, 1);
        for (let i = 0; i < plane.data.length; i++) {
          const v = normal.data[i * 3 + index];
          plane.data[i] = spec.invert ? 1 - v : v;
        }
        setChannel(first + c, plane);
      }
      continue;
    }

    // Each target channel decodes as sRGB by default when it's a colour channel of an sRGB texture
    const planes = [...letters].map((letter, c) => {
      const isSrgb = spec.colorSpace
        ? spec.colorSpace === 'srgb'
        : opts.isSrgb && target[c] !== 'a';
      return readPlane(spec.src, letter, isSrgb);
    });
    if (spec.remap) remapInPlace(planes, spec.remap);
    if (spec.invert) {
      for (const plane of planes) {
        for (let i = 0; i < plane.data.length; i++) plane.data[i] = 1 - plane.data[i];
      }
    }
    if (spec.cavity) for (const plane of planes) applyCavity(plane, spec.cavity);
    if (spec.multiply !== undefined) {
      const { multiply } = spec;
      const factor =
        typeof multiply === 'number'
          ? null
          : readPlane(multiply.src, multiply.channel ?? 'r', false);
      if (factor && typeof multiply === 'object' && multiply.cavity) {
        applyCavity(factor, multiply.cavity);
      }
      const strength = typeof multiply === 'number' ? 1 : multiply.strength ?? 1;
      for (const plane of planes) {
        for (let i = 0; i < plane.data.length; i++) {
          const m = factor ? factor.data[i] : (multiply as number);
          plane.data[i] = plane.data[i] * (1 + (m - 1) * strength);
        }
      }
    }
    planes.forEach((plane, c) => setChannel(first + c, resizeImage(plane, out.width, out.height)));
  }
  return result;
};
