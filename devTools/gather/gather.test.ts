import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { gatherSceneData } from '../gatherAppData';
import { ROOT } from '../paths';
import { GENERATED_APP_DATA_FILENAME, GENERATED_APP_FNS_FILENAME } from './output';

// The gather on the repo's data, and its rules (p619 G1-G3, G5, G6, G12, G13) on small trees in a
// temp folder (the gather's `srcDir` and `outDir`): nothing under the repo is written.

const tempRoots: string[] = [];

/** A temp `src/` holding `files` (path from src/ → JSON value or text), and an output folder */
const makeTree = (files: Record<string, unknown>) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aek-gather-'));
  tempRoots.push(root);
  const srcDir = path.join(root, 'src');
  for (const [file, content] of Object.entries(files)) {
    const fullPath = path.join(srcDir, file);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, typeof content === 'string' ? content : JSON.stringify(content));
  }
  return { srcDir, outDir: path.join(root, 'out') };
};

type OutputScene = Record<string, unknown> & {
  cameras?: { camProps?: Record<string, unknown> }[];
  materials?: Record<string, unknown>[];
  meshes?: { props: Record<string, unknown> }[];
};
type Output = { json: { scenes: Record<string, OutputScene> }; fns: string };

/** Gathers a tree (no profiles, no pipeline) */
const gather = (files: Record<string, unknown>, opts: { isProduction?: boolean } = {}) => {
  const tree = makeTree(files);
  const isGathered = gatherSceneData({ ...tree, profiles: [], isProduction: !!opts.isProduction });
  const dataFile = path.join(tree.outDir, GENERATED_APP_DATA_FILENAME);
  const output: Output | null = fs.existsSync(dataFile)
    ? {
        json: JSON.parse(fs.readFileSync(dataFile, 'utf8')) as Output['json'],
        fns: fs.readFileSync(path.join(tree.outDir, GENERATED_APP_FNS_FILENAME), 'utf8'),
      }
    : null;
  return { isGathered, output, scene: (id: string) => output?.json.scenes[id] };
};

// A scene `id` with its scene file, and `fields`
const scene = (id: string, fields: Record<string, unknown> = {}) => ({
  [`app/scenes/${id}/${id}.scene.json`]: { id, sceneFile: `scenes/${id}/${id}.ts`, ...fields },
  [`app/scenes/${id}/${id}.ts`]: 'export const scene = async () => {};\n',
});
const camera = (appId: string) => ({ camProps: { type: 'PERSPECTIVE', appId } });
const material = (id: string, fields: Record<string, unknown> = {}) => ({
  id,
  type: 'BASIC',
  ...fields,
});
const tslMaterial = (id: string) => ({
  [`app/materials/${id}.material.json`]: {
    id,
    type: 'STANDARDNODEMATERIAL',
    tslFile: `materials/${id}.tsl.ts`,
    nodes: { colorNode: { scale: 1 } },
  },
  [`app/materials/${id}.tsl.ts`]: 'export const colorNode = () => null;\n',
});

beforeAll(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterAll(() => {
  vi.restoreAllMocks();
  for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true });
});

describe('the repo’s data', () => {
  it.each([false, true])('gathers (production: %s)', (isProduction) => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aek-gather-repo-'));
    tempRoots.push(outDir);
    expect(gatherSceneData({ outDir, isProduction })).toBe(true);
    const json = JSON.parse(
      fs.readFileSync(path.join(outDir, GENERATED_APP_DATA_FILENAME), 'utf8')
    );
    expect(Object.keys(json.scenes).length).toBeGreaterThan(0);
  });

  it('importing the gatherer writes nothing (G3)', async () => {
    vi.resetModules();
    const writes = vi.spyOn(fs, 'writeFileSync');
    await import('../gatherAppData');
    expect(writes.mock.calls.filter(([file]) => String(file).startsWith(ROOT))).toEqual([]);
    writes.mockRestore();
  });
});

describe('a failed gather writes nothing', () => {
  it('no output folder', () => {
    const { isGathered, output } = gather({ ...scene('a', { cameras: ['missing'] }) });
    expect(isGathered).toBe(false);
    expect(output).toBeNull();
  });
});

describe('G1: a duplicate id fails the gather', () => {
  it('a second camera with the same id', () => {
    const files = {
      ...scene('a'),
      'app/one.camera.json': camera('cam'),
      'app/two.camera.json': camera('cam'),
    };
    expect(gather(files).isGathered).toBe(false);
  });

  it('a second scene with the same id', () => {
    const files = {
      ...scene('a', { name: 'first' }),
      'app/scenes/b/b.scene.json': { id: 'a', sceneFile: 'scenes/a/a.ts', name: 'second' },
    };
    expect(gather(files).isGathered).toBe(false);
  });

  it('a second material with the same id', () => {
    const files = {
      ...scene('a'),
      'app/one.material.json': material('m'),
      'app/two.material.json': material('m'),
    };
    expect(gather(files).isGathered).toBe(false);
  });
});

