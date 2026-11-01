/**
 * One page load of the scene runner (`yarn verify:scenes`, `scenes.ts`): a scene in a
 * configuration, through the dev-only test bridge (`window.__AEK_TEST__`,
 * `src/_engine/debug/TestBridge.ts`), compared with its baseline (`sceneBaseline.ts`): the errors,
 * the probe and character path hashes, the snapshot and the system order, and in the `debugger`
 * configuration the debugger's (`sceneDebugger.ts`).
 */
import fs from 'fs';
import path from 'path';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import { ROOT } from '../paths';
import type {
  TestBridgeCharacterPaths,
  TestBridgeInputScript,
  TestBridgeProbeResult,
  TestBridgeSceneReady,
  TestBridgeSnapshot,
} from '../../src/_engine/debug/TestBridge';
import {
  DEFAULT_PROBE_STEPS,
  DEFAULT_SNAPSHOT_TOLERANCE,
  GLOBAL_ALLOWED_ERRORS,
  PROBE_TIMEOUT_MS,
  PROD_TEST_SETTLE_MS,
  READY_TIMEOUT_MS,
  SCENE_VERIFY_CONFIG,
  SNAPSHOT_SIZE,
  VERIFY_CONFIGS,
  type SceneVerifyConfig,
  type VerifyBrowser,
  type VerifyConfigDef,
  type VerifyConfigName,
} from './scenes.config';
import {
  type Backend,
  type BaselineContext,
  type BaselineEntry,
  type BaselineFile,
  getBaseline,
  getChromiumEntry,
  getResultPaths,
  readJSON,
  RunAbort,
  type RunResult,
  runKey,
  snapshotFileName,
} from './sceneBaseline';
import { appliesTo, buildSceneUrl } from './sceneSelect';
import { EVALUATE_MARGIN_MS, withTimeout } from './browser';
import { runDebuggerChecksAsync } from './sceneDebugger';
import { compareSnapshots } from './snapshotDiff';
import { diffSystemOrders } from './systemOrder';

/** The scenes' input scripts (`SceneVerifyConfig.inputScript`), by name */
const INPUTS_DIR = path.join(ROOT, 'devTools/verify/inputs');
/** `DEBUG_PHYSICS_API_BOOT_LS_KEY` (kernel/config/Config.ts, which reads `window` at load: not importable here) */
const PHYSICS_BOOT_LS_KEY = 'AEK_debugPhysicsApiBoot';
const VIEWPORT = { width: 1024, height: 576 };
const BRIDGE_INSTALL_TIMEOUT_MS = 120_000;

/** What every page load of a run shares */
export type LoadContext = BaselineContext & {
  browser: Browser;
  browserName: VerifyBrowser;
  baseUrl: string;
  useWebGL: boolean;
  /** What the first page rendered on (WebGPU falls back to WebGL2 where it isn't available) */
  backend: Backend | null;
};

/** Whether an error is allowed for a scene (`GLOBAL_ALLOWED_ERRORS`, the scene's own) */
export const isAllowed = (sceneId: string, message: string, browser: VerifyBrowser) =>
  [...GLOBAL_ALLOWED_ERRORS, ...(SCENE_VERIFY_CONFIG[sceneId]?.allowedErrors ?? [])].some(
    (a) => appliesTo(a, null, browser) && a.pattern.test(message)
  );

/**
 * A scene's input script, `devTools/verify/inputs/<name>.json`. A missing or invalid one throws:
 * that scene's failure, not an exit mid-run (V2: the run wasn't written, the browser not closed)
 */
const readInputScript = (name: string): TestBridgeInputScript => {
  const file = path.join(INPUTS_DIR, `${name}.json`);
  const script = readJSON<TestBridgeInputScript>(file);
  if (!script) {
    throw new Error(`the input script ${path.relative(ROOT, file)} is missing or not JSON`);
  }
  return script;
};

/** A hash of the run against its baseline's, the probe's or the characters' paths
 * (`unstableHash` applies to both); `source` names whose baseline it is (Firefox compares with
 * Chromium's) */
