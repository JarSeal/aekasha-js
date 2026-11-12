/**
 * p376 Phase 0 step 2 (`hlodSpike.ts --step frames`): what drawing proxies saves. largeWorld under
 * the day-night sky box paused at `--time` (10:00: its sun's shadow follows the camera), each group
 * given its proxy levels (`prepareLevelsAsync`, the chain options from the command line), then
 * from each view every group at full detail (`FULL`), at the level its `AUTO` LOD would pick
 * (`AUTO`, `--max-pixel-error`) and at its coarsest level (`COARSEST`), swapped by hand. Per case:
 * the groups per level, the groups' triangles in the main camera's frustum and the sun's shadow
 * frustum, the renderer's triangles and draws (every pass), the CPU frame and render submit, and
 * the stats panel's GPU figure. Each backend and run is a page of its own; the level order is
 * reversed on every second run, so a drift over the page's life doesn't favour one.
 *
 * Step 3 is the same with `--field <sites>` (largeWorld's `?hlodField`, the far field). On WebGPU
 * the frame figure sums overlapping passes (docs/issues/gpu-timer-webgpu-frame-sum.md), so the
 * passes that draw the scene are read one by one meanwhile (the probe's `gpuContextsAsync`: the
 * scene pass, the AO pre-pass and the sun's shadow, each its median), and their sum compared.
 */
import type { Browser, Page } from 'playwright-core';
import { out } from '../progressLog';
import { EVALUATE_MARGIN_MS, withTimeout } from '../verify/browser';
import {
  buildSceneUrl,
  fmt,
  int,
  med,
  openSceneAsync,
  printErrors,
  RED,
  RESET,
  VIEWPORT,
  type Backend,
} from './hlodSpikePage';

const GPU_SAMPLE_MS = 250;
const SCENE_ID = 'largeWorld';

/** A camera pose: where it is and the point it looks at */
type Pose = { position: [number, number, number]; target: [number, number, number] };

/** The views: the overview camera's own pose (`largeWorldOverview.camera.json`), the same line
 * pulled back 2.5 times (the whole terrain small in the frame), and 8 m up at the terrain's edge
 * looking out across the far field's ring (`ground`) */
export const FRAME_VIEWS: Record<string, Pose> = {
  start: { position: [0, 60, 120], target: [0, 0, 0] },
  far: { position: [0, 150, 300], target: [0, 0, 0] },
  ground: { position: [0, 8, 95], target: [0, 0, -1000] },
};

const MODES = ['FULL', 'AUTO', 'COARSEST'] as const;
type Mode = (typeof MODES)[number];

export type FramesArgs = {
  backends: Backend[];
  runs: number;
  warmup: number;
  frames: number;
  views: string[];
  timeOfDay: number;
  maxPixelError: number;
  /** The proxies' chain options (`prune` added by the probe) */
  chain: { permissive: boolean; maxError: number; ratios?: number[]; prune: boolean };
  /** The far field's sites (`?hlodField`), 0 for none */
  field: number;
};

/** `measure`'s figures */
type Measure = Record<'cpuMs' | 'renderMs' | 'drawCalls' | 'triangles' | 'seconds', number>;
type PassCount = { triangles: number; groups: number };
type Passes = { all: number; main: PassCount | null; shadows: PassCount[] };
/** A render context's GPU durations over a case (`gpuContextsAsync`) */
type GpuContext = { context: string; drew: string; samples: number; medianMs: number };
type CaseRun = {
  measure: Measure;
  gpuMs: number;
  /** WebGPU: the scene-drawing passes' medians summed (the scene pass, the pre-pass, the shadow) */
  scenePassesMs: number;
  contexts: GpuContext[];
  byLevel: number[];
  passes: Passes;
};
type FramesApi = {
  setupSkyAsync: (hours: number) => Promise<void>;
  prepareLevelsAsync: (
    options: object
  ) => Promise<{ groups: number; withLevels: number; ms: number }>;
  view: (pose: Pose) => void;
  setLevel: (mode: Mode, maxPixelError: number) => number[];
  passTriangles: () => Passes;
  measure: (frames: number) => Promise<Measure>;
  gpuContextsAsync: (ms: number) => Promise<GpuContext[]>;
  backend: () => string;
  restore: () => void;
};
type FramesWindow = Window & {
  __aekHlod?: FramesApi;
  __benchGpu?: { samples: number[]; timer: number };
};

/** Results by backend, view and mode: one entry per run */
export type FramesResults = Record<string, Record<string, Record<Mode, CaseRun[]>>>;

const measureAsync = (page: Page, frames: number) =>
  withTimeout(
    page.evaluate((n) => (window as FramesWindow).__aekHlod!.measure(n), frames),
    (frames / 20) * 1000 + EVALUATE_MARGIN_MS,
    `measure(${frames})`
  );

