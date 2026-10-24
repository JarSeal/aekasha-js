import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { HUB_ASSETS_DIR } from './paths';
import { SRC_DIR } from '../paths';

// The Hub on the UI kit's tokens (p801 Phase 5): every `--hub-*` in `_tokens.scss` is an alias of
// a `--aek-*` that `tokens.css` defines, or one of the Hub's own (`HUB_ONLY`), and each resolves
// in both themes to the Hub's colour at p801's Phase 0 (`f962bb3`) but for the changes p801 D2
// made on purpose (`EXPECTED_CHANGES`).

const stripComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const tokensCss = stripComments(
  fs.readFileSync(path.join(SRC_DIR, '_engine', 'ui', 'styles', 'tokens.css'), 'utf8')
);
const hubTokens = stripComments(
  fs.readFileSync(path.join(HUB_ASSETS_DIR, 'scss', '_tokens.scss'), 'utf8')
);

const squash = (value: string) => value.replace(/\s+/g, ' ').trim();

type Rule = { selector: string; decls: Map<string, string> };

/** Every innermost `selector { declarations }` block, an at-rule's wrapper left out */
const readRules = (css: string): Rule[] =>
  [...css.matchAll(/([^{};]+)\{([^{}]*)\}/g)].map(([, selector, body]) => {
    const decls = new Map<string, string>();
    for (const decl of body.split(';')) {
      const colon = decl.indexOf(':');
      if (colon >= 0) decls.set(decl.slice(0, colon).trim(), squash(decl.slice(colon + 1)));
    }
    return { selector: squash(selector), decls };
  });

const findRule = (rules: Rule[], file: string, selector: string) => {
  const found = rules.find((rule) => rule.selector === selector);
  if (!found) throw new Error(`${file}: no rule \`${selector}\``);
  return found.decls;
};

const kitRules = readRules(tokensCss);
const kit = {
  root: findRule(kitRules, 'tokens.css', ':where(.aekUi)'),
  dark: findRule(
    kitRules,
    'tokens.css',
    `:where(.aekUi:not([data-aek-theme], [data-aek-theme] *)), :where([data-aek-theme='dark'])`
  ),
  light: findRule(kitRules, 'tokens.css', `:where([data-aek-theme='light'])`),
};

const hubRules = readRules(hubTokens);
const ALIAS_SELECTOR = ':root, [data-aek-theme]';
const hub = {
  aliases: findRule(hubRules, '_tokens.scss', ALIAS_SELECTOR),
  root: findRule(hubRules, '_tokens.scss', ':root'),
  dark: findRule(hubRules, '_tokens.scss', '@mixin dark-tokens'),
  light: findRule(hubRules, '_tokens.scss', '@mixin light-tokens'),
};

/** The Hub's own: what the kit has no role for */
const HUB_ONLY = [
  'gradient',
  'header-bg',
  'code-bg',
  'code-highlight',
  'code-add',
  'code-remove',
  'code-warning-bg',
  'page-width',
  'docs-width',
  'content-width',
  'gutter',
  'header-height',
];

type Themed = { dark: string; light: string };

/** `_tokens.scss` at `f962bb3` (p801 §4.8): the colours and the radius, each theme's */
const PHASE_0: Record<string, Themed> = {
  bg: { dark: '#070b14', light: '#f5f7fa' },
  panel: { dark: '#0c1321', light: '#ffffff' },
  'panel-hover': { dark: '#111b2d', light: '#edf1f6' },
  border: { dark: '#1b2638', light: '#dce3ec' },
  'border-strong': { dark: '#2b3a52', light: '#b9c4d3' },
  text: { dark: '#e6ebf2', light: '#0f1726' },
  'text-muted': { dark: '#9aa6b8', light: '#4b5668' },
  accent: { dark: '#3fd8f2', light: '#0a7590' },
  'accent-hover': { dark: '#8be9f8', light: '#075a6f' },
  'accent-soft': { dark: 'rgb(63 216 242 / 12%)', light: 'rgb(10 117 144 / 10%)' },
  gradient: {
    dark: 'linear-gradient(100deg, #2fc4ec 10%, #8cf0ff 90%)',
    light: 'linear-gradient(100deg, #0a7590 10%, #0b9bbb 90%)',
  },
  'header-bg': { dark: 'rgb(7 11 20 / 85%)', light: 'rgb(245 247 250 / 88%)' },
  'code-bg': { dark: '#0a101d', light: '#edf1f6' },
  shadow: { dark: '0 12px 32px rgb(0 0 0 / 45%)', light: '0 12px 32px rgb(15 23 38 / 12%)' },
  warning: { dark: '#f2c13f', light: '#9a6a00' },
  success: { dark: '#5fd89a', light: '#1c7a46' },
  danger: { dark: '#ff7a6b', light: '#c2361f' },
  error: { dark: '#ff7a85', light: '#c0283a' },
  'code-highlight': { dark: 'rgb(63 216 242 / 11%)', light: 'rgb(10 117 144 / 11%)' },
  'code-add': { dark: 'rgb(95 216 154 / 12%)', light: 'rgb(28 122 70 / 12%)' },
  'code-remove': { dark: 'rgb(255 122 107 / 12%)', light: 'rgb(194 54 31 / 11%)' },
  'code-warning-bg': { dark: 'rgb(242 193 63 / 12%)', light: 'rgb(154 106 0 / 12%)' },
  radius: { dark: '8px', light: '8px' },
};

