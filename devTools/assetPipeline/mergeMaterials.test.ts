import path from 'path';
import { describe, expect, it } from 'vitest';
import type { MergeMaterialAsset, TextureAsset } from '../../src/_engine/schemas';
import { ROOT } from '../paths';
import { collectPipelineAssets, readAssetJsons, type AssetJson } from './assets';
import type { MaterialLookup } from './mergeMaterialClass';
import { resolveMergeMaterial } from './mergeMaterials';
import { readTextureSource, type TextureArrayLayer, type TextureLookup } from './textureArrays';

// The repo's own public test images, so the sources resolve (each 2048²)
const RUST = '/debugger/assets/testTextures/Poliigon_MetalRust_7642_';
const PALETTE_JSON = path.join(ROOT, 'src/app/scenes/p374/ruins.mergeMaterial.json');
const SIZE: [number, number] = [256, 256];

const materialFile = (id: string) => path.join(ROOT, `src/app/scenes/p374/${id}.material.json`);
const textureFile = (id: string) => path.join(ROOT, `src/app/scenes/p374/${id}.texture.json`);

const lookups = (
  materials: Record<string, Record<string, unknown>>,
  textures: Record<string, Pick<TextureAsset, 'fileName' | 'pack' | 'texOpts'>>
): { findMaterial: MaterialLookup; findTexture: TextureLookup } => ({
  findMaterial: (id) =>
    materials[id] && {
      jsonFile: materialFile(id),
      data: { type: 'STANDARD', params: materials[id] },
    },
  findTexture: (id) => textures[id] && { jsonFile: textureFile(id), data: textures[id] },
});

const resolve = (
  slots: MergeMaterialAsset['slots'],
  materials: Record<string, Record<string, unknown>>,
  textures: Record<string, Pick<TextureAsset, 'fileName' | 'pack' | 'texOpts'>>,
  optimize?: MergeMaterialAsset['optimize']
) => {
  const { findMaterial, findTexture } = lookups(materials, textures);
  const palette = { materials: Object.keys(materials), slots, ...(optimize ? { optimize } : {}) };
  return resolveMergeMaterial(PALETTE_JSON, 'ruins', palette, findMaterial, findTexture);
};

const REPEAT = { wrapS: 1000, wrapT: 1000 } as const;

