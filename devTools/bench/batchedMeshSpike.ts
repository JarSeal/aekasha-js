/**
 * p375 Phase 0's spike bench (docs/plans/p375_batched-mesh-batches.md §2): the `batchedMeshSpike`
 * scene's ways (separate meshes, a baked merge group, a hand-built `BatchedMesh`, and Phase 1's
 * engine batched merge group: the `engine` and `kinematic` cases, its exit) in each case below, on
 * WebGPU and on WebGL2, both on the machine's GPU (WebGL2 through the renderer tab's persisted
 * "Force WebGL", so the debug env), printing a table per backend.
 *
 *   npx tsx devTools/bench/batchedMeshSpike.ts [--backends webgpu,webgl] [--only <case>[,…]]
 *     [--runs 3] [--warmup 120] [--frames 300] [--url <server>] [--headed] [--json <file>]
 *     [--long-seconds 600] [--sample-seconds 10]
 *
 * Each case is a page of its own (its own dev server, the scene runner's, unless `--url`), run
 * `--runs` times; the table gives the median of the runs' medians, and the runs' spread. The CPU
 * frame is the first MAIN system to the first LATE_MAIN one (`_dbg__batchedMeshSpike.ts`), GPU
 * the stats panel's figure. The `check:` cases screenshot to `.cache/bench/batchedMeshSpike/`;
 * the `churn:` cases run the scene's churn calls before measuring. Output:
 * `.cache/bench/progress.log` too.
 *
 * p375 Phase 2's exit (S6): the `lod` cases give every member a LOD of three levels (`?bmsLod=3`),
 * still or with the camera dollying (`?bmsDolly=true`), separate LOD meshes against the engine's
 * batch (which sorts by geometry range on WebGPU with LOD members, D1's fallback). The LOD columns are the
 * swaps a second and the members fading; for the engine's batch, its geometry runs and the
 * geometries in use at the end, and its compactions a second, read from the page's own
 * `MergeBatch.ts` module (n/a when the page's resource entries don't name exactly one). The
 * `check: lod fades` pair starts 20 s fades on many members, shoots both ways 7 s in and diffs them
 * (the share of pixels over 8/255).
 *
 * p375 Phase 3's exit (S5): the `decals` cases (`?bmsDecals=blend|cutout`, a FIFO pool of 128 or 512
 * conformed patches on a heightfield, 30 spawns a second) against separate meshes; the Spawns
 * column is the spawns a second and the spawner's time per spawn. `decals burst` times
 * `spawnDecals(512)` at once; the `check: decals` pairs shoot both ways at rate 0 and diff them.
 * The `long:` cases (only with an `--only` naming `long`) churn the pool at 60 spawns a second for
 * `--long-seconds`, one run, sampling the batch's reserved sizes, the renderer's geometries and
 * textures and the JS heap every `--sample-seconds`, and print the first, last and largest.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from 'playwright-core';
import { ROOT } from '../paths';
import { out, setProgressLogFile } from '../progressLog';
import { EVALUATE_MARGIN_MS, launchVerifyChromiumAsync, withTimeout } from '../verify/browser';
import { startVerifyServerAsync } from '../verify/devServer';
import { compareSnapshots } from '../verify/snapshotDiff';

const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const LOG_FILE = path.join(ROOT, '.cache/bench/progress.log');
const SHOT_DIR = path.join(ROOT, '.cache/bench/batchedMeshSpike');
const VIEWPORT = { width: 1600, height: 900 };
const READY_TIMEOUT_MS = 180_000;
const GPU_SAMPLE_MS = 250;

type Backend = 'webgpu' | 'webgl';
/** A page script run after the load, before the warm-up (the scene's window global) */
type Churn =
  | { kind: 'instances'; share: number; rounds: number }
  | { kind: 'geometries'; mode: 'DELETE_ADD' | 'OPTIMIZE' | 'SET_AT'; rounds: number };
/** Starts LOD fades (the scene's `lod`), then shoots after `waitMs`, before measuring */
type FadeShot = { fadeSeconds: number; bias: number; waitMs: number };
type Case = {
  name: string;
  params: Record<string, string>;
  churn?: Churn;
  shot?: boolean;
  fadeShot?: FadeShot;
  /** A case whose shot this one's is diffed with */
  compareWith?: string;
  /** Decals spawned at once after the warm-up (`spawnDecals`), timed */
  burst?: number;
  /** A long churn: run only when `--only` names `long`, sampled (`decalBuffers`) */
  long?: boolean;
};

