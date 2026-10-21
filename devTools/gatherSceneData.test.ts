import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { GeneratedOutput } from './gatherOutput';

// p619 §1.4 G1-G3, G5, G6 and G12: the gather's bugs, checked against the repo's own data with fake
// files added to the gather's walk of src/ (nothing is written: the output is recorded).

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

/** A fake scene's JSON: the repo's first scene's file (never loaded), and `fields` */
const fakeScene = (id: string, fields: Record<string, unknown>) => {
  const { sceneFile } = JSON.parse(firstOf('.scene.json').text) as { sceneFile: string };
  return JSON.stringify({ id, sceneFile, ...fields });
};

/** The repo's first TSL material, as a fake one in FAKE_DIR with its file and another id */
const fakeTslMaterial = (id: string) => {
  const file = (readdirSync(SRC, { recursive: true }) as string[]).find(
    (f) =>
      f.endsWith('.material.json') && readFileSync(path.join(SRC, f), 'utf8').includes('"tslFile"')
  );
  if (!file) throw new Error('No TSL material in src/');
  const json = JSON.parse(readFileSync(path.join(SRC, file), 'utf8')) as Record<string, unknown>;
  // The gather resolves `tslFile` from the JSON's top folder under src/ (app/ for the fake)
  const tslFile = path.posix.join('..', file.split(path.sep)[0], String(json.tslFile));
  return JSON.stringify({ ...json, id, tslFile, __saveData: undefined });
};

/** Runs `fn` as a production gather (`NODE_ENV`, which the gather reads per call) */
const inProduction = <T>(fn: () => T) => {
  const before = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    return fn();
  } finally {
    process.env.NODE_ENV = before;
  }
};

type OutputScene = {
  cameras?: { camProps?: { type?: string } }[];
  materials?: Record<string, unknown>[];
  backgroundColor?: unknown;
  __saveData?: unknown;
};
const outputScene = (id: string) => written[0]?.json.scenes[id] as OutputScene | undefined;

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
  it('a second camera with the same id', () => {
    const camera = firstOf('.camera.json');
    addFakeFiles({ [`${FAKE_DIR}/dup.camera.json`]: camera.text });
    expect(gatherSceneData()).toBe(false);
  });

  it('a second scene with the same id', () => {
    const scene = firstOf('.scene.json');
    addFakeFiles({ [`${FAKE_DIR}/dup.scene.json`]: scene.text });
    expect(gatherSceneData()).toBe(false);
  });

  it('the first scene file keeps its id (pass 2 doesn’t let the later one win)', () => {
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
  it('a camera JSON cut off mid-save', () => {
    const camera = firstOf('.camera.json');
    addFakeFiles({ [`${FAKE_DIR}/broken.camera.json`]: camera.text.slice(0, 20) });
    expect(gatherSceneData()).toBe(false);
  });

  it('an empty light JSON', () => {
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
  it('no .schemas/ write at module load', () => {
    // The beforeAll's import recorded the writes of the load
    expect(schemaWrites).toEqual([]);
  });
});

describe('G5: save entries', () => {
  const files = {
    [`${FAKE_DIR}/saved.material.json`]: JSON.stringify({
      id: 'p619Mat',
      type: 'BASIC',
      debugData: { name: 'the asset’s' },
      __saveData: { p619Saved: [{ debugData: { name: 'the entry’s' } }] },
    }),
    [`${FAKE_DIR}/saved.scene.json`]: fakeScene('p619Saved', {
      materials: ['p619Mat'],
      __saveData: { p619Saved: [{ backgroundColor: '#123456' }] },
    }),
  };

  it('a scene’s own latest entry is applied, and the output has no __saveData', () => {
    addFakeFiles(files);
    expect(gatherSceneData()).toBe(true);
    expect(outputScene('p619Saved')?.backgroundColor).toBe('#123456');
    expect(outputScene('p619Saved')).not.toHaveProperty('__saveData');
  });

  it('production strips debugData after the entry is merged (an entry can hold one)', () => {
    addFakeFiles(files);
    expect(inProduction(() => gatherSceneData())).toBe(true);
    expect(outputScene('p619Saved')?.materials?.[0]).not.toHaveProperty('debugData');
  });
});

describe('G6', () => {
  it('an empty camera list gets the auto camera, as a missing one does', () => {
    addFakeFiles({ [`${FAKE_DIR}/noCams.scene.json`]: fakeScene('p619NoCams', { cameras: [] }) });
    expect(gatherSceneData()).toBe(true);
    expect(outputScene('p619NoCams')?.cameras?.map((cam) => cam.camProps?.type)).toEqual([
      'PERSPECTIVE',
    ]);
  });

  it('no material ships an empty nodes object', () => {
    expect(gatherSceneData()).toBe(true);
    const materials = Object.values(written[0].json.scenes).flatMap(
      (scene) => (scene as OutputScene).materials ?? []
    );
    expect(materials.length).toBeGreaterThan(0);
    expect(materials.filter((mat) => JSON.stringify(mat.nodes) === '{}')).toEqual([]);
  });

  it('a TSL material only a debug scene lists has no loader in production', () => {
    const files = {
      [`${FAKE_DIR}/debugOnly.material.json`]: fakeTslMaterial('p619DebugOnlyMat'),
      [`${FAKE_DIR}/debugOnly.scene.json`]: fakeScene('p619DebugOnly', {
        isDebugScene: true,
        materials: ['p619DebugOnlyMat'],
      }),
    };
    addFakeFiles(files);
    expect(gatherSceneData()).toBe(true);
    expect(written[0].loaders.tslMaterials).toHaveProperty('p619DebugOnlyMat');
    written.length = 0;
    expect(inProduction(() => gatherSceneData())).toBe(true);
    expect(written[0].loaders.tslMaterials).not.toHaveProperty('p619DebugOnlyMat');
  });
});

describe('G12: an id no asset JSON has fails the gather', () => {
  it.each([
    ['a material', { materials: ['p619NoSuchMaterial'] }],
    ['a camera', { cameras: ['p619NoSuchCamera'] }],
    ['a sky box', { skyboxes: ['p619NoSuchSky'] }],
  ])('%s', (_kind, fields) => {
    addFakeFiles({ [`${FAKE_DIR}/unknown.scene.json`]: fakeScene('p619Unknown', fields) });
    expect(gatherSceneData()).toBe(false);
  });
});
