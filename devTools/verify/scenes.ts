/**
 * The scene runner (`yarn verify:scenes`, p601): loads every scene of the generated data in every
 * configuration of `scenes.config.ts`, through the dev-only test bridge (`window.__AEK_TEST__`,
 * `src/_engine/debug/TestBridge.ts`), and fails on console or page errors that aren't allowed, a
 * probe hash that differs from the baseline, or a snapshot that differs beyond the tolerance.
 *
 *   yarn verify:scenes [--only <sceneId|glob>[,…]] [--config <name|set>[,…]] [--update]
 *                      [--url <url>] [--webgl] [--headed] [--browser chromium|firefox]
 *
 * Baselines are local (`.cache/verify/scenes/<backend>/`): snapshots depend on the GPU, the driver
 * and the backend. `--update` compares nothing with the baseline and records every run without
 * errors or timeouts as the new one (merged: `--only` updates only those scenes). The workflow is
 * "update on `main`, then run on the branch". Each run also records every world's system order
 * (`getSystemOrder`, last on the page) and fails on a change (`systemOrder.ts`): registration
 * order breaks ties between systems, so it moves when a registration moves.
 *
 * It starts its own dev server (port 8092 or the next free one) unless `--url` points at one.
 * Headless WebGPU can't render on WSL2, so there (and with `--webgl`) the page gets no
 * `navigator.gpu` and the engine renders on WebGL2 (SwiftShader): WebGPU-only regressions need a
 * `--headed` run on a real GPU.
 *
 * `--browser firefox` (Playwright's Firefox, `npx playwright-core install firefox`) is the
 * cross-browser determinism run: the debug configurations only, always on WebGL2, and only their
 * probe hashes, compared with Chromium's baseline for the same scene, configuration and steps
 * (the `webgl` file's entry, else the `webgpu` one's: the hash doesn't depend on the backend). No
 * snapshots (another rasterizer), no baseline of its own, so no `--update`. Its last run is in
 * `.cache/verify/scenes/firefox/`.
 *
 * This file is the CLI (the server, the browser, the loop, the printing); a page load is
 * `sceneRun.ts`', the baseline files `sceneBaseline.ts`' and the arguments and selection
 * `sceneSelect.ts`' (p619 V1).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { firefox } from 'playwright-core';
import { isWSL, launchChromium } from './browser';
import { startVerifyServerAsync } from './devServer';
import { ROOT } from '../paths';
import { readGit } from '../git';
import { SCENE_VERIFY_CONFIG, type VerifyBrowser } from './scenes.config';
import { out, PROGRESS_LOG_WATCH } from '../progressLog';
import { sha256, writeFileAtomic } from '../files';
import {
  type Backend,
  type BaselineContext,
  type BaselineFile,
  findBackendHashMismatches,
  getBaseline,
  getResultPaths,
  readJSON,
  recordBaseline,
  RunAbort,
  type RunResult,
  type RunStatus,
} from './sceneBaseline';
import { isAllowed, type LoadContext, runOne } from './sceneRun';
import { checkCrossTargetHashes, parseSceneRunArgs, selectScenes } from './sceneSelect';

const GENERATED_DATA = path.join(ROOT, 'src/generated/generatedAppData.json');

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

/** Prints the message and exits 2 */
function fail(msg: string): never {
  out(`${RED}${msg}${RESET}`, true);
  process.exit(2);
}

// --- Environment ---

/** The generated data's hash; '' when it can't be read */
const readDataHash = () => {
  try {
    return sha256(fs.readFileSync(GENERATED_DATA));
  } catch {
    return '';
  }
};

/** The commit the run is on, `+dirty` with local changes; `unknown` without git */
const getCommit = () => {
  const sha = readGit(['rev-parse', '--short', 'HEAD']);
  if (!sha) return 'unknown';
  return readGit(['status', '--porcelain']) ? `${sha}+dirty` : sha;
};

