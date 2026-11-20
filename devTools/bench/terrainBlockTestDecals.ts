/**
 * p309 Phase 4's check (p309, section 5): the runtime decals of the
 * `terrainBlockTest` scene (its decal block's walk, `decalBlock/terrainBlockTestDecalWalk.ts`: a
 * pool of 128 footprints and one of 64 wheel-track segments, each a `BATCHED` merge group) on
 * WebGPU and on WebGL2, both on the machine's GPU (WebGL2 through the renderer tab's persisted
 * "Force WebGL", so the debug env), against the same decals shown unmerged (the Merging tab's A/B
 * view: each decal drawn by its own mesh), printing a table per backend.
 *
 *   npx tsx devTools/bench/terrainBlockTestDecals.ts [--backends webgpu,webgl] [--only <case>[,…]]
 *     [--runs 3] [--warmup 120] [--frames 300] [--url <server>] [--headed] [--json <file>]
 *     [--long-seconds 600] [--sample-seconds 10]
 *
 * Each case is a page of its own (its own dev server, the scene runner's, unless `--url`), run
 * `--runs` times; the table gives the median of the runs' medians, and the runs' spread. A page
 * fills both pools first (60 footprints a second until each is full), sets the case's rate, looks
 * over the whole block, then measures (`_dbg__terrainBlockTestDecals.ts`' `measure`): the CPU
 * frame, the render submit, the batch sync, APP_LOGIC (the walk's spawns and the pools' fades),
 * the draw calls, GPU the stats panel's figure, and the pools' objects drawn (the exit's one
 * render object per pool: 2 merged, a mesh per decal unmerged). The `long:` cases (only
 * with an `--only` naming `long`) churn the pools at 60 footprints a second for `--long-seconds`,
 * one run, sampling the batches' reserved sizes, the renderer's geometries and textures and the JS
 * heap every `--sample-seconds`, and print the first, last and largest. Output:
 * `.cache/bench/progress.log` too.
 *
 * The `gpu ` cases (only with an `--only` naming `gpu`, WebGL2 only: p309 D4's open question)
 * time WebGL2's GPU with timer queries of their own (`_dbg__terrainBlockTestGpuProfile.ts`), the
 * stats panel's GPU timer off (a WebGL2 timer query can't nest): `pools` around the pools' own
 * objects (their uploads and draws; the batch per pool, or each decal's own mesh unmerged),
 * `frame` around the whole render submit, over `--frames` frames after the warm-up, at rates 0
 * (nothing rewritten), 2 and 30.
 *
 * The rates are a simulated second's: the walk runs on the fixed steps, and the test bridge
 * (`?aekTest`) steps once a frame, so at 144 Hz a rate of 30 stamps 72 footprints a real second
 * (the table's figures are real seconds').
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from 'playwright-core';
import { ROOT } from '../paths';
import { out, setProgressLogFile } from '../progressLog';
import { EVALUATE_MARGIN_MS, launchVerifyChromiumAsync, withTimeout } from '../verify/browser';
import { startVerifyServerAsync } from '../verify/devServer';

const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const LOG_FILE = path.join(ROOT, '.cache/bench/progress.log');
const VIEWPORT = { width: 1600, height: 900 };
const READY_TIMEOUT_MS = 180_000;
const FILL_TIMEOUT_MS = 60_000;
const FILL_RATE = 60;
const GPU_SAMPLE_MS = 250;
const SCENE_ID = 'terrainBlockTest';

type Backend = 'webgpu' | 'webgl';
type GpuProfileMode = 'POOLS' | 'FRAME';
/** `profileGpu`'s result (`GpuProfileResult`) */
type GpuProfile = {
  mode: GpuProfileMode;
  frames: number;
  framesTimed: number;
  busyFrames: number;
  disjointFrames: number;
  queriesPerFrame: number;
  medianMs: number;
  p90Ms: number;
  meanMs: number;
};
type Case = {
  name: string;
  /** `?tbtDecals` */
  mode: 'blend' | 'cutout';
  /** Footprints a second while measuring */
  rate: number;
  isUnmerged: boolean;
  /** A long churn: run only when `--only` names `long`, sampled (`decalBuffers`) */
  long?: boolean;
  /** A WebGL2 GPU profile: run only when `--only` names `gpu`, on WebGL2 only */
  profile?: GpuProfileMode;
  /** More URL parameters (the walk's, `?tbtDecalFifoFade`) */
  params?: Record<string, string>;
};

