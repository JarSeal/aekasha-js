import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { gatherSceneData } from '../gatherAppData';
import { ROOT } from '../paths';
import { getFontAssetKey } from '../assetPipeline/assets';
import { createFontSource } from '../assetPipeline/fonts/fontSource';
import type { PipelineRun, PipelineRunResult } from '../assetPipeline/run';
import { createRegistries, type GatherContext, type Registries } from './context';
import type { EngineSceneAsset } from './engineSchemas';
import {
  FONT_CHARSETS_FILENAME,
  collectFontChars,
  reportStaleFonts,
  writeFontCharsets,
  type FontText,
} from './fonts';
import type { GatherLog } from './log';
import { GENERATED_APP_DATA_FILENAME } from './output';

// p391 D5, D6: fonts in the gather (temp trees: nothing under the repo is written)

const FONT = path.join(ROOT, 'src/toolkit/fonts/plexSans/IBMPlexSans-Medium.woff');

const tempRoots: string[] = [];
afterAll(() => {
  for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true });
});

/** A temp `src/` holding `files` (JSON values, or a path to copy for a `.woff`), and its output */
const makeTree = (files: Record<string, unknown>) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aek-gather-fonts-'));
  tempRoots.push(root);
  const srcDir = path.join(root, 'src');
  for (const [file, content] of Object.entries(files)) {
    const fullPath = path.join(srcDir, file);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    if (file.endsWith('.woff')) fs.copyFileSync(content as string, fullPath);
    else
      fs.writeFileSync(fullPath, typeof content === 'string' ? content : JSON.stringify(content));
  }
  return { srcDir, outDir: path.join(root, 'out') };
};

const scene = (id: string, fields: Record<string, unknown> = {}) => ({
  [`app/scenes/${id}/${id}.scene.json`]: { id, sceneFile: `scenes/${id}/${id}.ts`, ...fields },
  [`app/scenes/${id}/${id}.ts`]: 'export const scene = async () => {};\n',
});

const font = (id: string, fields: Record<string, unknown> = {}) => ({
  [`app/fonts/${id}/${id}.font.json`]: { fileName: './Font.woff', name: `Font ${id}`, ...fields },
  [`app/fonts/${id}/Font.woff`]: FONT,
});

type OutputJson = {
  scenes: Record<string, { fonts?: Record<string, unknown>[]; __features: string[] }>;
  fonts?: Record<string, Record<string, unknown>>;
};

/** Gathers a tree, its console quiet; the output (null when nothing was written) and the logs */
const gather = (
  files: Record<string, unknown>,
  opts: { isProduction?: boolean; pipeline?: (srcDir: string) => PipelineRun } = {}
) => {
  const tree = makeTree(files);
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const { isGathered } = gatherSceneData({
    ...tree,
    profiles: [],
    isProduction: !!opts.isProduction,
    pipeline: opts.pipeline?.(tree.srcDir),
  });
  const logs = {
    errors: error.mock.calls.map((call) => call.join(' ')),
    warnings: warn.mock.calls.map((call) => call.join(' ')),
  };
  error.mockRestore();
  warn.mockRestore();
  log.mockRestore();
  const dataFile = path.join(tree.outDir, GENERATED_APP_DATA_FILENAME);
  const json = fs.existsSync(dataFile)
    ? (JSON.parse(fs.readFileSync(dataFile, 'utf8')) as OutputJson)
    : null;
  return { isGathered, json, logs, ...tree };
};

/** A run with an optimized output for each font JSON (from `src/`) */
const runWith =
  (fontJsons: string[], status: PipelineRunResult['status'] = 'optimized') =>
  (srcDir: string): PipelineRun => ({
    results: new Map(
      fontJsons.map((rel) => {
        const jsonFile = path.join(srcDir, rel);
        const data = JSON.parse(fs.readFileSync(jsonFile, 'utf8')) as { fileName: string };
        const source = createFontSource(jsonFile, data);
        const result = {
          status,
          asset: { type: 'font', id: path.basename(rel, '.font.json'), jsonFile, source },
          output: { file: '', url: `/aek-assets/${rel}.layout.json`, bytes: 100 },
          extraOutputs: [{ url: `/aek-assets/${rel}.atlas.ktx2`, bytes: 1000 }],
          font: { atlas: { width: 64, height: 64, channels: 4 } },
          sourceBytes: 90,
          settings: { budget: { isOwn: false, profileTextures: {} } },
          textures: [],
          warnings: [],
          ...(status === 'optimized' ? {} : { reason: 'no ktx' }),
        } as unknown as PipelineRunResult;
        return [getFontAssetKey(jsonFile), result];
      })
    ),
  });

