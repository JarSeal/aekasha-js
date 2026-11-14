// The rain ripple atlas (p304 D4): a grid of drops in one tileable RGBA8 texture, baked once, from
// which a wet surface's material (p307) makes expanding rings with a few ALU a sample:
// `decodeRippleAtlas` turns a sample and a time into the rings' normal offset. The texture holds
// where each texel is in its drop's ring (not a ring at one moment), so the rings expand smoothly
// at any speed from one texture.
import { clamp, float, fract, length, max, sin, smoothstep, vec4 } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node } from 'three/webgpu';
import { bakeTexture, type BakedTexture } from 'aekasha';
import { hash12, hash22 } from '../nodes/noise/Hash';

/** The bake's output: the texture is `bake.textures.data`, registered as `<id>.data`. */
const RIPPLE_ATLAS_OUTPUT = 'data';

/** How far a drop lands from its cell's centre at most, in cells. */
const DROP_JITTER = 0.15;
/** A ring's largest radius, in cells: with the jitter, it ends just inside its cell (the atlas
 * tiles, no ring is cut, and the cells' border texels are empty). */
const RING_RADIUS = 0.5 - DROP_JITTER - 0.02;
/** The share of the radius around a drop's centre over which the direction fades in (it has none
 * at the centre). */
const CENTRE_FADE = 0.08;
/** The mask under which the direction fades out towards the ring's largest radius. */
const RIM_FADE = 0.04;

/** What {@link bakeRippleAtlas} bakes. */
export type BakeRippleAtlasOpts = {
  /** The bake's id: the texture is registered as `<id>.data`. Default `rippleAtlas`. */
  id?: string;
  /** The side in texels, a whole number (a power of two for mips and the KTX2 export). Default
   * 256. */
  size?: number;
  /** The drops along a side, 1 to 16: `cells`² drops a tile. Default 4. */
  cells?: number;
  /** Another seed gives other drop positions and times, a whole number. Default 0. */
  seed?: number;
  /** The texture's anisotropic filtering, or `MAX`. Default 1. */
  anisotropy?: number | 'MAX';
  /** Never released with its scene. */
  isPersistent?: boolean;
};

/** How {@link decodeRippleAtlas} shapes the rings. */
export type DecodeRippleAtlasOpts = {
  /** The share of a ring's largest radius its wave train spans behind the front, above 0. Default
   * 0.33. */
  width?: number;
  /** The half waves in the train: 1 is one crest, 3 a crest, a trough and a crest. Default 3. */
  halfWaves?: number;
};

/** A ripple atlas sample's rings at a time, from {@link decodeRippleAtlas}. */
export type RippleRings = {
  /** The rings' normal offset in the texture's plane: x along +u, y along +v, each in −1..1, zero
   * off the rings. Scale it and add it to a tangent-space normal's xy. */
  normalXY: Node<'vec2'>;
  /** The rings' strength, 0..1 (0 off them): for a roughness or highlight change. */
  mask: Node<'float'>;
};

const checkRange = (value: number, what: string, min: number, max: number) => {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(
      `bakeRippleAtlas: the ${what} ${value} isn't a whole number from ${min} to ${max}.`
    );
  }
};

const checkOpts = (size: number, cells: number, seed: number) => {
  checkRange(size, 'size', 4, 8192);
  checkRange(cells, 'cells', 1, 16);
  checkRange(seed, 'seed', 0, 0xffffffff);
  if (size / cells < 8) {
    throw new Error(
      `bakeRippleAtlas: ${cells} cells across ${size} texels leave a drop under 8 texels.`
    );
  }
};

/**
 * The ripple atlas's graph at `uv` (a tile per unit), its channels as {@link bakeRippleAtlas}
 * describes them.
 * @internal
 */
export const buildRippleAtlas = (
  uv: Node<'vec2'>,
  { cells, seed }: { cells: number; seed: number }
): Node<'vec4'> => {
  const p = uv.mul(cells) as Node<'vec2'>;
  const centre = hash22(p, { period: cells, seed: (seed * 2) >>> 0 })
    .sub(0.5)
    .mul(DROP_JITTER * 2)
    .add(0.5);
  const offset = fract(p).sub(centre) as Node<'vec2'>;
  const distance = length(offset);
  /** 0 at the drop, 1 at the ring's largest radius */
  const radius = distance.div(RING_RADIUS);
  const mask = clamp(float(1).sub(radius), 0, 1);
  // Outwards from the drop, fading in from its centre and out at the rim: none past the largest
  // radius, and no step there for the mips to smear
  const direction = offset
    .div(max(distance, 1e-5))
    .mul(smoothstep(0, CENTRE_FADE, radius))
    .mul(smoothstep(0, RIM_FADE, mask));
  const timeOffset = hash12(p, { period: cells, seed: (seed * 2 + 1) >>> 0 });
  return vec4(direction.mul(0.5).add(0.5), mask, timeOffset) as unknown as Node<'vec4'>;
};

