/**
 * The component library's stress boxes (the dev page's: p804 D14's and p805 D14's perf passes):
 * many number fields or monitors on one scheduler, a table of live figures and a virtual one, a
 * frame time readout.
 */
import {
  createBindingScheduler,
  createMonitor,
  createNumberField,
  createTable,
  createVirtualRows,
} from 'aekasha/ui';
import type { BindingScheduler, Field, TableColumn } from 'aekasha/ui';
import { ID_PREFIX, addGroup, addButton, addKitRoot } from './page';
import type { Demo } from './page';

// --- Number field stress (the dev page's: p804 D14's perf pass) ---

const STRESS_COUNT = 200;
/** The frames the readout averages: about 2 s at 60 Hz */
const STRESS_FRAMES = 120;

/** A field the stress boxes make: the `index`th, bound to `target.value`, with `interval: 0` */
type StressField = (
  index: number,
  target: { value: number },
  scheduler: BindingScheduler
) => Field<number>;

/** 200 fields of one kind with `interval: 0` in one scheduler, bound to values that change every
 * frame or stay: the tick's cost, read from the frame times in the readout or a profile */
const createStressDemo =
  (name: string, makeField: StressField): Demo =>
  (box) => {
    const controls = addGroup(box, 'Run');
    const root = addKitRoot(box);
    const readout = document.createElement('p');
    readout.id = `${ID_PREFIX}${name}Readout`;
    readout.className = 'hubDemoLine';
    readout.textContent = 'Stopped';
    root.append(readout);
    const values = Array.from({ length: STRESS_COUNT }, (_, i) => ({ value: i / 100 }));
    const scheduler = createBindingScheduler({ visible: false });
    const grid = document.createElement('div');
    grid.className = 'hubDemoStressGrid';
    for (let i = 0; i < STRESS_COUNT; i++) {
      grid.append(makeField(i, values[i], scheduler).cmp.elem);
    }
    root.append(grid);

    let isChanging = false;
    let frame: number | null = null;
    const deltas = new Float64Array(STRESS_FRAMES);
    let count = 0;
    let last = 0;
    let lastReadout = 0;
    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      if (isChanging) {
        for (let i = 0; i < STRESS_COUNT; i++) {
          values[i].value = Math.round(Math.sin(now / 500 + i) * 10000) / 100;
        }
      }
      if (last) deltas[count++ % STRESS_FRAMES] = now - last;
      last = now;
      if (now - lastReadout < 500 || count < STRESS_FRAMES) return;
      lastReadout = now;
      let sum = 0;
      let worst = 0;
      for (let i = 0; i < STRESS_FRAMES; i++) {
        sum += deltas[i];
        worst = Math.max(worst, deltas[i]);
      }
      readout.textContent = `${isChanging ? 'Changing' : 'Steady'}: frames ${(sum / STRESS_FRAMES).toFixed(1)} ms on average, ${worst.toFixed(1)} ms at worst (last ${STRESS_FRAMES})`;
    };
    const run = (changing: boolean) => {
      isChanging = changing;
      count = 0;
      last = 0;
      scheduler.setVisible(true);
      if (frame === null) frame = requestAnimationFrame(loop);
    };
    addButton(controls, 'Values change every frame', () => run(true));
    addButton(controls, 'Values stay', () => run(false));
    addButton(controls, 'Stop', () => {
      scheduler.setVisible(false);
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      readout.textContent = 'Stopped';
    });
  };

const initNumberFieldStressDemo = createStressDemo('Stress', (i, target, scheduler) =>
  createNumberField({
    label: `Value ${i + 1}`,
    target,
    key: 'value',
    step: 0.01,
    interval: 0,
    scheduler,
  })
);

const initMonitorStressDemo = createStressDemo('MonitorStress', (i, target, scheduler) =>
  createMonitor({
    label: `Value ${i + 1}`,
    target,
    key: 'value',
    precision: 2,
    interval: 0,
    scheduler,
  })
);

// --- Table stress (the dev page's: p805 D14's perf pass) ---

/** A table stress row: a name and five figures */
type StressRow = {
  id: string;
  name: string;
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
};

const FIGURES = ['a', 'b', 'c', 'd', 'e'] as const;
/** The updates a readout's update times are from: 5 s at 10 Hz */
const UPDATE_SAMPLES = 50;

const formatFigure = (value: unknown) => (value as number).toFixed(2);

const STRESS_COLUMNS: TableColumn<StressRow>[] = [
  { key: 'name', label: 'Row', rowHeader: true, width: 96 },
  ...FIGURES.map((key) => ({ key, label: key.toUpperCase(), format: formatFigure, width: 80 })),
];

/** A table stress mode: what each 100 ms update does, or each frame (a scroll) */
type TableStressMode = { label: string; update?: (now: number) => void; frame?: () => void };

/** A table of `rowCount` rows of five figures (every column a width: the fixed layout), updated by
 * its modes at 10 Hz; the readout is each update's script time with the style and layout it
 * forces (read back at once, as p805 Phase 0's probe did), and the frame times */
