/**
 * The instance stress bench (p354 Phase 1 step 7): `instanceStress`'s paths (instanced LOD pools,
 * an instance set) measured at each count, Phase 0's tables printed.
 *
 *   npx tsx devTools/bench/instanceStress.ts [--counts 5k,20k,100k] [--paths cpu,gpu,set-cpu]
 *     [--mode debug|prodTest] [--url <server> | --build] [--shadow] [--fade-seconds <s>]
 *     [--orbit-hold] [--camera ORBIT|STILL] [--move <share>] [--warmup 120] [--frames 300]
 *     [--headed] [--webgl] [--json <file>]
 *
 * Each case is a page of its own: the test bridge's fixed frame delta puts the camera on the same
 * path every run, the scene's `measure()` (`_dbg__instanceStress.ts`) averages the probe's timing
 * over `--frames` frames after `--warmup`, and in the debug env the stats panels' GPU and CPT
 * figures (turned on through `AEK_debugStats`) are sampled meanwhile. Prod test mode has no stats
 * panels, so no GPU figures: measure a minified build's CPU side there (`yarn build:test`, then
 * `--build`), and its GPU side with `--build --mode debug` (minified, the debug env on).
 *
 * `--move 0.01` moves 1% of the set's trees each frame, one `setInstanceMatrices` call each
 * (`?stressMove=`, p354 Phase 5 step 2; the set paths only: the pools' cases ignore it).
 *
 * `set-cpu` is the set on its CPU backend on WebGPU too (p354 Phase 4): the LOD tab's "CPU backend
 * (next sets)" ticked and the scene reloaded before the warm-up (the debug env only); on WebGL2
 * (`--webgl`) `gpu`'s set is on the CPU backend anyway. The tables name what drew each case.
 *
 * The server: its own dev server (the scene runner's, `devServer.ts`), `--build` (`dist/` served
 * with the COOP / COEP headers the dev server sends), or `--url`. The pool path past about 90k
 * trees needs a larger ECS world (`VITE_ECS_MAX_ENTITIES`): its own dev server sets it; a build or
 * another server must have been started with it. Output: `.cache/bench/progress.log` too.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from 'playwright-core';
import { ROOT } from '../paths';
import { out, setProgressLogFile } from '../progressLog';
import { EVALUATE_MARGIN_MS, launchVerifyChromiumAsync, withTimeout } from '../verify/browser';
import { startVerifyServerAsync } from '../verify/devServer';
import {
  averageSamples,
  type BenchArgs,
  type BenchCase,
  type BenchResult,
  buildBenchUrl,
  formatBenchTables,
  getNeededMaxEntities,
  parseBenchArgs,
  type StressSummary,
} from './instanceStressBench';
import { forceSetCpuBackendAsync, whenStressReadyAsync } from './instanceStressPage';

const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

const DIST_DIR = path.join(ROOT, 'dist');
const LOG_FILE = path.join(ROOT, '.cache/bench/progress.log');
const VIEWPORT = { width: 1600, height: 900 };
/** The stats panels' figures change at 4 Hz */
const GPU_SAMPLE_MS = 250;

const fail = (message: string): never => {
  out(`${RED}${message}${RESET}`, true);
  process.exit(2);
};

// --- Serving a build ---

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.ktx2': 'image/ktx2',
  '.glb': 'model/gltf-binary',
};

/** `dist/` as a static host with the dev server's cross-origin isolation (SharedArrayBuffer, for
 * physics' transform buffer); `localhost` only */
