import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

// p619 §1.4 A1-A3: `yarn assets`' prune keeps what it can't rebuild, and what another run is
// writing; A5: an output of the wrong size is written again. Run in a temp repo root: `sources.ts`' ROOT (every path the pipeline writes) is
// redirected there, so the repo's own outputs are never touched. `ktx` is missing, as on a clone
// without `yarn setupAssetTools`.

const { TMP, REPO_ROOT } = await vi.hoisted(async () => {
  const fsp = await import('node:fs');
  const os = await import('node:os');
  const pathp = await import('node:path');
  const url = await import('node:url');
  const here = pathp.dirname(url.fileURLToPath(import.meta.url));
  return {
    TMP: fsp.mkdtempSync(pathp.join(os.tmpdir(), 'aek-p619-prune-')),
    REPO_ROOT: pathp.resolve(here, '../..'),
  };
});

// sources.ts computes ROOT from its own URL: that one URL resolves into the temp root
vi.mock('url', async (importOriginal) => {
  const actual = await importOriginal<typeof import('url')>();
  const fileURLToPath = (url: string | URL) => {
    const file = actual.fileURLToPath(url);
    return file === path.join(REPO_ROOT, 'devTools/assetPipeline/sources.ts')
      ? path.join(TMP, 'devTools/assetPipeline/sources.ts')
      : file;
  };
  return { ...actual, default: { ...actual, fileURLToPath }, fileURLToPath };
});

// No `ktx`, without looking for one
vi.mock('./ktxEncode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ktxEncode')>();
  return {
    ...actual,
    createKtxProvider: () => () =>
      Promise.reject(new actual.EncoderMissingError('ktx not set up (p619 test)')),
  };
});

const { runAssetsCommand } = await import('./command');
const { ROOT } = await import('./sources');
const { RUN_LOCK_FILE } = await import('./runLock');
const { getContentHash, writeOutput } = await import('./outputs');

const TEXTURE_DIR = path.join(TMP, 'src/app/t');
const AEK_ASSETS = path.join(TMP, 'src/public/aek-assets');
// What an earlier run on a machine with `ktx` committed for rock.texture.json
const COMMITTED_OUTPUT = path.join(AEK_ASSETS, 'app/t/rock.0123abcd.ktx2');
const LOCK_FILE = path.join(TMP, 'assets.lock.json');
const LOCK_KEY = 'f'.repeat(64);

const writeTree = async (textureJson: unknown, opts: { rawJson?: string } = {}) => {
  fs.rmSync(path.join(TMP, 'src'), { recursive: true, force: true });
  fs.mkdirSync(TEXTURE_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(COMMITTED_OUTPUT), { recursive: true });
  await sharp({ create: { width: 4, height: 4, channels: 3, background: '#808080' } })
    .png()
    .toFile(path.join(TEXTURE_DIR, 'rock.png'));
  fs.writeFileSync(
    path.join(TEXTURE_DIR, 'rock.texture.json'),
    opts.rawJson ?? JSON.stringify(textureJson)
  );
  fs.writeFileSync(COMMITTED_OUTPUT, 'ktx2 bytes');
  // Committed earlier: the prune keeps a file changed after its run started (A3)
  const anHourAgo = new Date(Date.now() - 3_600_000);
  fs.utimesSync(COMMITTED_OUTPUT, anHourAgo, anHourAgo);
  // Its lock entry, under a key this run can't match (a PIPELINE_VERSION or tool bump since)
  fs.writeFileSync(
    LOCK_FILE,
    JSON.stringify({
      '//': 'p619 test',
      entries: {
        [LOCK_KEY]: {
          source: 'src/app/t/rock.png',
          url: '/aek-assets/app/t/rock.0123abcd.ktx2',
          bytes: 10,
        },
      },
    })
  );
};

