import fs from 'fs';
import path from 'path';
import type { TextureSlot } from '../../src/_engine/schemas';
import { encodeKtx2Cube, type KtxProvider, type KtxSettings } from './ktxEncode';
import { getCubeLogicalPath, writeOutput, type PipelineOutput } from './outputs';
import { toRepoPath, type AssetSource } from './sources';
import { probeTextureSource, readTextureSource, resolveFileLayer } from './textureArrays';
import { describeEncodedTexture, fitTextureSize, type EncodedTexture } from './textures';
import { ROOT } from '../paths';

/**
 * Cube textures (p311 D1): a `*.texture.json`'s `faces`, six source images encoded as one KTX2
 * cube (`ktx create --cubemap`). Its faces are stored as they are (a cube texture isn't flipped),
 * each fit to the slot's `maxSize`. Its codec defaults to ETC1S (`settings.ts`, D3).
 */

/** The faces' order, in `faces` and in a KTX2 cube */
export const CUBE_FACE_NAMES = ['+x', '-x', '+y', '-y', '+z', '-z'] as const;

/**
 * A cube texture as the pipeline builds it: like a pack, it has no single source file, so its
 * rules match, and its output is named after, its JSON.
 */
export type CubeSource = {
  kind: 'cube';
  /** The texture's JSON, absolute */
  jsonFile: string;
  /** The texture's JSON, '/'-separated, relative to the repo root */
  repoPath: string;
  /** In {@link CUBE_FACE_NAMES}' order */
  faces: Extract<AssetSource, { file: string }>[];
};

const getFaceLabel = (index: number) => `faces[${index}] (${CUBE_FACE_NAMES[index]})`;

/**
 * Resolves a cube texture's `faces` (each like a `fileName`, after the texture's `path`). Returns
 * `{ error }` naming each face that doesn't resolve, is remote, doesn't exist or isn't an 8-bit
 * image.
 * @param jsonFile The texture's JSON, absolute or relative to the repo root
 */
export const resolveCubeSource = (
  jsonFile: string,
  faces: readonly string[],
  urlPath?: string
): CubeSource | { error: string } => {
  const resolved: CubeSource['faces'] = [];
  const errors: string[] = [];
  faces.forEach((fileName, index) => {
    const source = resolveFileLayer(jsonFile, fileName, urlPath, 'a cube face');
    if (typeof source === 'string') errors.push(`${getFaceLabel(index)}: ${source}`);
    else resolved.push(source);
  });
  if (errors.length) return { error: errors.join('; ') };
  const file = path.resolve(ROOT, jsonFile);
  return { kind: 'cube', jsonFile: file, repoPath: toRepoPath(file), faces: resolved };
};

/** Every file a cube's encode reads, in its faces' order (the cache key hashes them so) */
export const listCubeFiles = (source: CubeSource) => source.faces.map((face) => face.file);

/**
 * Encodes a cube texture (p311 D1): its six faces, square and of one size, fit to `maxSize` (and
 * multiples of 4) like a texture, as one KTX2 cube. A face with alpha makes the cube RGBA.
 * Throws, naming the face, for one that can't be read, isn't square or isn't the first face's
 * size.
 */
export const encodeCubeTexture = async (
  source: CubeSource,
  slot: TextureSlot,
  settings: KtxSettings,
  opts: { isSrgb: boolean; getKtx: KtxProvider; warn: (message: string) => void }
): Promise<{ output: PipelineOutput; texture: EncodedTexture }> => {
  const isNormal = slot === 'normal';
  const layers = source.faces.map((face, index) => ({ key: getFaceLabel(index), source: face }));
  const withLabel = async <T>(index: number, fn: () => Promise<T>) => {
    try {
      return await fn();
    } catch (error) {
      throw new Error(`${getFaceLabel(index)}: ${(error as Error).message}`);
    }
  };

  const probes: Awaited<ReturnType<typeof probeTextureSource>>[] = [];
  for (let index = 0; index < layers.length; index++) {
    probes.push(await withLabel(index, () => probeTextureSource(layers[index], isNormal)));
  }
  const [base] = probes;
  if (base.width !== base.height) {
    throw new Error(
      `${getFaceLabel(0)}: a cube's faces are square, and it is ${base.width}×${base.height}`
    );
  }
  const other = probes.findIndex((p) => p.width !== base.width || p.height !== base.height);
  if (other >= 0) {
    throw new Error(
      `the faces differ in size (${getFaceLabel(0)} is ${base.width}×${base.height}, ${getFaceLabel(other)} ${probes[other].width}×${probes[other].height})`
    );
  }
  const size = fitTextureSize(base.width, base.height, settings, opts.warn);

  const channels = probes.some((probe) => probe.hasAlpha) ? 4 : 3;
  const bytes = await encodeKtx2Cube(
    (index) =>
      withLabel(index, () =>
        readTextureSource(layers[index], size, { isSrgb: opts.isSrgb, isNormal })
      ),
    settings,
    { channels, isSrgb: opts.isSrgb, isNormal, getKtx: opts.getKtx }
  );
  const output = writeOutput(getCubeLogicalPath(source.jsonFile), '.ktx2', bytes);
  const sourceBytes = [...new Set(listCubeFiles(source))].reduce(
    (sum, file) => sum + fs.statSync(file).size,
    0
  );
  const texture: EncodedTexture = {
    ...describeEncodedTexture({ ...size, channels }, settings, {
      slot,
      bytes: output.bytes,
      source: { width: base.width, height: base.height, bytes: sourceBytes },
    }),
    isCube: true,
  };
  return { output, texture };
};
