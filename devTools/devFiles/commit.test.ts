import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// p619 §1.4 F5, F6: the commit's races and limits, the stage's folders, and the path and save
// entry edge cases; p355 §2.4: the backups kept, the dry run and the author stamp. Run in a temp
// repo root: `devTools/paths.ts`' ROOT (every path the dev files resolve
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
    return file === path.join(REPO_ROOT, 'devTools/paths.ts')
      ? path.join(TMP, 'devTools/paths.ts')
      : file;
  };
  return { ...actual, default: { ...actual, fileURLToPath }, fileURLToPath };
});

/** git's `user.name` as the mocked `readGit` answers it ('': not set) */
const gitUser = vi.hoisted(() => ({ name: '' }));

vi.mock('../git', () => ({
  readGit: (args: string[]) => (args.join(' ') === 'config user.name' ? gitUser.name : ''),
}));

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

const { commitDevFiles, MAX_FILE_BYTES, parseBackupsKept } = await import('./commit');
const { sha256 } = await import('../files');
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
  gitUser.name = '';
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

describe('p355: the backups kept', () => {
  const BACKUP_DIR = path.join(TMP, '.cache/dev-files/backup');
  const countBackups = () => (fs.existsSync(BACKUP_DIR) ? fs.readdirSync(BACKUP_DIR).length : 0);
  /** Three commits that each update the material */
  const commitThrice = async (backupsKept: number) => {
    for (const type of ['PHONG', 'LAMBERT', 'BASIC']) {
      await commitDevFiles(
        { writes: [{ path: MATERIAL, json: { id: 'm', type, params: {} } }] },
        { stage, backupsKept }
      );
    }
  };

  beforeEach(() => fs.rmSync(BACKUP_DIR, { recursive: true, force: true }));

  it('keeps the last n commits’ backups', async () => {
    await commitThrice(2);
    expect(countBackups()).toBe(2);
  });

  it('keeps none with 0, every one with -1', async () => {
    await commitThrice(0);
    expect(countBackups()).toBe(0);
    await commitThrice(-1);
    expect(countBackups()).toBe(3);
  });

  it('parses AEK_DEV_FILES_BACKUPS', () => {
    expect(parseBackupsKept(undefined)).toBe(20);
    expect(parseBackupsKept('')).toBe(20);
    expect(parseBackupsKept('5')).toBe(5);
    expect(parseBackupsKept('-1')).toBe(-1);
    expect(parseBackupsKept('0')).toBe(0);
    expect(parseBackupsKept('-2')).toBeNull();
    expect(parseBackupsKept('1.5')).toBeNull();
    expect(parseBackupsKept('all')).toBeNull();
  });
});

