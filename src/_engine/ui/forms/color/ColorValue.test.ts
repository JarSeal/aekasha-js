import { Color } from 'three';
import { LinearToSRGB, SRGBToLinear } from 'three/src/math/ColorManagement.js';
import { describe, expect, it } from 'vitest';
import {
  COLOR_TEXT_ERROR,
  createColorCodec,
  formatColorHex,
  getColorForm,
  isColorObject,
  isColorString,
  linearToSrgb,
  parseColorText,
  srgbToLinear,
  type Rgba,
} from './ColorValue';

const rgba = (r: number, g: number, b: number, a = 1): Rgba => ({ r, g, b, a });
const blank = () => rgba(0, 0, 0);

/** A parse's value, each channel rounded to a byte's worth (the comparisons' precision) */
const parsed = (text: string) => {
  const { value, error } = parseColorText(text);
  if (!value) throw new Error(`${text}: ${error}`);
  return [value.r, value.g, value.b, value.a].map((c) => Math.round(c * 255));
};

describe('the sRGB curve (p804 D8: the kit’s own, three’s)', () => {
  it('matches three’s both ways across the range', () => {
    for (let i = 0; i <= 1000; i++) {
      const c = i / 1000;
      expect(srgbToLinear(c)).toBe(SRGBToLinear(c));
      expect(linearToSrgb(c)).toBe(LinearToSRGB(c));
    }
  });

  it('a linear object reads and writes as a THREE.Color does', () => {
    const codec = createColorCodec('float', { space: 'linear' });
    // three keeps a colour linear, its hex sRGB
    const color = new Color().setHex(0x3fd8f2);
    expect(formatColorHex(codec.read(color, blank()))).toBe('#3fd8f2');
    const written = codec.write(parseColorText('#3fd8f2').value!) as Rgba;
    expect(written.r).toBeCloseTo(color.r, 10);
    expect(new Color(written.r, written.g, written.b).getHex()).toBe(0x3fd8f2);
  });
});

describe('the forms (p804 D8)', () => {
  it('tells a value’s form, and what a property grid infers a colour from', () => {
    expect(getColorForm(0xff0000)).toBe('number');
    expect(getColorForm('#ff0000')).toBe('hex');
    expect(getColorForm({ r: 1, g: 0, b: 0 })).toBe('float');
    expect(getColorForm(new Color())).toBe('float');
    expect(getColorForm({ x: 1, y: 2 })).toBe(null);
    expect(getColorForm(true)).toBe(null);
    for (const text of ['#fff', '#ffff', '#3fd8f2', '#3FD8F280'])
      expect(isColorString(text)).toBe(true);
    for (const text of ['fff', '#ff', '#3fd8f', 'red', 'rgb(1, 2, 3)', '#tag']) {
      expect(isColorString(text)).toBe(false);
    }
    expect(isColorObject({ r: 0.1, g: 0.2, b: 0.3, a: 0.5 })).toBe(true);
    expect(isColorObject({ r: 0.1, g: 0.2 })).toBe(false);
    expect(isColorObject({ r: 0.1, g: 0.2, b: 0.3, a: '1' })).toBe(false);
  });

  it('a 24-bit number: read as sRGB bytes, written rounded, no alpha', () => {
    const codec = createColorCodec('number', { alpha: true });
    expect(codec.hasAlpha).toBe(false);
    expect(formatColorHex(codec.read(0x3fd8f2, blank()))).toBe('#3fd8f2');
    expect(codec.write(rgba(1, 0.5, 0, 0.2))).toBe(0xff8000);
    expect(codec.withAlpha(0x3fd8f2, 0.5)).toBe(0x3fd8f2);
  });

  it('a hex string: written as #rrggbb, with alpha digits when the field edits them or had them', () => {
    const plain = createColorCodec('hex', { first: '#abc' });
    expect(formatColorHex(plain.read('#abc', blank()))).toBe('#aabbcc');
    expect(plain.write(rgba(1, 0, 0, 0.5))).toBe('#ff0000');
    expect(plain.hasAlpha).toBe(false);
    const withDigits = createColorCodec('hex', { first: '#ff000080' });
    expect(withDigits.hasAlpha).toBe(true);
    expect(withDigits.keys).toEqual(['r', 'g', 'b', 'a']);
    expect(withDigits.read('#ff000080', blank()).a).toBeCloseTo(128 / 255);
    expect(withDigits.write(rgba(0, 1, 0, 0.25))).toBe('#00ff0040');
    expect(withDigits.withAlpha('#3fd8f2ff', 0)).toBe('#3fd8f200');
    const edited = createColorCodec('hex', { alpha: true, first: '#3fd8f2' });
    expect(edited.write(rgba(0, 0, 1))).toBe('#0000ffff');
    // Any other colour text bound reads, and is written back as hex
    expect(formatColorHex(plain.read('rgb(255 0 0)', blank()))).toBe('#ff0000');
  });

  it('a float object: its keys, its space, alpha in place', () => {
    const srgb = createColorCodec('float');
    expect(srgb.keys).toEqual(['r', 'g', 'b']);
    expect(srgb.write(rgba(0.2, 0.4, 0.6, 0.5))).toEqual({ r: 0.2, g: 0.4, b: 0.6 });
    const withAlpha = createColorCodec('float', { alpha: true });
    expect(withAlpha.write(rgba(0.2, 0.4, 0.6, 0.5))).toEqual({ r: 0.2, g: 0.4, b: 0.6, a: 0.5 });
    const linear = createColorCodec('float', { space: 'linear', alpha: true });
    const value = { r: 0.5, g: 0.25, b: 2, a: 1 };
    // The channels as they are: no round trip through sRGB, an HDR value over 1 kept
    expect(linear.withAlpha(value, 0.3)).toEqual({ r: 0.5, g: 0.25, b: 2, a: 0.3 });
    const read = linear.read(value, blank());
    expect(read.r).toBe(LinearToSRGB(0.5));
    expect(read.b).toBeGreaterThan(1);
    // Clamped to a byte in the text only
    expect(formatColorHex(read).slice(5)).toBe('ff');
  });
});