/**
 * p801 D2's outcome: `error` folds into `danger`, and the light `warning` holds 4.5 on every
 * surface (the Hub's was 4.41 on `bg`)
 */
const EXPECTED_CHANGES: Record<string, Partial<Themed>> = {
  error: { dark: '#ff7a6b', light: '#c2361f' },
  warning: { light: '#8f6300' },
};

const ALIAS_REGEX = /^var\(--aek-([\w-]+)\)$/;
const hubName = (prop: string) => prop.slice('--hub-'.length);
const hubProps = (decls: Map<string, string>) =>
  [...decls].filter(([prop]) => prop.startsWith('--hub-'));

/** A `--hub-*`'s value in a theme: its alias' (the kit's theme, then its root) or its own */
const resolve = (name: string, theme: keyof Themed) => {
  const own = hub.aliases.get(`--hub-${name}`) ?? hub.root.get(`--hub-${name}`);
  const alias = own?.match(ALIAS_REGEX)?.[1];
  if (alias) return kit[theme].get(`--aek-${alias}`) ?? kit.root.get(`--aek-${alias}`);
  return own ?? hub[theme].get(`--hub-${name}`);
};

describe("the Hub's tokens", () => {
  it("are each an alias of a kit token or one of the Hub's own", () => {
    const names = new Set(
      [hub.aliases, hub.root, hub.dark, hub.light].flatMap((decls) =>
        hubProps(decls).map(([prop]) => hubName(prop))
      )
    );
    const problems = [...names].flatMap((name) => {
      const value = hub.aliases.get(`--hub-${name}`) ?? hub.root.get(`--hub-${name}`);
      const token = value?.match(ALIAS_REGEX)?.[1];
      if (token) {
        const isThemed = kit.dark.has(`--aek-${token}`) && kit.light.has(`--aek-${token}`);
        return isThemed || kit.root.has(`--aek-${token}`)
          ? []
          : [`--hub-${name}: no --aek-${token}`];
      }
      if (!HUB_ONLY.includes(name)) return [`--hub-${name}: neither an alias nor in HUB_ONLY`];
      const isThemed = hub.dark.has(`--hub-${name}`) || hub.light.has(`--hub-${name}`);
      return isThemed && !(hub.dark.has(`--hub-${name}`) && hub.light.has(`--hub-${name}`))
        ? [`--hub-${name}: in one theme's mixin only`]
        : [];
    });
    expect(problems).toEqual([]);
    expect(HUB_ONLY.filter((name) => !names.has(name))).toEqual([]);
  });

  it('alias the themed tokens on every element that forces a theme, not on :root alone', () => {
    // A var() resolves where it's declared: on :root alone, the hero (forced dark in the light
    // theme) would inherit the light theme's values
    const onRootOnly = hubProps(hub.root)
      .filter(([, value]) => kit.dark.has(`--aek-${value.match(ALIAS_REGEX)?.[1]}`))
      .map(([prop]) => prop);
    expect(onRootOnly).toEqual([]);
    expect(hubProps(hub.aliases).length).toBeGreaterThan(0);
  });

  it.each(['dark', 'light'] as const)(
    "%s: resolve to the Hub's Phase 0 values but for the expected changes",
    (theme) => {
      const resolved = Object.fromEntries(
        Object.keys(PHASE_0).map((name) => [name, resolve(name, theme)])
      );
      const expected = Object.fromEntries(
        Object.entries(PHASE_0).map(([name, values]) => [
          name,
          EXPECTED_CHANGES[name]?.[theme] ?? values[theme],
        ])
      );
      expect(resolved).toEqual(expected);
    }
  );
});
