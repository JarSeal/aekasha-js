/**
 * p376 Phase 0's bench (docs/plans/p376_hlod-merged-cluster-proxies.md §3): drives the scenes'
 * HLOD probe (`window.__aekHlod`, `src/app/shared/_dbg__hlodSpike.ts`) and prints its tables.
 *
 *   npx tsx devTools/bench/hlodSpike.ts [--step simplify] [--scenes largeWorld,testDebugScene]
 *     [--variants default,permissive,prune,prunePermissive] [--ratios 0.5,0.25,0.1]
 *     [--max-error 0.05] [--runs 3] [--no-worker] [--url <server>] [--headed] [--json <file>]
 *
 * Step 1 (`simplify`): every BAKED merge group of each scene simplified in each variant with the
 * engine's simplifier, its levels' triangles and errors (metres), the main thread's time (the
 * median of `--runs`) and, for the variants without `prune`, the assets worker's (`generateLodChain`
 * on a registered copy). Then the totals: the groups' triangles at each level (a group whose chain
 * stopped counts its last level) and the share of the base they save. Each scene is a page of its
 * own (its own dev server, the scene runner's, unless `--url`), in the debug env on WebGPU.
 *
 *   npx tsx devTools/bench/hlodSpike.ts --step frames [--backends webgpu,webgl] [--views start,far]
 *     [--proxy permissive] [--max-error 0.2] [--ratios …] [--max-pixel-error 1] [--time 10] [--field <sites>]
 *     [--runs 3] [--warmup 120] [--frames 300] [--url <server>] [--headed] [--json <file>]
 *
 * Step 2 (`frames`, `hlodSpikeFrames.ts`): largeWorld's frame with the groups at full detail, at
 * the level `AUTO` would pick and at their coarsest proxy level (`--proxy`'s variant at
 * `--max-error`, default 0.2 here), on each backend. Step 3 is `frames` with `--field <sites>`
 * (largeWorld's far field, `?hlodField`) and `--views` naming `ground` (8 m up, looking across it).
 *
 *   npx tsx devTools/bench/hlodSpike.ts --step draws [--field 400] [--cases floor,members@32,…]
 *     [--rebuilds 8] [--backends webgpu,webgl] [--views start,far,ground] [--time 10] [--runs 3]
 *     [--warmup 120] [--frames 300] [--url <server>] [--headed] [--json <file>]
 *
 * p377 Phase 0 (`draws`, `hlodSpikeDraws.ts`): which way to fewer draws on the far field
 * (`--field`, default 400 sites here): the floor, the reference (`members@32`) and its culls
 * (`+cull25|50|75`), larger cells (`members@<m>`), a cell as one mesh (`proxy@<m>`) and today's far
 * layer (`instanced@<m>`); `--cases` names any of them (default steps 1-4's). Each case's CPU
 * split, draws, GPU and a snapshot against the reference's, each page's load and (members) its
 * rebuilds. The results also go to `.cache/bench/hlodSpike/draws/<sites>-sites/results.json`.
 * Output: `.cache/bench/progress.log` too.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser } from 'playwright-core';
import { ROOT } from '../paths';
import { out, setProgressLogFile } from '../progressLog';
import { launchVerifyChromiumAsync, withTimeout } from '../verify/browser';
import { startVerifyServerAsync } from '../verify/devServer';
import {
  DEFAULT_DRAW_CASES,
  formatDraws,
  getDrawsDir,
  parseDrawCase,
  runDrawsStepAsync,
  type DrawsArgs,
} from './hlodSpikeDraws';
import { FRAME_VIEWS, formatFrames, runFramesStepAsync, type FramesArgs } from './hlodSpikeFrames';
import {
  buildSceneUrl,
  DIM,
  fail,
  fmt,
  int,
  openSceneAsync,
  pct,
  printErrors,
  RED,
  RESET,
  VIEWPORT,
  YELLOW,
  type Backend,
} from './hlodSpikePage';

const LOG_FILE = path.join(ROOT, '.cache/bench/progress.log');
const SIMPLIFY_TIMEOUT_MS = 600_000;

const VARIANTS = ['default', 'permissive', 'prune', 'prunePermissive'] as const;
type VariantName = (typeof VARIANTS)[number];
const VARIANT_LABELS: Record<VariantName, string> = {
  default: 'default',
  permissive: 'permissive',
  prune: 'prune',
  prunePermissive: 'prune + permissive',
};

type Args = {
  step: 'simplify' | 'frames' | 'draws';
  scenes: string[];
  variants: VariantName[];
  ratios: number[] | null;
  maxError: number | null;
  runs: number;
  worker: boolean;
  url: string | null;
  headed: boolean;
  json: string | null;
  /** Step 2's */
  backends: Backend[];
  views: string[];
  proxy: VariantName;
  maxPixelError: number;
  timeOfDay: number;
  warmup: number;
  frames: number;
  field: number;
  /** Step `draws`' (p377) */
  cases: string[];
  rebuilds: number;
};

