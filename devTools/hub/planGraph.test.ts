import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { HubDiagnostics } from './diagnostics';
import {
  createPlanGraph,
  getPlanLabel,
  layoutPlanGraph,
  renderPlanGraph,
  wrapPlanTitle,
  type PlanGraph,
  type PlanGraphNode,
} from './generated/planGraph';
import { readPlans, type PlanSource } from './generated/plans';

// The roadmap's dependency graphs (p809 D5): what's drawn, the layout and the SVG

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aek-hub-plan-graph-'));
afterAll(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

/** A plan model from folders of plan files (file name → header lines) */
const readModel = (
  folders: Record<string, Record<string, string>>,
  owners: PlanSource['owner'][]
) =>
  readPlans(
    new HubDiagnostics(),
    Object.entries(folders).map(([name, files], i) => {
      const dir = path.join(tempRoot, name);
      fs.mkdirSync(dir, { recursive: true });
      for (const [file, header] of Object.entries(files)) {
        fs.writeFileSync(path.join(dir, file), `${header}\n\n# ${file.replace(/\.md$/, '')}\n`);
      }
      return { dir, owner: owners[i] };
    })
  );

const node = (key: string, title = key): PlanGraphNode => ({
  key,
  label: key,
  title,
  href: `#${key}`,
  variant: 'open',
  note: '',
});

/**
 * a → c, b → c, a → d, c → e, and a → e, which crosses the middle layer. Worked by hand: the down
 * sweep orders the middle layer [a→e's point, d, c] (barycentres 0, 0, 0.5), the up sweep [the
 * point, c, d] (0, 0, and d keeps its 1)
 */
const fixedGraph: PlanGraph = {
  nodes: ['a', 'b', 'c', 'd', 'e'].map((key) => node(key)),
  edges: [
    { from: 'a', to: 'c', isSoft: false },
    { from: 'b', to: 'c', isSoft: true },
    { from: 'a', to: 'd', isSoft: false },
    { from: 'c', to: 'e', isSoft: false },
    { from: 'a', to: 'e', isSoft: false },
  ],
};

describe('the layout', () => {
  const layout = layoutPlanGraph(fixedGraph);
  const box = (key: string) => layout.nodes.find(({ node: { key: other } }) => other === key)!;

  it('layers by the longest path, blockers above, and orders by two barycentre sweeps', () => {
    expect(layout.layers).toEqual([['a', 'b'], ['c', 'd'], ['e']]);
    expect(box('c').x).toBeLessThan(box('d').x);
    expect(box('a').y).toBeLessThan(box('c').y);
    expect(box('c').y).toBeLessThan(box('e').y);
  });

  it('sizes the graph from its widest layer: two nodes and the long edge’s slot', () => {
    // 8 + 24 + 184 + 24 + 184 between margins of 8; three layers of 64 with gaps of 48
    expect(layout.width).toBe(440);
    expect(layout.height).toBe(304);
    // Narrower layers are centred
    expect(box('e').x).toBe(8 + (424 - 184) / 2);
  });

  it('gives a long edge two points in the layer it crosses, between the nodes', () => {
    const { points } = layout.edges.find(({ edge }) => edge.from === 'a' && edge.to === 'e')!;
    expect(points).toHaveLength(4);
    expect(points[0].y).toBe(8 + 64);
    expect(points[1]).toEqual({ x: 12, y: 120 });
    expect(points[2]).toEqual({ x: 12, y: 184 });
    expect(points[3].y).toBe(232);
    // Not through c's box, the first node in that layer
    expect(points[1].x).toBeLessThan(box('c').x);
  });

  it("spreads the edges ending on one node along its top, in their sources' order", () => {
    const ends = layout.edges
      .filter(({ edge }) => edge.to === 'e')
      .map(({ edge, points }) => ({ from: edge.from, x: points.at(-1)!.x }))
      .sort((p, q) => p.x - q.x);
    // a → e comes down at the left, c → e from c's box to its right
    expect(ends.map(({ from }) => from)).toEqual(['a', 'c']);
    expect(ends[1].x - ends[0].x).toBe(12);
  });

  it('lays out a graph without edges, or empty', () => {
    expect(layoutPlanGraph({ nodes: [node('x'), node('y')], edges: [] }).layers).toEqual([
      ['x', 'y'],
    ]);
    expect(layoutPlanGraph({ nodes: [], edges: [] })).toMatchObject({ width: 16, height: 16 });
  });
});

describe('the SVG', () => {
  it('has a viewBox of its size, the soft edges without an arrowhead and out-of-tab-order links', () => {
    const html = renderPlanGraph(fixedGraph, 'fixed');
    expect(html).toMatch(/<svg [^>]*viewBox="0 0 440 304" width="440" height="304"/);
    expect(html).toMatch(/aria-hidden="true"/);
    expect(html.match(/<a /g)).toHaveLength(5);
    expect(html.match(/tabindex="-1"/g)).toHaveLength(5);
    expect(html.match(/hubPlanEdge_soft/g)).toHaveLength(1);
    expect(html.match(/marker-end="url\(#hubPlanArrow-fixed\)"/g)).toHaveLength(4);
    expect(html).toMatch(/<marker id="hubPlanArrow-fixed"/);
    expect(html).toMatch(/<figcaption>Blockers above/);
  });

  it('escapes the titles, labels and links', () => {
    const html = renderPlanGraph(
      {
        nodes: [{ ...node('x', 'Fish & <b>"chips"</b>'), href: '#a"b', label: 'p<1>' }],
        edges: [],
      },
      'escape'
    );
    expect(html).toContain('Fish &amp; &lt;b&gt;&quot;chips&quot;&lt;/b&gt;');
    expect(html).toContain('href="#a&quot;b"');
    expect(html).toContain('p&lt;1&gt;');
    expect(html).not.toMatch(/<b>|<1>/);
  });

  it('wraps a title to two lines, clipping the rest', () => {
    expect(wrapPlanTitle('Vehicles')).toEqual(['Vehicles']);
    expect(wrapPlanTitle('Texture Sets & the Terrain Texture Library')).toEqual([
      'Texture Sets & the',
      'Terrain Texture Library',
    ]);
    expect(
      wrapPlanTitle('Terrain Preview Scenes (gallery + showcase) and the Final Handbook Pass')
    ).toEqual(['Terrain Preview Scenes', '(gallery + showcase)…']);
    // A word longer than a line is cut
    expect(wrapPlanTitle('a'.repeat(30))).toEqual(['a'.repeat(24), 'a'.repeat(6)]);
    // And clipped inside the word when it's the clipped line's only one
    expect(wrapPlanTitle(`Big ${'b'.repeat(24)} c`)).toEqual(['Big', `${'b'.repeat(23)}…`]);
  });
});

describe('what a graph shows', () => {
  const model = readModel(
    {
      engine: {
        'p10_epic.md': 'Status: draft | epic\nBlocks: p11_one.md, p12_two.md, p13_three.md',
        '_DONE_p11_one.md': 'Status: implemented\nEpic: p10_epic.md\nBlocks: p12_two.md',
        'p12_two.md': 'Status: in progress | Phase 1 implemented\nEpic: p10_epic.md',
        'p13_three.md':
          'Status: draft\nEpic: p10_epic.md\nBlocked by: p12_two.md, p21_other.md (soft: its API), \\_DONE_p30_old.md',
        'p20_epic.md': 'Status: draft | epic\nBlocks: p21_other.md',
        'p21_other.md': 'Status: draft\nEpic: p20_epic.md',
        '_DONE_p30_old.md': 'Status: implemented',
        'p40_a.md': 'Status: draft\nBlocks: p41_b.md',
        'p41_b.md': 'Status: draft\nBlocks: p42_c.md',
        'p42_c.md': 'Status: draft\nBlocks: p40_a.md',
      },
      app: { 'p1_app.md': 'Status: draft\nBlocked by: docs/plans/p21_other.md' },
    },
    ['aekasha', 'app']
  );
  const href = (plan: Parameters<typeof getPlanLabel>[0]) =>
    `${plan.owner === 'app' ? '#app-' : '#'}${getPlanLabel(plan)}`;
  const byKey = (graph: PlanGraph) =>
    Object.fromEntries(graph.nodes.map((graphNode) => [graphNode.key, graphNode]));

  it("draws an epic's children by state, and its open blockers from outside with their epic", () => {
    const graph = createPlanGraph(model, model.byKey.get('aekasha/p10_epic')!.children, href);
    const nodes = byKey(graph);
    expect(graph.nodes.map(({ label }) => label)).toEqual(['p11', 'p12', 'p13', 'p21']);
    expect(nodes['aekasha/_DONE_p11_one']).toMatchObject({ variant: 'done', note: '✓ done' });
    expect(nodes['aekasha/p12_two']).toMatchObject({ variant: 'progress', note: 'in progress' });
    expect(nodes['aekasha/p13_three']).toMatchObject({ variant: 'open', note: '', href: '#p13' });
    expect(nodes['aekasha/p21_other']).toMatchObject({ variant: 'outside', note: 'in p20' });
    // The done outside blocker (p30) blocks nothing, so it isn't drawn
    expect(nodes['aekasha/_DONE_p30_old']).toBeUndefined();
    expect(graph.edges).toEqual([
      { from: 'aekasha/_DONE_p11_one', to: 'aekasha/p12_two', isSoft: false },
      { from: 'aekasha/p12_two', to: 'aekasha/p13_three', isSoft: false },
      { from: 'aekasha/p21_other', to: 'aekasha/p13_three', isSoft: true },
    ]);
    expect(renderPlanGraph(graph, 'p10')).toMatch(
      /class="hubPlanNode hubPlanNode_done" href="#p11"[^]*?✓ done/
    );
  });

  it("names an outside plan's folder when it's the other one", () => {
    const graph = createPlanGraph(model, ['app/p1_app'], href);
    expect(byKey(graph)['aekasha/p21_other']).toMatchObject({
      variant: 'outside',
      note: 'Ækasha · in p20',
      href: '#p21',
    });
    expect(byKey(graph)['app/p1_app'].href).toBe('#app-p1');
  });

  it('leaves out the edge that closes a cycle', () => {
    const graph = createPlanGraph(model, ['aekasha/p40_a', 'aekasha/p41_b', 'aekasha/p42_c'], href);
    expect(graph.edges.map(({ from, to }) => `${from} → ${to}`)).toEqual([
      'aekasha/p40_a → aekasha/p41_b',
      'aekasha/p41_b → aekasha/p42_c',
    ]);
    expect(layoutPlanGraph(graph).layers).toEqual([
      ['aekasha/p40_a'],
      ['aekasha/p41_b'],
      ['aekasha/p42_c'],
    ]);
  });
});
