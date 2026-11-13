import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import { TextureAssetSchema, type TexturePack } from '../../src/_engine/schemas';
import { createImage, type Img } from './images';
import {
  applyCavity,
  blurWrapped,
  buildPackedImage,
  getPackKeyParams,
  PACK_CAVITY_VERSION,
} from './pack';

// p303 D2: the cavity term (an AO derived from height) of a pack channel or a multiply factor,
// its wrapping blur, its key version, and the schema's rules for it

const plane = (width: number, height: number, fill: (x: number, y: number) => number): Img => {
  const img = createImage(width, height, 1);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) img.data[y * width + x] = fill(x, y);
  return img;
};
const at = (img: Img, x: number, y: number) => img.data[y * img.width + x];
const sum = (img: Img) => img.data.reduce((total, v) => total + v, 0);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aek-pack-'));
afterAll(() => fs.rmSync(tempDir, { recursive: true, force: true }));

describe('blurWrapped', () => {
  it('spreads a pixel evenly across the edges, keeping the sum', () => {
    const dot = plane(16, 16, (x, y) => (x === 0 && y === 0 ? 1 : 0));
    const blurred = blurWrapped(dot, 2);
    expect(sum(blurred)).toBeCloseTo(1, 5);
    expect(at(blurred, 15, 0)).toBeCloseTo(at(blurred, 1, 0), 6);
    expect(at(blurred, 0, 15)).toBeCloseTo(at(blurred, 0, 1), 6);
    expect(at(blurred, 0, 0)).toBeGreaterThan(at(blurred, 2, 0));
    expect(at(blurred, 8, 8)).toBeLessThan(1e-3);
  });

  it('leaves an image alone at a radius below half a pixel', () => {
    const dot = plane(4, 4, (x) => x / 4);
    expect(blurWrapped(dot, 0.2).data).toEqual(dot.data);
  });
});

describe('applyCavity', () => {
  it('darkens a pit below its surroundings, never a flat or raised spot', () => {
    const pit = plane(32, 32, (x, y) => (Math.hypot(x - 16, y - 16) < 2 ? 0 : 1));
    applyCavity(pit, { radius: 3, strength: 4 });
    expect(at(pit, 16, 16)).toBeLessThan(0.5);
    expect(at(pit, 0, 0)).toBe(1);
    // A bump: the blur is below it, so no cavity
    const bump = plane(32, 32, (x, y) => (Math.hypot(x - 16, y - 16) < 2 ? 1 : 0));
    applyCavity(bump, { radius: 3, strength: 4 });
    expect(at(bump, 16, 16)).toBe(1);
  });

  it('normalizes the height first, clamps to 0..1, and is 1 everywhere at strength 0 or flat', () => {
    // A shallow pit (0.9 against 1): normalized, it's as deep as a full one
    const shallow = plane(32, 32, (x, y) => (Math.hypot(x - 16, y - 16) < 2 ? 0.9 : 1));
    const deep = plane(32, 32, (x, y) => (Math.hypot(x - 16, y - 16) < 2 ? 0 : 1));
    applyCavity(shallow, { radius: 3, strength: 4 });
    applyCavity(deep, { radius: 3, strength: 4 });
    expect(at(shallow, 16, 16)).toBeCloseTo(at(deep, 16, 16), 5);

    const strong = plane(32, 32, (x, y) => (Math.hypot(x - 16, y - 16) < 2 ? 0 : 1));
    applyCavity(strong, { radius: 3, strength: 100 });
    expect(at(strong, 16, 16)).toBe(0);
    const off = plane(32, 32, (x, y) => (Math.hypot(x - 16, y - 16) < 2 ? 0 : 1));
    applyCavity(off, { radius: 3, strength: 0 });
    expect(off.data.every((v) => v === 1)).toBe(true);
    const flat = plane(8, 8, () => 0.5);
    applyCavity(flat, {});
    expect(flat.data.every((v) => v === 1)).toBe(true);
  });
});

describe('a pack with a cavity', () => {
  const pack = (channels: TexturePack['channels']): TexturePack => ({ channels });

  it('has the cavity version in its key, and only then', () => {
    const plain = pack({ rgb: { src: './color.png' } });
    expect(getPackKeyParams(plain)).toEqual({ pack: plain });
    const multiplied = pack({
      rgb: { src: './color.png', multiply: { src: './height.png', cavity: {} } },
    });
    expect(getPackKeyParams(multiplied)).toEqual({ pack: multiplied, cavity: PACK_CAVITY_VERSION });
    const channel = pack({ r: { src: './height.png', cavity: { radius: 4 } } });
    expect(getPackKeyParams(channel)).toMatchObject({ cavity: PACK_CAVITY_VERSION });
  });

  it("darkens the albedo in a height map's pit, as a channel and as a multiply factor", async () => {
    const size = 32;
    const heights = Buffer.alloc(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++)
        heights[y * size + x] = Math.hypot(x - 16, y - 16) < 3 ? 0 : 255;
    }
    const heightFile = path.join(tempDir, 'height.png');
    const colorFile = path.join(tempDir, 'color.png');
    await sharp(heights, { raw: { width: size, height: size, channels: 1 } })
      .png()
      .toFile(heightFile);
    await sharp({ create: { width: size, height: size, channels: 3, background: '#ffffff' } })
      .png()
      .toFile(colorFile);
    const resolveFile = (src: string) => path.join(tempDir, src);
    const image = await buildPackedImage(
      pack({
        rgb: {
          src: 'color.png',
          multiply: { src: 'height.png', cavity: { radius: 3 }, strength: 1 },
        },
        a: { src: 'height.png', channel: 'r', cavity: { radius: 3 } },
      }),
      { resolveFile, isSrgb: true }
    );
    const pixel = (x: number, y: number) => [
      ...image.data.subarray((y * size + x) * 4, (y * size + x) * 4 + 4),
    ];
    const [r, g, b, a] = pixel(16, 16);
    expect(r).toBeLessThan(0.5);
    expect(g).toBe(r);
    expect(b).toBe(r);
    expect(a).toBeCloseTo(r, 5);
    expect(pixel(0, 0)).toEqual([1, 1, 1, 1]);
  });

  it('the schema takes a cavity on a channel and a factor, not on a normal map', () => {
    const texture = (channels: unknown) =>
      TextureAssetSchema.safeParse({ id: 't', pack: { channels } }).success;
    expect(texture({ r: { src: './h.png', cavity: {} } })).toBe(true);
    expect(
      texture({
        rgb: { src: './c.png', multiply: { src: './h.png', cavity: { radius: 24, strength: 4 } } },
      })
    ).toBe(true);
    expect(texture({ rgb: { src: './n.png', normal: true, cavity: {} } })).toBe(false);
    expect(texture({ r: { src: './h.png', cavity: { radius: 0 } } })).toBe(false);
    expect(texture({ r: { src: './h.png', cavity: { size: 4 } } })).toBe(false);
  });
});
