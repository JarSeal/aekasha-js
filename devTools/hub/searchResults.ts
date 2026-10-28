// No Node imports: the Hub's search (`hub/_assets/ts/_search.ts`) imports this, as it does
// `searchProtocol.ts`. The payload's results as the command palette's commands (p805 Phase 7
// section 2: the search moved onto `createCommandPalette`), kept apart from the palette so the
// Node test runs them against a built payload.
import MiniSearch, { type SearchOptions } from 'minisearch';
import type { PaletteCommand } from 'aekasha/ui';
import {
  apiSearchName,
  createHubSearchReader,
  HUB_SEARCH_OPTIONS,
  type HubSearchIndexedDoc,
  type HubSearchPayload,
  type HubSearchStored,
} from './searchProtocol';
import type { HubDataPage, HubNavItem } from './types';

/** The most results a query shows (the status counts them all: "50 of 214 results") */
export const HUB_SEARCH_MAX_RESULTS = 50;
const MAX_SUGGESTIONS = 3;
/** The snippet: this much text before the first match, and this long in all */
const SNIPPET_BEFORE = 40;
const SNIPPET_LENGTH = 180;

/** A search result as a palette command: its row's parts besides the palette's own */
export type HubSearchCommand = PaletteCommand & {
  /** Its page and anchor, as a URL */
  href: string;
  /** The pages and headings above it, outermost first (the group's section left out) */
  crumbs: string[];
  /** An API result's kind (`function`, `type`, `entry`, …): its row shows the kind's badge and
   * the label as code */
  kind?: string;
  /** A window of its text around the first match, cut at word edges */
  snippet: string;
};

/** A page a query without results may have meant */
export type HubSearchSuggestion = { title: string; href: string };

/** `examples/physics/` → `examples/`, `examples/physics/` */
const pagePathTrail = (pagePath: string) => {
  const parts = pagePath.split('/').filter(Boolean);
  return parts.map((_part, i) => `${parts.slice(0, i + 1).join('/')}/`);
};

/** The headings above the result's heading on its page, outermost first */
const parentHeadings = (page: HubDataPage, anchor: string) => {
  const at = page.headings.findIndex((heading) => heading.id === anchor);
  if (at < 0) return [];
  const parents: string[] = [];
  let level = page.headings[at].level;
  for (let i = at - 1; i >= 0 && level > 2; i--) {
    const heading = page.headings[i];
    if (heading.level < level) {
      parents.unshift(heading.text);
      level = heading.level;
    }
  }
  return parents;
};

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The matched index terms worth marking: two letters or more, once each */
const getMarkedTerms = (terms: string[]) => [...new Set(terms)].filter((term) => term.length > 1);

/**
 * A window of the text around its first match (`terms`, case ignored), cut at word edges, with
 * `…` where it's cut
 * @internal
 */
export const getSnippet = (text: string, terms: readonly string[]) => {
  if (text.length <= SNIPPET_LENGTH) return text;
  const regex = terms.length
    ? new RegExp(
        [...terms]
          .sort((a, b) => b.length - a.length)
          .map(escapeRegExp)
          .join('|'),
        'i'
      )
    : null;
  // -1 without a match in the text (it matched the heading or the code): the text's start
  const first = regex ? text.search(regex) : -1;
  let start = Math.max(0, first - SNIPPET_BEFORE);
  if (start > 0) start = text.indexOf(' ', start) + 1 || start;
  let end = Math.min(text.length, start + SNIPPET_LENGTH);
  const lastSpace = text.lastIndexOf(' ', end);
  if (end < text.length && lastSpace > start) end = lastSpace;
  return `${start > 0 ? '… ' : ''}${text.slice(start, end)}${end < text.length ? ' …' : ''}`;
};

/**
 * The Hub's search over a loaded payload: `search(query)` is the palette's `source` answer (the
 * best results as commands, MiniSearch's order, grouped by top-level section through `group`, with
 * the count of every result), `suggest(query)` the closest page titles for a query with none.
 * @internal
 * @param props the payload, and the site's root URL its paths resolve against
 */