/** Whether a context draws the scene: a perspective camera's (the scene pass, the AO pre-pass) or
 * a shadow map's */
const isScenePass = (c: GpuContext) => /^PerspectiveCamera|ShadowMap/.test(c.drew);

/** The next `frames` frames' figures, with the stats panel's GPU figure sampled meanwhile (its
 * first second left out: the panel's average still holds the previous case) and, on WebGPU, each
 * render context's durations */
const measureWithGpuAsync = async (page: Page, frames: number, backend: Backend) => {
  await page.evaluate((everyMs) => {
    const gpu = { samples: [] as number[], timer: 0 };
    gpu.timer = window.setInterval(() => {
      const figure = document.querySelector('[data-panel="GPU"] .statsLive');
      gpu.samples.push(parseFloat(figure?.textContent ?? ''));
    }, everyMs);
    (window as FramesWindow).__benchGpu = gpu;
  }, GPU_SAMPLE_MS);
  // At 60 fps; the contexts' read starts with the measure and stops a little before it ends
  const contextsMs = Math.max(500, (frames / 60) * 1000 - 500);
  const [measure, contexts] = await Promise.all([
    measureAsync(page, frames),
    backend === 'webgpu'
      ? page.evaluate((ms) => (window as FramesWindow).__aekHlod!.gpuContextsAsync(ms), contextsMs)
      : Promise.resolve([] as GpuContext[]),
  ]);
  const samples = await page.evaluate(() => {
    const gpu = (window as FramesWindow).__benchGpu!;
    window.clearInterval(gpu.timer);
    return gpu.samples;
  });
  const usable = samples.slice(Math.ceil(1000 / GPU_SAMPLE_MS)).filter((s) => !Number.isNaN(s));
  const gpuMs = usable.length ? usable.reduce((a, b) => a + b, 0) / usable.length : NaN;
  const scene = contexts.filter(isScenePass);
  const scenePassesMs = scene.length
    ? scene.reduce((sum, c) => sum + Math.max(0, c.medianMs), 0)
    : NaN;
  return { measure, gpuMs, contexts, scenePassesMs };
};

/** One page: every view and mode, in `order` */
const runPageAsync = async (
  page: Page,
  args: FramesArgs,
  backend: Backend,
  order: readonly Mode[],
  results: Record<string, Record<Mode, CaseRun[]>>
) => {
  await page.evaluate(
    (hours) => (window as FramesWindow).__aekHlod!.setupSkyAsync(hours),
    args.timeOfDay
  );
  const prepared = await page.evaluate(
    (chain) => (window as FramesWindow).__aekHlod!.prepareLevelsAsync(chain),
    args.chain
  );
  const drawnOn = await page.evaluate(() => (window as FramesWindow).__aekHlod!.backend());
  if (!drawnOn.toLowerCase().startsWith(backend)) {
    out(`    ${RED}asked for ${backend}, drew on ${drawnOn}${RESET}`);
  }
  out(
    `    ${prepared.withLevels} of ${prepared.groups} groups with proxy levels (${fmt(prepared.ms, 0)} ms on the main thread), on ${drawnOn}`
  );
  for (const viewName of args.views) {
    await page.evaluate(
      (pose) => (window as FramesWindow).__aekHlod!.view(pose),
      FRAME_VIEWS[viewName]
    );
    await measureAsync(page, 30);
    for (const mode of order) {
      const byLevel = await page.evaluate(
        ({ m, mpe }) => (window as FramesWindow).__aekHlod!.setLevel(m, mpe),
        { m: mode, mpe: args.maxPixelError }
      );
      if (args.warmup > 0) await measureAsync(page, args.warmup);
      const { measure, gpuMs, contexts, scenePassesMs } = await measureWithGpuAsync(
        page,
        args.frames,
        backend
      );
      const passes = await page.evaluate(() => (window as FramesWindow).__aekHlod!.passTriangles());
      results[viewName][mode].push({ measure, gpuMs, scenePassesMs, contexts, byLevel, passes });
      out(
        `    ${viewName} ${mode}: levels [${byLevel.join(', ')}], CPU ${fmt(measure.cpuMs)} ms, GPU ${fmt(gpuMs)} ms${backend === 'webgpu' ? ` (scene passes ${fmt(scenePassesMs)} ms)` : ''}, ${int(measure.drawCalls)} draws, ${int(measure.triangles)} triangles`
      );
    }
  }
  await page.evaluate(() => (window as FramesWindow).__aekHlod!.restore());
};