const parseArgs = (argv: string[]): Args => {
  const args: Args = {
    step: 'simplify',
    scenes: ['largeWorld', 'testDebugScene'],
    variants: [...VARIANTS],
    ratios: null,
    maxError: null,
    runs: 3,
    worker: true,
    url: null,
    headed: false,
    json: null,
    backends: ['webgpu', 'webgl'],
    views: Object.keys(FRAME_VIEWS),
    proxy: 'permissive',
    maxPixelError: 1,
    timeOfDay: 10,
    warmup: 120,
    frames: 300,
    field: -1,
    cases: DEFAULT_DRAW_CASES,
    rebuilds: 8,
  };
  const variant = (v: string) =>
    (VARIANTS as readonly string[]).includes(v) ? (v as VariantName) : fail(`unknown variant ${v}`);
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => argv[++i] ?? fail(`${flag} needs a value`);
    if (flag === '--step') {
      const step = value();
      args.step =
        step === 'simplify' || step === 'frames' || step === 'draws'
          ? step
          : fail(`unknown step ${step}`);
    } else if (flag === '--scenes') args.scenes = value().split(',');
    else if (flag === '--variants') args.variants = value().split(',').map(variant);
    else if (flag === '--proxy') args.proxy = variant(value());
    else if (flag === '--backends') {
      args.backends = value()
        .split(',')
        .map((b) => (b === 'webgpu' || b === 'webgl' ? b : fail(`unknown backend ${b}`)));
    } else if (flag === '--views') {
      args.views = value()
        .split(',')
        .map((v) => (FRAME_VIEWS[v] ? v : fail(`unknown view ${v}`)));
    } else if (flag === '--max-pixel-error') args.maxPixelError = Number(value());
    else if (flag === '--time') args.timeOfDay = Number(value());
    else if (flag === '--warmup') args.warmup = Math.max(0, Number(value()));
    else if (flag === '--frames') args.frames = Math.max(1, Number(value()));
    else if (flag === '--field') args.field = Math.max(0, Math.floor(Number(value())));
    else if (flag === '--cases') {
      args.cases = value().split(',');
      for (const name of args.cases) {
        try {
          parseDrawCase(name);
        } catch (err) {
          fail((err as Error).message);
        }
      }
    } else if (flag === '--rebuilds') args.rebuilds = Math.max(0, Math.floor(Number(value())));
    else if (flag === '--ratios') args.ratios = value().split(',').map(Number);
    else if (flag === '--max-error') args.maxError = Number(value());
    else if (flag === '--runs') args.runs = Math.max(1, Number(value()));
    else if (flag === '--no-worker') args.worker = false;
    else if (flag === '--url') args.url = value();
    else if (flag === '--headed') args.headed = true;
    else if (flag === '--json') args.json = value();
    else fail(`unknown option ${flag}`);
  }
  // The field: none by default, 400 sites for p377's draws
  if (args.field < 0) args.field = args.step === 'draws' ? 400 : 0;
  return args;
};

/** What the probe's `simplifyAsync` gives (`_dbg__hlodSpike.ts`) */
type Level = { triangles: number; errorM: number };
type VariantResult = {
  levels: Level[];
  mainMs: number;
  workerMs: number | null;
  workerLoadedOn: string | null;
  workerTriangles: number[] | null;
};
type GroupResult = {
  id: string;
  members: number;
  material: string;
  vertices: number;
  triangles: number;
  extent: number;
  radius: number;
  variants: Partial<Record<VariantName, VariantResult>>;
};
type SimplifyResult = {
  sceneId: string;
  options: { ratios: number[]; maxError: number };
  groups: GroupResult[];
};
type HlodWindow = Window & {
  __aekHlod?: {
    simplifyAsync: (options: object) => Promise<SimplifyResult>;
  };
};

/** An `AUTO` group's id as its material and cell (`auto:<hash>:<cx>,<cz>:<n>`), else the id */
const shortGroupName = (g: GroupResult) => {
  const auto = /^auto:[^:]+:(-?\d+,-?\d+):(\d+)$/.exec(g.id);
  return auto ? `${g.material} @${auto[1]}${auto[2] !== '0' ? ` #${auto[2]}` : ''}` : g.id;
};