const compareRunHash = (
  which: 'probe' | 'path',
  entry: BaselineEntry | undefined,
  result: RunResult,
  browser: VerifyBrowser,
  source?: string
) => {
  const [hash, steps, baseHash, baseSteps, label] =
    which === 'probe'
      ? [result.hash, result.steps, entry?.hash, entry?.steps, 'probe hash']
      : [
          result.pathHash,
          result.pathSteps,
          entry?.pathHash,
          entry?.pathSteps,
          'character path hash',
        ];
  const noun = which === 'probe' ? 'hash' : 'path hash';
  const of = source ? ` (${source.trim()})` : '';
  if (!baseHash) {
    result.notes.push(`no baseline ${noun}${of}`);
    return;
  }
  if (baseSteps !== steps) {
    result.notes.push(`no baseline ${noun} at ${steps} steps${of} (baseline: ${baseSteps})`);
    return;
  }
  if (baseHash === hash) return;
  const msg = `${label} ${hash}, baseline ${baseHash} (${source ? `${source}, ` : ''}${entry!.commit})`;
  const unstable = SCENE_VERIFY_CONFIG[result.sceneId]?.unstableHash;
  if (unstable && appliesTo(unstable, result.config, browser)) {
    result.warnings.push(`${msg}: ${unstable.reason}`);
  } else {
    result.failures.push(msg);
  }
};

/** Compares a hash with the run's own baseline, or for Firefox with Chromium's */
const compareWithBaseline = (
  ctx: LoadContext,
  which: 'probe' | 'path',
  baseline: BaselineFile,
  result: RunResult
) => {
  const key = runKey(result.sceneId, result.config);
  if (ctx.browserName === 'firefox') {
    const chromium = getChromiumEntry(ctx, key);
    compareRunHash(
      which,
      chromium?.entry,
      result,
      ctx.browserName,
      `Chromium ${chromium?.backend ?? ''}`
    );
  } else if (!ctx.isRecording) {
    compareRunHash(which, baseline.entries[key], result, ctx.browserName);
  }
};

const compareSystemOrder = (entry: BaselineEntry | undefined, result: RunResult) => {
  if (!entry?.systemOrder || !result.systemOrder) {
    result.notes.push('no baseline system order');
    return;
  }
  for (const diff of diffSystemOrders(entry.systemOrder, result.systemOrder)) {
    result.failures.push(`system order ${diff} (baseline ${entry.commit})`);
  }
};

/** Writes the snapshot into the last run's folder and, unless recording (`baseline` null),
 * compares it with the baseline's within the scene's tolerance */
const handleSnapshot = async (
  backend: Backend,
  baseline: BaselineFile | null,
  result: RunResult,
  png: Buffer,
  cacheDir?: string
) => {
  const paths = getResultPaths(backend, cacheDir);
  const fileName = snapshotFileName(result.sceneId, result.config);
  fs.mkdirSync(paths.lastRunDir, { recursive: true });
  const currentFile = path.join(paths.lastRunDir, fileName);
  const diffFile = currentFile.replace(/\.png$/, '.diff.png');
  fs.writeFileSync(currentFile, png);
  fs.rmSync(diffFile, { force: true });
  result.snapshotFile = fileName;
  if (!baseline) return; // Recording: the image only

  const entry = baseline.entries[runKey(result.sceneId, result.config)];
  const baselineFile = entry?.snapshot ? path.join(paths.baselineDir, entry.snapshot) : null;
  if (!baselineFile || !fs.existsSync(baselineFile)) {
    result.notes.push('no baseline snapshot');
    return;
  }
  const sceneSnapshot = SCENE_VERIFY_CONFIG[result.sceneId]?.snapshot;
  const tolerance = {
    ...DEFAULT_SNAPSHOT_TOLERANCE,
    ...(sceneSnapshot && 'tolerance' in sceneSnapshot ? sceneSnapshot.tolerance : {}),
  };
  const diff = await compareSnapshots(png, baselineFile, tolerance, diffFile);
  if ('sizeMismatch' in diff) {
    result.failures.push(`snapshot size ${diff.sizeMismatch}`);
    return;
  }
  const summary = `mean ${diff.meanDelta.toFixed(3)}, changed ${(diff.changedRatio * 100).toFixed(2)} %, max ${diff.maxDelta}`;
  if (diff.meanDelta > tolerance.maxMeanDelta || diff.changedRatio > tolerance.maxChangedRatio) {
    result.failures.push(`snapshot differs (${summary}): ${path.relative(ROOT, diffFile)}`);
  } else if (diff.maxDelta > 0) {
    result.notes.push(`snapshot within tolerance (${summary})`);
  }
};

