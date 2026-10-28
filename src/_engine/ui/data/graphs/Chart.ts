import type { CMPAttr, CMPHandle } from '../../core/CMPTypes';
import { CMP, classes } from '../../core/CMP';
import { formatTick, getNiceTicks, type ChartTicks } from './ChartScale';
import { createLegend, getPartColor, writeLegend, type GraphPart } from './GraphParts';
import './Chart.scss';
import '../../styles/kit.scss';

/** A chart's series: its name and a value per category or x (`null` none: a line's gap). */
export type ChartSeries = {
  /** Its name, in the legend and the table's header ('Frame time'). */
  label: string;
  /** A value per category (or per `x`), in order; `null` or `NaN` is none. */
  values: readonly (number | null)[];
  /** Its colour, any CSS colour (default the chart series in order, `--aek-chart-1` to `-6`). */
  color?: string;
};

/** What a chart's values are placed along: categories (its bands), or numbers (a line's x). */
export type ChartAxis = {
  /** A name per value (a bar's band, a line's point): the x labels and the table's first column.
   * Default the values' places, 1, 2, …. */
  categories?: readonly string[];
  /** A line's x per value (time, distance), on a scale of its own; bars ignore it. */
  x?: readonly number[];
};

/** What {@link createChart} draws. */
export type ChartProps = ChartAxis & {
  /** Lines through the values, or bars per category (`stacked` piles the series up). */
  type: 'line' | 'bar';
  /** The series, each in its colour. */
  series: readonly ChartSeries[];
  /** Its title, shown above it and its accessible name ('Frame time by scene'). */
  title: string;
  /** What it shows, in a sentence under the title and its accessible description ('Physics takes
   * most of the time in the gym.'): the trend a reader should see. */
  description?: string;
  /** The table's first column's header (default 'Category', or 'X' with `x`). */
  xLabel?: string;
  /** A value's text on the y axis and in the table (default the tick's decimals on the axis, the
   * value as it is in the table). */
  yFormat?: (value: number) => string;
  /** An `x`'s text on the x axis and in the table (default the tick's decimals). */
  xFormat?: (value: number) => string;
  /** Bars only: the series piled up per category (positives up from 0, negatives down). Default
   * false: side by side. */
  stacked?: boolean;
  /** The y axis' ends (default the values' range, widened to nice ticks; bars always include 0). */
  yMin?: number;
  /** See `yMin`. */
  yMax?: number;
  /** Shows the legend (default with more than one series). */
  legend?: boolean;
  /** Extra classes for its element. */
  class?: string | string[];
  /** Extra attributes for its element. */
  attr?: CMPAttr;
  /** Its element id (default: a generated one, not written to the element). */
  id?: string;
};

/** A chart {@link createChart} made: its CMP and its setters. */
export type Chart = {
  /** Its element (`.aekChart`): add it where it goes. */
  cmp: CMPHandle;
  /** Replaces the series (and the categories or `x`, when given): the plot, the axes, the legend
   * and the table drawn again. A static chart's update, not a per-frame one (a live line is
   * `createTimeSeries`). */
  setSeries: (series: readonly ChartSeries[], axis?: ChartAxis) => void;
  /** Shows the table of the values under the chart (the "Show as table" button's), or hides it
   * again (visually: assistive tech always has it). */
  setTableShown: (shown: boolean) => void;
  /** Whether the table shows. */
  isTableShown: () => boolean;
};

const SVG_NS = 'http://www.w3.org/2000/svg';
/** The plot's box: 100 by 100, stretched to the element's (strokes keep their width) */
const SIZE = 100;
/** A bar band's share its bars take (the rest the gap between bands) */
const BAR_FILL = 0.7;
/** Most x labels a categorical axis shows (every k-th past it), and a numeric one's ticks */
const MAX_BAR_LABELS = 12;
const MAX_LINE_LABELS = 8;
/** A line's points have a dot up to this many */
const MAX_DOTS = 40;
const NO_VALUE = '–';

const createElem = (tag: string, className: string) => {
  const elem = document.createElement(tag);
  elem.className = className;
  return elem;
};

const createSvg = (tag: string, className: string) => {
  const part = document.createElementNS(SVG_NS, tag);
  part.setAttribute('class', className);
  return part;
};

const round = (n: number) => Math.round(n * 100) / 100;

