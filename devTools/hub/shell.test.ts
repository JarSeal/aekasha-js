import { describe, expect, it } from 'vitest';
import { HubDiagnostics } from './diagnostics';
import type { HubIcons } from './icons';
import {
  fillShell,
  renderBreadcrumbs,
  renderDevNav,
  renderNav,
  type HubMarkupHelpers,
  type ShellValues,
} from './shell';
import type { HubPage } from './types';

const VALUES = { root: '../', title: 'A page', body: '<p>Body</p>' } as ShellValues;

const HELPERS: HubMarkupHelpers = {
  icon: (arg) => `<svg data-icon="${arg}"></svg>`,
  asset: (arg, root) => `${root}_assets/${arg}`,
  link: (arg, root) => `${root}${arg}/`,
  sbp: () => '1 kB',
};

const fill = (shell: string) => {
  const diag = new HubDiagnostics();
  return { html: fillShell(shell, 'hub/_layout/shell.html', VALUES, HELPERS, diag), diag };
};

describe('fillShell', () => {
  it('fills values and helpers', () => {
    const { html, diag } = fill('<title>{{title}}</title>{{icon:search}}<a href="{{link:x}}">');
    expect(html).toBe('<title>A page</title><svg data-icon="search"></svg><a href="../x/">');
    expect(diag.errors).toEqual([]);
  });

  it('reports an unknown placeholder', () => {
    const { html, diag } = fill('{{nope}}');
    expect(html).toBe('');
    expect(diag.errors.map((error) => error.message)).toEqual(['Unknown placeholder {{nope}}']);
  });

  // p619 §1.4 H2: `key in values` / `key in helpers` read Object.prototype
  it.each(['{{constructor}}', '{{toString}}', '{{toString:x}}', '{{hasOwnProperty:x}}'])(
    'reports %s as unknown',
    (shell) => {
      const { html, diag } = fill(shell);
      expect(html).toBe('');
      expect(diag.errors.map((error) => error.message)).toEqual([`Unknown placeholder ${shell}`]);
    }
  );
});

// p802 D1, D3: the top-level dev pages are the header's buttons, not nav items

const ICONS = { render: (name: string) => `<svg data-icon="${name}"></svg>` } as HubIcons;

const createPage = (path: string, parent: HubPage | null, fields: Partial<HubPage> = {}) => {
  const page = {
    path,
    file: `hub/pages/${path}index.html`,
    menu: path.replace(/\/$/, '') || 'Hub',
    icon: '',
    isDev: false,
    isInMenu: true,
    parent,
    children: [],
    ...fields,
  } as unknown as HubPage;
  parent?.children.push(page);
  return page;
};

const createTree = () => {
  const home = createPage('', null);
  const guides = createPage('guides/', home);
  const project = createPage('project/', home, { isDev: true, icon: 'compass', menu: 'Project' });
  const aekasha = createPage('project/aekasha/', project, { isDev: true });
  return { home, guides, project, aekasha };
};

describe('the dev nav (p802 D3)', () => {
  it('leaves the top-level dev pages out of the nav', () => {
    const { home, guides } = createTree();
    const nav = renderNav(home, guides, '../', ICONS);
    expect(nav).toContain('href="../guides/"');
    expect(nav).not.toContain('project');
  });

  it('renders them as buttons, the one on screen with aria-current', () => {
    const { home, project } = createTree();
    expect(renderDevNav(home, project, '../', ICONS)).toBe(
      '<a class="hubDevNavLink hubDevNavLink_active" href="../project/" title="Project" aria-current="page"><svg data-icon="compass"></svg><span>Project</span></a>'
    );
  });

  it('marks it active, without aria-current, on a page under it', () => {
    const { home, aekasha } = createTree();
    const html = renderDevNav(home, aekasha, '../../', ICONS);
    expect(html).toContain('class="hubDevNavLink hubDevNavLink_active" href="../../project/"');
    expect(html).not.toContain('aria-current');
  });

  it('is empty without a dev page (a public build: its header is as before)', () => {
    const { home, guides, project } = createTree();
    home.children = home.children.filter((page) => page !== project);
    expect(renderDevNav(home, guides, '../', ICONS)).toBe('');
  });
});

describe('the breadcrumbs (p802 D1)', () => {
  it('end with the "Local only" badge on a dev page only', () => {
    const { guides, aekasha } = createTree();
    expect(renderBreadcrumbs(guides, '../')).not.toContain('Local only');
    const html = renderBreadcrumbs(aekasha, '../../');
    expect(html).toContain('class="hubBreadcrumbs hubBreadcrumbs_dev"');
    expect(html).toContain('>Local only</span></nav>');
  });
});
