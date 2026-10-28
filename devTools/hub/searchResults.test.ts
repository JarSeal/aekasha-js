import { describe, expect, it } from 'vitest';
import { buildSearchIndex, type HubSearchPage } from './search';
import type { HubSearchPayload } from './searchProtocol';
import { createHubSearchResults, getSnippet, HUB_SEARCH_MAX_RESULTS } from './searchResults';
import type { HubHeading, HubPage } from './types';

// p805 Phase 7 section 2: the Hub's search as the command palette's source, run against a payload
// built as `yarn hub:build` builds it and loaded as the browser loads it

const createPage = (path: string, parent: HubPage | null, fields: Partial<HubPage> = {}) => {
  const page = {
    path,
    title: path || 'Home',
    menu: path || 'Home',
    tags: [],
    description: '',
    icon: '',
    isInMenu: true,
    isSearchable: true,
    parent,
    children: [],
    ...fields,
  } as unknown as HubPage;
  parent?.children.push(page);
  return page;
};

const heading = (level: number, id: string, text: string): HubHeading => ({ level, id, text });

const home = createPage('', null);
const guides = createPage('guides/', home, { title: 'All the guides', menu: 'Guides' });
const physics = createPage('guides/physics/', guides, {
  title: 'Physics guide',
  menu: 'Physics',
  description: 'Bodies and colliders.',
});
const examples = createPage('examples/', home, { title: 'Examples', menu: 'Examples' });
const boxes = createPage('examples/boxes/', examples, { title: 'Falling boxes' });
const api = createPage('documentation/aekasha/physics/', home, {
  menu: 'physics',
  isSearchable: false,
});

const LONG_TEXT = `${'Words before the match go here. '.repeat(8)}The colliders are what bodies touch. ${'More words after it. '.repeat(10)}`;

const PAGES: HubSearchPage[] = [
  { page: guides, body: '<p>Every guide.</p>', headings: [] },
  {
    page: physics,
    body: `<p>Intro to the simulation.</p>
<h2 id="setup">Set up</h2><p>Make a world.</p>
<h3 id="fixed-step">Fixed step</h3><p>${LONG_TEXT}</p>`,
    headings: [heading(2, 'setup', 'Set up'), heading(3, 'fixed-step', 'Fixed step')],
  },
  { page: examples, body: '<p>Every example.</p>', headings: [] },
  { page: boxes, body: '<p>Boxes fall on colliders.</p>', headings: [] },
  { page: api, body: '<h3 id="createPhysicsEntity">createPhysicsEntity</h3>', headings: [] },
];

const API_DOCS = [
  { path: api.path, symbol: 'aekasha/physics', kind: 'entry' },
  {
    path: api.path,
    anchor: 'createPhysicsEntity',
    symbol: 'createPhysicsEntity',
    kind: 'function',
    summary: 'Creates a physics entity.',
  },
];

const ROOT_URL = 'https://hub.example/';

const loadResultsAsync = async () => {
  const file = buildSearchIndex(home, PAGES, API_DOCS, { isGzipMeasured: false });
  const url = `data:text/javascript,${encodeURIComponent(String(file.content))}`;
  const payload = ((await import(/* @vite-ignore */ url)) as { default: HubSearchPayload }).default;
  return createHubSearchResults({ payload, rootUrl: ROOT_URL });
};

describe("the Hub's search as the palette's source", () => {
  it('answers an empty query with nothing', async () => {
    const results = await loadResultsAsync();
    expect(results.search('  ')).toEqual({ commands: [], total: 0 });
  });

  it('groups by top-level section (its menu label), crumbs the pages and headings below it', async () => {
    const { commands, total } = (await loadResultsAsync()).search('fixed step');
    expect(total).toBeGreaterThan(0);
    const [first] = commands;
    expect(first).toMatchObject({
      id: 'guides/physics/#fixed-step',
      label: 'Fixed step',
      group: 'Guides',
      href: `${ROOT_URL}guides/physics/#fixed-step`,
      // The section is the group: the page, then the heading above
      crumbs: ['Physics', 'Set up'],
    });
    // MiniSearch's matched terms, each once, a letter alone left out
    expect(first.matchTerms).toEqual(expect.arrayContaining(['fixed', 'step']));
  });

  it("a page's own section: its title, no crumb of itself; another section's group", async () => {
    const { commands } = (await loadResultsAsync()).search('falling boxes');
    expect(commands[0]).toMatchObject({
      id: 'examples/boxes/#',
      label: 'Falling boxes',
      group: 'Examples',
      href: `${ROOT_URL}examples/boxes/`,
      crumbs: [],
      snippet: 'Boxes fall on colliders.',
    });
  });

  it('an API name and an entry: their kind, their name as the label, the page in the crumbs', async () => {
    const results = await loadResultsAsync();
    const [name] = results.search('createPhysicsEntity').commands;
    expect(name).toMatchObject({
      label: 'createPhysicsEntity',
      kind: 'function',
      group: 'Home',
      crumbs: ['aekasha', 'physics'],
      snippet: 'Creates a physics entity.',
      href: `${ROOT_URL}documentation/aekasha/physics/#createPhysicsEntity`,
    });
    const entry = results.search('aekasha physics').commands.find((c) => c.kind === 'entry');
    expect(entry).toMatchObject({ label: 'aekasha/physics', crumbs: ['aekasha'] });
  });

  it('cuts a long text to a window around the first match', async () => {
    const results = await loadResultsAsync();
    const step = results.search('colliders').commands.find((c) => c.label === 'Fixed step');
    expect(step?.snippet.startsWith('… ')).toBe(true);
    expect(step?.snippet.endsWith(' …')).toBe(true);
    expect(step?.snippet).toContain('The colliders are what bodies touch.');
  });

  it(`keeps the best ${HUB_SEARCH_MAX_RESULTS} and counts them all`, async () => {
    const pages: HubSearchPage[] = Array.from({ length: 60 }, (_, i) => ({
      page: createPage(`many/${i}/`, home, { title: `Widget ${i}` }),
      body: '<p>A widget.</p>',
      headings: [],
    }));
    const file = buildSearchIndex(home, pages, [], { isGzipMeasured: false });
    const url = `data:text/javascript,${encodeURIComponent(String(file.content))}`;
    const payload = ((await import(/* @vite-ignore */ url)) as { default: HubSearchPayload })
      .default;
    const { commands, total } = createHubSearchResults({ payload, rootUrl: ROOT_URL }).search(
      'widget'
    );
    expect(commands).toHaveLength(HUB_SEARCH_MAX_RESULTS);
    expect(total).toBe(60);
  });

  it('suggests the closest page titles, once each, for a query with no results', async () => {
    const results = await loadResultsAsync();
    // Two letters off: past the search's fuzziness (one in seven), within the titles' (0.4)
    expect(results.search('falxinq').commands).toEqual([]);
    expect(results.suggest('falxinq')).toEqual([
      { title: 'Falling boxes', href: `${ROOT_URL}examples/boxes/` },
    ]);
  });
});

describe('getSnippet', () => {
  it('keeps a short text whole and starts a long one at its text without a match', () => {
    expect(getSnippet('Short.', ['short'])).toBe('Short.');
    expect(getSnippet(LONG_TEXT, ['nowhere']).startsWith('Words before')).toBe(true);
  });
});