describe('typed and pasted text (p804 D8)', () => {
  it('reads hex in its forms', () => {
    expect(parsed('#3fd8f2')).toEqual([63, 216, 242, 255]);
    expect(parsed('  #3FD8F2 ')).toEqual([63, 216, 242, 255]);
    expect(parsed('#fff')).toEqual([255, 255, 255, 255]);
    expect(parsed('#f008')).toEqual([255, 0, 0, 136]);
    expect(parsed('#3fd8f280')).toEqual([63, 216, 242, 128]);
    expect(parsed('0x3fd8f2')).toEqual([63, 216, 242, 255]);
    expect(parsed('3fd8f2')).toEqual([63, 216, 242, 255]);
    expect(parseColorText('#3fd8f').error).toBe(COLOR_TEXT_ERROR);
    expect(parseColorText('#ggg').error).toBe(COLOR_TEXT_ERROR);
  });

  it('reads rgb() and hsl() in CSS’s comma and space forms, clamped', () => {
    expect(parsed('rgb(255, 128, 0)')).toEqual([255, 128, 0, 255]);
    expect(parsed('rgba(255,128,0,0.5)')).toEqual([255, 128, 0, 128]);
    expect(parsed('rgb(100% 50% 0% / 25%)')).toEqual([255, 128, 0, 64]);
    expect(parsed('rgb(300 -20 0)')).toEqual([255, 0, 0, 255]);
    expect(parsed('hsl(0, 100%, 50%)')).toEqual([255, 0, 0, 255]);
    expect(parsed('hsl(120deg 100% 25%)')).toEqual([0, 128, 0, 255]);
    expect(parsed('hsl(0.5turn 100 50 / 0.5)')).toEqual([0, 255, 255, 128]);
    expect(parsed('hsla(-120, 100%, 50%, 1)')).toEqual([0, 0, 255, 255]);
    for (const text of [
      'rgb(1, 2)',
      'rgb(1 2 3 / )',
      'hsl(red, 1, 1)',
      'rgb(a, b, c)',
      'rgb(1/2/3)',
    ]) {
      expect(parseColorText(text).error).toBe(COLOR_TEXT_ERROR);
    }
  });

  it('reads three or four numbers 0-1 (the float form), and refuses others', () => {
    expect(parseColorText('0.2, 0.8, 0.9').value).toEqual(rgba(0.2, 0.8, 0.9));
    expect(parseColorText('1 0 0 0.5').value).toEqual(rgba(1, 0, 0, 0.5));
    expect(parseColorText('255, 0, 0').error).toMatch(/0-1/);
    // Digits alone at 3 aren't hex: they're too few numbers
    expect(parseColorText('100').error).toBe(COLOR_TEXT_ERROR);
    expect(parseColorText('red').error).toBe(COLOR_TEXT_ERROR);
    expect(parseColorText('').error).toBe(COLOR_TEXT_ERROR);
  });

  it('formats lower case, clamped, alpha only when asked', () => {
    expect(formatColorHex(rgba(1, 0.5, 0, 0.5))).toBe('#ff8000');
    expect(formatColorHex(rgba(1, 0.5, 0, 0.5), true)).toBe('#ff800080');
    expect(formatColorHex(rgba(2, -1, 0.999))).toBe('#ff00ff');
  });
});
