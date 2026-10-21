import path from 'node:path';
import type { ProjectMetadata } from '../../projectMetadata';
import { loadHubHighlighter } from '../code';
import { HubDiagnostics, type HubDiagnostic } from '../diagnostics';
import type { HubGeneratedPage, HubGeneratedSection, HubSlotGenerator } from '../generated/section';
import { hashContent } from '../hash';
import { escapeHtml } from '../html';
import { uniqueId, type HubApiLinkResolver, type HubImageJob, type HubLinkRef } from '../markdown';
import { ROOT, TSCONFIG_FILE } from '../paths';
import { toRepoWebUrl } from '../repoFiles';
import type { HubBuildMode, HubHeading } from '../types';
import { getSearchDocs } from './apiSearch';
import { linkName } from './comments';
import {
  ACCEPTED_LEAKS,
  findLeakedTypes,
  indexEntries,
  type ApiEntryIndex,
  type LeakedType,
  type LeakNamer,
} from './entries';
import { getLastApiModel, loadApiModel, type ApiEntry, type ApiExtractMessage } from './extract';
import { getApiLinks, type ApiLinks } from './links';
import {
  API_SECTION_PATH,
  API_SUBTREES,
  indexApiModel,
  Kind,
  listFolders,
  type ApiFolder,
  type ApiIndex,
  type ApiModule,
  type Coverage,
} from './model';
import {
  commentLinks,
  getModuleSummary,
  heading,
  href,
  isForeignTarget,
  renderCoverage,
  renderInline,
  renderSymbol,
  resolveCommentLink,
  sectionHeading,
  toPlainText,
  type Ctx,
  type SourceLink,
} from './renderSymbol';

/**
 * The Documentation section (p553 §2.2): the engine's and the toolkit's API as Hub pages, from
 * the API model (`extract.ts`). A generated section on `documentation/`: its landing slot lists
 * the modules by folder with their coverage, then an A-Z index; each folder and each module gets
 * a page. A module page has a section per kind (functions, classes, interfaces, type aliases,
 * enums, variables), and each symbol its anchor (`#loadScene`), its signature, its comment, its
 * parameters, and a link to its source (GitHub at the build's commit, or the editor in dev).
 * This module makes the pages and the section; a symbol's rendering is `renderSymbol.ts`, the
 * search's documents `apiSearch.ts`.
 *
 * Rendering the whole API takes about a second (shiki and Markdown for every symbol), so each
 * slot's output is kept in memory for the same model, mode and commit: the dev plugin's
 * rebuilds of other pages stay fast.
 */

const LANDING_SLOT = 'generated-api';
const PAGE_SLOT = 'generated-api-page';
const DESCRIPTION_LENGTH = 200;

