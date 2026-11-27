import fs from 'node:fs';
import path from 'node:path';
import * as fontkit from 'fontkit';
import type { Font } from 'fontkit';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../../paths';
import { getFontKerning, getFontMetrics, getVariableFontError, openFont } from './fontFile';

// p391 Phase 2 section 3: fontkit's side (D1): the refusals, the metrics and the kerning of the
// fixture (IBM Plex Sans Medium, its static WOFF)

const FIXTURE = path.join(ROOT, 'devTools/assetPipeline/fonts/fixtures/IBMPlexSans-Medium.woff');
/** The UI kit's IBM Plex Sans: a variable WOFF2 (a `wght` axis) */
const VARIABLE_WOFF2 = path.join(
  ROOT,
  'src/_engine/ui/fonts/ibm-plex-sans-latin-wght-normal.woff2'
);

const readBytes = (file: string) => new Uint8Array(fs.readFileSync(file));
const font = openFont(readBytes(FIXTURE));

describe('openFont', () => {
  it('reads a static WOFF', () => {
    expect(font.unitsPerEm).toBe(1000);
    expect(font.hasGlyphForCodePoint(0x41)).toBe(true);
  });

  it('refuses a WOFF2, naming the formats it reads', () => {
    expect(() => openFont(readBytes(VARIABLE_WOFF2))).toThrow(
      /^it's a WOFF2 file, which the encoder can't read: use a static TTF, OTF or WOFF/
    );
  });

  it('refuses a font collection by its signature', () => {
    const ttc = new Uint8Array(64);
    ttc.set([0x74, 0x74, 0x63, 0x66]); // 'ttcf'
    expect(() => openFont(ttc)).toThrow(/font collection \(TTC \/ OTC\)/);
  });

  it('names fontkit’s reason for a file it can’t read', () => {
    expect(() => openFont(new Uint8Array(64))).toThrow(/^fontkit can't read it: /);
  });
});

describe('getVariableFontError', () => {
  it('names a variable font’s axes, and passes a static one', () => {
    // fontkit reads the WOFF2 the encoder refuses, so the check is tried on it directly
    const variable = fontkit.create(fs.readFileSync(VARIABLE_WOFF2)) as Font;
    expect(getVariableFontError(variable)).toMatch(
      /^it's a variable font \(its axes: wght\), and the encoder draws only static ones/
    );
    expect(getVariableFontError(font)).toBeNull();
  });
});

describe('getFontMetrics', () => {
  it('gives hhea’s metrics and the underline’s centre in em', () => {
    const metrics = getFontMetrics(font);
    expect(metrics).toEqual({
      ascender: 1.025,
      descender: -0.275,
      lineHeight: 1.3,
      underlineY: expect.closeTo(-0.1215, 6),
      underlineThickness: 0.077,
    });
  });
});

describe('getFontKerning', () => {
  const codePoints = [...'AV",fiT.'].map((character) => character.codePointAt(0) as number);
  const kerning = getFontKerning(font, codePoints);
  const amount = (pair: string) => {
    const [first, second] = [...pair].map((character) => character.codePointAt(0));
    return kerning.get(first as number)?.find(([cp]) => cp === second)?.[1];
  };

  it('reads the GPOS pairs in font units, the first glyph’s advance change', () => {
    expect(amount('AV')).toBe(-47);
    expect(amount('A"')).toBe(-50);
    expect(amount('A,')).toBe(17);
    expect(amount('T.')).toBeLessThan(0);
  });

  it('lists no pair without kerning, and keeps "fi" two glyphs (no ligature)', () => {
    expect(amount('AA')).toBe(13);
    let listed = 0;
    for (const pairs of kerning.values()) listed += pairs.length;
    expect(listed).toBeGreaterThan(0);
    expect(listed).toBeLessThan(codePoints.length ** 2);
    for (const pairs of kerning.values()) for (const [, value] of pairs) expect(value).not.toBe(0);
    const run = font.layout('fi', { liga: false, clig: false, dlig: false, calt: false });
    expect(run.glyphs).toHaveLength(2);
  });
});
