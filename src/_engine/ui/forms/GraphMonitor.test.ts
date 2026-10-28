import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  stubCanvas2d,
  stubIntersectionObserver,
  stubKitDomAsync,
  stubResizeObserver,
} from '../testing/KitDom';
import { createBindingScheduler } from './binding/BindingScheduler';
import type { Field } from './Field';
import { createGraphMonitor } from './GraphMonitor';
import { createPropertyGrid } from './PropertyGrid';
import { addPropertyGridItems } from './PropertyGridItems';

let resizer: ReturnType<typeof stubResizeObserver>;
let intersections: ReturnType<typeof stubIntersectionObserver>;
let canvas2d: ReturnType<typeof stubCanvas2d>;

beforeAll(async () => {
  await stubKitDomAsync();
  resizer = stubResizeObserver();
  intersections = stubIntersectionObserver();
  canvas2d = stubCanvas2d({ computedStyle: {} });
});

afterAll(() => {
  resizer.restore();
  intersections.restore();
  canvas2d.restore();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

const graphOf = (elem: Element) => elem.querySelector('.aekMonitor__graph') as HTMLElement;
const canvasOf = (elem: Element) => elem.querySelector('canvas') as HTMLCanvasElement;
/** Draws the graph once at 100 by 40 px: the stubbed frame is a 16 ms timer */
const drawGraph = (elem: Element) => {
  resizer.resize(elem.querySelector('.aekTimeSeries__plot') as Element, {
    width: 100,
    height: 40,
  });
  vi.advanceTimersByTime(16);
  return canvas2d.calls(canvasOf(elem));
};

describe('the graph monitor (p805 D9)', () => {
  it('shows the value as text with its graph under it, hidden from assistive tech', () => {
    const stats = { frameMs: 16.63 };
    const monitor = createGraphMonitor({
      label: 'Frame time',
      target: stats,
      key: 'frameMs',
      unit: 'ms',
      precision: 1,
    });
    const elem = monitor.cmp.elem;
    expect(elem.getAttribute('data-kind')).toBe('monitor');
    const control = elem.querySelector('.aekMonitor') as HTMLElement;
    expect(control.tagName).toBe('DIV');
    expect(control.hasAttribute('data-graph')).toBe(true);
    expect(elem.querySelector('.aekMonitor__value')?.textContent).toBe('16.6');
    expect(elem.querySelector('.aekMonitor__unit')?.textContent).toBe('ms');
    // No reset button: a monitor
    expect(elem.querySelector('.aekField__reset')).toBe(null);
    const series = graphOf(elem).querySelector('.aekTimeSeries') as HTMLElement;
    expect(series).not.toBe(null);
    // The text is the value: no ticks, no summary
    expect(series.querySelector('.aekTimeSeries__summary')).toBe(null);
    expect(series.querySelector('.aekTimeSeries__gridLine')).toBe(null);
    expect(series.querySelector('.aekTimeSeries__plot')?.getAttribute('aria-hidden')).toBe('true');
    monitor.cmp.remove();
  });

  it('samples every read, the value changed or not, and a non-number is a gap', () => {
    vi.useFakeTimers();
    const values = [1, 1, NaN, 2];
    let reads = 0;
    const scheduler = createBindingScheduler({ visible: false });
    const monitor = createGraphMonitor({
      label: 'Load',
      get: () => values[Math.min(reads, values.length - 1)],
      scheduler,
    });
    document.body.append(monitor.cmp.elem);
    // The graph's first sample (the value at its attach), then a refresh per value
    for (reads = 1; reads < values.length; reads++) scheduler.refresh();
    const calls = drawGraph(monitor.cmp.elem);
    // 1, 1 (unchanged, still a sample), a gap, 2: a run of two, then one of one
    expect(calls.filter((call) => call[0] === 'lineTo')).toHaveLength(1);
    expect(calls.filter((call) => call[0] === 'arc')).toHaveLength(2);
    monitor.cmp.remove();
    scheduler.dispose();
  });

  it('removes its graph with it', () => {
    vi.useFakeTimers();
    const monitor = createGraphMonitor({ label: 'Load', get: () => 0.5, interval: 0 });
    document.body.append(monitor.cmp.elem);
    expect(resizer.observerCount()).toBe(1);
    expect(intersections.observerCount()).toBe(1);
    monitor.cmp.remove();
    expect(resizer.observerCount()).toBe(0);
    expect(intersections.observerCount()).toBe(0);
    vi.advanceTimersByTime(100);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('the property grid’s graph item (p805 D9)', () => {
  it('shows the text at once and its graph once the module loads', async () => {
    const stats = { drawCalls: 120 };
    const created: Field<unknown>[] = [];
    const grid = createPropertyGrid();
    addPropertyGridItems(grid, [
      {
        target: stats,
        key: 'drawCalls',
        label: 'Draw calls',
        view: 'graph',
        readonly: true,
        bufferSize: 30,
        onCreate: (field) => created.push(field),
      },
    ]);
    document.body.append(grid.cmp.elem);
    const row = grid.content.elem.querySelector('.aekField') as HTMLElement;
    expect(row.querySelector('.aekMonitor__value')?.textContent).toBe('120.00');
    // The text's line and the graph's empty one, its height kept
    expect(graphOf(row).children).toHaveLength(0);
    expect(created).toHaveLength(1);
    await vi.dynamicImportSettled();
    expect(graphOf(row).querySelector('.aekTimeSeries')).not.toBe(null);
    // The same field: `onCreate` isn't called again
    expect(created).toHaveLength(1);
    expect(created[0].cmp.elem).toBe(row);
    grid.cmp.remove();
    expect(resizer.observerCount()).toBe(0);
  });

  it('drops the graph of a grid removed before it loaded', async () => {
    const grid = createPropertyGrid();
    addPropertyGridItems(grid, [{ get: () => 1, label: 'Load', view: 'graph' }]);
    grid.cmp.remove();
    await vi.dynamicImportSettled();
    expect(resizer.observerCount()).toBe(0);
    expect(intersections.observerCount()).toBe(0);
  });

  it('shows a value that isn’t a number as a monitor, with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const grid = createPropertyGrid();
    addPropertyGridItems(grid, [{ get: () => 'idle', label: 'State', view: 'graph' }]);
    const row = grid.content.elem.querySelector('.aekField') as HTMLElement;
    expect(row.getAttribute('data-kind')).toBe('monitor');
    expect(graphOf(row)).toBe(null);
    expect(row.querySelector('.aekMonitor__value')?.textContent).toBe('idle');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('"State"');
    grid.cmp.remove();
  });
});
