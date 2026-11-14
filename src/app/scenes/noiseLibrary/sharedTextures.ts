// The noise library scene's last pair (p304 D4): the toolkit's shared generated textures, baked
// with their defaults, shown and read back for `sharedTextureChecks.ts`.
//
// The left tile is `bakeMacroNoise`'s texture, a channel per quarter: R (top left), G (top right)
// and B (bottom left) over 2 × 2 tiles each, so a seam would show as a line, and A (bottom right)
// magnified to about 50 texels across (minified, its mips are an even grey).
// The right tile is `bakeRippleAtlas`'s: the texture's RGB (top left: the directions in red and
// green, the mask in blue) and its time offsets (top right), then what `decodeRippleAtlas` makes
// of it at the scene's fixed ripple time, close up (2 × 2 drops) and three times as strong: one
// sample's normal offset (bottom left) and two samples' as a material would layer them (bottom
// right).
// `window.__noiseLibrary.setRippleTime(t)` moves the rings (in ring lifetimes).
import type * as THREE from 'three/webgpu';
import { floor, mix, uniform, vec2, vec3, vec4 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { bakeTexture, getRenderer, getTexture, lerror, type BakedTexture } from 'aekasha';
import { bakeMacroNoise, bakeRippleAtlas, decodeRippleAtlas } from 'aekasha/toolkit/terrain';
import { getBackendName, meshUv, sampleTexture } from '../../shared/verifyHarness';
import {
  checkCommittedCopy,
  checkMacroNoise,
  checkRippleAtlas,
  type CopyTolerance,
  type SharedTextureResult,
} from './sharedTextureChecks';

/** The bakes' defaults, which the checks read back at. */
const MACRO_SIZE = 512;
const RIPPLE_SIZE = 256;
const RIPPLE_CELLS = 4;
/** The rings' time in the snapshot, in ring lifetimes: fixed, so every run shows the same. */
const RIPPLE_TIME = 0.3;
/** The share of the atlas the decoded quarters show across, and their offsets' gain. */
const RINGS_ZOOM = 0.5;
const RINGS_GAIN = 3;
/** The share of the macro texture its A quarter shows across (about 50 texels). */
const BLUE_ZOOM = 0.1;

/**
 * How far the committed KTX2 copies (UASTC) may be from the bakes, per channel in bytes: about
 * twice what was measured (2026-11-14: means of 2-3 for the macro noise and about 1 for the atlas,
 * the largest 17-36, at the drops' centres and the patches' borders). A copy flipped or of another
 * seed is tens of bytes off on average.
 */
const MACRO_COPY_TOLERANCES: [CopyTolerance, CopyTolerance, CopyTolerance, CopyTolerance] = [
  { mean: 6, max: 60 },
  { mean: 6, max: 60 },
  { mean: 6, max: 60 },
  { mean: 6, max: 60 },
];
const RIPPLE_COPY_TOLERANCES: [CopyTolerance, CopyTolerance, CopyTolerance, CopyTolerance] = [
  { mean: 3, max: 70 },
  { mean: 3, max: 70 },
  { mean: 3, max: 60 },
  { mean: 2, max: 20 },
];

/** The shared textures' results: each bake's, and its committed copy's against it. */
export type SharedTextureResults = Record<
  'macroNoise' | 'rippleAtlas' | 'macroNoise copy' | 'rippleAtlas copy',
  SharedTextureResult
>;

const rippleTime = uniform(RIPPLE_TIME);

/**
 * Sets the ripple tile's time (the scene's `window.__noiseLibrary.setRippleTime`).
 * @param time the time in ring lifetimes
 */
export const setRippleTime = (time: number) => {
  rippleTime.value = time;
};

/** A tile's quarter as 0 or 1 along each axis (v up), and the uv inside it over `tiles` tiles. */
const getQuarters = (tiles: number) => {
  const doubled = meshUv().mul(2) as Node<'vec2'>;
  // Not `fract`: its jump at the quarters' borders would pick the smallest mip along them
  return { quarter: floor(doubled) as Node<'vec2'>, uv: doubled.mul(tiles) as Node<'vec2'> };
};

/** `[topLeft, topRight, bottomLeft, bottomRight]` by quarter. */
const pickQuarter = (quarter: Node<'vec2'>, values: Node<'vec3'>[]) =>
  mix(
    mix(values[2], values[3], quarter.x),
    mix(values[0], values[1], quarter.x),
    quarter.y
  ) as unknown as Node<'vec3'>;

const toVec3 = (...parts: (Node | number)[]) =>
  (vec3 as unknown as (...parts: (Node | number)[]) => Node<'vec3'>)(...parts);

const getMacroNoiseColor = (texture: THREE.Texture) => {
  const { quarter, uv } = getQuarters(2);
  const sample = sampleTexture(texture, uv);
  const zoomed = sampleTexture(texture, meshUv().mul(2 * BLUE_ZOOM));
  const color = pickQuarter(quarter, [
    toVec3(sample.r),
    toVec3(sample.g),
    toVec3(sample.b),
    toVec3(zoomed.a),
  ]);
  return vec4(color, 1) as unknown as Node<'vec4'>;
};

const getRippleAtlasColor = (texture: THREE.Texture) => {
  const { quarter, uv } = getQuarters(1);
  const sample = sampleTexture(texture, uv) as unknown as Node<'vec4'>;
  // The rings close up (2 × 2 drops a quarter), their offsets stretched to read at this size
  const close = uv.mul(RINGS_ZOOM) as Node<'vec2'>;
  const rings = decodeRippleAtlas(
    sampleTexture(texture, close) as unknown as Node<'vec4'>,
    rippleTime as unknown as Node<'float'>
  );
  // Two samples at other scales and times, as the rings are layered on a wet surface
  const second = decodeRippleAtlas(
    sampleTexture(texture, close.mul(1.37).add(vec2(0.31, 0.57))) as unknown as Node<'vec4'>,
    rippleTime.add(0.5) as unknown as Node<'float'>
  );
  const show = (offset: Node<'vec2'>) => offset.mul(RINGS_GAIN * 0.5).add(0.5);
  const color = pickQuarter(quarter, [
    toVec3(sample.xyz),
    toVec3(sample.w),
    toVec3(show(rings.normalXY), 1),
    toVec3(show(rings.normalXY.add(second.normalXY)), 1),
  ]);
  return vec4(color, 1) as unknown as Node<'vec4'>;
};

/** A bake's `data` texture read back as RGBA8 bytes (level 0), the first row v = 0: three's
 * readback is bottom row first on WebGL2, and the atlas's directions have a side. */
const readBakeAsync = async (bake: BakedTexture, size: number) => {
  const renderer = getRenderer(true) as THREE.Renderer;
  const target = bake.textures.data.renderTarget as THREE.RenderTarget;
  const bytes = (await renderer.readRenderTargetPixelsAsync(
    target,
    0,
    0,
    size,
    size
  )) as Uint8Array;
  if (getBackendName() === 'WebGPU') return bytes;
  const rowBytes = size * 4;
  const flipped = new Uint8Array(bytes.length);
  for (let y = 0; y < size; y++) {
    flipped.set(bytes.subarray(y * rowBytes, (y + 1) * rowBytes), (size - 1 - y) * rowBytes);
  }
  return flipped;
};

/**
 * `|bake − committed copy|` of a shared texture, texel for texel (a bake of the difference, both
 * sampled at the texel's centre), read back; the copy is the scene's texture `id` (the toolkit's
 * `<id>.texture.json`, the bake's export encoded to KTX2).
 */
const readCopyDifferenceAsync = async (id: string, bake: BakedTexture, size: number) => {
  const copy = getTexture(id);
  if (!copy) throw new Error(`The committed texture "${id}" isn't loaded.`);
  const difference = await bakeTexture({
    id: `p304_copyDifference_${id}`,
    size,
    mipmaps: false,
    outputs: [{ name: 'data' }],
    build: ({ uv }) => ({
      data: sampleTexture(bake.textures.data, uv).sub(sampleTexture(copy, uv)).abs(),
    }),
  });
  const bytes = await readBakeAsync(difference, size);
  difference.dispose();
  return bytes;
};

/**
 * Bakes the two shared textures, shows them as the scene's last pair, checks them and compares
 * their committed copies with them; an error for each failure.
 * @param createTile the scene's tile maker, bound to the pair's left and right positions
 * @returns the checks' results
 */
export const createSharedTexturesAsync = async (
  createTile: (id: string, side: 'left' | 'right', color: Node<'vec4'>) => void
): Promise<SharedTextureResults> => {
  rippleTime.value = RIPPLE_TIME;
  const macro = await bakeMacroNoise();
  const ripples = await bakeRippleAtlas();
  createTile('p304_macroNoise', 'left', getMacroNoiseColor(macro.textures.data));
  createTile('p304_rippleAtlas', 'right', getRippleAtlasColor(ripples.textures.data));
  const results: SharedTextureResults = {
    macroNoise: checkMacroNoise(await readBakeAsync(macro, MACRO_SIZE), MACRO_SIZE),
    rippleAtlas: checkRippleAtlas(
      await readBakeAsync(ripples, RIPPLE_SIZE),
      RIPPLE_SIZE,
      RIPPLE_CELLS
    ),
    'macroNoise copy': checkCommittedCopy(
      await readCopyDifferenceAsync('macroNoise', macro, MACRO_SIZE),
      MACRO_COPY_TOLERANCES
    ),
    'rippleAtlas copy': checkCommittedCopy(
      await readCopyDifferenceAsync('rippleAtlas', ripples, RIPPLE_SIZE),
      RIPPLE_COPY_TOLERANCES
    ),
  };
  for (const [id, result] of Object.entries(results)) {
    for (const failure of result.failures) {
      lerror(`[noiseLibrary] ${id} (${getBackendName()}): ${failure}.`);
    }
  }
  return results;
};
