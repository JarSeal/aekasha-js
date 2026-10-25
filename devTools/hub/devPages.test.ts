import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { HubDiagnostics } from './diagnostics';
import type { HubMarkdownEnv } from './markdown';
import type { RenderedPage } from './renderPages';
import type { ProjectMetadata } from '../projectMetadata';
import type { HubBuildMode, HubPage } from './types';

// p802 D1, D2, D4: `aek:dev` pages are in the dev server's Hub only, and a public page links one
// only inside `::: dev-only`

const { PAGES } = vi.hoisted(() => ({ PAGES: { dir: '' } }));
vi.mock('./paths', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./paths')>();
  return {
    ...actual,
    get HUB_PAGES_DIR() {
      return PAGES.dir;
    },
  };
});

const { discoverPages, removeDevPages } = await import('./pages');
const { createHubMarkdown, createMarkdownEnv } = await import('./markdown');
const { checkLinks } = await import('./renderPages');
const { createHomeSection } = await import('./generated/home');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aek-p802-dev-pages-'));
afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

/** A page folder under the fixture's `hub/pages/`, with its metas */
const writePage = (sitePath: string, metas: Record<string, string> = {}) => {
  const dir = path.join(PAGES.dir, sitePath);
  fs.mkdirSync(dir, { recursive: true });
  const head = Object.entries(metas)
    .map(([name, content]) => `<meta name="${name}" content="${content}" />`)
    .join('');
  const title = sitePath.replace(/\/$/, '') || 'Home';
  fs.writeFileSync(
    path.join(dir, 'index.html'),
    `<html><head><title>${title}</title>${head}</head><body><p>${title}</p></body></html>`
  );
};

/** The fixture: a public section, a dev section with a child, and a dev page under a public one */
const writeFixture = () => {
  PAGES.dir = fs.mkdtempSync(path.join(TMP, 'pages-'));
  writePage('');
  writePage('guides/');
  writePage('guides/internal/', { 'aek:dev': 'true' });
  writePage('project/', { 'aek:dev': 'true' });
  writePage('project/aekasha/');
};

const discover = () => {
  const diag = new HubDiagnostics();
  const tree = discoverPages(diag);
  if (!tree) throw new Error('no tree');
  return { tree, diag };
};

const paths = (pages: HubPage[]) => pages.map((page) => page.path);

describe('dev pages (D1)', () => {
  beforeEach(writeFixture);

  it('marks an aek:dev page and every page under it', () => {
    const { tree, diag } = discover();
    const devPaths = tree.pages.filter((page) => page.isDev).map((page) => page.path);
    expect(devPaths).toEqual(['guides/internal/', 'project/', 'project/aekasha/']);
    expect(diag.errors).toEqual([]);
  });

  it('removes them from the tree, the path map and their parents for a public build', () => {
    const { tree } = discover();
    removeDevPages(tree);
    expect(paths(tree.pages)).toEqual(['', 'guides/']);
    expect([...tree.byPath.keys()].sort()).toEqual(['', 'guides/']);
    expect(paths(tree.root.children)).toEqual(['guides/']);
    expect(tree.byPath.get('guides/')?.children).toEqual([]);
    expect([...tree.removedDevPaths].sort()).toEqual([
      'guides/internal/',
      'project/',
      'project/aekasha/',
    ]);
  });

  it('warns on a value other than "true", and keeps the page public', () => {
    writePage('typo/', { 'aek:dev': 'yes' });
    const { tree, diag } = discover();
    expect(tree.byPath.get('typo/')?.isDev).toBe(false);
    expect(diag.warnings.map((w) => w.message)).toEqual([expect.stringContaining('"yes"')]);
  });

  it('refuses a dev homepage', () => {
    writePage('', { 'aek:dev': 'true' });
    const { tree, diag } = discover();
    expect(tree.root.isDev).toBe(false);
    expect(diag.errors.map((e) => e.message)).toEqual([expect.stringContaining('homepage')]);
  });

  it("refuses a generated section's page under a dev page", () => {
    const diag = new HubDiagnostics();
    discoverPages(diag, [
      {
        path: 'project/',
        slots: {},
        pages: [
          {
            path: 'project/log/',
            file: path.join(PAGES.dir, 'log.md'),
            title: 'Log',
            menu: 'Log',
            description: '',
            tags: [],
            isInMenu: false,
            body: '<p>Log</p>',
            slots: {},
          },
        ],
        files: [],
        dirs: [],
      },
    ]);
    expect(diag.errors.map((e) => e.message)).toEqual([
      expect.stringContaining('/project/log/ is under a dev-only page'),
    ]);
  });
});

