import path from 'node:path';
import type { HubBuiltPage } from './build';
import type { HubDiagnostic, HubDiagnostics } from './diagnostics';
import type { HubGeneratedSection } from './generated/section';
import type { HubPageTree } from './pages';
import { HUB_PAGES_DIR } from './paths';
import type { RenderedPage } from './renderPages';
import type { HubShellPages } from './shellPages';
import type { HubPage } from './types';

/**
 * `dev`'s error pages: a page with an error is served as a page listing it, with its file and
 * line. An error in a page's own files (its folder, a generated section's sources) is that page's;
 * one that isn't any page's (the shell, the SCSS, the TS) goes on every page and the 404 page.
 */

/**
 * The page a file belongs to: a generated section's source (`pagesByFile`), else the page whose
 * folder holds it (an `.md`, an image), or null for one outside the pages
 */
const findOwnerPage = (
  file: string,
  pagesByDir: Map<string, HubPage>,
  pagesByFile: Map<string, HubPage>
) => {
  const owner = pagesByFile.get(file);
  if (owner) return owner;
  for (
    let dir = path.dirname(file);
    dir === HUB_PAGES_DIR || dir.startsWith(HUB_PAGES_DIR + path.sep);
    dir = path.dirname(dir)
  ) {
    const page = pagesByDir.get(dir);
    if (page) return page;
  }
  return null;
};

/**
 * Replaces each page that has errors with its error page, in `builtPages` (the rendered pages in
 * order, then the 404 page). Run after every shell fill, so the errors are complete.
 */
export const applyErrorPages = (opts: {
  rendered: RenderedPage[];
  builtPages: HubBuiltPage[];
  sections: HubGeneratedSection[];
  tree: HubPageTree | null;
  diag: HubDiagnostics;
  shellPages: HubShellPages;
}) => {
  const { rendered, builtPages, tree, diag, shellPages } = opts;
  const pagesByDir = new Map(
    rendered.filter(({ page }) => !page.isGenerated).map(({ page }) => [page.dir, page])
  );
  // A section's sources are its page's, and a generated page's own source is that page's
  const pagesByFile = new Map<string, HubPage>();
  for (const section of opts.sections) {
    const page = tree?.byPath.get(section.path);
    if (page) for (const file of section.files) pagesByFile.set(file, page);
  }
  for (const { page } of rendered) if (page.isGenerated) pagesByFile.set(page.file, page);
  const errorsByPage = new Map<HubPage | null, HubDiagnostic[]>();
  for (const error of diag.errors) {
    const owner = findOwnerPage(error.file, pagesByDir, pagesByFile);
    errorsByPage.set(owner, [...(errorsByPage.get(owner) ?? []), error]);
  }
  const siteErrors = errorsByPage.get(null) ?? [];
  rendered.forEach((item, i) => {
    const errors = [...(errorsByPage.get(item.page) ?? []), ...siteErrors];
    if (!errors.length) return;
    builtPages[i] = {
      ...builtPages[i],
      html: shellPages.errorPage(item, errors),
      isErrorPage: true,
    };
  });
  if (siteErrors.length || !tree) {
    // Without a page tree, the errors are the discovery's, which no page could list
    const last = builtPages.length - 1;
    const html = shellPages.errorPage(null, tree ? siteErrors : diag.errors);
    builtPages[last] = { ...builtPages[last], html, isErrorPage: true };
  }
};