const batched = (extra: Record<string, string> = {}) => ({ bmsWay: 'batched', ...extra });
const grouped = { bmsOrder: 'grouped', bmsSort: 'none' };
/** The engine's batched group: grouped by geometry and unsorted by itself */
const engine = (extra: Record<string, string> = {}) => ({ bmsWay: 'engine', ...extra });
/** Every member a kinematic body, all moved each fixed step */
const kinematic = { bmsBodies: 'kinematic', bmsMove: '1' };
/** Every member a LOD of three levels; with the camera dollying in and out */
const lod = { bmsLod: '3' };
const dolly = { bmsLod: '3', bmsDolly: 'true' };
/** A decal pool (`?bmsDecals`): the way, the mode, the pool's size */
const decal = (
  way: 'separate' | 'engine',
  mode: 'blend' | 'cutout',
  pool: number,
  extra: Record<string, string> = {}
) => ({ bmsWay: way, bmsDecals: mode, bmsDecalPool: String(pool), ...extra });
/** Both ways of a decal case, separate first */
const decalPair = (
  name: string,
  mode: 'blend' | 'cutout',
  pool: number,
  extra: Record<string, string> = {},
  more: Partial<Case> = {}
): Case[] => [
  { name: `${name}: separate`, params: decal('separate', mode, pool, extra), ...more },
  { name: `${name}: engine`, params: decal('engine', mode, pool, extra), ...more },
];
const still = { bmsDecalRate: '0' };
/** Mid-fade: 20 s fades started by a bias of 0.15, shot 7 s in (p375 Phase 2 S4's check) */
const LOD_FADE_SHOT: FadeShot = { fadeSeconds: 20, bias: 0.15, waitMs: 7000 };

