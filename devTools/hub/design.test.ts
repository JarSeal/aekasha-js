import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { HubDiagnostics } from './diagnostics';
import { createHubMarkdown, createMarkdownEnv, type HubRenderContext } from './markdown';
import type { HubPage } from './types';
import { SRC_DIR } from '../paths';
import {
  findTokenRules,
  listContrastPairs,
  parseTokenSheet,
} from '../../src/_engine/ui/styles/TokenSheet';
import { createDesignSection, findUnshownTokens, type DesignTokens } from './generated/design';

// p802 D8: the design document's tables are tokens.css' and the icons', every token on the page

const STYLES_DIR = path.join(SRC_DIR, '_engine', 'ui', 'styles');
const sheet = parseTokenSheet(fs.readFileSync(path.join(STYLES_DIR, 'tokens.css'), 'utf8'));
const rules = findTokenRules(sheet);

const renderSlots = () => {
  const diag = new HubDiagnostics();
  const section = createDesignSection(diag);
  const page = { file: 'index.html', body: '' } as HubPage;
  const env = createMarkdownEnv(page, '../../../', diag, {
    mode: 'dev',
    icons: { render: () => '' },
  } as unknown as HubRenderContext);
  const md = createHubMarkdown();
  const html = Object.fromEntries(
    Object.entries(section.slots).map(([id, slot]) => [id, slot(md, env)])
  );
  return { html, diag, env };
};

const customProps = (decls: Map<string, string>) =>
  [...decls.keys()].filter((name) => name.startsWith('--aek-'));

describe('the design document (p802 D8)', () => {
  const { html, diag, env } = renderSlots();
  const all = Object.values(html).join('\n');

  it('reads the tokens and the icons without a diagnostic', () => {
    expect([...diag.errors, ...diag.warnings]).toEqual([]);
  });

  it('shows every token tokens.css declares', () => {
    const tokens = [...customProps(rules.kitRoot.decls), ...customProps(rules.dark.decls)];
    expect(tokens.filter((name) => !all.includes(`<code>${name}</code>`))).toEqual([]);
  });

  it("shows each theme's value of every colour role", () => {
    const colours = html['generated-design-colours'];
    for (const decls of [rules.dark.decls, rules.lightSystem.decls]) {
      for (const name of customProps(decls).filter((n) => !n.startsWith('--aek-shadow-'))) {
        expect(colours, name).toContain(`<code>${decls.get(name)}</code>`);
      }
    }
  });

  it('shows the ratio of every pair the contrast test checks, in both themes', () => {
    const shown = [...html['generated-design-colours'].matchAll(/<\/span>(\d+\.\d\d)/g)].map(
      (match) => match[1]
    );
    const expected = [rules.dark.decls, rules.lightSystem.decls].flatMap((decls) =>
      listContrastPairs(decls).map((pair) => pair.ratio.toFixed(2))
    );
    expect(shown.sort()).toEqual(expected.sort());
  });

  it('lists every built-in icon by its name', () => {
    const source = fs.readFileSync(
      path.join(SRC_DIR, '_engine', 'ui', 'icons', 'BuiltInIcons.ts'),
      'utf8'
    );
    const names = [...source.matchAll(/default as (\w+)Icon\b/g)].map((match) => match[1]);
    expect(names.length).toBeGreaterThan(0);
    const shown = [...html['generated-design-icons'].matchAll(/<li><svg[^]*?<code>(\w+)<\/code>/g)];
    expect(shown.map((match) => match[1])).toEqual(names);
  });

  it('puts its headings in the TOC', () => {
    expect(env.headings.map((h) => h.text)).toContain('Contrast');
  });

  it('warns about a token in no table', () => {
    const tokens = { root: new Map([['--aek-blur-sm', '4px']]) } as DesignTokens;
    expect(findUnshownTokens(tokens)).toEqual(['--aek-blur-sm']);
  });
});