const readValue = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** The y range the values need: each value, or with `stacked` each category's piles */
const getValueRange = (series: readonly ChartSeries[], count: number, stacked: boolean) => {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < count; i++) {
    let up = 0;
    let down = 0;
    for (const s of series) {
      const value = readValue(s.values[i]);
      if (value === null) continue;
      if (stacked) {
        if (value >= 0) up += value;
        else down += value;
      } else {
        lo = Math.min(lo, value);
        hi = Math.max(hi, value);
      }
    }
    if (stacked) {
      lo = Math.min(lo, down);
      hi = Math.max(hi, up);
    }
  }
  return lo <= hi ? { lo, hi } : { lo: NaN, hi: NaN };
};

/**
 * Creates a static chart (p805 D9): lines or bars of a few series over categories or a numeric x,
 * with a y axis of nice ticks, a legend and the values as a table. SVG for the plot (stretched to
 * its box, so it follows its width with no measuring) and HTML for the labels; redrawn whole by
 * `setSeries`, so it's for figures that change now and then (a benchmark's results, a level's
 * history), not every frame.
 * - Parts: `.aekChart` (`data-type`) holding `__title`, `__description`, `__figure` (`__yAxis`
 *   with a `__tick` per tick, `__plot` with `svg.aekChart__svg`: `__grid` lines (the zero one
 *   `data-zero`) and a `__series` group per series (`__bar`s, or `__line` and `__points`), and
 *   `__xAxis` with its `__tick`s, an edge one `data-edge`), the legend (`.aekGraphLegend`),
 *   `__toggle` ("Show as table") and `__tableBox` (`data-shown`) with `table.aekChart__table`.
 * - Custom properties (read on any ancestor): `--aek-chart-height` (the plot's, default
 *   `--aek-space-7` × 6), `--aek-chart-grid-color` (default `--aek-border`),
 *   `--aek-chart-line-width` (default 2 px); a series' colour is written as `--aek-chart-color`
 *   on its group.
 * - ARIA: the figure is a `role="img"` named by the title and described by the description; the
 *   values are a `<table>` captioned by the title, visually hidden until the toggle (a button with
 *   `aria-expanded`) shows it, so a screen reader has them either way; the legend is
 *   `aria-hidden` (the table's headers name the series). Colour is never alone: the legend and
 *   the table name each series.
 * - Motion: none (a first draw doesn't grow).
 * @example
 * ```ts
 * const results = createChart({
 *   type: 'bar',
 *   title: 'Frame time by scene',
 *   description: 'The gym spends most of its frame in physics.',
 *   categories: ['Space', 'Gym', 'Large world'],
 *   series: [
 *     { label: 'Physics', values: [1.2, 6.8, 3.1] },
 *     { label: 'Render', values: [5.4, 4.9, 9.7] },
 *   ],
 *   stacked: true,
 *   yFormat: (ms) => `${ms} ms`,
 * });
 * benchmarkPanel.add(results.cmp);
 * ```
 */
