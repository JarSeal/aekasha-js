/**
 * The LOD tab check (p354 Phase 2 step 3): `instanceStress`' two paths (instanced LOD pools, an
 * instance set) driven through the LOD drawer tab's own controls, as a person would, and compared
 * checkpoint by checkpoint, plus a snapshot pair at a held cross-fade.
 *
 *   npx tsx devTools/bench/instanceStressLodTab.ts [--count 20k] [--fade-seconds 0.25]
 *     [--url <server>] [--headed] [--webgl]
 *
 * Each path is a page of its own (debug env, the test bridge's fixed 1/60 s frame delta), the
 * orbit held at its start, then:
 *   1. settled: the scene's `measure()` state after the warm-up;
 *   2. the LOD tab's "Time scale (0 = hold)" at 0 (Home), then "Force level" at Level 1: every
 *      instance not at level 1 starts its fade, held at 0;
 *   3. the time scale at 0.10 (ten ArrowUps), 75 frames, then 0 (Home), dispatched inside the page
 *      around `measure(75)`, so both paths advance exactly 75 frames: every fade held at 0.5. A
 *      snapshot of each path, then compared (the scene runner's tolerance);
 *   4. the time scale at 1 (End): the fades end, every instance at level 1;
 *   5. "Force level" Off: the selection again (from level 1, so through its hysteresis);
 *   6. "Freeze" on, then 120 frames with the orbit started: the levels from step 5 hold.
 * The two paths must agree at every checkpoint (`instanceStressLodTabChecks.ts`). The server: its
 * own dev server (the scene runner's) or `--url`. Output: `.cache/bench/progress.log` too, the
 * snapshots in `.cache/bench/lodTab/`. Exits 1 on a problem.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from 'playwright-core';
import { ROOT } from '../paths';
import { out, setProgressLogFile } from '../progressLog';
import { EVALUATE_MARGIN_MS, launchVerifyChromiumAsync, withTimeout } from '../verify/browser';
import { startVerifyServerAsync } from '../verify/devServer';
import { DEFAULT_SNAPSHOT_TOLERANCE } from '../verify/scenes.config';
import { compareSnapshots } from '../verify/snapshotDiff';
import type { StressSummary } from './instanceStressBench';
import {
  type CheckpointStates,
  findCheckpointProblems,
  formatCheckpointTable,
} from './instanceStressLodTabChecks';

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

const LOG_FILE = path.join(ROOT, '.cache/bench/progress.log');
const SHOT_DIR = path.join(ROOT, '.cache/bench/lodTab');
const VIEWPORT = { width: 1600, height: 900 };
const SHOT_SIZE = { width: 1024, height: 576 };
const READY_TIMEOUT_MS = 240_000;
const LOD_TAB_ID = 'lodControls';
/** The frames step 3 runs at a time scale of 0.1: 75 × (1/60 s × 0.1) / 0.25 s = 0.5 */
const HELD_FADE_FRAMES = 75;
const SETTLE_FRAMES = 30;
const FREEZE_FRAMES = 120;

type Path = 'cpu' | 'gpu';
type Args = {
  count: number;
  fadeSeconds: number;
  url: string | null;
  headed: boolean;
  webgl: boolean;
};
type StressApi = { measure: (frames: number, startOrbit?: boolean) => Promise<StressSummary> };
type LodTabWindow = Window & { __aekInstanceStress?: StressApi };

const fail = (message: string): never => {
  out(`${RED}${message}${RESET}`, true);
  process.exit(2);
};

const parseCount = (text: string) => {
  const match = /^(\d+(?:\.\d+)?)(k|m)?$/i.exec(text.trim());
  if (!match) return NaN;
  const scale = { k: 1_000, m: 1_000_000 }[match[2]?.toLowerCase() as 'k' | 'm'] ?? 1;
  return Math.round(Number(match[1]) * scale);
};

