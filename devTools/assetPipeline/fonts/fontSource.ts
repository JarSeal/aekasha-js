import fs from 'fs';
import path from 'path';
import {
  FONT_DEFAULTS,
  type FontAsset,
  type FontCharsetPreset,
  type FontType,
} from '../../../src/_engine/schemas';
import { getFontLogicalPath } from '../outputs';
import { toRepoPath } from '../sources';
import { getRequestedCharsetHash, resolveRequestedCharset } from './charset';

/**
 * A font's source for the pipeline (p391 D2, D3): its JSON with the defaults filled in, its font
 * file and the files its charset reads. Light: the cache key is made from it without loading
 * fontkit or msdfgen-wasm (the encode `import()`s them, `encodeFont.ts`).
 */

/**
 * Bump when the font encoder's code changes what it writes for the same inputs (the true SDF,
 * the packer, the layout's format). Every font then encodes once more.
 */
export const FONT_ENCODER_VERSION = 1;

/** A font JSON with every default filled in */
export type ResolvedFont = {
  type: FontType;
  size: number;
  pxRange: number;
  charset: {
    presets: FontCharsetPreset[];
    chars: string;
    /** As written (relative to the JSON) */
    charsFromFiles: string[];
    collectFromScenes: boolean;
  };
  fallbackGlyph: string;
  kerning: boolean;
  atlas: { maxSize: number; padding: number; pot: boolean };
};

/** A font asset's source: what its encode reads */
export type FontSource = {
  kind: 'font';
  /** The font JSON, absolute */
  jsonFile: string;
  /** The font file, absolute */
  file: string;
  /** The font file, '/'-separated from the repo root */
  repoPath: string;
  font: ResolvedFont;
  /** `charset.charsFromFiles`, absolute, in the JSON's order */
  charsFiles: string[];
};

/** What a font's encode made: kept in its lock entry and the run's stats */
export type FontEncodeStats = {
  type: FontType;
  /** The layout's glyphs (with no ink included) */
  glyphs: number;
  /** Requested characters the font lacks */
  missing: number;
  /** The layout's kerning pairs */
  kerningPairs: number;
  /** Glyphs whose contours overlap (their alpha is off inside near an overlap) */
  overlaps: number;
  atlas: { width: number; height: number; channels: 1 | 4 };
};

/** A font JSON with its defaults: a font without `charset` gets ASCII, a `charset` without
 * `presets` none */
export const resolveFont = (data: FontAsset): ResolvedFont => {
  const charset = data.charset;
  const defaults = FONT_DEFAULTS;
  return {
    type: data.type ?? defaults.type,
    size: data.size ?? defaults.size,
    pxRange: data.pxRange ?? defaults.pxRange,
    charset: {
      presets: [...(charset ? charset.presets ?? [] : defaults.charset.presets)],
      chars: charset?.chars ?? defaults.charset.chars,
      charsFromFiles: [...(charset?.charsFromFiles ?? defaults.charset.charsFromFiles)],
      collectFromScenes: charset?.collectFromScenes ?? defaults.charset.collectFromScenes,
    },
    fallbackGlyph: data.fallbackGlyph ?? defaults.fallbackGlyph,
    kerning: data.kerning ?? defaults.kerning,
    atlas: {
      maxSize: data.atlas?.maxSize ?? defaults.atlas.maxSize,
      padding: data.atlas?.padding ?? defaults.atlas.padding,
      pot: data.atlas?.pot ?? defaults.atlas.pot,
    },
  };
};

/**
 * A font JSON's source, or `{ error }` when its font file or a `charsFromFiles` file isn't there
 * (the font is left out of the run, and the gather reports it).
 * @param jsonFile The font JSON, absolute
 */
export const createFontSource = (
  jsonFile: string,
  data: FontAsset
): FontSource | { error: string } => {
  const dir = path.dirname(jsonFile);
  const file = path.resolve(dir, data.fileName);
  if (!fs.existsSync(file)) return { error: `its font file ${toRepoPath(file)} doesn't exist` };
  const font = resolveFont(data);
  const charsFiles = font.charset.charsFromFiles.map((name) => path.resolve(dir, name));
  const missing = charsFiles.find((charsFile) => !fs.existsSync(charsFile));
  if (missing) return { error: `its charsFromFiles file ${toRepoPath(missing)} doesn't exist` };
  return { kind: 'font', jsonFile, file, repoPath: toRepoPath(file), font, charsFiles };
};

/** Every file a font's encode reads: the font, then its charset's files */
export const listFontFiles = (source: FontSource) => [source.file, ...source.charsFiles];

/**
 * A font encode's cache key params (with {@link listFontFiles}' bytes and the tools' versions):
 * the resolved JSON, the requested characters' hash (D3; a `charsFromFiles` file is in the key's
 * files too), the encoder's version and the outputs' logical path. Throws like
 * `resolveRequestedCharset` (a `charsFromFiles` JSON that doesn't parse).
 */
export const getFontKeyParams = (source: FontSource) => ({
  kind: 'font',
  font: source.font,
  charset: getRequestedCharsetHash(resolveRequestedCharset(source)),
  encoder: FONT_ENCODER_VERSION,
  output: getFontLogicalPath(source.jsonFile, 'layout'),
});
