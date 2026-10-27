/**
 * The component library's stress boxes (the dev page's: p804 D14's perf pass): many number
 * fields or monitors on one scheduler, a frame time readout.
 */
import { createBindingScheduler, createMonitor, createNumberField } from 'aekasha/ui';
import type { BindingScheduler, Field } from 'aekasha/ui';
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

/** The stress group's demos by their box's key (`data-hub-demo`) */
export const STRESS_DEMOS: Record<string, Demo> = {
  numberFieldStress: initNumberFieldStressDemo,
  monitorStress: initMonitorStressDemo,
};
