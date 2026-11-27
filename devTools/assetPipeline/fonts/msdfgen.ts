import fs from 'fs';
import { createRequire } from 'module';

/**
 * msdfgen-wasm (p391 D1: the MSDF's RGB): Chlumsky's msdfgen in WebAssembly, loaded in Node
 * through `createRequire` of its CommonJS entry (its ES entry's imports have no extensions, which
 * Node's ESM can't resolve) and its `.wasm` from `msdfgen-wasm/wasm`. Its own typings aren't
 * reachable (its `exports` names no `types`), so the members used are declared here.
 */

/** A glyph msdfgen-wasm loaded: em units (the em is 1), y up */
export type MsdfGlyph = {
  unicode: number;
  index: number;
  advance: number;
  left: number;
  bottom: number;
  right: number;
  top: number;
};

/** A glyph's tile and projection (`computeGlpyhMsdfData`): `scale` px per em, `range` in em, the
 * tile `width` × `height` px (0 × 0 for a glyph with no ink) */
export type MsdfData = {
  scale: number;
  xTranslate: number;
  yTranslate: number;
  range: number;
  width: number;
  height: number;
  edgeColoring: 'simple' | 'inktrap' | 'distance';
  edgeThresholdAngle: number;
  scanline: boolean;
};

/** One msdfgen-wasm instance: one font at a time */
export type Msdfgen = {
  loadFont(data: Uint8Array): void;
  /** Glyph index 0 (the font lacks it) is skipped without a word */
  loadGlyphs(characters: number[], options?: { preprocess: boolean }): void;
  readonly glyphs: readonly MsdfGlyph[];
  /** `range` is the full width in px, as the font's `pxRange` (msdfgen-wasm's typo kept) */
  computeGlpyhMsdfData(glyph: MsdfGlyph, options: { size: number; range: number }): MsdfData;
  /** RGBA, rows top first (the wrapper flips msdfgen's), A = 255 */
  generateBitmap(
    glyph: MsdfGlyph,
    config: MsdfData
  ): { width: number; height: number; buffer: ArrayBufferLike };
};

type MsdfgenModule = { Msdfgen: { create(wasm: ArrayBufferLike): Promise<Msdfgen> } };

let wasmBytes: Uint8Array | null = null;

/**
 * A new msdfgen-wasm instance (about 6 ms): one per encode, so a font's glyphs and the module's
 * memory go with it. The `.wasm` is read once per process.
 */
export const createMsdfgenAsync = async (): Promise<Msdfgen> => {
  const require = createRequire(import.meta.url);
  const { Msdfgen } = require('msdfgen-wasm') as MsdfgenModule;
  wasmBytes ??= new Uint8Array(fs.readFileSync(require.resolve('msdfgen-wasm/wasm')));
  return Msdfgen.create(wasmBytes.slice().buffer);
};