const shorten = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max).replace(/\s+\S*$/, '')}…`;

/**
 * Where a build's API model comes from (§2.5): `current` converts when its inputs changed (the
 * public build), `last` takes the last good one whatever its inputs (the dev plugin, which
 * rebuilds it in a child process), `none` builds no API docs (`hub:build --no-api`)
 */
export type ApiModelSource = 'current' | 'last' | 'none';

export type ApiBuildStats = {
  isCached: boolean;
  extractMs: number;
  moduleCount: number;
  symbolCount: number;
  coverage: Coverage;
};

export type ApiSectionResult = {
  section: HubGeneratedSection;
  /** Null when the model didn't build or there's none (`none`, or `last` before any) */
  stats: ApiBuildStats | null;
  /** Every page's `api:` links (§2.3), null when the model didn't build */
  links: HubApiLinkResolver | null;
  /** `last`: the model is older than its inputs (an old cache file), or there's none yet */
  isStale: boolean;
  /**
   * No model to check links against (`none`, or `last` before any): `hub:` links to the API pages
   * aren't checked either, like `api:` links
   */
  areApiPagesUnchecked: boolean;
};

// --- Memo ---

/** What a slot's render added to its page's env, so a memo hit replays it */
type SlotRecord = {
  html: string;
  headings: HubHeading[];
  ids: string[];
  links: HubLinkRef[];
  images: HubImageJob[];
  includes: string[];
  diagnostics: HubDiagnostic[];
};

let memoKey = '';
const memo = new Map<string, SlotRecord>();

/** Same model, mode and commit: the same pages. Anything else drops the memo. */
const resetMemo = (key: string) => {
  if (key === memoKey) return;
  memoKey = key;
  memo.clear();
};

/** The slot's output, rendered once per memo key and the ids the page already had */
const memoized =
  (key: string, generate: HubSlotGenerator): HubSlotGenerator =>
  (md, env) => {
    const fullKey = `${key}\0${hashContent([...env.ids].join('\0'))}`;
    const hit = memo.get(fullKey);
    if (hit) {
      env.headings.push(...hit.headings);
      for (const id of hit.ids) env.ids.add(id);
      env.links.push(...hit.links);
      env.images.push(...hit.images);
      env.includes.push(...hit.includes);
      replayDiagnostics(env.diag, hit.diagnostics);
      return hit.html;
    }
    const before = {
      headings: env.headings.length,
      ids: new Set(env.ids),
      links: env.links.length,
      images: env.images.length,
      includes: env.includes.length,
    };
    const diag = env.diag;
    const local = new HubDiagnostics();
    env.diag = local;
    let html: string;
    try {
      html = generate(md, env);
    } finally {
      env.diag = diag;
    }
    replayDiagnostics(diag, local.items);
    memo.set(fullKey, {
      html,
      headings: env.headings.slice(before.headings),
      ids: [...env.ids].filter((id) => !before.ids.has(id)),
      links: env.links.slice(before.links),
      images: env.images.slice(before.images),
      includes: env.includes.slice(before.includes),
      diagnostics: local.items,
    });
    return html;
  };

const replayDiagnostics = (diag: HubDiagnostics, items: HubDiagnostic[]) => {
  for (const { level, file, line, message } of items) {
    if (level === 'error') diag.error(file, line, message);
    else diag.warn(file, line, message);
  }
};

// --- Pages ---

const SECTIONS: { title: string; id: string; kinds: number[] }[] = [
  { title: 'Functions', id: 'functions', kinds: [Kind.Function] },
  { title: 'Classes', id: 'classes', kinds: [Kind.Class] },
  { title: 'Interfaces', id: 'interfaces', kinds: [Kind.Interface] },
  { title: 'Type aliases', id: 'type-aliases', kinds: [Kind.TypeAlias] },
  { title: 'Enums', id: 'enums', kinds: [Kind.Enum] },
  { title: 'Variables', id: 'variables', kinds: [Kind.Variable] },
  { title: 'Namespaces', id: 'namespaces', kinds: [Kind.Namespace, Kind.Module] },
  { title: 'Re-exports', id: 're-exports', kinds: [Kind.Reference] },
];

const renderModuleList = (ctx: Ctx, modules: ApiModule[]) => {
  if (!modules.length) return '';
  const items = modules.map((module) => {
    ctx.file = module.file;
    const summary = renderInline(ctx, getModuleSummary(module, commentLinks(ctx)));
    return `<li><div class="hubApiListHead"><a href="${escapeHtml(href(ctx, module.pagePath))}"><code>${escapeHtml(path.posix.basename(module.relPath))}</code></a>${renderCoverage(module.coverage)}</div>${summary ? `<p class="hubApiSummary">${summary}</p>` : ''}</li>`;
  });
  return `<ul class="hubApiList">${items.join('')}</ul>\n`;
};

const renderFolderList = (ctx: Ctx, folders: ApiFolder[]) => {
  if (!folders.length) return '';
  const items = folders.map((folder) => {
    const count = listFolders(folder).reduce((n, f) => n + f.modules.length, 0);
    return `<li><div class="hubApiListHead"><a href="${escapeHtml(href(ctx, folder.pagePath))}"><code>${escapeHtml(path.posix.basename(folder.relPath))}/</code></a>${renderCoverage(folder.totalCoverage)}</div><p class="hubApiSummary">${count} module${count === 1 ? '' : 's'}</p></li>`;
  });
  return `<ul class="hubApiList">${items.join('')}</ul>\n`;
};

/** A folder's contents: its subfolders and its modules */
const renderFolderContents = (ctx: Ctx, folder: ApiFolder, ownModule: ApiModule | null) => {
  const modules = folder.modules.filter((module) => module !== ownModule);
  let html = '';
  if (folder.folders.length) {
    html += sectionHeading(ctx, 'Folders', 'folders') + renderFolderList(ctx, folder.folders);
  }
  if (modules.length) {
    html += sectionHeading(ctx, 'Modules', 'modules') + renderModuleList(ctx, modules);
  }
  return html;
};

const renderPathLine = (sourcePath: string, coverage: Coverage) =>
  `<p class="hubApiPath"><code>${escapeHtml(sourcePath)}</code>${renderCoverage(coverage)}</p>\n`;

const renderModulePage = (ctx: Ctx, module: ApiModule, folder: ApiFolder | null) => {
  ctx.file = module.file;
  let html = renderPathLine(module.sourcePath, module.coverage);
  if (folder) {
    html += `<p>This module sits next to its folder, <code>${escapeHtml(folder.sourcePath)}/</code>, so its page lists the folder too.</p>\n`;
    html += renderFolderContents(ctx, folder, module);
  }
  if (!module.symbols.length) html += '<p>This module exports nothing.</p>\n';
  for (const section of SECTIONS) {
    const symbols = module.symbols
      .filter((symbol) => section.kinds.includes(symbol.kind))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (!symbols.length) continue;
    html += sectionHeading(ctx, section.title, section.id);
    for (const symbol of symbols) {
      ctx.file = module.file;
      html += renderSymbol(ctx, symbol);
    }
  }
  return `<div class="hubApi">\n${html}</div>\n`;
};

const renderFolderPage = (ctx: Ctx, folder: ApiFolder) => {
  ctx.file = path.join(ROOT, folder.sourcePath);
  const html =
    renderPathLine(`${folder.sourcePath}/`, folder.totalCoverage) +
    renderFolderContents(ctx, folder, null);
  return `<div class="hubApi">\n${html}</div>\n`;
};

/** Every symbol, A-Z by first letter, with its module */
const renderAzIndex = (ctx: Ctx) => {
  const entries = ctx.index.modules
    .flatMap((module) =>
      module.symbols
        .filter((symbol) => symbol.kind !== Kind.Reference)
        .map((symbol) => ({ symbol, module, target: ctx.index.targets.get(symbol.id)! }))
    )
    .sort(
      (a, b) =>
        a.symbol.name.localeCompare(b.symbol.name, 'en', { sensitivity: 'base' }) ||
        a.module.pagePath.localeCompare(b.module.pagePath)
    );
  const groups = new Map<string, typeof entries>();
  for (const entry of entries) {
    const first = entry.symbol.name.charAt(0).toUpperCase();
    const letter = /[A-Z]/.test(first) ? first : '#';
    groups.set(letter, [...(groups.get(letter) ?? []), entry]);
  }
  const letters = [...groups.keys()].sort((a, b) =>
    a === '#' ? -1 : b === '#' ? 1 : a.localeCompare(b)
  );
  const ids = new Map(
    letters.map((letter) => [
      letter,
      uniqueId(ctx.env, `az-${letter === '#' ? 'other' : letter.toLowerCase()}`),
    ])
  );
  const bar = letters
    .map((letter) => `<a href="#${ids.get(letter)}">${escapeHtml(letter)}</a>`)
    .join('');
  const lists = letters.map((letter) => {
    const items = groups
      .get(letter)!
      .map(
        ({ symbol, module, target }) =>
          `<li><a href="${escapeHtml(href(ctx, module.pagePath, target.anchor))}">${escapeHtml(symbol.name)}</a><span class="hubApiAzModule">${escapeHtml(module.subtree === 'engine' ? module.relPath : `${module.subtree}/${module.relPath}`)}</span></li>`
      );
    return `<p class="hubApiAzLetter" id="${ids.get(letter)}">${escapeHtml(letter)}</p><ul class="hubApiAzList">${items.join('')}</ul>`;
  });
  return `${sectionHeading(ctx, 'A–Z index', 'a-z-index')}<p class="hubApiLetters">${bar}</p>\n${lists.join('\n')}\n`;
};

/** `documentation/`'s slot: each subtree's modules by folder, then the A-Z index */
const renderLanding = (ctx: Ctx) => {
  let html = '';
  for (const { id, title, sourceDir } of API_SUBTREES) {
    const root = ctx.index.roots[id];
    const total = ctx.index.coverage[id];
    html += sectionHeading(ctx, title, id);
    html += `<p class="hubApiPath"><a href="${escapeHtml(href(ctx, root.pagePath))}"><code>${escapeHtml(sourceDir)}/</code></a>${renderCoverage(total)}</p>\n`;
    for (const folder of listFolders(root)) {
      const modules = folder.module ? [folder.module, ...folder.modules] : folder.modules;
      if (!modules.length) continue;
      const label = folder.relPath ? `${folder.relPath}/` : 'Top level';
      const inner = `<a href="${escapeHtml(href(ctx, folder.pagePath))}">${escapeHtml(label)}</a>${renderCoverage(folder.coverage)}`;
      html += heading(
        ctx,
        3,
        uniqueId(
          ctx.env,
          `${id}-${folder.relPath || 'top-level'}`.replace(/[^\w-]+/g, '-').toLowerCase()
        ),
        label,
        inner
      );
      html += renderModuleList(ctx, modules);
    }
  }
  html += renderAzIndex(ctx);
  // The section's symbols get their own search entries (Phase 2): the lists aren't indexed
  return `<div class="hubApi hubSearchSkip">\n${html}</div>\n`;
};

// --- The section ---

/**
 * A symbol's source: GitHub at the build's commit (`public`), or the file at its line in the
 * editor through Vite's `/__open-in-editor` (`dev`, which `hub.ts` fetches instead of following)
 */
const createSourceLink = (mode: HubBuildMode, meta: ProjectMetadata): SourceLink => {
  const repo = toRepoWebUrl(meta.engine.repoUrl);
  const ref = meta.build.commit || 'main';
  return ({ fileName, line }) => {
    const label = escapeHtml(`${fileName}:${line}`);
    if (mode === 'dev') {
      const file = encodeURIComponent(`${path.join(ROOT, fileName)}:${line}`);
      return `<a href="/__open-in-editor?file=${file}" data-hub-open-in-editor title="Open in your editor">${label}</a>`;
    }
    const url = `${repo}/blob/${ref}/${fileName}#L${line}`;
    return `<a class="hubApiSourceGitHub" href="${escapeHtml(url)}" title="The source on GitHub" rel="noopener">${label}</a>`;
  };
};

