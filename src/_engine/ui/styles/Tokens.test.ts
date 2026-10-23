import fs from 'fs';
import { describe, expect, it } from 'vitest';

// tokens.css' structure and the contrast rule (p800 D6, p801 D6): WCAG 2.2 AA in both themes.
// Read from disk: Vitest turns a CSS import into an empty string, `?raw` included.
const tokensCss = fs.readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

type CssRule = { selector: string; context: string[]; decls: Map<string, string> };
type CssSheet = { statements: string[]; properties: string[]; rules: CssRule[] };

/** Finds the `}` that closes the block opened right before `start`. */
const findBlockEnd = (css: string, start: number) => {
  let depth = 1;
  for (let i = start; i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) return i;
  }
  throw new Error(`tokens.css: unclosed block at ${start}`);
};

const parseDecls = (body: string) => {
  const decls = new Map<string, string>();
  for (const decl of body.split(';')) {
    const colon = decl.indexOf(':');
    if (colon < 0) continue;
    const name = decl.slice(0, colon).trim();
    if (decls.has(name)) throw new Error(`tokens.css: ${name} declared twice in one rule`);
    decls.set(
      name,
      decl
        .slice(colon + 1)
        .replace(/\s+/g, ' ')
        .trim()
    );
  }
  return decls;
};

/** A parser for tokens.css' subset of CSS: statements, at-rule blocks, rules of declarations. */
const parseCss = (css: string, context: string[] = [], sheet?: CssSheet): CssSheet => {
  const out = sheet ?? { statements: [], properties: [], rules: [] };
  let pos = 0;
  while (pos < css.length) {
    const open = css.indexOf('{', pos);
    const semi = css.indexOf(';', pos);
    if (open < 0 && semi < 0) break;
    if (semi >= 0 && (open < 0 || semi < open)) {
      out.statements.push(css.slice(pos, semi).replace(/\s+/g, ' ').trim());
      pos = semi + 1;
      continue;
    }
    const prelude = css.slice(pos, open).replace(/\s+/g, ' ').trim();
    const end = findBlockEnd(css, open + 1);
    const body = css.slice(open + 1, end);
    if (prelude.startsWith('@property')) {
      out.properties.push(prelude.slice('@property'.length).trim());
    } else if (/^@(layer|media|supports)\b/.test(prelude)) {
      parseCss(body, [...context, prelude], out);
    } else {
      out.rules.push({ selector: prelude, context, decls: parseDecls(body) });
    }
    pos = end + 1;
  }
  return out;
};

const sheet = parseCss(tokensCss.replace(/\/\*[\s\S]*?\*\//g, ''));

const TOKENS_LAYER = '@layer aek.tokens';
const LIGHT_MEDIA = '@media (prefers-color-scheme: light)';

const findRule = (test: (rule: CssRule) => boolean, what: string) => {
  const found = sheet.rules.filter(test);
  if (found.length !== 1) throw new Error(`tokens.css: ${found.length} rules for ${what}, not 1`);
  return found[0];
};
const isTokensOnly = (rule: CssRule) => rule.context.join() === TOKENS_LAYER;

const kitRoot = findRule((r) => isTokensOnly(r) && r.selector === ':where(.aekUi)', 'the kit root');
const themes = {
  dark: findRule(
    (r) => isTokensOnly(r) && r.selector.includes(`[data-aek-theme='dark']`),
    'the dark theme'
  ),
  lightSystem: findRule(
    (r) => r.context.join() === [TOKENS_LAYER, LIGHT_MEDIA].join(),
    'the light theme (the system preference)'
  ),
  lightForced: findRule(
    (r) => isTokensOnly(r) && r.selector === `:where([data-aek-theme='light'])`,
    `the light theme (data-aek-theme='light')`
  ),
};
const compact = findRule(
  (r) => r.selector === `:where([data-aek-density='compact'])`,
  'the compact density'
);

const SURFACES = ['bg', 'surface', 'surface-raised', 'surface-hover'];
/** Text and icons in these colours, at 4.5:1 on every surface */
const TEXTS = [
  'text',
  'text-muted',
  'accent',
  'accent-hover',
  'danger',
  'warning',
  'success',
  'info',
];
/** A control's edge and the focus ring, at 3:1 on every surface (WCAG 1.4.11) */
const CONTROLS = ['border-control', 'focus-ring-color'];
/** A status' background, under `text` and its own colour (a badge, a toast) */
const SOFTS = ['accent', 'danger', 'warning', 'success', 'info'];
/** The theme tokens no pair checks, each with its reason */
const UNCHECKED: Record<string, string> = {
  // WCAG exempts the text of a disabled control
  'text-disabled': 'exempt',
  // Decorative: dividers and emphasis, never a control's only edge (that's border-control)
  border: 'decorative',
  'border-strong': 'decorative',
  backdrop: 'an overlay, not a pair',
  'shadow-sm': 'not a colour pair',
  'shadow-lg': 'not a colour pair',
};
const CHECKED = new Set([
  ...SURFACES,
  ...TEXTS,
  ...CONTROLS,
  'on-accent',
  ...SOFTS.map((role) => `${role}-soft`),
]);

type Rgba = [number, number, number, number];

const parseColor = (value: string, vars: Map<string, string>, seen = 0): Rgba => {
  const ref = value.match(/^var\((--aek-[\w-]+)\)$/);
  if (ref) {
    const target = vars.get(ref[1]);
    if (!target || seen > 4) throw new Error(`tokens.css: can't resolve ${value}`);
    return parseColor(target, vars, seen + 1);
  }
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgb = value.match(/^rgb\((\d+) (\d+) (\d+)(?: \/ (\d+(?:\.\d+)?)%)?\)$/);
  if (rgb) {
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] ? Number(rgb[4]) / 100 : 1];
  }
  throw new Error(`tokens.css: not a colour the test reads: ${value}`);
};