describe('G2: a malformed asset JSON fails the gather', () => {
  it.each([
    ['a camera JSON cut off mid-save', 'app/broken.camera.json', '{ "camProps": { "ty'],
    ['an empty light JSON', 'app/empty.light.json', ''],
    ['a scene JSON cut off mid-save', 'app/scenes/b/b.scene.json', '{ "id": "b", '],
  ])('%s', (_case, file, text) => {
    expect(gather({ ...scene('a'), [file]: text }).isGathered).toBe(false);
  });
});

describe('G5: save entries', () => {
  const files = {
    'app/saved.material.json': material('mat', {
      debugData: { name: 'the asset’s' },
      __saveData: { saved: [{ debugData: { name: 'the entry’s' } }] },
    }),
    ...scene('saved', {
      materials: ['mat'],
      __saveData: { saved: [{ backgroundColor: '#123456' }] },
    }),
  };

  it('a scene’s own latest entry is applied, and the output has no __saveData', () => {
    const { isGathered, scene: get } = gather(files);
    expect(isGathered).toBe(true);
    expect(get('saved')?.backgroundColor).toBe('#123456');
    expect(get('saved')).not.toHaveProperty('__saveData');
  });

  it('production strips debugData after the entry is merged (an entry can hold one)', () => {
    const { isGathered, scene: get } = gather(files, { isProduction: true });
    expect(isGathered).toBe(true);
    expect(get('saved')?.materials?.[0]).not.toHaveProperty('debugData');
  });
});

describe('G6', () => {
  it('an empty camera list gets the auto camera, as a missing one does', () => {
    const { scene: get } = gather({ ...scene('a', { cameras: [] }), ...scene('b') });
    for (const id of ['a', 'b']) {
      expect(get(id)?.cameras?.map((cam) => cam.camProps?.type)).toEqual(['PERSPECTIVE']);
    }
  });

  it('no material ships an empty nodes object', () => {
    const files = { ...scene('a', { materials: ['m'] }), 'app/m.material.json': material('m') };
    expect(gather(files).scene('a')?.materials?.[0]).not.toHaveProperty('nodes');
  });

  it('a TSL material only a debug scene lists has no loader in production', () => {
    const files = {
      ...tslMaterial('debugOnlyMat'),
      ...scene('debugOnly', { isDebugScene: true, materials: ['debugOnlyMat'] }),
    };
    expect(gather(files).output?.fns).toContain('debugOnlyMat');
    expect(gather(files, { isProduction: true }).output?.fns).not.toContain('debugOnlyMat');
  });
});

describe('G12: an id no asset JSON has fails the gather', () => {
  it.each([
    ['a material', { materials: ['noSuchMaterial'] }],
    ['a camera', { cameras: ['noSuchCamera'] }],
    ['a sky box', { skyboxes: ['noSuchSky'] }],
  ])('%s', (_kind, fields) => {
    expect(gather(scene('a', fields)).isGathered).toBe(false);
  });
});

describe('G13: a mesh save entry’s geo and mat', () => {
  const box = { type: 'BOX', params: { width: 1, height: 2, depth: 3 } };
  const mesh = (props: Record<string, unknown>, entry: Record<string, unknown>) => ({
    ...scene('a', { meshes: ['m'] }),
    'app/m.mesh.json': { props, __saveData: { a: [entry] } },
  });
  const meshProps = (files: Record<string, unknown>) =>
    gather(files).scene('a')?.meshes?.[0]?.props;

  it('partial geometry props merge over the mesh’s, params key by key', () => {
    const files = mesh({ geo: box, mat: material('mat') }, { geo: { params: { width: 4 } } });
    expect(meshProps(files)?.geo).toEqual({ ...box, params: { ...box.params, width: 4 } });
  });

  it('partial material props merge over the mesh’s, params key by key', () => {
    const mat = material('mat', { params: { color: '#ff0000', wireframe: false } });
    const files = mesh({ geo: box, mat }, { mat: { params: { wireframe: true } } });
    expect(meshProps(files)?.mat).toEqual({
      ...mat,
      params: { color: '#ff0000', wireframe: true },
    });
  });

  it('props of another type replace the mesh’s whole', () => {
    const sphere = { type: 'SPHERE', params: { radius: 2 } };
    const files = mesh({ geo: box, mat: material('mat') }, { geo: sphere });
    expect(meshProps(files)?.geo).toEqual(sphere);
  });

  it('partial props over an id fail the gather', () => {
    const files = {
      ...mesh({ geo: 'g', mat: material('mat') }, { geo: { params: { width: 4 } } }),
      'app/g.geometry.json': { geoProps: { id: 'g', ...box } },
    };
    expect(gather(files).isGathered).toBe(false);
  });
});
