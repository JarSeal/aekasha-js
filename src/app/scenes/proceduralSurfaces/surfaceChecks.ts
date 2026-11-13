// The procedural surfaces scene's checks (p304 Phase 4's exit), on the bytes read back from its
// bakes: each packing's slots are written as p303 D2 packs them (colour that varies, a height, a
// normal map facing out, an ORM with no metal), nothing steps across a slot's wrap past its
// largest step inside, and the surface repeats over whole tiles. Pure, so unit-tested.
import { getChannelStats, type ChannelStats } from '../../shared/channelStats';

/** A slot's channels summed up and what failed. */
export type SlotCheck = {
  /** The R, G, B and A channels' stats, 0..1. */
  channels: ChannelStats[];
  /** What failed, in words; empty when the slot passes. */
  failures: string[];
};

/** The periodicity check's result: how many texels differ a whole tile away, and by how much. */
export type PeriodicityCheck = {
  /** The largest byte of `|slot(uv) − slot(uv + whole tiles)| × 100`, over every channel. */
  maxByte: number;
  /** The texels where any channel's byte is past the tolerance. */
  offTexels: number;
  failures: string[];
};

/** A channel that varies: its spread is at least this (1 byte). */
export const MIN_SPREAD = 1 / 255;
/** The wrap may step this much (2 bytes) past the largest step inside: 8-bit rounding. */
export const SEAM_TOLERANCE = 2 / 255;
/** A periodicity byte past this is off (0.0004: float noise at a tile's distance). */
export const PERIODICITY_BYTE = 4;
/**
 * The share of the texels that may be off: a texel within float precision of a Voronoi edge may
 * pick the other cell (its id, its colour) a whole tile away, so a few may jump.
 */
export const PERIODICITY_OFF_SHARE = 0.001;

const CHANNELS = ['R', 'G', 'B', 'A'];
const format = (value: number) => value.toFixed(3);

/** What a slot must hold, per channel: one that varies, a constant, or a range of its mean. */
type ChannelRule = 'varies' | { mean: [number, number] } | 'any';

/** p303 D2's packing by slot: the channels a bake of it writes. */
const SLOT_RULES: Record<string, ChannelRule[]> = {
  // RGB albedo, A height
  albedoHeight: ['varies', 'varies', 'varies', 'varies'],
  // RGB albedo × AO, A roughness (some surfaces' barely varies)
  albedoRough: ['varies', 'varies', 'varies', { mean: [0.02, 1] }],
  // The normal facing out: B (z) mostly high, A 1
  normal: ['varies', 'varies', { mean: [0.75, 1] }, { mean: [0.99, 1] }],
  // RG the normal's X and Y, B height, A 1
  normalHeight: ['varies', 'varies', 'varies', { mean: [0.99, 1] }],
  // R AO, G roughness, B metalness 0, A 1
  orm: [{ mean: [0.2, 1] }, { mean: [0.02, 1] }, { mean: [0, 0.002] }, { mean: [0.99, 1] }],
};

/**
 * Checks a slot's readback: each channel as its packing writes it, and no seam across the wrap.
 * @param slot the slot's name (`albedoRough`, `normal`, …)
 * @param bytes the slot's RGBA8 image, rows without padding
 * @param size its width and height in texels
 * @returns the channels' stats and the failures
 */
export const checkSurfaceSlot = (
  slot: string,
  bytes: ArrayLike<number>,
  size: number
): SlotCheck => {
  const rules = SLOT_RULES[slot];
  if (!rules) throw new Error(`[surfaceChecks] No rules for the slot "${slot}".`);
  const channels = rules.map((_, channel) => getChannelStats(bytes, size, size, channel));
  const failures: string[] = [];
  rules.forEach((rule, channel) => {
    const stats = channels[channel];
    const name = `${slot}.${CHANNELS[channel]}`;
    if (rule === 'varies' && stats.std < MIN_SPREAD) {
      failures.push(`${name} doesn't vary (σ ${format(stats.std)}): not written, or flat`);
    }
    if (typeof rule === 'object' && (stats.mean < rule.mean[0] || stats.mean > rule.mean[1])) {
      failures.push(`${name}'s mean ${format(stats.mean)} is outside ${rule.mean.join('–')}`);
    }
    if (stats.wrapStep > stats.neighbourStep + SEAM_TOLERANCE) {
      failures.push(
        `${name} has a seam: the wrap steps ${format(stats.wrapStep)}, the largest step inside ${format(stats.neighbourStep)}`
      );
    }
  });
  return { channels, failures };
};

/**
 * Checks the periodicity bakes' readbacks (`|slot(uv) − slot(uv + whole tiles)| × 100` per
 * channel): a texel is off when any channel's byte is past {@link PERIODICITY_BYTE}, and the
 * surface fails when more than {@link PERIODICITY_OFF_SHARE} of them are.
 * @param images the readbacks (RGBA8, the same size each)
 * @param texels the texels in each
 * @returns the largest byte, the off texels and the failures
 */
export const checkPeriodicity = (images: ArrayLike<number>[], texels: number): PeriodicityCheck => {
  let maxByte = 0;
  const off = new Uint8Array(texels);
  for (const bytes of images) {
    for (let i = 0; i < bytes.length; i++) {
      maxByte = Math.max(maxByte, bytes[i]);
      if (bytes[i] > PERIODICITY_BYTE) off[i >> 2] = 1;
    }
  }
  const offTexels = off.reduce((sum, value) => sum + value, 0);
  const failures =
    offTexels > texels * PERIODICITY_OFF_SHARE
      ? [
          `not periodic: ${offTexels} of ${texels} texels differ a whole tile away (up to ${maxByte} / 25500)`,
        ]
      : [];
  return { maxByte, offTexels, failures };
};

/** Two readbacks of one surface compared: the largest byte difference and the texels that differ. */
export type ImageComparison = {
  maxByte: number;
  offTexels: number;
};

/**
 * Compares two RGBA8 readbacks of the same size byte for byte (a procedural set's JSON bake and a
 * code bake of the same generator and values: the same graph, so equal).
 * @param a one readback
 * @param b the other
 * @returns the largest byte difference and the texels with any channel off
 */
export const compareImages = (a: ArrayLike<number>, b: ArrayLike<number>): ImageComparison => {
  if (a.length !== b.length) {
    throw new Error(`compareImages: ${a.length} bytes against ${b.length}.`);
  }
  let maxByte = 0;
  let offTexels = 0;
  for (let i = 0; i < a.length; i += 4) {
    let isOff = false;
    for (let c = 0; c < 4; c++) {
      const diff = Math.abs(a[i + c] - b[i + c]);
      maxByte = Math.max(maxByte, diff);
      if (diff) isOff = true;
    }
    if (isOff) offTexels++;
  }
  return { maxByte, offTexels };
};