/** A chain's levels as "t1 → t2 → t3 (e1 / e2 / e3 m)"; "none" without levels */
const formatLevels = (v: VariantResult | undefined) =>
  !v
    ? ''
    : v.levels.length === 0
      ? 'none'
      : `${v.levels.map((l) => int(l.triangles)).join(' → ')} (${v.levels.map((l) => fmt(l.errorM)).join(' / ')} m)`;

/** The groups' triangles at level `n` (1-based) of a variant: a group whose chain stopped earlier
 * counts its last level, one without levels its base */
const trianglesAtLevel = (groups: GroupResult[], variant: VariantName, n: number) =>
  groups.reduce((sum, g) => {
    const levels = g.variants[variant]?.levels ?? [];
    return sum + (levels.length ? levels[Math.min(n, levels.length) - 1].triangles : g.triangles);
  }, 0);

const formatSimplify = (result: SimplifyResult, args: Args) => {
  const { groups } = result;
  const lines = [
    `\n${result.sceneId}: ${groups.length} BAKED groups, ratios [${result.options.ratios.join(', ')}], maxError ${result.options.maxError}`,
    `| Group | Members | Vertices | Triangles | Extent (m) | ${args.variants.map((v) => `${VARIANT_LABELS[v]}: triangles (error)`).join(' | ')} |`,
    `| --- | ---: | ---: | ---: | ---: | ${args.variants.map(() => '---').join(' | ')} |`,
  ];
  for (const g of groups) {
    lines.push(
      `| ${shortGroupName(g)} | ${g.members} | ${int(g.vertices)} | ${int(g.triangles)} | ${fmt(g.extent, 1)} | ${args.variants.map((v) => formatLevels(g.variants[v])).join(' | ')} |`
    );
  }
  const base = groups.reduce((sum, g) => sum + g.triangles, 0);
  const depth = result.options.ratios.length;
  lines.push(
    `\n${result.sceneId} totals: ${int(base)} triangles in the groups at full detail`,
    `| Variant | Groups with levels | ${Array.from({ length: depth }, (_, i) => `Level ${i + 1}: triangles (saved)`).join(' | ')} | Main thread (ms, sum of medians) | Worker (ms, sum) | Slowest group (main ms) |`,
    `| --- | ---: | ${Array.from({ length: depth }, () => '---:').join(' | ')} | ---: | ---: | ---: |`
  );
  for (const v of args.variants) {
    const withLevels = groups.filter((g) => (g.variants[v]?.levels.length ?? 0) > 0).length;
    const levels = Array.from({ length: depth }, (_, i) => {
      const t = trianglesAtLevel(groups, v, i + 1);
      return `${int(t)} (${pct(base - t, base)})`;
    });
    const mainMs = groups.reduce((sum, g) => sum + (g.variants[v]?.mainMs ?? 0), 0);
    const workerTimes = groups
      .map((g) => g.variants[v]?.workerMs)
      .filter((t): t is number => t !== null && t !== undefined);
    const workerMs = workerTimes.length ? workerTimes.reduce((a, b) => a + b, 0) : NaN;
    const slowest = groups.reduce(
      (worst, g) =>
        (g.variants[v]?.mainMs ?? 0) > worst.ms ? { ms: g.variants[v]!.mainMs, g } : worst,
      { ms: 0, g: null as GroupResult | null }
    );
    lines.push(
      `| ${VARIANT_LABELS[v]} | ${withLevels} of ${groups.length} | ${levels.join(' | ')} | ${fmt(mainMs)} | ${fmt(workerMs)} | ${slowest.g ? `${fmt(slowest.ms)} (${shortGroupName(slowest.g)}, ${int(slowest.g.triangles)} triangles)` : ''} |`
    );
  }
  // The worker's levels should be the main thread's (the same simplifier); a fallback is flagged
  const mismatches: string[] = [];
  for (const g of groups) {
    for (const v of args.variants) {
      const r = g.variants[v];
      if (!r?.workerTriangles) continue;
      const main = r.levels.map((l) => l.triangles).join(',');
      if (r.workerTriangles.join(',') !== main) {
        mismatches.push(
          `${shortGroupName(g)} ${v}: worker ${r.workerTriangles.join(',')} vs main ${main}`
        );
      }
      if (r.workerLoadedOn && r.workerLoadedOn !== 'WORKER_THREAD') {
        mismatches.push(`${shortGroupName(g)} ${v}: the worker path ran on ${r.workerLoadedOn}`);
      }
    }
  }
  for (const m of mismatches) lines.push(`${YELLOW}${m}${RESET}`);
  return lines;
};