/**
 * The `{@link}`s that link nowhere, once per build (not per render: a module's summary is on
 * several pages). Another package's symbol (three's) is fine as text.
 */
const reportCommentLinks = (diag: HubDiagnostics, index: ApiIndex, links: ApiLinks) => {
  for (const { part, ownerId, fileName, line } of links.namedLinks) {
    if (typeof part.target === 'string' || isForeignTarget(index, part)) continue;
    // A member inherited from three: its comment is three's, and the pages leave it out
    if (fileName?.startsWith('node_modules/')) continue;
    if (resolveCommentLink(index, links, part)) continue;
    const owner = links.resolveId(ownerId);
    if (!owner) continue; // Not on any page
    const file = fileName ? path.join(ROOT, fileName) : owner.module.file;
    const why = part.target ? 'it isn’t in the API docs' : 'TypeDoc found no such symbol';
    diag.warn(file, line, `{@link ${linkName(part)}} links nowhere (${why}): shown as text`);
  }
};

const namerLabel = ({ name, entry }: LeakNamer) =>
  entry ? `\`${name}\` (${entry})` : `\`${name}\` (itself on no entry)`;

/**
 * p619 R2: a type the public API names that no entry exports, once per type at its first
 * namer's reference (an accepted one not at all, and an accepted key that no longer leaks warns).
 * An entry name the model doesn't have is an error: it would have no page.
 */