/** The spike's cases, by item (§2) */
const CASES: Case[] = [
  // Items 1 and 2: the field in view, still
  { name: 'separate', params: { bmsWay: 'separate' } },
  { name: 'baked', params: { bmsWay: 'baked' } },
  { name: 'batch random depth', params: batched() },
  { name: 'batch grouped depth', params: batched({ bmsOrder: 'grouped' }) },
  { name: 'batch random range', params: batched({ bmsSort: 'range' }) },
  { name: 'batch grouped none', params: batched(grouped) },
  { name: 'batch grouped none nocull', params: batched({ ...grouped, bmsCull: 'false' }) },
  // Phase 1's exit: the engine's batch against the hand-built one above
  { name: 'engine', params: engine() },
  { name: 'engine nocull', params: engine({ bmsCull: 'false' }) },
  // Item 1 with the sun's shadow
  { name: 'shadow: separate', params: { bmsWay: 'separate', bmsShadow: 'true' } },
  { name: 'shadow: baked', params: { bmsWay: 'baked', bmsShadow: 'true' } },
  { name: 'shadow: batch random depth', params: batched({ bmsShadow: 'true' }) },
  { name: 'shadow: batch random range', params: batched({ bmsSort: 'range', bmsShadow: 'true' }) },
  { name: 'shadow: batch grouped none', params: batched({ ...grouped, bmsShadow: 'true' }) },
  {
    name: 'shadow: batch grouped none nocull',
    params: batched({ ...grouped, bmsCull: 'false', bmsShadow: 'true' }),
  },
  { name: 'shadow: engine', params: engine({ bmsShadow: 'true' }) },
  // Item 3: members moving
  { name: 'move 10%: separate', params: { bmsWay: 'separate', bmsMove: '0.1' } },
  { name: 'move 10%: baked', params: { bmsWay: 'baked', bmsMove: '0.1' } },
  { name: 'move 10%: batch grouped none', params: batched({ ...grouped, bmsMove: '0.1' }) },
  { name: 'move 100%: separate', params: { bmsWay: 'separate', bmsMove: '1' } },
  { name: 'move 100%: baked', params: { bmsWay: 'baked', bmsMove: '1' } },
  { name: 'move 100%: batch grouped none', params: batched({ ...grouped, bmsMove: '1' }) },
  { name: 'move 10%: engine', params: engine({ bmsMove: '0.1' }) },
  { name: 'move 100%: engine', params: engine({ bmsMove: '1' }) },
  // Phase 1's exit: every member a moving kinematic body
  { name: 'kinematic move 100%: separate', params: { bmsWay: 'separate', ...kinematic } },
  { name: 'kinematic move 100%: engine', params: engine(kinematic) },
  // Item 5: most members out of view
  { name: 'inside: separate', params: { bmsWay: 'separate', bmsCamera: 'inside' } },
  { name: 'inside: baked', params: { bmsWay: 'baked', bmsCamera: 'inside' } },
  { name: 'inside: batch grouped none', params: batched({ ...grouped, bmsCamera: 'inside' }) },
  {
    name: 'inside: batch grouped none nocull',
    params: batched({ ...grouped, bmsCamera: 'inside', bmsCull: 'false' }),
  },
  {
    name: 'inside: batch random range',
    params: batched({ bmsSort: 'range', bmsCamera: 'inside' }),
  },
  { name: 'inside: engine', params: engine({ bmsCamera: 'inside' }) },
  // p375 Phase 2's exit: per-member LOD, separate LOD meshes against the engine's batch
  { name: 'lod still: separate', params: { bmsWay: 'separate', ...lod } },
  { name: 'lod still: engine', params: engine(lod) },
  { name: 'lod dolly: separate', params: { bmsWay: 'separate', ...dolly } },
  { name: 'lod dolly: engine', params: engine(dolly) },
  {
    name: 'lod dolly shadow: separate',
    params: { bmsWay: 'separate', ...dolly, bmsShadow: 'true' },
  },
  { name: 'lod dolly shadow: engine', params: engine({ ...dolly, bmsShadow: 'true' }) },
  {
    name: 'check: lod fades separate',
    params: { bmsWay: 'separate', ...lod, bmsCamera: 'inside', bmsShadow: 'true' },
    fadeShot: LOD_FADE_SHOT,
  },
  {
    name: 'check: lod fades engine',
    params: engine({ ...lod, bmsCamera: 'inside', bmsShadow: 'true' }),
    fadeShot: LOD_FADE_SHOT,
    compareWith: 'check: lod fades separate',
  },
  // p375 Phase 3's exit (S5): decal pools, separate meshes against the engine's batch
  ...decalPair('decals blend 128', 'blend', 128),
  ...decalPair('decals blend 512', 'blend', 512),
  ...decalPair('decals cutout 128', 'cutout', 128),
  ...decalPair('decals cutout 512', 'cutout', 512),
  {
    name: 'decals blend 512 depth: engine',
    params: decal('engine', 'blend', 512, { bmsDecalOrder: 'depth' }),
  },
  ...decalPair('decals blend 512 entity', 'blend', 512, { bmsDecalSpawn: 'entity' }),
  ...decalPair('decals burst 512', 'blend', 512, still, { burst: 512 }),
  {
    name: 'check: decals blend separate',
    params: decal('separate', 'blend', 128, still),
    shot: true,
  },
  {
    name: 'check: decals blend engine',
    params: decal('engine', 'blend', 128, still),
    shot: true,
    compareWith: 'check: decals blend separate',
  },
  {
    name: 'check: decals cutout separate',
    params: decal('separate', 'cutout', 128, still),
    shot: true,
  },
  {
    name: 'check: decals cutout engine',
    params: decal('engine', 'cutout', 128, still),
    shot: true,
    compareWith: 'check: decals cutout separate',
  },
  {
    name: 'long: decals blend 128 rewrite: engine',
    params: decal('engine', 'blend', 128, { bmsDecalRate: '60' }),
    long: true,
  },
  {
    name: 'long: decals blend 128 entity: engine',
    params: decal('engine', 'blend', 128, { bmsDecalRate: '60', bmsDecalSpawn: 'entity' }),
    long: true,
  },
  // Item 4: per-member colour and visibility (screenshots)
  {
    name: 'check: colours hidden',
    params: batched({ ...grouped, bmsColors: 'true', bmsHidden: '7' }),
    shot: true,
  },
  // Item 6: slot reuse
  {
    name: 'churn: instances none',
    params: batched(grouped),
    churn: { kind: 'instances', share: 0.1, rounds: 1 },
  },
  {
    name: 'churn: instances range',
    params: batched({ bmsOrder: 'grouped', bmsSort: 'range' }),
    churn: { kind: 'instances', share: 0.1, rounds: 1 },
  },
  {
    name: 'churn: geometries delete-add',
    params: batched({ ...grouped, bmsColors: 'true' }),
    churn: { kind: 'geometries', mode: 'DELETE_ADD', rounds: 40 },
    shot: true,
  },
  {
    name: 'churn: geometries optimize',
    params: batched({ ...grouped, bmsColors: 'true' }),
    churn: { kind: 'geometries', mode: 'OPTIMIZE', rounds: 40 },
    shot: true,
  },
  {
    name: 'churn: geometries set-at',
    params: batched({ ...grouped, bmsColors: 'true' }),
    churn: { kind: 'geometries', mode: 'SET_AT', rounds: 40 },
    shot: true,
  },
];

