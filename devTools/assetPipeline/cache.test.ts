import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// p619 D14 and D16: the cache key (every input that decides an output's bytes, and nothing else)
// and its memo, kept across processes. Run in a temp repo root: `devTools/paths.ts`' ROOT is redirected
// there (as in prune.test.ts), so the memo file is the test's own.

const { TMP, REPO_ROOT } = await vi.hoisted(async () => {
  const fsp = await import('node:fs');
  const os = await import('node:os');
  const pathp = await import('node:path');
  const url = await import('node:url');
  const here = pathp.dirname(url.fileURLToPath(import.meta.url));
  return {
    TMP: fsp.mkdtempSync(pathp.join(os.tmpdir(), 'aek-p619-cache-')),
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

fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(TMP, 'node_modules'));
const SOURCE = path.join(TMP, 'src/source.bin');
const OTHER = path.join(TMP, 'src/other.bin');

/** The cache module as a new process loads it */
const loadCache = async () => {
  vi.resetModules();
  return import('./cache');
};

const input = (params: unknown, files = [SOURCE]) => ({ type: 'texture' as const, files, params });

beforeEach(() => {
  fs.mkdirSync(path.dirname(SOURCE), { recursive: true });
  fs.writeFileSync(SOURCE, 'source bytes');
  fs.writeFileSync(OTHER, 'other bytes');
  fs.rmSync(path.join(TMP, '.cache'), { recursive: true, force: true });
});

afterAll(() => {
  vi.restoreAllMocks();
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe('getCacheKey', () => {
  it('is the same for the same inputs, whatever their keys’ order', async () => {
    const { getCacheKey } = await loadCache();
    const key = getCacheKey(input({ a: 1, b: { c: 2, d: 3 } }));
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(getCacheKey(input({ b: { d: 3, c: 2 }, a: 1 }))).toBe(key);
  });

  it('changes with a param, a file’s bytes, the files’ order and the asset type', async () => {
    const { getCacheKey } = await loadCache();
    const key = getCacheKey(input({ a: 1 }));
    expect(getCacheKey(input({ a: 2 }))).not.toBe(key);
    expect(getCacheKey({ ...input({ a: 1 }), type: 'importedAsset' })).not.toBe(key);
    const both = getCacheKey(input({ a: 1 }, [SOURCE, OTHER]));
    expect(getCacheKey(input({ a: 1 }, [OTHER, SOURCE]))).not.toBe(both);
    fs.writeFileSync(SOURCE, 'changed bytes');
    expect(getCacheKey(input({ a: 1 }))).not.toBe(key);
  });

  it('a later process takes the key from the memo, without reading the source', async () => {
    const first = await loadCache();
    const key = first.getCacheKey(input({ a: 1 }));
    first.saveKeyMemo();
    expect(fs.existsSync(first.KEY_MEMO_FILE)).toBe(true);

    const second = await loadCache();
    const reads = vi.spyOn(fs, 'readFileSync');
    expect(second.getCacheKey(input({ a: 1 }))).toBe(key);
    expect(reads.mock.calls.filter(([file]) => file === SOURCE)).toEqual([]);
    reads.mockRestore();
  });

  it('hashes again after the source is written, even at the same size and mtime', async () => {
    // A whole second, so the mtime set back is exactly the first one
    fs.utimesSync(SOURCE, 1_000_000, 1_000_000);
    const first = await loadCache();
    const key = first.getCacheKey(input({ a: 1 }));
    first.saveKeyMemo();
    const { ctimeMs } = fs.statSync(SOURCE);
    fs.writeFileSync(SOURCE, 'SOURCE BYTES'); // Same length
    fs.utimesSync(SOURCE, 1_000_000, 1_000_000);
    // The kernel's ctime clock is coarse (a few ms): a write in the same tick keeps the ctime,
    // which a save a person makes never does. Touch again until it moves on.
    while (fs.statSync(SOURCE).ctimeMs === ctimeMs) fs.utimesSync(SOURCE, 1_000_000, 1_000_000);

    const second = await loadCache();
    expect(second.getCacheKey(input({ a: 1 }))).not.toBe(key);
  });

  it('a memo file it can’t read is no memo', async () => {
    const first = await loadCache();
    fs.mkdirSync(path.dirname(first.KEY_MEMO_FILE), { recursive: true });
    fs.writeFileSync(first.KEY_MEMO_FILE, '{ broken');
    expect(first.getCacheKey(input({ a: 1 }))).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('an entry with extra outputs (p391 D3: a font’s atlas beside its layout)', () => {
  it('is a hit with every output in place; the store brings back a missing one', async () => {
    const { createPipelineCache } = await loadCache();
    const { writeOutput } = await import('./outputs');
    const layout = writeOutput('app/fonts/a/a.layout', '.json', Buffer.from('{}'));
    const atlas = writeOutput('app/fonts/a/a.atlas', '.ktx2', Buffer.from('atlas bytes'));
    const opts = { lockFile: path.join(TMP, 'fonts.lock.json'), storeDir: path.join(TMP, 'store') };
    const cache = createPipelineCache(opts);
    cache.set('font', {
      source: 'src/app/fonts/a/A.woff',
      url: layout.url,
      bytes: layout.bytes,
      extraOutputs: [{ url: atlas.url, bytes: atlas.bytes }],
    });
    cache.save();
    expect(createPipelineCache(opts).get('font')?.from).toBe('output');

    fs.rmSync(atlas.file);
    expect(createPipelineCache(opts).get('font')?.from).toBe('store');
    expect(fs.readFileSync(atlas.file, 'utf-8')).toBe('atlas bytes');

    // Neither in place nor stored: a miss, so the font encodes again
    fs.rmSync(atlas.file);
    fs.rmSync(opts.storeDir, { recursive: true });
    expect(createPipelineCache(opts).get('font')).toBeNull();
  });
});