/** Runs step 2 on every backend, `args.runs` pages each */
export const runFramesStepAsync = async (browser: Browser, baseUrl: string, args: FramesArgs) => {
  const results: FramesResults = {};
  for (const backend of args.backends) {
    const byView: Record<string, Record<Mode, CaseRun[]>> = {};
    for (const view of args.views) byView[view] = { FULL: [], AUTO: [], COARSEST: [] };
    results[backend] = byView;
    for (let run = 0; run < args.runs; run++) {
      const order = run % 2 === 0 ? MODES : [...MODES].reverse();
      out(`  ${backend} run ${run + 1}: ${order.join(', ')}`);
      const page = await browser.newPage({ viewport: VIEWPORT });
      const errors: string[] = [];
      try {
        const extra: Record<string, string> =
          args.field > 0 ? { hlodField: String(args.field) } : {};
        await openSceneAsync(page, buildSceneUrl(baseUrl, SCENE_ID, extra), backend, errors);
        await runPageAsync(page, args, backend, order, byView);
      } catch (err) {
        out(`${RED}✗ ${backend} run ${run + 1}: ${(err as Error).message}${RESET}`);
      } finally {
        printErrors(errors);
        await withTimeout(page.close(), 30_000, 'closing the page').catch(() => undefined);
      }
    }
  }
  return results;
};

const sumShadows = (passes: Passes) => passes.shadows.reduce((sum, s) => sum + s.triangles, 0);

/** Per backend: each view and mode's medians over the runs, then each mode against `FULL` */
export const formatFrames = (results: FramesResults, args: FramesArgs) => {
  const lines: string[] = [];
  for (const [backend, byView] of Object.entries(results)) {
    lines.push(
      `\n${backend}: medians of ${args.runs} run(s), ${args.frames} frames each, ${args.timeOfDay}:00, proxies ${JSON.stringify(args.chain)}, maxPixelError ${args.maxPixelError}`,
      "| View | Levels | Groups per level (0, 1, …) | Groups' triangles: all / in view (drawn twice: the scene pass and the AO pre-pass) / in the sun's shadow | Renderer triangles (every pass) | Draws | CPU frame (ms) | Render submit (ms) | GPU (ms) | GPU spread | Scene passes GPU (ms, WebGPU) |",
      '| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | ---: |'
    );
    for (const [view, byMode] of Object.entries(byView)) {
      for (const mode of MODES) {
        const runs = byMode[mode];
        if (!runs.length) {
          lines.push(`| ${view} | ${mode} | failed | | | | | | | | |`);
          continue;
        }
        const pick = (key: keyof Measure) => med(runs.map((r) => r.measure[key]));
        const gpus = runs.map((r) => r.gpuMs);
        const last = runs[runs.length - 1];
        lines.push(
          `| ${view} | ${mode} | ${last.byLevel.join(', ')} | ${int(last.passes.all)} / ${int(last.passes.main?.triangles ?? NaN)} / ${int(sumShadows(last.passes))}${last.passes.shadows.length !== 1 ? ` (${last.passes.shadows.length} shadow suns)` : ''} | ${int(pick('triangles'))} | ${fmt(pick('drawCalls'), 0)} | ${fmt(pick('cpuMs'))} | ${fmt(pick('renderMs'))} | ${fmt(med(gpus))} | ${fmt(Math.min(...gpus))}-${fmt(Math.max(...gpus))} | ${fmt(med(runs.map((r) => r.scenePassesMs)))} |`
        );
      }
    }
    lines.push(
      `\n${backend}: against FULL (the median of the runs' differences, each run against its own FULL)`,
      '| View | Levels | Renderer triangles saved | GPU (ms) saved | GPU spread | Scene passes GPU (ms) saved | its spread | CPU frame (ms) saved |',
      '| --- | --- | ---: | ---: | --- | ---: | --- | ---: |'
    );
    for (const [view, byMode] of Object.entries(byView)) {
      for (const mode of ['AUTO', 'COARSEST'] as const) {
        const pairs = byMode[mode]
          .map((r, i) => ({ r, full: byMode.FULL[i] }))
          .filter((p) => p.full);
        if (!pairs.length) continue;
        const gpu = pairs.map((p) => p.full.gpuMs - p.r.gpuMs);
        const scene = pairs.map((p) => p.full.scenePassesMs - p.r.scenePassesMs);
        lines.push(
          `| ${view} | ${mode} | ${int(med(pairs.map((p) => p.full.measure.triangles - p.r.measure.triangles)))} | ${fmt(med(gpu), 3)} | ${fmt(Math.min(...gpu), 3)} to ${fmt(Math.max(...gpu), 3)} | ${fmt(med(scene), 3)} | ${fmt(Math.min(...scene), 3)} to ${fmt(Math.max(...scene), 3)} | ${fmt(med(pairs.map((p) => p.full.measure.cpuMs - p.r.measure.cpuMs)), 3)} |`
        );
      }
    }
  }
  return lines;
};