describe('fonts in the generated data', () => {
  it('writes the fonts a scene lists, once, and the development data’s fonts section', () => {
    const { isGathered, json } = gather({
      ...font('sans'),
      ...font('mono', { type: 'SDF' }),
      ...scene('a', { fonts: ['mono', 'sans', 'mono'] }),
      ...scene('b'),
    });
    expect(isGathered).toBe(true);
    expect(json?.scenes.a.fonts).toEqual([
      {
        id: 'mono',
        type: 'SDF',
        name: 'Font mono',
        __sourcePath: 'src/app/fonts/mono/mono.font.json',
      },
      {
        id: 'sans',
        type: 'MTSDF',
        name: 'Font sans',
        __sourcePath: 'src/app/fonts/sans/sans.font.json',
      },
    ]);
    expect(json?.scenes.a.__features).toEqual(['text']);
    expect(json?.scenes.b.fonts).toBeUndefined();
    expect(json?.scenes.b.__features).toEqual([]);
    expect(Object.keys(json?.fonts ?? {})).toEqual(['mono', 'sans']);
  });

  it('takes the layout’s URL and the figures from the run; production only the load’s fields', () => {
    const files = { ...font('sans'), ...scene('a', { fonts: ['sans'] }) };
    const pipeline = runWith(['app/fonts/sans/sans.font.json']);
    const dev = gather(files, { pipeline });
    expect(dev.json?.scenes.a.fonts?.[0]).toMatchObject({
      __url: '/aek-assets/app/fonts/sans/sans.font.json.layout.json',
      __bytes: { in: 90, out: 1100 },
      __vramBytes: { in: 64 * 64 * 4, out: 64 * 64 * 4 },
    });
    const production = gather(files, { isProduction: true, pipeline });
    expect(production.json?.scenes.a.fonts).toEqual([
      {
        id: 'sans',
        type: 'MTSDF',
        __url: '/aek-assets/app/fonts/sans/sans.font.json.layout.json',
        __bytes: { in: 90, out: 1100 },
        __vramBytes: { in: 64 * 64 * 4, out: 64 * 64 * 4 },
      },
    ]);
    expect(production.json?.fonts).toBeUndefined();
  });

  it('fails a production build whose shipped scene lists a font without an output', () => {
    const { isGathered, logs } = gather(
      { ...font('sans'), ...scene('a', { fonts: ['sans'] }) },
      { isProduction: true, pipeline: runWith(['app/fonts/sans/sans.font.json'], 'encoderMissing') }
    );
    expect(isGathered).toBe(false);
    expect(logs.errors.join('\n')).toMatch(/sans \(.*Font\.woff; a\): encoder missing/);
  });

  it('fails on a font id no font has, one two fonts give, and a missing font file', () => {
    const unknown = gather({ ...scene('a', { fonts: ['nope'] }) });
    expect(unknown.isGathered).toBe(false);
    expect(unknown.logs.errors.join('\n')).toMatch(/lists the font "nope", which no asset JSON/);

    const twice = gather({
      ...font('sans'),
      'app/scenes/x/sans.font.json': { fileName: '../../fonts/sans/Font.woff' },
    });
    expect(twice.isGathered).toBe(false);
    expect(twice.logs.errors.join('\n')).toMatch(/Duplicate font ID found: sans/);

    const missing = gather({ 'app/fonts/a/a.font.json': { fileName: './Gone.woff' } });
    expect(missing.isGathered).toBe(false);
    expect(missing.logs.errors.join('\n')).toMatch(/a\.font\.json: its font file .*Gone\.woff/);
  });
});

