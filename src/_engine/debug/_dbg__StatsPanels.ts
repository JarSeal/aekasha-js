/**
 * The on-screen stats panels (p807 D4): one debugger root in the bottom-left corner, a panel per
 * figure in PANEL_ORDER, each with its label, its figure (written at 4 Hz), the graph's lowest and
 * highest sample, and a time series of the figure (pushed at 30 Hz, each sample the worst frame
 * since the last, so a spike still shows). Debug only.
 *
 * - The figures share the profiler's definitions: FPS and CPU are the frame probe's summary (the
 *   Overview's FPS and CPU rows), GPU and CPT the GPU frame times' mean over 1 s (its GPU row),
 *   PHY the physics step stats' last step, TFPS 1000 over the main loop's mean CPU time of the
 *   last 60 frames (as stats-gl's TFPS panel was). Hz is the display's refresh rate read from the
 *   animation frames' intervals, shown in the FPS panel.
 * - The main loop calls _onStatsFrameStart at every frame's start and _onStatsFrameEnd at a
 *   rendered frame's end (after the render and the late loopers, in every view). Nothing
 *   allocates per frame: the frame step adds to numbers, the pushes write the time series' and
 *   the panels' rings, and only the 4 Hz text writes make strings.
 */
import { CMP } from '../ui/core/CMP';
import type { CMPHandle } from '../ui/core/CMPTypes';
import { KEEP_IN_VIEWS_CLASS } from '../ui/core/HUD';
import { createTimeSeries, type TimeSeries } from '../ui/data/graphs/TimeSeries';
import { getDebuggerRootProps } from '../ui/overlays/DebuggerRoot';
import { createTooltip, type Tooltip } from '../ui/overlays/Tooltip';
import {
  _acquireGpuFrameTimes,
  _onGpuFrameTime,
  _releaseGpuFrameTimes,
  type GpuFrameTime,
} from './_dbg__GPUFrameTimes';
import {
  _acquireFrameProbe,
  _getFrameProbeSummary,
  _releaseFrameProbe,
} from './profiler/_dbg__FrameProbe';
import { SampleWindow } from './profiler/_dbg__SampleWindow';
import styles from './Stats.module.scss';

/** A stats panel's figure. */
export type StatsPanelId = 'TFPS' | 'FPS' | 'CPU' | 'PHY' | 'GPU' | 'CPT';

/** Top to bottom (left to right when horizontal). */
export const STATS_PANEL_ORDER: readonly StatsPanelId[] = [
  'TFPS',
  'FPS',
  'CPU',
  'PHY',
  'GPU',
  'CPT',
];

/** What _createStatsPanels builds. */
export type StatsPanelsOptions = {
  /** The panels shown (GPU and CPT only where the renderer has timestamp queries). */
  panels: Readonly<Record<StatsPanelId, boolean>>;
  /** The refresh rate in the FPS panel (none without it). */
  showHz: boolean;
  /** A row in place of a column. */
  horizontal: boolean;
};

type PanelDef = {
  label: string;
  /** After the figure, muted */
  unit: string;
  /** The panel's tooltip: what the figure spans */
  description: string;
  format: (value: number) => string;
};

type Panel = {
  id: StatsPanelId;
  def: PanelDef;
  cmp: CMPHandle;
  series: TimeSeries;
  tooltip: Tooltip;
  value: Text;
  range: Text;
  hz: Text | null;
  /** The graph's samples (as the time series holds them), for the range text */
  ring: Float32Array;
  head: number;
};

/** The figures' text rate (stats-gl's) */
const TEXT_MS = 250;
/** The graphs' sample rate (stats-gl's 30 Hz) */
const GRAPH_MS = 1000 / 30;
/** Samples a graph holds: one per CSS px of its width at the default size (Stats.module.scss'
 * `.graph`, the compact density's `--aek-space-7` × 4), 3.2 s at 30 Hz */
