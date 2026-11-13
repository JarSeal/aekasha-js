import { describe, expect, it } from 'vitest';
import { createImage } from './images';
import { getAverageColor } from './textures';

// p303 D1: an sRGB texture's average colour, recorded at the encode (linear, 4 decimals)

describe('getAverageColor', () => {
  it('averages the RGB of a linear image, alpha left out, to 4 decimals', () => {
    const img = createImage(2, 1, 4);
    img.data.set([0.2, 0.4, 0.6, 0, 0.3, 0.1, 0.0, 1]);
    expect(getAverageColor(img)).toEqual([0.25, 0.25, 0.3]);
    const third = createImage(3, 1, 3);
    third.data.set([1, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(getAverageColor(third)).toEqual([0.3333, 0, 0]);
  });

  it("takes a one-channel image's grey for each of RGB", () => {
    const grey = createImage(2, 1, 1);
    grey.data.set([0.2, 0.6]);
    expect(getAverageColor(grey)).toEqual([0.4, 0.4, 0.4]);
  });
});
