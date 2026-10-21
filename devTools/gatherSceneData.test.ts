import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { GeneratedOutput } from './gatherOutput';

// docs/plans/p619_review-schemas-pipeline-devtools-hub.md Phase 0: the gather's bugs (§1.4 G1-G3),
// reproduced against the repo's own data with fake files added to the gather's walk of src/. An
// `it.fails` is a bug not fixed yet: the phase that fixes it turns it into an `it`.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(REPO_ROOT, 'src');
const SCHEMAS_DIR = path.join(REPO_ROOT, '.schemas');
// A folder that doesn't exist: the fake files are only in the spied walk and reads
const FAKE_DIR = 'app/__p619Repro__';

const readdirSync = fs.readdirSync.bind(fs);
const readFileSync = fs.readFileSync.bind(fs);
const writeFileSync = fs.writeFileSync.bind(fs);

/** The repo's first file with this suffix, as a path from src/ and its text */
const firstOf = (suffix: string) => {
  const file = (readdirSync(SRC, { recursive: true }) as string[]).find((f) => f.endsWith(suffix));
  if (!file) throw new Error(`No ${suffix} in src/`);
  return { file, text: readFileSync(path.join(SRC, file), 'utf8') };
};

// The schema compile at load (G3) writes the tracked .schemas/: the spies record it, write nothing
const schemaWrites: string[] = [];
const spyWrites = () =>
  vi.spyOn(fs, 'writeFileSync').mockImplementation((file, ...rest) => {
    if (typeof file === 'string' && file.startsWith(SCHEMAS_DIR)) schemaWrites.push(file);
    else writeFileSync(file, ...rest);
  });

/** The generated output each gather would write, instead of writing it */
const written: GeneratedOutput[] = [];
vi.mock('./gatherOutput', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./gatherOutput')>();
  return {
    ...actual,
    writeGeneratedOutput: (_dir: string, output: GeneratedOutput) => void written.push(output),
    removeStaleProfileOutputs: () => [],
  };
});

/** Adds files (path from src/ → text) to the gather's walk and reads */
const addFakeFiles = (files: Record<string, string>) => {
  vi.spyOn(fs, 'readdirSync').mockImplementation(((dir: fs.PathLike, opts?: unknown) => {
    const entries = readdirSync(dir, opts as never) as unknown[];
    if (path.resolve(String(dir)) !== SRC) return entries;
    return [...entries, ...Object.keys(files)];
  }) as typeof fs.readdirSync);
  vi.spyOn(fs, 'readFileSync').mockImplementation(((
    file: fs.PathOrFileDescriptor,
    opts?: unknown
  ) => {
    const rel = typeof file === 'string' ? path.relative(SRC, file) : '';
    return rel in files ? files[rel] : readFileSync(file, opts as never);
  }) as typeof fs.readFileSync);
};

let gatherSceneData: typeof import('./gatherAppData').gatherSceneData;

beforeAll(async () => {
  const spy = spyWrites();
  ({ gatherSceneData } = await import('./gatherAppData'));
  spy.mockRestore();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  written.length = 0;
  vi.mocked(fs.readdirSync).mockRestore?.();
  vi.mocked(fs.readFileSync).mockRestore?.();
});

describe('the gather on the repo’s data', () => {
  it('succeeds without fake files', () => {
    expect(gatherSceneData()).toBe(true);
    expect(written.length).toBeGreaterThan(0);
  });
});

describe('G1: a duplicate id fails the gather', () => {
  it.fails('a second camera with the same id', () => {
    const camera = firstOf('.camera.json');
    addFakeFiles({ [`${FAKE_DIR}/dup.camera.json`]: camera.text });
    expect(gatherSceneData()).toBe(false);
  });

  it.fails('a second scene with the same id', () => {
    const scene = firstOf('.scene.json');
    addFakeFiles({ [`${FAKE_DIR}/dup.scene.json`]: scene.text });
    expect(gatherSceneData()).toBe(false);
  });

  it.fails('the first scene file keeps its id (pass 2 doesn’t let the later one win)', () => {
    const scene = firstOf('.scene.json');
    const json = JSON.parse(scene.text) as { id: string; name?: string };
    addFakeFiles({
      [`${FAKE_DIR}/dup.scene.json`]: JSON.stringify({ ...json, name: 'p619 duplicate' }),
    });
    gatherSceneData();
    const appOutput = written[0]?.json.scenes[json.id] as { name?: string } | undefined;
    expect(appOutput?.name).not.toBe('p619 duplicate');
  });
});

describe('G2: a malformed asset JSON fails the gather', () => {
  it.fails('a camera JSON cut off mid-save', () => {
    const camera = firstOf('.camera.json');
    addFakeFiles({ [`${FAKE_DIR}/broken.camera.json`]: camera.text.slice(0, 20) });
    expect(gatherSceneData()).toBe(false);
  });

  it.fails('an empty light JSON', () => {
    addFakeFiles({ [`${FAKE_DIR}/empty.light.json`]: '' });
    expect(gatherSceneData()).toBe(false);
  });

  it('a scene JSON cut off mid-save (already fails: pass 1 rethrows)', () => {
    const scene = firstOf('.scene.json');
    addFakeFiles({ [`${FAKE_DIR}/broken.scene.json`]: scene.text.slice(0, 20) });
    expect(gatherSceneData()).toBe(false);
  });
});

describe('G3: importing the gatherer writes nothing', () => {
  it.fails('no .schemas/ write at module load', () => {
    // The beforeAll's import recorded the writes of the load
    expect(schemaWrites).toEqual([]);
  });
});
