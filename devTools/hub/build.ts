import fs from 'node:fs';
import hubConfig from '../../hub/hub.config';
import { getProjectMetadata, type ProjectMetadata } from '../projectMetadata';
import {
  buildScripts,
  buildStyles,
  createStaticAssetHasher,
  HUB_DEV_CLIENT_OUT_PATH,
  type HubAssetFile,
} from './assets';
import { createApiSection, type ApiBuildStats, type ApiModelSource } from './api/render';
import { cardsDirective } from './cards';
import { createHubEmbedState, embedDirective } from './embed';
import { checkClaudeMdCoverage, claudeMdDirective } from './claudeMd';
import { codeGroupDirective, hubCodePlugin, loadHubHighlighter } from './code';
import { applyErrorPages } from './errorPages';
import { buildSearchIndex, checkSearchIndexSize } from './search';
import { readSbpReport } from './sbp';
import { SBP_REPORT_FILE } from '../sbp/report';
import { createHomeSection, getRepoWebUrl } from './generated/home';
import { createIssuesSection } from './generated/issues';
import type { HubGeneratedSection } from './generated/section';
import { createVersionSection } from './generated/version';
import { HubDiagnostics } from './diagnostics';
import { loadHubIcons } from './icons';
import { createHubMarkdown, type HubDirectives, type HubRenderContext } from './markdown';
import { getHubOutDirError } from './outDir';
import { discoverPages, removeDevPages } from './pages';
import { loadAppScenes, sceneDirective } from './scenes';
import {
  FAVICON_FILES,
  HUB_NOT_FOUND_FILE,
  HUB_SHELL_FILE,
  HUB_STATIC_ASSET_DIRS,
  PACKAGE_JSON_FILE,
} from './paths';
import { checkLinks, createMarkupHelpers, renderHubPages, type RenderedPage } from './renderPages';
import { createShellPages } from './shellPages';
import type { HubBuildMode } from './types';
import { writeHubOutputAsync } from './writeOutput';

/**
 * Builds the Hub: `hub/` → static pages in `outDir`. `public` (`yarn hub:build` → `dist-hub/`)
 * replaces `outDir` only when there's no error, and throws before building for an `outDir` it may
 * not replace (`getHubOutDirError`). `dev` (the dev plugin, `devTools/hubPlugin.ts`) writes every
 * page, and a page with an error becomes an error page listing it (`errorPages.ts`). Dev pages
 * also load the dev client.
 *
 * The steps, in order: the generated sections and the page tree, the markup helpers and the
 * assets (`assets.ts`), the page bodies and their links (`renderPages.ts`), the search
 * (`search.ts`), the shell around every page (`shellPages.ts`), then the writes
 * (`writeOutput.ts`).
 */

export type HubBuildAssets = {
  styles: HubAssetFile | null;
  /** The files sass read for `styles` (`HubBuiltStyles.sources`), in the build's `files` */
  styleSources: string[];
  scripts: HubAssetFile[] | null;
  /** Both built without an error (not a fallback): `reuseAssets` takes only such ones */
  isClean: boolean;
};

/** What `buildHub` takes */
export type HubBuildOptions = {
  mode: HubBuildMode;
  outDir: string;
  /** The site root's absolute URL path, for the 404 page's `<base>` (default `/`) */
  basePath?: string;
  /** `dev`: the last build's assets, kept when this build's fail, so error pages keep styles */
  fallback?: HubBuildAssets;
  /**
   * `dev`: `fallback`'s styles and scripts stand, when they built clean (p619 D16: sass and Vite's
   * `build()` were a rebuild's next largest steps). The dev runner asks for it when no file under
   * `hub/_assets/` changed.
   */
  reuseAssets?: boolean;
  /**
   * The build's commit, local changes and time the Version page shows (default:
   * now's). The dev plugin passes its first build's, so a rebuild doesn't change the Version page
   * by itself: an edit and its undo flipped "local changes" and reloaded it (p619 §1.4 H3).
   */
  build?: ProjectMetadata['build'];
  /** The API docs' model: `current` by default, `last` in the dev plugin */
  api?: ApiModelSource;
  /**
   * `public`: `::: embed` runs its profile live (copied into `_assets/embed/`), the default, or
   * shows its poster only (`yarn hub:build --no-embed`). `dev` always runs it from the source.
   */
  isEmbedLive?: boolean;
};

/** A page as the build wrote it (the dev plugin compares them between runs) */
export type HubBuiltPage = {
  /** The page's site path ('' the homepage), '404' for the 404 page */
  path: string;
  /** From `outDir`: `examples/index.html`, `404.html` */
  outPath: string;
  html: string;
  /** `dev`: an error page stands in for it */
  isErrorPage: boolean;
};

/**
 * A build's outcome: its diagnostics, pages, assets, sources (the dev plugin's watcher) and numbers
 */
