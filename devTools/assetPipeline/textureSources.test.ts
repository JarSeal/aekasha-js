import { createHash } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  fetchTextureSetSourceAsync,
  findTextureSetSources,
  renderTextureCredits,
  TextureSourceSchema,
  writeTextureCredits,
  type TextureSetSourceDir,
  type TextureSource,
} from './textureSources';

// p303 D5: `yarn fetchTextureSources`' set discovery, both providers against a fake downloader,
// the raw folder and the credits

/** A stored zip of the files (the reader's own tests cover deflate) */
const zip = (files: Record<string, string>) => {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [fileName, text] of Object.entries(files)) {
    const data = Buffer.from(text);
    const name = Buffer.from(fileName);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt32LE(zlib.crc32(data), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    centrals.push(central, name);
    offset += 30 + name.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(centrals.length / 2, 8);
  end.writeUInt16LE(centrals.length / 2, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
};

const AMBIENT_SOURCE: TextureSource = {
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

const AMBIENT_ZIP = zip({
  'Ground080.png': 'preview',
  'Ground080_2K-JPG.usdc': 'scene',
  'Ground080_2K-JPG_Color.jpg': 'color',
  'Ground080_2K-JPG_NormalGL.jpg': 'normal gl',
  'Ground080_2K-JPG_NormalDX.jpg': 'normal dx',
  'Ground080_2K-JPG_Roughness.jpg': 'roughness',
  'Ground080_2K-JPG_Displacement.jpg': 'height',
});

let root: string;
let srcDir: string;
let cacheDir: string;
let downloads: string[];
let lines: string[];
let responses: Record<string, Buffer>;

const opts = (extra: { force?: boolean } = {}) => ({
  cacheDir,
  log: (line: string) => lines.push(line),
  download: async (url: string) => {
    downloads.push(url);
    const response = responses[url];
    if (!response) throw new Error(`can't download ${url}: HTTP 404`);
    return response;
  },
  ...extra,
});

const writeSet = (dir: string, id: string, source?: unknown) => {
  fs.mkdirSync(path.join(srcDir, dir), { recursive: true });
  fs.writeFileSync(path.join(srcDir, dir, `${id}.textureSet.json`), JSON.stringify({ id }));
  if (source) fs.writeFileSync(path.join(srcDir, dir, 'source.json'), JSON.stringify(source));
};

const findSet = (id: string) => {
  const set = findTextureSetSources(srcDir).find((s) => s.setId === id)!;
  return set as TextureSetSourceDir & { source: TextureSource };
};

const readRaw = (dir: string) => {
  const rawDir = path.join(srcDir, dir, 'source', 'raw');
  return Object.fromEntries(
    fs.readdirSync(rawDir).map((file) => [file, fs.readFileSync(path.join(rawDir, file), 'utf8')])
  );
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aek-texture-sources-'));
  srcDir = path.join(root, 'src');
  cacheDir = path.join(root, 'cache');
  downloads = [];
  lines = [];
  responses = { 'https://ambientcg.com/get?file=Ground080_2K-JPG.zip': AMBIENT_ZIP };
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('source.json', () => {
  it('takes the example and refuses what the tool can not use', () => {
    expect(TextureSourceSchema.parse(AMBIENT_SOURCE)).toEqual(AMBIENT_SOURCE);
    const bad = (patch: object) =>
      TextureSourceSchema.safeParse({ ...AMBIENT_SOURCE, ...patch }).success;
    expect(bad({ provider: 'textures.com' })).toBe(false);
    expect(bad({ download: '2K' })).toBe(false);
    expect(bad({ assetId: '../x' })).toBe(false);
    expect(bad({ page: 'not a url' })).toBe(false);
    expect(bad({ maps: { normal: '_NormalGL' } })).toBe(false);
    expect(bad({ maps: { color: '_Color', specular: '_Spec' } })).toBe(false);
    expect(bad({ extra: true })).toBe(false);
  });
});

describe('findTextureSetSources', () => {
  it("finds the toolkit's and the app's set folders with a source.json, by set id", () => {
    writeSet('toolkit/textures/sand01', 'sand01', AMBIENT_SOURCE);
    writeSet('app/scenes/demo/rock', 'demoRock', { ...AMBIENT_SOURCE, assetId: 'Rock051' });
    writeSet('app/scenes/handMade', 'handMade');
    writeSet('toolkit/textures/bad', 'bad', { ...AMBIENT_SOURCE, download: 'big' });
    fs.mkdirSync(path.join(srcDir, 'toolkit/textures/orphan'), { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'toolkit/textures/orphan/source.json'), '{}');
    writeSet('toolkit/textures/two', 'twoA', AMBIENT_SOURCE);
    writeSet('toolkit/textures/two', 'twoB');

    const sets = findTextureSetSources(srcDir);
    expect(sets.map(({ setId, srcPath }) => [setId, srcPath])).toEqual([
      ['bad', 'toolkit/textures/bad'],
      ['demoRock', 'app/scenes/demo/rock'],
      ['sand01', 'toolkit/textures/sand01'],
      ['toolkit/textures/orphan', 'toolkit/textures/orphan'],
      ['toolkit/textures/two', 'toolkit/textures/two'],
    ]);
    expect(sets[0].source).toEqual({
      error: expect.stringMatching(/^invalid source.json: download/),
    });
    expect(sets[2].source).toEqual(AMBIENT_SOURCE);
    expect(sets[3].source).toEqual({ error: 'source.json without a *.textureSet.json beside it' });
    expect(sets[4].source).toEqual({ error: expect.stringMatching(/^one texture set per folder/) });
  });
});

describe('fetchTextureSetSourceAsync', () => {
  it('writes the ambientCG maps by their fixed names, a missing optional one returned', async () => {
    writeSet('toolkit/textures/sand01', 'sand01', AMBIENT_SOURCE);
    const result = await fetchTextureSetSourceAsync(findSet('sand01'), opts());
    expect(result).toEqual({ status: 'fetched', missingOptional: ['ao'] });
    expect(readRaw('toolkit/textures/sand01')).toEqual({
      '.fetched.json': expect.any(String),
      'color.jpg': 'color',
      'normal.jpg': 'normal gl',
      'roughness.jpg': 'roughness',
      'height.jpg': 'height',
    });
    expect(fs.existsSync(path.join(cacheDir, 'ambientCG', 'Ground080_2K-JPG.zip'))).toBe(true);
  });

  it('skips an unchanged set, fetches again on a change or a touched map, uses the cache', async () => {
    writeSet('toolkit/textures/sand01', 'sand01', AMBIENT_SOURCE);
    await fetchTextureSetSourceAsync(findSet('sand01'), opts());
    expect(await fetchTextureSetSourceAsync(findSet('sand01'), opts())).toEqual({
      status: 'upToDate',
      missingOptional: [],
    });
    fs.writeFileSync(path.join(srcDir, 'toolkit/textures/sand01/source/raw/color.jpg'), 'edited');
    expect((await fetchTextureSetSourceAsync(findSet('sand01'), opts())).status).toBe('fetched');
    expect(readRaw('toolkit/textures/sand01')['color.jpg']).toBe('color');
    expect(downloads).toHaveLength(1);

    await fetchTextureSetSourceAsync(findSet('sand01'), opts({ force: true }));
    expect(downloads).toHaveLength(2);
  });

  it("removes the raw folder's other files, and writes nothing when a required map is missing", async () => {
    writeSet('toolkit/textures/sand01', 'sand01', AMBIENT_SOURCE);
    fs.mkdirSync(path.join(srcDir, 'toolkit/textures/sand01/source/raw'), { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'toolkit/textures/sand01/source/raw/color.png'), 'old');
    await fetchTextureSetSourceAsync(findSet('sand01'), opts());
    expect(readRaw('toolkit/textures/sand01')['color.png']).toBeUndefined();

    const source = { ...AMBIENT_SOURCE, maps: { ...AMBIENT_SOURCE.maps, normal: '_Normal' } };
    writeSet('toolkit/textures/sand02', 'sand02', source);
    await expect(fetchTextureSetSourceAsync(findSet('sand02'), opts())).rejects.toThrow(
      'the ambientCG download Ground080 2K-JPG has no "normal" (_Normal)'
    );
    expect(fs.existsSync(path.join(srcDir, 'toolkit/textures/sand02/source'))).toBe(false);
  });

  it('refuses a suffix that matches two files, and fetches a cached zip again when it is corrupt', async () => {
    responses['https://ambientcg.com/get?file=Rock051_2K-JPG.zip'] = zip({
      'Rock051_2K-JPG_Color.jpg': 'color',
      'Rock051_2K-JPG_Color.png': 'color',
    });
    writeSet('toolkit/textures/cliffs01', 'cliffs01', { ...AMBIENT_SOURCE, assetId: 'Rock051' });
    await expect(fetchTextureSetSourceAsync(findSet('cliffs01'), opts())).rejects.toThrow(
      'the "color" suffix "_Color" matches 2 files: Rock051_2K-JPG_Color.jpg, Rock051_2K-JPG_Color.png'
    );

    const cacheFile = path.join(cacheDir, 'ambientCG', 'Ground080_2K-JPG.zip');
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, AMBIENT_ZIP.subarray(0, 100));
    writeSet('toolkit/textures/sand01', 'sand01', AMBIENT_SOURCE);
    expect((await fetchTextureSetSourceAsync(findSet('sand01'), opts())).status).toBe('fetched');
    expect(
      lines.some((line) => line.includes("the cached Ground080_2K-JPG.zip doesn't read"))
    ).toBe(true);
    expect(downloads).toEqual([
      'https://ambientcg.com/get?file=Rock051_2K-JPG.zip',
      'https://ambientcg.com/get?file=Ground080_2K-JPG.zip',
    ]);
  });

  it('fetches the Poly Haven maps from its files API, checked against their MD5', async () => {
    const md5 = (text: string) => createHash('md5').update(text).digest('hex');
    const file = (name: string, text: string) => ({
      url: `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/aerial_sand/${name}`,
      md5: md5(text),
      size: text.length,
    });
    // The files API's map names, each with its file's content
    const maps = [
      ['Diffuse', 'diffuse'],
      ['nor_gl', 'normal'],
      ['Rough', 'rough'],
    ];
    const files = Object.fromEntries(
      maps.map(([name, text]) => [
        name,
        { '2k': { jpg: file(`aerial_sand_${name.toLowerCase()}_2k.jpg`, text) } },
      ])
    );
    responses = {
      'https://api.polyhaven.com/files/aerial_sand': Buffer.from(JSON.stringify(files)),
    };
    for (const [name, text] of maps) {
      responses[files[name]['2k'].jpg.url] = Buffer.from(text);
    }

    const source: TextureSource = {
      provider: 'polyHaven',
      assetId: 'aerial_sand',
      download: '2K-JPG',
      license: 'CC0-1.0',
      page: 'https://polyhaven.com/a/aerial_sand',
      maps: { color: 'Diffuse', normal: 'nor_gl', roughness: 'Rough', ao: 'AO' },
    };
    writeSet('toolkit/textures/sand01', 'sand01', source);
    expect(await fetchTextureSetSourceAsync(findSet('sand01'), opts())).toEqual({
      status: 'fetched',
      missingOptional: ['ao'],
    });
    expect(readRaw('toolkit/textures/sand01')).toMatchObject({
      'color.jpg': 'diffuse',
      'normal.jpg': 'normal',
      'roughness.jpg': 'rough',
    });

    responses[files.Rough['2k'].jpg.url] = Buffer.from('changed on the server');
    fs.rmSync(path.join(cacheDir, 'polyHaven', 'aerial_sand', 'aerial_sand_rough_2k.jpg'));
    await expect(
      fetchTextureSetSourceAsync(findSet('sand01'), opts({ force: true }))
    ).rejects.toThrow(/aerial_sand_rough_2k.jpg: its MD5 isn't the files API's/);
  });
});

describe('the credits', () => {
  it("lists the toolkit's sets, and isn't written while one is invalid", () => {
    writeSet('toolkit/textures/sand02', 'sand02', { ...AMBIENT_SOURCE, assetId: 'Ground093C' });
    writeSet('toolkit/textures/sand01', 'sand01', AMBIENT_SOURCE);
    writeSet('app/scenes/demo', 'appSet', AMBIENT_SOURCE);
    const sets = findTextureSetSources(srcDir);
    const credits = writeTextureCredits(srcDir, sets);
    expect(credits).toEqual({
      file: path.join(srcDir, 'toolkit/textures/CREDITS.md'),
      isWritten: true,
    });
    const text = fs.readFileSync(credits.file, 'utf8');
    expect(text).toBe(renderTextureCredits(sets.filter((s) => s.setId !== 'appSet') as never));
    expect(text.split('\n').filter((line) => line.startsWith('| `'))).toEqual([
      '| `sand01` | Ground080 (2K-JPG) | ambientCG | CC0-1.0 | <https://ambientcg.com/view?id=Ground080> |',
      '| `sand02` | Ground093C (2K-JPG) | ambientCG | CC0-1.0 | <https://ambientcg.com/view?id=Ground080> |',
    ]);
    expect(writeTextureCredits(srcDir, sets)).toMatchObject({ isWritten: false });

    writeSet('toolkit/textures/bad', 'bad', { ...AMBIENT_SOURCE, license: '' });
    expect(writeTextureCredits(srcDir, findTextureSetSources(srcDir))).toMatchObject({
      skipped: 'invalid: toolkit/textures/bad',
    });
  });
});
