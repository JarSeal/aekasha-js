import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createImage, encodePng } from './images';
import { EncoderMissingError, type KtxSettings } from './ktxEncode';
import { processAsset } from './pipeline';
import { createSettingsResolver } from './settings';
import { encodeCubeTexture, resolveCubeSource, type CubeSource } from './textureCubes';
import { ROOT } from '../paths';

// p311 D1: a cube texture's six faces, resolved and checked before one `ktx create --cubemap`.
// No `ktx` is needed: the checks run before the encoder is asked for, which here fails.

const JSON_FILE = path.join(ROOT, 'src/app/textures/probeCube.texture.json');
const DIR = '/debugger/assets/testTextures/';
const FACES = ['positive_x', 'negative_x', 'positive_y', 'negative_y', 'positive_z', 'negative_z'];
const CUBEMAP01 = FACES.map((face) => `cubemap01_${face}.png`);

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aek-p311-cube-'));
afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

const ETC1S: KtxSettings = {
  codec: 'etc1s',
  maxSize: 1024,
  mipmaps: true,
  quality: 128,
  normalMode: false,
};
const noKtx = () => Promise.reject(new EncoderMissingError('no ktx here'));

/** A cube of six PNGs written into the temp folder, each `sizes[i]` (default 8×8) */
const writeCube = async (name: string, sizes: [number, number][] = []): Promise<CubeSource> => {
  const faces: CubeSource['faces'] = [];
  for (let i = 0; i < 6; i++) {
    const [width, height] = sizes[i] ?? [8, 8];
    const file = path.join(TMP, `${name}_${i}.png`);
    fs.writeFileSync(file, await encodePng(createImage(width, height, 3), true));
    faces.push({ kind: 'relative', file, repoPath: file });
  }
  return { kind: 'cube', jsonFile: JSON_FILE, repoPath: 'probeCube.texture.json', faces };
};

const encode = (source: CubeSource) =>
  encodeCubeTexture(source, 'default', ETC1S, { isSrgb: true, getKtx: noKtx, warn: () => {} });

describe('resolveCubeSource', () => {
  it('resolves six public faces after the path, in their order', () => {
    const source = resolveCubeSource(JSON_FILE, CUBEMAP01, DIR);
    if ('error' in source) throw new Error(source.error);
    expect(source.kind).toBe('cube');
    expect(source.repoPath).toBe('src/app/textures/probeCube.texture.json');
    expect(source.faces.map((face) => face.repoPath)).toEqual(
      CUBEMAP01.map((file) => `src/public${DIR}${file}`)
    );
  });

  it('names each face that is missing, remote or not an 8-bit image', () => {
    const faces = [...CUBEMAP01];
    faces[1] = 'cubemap01_missing.png';
    faces[3] = 'https://example.com/face.png';
    faces[5] = 'kloofendal_48d_partly_cloudy_puresky_2k.hdr';
    const source = resolveCubeSource(JSON_FILE, faces, DIR);
    expect('error' in source && source.error.split('; ')).toEqual([
      expect.stringMatching(/^faces\[1\] \(-x\): source file .* not found/),
      expect.stringMatching(/^faces\[3\] \(-y\): .* is remote/),
      expect.stringMatching(/^faces\[5\] \(-z\): a cube face is read as an 8-bit image/),
    ]);
  });
});

describe('encodeCubeTexture', () => {
  it('refuses faces that are not square', async () => {
    const source = await writeCube('oblong', Array(6).fill([8, 4]));
    await expect(encode(source)).rejects.toThrow("faces[0] (+x): a cube's faces are square");
  });

  it('refuses faces of different sizes, naming the first that differs', async () => {
    const source = await writeCube('mixed', [
      [8, 8],
      [8, 8],
      [8, 8],
      [16, 16],
    ]);
    await expect(encode(source)).rejects.toThrow(
      'the faces differ in size (faces[0] (+x) is 8×8, faces[3] (-y) 16×16)'
    );
  });

  it('asks for the encoder once six square faces of one size are read', async () => {
    const source = await writeCube('even');
    await expect(encode(source)).rejects.toThrow(EncoderMissingError);
  });
});

describe('a cube texture in the pipeline', () => {
  const asset = (optimize?: object) => ({
    type: 'texture' as const,
    id: 'probeCube',
    jsonFile: 'src/app/textures/probeCube.texture.json',
    source: resolveCubeSource(JSON_FILE, CUBEMAP01, DIR) as CubeSource,
    isSrgb: true,
    ...(optimize ? { optimize } : {}),
  });
  const resolveSettings = createSettingsResolver({});

  it('has no output with its textures kept as they are', async () => {
    const result = await processAsset(asset({ textures: false }), resolveSettings);
    expect(result).toMatchObject({
      status: 'skipped',
      reason: expect.stringContaining('a cube texture is only built as a KTX2 file'),
    });
  });

  it('refuses codec "none": a cube is a KTX2 file', async () => {
    const optimize = { textures: { default: { codec: 'none' } } };
    await expect(processAsset(asset(optimize), resolveSettings)).rejects.toThrow(
      'and a cube texture is a KTX2 file'
    );
  });
});