const parseArgs = (argv: string[]): Args => {
  const args: Args = { count: 20_000, fadeSeconds: 0.25, url: null, headed: false, webgl: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--count') args.count = parseCount(argv[++i] ?? '');
    else if (arg === '--fade-seconds') args.fadeSeconds = Number(argv[++i]);
    else if (arg === '--url') args.url = argv[++i] ?? null;
    else if (arg === '--headed') args.headed = true;
    else if (arg === '--webgl') args.webgl = true;
    else fail(`Unknown option ${arg}`);
  }
  if (!(args.count > 0)) fail('--count: a positive count (eg. 20k)');
  if (!(args.fadeSeconds > 0)) fail('--fade-seconds: a positive number of seconds');
  return args;
};

const buildUrl = (baseUrl: string, args: Args, p: Path) => {
  const params = new URLSearchParams({
    isDebug: 'true',
    aekTest: 'true',
    startScene: 'instanceStress',
    stressInstances: String(args.count),
    stressPath: p,
    stressFadeSeconds: String(args.fadeSeconds),
    stressOrbitHold: 'true',
  });
  return `${baseUrl.replace(/\/$/, '')}/?${params}`;
};

/** The scene's `measure(frames)`: its state at the last of them */
const measureAsync = async (page: Page, frames: number, startOrbit = false) => {
  const summary = await withTimeout(
    page.evaluate(
      ({ n, orbit }) => (window as LodTabWindow).__aekInstanceStress!.measure(n, orbit),
      { n: frames, orbit: startOrbit }
    ),
    (frames / 20) * 1000 + EVALUATE_MARGIN_MS,
    `measure(${frames})`
  );
  if (!summary.state) throw new Error(`measure(${frames}) has no state`);
  return { levels: summary.state.levels, fading: summary.state.fading };
};

/** Focuses a control of the LOD tab by its name, through the test bridge */
const focusControlAsync = async (page: Page, name: string) => {
  const focused = await page.evaluate(
    (n) => window.__AEK_TEST__!.focusDebuggerControl({ root: 'drawer', name: n }),
    name
  );
  if (focused.status !== 'FOCUSED') {
    throw new Error(`no "${name}" control in the LOD tab (seen: ${focused.seen.join(', ')})`);
  }
};

