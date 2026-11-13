import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TextureAssetSchema } from '../../src/_engine/schemas';
import {
  createSlotTextureJson,
  listTextureIds,
  scaffoldTextureSetAsync,
  type ScaffoldSet,
} from './textureSetScaffold';
import type { TextureSource } from './textureSources';

// p303 D3: the scaffold's recipes (D2's channel layouts, valid texture JSONs) and what it keeps

const SOURCE: TextureSource = {
  provider: 'ambientCG',
  assetId: 'Ground080',
  download: '2K-JPG',
  license: 'CC0-1.0',
  page: 'https://ambientcg.com/view?id=Ground080',
  maps: {
    color: '_Color',
    normal: '_NormalGL',
    roughness: '_Roughness',
    ao: '_AmbientOcclusion',
    height: '_Displacement',
  },
};

const SET: ScaffoldSet = {
  id: 'sand01',
  packings: {
    LITE: { albedoRough: 'sand01_albedoRough', normalHeight: 'sand01_normalHeight' },
    FULL: { albedoHeight: 'sand01_albedoHeight', normal: 'sand01_normal', orm: 'sand01_orm' },
    MINIMAL: { albedoHeight: 'sand01_albedoHeightAO' },
  },
  surface: { aoStrength: 0.8 },
};

let dir: string;
const SCHEMA_FILE = '/repo/.schemas/texture.schema.json';

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aek-scaffold-'));
});

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const readJson = (id: string) =>
  JSON.parse(fs.readFileSync(path.join(dir, `${id}.texture.json`), 'utf8')) as Record<
    string,
    unknown
  >;

describe('the recipes', () => {
  it("write D2's channels for every slot, each a valid texture JSON", async () => {
    const result = await scaffoldTextureSetAsync(dir, SET, SOURCE, {
      existingIds: new Map(),
      schemaFile: path.join(dir, '../.schemas/texture.schema.json'),
    });
    expect(result.written).toEqual([
      'sand01_albedoHeight',
      'sand01_normal',
      'sand01_orm',
      'sand01_albedoRough',
      'sand01_normalHeight',
      'sand01_albedoHeightAO',
    ]);
    for (const id of result.written) {
      const json = readJson(id);
      expect(json.$schema).toBe('../.schemas/texture.schema.json');
      expect(TextureAssetSchema.safeParse(json).error).toBeUndefined();
    }

    const ao = { src: './source/raw/ao.jpg', channel: 'r', strength: 0.8 };
    const height = { src: './source/raw/height.jpg', channel: 'r', remap: 'auto' };
    const roughness = { src: './source/raw/roughness.jpg', channel: 'r' };
    expect(readJson('sand01_albedoRough')).toMatchObject({
      pack: { channels: { rgb: { src: './source/raw/color.jpg', multiply: ao }, a: roughness } },
      optimize: { profile: 'terrainLayer', slot: 'baseColor' },
      texOpts: { wrapS: 'REPEAT', wrapT: 'REPEAT', colorSpace: 'srgb', anisotropy: 'MAX' },
    });
    expect(readJson('sand01_normalHeight')).toMatchObject({
      pack: { channels: { rg: { src: './source/raw/normal.jpg', normal: true }, b: height } },
      optimize: { slot: 'data' },
    });
    expect(readJson('sand01_normalHeight').texOpts as object).not.toHaveProperty('colorSpace');
    expect(readJson('sand01_albedoHeight')).toMatchObject({
      pack: { channels: { rgb: { src: './source/raw/color.jpg' }, a: height } },
    });
    expect(readJson('sand01_normal')).toMatchObject({ optimize: { slot: 'normal' } });
    expect(readJson('sand01_orm')).toMatchObject({
      pack: { channels: { r: { src: './source/raw/ao.jpg', channel: 'r' }, g: roughness, b: 0 } },
      optimize: { slot: 'orm' },
    });
    expect(readJson('sand01_albedoHeightAO')).toMatchObject({
      pack: { channels: { rgb: { multiply: ao }, a: height } },
    });
  });

  it('use a PNG download, and constants for a missing AO or height map', () => {
    const source: TextureSource = {
      ...SOURCE,
      download: '2K-PNG',
      maps: { color: '_Color', normal: '_NormalGL', roughness: '_Roughness' },
    };
    const json = (packing: 'LITE' | 'FULL', slot: 'albedoRough' | 'normalHeight' | 'orm') =>
      createSlotTextureJson(SET, source, packing, slot, 'x');
    expect(json('LITE', 'albedoRough').pack.channels.rgb).toEqual({
      src: './source/raw/color.png',
    });
    expect(json('LITE', 'normalHeight').pack.channels.b).toBe(0.5);
    expect(json('FULL', 'orm').pack.channels.r).toBe(1);
    expect(() => createSlotTextureJson(SET, source, 'LITE', 'orm', 'x')).toThrow(
      'LITE has no slot "orm"'
    );
  });

  it("derive the AO from the height's cavity without an AO map, its radius scaled to the download", async () => {
    const source: TextureSource = {
      ...SOURCE,
      download: '1K-JPG',
      maps: { color: '_Color', normal: '_NormalGL', roughness: '_Roughness', height: '_Height' },
    };
    const cavity = {
      src: './source/raw/height.jpg',
      channel: 'r',
      cavity: { radius: 12, strength: 4 },
    };
    const lite = createSlotTextureJson(SET, source, 'LITE', 'albedoRough', 'x');
    expect(lite.pack.channels.rgb).toEqual({
      src: './source/raw/color.jpg',
      multiply: { ...cavity, strength: 0.8 },
    });
    expect(lite.debugData.description).toContain('RGB albedo × cavity AO (from height)');
    expect(createSlotTextureJson(SET, source, 'FULL', 'orm', 'x').pack.channels.r).toEqual(cavity);
    const json = createSlotTextureJson(SET, source, 'MINIMAL', 'albedoHeight', 'x');
    expect(TextureAssetSchema.safeParse(json).error).toBeUndefined();
    const at2k = createSlotTextureJson(SET, { ...source, download: '2K-PNG' }, 'FULL', 'orm', 'x');
    expect(at2k.pack.channels.r).toMatchObject({ cavity: { radius: 24 } });
  });
});

