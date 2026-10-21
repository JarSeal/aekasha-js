import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import { measureAlphaCoverage, scaleAlphaForCoverage } from './alphaCoverage';
import { PIPELINE_VERSION } from './cache';
import { createImage, getNextMipLevel, resizeImage, type Img } from './images';
import { buildPackedImage } from './pack';

// p619 D14: the packer and the alpha coverage on synthetic images, and a golden hash over the
// pipeline's own image maths (resize, mip levels, alpha coverage), which decide the KTX2's
// bytes: when it changes, every output changes, so PIPELINE_VERSION (and ALPHA_COVERAGE_VERSION
// for the coverage) must be bumped with the hash. Sharp's decode isn't in it: its bytes differ
// across machines (§1.4 A10).

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aek-images-'));
afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

/** A deterministic test image: each channel a different gradient, alpha a disc */
const makeImage = (width: number, height: number, channels: number): Img => {
  const img = createImage(width, height, channels);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * channels;
      const values = [
        x / (width - 1),
        y / (height - 1),
        ((x * 7 + y * 13) % 17) / 16,
        Math.hypot(x - width / 2, y - height / 2) < width / 3 ? 0.9 : 0.1,
      ];
      for (let c = 0; c < channels; c++) img.data[o + c] = values[c];
    }
  }
  return img;
};

/** An 8-bit PNG of raw channel bytes */
const writePng = async (name: string, width: number, height: number, bytes: number[]) => {
  const file = path.join(TMP, name);
  const channels = bytes.length / (width * height);
  await sharp(Buffer.from(bytes), { raw: { width, height, channels: channels as 1 | 3 | 4 } })
    .png()
    .toFile(file);
  return file;
};

describe('buildPackedImage', () => {
  it('takes channels from sources, inverts, remaps, multiplies and fills constants', async () => {
    // 2×1: a.png red 0 and 255, b.png grey 51 and 102 (0.2, 0.4)
    await writePng('a.png', 2, 1, [0, 0, 0, 255, 0, 0]);
    await writePng('b.png', 2, 1, [51, 102]);
    const image = await buildPackedImage(
      {
        channels: {
          r: { src: 'a.png', channel: 'r', invert: true },
          g: { src: 'b.png', channel: 'r', remap: 'auto' },
          b: { src: 'b.png', channel: 'r', multiply: 0.5 },
          a: 0.25,
        },
      },
      { resolveFile: (src) => path.join(TMP, src), isSrgb: false }
    );
    expect([image.width, image.height, image.channels]).toEqual([2, 1, 4]);
    const texels = [...image.data].map((v) => Math.round(v * 1000) / 1000);
    expect(texels).toEqual([1, 0, 0.1, 0.25, 0, 1, 0.2, 0.25]);
  });

  it('refuses sources of different sizes without a size', async () => {
    await writePng('c.png', 1, 1, [0]);
    await expect(
      buildPackedImage(
        { channels: { r: { src: 'a.png' }, g: { src: 'c.png', channel: 'r' } } },
        { resolveFile: (src) => path.join(TMP, src), isSrgb: false }
      )
    ).rejects.toThrow(/the pack sources differ in size/);
  });
});

describe('the alpha coverage', () => {
  it('scales a level’s alpha back to level 0’s coverage', () => {
    const level0 = makeImage(32, 32, 4);
    const cut = 0.5;
    const target = measureAlphaCoverage(level0, cut);
    // A blurred level loses coverage at the cut; the scaled one gets it back
    const level2 = getNextMipLevel(getNextMipLevel(level0, false), false);
    for (let i = 0; i < level2.data.length; i += 4) level2.data[i + 3] *= 0.6;
    const before = measureAlphaCoverage(level2, cut);
    const { image, scales } = scaleAlphaForCoverage(level2, cut, [target]);
    expect(before).toBeLessThan(target - 0.1);
    expect(scales[0]).toBeGreaterThan(1);
    expect(Math.abs(measureAlphaCoverage(image, cut) - target)).toBeLessThan(0.02);
  });

  it('leaves a region at its target as it is', () => {
    const img = makeImage(16, 16, 4);
    const { scales } = scaleAlphaForCoverage(img, 0.5, [measureAlphaCoverage(img, 0.5)]);
    expect(scales).toEqual([1]);
  });
});

describe('the golden hash (bump PIPELINE_VERSION with it)', () => {
  it('the resize, the mip chain and the coverage write the same floats', () => {
    const hash = createHash('sha256');
    const add = (img: Img) => hash.update(Buffer.from(img.data.buffer));
    const rgba = makeImage(40, 24, 4);
    add(resizeImage(rgba, 10, 6));
    add(resizeImage(rgba, 13, 7));
    add(resizeImage(makeImage(16, 16, 3), 8, 8, true));
    let level = rgba;
    while (level.width > 1 || level.height > 1) add((level = getNextMipLevel(level, false)));
    add(scaleAlphaForCoverage(getNextMipLevel(rgba, false), 0.5, [0.3]).image);
    expect({ PIPELINE_VERSION, hash: hash.digest('hex').slice(0, 16) }).toEqual({
      PIPELINE_VERSION: 1,
      hash: '3e99f25e98d269d3',
    });
  });
});
