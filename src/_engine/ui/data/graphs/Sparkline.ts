import type { CMPAttr, CMPHandle } from '../../core/CMPTypes';
import { CMP, classes } from '../../core/CMP';
import './Sparkline.scss';
import '../../styles/kit.scss';

/** What {@link createSparkline} draws. */
export type SparklineProps = {
  /** The values at the start, oldest first (`NaN` a gap). */
  values?: readonly number[];
  /** How many values it holds and spreads across its width (default `values`' length, else 60):
   * `push` past it drops the oldest. Fewer values sit at the right, the newest at the edge. */
  capacity?: number;
  /** The value at the bottom (default the smallest shown): 0 for a count. */
  min?: number;
  /** The value at the top (default the largest shown). */
  max?: number;
  /** Its accessible name, which makes it a `role="img"` ('Draw calls over the last 15 s, 120 to
   * 340'). Without it it's hidden from assistive tech: a figure beside it says what it shows. */
  label?: string;
  /** Fills the area under the line, faintly. Default false. */
  area?: boolean;
  /** Its line's colour, any CSS colour (default `--aek-sparkline-color`, else the text colour): a
   * chart series (`var(--aek-chart-2)`), or a status role for a status. */
  color?: string;
  /** Extra classes for its element. */
  class?: string | string[];
  /** Extra attributes for its element. */
  attr?: CMPAttr;
  /** Its element id (default: a generated one, not written to the element). */
  id?: string;
};

/** A sparkline {@link createSparkline} made: its CMP and its setters. */
export type Sparkline = {
  /** Its element (`.aekSparkline`): add it where it goes. */
  cmp: CMPHandle;
  /** Adds a value at the right (`NaN` a gap), the oldest dropped past `capacity`, and draws it.
   * Builds the line's points as a string: push at a panel's rate (a scheduler's tick, 4 Hz), not
   * every frame (`createTimeSeries` is for that). */
  push: (value: number) => void;
  /** Replaces the values (oldest first; past `capacity` only the newest kept) and draws them. */
  setValues: (values: readonly number[]) => void;
  /** Removes every value. */
  clear: () => void;
};

const SVG_NS = 'http://www.w3.org/2000/svg';
/** The drawing's box: 100 by 100, stretched to the element's (the stroke keeps its width) */
const SIZE = 100;
const DEFAULT_CAPACITY = 60;

const createSvgPart = (tag: string, className: string) => {
  const part = document.createElementNS(SVG_NS, tag);
  part.setAttribute('class', className);
  return part;
};

