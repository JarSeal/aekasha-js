/* eslint-disable no-console -- a script's own output */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { SRC_DIR } from '../../paths';

/**
 * The `textureSets` scene's hand-made texture set (p303 Phase 1's exit, `p303TestSet`): a tileable
 * 256² cobble surface (4 × 4 domed stones in mortar) packed by hand into each packing of D2's
 * table, so the set loads as PNGs with no pipeline:
 *
 * - `FULL`: `albedoHeight` (RGB albedo, A height), `normal` (XYZ), `orm` (AO, roughness, metalness 0).
 * - `LITE`: `albedoRough` (RGB albedo × AO, A roughness), `normalHeight` (RG the normal's X and Y,
 *   B height).
 * - `MINIMAL`: `albedoHeightAO` (RGB albedo × AO, A height).
 *
 * The top left stone is orange (a flip shows), the mortar's height is 0 (its alpha in `albedoHeight`
 * and `albedoHeightAO`: a decode that premultiplied the alpha would turn the mortar black there).
 *
 * Three more sets in `LITE` only (p303 Phase 3's exit: a 4-set array against the 4 sets), each in
 * its own `source/<pattern>/` folder, 256² like the first so the four fit one array:
 *
 * - `bricks/` (`p303BrickSet`): a running bond of red bricks in grey mortar, the top left brick
 *   yellow.
 * - `ridges/` (`p303RidgeSet`): green diagonal ridges, a white square at the top left.
 * - `dots/` (`p303DotSet`): dark round bumps in staggered rows on sand, the top left one blue.
 *
 * Deterministic (its own seeded generator), written into the scene's `source/` folder and committed
 * with the texture JSONs. Images are top row first, as a PNG is; normal maps are OpenGL's (green
 * up), as three reads them.
 *
 * Usage: `npx tsx devTools/assetPipeline/fixtures/textureSetsFiles.ts`
 */

const OUT_DIR = path.join(SRC_DIR, 'app', 'scenes', 'textureSets', 'source');
const SIZE = 256;
const STONES = 4;
const CELL = SIZE / STONES;
/** The mortar's half width in px: each stone is a rounded square inside its cell */
const MORTAR = 5;

type Plane = Float32Array;

/** mulberry32: the same numbers on every machine */
const createRandom = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const createPlane = () => new Float32Array(SIZE * SIZE);

/** A stone's dome at a pixel: 0 in the mortar, rising to 1 at the stone's centre; its cell */
const getStone = (x: number, y: number) => {
  const cx = Math.floor(x / CELL);
  const cy = Math.floor(y / CELL);
  // Distance to the cell's edge, rounded at the corners
  const half = CELL / 2 - MORTAR;
  const dx = Math.max(0, Math.abs((x % CELL) + 0.5 - CELL / 2) - (half - 8));
  const dy = Math.max(0, Math.abs((y % CELL) + 0.5 - CELL / 2) - (half - 8));
  const inside = 1 - Math.hypot(dx, dy) / 8;
  return { dome: Math.max(0, Math.min(1, inside * 1.5)) ** 0.6, index: cy * STONES + cx };
};

/** A tangent-space normal map (OpenGL, green up) from a height plane, wrapped at the edges */
const toNormal = (height: Plane, strength: number): Plane[] => {
  const h = (x: number, y: number) => height[((y + SIZE) % SIZE) * SIZE + ((x + SIZE) % SIZE)];
  const planes = [createPlane(), createPlane(), createPlane()];
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

const toSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

/** Writes planes (0-1) as a 3- or 4-channel PNG; `srgb` names the channels to sRGB-encode */
const writePng = async (name: string, planes: Plane[], srgb: number[] = []) => {
  const channels = planes.length as 3 | 4;
  const data = Buffer.alloc(SIZE * SIZE * channels);
  for (let i = 0; i < SIZE * SIZE; i++) {
    for (let c = 0; c < channels; c++) {
      const v = Math.min(1, Math.max(0, planes[c][i]));
      data[i * channels + c] = Math.round((srgb.includes(c) ? toSrgb(v) : v) * 255);
    }
  }
  const file = path.join(OUT_DIR, `${name}.png`);
  await sharp(data, { raw: { width: SIZE, height: SIZE, channels } })
    .png({ compressionLevel: 9 })
    .toFile(file);
  console.log(`  ${path.relative(SRC_DIR, file)} (${fs.statSync(file).size} B)`);
};

const writeSet = async () => {
  const random = createRandom(303);
  const shades = Array.from({ length: STONES * STONES }, () => 0.75 + random() * 0.5);
  const grain = Float32Array.from({ length: SIZE * SIZE }, () => random());
  const albedo = [createPlane(), createPlane(), createPlane()];
  const height = createPlane();
  const ao = createPlane();
  const roughness = createPlane();
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = y * SIZE + x;
      const { dome, index } = getStone(x, y);
      const g = 0.92 + grain[i] * 0.16;
      // Linear albedo: blue-grey stones, the top left one orange, light mortar
      const stone =
        index === 0 ? [0.8, 0.3, 0.05] : [0.3, 0.33, 0.38].map((c) => c * shades[index]);
      const mortar = [0.55, 0.52, 0.47];
      const t = Math.min(1, dome * 4);
      for (let c = 0; c < 3; c++) albedo[c][i] = (mortar[c] * (1 - t) + stone[c] * t) * g;
      height[i] = dome;
      // The mortar and the stones' feet are occluded
      ao[i] = 0.45 + 0.55 * Math.min(1, dome * 2.5);
      roughness[i] = 0.95 - 0.5 * t + grain[i] * 0.05;
    }
  }
  const normal = toNormal(height, 6);
  const albedoAo = albedo.map((plane) => plane.map((v, i) => v * ao[i]));
  const metalness = createPlane();

  await writePng('albedoHeight', [...albedo, height], [0, 1, 2]);
  await writePng('normal', normal);
  await writePng('orm', [ao, roughness, metalness]);
  await writePng('albedoRough', [...albedoAo, roughness], [0, 1, 2]);
  await writePng('normalHeight', [normal[0], normal[1], height]);
  await writePng('albedoHeightAO', [...albedoAo, height], [0, 1, 2]);
};