/** A fresh browser context with the run's init script (no GPU for WebGL2, the physics boot, the
 * input script) and a page whose console errors, warnings and page errors go into the result */
const openPage = async (
  ctx: LoadContext,
  def: VerifyConfigDef,
  sceneConfig: SceneVerifyConfig,
  result: RunResult
) => {
  const input = sceneConfig.inputScript ? readInputScript(sceneConfig.inputScript) : null;
  const context: BrowserContext = await ctx.browser.newContext({ viewport: VIEWPORT });
  await context.addInitScript(
    ({ hideGPU, bootKey, boot, input }) => {
      if (hideGPU) delete (Object.getPrototypeOf(navigator) as { gpu?: unknown }).gpu;
      if (boot) localStorage.setItem(bootKey, JSON.stringify(boot));
      if (input) window.__AEK_TEST_INPUT__ = input;
    },
    { hideGPU: ctx.useWebGL, bootKey: PHYSICS_BOOT_LS_KEY, boot: def.physicsBoot ?? null, input }
  );
  const page: Page = await context.newPage();
  const warnings = new Set<string>();
  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error') result.errors.push(`[console.error] ${text}`);
    else if (msg.type() === 'warning') warnings.add(text.slice(0, 300));
  });
  page.on('pageerror', (err) => result.errors.push(`[pageerror] ${err.message}`));
  // The main frame's navigations: more than one is a reload mid-run (Vite's dep optimizer, a file
  // change without an HMR boundary, the gatherer's reload), p619 V3. The engine never changes its
  // URL in place, so a same-document navigation doesn't count one either.
  const loads = { count: 0 };
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) loads.count++;
  });
  return { context, page, warnings, loads };
};

/** Loads the scene's page and waits for the bridge and the scene; the backend it rendered on, or
 * null after a failure (in the result) */
const loadScene = async (
  ctx: LoadContext,
  page: Page,
  def: VerifyConfigDef,
  steps: number,
  result: RunResult
): Promise<Backend | null> => {
  await page.goto(buildSceneUrl(ctx.baseUrl, result.sceneId, def, steps), {
    waitUntil: 'domcontentloaded',
  });
  const hasBridge = await page
    .waitForFunction(() => Boolean(window.__AEK_TEST__), null, {
      timeout: BRIDGE_INSTALL_TIMEOUT_MS,
    })
    .then(() => true)
    .catch(() => false);
  if (!hasBridge) {
    result.failures.push(
      "the test bridge never installed (the engine didn't boot, or the server isn't a development or test build)"
    );
    return null;
  }
  const ready: TestBridgeSceneReady = await withTimeout(
    page.evaluate(
      (timeoutMs) => window.__AEK_TEST__!.whenSceneReady({ timeoutMs }),
      READY_TIMEOUT_MS
    ),
    READY_TIMEOUT_MS + EVALUATE_MARGIN_MS,
    'whenSceneReady'
  );
  if (ready.status !== 'READY') {
    result.failures.push(`the scene didn't finish loading in ${READY_TIMEOUT_MS / 1000} s`);
    return null;
  }
  if (ready.sceneId !== result.sceneId) {
    result.failures.push(`loaded "${ready.sceneId}" instead (startScene fell back)`);
    return null;
  }
  const backend: Backend = ready.backend === 'WEBGPU' ? 'webgpu' : 'webgl';
  ctx.backend ??= backend;
  if (backend !== ctx.backend) {
    result.failures.push(`rendered on ${backend}, the run's other pages on ${ctx.backend}`);
    return null;
  }
  return backend;
};

