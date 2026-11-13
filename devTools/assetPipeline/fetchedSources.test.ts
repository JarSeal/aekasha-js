import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

// p303 Phase 2 section 2: a pack reading a texture set's fetched sources (`source/raw/`,
// gitignored) keeps its committed output on a clone that hasn't fetched them (`recipeKey`), and
// an edited recipe without them fails naming `yarn fetchTextureSources`. Run in a temp repo root,
// as prune.test.ts: `devTools/paths.ts`' ROOT is redirected there. The pack is passed through
// (`optimize: false`, a PNG), so no `ktx` is needed: the encode path shares the lookup.

const { TMP, REPO_ROOT } = await vi.hoisted(async () => {
  const fsp = await import('node:fs');
  const os = await import('node:os');
  const pathp = await import('node:path');
  const url = await import('node:url');
  const here = pathp.dirname(url.fileURLToPath(import.meta.url));
  return {
    TMP: fsp.mkdtempSync(pathp.join(os.tmpdir(), 'aek-p303-fetched-')),
    REPO_ROOT: pathp.resolve(here, '../..'),
  };
});

vi.mock('url', async (importOriginal) => {
  const actual = await importOriginal<typeof import('url')>();
  const fileURLToPath = (url: string | URL) => {
    const file = actual.fileURLToPath(url);
    return file === path.join(REPO_ROOT, 'devTools/paths.ts')
      ? path.join(TMP, 'devTools/paths.ts')
      : file;
  };
  return { ...actual, default: { ...actual, fileURLToPath }, fileURLToPath };
});

const { runAssetsCommand } = await import('./command');
const { ROOT } = await import('../paths');

const SET_DIR = path.join(TMP, 'src/toolkit/textures/sand01');
const RAW_DIR = path.join(SET_DIR, 'source/raw');
const LOCK_FILE = path.join(TMP, 'assets.lock.json');

const PACK = {
  size: [4, 4],
  channels: {
    rgb: { src: './source/raw/color.png' },
    a: { src: './source/mask.png', channel: 'r' },
  },
};

const png = (file: string, background: string) =>
  sharp({ create: { width: 4, height: 4, channels: 3, background } })
    .png()
    .toFile(file);

const writeTexture = (pack: unknown = PACK) =>
  fs.writeFileSync(
    path.join(SET_DIR, 'sand01_albedoRough.texture.json'),
    JSON.stringify({ id: 'sand01_albedoRough', pack, optimize: false })
  );

const readLock = () =>
  (
    JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8')) as {
      entries: Record<string, { url: string; recipeKey?: string }>;
    }
  ).entries;

const runFullAssets = () => runAssetsCommand({ projectOptOut: {}, verbosity: 'full', prune: true });

const getResult = async () => {
  const { run } = await runFullAssets();
  const [result] = [...run.results.values()];
  return result;
};

beforeEach(async () => {
  fs.rmSync(path.join(TMP, 'src'), { recursive: true, force: true });
  fs.rmSync(path.join(TMP, '.cache'), { recursive: true, force: true });
  fs.rmSync(LOCK_FILE, { force: true });
  if (!fs.existsSync(path.join(TMP, 'node_modules'))) {
    fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(TMP, 'node_modules'));
  }
  fs.copyFileSync(path.join(REPO_ROOT, 'assets.config.json'), path.join(TMP, 'assets.config.json'));
  fs.mkdirSync(RAW_DIR, { recursive: true });
  await png(path.join(RAW_DIR, 'color.png'), '#c0a080');
  await png(path.join(SET_DIR, 'source/mask.png'), '#ffffff');
  writeTexture();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe('p303: a pack whose fetched sources are missing', () => {
  it('is in the temp root', () => {
    expect(ROOT).toBe(TMP);
  });

  it('records its recipe key with the sources, and keeps the committed output without them', async () => {
    const built = await getResult();
    expect(built.status).toBe('passThrough');
    const [[key, entry]] = Object.entries(readLock());
    expect(entry.recipeKey).toMatch(/^[0-9a-f]{64}$/);

    // A clone: the committed output and lock, no `source/raw/`
    fs.rmSync(RAW_DIR, { recursive: true });
    fs.rmSync(path.join(TMP, '.cache'), { recursive: true, force: true });
    const cloned = await getResult();
    expect(cloned).toMatchObject({ status: 'passThrough', cache: 'hit' });
    expect(cloned.status === 'passThrough' && cloned.output.url).toBe(entry.url);
    // The prune kept it: the full run looked its entry up
    expect(Object.keys(readLock())).toEqual([key]);
    expect(fs.existsSync(path.join(TMP, 'src/public', entry.url))).toBe(true);
  });

  it('fails an edited recipe, or a changed committed source, without them', async () => {
    await getResult();
    fs.rmSync(RAW_DIR, { recursive: true });

    writeTexture({ ...PACK, channels: { ...PACK.channels, a: 1 } });
    const edited = await getResult();
    expect(edited.status).toBe('error');
    expect(edited.status === 'error' && edited.reason).toMatch(
      /^no committed output has this recipe, and its fetched sources aren't there \(src\/toolkit\/textures\/sand01\/source\/raw\/color\.png\): run yarn fetchTextureSources$/
    );

    writeTexture();
    await png(path.join(SET_DIR, 'source/mask.png'), '#000000');
    expect((await getResult()).status).toBe('error');
  });

  it('a missing source outside source/raw/ still fails as missing', async () => {
    fs.rmSync(path.join(SET_DIR, 'source/mask.png'));
    const result = await getResult();
    expect(result.status === 'error' && result.reason).toMatch(
      /source file ".\/source\/mask.png" not found/
    );
  });
});
