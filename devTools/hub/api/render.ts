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
  type ApiIndex,
  type Coverage,
} from './model';
import { buildPublicApi, type ApiPage, type ApiPageSection, type PublicApi } from './publicApi';
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
  type Ctx,
  type SourceLink,
} from './renderSymbol';

/**
 * The Documentation section: the engine's and the toolkit's public API as Hub pages, from the API
 * model (`extract.ts`). A generated section on `documentation/`: its landing slot lists each
 * subtree's entries with their folders and coverage, then an A-Z index; each entry gets a page
 * (`publicApi.ts`; `aekasha` one per source folder too) with a section per source module, and each
 * name its anchor (`#loadScene`), its signature, its comment, its parameters, and a link to its
 * source (GitHub at the build's commit, or the editor in dev).
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

/**
 * The API docs' numbers for `yarn hub:build`'s line: the model's reuse and time, the entries, names
 * and coverage
 */
export type ApiBuildStats = {
  isCached: boolean;
  extractMs: number;
  /** The public entries */
  entryCount: number;
  /** Their names, a second entry's re-exports aside */
  symbolCount: number;
  coverage: Coverage;
};

/**
 * The Documentation section for a build, with its stats, its links for `api:` and whether the model
 * is stale
 */
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

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** A page's names, its children's included, re-exports aside (a value and a type of one name
 * are one) */
const countNames = (page: ApiPage): number =>
  page.sections.reduce(
    (n, section) =>
      n + new Set(section.symbols.filter((s) => !s.isReexport).map((s) => s.name)).size,
    0
  ) + page.children.reduce((n, child) => n + countNames(child), 0);

/** The import it documents (`from 'aekasha/physics'`), its source and its coverage */
const renderPageLine = (page: ApiPage) => {
  const from = page.entry ? `<code>from '${escapeHtml(page.entry)}'</code> ` : '';
  const source = page.kind === 'entry' ? page.sourcePath : `${page.sourcePath}/`;
  return `<p class="hubApiPath">${from}<code>${escapeHtml(source)}</code>${renderCoverage(page.coverage)}</p>\n`;
};

/** Entries or folder pages, each with its coverage and how many names it holds */
const renderPageList = (ctx: Ctx, pages: ApiPage[]) => {
  if (!pages.length) return '';
  const items = pages.map((page) => {
    const label = page.kind === 'folder' ? page.menu : page.title;
    const folders = page.children.length
      ? `, ${plural(page.children.length, page.kind === 'group' ? 'entry' : 'folder').replace('entrys', 'entries')}`
      : '';
    return `<li><div class="hubApiListHead"><a href="${escapeHtml(href(ctx, page.pagePath))}"><code>${escapeHtml(label)}</code></a>${renderCoverage(page.coverage)}</div><p class="hubApiSummary">${plural(countNames(page), 'name')}${folders}</p></li>`;
  });
  return `<ul class="hubApiList">${items.join('')}</ul>\n`;
};

/** A module's names on the page: its heading, path and summary, then each name */
const renderSection = (ctx: Ctx, { module, symbols }: ApiPageSection) => {
  ctx.file = module.file;
  const name = path.posix.basename(module.relPath);
  const declarations = symbols.filter((s) => !s.isReexport).map((s) => s.reflection);
  const summary = renderInline(ctx, getModuleSummary(module, declarations, commentLinks(ctx)));
  let html = heading(ctx, 2, uniqueId(ctx.env, `module-${name}`), name);
  html += `<p class="hubApiPath"><code>${escapeHtml(module.sourcePath)}</code></p>\n`;
  if (summary) html += `<p class="hubApiSummary">${summary}</p>\n`;
  for (const symbol of symbols) {
    ctx.file = module.file;
    html += renderSymbol(ctx, symbol);
  }
  return html;
};

const renderApiPage = (ctx: Ctx, page: ApiPage) => {
  ctx.file = path.join(ROOT, page.sourcePath);
  let html = renderPageLine(page);
  if (page.kind === 'group') {
    html += `<p>The entries under <code>${escapeHtml(page.title)}/</code>, one per category.</p>\n`;
    html += sectionHeading(ctx, 'Entries', 'entries') + renderPageList(ctx, page.children);
  } else if (page.children.length) {
    html += `<p>Its ${countNames(page)} names, by the source folder they come from: each folder is a page below. Import every one of them from <code>${escapeHtml(page.entry!)}</code>.</p>\n`;
    html += sectionHeading(ctx, 'Folders', 'folders') + renderPageList(ctx, page.children);
  } else if (page.kind === 'folder') {
    html += `<p>The names <code>${escapeHtml(page.entry!)}</code> exports from <code>${escapeHtml(page.sourcePath)}/</code>.</p>\n`;
  } else if (!page.sections.length) {
    // A stylesheet entry (`aekasha/ui/fonts`): imported for its styles, no names
    html += `<p>A stylesheet entry: it exports no names. Import it for its styles: <code>import '${escapeHtml(page.entry!)}'</code>.</p>\n`;
  }
  for (const section of page.sections) html += renderSection(ctx, section);
  return `<div class="hubApi">\n${html}</div>\n`;
};