describe('scaffoldTextureSetAsync', () => {
  it('keeps a file that is there and an id another JSON gives, and refuses missing maps', async () => {
    fs.writeFileSync(path.join(dir, 'sand01_orm.texture.json'), '{ "id": "sand01_orm" }');
    const existingIds = new Map([['sand01_normal', '/elsewhere/sand01_normal.texture.json']]);
    const result = await scaffoldTextureSetAsync(dir, SET, SOURCE, {
      existingIds,
      schemaFile: SCHEMA_FILE,
    });
    expect(result.kept).toEqual(['sand01_normal', 'sand01_orm']);
    expect(fs.readFileSync(path.join(dir, 'sand01_orm.texture.json'), 'utf8')).toBe(
      '{ "id": "sand01_orm" }'
    );
    expect(existingIds.get('sand01_albedoRough')).toBe(
      path.join(dir, 'sand01_albedoRough.texture.json')
    );

    const lacking = { ...SOURCE, maps: { color: '_Color', normal: '_NormalGL' } };
    await expect(
      scaffoldTextureSetAsync(dir, SET, lacking, { existingIds, schemaFile: SCHEMA_FILE })
    ).rejects.toThrow('the recipes read a roughness map: source.json names none');
  });

  it("listTextureIds finds every texture JSON's id", () => {
    fs.mkdirSync(path.join(dir, 'a/b'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'a/b/x.texture.json'), '{ "id": "x" }');
    fs.writeFileSync(path.join(dir, 'a/broken.texture.json'), '{');
    fs.writeFileSync(path.join(dir, 'a/y.material.json'), '{ "id": "y" }');
    expect(listTextureIds(dir)).toEqual(new Map([['x', path.join(dir, 'a/b/x.texture.json')]]));
  });
});
