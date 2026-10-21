import MiniSearch from 'minisearch';
import { describe, expect, it } from 'vitest';
import { buildSearchIndex, splitSections, type HubSearchPage } from './search';
import {
  apiSearchName,
  createHubSearchReader,
  HUB_SEARCH_OPTIONS,
  type HubSearchIndexedDoc,
  type HubSearchPayload,
} from './searchProtocol';
import type { HubHeading, HubPage } from './types';

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

const home = createPage('', null);
const guides = createPage('guides/', home, { title: 'Guides', tags: ['howto'] });
const physics = createPage('guides/physics/', guides, {
  title: 'Physics guide',
  description: 'Bodies and colliders.',
});
const api = createPage('documentation/aekasha/physics/', home, { isSearchable: false });

const heading = (level: number, id: string, text: string): HubHeading => ({ level, id, text });

const PAGES: HubSearchPage[] = [
  { page: home, body: '<h2 id="hero">Hero</h2><p>Not indexed</p>', headings: [] },
  { page: guides, body: '<p>Every guide.</p>', headings: [] },
  {
    page: physics,
    body: `<p>Intro to the simulation.</p>
<h2 id="setup">Set up <a class="hubAnchor" href="#setup">#</a></h2><p>It's a "quoted" \\ path.</p>
<h3 id="fixed-step">Fixed step</h3><pre><code><span class="line">stepPhysics(world)</span></code></pre>
<h2 id="markup-only">From the markup</h2><p>A heading the TOC doesn't list.</p>`,
    headings: [heading(2, 'setup', 'Set up'), heading(3, 'fixed-step', 'Fixed step')],
  },
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

/** The built file, loaded as the browser does: an ES module whose default export is the payload */
const loadBuiltPayloadAsync = async () => {
  const file = buildSearchIndex(home, PAGES, API_DOCS);
  const url = `data:text/javascript,${encodeURIComponent(String(file.content))}`;
  const payload = ((await import(/* @vite-ignore */ url)) as { default: HubSearchPayload }).default;
  return { file, payload };
};

const searchAsync = async (query: string) => {
  const { payload } = await loadBuiltPayloadAsync();
  const index = MiniSearch.loadJS<HubSearchIndexedDoc>(payload.index, HUB_SEARCH_OPTIONS);
  const read = createHubSearchReader(payload);
  return index.search(query).map((result) => read(result as unknown as HubSearchIndexedDoc));
};

describe('the search payload', () => {
  it('holds the path table, the menu and the searchable pages with their headings', async () => {
    const { file, payload } = await loadBuiltPayloadAsync();
    expect(payload.paths).toEqual(['guides/', 'guides/physics/', api.path]);
    expect(payload.nav[0].children.map((item) => item.path)).toEqual(['guides/', api.path]);
    expect(payload.pages.map((page) => [page.path, page.section])).toEqual([
      ['', ''],
      ['guides/', 'guides/'],
      ['guides/physics/', 'guides/'],
    ]);
    expect(file.docCount).toBe(7); // The guides' 1 section and the physics guide's 4, + 2 API docs
    expect(file.pageDocCount).toBe(5);
    expect(file.gzipBytes).toBeGreaterThan(0);
  });

  it('stores no path, no anchor and only the headings the pages cannot give', async () => {
    const { payload } = await loadBuiltPayloadAsync();
    const stored = Object.values(payload.index.storedFields) as Record<string, unknown>[];
    expect(stored.some((fields) => 'path' in fields || 'anchor' in fields)).toBe(false);
    expect(stored.filter((fields) => 'storedHeading' in fields)).toEqual([
      { storedHeading: 'From the markup', text: "A heading the TOC doesn't list." },
    ]);
  });
});

describe('the dev rebuilds (D16)', () => {
  it('reuse the payload for the same documents, and rebuild it for a changed page', () => {
    const first = buildSearchIndex(home, PAGES, API_DOCS);
    expect(buildSearchIndex(home, PAGES, API_DOCS).content).toBe(first.content);
    const edited = PAGES.map((entry) =>
      entry.page === guides ? { ...entry, body: '<p>Every guide, edited.</p>' } : entry
    );
    const next = buildSearchIndex(home, edited, API_DOCS);
    expect(next.content).not.toBe(first.content);
    expect(String(next.content)).toContain('Every guide, edited.');
  });

  it('skip the gzip measurement when not asked', () => {
    expect(buildSearchIndex(home, PAGES, API_DOCS, { isGzipMeasured: false }).gzipBytes).toBe(null);
  });
});

describe('a search round trip', () => {
  it('finds a page section by its title, with the description first', async () => {
    const [first] = await searchAsync('physics guide');
    expect(first).toEqual({
      path: 'guides/physics/',
      text: 'Bodies and colliders. Intro to the simulation.',
    });
  });

  it('finds a heading, reading its text from the page', async () => {
    const [first] = await searchAsync('set up');
    expect(first).toEqual({
      path: 'guides/physics/',
      anchor: 'setup',
      heading: 'Set up',
      text: 'It\'s a "quoted" \\ path.',
    });
  });

  it('finds a code identifier by a camelCase part', async () => {
    const results = await searchAsync('step');
    expect(results.map((result) => result.anchor)).toContain('fixed-step');
  });

  it('finds a heading the TOC does not list, from its stored text', async () => {
    const [first] = await searchAsync('markup');
    expect(first).toMatchObject({ anchor: 'markup-only', heading: 'From the markup' });
  });

  it('finds an API name and an entry, named as the dialog shows them', async () => {
    const [name] = await searchAsync('createPhysicsEntity');
    expect(name).toEqual({
      path: api.path,
      anchor: 'createPhysicsEntity',
      kind: 'function',
      summary: 'Creates a physics entity.',
    });
    expect(apiSearchName(name)).toBe('createPhysicsEntity');
    const entry = (await searchAsync('aekasha physics')).find((result) => result.kind === 'entry');
    expect(entry && apiSearchName(entry)).toBe('aekasha/physics');
  });

  it("doesn't index the homepage or a page that leaves itself out", async () => {
    expect(await searchAsync('hero')).toEqual([]);
  });
});

describe('splitSections', () => {
  it('splits at headings with an id, skipping anchors and buttons, keeping code identifiers', () => {
    const sections = splitSections(
      '<h1>Title</h1><p>Lead <button>Copy</button>text</p><h2 id="a">A <a class="hubAnchor">#</a></h2><ul><li>one</li><li>two</li></ul><pre><span class="line">const value = loadScene(id)</span></pre>'
    );
    expect(sections).toEqual([
      { anchor: '', heading: '', text: 'Lead text', code: '' },
      { anchor: 'a', heading: 'A', text: 'one two', code: 'value loadScene' },
    ]);
  });
});