/** Picks "Force level"'s option `index` (0 Off, then Level 0, Level 1, …) by keys */
const pickForceLevelAsync = async (page: Page, index: number) => {
  await focusControlAsync(page, 'Force level');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Home');
  for (let i = 0; i < index; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
};

const pressOnControlAsync = async (page: Page, name: string, key: string) => {
  await focusControlAsync(page, name);
  await page.keyboard.press(key);
};

const runPathAsync = async (page: Page, url: string, p: Path, states: CheckpointStates) => {
  const errors: string[] = [];
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
  if (ready.status !== 'READY') throw new Error("the scene didn't load");
  await page.waitForFunction(() => Boolean((window as LodTabWindow).__aekInstanceStress), null, {
    timeout: 60_000,
  });

  states.settled = await measureAsync(page, 60);
  const opened = await page.evaluate(
    (id) => window.__AEK_TEST__!.openDebuggerTab({ host: 'DRAWER', id }),
    LOD_TAB_ID
  );
  if (opened.status !== 'OPEN') throw new Error(`the LOD tab didn't open: ${opened.reason}`);

  // 2. Every fade starts held at 0, whatever frame the keys land in
  await pressOnControlAsync(page, 'Time scale (0 = hold)', 'Home');
  await measureAsync(page, 2);
  await pickForceLevelAsync(page, 2);
  states.heldAt0 = await measureAsync(page, 5);

  // 3. Exactly HELD_FADE_FRAMES frames at 0.1: the keys dispatched in the page around measure(),
  // which resolves after its last frame's work. No named function inside: tsx's `__name` helper
  // isn't in the page
  await focusControlAsync(page, 'Time scale (0 = hold)');
  await withTimeout(
    page.evaluate(async (frames) => {
      const elem = document.activeElement as HTMLElement;
      for (const key of [...Array<string>(10).fill('ArrowUp')]) {
        elem.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
        elem.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
      }
      await (window as LodTabWindow).__aekInstanceStress!.measure(frames);
      elem.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
      elem.dispatchEvent(new KeyboardEvent('keyup', { key: 'Home', bubbles: true }));
    }, HELD_FADE_FRAMES),
    (HELD_FADE_FRAMES / 20) * 1000 + EVALUATE_MARGIN_MS,
    'the held fade'
  );
  states.heldAtHalf = await measureAsync(page, 5);
  const shot = await withTimeout(
    page.evaluate((size) => window.__AEK_TEST__!.snapshot(size), SHOT_SIZE),
    EVALUATE_MARGIN_MS,
    'snapshot'
  );
  const shotFile = path.join(SHOT_DIR, `heldFade.${p}.png`);
  fs.writeFileSync(shotFile, Buffer.from(shot.pngBase64, 'base64'));

  // 4-5. The fades run out at level 1, then the selection again
  await pressOnControlAsync(page, 'Time scale (0 = hold)', 'End');
  states.forcedLevel1 = await measureAsync(page, SETTLE_FRAMES);
  await pickForceLevelAsync(page, 0);
  states.forceOff = await measureAsync(page, SETTLE_FRAMES);

  // 6. Frozen while the camera moves
  await pressOnControlAsync(page, 'Freeze', ' ');
  states.frozenOrbit = await measureAsync(page, FREEZE_FRAMES, true);
  return errors;
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const watch = setProgressLogFile(LOG_FILE);
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const server = args.url
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
    `The LOD tab check against ${baseUrl} (${launched.label}): ${args.count} trees, fades ${args.fadeSeconds} s`
  );
  out(`${DIM}Watch it: cd ${ROOT} && ${watch}${RESET}\n`);

  const states: Record<Path, CheckpointStates> = { cpu: {}, gpu: {} };
  const problems: string[] = [];
  try {
    for (const p of ['cpu', 'gpu'] as const) {
      const page = await launched.browser.newPage({ viewport: VIEWPORT });
      try {
        const errors = await runPathAsync(page, buildUrl(baseUrl, args, p), p, states[p]);
        for (const e of errors) problems.push(`${p}: ${e.slice(0, 300)}`);
        out(`  ${p}: ${Object.keys(states[p]).length} checkpoints`);
      } catch (err) {
        problems.push(`${p}: ${(err as Error).message}`);
      } finally {
        await withTimeout(page.close(), 30_000, 'closing the page').catch(() => undefined);
      }
    }
  } finally {
    await launched.closeAsync().catch(() => undefined);
    await server?.close();
  }

  out('');
  for (const line of formatCheckpointTable(states.cpu, states.gpu)) out(line);
  problems.push(...findCheckpointProblems(states.cpu, states.gpu));

  const poolsShot = path.join(SHOT_DIR, 'heldFade.cpu.png');
  const setShot = path.join(SHOT_DIR, 'heldFade.gpu.png');
  if (fs.existsSync(poolsShot) && fs.existsSync(setShot)) {
    const diffFile = path.join(SHOT_DIR, 'heldFade.diff.png');
    fs.rmSync(diffFile, { force: true });
    const diff = await compareSnapshots(
      fs.readFileSync(setShot),
      poolsShot,
      DEFAULT_SNAPSHOT_TOLERANCE,
      diffFile
    );
    if ('sizeMismatch' in diff) {
      problems.push(`the snapshots' sizes differ: ${diff.sizeMismatch}`);
    } else {
      const summary = `mean ${diff.meanDelta.toFixed(3)}, changed ${(diff.changedRatio * 100).toFixed(2)} %, max ${diff.maxDelta}`;
      const isOver =
        diff.meanDelta > DEFAULT_SNAPSHOT_TOLERANCE.maxMeanDelta ||
        diff.changedRatio > DEFAULT_SNAPSHOT_TOLERANCE.maxChangedRatio;
      out(`\nThe held fade, the set's snapshot against the pools': ${summary}`);
      out(`${DIM}${path.relative(ROOT, SHOT_DIR)}/heldFade.{cpu,gpu}.png${RESET}`);
      if (isOver) problems.push(`the held fade's snapshots differ (${summary}): ${diffFile}`);
    }
  }

  out('');
  if (problems.length === 0) {
    out(`${GREEN}✓ Both paths agree at every checkpoint${RESET}`);
    return;
  }
  for (const problem of problems) out(`${RED}✗ ${problem}${RESET}`);
  process.exit(1);
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err: Error) => fail(`The check stopped: ${err.stack ?? err.message}`));
}
