import { describe, expect, it } from 'vitest';
import { evaluateGradient, getGradientCss, readHexColor, type GradientColor } from './Gradient';

/** The channels in bytes, to a thousandth (off the float noise) */
const rgba = (color: GradientColor) =>
  [color.r, color.g, color.b, color.a].map((c) => Math.round(c * 255 * 1e3) / 1e3);

describe('evaluateGradient (p804 D8)', () => {
  const ramp = {
    stops: [
      { t: 0, color: '#000000' },
      { t: 0.5, color: '#ff0000' },
      { t: 1, color: '#ffffff' },
    ],
  };

  it('mixes the stops on either side in sRGB, the ends their colours', () => {
    expect(rgba(evaluateGradient(ramp, 0))).toEqual([0, 0, 0, 255]);
    expect(rgba(evaluateGradient(ramp, 0.25))).toEqual([127.5, 0, 0, 255]);
    expect(rgba(evaluateGradient(ramp, 0.5))).toEqual([255, 0, 0, 255]);
    expect(rgba(evaluateGradient(ramp, 0.75))).toEqual([255, 127.5, 127.5, 255]);
    // Clamped to 0-1
    expect(rgba(evaluateGradient(ramp, 2))).toEqual([255, 255, 255, 255]);
    expect(rgba(evaluateGradient(ramp, Number.NaN))).toEqual([0, 0, 0, 255]);
  });

  it('takes the stops in any order; before the first and after the last, their colours', () => {
    const shuffled = {
      stops: [
        { t: 0.8, color: '#00ff00' },
        { t: 0.2, color: '#0000ff' },
      ],
    };
    expect(rgba(evaluateGradient(shuffled, 0.1))).toEqual([0, 0, 255, 255]);
    expect(rgba(evaluateGradient(shuffled, 0.5))).toEqual([0, 127.5, 127.5, 255]);
    expect(rgba(evaluateGradient(shuffled, 0.9))).toEqual([0, 255, 0, 255]);
  });

  it('two stops at one place are a hard edge, the later one’s colour at it (CSS’s)', () => {
    const edge = {
      stops: [
        { t: 0, color: '#000000' },
        { t: 0.5, color: '#ff0000' },
        { t: 0.5, color: '#0000ff' },
        { t: 1, color: '#ffffff' },
      ],
    };
    expect(rgba(evaluateGradient(edge, 0.5))).toEqual([0, 0, 255, 255]);
    expect(evaluateGradient(edge, 0.499).r).toBeGreaterThan(0.99);
    expect(evaluateGradient(edge, 0.501).b).toBeGreaterThan(0.99);
  });

  it('mixes alpha premultiplied: a transparent stop doesn’t tint its neighbour', () => {
    const fade = {
      stops: [
        { t: 0, color: '#ff000000' },
        { t: 1, color: '#0000ffff' },
      ],
    };
    // Still pure blue at half alpha (straight sRGB would give purple)
    expect(rgba(evaluateGradient(fade, 0.5))).toEqual([0, 0, 255, 127.5]);
  });

  it('writes into `out` and returns it; no stops is transparent, one its colour', () => {
    const out = { r: 1, g: 1, b: 1, a: 1 };
    expect(evaluateGradient(ramp, 0.5, out)).toBe(out);
    expect(rgba(evaluateGradient({ stops: [] }, 0.5, out))).toEqual([0, 0, 0, 0]);
    expect(rgba(evaluateGradient({ stops: [{ t: 0.3, color: '#08f' }] }, 0.9))).toEqual([
      0, 136, 255, 255,
    ]);
  });

  it('reads hex in its four lengths; anything else is opaque black', () => {
    const out = { r: 0, g: 0, b: 0, a: 0 };
    expect(readHexColor('#3fd8f2', out)).toBe(true);
    expect(rgba(out)).toEqual([63, 216, 242, 255]);
    expect(readHexColor('#3fd8f280', out)).toBe(true);
    expect(rgba(out)).toEqual([63, 216, 242, 128]);
    expect(readHexColor('#F0A8', out)).toBe(true);
    expect(rgba(out)).toEqual([255, 0, 170, 136]);
    for (const text of ['red', '#12345', '#ggg', 'rgb(1, 2, 3)']) {
      expect(readHexColor(text, out)).toBe(false);
      expect(rgba(out)).toEqual([0, 0, 0, 255]);
    }
  });

  it('its CSS has the stops in place order, a tie in the array’s', () => {
    expect(
      getGradientCss({
        stops: [
          { t: 1, color: '#fff' },
          { t: 0.5, color: '#f00' },
          { t: 0.5, color: '#00f' },
          { t: 0, color: '#000' },
        ],
      })
    ).toBe('linear-gradient(to right, #000 0%, #f00 50%, #00f 50%, #fff 100%)');
    expect(getGradientCss({ stops: [] })).toBe('none');
  });
});
