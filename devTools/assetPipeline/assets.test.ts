import { describe, expect, it } from 'vitest';
import path from 'path';
import { ROOT } from '../paths';
import type { TextureAsset } from '../../src/_engine/schemas';
import { collectPipelineAssets, getPipelineAssetKey, resolveAssetUse } from './assets';
import { listAssetSourceFiles } from './pipeline';

// The repo's own public test image, so the source resolves
const FILE = '/debugger/assets/testTextures/Poliigon_MetalRust_7642_BaseColor.jpg';
const JSON_FILE = path.join(ROOT, 'src/app/textures/probe.texture.json');

const getUse = (texOpts?: { flipY?: boolean; colorSpace?: 'srgb' }) => {
  const use = resolveAssetUse(JSON_FILE, { fileName: FILE, ...(texOpts ? { texOpts } : {}) });
  if (!use || 'error' in use) throw new Error('the source should resolve');
  return use;
};

describe("a texture's flip (p302 D1)", () => {
  it('is unflipped only with texOpts.flipY false', () => {
    expect(getUse().isUnflipped).toBe(false);
    expect(getUse({ flipY: true }).isUnflipped).toBe(false);
    expect(getUse({ flipY: false }).isUnflipped).toBe(true);
  });

  it("keys an unflipped encode apart, and leaves the others' keys as they were", () => {
    const flipped = getPipelineAssetKey('texture', JSON_FILE, getUse({ colorSpace: 'srgb' }));
    // The key's form before p302: its colour space last
    expect(flipped).toMatch(/^texture:src\/app\/textures\/probe\.texture\.json:file:.*:srgb$/);
    const unflipped = getPipelineAssetKey(
      'texture',
      JSON_FILE,
      getUse({ colorSpace: 'srgb', flipY: false })
    );
    expect(unflipped).toBe(`${flipped}:unflipped`);
  });
});

describe('a cube texture (p311 D1)', () => {
  const CUBE_FILE = path.join(ROOT, 'src/app/textures/probeCube.texture.json');
  const DIR = '/debugger/assets/testTextures/';
  const FACES = [
    'positive_x',
    'negative_x',
    'positive_y',
    'negative_y',
    'positive_z',
    'negative_z',
  ];
  const faces = FACES.map((face) => `cubemap01_${face}.png`) as NonNullable<TextureAsset['faces']>;
  const ARRAY_FILE = path.join(ROOT, 'src/app/textures/probe.textureArray.json');
  const collect = (cubeFaces = faces) =>
    collectPipelineAssets([
      {
        type: 'texture',
        id: 'probeCube',
        jsonFile: CUBE_FILE,
        data: {
          faces: cubeFaces,
          path: DIR,
          texOpts: { colorSpace: 'srgb' },
          // A scene's entry may still say flipY: a cube's faces are stored as they are
          __saveData: { scene01: [{ texOpts: { colorSpace: 'srgb', flipY: false } }] },
        },
      },
    ]);

  it('is one encode of its six faces, keyed by its JSON', () => {
    const { assets, dropped } = collect();
    expect(dropped).toEqual([]);
    expect([...assets.keys()]).toEqual([
      'texture:src/app/textures/probeCube.texture.json:cube:src/app/textures/probeCube.texture.json:srgb',
    ]);
    const [asset] = assets.values();
    expect(asset).toMatchObject({ type: 'texture', id: 'probeCube', isSrgb: true });
    expect(asset.isUnflipped).toBeUndefined();
    expect(listAssetSourceFiles(asset).map((file) => path.relative(ROOT, file))).toEqual(
      faces.map((face) => `src/public${DIR}${face}`)
    );
  });

  it('is dropped, naming the face, when a face is missing', () => {
    const missing = [...faces] as typeof faces;
    missing[4] = 'cubemap01_nope.png';
    const { assets, dropped } = collect(missing);
    expect(assets.size).toBe(0);
    expect(dropped).toEqual([
      {
        jsonFile: 'src/app/textures/probeCube.texture.json',
        reason: expect.stringMatching(/^faces\[4\] \(\+z\): source file .* not found/),
      },
      // The scene's entry is a use of its own
      expect.objectContaining({ jsonFile: 'src/app/textures/probeCube.texture.json' }),
    ]);
  });

  it("can't be an array layer", () => {
    const { assets, dropped } = collectPipelineAssets([
      { type: 'texture', id: 'probeCube', jsonFile: CUBE_FILE, data: { faces, path: DIR } },
      {
        type: 'textureArray',
        id: 'probeArray',
        jsonFile: ARRAY_FILE,
        data: { layers: ['probeCube'] },
      },
    ]);
    expect([...assets.values()].map(({ type }) => type)).toEqual(['texture']);
    expect(dropped).toEqual([
      {
        jsonFile: 'src/app/textures/probe.textureArray.json',
        reason: 'layers[0] ("probeCube"): the texture "probeCube" is a cube texture',
      },
    ]);
  });
});

describe('a source-only texture (p309 D1)', () => {
  const ATLAS_FILE = path.join(ROOT, 'src/app/textures/probe.textureAtlas.json');
  const collect = (sourceOnly?: boolean) =>
    collectPipelineAssets([
      {
        type: 'texture',
        id: 'probe',
        jsonFile: JSON_FILE,
        data: { fileName: FILE, ...(sourceOnly !== undefined ? { sourceOnly } : {}) },
      },
      {
        type: 'textureAtlas',
        id: 'probeAtlas',
        jsonFile: ATLAS_FILE,
        data: {
          size: [128, 128],
          slots: { albedo: { texOpts: { colorSpace: 'srgb' } } },
          cells: [{ id: 'rust', size: [48, 48], sources: { albedo: 'probe' } }],
        },
      },
    ]);

  it('is encoded only by the atlas whose cell reads it', () => {
    const { assets, dropped } = collect(true);
    expect(dropped).toEqual([]);
    expect([...assets.values()].map(({ type, id }) => [type, id])).toEqual([
      ['textureAtlas', 'probeAtlas.albedo'],
    ]);
  });

  it('is encoded on its own too without the flag', () => {
    for (const sourceOnly of [undefined, false]) {
      const { assets } = collect(sourceOnly);
      expect([...assets.values()].map(({ type }) => type).sort()).toEqual([
        'texture',
        'textureAtlas',
      ]);
    }
  });
});
