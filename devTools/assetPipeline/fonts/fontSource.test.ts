import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { FONT_DEFAULTS } from '../../../src/_engine/schemas';
import { ROOT } from '../../paths';
import { collectPipelineAssets, getFontAssetKey, readAssetJsons } from '../assets';
import { createFontSource, getFontKeyParams, listFontFiles, resolveFont } from './fontSource';

// p391 Phase 2 section 3: a font's source (D2): its defaults, its files, its cache key's params,
// and its place in the pipeline's asset list

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aek-p391-source-'));
afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

const FONT_DIR = path.join(TMP, 'src/app/fonts/sans');
fs.mkdirSync(FONT_DIR, { recursive: true });
fs.copyFileSync(
  path.join(ROOT, 'src/toolkit/fonts/plexSans/IBMPlexSans-Medium.woff'),
  path.join(FONT_DIR, 'Sans.woff')
);
const JSON_FILE = path.join(FONT_DIR, 'sans.font.json');

describe('resolveFont', () => {
  it('fills every default in: ASCII without a charset', () => {
    expect(resolveFont({ fileName: './a.ttf' })).toEqual({
      ...FONT_DEFAULTS,
      charset: { ...FONT_DEFAULTS.charset, presets: ['ASCII'] },
      atlas: { ...FONT_DEFAULTS.atlas },
    });
  });

  it('gives a charset without presets none, and keeps what the JSON gives', () => {
    const font = resolveFont({
      fileName: './a.ttf',
      type: 'SDF',
      charset: { chars: '0123' },
      atlas: { pot: false },
    });
    expect(font.charset.presets).toEqual([]);
    expect(font.charset.chars).toBe('0123');
    expect(font.type).toBe('SDF');
    expect(font.atlas).toEqual({ maxSize: 2048, padding: 2, pot: false });
  });
});

describe('createFontSource', () => {
  it('resolves the font and the charset files from the JSON’s folder', () => {
    fs.writeFileSync(path.join(FONT_DIR, 'strings.json'), '["Hei"]');
    const source = createFontSource(JSON_FILE, {
      fileName: './Sans.woff',
      charset: { charsFromFiles: ['./strings.json'] },
    });
    if ('error' in source) throw new Error(source.error);
    expect(listFontFiles(source)).toEqual([
      path.join(FONT_DIR, 'Sans.woff'),
      path.join(FONT_DIR, 'strings.json'),
    ]);
  });

  it('names a missing font file or charset file', () => {
    expect(createFontSource(JSON_FILE, { fileName: './Missing.woff' })).toEqual({
      error: expect.stringMatching(/its font file .*Missing\.woff doesn't exist$/),
    });
    expect(
      createFontSource(JSON_FILE, {
        fileName: './Sans.woff',
        charset: { charsFromFiles: ['./nope.txt'] },
      })
    ).toEqual({
      error: expect.stringMatching(/its charsFromFiles file .*nope\.txt doesn't exist$/),
    });
  });
});

describe('getFontKeyParams', () => {
  it('changes with the characters a charset file gives, and names the output', () => {
    const file = path.join(FONT_DIR, 'names.txt');
    fs.writeFileSync(file, 'abc');
    const keyOf = () => {
      const source = createFontSource(JSON_FILE, {
        fileName: './Sans.woff',
        charset: { charsFromFiles: ['./names.txt'] },
      });
      if ('error' in source) throw new Error(source.error);
      return getFontKeyParams(source);
    };
    const before = keyOf();
    fs.writeFileSync(file, 'cba'); // Other bytes, the same characters
    expect(keyOf().charset).toBe(before.charset);
    fs.writeFileSync(file, 'abcd');
    expect(keyOf().charset).not.toBe(before.charset);
    expect(before.output).toMatch(/fonts\/sans\/sans\.layout$/);
  });
});

describe('the asset list', () => {
  it('collects a font JSON as one encode by its key, and drops one whose file is missing', () => {
    fs.writeFileSync(JSON_FILE, JSON.stringify({ fileName: './Sans.woff' }));
    const broken = path.join(FONT_DIR, 'broken.font.json');
    fs.writeFileSync(broken, JSON.stringify({ fileName: './Missing.ttf' }));
    const { assetJsons, dropped } = readAssetJsons(path.join(TMP, 'src'));
    expect(dropped).toEqual([]);
    const collected = collectPipelineAssets(assetJsons);
    const asset = collected.assets.get(getFontAssetKey(JSON_FILE));
    expect(asset).toMatchObject({ type: 'font', id: 'sans', source: { kind: 'font' } });
    expect(collected.dropped).toEqual([
      {
        jsonFile: expect.stringMatching(/broken\.font\.json$/),
        reason: expect.stringMatching(/Missing\.ttf doesn't exist/),
      },
    ]);
  });

  it('drops a font JSON that fails its schema (a WOFF2)', () => {
    const woff2 = path.join(TMP, 'src/app/fonts/other/other.font.json');
    fs.mkdirSync(path.dirname(woff2), { recursive: true });
    fs.writeFileSync(woff2, JSON.stringify({ fileName: './Other.woff2' }));
    const { dropped } = readAssetJsons(path.join(TMP, 'src'));
    expect(dropped).toEqual([
      {
        jsonFile: expect.stringMatching(/other\.font\.json$/),
        reason: expect.stringMatching(/^A WOFF2 font/),
      },
    ]);
    fs.rmSync(path.dirname(woff2), { recursive: true });
  });
});
