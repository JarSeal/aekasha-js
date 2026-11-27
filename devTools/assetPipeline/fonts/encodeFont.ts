import fs from 'fs';
import path from 'path';
import { getFontBudgetWarnings } from '../budgets';
import { encodeKtx2Raw, type KtxProvider } from '../ktxEncode';
import { getFontLogicalPath, writeOutput, type PipelineOutput } from '../outputs';
import { resolveRequestedCharset, type RequestedCharset } from './charset';
import { getFontKerning, getFontMetrics, openFont } from './fontFile';
import type { FontEncodeStats, FontSource } from './fontSource';
import { buildFontLayout, type FontLayout, type FontLayoutGlyphInput } from './layout';
import { createMsdfgenAsync, type MsdfData, type MsdfGlyph } from './msdfgen';
import { flattenOutline, hasOverlappingContours, type OutlineCommand } from './outline';
import { packFontAtlas } from './pack';
import { generateTrueSdf } from './trueSdf';

/**
 * A font's encode (p391 D1-D3): fontkit reads the font (the refusals, the cmap, metrics,
 * advances, kerning), msdfgen-wasm makes each glyph's tile and its MSDF (RGB), the true SDF its
 * alpha (`MTSDF`) or its one channel (`SDF`), the skyline packer places the tiles, and the
 * outputs are written: the atlas (KTX2, uncompressed + zstd, one level) and the layout JSON naming
 * it. Loaded with a font's first encode (`pipeline.ts`' `import()`), with fontkit and the WASM.
 */

/** The curves' flattening for the true SDF: a hundredth of an atlas pixel (Phase 1's) */
const FLATTEN_TOLERANCE_PX = 0.01;

/** How many characters a warning names */
const NAMED_MAX = 20;

const formatCodePoint = (codePoint: number) =>
  `"${String.fromCodePoint(codePoint)}" U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;

/** Up to {@link NAMED_MAX} characters by name, and how many more */
const formatCodePoints = (codePoints: readonly number[]) => {
  const more = codePoints.length > NAMED_MAX ? ` and ${codePoints.length - NAMED_MAX} more` : '';
  return `${codePoints.slice(0, NAMED_MAX).map(formatCodePoint).join(', ')}${more}`;
};

/** The warnings for the requested characters the font lacks: the named ones by name, a preset's
 * counted (an unassigned code point of a block isn't news) */
const describeMissing = (requested: RequestedCharset, missing: Set<number>) => {
  const warnings: string[] = [];
  const named = [...missing].filter((codePoint) => requested.named.has(codePoint));
  if (named.length) warnings.push(`the font lacks ${formatCodePoints(named)}: left out`);
  for (const [preset, codePoints] of requested.presets) {
    const lacking = codePoints.filter(
      (codePoint) => missing.has(codePoint) && !requested.named.has(codePoint)
    ).length;
    if (lacking) {
      warnings.push(
        `the font lacks ${lacking} of ${preset}'s ${codePoints.length} characters: left out`
      );
    }
  }
  return warnings;
};

/** A placed tile: its glyph, its projection and where it goes */
type Tile = { codePoint: number; glyph: MsdfGlyph; data: MsdfData; x: number; y: number };

/** Copies a tile's rows (top first) into the atlas */
const blitTile = (
  atlas: Uint8Array,
  atlasWidth: number,
  channels: number,
  tile: Tile,
  pixels: Uint8Array
) => {
  const rowBytes = tile.data.width * channels;
  for (let row = 0; row < tile.data.height; row++) {
    atlas.set(
      pixels.subarray(row * rowBytes, (row + 1) * rowBytes),
      ((tile.y + row) * atlasWidth + tile.x) * channels
    );
  }
};

/** A font's atlas and layout before they're written: the atlas's pixels and the layout's input */
export type FontAtlas = {
  /** Rows top first, `channels` bytes per pixel */
  pixels: Uint8Array;
  width: number;
  height: number;
  channels: 1 | 4;
  /** The layout's input but the atlas's file name, known once the atlas is written */
  layout: Omit<Parameters<typeof buildFontLayout>[0], 'atlas'> & {
    atlas: Omit<FontLayout['atlas'], 'file'>;
  };
  stats: FontEncodeStats;
};

/**
 * Reads a font and makes its atlas's pixels and its layout's input: no `ktx`, nothing written.
 * Throws naming the problem: a file the encoder refuses (WOFF2, a collection, a variable font), a
 * fallback glyph the font lacks, or glyphs that don't fit on `atlas.maxSize`.
 * @param opts.collected The characters the scenes write with it (`collectFromScenes`)
 */
