import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CMP } from '../ui/core/CMP';
import type { CMPHandle } from '../ui/core/CMPTypes';
import {
  countListeners,
  stubCanvas2d,
  stubIntersectionObserver,
  stubKitDomAsync,
  stubMatchMedia,
  stubResizeObserver,
} from '../ui/testing/KitDom';

// What the panels read: the frame probe and the GPU frame times, set by each test
const sources = vi.hoisted(() => ({
  summary: { frames: 0, fps: 0, frameTimeAvgMs: 0, frameTimeMaxMs: 0, cpuAvgMs: 0, cpuMaxMs: 0 },
  probeHolds: 0,
  gpu: { RENDER: true as boolean | null, COMPUTE: true as boolean | null },
  gpuHolds: { RENDER: 0, COMPUTE: 0 },
  gpuListener: null as
    | null
    | ((time: { renderMs: number | null; computeMs: number | null }) => void),
  /** Each panel's graph samples, by its label */
  pushes: {} as Record<string, number[]>,
}));
vi.mock('./profiler/_dbg__FrameProbe', () => ({
  _acquireFrameProbe: () => sources.probeHolds++,
  _releaseFrameProbe: () => sources.probeHolds--,
  _getFrameProbeSummary: () => sources.summary,
}));
vi.mock('./_dbg__GPUFrameTimes', () => ({
  _acquireGpuFrameTimes: (side: 'RENDER' | 'COMPUTE') => {
    const held = sources.gpu[side];
    if (held) sources.gpuHolds[side]++;
    return held;
  },
  _releaseGpuFrameTimes: (side: 'RENDER' | 'COMPUTE') => sources.gpuHolds[side]--,
  _onGpuFrameTime: (listener: typeof sources.gpuListener) => {
    sources.gpuListener = listener;
    return () => {
      sources.gpuListener = null;
    };
  },
}));
// The root goes in the HUD root: this test's
const hud = vi.hoisted(() => ({ root: null as CMPHandle | null }));
vi.mock(import('../ui/core/HUD'), async (importOriginal) => ({
  ...(await importOriginal()),
  getHUDRootCMP: () => hud.root as CMPHandle,
}));
vi.mock(import('../ui/data/graphs/TimeSeries'), async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    createTimeSeries: (props) => {
      const series = original.createTimeSeries(props);
      const samples: number[] = [];
      sources.pushes[props.series[0].label] = samples;
      const push = series.push;
      series.push = (value) => {
        samples.push(value);
        push(value);
      };
      return series;
    },
  };
});

import {
  _onStatsFrameEnd,
  _onStatsFrameStart,
  _recordPhysicsStep,
  _removeStatsPanels,
  _setStatsPanels,
  type StatsPanelId,
  type StatsPanelsOptions,
} from './_dbg__StatsPanels';

let restores: (() => void)[] = [];
let resizer: ReturnType<typeof stubResizeObserver>;

beforeAll(async () => {
  await stubKitDomAsync();
  resizer = stubResizeObserver();
  restores = [
    resizer.restore,
    stubIntersectionObserver().restore,
    stubCanvas2d().restore,
    stubMatchMedia().restore,
  ];
});

afterAll(() => {
  for (const restore of restores) restore();
});

beforeEach(() => {
  sources.summary.frames = 0;
  sources.gpu.RENDER = true;
  sources.gpu.COMPUTE = true;
  sources.pushes = {};
  hud.root = CMP({});
  document.body.append(hud.root.elem);
});

afterEach(() => {
  _removeStatsPanels();
  hud.root?.remove();
  document.body.replaceChildren();
});

const NONE: Record<StatsPanelId, boolean> = {
  TFPS: false,
  FPS: false,
  CPU: false,
  PHY: false,
  GPU: false,
  CPT: false,
};

const build = (
  panels: Partial<Record<StatsPanelId, boolean>>,
  opts: Partial<StatsPanelsOptions> = {}
) => {
  _setStatsPanels({
    panels: { ...NONE, ...panels },
    showHz: false,
    horizontal: false,
    activate: null,
    ...opts,
  });
  return { elem: document.querySelector('.statsContainer') as HTMLElement };
};

const panelIds = (root: { elem: HTMLElement }) =>
  [...root.elem.querySelectorAll('[data-panel]')].map((panel) => panel.getAttribute('data-panel'));
const panelElem = (id: StatsPanelId) =>
  document.querySelector(`[data-panel="${id}"]`) as HTMLElement;
/** A panel's figure: its head's second span (the figure's text node and its unit) */
const figureOf = (id: StatsPanelId) =>
  panelElem(id).firstElementChild?.children[1]?.firstChild?.nodeValue ?? null;
