/* eslint-disable no-console -- a script's own output */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { SRC_DIR } from '../../paths';

/**
 * The `mergeMaterials` scene's palette sources (p374 Phase 1, `ruinsPalette`): procedural,
 * tileable 256² maps for its four materials, each exercising one way a palette layer is built:
 *
 * - `ruinStone`: albedo, normal and one ORM map (AO, roughness, metalness 0) used as its `aoMap`,
 *   `roughnessMap` and `metalnessMap`: the `orm` slot takes it as it is.
 * - `ruinBrick`: albedo, normal and a separate roughness map: `orm` packs r 1, g its grey, b 1.
 * - `ruinMoss`: albedo only: neutral normal and ORM layers.
 * - `ruinPlaster`: albedo and separate AO, roughness and metalness maps (a metal trim band), no
 *   normal map: `orm` packs all three channels.
 *
 * Deterministic (its own seeded generator), written into the scene's `source/` folder and
 * committed with the texture JSONs, not built by the pipeline. Images are top row first, as a PNG
 * is; normal maps are OpenGL's (green up), as three reads them.
 *
 * Usage: `npx tsx devTools/assetPipeline/fixtures/mergeMaterialsFiles.ts`
 */

const OUT_DIR = path.join(SRC_DIR, 'app', 'scenes', 'mergeMaterials', 'source');
const SIZE = 256;

type Plane = Float32Array;

/** mulberry32: the same numbers on every machine */
const createRandom = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** Tileable value noise: a `cells`² lattice wrapped at the edges, smoothstep-interpolated */
const valueNoise = (seed: number, cells: number): Plane => {
  const random = createRandom(seed);
  const lattice = Array.from({ length: cells * cells }, random);
  const at = (x: number, y: number) => lattice[(y % cells) * cells + (x % cells)];
  const out = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const fx = (x / SIZE) * cells;
      const fy = (y / SIZE) * cells;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const sx = (fx - x0) ** 2 * (3 - 2 * (fx - x0));
      const sy = (fy - y0) ** 2 * (3 - 2 * (fy - y0));
      const top = at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx;
      const bottom = at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx;
      out[y * SIZE + x] = top * (1 - sy) + bottom * sy;
    }
  }
  return out;
};

/** Fractal noise, 0-1: octaves of value noise, each twice the cells at half the weight */
const fbm = (seed: number, cells: number, octaves: number): Plane => {
  const out = new Float32Array(SIZE * SIZE);
  let weight = 0.5;
  let total = 0;
  for (let octave = 0; octave < octaves; octave++) {
    const layer = valueNoise(seed + octave * 101, cells << octave);
    for (let i = 0; i < out.length; i++) out[i] += layer[i] * weight;
    total += weight;
    weight *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
};

const map = (plane: Plane, fn: (value: number, x: number, y: number) => number): Plane => {
  const out = new Float32Array(plane.length);
  for (let i = 0; i < plane.length; i++) out[i] = fn(plane[i], i % SIZE, Math.floor(i / SIZE));
  return out;
};

/** A tangent-space normal map (OpenGL, green up) from a height plane, wrapped at the edges */
const toNormal = (height: Plane, strength: number): Plane[] => {
  const h = (x: number, y: number) => height[((y + SIZE) % SIZE) * SIZE + ((x + SIZE) % SIZE)];
  const planes = [0, 1, 2].map(() => new Float32Array(SIZE * SIZE));
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * strength;
      // Rows go down the image, v up: a height rising downwards tilts the normal up (+y)
      const dy = (h(x, y + 1) - h(x, y - 1)) * strength;
      const length = Math.hypot(dx, dy, 1);
      const i = y * SIZE + x;
      planes[0][i] = (-dx / length) * 0.5 + 0.5;
      planes[1][i] = (dy / length) * 0.5 + 0.5;
      planes[2][i] = (1 / length) * 0.5 + 0.5;
    }
  }
  return planes;
};

/** Writes planes (0-1) as a 1- or 3-channel PNG, sRGB-encoding them when `isSrgb` */
const writePng = async (name: string, planes: Plane[], isSrgb = false) => {
  const channels = planes.length as 1 | 3;
  const data = Buffer.alloc(SIZE * SIZE * channels);
  const encode = (v: number) => {
    const c = Math.min(1, Math.max(0, v));
    const encoded = isSrgb ? (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055) : c;
    return Math.round(encoded * 255);
  };
  for (let i = 0; i < SIZE * SIZE; i++) {
    for (let c = 0; c < channels; c++) data[i * channels + c] = encode(planes[c][i]);
  }
  const file = path.join(OUT_DIR, `${name}.png`);
  await sharp(data, { raw: { width: SIZE, height: SIZE, channels } })
    .png({ compressionLevel: 9 })
    .toFile(file);
  console.log(`  ${path.relative(SRC_DIR, file)} (${fs.statSync(file).size} B)`);
};