const startBuildServerAsync = async () => {
  if (!fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
    fail('--build: no dist/index.html (yarn build:test first)');
  }
  const server = http.createServer((req, res) => {
    // A build asks for some files with a doubled slash (`//debugger/…`), which `new URL` would
    // read as a host: collapse the slashes, as a static host does
    const pathname = decodeURIComponent((req.url ?? '/').split('?')[0].replace(/\/{2,}/g, '/'));
    const file = path.join(DIST_DIR, pathname === '/' ? 'index.html' : pathname);
    if (!file.startsWith(DIST_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') return fail('The build server has no port');
  return {
    url: `http://localhost:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
};

// --- A case ---

/** The stats panels with the GPU and CPT figures on, before the page's first script */
const STATS_SETTINGS = JSON.stringify({
  enabled: true,
  trackTFPS: true,
  trackFPS: true,
  trackCPU: true,
  trackHz: false,
  trackGPU: true,
  trackCPT: true,
  horizontal: false,
});

type StressApi = { measure: (frames: number, startOrbit?: boolean) => Promise<StressSummary> };
type BenchWindow = Window & {
  __aekInstanceStress?: StressApi;
  __aekTestReady?: boolean;
  __benchSamples?: { gpu: number[]; compute: number[]; timer: number };
};

const runCase = async (page: Page, url: string, args: BenchArgs, c: BenchCase) => {
  const result: BenchResult = { ...c, summary: null, gpuMs: NaN, computeMs: NaN, errors: [] };
  page.on('pageerror', (err) => result.errors.push(`[pageerror] ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') result.errors.push(msg.text());
  });
  await page.addInitScript(
    ({ stats, isDebug }) => {
      if (isDebug) localStorage.setItem('AEK_debugStats', stats);
    },
    { stats: STATS_SETTINGS, isDebug: args.mode === 'debug' }
  );
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__AEK_TEST__), null, { timeout: 60_000 });
  try {
    await whenStressReadyAsync(page);
    if (c.path === 'set-cpu') await forceSetCpuBackendAsync(page);
  } catch (err) {
    result.failure = (err as Error).message;
    return result;
  }
  const measureMs = ((args.warmupFrames + args.frames) / 30) * 1000 + EVALUATE_MARGIN_MS;
  if (args.warmupFrames > 0) {
    await withTimeout(
      page.evaluate(
        (frames) => (window as BenchWindow).__aekInstanceStress!.measure(frames),
        args.warmupFrames
      ),
      measureMs,
      'the warm-up'
    );
  }
  // The stats panels' GPU and CPT figures (each averaged over a second) while the measuring runs.
  // No named function in the page's code: tsx's `__name` helper isn't there
  await page.evaluate((everyMs) => {
    const samples = { gpu: [] as number[], compute: [] as number[], timer: 0 };
    samples.timer = window.setInterval(() => {
      for (const [panel, list] of [
        ['GPU', samples.gpu],
        ['CPT', samples.compute],
      ] as const) {
        const figure = document.querySelector(`[data-panel="${panel}"] .statsLive`);
        list.push(parseFloat(figure?.textContent ?? ''));
      }
    }, everyMs);
    (window as BenchWindow).__benchSamples = samples;
  }, GPU_SAMPLE_MS);
  result.summary = await withTimeout(
    page.evaluate(
      ({ frames, startOrbit }) =>
        (window as BenchWindow).__aekInstanceStress!.measure(frames, startOrbit),
      { frames: args.frames, startOrbit: args.orbitHold }
    ),
    measureMs,
    'the measuring'
  );
  const samples = await page.evaluate(() => {
    const s = (window as BenchWindow).__benchSamples!;
    window.clearInterval(s.timer);
    return { gpu: s.gpu, compute: s.compute };
  });
  // The first second's figures still average the warm-up's frames
  const skip = Math.ceil(1000 / GPU_SAMPLE_MS);
  result.gpuMs = averageSamples(samples.gpu.slice(skip));
  result.computeMs = averageSamples(samples.compute.slice(skip));
  return result;
};

// --- Main ---

const main = async () => {
  const parsed = parseBenchArgs(process.argv.slice(2));
  if ('error' in parsed) return fail(parsed.error);
  const { args } = parsed;
  const watch = setProgressLogFile(LOG_FILE);
  const cases: BenchCase[] = args.counts.flatMap((count) =>
    args.paths.map((p) => ({ count, path: p }))
  );

  const maxEntities = getNeededMaxEntities(cases);
  if (maxEntities && !args.url && !args.build) {
    process.env.VITE_ECS_MAX_ENTITIES = String(maxEntities);
  } else if (maxEntities) {
    out(
      `${YELLOW}! The pool path past 90k trees needs VITE_ECS_MAX_ENTITIES=${maxEntities} in the server's (or the build's) environment${RESET}`
    );
  }
  const server = args.build
    ? await startBuildServerAsync()
    : args.url
      ? null
      : await startVerifyServerAsync()
          .then(({ server: s, url }) => ({ url, close: () => s.close() }))
          .catch((err: Error) => fail(err.message));
  const baseUrl = server ? server.url : args.url!;
  const launched = await launchVerifyChromiumAsync({
    webgl: args.webgl,
    headed: args.headed,
    probeUrl: baseUrl,
    onNote: (note) => out(`${YELLOW}${note}${RESET}`),
  });

  out(
    `Instance stress bench against ${baseUrl} (${args.build ? 'dist/' : args.url ? 'a server' : 'a dev server'}, ` +
      `${args.mode}, ${launched.label}): ${cases.length} case(s), ${args.warmupFrames} + ${args.frames} frames each`
  );
  out(`${DIM}Watch it: cd ${ROOT} && ${watch}${RESET}\n`);

  const results: BenchResult[] = [];
  try {
    for (const c of cases) {
      const page = await launched.browser.newPage({ viewport: VIEWPORT });
      const started = Date.now();
      let result: BenchResult;
      try {
        result = await runCase(page, buildBenchUrl(baseUrl, args, c), args, c);
      } catch (err) {
        result = {
          ...c,
          summary: null,
          gpuMs: NaN,
          computeMs: NaN,
          errors: [],
          failure: (err as Error).message,
        };
      } finally {
        await withTimeout(page.close(), 30_000, 'closing the page').catch(() => undefined);
      }
      results.push(result);
      const took = `${((Date.now() - started) / 1000).toFixed(1)} s`;
      const s = result.summary;
      out(
        result.failure
          ? `${RED}✗ ${c.count} ${c.path}: ${result.failure}${RESET}`
          : `  ${c.count} ${c.path} (${s!.path}, ${s!.backend}): CPU frame ${s!.avg.cpuMs.toFixed(2)} ms ${DIM}(${took})${RESET}`
      );
      for (const e of result.errors.slice(0, 5)) out(`    ${RED}${e.slice(0, 300)}${RESET}`);
    }
  } finally {
    await launched.closeAsync().catch(() => undefined);
    await server?.close();
  }

  out('');
  for (const line of formatBenchTables(results)) out(line);
  if (args.json) {
    fs.writeFileSync(args.json, `${JSON.stringify({ args, results }, null, 2)}\n`);
    out(`\n${DIM}Results: ${args.json}${RESET}`);
  }
  if (results.some((r) => r.failure)) process.exit(1);
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err: Error) => fail(`The bench stopped: ${err.stack ?? err.message}`));
}
