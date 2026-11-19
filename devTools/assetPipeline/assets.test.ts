import { describe, expect, it } from 'vitest';
import path from 'path';
import { ROOT } from '../paths';
import { collectPipelineAssets, getPipelineAssetKey, resolveAssetUse } from './assets';

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