describe('resolveMergeMaterial', () => {
  it('makes a slot an array of the members’ maps, a neutral layer for a member without one', () => {
    const { slots, errors } = resolve(
      { map: { size: SIZE }, normalMap: { size: SIZE } },
      { a: { map: 'rustAlbedo', normalMap: 'rustNormal' }, b: {} },
      {
        rustAlbedo: { fileName: `${RUST}BaseColor.jpg`, texOpts: REPEAT },
        rustNormal: { fileName: `${RUST}Normal.png`, texOpts: REPEAT },
      },
      { profile: 'prop' }
    );
    expect(errors).toEqual([]);
    const [map, normalMap] = slots;
    expect(map).toMatchObject({
      slot: 'map',
      id: 'ruins.map',
      isSrgb: true,
      optimize: { profile: 'prop', slot: 'baseColor' },
      texOpts: { colorSpace: 'srgb', wrapS: 1000, wrapT: 1000 },
      has: [true, false],
    });
    expect(map.source).toMatchObject({
      kind: 'array',
      size: SIZE,
      logicalPath: 'app/scenes/p374/ruins.palette.map',
    });
    expect(map.source.layers.map((layer) => [layer.key, layer.source.kind])).toEqual([
      ['a', 'public'],
      ['b', 'pack'],
    ]);
    expect(map.source.layers[1].source).toMatchObject({
      kind: 'pack',
      pack: { size: SIZE, channels: { rgb: 1 } },
    });
    expect(map.source.jsonFiles).toEqual([
      materialFile('a'),
      materialFile('b'),
      textureFile('rustAlbedo'),
    ]);
    expect(normalMap).toMatchObject({ isSrgb: false, optimize: { slot: 'normal' } });
    expect(normalMap.texOpts).toEqual(REPEAT);
    expect(normalMap.source.layers[1].source).toMatchObject({
      pack: { channels: { r: 0.5, g: 0.5, b: 1 } },
    });
  });

  it('takes one ORM texture as it is, and packs separate maps (a missing one’s channel 1)', () => {
    const { slots, errors } = resolve(
      { orm: { size: SIZE } },
      {
        split: { aoMap: 'rustAo', roughnessMap: 'rustRough', metalnessMap: 'rustMetal' },
        packed: { aoMap: 'rustAo', roughnessMap: 'rustAo', metalnessMap: 'rustAo' },
        roughOnly: { roughnessMap: 'rustRough' },
        none: {},
      },
      {
        rustAo: { fileName: `${RUST}AmbientOcclusion.jpg` },
        rustRough: { fileName: `${RUST}Roughness.jpg` },
        rustMetal: { fileName: `${RUST}Metallic.jpg` },
      }
    );
    expect(errors).toEqual([]);
    const [orm] = slots;
    expect(orm).toMatchObject({ id: 'ruins.orm', isSrgb: false, has: [true, true, true, false] });
    const [split, packed, roughOnly, none] = orm.source.layers;
    expect(split.source).toMatchObject({
      kind: 'pack',
      pack: {
        size: SIZE,
        channels: {
          r: { src: `${RUST}AmbientOcclusion.jpg`, channel: 'r' },
          g: { src: `${RUST}Roughness.jpg`, channel: 'g' },
          b: { src: `${RUST}Metallic.jpg`, channel: 'b' },
        },
      },
    });
    expect(packed).toMatchObject({ key: 'packed', source: { kind: 'public' } });
    expect(roughOnly.source).toMatchObject({
      pack: { channels: { r: 1, g: { src: `${RUST}Roughness.jpg`, channel: 'g' }, b: 1 } },
    });
    expect(none.source).toMatchObject({ pack: { channels: { rgb: 1 } } });
    expect(orm.source.jsonFiles).toEqual(
      expect.arrayContaining([
        textureFile('rustAo'),
        textureFile('rustRough'),
        textureFile('rustMetal'),
      ])
    );
  });

  it('packs a member’s file under src/ by its path from the palette’s JSON', () => {
    const glb = path.join(ROOT, 'src/toolkit/models/brand/aekashaSymbol/aekashaSymbol.glb');
    const { findMaterial } = lookups({ a: { roughnessMap: 'r' }, b: {} }, {});
    const findTexture: TextureLookup = (id) =>
      id === 'r'
        ? {
            jsonFile: path.join(path.dirname(glb), 'r.texture.json'),
            data: { fileName: './aekashaSymbol.glb' },
          }
        : undefined;
    const palette = { materials: ['a', 'b'], slots: { orm: { size: SIZE } } };
    const { slots } = resolveMergeMaterial(
      PALETTE_JSON,
      'ruins',
      palette,
      findMaterial,
      findTexture
    );
    expect(slots[0].source.layers[0].source).toMatchObject({
      pack: {
        channels: {
          g: { src: '../../../toolkit/models/brand/aekashaSymbol/aekashaSymbol.glb' },
        },
      },
    });
  });

  it('builds no array for a slot no member uses', () => {
    const { slots, warnings } = resolve(
      { map: { size: SIZE }, emissiveMap: { size: SIZE } },
      { a: { map: 'rustAlbedo' }, b: { map: 'rustAlbedo' } },
      { rustAlbedo: { fileName: `${RUST}BaseColor.jpg` } }
    );
    expect(slots.map((slot) => slot.slot)).toEqual(['map']);
    expect(warnings).toEqual([expect.stringContaining('slots.emissiveMap: no member has a map')]);
  });

  it('fails on textures that don’t agree on the sampler, naming each member and texture', () => {
    const { slots, errors } = resolve(
      { map: { size: SIZE } },
      { a: { map: 'repeat' }, b: { map: 'clamp' }, c: { map: 'unset' } },
      {
        repeat: { fileName: `${RUST}BaseColor.jpg`, texOpts: { wrapS: 1000 } },
        clamp: { fileName: `${RUST}BaseColor.jpg`, texOpts: { wrapS: 1001 } },
        unset: { fileName: `${RUST}BaseColor.jpg` },
      }
    );
    expect(slots).toEqual([]);
    expect(errors).toEqual([
      'slots.map: the members\' textures differ in texOpts.wrapS: 1000 in "a" (repeat); 1001 in "b" (clamp), "c" (unset) (an array has one sampler; unset is three\'s 1001)',
    ]);
  });

  it('fails on a member texture meant unflipped: the array is stored flipped', () => {
    const { slots, errors } = resolve(
      { map: { size: SIZE } },
      { a: { map: 'unflipped' }, b: { map: 'flipped' } },
      {
        unflipped: { fileName: `${RUST}BaseColor.jpg`, texOpts: { flipY: false } },
        flipped: { fileName: `${RUST}BaseColor.jpg` },
      }
    );
    expect(slots).toEqual([]);
    expect(errors).toEqual([
      "slots.map: \"a\"'s texture unflipped has texOpts.flipY false, which an array can't keep (it's stored flipped)",
    ]);
  });

  it('fails on a map that isn’t a texture JSON’s, and on a packed texture in a split ORM', () => {
    const { slots, errors } = resolve(
      { map: { size: SIZE }, orm: { size: SIZE } },
      { a: { map: 'missing', aoMap: 'packedOrm', roughnessMap: 'rough' }, b: {} },
      {
        packedOrm: { pack: { channels: { r: 1, g: 1, b: 1 }, size: [4, 4] } },
        rough: { fileName: `${RUST}Roughness.jpg` },
      }
    );
    expect(slots).toEqual([]);
    expect(errors).toEqual([
      expect.stringMatching(
        /^materials\[0\] "a": params\.map: "missing" isn't a texture JSON's id/
      ),
      expect.stringMatching(/^materials\[0\] "a": params\.aoMap: "packedOrm" is a packed texture/),
    ]);
  });

  it('fails with the class check’s errors before any layer', () => {
    const { slots, errors } = resolve(
      { map: { size: SIZE } },
      { a: { map: 'x', side: 2 }, b: {} },
      {}
    );
    expect(slots).toEqual([]);
    expect(errors).toEqual([expect.stringContaining('params.side differs')]);
  });
});

