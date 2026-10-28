// The time series (p805 D9): figures that change every frame as lines over their last
// `capacity` samples, on a canvas. Phase 0's probe picked the renderer: each frame the drawn
// bitmap moves left by the new samples' width (`drawImage` through a back canvas, by whole device
// pixels so nothing blurs) and only the new segments are stroked; the whole path is drawn on a
// resize, a rescale, a theme change, a resume and a show. The grid, its ticks and the thresholds
// are HTML over the canvas (a shift would cut them), and the colours are the tokens read once and
// again on a theme change (`ThemeWatch.ts`), never a style read per frame. Nothing allocates per
// push or per draw (D14's perf pass).
import type { CMPAttr, CMPHandle } from '../../core/CMPTypes';
import { CMP, classes } from '../../core/CMP';
import { onKitThemeChange } from '../../core/ThemeWatch';
import { formatTick, getNiceCeiling, getNiceTicks } from './ChartScale';
import './TimeSeries.scss';
import '../../styles/kit.scss';

/** A line of a {@link createTimeSeries}: its name and colour. */
export type TimeSeriesSeries = {
  /** Its name in the summary ('Physics'). */
  label: string;
  /** Its line's colour, any CSS colour (default the chart series by its place,
   * `var(--aek-chart-1)` on). */
  color?: string;
};

/** A {@link createTimeSeries}' line across the plot at a value: a budget, a limit. */
export type TimeSeriesThreshold = {
  /** Where it's drawn, in the series' values. */
  value: number;
  /** Its text at the line's end ('Budget 16.7 ms'): the line is never the only signal. */
  label: string;
  /** Its status colour (default `'warning'`): a threshold is a status, not a series. */
  tone?: 'info' | 'success' | 'warning' | 'danger';
};

/** What {@link createTimeSeries} draws. */
export type TimeSeriesProps = {
  /** Its lines, in order (at least one): `pushAll`'s values come in this order. */
  series: readonly TimeSeriesSeries[];
  /** How many samples it holds and spreads across its width (default 300, 5 s at 60 Hz): a push
   * past it drops the oldest. */
  capacity?: number;
  /** The value at the bottom (default 0, or a nice floor under a negative value). */
  min?: number;
  /** The value at the top (default a nice ceiling over the values and thresholds: it grows when a
   * value passes it and shrinks only after a whole buffer under a lower one). */
  max?: number;
  /** A unit after each figure in the summary ('ms'). */
  unit?: string;
  /** A figure's text in the summary (default: 2 decimals under 10, 1 under 100, else none). */
  format?: (value: number) => string;
  /** The plot's height: px, or any CSS length (default `--aek-time-series-height`). */
  height?: number | string;
  /** Lines across the plot at a value, in a status colour with their text. */
  thresholds?: readonly TimeSeriesThreshold[];
  /** Shows the grid lines with their values (default true). */
  ticks?: boolean;
  /** Shows each series' name, latest value, min and max under the plot (default true): what a
   * screen reader reads. Without it the figure beside it has to say what it shows. */
  summary?: boolean;
  /** Extra classes for its element. */
  class?: string | string[];
  /** Extra attributes for its element. */
  attr?: CMPAttr;
  /** Its element id (default: a generated one, not written to the element). */
  id?: string;
};

/** A time series {@link createTimeSeries} made: its CMP and its setters. */
export type TimeSeries = {
  /** Its element (`.aekTimeSeries`): add it where it goes. */
  cmp: CMPHandle;
  /** Adds a sample of the first series (the others' a gap; `NaN` is one), drawn on the next
   * animation frame. For a figure that changes every frame: it allocates nothing. */
  push: (value: number) => void;
  /** Adds a sample of every series, in `series`' order (one missing or `NaN` a gap). Reuse the
   * array: it's read, not kept. */
  pushAll: (values: ArrayLike<number>) => void;
  /** Removes every sample. */
  clear: () => void;
  /** Fixes an end of the range, or lets it follow the values again (`undefined`). */
  setRange: (range: { min?: number; max?: number }) => void;
  /** Stops drawing (the samples are still kept): the lines and the summary hold still. */
  pause: () => void;
  /** Draws again, every sample kept while it was paused. */
  resume: () => void;
  /** Whether it's paused. */
  isPaused: () => boolean;
};