describe('p355: a dry run', () => {
  const NEW_FILE = `${DIR}/new.json`;
  const writes = [
    { path: MATERIAL, json: { id: 'm', type: 'PHONG' } },
    { path: NEW_FILE, json: { a: 1 } },
  ];

  it('writes nothing, and reports what the commit would do and the hashes to confirm it with', async () => {
    const before = fs.readFileSync(abs(MATERIAL));
    const dry = await commitDevFiles({ writes, dryRun: true }, { stage });
    expect(dry.isDryRun).toBe(true);
    expect(dry.body.results.map((result) => result.status)).toEqual(['updated', 'created']);
    expect(dry.body.results.map((result) => result.previousHash)).toEqual([sha256(before), null]);
    expect(fs.readFileSync(abs(MATERIAL)).equals(before)).toBe(true);
    expect(fs.existsSync(abs(NEW_FILE))).toBe(false);

    const confirmed = await commitDevFiles(
      {
        writes: writes.map((write, i) => ({
          ...write,
          expectedHash: dry.body.results[i].previousHash,
        })),
      },
      { stage }
    );
    expect(confirmed.body.results).toEqual(dry.body.results);
    expect(sha256(fs.readFileSync(abs(NEW_FILE)))).toBe(dry.body.results[1].sha256);
  });

  it('runs every check: a stale expectedHash is a CONFLICT', async () => {
    await expect(
      commitDevFiles(
        { writes: [{ ...writes[0], expectedHash: '0'.repeat(64) }], dryRun: true },
        {
          stage,
        }
      )
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('keeps its staged files for the commit it confirms', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
    const { stageId } = await stage.add(png);
    const write = { path: `${DIR}/i.png`, stageId };
    await commitDevFiles({ writes: [write], dryRun: true }, { stage });
    expect(fs.existsSync(stage.get(stageId).file)).toBe(true);
    const { body } = await commitDevFiles({ writes: [write] }, { stage });
    expect(body.results[0].status).toBe('created');
  });

  it('refuses a dryRun that isn’t a boolean', async () => {
    await expect(commitDevFiles({ writes, dryRun: 'yes' }, { stage })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });
});

describe('p355: entries of several scenes in one write', () => {
  type SaveDataFile = {
    __saveData: Record<string, { __meta: Record<string, unknown>; params: unknown }[]>;
  };
  const readSaveData = () =>
    (JSON.parse(fs.readFileSync(abs(MATERIAL), 'utf8')) as SaveDataFile).__saveData;
  const entry = (sceneId: string, color: string) => ({
    sceneId,
    entry: { params: { color } },
    historySize: 20,
  });

  it('puts each scene’s entry first in its list, stamped, in one write', async () => {
    const { body } = await commitDevFiles(
      { writes: [{ path: MATERIAL, saveData: [entry('a', '#ff0000'), entry('b', '#00ff00')] }] },
      { stage }
    );
    expect(body.results[0].status).toBe('updated');
    const saveData = readSaveData();
    expect(Object.keys(saveData)).toEqual(['a', 'b']);
    expect(saveData.a[0].params).toEqual({ color: '#ff0000' });
    expect(saveData.b[0].params).toEqual({ color: '#00ff00' });
    expect(saveData.b[0].__meta).toHaveProperty('engineVersion');
  });

  it('is unchanged only when every entry is its scene’s latest', async () => {
    const writes = [{ path: MATERIAL, saveData: [entry('a', '#ff0000'), entry('b', '#00ff00')] }];
    await commitDevFiles({ writes }, { stage });
    const again = await commitDevFiles({ writes }, { stage });
    expect(again.body.results[0].status).toBe('unchanged');
    const oneNew = await commitDevFiles(
      { writes: [{ path: MATERIAL, saveData: [entry('a', '#ff0000'), entry('b', '#0000ff')] }] },
      { stage }
    );
    expect(oneNew.body.results[0].status).toBe('updated');
    const saveData = readSaveData();
    expect(saveData.a).toHaveLength(1);
    expect(saveData.b).toHaveLength(2);
  });

  it('refuses an empty list and a scene twice', async () => {
    for (const saveData of [[], [entry('a', '#ff0000'), entry('a', '#00ff00')]]) {
      await expect(
        commitDevFiles({ writes: [{ path: MATERIAL, saveData }] }, { stage })
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    }
    expect(fs.readFileSync(abs(MATERIAL), 'utf8')).toBe(JSON.stringify({ id: 'm', type: 'BASIC' }));
  });
});

describe('p355: the author stamp', () => {
  const readMeta = () =>
    (
      JSON.parse(fs.readFileSync(abs(MATERIAL), 'utf8')) as {
        __saveData: Record<string, { __meta: Record<string, unknown> }[]>;
      }
    ).__saveData.s[0].__meta;
  const entryWithAuthor = (color: string) => ({
    path: MATERIAL,
    saveData: {
      sceneId: 's',
      entry: { __meta: { author: 'Someone Else' }, params: { color } },
      historySize: 20,
    },
  });

  it('stamps git’s user.name over the entry’s own', async () => {
    gitUser.name = 'Self Check';
    await commitDevFiles({ writes: [entryWithAuthor('#ff0000')] }, { stage });
    expect(readMeta().author).toBe('Self Check');
  });

  it('removes the entry’s own without a user.name', async () => {
    await commitDevFiles({ writes: [entryWithAuthor('#00ff00')] }, { stage });
    expect(readMeta()).not.toHaveProperty('author');
  });
});

describe('p355: json and saveData in one write', () => {
  const NEW_SKY = `${DIR}/sky.skybox.json`;
  const sky = { id: 'sky', base: { type: 'COLOR', color: '#000000' } };
  const write = (expectedHash?: string | null) => ({
    path: NEW_SKY,
    json: sky,
    saveData: { sceneId: 's', entry: { env: { environmentIntensity: 0.5 } }, historySize: 20 },
    ...(expectedHash !== undefined ? { expectedHash } : {}),
  });
  type SkyFile = typeof sky & {
    __saveData: Record<string, { __meta: Record<string, unknown>; env: unknown }[]>;
  };
  const readSky = () => JSON.parse(fs.readFileSync(abs(NEW_SKY), 'utf8')) as SkyFile;

  it('creates the file with the json and its entry, stamped', async () => {
    gitUser.name = 'Self Check';
    const { body } = await commitDevFiles({ writes: [write(null)] }, { stage });
    expect(body.results[0]).toMatchObject({ status: 'created', previousHash: null });
    const file = readSky();
    expect(file.base).toEqual(sky.base);
    expect(file.__saveData.s[0].env).toEqual({ environmentIntensity: 0.5 });
    expect(file.__saveData.s[0].__meta).toMatchObject({ author: 'Self Check' });
    expect(file.__saveData.s[0].__meta).toHaveProperty('engineVersion');
  });

  it('keeps the json’s own entries after the new one', async () => {
    const own = { ...sky, __saveData: { s: [{ env: { environmentIntensity: 0.2 } }] } };
    await commitDevFiles({ writes: [{ ...write(null), json: own }] }, { stage });
    expect(readSky().__saveData.s.map((entry) => entry.env)).toEqual([
      { environmentIntensity: 0.5 },
      { environmentIntensity: 0.2 },
    ]);
  });

  it('with expectedHash null, refuses a file that exists', async () => {
    fs.writeFileSync(abs(NEW_SKY), JSON.stringify(sky));
    await expect(commitDevFiles({ writes: [write(null)] }, { stage })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(fs.readFileSync(abs(NEW_SKY), 'utf8')).toBe(JSON.stringify(sky));
  });

  it('is unchanged when the file has those bytes already', async () => {
    await commitDevFiles({ writes: [write(null)] }, { stage });
    const written = readSky();
    const again = await commitDevFiles(
      { writes: [{ path: NEW_SKY, json: written, saveData: write().saveData }] },
      { stage }
    );
    // The entry equals the latest: the json is written as it came, which the file is
    expect(again.body.results[0].status).toBe('unchanged');
  });

  it('refuses a stageId with them, and a target without __saveData', async () => {
    await expect(
      commitDevFiles({ writes: [{ ...write(), stageId: 'x' }] }, { stage })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      commitDevFiles({ writes: [{ ...write(), path: `${DIR}/a.json` }] }, { stage })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});