describe('a palette’s layers as images', () => {
  /** Each channel's value range over the image */
  const getRanges = async (layer: TextureArrayLayer, opts = { isSrgb: false, isNormal: false }) => {
    const img = await readTextureSource(layer, { width: 8, height: 8 }, opts);
    return Array.from({ length: img.channels }, (_, c) => {
      const values = Array.from(
        { length: img.width * img.height },
        (_, i) => img.data[i * img.channels + c]
      );
      return [Math.min(...values), Math.max(...values)].map((v) => Math.round(v * 1000) / 1000);
    });
  };

  it('builds the neutral layers and a packed ORM at the slot size', async () => {
    const { slots } = resolve(
      { normalMap: { size: [8, 8] }, orm: { size: [8, 8] } },
      { a: { normalMap: 'n', roughnessMap: 'rough' }, b: {} },
      {
        n: { fileName: `${RUST}Normal.png` },
        rough: { fileName: `${RUST}Roughness.jpg` },
      }
    );
    const [normalMap, orm] = slots;
    expect(await getRanges(normalMap.source.layers[1])).toEqual([
      [0.5, 0.5],
      [0.5, 0.5],
      [1, 1],
    ]);
    const [r, g, b] = await getRanges(orm.source.layers[0]);
    expect([r, b]).toEqual([
      [1, 1],
      [1, 1],
    ]);
    // The roughness map's grey varies
    expect(g[1]).toBeGreaterThan(g[0]);
    expect(await getRanges(orm.source.layers[1])).toEqual([
      [1, 1],
      [1, 1],
      [1, 1],
    ]);
  });
});

