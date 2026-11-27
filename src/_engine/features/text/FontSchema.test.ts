import { describe, expect, it } from 'vitest';
import { FONT_DEFAULTS, FontAssetSchema } from './FontSchema';

/** The plan's example (p391 D2) */
const example = {
  $schema: '../../../../.schemas/font.schema.json',
  id: 'plexSans',
  name: 'IBM Plex Sans',
  fileName: './IBMPlexSans-Medium.woff',
  type: 'MTSDF',
  size: 48,
  pxRange: 8,
  charset: {
    presets: ['ASCII', 'LATIN_1'],
    chars: '€–—…“”‘’•°',
    charsFromFiles: [],
    collectFromScenes: false,
  },
  fallbackGlyph: '?',
  kerning: true,
  atlas: { maxSize: 2048, padding: 2, pot: true },
};

/** The issues of a value as `path: message`, or [] when it's valid */
const issues = (value: unknown) => {
  const result = FontAssetSchema.safeParse(value);
  return result.success
    ? []
    : result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
};

describe('FontAssetSchema', () => {
  it("takes the plan's example, and a font of only its file", () => {
    expect(issues(example)).toEqual([]);
    expect(issues({ fileName: './a.ttf' })).toEqual([]);
    expect(issues({ fileName: '../fonts/a.OTF' })).toEqual([]);
  });

  it('refuses a WOFF2 naming the formats it reads, and any other extension', () => {
    const [woff2] = issues({ fileName: './a.woff2' });
    expect(woff2).toMatch(/^fileName: A WOFF2 font .*static TTF, OTF or WOFF/);
    expect(issues({ fileName: './a.png' })).toEqual([
      expect.stringMatching(/^fileName: A font file is a static TTF, OTF or WOFF .*"\.png"/),
    ]);
    expect(issues({ fileName: './font' })).toEqual([expect.stringMatching(/"no extension"/)]);
  });

  it('refuses a public URL path: a font is always encoded', () => {
    expect(issues({ fileName: '/fonts/a.ttf' })).toEqual([
      expect.stringMatching(/^fileName: A font file relative to this JSON/),
    ]);
  });

  it('checks the charset: preset names, files relative to the JSON, no unknown keys', () => {
    expect(issues({ fileName: './a.ttf', charset: { presets: ['LATIN_2'] } })).toEqual([
      expect.stringMatching(/^charset\.presets\.0: /),
    ]);
    expect(issues({ fileName: './a.ttf', charset: { charsFromFiles: ['/strings.json'] } })).toEqual(
      [expect.stringMatching(/^charset\.charsFromFiles\.0: A file relative to this JSON/)]
    );
    expect(issues({ fileName: './a.ttf', charset: { preset: ['ASCII'] } })).toHaveLength(1);
  });

  it('takes one character as the fallback glyph, counted by code point', () => {
    expect(issues({ fileName: './a.ttf', fallbackGlyph: '□' })).toEqual([]);
    expect(issues({ fileName: './a.ttf', fallbackGlyph: '😀' })).toEqual([]);
    expect(issues({ fileName: './a.ttf', fallbackGlyph: '' })).toEqual([
      'fallbackGlyph: One character.',
    ]);
    expect(issues({ fileName: './a.ttf', fallbackGlyph: '??' })).toEqual([
      'fallbackGlyph: One character.',
    ]);
  });

  it("keeps pxRange below the em's size, with either one defaulted", () => {
    expect(issues({ fileName: './a.ttf', size: 8 })).toEqual([
      "pxRange: pxRange (8) must be smaller than the em's size (8 px).",
    ]);
    expect(issues({ fileName: './a.ttf', size: 16, pxRange: 12 })).toEqual([]);
    expect(issues({ fileName: './a.ttf', pxRange: 0 })).toHaveLength(1);
  });

  it("takes a power of two for the atlas's largest side", () => {
    expect(issues({ fileName: './a.ttf', atlas: { maxSize: 1024 } })).toEqual([]);
    expect(issues({ fileName: './a.ttf', atlas: { maxSize: 1000 } })).toEqual([
      'atlas.maxSize: A power of two (64, 128, … 8192).',
    ]);
    expect(issues({ fileName: './a.ttf', atlas: { maxSize: 16384 } })).toHaveLength(1);
  });

  it('has defaults the schema takes', () => {
    expect(issues({ fileName: './a.ttf', ...FONT_DEFAULTS })).toEqual([]);
  });
});