/** A coordinate to a hundredth: the points' string stays short */
const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Creates a sparkline (p805 D9): a small line of recent values beside a figure, an "over time"
 * at a glance. SVG, so its stroke follows the theme in CSS and stays sharp at any pixel ratio.
 * - Parts: `.aekSparkline` (`data-area` with `area`) holding `svg.aekSparkline__svg`, with
 *   `__area` (the fill under the line), `__line` (a path, broken at each `NaN`) and `__dot` (the
 *   last value, hidden when it's a gap).
 * - Custom properties (read on any ancestor): `--aek-sparkline-color` (default the text colour),
 *   `--aek-sparkline-width` (default `--aek-space-7` × 2), `--aek-sparkline-height` (default
 *   `--aek-space-5`), `--aek-sparkline-stroke` (the line's width, default 1.5 px),
 *   `--aek-sparkline-area-opacity` (default 0.16).
 * - Scale: from `min` to `max`, each the shown values' smallest or largest when not given; one
 *   value repeated is a line across the middle.
 * - ARIA: with `label` a `role="img"` named by it; without, `aria-hidden` (a figure beside it says
 *   what it shows: p800 D8's written deviation).
 * @example
 * ```ts
 * const drawCalls = createSparkline({ capacity: 60, min: 0, area: true });
 * const figure = CMP({ tag: 'span', text: '0' });
 * row.add(figure);
 * row.add(drawCalls.cmp);
 * setInterval(() => {
 *   const calls = getDrawCallCount();
 *   drawCalls.push(calls);
 *   figure.updateText(String(calls));
 * }, 250);
 * ```
 */
export const createSparkline = (props: SparklineProps = {}): Sparkline => {
  const capacity = Math.max(
    1,
    Math.floor(props.capacity ?? (props.values?.length || DEFAULT_CAPACITY))
  );
  const ring = new Float64Array(capacity);
  /** The ring's next write, and how many values it holds */
  let head = 0;
  let count = 0;

  const cmp = CMP({
    id: props.id,
    idAttr: props.id !== undefined,
    tag: 'span',
    class: classes('aekSparkline', props.class),
    attr: {
      ...props.attr,
      ...(props.label ? { role: 'img', 'aria-label': props.label } : { 'aria-hidden': 'true' }),
      ...(props.area ? { 'data-area': '' } : {}),
    },
  });
  const elem = cmp.elem;
  if (props.color) elem.style.setProperty('--aek-sparkline-color', props.color);

  const svg = createSvgPart('svg', 'aekSparkline__svg');
  svg.setAttribute('viewBox', `0 0 ${SIZE} ${SIZE}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('focusable', 'false');
  const area = props.area ? createSvgPart('path', 'aekSparkline__area') : null;
  const line = createSvgPart('path', 'aekSparkline__line');
  // A line of no length: its round cap is the dot, a circle at any stretch
  const dot = createSvgPart('line', 'aekSparkline__dot');
  if (area) svg.append(area);
  svg.append(line, dot);
  elem.append(svg);

  /** The i-th value held, oldest first */
  const valueAt = (i: number) => ring[(head - count + i + capacity) % capacity];

  const draw = () => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < count; i++) {
      const value = valueAt(i);
      if (!Number.isFinite(value)) continue;
      if (value < lo) lo = value;
      if (value > hi) hi = value;
    }
    if (props.min !== undefined) lo = props.min;
    if (props.max !== undefined) hi = props.max;
    const span = hi - lo;
    const toY = (value: number) =>
      span > 0 ? round(SIZE - Math.min(1, Math.max(0, (value - lo) / span)) * SIZE) : SIZE / 2;
    const toX = (i: number) =>
      capacity > 1 ? round(((capacity - count + i) / (capacity - 1)) * SIZE) : SIZE;

    let lineD = '';
    let areaD = '';
    let runStart = -1;
    for (let i = 0; i <= count; i++) {
      const value = i < count ? valueAt(i) : NaN;
      if (Number.isFinite(value)) {
        const point = `${toX(i)} ${toY(value)}`;
        lineD += runStart < 0 ? `M${point}` : `L${point}`;
        if (area) areaD += runStart < 0 ? `M${toX(i)} ${SIZE}L${point}` : `L${point}`;
        if (runStart < 0) runStart = i;
        continue;
      }
      if (runStart < 0) continue;
      // A run of one point: a segment of no length, which the round cap draws as a dot
      if (runStart === i - 1) lineD += `L${toX(runStart)} ${toY(valueAt(runStart))}`;
      if (area) areaD += `L${toX(i - 1)} ${SIZE}Z`;
      runStart = -1;
    }
    line.setAttribute('d', lineD);
    if (area) area.setAttribute('d', areaD);

    const last = count ? valueAt(count - 1) : NaN;
    if (Number.isFinite(last)) {
      const x = String(toX(count - 1));
      const y = String(toY(last));
      dot.setAttribute('x1', x);
      dot.setAttribute('x2', x);
      dot.setAttribute('y1', y);
      dot.setAttribute('y2', y);
      dot.removeAttribute('display');
    } else {
      dot.setAttribute('display', 'none');
    }
  };

  const setValues = (values: readonly number[]) => {
    const from = Math.max(0, values.length - capacity);
    count = values.length - from;
    for (let i = 0; i < count; i++) ring[i] = values[from + i];
    head = count % capacity;
    draw();
  };

  setValues(props.values ?? []);

  return {
    cmp,
    push: (value) => {
      ring[head] = value;
      head = (head + 1) % capacity;
      if (count < capacity) count++;
      draw();
    },
    setValues,
    clear: () => setValues([]),
  };
};