/** Renders `markdown` as `page`'s, its links checked against `tree` */
const renderAndCheck = (
  markdown: string,
  page: HubPage,
  tree: ReturnType<typeof discover>['tree'],
  mode: HubBuildMode
) => {
  const diag = new HubDiagnostics();
  const env: HubMarkdownEnv = createMarkdownEnv(page, '../', diag, {
    mode,
    icons: { render: () => '' },
    tree,
  } as unknown as Parameters<typeof createMarkdownEnv>[3]);
  env.file = path.join(page.dir, 'intro.md');
  createHubMarkdown().render(markdown, env);
  const rendered: RenderedPage[] = [{ page, body: '', env }];
  checkLinks(rendered, tree, false, diag);
  return diag.errors.map((e) => e.message);
};

const DEV_ONLY_LINK = '::: dev-only\n\nSee [the project](hub:project).\n\n:::\n';
const PLAIN_LINK = 'See [the project](hub:project).\n';

describe.each<HubBuildMode>(['dev', 'public'])('links to a dev page in %s (D2)', (mode) => {
  beforeEach(writeFixture);

  const setup = () => {
    const { tree } = discover();
    const guides = tree.byPath.get('guides/')!;
    const internal = tree.byPath.get('guides/internal/')!;
    if (mode === 'public') removeDevPages(tree);
    return { tree, guides, internal };
  };

  it('is an error from a public page', () => {
    const { tree, guides } = setup();
    expect(renderAndCheck(PLAIN_LINK, guides, tree, mode)).toEqual([
      expect.stringContaining('hub:project is a dev-only page'),
    ]);
  });

  it('is fine inside ::: dev-only (a public build never reads it)', () => {
    const { tree, guides } = setup();
    expect(renderAndCheck(DEV_ONLY_LINK, guides, tree, mode)).toEqual([]);
  });

  // A public build doesn't render a dev page
  it.runIf(mode === 'dev')('is fine from a dev page', () => {
    const { tree, internal } = setup();
    expect(renderAndCheck(PLAIN_LINK, internal, tree, mode)).toEqual([]);
  });

  it('a dead link is still a dead link', () => {
    const { tree, guides } = setup();
    expect(renderAndCheck('[x](hub:nowhere)', guides, tree, mode)).toEqual([
      expect.stringContaining('Dead link hub:nowhere'),
    ]);
  });
});

describe('the dev-only depth', () => {
  beforeEach(writeFixture);

  it('ends with its block: a link after it is a public one', () => {
    const { tree } = discover();
    const guides = tree.byPath.get('guides/')!;
    expect(renderAndCheck(`${DEV_ONLY_LINK}\n${PLAIN_LINK}`, guides, tree, 'dev')).toHaveLength(1);
  });
});

describe("the homepage hero's Project links (D6)", () => {
  beforeEach(writeFixture);

  const renderSlot = (mode: HubBuildMode) => {
    const { tree } = discover();
    const env: HubMarkdownEnv = createMarkdownEnv(tree.root, '', new HubDiagnostics(), {
      mode,
      icons: { render: () => '' },
      tree,
    } as unknown as Parameters<typeof createMarkdownEnv>[3]);
    const slot = createHomeSection({} as ProjectMetadata, null).slots['generated-hero-project'];
    return { html: slot(createHubMarkdown(), env), env };
  };

  it('are empty in a public build', () => {
    const { html, env } = renderSlot('public');
    expect(html).toBe('');
    expect(env.links).toEqual([]);
  });

  it('are dev-only links in dev', () => {
    const { html, env } = renderSlot('dev');
    expect(html).toContain('hubHeroProject');
    expect(env.links.length).toBeGreaterThan(0);
    expect(
      env.links.every((link) => link.isInDevOnly && link.targetPath.startsWith('project/'))
    ).toBe(true);
  });
});
