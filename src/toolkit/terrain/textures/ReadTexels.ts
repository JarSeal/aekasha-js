// A texture's texels read back from the GPU (p306 D4): the CPU side of something a shader samples,
// eg. the macro noise a terrain's rules read, for the same rules evaluated into vertex colours. A
// loaded texture may be compressed (KTX2), which the CPU can't decode: a bake draws it into an
// RGBA8 target, which is read back.
import type * as THREE from 'three/webgpu';
import { float, texture } from 'three/tsl';
import { bakeTexture, getRenderer, getTexture, isWebGPURenderer } from 'aekasha';
import type { TerrainRuleNoiseTexels } from 'aekasha/toolkit/geometry';

/** three/tsl's `texture()`, with the real node types (its own typings take a loose node) */
const sampleTexture = texture as unknown as (
  tex: THREE.Texture,
  uv: THREE.Node
) => THREE.TextureNode;

/** The reads made, per texture and size: a second read of either shares the first's */
const reads = new WeakMap<THREE.Texture, Map<string, Promise<TerrainRuleNoiseTexels>>>();
let readCount = 0;

/** A texture's size from its image (a compressed texture's level 0 too), or null */
const getImageSize = (tex: THREE.Texture): [number, number] | null => {
  const image = tex.image as { width?: number; height?: number } | undefined;
  return image?.width && image.height ? [image.width, image.height] : null;
};

/** The bake's target read back, its first row v = 0 (three's WebGL2 readback is bottom row first) */
const readTargetAsync = async (target: THREE.RenderTarget, width: number, height: number) => {
  const renderer = getRenderer(true) as THREE.Renderer;
  const bytes = (await renderer.readRenderTargetPixelsAsync(
    target,
    0,
    0,
    width,
    height
  )) as Uint8Array;
  if (isWebGPURenderer()) return new Uint8Array(bytes);
  const rowBytes = width * 4;
  const flipped = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    flipped.set(bytes.subarray(y * rowBytes, (y + 1) * rowBytes), (height - 1 - y) * rowBytes);
  }
  return flipped;
};

const readAsync = async (tex: THREE.Texture, width: number, height: number) => {
  readCount += 1;
  const bake = await bakeTexture({
    id: `aekReadTexels_${readCount}`,
    size: [width, height],
    mipmaps: false,
    outputs: [{ name: 'data' }],
    // The full resolution at each texel's centre: what the texture holds, not its mips
    build: ({ uv }) => ({ data: sampleTexture(tex, uv).level(float(0) as unknown as THREE.Node) }),
  });
  try {
    const target = bake.textures.data.renderTarget as THREE.RenderTarget;
    return { data: await readTargetAsync(target, width, height), width, height };
  } finally {
    bake.dispose();
  }
};

/**
 * A texture's texels on the CPU, RGBA bytes, row 0 at v = 0 (the shape the terrain rules' CPU
 * evaluation reads its noise in, `generateTerrain`'s `vertexColors.noise`): the texture drawn at
 * its full resolution into an RGBA8 target and read back, so a compressed one (KTX2) works too.
 * The values are what a material samples: an sRGB texture's decoded, clamped to 0..1. Reads are
 * kept per texture and size, so a second call (another block) costs nothing.
 * @param source the texture, or a registered texture's id (eg. `macroNoise`, which the scene lists)
 * @param opts `size`, the texels across and down (default the texture's own)
 * @returns the texels, once read (a bake: at once during a scene load, else queued a frame)
 * @throws (rejects) for an id that isn't loaded, a texture without a size and none given, or no
 * renderer
 * @example
 * ```ts
 * import { generateTerrain } from 'aekasha/toolkit/geometry';
 * import { readTextureTexelsAsync } from 'aekasha/toolkit/terrain';
 *
 * // The rules' noise from the macro noise texture the scene loaded
 * const noise = await readTextureTexelsAsync('macroNoise');
 * const terrain = generateTerrain({
 *   width: 64,
 *   depth: 64,
 *   widthSegments: 128,
 *   depthSegments: 128,
 *   maxHeight: 8,
 *   vertexColors: {
 *     layout: 'RGB_AO',
 *     rules: [{ layer: 1, slope: { min: 26 }, noise: { scale: 18, amount: 0.35, channel: 'A' } }],
 *     noise,
 *   },
 * });
 * ```
 */
export const readTextureTexelsAsync = async (
  source: THREE.Texture | string,
  opts: { size?: [number, number] } = {}
): Promise<TerrainRuleNoiseTexels> => {
  const tex = typeof source === 'string' ? getTexture(source) : source;
  if (!tex) {
    throw new Error(
      `readTextureTexelsAsync: no texture "${String(source)}" is loaded (list it in the scene's textures).`
    );
  }
  const size = opts.size ?? getImageSize(tex);
  if (!size) {
    throw new Error(
      `readTextureTexelsAsync: the texture "${tex.name || tex.uuid}" has no image size: give opts.size.`
    );
  }
  const [width, height] = size;
  const key = `${width}x${height}`;
  let byTexture = reads.get(tex);
  if (!byTexture) {
    byTexture = new Map();
    reads.set(tex, byTexture);
  }
  let read = byTexture.get(key);
  if (!read) {
    read = readAsync(tex, width, height);
    // A failed read isn't kept: the next call tries again
    read.catch(() => byTexture.delete(key));
    byTexture.set(key, read);
  }
  return read;
};
