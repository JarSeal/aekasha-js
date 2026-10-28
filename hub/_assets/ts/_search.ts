import { CMP, createCommandPalette, createLink } from 'aekasha/ui';
import type { CommandPalette } from 'aekasha/ui';
import { HUB_SEARCH_META, type HubSearchPayload } from '../../../devTools/hub/searchProtocol';
import {
  createHubSearchResults,
  type HubSearchCommand,
  type HubSearchResults,
} from '../../../devTools/hub/searchResults';
import { getKitRoot } from './_kitRoot';

/**
 * The Hub's search: the UI kit's command palette (p805 D12, Phase 7 section 2) over the Hub's
 * index, a chunk `hub.ts` imports on first use (the first focus or hover of the search button,
 * a click, ⌘K / Ctrl+K or `/`), which then loads the payload (`hub-search.js`, its URL in the
 * page's `<meta name="aek-hub-search">`): the index, and the menu and pages for the results'
 * groups and breadcrumbs. Both are cached by the browser from then on: the chunk's name has its
 * hash, and the payload's URL its `?v=`.
 *
 * The palette's `source` answers each query with the best results as commands
 * (`devTools/hub/searchResults.ts`: MiniSearch's order, grouped by top-level section, the count
 * of all), a promise of them until the payload is in (its loading status), a rejection when it
 * fails (tried again on the next query). A row is a link (the palette's `href`): its breadcrumb,
 * its title (an API result's kind badge and name as code) and a snippet, marked with MiniSearch's
 * matched terms. The page around the HUD root is the Hub's: made inert and kept from scrolling
 * while the palette is open. The last query is kept for the session and opened selected.
 */

/** The last query, kept for the session */
const QUERY_STORAGE_KEY = 'aekHubSearch';
/** Set on `<html>` while the palette is open: the page doesn't scroll (`_search.scss`) */
const OPEN_CLASS = 'hubSearchOpen';

const readStoredQuery = () => {
  try {
    return sessionStorage.getItem(QUERY_STORAGE_KEY) ?? '';
  } catch {
    return ''; // Storage off (a private window)
  }
};

const storeQuery = (query: string) => {
  try {
    sessionStorage.setItem(QUERY_STORAGE_KEY, query);
  } catch {
    // Storage off: the query lasts while the page is open
  }
};

// --- The payload ---

let resultsPromise: Promise<HubSearchResults> | null = null;
/** The results once loaded, for synchronous answers while typing */
let loaded: HubSearchResults | null = null;

/** Loads the payload once; a failed load is tried again on the next query */
const loadResultsAsync = () =>
  (resultsPromise ??= (async () => {
    const href = document.querySelector<HTMLMetaElement>(
      `meta[name="${HUB_SEARCH_META}"]`
    )?.content;
    if (!href) throw new Error(`The page has no <meta name="${HUB_SEARCH_META}">`);
    // The 404 page's links resolve against its `<base>`, the others against the page
    const url = new URL(href, document.baseURI).href;
    const module = (await import(/* @vite-ignore */ url)) as { default: HubSearchPayload };
    // The results' links resolve against the site root: `_assets/hub-search.js`' folder's parent.
    // Not `hub.js`' `import.meta.url`: the build may move its code into a chunk (it did, and every
    // result linked into `_assets/`)
    loaded = createHubSearchResults({ payload: module.default, rootUrl: new URL('../', url).href });
    return loaded;
  })().catch((err: unknown) => {
    resultsPromise = null;
    // eslint-disable-next-line no-console -- a failed load's error, for the console (the status says it failed)
    console.error('[Hub] The search index failed to load:', err);
    throw err;
  }));

// --- The palette ---

/** A result's row: its breadcrumb, its title (or an API result's kind and name) and snippet */
const renderRow = (
  command: HubSearchCommand,
  { appendMarked }: { appendMarked: (parent: Node, text: string) => void }
) => {
  const row = CMP({ class: 'hubSearchRow' });
  if (command.crumbs.length) {
    row.add({ tag: 'span', class: 'hubSearchCrumbs', text: command.crumbs.join(' › ') });
  }
  const title = row.add({ tag: 'span', class: 'hubSearchTitle' });
  if (command.kind) {
    // The API pages' kind badge and colours (`_api.scss`)
    title.add({
      tag: 'span',
      class: ['hubSearchKind', 'hubApiKind', `hubApiKind_${command.kind.replace(/\W/g, '')}`],
      text: command.kind,
    });
    appendMarked(title.add({ tag: 'code' }).elem, command.label);
  } else {
    appendMarked(title.elem, command.label);
  }
  if (command.snippet) {
    appendMarked(row.add({ tag: 'span', class: 'hubSearchSnippet' }).elem, command.snippet);
  }
  return row;
};

/** No results: the closest page titles as links to try */
const renderEmpty = (query: string) => {
  const text = `No results for “${query.trim()}”.`;
  const suggestions = loaded?.suggest(query) ?? [];
  if (!suggestions.length) return text;
  const status = CMP({ tag: 'span', text: `${text} Did you mean ` });
  suggestions.forEach(({ title, href }, i) => {
    status.add(createLink({ href, label: title }).cmp);
    const after = i < suggestions.length - 2 ? ', ' : i === suggestions.length - 2 ? ' or ' : '?';
    status.elem.append(after);
  });
  return status;
};

/** The page's elements the open palette made inert (not one that was already) */
const madeInert: Element[] = [];

/** While open, the page around the HUD root is inert and doesn't scroll (the kit's modal makes
 * only the HUD root's other children inert: it doesn't own a host page) */
const onOpen = () => {
  const hudRoot = getKitRoot().elem;
  for (const child of document.body.children) {
    if (child === hudRoot || child.contains(hudRoot) || child.hasAttribute('inert')) continue;
    child.setAttribute('inert', '');
    madeInert.push(child);
  }
  document.documentElement.classList.add(OPEN_CLASS);
};

const onClose = () => {
  for (const elem of madeInert.splice(0)) elem.removeAttribute('inert');
  document.documentElement.classList.remove(OPEN_CLASS);
};

let palette: CommandPalette<HubSearchCommand> | null = null;

const createPalette = () =>
  createCommandPalette<HubSearchCommand>({
    id: 'hubSearch',
    label: 'Search the Hub',
    hint: 'Search the pages, their sections and code.',
    loadingText: 'Loading the search…',
    errorText: 'The search could not load. Check the connection and try again.',
    emptyText: renderEmpty,
    hints: { select: 'to open' },
    source: (query) => {
      if (!query.trim()) return [];
      return loaded ? loaded.search(query) : loadResultsAsync().then((r) => r.search(query));
    },
    renderRow,
    onQueryChange: storeQuery,
    onOpen,
    onClose,
  });

/** Starts loading the payload (the first focus or hover of the search button) */
export const preloadSearch = () => {
  loadResultsAsync().catch(() => {
    // Reported, and tried again, when a query asks for it
  });
};

/** Opens the palette with the last query of the session, selected */
export const openSearch = () => {
  getKitRoot();
  palette ??= createPalette();
  palette.open(palette.isOpen() ? undefined : { query: readStoredQuery() });
};
