/**
 * The dev page's "Debugger parity" box (p805 D14): a row per shape of p805 §4.1's census that
 * p807 still ports (GPU memory's tables and budget bar) built from the kit's data pieces, each
 * with its census source line and what its port takes that isn't a rename. p806 ported the rest
 * (the debugger lists, the tab menus, the ray cast pie, the assets info window's tables) and
 * p807's Phase 3 the profiler's Overview and Objects (its tables, sparklines and component types'
 * list), each removing their rows. The sections are an accordion (shut, each built on its first open); a live run (a
 * kit switch, off at the start) moves the figures the census refreshes. The tables are
 * `parityTables.ts`'.
 */
import { CMP, createAccordion, createBindingScheduler, createStackedBar } from 'aekasha/ui';
import { addLiveSwitch } from './graphs';
import { addKitRoot } from './page';
import type { Demo } from './page';
import { addParityRow, buildGpuMemoryTables } from './parityTables';
import type { ParityLive } from './parityTables';

/** A section's content: a column of rows, built on the section's first open */
const createSection = (build: (parent: HTMLElement) => void) => () => {
  const section = CMP({ class: 'hubDemoParitySection' });
  build(section.elem);
  return section;
};

// --- The budget bar ---

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
};

// --- The box ---

/** The census' shapes p807 still ports, in an accordion: GPU memory's tables and its budget bar;
 * a live run moves the figures */
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
          key: 'gpu',
          title: 'GPU memory’s tables (9)',
          content: createSection((p) => buildGpuMemoryTables(p, live)),
        },
        {
          key: 'graphs',
          title: 'The budget bar',
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