type Args = {
  backends: Backend[];
  only: string[];
  runs: number;
  warmup: number;
  frames: number;
  url: string | null;
  headed: boolean;
  json: string | null;
  longSeconds: number;
  sampleSeconds: number;
};

const fail = (message: string): never => {
  out(`${RED}${message}${RESET}`, true);
  process.exit(2);
};

const parseArgs = (argv: string[]): Args => {
  const args: Args = {
    backends: ['webgpu', 'webgl'],
    only: [],
    runs: 3,
    warmup: 120,
    frames: 300,
    url: null,
    headed: false,
    json: null,
    longSeconds: 600,
    sampleSeconds: 10,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => argv[++i] ?? fail(`${flag} needs a value`);
    if (flag === '--backends') {
      args.backends = value()
        .split(',')
        .map((b) => (b === 'webgpu' || b === 'webgl' ? b : fail(`unknown backend ${b}`)));
    } else if (flag === '--only') args.only = value().split(',');
    else if (flag === '--runs') args.runs = Math.max(1, Number(value()));
    else if (flag === '--warmup') args.warmup = Math.max(0, Number(value()));
    else if (flag === '--frames') args.frames = Math.max(1, Number(value()));
    else if (flag === '--url') args.url = value();
    else if (flag === '--headed') args.headed = true;
    else if (flag === '--json') args.json = value();
    else if (flag === '--long-seconds') args.longSeconds = Math.max(1, Number(value()));
    else if (flag === '--sample-seconds') args.sampleSeconds = Math.max(1, Number(value()));
    else fail(`unknown option ${flag}`);
  }
  return args;
};

/** What the scene's `measure` gives */
type Summary = {
  frames: number;
  cpuMs: number;
  cpuMsP90: number;
  renderMs: number;
  syncMs: number;
  drawCalls: number;
  triangles: number;
  backend: string;
  batch: Record<string, unknown> | null;
  seconds: number;
  swapsPerSecond: number;
  lodFading: number;
  mergedDraws: number;
  spawnsPerSecond: number;
  msPerSpawn: number;
};
/** `spawnDecals`' result */
type Burst = {
  count: number;
  ms: number;
  patchMs: number;
  msPerSpawn: number;
  patchMsPerSpawn: number;
};
/** `decalBuffers`' result: a long churn's sample */
type DecalBuffers = {
  spawned: number;
  batch: {
    maxInstances: number;
    instances: number;
    maxVertices: number;
    maxIndices: number;
    geometrySlots: number;
  } | null;
  geometries: number;
  textures: number;
  heapMb: number;
};
type BmsApi = {
  measure: (frames: number) => Promise<Summary>;
  churnInstances: (share: number, rounds: number) => unknown;
  churnGeometries: (mode: string, rounds: number) => unknown;
  lod: (options: { bias?: number; fadeSeconds?: number }) => void;
  engineGroup: () => object | null;
  spawnDecals: (count: number) => Burst;
  decalBuffers: () => DecalBuffers;
};
/** The engine batch's state, read through the page's own `MergeBatch.ts` */
type EngineBatch = { runs: number; geometriesInUse: number; compactions: number };
type BmsWindow = Window & {
  __aekBms?: BmsApi;
  __benchGpu?: { samples: number[]; timer: number };
};

type Run = {
  summary: Summary | null;
  gpuMs: number;
  churn?: unknown;
  /** The engine batch's state after the measure, its compactions a second during it */
  engineBatch?: (EngineBatch & { compactionsPerSecond: number }) | null;
  shotFile?: string;
  burst?: Burst;
  /** A long churn's samples, with their time (s) */
  samples?: (DecalBuffers & { seconds: number })[];
  errors: string[];
};