const reportEntries = (diag: HubDiagnostics, entries: ApiEntryIndex, leaks: LeakedType[]) => {
  for (const { file, message } of entries.problems) {
    diag.error(path.join(ROOT, file), undefined, message);
  }
  for (const { entry, name, reflection } of entries.internal) {
    const source = reflection.sources?.[0];
    diag.warn(
      source ? path.join(ROOT, source.fileName) : TSCONFIG_FILE,
      source?.line,
      `\`${name}\` is on ${entry} but tagged @internal: drop the tag, or take it off the entry`
    );
  }
  for (const leak of leaks) {
    if (leak.accepted) continue;
    const [first, ...rest] = leak.namedBy;
    const where = leak.sourcePath ? ` (${leak.sourcePath}${leak.line ? `:${leak.line}` : ''})` : '';
    const more = rest.length
      ? `, and ${rest.length} more: ${rest.slice(0, 3).map(namerLabel).join(', ')}${rest.length > 3 ? ', …' : ''}`
      : '';
    diag.warn(
      first.fileName ? path.join(ROOT, first.fileName) : TSCONFIG_FILE,
      first.line,
      `\`${leak.name}\`${where} is on no entry, but ${namerLabel(first)} names it${more}: add it to an entry, or change the signature`
    );
  }
  const accepted = new Set(
    leaks.filter((leak) => leak.accepted).map((leak) => `${leak.sourcePath}#${leak.name}`)
  );
  for (const key of Object.keys(ACCEPTED_LEAKS)) {
    if (accepted.has(key)) continue;
    diag.warn(
      path.join(ROOT, 'devTools/hub/api/entries.ts'),
      undefined,
      `ACCEPTED_LEAKS: ${key} no longer leaks: remove it`
    );
  }
};

