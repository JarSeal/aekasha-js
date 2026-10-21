import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

// docs/plans/p619_review-schemas-pipeline-devtools-hub.md Phase 0: `yarn assets`' prune deletes
// committed outputs it can't rebuild (§1.4 A1, A2). Run in a temp repo root: `sources.ts`' ROOT
// (every path the pipeline writes) is redirected there, so the repo's own outputs are never
// touched. `ktx` is missing, as on a clone without `yarn setupAssetTools`. An `it.fails` is a bug
// not fixed yet: the phase that fixes it turns it into an `it`.

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

const TEXTURE_DIR = path.join(TMP, 'src/app/t');
const AEK_ASSETS = path.join(TMP, 'src/public/aek-assets');
// What an earlier run on a machine with `ktx` committed for rock.texture.json
const COMMITTED_OUTPUT = path.join(AEK_ASSETS, 'app/t/rock.0123abcd.ktx2');
const LOCK_FILE = path.join(TMP, 'assets.lock.json');
const LOCK_KEY = 'f'.repeat(64);

const writeTree = async (textureJson: unknown) => {
  fs.rmSync(path.join(TMP, 'src'), { recursive: true, force: true });
  fs.mkdirSync(TEXTURE_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(COMMITTED_OUTPUT), { recursive: true });
  await sharp({ create: { width: 4, height: 4, channels: 3, background: '#808080' } })
    .png()
    .toFile(path.join(TEXTURE_DIR, 'rock.png'));
  fs.writeFileSync(path.join(TEXTURE_DIR, 'rock.texture.json'), JSON.stringify(textureJson));
  fs.writeFileSync(COMMITTED_OUTPUT, 'ktx2 bytes');
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
  it.fails('the committed output stays', async () => {
    await writeTree({ id: 'rock', fileName: './rock.png' });
    await runFullAssets();
    expect(fs.existsSync(COMMITTED_OUTPUT)).toBe(true);
  });

  it.fails('its lock entry stays', async () => {
    await writeTree({ id: 'rock', fileName: './rock.png' });
    await runFullAssets();
    expect(lockKeys()).toEqual([LOCK_KEY]);
  });
});

describe('A2: an asset dropped before the run keeps its outputs', () => {
  it.fails('a texture JSON that fails its schema (a typo mid-edit)', async () => {
    await writeTree({ id: 'rock', fileName: './rock.png', texOpts: { wrapS: 'REPEET' } });
    await runFullAssets();
    expect(fs.existsSync(COMMITTED_OUTPUT)).toBe(true);
  });

  it.fails('a texture whose source doesn’t resolve (renamed mid-edit)', async () => {
    await writeTree({ id: 'rock', fileName: './rock-renamed.png' });
    await runFullAssets();
    expect(fs.existsSync(COMMITTED_OUTPUT)).toBe(true);
  });
});
