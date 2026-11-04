import { escapeHtml } from '../html';
import type { DocsOwner } from './issues';
import type { Plan, PlanModel } from './plans';

/**
 * The roadmap's dependency graphs (p809 D5): a small layered layout drawn as an SVG at build time,
 * written for these graphs (the largest, p301's, has 10 nodes), so nothing runs in the page.
 *
 * `createPlanGraph` picks the nodes and edges from the plan model (a set of member plans, their open
 * blockers from outside the set as dashed boxes, the edges that close a cycle or that another
 * path implies left out),
 * `layoutPlanGraph` lays them out top to bottom with the blockers above (longest-path layering,
 * a point per layer a long edge crosses, two barycenter sweeps with ties by plan order), and
 * `renderPlanGraph` draws it in a `<figure>`. The SVG is `aria-hidden` and its links are out of
 * the tab order: the table next to it is the text equivalent, and Tab reaching every row twice
 * would be noise.
 */

/** How a node is drawn: a member by its state, or a blocker from outside the members */
export type PlanGraphVariant = 'open' | 'progress' | 'done' | 'outside';

export type PlanGraphNode = {
  /** The plan's key (`PlanModel.byKey`) */
  key: string;
  /** The first line: `p305` */
  label: string;
  title: string;
  /** Its row: `#p305`, or the other roadmap's */
  href: string;
  variant: PlanGraphVariant;
  /** After the label: `done`, `in progress`, an outside plan's epic (`in p370`) or folder */
  note: string;
};

export type PlanGraphEdge = { from: string; to: string; isSoft: boolean };

export type PlanGraph = {
  /** In plan order, which breaks the layout's ties */
  nodes: PlanGraphNode[];
  edges: PlanGraphEdge[];
};

export type PlanGraphPoint = { x: number; y: number };

export type PlanGraphLayout = {
  width: number;
  height: number;
  /** The real nodes' keys per layer, in their order */
  layers: string[][];
  /** Each node's box, its top-left corner */
  nodes: { node: PlanGraphNode; layer: number; x: number; y: number }[];
  /** Each edge's points: its start, two per layer it crosses (in the gap between nodes), its end */
  edges: { edge: PlanGraphEdge; points: PlanGraphPoint[] }[];
};

// The sizes, in px at the UI kit's 14 px base: an SVG's viewBox is numbers, so these are the
// space tokens' values (`--aek-space-*` in `tokens.css`)
const NODE_WIDTH = 184;
const NODE_HEIGHT = 64;
/** `--aek-space-6` */
const NODE_GAP = 24;
/** `--aek-space-7` + `--aek-space-5`: room for an edge's curve and its arrowhead */
const LAYER_GAP = 48;
/** `--aek-space-3`: around the graph, for the strokes */
const MARGIN = 8;
/** `--aek-space-4`: inside a box */
const PADDING = 12;
/** A long edge's slot in a layer it crosses */
const DUMMY_WIDTH = 8;
/** The ends of the edges into or out of one node, spread along its edge this far apart at most */
const PORT_SPACING = 12;
/** The title's lines and their length: 12 px text in the box's 160 px (about 6.6 px a character) */
const TITLE_LINES = 2;
const TITLE_LINE_CHARS = 24;
const LABEL_BASELINE = 20;
const TITLE_BASELINE = 38;
const LINE_HEIGHT = 16;

const OWNER_NAMES: Record<DocsOwner, string> = { aekasha: 'Ækasha', app: 'the app' };

/** A plan's label: its number (`p305`), else its file name */
export const getPlanLabel = (plan: Plan) => (plan.number === null ? plan.name : `p${plan.number}`);

const VARIANT_NOTES: Record<PlanGraphVariant, string> = {
  open: '',
  progress: 'in progress',
  done: '✓ done',
  outside: '',
};

/**
 * The graph of `members` (plan keys): those plans, their blockers from outside the set that
 * aren't done (a done one blocks nothing), and the edges into the members from either (not the
 * ones closing a cycle, `PlanEdge.closesCycle`, nor the ones another path implies). An outside
 * node says whose epic it's in, and its folder when that's the other one.
 */