const launchBrowser = async (browser: VerifyBrowser, useWebGL: boolean, headed: boolean) => {
  if (browser === 'firefox') {
    try {
      // Playwright's own build: a system Firefox has no remote protocol Playwright can drive
      return await firefox.launch({ headless: !headed });
    } catch (err) {
      return fail(
        `Firefox didn't launch: ${(err as Error).message}\n` +
          "Install Playwright's Firefox once: npx playwright-core install firefox"
      );
    }
  }
  try {
    return await launchChromium({ useWebGL, headed });
  } catch (err) {
    return fail((err as Error).message);
  }
};

// --- Report ---

const formatDuration = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

const printResult = (r: RunResult, browser: VerifyBrowser) => {
  const colour = { PASS: GREEN, UPDATED: GREEN, NEW: YELLOW, SKIPPED: DIM, FAIL: RED }[r.status];
  const hash = r.hash ? ` ${DIM}${r.hash}${RESET}` : '';
  out(
    `${colour}${r.status.padEnd(7)}${RESET} ${r.sceneId} ${DIM}${r.config}${RESET}${hash} ${DIM}(${formatDuration(r.durationMs)})${RESET}`
  );
  for (const f of r.failures) out(`        ${RED}✗ ${f}${RESET}`);
  if (r.status === 'FAIL' || r.errors.length) {
    for (const e of r.errors) {
      const allowed = isAllowed(r.sceneId, e, browser);
      out(`        ${allowed ? DIM : RED}${allowed ? '(allowed) ' : ''}${e.slice(0, 400)}${RESET}`);
    }
  }
  for (const w of r.warnings.filter((w) => !w.startsWith('[console.warn]'))) {
    out(`        ${YELLOW}! ${w}${RESET}`);
  }
  for (const n of r.notes) out(`        ${DIM}${n}${RESET}`);
};

/** Firefox: fails without a Chromium baseline to compare with, and warns when the two Chromium
 * baselines hash a run differently (Firefox then compares with the `webgl` one, its own backend) */
const checkChromiumBaselines = (ctx: BaselineContext) => {
  const hashed = (backend: Backend) =>
    Object.values(getBaseline(ctx, backend).entries).filter((e) => e.hash).length;
  const counts = { webgl: hashed('webgl'), webgpu: hashed('webgpu') };
  if (!counts.webgl && !counts.webgpu) {
    fail(
      "--browser firefox compares with Chromium's baseline, and there's none: record one first " +
        '(yarn verify:scenes --update, on the same commit)'
    );
  }
  out(`Chromium baseline: ${counts.webgl} webgl and ${counts.webgpu} webgpu hash(es)`);
  const { shared, mismatches } = findBackendHashMismatches(ctx);
  if (mismatches.length) {
    out(
      `${YELLOW}! the webgl and webgpu baselines hash ${mismatches.length} of ${shared} shared run(s) ` +
        `differently, so the hash depends on the backend: Firefox's webgpu fallbacks aren't valid\n` +
        mismatches.map((m) => `    ${m}`).join('\n') +
        RESET
    );
  } else if (shared) {
    out(`${DIM}The webgl and webgpu baselines agree on all ${shared} run(s) both hashed${RESET}`);
  }
};

// --- Main ---

