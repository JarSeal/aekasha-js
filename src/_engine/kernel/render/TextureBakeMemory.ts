// The texture baker's sizes and memory figures (p304 D1), on plain numbers: no three, so the unit
// tests and the handbook's VRAM figures read them without a renderer.

/**
 * A baked output's texel type: `UNSIGNED_BYTE` (RGBA8, 4 bytes a texel) or `HALF_FLOAT` (RGBA16F,
 * 8 bytes a texel).
 */
export type BakeOutputType = 'UNSIGNED_BYTE' | 'HALF_FLOAT';

/** What {@link getBakedTextureMemoryBytes} measures: a bake's size, outputs, layers and mips. */
export type BakedTextureMemoryOpts = {
  /** The texture's width and height in texels: one number for a square. */
  size: number | readonly [number, number];
  /** Each output's texel type (default `UNSIGNED_BYTE`): one texture each. */
  outputs: readonly { type?: BakeOutputType }[];
  /** The array layers of each texture. Default 1. */
  layers?: number;
  /** Whether the textures have their full mip chains. Default true. */
  mipmaps?: boolean;
};

const BYTES_PER_TEXEL: Record<BakeOutputType, number> = { UNSIGNED_BYTE: 4, HALF_FLOAT: 8 };

/**
 * A bake's `size` as width and height, or a throw naming the caller: each a whole number of at
 * least 1.
 * @internal
 */
export const getBakeSize = (size: number | readonly [number, number], caller: string) => {
  const [width, height] = typeof size === 'number' ? [size, size] : size;
  for (const side of [width, height]) {
    if (!Number.isInteger(side) || side < 1) {
      throw new Error(`${caller}: size must be whole numbers of at least 1 (got ${String(size)}).`);
    }
  }
  return { width, height };
};

/**
 * The texels of a `width` × `height` level and, with `mipmaps`, of every level below it down to
 * 1 × 1 (each side halved and rounded down, never under 1, as the GPU sizes them).
 * @internal
 */
export const getMipChainTexels = (width: number, height: number, mipmaps: boolean) => {
  let texels = width * height;
  if (!mipmaps) return texels;
  let w = width;
  let h = height;
  while (w > 1 || h > 1) {
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
    texels += w * h;
  }
  return texels;
};

/**
 * The GPU memory a texture bake takes, in bytes: every output's texture, with its layers and its
 * mip chain. Baked textures are uncompressed (a 1024² RGBA8 bake with mips is about 5.6 MB, a
 * `HALF_FLOAT` one twice that), where an exported KTX2 copy is block-compressed.
 * @example
 * ```ts
 * import { getBakedTextureMemoryBytes } from 'aekasha';
 *
 * const bytes = getBakedTextureMemoryBytes({ size: 1024, outputs: [{}, { type: 'HALF_FLOAT' }] });
 * console.log(`${(bytes / 2 ** 20).toFixed(1)} MiB`);
 * ```
 */
export const getBakedTextureMemoryBytes = (opts: BakedTextureMemoryOpts) => {
  const { width, height } = getBakeSize(opts.size, 'getBakedTextureMemoryBytes');
  const texels = getMipChainTexels(width, height, opts.mipmaps ?? true) * (opts.layers ?? 1);
  let bytes = 0;
  for (const output of opts.outputs)
    bytes += texels * BYTES_PER_TEXEL[output.type ?? 'UNSIGNED_BYTE'];
  return bytes;
};