/** The engine batch's runs, geometries in use and compactions, from the page's own merging batch
 * module: the one resource entry naming it (a bare `import()` could be a second instance), else
 * null; null too without an engine group or a batch. */
const readEngineBatchAsync = (page: Page) =>
  page.evaluate(async (): Promise<EngineBatch | null> => {
    const group = (window as BmsWindow).__aekBms?.engineGroup();
    if (!group) return null;
    const entries = performance
      .getEntriesByType('resource')
      .filter((e) => new URL(e.name).pathname.endsWith('/_engine/features/merging/MergeBatch.ts'));
    if (entries.length !== 1) return null;
    const mod = (await import(/* @vite-ignore */ entries[0].name)) as {
      getBatchState?: (g: object) => EngineBatch | undefined;
    };
    const state = mod.getBatchState?.(group);
    return state
      ? { runs: state.runs, geometriesInUse: state.geometriesInUse, compactions: state.compactions }
      : null;
  });

const STATS_SETTINGS = JSON.stringify({
  enabled: true,
  trackTFPS: true,
  trackFPS: true,
  trackCPU: true,
  trackHz: false,
  trackGPU: true,
  trackCPT: false,
  horizontal: false,
});

const buildUrl = (base: string, c: Case) => {
  const params = new URLSearchParams({
    isDebug: 'true',
    aekTest: 'true',
    startScene: 'batchedMeshSpike',
    ...c.params,
  });
  return `${base.replace(/\/$/, '')}/?${params}`;
};

const runCaseAsync = async (page: Page, url: string, args: Args, c: Case, backend: Backend) => {
  const run: Run = { summary: null, gpuMs: NaN, errors: [] };
  page.on('pageerror', (err) => run.errors.push(`[pageerror] ${err.message}`));
  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error' || /webgpu|validation|batchedmesh/i.test(text)) {
      if (msg.type() !== 'log' && msg.type() !== 'debug') run.errors.push(text);
    }
  });
  await page.addInitScript(
    ({ stats, webgl }) => {
      // Every module's entry kept: readEngineBatchAsync finds the page's own merging module by it
      performance.setResourceTimingBufferSize(100_000);
      localStorage.setItem('AEK_debugStats', stats);
      if (webgl) localStorage.setItem('debugRenderer', JSON.stringify({ forceWebGL: true }));
      else localStorage.removeItem('debugRenderer');
    },
    { stats: STATS_SETTINGS, webgl: backend === 'webgl' }
  );
  // What ends a page early (a long churn lost one at 230 s with no Vite reload line, p375 S5)
  page.on('crash', () => run.errors.push('[crash] the page crashed'));
  let loads = 0;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame() && ++loads > 1) {
      run.errors.push(`[navigated] the page loaded again: ${frame.url()}`);
    }
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__AEK_TEST__), null, { timeout: 60_000 });
  const ready = await withTimeout(
    page.evaluate((ms) => window.__AEK_TEST__!.whenSceneReady({ timeoutMs: ms }), READY_TIMEOUT_MS),
    READY_TIMEOUT_MS + EVALUATE_MARGIN_MS,
    'whenSceneReady'
  );
  if (ready.status !== 'READY') throw new Error(`the scene didn't load (${ready.status})`);
  await page.waitForFunction(() => Boolean((window as BmsWindow).__aekBms), null, {
    timeout: 60_000,
  });
  const measureAsync = (frames: number) =>
    withTimeout(
      page.evaluate((n) => (window as BmsWindow).__aekBms!.measure(n), frames),
      (frames / 20) * 1000 + EVALUATE_MARGIN_MS,
      `measure(${frames})`
    );
  // A first frame before the churn: the batch drawn once
  await measureAsync(5);
  if (c.churn) {
    const churn = c.churn;
    run.churn = await page.evaluate(
      (ch) =>
        ch.kind === 'instances'
          ? (window as BmsWindow).__aekBms!.churnInstances(ch.share, ch.rounds)
          : (window as BmsWindow).__aekBms!.churnGeometries(ch.mode, ch.rounds),
      churn
    );
  }
  if (args.warmup > 0) await measureAsync(args.warmup);
  if (c.fadeShot) {
    const { fadeSeconds, bias, waitMs } = c.fadeShot;
    await page.evaluate((o) => (window as BmsWindow).__aekBms!.lod(o), { fadeSeconds, bias });
    await page.waitForTimeout(waitMs);
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    run.shotFile = path.join(SHOT_DIR, `${c.name.replace(/[^a-z0-9]+/gi, '-')}-${backend}.png`);
    await shootAsync(page, run.shotFile);
  }
  if (c.burst) {
    const count = c.burst;
    run.burst = await page.evaluate((n) => (window as BmsWindow).__aekBms!.spawnDecals(n), count);
  }
  if (c.long) run.samples = await sampleLongAsync(page, args);
  const before = await readEngineBatchAsync(page);
  await page.evaluate((everyMs) => {
    const gpu = { samples: [] as number[], timer: 0 };
    gpu.timer = window.setInterval(() => {
      const figure = document.querySelector('[data-panel="GPU"] .statsLive');
      gpu.samples.push(parseFloat(figure?.textContent ?? ''));
    }, everyMs);
    (window as BmsWindow).__benchGpu = gpu;
  }, GPU_SAMPLE_MS);
  run.summary = await measureAsync(args.frames);
  const after = await readEngineBatchAsync(page);
  run.engineBatch =
    before && after
      ? {
          ...after,
          compactionsPerSecond: (after.compactions - before.compactions) / run.summary.seconds,
        }
      : null;
  const samples = await page.evaluate(() => {
    const gpu = (window as BmsWindow).__benchGpu!;
    window.clearInterval(gpu.timer);
    return gpu.samples;
  });
  const usable = samples.slice(Math.ceil(1000 / GPU_SAMPLE_MS)).filter((s) => !Number.isNaN(s));
  run.gpuMs = usable.length ? usable.reduce((a, b) => a + b, 0) / usable.length : NaN;
  if (c.shot) {
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    run.shotFile = path.join(SHOT_DIR, `${c.name.replace(/[^a-z0-9]+/gi, '-')}-${backend}.png`);
    await shootAsync(page, run.shotFile);
  }
  return run;
};