describe('collectPipelineAssets', () => {
  it('makes one texture array job per slot a palette’s members use, keyed by the slot', () => {
    const paletteJson = PALETTE_JSON;
    const assetJsons: AssetJson[] = [
      {
        type: 'material',
        id: 'a',
        jsonFile: materialFile('a'),
        data: { id: 'a', type: 'STANDARD', params: { map: 'albedo' } },
      },
      {
        type: 'material',
        id: 'b',
        jsonFile: materialFile('b'),
        data: { id: 'b', type: 'STANDARD', params: {} },
      },
      {
        type: 'texture',
        id: 'albedo',
        jsonFile: textureFile('albedo'),
        data: { fileName: `${RUST}BaseColor.jpg` },
      },
      {
        type: 'mergeMaterial',
        id: 'ruins',
        jsonFile: paletteJson,
        data: { materials: ['a', 'b'], slots: { map: { size: SIZE }, orm: { size: SIZE } } },
      },
    ];
    const { assets, dropped } = collectPipelineAssets(assetJsons);
    expect(dropped).toEqual([]);
    expect(
      assets.get('mergeMaterial:src/app/scenes/p374/ruins.mergeMaterial.json:map')
    ).toMatchObject({
      type: 'textureArray',
      id: 'ruins.map',
      jsonFile: 'src/app/scenes/p374/ruins.mergeMaterial.json',
      isSrgb: true,
      optimize: { slot: 'baseColor' },
    });
    // No member has an ORM map: no job
    expect([...assets.keys()].filter((key) => key.startsWith('mergeMaterial:'))).toHaveLength(1);
  });

  it('drops a palette whose class fails, so the run doesn’t prune', () => {
    const { dropped } = collectPipelineAssets([
      {
        type: 'material',
        id: 'a',
        jsonFile: materialFile('a'),
        data: { id: 'a', type: 'PHONG', params: {} },
      },
      {
        type: 'mergeMaterial',
        id: 'ruins',
        jsonFile: PALETTE_JSON,
        data: { materials: ['a', 'missing'], slots: { map: { size: SIZE } } },
      },
    ]);
    expect(dropped).toEqual([
      {
        jsonFile: 'src/app/scenes/p374/ruins.mergeMaterial.json',
        reason: expect.stringContaining('type PHONG'),
      },
    ]);
  });
});

describe('the repo’s ruinsPalette (p374 Phase 1’s exit)', () => {
  it('builds three arrays, each member’s layer the way its maps call for', () => {
    const { assetJsons } = readAssetJsons();
    const { assets } = collectPipelineAssets(assetJsons);
    const json = 'src/app/scenes/mergeMaterials/ruinsPalette.mergeMaterial.json';
    const getLayers = (slot: string) => {
      const asset = assets.get(`mergeMaterial:${json}:${slot}`);
      if (asset?.source.kind !== 'array') return null;
      return asset.source.layers.map((layer) => {
        if (layer.source.kind !== 'pack') return [layer.key, layer.source.kind];
        const channels = Object.entries(layer.source.pack.channels).map(([target, spec]) =>
          typeof spec === 'number' ? `${target}=${spec}` : `${target}<${path.basename(spec.src)}`
        );
        return [layer.key, channels.join(' ')];
      });
    };
    expect(getLayers('map')).toEqual([
      ['ruinStone', 'relative'],
      ['ruinBrick', 'relative'],
      ['ruinMoss', 'relative'],
      ['ruinPlaster', 'relative'],
    ]);
    expect(getLayers('normalMap')).toEqual([
      ['ruinStone', 'relative'],
      ['ruinBrick', 'relative'],
      ['ruinMoss', 'r=0.5 g=0.5 b=1'],
      ['ruinPlaster', 'r=0.5 g=0.5 b=1'],
    ]);
    expect(getLayers('orm')).toEqual([
      ['ruinStone', 'relative'],
      ['ruinBrick', 'r=1 g<ruinBrick_roughness.png b=1'],
      ['ruinMoss', 'rgb=1'],
      [
        'ruinPlaster',
        'r<ruinPlaster_ao.png g<ruinPlaster_roughness.png b<ruinPlaster_metalness.png',
      ],
    ]);
    expect(assets.has(`mergeMaterial:${json}:emissiveMap`)).toBe(false);
  });
});