const GRAPH_CAPACITY = 96;
/** The GPU figures' window (the profiler's) */
const GPU_WINDOW_MS = 1000;
/** TFPS: the frames its mean CPU time covers (stats-gl's TFPS panel's) */
const TFPS_SAMPLES = 60;
/** Hz: the animation frame intervals kept, and the share of the shortest one read */
const HZ_SAMPLES = 120;
const HZ_MIN_SAMPLES = 30;
const HZ_PERCENTILE = 0.25;
/** A longer interval (a paused loop, a hidden tab, a hitch) isn't a refresh */
const HZ_MAX_INTERVAL_MS = 1000 / 20;
/** The common refresh rates a measured one is matched to, within HZ_MATCH */
const COMMON_HZ = [24, 30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 170, 180, 200, 240, 360];
const HZ_MATCH = 0.03;
/** A longer gap between rendered frames isn't a frame (the frame probe's window) */
const MAX_FRAME_GAP_MS = 1000;
const NO_FIGURE = '–';

const formatCount = (value: number) => value.toFixed(0);
const formatMs = (value: number) => {
  const size = Math.abs(value);
  return value.toFixed(size >= 100 ? 0 : size >= 10 ? 1 : 2);
};

const PANEL_DEFS: Record<StatsPanelId, PanelDef> = {
  TFPS: {
    label: 'TFPS',
    unit: '',
    description:
      'Theoretical frames per second: 1000 / the main loop’s mean CPU time of the last 60 frames',
    format: formatCount,
  },
  FPS: {
    label: 'FPS',
    unit: '',
    description: 'Rendered frames per second, over the last second',
    format: formatCount,
  },
  CPU: {
    label: 'CPU',
    unit: 'ms',
    description: 'Main loop CPU per frame, the render’s submission included',
    format: formatMs,
  },
  PHY: {
    label: 'PHY',
    unit: 'ms',
    description: 'Physics step time of the last stepped frame, its sub-steps summed',
    format: formatMs,
  },
  GPU: {
    label: 'GPU',
    unit: 'ms',
    description: 'GPU time per frame, every render pass summed, over the last second',
    format: formatMs,
  },
  CPT: {
    label: 'CPT',
    unit: 'ms',
    description: 'GPU time per frame of the compute dispatches, over the last second',
    format: formatMs,
  },
};

let root: CMPHandle | null = null;
const panels: Partial<Record<StatsPanelId, Panel>> = {};
let isProbeHeld = false;
let isRenderHeld = false;
let isComputeHeld = false;
let removeGpuListener: (() => void) | null = null;

// --- Per-frame measures ---
let frameStart = 0;
let lastFrameEnd = 0;
let lastRafStart = -1;
let lastRenderedStart = -1;
let nextGraphAt = 0;
let nextTextAt = 0;
/** The worst values since the last graph push (NaN: none) */
let worstInterval = NaN;
let worstCpu = NaN;
let worstPhy = NaN;
let worstGpu = NaN;
let worstCpt = NaN;
let lastPhy = NaN;
let tfpsSum = 0;

const gpuWindow = new SampleWindow(1, 512);
const cptWindow = new SampleWindow(1, 512);

const tfpsSamples = new Float64Array(TFPS_SAMPLES);
let tfpsHead = 0;
let tfpsCount = 0;

const hzIntervals = new Float64Array(HZ_SAMPLES);
const hzSorted = new Float64Array(HZ_SAMPLES);
let hzHead = 0;
let hzCount = 0;

const resetMeasures = () => {
  lastRafStart = -1;
  lastRenderedStart = -1;
  nextGraphAt = 0;
  nextTextAt = 0;
  worstInterval = NaN;
  worstCpu = NaN;
  worstPhy = NaN;
  worstGpu = NaN;
  worstCpt = NaN;
  lastPhy = NaN;
  tfpsSum = 0;
  gpuWindow.reset();
  cptWindow.reset();
  tfpsHead = 0;
  tfpsCount = 0;
  hzHead = 0;
  hzCount = 0;
};

