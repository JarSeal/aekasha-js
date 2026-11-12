import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { gatherSceneData } from '../gatherAppData';
import { packCellKey } from '../../src/_engine/utils/CellKey';
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