const lockKeys = () =>
  Object.keys((JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8')) as { entries: object }).entries);

beforeEach(() => {
  fs.mkdirSync(TMP, { recursive: true });
  if (!fs.existsSync(path.join(TMP, 'node_modules'))) {
    fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(TMP, 'node_modules'));
  }
  fs.copyFileSync(path.join(REPO_ROOT, 'assets.config.json'), path.join(TMP, 'assets.config.json'));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});

const runFullAssets = () => runAssetsCommand({ projectOptOut: {}, verbosity: 'full', prune: true });

describe('the temp root (the check itself)', () => {
  it('is where the pipeline writes', () => {
    expect(ROOT).toBe(TMP);
  });

  it('a run with the asset encodes it as encoderMissing', async () => {
    await writeTree({ id: 'rock', fileName: './rock.png' });
    const { run } = await runFullAssets();
    expect([...run.results.values()].map((result) => result.status)).toEqual(['encoderMissing']);
  });
});

describe('A1: yarn assets without ktx keeps what it couldn’t rebuild', () => {
  it('the committed output stays', async () => {
    await writeTree({ id: 'rock', fileName: './rock.png' });
    await runFullAssets();
    expect(fs.existsSync(COMMITTED_OUTPUT)).toBe(true);
  });

  it('its lock entry stays', async () => {
    await writeTree({ id: 'rock', fileName: './rock.png' });
    await runFullAssets();
    expect(lockKeys()).toEqual([LOCK_KEY]);
  });
});

describe('A2: an asset dropped before the run keeps its outputs', () => {
  it('a texture JSON that fails its schema (a typo mid-edit)', async () => {
    await writeTree({ id: 'rock', fileName: './rock.png', texOpts: { wrapS: 'REPEET' } });
    await runFullAssets();
    expect(fs.existsSync(COMMITTED_OUTPUT)).toBe(true);
  });

  it('a texture whose source doesn’t resolve (renamed mid-edit)', async () => {
    await writeTree({ id: 'rock', fileName: './rock-renamed.png' });
    await runFullAssets();
    expect(fs.existsSync(COMMITTED_OUTPUT)).toBe(true);
  });

  it('a texture JSON that isn’t JSON (an editor’s half-written save)', async () => {
    await writeTree(null, { rawJson: '{ "id": "ro' });
    await runFullAssets();
    expect(fs.existsSync(COMMITTED_OUTPUT)).toBe(true);
    expect(lockKeys()).toEqual([LOCK_KEY]);
  });
});

describe('a complete run still prunes', () => {
  it('removes the output and the lock entry nothing uses', async () => {
    // Passed through: an output without ktx, so nothing is missing
    await writeTree({ id: 'rock', fileName: './rock.png', optimize: false });
    const { run } = await runFullAssets();
    expect([...run.results.values()].map((result) => result.status)).toEqual(['passThrough']);
    expect(fs.existsSync(COMMITTED_OUTPUT)).toBe(false);
    expect(lockKeys()).toEqual([]);
  });
});

describe('A3: the prune leaves alone what another run is writing', () => {
  it('keeps a running process’s temp file, and removes a leftover one', async () => {
    await writeTree({ id: 'rock', fileName: './rock.png', optimize: false });
    const live = path.join(AEK_ASSETS, `app/t/other.12345678.ktx2.${process.pid}.tmp`);
    // No process has pid 2^22 + 1 (Linux's limit is 2^22)
    const leftover = path.join(AEK_ASSETS, `app/t/other.12345678.ktx2.${2 ** 22 + 1}.tmp`);
    fs.writeFileSync(live, 'half');
    fs.writeFileSync(leftover, 'half');
    await runFullAssets();
    expect(fs.existsSync(live)).toBe(true);
    expect(fs.existsSync(leftover)).toBe(false);
  });

  it('keeps an output written after the run started (under a key it never saw)', async () => {
    await writeTree({ id: 'rock', fileName: './rock.png', optimize: false });
    const later = path.join(AEK_ASSETS, 'app/t/other.12345678.ktx2');
    fs.writeFileSync(later, 'ktx2 bytes');
    const inAMinute = new Date(Date.now() + 60_000);
    fs.utimesSync(later, inAMinute, inAMinute);
    await runFullAssets();
    expect(fs.existsSync(later)).toBe(true);
    expect(fs.existsSync(COMMITTED_OUTPUT)).toBe(false);
  });

  it('waits for another process’s prune and save, then takes the lock', async () => {
    await writeTree({ id: 'rock', fileName: './rock.png', optimize: false });
    fs.mkdirSync(path.dirname(RUN_LOCK_FILE), { recursive: true });
    // A live owner: this process
    fs.writeFileSync(RUN_LOCK_FILE, JSON.stringify({ pid: process.pid, since: Date.now() }));
    let releasedAt = 0;
    setTimeout(() => {
      releasedAt = Date.now();
      fs.rmSync(RUN_LOCK_FILE);
    }, 300);
    await runFullAssets();
    expect(releasedAt).toBeGreaterThan(0);
    expect(lockKeys()).toEqual([]);
    expect(fs.existsSync(RUN_LOCK_FILE)).toBe(false);
  });

  it('takes over a lock whose owner is gone', async () => {
    await writeTree({ id: 'rock', fileName: './rock.png', optimize: false });
    fs.mkdirSync(path.dirname(RUN_LOCK_FILE), { recursive: true });
    fs.writeFileSync(RUN_LOCK_FILE, JSON.stringify({ pid: 2 ** 22 + 1, since: 0 }));
    await runFullAssets();
    expect(lockKeys()).toEqual([]);
    expect(fs.existsSync(RUN_LOCK_FILE)).toBe(false);
  });
});

describe('A5: writeOutput', () => {
  it('writes a present output of the wrong size again, and leaves a right one alone', () => {
    const bytes = new TextEncoder().encode('the whole output');
    const file = path.join(AEK_ASSETS, `app/t/w.${getContentHash(bytes)}.bin`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'the who');
    expect(writeOutput('app/t/w', '.bin', bytes).file).toBe(file);
    expect(fs.readFileSync(file, 'utf8')).toBe('the whole output');
    const anHourAgo = new Date(Date.now() - 3_600_000);
    fs.utimesSync(file, anHourAgo, anHourAgo);
    writeOutput('app/t/w', '.bin', bytes);
    // Not written again: still about an hour old (utimes rounds below the millisecond)
    expect(fs.statSync(file).mtimeMs).toBeLessThan(Date.now() - 60_000);
  });
});