// --- The panels ---

const createPart = (tag: string, className: string, parent: Element) => {
  const part = document.createElement(tag);
  part.className = className;
  parent.append(part);
  return part;
};

const createTextPart = (className: string, parent: Element, initial = '') => {
  const text = document.createTextNode(initial);
  createPart('span', className, parent).append(text);
  return text;
};

const createPanel = (id: StatsPanelId, showHz: boolean): Panel => {
  const def = PANEL_DEFS[id];
  const cmp = CMP({ class: styles.panel, attr: { 'data-panel': id } });
  const elem = cmp.elem;
  const head = createPart('div', styles.head, elem);
  createPart('span', styles.label, head).textContent = def.label;
  const figure = createPart('span', styles.figure, head);
  const value = document.createTextNode(NO_FIGURE);
  figure.append(value);
  if (def.unit) createPart('span', styles.unit, figure).textContent = def.unit;
  const foot = createPart('div', styles.foot, elem);
  const rangeElem = createPart('span', styles.range, foot);
  // Read as "Range 0.81–1.20": the dash alone says little
  createPart('span', 'aekVisuallyHidden', rangeElem).textContent = 'Range ';
  const range = document.createTextNode('');
  rangeElem.append(range);
  const hz = showHz && id === 'FPS' ? createTextPart(styles.hz, foot) : null;
  const series = createTimeSeries({
    series: [{ label: def.label, color: 'var(--aek-text-muted)' }],
    capacity: GRAPH_CAPACITY,
    min: 0,
    ticks: false,
    summary: false,
    class: styles.graph,
  });
  cmp.add(series.cmp);
  const tooltip = createTooltip({ anchor: elem, text: def.description });
  return {
    id,
    def,
    cmp,
    series,
    tooltip,
    value,
    range,
    hz,
    ring: new Float32Array(GRAPH_CAPACITY).fill(NaN),
    head: 0,
  };
};

const removePanel = (panel: Panel) => {
  panel.tooltip.cmp.remove();
  panel.cmp.remove();
  delete panels[panel.id];
};

const pushSample = (panel: Panel | undefined, value: number) => {
  if (!panel) return;
  panel.series.push(value);
  panel.ring[panel.head] = value;
  panel.head = (panel.head + 1) % GRAPH_CAPACITY;
};

const writeText = (text: Text, data: string) => {
  if (text.data !== data) text.data = data;
};

const writeFigure = (panel: Panel | undefined, value: number, hasValue: boolean) => {
  if (!panel) return;
  writeText(panel.value, hasValue ? panel.def.format(value) : NO_FIGURE);
  let min = Infinity;
  let max = -Infinity;
  const ring = panel.ring;
  for (let i = 0; i < GRAPH_CAPACITY; i++) {
    const sample = ring[i];
    if (sample < min) min = sample;
    if (sample > max) max = sample;
  }
  writeText(panel.range, min <= max ? `${panel.def.format(min)}–${panel.def.format(max)}` : '');
};

// --- Hz ---

/** The display's refresh rate: the shortest steady animation frame interval (its lower
 * quartile), matched to a common rate within 3 %, else as measured. NaN while there are too
 * few intervals. */
const readRefreshRate = () => {
  if (hzCount < HZ_MIN_SAMPLES) return NaN;
  hzSorted.set(hzIntervals);
  // The unused tail sorts last (Infinity)
  for (let i = hzCount; i < HZ_SAMPLES; i++) hzSorted[i] = Infinity;
  hzSorted.sort();
  const interval = hzSorted[Math.floor(hzCount * HZ_PERCENTILE)];
  const measured = 1000 / interval;
  for (let i = 0; i < COMMON_HZ.length; i++) {
    const rate = COMMON_HZ[i];
    if (Math.abs(measured - rate) <= rate * HZ_MATCH) return rate;
  }
  return Math.round(measured);
};