export const generateFontAtlasAsync = async (
  source: FontSource,
  opts: { warn: (message: string) => void; collected?: Iterable<number> }
): Promise<FontAtlas> => {
  const { font: def } = source;
  const bytes = new Uint8Array(fs.readFileSync(source.file));
  let font: ReturnType<typeof openFont>;
  try {
    font = openFont(bytes);
  } catch (error) {
    throw new Error(`${source.repoPath}: ${(error as Error).message}`);
  }

  // The characters: what's asked for, less what the font's cmap lacks
  const requested = resolveRequestedCharset(source, { collected: opts.collected });
  const fallback = def.fallbackGlyph.codePointAt(0) as number;
  const missing = new Set(
    requested.codePoints.filter(
      (codePoint) => !font.hasGlyphForCodePoint(codePoint) || !font.glyphForCodePoint(codePoint).id
    )
  );
  if (missing.has(fallback)) {
    throw new Error(
      `${source.repoPath} has no glyph for its fallbackGlyph ${formatCodePoint(fallback)}: pick one it has`
    );
  }

  const msdfgen = await createMsdfgenAsync();
  msdfgen.loadFont(bytes);
  msdfgen.loadGlyphs(
    requested.codePoints.filter((codePoint) => !missing.has(codePoint)),
    { preprocess: true }
  );
  const msdfGlyphs = new Map(msdfgen.glyphs.map((glyph) => [glyph.unicode, glyph]));
  for (const codePoint of requested.codePoints) {
    if (!msdfGlyphs.has(codePoint)) missing.add(codePoint);
  }
  for (const warning of describeMissing(requested, missing)) opts.warn(warning);

  // Each glyph's tile, then the page
  const em = font.unitsPerEm;
  const getAdvance = (codePoint: number) => font.glyphForCodePoint(codePoint).advanceWidth / em;
  const glyphs: FontLayoutGlyphInput[] = [];
  const tiles: Tile[] = [];
  for (const [codePoint, glyph] of msdfGlyphs) {
    const data = msdfgen.computeGlpyhMsdfData(glyph, { size: def.size, range: def.pxRange });
    if (data.width && data.height) tiles.push({ codePoint, glyph, data, x: 0, y: 0 });
    else glyphs.push({ codePoint, advance: getAdvance(codePoint) });
  }
  const packing = packFontAtlas(
    tiles.map(({ data }) => ({ width: data.width, height: data.height })),
    def.atlas
  );
  if ('error' in packing) throw new Error(`${source.repoPath}: ${packing.error}`);
  const { width, height } = packing;
  const channels = def.type === 'SDF' ? 1 : 4;
  const pixels = new Uint8Array(width * height * channels);

  // The fields: msdfgen's RGB, the true SDF in alpha (or alone)
  const overlapping: number[] = [];
  const tolerance = FLATTEN_TOLERANCE_PX / def.size;
  tiles.forEach((tile, i) => {
    Object.assign(tile, packing.places[i]);
    const { data, codePoint } = tile;
    let tilePixels: Uint8Array | null = null;
    if (def.type !== 'SDF') {
      tilePixels = new Uint8Array(msdfgen.generateBitmap(tile.glyph, data).buffer);
    }
    if (def.type !== 'MSDF') {
      const commands = font.glyphForCodePoint(codePoint).path.commands as OutlineCommand[];
      const contours = flattenOutline(commands, em, tolerance);
      if (hasOverlappingContours(contours)) overlapping.push(codePoint);
      const alpha = generateTrueSdf(contours, data, data.width, data.height);
      if (tilePixels) for (let p = 0; p < alpha.length; p++) tilePixels[p * 4 + 3] = alpha[p];
      else tilePixels = alpha;
    }
    blitTile(pixels, width, channels, tile, tilePixels as Uint8Array);
    glyphs.push({
      codePoint,
      advance: getAdvance(codePoint),
      tile: {
        plane: [
          -data.xTranslate,
          -data.yTranslate,
          data.width / data.scale - data.xTranslate,
          data.height / data.scale - data.yTranslate,
        ],
        atlas: [tile.x, tile.y, data.width, data.height],
      },
    });
  });
  if (overlapping.length) {
    opts.warn(
      `${overlapping.length} glyph(s) have overlapping contours (${formatCodePoints(overlapping)}): their alpha (the soft effects' distance) is too small inside near the overlaps; the fill is right. Remove the overlaps in a font editor, or take a build of the font without them`
    );
  }

  const kerning = def.kerning
    ? {
        unitsPerEm: em,
        pairs: getFontKerning(
          font,
          glyphs.map((glyph) => glyph.codePoint)
        ),
      }
    : null;
  let kerningPairs = 0;
  for (const pairs of kerning?.pairs.values() ?? []) kerningPairs += pairs.length;
  return {
    pixels,
    width,
    height,
    channels,
    layout: {
      type: def.type,
      atlas: { width, height, size: def.size, pxRange: def.pxRange },
      metrics: getFontMetrics(font),
      fallback,
      glyphs,
      kerning,
    },
    stats: {
      type: def.type,
      glyphs: glyphs.length,
      missing: missing.size,
      kerningPairs,
      overlaps: overlapping.length,
      atlas: { width, height, channels },
    },
  };
};

/** The encode's result: the layout (the output the runtime loads), its atlas, and the stats */
export type EncodedFont = {
  output: PipelineOutput;
  atlas: PipelineOutput;
  stats: FontEncodeStats;
};

/**
 * Encodes a font into its atlas and layout ({@link generateFontAtlasAsync}, then the atlas
 * through `ktx` and both written). Throws like it, and when `ktx create` fails
 * (`EncoderMissingError` without `ktx`).
 */
export const encodeFontAsset = async (
  source: FontSource,
  opts: { getKtx: KtxProvider; warn: (message: string) => void; collected?: Iterable<number> }
): Promise<EncodedFont> => {
  const generated = await generateFontAtlasAsync(source, opts);
  const { pixels, width, height, channels, stats } = generated;
  for (const warning of getFontBudgetWarnings(stats)) opts.warn(warning);
  // The atlas first: the layout names it
  const atlasBytes = await encodeKtx2Raw(pixels, { width, height, channels }, opts.getKtx);
  const atlas = writeOutput(getFontLogicalPath(source.jsonFile, 'atlas'), '.ktx2', atlasBytes);
  const layout = buildFontLayout({
    ...generated.layout,
    atlas: { file: path.basename(atlas.file), ...generated.layout.atlas },
  });
  const output = writeOutput(
    getFontLogicalPath(source.jsonFile, 'layout'),
    '.json',
    Buffer.from(JSON.stringify(layout))
  );
  return { output, atlas, stats };
};
