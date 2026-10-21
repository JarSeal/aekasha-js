import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { HUB_CODE_PALETTES } from './codeThemes';
import { HUB_ASSETS_DIR } from './paths';

/**
 * The syntax themes' promise (`codeThemes.ts`): every colour passes WCAG AA (4.5) on its theme's
 * `--hub-code-bg` and on each line tint over it, as `_tokens.scss` defines them
 */

const TOKENS = fs.readFileSync(path.join(HUB_ASSETS_DIR, 'scss', '_tokens.scss'), 'utf-8');
const TINTS = ['highlight', 'add', 'remove', 'warning-bg'];

type Rgb = [number, number, number];

const hexToRgb = (hex: string): Rgb => {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};

const luminance = (rgb: Rgb) => {
  const [r, g, b] = rgb.map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** Each theme's code tokens in `_tokens.scss`: the dark block first, then the light one */
const readThemeTokens = () => {
  const blocks = TOKENS.split(/(?=--hub-code-bg:)/).slice(1);
  return blocks.map((block) => {
    const bg = /--hub-code-bg:\s*(#[0-9a-f]{6})/i.exec(block)?.[1] ?? '';
    const tints = TINTS.map((name) => {
      const match = new RegExp(
        `--hub-code-${name}:\\s*rgb\\((\\d+) (\\d+) (\\d+) / (\\d+)%\\)`
      ).exec(block);
      if (!match) throw new Error(`_tokens.scss: no --hub-code-${name} after ${bg}`);
      const [, r, g, b, alpha] = match.map(Number);
      return { name, rgb: [r, g, b] as Rgb, alpha: alpha / 100 };
    });
    return { bg, tints };
  });
};

const over = (tint: Rgb, alpha: number, bg: Rgb): Rgb =>
  tint.map((channel, i) => Math.round(channel * alpha + bg[i] * (1 - alpha))) as Rgb;

describe('the code themes', () => {
  const themes = readThemeTokens();

  it("use the stylesheet's code backgrounds", () => {
    expect(themes.map((theme) => theme.bg.toLowerCase())).toEqual([
      HUB_CODE_PALETTES.dark.bg,
      HUB_CODE_PALETTES.light.bg,
    ]);
  });

  it.each([
    ['dark', 0],
    ['light', 1],
  ] as const)('%s: every colour is AA on the background and on each line tint', (name, at) => {
    const { bg: _bg, ...colours } = HUB_CODE_PALETTES[name];
    const bg = hexToRgb(themes[at].bg);
    const backgrounds = [
      { name: 'background', rgb: bg },
      ...themes[at].tints.map((tint) => ({ name: tint.name, rgb: over(tint.rgb, tint.alpha, bg) })),
    ];
    const failures = Object.entries(colours).flatMap(([colour, hex]) =>
      backgrounds
        .map((back) => ({ colour, on: back.name, ratio: contrast(hexToRgb(hex), back.rgb) }))
        .filter(({ ratio }) => ratio < 4.5)
        .map(({ colour: c, on, ratio }) => `${c} on ${on}: ${ratio.toFixed(2)}`)
    );
    expect(failures).toEqual([]);
  });
});
