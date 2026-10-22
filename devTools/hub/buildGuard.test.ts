import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { ROOT } from './paths';

// p619 §1.4 H1: a public build replaced its `outDir` whatever it was (`yarn hub:build --out .`
// deleted the repo), and emptied it before steps that can still fail. The spy throws instead of
// deleting a protected folder, so this test never deletes anything of the repo's.

const { failingEmbedCopy } = vi.hoisted(() => ({ failingEmbedCopy: { isOn: false } }));

vi.mock('./embed', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./embed')>();
  return {
    ...actual,
    copyHubEmbeds: (...args: Parameters<typeof actual.copyHubEmbeds>) => {
      if (failingEmbedCopy.isOn) throw new Error('p619 test: the embed copy failed');
      actual.copyHubEmbeds(...args);
    },
  };
});

const { buildHub } = await import('./build');
const { commitHubStagingDir, createHubStagingDir, getHubOutDirError, getHubStagingDir } =
  await import('./outDir');

const SENTINEL = 'p619: rmSync of a protected folder';
const PROTECTED = [ROOT, path.dirname(ROOT), path.join(ROOT, 'src')];

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aek-p619-hub-out-'));

/** A folder holding what a public build writes at its root, plus `stale.html` */
const writeOldOutput = (dir: string) => {
  fs.mkdirSync(path.join(dir, '_assets'), { recursive: true });
  for (const name of ['_headers', '404.html', 'stale.html']) {
    fs.writeFileSync(path.join(dir, name), 'old');
  }
};

const rmSync = fs.rmSync.bind(fs);

afterEach(() => {
  vi.restoreAllMocks();
  failingEmbedCopy.isOn = false;
});

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe('H1: a public build refuses to empty a folder that isn’t a Hub output', () => {
  it('refuses the repo root before it builds', async () => {
    const removed: string[] = [];
    vi.spyOn(fs, 'rmSync').mockImplementation((target, opts) => {
      const file = path.resolve(String(target));
      if (PROTECTED.includes(file)) {
        removed.push(file);
        throw new Error(SENTINEL);
      }
      rmSync(target, opts);
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const build = buildHub({ mode: 'public', outDir: ROOT, api: 'none', isEmbedLive: false });
    await expect(build).rejects.toThrow(/refuse|not a Hub output/i);
    expect(removed).toEqual([]);
  }, 60_000);

  it.each([
    ['the repo root', ROOT, /holds the repo/],
    ['a folder above it', path.dirname(ROOT), /holds the repo/],
    ['src/', path.join(ROOT, 'src'), /source folders/],
    ['hub/', path.join(ROOT, 'hub'), /source folders/],
  ])('refuses %s', (_label, dir, message) => {
    expect(getHubOutDirError(dir)).toMatch(message);
  });

  it('refuses a non-empty folder that isn’t a Hub output, and a file', () => {
    const dir = path.join(TMP, 'photos');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'cat.jpg'), 'meow');
    expect(getHubOutDirError(dir)).toMatch(/not a Hub output/);
    expect(getHubOutDirError(path.join(dir, 'cat.jpg'))).toMatch(/is a file/);
  });

  it('takes a missing folder, an empty one and an earlier Hub output', () => {
    expect(getHubOutDirError(path.join(TMP, 'missing'))).toBeNull();
    fs.mkdirSync(path.join(TMP, 'empty'), { recursive: true });
    expect(getHubOutDirError(path.join(TMP, 'empty'))).toBeNull();
    writeOldOutput(path.join(TMP, 'earlier'));
    expect(getHubOutDirError(path.join(TMP, 'earlier'))).toBeNull();
  });
});

describe('H1: a public build replaces its output only when nothing failed', () => {
  it('swaps the staging folder in, and the old output out', () => {
    const outDir = path.join(TMP, 'swap');
    writeOldOutput(outDir);
    const staging = createHubStagingDir(outDir);
    expect(staging).toBe(getHubStagingDir(outDir));
    fs.writeFileSync(path.join(staging, 'index.html'), 'new');
    commitHubStagingDir(staging, outDir);
    expect(fs.readdirSync(outDir)).toEqual(['index.html']);
    expect(fs.existsSync(staging)).toBe(false);
    expect(fs.readdirSync(TMP).filter((name) => name.startsWith('swap.'))).toEqual([]);
  });

  it('leaves the last output as it was when a write step throws', async () => {
    const outDir = path.join(TMP, 'failing');
    writeOldOutput(outDir);
    failingEmbedCopy.isOn = true;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const build = buildHub({ mode: 'public', outDir, api: 'none', isEmbedLive: false });
    await expect(build).rejects.toThrow('the embed copy failed');
    expect(fs.readdirSync(outDir).sort()).toEqual([
      '404.html',
      '_assets',
      '_headers',
      'stale.html',
    ]);
    expect(fs.existsSync(getHubStagingDir(outDir))).toBe(false);
  }, 60_000);
});
