/**
 * The component library's graphs and figures (the Hub's `features/ui-kit/data/` page, p805 D9):
 * the sparkline, the donut, the stacked bar and the stat tile; the static charts and the time
 * series join them. Out of `data.ts` for its size. Every figure is fixed (no clock, no random), so
 * the screenshots hold; each sits on a `surface` panel, the surface the chart series are checked
 * on.
 */
import { createDonut, createSparkline, createStackedBar, createStatTile } from 'aekasha/ui';
import type { CMPHandle, GraphPart } from 'aekasha/ui';
import { ID_PREFIX, addButton, addGroup, addKitRoot } from './page';
import type { Demo } from './page';

const GRAPH_ID = (name: string) => `${ID_PREFIX}Graph${name}`;

/** A labelled row on the surface a chart sits on */
const addPanel = (root: HTMLElement, label: string) => {
  const group = addGroup(root, label);
  group.classList.add('hubDemoGraphs');
  return group;
};

/** A figure's line: its name, its value and its graph, as a panel shows one */
const addFigureLine = (parent: HTMLElement, name: string, value: string, graph: CMPHandle) => {
  const line = document.createElement('p');
  line.className = 'hubDemoLine hubDemoFigure';
  const label = document.createElement('span');
  label.textContent = name;
  const figure = document.createElement('span');
  figure.className = 'hubDemoFigureValue';
  figure.textContent = value;
  line.append(label, figure, graph.elem);
  parent.append(line);
  return figure;
};

// --- Sparkline ---

/** The Objects tab's "Over time": 60 samples each, a dip and a climb */
const TRIANGLES = Array.from({ length: 60 }, (_, i) => 180 + Math.round(60 * Math.sin(i / 6)));
const DRAW_CALLS = Array.from({ length: 60 }, (_, i) => 120 + i * 3 + (i % 7) * 4);
const FRAME_GAPS = [16, 17, 16, NaN, NaN, 18, 22, 19, 17, NaN, 16, 16, 17, 33, 18, 17];

const initSparklineDemo: Demo = (box) => {
  const root = addKitRoot(box);
  const over = addPanel(
    root,
    'Over time: beside their figures (hidden from assistive tech), filled, from 0'
  );
  const triangles = createSparkline({
    id: GRAPH_ID('Triangles'),
    values: TRIANGLES,
    min: 0,
    area: true,
  });
  const triangleFigure = addFigureLine(over, 'Triangles in view', '180k', triangles.cmp);
  addFigureLine(
    over,
    'Draw calls',
    '297',
    createSparkline({
      values: DRAW_CALLS,
      min: 0,
      area: true,
      color: 'var(--aek-chart-1)',
    }).cmp
  );
  let next = 0;
  addButton(over, 'Push a value', () => {
    const value = 300 + next * 20;
    next++;
    triangles.push(value);
    triangleFigure.textContent = `${value}k`;
  });

  const gaps = addPanel(
    root,
    'Gaps where a frame wasn’t measured, a label (an image), a series colour'
  );
  gaps.append(
    createSparkline({
      id: GRAPH_ID('Frames'),
      values: FRAME_GAPS,
      label: 'Frame time over the last 16 frames, 16 to 33 ms',
      color: 'var(--aek-chart-2)',
    }).cmp.elem
  );
};

// --- Donut ---

const MEMORY_PARTS: GraphPart[] = [
  { label: 'Textures', value: 182 },
  { label: 'Geometry', value: 64 },
  { label: 'Render targets', value: 48 },
];

const megabytes = (value: number) => `${value} MB`;

