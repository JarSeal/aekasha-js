import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import type { FontAsset } from '../../../src/_engine/schemas';
import { ROOT } from '../../paths';
import { encodePngBytes } from '../images';
import { generateFontAtlasAsync, type FontAtlas } from './encodeFont';
import { openFont } from './fontFile';
import { createFontSource, FONT_ENCODER_VERSION } from './fontSource';
import { buildFontLayout } from './layout';
import { flattenOutline, getContourWinding, type OutlineCommand } from './outline';

// p391 Phase 2 section 3: a font's atlas and layout from the fixture (IBM Plex Sans Medium, a
// static WOFF), without `ktx`: the golden DIGITS atlas, the fields against the outline (Phase 1's
// method), the three types, the warnings and the errors.
//
// The golden files (fixtures/plexSansDigits.golden.*) are what the encoder makes: a change that
// changes them is a change to every font's output, so bump FONT_ENCODER_VERSION with it, then
// write them again: AEK_UPDATE_FONT_GOLDEN=true yarn test devTools/assetPipeline/fonts

const FIXTURES = path.join(ROOT, 'devTools/assetPipeline/fonts/fixtures');
const FIXTURE = path.join(FIXTURES, 'IBMPlexSans-Medium.woff');
const GOLDEN_PNG = path.join(FIXTURES, 'plexSansDigits.golden.png');
const GOLDEN_JSON = path.join(FIXTURES, 'plexSansDigits.golden.json');

/** The fixture's atlas for a font JSON's fields (its JSON beside the fixture) */
const generate = async (data: Omit<FontAsset, 'fileName'>, warnings: string[] = []) => {
  const source = createFontSource(path.join(FIXTURES, 'test.font.json'), {
    fileName: './IBMPlexSans-Medium.woff',
    ...data,
  });
  if ('error' in source) throw new Error(source.error);
  return generateFontAtlasAsync(source, { warn: (message) => warnings.push(message) });
};

/** The layout as the encode writes it, with a fixed atlas file name */
const toLayout = (atlas: FontAtlas) =>
  buildFontLayout({ ...atlas.layout, atlas: { file: 'golden.ktx2', ...atlas.layout.atlas } });

describe('the golden DIGITS atlas (bump FONT_ENCODER_VERSION with it)', () => {
  it('makes the same pixels (within 1 per channel) and the same layout', async () => {
    const atlas = await generate({ charset: { presets: ['DIGITS'] } });
    const layout = toLayout(atlas);
    if (process.env.AEK_UPDATE_FONT_GOLDEN === 'true') {
      fs.writeFileSync(GOLDEN_PNG, await encodePngBytes(atlas.pixels, atlas));
      fs.writeFileSync(GOLDEN_JSON, `${JSON.stringify(layout, null, 2)}\n`);
    }
    expect(FONT_ENCODER_VERSION).toBe(1);
    expect(layout).toEqual(JSON.parse(fs.readFileSync(GOLDEN_JSON, 'utf-8')));
    const golden = await sharp(GOLDEN_PNG).raw().toBuffer({ resolveWithObject: true });
    expect([golden.info.width, golden.info.height, golden.info.channels]).toEqual([
      atlas.width,
      atlas.height,
      atlas.channels,
    ]);
    let worst = 0;
    for (let i = 0; i < atlas.pixels.length; i++) {
      worst = Math.max(worst, Math.abs(atlas.pixels[i] - golden.data[i]));
    }
    expect(worst).toBeLessThanOrEqual(1);
  });
});

/** A channel bilinearly sampled at tile pixel (u, v) (rows from the top), as a GPU samples it */
const sampleTile = (atlas: FontAtlas, rect: number[], channel: number, u: number, v: number) => {
  const [ax, ay, w, h] = rect;
  const x = Math.min(w - 1, Math.max(0, u - 0.5));
  const y = Math.min(h - 1, Math.max(0, v - 0.5));
  const [x0, y0] = [Math.floor(x), Math.floor(y)];
  const [x1, y1] = [Math.min(w - 1, x0 + 1), Math.min(h - 1, y0 + 1)];
  const [fx, fy] = [x - x0, y - y0];
  const at = (px: number, py: number) =>
    atlas.pixels[((ay + py) * atlas.width + ax + px) * atlas.channels + channel];
  const top = at(x0, y0) * (1 - fx) + at(x1, y0) * fx;
  const bottom = at(x0, y1) * (1 - fx) + at(x1, y1) * fx;
  return top * (1 - fy) + bottom * fy;
};

const median = (a: number, b: number, c: number) =>
  Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));