/** Step 1: each scene's groups simplified in each variant */
const runSimplifyStepAsync = async (browser: Browser, baseUrl: string, args: Args) => {
  const results: SimplifyResult[] = [];
  for (const sceneId of args.scenes) {
    const page = await browser.newPage({ viewport: VIEWPORT });
    const errors: string[] = [];
    try {
      const extra: Record<string, string> =
        args.field > 0 && sceneId === 'largeWorld' ? { hlodField: String(args.field) } : {};
      await openSceneAsync(page, buildSceneUrl(baseUrl, sceneId, extra), 'webgpu', errors);
      const options = {
        variants: args.variants,
        runs: args.runs,
        worker: args.worker,
        ...(args.ratios ? { ratios: args.ratios } : {}),
        ...(args.maxError !== null ? { maxError: args.maxError } : {}),
      };
      const result = await withTimeout(
        page.evaluate((o) => (window as HlodWindow).__aekHlod!.simplifyAsync(o), options),
        SIMPLIFY_TIMEOUT_MS,
        'simplifyAsync'
      );
      results.push(result);
      out(`  ${sceneId}: ${result.groups.length} groups simplified`);
    } catch (err) {
      out(`${RED}✗ ${sceneId}: ${(err as Error).message}${RESET}`);
    } finally {
      printErrors(errors);
      await withTimeout(page.close(), 30_000, 'closing the page').catch(() => undefined);
    }
  }
  return results;
};

/** Step 2's arguments: the proxies' chain from `--proxy` and `--max-error` (0.2 by default) */
const toFramesArgs = (args: Args): FramesArgs => ({
  backends: args.backends,
  runs: args.runs,
  warmup: args.warmup,
  frames: args.frames,
  views: args.views,
  timeOfDay: args.timeOfDay,
  maxPixelError: args.maxPixelError,
  field: args.field,
  chain: {
    permissive: args.proxy === 'permissive' || args.proxy === 'prunePermissive',
    prune: args.proxy === 'prune' || args.proxy === 'prunePermissive',
    maxError: args.maxError ?? 0.2,
    ...(args.ratios ? { ratios: args.ratios } : {}),
  },
});

/** Step `draws`' arguments */
const toDrawsArgs = (args: Args): DrawsArgs => ({
  backends: args.backends,
  runs: args.runs,
  warmup: args.warmup,
  frames: args.frames,
  views: args.views,
  timeOfDay: args.timeOfDay,
  field: args.field,
  cases: args.cases,
  rebuilds: args.rebuilds,
});

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
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
    args.step === 'simplify'
      ? `HLOD spike, step 1 (simplify), against ${baseUrl} (${launched.label}): ${args.scenes.join(', ')}; ${args.variants.join(', ')}; ${args.runs} run(s)`
      : args.step === 'frames'
        ? `HLOD spike, step 2 (frames), against ${baseUrl} (${launched.label}): ${args.backends.join(', ')} × ${args.views.join(', ')} × ${args.runs} run(s), ${args.warmup} + ${args.frames} frames`
        : `HLOD spike, p377 draws, against ${baseUrl} (${launched.label}): ${args.field} sites; ${args.cases.join(', ')}; ${args.backends.join(', ')} × ${args.views.join(', ')} × ${args.runs} run(s), ${args.warmup} + ${args.frames} frames, ${args.rebuilds} rebuilds`
  );
  out(`${DIM}Watch it: cd ${ROOT} && ${watch}${RESET}\n`);

  let lines: string[] = [];
  let results: unknown;
  try {
    if (args.step === 'simplify') {
      const simplified = await runSimplifyStepAsync(launched.browser, baseUrl, args);
      results = simplified;
      lines = simplified.flatMap((result) => formatSimplify(result, args));
    } else if (args.step === 'draws') {
      const drawsArgs = toDrawsArgs(args);
      const draws = await runDrawsStepAsync(launched.browser, baseUrl, drawsArgs);
      results = draws;
      lines = formatDraws(draws, drawsArgs);
      fs.writeFileSync(
        path.join(getDrawsDir(args.field), 'results.json'),
        `${JSON.stringify({ args, results }, null, 2)}\n`
      );
    } else {
      const framesArgs = toFramesArgs(args);
      const frames = await runFramesStepAsync(launched.browser, baseUrl, framesArgs);
      results = frames;
      lines = formatFrames(frames, framesArgs);
    }
  } finally {
    await launched.closeAsync().catch(() => undefined);
    await server?.server.close();
  }
  for (const line of lines) out(line);
  if (args.json) {
    fs.writeFileSync(args.json, `${JSON.stringify({ args, results }, null, 2)}\n`);
    out(`\n${DIM}Results: ${args.json}${RESET}`);
  }
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err: Error) => fail(`The bench stopped: ${err.stack ?? err.message}`));
}
