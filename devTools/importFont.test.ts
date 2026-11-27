import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FontAssetSchema } from '../src/_engine/schemas';
import type { Font } from 'fontkit';
import {
  FONT_LICENSE_NOTE,
  getCoverageWarnings,
  getFontPresetCoverage,
  parseImportFontArgs,
  planFontImport,
  toFontId,
  writeFontImportAsync,
} from './importFont';
import { ROOT } from './paths';

// p391 D4: `yarn importFont`'s plan and writes, in a temp repo (its `src/`), without the encode

/** The toolkit's plexSans font */
const FIXTURE = path.join(ROOT, 'src/toolkit/fonts/plexSans/IBMPlexSans-Medium.woff');
/** The UI kit's IBM Plex Sans: a variable WOFF2 */
const VARIABLE_WOFF2 = path.join(
  ROOT,
  'src/_engine/ui/fonts/ibm-plex-sans-latin-wght-normal.woff2'
);

let root: string;
let srcDir: string;
const dirs = () => ({ srcDir, rootDir: root });

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aek-import-font-'));
  srcDir = path.join(root, 'src');
  fs.mkdirSync(srcDir);
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('toFontId', () => {
  it('camel-cases the file name, a leading run of capitals as one word', () => {
    expect(toFontId('IBMPlexSans-Medium.woff')).toBe('ibmPlexSansMedium');
    expect(toFontId('Roboto_Mono-Bold.ttf')).toBe('robotoMonoBold');
    expect(toFontId('/fonts/inter.otf')).toBe('inter');
    expect(toFontId('ABC.ttf')).toBe('abc');
    expect(toFontId('Font 2 Bold.ttf')).toBe('font2Bold');
  });
});

describe('parseImportFontArgs', () => {
  it('resolves the paths from where the command ran', () => {
    const { options, encode } = parseImportFontArgs(
      ['fonts/a.ttf', '--into', 'src/app/scenes/x', '--charset', 'ASCII,LATIN_1', '--size', '64'],
      '/work'
    );
    expect(options).toEqual({
      file: '/work/fonts/a.ttf',
      into: '/work/src/app/scenes/x',
      presets: ['ASCII', 'LATIN_1'],
      size: 64,
    });
    expect(encode).toBe(true);
  });

  it('keeps app and toolkit as names, and reads the flags', () => {
    const { options, encode } = parseImportFontArgs(
      ['a.ttf', '--into', 'toolkit', '--type', 'SDF', '--chars', '€…', '--force', '--no-encode'],
      '/work'
    );
    expect(options).toMatchObject({ into: 'toolkit', type: 'SDF', chars: '€…', force: true });
    expect(encode).toBe(false);
  });

  it('refuses unknown presets and types, a missing value and a missing file', () => {
    expect(() => parseImportFontArgs(['a.ttf', '--charset', 'ASCII,KLINGON'], '/')).toThrow(
      /--charset takes DIGITS, ASCII, .*not "KLINGON"/
    );
    expect(() => parseImportFontArgs(['a.ttf', '--type', 'BITMAP'], '/')).toThrow(/--type takes/);
    expect(() => parseImportFontArgs(['a.ttf', '--id'], '/')).toThrow(/--id needs a value/);
    expect(() => parseImportFontArgs(['a.ttf', '--size', '4.5'], '/')).toThrow(/whole number/);
    expect(() => parseImportFontArgs(['--force'], '/')).toThrow(/No font file given/);
    expect(() => parseImportFontArgs(['a.ttf', 'b.ttf'], '/')).toThrow(/extra argument "b.ttf"/);
  });
});