const createTableStressDemo =
  (name: string, rowCount: number, makeModes: (table: StressTable) => TableStressMode[]): Demo =>
  (box) => {
    const controls = addGroup(box, 'Run');
    const root = addKitRoot(box);
    const readout = document.createElement('p');
    readout.id = `${ID_PREFIX}${name}Readout`;
    readout.className = 'hubDemoLine';
    readout.textContent = 'Stopped';
    root.append(readout);
    const rows: StressRow[] = Array.from({ length: rowCount }, (_, i) => ({
      id: `r${i}`,
      name: `Row ${i + 1}`,
      a: i,
      b: i / 2,
      c: i / 3,
      d: i / 4,
      e: i / 5,
    }));
    const table = createTable<StressRow>({
      id: `${ID_PREFIX}${name}Table`,
      caption: `${rowCount.toLocaleString('en')} live rows`,
      columns: STRESS_COLUMNS,
      rows: () => rows,
      sticky: { header: true },
      striped: true,
      virtual: rowCount > 1000 ? createVirtualRows({ rowHeight: 28 }) : undefined,
    });
    const group = document.createElement('div');
    group.className = 'hubDemoStressTable';
    group.append(table.cmp.elem);
    root.append(group);

    const updateTimes = new Float64Array(UPDATE_SAMPLES);
    let updates = 0;
    const deltas = new Float64Array(STRESS_FRAMES);
    let frames = 0;
    let last = 0;
    let lastReadout = 0;
    let mode: TableStressMode | null = null;
    let frame: number | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;

    const writeReadout = (now: number) => {
      if (!mode || now - lastReadout < 500 || frames < STRESS_FRAMES) return;
      lastReadout = now;
      let sum = 0;
      let worst = 0;
      for (let i = 0; i < STRESS_FRAMES; i++) {
        sum += deltas[i];
        worst = Math.max(worst, deltas[i]);
      }
      const count = Math.min(updates, UPDATE_SAMPLES);
      const sorted = Array.from(updateTimes.subarray(0, count)).sort((x, y) => x - y);
      const median = sorted[Math.floor(count / 2)] ?? 0;
      const p95 = sorted[Math.min(count - 1, Math.floor(count * 0.95))] ?? 0;
      const update = count
        ? `update ${median.toFixed(1)} ms median, ${p95.toFixed(1)} ms p95 (last ${count}); `
        : '';
      readout.textContent = `${mode.label}: ${update}frames ${(sum / STRESS_FRAMES).toFixed(1)} ms on average, ${worst.toFixed(1)} ms at worst`;
    };

    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      mode?.frame?.();
      if (last) deltas[frames++ % STRESS_FRAMES] = now - last;
      last = now;
      writeReadout(now);
    };

    const stop = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      if (timer !== null) clearInterval(timer);
      frame = null;
      timer = null;
      mode = null;
      readout.textContent = 'Stopped';
    };

    const run = (next: TableStressMode) => {
      stop();
      mode = next;
      updates = 0;
      frames = 0;
      last = 0;
      frame = requestAnimationFrame(loop);
      const { update } = next;
      if (!update) return;
      timer = setInterval(() => {
        const start = performance.now();
        update(start);
        // The style and layout the change forces, inside the measure
        void table.cmp.elem.offsetHeight;
        updateTimes[updates++ % UPDATE_SAMPLES] = performance.now() - start;
      }, 100);
    };

    for (const next of makeModes({ table, rows })) {
      addButton(controls, next.label, () => run(next));
    }
    addButton(controls, 'Stop', stop);
  };

/** What a table stress box's modes act on */
type StressTable = { table: ReturnType<typeof createTable<StressRow>>; rows: StressRow[] };

/** A row's five figures at a time, every one changed */
const setFigures = (row: StressRow, now: number, i: number) => {
  row.a = Math.sin(now / 500 + i) * 1000;
  row.b = Math.cos(now / 700 + i) * 100;
  row.c = Math.sin(now / 900 + i) * 10;
  row.d = (now / 10 + i) % 1000;
  row.e = Math.sin(now / 300 + i);
};

const initTableStressDemo = createTableStressDemo('TableStress', 500, ({ table, rows }) => [
  {
    label: 'setCell: a tenth of the rows at 10 Hz',
    update: (now) => {
      // A different tenth each time, as a profiler's figures move
      const offset = Math.floor(now / 100) % 10;
      for (let i = offset; i < rows.length; i += 10) {
        setFigures(rows[i], now, i);
        for (const key of FIGURES) table.setCell(rows[i].id, key, rows[i][key]);
      }
    },
  },
  {
    label: 'setCell: every figure at 10 Hz',
    update: (now) => {
      for (let i = 0; i < rows.length; i++) {
        setFigures(rows[i], now, i);
        for (const key of FIGURES) table.setCell(rows[i].id, key, rows[i][key]);
      }
    },
  },
  {
    label: 'refresh: every figure at 10 Hz',
    update: (now) => {
      for (let i = 0; i < rows.length; i++) setFigures(rows[i], now, i);
      table.refresh();
    },
  },
]);

const initVirtualTableStressDemo = createTableStressDemo(
  'VirtualTableStress',
  10000,
  ({ table, rows }) => {
    const scrollBox = () => table.cmp.elem.querySelector('.aekTable__scroll') as HTMLElement;
    return [
      {
        label: 'refresh: every figure at 10 Hz',
        update: (now) => {
          for (let i = 0; i < rows.length; i++) setFigures(rows[i], now, i);
          table.refresh();
        },
      },
      {
        label: 'Scroll 37 px a frame',
        frame: () => {
          const elem = scrollBox();
          elem.scrollTop =
            elem.scrollTop + 37 >= elem.scrollHeight - elem.clientHeight ? 0 : elem.scrollTop + 37;
        },
      },
    ];
  }
);

/** The stress group's demos by their box's key (`data-hub-demo`) */
export const STRESS_DEMOS: Record<string, Demo> = {
  numberFieldStress: initNumberFieldStressDemo,
  monitorStress: initMonitorStressDemo,
  tableStress: initTableStressDemo,
  virtualTableStress: initVirtualTableStressDemo,
};
