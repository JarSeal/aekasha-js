import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { getFontCharsetPresetCodePoints } from '../../../src/_engine/features/text/FontCharsets';
import { getRequestedCharsetHash, resolveRequestedCharset } from './charset';
import { resolveFont } from './fontSource';

// p391 Phase 2 section 3: a font's requested characters (D2): presets, chars, files, space and
// the fallback glyph, without control characters

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aek-p391-charset-'));
afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

const write = (name: string, text: string) => {
  const file = path.join(TMP, name);
  fs.writeFileSync(file, text);
  return file;
};

const toText = (codePoints: number[]) => String.fromCodePoint(...codePoints);

describe('the presets', () => {
  it('have their D2 characters', () => {
    expect(toText(getFontCharsetPresetCodePoints('DIGITS'))).toBe(' %+,-.0123456789:');
    const ascii = getFontCharsetPresetCodePoints('ASCII');
    expect([ascii.length, ascii[0], ascii[ascii.length - 1]]).toEqual([95, 0x20, 0x7e]);
    const latin1 = getFontCharsetPresetCodePoints('LATIN_1');
    expect([latin1.length, latin1[0], latin1[latin1.length - 1]]).toEqual([96, 0xa0, 0xff]);
    expect(getFontCharsetPresetCodePoints('LATIN_EXT_A')).toHaveLength(128);
    expect(toText(getFontCharsetPresetCodePoints('PUNCTUATION'))).toBe('‐–—‘’‚“”„†‡•…‰′″‹›');
  });

  it('leave out the blocks’ unassigned code points', () => {
    const greek = getFontCharsetPresetCodePoints('GREEK');
    for (const unassigned of [0x38b, 0x38d, 0x3a2]) expect(greek).not.toContain(unassigned);
    expect(greek).toContain(0x3a9); // Ω
    expect(getFontCharsetPresetCodePoints('CYRILLIC')).toContain(0x490); // Ґ
  });
});

describe('resolveRequestedCharset', () => {
  it('is ASCII without a charset, and always has space and the fallback glyph', () => {
    const ascii = resolveRequestedCharset({
      font: resolveFont({ fileName: './a.ttf' }),
      charsFiles: [],
    });
    expect(ascii.codePoints).toEqual(getFontCharsetPresetCodePoints('ASCII'));
    const none = resolveRequestedCharset({
      font: resolveFont({ fileName: './a.ttf', charset: { chars: 'ba' }, fallbackGlyph: '□' }),
      charsFiles: [],
    });
    expect(toText(none.codePoints)).toBe(' ab□');
    expect(none.presets.size).toBe(0);
    expect([...none.named].sort((a, b) => a - b)).toEqual(none.codePoints);
  });

  it('reads a text file whole and a JSON file’s keys and strings, without control characters', () => {
    const text = write('strings.txt', 'Hei\tmaailma!\r\n€');
    const json = write('strings.json', JSON.stringify({ Ω: ['Ä', { k: 'ü', n: 3, b: true }] }));
    const requested = resolveRequestedCharset({
      font: resolveFont({ fileName: './a.ttf', charset: { charsFromFiles: ['x'] } }),
      charsFiles: [text, json],
    });
    // The JSON's keys (k, n, b) are characters too
    expect(toText(requested.codePoints)).toBe(' !?HabeiklmnÄüΩ€');
  });

  it('fails naming a charsFromFiles JSON that doesn’t parse', () => {
    const broken = write('broken.json', '{ "a": ');
    expect(() =>
      resolveRequestedCharset({ font: resolveFont({ fileName: './a.ttf' }), charsFiles: [broken] })
    ).toThrow(/charsFromFiles: .*broken\.json isn't JSON/);
  });

  it('adds the collected characters, and keeps the presets apart for the warnings', () => {
    const requested = resolveRequestedCharset(
      {
        font: resolveFont({ fileName: './a.ttf', charset: { presets: ['DIGITS'] } }),
        charsFiles: [],
      },
      { collected: [0x41, 0x0a] }
    );
    expect(requested.codePoints).toContain(0x41);
    expect(requested.codePoints).not.toContain(0x0a);
    expect(requested.named.has(0x41)).toBe(true);
    expect(requested.named.has(0x30)).toBe(false);
    expect(requested.presets.get('DIGITS')).toHaveLength(17);
  });

  it('hashes the characters, not where they came from', () => {
    const fromChars = resolveRequestedCharset({
      font: resolveFont({ fileName: './a.ttf', charset: { chars: '0123456789 %+,-.:' } }),
      charsFiles: [],
    });
    const fromPreset = resolveRequestedCharset({
      font: resolveFont({ fileName: './a.ttf', charset: { presets: ['DIGITS'] } }),
      charsFiles: [],
    });
    expect(getRequestedCharsetHash(fromChars)).toBe(getRequestedCharsetHash(fromPreset));
  });
});