export const createChart = (props: ChartProps): Chart => {
  const isBar = props.type === 'bar';
  const stacked = isBar && props.stacked === true;
  let series = props.series;
  let categories = props.categories;
  let xs = isBar ? undefined : props.x;
  let tableShown = false;

  const cmp = CMP({
    id: props.id,
    idAttr: props.id !== undefined,
    class: classes('aekChart', props.class),
    attr: { ...props.attr, 'data-type': props.type },
  });
  const elem = cmp.elem;
  const baseId = cmp.id;

  const title = createElem('p', 'aekChart__title');
  title.id = `${baseId}__title`;
  title.textContent = props.title;
  elem.append(title);
  const figure = createElem('div', 'aekChart__figure');
  figure.setAttribute('role', 'img');
  figure.setAttribute('aria-labelledby', title.id);
  if (props.description) {
    const description = createElem('p', 'aekChart__description');
    description.id = `${baseId}__description`;
    description.textContent = props.description;
    elem.append(description);
    figure.setAttribute('aria-describedby', description.id);
  }
  const yAxis = createElem('div', 'aekChart__yAxis');
  const plot = createElem('div', 'aekChart__plot');
  const svg = createSvg('svg', 'aekChart__svg');
  svg.setAttribute('viewBox', `0 0 ${SIZE} ${SIZE}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('focusable', 'false');
  plot.append(svg);
  const xAxis = createElem('div', 'aekChart__xAxis');
  figure.append(yAxis, plot, xAxis);
  elem.append(figure);
  const legend = props.legend ?? props.series.length > 1 ? createLegend() : null;
  if (legend) elem.append(legend);

  const tableBox = createElem('div', 'aekChart__tableBox aekVisuallyHidden');
  tableBox.id = `${baseId}__table`;
  const table = createElem('table', 'aekChart__table');
  const toggle = cmp.add({
    tag: 'button',
    class: 'aekChart__toggle',
    text: 'Show as table',
    attr: { type: 'button', 'aria-expanded': 'false', 'aria-controls': tableBox.id },
    onClick: () => setTableShown(!tableShown),
  });
  tableBox.append(table);
  elem.append(tableBox);

  const setTableShown = (shown: boolean) => {
    if (shown === tableShown) return;
    tableShown = shown;
    tableBox.classList.toggle('aekVisuallyHidden', !shown);
    tableBox.toggleAttribute('data-shown', shown);
    toggle.elem.setAttribute('aria-expanded', String(shown));
    toggle.elem.textContent = shown ? 'Hide the table' : 'Show as table';
  };

  /** How many values there are: the categories', the x's, else the longest series' */
  const getCount = () => {
    if (categories) return categories.length;
    if (xs) return xs.length;
    let count = 0;
    for (const s of series) count = Math.max(count, s.values.length);
    return count;
  };

  const getCategory = (i: number) => categories?.[i] ?? String(i + 1);

  /** A y tick's text, and a value's in the table */
  const formatY = (value: number, ticks: ChartTicks) =>
    props.yFormat ? props.yFormat(value) : formatTick(value, ticks.decimals);

  const addTick = (axis: HTMLElement, text: string, at?: number, edge?: 'start' | 'end') => {
    const tick = createElem('span', 'aekChart__tick');
    tick.textContent = text;
    if (at !== undefined) tick.style.left = `${at}%`;
    if (edge) tick.setAttribute('data-edge', edge);
    axis.append(tick);
  };

  const drawYAxis = (ticks: ChartTicks, toY: (value: number) => number) => {
    yAxis.replaceChildren();
    const grid = createSvg('g', 'aekChart__gridLines');
    // Top to bottom: the axis is a column the ticks space out evenly
    for (let i = ticks.values.length - 1; i >= 0; i--) {
      const value = ticks.values[i];
      addTick(yAxis, formatY(value, ticks));
      const line = createSvg('line', 'aekChart__grid');
      const y = String(round(toY(value)));
      line.setAttribute('x1', '0');
      line.setAttribute('x2', String(SIZE));
      line.setAttribute('y1', y);
      line.setAttribute('y2', y);
      if (value === 0) line.setAttribute('data-zero', '');
      grid.append(line);
    }
    svg.append(grid);
  };

  const drawXAxis = (count: number, toX: (i: number) => number, xTicks: ChartTicks | null) => {
    xAxis.replaceChildren();
    if (xTicks) {
      const span = xTicks.max - xTicks.min || 1;
      xTicks.values.forEach((value, i) => {
        const text = props.xFormat ? props.xFormat(value) : formatTick(value, xTicks.decimals);
        const edge = i === 0 ? 'start' : i === xTicks.values.length - 1 ? 'end' : undefined;
        addTick(xAxis, text, round(((value - xTicks.min) / span) * SIZE), edge);
      });
      return;
    }
    const every = Math.ceil(count / (isBar ? MAX_BAR_LABELS : MAX_LINE_LABELS));
    for (let i = 0; i < count; i += every) addTick(xAxis, getCategory(i), round(toX(i)));
  };

  const drawBars = (count: number, toY: (value: number) => number) => {
    const band = SIZE / Math.max(1, count);
    const barWidth = stacked ? band * BAR_FILL : (band * BAR_FILL) / Math.max(1, series.length);
    const zero = toY(0);
    const piles = stacked ? { up: new Float64Array(count), down: new Float64Array(count) } : null;
    series.forEach((s, si) => {
      const group = createSvg('g', 'aekChart__series');
      group.setAttribute('style', `--aek-chart-color: ${getSeriesColor(s, si)}`);
      for (let i = 0; i < count; i++) {
        const value = readValue(s.values[i]);
        if (value === null) continue;
        let from = 0;
        if (piles) {
          const pile = value >= 0 ? piles.up : piles.down;
          from = pile[i];
          pile[i] += value;
        }
        const y0 = from === 0 ? zero : toY(from);
        const y1 = toY(from + value);
        const left = band * i + (band * (1 - BAR_FILL)) / 2 + (stacked ? 0 : barWidth * si);
        const rect = createSvg('rect', 'aekChart__bar');
        rect.setAttribute('x', String(round(left)));
        rect.setAttribute('width', String(round(barWidth)));
        rect.setAttribute('y', String(round(Math.min(y0, y1))));
        rect.setAttribute('height', String(round(Math.abs(y1 - y0))));
        group.append(rect);
      }
      svg.append(group);
    });
  };

  const drawLines = (count: number, toX: (i: number) => number, toY: (value: number) => number) => {
    const withDots = count <= MAX_DOTS;
    series.forEach((s, si) => {
      const group = createSvg('g', 'aekChart__series');
      group.setAttribute('style', `--aek-chart-color: ${getSeriesColor(s, si)}`);
      let lineD = '';
      let dotsD = '';
      let inRun = false;
      for (let i = 0; i < count; i++) {
        const value = readValue(s.values[i]);
        if (value === null) {
          inRun = false;
          continue;
        }
        const point = `${round(toX(i))} ${round(toY(value))}`;
        lineD += inRun ? `L${point}` : `M${point}`;
        // A dot is a segment of no length: its round cap is a circle at any stretch
        if (withDots) dotsD += `M${point}L${point}`;
        inRun = true;
      }
      const line = createSvg('path', 'aekChart__line');
      line.setAttribute('d', lineD);
      group.append(line);
      if (withDots) {
        const dots = createSvg('path', 'aekChart__points');
        dots.setAttribute('d', dotsD);
        group.append(dots);
      }
      svg.append(group);
    });
  };

  const drawTable = (count: number, ticks: ChartTicks) => {
    table.replaceChildren();
    // The title shows above the chart: the caption names the table for assistive tech
    const caption = createElem('caption', 'aekVisuallyHidden');
    caption.textContent = props.title;
    const head = document.createElement('thead');
    const headRow = document.createElement('tr');
    const addHeader = (row: HTMLElement, text: string, scope: 'col' | 'row') => {
      const th = document.createElement('th');
      th.setAttribute('scope', scope);
      th.textContent = text;
      row.append(th);
    };
    addHeader(headRow, props.xLabel ?? (xs ? 'X' : 'Category'), 'col');
    for (const s of series) addHeader(headRow, s.label, 'col');
    head.append(headRow);
    const body = document.createElement('tbody');
    for (let i = 0; i < count; i++) {
      const row = document.createElement('tr');
      const x = xs ? readValue(xs[i]) : null;
      addHeader(
        row,
        xs
          ? x === null
            ? NO_VALUE
            : props.xFormat
              ? props.xFormat(x)
              : String(x)
          : getCategory(i),
        'row'
      );
      for (const s of series) {
        const td = document.createElement('td');
        const value = readValue(s.values[i]);
        td.textContent =
          value === null ? NO_VALUE : props.yFormat ? formatY(value, ticks) : String(value);
        row.append(td);
      }
      body.append(row);
    }
    table.append(caption, head, body);
  };

  const getSeriesColor = (s: ChartSeries, index: number) =>
    getPartColor({ label: s.label, value: 0, color: s.color }, index);

  const draw = () => {
    const count = getCount();
    const range = getValueRange(series, count, stacked);
    const ticks = getNiceTicks(props.yMin ?? range.lo, props.yMax ?? range.hi, {
      includeZero: isBar,
    });
    const ySpan = ticks.max - ticks.min || 1;
    const toY = (value: number) => SIZE - ((value - ticks.min) / ySpan) * SIZE;

    let xTicks: ChartTicks | null = null;
    let toX = (i: number) => ((i + 0.5) / Math.max(1, count)) * SIZE;
    if (xs) {
      let lo = Infinity;
      let hi = -Infinity;
      for (const x of xs) {
        const value = readValue(x);
        if (value === null) continue;
        lo = Math.min(lo, value);
        hi = Math.max(hi, value);
      }
      const nice = getNiceTicks(lo, hi, { count: MAX_LINE_LABELS - 2 });
      const xSpan = nice.max - nice.min || 1;
      const values = xs;
      toX = (i) => (((readValue(values[i]) ?? nice.min) - nice.min) / xSpan) * SIZE;
      xTicks = nice;
    }

    svg.replaceChildren();
    drawYAxis(ticks, toY);
    if (isBar) drawBars(count, toY);
    else drawLines(count, toX, toY);
    drawXAxis(count, toX, xTicks);
    if (legend) {
      const parts: GraphPart[] = series.map((s) => ({ label: s.label, value: 0, color: s.color }));
      writeLegend(legend, parts, 0, () => '');
    }
    drawTable(count, ticks);
  };

  draw();

  return {
    cmp,
    setSeries: (next, axis) => {
      series = next;
      if (axis?.categories) categories = axis.categories;
      if (axis?.x && !isBar) xs = axis.x;
      draw();
    },
    setTableShown,
    isTableShown: () => tableShown,
  };
};