export type HubBuildResult = {
  isOk: boolean;
  diag: HubDiagnostics;
  pageCount: number;
  durationMs: number;
  /**
   * Each step's time in ms, in order (`meta`, `sections`, `discover`, `styles`, `scripts`,
   * `render`, `search`, `shell`, `write`): the dev plugin's log, and D16's measurements
   */
  steps: Record<string, number>;
  /** Every source file the build read, for the dev plugin's watcher */
  files: string[];
  /** Folders whose added and removed files change the build (`docs/issues/`) */
  dirs: string[];
  /** The pages and the 404 page as written; empty when nothing was */
  pages: HubBuiltPage[];
  assets: HubBuildAssets;
  /**
   * The search payload's size and `gzip -9` size (`hub:build` reports them; `dev` doesn't measure
   * gzip), its documents and how many of them are page sections (the rest are the API's), null
   * when not built
   */
  search: {
    bytes: number;
    gzipBytes: number | null;
    docCount: number;
    pageDocCount: number;
  } | null;
  /** The API docs: whether the model was reused, its size, null when it didn't build */
  api: ApiBuildStats | null;
  /** `api: 'last'`: the model is older than its inputs, or there's none yet */
  isApiStale: boolean;
  /**
   * `dev`: the page served for an API page while the API docs rebuild, at any depth
   * like the 404 page; not written
   */
  apiRebuildingHtml: string | null;
};

/** The directives besides the Markdown's own (the callouts, `dev-only`), each its module's */
const HUB_DIRECTIVES: HubDirectives = {
  'code-group': codeGroupDirective,
  scene: sceneDirective,
  embed: embedDirective,
  cards: cardsDirective,
  'claude-md': claudeMdDirective,
};

/** Reads on the first call only: a build reads the SBP report and the scenes if a page shows them */
const memoize = <T>(read: () => T) => {
  let value: { value: T } | null = null;
  return () => (value ??= { value: read() }).value;
};

/** Every source file the build read, for the dev plugin's watcher */
const collectSourceFiles = (opts: {
  treeFiles: string[];
  sectionFiles: string[];
  coverageFiles: string[];
  pageImageFiles: string[];
  rendered: RenderedPage[];
}) => [
  ...new Set([
    ...opts.treeFiles,
    HUB_SHELL_FILE,
    HUB_NOT_FOUND_FILE,
    PACKAGE_JSON_FILE,
    ...opts.sectionFiles,
    ...opts.coverageFiles,
    ...FAVICON_FILES,
    ...opts.rendered.flatMap(({ env }) => env.images.map((job) => job.source)),
    // Snippet includes and scenes: an edit to one rebuilds, and reloads the pages that show it
    ...opts.rendered.flatMap(({ env }) => env.includes),
    ...opts.pageImageFiles,
    // `{{sbp:…}}`: a `yarn sbp` run rebuilds the pages that show its numbers
    SBP_REPORT_FILE,
  ]),
];

/** The generated sections, in the order their pages are discovered */
const createSectionsAsync = async (
  meta: ProjectMetadata,
  mode: HubBuildMode,
  apiModel: ApiModelSource,
  diag: HubDiagnostics
) => {
  const version = createVersionSection(meta, diag);
  const api = await createApiSection({ mode, diag, meta, model: apiModel });
  const sections: HubGeneratedSection[] = [
    createHomeSection(meta, version.latestChange),
    createIssuesSection(diag),
    version.section,
    api.section,
  ];
  return { sections, api };
};

/**
 * Builds the Hub into `outDir` (see the module's comment); never throws for a page's error, only
 * for an `outDir` it may not replace or a failed write
 */
