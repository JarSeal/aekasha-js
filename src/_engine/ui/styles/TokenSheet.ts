/**
 * `tokens.css` read as data (p801 D6, p802 D8): a parser for its subset of CSS, its rules by role
 * (the kit root, each theme, the compact density), and the WCAG contrast pairs its colours must
 * meet. `Tokens.test.ts` checks the pairs, the Hub's design document (`devTools/hub/generated/`)
 * renders them, so the rule and the page are one computation. Takes the text, reads no file, and
 * nothing that ships imports it.
 */

/**
 * A rule of declarations: its selector, the at-rules around it, its declarations by name
 * @internal
 */
export type TokenRule = { selector: string; context: string[]; decls: Map<string, string> };

/**
 * A stylesheet's top-level statements, `@property` names and rules, in source order
 * @internal
 */
export type TokenSheet = { statements: string[]; properties: string[]; rules: TokenRule[] };

/**
 * An sRGB colour, 0-255 per channel, alpha 0-1
 * @internal
 */
export type TokenColor = [number, number, number, number];

/**
 * A pair the contrast rule checks: the foreground role on the background, and the ratio
 * @internal
 */
export type ContrastPair = {
  fg: string;
  /** A surface role, or `<role>-soft over surface` */
  bg: string;
  ratio: number;
  min: number;
};

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

const parseBlocks = (css: string, context: string[], out: TokenSheet) => {
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
      parseBlocks(body, [...context, prelude], out);
    } else {
      out.rules.push({ selector: prelude, context, decls: parseDecls(body) });
    }
    pos = end + 1;
  }
  return out;
};

/**
 * Parses `tokens.css`' subset of CSS (comments, statements, `@layer` / `@media` / `@supports`
 * blocks, `@property`, rules of declarations; `fonts.css` is in it too). Throws on an unclosed
 * block or a name declared twice in one rule.
 * @internal
 */
export const parseTokenSheet = (css: string): TokenSheet =>
  parseBlocks(css.replace(/\/\*[\s\S]*?\*\//g, ''), [], {
    statements: [],
    properties: [],
    rules: [],
  });

const TOKENS_LAYER = '@layer aek.tokens';
const LIGHT_MEDIA = '@media (prefers-color-scheme: light)';

/**
 * `tokens.css`' rules by role: the kit root, the dark theme, the light theme's two copies (the
 * system preference's and `data-aek-theme='light'`), the compact density. Throws when a role
 * hasn't exactly one rule.
 * @internal
 */
export const findTokenRules = (sheet: TokenSheet) => {
  const find = (test: (rule: TokenRule) => boolean, what: string) => {
    const found = sheet.rules.filter(test);
    if (found.length !== 1) throw new Error(`tokens.css: ${found.length} rules for ${what}, not 1`);
    return found[0];
  };
  const isTokensOnly = (rule: TokenRule) => rule.context.join() === TOKENS_LAYER;
  return {
    kitRoot: find((r) => isTokensOnly(r) && r.selector === ':where(.aekUi)', 'the kit root'),
    dark: find(
      (r) => isTokensOnly(r) && r.selector.includes(`[data-aek-theme='dark']`),
      'the dark theme'
    ),
    lightSystem: find(
      (r) => r.context.join() === [TOKENS_LAYER, LIGHT_MEDIA].join(),
      'the light theme (the system preference)'
    ),
    lightForced: find(
      (r) => isTokensOnly(r) && r.selector === `:where([data-aek-theme='light'])`,
      `the light theme (data-aek-theme='light')`
    ),
    compact: find(
      (r) => r.selector === `:where([data-aek-density='compact'])`,
      'the compact density'
    ),
  };
};

/**
 * The surfaces every text and control colour is checked on
 * @internal
 */
export const CONTRAST_SURFACES = ['bg', 'surface', 'surface-raised', 'surface-hover'];
/**
 * Text and icons in these colours, at 4.5:1 on every surface
 * @internal
 */
export const CONTRAST_TEXTS = [
  'text',
  'text-muted',
  'accent',
  'accent-hover',
  'danger',
  'warning',
  'success',
  'info',
];
/**
 * A control's edge and the focus ring, at 3:1 on every surface (WCAG 1.4.11)
 * @internal
 */
export const CONTRAST_CONTROLS = ['border-control', 'focus-ring-color'];
/**
 * A status' background, under `text` and its own colour (a badge, a toast)
 * @internal
 */