/** A panel's range: the foot's first span, its hidden "Range " left out */
const rangeOf = (id: StatsPanelId) => {
  const range = panelElem(id).children[1]?.firstElementChild;
  return range?.lastChild?.nodeValue ?? null;
};
const hzOf = () => panelElem('FPS').children[1]?.children[1]?.textContent ?? null;

/** Runs frames from `start`, each `interval` ms apart taking `cpu` ms; returns the next start */
const runFrames = (start: number, count: number, interval: number, cpu: number | number[]) => {
  let t = start;
  for (let i = 0; i < count; i++) {
    const cpuMs = Array.isArray(cpu) ? cpu[i % cpu.length] : cpu;
    _onStatsFrameStart(t);
    _onStatsFrameEnd(t + cpuMs);
    t += interval;
  }
  return t;
};

describe('the stats panels (p807 D4)', () => {
  it('builds the panels shown in their order, a named group, vertical or a row', () => {
    const root = build({ CPT: true, FPS: true, TFPS: true, CPU: true, GPU: true, PHY: true });
    expect(panelIds(root)).toEqual(['TFPS', 'FPS', 'CPU', 'PHY', 'GPU', 'CPT']);
    expect(root.elem.getAttribute('role')).toBe('group');
    expect(root.elem.getAttribute('aria-label')).toBe('Frame statistics');
    expect(root.elem.getAttribute('data-orientation')).toBe('vertical');
    expect(root.elem.hasAttribute('data-aek-debugger')).toBe(true);
    expect(root.elem.getAttribute('data-aek-density')).toBe('compact');
    expect(root.elem.classList.contains('statsContainer')).toBe(true);
    // The graphs say nothing to assistive tech: the figures are the text
    expect(root.elem.querySelector('.aekTimeSeries__plot')?.getAttribute('aria-hidden')).toBe(
      'true'
    );

    const row = build({ FPS: true, CPU: true }, { horizontal: true });
    expect(panelIds(row)).toEqual(['FPS', 'CPU']);
    expect(row.elem.getAttribute('data-orientation')).toBe('horizontal');
  });

  it('holds the frame probe for FPS or CPU and the GPU sides for GPU and CPT, and releases them', () => {
    build({ FPS: true, CPU: true, GPU: true, CPT: true });
    expect(sources.probeHolds).toBe(1);
    expect(sources.gpuHolds).toEqual({ RENDER: 1, COMPUTE: 1 });
    expect(sources.gpuListener).not.toBeNull();
    // One side gone: the listener stays for the other
    build({ FPS: true, CPU: true, CPT: true });
    expect(sources.gpuHolds).toEqual({ RENDER: 0, COMPUTE: 1 });
    expect(sources.gpuListener).not.toBeNull();
    // CPU alone keeps the probe; nothing reads the GPU
    build({ CPU: true });
    expect(sources.probeHolds).toBe(1);
    expect(sources.gpuListener).toBeNull();
    build({ TFPS: true });
    expect(sources.probeHolds).toBe(0);
    expect(sources.gpuHolds).toEqual({ RENDER: 0, COMPUTE: 0 });
    expect(sources.gpuListener).toBeNull();
    _removeStatsPanels();
    expect(document.querySelector('[data-panel]')).toBeNull();
  });

  it('leaves GPU and CPT out without timestamp queries or a renderer', () => {
    sources.gpu.RENDER = false;
    sources.gpu.COMPUTE = null;
    const root = build({ FPS: true, GPU: true, CPT: true });
    expect(panelIds(root)).toEqual(['FPS']);
    expect(sources.gpuListener).toBeNull();
  });

  it('writes the figures at 4 Hz from the frame probe, not every frame', () => {
    build({ FPS: true, CPU: true });
    sources.summary.frames = 132;
    sources.summary.fps = 132.4;
    sources.summary.cpuAvgMs = 0.94;
    // The first frame writes
    let t = runFrames(1000, 1, 7.5, 1);
    expect(figureOf('FPS')).toBe('132');
    expect(figureOf('CPU')).toBe('0.94');
    const node = panelElem('CPU').firstElementChild?.children[1]?.firstChild;
    sources.summary.cpuAvgMs = 2.5;
    // 240 ms later: not yet
    t = runFrames(t, 32, 7.5, 1);
    expect(figureOf('CPU')).toBe('0.94');
    t = runFrames(t, 2, 7.5, 1);
    expect(figureOf('CPU')).toBe('2.50');
    // The same text node, written in place
    expect(panelElem('CPU').firstElementChild?.children[1]?.firstChild).toBe(node);
    // No frames in the probe's window: a dash
    sources.summary.frames = 0;
    runFrames(t + 250, 1, 7.5, 1);
    expect(figureOf('FPS')).toBe('–');
    expect(figureOf('CPU')).toBe('–');
  });

  it('pushes the graphs at 30 Hz, each sample the worst frame since the last', () => {
    build({ FPS: true, CPU: true });
    // 1 s at 7.5 ms a frame, every eighth frame a 4 ms CPU spike and a 15 ms interval
    let t = 0;
    for (let i = 0; i < 133; i++) {
      const isSpike = i % 8 === 7;
      _onStatsFrameStart(t);
      _onStatsFrameEnd(t + (isSpike ? 4 : 1));
      t += isSpike ? 15 : 7.5;
    }
    const cpu = sources.pushes.CPU;
    // About 30 a second (the first at the first frame), whatever the frame rate
    expect(cpu.length).toBeGreaterThanOrEqual(34);
    expect(cpu.length).toBeLessThanOrEqual(38);
    // A sample is the worst of its frames: the spikes show, never averaged away
    expect(Math.max(...cpu)).toBe(4);
    expect(cpu.filter((ms) => ms === 4).length).toBeGreaterThan(10);
    const fps = sources.pushes.FPS.filter((value) => !Number.isNaN(value));
    expect(Math.min(...fps)).toBeCloseTo(1000 / 15);
    // The range is the graph's lowest and highest sample (at the next text write)
    t = runFrames(t, 34, 7.5, 1);
    expect(rangeOf('CPU')).toBe('1.00–4.00');
    expect(rangeOf('FPS')).toBe('67–133');
    // Kept as samples come; once the spikes scroll out (96 samples, 3.2 s), they leave the range
    t = runFrames(t, 500, 7.5, 2);
    expect(rangeOf('CPU')).toBe('2.00–2.00');
    // A new high and low come in without a scan (each past a text write)
    t = runFrames(t, 40, 7.5, 3);
    expect(rangeOf('CPU')).toBe('2.00–3.00');
    runFrames(t, 40, 7.5, 0.5);
    expect(rangeOf('CPU')).toBe('0.50–3.00');
  });

  it('keeps TFPS as 1000 over the mean CPU time of the last 60 frames', () => {
    build({ TFPS: true });
    const t = runFrames(0, 60, 7.5, 2);
    runFrames(t + 250, 1, 7.5, 2);
    expect(figureOf('TFPS')).toBe('500');
    // 60 frames at 4 ms push the 2 ms ones out
    const next = runFrames(t + 500, 60, 7.5, 4);
    runFrames(next + 250, 1, 7.5, 4);
    expect(figureOf('TFPS')).toBe('250');
  });

  it('shows the GPU and compute times over the last second', () => {
    build({ GPU: true, CPT: true });
    let t = runFrames(0, 1, 7.5, 1);
    for (let i = 0; i < 10; i++) {
      t = runFrames(t, 1, 7.5, 1);
      sources.gpuListener?.({ renderMs: i % 2 ? 1 : 2, computeMs: 0.33 });
    }
    runFrames(t + 250, 1, 7.5, 1);
    expect(figureOf('GPU')).toBe('1.50');
    expect(figureOf('CPT')).toBe('0.33');
    // The graph took the worst frame of its period
    expect(Math.max(...sources.pushes.GPU.filter((ms) => !Number.isNaN(ms)))).toBe(2);
    // A side nobody holds comes as null: nothing recorded
    sources.gpuListener?.({ renderMs: null, computeMs: null });
  });

  it('shows the last physics step, and a gap in the graph while none comes', () => {
    build({ PHY: true });
    _recordPhysicsStep(0.4);
    _recordPhysicsStep(1.2);
    const t = runFrames(0, 1, 7.5, 1);
    expect(figureOf('PHY')).toBe('1.20');
    expect(sources.pushes.PHY).toEqual([1.2]);
    runFrames(t + 40, 1, 7.5, 1);
    expect(sources.pushes.PHY[1]).toBeNaN();
  });

  it('reads the refresh rate from the animation frames, matched to a common rate', () => {
    build({ FPS: true }, { showHz: true });
    sources.summary.frames = 100;
    sources.summary.fps = 143;
    // 143.4 Hz (a variable rate display's) is 144; a skipped frame's double interval is ignored
    let t = runFrames(0, 60, 6.97, 0.5);
    t = runFrames(t, 4, 13.94, 0.5);
    runFrames(t + 250, 1, 6.97, 0.5);
    expect(hzOf()).toBe('144 Hz');
    _removeStatsPanels();

    // 132 Hz is no common rate: as measured
    build({ FPS: true }, { showHz: true });
    t = runFrames(0, 60, 1000 / 132, 0.5);
    runFrames(t + 250, 1, 1000 / 132, 0.5);
    expect(hzOf()).toBe('132 Hz');
  });

  it('applies a change live: a panel added in its place or removed, the rest kept', () => {
    const root = build({ TFPS: true, CPU: true });
    const cpuElem = panelElem('CPU');
    sources.summary.frames = 100;
    sources.summary.cpuAvgMs = 1.5;
    const t = runFrames(0, 1, 7.5, 1);
    expect(figureOf('CPU')).toBe('1.50');
    build({ TFPS: true, FPS: true, CPU: true, GPU: true });
    expect(panelIds(root)).toEqual(['TFPS', 'FPS', 'CPU', 'GPU']);
    // The same root and the CPU panel with its figure; the new ones written on the next frame
    expect(document.querySelector('.statsContainer')).toBe(root.elem);
    expect(panelElem('CPU')).toBe(cpuElem);
    expect(figureOf('FPS')).toBe('–');
    runFrames(t, 1, 7.5, 1);
    expect(figureOf('FPS')).not.toBe('–');
    build({ FPS: true, GPU: true }, { horizontal: true });
    expect(panelIds(root)).toEqual(['FPS', 'GPU']);
    expect(root.elem.getAttribute('data-orientation')).toBe('horizontal');
    expect(document.querySelectorAll('.statsContainer').length).toBe(1);
  });

  it('shows and hides the refresh rate line live', () => {
    build({ FPS: true }, { showHz: true });
    sources.summary.frames = 100;
    sources.summary.fps = 60;
    let t = runFrames(0, 40, 1000 / 60, 0.5);
    t = runFrames(t + 250, 1, 1000 / 60, 0.5);
    expect(hzOf()).toBe('60 Hz');
    build({ FPS: true }, { showHz: false });
    expect(hzOf()).toBe('');
    runFrames(t + 250, 1, 1000 / 60, 0.5);
    expect(hzOf()).toBe('');
  });

  it("is the profiler's button with `activate`, its press keeping the focus", () => {
    const onActivate = vi.fn();
    const activate = { label: 'Open the profiler', tooltip: 'Open the profiler (F8)', onActivate };
    build({ FPS: true, CPU: true }, { activate });
    const button = document.querySelector('.statsContainer') as HTMLElement;
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('type')).toBe('button');
    // Named by its content: its purpose (hidden) and then the figures it shows
    expect(button.hasAttribute('aria-label')).toBe(false);
    expect(button.firstElementChild?.textContent).toBe('Open the profiler:');
    expect(button.firstElementChild?.className).toBe('aekVisuallyHidden');
    expect(button.hasAttribute('role')).toBe(false);
    // The tooltip with the key describes it (its text isn't the name)
    expect(button.getAttribute('aria-describedby')).toBeTruthy();
    expect(panelIds({ elem: button })).toEqual(['FPS', 'CPU']);
    button.dispatchEvent(new CustomEvent('click', { bubbles: true }));
    expect(onActivate).toHaveBeenCalledTimes(1);
    const press = Object.assign(new CustomEvent('mousedown', { bubbles: true, cancelable: true }), {
      button: 0,
    });
    button.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);

    // Off: a group again, built anew
    build({ FPS: true, CPU: true });
    const group = document.querySelector('.statsContainer') as HTMLElement;
    expect(group).not.toBe(button);
    expect(group.tagName).toBe('DIV');
    expect(group.getAttribute('role')).toBe('group');
    expect(panelIds({ elem: group })).toEqual(['FPS', 'CPU']);
    expect(document.querySelectorAll('.statsContainer').length).toBe(1);
    expect(countListeners(button)).toBe(0);
    expect(sources.probeHolds).toBe(1);
  });

  it('writes its height on <body> for the debug toaster, and removes it', () => {
    const root = build({ FPS: true });
    expect(resizer.observerCount()).toBeGreaterThan(0);
    resizer.resize(root.elem, { height: 120 });
    expect(document.body.style.getPropertyValue('--aek-debug-stats-height')).toMatch(/px$/);
    _removeStatsPanels();
    expect(document.body.style.getPropertyValue('--aek-debug-stats-height')).toBe('');
    expect(document.querySelector('.statsContainer')).toBeNull();
  });

  it('measures nothing without panels', () => {
    _onStatsFrameStart(0);
    _onStatsFrameEnd(1);
    _recordPhysicsStep(1);
    expect(sources.pushes).toEqual({});
  });
});