/** `api:` links on every page, by name (§2.3) */
const createLinkResolver =
  (links: ApiLinks): HubApiLinkResolver =>
  (ref) => {
    const result = links.resolveName(ref);
    return result.isOk
      ? { pagePath: result.target.module.pagePath, anchor: result.target.anchor }
      : { error: result.message };
  };

const reportMessages = (diag: HubDiagnostics, messages: ApiExtractMessage[]) => {
  for (const { level, message, file, line } of messages) {
    const text = `TypeDoc: ${message}`;
    if (level === 'error') diag.error(file ?? TSCONFIG_FILE, line, text);
    else diag.warn(file ?? TSCONFIG_FILE, line, text);
  }
};

const pageBody = (title: string) =>
  `<h1 class="hubApiTitle">${escapeHtml(title)}</h1>\n<div id="${PAGE_SLOT}"></div>\n`;

/** The index, its links and its search documents are the model's: built once per model */
const indexes = new WeakMap<ApiIndex['project'], ApiIndex>();

const getIndex = (project: ApiIndex['project']) => {
  let index = indexes.get(project);
  if (!index) indexes.set(project, (index = indexApiModel(project)));
  return index;
};

const entryIndexes = new WeakMap<ApiIndex, { entries: ApiEntryIndex; leaks: LeakedType[] }>();

const getEntries = (index: ApiIndex, apiEntries: ApiEntry[]) => {
  let result = entryIndexes.get(index);
  if (!result) {
    const entries = indexEntries(index, apiEntries);
    entryIndexes.set(index, (result = { entries, leaks: findLeakedTypes(index, entries) }));
  }
  return result;
};

export type ApiSectionOptions = {
  mode: HubBuildMode;
  diag: HubDiagnostics;
  meta: ProjectMetadata;
  model: ApiModelSource;
};

/** `api:` links when there's no model to check them against: they point at the landing page */
const uncheckedLinks: HubApiLinkResolver = () => ({ pagePath: API_SECTION_PATH, anchor: '' });

/** The section without API pages: its landing slot says why */
const createEmptySection = (
  text: string,
  links: HubApiLinkResolver | null,
  isStale = false
): ApiSectionResult => ({
  section: {
    path: API_SECTION_PATH,
    slots: { [LANDING_SLOT]: () => `<p>${text}</p>\n` },
    pages: [],
    files: [TSCONFIG_FILE],
    dirs: [],
  },
  stats: null,
  links,
  isStale,
  areApiPagesUnchecked: links === uncheckedLinks,
});

/**
 * The Documentation section: the API model (`model` says from where), its pages, and the landing
 * slot on `documentation/`. A failed conversion is an error on the section's page, which then says
 * the API docs didn't build. Without a model (`none`, or `last` before the first), `api:` links
 * aren't checked.
 */