const main = async () => {
  const parsed = parseSceneRunArgs(process.argv.slice(2));
  if ('error' in parsed) fail(parsed.error);
  const { args } = parsed;
  const dataHashAtStart = readDataHash();
  const generated = readJSON<{ scenes: Record<string, unknown> }>(GENERATED_DATA);
  if (!generated) fail(`Can't read ${path.relative(ROOT, GENERATED_DATA)}: run yarn gatherAppData`);
  const selected = selectScenes(Object.keys(generated.scenes), args.only);
  if ('error' in selected) fail(selected.error);
  const sceneIds = selected.ids;
  // A scene renamed in the data would lose its settings (allowed errors, skips) without a word
  const unknown = Object.keys(SCENE_VERIFY_CONFIG).filter((id) => !(id in generated.scenes));
  if (unknown.length) {
    fail(
      `scenes.config.ts names scene(s) the data doesn't have: ${unknown.join(', ')} (renamed or removed?)`
    );
  }

  const isFirefox = args.browser === 'firefox';
  const useWebGL = isFirefox || args.webgl || (isWSL() && !args.headed);
  const requested: Backend = useWebGL ? 'webgl' : 'webgpu';
  const baselines = new Map<Backend, BaselineFile>();
  const onProblem = (problem: string) => out(`${YELLOW}${problem}${RESET}`);
  if (isFirefox) checkChromiumBaselines({ baselines, isRecording: false, onProblem });
  const own = args.url
    ? null
    : await startVerifyServerAsync().catch((err: Error) => fail(err.message));
  const baseUrl = own ? own.url : args.url!;
  const browser = await launchBrowser(args.browser, useWebGL, args.headed);
  const commit = getCommit();

  const close = async () => {
    await browser.close().catch(() => undefined);
    await own?.server.close();
  };
  process.once('SIGINT', () => {
    void close().then(() => process.exit(130));
  });

  const renderer = isFirefox
    ? `Firefox ${browser.version()}, WebGL2, hashes against Chromium's baseline`
    : requested === 'webgl'
      ? `WebGL2 (SwiftShader${args.webgl ? '' : ', WSL2'})`
      : 'WebGPU';
  out(
    `Scene runner against ${baseUrl}: ${sceneIds.length} scene(s) × ${args.configs.join(', ')}, ` +
      `${renderer}${args.update ? ', recording baselines' : ''}`
  );
  out(`${DIM}Watch it: ${PROGRESS_LOG_WATCH}${RESET}\n`);

  const ctx: LoadContext = {
    browser,
    browserName: args.browser,
    baseUrl,
    useWebGL,
    isRecording: args.update,
    baselines,
    onProblem,
    backend: null,
  };
  const results: RunResult[] = [];
  const started = Date.now();
  let aborted: string | null = null;
  try {
    for (const sceneId of sceneIds) {
      const sceneResults: RunResult[] = [];
      for (const config of args.configs) {
        const isFirstPage = !ctx.backend;
        const r = await runOne(ctx, sceneId, config);
        if (isFirstPage && ctx.backend && ctx.backend !== requested) {
          out(
            `${YELLOW}No WebGPU here: the engine fell back to WebGL2 (the webgl baseline)${RESET}`
          );
        }
        sceneResults.push(r);
        printResult(r, args.browser);
      }
      const mismatch = checkCrossTargetHashes(sceneResults);
      if (mismatch)
        out(`        ${YELLOW}! the physics targets hash differently: ${mismatch}${RESET}`);
      results.push(...sceneResults);
    }
  } catch (err) {
    if (!(err instanceof RunAbort)) throw err;
    aborted = err.message;
  } finally {
    await close();
  }

  const backend = ctx.backend ?? requested;
  if (args.update && !aborted) {
    recordBaseline({
      paths: getResultPaths(backend),
      baseline: getBaseline(ctx, backend),
      results,
      commit,
      now: new Date().toISOString(),
    });
  }
  const paths = getResultPaths(isFirefox ? 'firefox' : backend);
  writeFileAtomic(
    paths.lastRunFile,
    `${JSON.stringify({ commit, at: new Date().toISOString(), baseUrl, browser: args.browser, backend, results }, null, 2)}\n`
  );

  // A gather during the run (a save in the editor, `yarn gatherAppData`): the pages after it
  // loaded other data than the ones before (p619 V3)
  if (readDataHash() !== dataHashAtStart) {
    out(
      `\n${YELLOW}! ${path.relative(ROOT, GENERATED_DATA)} changed during the run: the pages after the gather loaded the new data${RESET}`
    );
  }
  const count = (status: RunStatus) => results.filter((r) => r.status === status).length;
  const failed = count('FAIL');
  out(
    `\n${count('PASS')} passed, ${failed} failed, ${count('NEW')} new, ${count('UPDATED')} recorded, ` +
      `${count('SKIPPED')} skipped in ${formatDuration(Date.now() - started)} ` +
      `${DIM}(${path.relative(ROOT, paths.lastRunFile)})${RESET}`
  );
  if (aborted) fail(`The run stopped: ${aborted}`);
  process.exit(failed ? 1 : 0);
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err: Error) =>
    fail(err instanceof RunAbort ? err.message : err.stack ?? err.message)
  );
}
