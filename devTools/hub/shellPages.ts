import hubConfig from '../../hub/hub.config';
import type { ProjectMetadata } from '../projectMetadata';
import type { HubAssetFile } from './assets';
import { HUB_API_REBUILDING_PAGE, HUB_DEV_META, HUB_DEV_SOCKET_PLACEHOLDER } from './devProtocol';
import type { HubDiagnostic, HubDiagnostics } from './diagnostics';
import { getRepoWebUrl } from './generated/home';
import { escapeHtml } from './html';
import type { HubIcons } from './icons';
import { getPageSection, type HubPageTree } from './pages';
import { HUB_SHELL_FILE, toRepoPath } from './paths';
import type { RenderedPage } from './renderPages';
import {
  fillShell,
  renderBreadcrumbs,
  renderNav,
  renderToc,
  type HubMarkupHelpers,
  type ShellPageValues,
  type ShellSiteValues,
} from './shell';
import type { HubPage } from './types';

/**
 * A build's pages in the shell (`hub/_layout/shell.html`): the rendered pages, the 404 page, the
 * dev error pages and the page the dev plugin serves while the API docs rebuild. Every page gets
 * the same site values (the menu with its active item, the asset URLs with their `?v=`), relative
 * to its own root.
 */

/**
 * The 404 page is served at any depth, so its links resolve against a `<base>`: the site root's
 * absolute path, `/` by default. `rebaseNotFoundPage` moves a built one (`AEK_HUB_IN_DIST`'s
 * `dist/hub/`, `yarn hub:preview --base`).
 */
const notFoundBaseTag = (basePath: string) => `<base href="${escapeHtml(basePath)}" />`;

export const rebaseNotFoundPage = (html: string, basePath: string) =>
  html.replace(/<base href="[^"]*" \/>/, notFoundBaseTag(basePath));

/** `dev`: the body of the page the dev plugin serves for an API page while the API docs rebuild */
const API_REBUILDING_BODY = `<h1>Rebuilding the API documentation…</h1>
<p>An engine or toolkit source changed since the API documentation was built. TypeDoc is reading the sources again, which takes a few seconds: this page reloads by itself when it’s done.</p>
<p>The other Hub pages load as usual meanwhile.</p>
`;

const renderErrorBody = (errors: HubDiagnostic[]) => {
  const items = errors.map(
    ({ file, line, message }) =>
      `<li><code>${escapeHtml(toRepoPath(file))}${line ? `:${line}` : ''}</code> ${escapeHtml(message)}</li>`
  );
  return `<h1>Build error</h1>
<p>This page didn't build. Fix ${errors.length === 1 ? 'the error' : 'the errors'} and save: the page reloads by itself.</p>
<ul class="hubBuildErrors">${items.join('')}</ul>`;
};

/** A build's shell pages: each call fills the shell once (its diagnostics go to `diag`) */
export type HubShellPages = {
  page: (item: RenderedPage) => string;
  notFound: () => string;
  /** `dev`: the rebuilding page, at any depth like the 404 page */
  apiRebuilding: () => string;
  /** `dev`: a page (or, for null, the 404 page) replaced by its errors */
  errorPage: (item: RenderedPage | null, errors: HubDiagnostic[]) => string;
};

export const createShellPages = (opts: {
  shell: string;
  notFoundBody: string;
  helpers: HubMarkupHelpers;
  diag: HubDiagnostics;
  tree: HubPageTree | null;
  icons: HubIcons;
  meta: ProjectMetadata;
  styles: HubAssetFile | null;
  scripts: HubAssetFile[] | null;
  search: HubAssetFile | null;
  /** `dev`: the dev client every page loads */
  devClient: HubAssetFile | undefined;
  /** The 404 page's `<base>` */
  basePath: string;
}): HubShellPages => {
  const { tree, meta, devClient } = opts;
  const assetUrl = (root: string, file: HubAssetFile | null | undefined) =>
    file ? `${root}${file.outPath}?v=${file.hash}` : '';
  const hubJs = opts.scripts?.find((file) => file.outPath === '_assets/hub.js');

  const siteValues = (root: string, page: HubPage | null): ShellSiteValues => ({
    root,
    siteTitle: escapeHtml(hubConfig.title),
    head: devClient
      ? `<meta name="${HUB_DEV_META}" content="${HUB_DEV_SOCKET_PLACEHOLDER}" />
    <script type="module" src="${assetUrl(root, devClient)}"></script>`
      : '',
    nav: tree ? renderNav(tree.root, page, root, opts.icons) : '',
    css: assetUrl(root, opts.styles),
    js: assetUrl(root, hubJs),
    searchJs: assetUrl(root, opts.search),
    engineVersion: meta.engine.version,
    githubUrl: escapeHtml(getRepoWebUrl(meta)),
  });

  const pageValues = ({ page, env, body }: RenderedPage): ShellPageValues => {
    const isHome = page === tree?.root;
    const section = getPageSection(page);
    return {
      title: escapeHtml(isHome ? hubConfig.title : `${page.title} · ${hubConfig.title}`),
      pageTitle: escapeHtml(page.title),
      description: escapeHtml(page.description || (isHome ? hubConfig.description : '')),
      pagePath: page.path,
      section,
      bodyClass: `hubPage_${section.replace(/\/$/, '') || 'home'}`,
      breadcrumbs: renderBreadcrumbs(page, env.root),
      // The homepage's sections are its layout, not a document to jump around in
      toc: isHome ? '' : renderToc(env.headings),
      body,
    };
  };
  const notFoundValues: ShellPageValues = {
    title: escapeHtml(`Page not found · ${hubConfig.title}`),
    pageTitle: 'Page not found',
    description: '',
    pagePath: '404',
    section: '404',
    bodyClass: 'hubPage_404',
    breadcrumbs: '',
    toc: '',
    body: opts.notFoundBody,
  };
  const baseTag = notFoundBaseTag(opts.basePath);

  const fill = (root: string, page: HubPage | null, values: ShellPageValues, head = '') => {
    const site = siteValues(root, page);
    return fillShell(
      opts.shell,
      HUB_SHELL_FILE,
      { ...site, head: [head, site.head].filter(Boolean).join('\n    '), ...values },
      opts.helpers,
      opts.diag
    );
  };
  const errorValues = (errors: HubDiagnostic[], values: ShellPageValues): ShellPageValues => ({
    ...values,
    title: escapeHtml(`Build error · ${hubConfig.title}`),
    bodyClass: 'hubPage_error',
    toc: '',
    body: renderErrorBody(errors),
  });

  return {
    page: (item) => fill(item.env.root, item.page, pageValues(item)),
    notFound: () => fill('', null, notFoundValues, baseTag),
    apiRebuilding: () =>
      fill(
        '',
        null,
        {
          ...notFoundValues,
          title: escapeHtml(`Rebuilding the API documentation · ${hubConfig.title}`),
          pageTitle: 'Rebuilding the API documentation',
          pagePath: HUB_API_REBUILDING_PAGE,
          bodyClass: 'hubPage_apiRebuilding',
          body: API_REBUILDING_BODY,
        },
        baseTag
      ),
    errorPage: (item, errors) =>
      item
        ? fill(item.env.root, item.page, errorValues(errors, pageValues(item)))
        : fill('', null, errorValues(errors, notFoundValues), baseTag),
  };
};
