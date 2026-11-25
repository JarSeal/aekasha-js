import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { HubDiagnostics } from './diagnostics';
import type { HubIcons } from './icons';

// p103: `aek:navParent` hangs a page under another one in the nav, the breadcrumbs and the
// search's section, while its URL and its children's keep its folder (Issues under Versions &
// Issues, at issues/…)

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

const { discoverPages, getPageSection, getPageTrail } = await import('./pages');
const { renderBreadcrumbs, renderNav } = await import('./shell');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'aek-p103-nav-parent-'));
afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

const ICONS = { render: (name: string) => `<svg data-icon="${name}"></svg>` } as HubIcons;

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

/** The Hub's case: issues/ (and an issue under it) hung under version/ */
const writeFixture = () => {
  PAGES.dir = fs.mkdtempSync(path.join(TMP, 'pages-'));
  writePage('');
  writePage('guides/', { 'aek:order': '10' });
  writePage('version/', { 'aek:order': '50' });
  writePage('version/changelog/', { 'aek:order': '20' });
  writePage('issues/', { 'aek:order': '10', 'aek:navParent': 'version/' });
  writePage('issues/leak/');
};

const discover = () => {
  const diag = new HubDiagnostics();
  const tree = discoverPages(diag);
  if (!tree) throw new Error('no tree');
  return { tree, diag, page: (sitePath: string) => tree.byPath.get(sitePath)! };
};

describe('aek:navParent', () => {
  beforeEach(writeFixture);

  it('hangs the page under its nav parent, in its order, its URL and its children kept', () => {
    const { tree, diag, page } = discover();
    expect(diag.errors).toEqual([]);
    expect(tree.root.children.map((p) => p.path)).toEqual(['guides/', 'version/']);
    expect(page('version/').children.map((p) => p.path)).toEqual(['issues/', 'version/changelog/']);
    expect(page('issues/').parent).toBe(page('version/'));
    expect(page('issues/leak/').parent).toBe(page('issues/'));
    expect(tree.pages.map((p) => p.path)).toContain('issues/leak/');
  });

  it('accepts the path without its slash', () => {
    writePage('issues/', { 'aek:navParent': 'version' });
    expect(discover().page('issues/').parent?.path).toBe('version/');
  });

  it('takes it out of the top nav, and marks its nav parent active on it and its children', () => {
    const { tree, page } = discover();
    for (const active of [page('issues/'), page('issues/leak/')]) {
      const nav = renderNav(tree.root, active, '../', ICONS);
      // Not a top-level item: only in the dropdown, which the top items come before
      expect(nav.slice(0, nav.indexOf('hubNavDropdown'))).not.toContain('href="../issues/"');
      expect(nav).toContain(
        '<li class="hubNavItem hubNavItem_active hubNavItem_hasMenu"><a class="hubNavLink" href="../version/">'
      );
    }
    // In its nav parent's dropdown, at its own URL
    const nav = renderNav(tree.root, page('issues/'), '../', ICONS);
    expect(nav).toContain('<a class="hubNavLink" href="../issues/" aria-current="page">');
  });

  it('puts the nav parent in the breadcrumbs and the section', () => {
    const { page } = discover();
    const leak = page('issues/leak/');
    expect(getPageTrail(leak).map((p) => p.path)).toEqual(['', 'version/', 'issues/', leak.path]);
    expect(renderBreadcrumbs(leak, '../../')).toContain(
      '<li><a href="../../version/">version</a></li><li><a href="../../issues/">issues</a></li>'
    );
    expect(getPageSection(leak)).toBe('version/');
    expect(getPageSection(page('issues/'))).toBe('version/');
  });

  it('is an error when it names no page, and the folder stands in', () => {
    writePage('issues/', { 'aek:navParent': 'nowhere/' });
    const { diag, page } = discover();
    expect(diag.errors.map((e) => e.message)).toEqual([
      'aek:navParent: no page at hub/pages/nowhere/',
    ]);
    expect(page('issues/').parent?.path).toBe('');
  });

  it('is an error when it names the page itself or a page under it', () => {
    writePage('issues/', { 'aek:navParent': 'issues/leak/' });
    const { diag, page } = discover();
    expect(diag.errors.map((e) => e.message)).toEqual([
      'aek:navParent: /issues/leak/ is this page or under it',
    ]);
    expect(page('issues/').parent?.path).toBe('');
  });

  it('is an error in a cycle, whose pages are cut loose', () => {
    writePage('version/', { 'aek:navParent': 'issues/' });
    const { tree, diag, page } = discover();
    expect(diag.errors.map((e) => e.message)).toEqual([
      'aek:navParent: the page is in a cycle of nav parents',
      'aek:navParent: the page is in a cycle of nav parents',
    ]);
    expect(page('issues/').parent).toBeNull();
    expect(getPageTrail(page('issues/leak/')).map((p) => p.path)).toEqual([
      'issues/',
      'issues/leak/',
    ]);
    expect(tree.pages.map((p) => p.path)).toEqual(['', 'guides/']);
  });
});