/** A screenshot without the stats panels' figures (they differ run to run, which a diff of two
 * ways' shots would count) */
const shootAsync = async (page: Page, file: string) => {
  const hide = (hidden: boolean) =>
    page.evaluate((h) => {
      for (const el of document.querySelectorAll<HTMLElement>('[data-panel]')) {
        el.style.visibility = h ? 'hidden' : '';
      }
    }, hidden);
  await hide(true);
  await page.screenshot({ path: file });
  await hide(false);
};

/** A long churn: `decalBuffers()` now and every `--sample-seconds` until `--long-seconds` */
const sampleLongAsync = async (page: Page, args: Args) => {
  const samples: (DecalBuffers & { seconds: number })[] = [];
  const start = Date.now();
  for (;;) {
    const seconds = (Date.now() - start) / 1000;
    const sample = await page.evaluate(() => (window as BmsWindow).__aekBms!.decalBuffers());
    samples.push({ ...sample, seconds });
    if (seconds >= args.longSeconds) return samples;
    out(
      `${DIM}    ${Math.round(seconds)} s: ${sample.spawned} spawned, ${JSON.stringify(sample.batch)}, geometries ${sample.geometries}, textures ${sample.textures}, heap ${fmt(sample.heapMb, 1)} MB${RESET}`
    );
    await page.waitForTimeout(Math.min(args.sampleSeconds, args.longSeconds - seconds) * 1000);
  }
};

const med = (values: number[]) => {
  const v = values.filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : NaN;
};
const fmt = (n: number, digits = 2) => (Number.isNaN(n) ? 'n/a' : n.toFixed(digits));

