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
 * Output: `.cache/bench/progress.log` too.
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
  step: 'simplify';
  scenes: string[];
  variants: VariantName[];
  ratios: number[] | null;
  maxError: number | null;
  runs: number;
  worker: boolean;
  url: string | null;
  headed: boolean;
  json: string | null;
};

const fail = (message: string): never => {
  out(`${RED}${message}${RESET}`, true);
  process.exit(2);
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
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => argv[++i] ?? fail(`${flag} needs a value`);
    if (flag === '--step') {
      const step = value();
      if (step !== 'simplify') fail(`unknown step ${step}`);
    } else if (flag === '--scenes') args.scenes = value().split(',');
    else if (flag === '--variants') {
      args.variants = value()
        .split(',')
        .map((v) =>
          (VARIANTS as readonly string[]).includes(v)
            ? (v as VariantName)
            : fail(`unknown variant ${v}`)
        );
    } else if (flag === '--ratios') args.ratios = value().split(',').map(Number);
    else if (flag === '--max-error') args.maxError = Number(value());
    else if (flag === '--runs') args.runs = Math.max(1, Number(value()));
    else if (flag === '--no-worker') args.worker = false;
    else if (flag === '--url') args.url = value();
    else if (flag === '--headed') args.headed = true;
    else if (flag === '--json') args.json = value();
    else fail(`unknown option ${flag}`);
  }
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

const buildUrl = (base: string, sceneId: string) => {
  const params = new URLSearchParams({ isDebug: 'true', aekTest: 'true', startScene: sceneId });
  return `${base.replace(/\/$/, '')}/?${params}`;
};

/** Opens the scene and waits for its load and the probe. */
const openSceneAsync = async (page: Page, url: string, errors: string[]) => {
  page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__AEK_TEST__), null, { timeout: 60_000 });
  const ready = await withTimeout(
    page.evaluate((ms) => window.__AEK_TEST__!.whenSceneReady({ timeoutMs: ms }), READY_TIMEOUT_MS),
    READY_TIMEOUT_MS + EVALUATE_MARGIN_MS,
    'whenSceneReady'
  );
  if (ready.status !== 'READY') throw new Error(`the scene didn't load (${ready.status})`);
  await page.waitForFunction(() => Boolean((window as HlodWindow).__aekHlod), null, {
    timeout: 60_000,
  });
};

const fmt = (n: number | null | undefined, digits = 2) =>
  n === null || n === undefined || Number.isNaN(n) ? 'n/a' : n.toFixed(digits);
const int = (n: number) => Math.round(n).toLocaleString('en');
const pct = (part: number, whole: number) =>
  whole > 0 ? `${((part / whole) * 100).toFixed(1)} %` : 'n/a';

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
    `HLOD spike, step ${args.step}, against ${baseUrl} (${launched.label}): ${args.scenes.join(', ')}; ${args.variants.join(', ')}; ${args.runs} run(s)`
  );
  out(`${DIM}Watch it: cd ${ROOT} && ${watch}${RESET}\n`);

  const results: SimplifyResult[] = [];
  try {
    for (const sceneId of args.scenes) {
      const page = await launched.browser.newPage({ viewport: VIEWPORT });
      const errors: string[] = [];
      try {
        await openSceneAsync(page, buildUrl(baseUrl, sceneId), errors);
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
        for (const e of [...new Set(errors)].slice(0, 5))
          out(`    ${RED}${e.slice(0, 300)}${RESET}`);
        await withTimeout(page.close(), 30_000, 'closing the page').catch(() => undefined);
      }
    }
  } finally {
    await launched.closeAsync().catch(() => undefined);
    await server?.server.close();
  }
  for (const result of results) for (const line of formatSimplify(result, args)) out(line);
  if (args.json) {
    fs.writeFileSync(args.json, `${JSON.stringify({ args, results }, null, 2)}\n`);
    out(`\n${DIM}Results: ${args.json}${RESET}`);
  }
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err: Error) => fail(`The bench stopped: ${err.stack ?? err.message}`));
}