const initDonutDemo: Demo = (box) => {
  const root = addKitRoot(box);

  const windows = addPanel(root, 'One value, decorative beside its figure (the ray cast tab’s)');
  for (const [seconds, progress, figure] of [
    [1, 0.25, '3.4'],
    [5, 0.65, '2.9'],
    [30, 0.9, '3.1'],
  ] as const) {
    const donut = createDonut({ size: 14 });
    donut.setValue(progress);
    addFigureLine(windows, `Last ${seconds} s`, figure, donut.cmp);
  }

  const meter = createDonut({
    id: GRAPH_ID('Budget'),
    label: 'Budget used',
    value: 0.62,
    centre: '62 %',
    size: 64,
  });
  const meters = addPanel(root, 'A meter, its value in the middle');
  meters.append(meter.cmp.elem);
  addButton(meters, 'Fill to 90 %', () => {
    meter.setValue(0.9);
    meter.setCentre('90 %');
  });

  const parts = addPanel(root, 'Parts of a budget, with a legend; parts of a whole as a pie');
  parts.append(
    createDonut({
      id: GRAPH_ID('Memory'),
      label: 'GPU memory',
      parts: MEMORY_PARTS,
      total: 512,
      centre: '57 %',
      size: 72,
      format: megabytes,
    }).cmp.elem,
    createDonut({
      id: GRAPH_ID('Pie'),
      label: 'Frame by stage',
      parts: [
        { label: 'Physics', value: 3 },
        { label: 'Logic', value: 2 },
        { label: 'Render', value: 9 },
      ],
      size: 56,
      class: 'hubDemoPie',
    }).cmp.elem
  );
};

// --- Stacked bar ---

const FRAME_STAGES: GraphPart[] = [
  { label: 'Physics', value: 2.1 },
  { label: 'Logic', value: 1.4 },
  { label: 'Render', value: 6.8 },
  { label: 'Post', value: 1.2 },
];

const initStackedBarDemo: Demo = (box) => {
  const root = addKitRoot(box);
  addPanel(root, 'Parts of a whole, with a legend: a frame by stage').append(
    createStackedBar({
      id: GRAPH_ID('Stages'),
      label: 'Frame by stage',
      parts: FRAME_STAGES,
      legend: true,
      format: (ms, share) => `${ms} ms (${Math.round(share * 100)} %)`,
      class: 'hubDemoBar',
    }).cmp.elem
  );

  const budget = createStackedBar({
    id: GRAPH_ID('MemoryBudget'),
    label: 'GPU memory against its budget',
    parts: [{ label: 'Used', value: 318 }],
    total: 512,
    format: megabytes,
    class: 'hubDemoBar',
  });
  const text = document.createElement('p');
  text.className = 'hubDemoLine';
  text.textContent = '62 % of the 512 MB budget';
  const budgetGroup = addPanel(root, 'One part against a budget, its figure beside it');
  budgetGroup.append(budget.cmp.elem, text);
  addButton(budgetGroup, 'Go over the budget', () => {
    budget.setParts([{ label: 'Used', value: 600 }]);
    text.textContent = '117 % of the 512 MB budget (over budget)';
  });
};

// --- Stat tile ---

const FRAME_TIMES = [18.2, 17.9, 18.4, 17.1, 16.9, 17.3, 16.4, 16.8, 16.2, 16.6, 15.9, 16.1];

const initStatTileDemo: Demo = (box) => {
  const root = addKitRoot(box);
  const row = addPanel(root, 'A HUD’s figures: a good change, a neutral one, a bad one, none yet');
  row.classList.add('hubDemoTiles');
  const frameTime = createStatTile({
    id: GRAPH_ID('FrameTime'),
    label: 'Frame time',
    value: 16.1,
    unit: 'ms',
    format: (ms) => ms.toFixed(1),
    delta: -4.2,
    goodDirection: 'down',
    sparkline: createSparkline({ values: FRAME_TIMES, min: 0, area: true }),
  });
  const drawCalls = createStatTile({
    id: GRAPH_ID('DrawCalls'),
    label: 'Draw calls',
    value: 297,
    delta: 12,
  });
  const fps = createStatTile({
    id: GRAPH_ID('Fps'),
    label: 'Frames per second',
    value: 58,
    delta: -8,
    goodDirection: 'up',
  });
  const memory = createStatTile({ id: GRAPH_ID('MemoryTile'), label: 'GPU memory', unit: 'MB' });
  row.append(frameTime.cmp.elem, drawCalls.cmp.elem, fps.cmp.elem, memory.cmp.elem);
  addButton(row, 'Next period', () => {
    frameTime.setValue(17.4);
    frameTime.setDelta(8.1);
    drawCalls.setDelta(0);
    fps.setValue(60);
    fps.setDelta(3.4);
    memory.setValue(318);
  });
};

/** The graphs' demos by their box's key (`data-hub-demo`) */
export const GRAPHS_DEMOS: Record<string, Demo> = {
  sparkline: initSparklineDemo,
  donut: initDonutDemo,
  stackedBar: initStackedBarDemo,
  statTile: initStatTileDemo,
};