export const createApiSection = async ({
  mode,
  diag,
  meta,
  model,
}: ApiSectionOptions): Promise<ApiSectionResult> => {
  if (model === 'none') {
    diag.warn(
      TSCONFIG_FILE,
      undefined,
      'The API docs are not built (--no-api): api: links and hub: links to API pages are not checked'
    );
    return createEmptySection(
      'The API documentation isn’t in this build (<code>yarn hub:build --no-api</code>).',
      uncheckedLinks
    );
  }
  const extract =
    model === 'last' ? getLastApiModel() : { ...(await loadApiModel()), isStale: false };
  const { isStale } = extract;
  reportMessages(diag, extract.messages);
  if (!extract.model) {
    // `last` with no conversion yet: the dev plugin converts on the first API page request
    return extract.messages.length
      ? createEmptySection(
          'The API documentation didn’t build: the errors are listed above and in the terminal.',
          null
        )
      : createEmptySection('The API documentation isn’t built yet.', uncheckedLinks, isStale);
  }

  const index = getIndex(extract.model.project);
  const { entries, leaks } = getEntries(index, extract.model.entries);
  reportEntries(diag, entries, leaks);
  const links = getApiLinks(index);
  reportCommentLinks(diag, index, links);
  const highlighter = await loadHubHighlighter();
  const sourceLink = createSourceLink(mode, meta);
  resetMemo(
    hashContent([extract.model.hash, mode, meta.build.commit, meta.engine.repoUrl].join('\0'))
  );
  const generator = (key: string, render: (ctx: Ctx) => string): HubSlotGenerator =>
    memoized(key, (md, env) =>
      render({ index, links, highlighter, md, env, file: env.page.file, sourceLink })
    );

  const pages: HubGeneratedPage[] = [];
  for (const folder of index.folders.values()) {
    if (folder.module) continue; // Its module's page is the folder's
    const subtree = API_SUBTREES.find((s) => s.id === folder.subtree)!;
    const name = path.posix.basename(folder.relPath);
    const title = folder.relPath ? `${name}/` : `${subtree.title} API`;
    pages.push({
      path: folder.pagePath,
      file: path.join(ROOT, folder.sourcePath),
      title,
      menu: folder.relPath ? name : subtree.title,
      description: `The modules in ${folder.sourcePath}/.`,
      tags: ['api', folder.subtree],
      isInMenu: true,
      isSearchable: false,
      body: pageBody(title),
      slots: { [PAGE_SLOT]: generator(folder.pagePath, (ctx) => renderFolderPage(ctx, folder)) },
    });
  }
  for (const module of index.modules) {
    const folder = index.folders.get(module.pagePath) ?? null;
    const name = path.posix.basename(module.relPath);
    pages.push({
      path: module.pagePath,
      file: module.file,
      title: name,
      menu: name,
      description: shorten(toPlainText(getModuleSummary(module)), DESCRIPTION_LENGTH),
      tags: ['api', module.subtree],
      isInMenu: !!folder,
      isSearchable: false,
      body: pageBody(name),
      slots: {
        [PAGE_SLOT]: generator(module.pagePath, (ctx) => renderModulePage(ctx, module, folder)),
      },
    });
  }

  const symbolCount = index.modules.reduce(
    (n, module) => n + module.symbols.filter((s) => s.kind !== Kind.Reference).length,
    0
  );
  const coverage = {
    documented: index.coverage.engine.documented + index.coverage.toolkit.documented,
    total: index.coverage.engine.total + index.coverage.toolkit.total,
  };
  return {
    section: {
      path: API_SECTION_PATH,
      slots: { [LANDING_SLOT]: generator(API_SECTION_PATH, renderLanding) },
      pages,
      files: [TSCONFIG_FILE],
      dirs: [],
      searchDocs: getSearchDocs(index),
    },
    links: createLinkResolver(links),
    isStale,
    areApiPagesUnchecked: false,
    stats: {
      isCached: extract.isCached,
      extractMs: extract.durationMs,
      moduleCount: index.modules.length,
      symbolCount,
      coverage,
    },
  };
};