/** The debug configurations' checks: the probe's hash and configuration, the characters' paths
 * (`MAIN_THREAD` only) and the snapshot */
const runProbe = async (
  ctx: LoadContext,
  page: Page,
  backend: Backend,
  baseline: BaselineFile,
  def: VerifyConfigDef,
  sceneConfig: SceneVerifyConfig,
  steps: number,
  result: RunResult
) => {
  const probe: TestBridgeProbeResult = await withTimeout(
    page.evaluate(
      (timeoutMs) => window.__AEK_TEST__!.whenProbeDone({ timeoutMs, freeze: true }),
      PROBE_TIMEOUT_MS
    ),
    PROBE_TIMEOUT_MS + EVALUATE_MARGIN_MS,
    'whenProbeDone'
  );
  if (probe.status !== 'DONE') {
    result.failures.push(
      probe.status === 'NOT_ARMED'
        ? 'the physics probe is not armed'
        : `the physics probe didn't reach step ${steps} in ${PROBE_TIMEOUT_MS / 1000} s`
    );
    return;
  }
  result.hash = probe.hash;
  result.steps = probe.steps;
  result.probeConfig = probe.config;
  if (def.expectProbeConfig && !probe.config.startsWith(def.expectProbeConfig)) {
    result.failures.push(
      `ran as "${probe.config}", expected "${def.expectProbeConfig}…" (the configuration didn't apply)`
    );
  }
  compareWithBaseline(ctx, 'probe', baseline, result);
  const paths: TestBridgeCharacterPaths = await withTimeout(
    page.evaluate(() => window.__AEK_TEST__!.getCharacterPaths()),
    EVALUATE_MARGIN_MS,
    'getCharacterPaths'
  );
  // MAIN_THREAD only: in the worker targets the recorder reads the latched snapshot, whose step
  // depends on the frame timing (p610 D1, p428)
  if (paths.status === 'DONE' && probe.config.startsWith('MAIN_THREAD')) {
    result.pathHash = paths.hash;
    result.pathSteps = paths.steps;
    if (sceneConfig.inputScript) {
      const states = Object.entries(paths.states).map(([id, s]) => `${id} ${s.join('/')}`);
      result.notes.push(`character paths ${paths.hash}: ${states.join(', ')}`);
    }
    compareWithBaseline(ctx, 'path', baseline, result);
  }
  if (probe.characterCount && !result.pathHash && !sceneConfig.unstableHash) {
    result.notes.push(`${probe.characterCount} character(s), not in the probe hash`);
  }

  if (ctx.browserName === 'firefox') {
    // Hashes only: Firefox rasterizes differently, and has no baseline of its own
  } else if (sceneConfig.snapshot && 'skip' in sceneConfig.snapshot) {
    result.notes.push(`snapshot skipped: ${sceneConfig.snapshot.reason}`);
  } else {
    const shot: TestBridgeSnapshot = await withTimeout(
      page.evaluate((size) => window.__AEK_TEST__!.snapshot(size), SNAPSHOT_SIZE),
      EVALUATE_MARGIN_MS,
      'snapshot'
    );
    await handleSnapshot(
      backend,
      ctx.isRecording ? null : baseline,
      result,
      Buffer.from(shot.pngBase64, 'base64'),
      ctx.cacheDir
    );
  }
};

/** Playwright's error for a page call the page's navigation cut off */
const NAVIGATION_ERROR = /Execution context was destroyed|because of a navigation/;

/** The note on a run that ran again because its page reloaded the first time */
export const RELOAD_RERUN_NOTE =
  "the page reloaded mid-run (see the progress log's [vite] lines): run again in a fresh context";