/** Every public name, A-Z by first letter, with its entry */
const renderAzIndex = (ctx: Ctx) => {
  const entries = ctx.api.symbols
    .filter((symbol) => !symbol.isReexport)
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) ||
        a.entry.localeCompare(b.entry)
    );
  const groups = new Map<string, typeof entries>();
  for (const entry of entries) {
    const first = entry.name.charAt(0).toUpperCase();
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
        ({ name, entry, target }) =>
          `<li><a href="${escapeHtml(href(ctx, target.pagePath, target.anchor))}">${escapeHtml(name)}</a><span class="hubApiAzModule">${escapeHtml(entry)}</span></li>`
      );
    return `<p class="hubApiAzLetter" id="${ids.get(letter)}">${escapeHtml(letter)}</p><ul class="hubApiAzList">${items.join('')}</ul>`;
  });
  return `${sectionHeading(ctx, 'A–Z index', 'a-z-index')}<p class="hubApiLetters">${bar}</p>\n${lists.join('\n')}\n`;
};

/** `documentation/`'s slot: each subtree's entries, then the A-Z index */
const renderLanding = (ctx: Ctx) => {
  let html = '';
  for (const { id, title } of API_SUBTREES) {
    const pages = ctx.api.roots[id];
    const coverage = { documented: 0, total: 0 };
    for (const page of pages) {
      coverage.documented += page.coverage.documented;
      coverage.total += page.coverage.total;
    }
    html += sectionHeading(ctx, title, id);
    html += `<p class="hubApiPath">${plural(pages.length, 'entry').replace('entrys', 'entries')}${renderCoverage(coverage)}</p>\n`;
    html += renderPageList(ctx, pages);
  }
  html += renderAzIndex(ctx);
  // The section's names get their own search entries: the lists aren't indexed
  return `<div class="hubApi hubSearchSkip">\n${html}</div>\n`;
};

/** A page's `<meta name="description">` */
const describePage = (page: ApiPage) =>
  page.kind === 'group'
    ? `The entries under ${page.title}.`
    : page.kind === 'folder'
      ? `The names ${page.entry} exports from ${page.sourcePath}/.`
      : `The API of ${page.entry}: ${plural(countNames(page), 'name')}.`;

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
 * The `{@link}`s on the pages that link nowhere, once per build (not per render: a module's
 * summary is on several pages): to an internal export (it has no page), or to a name TypeDoc found
 * no symbol for. Another package's symbol (three's) is fine as text.
 */
const reportCommentLinks = (diag: HubDiagnostics, index: ApiIndex, links: ApiLinks) => {
  for (const { part, ownerId, fileName, line } of links.commentLinks) {
    if (typeof part.target === 'string' || isForeignTarget(index, part)) continue;
    // A member inherited from three: its comment is three's, and the pages leave it out
    if (fileName?.startsWith('node_modules/')) continue;
    if (!links.resolveId(ownerId)) continue; // Not on any page
    if (resolveCommentLink(index, links, part)) continue;
    const file = fileName ? path.join(ROOT, fileName) : TSCONFIG_FILE;
    const why =
      typeof part.target === 'number' || part.target
        ? 'it’s internal: on no entry, so on no page'
        : 'TypeDoc found no such symbol';
    diag.warn(file, line, `{@link ${linkName(part)}} links nowhere (${why}): shown as code`);
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
      ? { pagePath: result.target.pagePath, anchor: result.target.anchor }
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

type EntryResult = { entries: ApiEntryIndex; leaks: LeakedType[]; api: PublicApi };
const entryIndexes = new WeakMap<ApiIndex, EntryResult>();

/** The entries, R2's leaked types and the pages: once per model */
const getEntries = (index: ApiIndex, apiEntries: ApiEntry[]) => {
  let result = entryIndexes.get(index);
  if (!result) {
    const entries = indexEntries(index, apiEntries);
    result = { entries, leaks: findLeakedTypes(index, entries), api: buildPublicApi(entries) };
    entryIndexes.set(index, result);
  }
  return result;
};

/**
 * What `createApiSection` takes: the build's mode, diagnostics and metadata, and which model to use
 */
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
  const { entries, leaks, api } = getEntries(index, extract.model.entries);
  reportEntries(diag, entries, leaks);
  for (const { file, message } of api.problems)
    diag.error(path.join(ROOT, file), undefined, message);
  const links = getApiLinks(index, api);
  reportCommentLinks(diag, index, links);
  const highlighter = await loadHubHighlighter();
  const sourceLink = createSourceLink(mode, meta);
  resetMemo(
    hashContent([extract.model.hash, mode, meta.build.commit, meta.engine.repoUrl].join('\0'))
  );
  const generator = (key: string, render: (ctx: Ctx) => string): HubSlotGenerator =>
    memoized(key, (md, env) =>
      render({ index, api, links, highlighter, md, env, file: env.page.file, sourceLink })
    );

  const pages: HubGeneratedPage[] = api.pages.map((page) => ({
    path: page.pagePath,
    file: path.join(ROOT, page.sourcePath),
    title: page.title,
    menu: page.menu,
    order: page.order,
    description: shorten(describePage(page), DESCRIPTION_LENGTH),
    tags: ['api', page.subtree, ...(page.entry ? [page.entry] : [])],
    isInMenu: true,
    isSearchable: false,
    body: pageBody(page.title),
    slots: { [PAGE_SLOT]: generator(page.pagePath, (ctx) => renderApiPage(ctx, page)) },
  }));

  return {
    section: {
      path: API_SECTION_PATH,
      slots: { [LANDING_SLOT]: generator(API_SECTION_PATH, renderLanding) },
      pages,
      files: [TSCONFIG_FILE],
      dirs: [],
      searchDocs: getSearchDocs(api),
    },
    links: createLinkResolver(links),
    isStale,
    areApiPagesUnchecked: false,
    stats: {
      isCached: extract.isCached,
      extractMs: extract.durationMs,
      entryCount: api.roots.engine.length + api.roots.toolkit.length,
      symbolCount: api.coverage.total,
      coverage: api.coverage,
    },
  };
};
