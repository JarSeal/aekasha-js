import { describe, expect, test } from 'vitest';
import { toSkyColor } from './SkyColor';

describe('toSkyColor', () => {
  test.each([
    ['#ff8000', { r: 255, g: 128, b: 0 }],
    ['#3b3a36', { r: 59, g: 58, b: 54 }],
    ['#000005', { r: 0, g: 0, b: 5 }],
  ])('reads %s and its { r, g, b } as the same colour', (hex, rgb) => {
    const fromHex = toSkyColor(hex);
    const fromRgb = toSkyColor(rgb);
    expect(fromRgb.r).toBeCloseTo(fromHex.r, 6);
    expect(fromRgb.g).toBeCloseTo(fromHex.g, 6);
    expect(fromRgb.b).toBeCloseTo(fromHex.b, 6);
    expect(`#${fromRgb.getHexString()}`).toBe(hex);
  });

  test('gives a linear colour: mid grey (sRGB 128) is about 0.216', () => {
    expect(toSkyColor({ r: 128, g: 128, b: 128 }).r).toBeCloseTo(0.2159, 4);
    expect(toSkyColor('#808080').r).toBeCloseTo(0.2159, 4);
  });
});