const formatTable = (backend: string, rows: { c: Case; runs: Run[] }[]) => {
  const lines = [
    `\n${backend}: medians of the runs (CPU spread min-max)`,
    '| Case | Draws | Triangles | CPU frame (ms) | spread | Render submit (ms) | Sync (ms) | GPU (ms) | LOD swaps/s, fading | Spawns/s, ms each | Batch |',
    '| --- | ---: | ---: | ---: | --- | ---: | ---: | ---: | --- | --- | --- |',
  ];
  for (const { c, runs } of rows) {
    const ok = runs.filter((r) => r.summary);
    if (ok.length === 0) {
      lines.push(`| ${c.name} | failed | | | | | | | | | |`);
      continue;
    }
    const pick = (key: keyof Summary) => med(ok.map((r) => r.summary![key] as number));
    const cpus = ok.map((r) => r.summary!.cpuMs);
    const b = ok[ok.length - 1].summary!.batch;
    let batch = b ? `visible ${b.visible}, merged draws ${b.mergedDraws}` : '';
    const engineRuns = ok.map((r) => r.engineBatch).filter((e) => e);
    if (engineRuns.length) {
      const e = engineRuns[engineRuns.length - 1]!;
      batch += `, merged median ${fmt(pick('mergedDraws'), 0)}, runs ${e.runs} of ${e.geometriesInUse} geometries in use, compactions ${fmt(med(engineRuns.map((r) => r!.compactionsPerSecond)), 1)}/s`;
    }
    const lodText =
      pick('swapsPerSecond') > 0 || pick('lodFading') > 0
        ? `${fmt(pick('swapsPerSecond'), 0)}, ${fmt(pick('lodFading'), 0)}`
        : '';
    const bursts = ok.map((r) => r.burst).filter((b) => b);
    const spawnText = bursts.length
      ? `burst ${bursts[0]!.count}: ${fmt(med(bursts.map((b) => b!.msPerSpawn)), 3)} (patch ${fmt(med(bursts.map((b) => b!.patchMsPerSpawn)), 3)})`
      : pick('spawnsPerSecond') > 0
        ? `${fmt(pick('spawnsPerSecond'), 0)}, ${fmt(pick('msPerSpawn'), 3)}`
        : '';
    lines.push(
      `| ${c.name} | ${fmt(pick('drawCalls'), 0)} | ${Math.round(pick('triangles')).toLocaleString('en')} | ${fmt(pick('cpuMs'))} | ${fmt(Math.min(...cpus))}-${fmt(Math.max(...cpus))} | ${fmt(pick('renderMs'))} | ${fmt(pick('syncMs'), 3)} | ${fmt(med(ok.map((r) => r.gpuMs)))} | ${lodText} | ${spawnText} | ${batch} |`
    );
  }
  return lines;
};

/** A long churn's samples: the first, the last and each figure's largest; a figure that grew past
 * its first sample after the first minute is flagged */
const formatLong = (backend: string, rows: { c: Case; runs: Run[] }[]) => {
  const lines: string[] = [];
  for (const { c, runs } of rows) {
    const samples = runs.find((r) => r.samples?.length)?.samples;
    if (!c.long || !samples) continue;
    const first = samples[0];
    const settled = samples.find((x) => x.seconds >= 60) ?? first;
    const last = samples[samples.length - 1];
    const figures = {
      maxInstances: (x: DecalBuffers) => x.batch?.maxInstances ?? NaN,
      maxVertices: (x: DecalBuffers) => x.batch?.maxVertices ?? NaN,
      maxIndices: (x: DecalBuffers) => x.batch?.maxIndices ?? NaN,
      geometrySlots: (x: DecalBuffers) => x.batch?.geometrySlots ?? NaN,
      geometries: (x: DecalBuffers) => x.geometries,
      textures: (x: DecalBuffers) => x.textures,
      heapMb: (x: DecalBuffers) => x.heapMb,
    };
    lines.push(
      `\n${backend} ${c.name}: ${last.spawned} spawned in ${Math.round(last.seconds)} s`,
      '| Figure | first | at 60 s | last | largest | grew after 60 s |',
      '| --- | ---: | ---: | ---: | ---: | --- |'
    );
    for (const [name, read] of Object.entries(figures)) {
      const largest = Math.max(...samples.map(read));
      const grew = samples.some((x) => x.seconds > settled.seconds && read(x) > read(settled));
      const digits = name === 'heapMb' ? 1 : 0;
      lines.push(
        `| ${name} | ${fmt(read(first), digits)} | ${fmt(read(settled), digits)} | ${fmt(read(last), digits)} | ${fmt(largest, digits)} | ${grew && name !== 'heapMb' ? `${RED}yes${RESET}` : grew ? 'yes (heap: GC)' : 'no'} |`
      );
    }
  }
  return lines;
};

/** Diffs each `compareWith` case's shots with its pair's, run by run (the share of pixels over
 * 8/255, as the scene runner's tolerance counts them) */
