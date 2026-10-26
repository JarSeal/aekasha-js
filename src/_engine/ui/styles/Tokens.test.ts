import fs from 'fs';
import { describe, expect, it } from 'vitest';
import {
  CONTRAST_CHECKED,
  CONTRAST_UNCHECKED,
  findTokenRules,
  listContrastPairs,
  parseTokenSheet,
  type TokenRule,
} from './TokenSheet';

// tokens.css' structure and the contrast rule (p800 D6, p801 D6): WCAG 2.2 AA in both themes. The
// parser and the pairs are TokenSheet.ts', which the Hub's design document renders (p802 D8).
// Read from disk: Vitest turns a CSS import into an empty string, `?raw` included.
const tokensCss = fs.readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

const sheet = parseTokenSheet(tokensCss);
// The fonts' opt-in (p801 D8) re-declares the font tokens
const fontsSheet = parseTokenSheet(
  fs.readFileSync(new URL('../fonts/fonts.css', import.meta.url), 'utf8')
);

const TOKENS_LAYER = '@layer aek.tokens';

const { kitRoot, dark, lightSystem, lightForced, compact } = findTokenRules(sheet);
const themes = { dark, lightSystem, lightForced };

/** Every pair below its minimum, as `fg on bg: ratio < minimum` */
const findContrastFailures = (decls: Map<string, string>) =>
  listContrastPairs(decls)
    .filter(({ ratio, min }) => ratio < min)
    .map(({ fg, bg, ratio, min }) => `${fg} on ${bg}: ${ratio.toFixed(2)} < ${min}`);

describe('tokens.css', () => {
  it('declares the layer order first', () => {
    expect(sheet.statements[0]).toBe(
      '@layer aek.page, aek.tokens, aek.base, aek.components, aek.utilities'
    );
  });

  it('registers each @property once, with a fixed fallback on the kit root', () => {
    expect(sheet.properties).toEqual([...new Set(sheet.properties)]);
    expect([...sheet.properties].sort()).toEqual(['--aek-base', '--aek-rem']);
    // Without @property an em would resolve again in every descendant: the default is pixels, and
    // the computed value is only where @property is (tokens.css says why)
    for (const name of sheet.properties) {
      expect(kitRoot.decls.get(name), name).toMatch(/^calc\(\d+px \* var\(--aek-ui-scale, 1\)\)$/);
      const computed = sheet.rules.filter(
        (r) => r.decls.has(name) && r.context.some((c) => c.startsWith('@supports'))
      );
      expect(computed, name).toHaveLength(1);
    }
  });

  it('defines the same tokens in both themes, and the light copies match', () => {
    const names = (rule: TokenRule) => [...rule.decls.keys()].sort();
    expect(names(themes.lightSystem)).toEqual(names(themes.dark));
    expect(Object.fromEntries(themes.lightForced.decls)).toEqual(
      Object.fromEntries(themes.lightSystem.decls)
    );
  });

  it("sets each theme block's color-scheme to its theme (p803 D5)", () => {
    expect(themes.dark.decls.get('color-scheme')).toBe('dark');
    expect(themes.lightSystem.decls.get('color-scheme')).toBe('light');
    expect(themes.lightForced.decls.get('color-scheme')).toBe('light');
  });

  it('has a contrast rule or a reason for every theme token', () => {
    const roles = [...themes.dark.decls.keys()]
      .filter((name) => name.startsWith('--aek-'))
      .map((name) => name.replace(/^--aek-/, ''));
    const unlisted = roles.filter(
      (role) => !CONTRAST_CHECKED.has(role) && !(role in CONTRAST_UNCHECKED)
    );
    expect(unlisted).toEqual([]);
    expect([...CONTRAST_CHECKED].filter((role) => !roles.includes(role))).toEqual([]);
  });

  it.each([
    ['dark', themes.dark],
    ['light', themes.lightSystem],
  ])('meets WCAG AA in the %s theme', (_theme, rule) => {
    expect(findContrastFailures(rule.decls)).toEqual([]);
  });

  it("the fonts' opt-in puts its family in front of each default stack, and sets nothing else", () => {
    const optIn = fontsSheet.rules.filter((r) => !r.selector.startsWith('@font-face'));
    expect(optIn.map((r) => [r.selector, r.context.join()])).toEqual([['.aekUi', TOKENS_LAYER]]);
    const decls = optIn[0].decls;
    expect([...decls.keys()].sort()).toEqual(['--aek-font-mono', '--aek-font-sans']);
    const families = fontsSheet.rules
      .filter((r) => r.selector === '@font-face')
      .map((r) => r.decls.get('font-family'));
    for (const [name, value] of decls) {
      const [family, ...rest] = value.split(', ');
      expect(families, name).toContain(family);
      expect(rest.join(', '), name).toBe(kitRoot.decls.get(name));
    }
    expect(kitRoot.decls.get('font-family')).toBe('var(--aek-font-sans)');
  });

  it('the compact density sets the type (its icon sizes too) and space scales only, all of them', () => {
    const scale = (rule: TokenRule) =>
      [...rule.decls.keys()]
        .filter((name) => /^--aek-(font-size|icon-size|space)-/.test(name))
        .sort();
    expect([...compact.decls.keys()].sort()).toEqual(scale(kitRoot));
  });
});
