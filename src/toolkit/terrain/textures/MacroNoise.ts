// The macro noise texture (p304 D4): four tileable noises in one RGBA8 texture, baked once, which
// a terrain material samples at large world scales (a tile over tens to hundreds of metres) to
// break up its layers' repetition: one fetch for all of them.
import { mix, smoothstep, vec2, vec4 } from 'three/tsl';
// The real generic `Node<T>` typings (the `three/tsl` `Node` is a loose local shim)
import type { Node } from 'three/webgpu';
import { bakeTexture, type BakedTexture } from 'aekasha';
import { hash12 } from '../nodes/noise/Hash';
import { domainWarp, fbm } from '../nodes/noise/Noise';
import { worley } from '../nodes/noise/Worley';

/** The bake's output: the texture is `bake.textures.data`, registered as `<id>.data`. */
const MACRO_NOISE_OUTPUT = 'data';

/** The fbm cells across the tile of R and of G (other counts, so the two don't line up). */
const BRIGHTNESS_CELLS = 4;
const VARIATION_CELLS = 6;
/** The patches across the tile (B). */
const PATCH_CELLS = 5;
/** An fbm stays mostly within ±0.5: stretched to use the byte's range. */
const FBM_CONTRAST = 1.8;
/** How far from a patch's border (in `f2 − f1`, cells) its level has faded to the neutral 0.5. */
const PATCH_EDGE = 0.25;

/** What {@link bakeMacroNoise} bakes. */
export type BakeMacroNoiseOpts = {
  /** The bake's id: the texture is registered as `<id>.data`. Default `macroNoise`. */
  id?: string;
  /** The side in texels, a whole number (a power of two for mips and the KTX2 export). Default
   * 512. */
  size?: number;
  /** Another seed gives another texture, a whole number. Default 0. */
  seed?: number;
  /** The texture's anisotropic filtering, or `MAX`. Default 1. */
  anisotropy?: number | 'MAX';
  /** Never released with its scene. */
  isPersistent?: boolean;
};

const checkWhole = (value: number, what: string, min: number) => {
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`bakeMacroNoise: the ${what} ${value} isn't a whole number of ${min} or more.`);
  }
};

const toUnit = (n: Node<'float'>) => n.mul(0.5).add(0.5) as Node<'float'>;

/**
 * The macro noise's graph at `uv` (a tile per unit), its four channels as {@link bakeMacroNoise}
 * describes them.
 * @internal
 */
export const buildMacroNoise = (
  uv: Node<'vec2'>,
  { size, seed }: { size: number; seed: number }
): Node<'vec4'> => {
  checkWhole(size, 'size', 4);
  checkWhole(seed, 'seed', 0);
  // A seed of its own per channel (and per seed: 8 apart)
  const seedOf = (channel: number) => (seed * 8 + channel) >>> 0;

  const brightness = fbm(uv.mul(BRIGHTNESS_CELLS) as Node<'vec2'>, {
    period: BRIGHTNESS_CELLS,
    octaves: 5,
    seed: seedOf(0),
  });
  const variation = fbm(uv.mul(VARIATION_CELLS) as Node<'vec2'>, {
    period: VARIATION_CELLS,
    octaves: 4,
    seed: seedOf(1),
  });

  // Patches: each Worley cell's own level, faded to the neutral 0.5 towards its border, the
  // borders bent by a warp, so any threshold cuts soft-edged patches out of it
  const warped = domainWarp(uv.mul(PATCH_CELLS) as Node<'vec2'>, {
    period: PATCH_CELLS,
    strength: 0.35,
    seed: seedOf(2),
  });
  const cells = worley(warped, { period: PATCH_CELLS, seed: seedOf(3) });
  const patches = mix(0.5, cells.cellId, smoothstep(0, PATCH_EDGE, cells.f2.sub(cells.f1)));

  // Blue-ish: a white noise per texel with its low frequencies taken out (the texel less its
  // 3 × 3 neighbourhood's weighted mean), around 0.5
  const texelAt = uv.mul(size) as Node<'vec2'>;
  const white = (x: number, y: number) =>
    hash12(texelAt.add(vec2(x, y)) as Node<'vec2'>, { period: size, seed: seedOf(4) });
  const edges = white(1, 0).add(white(-1, 0)).add(white(0, 1)).add(white(0, -1));
  const corners = white(1, 1).add(white(-1, 1)).add(white(1, -1)).add(white(-1, -1));
  const highPassed = white(0, 0).sub(edges.mul(2).add(corners).div(12));

  return vec4(
    toUnit(brightness.mul(FBM_CONTRAST) as Node<'float'>),
    toUnit(variation.mul(FBM_CONTRAST) as Node<'float'>),
    patches,
    toUnit(highPassed as Node<'float'>)
  ) as unknown as Node<'vec4'>;
};

/**
 * Bakes the macro noise texture: four tileable noises in one mipmapped RGBA8 texture
 * (`bake.textures.data`, linear, `REPEAT`), for a terrain material to sample once at a large world
 * scale (a tile over 40 to 300 m) and vary all its layers with.
 *
 * - **R**: a broad fbm (4 cells a tile, 5 octaves), around 0.5: brightness.
 * - **G**: a second fbm of other cells and seed (6 a tile), unrelated to R: hue or roughness.
 * - **B**: patches, 5 a tile: each one's own level in 0..1, 0.5 along the borders, so a threshold
 *   cuts soft-edged patches (masks; mixing two tilings).
 * - **A**: a blue-ish noise per texel (white noise without its low frequencies), mean 0.5, not
 *   evenly spread (about ±0.15 around it): dithering, breaking up a rule's edge. Its mips fade to
 *   0.5, so sample it near one texel a pixel.
 * @param opts the id, the size and the seed
 * @returns the bake, once rendered (see `bakeTexture`: at once during a scene load, else queued)
 * @throws (rejects) for a size or a seed that isn't a whole number, or what `bakeTexture` refuses
 * @remarks A call with the id of a bake that's alive returns that bake (`bakeTexture`'s rule), its
 * options ignored. Uncompressed: 512² is about 1.4 MB with its mips (`bake.memoryBytes`).
 * @example
 * ```ts
 * import { texture, uv } from 'three/tsl';
 * import { bakeMacroNoise } from 'aekasha/toolkit/terrain';
 *
 * const macro = await bakeMacroNoise();
 * // One tile over 120 m of a ground whose uv is in metres: R darkens and lightens the albedo
 * // by ±15 %
 * const sample = texture(macro.textures.data, uv().div(120));
 * const brightness = sample.r.sub(0.5).mul(0.3).add(1);
 * ```
 */
export const bakeMacroNoise = async (opts: BakeMacroNoiseOpts = {}): Promise<BakedTexture> => {
  const size = opts.size ?? 512;
  const seed = opts.seed ?? 0;
  checkWhole(size, 'size', 4);
  checkWhole(seed, 'seed', 0);
  return bakeTexture({
    id: opts.id ?? 'macroNoise',
    size,
    outputs: [{ name: MACRO_NOISE_OUTPUT, colorSpace: 'LINEAR' }],
    anisotropy: opts.anisotropy,
    isPersistent: opts.isPersistent,
    build: ({ uv }) => ({ [MACRO_NOISE_OUTPUT]: buildMacroNoise(uv, { size, seed }) }),
  });
};