const compareShotsAsync = async (backend: string, rows: { c: Case; runs: Run[] }[]) => {
  for (const { c, runs } of rows) {
    if (!c.compareWith) continue;
    const pair = rows.find((row) => row.c.name === c.compareWith);
    if (!pair) continue;
    for (let r = 0; r < runs.length; r++) {
      const shot = runs[r].shotFile;
      const other = pair.runs[r]?.shotFile;
      if (!shot || !other) continue;
      const diffFile = shot.replace(/\.png$/, '.diff.png');
      const diff = await compareSnapshots(
        fs.readFileSync(shot),
        other,
        { maxMeanDelta: 0, maxChangedRatio: 0, pixelThreshold: 8 },
        diffFile
      );
      out(
        'sizeMismatch' in diff
          ? `${backend} ${c.name} #${r + 1} against ${c.compareWith}: ${diff.sizeMismatch}`
          : `${backend} ${c.name} #${r + 1} against ${c.compareWith}: ${(diff.changedRatio * 100).toFixed(3)} % of pixels over 8/255, mean delta ${diff.meanDelta.toFixed(3)}`
      );
    }
  }
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const isLongAsked = args.only.some((o) => o.includes('long'));
  const cases = (
    args.only.length ? CASES.filter((c) => args.only.some((o) => c.name.includes(o))) : CASES
  ).filter((c) => !c.long || isLongAsked);
  if (cases.length === 0) fail('no case matches --only');
  const watch = setProgressLogFile(LOG_FILE);
  const server = args.url
    ? null
    : await startVerifyServerAsync().catch((err: Error) => fail(err.message));
  const baseUrl = server ? server.url : args.url!;
  const launched = await launchVerifyChromiumAsync({
    webgl: false,
    headed: args.headed,
    probeUrl: baseUrl,
    onNote: (note) => out(`${YELLOW}${note}${RESET}`),
  });
  out(
    `BatchedMesh spike against ${baseUrl} (${launched.label}): ${cases.length} case(s) × ${args.backends.join(', ')} × ${args.runs} run(s), ${args.warmup} + ${args.frames} frames`
  );
  out(`${DIM}Watch it: cd ${ROOT} && ${watch}${RESET}\n`);

  const results: Record<string, { c: Case; runs: Run[] }[]> = {};
  try {
    for (const backend of args.backends) {
      results[backend] = [];
      for (const c of cases) {
        const runs: Run[] = [];
        for (let r = 0; r < (c.long ? 1 : args.runs); r++) {
          const page = await launched.browser.newPage({ viewport: VIEWPORT });
          try {
            runs.push(await runCaseAsync(page, buildUrl(baseUrl, c), args, c, backend));
          } catch (err) {
            runs.push({ summary: null, gpuMs: NaN, errors: [(err as Error).message] });
          } finally {
            await withTimeout(page.close(), 30_000, 'closing the page').catch(() => undefined);
          }
          const last = runs[runs.length - 1];
          const s = last.summary;
          out(
            s
              ? `  ${backend} ${c.name} #${r + 1} (${s.backend}): CPU ${fmt(s.cpuMs)} ms, ${s.drawCalls} draws${(s as { moveWaitFrames?: number }).moveWaitFrames ? `, moves waited ${(s as { moveWaitFrames?: number }).moveWaitFrames} frames for the build` : ''}`
              : `${RED}✗ ${backend} ${c.name} #${r + 1}${RESET}`
          );
          if (s && !s.backend.toLowerCase().startsWith(backend)) {
            out(`    ${RED}asked for ${backend}, drew on ${s.backend}${RESET}`);
          }
          if (last.churn) out(`    churn: ${JSON.stringify(last.churn)}`);
          if (last.burst) out(`    burst: ${JSON.stringify(last.burst)}`);
          for (const e of [...new Set(last.errors)].slice(0, 5)) {
            out(`    ${RED}${e.slice(0, 300)}${RESET}`);
          }
        }
        results[backend].push({ c, runs });
      }
    }
  } finally {
    await launched.closeAsync().catch(() => undefined);
    await server?.server.close();
  }
  for (const backend of args.backends) {
    for (const line of formatTable(backend, results[backend])) out(line);
    for (const line of formatLong(backend, results[backend])) out(line);
    await compareShotsAsync(backend, results[backend]);
  }
  if (args.json) {
    fs.writeFileSync(args.json, `${JSON.stringify({ args, results }, null, 2)}\n`);
    out(`\n${DIM}Results: ${args.json}${RESET}`);
  }
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err: Error) => fail(`The bench stopped: ${err.stack ?? err.message}`));
}
