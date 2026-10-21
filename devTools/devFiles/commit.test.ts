import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// p619 §1.4 F5, F6: the commit's races and limits, the stage's folders, and the path and save
// entry edge cases. Run in a temp repo root: `sources.ts`' ROOT (every path the dev files resolve
// and write, the backups and the stage) is redirected there, so the repo is never written.

const { TMP, REPO_ROOT, formatHook } = await vi.hoisted(async () => {
  const fsp = await import('node:fs');
  const os = await import('node:os');
  const pathp = await import('node:path');
  const url = await import('node:url');
  const here = pathp.dirname(url.fileURLToPath(import.meta.url));
  return {
    TMP: fsp.mkdtempSync(pathp.join(os.tmpdir(), 'aek-p619-devfiles-')),
    REPO_ROOT: pathp.resolve(here, '../..'),
    /** Runs while Prettier formats a write: an editor's save in the middle of a commit */
    formatHook: { run: null as null | (() => void), calls: 0 },
  };
});

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

vi.mock('./format', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./format')>();
  return {
    formatDevFileJson: (...args: Parameters<typeof actual.formatDevFileJson>) => {
      formatHook.calls++;
      formatHook.run?.();
      return actual.formatDevFileJson(...args);
    },
  };
});

const { commitDevFiles, MAX_FILE_BYTES } = await import('./commit');
const { createStage } = await import('./stage');
const { resolveDevFilePath } = await import('./paths');

const DIR = 'src/app/x';
const abs = (repoPath: string) => path.join(TMP, ...repoPath.split('/'));
const MATERIAL = `${DIR}/m.material.json`;
const stage = createStage();

beforeEach(() => {
  fs.rmSync(path.join(TMP, 'src'), { recursive: true, force: true });
  fs.mkdirSync(abs(DIR), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, 'package.json'), path.join(TMP, 'package.json'));
  fs.writeFileSync(abs(MATERIAL), JSON.stringify({ id: 'm', type: 'BASIC' }));
  formatHook.run = null;
  formatHook.calls = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  stage.dispose();
  fs.rmSync(TMP, { recursive: true, force: true });
});

const saveEntry = (sceneId: string) => ({
  path: MATERIAL,
  saveData: { sceneId, entry: { params: { color: '#ff0000' } }, historySize: 20 },
});

describe('F5: a save while the commit is prepared', () => {
  it('fails with CONFLICT and keeps the editor’s save', async () => {
    formatHook.run = () => fs.writeFileSync(abs(MATERIAL), '{ "id": "m", "type": "PHONG" }');
    await expect(commitDevFiles({ writes: [saveEntry('s')] }, { stage })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(fs.readFileSync(abs(MATERIAL), 'utf8')).toBe('{ "id": "m", "type": "PHONG" }');
  });

  it('fails with CONFLICT when a new file appears after the plan, and leaves no temporary', async () => {
    const newFile = `${DIR}/new.json`;
    // The write step's first mkdir: after the plan read the target (missing), before the renames
    const mkdir = fsp.mkdir.bind(fsp);
    vi.spyOn(fsp, 'mkdir').mockImplementationOnce(async (...args) => {
      fs.writeFileSync(abs(newFile), 'theirs');
      return mkdir(...args);
    });
    await expect(
      commitDevFiles({ writes: [{ path: newFile, json: { a: 1 } }] }, { stage })
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(fs.readFileSync(abs(newFile), 'utf8')).toBe('theirs');
    expect(fs.readdirSync(abs(DIR)).filter((name) => name.endsWith('.aek-tmp'))).toEqual([]);
  });

  it('lands when nothing changed meanwhile', async () => {
    const { body } = await commitDevFiles({ writes: [saveEntry('s')] }, { stage });
    expect(body.results[0].status).toBe('updated');
  });
});

describe('F5: the size limit', () => {
  it('refuses a JSON over the limit before Prettier formats it', async () => {
    const json = { text: 'x'.repeat(MAX_FILE_BYTES) };
    await expect(
      commitDevFiles({ writes: [{ path: `${DIR}/big.json`, json }] }, { stage })
    ).rejects.toMatchObject({ code: 'TOO_LARGE' });
    expect(formatHook.calls).toBe(0);
  });
});

describe('F5: each server stages into its own folder', () => {
  it('a second server keeps the first one’s staged files, and removes a gone one’s', async () => {
    const goneDir = path.join(TMP, '.cache/dev-files/stage', `${2 ** 22 + 1}-dead`);
    fs.mkdirSync(goneDir, { recursive: true });
    const { stageId } = await stage.add(Buffer.from('png'));
    const second = createStage();
    try {
      expect(fs.existsSync(stage.get(stageId).file)).toBe(true);
      expect(fs.existsSync(goneDir)).toBe(false);
    } finally {
      second.dispose();
    }
    expect(fs.existsSync(stage.get(stageId).file)).toBe(true);
  });
});

describe('F6', () => {
  it('a folder that is a broken symlink is FORBIDDEN_PATH, not a 500', async () => {
    fs.symlinkSync(path.join(TMP, 'nowhere'), abs(`${DIR}/broken`), 'dir');
    await expect(resolveDevFilePath(`${DIR}/broken/a.json`)).rejects.toMatchObject({
      code: 'FORBIDDEN_PATH',
    });
  });

  it('"toString" is a scene id like any other', async () => {
    const { body } = await commitDevFiles({ writes: [saveEntry('toString')] }, { stage });
    expect(body.results[0].status).toBe('updated');
    const file = JSON.parse(fs.readFileSync(abs(MATERIAL), 'utf8')) as {
      __saveData: Record<string, unknown[]>;
    };
    expect(file.__saveData.toString).toHaveLength(1);
  });

  it('"__proto__" is refused', async () => {
    await expect(
      commitDevFiles({ writes: [saveEntry('__proto__')] }, { stage })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});
