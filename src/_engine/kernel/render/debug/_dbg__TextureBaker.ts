import * as THREE from 'three/webgpu';
import {
  DevFilesError,
  encodePNG,
  getDevFilesStatus,
  readDevFile,
  writeDevFiles,
} from '../../../debug/DevFiles';
import { lwarn } from '../../../utils/Logger';
import { getTexture } from '../../assets/Texture';
import { getRenderer } from '../Renderer';
import { readRenderTargetRGBA8Async } from '../Snapshot';
import type { BakedTextureExport, ExportBakedTextureOpts } from '../TextureBaker';

// The baked texture export (p304 D5, debug only): a bake's output read back (level 0: the asset
// pipeline builds the mips again), encoded as an 8-bit PNG and written into the repo through the
// dev files, as a texture set's committed source for a pack recipe (`yarn assets` then encodes it
// to KTX2): a procedural look, shipped compressed and without a bake at load. Without the dev
// files (a LAN device, `AEK_DEV_FILES=false`) the PNG is downloaded instead.
//
// The rows are flipped on the way out: a bake's first row is v = 0, a PNG's top row is sampled at
// v = 1 once imported, so the imported copy shows what the bake does at every uv.

/**
 * RGBA half floats as RGBA8, clamped to 0..1 (no tone mapping: what's above 1 is lost).
 * @param halves the half floats, 4 a texel
 * @returns the bytes, and how many components were out of range
 */
export const convertHalfFloatsToBytes = (halves: ArrayLike<number>) => {
  const bytes = new Uint8ClampedArray(halves.length);
  let clamped = 0;
  for (let i = 0; i < halves.length; i++) {
    const value = THREE.DataUtils.fromHalfFloat(halves[i]);
    if (value < 0 || value > 1) clamped++;
    // A Uint8ClampedArray rounds and clamps; NaN becomes 0
    bytes[i] = value * 255;
  }
  return { bytes, clamped };
};

/** A half float target's level 0 as RGBA8, top row first on both backends (WebGPU pads its rows,
 * WebGL reads them bottom-up), as `readRenderTargetRGBA8Async` reads an RGBA8 one. */
const readHalfFloatTargetAsync = async (target: THREE.RenderTarget, textureIndex: number) => {
  const renderer = getRenderer(true)!;
  const { width, height } = target;
  const isBottomUp = Boolean((renderer.backend as { isWebGLBackend?: boolean }).isWebGLBackend);
  const data = (await renderer.readRenderTargetPixelsAsync(
    target,
    0,
    0,
    width,
    height,
    textureIndex
  )) as Uint16Array;
  const rowLength = width * 4;
  const stride = height > 1 ? (data.length - rowLength) / (height - 1) : rowLength;
  const rows = new Uint16Array(rowLength * height);
  for (let row = 0; row < height; row++) {
    const start = (isBottomUp ? height - 1 - row : row) * stride;
    rows.set(data.subarray(start, start + rowLength), row * rowLength);
  }
  return convertHalfFloatsToBytes(rows);
};

/** The output's level 0 as RGBA8 bytes, top row first (the bake's v = 0). */
const readOutputAsync = async (id: string, output: string) => {
  const textureId = `${id}.${output}`;
  const texture = getTexture(textureId);
  const target = texture?.renderTarget;
  const textureIndex = target ? target.textures.indexOf(texture) : -1;
  if (!texture || !target || textureIndex < 0) {
    throw new Error(
      `exportBakedTexture: "${textureId}" isn't a baked texture (bake "${id}" with an output "${output}" first).`
    );
  }
  if (target.depth > 1) {
    throw new Error(
      `exportBakedTexture: "${textureId}" is an array bake (${target.depth} layers), which can't be exported: bake the layer on its own.`
    );
  }
  const { width, height } = target;
  if (texture.type === THREE.HalfFloatType) {
    const { bytes, clamped } = await readHalfFloatTargetAsync(target, textureIndex);
    if (clamped) {
      lwarn(
        `exportBakedTexture: "${textureId}" is HALF_FLOAT and the PNG is 8-bit: ${clamped} values outside 0..1 were clamped.`
      );
    }
    return { data: bytes, width, height, clamped };
  }
  const data = await readRenderTargetRGBA8Async(target, textureIndex);
  return { data, width, height, clamped: 0 };
};

const downloadBlob = (fileName: string, blob: Blob) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
};

const isSameBytes = (a: Uint8Array, b: Uint8Array) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

const toRepoDir = (dir: string) => dir.replace(/\\/g, '/').replace(/^\.?\/+|\/+$/g, '');

/**
 * `exportBakedTexture`'s implementation (see it in `TextureBaker.ts`).
 * @param opts the bake's id, its output and where the PNG goes
 * @returns the PNG's path and what happened to it
 */
export const exportBakedTextureAsync = async (
  opts: ExportBakedTextureOpts
): Promise<BakedTextureExport> => {
  const fileName = opts.fileName ?? `${opts.id}_${opts.output}.png`;
  if (!/^[^/\\]+\.png$/i.test(fileName)) {
    throw new Error(
      `exportBakedTexture: the file name "${fileName}" isn't a .png's, without a folder.`
    );
  }
  const path = `${toRepoDir(opts.dir)}/${fileName}`;
  const image = await readOutputAsync(opts.id, opts.output);
  const blob = await encodePNG(image, { flipY: true });
  const base = { path, clampedValues: image.clamped };

  const status = await getDevFilesStatus();
  if (!status.available) {
    downloadBlob(fileName, blob);
    lwarn(`exportBakedTexture (${status.message}): downloaded ${fileName}. Put it at ${path}`);
    return { ...base, status: 'DOWNLOADED', reason: status.message };
  }
  const existing = await readDevFile(path);
  if (existing) {
    if (isSameBytes(existing.bytes, new Uint8Array(await blob.arrayBuffer()))) {
      return { ...base, status: 'UNCHANGED' };
    }
    if (!opts.overwrite) return { ...base, status: 'EXISTS' };
  }
  try {
    const result = await writeDevFiles([
      { path, blob, expectedHash: existing ? existing.sha256 : null },
    ]);
    const written = result.results[0]?.status;
    return {
      ...base,
      status: written === 'created' ? 'CREATED' : written === 'updated' ? 'UPDATED' : 'UNCHANGED',
    };
  } catch (err) {
    if (err instanceof DevFilesError && err.code === 'CONFLICT') {
      throw new Error(`exportBakedTexture: ${path} changed on disk while exporting: export again.`);
    }
    throw err;
  }
};
