import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { gatherSceneData } from '../gatherAppData';
import { packCellKey } from '../../src/_engine/utils/CellKey';
import { ROOT } from '../paths';
import { GENERATED_APP_DATA_FILENAME, GENERATED_APP_FNS_FILENAME } from './output';
import { getPipelineAssetKey, resolveAssetUse } from '../assetPipeline/assets';
import { getGeneratedFields } from '../assetPipeline/generated';
import { createSettingsResolver } from '../assetPipeline/settings';
import type { PipelineRun, PipelineRunResult } from '../assetPipeline/run';

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
  const { isGathered } = gatherSceneData({
    ...tree,
    profiles: [],
    isProduction: !!opts.isProduction,
  });
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
    expect(gatherSceneData({ outDir, isProduction }).isGathered).toBe(true);
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

describe('the writes', () => {
  it('a second gather of the same data writes nothing (G7)', () => {
    const tree = makeTree(scene('a'));
    expect(gatherSceneData({ ...tree, profiles: [] }).changedFiles).toHaveLength(3);
    expect(gatherSceneData({ ...tree, profiles: [] })).toEqual({
      isGathered: true,
      changedFiles: [],
    });
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

  it('the development data names a scene’s file, production doesn’t (p355 §2.5)', () => {
    expect(gather(files).scene('saved')).toHaveProperty(
      '__sourcePath',
      'src/app/scenes/saved/saved.scene.json'
    );
    expect(gather(files, { isProduction: true }).scene('saved')).not.toHaveProperty('__sourcePath');
  });

  it('the development data names a scene’s inline cameras, lights and sky boxes (p355 §2.6)', () => {
    const inline = {
      ...scene('inline', {
        cameras: [
          'cam',
          { camProps: { type: 'PERSPECTIVE', appId: 'inlineCam' } },
          { camProps: { type: 'PERSPECTIVE' }, entityOpts: { appId: 'entityCam' } },
          { camProps: { type: 'PERSPECTIVE' } },
        ],
        lights: [{ lightProps: { type: 'AMBIENT', appId: 'inlineAmbient' } }],
        skyboxes: [{ id: 'inlineSky', base: { type: 'COLOR', color: '#000000' } }],
      }),
      'app/cam.camera.json': camera('cam'),
      ...scene('listed', { cameras: ['cam'] }),
    };
    expect(gather(inline).scene('inline')?.__inlineAssets).toEqual({
      cameras: ['inlineCam', 'entityCam'],
      lights: ['inlineAmbient'],
      skyboxes: ['inlineSky'],
    });
    // None listed inline, and none in production
    expect(gather(inline).scene('listed')).not.toHaveProperty('__inlineAssets');
    expect(gather(inline, { isProduction: true }).scene('inline')).not.toHaveProperty(
      '__inlineAssets'
    );
  });

  it('an inline asset of a list the scene’s save entry replaces isn’t named (p355 §2.6)', () => {
    const files = scene('replaced', {
      lights: [{ lightProps: { type: 'AMBIENT', appId: 'fileAmbient' } }],
      skyboxes: [{ id: 'fileSky', base: { type: 'COLOR', color: '#000000' } }],
      __saveData: {
        replaced: [{ lights: [{ lightProps: { type: 'AMBIENT', appId: 'entryAmbient' } }] }],
      },
    });
    expect(gather(files).scene('replaced')?.__inlineAssets).toEqual({ skyboxes: ['fileSky'] });
  });

  it('a scene entry’s spatialDomains merge by id (p355 §2.5)', () => {
    const domains = gather(
      scene('saved', {
        spatialDomains: [
          { id: 'DEFAULT', cellSize: 24, update: 'STATIC' },
          { id: 'FOLIAGE', cellSize: 10, maxMembers: 100 },
        ],
        __saveData: {
          saved: [
            {
              spatialDomains: [
                { id: 'DEFAULT', cellSize: 30 },
                { id: 'ROCKS', cellSize: 8, maxMembers: 50 },
              ],
            },
          ],
        },
      })
    ).scene('saved')?.spatialDomains;
    expect(domains).toEqual([
      { id: 'DEFAULT', cellSize: 30, update: 'STATIC' },
      { id: 'FOLIAGE', cellSize: 10, maxMembers: 100 },
      { id: 'ROCKS', cellSize: 8, maxMembers: 50 },
    ]);
  });

  it('a scene entry’s spatialDomains is the list of a scene without one', () => {
    const domains = gather(
      scene('saved', {
        __saveData: { saved: [{ spatialDomains: [{ id: 'DEFAULT', cellSize: 30 }] }] },
      })
    ).scene('saved')?.spatialDomains;
    expect(domains).toEqual([{ id: 'DEFAULT', cellSize: 30 }]);
  });

  it('a TSL material’s inputs merge key by key (p302 D2)', () => {
    const tslFiles = {
      'app/materials/inputsMat.material.json': {
        id: 'inputsMat',
        type: 'STANDARDNODEMATERIAL',
        tslFile: 'materials/inputsMat.tsl.ts',
        inputs: { tint: '#ff8000', scale: 2 },
        __saveData: { saved: [{ inputs: { scale: 4 } }] },
      },
      'app/materials/inputsMat.tsl.ts': 'export const setup = () => {};\n',
      ...scene('saved', { materials: ['inputsMat'] }),
    };
    const material = gather(tslFiles).scene('saved')?.materials?.[0];
    expect(material).toHaveProperty('inputs', { tint: '#ff8000', scale: 4 });
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

describe('p371 D2: a MERGED geometry’s parts', () => {
  const kit = {
    // A public file the repo has: a JSON-relative one would resolve outside the repo's src/
    'app/kit.importedAsset.json': { id: 'kit', fileName: '/debugger/assets/testModels/box01.glb' },
    'app/post.geometry.json': { geoProps: { id: 'post', type: 'CYLINDER' } },
  };
  const merged = (id: string, parts: string[]) => ({
    [`app/${id}.geometry.json`]: {
      geoProps: { id, type: 'MERGED', params: { parts: parts.map((geo) => ({ geo })) } },
    },
  });
  // The file's console.warn mock, spied again for its calls
  const warns = () => vi.spyOn(console, 'warn').mock.calls;

  it('gathers parts that are geometry JSONs and imported pieces the scene lists', () => {
    const files = {
      ...scene('s', { geometries: ['post', 'wall'], importedAssets: ['kit'] }),
      ...kit,
      ...merged('wall', ['post', 'kit/wall', 'kit/pillar']),
    };
    const { isGathered, scene: getScene } = gather(files);
    expect(isGathered).toBe(true);
    expect(getScene('s')?.geometries).toEqual([
      expect.objectContaining({ id: 'post' }),
      expect.objectContaining({ id: 'wall', type: 'MERGED' }),
    ]);
  });

  it.each([
    ['an unknown part, though no scene lists the geometry', ['post', 'nothing']],
    ['an unknown import’s piece', ['other/wall']],
    ['a MERGED part', ['inner']],
  ])('fails the gather for %s', (_, parts) => {
    const files = { ...scene('s'), ...kit, ...merged('inner', ['post']), ...merged('wall', parts) };
    expect(gather(files).isGathered).toBe(false);
  });

  it('checks an inline MERGED geometry’s parts in the scene pass', () => {
    const inline = { id: 'wall', type: 'MERGED', params: { parts: [{ geo: 'nothing' }] } };
    expect(gather({ ...scene('s', { geometries: [inline] }), ...kit }).isGathered).toBe(false);
  });

  it('warns about a part the scene doesn’t list, and gathers', () => {
    const files = {
      ...scene('s', { geometries: ['wall'] }),
      ...kit,
      ...merged('wall', ['post', 'kit/wall']),
    };
    const before = warns().length;
    expect(gather(files).isGathered).toBe(true);
    const messages = warns()
      .slice(before)
      .map(([message]) => String(message));
    expect(messages.filter((message) => message.includes('MERGED geometry "wall"'))).toEqual([
      expect.stringContaining('"post"'),
      expect.stringContaining('the imported asset "kit"'),
    ]);
  });
});

describe('p371 D3: an import’s merge', () => {
  const kit = (fileName: string) => ({
    'app/kit.importedAsset.json': { id: 'kit', fileName, merge: { exclude: ['door_*'] } },
  });

  it('is build time only: the generated import has none', () => {
    const files = {
      ...scene('s', { importedAssets: ['kit'] }),
      ...kit('/debugger/assets/testModels/box01.glb'),
    };
    const { isGathered, scene: getScene } = gather(files);
    expect(isGathered).toBe(true);
    const [imported] = getScene('s')?.importedAssets as Record<string, unknown>[];
    expect(imported).toMatchObject({ id: 'kit' });
    expect(imported).not.toHaveProperty('merge');
  });

  it('fails the gather for a remote file, which the pipeline doesn’t read', () => {
    const files = {
      ...scene('s', { importedAssets: ['kit'] }),
      ...kit('https://example.com/kit.glb'),
    };
    expect(gather(files).isGathered).toBe(false);
    const withoutMerge = { id: 'kit', fileName: 'https://example.com/kit.glb' };
    expect(gather({ ...files, 'app/kit.importedAsset.json': withoutMerge }).isGathered).toBe(true);
  });
});

describe('p353 Phase 3: a streaming scene’s cell manifest', () => {
  const crate = {
    'app/crate.mesh.json': {
      props: { geo: 'crateBox', mat: 'crateMat', position: { x: 10, y: 0, z: 10 } },
      // This scene's save entry moves it into the next cell along x
      __saveData: { w: [{ position: { x: 70, y: 0, z: 10 } }] },
    },
    'app/crateBox.geometry.json': { geoProps: { id: 'crateBox', type: 'BOX' } },
    'app/crateMat.material.json': material('crateMat'),
  };
  const streamingScene = (fields: Record<string, unknown> = {}) =>
    scene('w', {
      geometries: ['crateBox'],
      materials: ['crateMat'],
      meshes: ['crate'],
      streaming: { cellSize: 64, base: [], radii: {} },
      ...fields,
    });

  it('cuts the resolved meshes (save entries applied) and their cell-only assets into cells', () => {
    const { isGathered, scene: getScene } = gather({ ...streamingScene(), ...crate });
    expect(isGathered).toBe(true);
    const out = getScene('w') as OutputScene & { __streaming?: Record<string, unknown> };
    expect(out.meshes).toBeUndefined();
    expect(out.materials).toBeUndefined();
    expect(out.geometries).toBeUndefined();
    expect(out.streaming).toEqual({ cellSize: 64 });
    expect(out.__features).toEqual(['streaming']);
    const manifest = out.__streaming as {
      meshes: { props: { appId: string } }[];
      cells: Record<string, { meshes: number[]; materials: number[] }>;
    };
    expect(manifest.meshes[0].props.appId).toBe('crate');
    expect(manifest.cells).toEqual({
      [String(packCellKey(1, 0, 0))]: expect.objectContaining({
        meshes: [0],
        materials: [0],
        geometries: [0],
      }),
    });
  });

  it('keeps what streaming.base names in the base', () => {
    const files = { ...streamingScene({ streaming: { cellSize: 64, base: ['crate'] } }), ...crate };
    const out = gather(files).scene('w') as OutputScene & { __streaming?: unknown };
    expect(out.meshes?.[0]?.props.appId).toBe('crate');
    expect(out.materials).toHaveLength(1);
    expect(out.__streaming).toBeUndefined();
  });

  it('keeps a persistent mesh or light in the base', () => {
    const files = {
      ...streamingScene({
        lights: [
          {
            lightProps: { type: 'POINT', appId: 'keptLamp', position: { x: 10, y: 1, z: 10 } },
            entityOpts: { persistent: true },
          },
        ],
      }),
      ...crate,
      'app/crate.mesh.json': { ...crate['app/crate.mesh.json'], entityOpts: { persistent: true } },
    };
    const out = gather(files).scene('w') as OutputScene & { lights?: unknown[] };
    expect(out.meshes?.[0]?.props.appId).toBe('crate');
    expect(out.lights).toHaveLength(1);
    expect(out.__streaming).toBeUndefined();
  });
});

// docs/issues/_DONE_i060_entity-persistent-flag-not-applied.md
describe('i060: a persistent entity needs an app id', () => {
  const box = {
    'app/i060Box.geometry.json': { geoProps: { id: 'i060Box', type: 'BOX' } },
    'app/i060Mat.material.json': material('i060Mat'),
  };
  const lists = { geometries: ['i060Box'], materials: ['i060Mat'] };
  const persistent = { persistent: true };

  it.each([
    ['a camera', { cameras: [{ camProps: { type: 'PERSPECTIVE' }, entityOpts: persistent }] }],
    ['a light', { lights: [{ lightProps: { type: 'POINT' }, entityOpts: persistent }] }],
    [
      'a mesh',
      { ...lists, meshes: [{ props: { geo: 'i060Box', mat: 'i060Mat' }, entityOpts: persistent }] },
    ],
  ])('fails on %s without one', (_kind, fields) => {
    expect(gather({ ...scene('a', fields), ...box }).isGathered).toBe(false);
  });

  it('passes with one in its props or its entityOpts', () => {
    const fields = {
      ...lists,
      cameras: [{ camProps: { type: 'PERSPECTIVE', appId: 'keptCam' }, entityOpts: persistent }],
      lights: [{ lightProps: { type: 'POINT' }, entityOpts: { ...persistent, appId: 'keptLamp' } }],
      meshes: [
        { props: { geo: 'i060Box', mat: 'i060Mat', appId: 'keptBox' }, entityOpts: persistent },
      ],
    };
    expect(gather({ ...scene('a', fields), ...box }).isGathered).toBe(true);
  });
});

describe('merge material palettes (p374 D1, D2)', () => {
  const standard = (id: string, params: Record<string, unknown> = {}) => ({
    [`app/materials/${id}.material.json`]: { id, type: 'STANDARD', params },
  });
  const palette = (fields: Record<string, unknown> = {}) => ({
    'app/palettes/stones.mergeMaterial.json': {
      materials: ['stoneA', 'stoneB'],
      slots: { map: { size: [64, 64] } },
      ...fields,
    },
  });
  const logErrors = () => vi.spyOn(console, 'error').mockImplementation(() => {});

  it('registers a palette in the materials’ id space, its id from the file name', () => {
    const { isGathered, output } = gather({
      ...scene('a'),
      ...standard('stoneA', { color: '#808080', roughness: 0.9 }),
      ...standard('stoneB', { color: '#a0a0a0', roughness: 0.4, metalness: 0.2 }),
      ...palette(),
    });
    expect(isGathered).toBe(true);
    const palettes = (output?.json as Record<string, unknown>).mergeMaterials;
    expect(palettes).toEqual({
      stones: expect.objectContaining({
        id: 'stones',
        materials: ['stoneA', 'stoneB'],
        __sourcePath: 'src/app/palettes/stones.mergeMaterial.json',
      }),
    });
  });

  it('fails on a class violation, naming the material and the property', () => {
    const errorSpy = logErrors();
    const { isGathered } = gather({
      ...scene('a'),
      ...standard('stoneA', { side: 2 }),
      ...standard('stoneB', { bumpMap: 'bumps' }),
      ...palette(),
    });
    expect(isGathered).toBe(false);
    const logged = errorSpy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(logged).toContain('params.side differs: 2 in "stoneA"; 0 in "stoneB"');
    expect(logged).toContain('materials[1] "stoneB"');
    expect(logged).toContain('params.bumpMap: a merge material has no bumpMap');
  });

  it('registers each used slot’s array as the texture <paletteId>.<slot>, listed by a scene', () => {
    const albedo = '/debugger/assets/testTextures/Poliigon_MetalRust_7642_BaseColor.jpg';
    const {
      isGathered,
      output,
      scene: getScene,
    } = gather({
      ...scene('a', { textures: ['stones.map'] }),
      'app/textures/rust.texture.json': { id: 'rust', fileName: albedo, texOpts: { wrapS: 1000 } },
      ...standard('stoneA', { map: 'rust' }),
      ...standard('stoneB'),
      ...palette({ slots: { map: { size: [64, 64], missing: 'SKIP' }, orm: { size: [64, 64] } } }),
    });
    expect(isGathered).toBe(true);
    const json = output?.json as Record<string, Record<string, Record<string, unknown>>>;
    const slotTexture = {
      id: 'stones.map',
      texOpts: { colorSpace: 'srgb', wrapS: 1000 },
      __layers: ['stoneA', 'stoneB'],
      __mergeMaterial: { id: 'stones', slot: 'map' },
    };
    expect(json.textures['stones.map']).toEqual({
      ...slotTexture,
      __sourcePath: 'src/app/palettes/stones.mergeMaterial.json',
    });
    expect(json.textures['stones.orm']).toBeUndefined();
    expect(json.mergeMaterials.stones.__slots).toEqual({
      map: { texture: 'stones.map', has: [true, false], missing: 'SKIP' },
    });
    expect(getScene('a')?.textures).toEqual([slotTexture]);
  });

  it('bakes each member’s table entry into the palette (p374 D3)', () => {
    const { output } = gather({
      ...scene('a'),
      ...standard('stoneA', { color: '#808080', roughness: 0.9, normalScale: [0.5, 0.5] }),
      ...standard('stoneB'),
      ...palette(),
    });
    const json = output?.json as Record<string, Record<string, Record<string, unknown>>>;
    expect(json.mergeMaterials.stones.__entries).toEqual([
      {
        color: '#808080',
        opacity: 1,
        emissive: 0,
        emissiveIntensity: 1,
        roughness: 0.9,
        metalness: 0,
        normalScale: [0.5, 0.5],
        aoMapIntensity: 1,
      },
      expect.objectContaining({ color: 0xffffff, roughness: 1, normalScale: [1, 1] }),
    ]);
  });

  describe('a scene’s mergeMaterials (p374 Phase 2)', () => {
    const albedo = '/debugger/assets/testTextures/Poliigon_MetalRust_7642_BaseColor.jpg';
    const files = (sceneFields: Record<string, unknown>) => ({
      ...scene('a', sceneFields),
      ...scene('b'),
      'app/textures/rust.texture.json': { id: 'rust', fileName: albedo },
      ...standard('stoneA', { map: 'rust', roughness: 0.5 }),
      ...standard('stoneB', { map: 'rust' }),
      ...palette({ debugData: { name: 'Stones' } }),
    });

    it('inlines each palette and adds its slot textures once, naming the feature', () => {
      const { isGathered, scene: getScene } = gather(
        files({ mergeMaterials: ['stones'], textures: ['stones.map'] })
      );
      expect(isGathered).toBe(true);
      const a = getScene('a')!;
      expect(a.mergeMaterials).toEqual([
        {
          id: 'stones',
          materials: ['stoneA', 'stoneB'],
          debugData: { name: 'Stones' },
          __slots: { map: { texture: 'stones.map', has: [true, true] } },
          __entries: [
            expect.objectContaining({ roughness: 0.5 }),
            expect.objectContaining({ roughness: 1 }),
          ],
        },
      ]);
      // Listed by the scene already: not added again
      expect((a.textures as { id: string }[]).map((texture) => texture.id)).toEqual(['stones.map']);
      expect(a.__features).toEqual(['merging']);
      // A scene that doesn't list it carries none of it
      const b = getScene('b')!;
      expect(b.mergeMaterials).toBeUndefined();
      expect(b.__features).toEqual([]);
    });

    it('adds the slot textures to a scene that lists none', () => {
      const { scene: getScene } = gather(files({ mergeMaterials: ['stones'] }));
      expect((getScene('a')!.textures as { id: string }[]).map((texture) => texture.id)).toEqual([
        'stones.map',
      ]);
    });

    it('a production build drops the palette’s debugData', () => {
      const { isGathered, scene: getScene } = gather(files({ mergeMaterials: ['stones'] }), {
        isProduction: true,
      });
      expect(isGathered).toBe(true);
      const [palette] = getScene('a')!.mergeMaterials as Record<string, unknown>[];
      expect(palette).not.toHaveProperty('debugData');
      expect(palette.__entries).toHaveLength(2);
      expect(palette).not.toHaveProperty('__state');
    });

    it('carries the state the members agree on', () => {
      const { scene: getScene } = gather({
        ...scene('a', { mergeMaterials: ['stones'] }),
        ...standard('stoneA', { side: 2, roughness: 0.5 }),
        ...standard('stoneB', { side: 2 }),
        ...palette({ slots: { map: { size: [64, 64] } } }),
      });
      const [resolved] = getScene('a')!.mergeMaterials as Record<string, unknown>[];
      expect(resolved.__state).toEqual({ side: 2 });
    });

    it('fails on an id no palette has', () => {
      const errorSpy = logErrors();
      const { isGathered } = gather(files({ mergeMaterials: ['pebbles'] }));
      expect(isGathered).toBe(false);
      const logged = errorSpy.mock.calls.map((call) => String(call[0])).join('\n');
      expect(logged).toContain('Scene "a" lists the merge material "pebbles"');
    });

    it('fails on a mergeGroups entry naming a palette the scene doesn’t list (p374 Phase 3)', () => {
      const ruins = { id: 'ruins', palette: 'stones' };
      expect(gather(files({ mergeMaterials: ['stones'], mergeGroups: [ruins] })).isGathered).toBe(
        true
      );
      const errorSpy = logErrors();
      expect(gather(files({ mergeGroups: [ruins] })).isGathered).toBe(false);
      const logged = errorSpy.mock.calls.map((call) => String(call[0])).join('\n');
      expect(logged).toContain(
        'mergeGroups entry "ruins" names the palette "stones", which the scene\'s mergeMaterials doesn\'t list'
      );
    });

    it('fails on an AUTO palette the scene doesn’t list, and warns on a material two share', () => {
      const pebbles = {
        'app/palettes/pebbles.mergeMaterial.json': {
          materials: ['stoneB', 'stoneA'],
          slots: { map: { size: [64, 64] } },
        },
      };
      const errorSpy = logErrors();
      const auto = { id: 'AUTO', palettes: ['stones', 'pebbles'] };
      const unlisted = gather({
        ...files({ mergeMaterials: ['stones'], mergeGroups: [auto] }),
        ...pebbles,
      });
      expect(unlisted.isGathered).toBe(false);
      expect(errorSpy.mock.calls.map((call) => String(call[0])).join('\n')).toContain(
        'mergeGroups entry "AUTO" names the palette "pebbles"'
      );

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      warnSpy.mockClear();
      const shared = gather({
        ...files({ mergeMaterials: ['stones', 'pebbles'], mergeGroups: [auto] }),
        ...pebbles,
      });
      expect(shared.isGathered).toBe(true);
      const warned = warnSpy.mock.calls.map((call) => String(call[0])).join('\n');
      expect(warned).toContain(
        'the AUTO palettes "stones" and "pebbles" both have the material "stoneB": its meshes go into "stones"\'s groups'
      );
      expect(warned).toContain('both have the material "stoneA"');
    });
  });

  it('fails on a palette id a material has', () => {
    const files = {
      ...scene('a'),
      ...standard('stoneA'),
      ...standard('stoneB'),
      ...standard('stones'),
      ...palette(),
    };
    expect(gather(files).isGathered).toBe(false);
  });
});

describe('p302 D6: the texture closure', () => {
  const albedo = '/debugger/assets/testTextures/Poliigon_MetalRust_7642_BaseColor.jpg';
  const textures = (...ids: string[]) =>
    Object.fromEntries(
      ids.map((id) => [`app/textures/${id}.texture.json`, { id, fileName: albedo }])
    );
  const tslMat = (id: string, fields: Record<string, unknown>) => ({
    [`app/materials/${id}.material.json`]: {
      id,
      type: 'STANDARDNODEMATERIAL',
      tslFile: `materials/${id}.tsl.ts`,
      ...fields,
    },
    [`app/materials/${id}.tsl.ts`]: 'export const setup = () => {};\n',
  });
  const textureIds = (out: OutputScene | undefined) =>
    ((out?.textures ?? []) as ({ id?: string } | string)[]).map((tex) =>
      typeof tex === 'string' ? tex : tex.id
    );
  const box = { type: 'BOX', params: { width: 1, height: 1, depth: 1 } };

  it('adds the textures a listed material names, after the listed ones, each once', () => {
    const { isGathered, scene: get } = gather({
      ...textures('listed', 'albedo', 'mask', 'detail', 'normal'),
      ...tslMat('m', {
        params: { normalMap: 'normal', color: '#ffffff' },
        inputs: {
          albedo: 'albedo',
          mask: { texture: 'mask', channel: 'r' },
          tint: '#ff8000',
          again: 'albedo',
          staticDefines: { texture: 'notATexture' },
        },
        nodes: { colorNode: { detail: 'detail', scale: 2 } },
      }),
      ...scene('a', { textures: ['listed', 'albedo'], materials: ['m'] }),
    });
    expect(isGathered).toBe(true);
    expect(textureIds(get('a'))).toEqual(['listed', 'albedo', 'normal', 'mask', 'detail']);
    // Resolved as listed ones are: their data, not the id
    expect(get('a')?.textures).toContainEqual(expect.objectContaining({ id: 'mask' }));
  });

  it('adds a scene without textures a list, and follows a material’s save entry', () => {
    const { scene: get } = gather({
      ...textures('albedo', 'saved'),
      ...tslMat('m', {
        inputs: { albedo: 'albedo' },
        __saveData: { a: [{ inputs: { albedo: 'saved' } }] },
      }),
      ...scene('a', { materials: ['m'] }),
      ...scene('b', { materials: ['m'] }),
    });
    expect(textureIds(get('a'))).toEqual(['saved']);
    expect(textureIds(get('b'))).toEqual(['albedo']);
  });

  it('adds a mesh’s inline material’s, its matOverrides’, a spot cookie and the background', () => {
    const { isGathered, scene: get } = gather({
      ...textures('inline', 'override', 'cookie', 'sky'),
      'app/m.mesh.json': {
        props: {
          appId: 'm',
          geo: box,
          mat: material('inlineMat', { params: { map: 'inline' } }),
          matOverrides: { params: { map: 'override' } },
        },
      },
      ...scene('a', {
        meshes: ['m'],
        lights: [{ lightProps: { type: 'SPOT', appId: 'spot', map: 'cookie' } }],
        backgroundTexture: 'sky',
      }),
    });
    expect(isGathered).toBe(true);
    expect(textureIds(get('a'))).toEqual(['inline', 'override', 'cookie', 'sky']);
  });

  it('keeps an inline texture the scene lists, and adds nothing for it', () => {
    const inline = { id: 'own', fileName: albedo };
    const { isGathered, scene: get } = gather({
      ...tslMat('m', { inputs: { albedo: 'own' } }),
      ...scene('a', { textures: [inline], materials: ['m'] }),
    });
    expect(isGathered).toBe(true);
    expect(textureIds(get('a'))).toEqual(['own']);
  });

  it('fails on an id no asset JSON has, naming what names it', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { isGathered } = gather({
      ...tslMat('m', { inputs: { albedo: { texture: 'noSuchTexture' } } }),
      ...scene('a', { materials: ['m'] }),
    });
    expect(isGathered).toBe(false);
    expect(errors.mock.calls.flat().join('\n')).toContain(
      'Scene "a": the material "m" names the texture "noSuchTexture"'
    );
  });

  it('moves a cell-only material’s input textures into its cell', () => {
    const { isGathered, scene: get } = gather({
      ...textures('crateTex'),
      ...tslMat('crateMat', { inputs: { albedo: 'crateTex' } }),
      'app/crate.mesh.json': {
        props: { geo: box, mat: 'crateMat', position: { x: 70, y: 0, z: 10 } },
      },
      ...scene('w', {
        materials: ['crateMat'],
        meshes: ['crate'],
        streaming: { cellSize: 64, base: [], radii: {} },
      }),
    });
    expect(isGathered).toBe(true);
    const out = get('w') as OutputScene & {
      __streaming?: { cells: Record<string, { textures?: number[] }> };
    };
    expect(out.textures).toBeUndefined();
    expect(out.__streaming?.cells[String(packCellKey(1, 0, 0))]?.textures).toEqual([0]);
  });
});

describe('p299 D5: texture array layer and atlas cell inputs', () => {
  const albedo = '/debugger/assets/testTextures/Poliigon_MetalRust_7642_BaseColor.jpg';
  const textures = (...ids: string[]) =>
    Object.fromEntries(
      ids.map((id) => [`app/textures/${id}.texture.json`, { id, fileName: albedo }])
    );
  const assets = {
    ...textures('rock', 'moss', 'plain'),
    'app/textures/ground.textureArray.json': { id: 'ground', layers: ['rock', 'moss'] },
    'app/textures/decals.textureAtlas.json': {
      id: 'decals',
      size: [512, 512],
      padding: 8,
      slots: { albedo: {}, mask: {} },
      cells: [
        { id: 'crack', rect: [0, 0, 256, 256], sources: { albedo: 'rock', mask: 'moss' } },
        { id: 'tyre', rect: [256, 0, 256, 256], sources: { albedo: 'moss' } },
      ],
    },
  };
  const tslMat = (id: string, inputs: Record<string, unknown>) => ({
    [`app/materials/${id}.material.json`]: {
      id,
      type: 'STANDARDNODEMATERIAL',
      tslFile: `materials/${id}.tsl.ts`,
      inputs,
    },
    [`app/materials/${id}.tsl.ts`]: 'export const setup = () => {};\n',
  });
  const textureIds = (out: OutputScene | undefined) =>
    ((out?.textures ?? []) as ({ id?: string } | string)[]).map((tex) =>
      typeof tex === 'string' ? tex : tex.id
    );
  /** The gather's errors for a material of these inputs in scene "a" */
  const gatherErrors = (inputs: Record<string, unknown>) => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { isGathered } = gather({
      ...assets,
      ...tslMat('m', inputs),
      ...scene('a', { materials: ['m'] }),
    });
    const text = errors.mock.calls.flat().join('\n');
    errors.mockRestore();
    return { isGathered, text };
  };

  it('adds the array and the atlas slot the inputs name to the textures', () => {
    const { isGathered, scene: get } = gather({
      ...assets,
      ...tslMat('m', {
        byName: { textureArray: 'ground', layer: 'moss' },
        byIndex: { textureArray: 'ground', layer: 0 },
        cell: { atlas: 'decals', slot: 'mask', cell: 'crack', clampToCell: false },
      }),
      ...scene('a', { materials: ['m'] }),
    });
    expect(isGathered).toBe(true);
    expect(textureIds(get('a'))).toEqual(['ground', 'decals.mask']);
  });

  it('adds nothing for a slot the scene lists by its atlas id', () => {
    const { scene: get } = gather({
      ...assets,
      ...tslMat('m', { cell: { atlas: 'decals', slot: 'mask', cell: 'crack' } }),
      ...scene('a', { textures: ['decals'], materials: ['m'] }),
    });
    expect(textureIds(get('a'))).toEqual(['decals.albedo', 'decals.mask']);
  });

  it.each([
    [{ textureArray: 'ground', layer: 'sand' }, 'has no layer "sand" (layers: rock, moss)'],
    [{ textureArray: 'ground', layer: 2 }, 'has layers 0-1, not 2'],
    [{ textureArray: 'plain', layer: 0 }, '"plain" isn\'t a texture array'],
    [
      { atlas: 'decals', slot: 'normal', cell: 'crack' },
      'has no slot "normal" (slots: albedo, mask)',
    ],
    [{ atlas: 'decals', slot: 'mask', cell: 'leaf' }, 'has no cell "leaf" (cells: crack, tyre)'],
    [{ atlas: 'plain', slot: 'mask', cell: 'crack' }, '"plain" isn\'t a texture atlas'],
    [
      { atlas: 'nope', slot: 'mask', cell: 'crack' },
      'no texture atlas (a *.textureAtlas.json) has the id "nope"',
    ],
  ])('fails on %j, naming the material and what the asset has', (input, message) => {
    const { isGathered, text } = gatherErrors({ x: input });
    expect(isGathered).toBe(false);
    expect(text).toContain(`Scene "a": the material "m"'s input "x": `);
    expect(text).toContain(message);
  });

  it('moves a cell-only material’s atlas slot into its cell', () => {
    const { isGathered, scene: get } = gather({
      ...assets,
      ...tslMat('crateMat', { cell: { atlas: 'decals', slot: 'mask', cell: 'crack' } }),
      'app/crate.mesh.json': {
        props: {
          geo: { type: 'BOX', params: { width: 1, height: 1, depth: 1 } },
          mat: 'crateMat',
          position: { x: 70, y: 0, z: 10 },
        },
      },
      ...scene('w', {
        materials: ['crateMat'],
        meshes: ['crate'],
        streaming: { cellSize: 64, base: [], radii: {} },
      }),
    });
    expect(isGathered).toBe(true);
    const out = get('w') as OutputScene & {
      __streaming?: { cells: Record<string, { textures?: number[] }> };
    };
    expect(out.textures).toBeUndefined();
    expect(out.__streaming?.cells[String(packCellKey(1, 0, 0))]?.textures).toEqual([0]);
  });
});

describe('p309 D1: a source-only texture', () => {
  const albedo = '/debugger/assets/testTextures/Poliigon_MetalRust_7642_BaseColor.jpg';
  const assets = {
    'app/textures/crackSrc.texture.json': { id: 'crackSrc', fileName: albedo, sourceOnly: true },
    'app/textures/decals.textureAtlas.json': {
      id: 'decals',
      size: [256, 256],
      slots: { albedo: {} },
      cells: [{ id: 'crack', rect: [0, 0, 128, 128], sources: { albedo: 'crackSrc' } }],
    },
  };
  /** The gather's errors for a tree */
  const gatherErrors = (files: Record<string, unknown>) => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { isGathered } = gather(files);
    const text = errors.mock.calls.flat().join('\n');
    errors.mockRestore();
    return { isGathered, text };
  };
  const SOURCE_ONLY = '"crackSrc" is a source-only texture';

  it('is an atlas cell’s source, and isn’t in the development data’s textures', () => {
    const { isGathered, output } = gather({
      ...assets,
      ...scene('a', { textures: ['decals'] }),
    });
    expect(isGathered).toBe(true);
    const textures = (output?.json as unknown as { textures: Record<string, unknown> }).textures;
    expect(Object.keys(textures)).toEqual(['decals.albedo']);
  });

  it('fails a scene that lists it', () => {
    const { isGathered, text } = gatherErrors({
      ...assets,
      ...scene('a', { textures: ['crackSrc'] }),
    });
    expect(isGathered).toBe(false);
    expect(text).toContain(`Scene "a" lists the texture ${SOURCE_ONLY}`);
  });

  it('fails a material that names it, naming the material', () => {
    const { isGathered, text } = gatherErrors({
      ...assets,
      'app/materials/m.material.json': material('m', { params: { map: 'crackSrc' } }),
      ...scene('a', { materials: ['m'] }),
    });
    expect(isGathered).toBe(false);
    expect(text).toContain(`Scene "a": the material "m"`);
    expect(text).toContain(SOURCE_ONLY);
  });

  it('fails a texture set slot that names it', () => {
    const { isGathered, text } = gatherErrors({
      ...assets,
      'app/textures/sand.textureSet.json': {
        category: 'SAND',
        physicalSize: [3, 3],
        heightScale: 0.03,
        packings: { MINIMAL: { albedoHeight: 'crackSrc' } },
      },
    });
    expect(isGathered).toBe(false);
    expect(text).toContain(SOURCE_ONLY);
  });
});

describe('p303 D1: texture sets', () => {
  const albedo = '/debugger/assets/testTextures/Poliigon_MetalRust_7642_BaseColor.jpg';
  const tex = (id: string, colorSpace?: string) => ({
    [`app/textures/${id}.texture.json`]: {
      id,
      fileName: albedo,
      ...(colorSpace ? { texOpts: { colorSpace } } : {}),
    },
  });
  const textures = {
    ...tex('sandAR', 'srgb'),
    ...tex('sandNH'),
    ...tex('sandAH', 'srgb'),
    ...tex('sandN'),
    ...tex('sandORM'),
  };
  const set = (fields: Record<string, unknown> = {}) => ({
    'app/textures/sand.textureSet.json': {
      category: 'SAND',
      physicalSize: [3, 3],
      heightScale: 0.03,
      packings: {
        LITE: { albedoRough: 'sandAR', normalHeight: 'sandNH' },
        FULL: { albedoHeight: 'sandAH', normal: 'sandN', orm: 'sandORM' },
      },
      surface: { porosity: 0.85 },
      debugData: { name: 'Sand' },
      ...fields,
    },
  });
  const textureIds = (out: OutputScene | undefined) =>
    ((out?.textures ?? []) as ({ id?: string } | string)[]).map((t) =>
      typeof t === 'string' ? t : t.id
    );
  /** The gather's errors and warnings of a tree */
  const gatherLogs = (files: Record<string, unknown>) => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { isGathered } = gather(files);
    const logs = {
      isGathered,
      errors: errors.mock.calls.flat().join('\n'),
      warnings: warnings.mock.calls.flat().join('\n'),
    };
    errors.mockRestore();
    warnings.mockRestore();
    return logs;
  };

  it("fills a set's wet response from its category, the flat defaults for OTHER (p307 S3)", () => {
    const surfaceOf = (category: string) => {
      const out = gather({
        ...textures,
        ...set({ category, surface: {} }),
        ...scene('a', { textureSets: ['sand'] }),
      }).scene('a');
      return ((out?.textureSets ?? []) as { surface: object }[])[0]?.surface;
    };
    expect(surfaceOf('MUD')).toMatchObject({
      porosity: 0.7,
      wetDarkening: 0.6,
      wetRoughness: 0.15,
      puddleResponse: 1,
      dryingSpeed: 0.4,
    });
    expect(surfaceOf('OTHER')).toMatchObject({
      porosity: 0.5,
      wetDarkening: 0.5,
      wetRoughness: 0.3,
      puddleResponse: 0.5,
      dryingSpeed: 1,
    });
  });

  it('writes a listed set inline, its defaults filled, and appends its default packing', () => {
    const { isGathered, scene: get } = gather({
      ...textures,
      ...set(),
      ...scene('a', { textures: ['sandNH'], textureSets: ['sand', 'sand'] }),
    });
    expect(isGathered).toBe(true);
    const out = get('a');
    expect(out?.textureSets).toEqual([
      {
        id: 'sand',
        category: 'SAND',
        physicalSize: [3, 3],
        heightScale: 0.03,
        defaultPacking: 'LITE',
        packings: {
          LITE: { albedoRough: 'sandAR', normalHeight: 'sandNH' },
          FULL: { albedoHeight: 'sandAH', normal: 'sandN', orm: 'sandORM' },
        },
        surface: {
          tint: '#ffffff',
          normalStrength: 1,
          roughnessScale: 1,
          aoStrength: 1,
          heightContrast: 1,
          // The set's own, else its category's wet response (p307 S3)
          porosity: 0.85,
          wetDarkening: 0.55,
          wetRoughness: 0.45,
          puddleResponse: 0.3,
          dryingSpeed: 1.6,
        },
        debugData: { name: 'Sand' },
      },
    ]);
    // The listed one stays first, the packing's other one is appended once
    expect(textureIds(out)).toEqual(['sandNH', 'sandAR']);
    expect(out?.__features).toEqual(['texturesets']);
  });

  it('loads the JSON’s defaultPacking, in its slot order', () => {
    const { scene: get } = gather({
      ...textures,
      ...set({ defaultPacking: 'FULL' }),
      ...scene('a', { textureSets: ['sand'] }),
    });
    expect(textureIds(get('a'))).toEqual(['sandAH', 'sandN', 'sandORM']);
  });

  it('drops the debug data in a production build, and keeps the sets in the dev section', () => {
    const files = { ...textures, ...set(), ...scene('a', { textureSets: ['sand'] }) };
    const prod = gather(files, { isProduction: true });
    expect(
      (prod.scene('a')?.textureSets as { debugData?: unknown }[])[0].debugData
    ).toBeUndefined();
    expect((prod.output?.json as Record<string, unknown>).textureSets).toBeUndefined();
    const dev = gather(files);
    const section = (dev.output?.json as Record<string, unknown>).textureSets as Record<
      string,
      { __sourcePath?: string }
    >;
    expect(Object.keys(section)).toEqual(['sand']);
    expect(section.sand.__sourcePath).toBe(path.join('src', 'app/textures/sand.textureSet.json'));
  });

  it('fails on a set no *.textureSet.json has', () => {
    const { isGathered, errors } = gatherLogs({ ...scene('a', { textureSets: ['nope'] }) });
    expect(isGathered).toBe(false);
    expect(errors).toMatch(/texture set.*nope/);
  });

  it.each([
    [
      { packings: { MINIMAL: { albedoHeight: 'nope' } } },
      'packings.MINIMAL.albedoHeight: no *.texture.json has the id "nope"',
    ],
    [
      { packings: { MINIMAL: { albedoHeight: 'arr' } } },
      'packings.MINIMAL.albedoHeight: "arr" is a texture array, not a texture asset',
    ],
    [
      { defaultPacking: 'MINIMAL' },
      'defaultPacking "MINIMAL" isn\'t one of its packings (LITE, FULL)',
    ],
  ])('fails on a set with %j', (fields, message) => {
    const { isGathered, errors } = gatherLogs({
      ...textures,
      'app/textures/arr.textureArray.json': { id: 'arr', layers: ['sandN', 'sandORM'] },
      ...set(fields),
      ...scene('a'),
    });
    expect(isGathered).toBe(false);
    expect(errors).toContain(`sand.textureSet.json: ${message}`);
  });

  it('warns on a colour slot that isn’t sRGB and a data slot that is', () => {
    const { isGathered, warnings } = gatherLogs({
      ...textures,
      ...set({ packings: { LITE: { albedoRough: 'sandNH', normalHeight: 'sandAR' } } }),
      ...scene('a'),
    });
    expect(isGathered).toBe(true);
    expect(warnings).toContain('packings.LITE.albedoRough: the texture "sandNH" isn\'t sRGB');
    expect(warnings).toContain('packings.LITE.normalHeight: the texture "sandAR" is sRGB');
  });

  it('fails on a set id two files give', () => {
    const { isGathered, errors } = gatherLogs({
      ...textures,
      ...set(),
      'app/other/sand.textureSet.json': {
        category: 'SAND',
        physicalSize: [1, 1],
        heightScale: 0,
        packings: { MINIMAL: { albedoHeight: 'sandAH' } },
      },
      ...scene('a'),
    });
    expect(isGathered).toBe(false);
    expect(errors).toContain('Duplicate texture set ID found: sand');
  });
});

describe("p303 D1: a set's average colour", () => {
  const albedo = '/debugger/assets/testTextures/Poliigon_MetalRust_7642_BaseColor.jpg';
  const files = (setFields: Record<string, unknown> = {}) => ({
    'app/textures/sandAR.texture.json': {
      id: 'sandAR',
      fileName: albedo,
      texOpts: { colorSpace: 'srgb' },
    },
    'app/textures/sandNH.texture.json': { id: 'sandNH', fileName: albedo },
    'app/textures/sand.textureSet.json': {
      category: 'SAND',
      physicalSize: [3, 3],
      heightScale: 0.03,
      packings: { LITE: { albedoRough: 'sandAR', normalHeight: 'sandNH' } },
      ...setFields,
    },
    ...scene('a', { textureSets: ['sand'] }),
  });

  let lastRun: { pipeline: PipelineRun; jsonFile: string } | undefined;

  /** Gathers with a run that measured the albedo's average (linear 0.2, 0.1, 0.05) */
  const gatherWithRun = (tree: Record<string, unknown>, isProduction = false) => {
    const { srcDir, outDir } = makeTree(tree);
    const jsonFile = path.join(srcDir, 'app/textures/sandAR.texture.json');
    const use = resolveAssetUse(jsonFile, { fileName: albedo, texOpts: { colorSpace: 'srgb' } });
    if (!use || 'error' in use) throw new Error('the albedo has no use');
    const result = {
      status: 'optimized',
      output: { file: '', url: '/aek-assets/sandAR.ktx2', bytes: 10 },
      textures: [
        {
          slot: 'baseColor',
          codec: 'uastc',
          width: 4,
          height: 4,
          hasAlpha: true,
          mipmaps: true,
          normalMode: false,
          bytes: 10,
          source: { width: 4, height: 4, bytes: 20 },
          averageColor: [0.2, 0.1, 0.05],
        },
      ],
      warnings: [],
    } as unknown as PipelineRunResult;
    const pipeline = {
      results: new Map([[getPipelineAssetKey('texture', jsonFile, use), result]]),
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    gatherSceneData({ srcDir, outDir, profiles: [], isProduction, pipeline });
    warn.mockRestore();
    lastRun = { pipeline, jsonFile };
    return JSON.parse(fs.readFileSync(path.join(outDir, GENERATED_APP_DATA_FILENAME), 'utf8')) as {
      scenes: Record<string, { textureSets?: { averageColor?: unknown }[]; textures?: unknown[] }>;
      textures?: Record<string, Record<string, unknown>>;
      textureSets?: Record<string, { averageColor?: unknown }>;
    };
  };

  it("takes the default packing's albedo's measure as sRGB, the texture's only in dev data", () => {
    const dev = gatherWithRun(files());
    expect(dev.scenes.a.textureSets?.[0].averageColor).toBe('#7c593f');
    expect(dev.textureSets?.sand.averageColor).toBe('#7c593f');
    expect(dev.textures?.sandAR.__averageColor).toEqual([0.2, 0.1, 0.05]);

    const production = gatherWithRun(files(), true);
    expect(production.scenes.a.textureSets?.[0].averageColor).toBe('#7c593f');
    const { pipeline, jsonFile } = lastRun!;
    const data = { fileName: albedo, texOpts: { colorSpace: 'srgb' as const } };
    const fields = (isProduction: boolean) =>
      getGeneratedFields(pipeline, 'texture', jsonFile, data, { isProduction });
    expect(fields(false)).toMatchObject({
      __url: '/aek-assets/sandAR.ktx2',
      __averageColor: [0.2, 0.1, 0.05],
    });
    expect(fields(true)).toMatchObject({ __url: '/aek-assets/sandAR.ktx2' });
    expect(fields(true)).not.toHaveProperty('__averageColor');
  });

  it("keeps the JSON's own, and has none without a measure", () => {
    const own = gatherWithRun(files({ averageColor: '#a08060' }));
    expect(own.scenes.a.textureSets?.[0].averageColor).toBe('#a08060');
    const { scene: get } = gather(files());
    expect(get('a')?.textureSets).toEqual([
      expect.not.objectContaining({ averageColor: expect.anything() }),
    ]);
  });
});

describe('p303 D1: texture set inputs', () => {
  const albedo = '/debugger/assets/testTextures/Poliigon_MetalRust_7642_BaseColor.jpg';
  const tex = (id: string, srgb = false) => ({
    [`app/textures/${id}.texture.json`]: {
      id,
      fileName: albedo,
      ...(srgb ? { texOpts: { colorSpace: 'srgb' } } : {}),
    },
  });
  const assets = {
    ...tex('sandAR', true),
    ...tex('sandNH'),
    ...tex('sandAH', true),
    ...tex('sandN'),
    ...tex('sandORM'),
    'app/textures/sand.textureSet.json': {
      category: 'SAND',
      physicalSize: [3, 3],
      heightScale: 0.03,
      packings: {
        LITE: { albedoRough: 'sandAR', normalHeight: 'sandNH' },
        FULL: { albedoHeight: 'sandAH', normal: 'sandN', orm: 'sandORM' },
      },
    },
  };
  const tslMat = (id: string, inputs: Record<string, unknown>) => ({
    [`app/materials/${id}.material.json`]: {
      id,
      type: 'STANDARDNODEMATERIAL',
      tslFile: `materials/${id}.tsl.ts`,
      inputs,
    },
    [`app/materials/${id}.tsl.ts`]: 'export const setup = () => {};\n',
  });
  const textureIds = (out: OutputScene | undefined) =>
    ((out?.textures ?? []) as ({ id?: string } | string)[]).map((t) =>
      typeof t === 'string' ? t : t.id
    );
  const setIds = (out: OutputScene | undefined) =>
    ((out?.textureSets ?? []) as { id: string }[]).map((set) => set.id);

  it('adds the set and the packing’s textures a material input names', () => {
    const { isGathered, scene: get } = gather({
      ...assets,
      ...tslMat('m', { ground: { textureSet: 'sand', packing: 'FULL' } }),
      ...scene('a', { materials: ['m'] }),
    });
    expect(isGathered).toBe(true);
    expect(setIds(get('a'))).toEqual(['sand']);
    expect(textureIds(get('a'))).toEqual(['sandAH', 'sandN', 'sandORM']);
    expect(get('a')?.__features).toEqual(['texturesets']);
  });

  it('samples the default packing without one, and writes a set the scene lists once', () => {
    const { scene: get } = gather({
      ...assets,
      ...tslMat('m', { ground: { textureSet: 'sand' }, again: { textureSet: 'sand' } }),
      ...scene('a', { materials: ['m'], textureSets: ['sand'] }),
    });
    expect(setIds(get('a'))).toEqual(['sand']);
    expect(textureIds(get('a'))).toEqual(['sandAR', 'sandNH']);
  });

  it.each([
    [{ textureSet: 'nope' }, 'no texture set (a *.textureSet.json) has the id "nope"'],
    [
      { textureSet: 'sand', packing: 'MINIMAL' },
      'the texture set "sand" has no packing "MINIMAL" (packings: FULL, LITE)',
    ],
  ])('fails on %j, naming the material and the input', (input, message) => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { isGathered } = gather({
      ...assets,
      ...tslMat('m', { x: input }),
      ...scene('a', { materials: ['m'] }),
    });
    const text = errors.mock.calls.flat().join('\n');
    errors.mockRestore();
    expect(isGathered).toBe(false);
    expect(text).toContain(`Scene "a": the material "m"'s input "x": ${message}`);
  });

  /** A streaming scene `w` whose one crate, in cell (1, 0), has a material of these inputs */
  const streamingScene = (inputs: Record<string, unknown>, fields: Record<string, unknown> = {}) =>
    gather({
      ...assets,
      ...tslMat('crateMat', inputs),
      'app/crate.mesh.json': {
        props: {
          geo: { type: 'BOX', params: { width: 1, height: 1, depth: 1 } },
          mat: 'crateMat',
          position: { x: 70, y: 0, z: 10 },
        },
      },
      ...scene('w', {
        materials: ['crateMat'],
        meshes: ['crate'],
        streaming: { cellSize: 64, base: [], radii: {} },
        ...fields,
      }),
    });
  type StreamingOut = OutputScene & {
    __streaming?: {
      cells: Record<string, { textures?: number[] }>;
      assets: { textures: { id: string }[] };
    };
  };

  it('moves a cell-only material’s set textures into its cell', () => {
    const { isGathered, scene: get } = streamingScene({ ground: { textureSet: 'sand' } });
    expect(isGathered).toBe(true);
    const out = get('w') as StreamingOut;
    expect(out.textures).toBeUndefined();
    expect(out.__streaming?.assets.textures.map((t) => t.id)).toEqual(['sandAR', 'sandNH']);
    expect(out.__streaming?.cells[String(packCellKey(1, 0, 0))]?.textures).toEqual([0, 1]);
    // The set's data stays with the scene: the runtime finds it there
    expect(setIds(out)).toEqual(['sand']);
  });

  it('keeps a set the scene lists for its code in the base', () => {
    const { scene: get } = streamingScene(
      { ground: { textureSet: 'sand' } },
      { textureSets: ['sand'] }
    );
    const out = get('w') as StreamingOut;
    expect(textureIds(out)).toEqual(['sandAR', 'sandNH']);
    expect(out.__streaming?.assets.textures ?? []).toEqual([]);
  });

  describe('p303 D4: texture set arrays', () => {
    const arrayAssets = {
      ...assets,
      ...tex('rockAR', true),
      ...tex('rockNH'),
      'app/textures/rock.textureSet.json': {
        category: 'ROCKS',
        physicalSize: [6, 6],
        heightScale: 0.2,
        packings: { LITE: { albedoRough: 'rockAR', normalHeight: 'rockNH' } },
      },
    };
    type ArrayOut = {
      id?: string;
      sets: string[];
      packing: string;
      __textures?: { id: string; __url?: string }[];
    };
    const arraysOf = (out: OutputScene | undefined) =>
      ((out as { textureSetArrays?: ArrayOut[] } | undefined)?.textureSetArrays ?? []).map(
        ({ __textures, ...entry }) => ({ ...entry, textures: __textures?.map((t) => t.id) })
      );

    it('adds a material input’s list with its sets, its members declared on it, not loaded', () => {
      const { isGathered, scene: get } = gather({
        ...arrayAssets,
        ...tslMat('m', { ground: { textureSetArray: ['sand', 'rock'], packing: 'LITE' } }),
        ...scene('a', { materials: ['m'] }),
      });
      expect(isGathered).toBe(true);
      const out = get('a');
      expect(arraysOf(out)).toEqual([
        {
          sets: ['sand', 'rock'],
          packing: 'LITE',
          textures: ['sandAR', 'sandNH', 'rockAR', 'rockNH'],
        },
      ]);
      // Resolved as a listed texture is (its file size, no source path), yet not in textures
      const declared = (out as { textureSetArrays: ArrayOut[] }).textureSetArrays[0].__textures;
      expect(declared?.[0]).toHaveProperty('__fileSize');
      expect(declared?.[0]).not.toHaveProperty('__sourcePath');
      expect(out?.textures).toBeUndefined();
      expect(setIds(out)).toEqual(['sand', 'rock']);
      expect(out?.__features).toEqual(['texturesets']);
    });

    it('keeps listed arrays, dedupes a list, names a listed id, declares only unlisted members', () => {
      const { isGathered, scene: get } = gather({
        ...arrayAssets,
        ...tslMat('m', {
          a: { textureSetArray: ['sand', 'rock'], packing: 'LITE' },
          b: { textureSetArray: ['sand', 'rock'], packing: 'LITE' },
          c: { textureSetArray: 'gallery' },
        }),
        ...scene('a', {
          materials: ['m'],
          textureSets: ['sand'],
          textureSetArrays: [
            { id: 'gallery', sets: ['rock', 'sand'], packing: 'LITE', swappable: true },
            { sets: ['sand', 'rock'], packing: 'LITE' },
          ],
        }),
      });
      expect(isGathered).toBe(true);
      const out = get('a');
      // The listed set's default packing is in textures: those members aren't declared again
      expect(textureIds(out)).toEqual(['sandAR', 'sandNH']);
      expect(arraysOf(out)).toEqual([
        {
          id: 'gallery',
          sets: ['rock', 'sand'],
          packing: 'LITE',
          swappable: true,
          textures: ['rockAR', 'rockNH'],
        },
        { sets: ['sand', 'rock'], packing: 'LITE', textures: undefined },
      ]);
    });

    it.each([
      [
        { textureSetArray: ['sand', 'nope'], packing: 'LITE' },
        'no texture set (a *.textureSet.json) has the id "nope"',
      ],
      [
        { textureSetArray: ['rock'], packing: 'FULL' },
        'the texture set "rock" has no packing "FULL" (packings: LITE)',
      ],
      [
        { textureSetArray: 'gallery' },
        'the scene\'s textureSetArrays has no set array with the id "gallery"',
      ],
    ])('fails on %j, naming the material and the input', (input, message) => {
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { isGathered } = gather({
        ...arrayAssets,
        ...tslMat('m', { x: input }),
        ...scene('a', { materials: ['m'] }),
      });
      const text = errors.mock.calls.flat().join('\n');
      errors.mockRestore();
      expect(isGathered).toBe(false);
      expect(text).toContain(`Scene "a": the material "m"'s input "x": ${message}`);
    });

    it('fails on a listed array’s unknown set and on an id given twice', () => {
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { isGathered } = gather({
        ...arrayAssets,
        ...scene('a', {
          textureSetArrays: [
            { id: 'g', sets: ['sand'], packing: 'LITE' },
            { sets: ['rock'], packing: 'MINIMAL' },
            { id: 'g', sets: ['rock'], packing: 'LITE' },
          ],
        }),
      });
      const text = errors.mock.calls.flat().join('\n');
      errors.mockRestore();
      expect(isGathered).toBe(false);
      expect(text).toContain(
        'Scene "a": textureSetArrays[1]: the texture set "rock" has no packing "MINIMAL" (packings: LITE).'
      );
      expect(text).toContain(
        'Scene "a": textureSetArrays[2]: the id "g" is another entry\'s already.'
      );
    });

    it('lets a cell-only material move, its set arrays and members staying with the scene', () => {
      const { isGathered, scene: get } = streamingScene({
        ground: { textureSetArray: ['sand'], packing: 'LITE' },
      });
      expect(isGathered).toBe(true);
      const out = get('w') as StreamingOut & { materials?: unknown[] };
      expect(out.materials).toBeUndefined();
      expect(out.__streaming?.assets.textures ?? []).toEqual([]);
      expect(arraysOf(out)).toEqual([
        { sets: ['sand'], packing: 'LITE', textures: ['sandAR', 'sandNH'] },
      ]);
    });
  });
});

describe('p304 D3: procedural texture sets', () => {
  const generator = (folder: string, id: string) => ({
    [`${folder}/${id}.generator.ts`]: 'export const generator = {};\n',
  });
  const generators = {
    ...generator('toolkit/terrain/procedural/dunes', 'dunes'),
    ...generator('app/generators', 'cracks'),
  };
  const proceduralSet = (id: string, procedural: Record<string, unknown>) => ({
    [`app/textures/${id}.textureSet.json`]: {
      category: 'SAND',
      physicalSize: [2, 2],
      heightScale: 0.02,
      procedural,
    },
  });
  const tslMat = (id: string, inputs: Record<string, unknown>) => ({
    [`app/materials/${id}.material.json`]: {
      id,
      type: 'STANDARDNODEMATERIAL',
      tslFile: `materials/${id}.tsl.ts`,
      inputs,
    },
    [`app/materials/${id}.tsl.ts`]: 'export const setup = () => {};\n',
  });
  const gatherLogs = (files: Record<string, unknown>, opts: { isProduction?: boolean } = {}) => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = gather(files, opts);
    const logged = errors.mock.calls.flat().join('\n');
    errors.mockRestore();
    return { ...result, errors: logged };
  };

  it('writes a listed set with its procedural defaults and baked slot ids, loading no textures', () => {
    const {
      isGathered,
      scene: get,
      output,
    } = gather({
      ...generators,
      ...proceduralSet('beach', { generator: 'dunes', params: { wavelength: 0.12 } }),
      ...scene('a', { textureSets: ['beach'] }),
    });
    expect(isGathered).toBe(true);
    const [set] = get('a')?.textureSets as Record<string, unknown>[];
    expect(set).toMatchObject({
      id: 'beach',
      defaultPacking: 'LITE',
      packings: { LITE: { albedoRough: 'beach.albedoRough', normalHeight: 'beach.normalHeight' } },
      procedural: {
        generator: 'dunes',
        params: { wavelength: 0.12 },
        seed: 0,
        size: 1024,
        packing: 'LITE',
      },
    });
    expect(get('a')?.textures).toBeUndefined();
    expect(get('a')?.__features).toEqual(['texturesets']);
    // The development data: every set's generator, loaded on demand through the index
    expect(output?.fns).toContain(
      "export const textureSetGeneratorObjects = {\n  dunes: () => import('../src/toolkit/terrain/procedural/dunes/dunes.generator.ts'),\n};"
    );
    expect(output?.fns).not.toContain('cracks');
  });

  it('a material input adds the set without textures; its packing is the one baked', () => {
    const files = {
      ...generators,
      ...proceduralSet('mud', { generator: 'cracks', packing: 'FULL', size: [512, 256], seed: 3 }),
      ...tslMat('m', { ground: { textureSet: 'mud' } }),
      ...scene('a', { materials: ['m'] }),
    };
    const { isGathered, scene: get } = gather(files);
    expect(isGathered).toBe(true);
    const [set] = get('a')?.textureSets as Record<string, unknown>[];
    expect(set).toMatchObject({
      defaultPacking: 'FULL',
      packings: {
        FULL: { albedoHeight: 'mud.albedoHeight', normal: 'mud.normal', orm: 'mud.orm' },
      },
      procedural: { size: [512, 256], seed: 3, packing: 'FULL' },
    });
    expect(get('a')?.textures).toBeUndefined();
    // Another packing than the one baked fails as a packing the set lacks
    const other = gatherLogs({
      ...files,
      ...tslMat('m', { ground: { textureSet: 'mud', packing: 'LITE' } }),
    });
    expect(other.isGathered).toBe(false);
    expect(other.errors).toContain('the texture set "mud" has no packing "LITE"');
  });

  it('ships the generators of the shipped scenes’ sets only', () => {
    const files = {
      ...generators,
      ...proceduralSet('beach', { generator: 'dunes' }),
      ...proceduralSet('mud', { generator: 'cracks' }),
      ...scene('a', { textureSets: ['beach'] }),
    };
    const prod = gather(files, { isProduction: true });
    expect(prod.output?.fns).toContain('dunes: () =>');
    expect(prod.output?.fns).not.toContain('cracks');
    const none = gather(
      { ...generators, ...proceduralSet('mud', { generator: 'cracks' }), ...scene('a') },
      { isProduction: true }
    );
    expect(none.output?.fns).not.toContain('textureSetGeneratorObjects');
  });

  it.each([
    [
      'an unknown generator',
      proceduralSet('beach', { generator: 'waves' }),
      'procedural.generator: no .generator.ts module has the id "waves" (the generators: cracks, dunes)',
    ],
    [
      'a generator id two modules give',
      { ...generator('app/more', 'dunes'), ...proceduralSet('beach', { generator: 'dunes' }) },
      'Duplicate generator ID found: dunes in file: toolkit/terrain/procedural/dunes/dunes.generator.ts (app/more/dunes.generator.ts keeps it)',
    ],
    [
      'a baked texture id a texture asset has',
      {
        ...proceduralSet('beach', { generator: 'dunes' }),
        'app/textures/beach.albedoRough.texture.json': {
          id: 'beach.albedoRough',
          fileName: '/x.png',
        },
      },
      'Duplicate texture ID found: beach.albedoRough',
    ],
    [
      'a set array of a procedural set',
      {
        ...proceduralSet('beach', { generator: 'dunes' }),
        ...tslMat('m', { ground: { textureSetArray: ['beach'], packing: 'LITE' } }),
      },
      'the texture set "beach" is procedural (generator "dunes"), and a set array takes imported sets only',
    ],
  ])('fails on %s', (_name, files, error) => {
    const { isGathered, errors } = gatherLogs({
      ...generators,
      ...files,
      ...scene('a', {
        ...('app/materials/m.material.json' in files ? { materials: ['m'] } : {}),
        textureSets: ['beach'],
      }),
    } as Record<string, unknown>);
    expect(isGathered).toBe(false);
    expect(errors).toContain(error);
  });
});

describe('p306 D2: terrain blocks', () => {
  const albedo = '/debugger/assets/testTextures/Poliigon_MetalRust_7642_BaseColor.jpg';
  const files = (block: Record<string, unknown>, sceneFields: Record<string, unknown> = {}) => ({
    'app/blocks/ground.importedAsset.json': {
      id: 'ground',
      fileName: '/debugger/assets/testModels/box01.glb',
    },
    'app/blocks/splat.texture.json': { id: 'splat', fileName: albedo },
    'app/blocks/terrainMat.material.json': material('terrainMat'),
    'app/blocks/coast.terrainBlock.json': {
      geometry: { importedAsset: 'ground', node: 'Block' },
      material: 'terrainMat',
      grid: { size: 64, resolution: 129 },
      ...block,
    },
    ...scene('s', { terrainBlocks: ['coast'], ...sceneFields }),
  });
  const ids = (list: unknown) =>
    ((list ?? []) as ({ id?: string } | string)[]).map((entry) =>
      typeof entry === 'string' ? entry : entry.id
    );

  it('writes a listed block with its defaults, and loads its import, material and input textures', () => {
    const { isGathered, scene: get } = gather(
      files({ materialInputs: { splatMap: 'splat' }, debugData: { name: 'Coast' } })
    );
    expect(isGathered).toBe(true);
    const out = get('s');
    expect(out?.terrainBlocks).toEqual([
      {
        id: 'coast',
        geometry: { importedAsset: 'ground', node: 'Block' },
        material: 'terrainMat',
        materialInputs: { splatMap: 'splat' },
        grid: { x: 0, z: 0, size: 64, resolution: 129 },
        collider: { type: 'HEIGHTFIELD' },
        shadows: { cast: true, receive: true },
        debugData: { name: 'Coast' },
      },
    ]);
    expect(ids(out?.importedAssets)).toEqual(['ground']);
    expect(ids(out?.materials)).toEqual(['terrainMat']);
    expect(ids(out?.textures)).toEqual(['splat']);
    // The collider needs physics(), though the scene has none of its fields
    expect(out?.__features).toEqual(['terrain', 'physics']);
  });

  it('names no physics without a collider, and adds no import for a generated block', () => {
    const { scene: get } = gather(
      files({
        geometry: { generator: 'noiseTerrain' },
        collider: { type: 'NONE' },
        shadows: { cast: false },
      })
    );
    const out = get('s');
    const [block] = out?.terrainBlocks as Record<string, unknown>[];
    expect(block).toMatchObject({
      geometry: { generator: 'noiseTerrain', params: {}, seed: 0 },
      collider: { type: 'NONE' },
      shadows: { cast: false, receive: true },
    });
    expect(out?.importedAssets).toBeUndefined();
    expect(out?.__features).toEqual(['terrain']);
  });

  it('adds an import or material the scene lists only once, and a block listed twice once', () => {
    const { scene: get } = gather(
      files(
        {},
        { terrainBlocks: ['coast', 'coast'], importedAssets: ['ground'], materials: ['terrainMat'] }
      )
    );
    const out = get('s');
    expect(ids(out?.terrainBlocks)).toEqual(['coast']);
    expect(ids(out?.importedAssets)).toEqual(['ground']);
    expect(ids(out?.materials)).toEqual(['terrainMat']);
  });

  it('leaves the debug data out of a production build', () => {
    const { scene: get } = gather(files({ debugData: { name: 'Coast' } }), { isProduction: true });
    const [block] = get('s')?.terrainBlocks as Record<string, unknown>[];
    expect(block).not.toHaveProperty('debugData');
  });

  it('fails the gather on an unknown import, material, block or input texture', () => {
    expect(gather(files({ geometry: { importedAsset: 'nope' } })).isGathered).toBe(false);
    expect(gather(files({ material: 'nope' })).isGathered).toBe(false);
    expect(gather(files({}, { terrainBlocks: ['nope'] })).isGathered).toBe(false);
    expect(gather(files({ materialInputs: { splatMap: 'nope' } })).isGathered).toBe(false);
  });

  it('refuses a field the asset doesn’t have, and a resolution under 2', () => {
    expect(gather(files({ heightmap: 'coast' })).isGathered).toBe(false);
    expect(gather(files({ grid: { size: 64, resolution: 1 } })).isGathered).toBe(false);
  });
});

describe('p308 D2: scatters', () => {
  const box = { type: 'BOX', params: { width: 1, height: 1, depth: 1 } };
  const files = (
    scatter: Record<string, unknown> = {},
    sceneFields: Record<string, unknown> = { scatters: ['pebbles'] },
    extra: Record<string, unknown> = {}
  ) => ({
    'app/scatter/pebble.geometry.json': { geoProps: { id: 'pebble', ...box } },
    'app/scatter/stone.material.json': material('stone'),
    'app/scatter/pebbles.scatter.json': {
      items: [{ geometry: 'pebble', material: 'stone' }],
      source: { type: 'PROCEDURAL', generator: 'uniform' },
      ...scatter,
    },
    ...scene('s', sceneFields),
    ...extra,
  });
  const ids = (list: unknown) =>
    ((list ?? []) as ({ id?: string } | string)[]).map((entry) =>
      typeof entry === 'string' ? entry : entry.id
    );

  it('writes a listed scatter with its defaults, and loads its geometry and material JSONs', () => {
    const { isGathered, scene: get } = gather(files({ debugData: { name: 'Pebbles' } }));
    expect(isGathered).toBe(true);
    const out = get('s');
    expect(out?.scatters).toEqual([
      {
        id: 'pebbles',
        items: [
          {
            geometry: 'pebble',
            material: 'stone',
            weight: 1,
            castShadow: false,
            receiveShadow: true,
            collider: 'NONE',
          },
        ],
        source: { type: 'PROCEDURAL', generator: 'uniform', params: {}, seed: 0 },
        cellSize: 16,
        debugData: { name: 'Pebbles' },
      },
    ]);
    expect(ids(out?.geometries)).toEqual(['pebble']);
    expect(ids(out?.materials)).toEqual(['stone']);
    expect(out?.__features).toEqual(['instancing']);
  });

  it('leaves an id no asset JSON has to the runtime, and the debug data out of a production build', () => {
    const { isGathered, scene: get } = gather(
      files(
        {
          items: [{ geometry: 'rockFromCode', material: 'stone' }],
          source: { type: 'PLACEMENTS', placements: [{ position: [1, 0, 2], yaw: 1 }] },
          lod: { levels: [{ screenSize: 0.1 }, { screenSize: 0, geo: 'pebble' }] },
          debugData: { name: 'Pebbles' },
        },
        { scatters: ['pebbles', 'pebbles'] }
      ),
      { isProduction: true }
    );
    expect(isGathered).toBe(true);
    const out = get('s');
    const [scatter] = out?.scatters as Record<string, unknown>[];
    expect(scatter).toMatchObject({
      source: { type: 'PLACEMENTS', placements: [{ position: [1, 0, 2], yaw: 1 }], seed: 0 },
    });
    expect(scatter).not.toHaveProperty('debugData');
    expect(out?.scatters).toHaveLength(1);
    // The LOD level's geometry JSON loads; the code's geometry isn't one
    expect(ids(out?.geometries)).toEqual(['pebble']);
  });

  it("adds a terrain block's scatters to its scene, which then needs instancing", () => {
    const { isGathered, scene: get } = gather(
      files(
        {},
        { terrainBlocks: ['coast'] },
        {
          'app/blocks/coast.terrainBlock.json': {
            geometry: { generator: 'noiseTerrain' },
            material: 'stone',
            grid: { size: 64, resolution: 65 },
            collider: { type: 'NONE' },
            scatter: ['pebbles', 'pebbles'],
          },
        }
      )
    );
    expect(isGathered).toBe(true);
    const out = get('s');
    const [block] = out?.terrainBlocks as Record<string, unknown>[];
    expect(block.scatter).toEqual(['pebbles']);
    expect(ids(out?.scatters)).toEqual(['pebbles']);
    expect(ids(out?.geometries)).toEqual(['pebble']);
    expect(out?.__features).toEqual(['terrain', 'instancing']);
  });

  it('writes an IMPORTED source with its seed, and loads its import with the scene', () => {
    const { isGathered, scene: get } = gather(
      files(
        {
          items: [{ geometry: 'coast/Boulders', material: 'stone' }],
          source: { type: 'IMPORTED', importedAsset: 'coast', nodes: ['Boulders*'] },
        },
        { scatters: ['pebbles'] },
        {
          'app/scatter/coast.importedAsset.json': {
            id: 'coast',
            fileName: '/debugger/assets/testModels/box01.glb',
          },
        }
      )
    );
    expect(isGathered).toBe(true);
    const out = get('s');
    const [scatter] = out?.scatters as Record<string, unknown>[];
    expect(scatter.source).toEqual({
      type: 'IMPORTED',
      importedAsset: 'coast',
      nodes: ['Boulders*'],
      seed: 0,
    });
    expect(ids(out?.importedAssets)).toEqual(['coast']);
    // The import's piece isn't a geometry JSON: the spawn finds it registered by the import
    expect(ids(out?.geometries)).toEqual([]);
  });

  it('fails the gather on an IMPORTED source whose import no JSON has, or with no nodes', () => {
    const imported = (source: Record<string, unknown>) =>
      files({ source: { type: 'IMPORTED', importedAsset: 'coast', ...source } });
    expect(gather(imported({})).isGathered).toBe(false);
    const coast = {
      'app/scatter/coast.importedAsset.json': {
        id: 'coast',
        fileName: '/debugger/assets/testModels/box01.glb',
      },
    };
    expect(gather({ ...imported({ nodes: [] }), ...coast }).isGathered).toBe(false);
    expect(gather({ ...imported({}), ...coast }).isGathered).toBe(true);
  });

  it('names physics in the manifest of a scene with a collider item, and warns past 200 placed colliders', () => {
    const warn = vi.spyOn(console, 'warn');
    warn.mockClear();
    const placements = (count: number, item?: number) =>
      Array.from({ length: count }, (_, i) => ({ position: [i, 0, 0], item }));
    const colliderItems = [
      { geometry: 'pebble', material: 'stone' },
      { geometry: 'pebble', material: 'stone', collider: 'CONVEXHULL' },
    ];
    const { isGathered, scene: get } = gather(
      files({
        items: colliderItems,
        source: { type: 'PLACEMENTS', placements: [...placements(150, 1), ...placements(60)] },
      })
    );
    expect(isGathered).toBe(true);
    expect(get('s')?.__features).toEqual(['instancing', 'physics']);
    const [scatter] = get('s')?.scatters as { items: { collider: string }[] }[];
    expect(scatter.items.map((entry) => entry.collider)).toEqual(['NONE', 'CONVEXHULL']);
    // 150 name the collider item, 60 name none (the weights may pick it): up to 210
    expect(warn.mock.calls.flat().join('\n')).toMatch(
      /pebbles\.scatter\.json: its placements make up to 210 colliders/
    );

    warn.mockClear();
    const few = gather(
      files({
        items: colliderItems,
        source: { type: 'PLACEMENTS', placements: [...placements(150, 1), ...placements(60, 0)] },
      })
    );
    expect(few.isGathered).toBe(true);
    expect(warn.mock.calls.flat().join('\n')).not.toMatch(/colliders/);
    // A collider type it doesn't know
    expect(
      gather(files({ items: [{ geometry: 'pebble', material: 'stone', collider: 'BOX' }] }))
        .isGathered
    ).toBe(false);
  });

  it('fails the gather on an unknown scatter, a placement past the items or with two rotations', () => {
    expect(gather(files({}, { scatters: ['nope'] })).isGathered).toBe(false);
    const placements = (placement: Record<string, unknown>) =>
      files({
        source: { type: 'PLACEMENTS', placements: [{ position: [0, 0, 0], ...placement }] },
      });
    expect(gather(placements({ item: 1 })).isGathered).toBe(false);
    expect(gather(placements({ yaw: 1, quaternion: [0, 0, 0, 1] })).isGathered).toBe(false);
    expect(gather(placements({ item: 0 })).isGathered).toBe(true);
    const block = {
      'app/blocks/coast.terrainBlock.json': {
        geometry: { generator: 'noiseTerrain' },
        material: 'stone',
        grid: { size: 64, resolution: 65 },
        scatter: ['nope'],
      },
    };
    expect(gather(files({}, { terrainBlocks: ['coast'] }, block)).isGathered).toBe(false);
  });
});

describe('p309 D3: decal sets', () => {
  const files = (
    decalSet: Record<string, unknown> = {},
    sceneFields: Record<string, unknown> = { decalSets: ['tracks'] },
    extra: Record<string, unknown> = {}
  ) => ({
    'app/decals/tracksMesh.importedAsset.json': {
      id: 'tracksMesh',
      fileName: '/debugger/assets/testModels/box01.glb',
    },
    'app/decals/decalMat.material.json': material('decalMat'),
    'app/decals/tracks.decalSet.json': {
      importedAsset: 'tracksMesh',
      material: 'decalMat',
      ...decalSet,
    },
    ...scene('s', sceneFields),
    ...extra,
  });
  const ids = (list: unknown) =>
    ((list ?? []) as ({ id?: string } | string)[]).map((entry) =>
      typeof entry === 'string' ? entry : entry.id
    );
  const block = (fields: Record<string, unknown> = {}) => ({
    'app/blocks/coast.terrainBlock.json': {
      geometry: { generator: 'noiseTerrain' },
      material: 'decalMat',
      grid: { size: 64, resolution: 65 },
      collider: { type: 'NONE' },
      ...fields,
    },
  });

  it('writes a listed set with its defaults, and loads its import and material', () => {
    const { isGathered, scene: get } = gather(files({ debugData: { name: 'Tracks' } }));
    expect(isGathered).toBe(true);
    const out = get('s');
    expect(out?.decalSets).toEqual([
      {
        id: 'tracks',
        importedAsset: 'tracksMesh',
        material: 'decalMat',
        renderOrder: 10,
        receiveShadow: true,
        debugData: { name: 'Tracks' },
      },
    ]);
    expect(ids(out?.importedAssets)).toEqual(['tracksMesh']);
    expect(ids(out?.materials)).toEqual(['decalMat']);
    expect(out?.__features).toEqual(['terrain']);
  });

  it('keeps its own render order and shadows, a set listed twice once, without debug data in production', () => {
    const { scene: get } = gather(
      files(
        { renderOrder: 12, receiveShadow: false, debugData: { name: 'Tracks' } },
        { decalSets: ['tracks', 'tracks'], materials: ['decalMat'] }
      ),
      { isProduction: true }
    );
    const out = get('s');
    expect(out?.decalSets).toEqual([
      {
        id: 'tracks',
        importedAsset: 'tracksMesh',
        material: 'decalMat',
        renderOrder: 12,
        receiveShadow: false,
      },
    ]);
    expect(ids(out?.materials)).toEqual(['decalMat']);
  });

  it("adds a terrain block's decal sets to its scene", () => {
    const { isGathered, scene: get } = gather(
      files({}, { terrainBlocks: ['coast'] }, block({ decals: ['tracks', 'tracks'] }))
    );
    expect(isGathered).toBe(true);
    const out = get('s');
    const [def] = out?.terrainBlocks as Record<string, unknown>[];
    expect(def.decals).toEqual(['tracks']);
    expect(ids(out?.decalSets)).toEqual(['tracks']);
    expect(ids(out?.importedAssets)).toEqual(['tracksMesh']);
    expect(out?.__features).toEqual(['terrain']);
  });

  it('fails the gather on an unknown import, material or set, a fractional render order and a field it lacks', () => {
    expect(gather(files({ importedAsset: 'nope' })).isGathered).toBe(false);
    expect(gather(files({ material: 'nope' })).isGathered).toBe(false);
    expect(gather(files({}, { decalSets: ['nope'] })).isGathered).toBe(false);
    expect(
      gather(files({}, { terrainBlocks: ['coast'] }, block({ decals: ['nope'] }))).isGathered
    ).toBe(false);
    expect(gather(files({ renderOrder: 1.5 })).isGathered).toBe(false);
    expect(gather(files({ castShadow: true })).isGathered).toBe(false);
  });
});

describe('p311 D2: a cube texture asset', () => {
  const DIR = '/debugger/assets/testTextures/';
  const FACES = [
    'positive_x',
    'negative_x',
    'positive_y',
    'negative_y',
    'positive_z',
    'negative_z',
  ];
  const faces = FACES.map((face) => `cubemap01_${face}.png`);
  const SOURCE_URLS = faces.map((face) => `${DIR}${face}`);
  const files = (cube: Record<string, unknown> = {}, base: Record<string, unknown> = {}) => ({
    'app/textures/dunes.texture.json': {
      id: 'dunes',
      faces,
      path: DIR,
      texOpts: { colorSpace: 'srgb' },
      ...cube,
    },
    'app/skyboxes/dunesSky.skybox.json': {
      id: 'dunesSky',
      base: { type: 'CUBE_TEXTURE', textureId: 'dunes', flipY: true, ...base },
    },
    ...scene('a', { skyboxes: ['dunesSky'] }),
  });
  const sceneTexture = (out: OutputScene | undefined) =>
    ((out?.textures ?? []) as Record<string, unknown>[]).find((tex) => tex.id === 'dunes');

  /** Gathers with a run whose result for the cube is `result` */
  const gatherWithRun = (result: Record<string, unknown>, isProduction = false) => {
    const { srcDir, outDir } = makeTree(files());
    // Pass 1 keys it by its file, the scene pass by its `__sourcePath` from the tree's root,
    // which it resolves against the repo's (one key in the repo, two in a temp tree)
    const jsonFiles = [
      path.join(srcDir, 'app/textures/dunes.texture.json'),
      path.join(ROOT, 'src/app/textures/dunes.texture.json'),
    ];
    const pipeline = {
      results: new Map(
        jsonFiles.map((jsonFile) => {
          const use = resolveAssetUse(jsonFile, {
            faces,
            path: DIR,
            texOpts: { colorSpace: 'srgb' },
          } as never);
          if (!use || 'error' in use) throw new Error('the cube has no use');
          const asset = { type: 'texture', id: 'dunes', jsonFile, source: use.source };
          const key = getPipelineAssetKey('texture', jsonFile, use);
          return [key, { ...result, asset } as PipelineRunResult] as const;
        })
      ),
    };
    const { isGathered } = gatherSceneData({
      srcDir,
      outDir,
      profiles: [],
      isProduction,
      pipeline,
    });
    const dataFile = path.join(outDir, GENERATED_APP_DATA_FILENAME);
    const json = isGathered
      ? (JSON.parse(fs.readFileSync(dataFile, 'utf8')) as Output['json'])
      : null;
    return { isGathered, scene: json?.scenes.a };
  };

  it("is added to the textures of a scene whose sky box names it, with its faces' URLs", () => {
    const { isGathered, scene: get } = gather(files());
    expect(isGathered).toBe(true);
    const texture = sceneTexture(get('a'));
    expect(texture).toMatchObject({ id: 'dunes', __sourceUrls: SOURCE_URLS });
    // Build time only: the runtime loads its output or its faces
    expect(texture).not.toHaveProperty('faces');
    expect(texture).not.toHaveProperty('path');
    const bytes = SOURCE_URLS.reduce(
      (sum, url) => sum + fs.statSync(path.join(ROOT, 'src/public', url)).size,
      0
    );
    expect(texture?.__fileSize).toBe(bytes);
  });

  it('leaves out a base with files, whose textureId only names what it loads', () => {
    const { scene: get } = gather(files({}, { file: '/sky.ktx2' }));
    expect(get('a')?.textures).toBeUndefined();
  });

  it('gets its output, with the faces in development data only', () => {
    const optimized = {
      status: 'optimized',
      output: { file: '', url: '/aek-assets/app/textures/dunes.cube.1234abcd.ktx2', bytes: 10 },
      textures: [
        {
          slot: 'default',
          codec: 'etc1s',
          width: 4,
          height: 4,
          hasAlpha: false,
          mipmaps: true,
          normalMode: false,
          bytes: 10,
          source: { width: 4, height: 4, bytes: 60 },
          isCube: true,
        },
      ],
      warnings: [],
      settings: createSettingsResolver({})({ sourcePath: 'cube', isCubeSource: true }),
      durationMs: 0,
    };
    const dev = sceneTexture(gatherWithRun(optimized).scene);
    expect(dev).toMatchObject({ __url: optimized.output.url, __sourceUrls: SOURCE_URLS });
    // Six faces' VRAM: 6 × 16 B at 1 B/px, plus the mips (4×4, 2×2, 1×1 blocks of 16 B)
    expect(dev?.__vramBytes).toMatchObject({ out: 6 * 3 * 16 });
    const production = gatherWithRun(optimized, true);
    expect(production.isGathered).toBe(true);
    expect(sceneTexture(production.scene)).not.toHaveProperty('__sourceUrls');
  });

  it('fails a production build without its output', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const skipped = { status: 'skipped', reason: 'textures kept as they are', durationMs: 0 };
    expect(gatherWithRun(skipped, true).isGathered).toBe(false);
    expect(errors.mock.calls.flat().join('\n')).toContain('dunes');
  });

  it('fails on a missing face, a codec "none" and a sky box naming no texture asset', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const missing = [...faces];
    missing[2] = 'cubemap01_nope.png';
    expect(gather(files({ faces: missing })).isGathered).toBe(false);
    expect(
      gather(files({ optimize: { textures: { default: { codec: 'none' } } } })).isGathered
    ).toBe(false);
    expect(gather(files({}, { textureId: 'noSuchCube' })).isGathered).toBe(false);
    const logged = errors.mock.calls.flat().join('\n');
    expect(logged).toContain('faces[2] (+y): source file');
    expect(logged).toContain('a cube texture is a KTX2 file');
    expect(logged).toContain('the sky box "dunesSky" names the texture "noSuchCube"');
  });
});

