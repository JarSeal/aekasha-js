/**
 * The dev page's "Debugger parity" box (p805 D14): a row per shape of p805 §4.1's census that
 * p807 ports (the profiler's Overview and Objects tables, GPU memory's tables and budget bar, the
 * sparklines and the component types' list) built from the kit's data pieces, each with its
 * census source line and what its port takes that isn't a rename. p806 ported the rest (the
 * debugger lists, the tab menus, the ray cast pie, the assets info window's tables) and removed
 * their rows. The sections are an accordion (shut, each built on its first open); a live run (a
 * kit switch, off at the start) moves the figures the census refreshes. The tables are
 * `parityTables.ts`'.
 */
import {
  CMP,
  createAccordion,
  createBindingScheduler,
  createList,
  createSparkline,
  createStackedBar,
} from 'aekasha/ui';
import { addFigureLine, addLiveSwitch } from './graphs';
import { addKitRoot } from './page';
import type { Demo } from './page';
import { addParityRow, buildGpuMemoryTables, buildProfilerTables } from './parityTables';
import type { ParityLive } from './parityTables';

/** A section's content: a column of rows, built on the section's first open */
const createSection = (build: (parent: HTMLElement) => void) => () => {
  const section = CMP({ class: 'hubDemoParitySection' });
  build(section.elem);
  return section;
};

// --- Bars, sparklines and a key-value grid ---

const MB_BUDGET = 512;

const buildGraphs = (parent: HTMLElement, live: ParityLive) => {
  const panel = (source: string, note: string) =>
    addParityRow(parent, { source, note, layout: ['hubDemoGraphs'] });

  const budget = panel(
    '_dbg__GPUMemory.ts:212',
    'the budget bar: a stacked bar of one part against a `total`; over it, the bar’s `data-over` and its label say so (the census’ over-budget class), the text beside it stays'
  );
  const budgetBar = createStackedBar({
    parts: [{ label: 'In use', value: 612 }],
    total: MB_BUDGET,
    label: 'GPU memory budget',
    format: (value) => `${value} MB`,
    legend: false,
    class: 'hubDemoBar',
  });
  const budgetText = document.createElement('p');
  budgetText.className = 'hubDemoLine';
  budget.append(budgetBar.cmp.elem, budgetText);
  const writeBudget = (mb: number) => {
    budgetBar.setParts([{ label: 'In use', value: mb }], MB_BUDGET);
    const ratio = mb / MB_BUDGET;
    budgetText.textContent = `${(ratio * 100).toFixed(0)} % of the ${MB_BUDGET} MB budget${ratio > 1 ? ' (over budget)' : ''}`;
  };
  writeBudget(612);
  live.onStep(() => writeBudget(Math.round(420 + 200 * Math.abs(Math.sin(live.getStep() / 8)))));

  const overTime = panel(
    '…Objects.ts:406',
    'over time: three sparklines of 60 samples, `area`, from 0, hidden beside their figures (the latest and the max)'
  );
  const series = [
    { name: 'Triangles in view', base: 1200, unit: 'k' },
    { name: 'Meshes in view', base: 410, unit: '' },
    { name: 'Draw calls', base: 380, unit: '' },
  ].map(({ name, base, unit }, s) => {
    const values = Array.from({ length: 60 }, (_, i) =>
      Math.round(base * (1 + 0.15 * Math.sin(i / (5 + s))))
    );
    const sparkline = createSparkline({ values, capacity: 60, min: 0, area: true });
    const text = (latest: number, max: number) => `${latest}${unit} · max ${max}${unit}`;
    const figure = addFigureLine(
      overTime,
      name,
      text(values[59], Math.max(...values)),
      sparkline.cmp
    );
    let max = Math.max(...values);
    return (step: number) => {
      const value = Math.round(base * (1 + 0.15 * Math.sin((59 + step) / (5 + s))));
      max = Math.max(max, value);
      sparkline.push(value);
      figure.textContent = text(value, max);
    };
  });
  live.onStep(() => series.forEach((push) => push(live.getStep())));

  const grid = panel(
    '…Objects.ts:330',
    'the component types by entity count: `<div>`s today; a static list with a suffix'
  );
  grid.append(
    createList<[string, number]>({
      label: 'Component types',
      items: [
        ['TRANSFORM', 2318],
        ['MESH', 780],
        ['PHYSICS', 86],
        ['CHARACTER', 3],
      ],
      getKey: ([type]) => type,
      title: ([type]) => type,
      suffix: ([, entities]) => `${entities.toLocaleString('en')} entities`,
    }).cmp.elem
  );
};

// --- The box ---

/** The census' shapes p807 ports, in an accordion: the profiler's and GPU memory's tables, the
 * budget bar, the sparklines and the component types' list; a live run moves the figures */
const initDebuggerParityDemo: Demo = (box) => {
  const root = addKitRoot(box);
  const scheduler = createBindingScheduler();
  const stepListeners: (() => void)[] = [];
  let step = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  const live: ParityLive = {
    scheduler,
    getStep: () => step,
    onStep: (fn) => stepListeners.push(fn),
  };
  addLiveSwitch(root, 'Live figures (the census’ refreshes, 4 a second)', (on) => {
    if (on && timer === null) {
      timer = setInterval(() => {
        step++;
        for (const fn of stepListeners) fn();
      }, 250);
    } else if (!on && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  });
  root.append(
    createAccordion({
      level: 3,
      multiple: true,
      class: 'hubDemoParity',
      items: [
        {
          key: 'profiler',
          title: 'The profiler’s tables (4)',
          content: createSection((p) => buildProfilerTables(p, live)),
        },
        {
          key: 'gpu',
          title: 'GPU memory’s tables (9)',
          content: createSection((p) => buildGpuMemoryTables(p, live)),
        },
        {
          key: 'graphs',
          title: 'A bar, sparklines and a key-value grid',
          content: createSection((p) => buildGraphs(p, live)),
        },
      ],
    }).cmp.elem
  );
};

/** The dev page's parity box by its key (`data-hub-demo`) */
export const PARITY_DEMOS: Record<string, Demo> = {
  debuggerParity: initDebuggerParityDemo,
};