export const buildHub = async ({
  mode,
  outDir,
  basePath = '/',
  fallback,
  reuseAssets = false,
  build,
  api: apiModel = 'current',
  isEmbedLive = true,
}: HubBuildOptions): Promise<HubBuildResult> => {
  const startTime = performance.now();
  const steps: Record<string, number> = {};
  let lapTime = startTime;
  /** Ends a step: its time since the last one's end */
  const lap = (step: string) => {
    const now = performance.now();
    steps[step] = (steps[step] ?? 0) + now - lapTime;
    lapTime = now;
  };
  // Before the build's work: a folder the build may not replace throws (p619 §1.4 H1)
  if (mode === 'public') {
    const outDirError = getHubOutDirError(outDir);
    if (outDirError) throw new Error(outDirError);
  }
  const diag = new HubDiagnostics();
  let rendered: RenderedPage[] = [];
  const builtPages: HubBuiltPage[] = [];
  let assets: HubBuildAssets = { styles: null, styleSources: [], scripts: null, isClean: false };
  const meta = getProjectMetadata(build);
  lap('meta');
  const { sections, api } = await createSectionsAsync(meta, mode, apiModel, diag);
  lap('sections');
  let searchStats: HubBuildResult['search'] = null;
  let apiRebuildingHtml: string | null = null;
  const result = (files: string[]): HubBuildResult => ({
    isOk: diag.errors.length === 0,
    diag,
    pageCount: rendered.length,
    durationMs: performance.now() - startTime,
    steps,
    files: [...new Set([...files, ...assets.styleSources])],
    // The static folders outside hub/ (the engine's fonts), which hub/'s own watch doesn't see
    dirs: [...sections.flatMap((section) => section.dirs), ...Object.values(HUB_STATIC_ASSET_DIRS)],
    pages: builtPages,
    assets,
    search: searchStats,
    api: api.stats,
    isApiStale: api.isStale,
    apiRebuildingHtml,
  });

  const tree = discoverPages(diag, sections);
  // The coverage counts the dev pages, in both modes (p802 D4); a public build then drops them
  const coverageFiles = tree
    ? checkClaudeMdCoverage(tree.pages, hubConfig.coverageIgnore, diag)
    : [];
  if (tree && mode === 'public') removeDevPages(tree);
  const icons = loadHubIcons(diag);
  const hashStaticAsset = createStaticAssetHasher();
  const getSbpReport = memoize(readSbpReport);
  const helpers = createMarkupHelpers({ mode, diag, icons, tree, hashStaticAsset, getSbpReport });
  lap('discover');
  if (reuseAssets && fallback?.isClean) {
    assets = fallback;
  } else {
    const styles = buildStyles(mode, diag, hashStaticAsset);
    lap('styles');
    const scripts = await buildScripts(mode, diag);
    assets = {
      styles: styles?.file ?? fallback?.styles ?? null,
      // A failed compile has none: the last good one's, so a fix in an engine file is still seen
      styleSources: styles?.sources ?? fallback?.styleSources ?? [],
      scripts: scripts ?? fallback?.scripts ?? null,
      isClean: !!styles && !!scripts,
    };
  }
  lap('scripts');
  // `dev` still writes the 404 page, as the error page every URL gets
  const sectionFiles = sections.flatMap((section) => section.files);
  if (!tree && mode === 'public') return result(sectionFiles);

  // The pages
  const context: HubRenderContext = {
    mode,
    icons,
    apiLinks: api.links,
    getAppScenes: memoize(loadAppScenes),
    getSbpReport,
    embeds: createHubEmbedState(mode === 'dev' || isEmbedLive),
    repoBlobUrl: `${getRepoWebUrl(meta)}/blob/${meta.build.commit || 'main'}/`,
    tree,
  };
  let pageImageFiles: string[] = [];
  if (tree) {
    const md = createHubMarkdown(HUB_DIRECTIVES).use(hubCodePlugin, {
      highlighter: await loadHubHighlighter(),
      icons,
    });
    ({ rendered, pageImageFiles } = renderHubPages({ tree, sections, md, helpers, context, diag }));
    checkLinks(rendered, tree, api.areApiPagesUnchecked, diag);
  }
  lap('render');

  // The search, then the shell around every page
  const search = tree
    ? buildSearchIndex(
        tree.root,
        rendered.map(({ page, body, env }) => ({ page, body, headings: env.headings })),
        sections.flatMap((section) => section.searchDocs ?? []),
        // The dev server's rebuilds skip it: the warning is `yarn hub:build`'s
        { isGzipMeasured: mode === 'public' }
      )
    : null;
  if (search) {
    const { content, gzipBytes, docCount, pageDocCount } = search;
    searchStats = { bytes: content.length, gzipBytes, docCount, pageDocCount };
    checkSearchIndexSize(search, diag);
  }
  lap('search');
  const shellPages = createShellPages({
    shell: fs.readFileSync(HUB_SHELL_FILE, 'utf-8'),
    notFoundBody: fs.readFileSync(HUB_NOT_FOUND_FILE, 'utf-8'),
    helpers,
    diag,
    tree,
    icons,
    meta,
    styles: assets.styles,
    scripts: assets.scripts,
    search,
    devClient:
      mode === 'dev'
        ? assets.scripts?.find((file) => file.outPath === HUB_DEV_CLIENT_OUT_PATH)
        : undefined,
    basePath,
  });
  for (const item of rendered) {
    const { path } = item.page;
    builtPages.push({
      path,
      outPath: `${path}index.html`,
      html: shellPages.page(item),
      isErrorPage: false,
    });
  }
  builtPages.push({
    path: '404',
    outPath: '404.html',
    html: shellPages.notFound(),
    isErrorPage: false,
  });
  if (mode === 'dev') {
    apiRebuildingHtml = shellPages.apiRebuilding();
    // Every fillShell has run, so the errors are complete
    if (diag.errors.length)
      applyErrorPages({ rendered, builtPages, sections, tree, diag, shellPages });
  }

  lap('shell');
  const sourceFiles = collectSourceFiles({
    treeFiles: tree?.files ?? [],
    sectionFiles,
    coverageFiles,
    pageImageFiles,
    rendered,
  });
  if (mode === 'public' && diag.errors.length) {
    builtPages.length = 0;
    return result(sourceFiles);
  }
  const isWritten = await writeHubOutputAsync({
    mode,
    outDir,
    pages: builtPages,
    files: [assets.styles, search, ...(assets.scripts ?? [])],
    images: rendered.flatMap(({ env }) => env.images),
    embeds: context.embeds,
    diag,
    isStaticCurrent: mode === 'dev' && reuseAssets && !!fallback,
  });
  if (!isWritten) builtPages.length = 0;
  lap('write');
  return result(sourceFiles);
};
