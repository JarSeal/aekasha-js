import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  stubCanvas2d,
  stubIntersectionObserver,
  stubKitDomAsync,
  stubMatchMedia,
  stubResizeObserver,
  type Recorded2dCall,
} from '../../testing/KitDom';
import { createTimeSeries, type TimeSeries, type TimeSeriesProps } from './TimeSeries';

let resizer: ReturnType<typeof stubResizeObserver>;
let intersections: ReturnType<typeof stubIntersectionObserver>;
let canvas2d: ReturnType<typeof stubCanvas2d>;
let media: ReturnType<typeof stubMatchMedia>;

beforeAll(async () => {
  await stubKitDomAsync();
  resizer = stubResizeObserver();
  intersections = stubIntersectionObserver();
  canvas2d = stubCanvas2d({ computedStyle: { '--aek-time-series-line-width': '2' } });
  media = stubMatchMedia();
});

afterAll(() => {
  resizer.restore();
  intersections.restore();
  canvas2d.restore();
  media.restore();
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

const part = (series: TimeSeries, name: string) =>
  series.cmp.elem.querySelector(`.aekTimeSeries__${name}`) as HTMLElement;
const getCanvas = (series: TimeSeries) => part(series, 'canvas') as HTMLCanvasElement;
const callsOf = (series: TimeSeries) => canvas2d.calls(getCanvas(series));
const named = (calls: Recorded2dCall[], name: string) => calls.filter((call) => call[0] === name);
/** A frame: the stubbed animation frame is a 16 ms timer */
const frame = () => vi.advanceTimersByTime(16);

/** A time series in the page, 100 by 50 px, drawn once */
const setup = (props: Partial<TimeSeriesProps> = {}) => {
  const series = createTimeSeries({ series: [{ label: 'Frame' }], capacity: 11, ...props });
  document.body.append(series.cmp.elem);
  resizer.resize(part(series, 'plot'), { width: 100, height: 50 });
  frame();
  return series;
};

const getTicks = (series: TimeSeries) =>
  [...series.cmp.elem.querySelectorAll('.aekTimeSeries__tick')].map((tick) => tick.textContent);

describe('time series (p805 D9)', () => {
  it('hides the plot from assistive tech and writes a summary per series', () => {
    const series = setup({
      series: [{ label: 'Physics' }, { label: 'Render', color: 'tomato' }],
      unit: 'ms',
    });
    expect(part(series, 'plot').getAttribute('aria-hidden')).toBe('true');
    const items = [...series.cmp.elem.querySelectorAll('.aekTimeSeries__item')];
    expect(items.map((item) => item.querySelector('.aekTimeSeries__label')?.textContent)).toEqual([
      'Physics',
      'Render',
    ]);
    // No samples yet: a dash and no range
    expect(part(series, 'value').textContent).toBe('–');
    expect(part(series, 'range').textContent).toBe('');
    expect(items[0].querySelector('.aekTimeSeries__swatch')?.getAttribute('aria-hidden')).toBe(
      'true'
    );
    series.pushAll([16.63, 4]);
    series.pushAll([12.5, 5]);
    frame();
    // At most every 250 ms, not per frame
    expect(part(series, 'value').textContent).toBe('–');
    vi.advanceTimersByTime(250);
    expect(items[0].querySelector('.aekTimeSeries__value')?.textContent).toBe('12.5 ms');
    expect(items[0].querySelector('.aekTimeSeries__range')?.textContent).toBe('min 12.5, max 16.6');
    expect(items[1].querySelector('.aekTimeSeries__value')?.textContent).toBe('5.00 ms');
    series.cmp.remove();

    const bare = setup({ summary: false, format: (value) => `${value} fps` });
    expect(part(bare, 'summary')).toBe(null);
    bare.cmp.remove();
  });

  it('draws whole on its first frame, in its colours read once', () => {
    const series = createTimeSeries({
      series: [{ label: 'A' }, { label: 'B', color: 'tomato' }],
      capacity: 11,
    });
    series.pushAll([1, 2]);
    document.body.append(series.cmp.elem);
    // Nothing before it has a size
    frame();
    expect(callsOf(series)).toEqual([]);
    resizer.resize(part(series, 'plot'), { width: 100, height: 50 });
    frame();
    const calls = callsOf(series);
    expect(calls[0]).toEqual(['clearRect', 0, 0, 100, 50]);
    expect(calls).toContainEqual(['set', 'lineWidth', 2]);
    const colors = named(calls, 'set').filter((call) => call[1] === 'strokeStyle');
    expect(colors.map((call) => call[2])).toEqual(['var(--aek-chart-1)', 'tomato']);
    expect(named(calls, 'stroke')).toHaveLength(2);
    // One sample each: a dot where its run starts, none after
    expect(named(calls, 'arc')).toHaveLength(2);
    // The canvas' own colour is back to none
    expect(getCanvas(series).style.color).toBe('');
    series.cmp.remove();
  });

  it('shifts the bitmap by whole pixels and strokes only the new samples', () => {
    const series = setup();
    series.push(1);
    series.push(2);
    frame();
    canvas2d.clear(getCanvas(series));
    series.push(3);
    frame();
    const calls = callsOf(series);
    // Width 100, line 2 px: a step of 9.8 px, shifted by 10; the drift then makes one shift 9
    const draws = named(calls, 'drawImage');
    expect(draws).toHaveLength(1);
    expect(draws[0].slice(2)).toEqual([-10, 0]);
    expect(named(calls, 'clearRect')).toEqual([['clearRect', 0, 0, 100, 50]]);
    // From the last sample to the new one: one segment, no dot
    expect(named(calls, 'moveTo')).toHaveLength(1);
    expect(named(calls, 'lineTo')).toHaveLength(1);
    expect(named(calls, 'arc')).toHaveLength(0);
    const shifts: unknown[] = [];
    for (let i = 0; i < 4; i++) {
      canvas2d.clear(getCanvas(series));
      series.push(2);
      frame();
      shifts.push(named(callsOf(series), 'drawImage')[0][2]);
    }
    // 9.8 a sample: whole pixels that never drift more than half a pixel from it
    expect(shifts).toEqual([-10, -9, -10, -10]);
    series.cmp.remove();
  });

  it('draws in the frame of an app loop that pushes every frame, after it', () => {
    const series = setup();
    // The first draw's kept callback runs empty: none pending now
    frame();
    // An app's loop: its frame callback asked for before the time series' first
    const order: string[] = [];
    let pushes = 0;
    const appLoop = () => {
      if (pushes >= 4) return;
      requestAnimationFrame(appLoop);
      series.push((pushes++ % 2) / 2);
      order.push('push');
    };
    requestAnimationFrame(appLoop);
    for (let i = 0; i < 6; i++) {
      canvas2d.clear(getCanvas(series));
      frame();
      if (callsOf(series).some((call) => call[0] === 'stroke')) order.push('draw');
    }
    // The first push's draw is a frame later (with the second's); from then on every push is
    // drawn in its own frame, after it
    expect(order).toEqual(['push', 'push', 'draw', 'push', 'draw', 'push', 'draw']);
    series.cmp.remove();
  });

  it('draws once per frame whatever the samples since', () => {
    const series = setup();
    series.push(0.5);
    frame();
    canvas2d.clear(getCanvas(series));
    // Inside the range: no rescale
    series.push(0.25);
    series.push(0.75);
    series.push(0.5);
    frame();
    const calls = callsOf(series);
    expect(named(calls, 'drawImage')).toHaveLength(1);
    expect(named(calls, 'lineTo')).toHaveLength(3);
    canvas2d.clear(getCanvas(series));
    // Nothing new: no draw
    frame();
    expect(callsOf(series)).toEqual([]);
    series.cmp.remove();
  });

  it('breaks a line at a gap and marks the start of the next run', () => {
    const series = setup();
    series.push(1);
    series.push(NaN);
    series.push(2);
    series.push(3);
    frame();
    const calls = callsOf(series);
    expect(named(calls, 'moveTo').length).toBeGreaterThanOrEqual(2);
    expect(named(calls, 'lineTo')).toHaveLength(1);
    // Each run's start: the lone first sample, and the run after the gap
    expect(named(calls, 'arc')).toHaveLength(2);
    series.cmp.remove();
  });

  it('grows the range to a nice ceiling past it and draws it whole', () => {
    const series = setup();
    expect(getTicks(series)).toEqual(['0.0', '0.5', '1.0']);
    series.push(0.8);
    frame();
    canvas2d.clear(getCanvas(series));
    series.push(16.7);
    frame();
    // 16.7 with room is 18.4: a nice ceiling of 20, ticks at 10
    expect(getTicks(series)).toEqual(['0', '10', '20']);
    const calls = callsOf(series);
    expect(named(calls, 'drawImage')).toHaveLength(0);
    expect(calls[0]).toEqual(['clearRect', 0, 0, 100, 50]);
    // Lower values don't shrink it before a whole buffer
    for (let i = 0; i < 9; i++) series.push(1);
    expect(getTicks(series)).toEqual(['0', '10', '20']);
    // The 11th since the last check: the spike is still in the buffer
    series.push(1);
    expect(getTicks(series)).toEqual(['0', '10', '20']);
    for (let i = 0; i < 11; i++) series.push(1);
    expect(getTicks(series)).toEqual(['0', '1', '2']);
    // A ceiling of 50: three ticks that end at it, not four up to 60
    series.push(30);
    expect(getTicks(series)).toEqual(['0', '25', '50']);
    series.cmp.remove();

    // Without ticks the range is the nice ceiling itself (the 45 threshold with room: 50, not
    // the ticks' 60)
    const bare = setup({ ticks: false, thresholds: [{ value: 45, label: 'Limit' }] });
    bare.push(25);
    const limit = bare.cmp.elem.querySelector('.aekTimeSeries__threshold') as HTMLElement;
    // 45 of 0 to 50, from the top
    expect(limit.style.getPropertyValue('--aek-time-series-at')).toBe(String(1 - 45 / 50));
    bare.cmp.remove();
  });

  it('keeps a fixed end, and shows the thresholds in its range', () => {
    const series = setup({
      min: 0,
      max: 40,
      thresholds: [
        { value: 16.7, label: 'Budget 16.7 ms' },
        { value: 50, label: 'Off the scale', tone: 'danger' },
      ],
    });
    expect(getTicks(series)).toEqual(['0', '20', '40']);
    const [budget, over] = [...series.cmp.elem.querySelectorAll('.aekTimeSeries__threshold')];
    expect(budget.getAttribute('data-tone')).toBe('warning');
    expect(budget.textContent).toBe('Budget 16.7 ms');
    expect(budget.hasAttribute('hidden')).toBe(false);
    expect(over.getAttribute('data-tone')).toBe('danger');
    expect(over.hasAttribute('hidden')).toBe(true);
    // A value past a fixed end is held at it: no rescale
    series.push(100);
    expect(getTicks(series)).toEqual(['0', '20', '40']);
    // Freed, the range takes the values and the thresholds
    series.setRange({});
    expect(getTicks(series)).toEqual(['0', '100', '200']);
    expect(over.hasAttribute('hidden')).toBe(false);
    series.cmp.remove();

    const auto = setup({ thresholds: [{ value: 16.7, label: 'Budget' }], ticks: false });
    // The auto range shows a threshold over the values
    auto.push(4);
    const threshold = auto.cmp.elem.querySelector('.aekTimeSeries__threshold') as HTMLElement;
    expect(threshold.hasAttribute('hidden')).toBe(false);
    expect(getTicks(auto)).toEqual([]);
    auto.cmp.remove();
  });

  it('draws nothing while paused, and whole on resume', () => {
    const series = setup();
    series.push(1);
    frame();
    series.pause();
    expect(series.isPaused()).toBe(true);
    expect(series.cmp.elem.hasAttribute('data-paused')).toBe(true);
    canvas2d.clear(getCanvas(series));
    series.push(2);
    frame();
    expect(callsOf(series)).toEqual([]);
    series.resume();
    frame();
    const calls = callsOf(series);
    expect(calls[0]).toEqual(['clearRect', 0, 0, 100, 50]);
    // Both samples, kept while paused
    expect(named(calls, 'lineTo')).toHaveLength(1);
    expect(series.cmp.elem.hasAttribute('data-paused')).toBe(false);
    series.cmp.remove();
  });

  it('writes its summary out of view, and holds it while paused', () => {
    const series = setup({ unit: 'ms' });
    intersections.intersect(series.cmp.elem, false);
    series.push(4);
    vi.advanceTimersByTime(250);
    expect(part(series, 'value').textContent).toBe('4.00 ms');
    series.pause();
    series.push(5);
    vi.advanceTimersByTime(250);
    expect(part(series, 'value').textContent).toBe('4.00 ms');
    series.cmp.remove();
  });

  it('draws nothing while out of view, and whole when it shows again', () => {
    const series = setup();
    intersections.intersect(series.cmp.elem, false);
    canvas2d.clear(getCanvas(series));
    series.push(1);
    frame();
    expect(callsOf(series)).toEqual([]);
    intersections.intersect(series.cmp.elem, true);
    frame();
    expect(callsOf(series)[0]).toEqual(['clearRect', 0, 0, 100, 50]);
    series.cmp.remove();
  });

  it('reads its colours again and draws whole on a theme change', () => {
    const series = setup();
    series.push(1);
    frame();
    canvas2d.clear(getCanvas(series));
    media.setDark(true);
    media.setDark(false);
    frame();
    const calls = callsOf(series);
    expect(calls[0]).toEqual(['clearRect', 0, 0, 100, 50]);
    expect(calls).toContainEqual(['set', 'strokeStyle', 'var(--aek-chart-1)']);
    series.cmp.remove();
  });

  it('draws whole on a resize at the pixel ratio', () => {
    const series = setup();
    series.push(1);
    frame();
    canvas2d.clear(getCanvas(series));
    Object.assign(window, { devicePixelRatio: 2 });
    resizer.resize(part(series, 'plot'), { width: 120, height: 40 });
    expect(getCanvas(series).width).toBe(240);
    expect(getCanvas(series).height).toBe(80);
    frame();
    const calls = callsOf(series);
    expect(calls[0]).toEqual(['clearRect', 0, 0, 240, 80]);
    expect(calls).toContainEqual(['set', 'lineWidth', 4]);
    Object.assign(window, { devicePixelRatio: 1 });
    series.cmp.remove();
  });

  it('clears its samples', () => {
    const series = setup({ unit: 'ms' });
    series.push(30);
    vi.advanceTimersByTime(300);
    expect(part(series, 'value').textContent).toBe('30.0 ms');
    series.clear();
    expect(part(series, 'value').textContent).toBe('–');
    expect(getTicks(series)).toEqual(['0.0', '0.5', '1.0']);
    canvas2d.clear(getCanvas(series));
    frame();
    expect(named(callsOf(series), 'lineTo')).toHaveLength(0);
    series.cmp.remove();
  });

  it('leaves no observer, listener, frame or timer after its removal', () => {
    const series = setup();
    series.push(1);
    expect(resizer.observerCount()).toBe(1);
    expect(intersections.observerCount()).toBe(1);
    expect(media.listenerCount()).toBe(1);
    series.cmp.remove();
    expect(resizer.observerCount()).toBe(0);
    expect(intersections.observerCount()).toBe(0);
    expect(media.listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