describe("p102 Phase 4: a scene's world bounds", () => {
  it('passes them through, a null one too, and names physics for them once', () => {
    const worldBounds = { min: { y: -50 }, max: { x: 100 }, action: 'DISABLE' };
    const { isGathered, scene: get } = gather({
      ...scene('a', { worldBounds }),
      ...scene('b', { worldBounds: null }),
      ...scene('c'),
    });
    expect(isGathered).toBe(true);
    expect(get('a')?.worldBounds).toEqual(worldBounds);
    expect(get('a')?.__features).toEqual(['physics']);
    // null turns the app's default off; without physics() there's none to turn off
    expect(get('b')?.worldBounds).toBeNull();
    expect(get('b')?.__features).toEqual([]);
    expect(get('c')).not.toHaveProperty('worldBounds');
  });

  it("fails on a 'CALLBACK' action and on a min not below its max", () => {
    expect(gather(scene('a', { worldBounds: { action: 'CALLBACK' } })).isGathered).toBe(false);
    const flat = { min: { y: 0 }, max: { y: -1 } };
    expect(gather(scene('a', { worldBounds: flat })).isGathered).toBe(false);
  });
});

describe('p106 D2: fogs', () => {
  const valley = {
    mode: 'EXP2',
    exp2: { density: 0.01 },
    debugData: { name: 'Valley' },
    __saveData: { a: [{ mode: 'HEIGHT', height: { density: 0.05 }, __meta: { date: 1 } }] },
  };

  it('resolves a listed fog: its id from its file, its defaults, the scene’s entry over it', () => {
    const { isGathered, scene: get } = gather({
      'app/fogs/valley.fog.json': valley,
      ...scene('a', { fogs: ['valley'] }),
      ...scene('b', { fogs: ['valley'] }),
    });
    expect(isGathered).toBe(true);
    const [fogA] = get('a')?.fogs as Record<string, unknown>[];
    expect(fogA).toEqual({
      id: 'valley',
      isDefault: false,
      enabled: true,
      // The entry's mode and height, over the file's
      mode: 'HEIGHT',
      colorSource: 'SKY',
      color: '#b4c0cc',
      linear: { near: 10, far: 500 },
      exp2: { density: 0.01 },
      height: { density: 0.05, baseHeight: 0, falloff: 0.1, startDistance: 0, maxOpacity: 1 },
      // The glow is the file's mode's (EXP2: off), not the entry's
      sunScattering: { enabled: false, strength: 0.5, exponent: 8 },
      background: 'NONE',
      debugData: { name: 'Valley' },
    });
    // Another scene gets the file as it is
    expect((get('b')?.fogs as Record<string, unknown>[])[0]).toMatchObject({ mode: 'EXP2' });
    expect(get('a')?.__features).toEqual(['fog']);
  });

  it('resolves an inline fog with its own entry, and names it in the development data', () => {
    const inline = { id: 'mist', mode: 'HEIGHT', __saveData: { a: [{ enabled: false }] } };
    const { scene: get } = gather(scene('a', { fogs: [inline] }));
    expect(get('a')?.fogs).toEqual([
      expect.objectContaining({ id: 'mist', enabled: false, sunScattering: expect.anything() }),
    ]);
    expect(
      (get('a')?.fogs as { sunScattering: { enabled: boolean } }[])[0].sunScattering.enabled
    ).toBe(true);
    expect(get('a')?.__inlineAssets).toEqual({ fogs: ['mist'] });
  });

  it('leaves the debug data out of a production build', () => {
    const { scene: get } = gather(
      { 'app/fogs/valley.fog.json': valley, ...scene('a', { fogs: ['valley'] }) },
      { isProduction: true }
    );
    expect((get('a')?.fogs as Record<string, unknown>[])[0]).not.toHaveProperty('debugData');
  });

  it('writes each fog file into the development data, its path for the save source', () => {
    // p106 Phase 5: without the section, every scene fog read as inline and couldn't be saved
    const files = { 'app/fogs/valley.fog.json': valley, ...scene('a', { fogs: ['valley'] }) };
    const { output } = gather(files);
    expect((output?.json as Record<string, unknown>).fogs).toEqual({
      valley: expect.objectContaining({
        id: 'valley',
        __sourcePath: expect.stringMatching(/app\/fogs\/valley\.fog\.json$/),
      }),
    });
    expect(gather(files, { isProduction: true }).output?.json).not.toHaveProperty('fogs');
  });

  it.each([
    ['an id no fog JSON has', { fogs: ['noSuchFog'] }],
    ['an id twice', { fogs: ['valley', { id: 'valley', mode: 'LINEAR' }] }],
    ['an inline fog without an id', { fogs: [{ mode: 'LINEAR' }] }],
    [
      'a far not past its near',
      { fogs: [{ id: 'f', mode: 'LINEAR', linear: { near: 50, far: 50 } }] },
    ],
    ['an unknown key', { fogs: [{ id: 'f', mode: 'EXP2', exp2: { densitty: 0.1 } }] }],
  ])('fails on %s', (_case, fields) => {
    expect(gather({ 'app/fogs/valley.fog.json': valley, ...scene('a', fields) }).isGathered).toBe(
      false
    );
  });
});