// --- The frame step ---

const onGpuFrame = (time: Readonly<GpuFrameTime>) => {
  if (panels.GPU && time.renderMs !== null) {
    gpuWindow.push(lastFrameEnd, time.renderMs);
    if (!(worstGpu >= time.renderMs)) worstGpu = time.renderMs;
  }
  if (panels.CPT && time.computeMs !== null) {
    cptWindow.push(lastFrameEnd, time.computeMs);
    if (!(worstCpt >= time.computeMs)) worstCpt = time.computeMs;
  }
};

const readTfps = () => (tfpsCount && tfpsSum > 0 ? (1000 * tfpsCount) / tfpsSum : NaN);

const pushGraphs = () => {
  const tfps = readTfps();
  pushSample(panels.TFPS, tfps);
  pushSample(panels.FPS, worstInterval > 0 ? 1000 / worstInterval : NaN);
  pushSample(panels.CPU, worstCpu);
  pushSample(panels.PHY, worstPhy);
  pushSample(panels.GPU, worstGpu);
  pushSample(panels.CPT, worstCpt);
  worstInterval = NaN;
  worstCpu = NaN;
  worstPhy = NaN;
  worstGpu = NaN;
  worstCpt = NaN;
};

const writeFigures = (now: number) => {
  const tfps = readTfps();
  writeFigure(panels.TFPS, tfps, tfps === tfps);
  if (panels.FPS || panels.CPU) {
    const frames = _getFrameProbeSummary(now);
    writeFigure(panels.FPS, frames.fps, frames.frames > 0 && frames.fps > 0);
    writeFigure(panels.CPU, frames.cpuAvgMs, frames.frames > 0);
  }
  if (panels.FPS?.hz) {
    const hz = readRefreshRate();
    writeText(panels.FPS.hz, hz === hz ? `${hz} Hz` : '');
  }
  writeFigure(panels.PHY, lastPhy, lastPhy === lastPhy);
  if (panels.GPU) {
    const count = gpuWindow.summarize(GPU_WINDOW_MS, now);
    writeFigure(panels.GPU, gpuWindow.stats[0].avg, count > 0);
  }
  if (panels.CPT) {
    const count = cptWindow.summarize(GPU_WINDOW_MS, now);
    writeFigure(panels.CPT, cptWindow.stats[0].avg, count > 0);
  }
};

/**
 * A main loop frame's start (every animation frame, the limiter's skipped ones too): the CPU
 * span's start and the refresh rate's interval.
 * @param now the frame's start (default `performance.now()`)
 */
export const _onStatsFrameStart = (now?: number) => {
  if (!root) return;
  const time = now ?? performance.now();
  if (lastRafStart >= 0) {
    const interval = time - lastRafStart;
    if (interval > 0 && interval < HZ_MAX_INTERVAL_MS) {
      hzIntervals[hzHead] = interval;
      hzHead = (hzHead + 1) % HZ_SAMPLES;
      if (hzCount < HZ_SAMPLES) hzCount++;
    }
  }
  lastRafStart = time;
  frameStart = time;
};

/**
 * A rendered frame's end (after the render and the late loopers): the frame's figures added up,
 * the graphs pushed at 30 Hz and the figures written at 4 Hz.
 * @param now the frame's end (default `performance.now()`)
 */