describe('planFontImport and writeFontImportAsync', () => {
  it("writes the app's font folder: the font, its JSON with the defaults, its licence note", async () => {
    const plan = planFontImport({ file: FIXTURE, presets: ['ASCII', 'LATIN_1'] }, dirs());
    expect(plan.id).toBe('ibmPlexSansMedium');
    expect(plan.folder).toBe(path.join(srcDir, 'app/fonts/ibmPlexSansMedium'));
    await writeFontImportAsync(plan, FIXTURE);

    const json: unknown = JSON.parse(fs.readFileSync(plan.jsonFile, 'utf-8'));
    expect(FontAssetSchema.safeParse(json).success).toBe(true);
    expect(json).toEqual({
      $schema: '../../../../.schemas/font.schema.json',
      id: 'ibmPlexSansMedium',
      name: 'IBM Plex Sans Medium',
      fileName: './IBMPlexSans-Medium.woff',
      type: 'MTSDF',
      size: 48,
      pxRange: 8,
      charset: {
        presets: ['ASCII', 'LATIN_1'],
        chars: '',
        charsFromFiles: [],
        collectFromScenes: false,
      },
      fallbackGlyph: '?',
      kerning: true,
      atlas: { maxSize: 2048, padding: 2, pot: true },
    });
    expect(fs.readFileSync(plan.fontFile)).toEqual(fs.readFileSync(FIXTURE));

    const note = fs.readFileSync(path.join(plan.folder, FONT_LICENSE_NOTE), 'utf-8');
    expect(note).toMatch(/^IBM Plex Sans Medium \(IBMPlexSans-Medium\.woff\)\n/);
    expect(note).toContain('Copyright: Copyright 2018 IBM Corp.');
    expect(note).toContain('SIL Open Font License, Version 1.1');
    expect(note).toContain('License URL: http://scripts.sil.org/OFL');
  });

  it("prints the coverage: each preset's characters the font has, the asked ones marked", () => {
    const plan = planFontImport({ file: FIXTURE, presets: ['ASCII'] }, dirs());
    expect(plan.coverage.map(({ preset }) => preset)).toEqual([
      'DIGITS',
      'ASCII',
      'LATIN_1',
      'LATIN_EXT_A',
      'GREEK',
      'CYRILLIC',
      'PUNCTUATION',
    ]);
    const ascii = plan.coverage.find(({ preset }) => preset === 'ASCII');
    expect(ascii).toEqual({ preset: 'ASCII', covered: 95, total: 95, requested: true });
    expect(plan.coverage.filter(({ requested }) => requested)).toHaveLength(1);
    expect(plan.warnings).toEqual([]);
  });

  it("warns on --chars the font doesn't have", () => {
    const plan = planFontImport({ file: FIXTURE, chars: '€中' }, dirs());
    expect(plan.warnings).toEqual([`the font lacks --chars' "中"`]);
  });

  it('counts a font with gaps, and warns on an asked preset it lacks part of', () => {
    // plexSans covers every preset: a stub with only the digits (glyph 0 is .notdef)
    const isDigit = (codePoint: number) => codePoint >= 0x30 && codePoint <= 0x39;
    const font = {
      hasGlyphForCodePoint: () => true,
      glyphForCodePoint: (codePoint: number) => ({ id: isDigit(codePoint) ? codePoint : 0 }),
    } as unknown as Font;
    const coverage = getFontPresetCoverage(font, ['DIGITS', 'ASCII']);
    expect(coverage.slice(0, 3)).toEqual([
      { preset: 'DIGITS', covered: 10, total: 17, requested: true },
      { preset: 'ASCII', covered: 10, total: 95, requested: true },
      { preset: 'LATIN_1', covered: 0, total: 96, requested: false },
    ]);
    expect(getCoverageWarnings(coverage)).toEqual([
      "the font has 10 of DIGITS's 17 characters",
      "the font has 10 of ASCII's 95 characters",
    ]);
  });

  it('takes --id, --type, --size, toolkit and a folder under src/', () => {
    const toolkit = planFontImport(
      { file: FIXTURE, id: 'plexSans', into: 'toolkit', type: 'MSDF', size: 64 },
      dirs()
    );
    expect(toolkit.jsonFile).toBe(path.join(srcDir, 'toolkit/fonts/plexSans/plexSans.font.json'));
    expect(toolkit.json).toMatchObject({ type: 'MSDF', size: 64 });
    const scene = path.join(srcDir, 'app/scenes/hud');
    const inScene = planFontImport({ file: FIXTURE, id: 'hudFont', into: scene }, dirs());
    expect(inScene.jsonFile).toBe(path.join(scene, 'hudFont.font.json'));
    expect(inScene.json.$schema).toBe('../../../../.schemas/font.schema.json');
  });

  it("refuses a folder outside src/ or in its outputs', and an id that isn't a file name", () => {
    expect(() => planFontImport({ file: FIXTURE, into: root }, dirs())).toThrow(
      /isn't a folder under src\//
    );
    expect(() =>
      planFontImport({ file: FIXTURE, into: path.join(srcDir, 'public/fonts') }, dirs())
    ).toThrow(/src\/public\/, which the gather doesn't read/);
    expect(() => planFontImport({ file: FIXTURE, id: '1st font' }, dirs())).toThrow(
      /"1st font" isn't a usable id/
    );
  });

  it('refuses a size the schema refuses, naming the field', () => {
    expect(() => planFontImport({ file: FIXTURE, size: 8 }, dirs())).toThrow(
      /pxRange \(8\) must be smaller than the em's size \(8 px\)\. \(pxRange\)/
    );
  });

  it('refuses to overwrite without --force, naming the files', async () => {
    const plan = planFontImport({ file: FIXTURE, id: 'plex' }, dirs());
    await writeFontImportAsync(plan, FIXTURE);
    expect(() => planFontImport({ file: FIXTURE, id: 'plex' }, dirs())).toThrow(
      'src/app/fonts/plex/plex.font.json, src/app/fonts/plex/LICENSE.txt, src/app/fonts/plex/IBMPlexSans-Medium.woff already exist(s): --force overwrites'
    );
    const again = planFontImport({ file: FIXTURE, id: 'plex', size: 32, force: true }, dirs());
    await writeFontImportAsync(again, FIXTURE);
    expect(JSON.parse(fs.readFileSync(again.jsonFile, 'utf-8'))).toMatchObject({ size: 32 });
  });

  it('imports a font already in its folder again without copying it onto itself', async () => {
    const first = planFontImport({ file: FIXTURE, id: 'plex' }, dirs());
    await writeFontImportAsync(first, FIXTURE);
    const again = planFontImport({ file: first.fontFile, id: 'plex', force: true }, dirs());
    await writeFontImportAsync(again, first.fontFile);
    expect(fs.readFileSync(again.fontFile)).toEqual(fs.readFileSync(FIXTURE));
  });

  it('refuses an id another font JSON has (its own or its file name)', async () => {
    const other = path.join(srcDir, 'app/scenes/x');
    fs.mkdirSync(other, { recursive: true });
    fs.writeFileSync(path.join(other, 'named.font.json'), '{ "id": "plex" }');
    fs.writeFileSync(path.join(other, 'unnamed.font.json'), '{}');
    expect(() => planFontImport({ file: FIXTURE, id: 'plex' }, dirs())).toThrow(
      'src/app/scenes/x/named.font.json has the id "plex": give another with --id'
    );
    expect(() => planFontImport({ file: FIXTURE, id: 'unnamed' }, dirs())).toThrow(
      /unnamed\.font\.json has the id "unnamed"/
    );
  });

  it('refuses a WOFF2 (and so the variable one) before writing anything', () => {
    expect(() => planFontImport({ file: VARIABLE_WOFF2 }, dirs())).toThrow(
      /^ibm-plex-sans-latin-wght-normal\.woff2: it's a WOFF2 file/
    );
    expect(fs.readdirSync(srcDir)).toEqual([]);
  });

  it("refuses a file that isn't there", () => {
    expect(() => planFontImport({ file: path.join(root, 'nope.ttf') }, dirs())).toThrow(
      /nope\.ttf doesn't exist/
    );
  });
});