const DEFAULT_CAPACITY = 300;
/** The plot's inset above and below the lines, in CSS px (TimeSeries.scss' `--_pad`) */
const PAD = 2;
const TICK_COUNT = 3;
/** The tick counts tried for ticks that end at the range's nice ends, in order */
const TICK_COUNTS = [3, 2, 4];
/** The auto range's room over the largest value, before its nice ceiling */
const HEADROOM = 1.1;
/** How often the summary's text is written, at most (D9: not per frame) */
const SUMMARY_MS = 250;
const DEFAULT_LINE_WIDTH = 1.5;
const SERIES_COLORS = 6;

const defaultFormat = (value: number) => {
  const size = Math.abs(value);
  return value.toFixed(size >= 100 ? 0 : size >= 10 ? 1 : 2);
};

const seriesColor = (series: TimeSeriesSeries | undefined, index: number) =>
  series?.color ?? `var(--aek-chart-${(index % SERIES_COLORS) + 1})`;

const createPart = (tag: string, className: string, parent: Element) => {
  const part = document.createElement(tag);
  part.className = className;
  parent.append(part);
  return part;
};

/** A text node in a part, written by its `data` */
const createTextPart = (className: string, parent: Element) => {
  const text = document.createTextNode('');
  createPart('span', className, parent).append(text);
  return text;
};

/**
 * Creates a time series (p805 D9): lines of figures that change every frame (frame time, its
 * stages, draw calls) over their last `capacity` samples, on a canvas that draws only what's new.
 * - Samples: `push(value)` for one series, `pushAll(values)` for several (a reused array), as often
 *   as every frame; it draws at most once per animation frame while it shows (scrolled into view,
 *   in a shown panel, not paused), whatever the samples since. A `NaN` is a gap.
 * - Range: from `min` (default 0, or a nice floor under a negative value) to `max` (default a
 *   nice ceiling over the values and the thresholds: 1, 2, 2.5 or 5 times a power of ten with some
 *   room); an auto end grows when a value passes it and shrinks only after a whole buffer under a
 *   lower one, so it rarely redraws whole. `setRange` fixes or frees an end.
 * - Parts: `.aekTimeSeries` (`data-paused`) holding `__plot` (`aria-hidden`: the `__grid` lines,
 *   each with its `__tick`, the `__canvas` and the `__threshold`s with their `__thresholdLabel`
 *   and `data-tone`) and `__summary` (an `__item` per series: `__swatch`, `__label`, `__value`,
 *   `__range`).
 * - Custom properties: `--aek-time-series-height` (the plot's), `--aek-time-series-line-width`
 *   (the lines', read with the colours), `--aek-time-series-grid-color`.
 * - Colours: each series' `color`, else the chart series by its place; the tokens are read when it
 *   first draws and again when the theme or density changes, never per frame.
 * - ARIA: the plot is hidden from assistive tech; the summary is its text (each series' latest
 *   value, min and max, written at most 4 times a second while samples come, in view or not, and
 *   held while paused; not a live region). Without `summary`, a figure beside it says what it
 *   shows (p800 D8's written deviation).
 * @example
 * ```ts
 * const frame = createTimeSeries({
 *   series: [{ label: 'Physics' }, { label: 'Render' }],
 *   capacity: 600,
 *   unit: 'ms',
 *   thresholds: [{ value: 16.7, label: 'Budget 16.7 ms' }],
 * });
 * statsPanel.add(frame.cmp);
 * const sample = new Float64Array(2); // reused: nothing allocated per frame
 * const tick = () => {
 *   sample[0] = getPhysicsMs();
 *   sample[1] = getRenderMs();
 *   frame.pushAll(sample);
 *   requestAnimationFrame(tick);
 * };
 * requestAnimationFrame(tick);
 * ```
 */