/** One attempt at a run; `isReloaded` when the page loaded more than once */
const runAttempt = async (
  ctx: LoadContext,
  sceneId: string,
  config: VerifyConfigName,
  isRetry: boolean
): Promise<{ result: RunResult; isReloaded: boolean }> => {
  const started = Date.now();
  const def: VerifyConfigDef = VERIFY_CONFIGS[config];
  const sceneConfig = SCENE_VERIFY_CONFIG[sceneId] ?? {};
  const steps = sceneConfig.probeSteps ?? DEFAULT_PROBE_STEPS;
  const result: RunResult = {
    sceneId,
    config,
    status: 'PASS',
    failures: [],
    warnings: [],
    notes: [],
    errors: [],
    durationMs: 0,
  };
  let loads: { count: number } | null = null;
  const finish = () => {
    const isReloaded = (loads?.count ?? 0) > 1;
    if (isRetry) {
      result.notes.unshift(RELOAD_RERUN_NOTE);
      if (isReloaded) result.failures.push('the page reloaded again mid-run, in its second run');
    }
    result.durationMs = Date.now() - started;
    if (result.failures.length) result.status = 'FAIL';
    else if (result.notes.some((n) => n.startsWith('no baseline'))) result.status = 'NEW';
    return { result, isReloaded };
  };

  if (sceneConfig.skip && appliesTo(sceneConfig.skip, config, ctx.browserName)) {
    result.status = 'SKIPPED';
    result.notes.push(sceneConfig.skip.reason);
    return finish();
  }

  let context: BrowserContext | null = null;
  try {
    const opened = await openPage(ctx, def, sceneConfig, result);
    context = opened.context;
    loads = opened.loads;
    const { page, warnings } = opened;
    const backend = await loadScene(ctx, page, def, steps, result);
    if (!backend) return finish();
    const baseline = getBaseline(ctx, backend);

    if (def.mode === 'PROD_TEST') await page.waitForTimeout(PROD_TEST_SETTLE_MS);
    else await runProbe(ctx, page, backend, baseline, def, sceneConfig, steps, result);
    // On the frozen page (p806 D14); Firefox's runs are hashes only
    if (def.debugger && sceneConfig.debugger && ctx.browserName === 'chromium') {
      await runDebuggerChecksAsync({
        page,
        backend,
        entry: baseline.entries[runKey(sceneId, config)],
        isRecording: ctx.isRecording,
        cacheDir: ctx.cacheDir,
        settings: sceneConfig.debugger,
        result,
      });
    }

    // Last: after the probe's steps (or the prod test settle), so the debug modules that register
    // systems from a lazy chunk have loaded
    if (ctx.browserName === 'chromium') {
      result.systemOrder = await withTimeout(
        page.evaluate(() => window.__AEK_TEST__!.getSystemOrder()),
        EVALUATE_MARGIN_MS,
        'getSystemOrder'
      );
      if (!ctx.isRecording) compareSystemOrder(baseline.entries[runKey(sceneId, config)], result);
    }

    result.warnings.push(...[...warnings].map((w) => `[console.warn] ${w}`));
    const unallowed = result.errors.filter((e) => !isAllowed(sceneId, e, ctx.browserName));
    if (unallowed.length) {
      result.failures.push(`${unallowed.length} error(s) not allowed in scenes.config.ts`);
    }
  } catch (err) {
    if (err instanceof RunAbort) throw err;
    const message = (err as Error).message;
    // A reload mid-call rejects it before the next document's navigation is seen
    if (loads && NAVIGATION_ERROR.test(message)) loads.count = Math.max(loads.count, 2);
    result.failures.push(`the runner stopped: ${message.split('\n')[0]}`);
  } finally {
    await context?.close().catch(() => undefined);
  }
  return finish();
};

/**
 * Runs a scene in a configuration on a fresh page and compares it with the baseline. A page that
 * reloads mid-run (its state is from two loads) runs once more in a fresh context, noted
 * ({@link RELOAD_RERUN_NOTE}); a second reload fails it.
 * @throws {@link RunAbort} when a baseline can't be read: the whole run stops
 */
export const runOne = async (
  ctx: LoadContext,
  sceneId: string,
  config: VerifyConfigName
): Promise<RunResult> => {
  const first = await runAttempt(ctx, sceneId, config, false);
  if (!first.isReloaded) return first.result;
  return (await runAttempt(ctx, sceneId, config, true)).result;
};