export const CONTRAST_SOFTS = ['accent', 'danger', 'warning', 'success', 'info'];
/**
 * The chart series (p805 D9), in their order: each at 3:1 (a graphical object, WCAG 1.4.11) on
 * the surfaces a chart sits on, `CONTRAST_SERIES_SURFACES`. Their order keeps neighbours apart
 * under the common colour vision deficiencies (p805 Phase 0), which no pair here checks.
 * @internal
 */
export const CONTRAST_SERIES = ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6'];
/**
 * The surfaces the chart series are checked on: a panel's and a window's (not `bg` or
 * `surface-hover`, which a chart doesn't sit on: the light orange is under 3 there)
 * @internal
 */
export const CONTRAST_SERIES_SURFACES = ['surface', 'surface-raised'];
/**
 * The theme tokens no pair checks, each with its reason
 * @internal
 */
export const CONTRAST_UNCHECKED: Record<string, string> = {
  // WCAG exempts the text of a disabled control
  'text-disabled': 'exempt',
  // Decorative: dividers and emphasis, never a control's only edge (that's border-control)
  border: 'decorative',
  'border-strong': 'decorative',
  backdrop: 'an overlay, not a pair',
  'shadow-sm': 'not a colour pair',
  'shadow-lg': 'not a colour pair',
};
/**
 * Every theme token a pair checks
 * @internal
 */
export const CONTRAST_CHECKED = new Set([
  ...CONTRAST_SURFACES,
  ...CONTRAST_TEXTS,
  ...CONTRAST_CONTROLS,
  ...CONTRAST_SERIES,
  'on-accent',
  ...CONTRAST_SOFTS.map((role) => `${role}-soft`),
]);

/**
 * A token's colour: `#rrggbb`, `rgb(r g b)`, `rgb(r g b / a%)` or a `var(--aek-…)` of another
 * token in `vars`. Throws on anything else.
 * @internal
 */
export const parseTokenColor = (value: string, vars: Map<string, string>, seen = 0): TokenColor => {
  const ref = value.match(/^var\((--aek-[\w-]+)\)$/);
  if (ref) {
    const target = vars.get(ref[1]);
    if (!target || seen > 4) throw new Error(`tokens.css: can't resolve ${value}`);
    return parseTokenColor(target, vars, seen + 1);
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
const composite = (fg: TokenColor, bg: TokenColor): TokenColor => [
  fg[0] * fg[3] + bg[0] * (1 - fg[3]),
  fg[1] * fg[3] + bg[1] * (1 - fg[3]),
  fg[2] * fg[3] + bg[2] * (1 - fg[3]),
  1,
];

const luminance = ([r, g, b]: TokenColor) => {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

/**
 * The WCAG 2.2 contrast ratio of two opaque colours, 1 to 21
 * @internal
 */
export const getContrastRatio = (a: TokenColor, b: TokenColor) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/**
 * Every pair of a theme's declarations the contrast rule checks, with its ratio and minimum:
 * the texts at 4.5 and the controls at 3 on each surface, the chart series at 3 on theirs,
 * `on-accent` on `accent`, and `text` and each status colour on its `-soft` over `surface`. Throws when a token is missing or unreadable.
 * @internal
 */
export const listContrastPairs = (decls: Map<string, string>): ContrastPair[] => {
  const color = (role: string) => parseTokenColor(decls.get(`--aek-${role}`) ?? 'missing', decls);
  const pairs: ContrastPair[] = [];
  const add = (fg: string, fgColor: TokenColor, bg: string, bgColor: TokenColor, min: number) =>
    pairs.push({ fg, bg, ratio: getContrastRatio(fgColor, bgColor), min });
  for (const bg of CONTRAST_SURFACES) {
    for (const fg of CONTRAST_TEXTS) add(fg, color(fg), bg, color(bg), 4.5);
    for (const fg of CONTRAST_CONTROLS) add(fg, color(fg), bg, color(bg), 3);
  }
  for (const bg of CONTRAST_SERIES_SURFACES) {
    for (const fg of CONTRAST_SERIES) add(fg, color(fg), bg, color(bg), 3);
  }
  add('on-accent', color('on-accent'), 'accent', color('accent'), 4.5);
  for (const role of CONTRAST_SOFTS) {
    const soft = composite(color(`${role}-soft`), color('surface'));
    add('text', color('text'), `${role}-soft over surface`, soft, 4.5);
    add(role, color(role), `${role}-soft over surface`, soft, 4.5);
  }
  return pairs;
};