export const createTimeSeries = (props: TimeSeriesProps): TimeSeries => {
  const series = props.series.length ? props.series : [{ label: '' }];
  const seriesCount = series.length;
  const capacity = Math.max(2, Math.floor(props.capacity ?? DEFAULT_CAPACITY));
  const format = props.format ?? defaultFormat;
  const unit = props.unit ? ` ${props.unit}` : '';
  const thresholds = props.thresholds ?? [];

  const rings = series.map(() => new Float32Array(capacity).fill(NaN));
  /** The rings' next write, how many samples they hold, and how many came since the last draw */
  let head = 0;
  let count = 0;
  let fresh = 0;
  let sinceShrinkCheck = 0;
  let fixedMin = props.min;
  let fixedMax = props.max;
  /** The drawn range (none until the first `rescale`) */
  let lo = NaN;
  let hi = NaN;

  let paused = false;
  let shown = true;
  let removed = false;
  let needsFull = true;
  let colorsStale = true;
  let frame: number | null = null;
  let summaryTimer: ReturnType<typeof setTimeout> | null = null;

  /** The canvas' size in device px, its pixel ratio, the line's width in CSS px */
  let width = 0;
  let height = 0;
  let ratio = 1;
  let lineWidth = DEFAULT_LINE_WIDTH;
  /** The newest sample's x on the bitmap, in device px */
  let newestX = 0;
  const colors = series.map(() => '');

  const cmp = CMP({
    id: props.id,
    idAttr: props.id !== undefined,
    class: classes('aekTimeSeries', props.class),
    attr: props.attr,
    onRemoveCmp: () => {
      removed = true;
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      if (summaryTimer !== null) clearTimeout(summaryTimer);
      summaryTimer = null;
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      removeThemeWatch();
    },
  });
  const elem = cmp.elem;
  if (props.height !== undefined) {
    const value = typeof props.height === 'number' ? `${props.height}px` : props.height;
    elem.style.setProperty('--aek-time-series-height', value);
  }

  const plot = createPart('div', 'aekTimeSeries__plot', elem);
  plot.setAttribute('aria-hidden', 'true');
  const grid = createPart('div', 'aekTimeSeries__grid', plot);
  const canvas = createPart('canvas', 'aekTimeSeries__canvas', plot) as HTMLCanvasElement;
  const ctx = canvas.getContext('2d');
  /** The bitmap's copy a shift draws from, made on the first shift */
  let back: HTMLCanvasElement | null = null;
  let backCtx: CanvasRenderingContext2D | null = null;

  const thresholdElems = thresholds.map((threshold) => {
    const line = createPart('div', 'aekTimeSeries__threshold', plot);
    line.setAttribute('data-tone', threshold.tone ?? 'warning');
    createPart('span', 'aekTimeSeries__thresholdLabel', line).textContent = threshold.label;
    return line;
  });

  const summaryItems =
    props.summary === false
      ? null
      : (() => {
          const list = createPart('ul', 'aekTimeSeries__summary', elem);
          return series.map((line, index) => {
            const item = createPart('li', 'aekTimeSeries__item', list);
            const swatch = createPart('span', 'aekTimeSeries__swatch', item);
            swatch.setAttribute('aria-hidden', 'true');
            swatch.style.setProperty('--aek-time-series-swatch', seriesColor(line, index));
            createPart('span', 'aekTimeSeries__label', item).textContent = line.label;
            return {
              value: createTextPart('aekTimeSeries__value', item),
              range: createTextPart('aekTimeSeries__range', item),
            };
          });
        })();

  /** The i-th sample of a series held, oldest first */
  const valueAt = (ring: Float32Array, i: number) => ring[(head - count + i + capacity) % capacity];

  // --- The range ---

  /** The range the samples held and the thresholds need, each fixed end as it is */
  const computeRange = () => {
    let dataMin = Infinity;
    let dataMax = -Infinity;
    for (let s = 0; s < seriesCount; s++) {
      const ring = rings[s];
      for (let i = 0; i < capacity; i++) {
        const value = ring[i];
        if (value < dataMin) dataMin = value;
        if (value > dataMax) dataMax = value;
      }
    }
    for (const threshold of thresholds) {
      if (threshold.value < dataMin) dataMin = threshold.value;
      if (threshold.value > dataMax) dataMax = threshold.value;
    }
    let low = fixedMin ?? (dataMin < 0 ? -getNiceCeiling(-dataMin * HEADROOM) : 0);
    let high = fixedMax ?? getNiceCeiling(Math.max(dataMax, 0) * HEADROOM);
    if (!(high > low)) high = low + 1;
    // The ticks that end at the auto ends (0 to 50: 3 ticks at 25, not 4 at 20 up to 60), else 3
    let ticks = getNiceTicks(low, high, { count: TICK_COUNT });
    for (const count of TICK_COUNTS) {
      const fit = getNiceTicks(low, high, { count });
      const isFit =
        (fixedMin !== undefined || fit.min === low) && (fixedMax !== undefined || fit.max === high);
      if (!isFit) continue;
      ticks = fit;
      break;
    }
    // With ticks shown an auto end is the ticks' (a nice value); a fixed one stays
    if (props.ticks !== false && fixedMin === undefined) low = ticks.min;
    if (props.ticks !== false && fixedMax === undefined) high = ticks.max;
    return { low, high, ticks };
  };

  /** Places the grid lines and thresholds at the range (rare: a rescale) */
  const drawAxes = (ticks: ReturnType<typeof getNiceTicks>) => {
    const span = hi - lo;
    const at = (value: number) => String(1 - (value - lo) / span);
    if (props.ticks !== false) {
      grid.replaceChildren();
      for (const value of ticks.values) {
        if (value < lo || value > hi) continue;
        const line = createPart('div', 'aekTimeSeries__gridLine', grid);
        line.style.setProperty('--aek-time-series-at', at(value));
        createPart('span', 'aekTimeSeries__tick', line).textContent = formatTick(
          value,
          ticks.decimals
        );
      }
    }
    thresholds.forEach((threshold, index) => {
      const line = thresholdElems[index];
      const isIn = threshold.value >= lo && threshold.value <= hi;
      if (isIn) line.removeAttribute('hidden');
      else line.setAttribute('hidden', '');
      line.style.setProperty('--aek-time-series-at', at(threshold.value));
    });
  };

  /** Takes the range the samples need when it differs from the drawn one */
  const rescale = (onlyShrink: boolean) => {
    const { low, high, ticks } = computeRange();
    if (low === lo && high === hi) return;
    if (onlyShrink && (low < lo || high > hi)) return;
    lo = low;
    hi = high;
    needsFull = true;
    drawAxes(ticks);
  };

  // --- Drawing ---

  /** The plot's y of a value, in device px, held inside the plot */
  const toY = (value: number) => {
    const share = (value - lo) / (hi - lo);
    const pad = PAD * ratio;
    return pad + (1 - (share < 0 ? 0 : share > 1 ? 1 : share)) * (height - 2 * pad);
  };

  const readColors = () => {
    colorsStale = false;
    if (typeof window.getComputedStyle !== 'function') return;
    // Each series' colour through the canvas' own `color`: a token, a `color-mix()`, any CSS
    // colour comes back as one the canvas takes
    for (let s = 0; s < seriesCount; s++) {
      canvas.style.color = seriesColor(series[s], s);
      colors[s] = window.getComputedStyle(canvas).color;
    }
    canvas.style.color = '';
    const style = window.getComputedStyle(canvas);
    const cssWidth = parseFloat(style.getPropertyValue('--aek-time-series-line-width'));
    lineWidth = cssWidth > 0 ? cssWidth : DEFAULT_LINE_WIDTH;
  };

  /** Strokes each series from sample `start` on (joined to the one before it), and a dot where a
   * run starts, its next samples' line drawn over it */
  const drawSamples = (context: CanvasRenderingContext2D, start: number) => {
    const step = (width - lineWidth * ratio) / (capacity - 1);
    const dot = lineWidth * ratio;
    for (let s = 0; s < seriesCount; s++) {
      const ring = rings[s];
      context.strokeStyle = colors[s];
      context.fillStyle = colors[s];
      context.beginPath();
      let isDown = false;
      for (let i = start > 0 ? start - 1 : 0; i < count; i++) {
        const value = valueAt(ring, i);
        if (value !== value) {
          isDown = false;
          continue;
        }
        const x = newestX - (count - 1 - i) * step;
        if (isDown) context.lineTo(x, toY(value));
        else context.moveTo(x, toY(value));
        isDown = true;
      }
      context.stroke();
      let hasDots = false;
      for (let i = start; i < count; i++) {
        const value = valueAt(ring, i);
        if (value !== value) continue;
        if (i > 0) {
          const before = valueAt(ring, i - 1);
          if (before === before) continue;
        }
        if (!hasDots) context.beginPath();
        hasDots = true;
        const x = newestX - (count - 1 - i) * step;
        const y = toY(value);
        context.moveTo(x + dot, y);
        context.arc(x, y, dot, 0, Math.PI * 2);
      }
      if (hasDots) context.fill();
    }
  };

  const drawAll = (context: CanvasRenderingContext2D) => {
    context.clearRect(0, 0, width, height);
    context.lineWidth = lineWidth * ratio;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    newestX = width - (lineWidth * ratio) / 2;
    drawSamples(context, 0);
  };

  /** Moves the bitmap left by the new samples' width, in whole pixels, and strokes them */
  const drawFresh = (context: CanvasRenderingContext2D, added: number) => {
    if (!back) {
      back = document.createElement('canvas');
      backCtx = back.getContext('2d');
    }
    if (!backCtx) {
      drawAll(context);
      return;
    }
    if (back.width !== width || back.height !== height) {
      back.width = width;
      back.height = height;
    }
    const step = (width - lineWidth * ratio) / (capacity - 1);
    const right = width - (lineWidth * ratio) / 2;
    // The shift that brings the newest sample within half a pixel of the right edge
    const shift = Math.round(newestX - (right - added * step));
    backCtx.clearRect(0, 0, width, height);
    backCtx.drawImage(canvas, 0, 0);
    context.clearRect(0, 0, width, height);
    context.drawImage(back, -shift, 0);
    newestX += added * step - shift;
    drawSamples(context, count - added);
  };

  const canDraw = () => !removed && !paused && shown;

  const onFrame = () => {
    frame = null;
    if (!ctx || !canDraw() || !canvas.isConnected) return;
    if (!width && typeof ResizeObserver !== 'function') {
      const rect = plot.getBoundingClientRect();
      resize(rect.width, rect.height);
    }
    if (!width || !height) return;
    if (colorsStale) readColors();
    const isDrawing = needsFull || fresh > 0;
    if (needsFull || fresh >= count) drawAll(ctx);
    else if (fresh > 0) drawFresh(ctx, fresh);
    needsFull = false;
    fresh = 0;
    if (!isDrawing) return;
    // Kept for the next frame while samples come: an app's loop pushing every frame registered its
    // frame callback first, so this then runs after it in the same frame and draws every frame
    // (a callback asked for in a push would run a frame later, and only every other frame)
    schedule();
  };

  const schedule = () => {
    if (frame === null && canDraw()) frame = requestAnimationFrame(onFrame);
  };

  /** Draws it whole on the next frame (a resize, a theme change, a show) */
  const redraw = () => {
    needsFull = true;
    schedule();
  };

  // --- The summary ---

  const writeSummary = () => {
    if (!summaryItems) return;
    for (let s = 0; s < seriesCount; s++) {
      const ring = rings[s];
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < capacity; i++) {
        const value = ring[i];
        if (value < min) min = value;
        if (value > max) max = value;
      }
      const latest = count ? valueAt(ring, count - 1) : NaN;
      const valueText = latest === latest ? `${format(latest)}${unit}` : '–';
      const rangeText = min <= max ? `min ${format(min)}, max ${format(max)}` : '';
      const item = summaryItems[s];
      if (item.value.data !== valueText) item.value.data = valueText;
      if (item.range.data !== rangeText) item.range.data = rangeText;
    }
  };

  const onSummary = () => {
    summaryTimer = null;
    writeSummary();
  };

  // --- Size, visibility and theme ---

  const resize = (cssWidth: number, cssHeight: number) => {
    ratio = window.devicePixelRatio || 1;
    const nextWidth = Math.round(cssWidth * ratio);
    const nextHeight = Math.round(cssHeight * ratio);
    if (nextWidth === width && nextHeight === height) return;
    width = nextWidth;
    height = nextHeight;
    canvas.width = width;
    canvas.height = height;
    redraw();
  };

  const resizeObserver =
    typeof ResizeObserver === 'function'
      ? new ResizeObserver((entries) => {
          const rect = entries[entries.length - 1].contentRect;
          resize(rect.width, rect.height);
        })
      : null;
  resizeObserver?.observe(plot);

  const intersectionObserver =
    typeof IntersectionObserver === 'function'
      ? new IntersectionObserver((entries) => {
          shown = entries[entries.length - 1].isIntersecting;
          if (shown) redraw();
          else if (frame !== null) {
            cancelAnimationFrame(frame);
            frame = null;
          }
        })
      : null;
  intersectionObserver?.observe(elem);

  const removeThemeWatch = onKitThemeChange(elem, () => {
    colorsStale = true;
    redraw();
  });

  // --- Samples ---

  /** Takes a written sample: the rings move on, a value past an auto end rescales */
  const addSample = (isOutside: boolean) => {
    head = (head + 1) % capacity;
    if (count < capacity) count++;
    if (fresh < capacity) fresh++;
    if (isOutside) rescale(false);
    if (++sinceShrinkCheck >= capacity) {
      sinceShrinkCheck = 0;
      rescale(true);
    }
    // The summary is what a screen reader reads: written whether the plot draws (in view) or not
    if (summaryItems && summaryTimer === null && !paused) {
      summaryTimer = setTimeout(onSummary, SUMMARY_MS);
    }
    schedule();
  };

  const isOutside = (value: number) =>
    (fixedMax === undefined && value > hi) || (fixedMin === undefined && value < lo);

  rescale(false);
  writeSummary();

  return {
    cmp,
    push: (value) => {
      rings[0][head] = value;
      for (let s = 1; s < seriesCount; s++) rings[s][head] = NaN;
      addSample(isOutside(value));
    },
    pushAll: (values) => {
      let outside = false;
      for (let s = 0; s < seriesCount; s++) {
        const value = s < values.length ? values[s] : NaN;
        rings[s][head] = value;
        if (isOutside(value)) outside = true;
      }
      addSample(outside);
    },
    clear: () => {
      for (const ring of rings) ring.fill(NaN);
      head = 0;
      count = 0;
      fresh = 0;
      sinceShrinkCheck = 0;
      rescale(false);
      writeSummary();
      redraw();
    },
    setRange: (range) => {
      fixedMin = range.min;
      fixedMax = range.max;
      rescale(false);
      redraw();
    },
    pause: () => {
      paused = true;
      elem.setAttribute('data-paused', '');
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
    },
    resume: () => {
      if (!paused) return;
      paused = false;
      elem.removeAttribute('data-paused');
      redraw();
    },
    isPaused: () => paused,
  };
};
