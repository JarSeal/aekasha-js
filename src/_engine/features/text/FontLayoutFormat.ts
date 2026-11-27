import type { FontType } from './FontSchema';

// A font's layout JSON (p391 D3), the asset pipeline's output beside the atlas: the one definition
// the encoder writes (`devTools/assetPipeline/fonts/layout.ts`) and the runtime's parse reads
// (`Fonts.ts`). Import-free (types only), so the encoder imports it from devTools
// (`devTools/engineImports.test.ts`). A change to what it holds bumps `FONT_LAYOUT_FORMAT`.

/**
 * The layout format's version: the encoder writes it, and the runtime refuses a layout of another.
 * @internal
 */
export const FONT_LAYOUT_FORMAT = 1;

/**
 * A glyph's entry: `[advance]` for a glyph with no ink (space), else `[advance, planeLeft,
 * planeBottom, planeRight, planeTop, atlasX, atlasY, atlasWidth, atlasHeight]`: the plane bounds
 * in em (y up, the tile's whole quad, its distance range included) and the tile in atlas pixels
 * from the top left, so `v = y / height` (no flip on either backend).
 * @internal
 */
export type FontLayoutGlyph =
  | [number]
  | [number, number, number, number, number, number, number, number, number];

/**
 * A font's layout JSON, minified: em values (the em is 1) rounded to 4 decimals, atlas pixels
 * whole, kerning in font units.
 * @internal
 */
export type FontLayout = {
  format: number;
  type: FontType;
  atlas: {
    /** The atlas's file name, beside the layout (both are a font's outputs) */
    file: string;
    width: number;
    height: number;
    /** The em's size in atlas pixels */
    size: number;
    /** The distance range in atlas pixels, its full width */
    pxRange: number;
  };
  metrics: {
    ascender: number;
    descender: number;
    lineHeight: number;
    /** The underline's centre */
    underlineY: number;
    underlineThickness: number;
  };
  /** The fallback glyph's code point */
  fallback: number;
  /** By code point, ascending */
  glyphs: Record<string, FontLayoutGlyph>;
  /** The font units the kerning amounts are in; absent without kerning */
  kerningUnitsPerEm?: number;
  /** By first code point: `[second, amount, second, amount, …]`, amounts in
   * `kerningUnitsPerEm`; absent without kerning */
  kerning?: Record<string, number[]>;
};
