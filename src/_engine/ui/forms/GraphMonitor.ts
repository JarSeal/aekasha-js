// The monitor's graph view (p805 D9, p804 D1's move; Tweakpane's `view: 'graph'`): a number
// monitor with a time series of its reads under its text. Its own module, so a monitor or a
// property grid carries no time series: the grid's `view: 'graph'` item loads it with `import()`.
import type { BindingSource, ReadonlyBindingSource } from './binding/Binding';
import type { FieldOptions } from './Field';
import { buildGraphMonitor, type GraphMonitorBuild, type Monitor } from './Monitor';
import { createTimeSeries, type TimeSeriesThreshold } from '../data/graphs/TimeSeries';

/**
 * What {@link createGraphMonitor} makes a graph monitor from: a number's binding, the label, its
 * text and its graph's range.
 */
export type GraphMonitorProps = (BindingSource<number> | ReadonlyBindingSource<number>) &
  FieldOptions<number> & {
    /** The value's text, in place of its decimals. */
    format?: (value: number) => string;
    /** The decimals shown (default: the value's own, at least 2). */
    precision?: number;
    /** A unit shown after the value (`'ms'`). */
    unit?: string;
    /** The graph's bottom (default 0, or a nice floor under a negative value). */
    min?: number;
    /** The graph's top (default a nice ceiling over the values: it grows past one, and shrinks
     * after a whole buffer under a lower one). */
    max?: number;
    /** How many reads the graph holds (default 64, Tweakpane's `bufferSize`): at the default
     * `interval` of 200 ms, about 13 s. */
    capacity?: number;
    /** Lines across the graph at a value (a budget), in a status colour with their text. */
    thresholds?: readonly TimeSeriesThreshold[];
    /** The line's colour, any CSS colour (default the first chart series). */
    color?: string;
  };

const DEFAULT_CAPACITY = 64;

/**
 * Puts a graph monitor's time series into its field (`buildGraphMonitor`'s): what
 * `createGraphMonitor` does at once and the property grid's item after its `import()`.
 * @internal
 */
export const attachMonitorGraph = (build: GraphMonitorBuild, props: GraphMonitorProps) => {
  const series = createTimeSeries({
    series: [{ label: props.label, color: props.color }],
    capacity: props.capacity ?? DEFAULT_CAPACITY,
    min: props.min,
    max: props.max,
    thresholds: props.thresholds,
    ticks: false,
    summary: false,
  });
  build.attach({ cmp: series.cmp, push: series.push });
};

/**
 * Creates a graph monitor (p805 D9, Tweakpane's monitor with `view: 'graph'`): a number shown as
 * text, as `createMonitor`'s, with a time series of its reads under it, read on its scheduler's
 * tick every `interval` ms (default 200; 0 every frame) and on each `refresh()` (every read is a
 * sample, as Tweakpane's). A value that isn't a number is a gap.
 * - Range: from `min` to `max`, each a nice value over the reads and the `thresholds` when not
 *   given (the time series' auto range).
 * - Parts: the monitor's (`.aekField`, `data-kind="monitor"`, `.aekMonitor` with `data-graph`,
 *   `__value`, `__unit`) and `__graph`, the line holding the `.aekTimeSeries` (no ticks, no
 *   summary: the text is the value).
 * - Custom properties: the monitor's, `--aek-graph-monitor-height` (the graph's, default
 *   `--aek-space-7` × 2) and the time series'.
 * - ARIA: the monitor's (not a live region: the text is read after the label); the graph is
 *   hidden from assistive tech.
 * - Size: the time series comes with it (about 3 kB gzip). A property grid item with
 *   `view: 'graph'` loads it on first use, showing the text until then.
 * @example
 * ```ts
 * const frameTime = createGraphMonitor({
 *   label: 'Frame time',
 *   get: () => stats.frameMs,
 *   unit: 'ms',
 *   precision: 1,
 *   interval: 100,
 *   capacity: 100, // 10 s
 *   thresholds: [{ value: 16.7, label: '60 fps' }],
 * });
 * statsPanel.add(frameTime.cmp);
 * ```
 */
export const createGraphMonitor = (props: GraphMonitorProps): Monitor<number> => {
  const build = buildGraphMonitor(props);
  attachMonitorGraph(build, props);
  return build.field;
};