/** One texel of a `LITE`-only set: height 0-1, linear albedo, roughness and AO */
type LiteTexel = { height: number; albedo: number[]; roughness: number; ao: number };

/** A wrapped coordinate, 0 to `period` */
const wrap = (v: number, period: number) => ((v % period) + period) % period;

/** 0 at a cell's edge, rising to 1 at `bevel` px inside it: a flat top with bevelled sides */
const bevelled = (fromEdge: number, bevel: number) =>
  Math.max(0, Math.min(1, fromEdge / bevel)) ** 0.7;

/** A running bond: 8 rows of 32 px, bricks 64 px long, every other row shifted half a brick */
const brickTexel = (x: number, y: number, grain: number): LiteTexel => {
  const row = Math.floor(y / 32);
  const shifted = wrap(x + (row % 2) * 32, SIZE);
  const brick = Math.floor(shifted / 64);
  const fromEdge = Math.min(shifted % 64, 63 - (shifted % 64), y % 32, 31 - (y % 32)) - 2;
  const height = bevelled(fromEdge, 5);
  const t = Math.min(1, height * 3);
  const shade = 0.8 + 0.4 * (((row * 5 + brick * 3) % 7) / 6);
  const stone =
    row === 0 && brick === 0 ? [0.8, 0.6, 0.1] : [0.45, 0.12, 0.06].map((c) => c * shade);
  const mortar = [0.42, 0.42, 0.4];
  const g = 0.9 + grain * 0.2;
  return {
    height,
    albedo: [0, 1, 2].map((c) => (mortar[c] * (1 - t) + stone[c] * t) * g),
    roughness: 0.9 - 0.2 * t + grain * 0.05,
    ao: 0.5 + 0.5 * Math.min(1, height * 2),
  };
};

/** Diagonal ridges, 4 across the tile and 8 down it (so they wrap), a white square at the top left */
const ridgeTexel = (x: number, y: number, grain: number): LiteTexel => {
  const height = 0.5 + 0.5 * Math.sin((2 * Math.PI * 4 * (x + 2 * y)) / SIZE);
  const isMarker = x < 24 && y < 24;
  const albedo = isMarker
    ? [0.85, 0.85, 0.85]
    : [0.12 + 0.18 * height, 0.3 + 0.2 * height, 0.08 + 0.1 * height];
  return {
    height,
    albedo: albedo.map((c) => c * (0.94 + grain * 0.12)),
    roughness: 0.6 + 0.3 * (1 - height),
    ao: 0.6 + 0.4 * height,
  };
};

/** 8 rows of 8 round bumps, 32 px apart, every other row shifted 16 px; the top left one blue */
const dotTexel = (x: number, y: number, grain: number): LiteTexel => {
  const row = Math.floor(y / 32);
  const shifted = wrap(x + (row % 2) * 16, SIZE);
  const col = Math.floor(shifted / 32);
  const r = Math.hypot((shifted % 32) + 0.5 - 16, (y % 32) + 0.5 - 16);
  const height = Math.max(0, 1 - (r / 12) ** 2) ** 0.5;
  const t = Math.min(1, height * 4);
  const dot = row === 0 && col === 0 ? [0.1, 0.2, 0.7] : [0.3, 0.26, 0.22];
  const sand = [0.62, 0.5, 0.3];
  return {
    height,
    albedo: [0, 1, 2].map((c) => (sand[c] * (1 - t) + dot[c] * t) * (0.9 + grain * 0.2)),
    roughness: 0.9 - 0.5 * t,
    ao: 0.55 + 0.45 * Math.min(1, height * 3 + (1 - t)),
  };
};

/** Writes a `LITE`-only set into `source/<dir>/`: `albedoRough` and `normalHeight` */
const writeLiteSet = async (
  dir: string,
  seed: number,
  texel: (x: number, y: number, grain: number) => LiteTexel
) => {
  fs.mkdirSync(path.join(OUT_DIR, dir), { recursive: true });
  const random = createRandom(seed);
  const albedoAo = [createPlane(), createPlane(), createPlane()];
  const height = createPlane();
  const roughness = createPlane();
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = y * SIZE + x;
      const t = texel(x, y, random());
      for (let c = 0; c < 3; c++) albedoAo[c][i] = t.albedo[c] * t.ao;
      height[i] = t.height;
      roughness[i] = t.roughness;
    }
  }
  const normal = toNormal(height, 6);
  await writePng(`${dir}/albedoRough`, [...albedoAo, roughness], [0, 1, 2]);
  await writePng(`${dir}/normalHeight`, [normal[0], normal[1], height]);
};

const main = async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`Writing the p303TestSet maps (${SIZE}²):`);
  await writeSet();
  console.log('Writing the LITE-only sets (p303BrickSet, p303RidgeSet, p303DotSet):');
  await writeLiteSet('bricks', 304, brickTexel);
  await writeLiteSet('ridges', 305, ridgeTexel);
  await writeLiteSet('dots', 306, dotTexel);
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}