/** Linear albedo planes: a base colour, varied by `noise` (0-1) by ±`amount` */
const tint = (noise: Plane, rgb: [number, number, number], amount: number) =>
  rgb.map((c) => map(noise, (n) => c * (1 + (n - 0.5) * 2 * amount)));

const writeStone = async () => {
  const height = fbm(11, 4, 5);
  const grain = fbm(12, 16, 3);
  await writePng(
    'ruinStone_albedo',
    tint(
      map(height, (h, x, y) => h * 0.7 + grain[y * SIZE + x] * 0.3),
      [0.42, 0.4, 0.36],
      0.5
    ),
    true
  );
  await writePng('ruinStone_normal', toNormal(height, 6));
  await writePng('ruinStone_orm', [
    map(height, (h) => 0.55 + 0.45 * Math.min(1, h * 1.6)),
    map(grain, (g) => 0.75 + g * 0.25),
    map(height, () => 0),
  ]);
};

/** The brick layout: 1 on a brick, 0 in the mortar, and each brick's index */
const getBrick = (x: number, y: number) => {
  const rowHeight = 32;
  const brickWidth = 64;
  const mortar = 3;
  const row = Math.floor(y / rowHeight);
  const offset = row % 2 ? brickWidth / 2 : 0;
  const bx = (x + offset) % SIZE;
  const isMortar = y % rowHeight < mortar || bx % brickWidth < mortar;
  return { isMortar, index: row * 8 + Math.floor(bx / brickWidth) };
};

const writeBrick = async () => {
  const noise = fbm(21, 8, 4);
  const random = createRandom(22);
  const brickShades = Array.from({ length: 64 }, () => 0.8 + random() * 0.4);
  const albedo: Plane[] = [0, 1, 2].map(() => new Float32Array(SIZE * SIZE));
  const height = new Float32Array(SIZE * SIZE);
  const roughness = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = y * SIZE + x;
      const { isMortar, index } = getBrick(x, y);
      const n = noise[i];
      const color = isMortar
        ? [0.55, 0.53, 0.5]
        : [0.45, 0.16, 0.1].map((c) => c * brickShades[index]);
      for (let c = 0; c < 3; c++) albedo[c][i] = color[c] * (0.85 + n * 0.3);
      height[i] = isMortar ? 0.1 * n : 0.8 + 0.2 * n;
      roughness[i] = isMortar ? 0.95 : 0.65 + n * 0.2;
    }
  }
  await writePng('ruinBrick_albedo', albedo, true);
  await writePng('ruinBrick_normal', toNormal(height, 4));
  await writePng('ruinBrick_roughness', [roughness]);
};

const writeMoss = async () => {
  const noise = fbm(31, 6, 5);
  await writePng('ruinMoss_albedo', tint(noise, [0.12, 0.26, 0.06], 0.6), true);
};

const writePlaster = async () => {
  const stains = fbm(41, 3, 5);
  const fine = fbm(42, 32, 2);
  // A metal trim band across the tile, rows 200-223
  const isTrim = (y: number) => y >= 200 && y < 224;
  const albedo = [0.78, 0.74, 0.66].map((c, channel) =>
    map(stains, (s, x, y) =>
      isTrim(y)
        ? [0.62, 0.45, 0.25][channel]
        : c * (0.8 + s * 0.3) * (0.95 + fine[y * SIZE + x] * 0.1)
    )
  );
  await writePng('ruinPlaster_albedo', albedo, true);
  await writePng('ruinPlaster_ao', [
    map(stains, (s, _x, y) => (isTrim(y) ? 1 : 0.6 + 0.4 * s) * (y === 199 || y === 224 ? 0.5 : 1)),
  ]);
  await writePng('ruinPlaster_roughness', [
    map(fine, (f, _x, y) => (isTrim(y) ? 0.3 + f * 0.1 : 0.85 + f * 0.15)),
  ]);
  await writePng('ruinPlaster_metalness', [map(fine, (_f, _x, y) => (isTrim(y) ? 1 : 0))]);
};

const main = async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(
    `Writing the mergeMaterials palette sources into ${path.relative(SRC_DIR, OUT_DIR)}/:`
  );
  await writeStone();
  await writeBrick();
  await writeMoss();
  await writePlaster();
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