/** A case both ways, merged first */
const pair = (name: string, mode: Case['mode'], rate: number): Case[] => [
  { name: `${name}: merged`, mode, rate, isUnmerged: false },
  { name: `${name}: unmerged`, mode, rate, isUnmerged: true },
];

/** A WebGL2 GPU profile both ways */
const profiled = (
  name: string,
  profile: GpuProfileMode,
  mode: Case['mode'],
  rate: number
): Case[] => pair(name, mode, rate).map((c) => ({ ...c, profile }));

const CASES: Case[] = [
  // A walk (1.4 m/s), the cart at twice its speed: 2 footprints and about 2.6 segments a
  // simulated second
  ...pair('walk blend', 'blend', 2),
  // p375 S5's rate: 30 footprints and about 40 segments a simulated second
  ...pair('churn blend 30', 'blend', 30),
  ...pair('churn cutout 30', 'cutout', 30),
  { name: 'long: churn blend 60: merged', mode: 'blend', rate: 60, isUnmerged: false, long: true },
  ...profiled('gpu pools blend 0', 'POOLS', 'blend', 0),
  ...profiled('gpu pools blend 2', 'POOLS', 'blend', 2),
  ...profiled('gpu pools blend 30', 'POOLS', 'blend', 30),
  ...profiled('gpu pools cutout 30', 'POOLS', 'cutout', 30),
  ...profiled('gpu frame blend 0', 'FRAME', 'blend', 0),
  ...profiled('gpu frame blend 2', 'FRAME', 'blend', 2),
  ...profiled('gpu frame blend 30', 'FRAME', 'blend', 30),
  ...profiled('gpu frame cutout 30', 'FRAME', 'cutout', 30),
  // The FIFO's colour writes off (`fifoFade: 0`): what the instance colour texture's uploads cost
  ...profiled('gpu frame blend 30 no fifo fade', 'FRAME', 'blend', 30).map((c) => ({
    ...c,
    params: { tbtDecalFifoFade: '0' },
  })),
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

/** A pool's batch figures (`decalBuffers`) */
type PoolBatch = {
  maxInstances: number;
  instances: number;
  visible: number;
  mergedDraws: number;
  geometrySlots: number;
  vertices: number;
  maxVertices: number;
  indices: number;
  maxIndices: number;
};
type PoolFigures = { decals: number; batch: PoolBatch | null } | null;
/** `decalBuffers`' result */
type DecalBuffers = {
  footprintsSpawned: number;
  segmentsSpawned: number;
  footprints: PoolFigures;
  tracks: PoolFigures;
  geometries: number;
  textures: number;
  drawCalls: number;
  heapMb: number;
};
/** What the probe's `measure` gives */
type Summary = {
  frames: number;
  seconds: number;
  cpuMs: number;
  cpuMsP90: number;
  renderMs: number;
  syncMs: number;
  logicMs: number;
  logicMsP90: number;
  drawCalls: number;
  triangles: number;
  footprintsPerSecond: number;
  segmentsPerSecond: number;
  poolObjects: number;
  buffers: DecalBuffers;
  backend: string;
};
type ProbeApi = {
  measure: (frames: number) => Promise<Summary>;
  setUnmerged: (isOn: boolean) => Promise<number>;
  setRate: (rate: number) => void;
  decalBuffers: () => DecalBuffers;
  lookAtDecalWalk: () => void;
  profileGpu: (mode: GpuProfileMode, frames: number) => Promise<GpuProfile>;
};
type BenchWindow = Window & {
  __terrainBlockTest?: Partial<ProbeApi>;
  __benchGpu?: { samples: number[]; timer: number };
};

type Run = {
  summary: Summary | null;
  gpuMs: number;
  /** A long churn's samples, with their time (s) */
  samples?: (DecalBuffers & { seconds: number })[];
  /** A WebGL2 GPU profile's result */
  profile?: GpuProfile;
  errors: string[];
};

/** The stats panels: GPU's timer off for a profile (its query would block the profile's) */
const getStatsSettings = (trackGPU: boolean) =>
  JSON.stringify({
    enabled: true,
    trackTFPS: true,
    trackFPS: true,
    trackCPU: true,
    trackHz: false,
    trackGPU,
    trackCPT: false,
    horizontal: false,
  });

const buildUrl = (base: string, c: Case) => {
  const params = new URLSearchParams({
    isDebug: 'true',
    aekTest: 'true',
    startScene: SCENE_ID,
    tbtDecals: c.mode,
    tbtDecalRate: String(FILL_RATE),
    ...c.params,
  });
  return `${base.replace(/\/$/, '')}/?${params}`;
};

/** Waits until both pools are full (their batches' instances at the pools' sizes) */
const fillPoolsAsync = (page: Page) =>
  page.waitForFunction(
    () => {
      const b = (window as BenchWindow).__terrainBlockTest!.decalBuffers!();
      return b.footprints?.decals === 128 && b.tracks?.decals === 64;
    },
    null,
    { timeout: FILL_TIMEOUT_MS, polling: 250 }
  );

const runCaseAsync = async (page: Page, url: string, args: Args, c: Case, backend: Backend) => {
  const run: Run = { summary: null, gpuMs: NaN, errors: [] };
  page.on('pageerror', (err) => run.errors.push(`[pageerror] ${err.message}`));
  page.on('console', (msg) => {
    const text = msg.text();
    // three's one warning on WebGL2 when the GPU timer installs its inspector (harmless)
    if (text.includes('.toInspector()')) return;
    if (msg.type() === 'error' || /webgpu|validation|batchedmesh/i.test(text)) {
      if (msg.type() !== 'log' && msg.type() !== 'debug') run.errors.push(text);
    }
  });
  page.on('crash', () => run.errors.push('[crash] the page crashed'));
  await page.addInitScript(
    ({ stats, webgl }) => {
      // Every module's entry kept: setUnmerged finds the page's own unmerged view module by it
      performance.setResourceTimingBufferSize(100_000);
      localStorage.setItem('AEK_debugStats', stats);
      if (webgl) localStorage.setItem('debugRenderer', JSON.stringify({ forceWebGL: true }));
      else localStorage.removeItem('debugRenderer');
    },
    { stats: getStatsSettings(!c.profile), webgl: backend === 'webgl' }
  );
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
  await page.waitForFunction(
    () => Boolean((window as BenchWindow).__terrainBlockTest?.measure),
    null,
    { timeout: 60_000 }
  );
  await page.evaluate(() => (window as BenchWindow).__terrainBlockTest!.lookAtDecalWalk!());
  await fillPoolsAsync(page);
  await page.evaluate((rate) => (window as BenchWindow).__terrainBlockTest!.setRate!(rate), c.rate);
  if (c.isUnmerged) {
    const switched = await page.evaluate(() =>
      (window as BenchWindow).__terrainBlockTest!.setUnmerged!(true)
    );
    if (switched !== 2) run.errors.push(`unmerged view: ${switched} of 2 groups switched`);
  }
  const measureAsync = (frames: number) =>
    withTimeout(
      page.evaluate((n) => (window as BenchWindow).__terrainBlockTest!.measure!(n), frames),
      (frames / 20) * 1000 + EVALUATE_MARGIN_MS,
      `measure(${frames})`
    );
  if (args.warmup > 0) await measureAsync(args.warmup);
  if (c.long) run.samples = await sampleLongAsync(page, args);
  if (c.profile) {
    run.profile = await withTimeout(
      page.evaluate(
        ({ mode, frames }) => (window as BenchWindow).__terrainBlockTest!.profileGpu!(mode, frames),
        { mode: c.profile, frames: args.frames }
      ),
      (args.frames / 20) * 1000 + EVALUATE_MARGIN_MS,
      `profileGpu(${args.frames})`
    );
  }
  await page.evaluate((everyMs) => {
    const gpu = { samples: [] as number[], timer: 0 };
    gpu.timer = window.setInterval(() => {
      const figure = document.querySelector('[data-panel="GPU"] .statsLive');
      gpu.samples.push(parseFloat(figure?.textContent ?? ''));
    }, everyMs);
    (window as BenchWindow).__benchGpu = gpu;
  }, GPU_SAMPLE_MS);
  run.summary = await measureAsync(args.frames);
  const samples = await page.evaluate(() => {
    const gpu = (window as BenchWindow).__benchGpu!;
    window.clearInterval(gpu.timer);
    return gpu.samples;
  });
  const usable = samples.slice(Math.ceil(1000 / GPU_SAMPLE_MS)).filter((s) => !Number.isNaN(s));
  run.gpuMs = usable.length ? usable.reduce((a, b) => a + b, 0) / usable.length : NaN;
  return run;
};

/** A long churn: `decalBuffers()` now and every `--sample-seconds` until `--long-seconds` */
const sampleLongAsync = async (page: Page, args: Args) => {
  const samples: (DecalBuffers & { seconds: number })[] = [];
  const start = Date.now();
  for (;;) {
    const seconds = (Date.now() - start) / 1000;
    const sample = await page.evaluate(() =>
      (window as BenchWindow).__terrainBlockTest!.decalBuffers!()
    );
    samples.push({ ...sample, seconds });
    if (seconds >= args.longSeconds) return samples;
    const batch = (p: PoolFigures) =>
      p?.batch ? `${p.batch.maxInstances}/${p.batch.maxVertices}/${p.batch.maxIndices}` : 'n/a';
    out(
      `${DIM}    ${Math.round(seconds)} s: ${sample.footprintsSpawned} footprints, ${sample.segmentsSpawned} segments; reserved (instances/vertices/indices) footprints ${batch(sample.footprints)}, tracks ${batch(sample.tracks)}; geometries ${sample.geometries}, textures ${sample.textures}, heap ${fmt(sample.heapMb, 1)} MB${RESET}`
    );
    await page.waitForTimeout(Math.min(args.sampleSeconds, args.longSeconds - seconds) * 1000);
  }
};

const med = (values: number[]) => {
  const v = values.filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : NaN;
};
const fmt = (n: number, digits = 2) => (Number.isNaN(n) ? 'n/a' : n.toFixed(digits));

/** The GPU profiles: each run's median, and the median of the runs' figures */
const formatProfiles = (backend: string, rows: { c: Case; runs: Run[] }[]) => {
  const profiled = rows.filter(({ c }) => c.profile);
  if (profiled.length === 0) return [];
  const lines = [
    `\n${backend}: GPU profiles (own timer queries; medians of the runs)`,
    '| Case | Timed | Queries a frame | Median (ms) | runs | p90 (ms) | Mean (ms) | Frames timed, busy, disjoint |',
    '| --- | --- | ---: | ---: | --- | ---: | ---: | --- |',
  ];
  for (const { c, runs } of profiled) {
    const ok = runs.map((r) => r.profile).filter((p): p is GpuProfile => Boolean(p));
    if (ok.length === 0) {
      lines.push(`| ${c.name} | failed | | | | | | |`);
      continue;
    }
    const pick = (key: keyof GpuProfile) => med(ok.map((p) => p[key] as number));
    const last = ok[ok.length - 1];
    lines.push(
      `| ${c.name} | ${c.profile} | ${fmt(pick('queriesPerFrame'), 0)} | ${fmt(pick('medianMs'), 3)} | ${ok.map((p) => fmt(p.medianMs, 3)).join(', ')} | ${fmt(pick('p90Ms'), 3)} | ${fmt(pick('meanMs'), 3)} | ${last.framesTimed}, ${last.busyFrames}, ${last.disjointFrames} |`
    );
  }
  return lines;
};

const formatTable = (backend: string, rows: { c: Case; runs: Run[] }[]) => {
  if (rows.every(({ c }) => c.long || c.profile)) return [];
  const lines = [
    `\n${backend}: medians of the runs (CPU spread min-max)`,
    '| Case | Pool objects | Draws | CPU frame (ms) | spread | Render submit (ms) | Batch sync (ms) | APP_LOGIC (ms, p90) | GPU (ms) | Footprints/s, segments/s | Batches (instances drawn, draws) |',
    '| --- | ---: | ---: | ---: | --- | ---: | ---: | --- | ---: | --- | --- |',
  ];
  for (const { c, runs } of rows) {
    if (c.long || c.profile) continue;
    const ok = runs.filter((r) => r.summary);
    if (ok.length === 0) {
      lines.push(`| ${c.name} | failed | | | | | | | | | |`);
      continue;
    }
    const pick = (key: keyof Summary) => med(ok.map((r) => r.summary![key] as number));
    const cpus = ok.map((r) => r.summary!.cpuMs);
    const b = ok[ok.length - 1].summary!.buffers;
    const batch = (p: PoolFigures) =>
      p?.batch ? `${p.batch.visible}, ${p.batch.mergedDraws}` : 'n/a';
    lines.push(
      `| ${c.name} | ${fmt(pick('poolObjects'), 0)} | ${fmt(pick('drawCalls'), 0)} | ${fmt(pick('cpuMs'))} | ${fmt(Math.min(...cpus))}-${fmt(Math.max(...cpus))} | ${fmt(pick('renderMs'))} | ${fmt(pick('syncMs'), 3)} | ${fmt(pick('logicMs'), 3)}, ${fmt(pick('logicMsP90'), 3)} | ${fmt(med(ok.map((r) => r.gpuMs)))} | ${fmt(pick('footprintsPerSecond'), 1)}, ${fmt(pick('segmentsPerSecond'), 1)} | footprints ${batch(b.footprints)}; tracks ${batch(b.tracks)} |`
    );
  }
  return lines;
};

/** A long churn's samples: the first, at 60 s, the last and each figure's largest; a figure that
 * grew past its 60 s sample is flagged */
const formatLong = (backend: string, rows: { c: Case; runs: Run[] }[]) => {
  const lines: string[] = [];
  for (const { c, runs } of rows) {
    const samples = runs.find((r) => r.samples?.length)?.samples;
    if (!c.long || !samples) continue;
    const first = samples[0];
    const settled = samples.find((x) => x.seconds >= 60) ?? first;
    const last = samples[samples.length - 1];
    const pool = (key: 'footprints' | 'tracks', figure: keyof PoolBatch) => (x: DecalBuffers) =>
      x[key]?.batch?.[figure] ?? NaN;
    const figures: Record<string, (x: DecalBuffers) => number> = {
      'footprints maxInstances': pool('footprints', 'maxInstances'),
      'footprints maxVertices': pool('footprints', 'maxVertices'),
      'footprints maxIndices': pool('footprints', 'maxIndices'),
      'footprints slots': pool('footprints', 'geometrySlots'),
      'tracks maxInstances': pool('tracks', 'maxInstances'),
      'tracks maxVertices': pool('tracks', 'maxVertices'),
      'tracks maxIndices': pool('tracks', 'maxIndices'),
      'tracks slots': pool('tracks', 'geometrySlots'),
      geometries: (x) => x.geometries,
      textures: (x) => x.textures,
      heapMb: (x) => x.heapMb,
    };
    lines.push(
      `\n${backend} ${c.name}: ${last.footprintsSpawned} footprints and ${last.segmentsSpawned} segments spawned in ${Math.round(last.seconds)} s`,
      '| Figure | first | at 60 s | last | largest | grew after 60 s |',
      '| --- | ---: | ---: | ---: | ---: | --- |'
    );
    for (const [name, read] of Object.entries(figures)) {
      const largest = Math.max(...samples.map(read));
      const grew = samples.some((x) => x.seconds > settled.seconds && read(x) > read(settled));
      const digits = name === 'heapMb' ? 1 : 0;
      const grewText = !grew ? 'no' : name === 'heapMb' ? 'yes (heap: GC)' : `${RED}yes${RESET}`;
      lines.push(
        `| ${name} | ${fmt(read(first), digits)} | ${fmt(read(settled), digits)} | ${fmt(read(last), digits)} | ${fmt(largest, digits)} | ${grewText} |`
      );
    }
  }
  return lines;
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const isLongAsked = args.only.some((o) => o.includes('long'));
  const isGpuAsked = args.only.some((o) => o.includes('gpu'));
  const cases = (
    args.only.length ? CASES.filter((c) => args.only.some((o) => c.name.includes(o))) : CASES
  ).filter((c) => (!c.long || isLongAsked) && (!c.profile || isGpuAsked));
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
    `Terrain decals against ${baseUrl} (${launched.label}): ${cases.length} case(s) × ${args.backends.join(', ')} × ${args.runs} run(s), ${args.warmup} + ${args.frames} frames`
  );
  out(`${DIM}Watch it: cd ${ROOT} && ${watch}${RESET}\n`);

  const results: Record<string, { c: Case; runs: Run[] }[]> = {};
  try {
    for (const backend of args.backends) {
      results[backend] = [];
      for (const c of cases) {
        if (c.profile && backend !== 'webgl') continue;
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
              ? `  ${backend} ${c.name} #${r + 1} (${s.backend}): CPU ${fmt(s.cpuMs)} ms, ${s.drawCalls} draws, ${s.poolObjects} pool objects, GPU ${fmt(last.gpuMs)} ms`
              : `${RED}✗ ${backend} ${c.name} #${r + 1}${RESET}`
          );
          if (s && !s.backend.toLowerCase().startsWith(backend)) {
            out(`    ${RED}asked for ${backend}, drew on ${s.backend}${RESET}`);
          }
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
    for (const line of formatProfiles(backend, results[backend])) out(line);
  }
  if (args.json) {
    fs.writeFileSync(args.json, `${JSON.stringify({ args, results }, null, 2)}\n`);
    out(`\n${DIM}Results: ${args.json}${RESET}`);
  }
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err: Error) => fail(`The bench stopped: ${err.stack ?? err.message}`));
}