describe('the fields against the outline (Phase 1’s method)', async () => {
  // Each glyph's tile drawn at 8× (bilinear, the 0.5 cut) against its outline's fill (non-zero
  // winding): how many samples land on the wrong side, and how far from the outline the worst is
  const MAGNIFY = 8;
  const CHARS = 'oAW@ß&Rego';
  const atlas = await generate({ charset: { chars: CHARS } });
  const font = openFont(new Uint8Array(fs.readFileSync(FIXTURE)));
  const { size } = atlas.layout.atlas;

  const measure = (codePoint: number) => {
    const glyph = atlas.layout.glyphs.find((g) => g.codePoint === codePoint);
    if (!glyph?.tile) throw new Error(`no tile for ${codePoint}`);
    const [left, bottom] = glyph.tile.plane;
    const rect = glyph.tile.atlas;
    const commands = font.glyphForCodePoint(codePoint).path.commands as OutlineCommand[];
    // A five-hundredth of a pixel: well under the thresholds below
    const contours = flattenOutline(commands, font.unitsPerEm, 0.002 / size);
    const distancePx = (x: number, y: number) => {
      let nearest = Infinity;
      for (const c of contours) {
        for (let k = 0; k < c.length; k += 2) {
          const l = (k + 2) % c.length;
          const [ex, ey, wx, wy] = [c[l] - c[k], c[l + 1] - c[k + 1], x - c[k], y - c[k + 1]];
          const t = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey || 1)));
          nearest = Math.min(nearest, Math.hypot(wx - t * ex, wy - t * ey));
        }
      }
      return nearest * size;
    };
    const result = {
      alpha: { wrong: 0, farthestPx: 0 },
      median: { wrong: 0, farthestPx: 0 },
      samples: 0,
    };
    for (let j = 0; j < rect[3] * MAGNIFY; j++) {
      for (let i = 0; i < rect[2] * MAGNIFY; i++) {
        const [u, v] = [(i + 0.5) / MAGNIFY, (j + 0.5) / MAGNIFY];
        const [x, y] = [left + u / size, bottom + (rect[3] - v) / size];
        const isInside = contours.reduce((sum, c) => sum + getContourWinding(c, x, y), 0) !== 0;
        const fields = {
          alpha: sampleTile(atlas, rect, 3, u, v),
          median: median(
            sampleTile(atlas, rect, 0, u, v),
            sampleTile(atlas, rect, 1, u, v),
            sampleTile(atlas, rect, 2, u, v)
          ),
        };
        result.samples++;
        for (const key of ['alpha', 'median'] as const) {
          if (fields[key] >= 128 === isInside) continue;
          result[key].wrong++;
          result[key].farthestPx = Math.max(result[key].farthestPx, distancePx(x, y));
        }
      }
    }
    return result;
  };

  it('"o" (no corners): every wrong sample is within a byte of the range from the outline', () => {
    // A byte is 8 px / 256 = 0.031 px of distance: what's left is the quantization
    const o = measure(0x6f);
    expect(o.alpha.farthestPx).toBeLessThan(0.04);
    expect(o.median.farthestPx).toBeLessThan(0.04);
  });

  it('every glyph: under 0.5 % of the samples wrong, none half a pixel from the outline', () => {
    // Phase 1: mean 0.14-0.37 %; the alpha rounds a corner (its field has a kink there, which the
    // bilinear tap cuts), the median an ink trap's sharp inner corner, both within half a pixel
    for (const character of CHARS) {
      const result = measure(character.codePointAt(0) as number);
      for (const key of ['alpha', 'median'] as const) {
        expect(result[key].wrong / result.samples, `${character} ${key}`).toBeLessThan(0.005);
        expect(result[key].farthestPx, `${character} ${key}`).toBeLessThan(0.5);
      }
    }
  }, 15_000); // About a second; slower when the whole suite shares the cores
});

describe('the types', () => {
  it('MSDF has alpha 255 in every tile, SDF one channel, MTSDF the true distance in alpha', async () => {
    const msdf = await generate({ type: 'MSDF', charset: { chars: 'o' } });
    const sdf = await generate({ type: 'SDF', charset: { chars: 'o' } });
    const mtsdf = await generate({ type: 'MTSDF', charset: { chars: 'o' } });
    const tileOf = (atlas: FontAtlas) => {
      const tile = atlas.layout.glyphs.find((g) => g.codePoint === 0x6f)?.tile;
      if (!tile) throw new Error('no tile for "o"');
      return tile.atlas;
    };
    const [x, y] = tileOf(msdf);
    expect(msdf.pixels[(y * msdf.width + x) * 4 + 3]).toBe(255);
    expect([sdf.channels, sdf.stats.atlas.channels]).toEqual([1, 1]);
    expect(sdf.pixels).toHaveLength(sdf.width * sdf.height);
    // The SDF's one channel is the MTSDF's alpha
    const [mx, my, w, h] = tileOf(mtsdf);
    const [sx, sy] = tileOf(sdf);
    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        expect(sdf.pixels[(sy + row) * sdf.width + sx + col]).toBe(
          mtsdf.pixels[((my + row) * mtsdf.width + mx + col) * 4 + 3]
        );
      }
    }
  });
});

describe('the characters', () => {
  it('names what the font lacks and leaves it out; space has no tile', async () => {
    const warnings: string[] = [];
    const atlas = await generate({ charset: { presets: ['DIGITS'], chars: '中€' } }, warnings);
    expect(warnings).toEqual(['the font lacks "中" U+4E2D: left out']);
    expect(atlas.stats.missing).toBe(1);
    const codePoints = atlas.layout.glyphs.map((g) => g.codePoint);
    expect(codePoints).toContain(0x20ac);
    expect(codePoints).not.toContain(0x4e2d);
    expect(atlas.layout.glyphs.find((g) => g.codePoint === 0x20)).toEqual({
      codePoint: 0x20,
      advance: expect.closeTo(0.236, 6),
    });
    expect(atlas.layout.fallback).toBe(0x3f);
  });

  it('fails on a fallback glyph the font lacks', async () => {
    await expect(generate({ charset: { chars: 'a' }, fallbackGlyph: '中' })).rejects.toThrow(
      /has no glyph for its fallbackGlyph "中" U\+4E2D: pick one it has$/
    );
  });

  it('fails when the glyphs don’t fit on atlas.maxSize, naming how many do', async () => {
    await expect(generate({ atlas: { maxSize: 64 } })).rejects.toThrow(
      /IBMPlexSans-Medium\.woff: its 94 glyphs don't fit on a 64 × 64 atlas \(\d+ do\)/
    );
  });

  it('writes no kerning with kerning: false', async () => {
    const atlas = await generate({ charset: { chars: 'AV' }, kerning: false });
    expect(atlas.stats.kerningPairs).toBe(0);
    expect(toLayout(atlas).kerning).toBeUndefined();
  });
});