export const createHubSearchResults = ({
  payload,
  rootUrl,
}: {
  payload: HubSearchPayload;
  rootUrl: string;
}) => {
  const index = MiniSearch.loadJS<HubSearchIndexedDoc>(payload.index, HUB_SEARCH_OPTIONS);
  const read = createHubSearchReader(payload);

  const menuLabels = new Map<string, string>();
  const walk = (items: HubNavItem[]) => {
    for (const item of items) {
      menuLabels.set(item.path, item.title);
      walk(item.children);
    }
  };
  walk(payload.nav);
  /** Every page by path, labelled by its menu entry where it has one (else its title) */
  const pageInfos = new Map(
    payload.pages.map((page) => [
      page.path,
      { page, label: menuLabels.get(page.path) ?? page.title },
    ])
  );

  /**
   * A page's breadcrumb label: its menu entry or title, else its folder's name (an API page:
   * `documentation/aekasha/physics/` → `physics`)
   */
  const pathLabel = (pagePath: string) => {
    const parts = pagePath.split('/').filter(Boolean);
    return (
      pageInfos.get(pagePath)?.label ??
      menuLabels.get(pagePath) ??
      parts[parts.length - 1] ??
      pagePath
    );
  };

  /** The top-level section's label: the group a result goes in ('Home' for none) */
  const groupOf = (pagePath: string) => {
    const section = pageInfos.get(pagePath)?.page.section ?? pagePathTrail(pagePath)[0] ?? '';
    return pageInfos.get(section)?.label ?? 'Home';
  };

  const toHref = (path: string, anchor = '') =>
    new URL(`${path}${anchor ? `#${anchor}` : ''}`, rootUrl).href;

  const toCommand = (result: HubSearchStored, terms: string[]): HubSearchCommand => {
    const info = pageInfos.get(result.path);
    const crumbs = [
      // The section is the group's label; an API name's page is in the breadcrumb, an entry's is
      // itself
      ...pagePathTrail(result.path)
        .slice(1, result.anchor ? undefined : -1)
        .map(pathLabel),
      ...(info && result.anchor && !result.kind ? parentHeadings(info.page, result.anchor) : []),
    ];
    const label = result.kind
      ? apiSearchName(result)
      : result.anchor
        ? result.heading ?? ''
        : info?.page.title ?? result.path;
    const matchTerms = getMarkedTerms(terms);
    return {
      id: `${result.path}#${result.anchor ?? ''}`,
      label,
      group: groupOf(result.path),
      href: toHref(result.path, result.anchor),
      matchTerms,
      crumbs,
      ...(result.kind !== undefined && { kind: result.kind }),
      snippet: getSnippet(result.text || result.summary || '', matchTerms),
    };
  };

  const find = (query: string, options?: SearchOptions) => {
    const results = index.search(query, options);
    return {
      total: results.length,
      commands: results
        .slice(0, HUB_SEARCH_MAX_RESULTS)
        .map((result) => toCommand(read(result as unknown as HubSearchIndexedDoc), result.terms)),
    };
  };

  return {
    /** The best results for the query (none for an empty one), and how many there are */
    search: (query: string) =>
      query.trim() ? find(query.trim()) : { commands: [] as HubSearchCommand[], total: 0 },
    /** The closest page titles, for a query without results */
    suggest: (query: string): HubSearchSuggestion[] => {
      const seen = new Set<string>();
      const suggestions: HubSearchSuggestion[] = [];
      for (const result of index.search(query.trim(), {
        fields: ['title'],
        fuzzy: 0.4,
        prefix: true,
        combineWith: 'OR',
      })) {
        const { path } = read(result as unknown as HubSearchIndexedDoc);
        const info = pageInfos.get(path);
        if (!info || seen.has(path)) continue;
        seen.add(path);
        suggestions.push({ title: info.page.title, href: toHref(path) });
        if (suggestions.length === MAX_SUGGESTIONS) break;
      }
      return suggestions;
    },
  };
};

/** What `createHubSearchResults` returns */
export type HubSearchResults = ReturnType<typeof createHubSearchResults>;
