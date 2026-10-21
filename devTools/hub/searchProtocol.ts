// No Node imports: the Hub's search (`hub/_assets/ts/_search.ts`) imports this, and
// `hub/tsconfig.json` checks it without Node's types.
import type { AsPlainObject, Options } from 'minisearch';
import type { HubDataPage, HubNavItem } from './types';

/**
 * What the search index's build (`search.ts`) and the Hub's search dialog share: the payload's
 * shape, the index's options (minisearch serializes the index but not its options, so both sides
 * load it with these) and the decoding of a result.
 */

/**
 * One indexed section of a page: its text before the first heading, then each heading's.
 *
 * Or an API entry, public name or member (p619 D6): found by its name only (`symbol`), with its
 * `kind` and `summary` stored for the result. It leaves the page fields out, and stores no name: a
 * name's or a member's is its anchor (`loadScene`, `ECSWorld.addSystem`), an entry's its page's
 * path (`apiSearchName`). Thousands of them: every stored byte counts.
 *
 * `path` and `anchor` aren't stored: the document's id carries them (`toHubSearchId`).
 */
export type HubSearchDoc = {
  /** The page's site path ('' never: the homepage isn't indexed) */
  path: string;
  /** The heading's id, '' for the page's own section (the text before its first heading) */
  anchor?: string;
  /** The page's title and tags: on its own section only, so the title finds the page first */
  title?: string;
  tags?: string;
  /** The heading's text, '' for the page's own section */
  heading?: string;
  /** The section's text without markup or code blocks */
  text?: string;
  /** The identifiers in its code blocks, space separated (names, not the code) */
  code?: string;
  /** An API doc's name, indexed, not stored */
  symbol?: string;
  /** An API doc's kind badge (`function`, `type`, `method`, `entry`) */
  kind?: string;
  /** An API doc's summary, its first sentence: stored for the snippet, not indexed */
  summary?: string;
};

/**
 * A document as indexed: its id instead of its `path` and `anchor`. Its `heading` is indexed, and
 * stored as `storedHeading` only when its page's headings (`HubDataPage.headings`) don't give the
 * same text for its anchor (a heading in a page's own markup, which the TOC doesn't list).
 */
export type HubSearchIndexedDoc = Omit<HubSearchDoc, 'path' | 'anchor'> & {
  id: string;
  storedHeading?: string;
};

/** What a result carries once decoded (`createHubSearchReader`): enough to link it and show a snippet */
export type HubSearchStored = Pick<
  HubSearchDoc,
  'path' | 'anchor' | 'heading' | 'text' | 'kind' | 'summary'
>;

/**
 * `_assets/hub-search.js`: an ES module whose default export is the payload. Every page names its
 * URL in the `<meta name="aek-hub-search">` (`HUB_SEARCH_META`), relative to the page.
 */
export const HUB_SEARCH_FILE = 'hub-search.js';
export const HUB_SEARCH_META = 'aek-hub-search';

/**
 * The search's payload, loaded on its first use: the index, the path table its ids point into, and
 * the menu and the searchable pages for the results' groups and breadcrumbs (no page loads them
 * otherwise)
 */
export type HubSearchPayload = {
  index: AsPlainObject;
  /** A document's id is `<index into this>#<anchor>` */
  paths: string[];
  nav: HubNavItem[];
  pages: HubDataPage[];
};

/** A document's id: its path's index in `HubSearchPayload.paths`, then its anchor */
export const toHubSearchId = (pathIndex: number, anchor = '') => `${pathIndex}#${anchor}`;

/**
 * Decodes a result's id and stored fields into its path, anchor and heading, against the payload it
 * came from (the headings by page, read once)
 */
export const createHubSearchReader = ({
  paths,
  pages,
}: Pick<HubSearchPayload, 'paths' | 'pages'>) => {
  const headings = new Map<string, Map<string, string>>();
  for (const page of pages) {
    headings.set(page.path, new Map(page.headings.map(({ id, text }) => [id, text])));
  }
  return (
    result: Pick<HubSearchIndexedDoc, 'id' | 'storedHeading' | 'text' | 'kind' | 'summary'>
  ): HubSearchStored => {
    const at = result.id.indexOf('#');
    const path = paths[Number(result.id.slice(0, at))] ?? '';
    const anchor = result.id.slice(at + 1);
    const heading =
      result.storedHeading ??
      (anchor && !result.kind ? headings.get(path)?.get(anchor) : undefined);
    return {
      path,
      ...(anchor && { anchor }),
      ...(heading !== undefined && { heading }),
      ...(result.text !== undefined && { text: result.text }),
      ...(result.kind !== undefined && { kind: result.kind }),
      ...(result.summary !== undefined && { summary: result.summary }),
    };
  };
};

const SPACE_OR_PUNCTUATION = /[\n\r\p{Z}\p{P}]+/u;
/** `createMeshEntity` → `create`, `Mesh`, `Entity`; `GPUTimer` → `GPU`, `Timer` */
const CAMEL_CASE_PART = /\p{Lu}+(?!\p{Ll})|\p{Lu}?\p{Ll}+|\p{N}+/gu;

/**
 * minisearch's own split (spaces and punctuation), plus, for indexed text, the camelCase parts
 * of each word: `mesh` finds `createMeshEntity`. A query (no field) isn't split further.
 */
const tokenizeHubSearch = (text: string, fieldName?: string) => {
  const tokens = text.split(SPACE_OR_PUNCTUATION).filter(Boolean);
  if (fieldName === undefined) return tokens;
  const parts: string[] = [];
  for (const token of tokens) {
    const split = token.match(CAMEL_CASE_PART);
    if (split && split.length > 1) parts.push(...split);
  }
  return parts.length ? tokens.concat(parts) : tokens;
};

/**
 * An API result's name: a symbol's or a member's anchor without the `-2` a second declaration
 * of the same name on a page gets (`api/publicApi.ts`), an entry's specifier (its page's path
 * under `documentation/`: `aekasha/physics`)
 */
export const apiSearchName = ({ path, anchor, kind }: HubSearchStored) => {
  if (kind === 'entry') return path.replace(/^documentation\/|\/$/g, '');
  if (anchor) return anchor.replace(/-\d+$/, '');
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? path;
};

/** The index's options: the build's and the dialog's */
export const HUB_SEARCH_OPTIONS: Options<HubSearchIndexedDoc> = {
  fields: ['title', 'symbol', 'heading', 'tags', 'text', 'code'],
  storeFields: ['storedHeading', 'text', 'kind', 'summary'],
  tokenize: tokenizeHubSearch,
  searchOptions: {
    boost: { title: 4, symbol: 4, heading: 3, tags: 2 },
    // A one-letter prefix and a fuzzy short word match too much to be useful
    prefix: (term) => term.length > 1,
    fuzzy: (term) => (term.length > 3 ? 0.2 : false),
  },
};