/** `fg` painted over the opaque `bg` */
const composite = (fg: Rgba, bg: Rgba): Rgba => [
  fg[0] * fg[3] + bg[0] * (1 - fg[3]),
  fg[1] * fg[3] + bg[1] * (1 - fg[3]),
  fg[2] * fg[3] + bg[2] * (1 - fg[3]),
  1,
];

const luminance = ([r, g, b]: Rgba) => {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

const contrast = (a: Rgba, b: Rgba) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** Every pair below its minimum, as `fg on bg: ratio < minimum` */
const findContrastFailures = (decls: Map<string, string>) => {
  const color = (role: string) => parseColor(decls.get(`--aek-${role}`) ?? 'missing', decls);
  const failures: string[] = [];
  const check = (fg: string, fgColor: Rgba, bg: string, bgColor: Rgba, min: number) => {
    const ratio = contrast(fgColor, bgColor);
    if (ratio < min) failures.push(`${fg} on ${bg}: ${ratio.toFixed(2)} < ${min}`);
  };
  for (const bg of SURFACES) {
    for (const fg of TEXTS) check(fg, color(fg), bg, color(bg), 4.5);
    for (const fg of CONTROLS) check(fg, color(fg), bg, color(bg), 3);
  }
  check('on-accent', color('on-accent'), 'accent', color('accent'), 4.5);
  for (const role of SOFTS) {
    const soft = composite(color(`${role}-soft`), color('surface'));
    check('text', color('text'), `${role}-soft over surface`, soft, 4.5);
    check(role, color(role), `${role}-soft over surface`, soft, 4.5);
  }
  return failures;
};

describe('tokens.css', () => {
  it('declares the layer order first', () => {
    expect(sheet.statements[0]).toBe('@layer aek.tokens, aek.base, aek.components, aek.utilities');
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
    const names = (rule: CssRule) => [...rule.decls.keys()].sort();
    expect(names(themes.lightSystem)).toEqual(names(themes.dark));
    expect(Object.fromEntries(themes.lightForced.decls)).toEqual(
      Object.fromEntries(themes.lightSystem.decls)
    );
  });

  it('has a contrast rule or a reason for every theme token', () => {
    const roles = [...themes.dark.decls.keys()].map((name) => name.replace(/^--aek-/, ''));
    const unlisted = roles.filter((role) => !CHECKED.has(role) && !(role in UNCHECKED));
    expect(unlisted).toEqual([]);
    expect([...CHECKED].filter((role) => !roles.includes(role))).toEqual([]);
  });

  it.each([
    ['dark', themes.dark],
    ['light', themes.lightSystem],
  ])('meets WCAG AA in the %s theme', (_theme, rule) => {
    expect(findContrastFailures(rule.decls)).toEqual([]);
  });

  it('the compact density sets the type and space scales only, all of them', () => {
    const scale = (rule: CssRule) =>
      [...rule.decls.keys()].filter((name) => /^--aek-(font-size|space)-/.test(name)).sort();
    expect([...compact.decls.keys()].sort()).toEqual(scale(kitRoot));
  });
});