export const createPlanGraph = (
  model: PlanModel,
  members: string[],
  hrefOf: (plan: Plan) => string
): PlanGraph => {
  const memberSet = new Set(members);
  const owner = model.byKey.get(members[0])?.owner;
  const outside = new Set<string>();
  for (const key of members) {
    for (const { plan } of model.byKey.get(key)?.blockers ?? []) {
      if (!memberSet.has(plan) && model.byKey.get(plan)?.state !== 'done') outside.add(plan);
    }
  }
  const nodes = model.plans
    .filter(({ key }) => memberSet.has(key) || outside.has(key))
    .map((plan): PlanGraphNode => {
      const isOutside = outside.has(plan.key);
      const variant: PlanGraphVariant = isOutside
        ? 'outside'
        : plan.state === 'done'
          ? 'done'
          : plan.state === 'in progress'
            ? 'progress'
            : 'open';
      const epic = plan.epic?.kind === 'plan' ? model.byKey.get(plan.epic.plan) : undefined;
      const notes = isOutside
        ? [
            plan.owner !== owner ? OWNER_NAMES[plan.owner] : '',
            epic ? `in ${getPlanLabel(epic)}` : '',
            plan.state === 'in progress' ? 'in progress' : '',
          ]
        : [VARIANT_NOTES[variant]];
      return {
        key: plan.key,
        label: getPlanLabel(plan),
        title: plan.title.replace(/`/g, ''),
        href: hrefOf(plan),
        variant,
        note: notes.filter(Boolean).join(' · '),
      };
    });
  const edges = model.edges
    .filter(
      ({ from, to, closesCycle }) =>
        !closesCycle && memberSet.has(to) && (memberSet.has(from) || outside.has(from))
    )
    .map(({ from, to, isSoft }) => ({ from, to, isSoft }));
  return { nodes, edges: edges.filter((edge) => !isImplied(edges, edge)) };
};

/**
 * Whether another path of `edges` already says what `edge` does, so the graph leaves it out (the
 * plans list blockers their blockers wait on too: p310 names p305 to p309): a hard edge needs a
 * path of hard edges, a soft one any path. The table still lists every dependency.
 */
const isImplied = (edges: PlanGraphEdge[], edge: PlanGraphEdge) => {
  const counts = (other: PlanGraphEdge) => other !== edge && (edge.isSoft || !other.isSoft);
  const stack = edges
    .filter((other) => other.from === edge.from && counts(other))
    .map(({ to }) => to);
  const seen = new Set<string>();
  while (stack.length) {
    const key = stack.pop()!;
    if (key === edge.to) return true;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const other of edges) if (other.from === key && counts(other)) stack.push(other.to);
  }
  return false;
};

/** A slot in a layer: a node, or a point of a long edge crossing it */
type Slot = {
  key: string;
  node: PlanGraphNode | null;
  layer: number;
  /** Plan order, which breaks ties: a long edge's points take their source's, after it */
  tie: number;
  width: number;
  x: number;
  above: Slot[];
  below: Slot[];
};

/** Longest-path layers from the nodes that wait on nothing (the edges make no cycle) */
const assignLayers = (graph: PlanGraph) => {
  const layer = new Map(graph.nodes.map(({ key }) => [key, 0]));
  const incoming = new Map(graph.nodes.map(({ key }) => [key, 0]));
  for (const { to } of graph.edges) incoming.set(to, incoming.get(to)! + 1);
  const queue = graph.nodes.filter(({ key }) => !incoming.get(key)).map(({ key }) => key);
  while (queue.length) {
    const key = queue.shift()!;
    for (const { from, to } of graph.edges) {
      if (from !== key) continue;
      layer.set(to, Math.max(layer.get(to)!, layer.get(key)! + 1));
      incoming.set(to, incoming.get(to)! - 1);
      if (!incoming.get(to)) queue.push(to);
    }
  }
  return layer;
};

/** Orders each layer's slots by the mean position of their neighbours in the layer before */
const sweep = (layers: Slot[][], isDown: boolean) => {
  const position = new Map<Slot, number>();
  for (const layer of layers) layer.forEach((slot, i) => position.set(slot, i));
  const order = isDown ? layers.slice(1) : layers.slice(0, -1).reverse();
  for (const layer of order) {
    const barycenter = new Map(
      layer.map((slot) => {
        const neighbours = isDown ? slot.above : slot.below;
        const mean = neighbours.length
          ? neighbours.reduce((sum, other) => sum + position.get(other)!, 0) / neighbours.length
          : position.get(slot)!;
        return [slot, mean];
      })
    );
    layer.sort((a, b) => barycenter.get(a)! - barycenter.get(b)! || a.tie - b.tie);
    layer.forEach((slot, i) => position.set(slot, i));
  }
};

/** Spreads the ends of `count` edges along a node's top or bottom, centred */
const portX = (centre: number, index: number, count: number) =>
  centre + (index - (count - 1) / 2) * Math.min(PORT_SPACING, NODE_WIDTH / (count + 1));

/** The graph laid out top to bottom, blockers above (this module's comment) */
export const layoutPlanGraph = (graph: PlanGraph): PlanGraphLayout => {
  const layerOf = assignLayers(graph);
  const layerCount = graph.nodes.length ? Math.max(...layerOf.values()) + 1 : 0;
  const layers: Slot[][] = Array.from({ length: layerCount }, () => []);
  const slots = new Map<string, Slot>();
  graph.nodes.forEach((node, i) => {
    const slot: Slot = {
      key: node.key,
      node,
      layer: layerOf.get(node.key)!,
      tie: i,
      width: NODE_WIDTH,
      x: 0,
      above: [],
      below: [],
    };
    slots.set(node.key, slot);
    layers[slot.layer].push(slot);
  });
  // A long edge gets a slot per layer it crosses, so it routes between the nodes
  const chains = graph.edges.map((edge) => {
    const from = slots.get(edge.from)!;
    const to = slots.get(edge.to)!;
    const chain = [from];
    for (let layer = from.layer + 1; layer < to.layer; layer++) {
      const point: Slot = {
        key: `${edge.from}→${edge.to}@${layer}`,
        node: null,
        layer,
        tie: from.tie + 0.5,
        width: DUMMY_WIDTH,
        x: 0,
        above: [],
        below: [],
      };
      layers[layer].push(point);
      chain.push(point);
    }
    chain.push(to);
    for (let i = 1; i < chain.length; i++) {
      chain[i].above.push(chain[i - 1]);
      chain[i - 1].below.push(chain[i]);
    }
    return { edge, chain };
  });
  for (const layer of layers) layer.sort((a, b) => a.tie - b.tie);
  sweep(layers, true);
  sweep(layers, false);

  // Each layer centred on the widest
  const widthOf = (layer: Slot[]) =>
    layer.reduce((sum, slot) => sum + slot.width, 0) + Math.max(0, layer.length - 1) * NODE_GAP;
  const contentWidth = Math.max(0, ...layers.map(widthOf));
  for (const layer of layers) {
    let x = MARGIN + (contentWidth - widthOf(layer)) / 2;
    for (const slot of layer) {
      slot.x = x;
      x += slot.width + NODE_GAP;
    }
  }
  const top = (layer: number) => MARGIN + layer * (NODE_HEIGHT + LAYER_GAP);
  const centre = (slot: Slot) => slot.x + slot.width / 2;

  // The ends spread along each node, ordered by where the edge comes from or goes to
  const ends = new Map<string, number>();
  for (const slot of slots.values()) {
    const outgoing = chains.filter(({ chain }) => chain[0] === slot);
    outgoing.sort((a, b) => centre(a.chain[1]) - centre(b.chain[1]));
    outgoing.forEach(({ edge }, i) =>
      ends.set(`out:${edge.from}→${edge.to}`, portX(centre(slot), i, outgoing.length))
    );
    const incoming = chains.filter(({ chain }) => chain.at(-1) === slot);
    incoming.sort((a, b) => centre(a.chain.at(-2)!) - centre(b.chain.at(-2)!));
    incoming.forEach(({ edge }, i) =>
      ends.set(`in:${edge.from}→${edge.to}`, portX(centre(slot), i, incoming.length))
    );
  }

  return {
    width: contentWidth + 2 * MARGIN,
    height: layerCount ? top(layerCount - 1) + NODE_HEIGHT + MARGIN : 2 * MARGIN,
    layers: layers.map((layer) => layer.filter(({ node }) => node).map(({ key }) => key)),
    nodes: [...slots.values()].map((slot) => ({
      node: slot.node!,
      layer: slot.layer,
      x: slot.x,
      y: top(slot.layer),
    })),
    edges: chains.map(({ edge, chain }) => {
      const from = chain[0];
      const to = chain.at(-1)!;
      const points: PlanGraphPoint[] = [
        { x: ends.get(`out:${edge.from}→${edge.to}`)!, y: top(from.layer) + NODE_HEIGHT },
      ];
      for (const point of chain.slice(1, -1)) {
        points.push({ x: centre(point), y: top(point.layer) });
        points.push({ x: centre(point), y: top(point.layer) + NODE_HEIGHT });
      }
      points.push({ x: ends.get(`in:${edge.from}→${edge.to}`)!, y: top(to.layer) });
      return { edge, points };
    }),
  };
};

/** The title in at most two lines, the second clipped with `…` */
export const wrapPlanTitle = (title: string): string[] => {
  const lines: string[] = [];
  let line = '';
  for (let word of title.split(/\s+/).filter(Boolean)) {
    // A word longer than a line is cut
    while (word.length > TITLE_LINE_CHARS) {
      if (line) lines.push(line);
      line = '';
      lines.push(word.slice(0, TITLE_LINE_CHARS));
      word = word.slice(TITLE_LINE_CHARS);
    }
    if (!line) line = word;
    else if (line.length + 1 + word.length <= TITLE_LINE_CHARS) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= TITLE_LINES) return lines;
  // Clipped at a word with room for the `…`, or inside the word when it's the line's only one
  const full = lines[TITLE_LINES - 1];
  const cut = full.lastIndexOf(' ', TITLE_LINE_CHARS - 1);
  const last = (cut > 0 ? full.slice(0, cut) : full.slice(0, TITLE_LINE_CHARS - 1)).replace(
    /[\s,.;:&+(-]+$/,
    ''
  );
  return [...lines.slice(0, TITLE_LINES - 1), `${last}…`];
};

const round = (value: number) => Math.round(value * 10) / 10;

/** An edge's path: a curve between layers, straight down through the layers it crosses */
const toPath = (points: PlanGraphPoint[]) => {
  let d = `M${round(points[0].x)} ${round(points[0].y)}`;
  for (let i = 1; i < points.length; i++) {
    const { x: x1, y: y1 } = points[i - 1];
    const { x, y } = points[i];
    if (x === x1) d += `L${round(x)} ${round(y)}`;
    else {
      const middle = round((y1 + y) / 2);
      d += `C${round(x1)} ${middle} ${round(x)} ${middle} ${round(x)} ${round(y)}`;
    }
  }
  return d;
};

const renderNode = ({ node, x, y }: PlanGraphLayout['nodes'][number]) => {
  const title = wrapPlanTitle(node.title)
    .map(
      (line, i) =>
        `<tspan x="${round(x + PADDING)}" y="${round(y + TITLE_BASELINE + i * LINE_HEIGHT)}">${escapeHtml(line)}</tspan>`
    )
    .join('');
  const tooltip = [`${node.label} ${node.title}`, node.note].filter(Boolean).join(' · ');
  return `<a class="hubPlanNode hubPlanNode_${node.variant}" href="${escapeHtml(node.href)}" tabindex="-1"><title>${escapeHtml(tooltip)}</title><rect x="${round(x)}" y="${round(y)}" width="${NODE_WIDTH}" height="${NODE_HEIGHT}" rx="6"/><text class="hubPlanNodeLabel" x="${round(x + PADDING)}" y="${round(y + LABEL_BASELINE)}">${escapeHtml(node.label)}${node.note ? `<tspan class="hubPlanNodeNote"> · ${escapeHtml(node.note)}</tspan>` : ''}</text><text class="hubPlanNodeTitle">${title}</text></a>`;
};

/**
 * The graph as a `<figure>`: the SVG (at its own size, in a box that scrolls sideways when it's
 * wider than the page) and its caption. `id` makes the arrowhead's marker id unique on the page.
 */
export const renderPlanGraph = (graph: PlanGraph, id: string) => {
  const layout = layoutPlanGraph(graph);
  const marker = `hubPlanArrow-${id}`;
  const edges = layout.edges
    .map(
      ({ edge, points }) =>
        `<path class="hubPlanEdge${edge.isSoft ? ' hubPlanEdge_soft' : ''}" d="${toPath(points)}"${edge.isSoft ? '' : ` marker-end="url(#${escapeHtml(marker)})"`}/>`
    )
    .join('');
  return `<figure class="hubPlanGraph">
<div class="hubPlanGraphScroll"><svg class="hubPlanGraphSvg" viewBox="0 0 ${round(layout.width)} ${round(layout.height)}" width="${round(layout.width)}" height="${round(layout.height)}" aria-hidden="true" focusable="false"><defs><marker id="${escapeHtml(marker)}" class="hubPlanArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z"/></marker></defs><g class="hubPlanEdges">${edges}</g><g class="hubPlanNodes">${layout.nodes.map(renderNode).join('')}</g></svg></div>
<figcaption>Blockers above, soft dependencies dashed, plans from outside dashed boxes. An arrow another path already implies isn't drawn: the table lists every dependency.</figcaption>
</figure>
`;
};