export const _onStatsFrameEnd = (now?: number) => {
  if (!root) return;
  const time = now ?? performance.now();
  const cpu = time - frameStart;
  lastFrameEnd = time;
  if (panels.TFPS) {
    if (tfpsCount === TFPS_SAMPLES) tfpsSum -= tfpsSamples[tfpsHead];
    else tfpsCount++;
    tfpsSamples[tfpsHead] = cpu;
    tfpsSum += cpu;
    tfpsHead = (tfpsHead + 1) % TFPS_SAMPLES;
  }
  if (lastRenderedStart >= 0) {
    const interval = frameStart - lastRenderedStart;
    if (interval <= MAX_FRAME_GAP_MS && !(worstInterval >= interval)) {
      worstInterval = interval;
    }
  }
  lastRenderedStart = frameStart;
  if (!(worstCpu >= cpu)) worstCpu = cpu;

  // Each on its grid, unless a pause put it behind
  if (time >= nextGraphAt) {
    pushGraphs();
    nextGraphAt = nextGraphAt + GRAPH_MS > time ? nextGraphAt + GRAPH_MS : time + GRAPH_MS;
  }
  if (time >= nextTextAt) {
    writeFigures(time);
    nextTextAt = nextTextAt + TEXT_MS > time ? nextTextAt + TEXT_MS : time + TEXT_MS;
  }
};

/** A measured physics step (the physics step stats'): the PHY panel's figure. */
export const _recordPhysicsStep = (stepMs: number) => {
  if (!panels.PHY) return;
  lastPhy = stepMs;
  if (!(worstPhy >= stepMs)) worstPhy = stepMs;
};

// --- Build and removal ---

const holdSources = (options: StatsPanelsOptions) => {
  const { panels: shown } = options;
  if (shown.FPS || shown.CPU) {
    _acquireFrameProbe();
    isProbeHeld = true;
  }
  // GPU and CPT need timestamp queries: no panel without them (or without a renderer)
  const gpu = shown.GPU && _acquireGpuFrameTimes('RENDER') === true;
  const cpt = shown.CPT && _acquireGpuFrameTimes('COMPUTE') === true;
  isRenderHeld = gpu;
  isComputeHeld = cpt;
  if (gpu || cpt) removeGpuListener = _onGpuFrameTime(onGpuFrame);
  return { gpu, cpt };
};

const releaseSources = () => {
  removeGpuListener?.();
  removeGpuListener = null;
  if (isRenderHeld) _releaseGpuFrameTimes('RENDER');
  if (isComputeHeld) _releaseGpuFrameTimes('COMPUTE');
  isRenderHeld = false;
  isComputeHeld = false;
  if (isProbeHeld) _releaseFrameProbe();
  isProbeHeld = false;
};

/**
 * Builds the stats panels' root (replacing the one there was), its panels in STATS_PANEL_ORDER,
 * and holds what they read (the frame probe, the GPU frame times). The caller adds the root to
 * the HUD root.
 * @returns the root (`.statsContainer`, a debugger root)
 */
export const _createStatsPanels = (options: StatsPanelsOptions) => {
  _removeStatsPanels();
  const rootProps = getDebuggerRootProps();
  root = CMP({
    id: '_statsContainer',
    // The global class: the on-screen tools' click-through rule (OnScreenTools.module.scss)
    class: ['statsContainer', styles.stats, KEEP_IN_VIEWS_CLASS],
    ...rootProps,
    attr: {
      ...rootProps.attr,
      role: 'group',
      'aria-label': 'Frame statistics',
      'data-orientation': options.horizontal ? 'horizontal' : 'vertical',
    },
  });
  resetMeasures();
  const held = holdSources(options);
  for (const id of STATS_PANEL_ORDER) {
    if (!options.panels[id]) continue;
    if ((id === 'GPU' && !held.gpu) || (id === 'CPT' && !held.cpt)) continue;
    const panel = createPanel(id, options.showHz);
    panels[id] = panel;
    root.add(panel.cmp);
  }
  return root;
};

/** Removes the stats panels' root and releases what they read. */
export const _removeStatsPanels = () => {
  for (const id of STATS_PANEL_ORDER) {
    const panel = panels[id];
    if (panel) removePanel(panel);
  }
  releaseSources();
  root?.remove();
  root = null;
};

/** The stats panels' root, null without one. */
export const _getStatsPanelsRoot = () => root;