describe('the collected characters (D5)', () => {
  it('writes the charset file for the collecting fonts, and removes it when none collects', () => {
    const collecting = gather({
      ...font('sans', { charset: { collectFromScenes: true } }),
      ...font('mono'),
      ...scene('a'),
    });
    const file = path.join(collecting.outDir, FONT_CHARSETS_FILENAME);
    // No texts before the text() feature's: the font collects none yet
    expect(fs.readFileSync(file, 'utf8')).toBe('{\n  "sans": ""\n}\n');

    const { outDir } = collecting;
    writeFontCharsets(outDir, new Map());
    expect(fs.existsSync(file)).toBe(false);
  });

  /** Registries with the fonts (`collects`) and scenes (`debug`) the collection reads */
  const registries = (fonts: Record<string, boolean>, scenes: Record<string, boolean>) => {
    const { registries: reg } = createRegistries();
    for (const [id, collects] of Object.entries(fonts)) {
      const source = createFontSource(path.join(path.dirname(FONT), `${id}.font.json`), {
        fileName: `./${path.basename(FONT)}`,
        charset: { presets: ['DIGITS'], collectFromScenes: collects },
      });
      if ('error' in source) throw new Error(source.error);
      reg.fonts[id] = {
        id,
        jsonFile: source.jsonFile,
        sourcePath: '',
        font: source.font,
      };
    }
    for (const [id, isDebugScene] of Object.entries(scenes)) {
      reg.scenes.push({
        id,
        data: { id, sceneFile: `${id}.ts`, isDebugScene } as EngineSceneAsset,
        file: { file: '', fullPath: '', sourcePath: '' },
      });
    }
    return reg;
  };

  const TEXTS: Record<string, FontText[]> = {
    a: [
      { font: 'sans', text: 'ä 1+\n' },
      { font: 'mono', text: 'never' },
      { font: 'nope', text: 'x' },
    ],
    b: [{ font: 'sans', text: 'äÖ😀' }],
  };
  const listTexts = (data: EngineSceneAsset) => TEXTS[data.id as string] ?? [];

  it('collects each collecting font’s characters with the scenes writing them, no controls', () => {
    const reg = registries({ sans: true, mono: false }, { a: false, b: true });
    const collected = collectFontChars(reg, listTexts);
    expect([...collected.keys()]).toEqual(['sans']);
    expect([...(collected.get('sans') ?? [])]).toEqual([
      [0x20, new Set(['a'])],
      [0x2b, new Set(['a'])],
      [0x31, new Set(['a'])],
      [0xd6, new Set(['b'])],
      [0xe4, new Set(['a', 'b'])],
      [0x1f600, new Set(['b'])],
    ]);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aek-gather-fonts-'));
    tempRoots.push(root);
    writeFontCharsets(root, collected);
    expect(JSON.parse(fs.readFileSync(path.join(root, FONT_CHARSETS_FILENAME), 'utf8'))).toEqual({
      sans: ' +1Öä😀',
    });
  });

  /** The log a staleness check writes, with a run whose sans was encoded with `encodedChars` */
  const reportWith = (reg: Registries, encodedChars: string, isProduction: boolean) => {
    const font = reg.fonts.sans;
    const source = createFontSource(
      font.jsonFile,
      { fileName: `./${path.basename(FONT)}`, charset: font.font.charset },
      { collected: [...encodedChars].map((c) => c.codePointAt(0) as number) }
    );
    const pipeline: PipelineRun = {
      results: new Map([
        [
          getFontAssetKey(font.jsonFile),
          { status: 'optimized', asset: { source } } as unknown as PipelineRunResult,
        ],
      ]),
    };
    const messages = { error: [] as string[], warn: [] as string[] };
    const log = {
      error: (message: string) => messages.error.push(message),
      warn: (message: string) => messages.warn.push(message),
    } as unknown as GatherLog;
    reportStaleFonts(
      { isProduction, pipeline, log } as GatherContext,
      reg,
      collectFontChars(reg, listTexts)
    );
    return messages;
  };

  it('warns on a font whose atlas lacks a collected character, naming them and the command', () => {
    const reg = registries({ sans: true }, { a: false, b: true });
    // Space, + and 1 are the DIGITS preset's or always in; ä, Ö and 😀 were collected before
    expect(reportWith(reg, 'äÖ😀', false)).toEqual({ error: [], warn: [] });
    expect(reportWith(reg, 'ä', false)).toEqual({
      error: [],
      warn: [
        'The font "sans" is stale: its atlas lacks 2 character(s) the scenes\' texts write ("Ö" U+00D6, "😀" U+1F600; b). Encode it: yarn assets --only sans (until then they draw its fallback glyph)',
      ],
    });
  });

  it('fails a production build only when a shipped scene writes a missing character', () => {
    const reg = registries({ sans: true }, { a: false, b: true });
    // Ö and 😀 are only the debug scene b's
    expect(reportWith(reg, 'ä', true).error).toEqual([]);
    expect(reportWith(reg, 'ä', true).warn).toHaveLength(1);
    // ä is the shipped scene a's too
    expect(reportWith(reg, '', true).error).toEqual([
      expect.stringMatching(/^The font "sans" is stale: .*"ä" U\+00E4.*; a, b\)/),
    ]);
  });
});