/**
 * Bakes the rain ripple atlas: a grid of drops (`cells` × `cells`, each somewhere near its cell's
 * centre) in one mipmapped RGBA8 texture (`bake.textures.data`, linear, `REPEAT`) that tiles.
 * {@link decodeRippleAtlas} makes the expanding rings from a sample of it.
 *
 * - **RG**: the direction away from the texel's drop (x along +u, y along +v), as `× 0.5 + 0.5`:
 *   the ring's normal offset. 0.5 (none) off the drop's reach.
 * - **B**: the ring mask, 1 at the drop falling to 0 at the ring's largest radius (0.33 of a
 *   cell): where the texel is along the ring's way out.
 * - **A**: the cell's time offset in [0, 1), the same over the whole cell, so the drops don't land
 *   together.
 * @param opts the id, the size, the cells and the seed
 * @returns the bake, once rendered (see `bakeTexture`: at once during a scene load, else queued)
 * @throws (rejects) for a size, cell count or seed out of range, or what `bakeTexture` refuses
 * @remarks A call with the id of a bake that's alive returns that bake (`bakeTexture`'s rule), its
 * options ignored. Uncompressed: 256² is about 0.35 MB with its mips (`bake.memoryBytes`). Its
 * small mips mix neighbouring drops' times: it's close-up detail, so fade the rings out with
 * distance.
 * @example
 * ```ts
 * import { texture, uniform, uv } from 'three/tsl';
 * import type { Node } from 'three/webgpu';
 * import { bakeRippleAtlas, decodeRippleAtlas } from 'aekasha/toolkit/terrain';
 *
 * const atlas = await bakeRippleAtlas();
 * const time = uniform(0); // the seconds / a ring's lifetime, set every frame
 * const sampleAt = (scale: number, offset: number) =>
 *   texture(atlas.textures.data, uv().mul(scale).add(offset)) as unknown as Node<'vec4'>;
 * // Two samples at other scales and times, so the grid doesn't show
 * const a = decodeRippleAtlas(sampleAt(3, 0), time);
 * const b = decodeRippleAtlas(sampleAt(4.3, 0.37), time.add(0.5));
 * const rippleXY = a.normalXY.add(b.normalXY).mul(0.4);
 * ```
 */
export const bakeRippleAtlas = async (opts: BakeRippleAtlasOpts = {}): Promise<BakedTexture> => {
  const size = opts.size ?? 256;
  const cells = opts.cells ?? 4;
  const seed = opts.seed ?? 0;
  checkOpts(size, cells, seed);
  return bakeTexture({
    id: opts.id ?? 'rippleAtlas',
    size,
    outputs: [{ name: RIPPLE_ATLAS_OUTPUT, colorSpace: 'LINEAR' }],
    anisotropy: opts.anisotropy,
    isPersistent: opts.isPersistent,
    build: ({ uv }) => ({ [RIPPLE_ATLAS_OUTPUT]: buildRippleAtlas(uv, { cells, seed }) }),
  });
};

/**
 * The expanding rings of a ripple atlas sample at a time: each drop's ring starts at its centre,
 * runs out to its largest radius over one unit of `time` and fades on the way, then the drop lands
 * again; every cell at its own offset. A few ALU, no fetch (the sample is the caller's).
 * @param sample a sample of {@link bakeRippleAtlas}'s texture (linear, as it is)
 * @param time the time in ring lifetimes (seconds / the seconds a ring lives); only its fraction
 * counts
 * @param opts the wave train's shape
 * @returns the rings' normal offset and strength
 * @throws for a `width` or `halfWaves` of 0 or less
 * @remarks For a look that's the same on every run (a snapshot, a replay), feed `time` from a
 * clock of your own, never three's `time` node.
 * @example
 * ```ts
 * import { texture, uniform, uv } from 'three/tsl';
 * import type { Node } from 'three/webgpu';
 * import { bakeRippleAtlas, decodeRippleAtlas } from 'aekasha/toolkit/terrain';
 *
 * const atlas = await bakeRippleAtlas();
 * const time = uniform(0);
 * const sample = texture(atlas.textures.data, uv().mul(3)) as unknown as Node<'vec4'>;
 * const rings = decodeRippleAtlas(sample, time);
 * // One crest per ring, thinner
 * const thin = decodeRippleAtlas(sample, time, { width: 0.15, halfWaves: 1 });
 * ```
 */
export const decodeRippleAtlas = (
  sample: Node<'vec4'>,
  time: Node<'float'> | number,
  opts: DecodeRippleAtlasOpts = {}
): RippleRings => {
  const { width = 0.33, halfWaves = 3 } = opts;
  if (!(width > 0) || !(halfWaves > 0)) {
    throw new Error(
      `decodeRippleAtlas: width (${width}) and halfWaves (${halfWaves}) must be above 0.`
    );
  }
  const mask = sample.z as Node<'float'>;
  /** The ring's age: 0 as the drop lands, 1 as the ring reaches its largest radius */
  const age = fract(sample.w.add(time));
  /** How far behind the ring's front the texel is, in radii: under 0 ahead of it */
  const behind = age.sub(float(1).sub(mask));
  const wave = sin(clamp(behind.div(width), 0, 1).mul(halfWaves * Math.PI));
  // Fading as the ring ages, and to nothing at its largest radius
  const strength = wave.mul(float(1).sub(age)).mul(mask) as Node<'float'>;
  const direction = (sample.xy as Node<'vec2'>).mul(2).sub(1);
  return {
    normalXY: direction.mul(strength) as Node<'vec2'>,
    mask: strength.abs() as Node<'float'>,
  };
};
