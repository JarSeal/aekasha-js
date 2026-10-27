/**
 * The UI check (`yarn verify:ui`, p803 D11): opens the Hub's component library page in Chromium
 * and runs axe-core over each demo box's states, in both themes and both densities, failing on a
 * violation `ui.config.ts` doesn't allow:
 *
 *   yarn verify:ui [--url <hub url>] [--no-build] [--only <piece>[,<piece>…]] [--update] [--headed]
 *
 * - The states of a box (`uiChecks.ts`' `getDemoStates`): the box as the page shows it, each of
 *   its Hub buttons, and the states the checks table (`hub/_assets/ts/_componentChecks.ts`, next
 *   to the demos) opens with more steps. Each runs on its own page load per setting (four at a
 *   time, a browser context per setting), so no state leaks into the next.
 * - A setting is the Hub's theme (its toggle's saved value, and the colour scheme emulated) and
 *   the page's own theme and density switches, which set the HUD root's attributes.
 * - Before the steps the box is offset to whole pixels (`uiPage.ts`' `alignBoxAsync`), so an
 *   overlay anchored to it doesn't move by a fraction when the page above it changes. After the
 *   steps, it waits for the page to settle (no animation running, the HUD root's boxes the same on
 *   two polls; an infinite animation paused at the box's `pauseAt`), then runs axe-core (`UI_AXE_TAGS`) over the box and the HUD root,
 *   where the demos' overlays open. A console or page error fails the state too.
 * - Then each keyboard script of the table, on its own page load per setting (`uiPage.ts`'
 *   `runKeyStepsAsync`): its clicks, focus moves and keys, each expectation polled for up to 3 s
 *   (the script stops at the first one that doesn't come), and after every key the focused
 *   element showing an outline (its computed `outline-style` not `none`).
 * - `--only` runs the named pieces (the boxes' `data-hub-demo` keys). An allowance for a piece
 *   that ran and matched nothing is listed at the end: it can go.
 *
 * It checks the public component library page (`features/ui-kit/library/`) as the public Hub
 * ships it (p803 Phase 8): it builds the Hub into `.cache/verify/ui/hub/` (`yarn hub:build
 * --no-api --no-embed`: the page needs neither; `dist-hub/` stays as it is) and serves it with
 * `hub:preview`'s server on a free port. `--no-build` serves the last run's build as it is, and
 * `--url` names another Hub's root instead (a running dev server's `http://localhost:8080/hub/`).
 * Every line also goes to `.cache/verify/progress.log`. Exits 1 on a failed state, 2 on an error.
 */
import { spawn } from 'child_process';
import fs from 'fs';
import type { AddressInfo } from 'net';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import { UI_DEMO_CHECKS, type UiKeyScript } from '../../hub/_assets/ts/_componentChecks';
import { launchChromium } from './browser';
import { createHubPreviewServer } from '../hub/previewServer';
import {
  alignBoxAsync,
  BOX_BUTTON,
  boxSelector,
  captureStateAsync,
  runKeyStepsAsync,
  takeStepsAsync,
} from './uiPage';
import { checkSnapshotAsync, startSnapshotRun, UI_LAST_RUN_DIR } from './uiSnapshots';
import { ROOT } from '../paths';
import { UI_ALLOWED_VIOLATIONS, UI_AXE_TAGS } from './ui.config';
import {
  findAllowance,
  findStaleAllowances,
  formatSetting,
  getDemoStates,
  getSnapshotFile,
  groupProblems,
  groupViolations,
  parseUiArgs,
  UI_PAGE_PATH,
  UI_SETTINGS,
  type UiArgs,
  type UiSetting,
  type UiState,
  type UiViolation,
} from './uiChecks';
import { out, PROGRESS_LOG_WATCH } from '../progressLog';

const color = (code: string) => (process.env.NO_COLOR ? '' : `\x1b[${code}m`);
const RED = color('31');
const GREEN = color('32');
const YELLOW = color('33');
const DIM = color('2');
const RESET = color('0');

const VIEWPORT = { width: 1440, height: 900 };
/** The first load waits for the dev Hub's lazy first build */
const FIRST_LOAD_TIMEOUT_MS = 120_000;
const LOAD_TIMEOUT_MS = 30_000;
/** How long a state may take to settle before it's checked as it is (with a note) */
const SETTLE_TIMEOUT_MS = 5_000;
const SETTLE_POLL_MS = 100;
/**
 * Where in its duration an infinite animation is paused for the shot, unless the box's checks name
 * their own (`pauseAt`): past its start, where the indeterminate bar's slide is on the track
 * (p804 D13: at 0 it was still off its left edge)
 */
const DEFAULT_PAUSE_AT = 0.4;
/** The Hub's theme toggle's saved value (`hub.ts`), read before the first paint */
const HUB_THEME_KEY = 'aekHubTheme';
/** The targets printed per violation; the rest counted */
const MAX_TARGETS = 3;

/** Prints the message and exits 2 */
function fail(msg: string): never {
  out(`${RED}${msg}${RESET}`, true);
  process.exit(2);
}

/** axe-core's browser build, read on the first use */
let axeSource = '';
const getAxeSource = () =>
  (axeSource ||= fs.readFileSync(
    createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
    'utf8'
  ));

/** The page's demos mounted: the HUD root made and the boxes filled */
const waitForDemosAsync = (page: Page, timeout: number) =>
  page.waitForFunction(
    () => !!document.querySelector('#hudRoot') && !!document.querySelector('[data-hub-demo] *'),
    null,
    { timeout }
  );

/** Each box's key and its Hub buttons' texts, in the page's order */
const readBoxesAsync = async (page: Page, url: string) => {
  await page.goto(url, { timeout: FIRST_LOAD_TIMEOUT_MS });
  await waitForDemosAsync(page, FIRST_LOAD_TIMEOUT_MS);
  return page.evaluate(
    (selector) =>
      [...document.querySelectorAll<HTMLElement>('[data-hub-demo]')].map((box) => ({
        piece: box.dataset.hubDemo ?? '',
        buttons: [...box.querySelectorAll(selector)].map((b) => (b.textContent ?? '').trim()),
      })),
    BOX_BUTTON
  );
};

const createSettingContextAsync = async (browser: Browser, setting: UiSetting) => {
  const context = await browser.newContext({ viewport: VIEWPORT, colorScheme: setting.theme });
  await context.addInitScript(
    ({ key, theme }) => {
      try {
        localStorage.setItem(key, theme);
      } catch {
        // The page then follows the emulated colour scheme
      }
    },
    { key: HUB_THEME_KEY, theme: setting.theme }
  );
  return context;
};

/**
 * Waits for no running animation and the HUD root's boxes the same on two polls; false on a
 * timeout. An infinite animation (a spinner) never ends: it's paused at `pauseAt` of its duration
 * (after its delay), which also makes its shot the same on every run.
 */
const settleAsync = async (page: Page, pauseAt: number) => {
  const end = Date.now() + SETTLE_TIMEOUT_MS;
  let last = '';
  while (Date.now() < end) {
    // No named function in the page: tsx wraps those in a helper the page doesn't have
    const now = await page.evaluate((fraction) => {
      const animations = document.getAnimations();
      for (const a of animations) {
        if (a.playState !== 'running' || a.effect?.getTiming().iterations !== Infinity) continue;
        const timing = a.effect.getComputedTiming();
        a.pause();
        a.currentTime = (timing.delay ?? 0) + Number(timing.duration) * fraction;
      }
      const running = animations.some((a) => a.playState === 'running');
      const boxes = [...document.querySelectorAll('#hudRoot *')].map((el) => {
        const r = el.getBoundingClientRect();
        return `${r.x},${r.y},${r.width},${r.height}`;
      });
      return running ? null : boxes.join(';');
    }, pauseAt);
    if (now !== null && now === last) return true;
    last = now ?? '';
    await page.waitForTimeout(SETTLE_POLL_MS);
  }
  return false;
};

type SettingRun = {
  setting: string;
  violations: UiViolation[];
  problems: string[];
  notes: string[];
};

/** What every state and script of a run shares: a browser context per setting, the page, `--update` */
type RunEnv = { contexts: BrowserContext[]; url: string; isUpdate: boolean };

/**
 * A fresh page load of the demos in a setting, running `steps` on it; the console's and the
 * page's errors and a throw are the run's problems
 */
const withDemoPageAsync = async (
  context: BrowserContext,
  url: string,
  setting: UiSetting,
  steps: (page: Page, problems: string[]) => Promise<void>
) => {
  const problems: string[] = [];
  const page = await context.newPage();
  page.setDefaultTimeout(LOAD_TIMEOUT_MS);
  page.on('console', (msg) => msg.type() === 'error' && problems.push(`console: ${msg.text()}`));
  page.on('pageerror', (err) => problems.push(`page error: ${err.message}`));
  try {
    await page.goto(url);
    await waitForDemosAsync(page, LOAD_TIMEOUT_MS);
    await page.check(`input[name="theme"][value="${setting.theme}"]`);
    await page.check(`input[name="density"][value="${setting.density}"]`);
    await steps(page, problems);
  } catch (err) {
    problems.push(`stopped: ${(err as Error).message.split('\n')[0]}`);
  } finally {
    await page.close();
  }
  return problems;
};

/**
 * One state in one setting: its steps, the settle, its screenshot against the baseline (or
 * recorded), then axe over the box and the HUD root
 */
const runStateAsync = async (
  env: RunEnv,
  index: number,
  piece: string,
  state: UiState
): Promise<SettingRun> => {
  const setting = UI_SETTINGS[index];
  let violations: UiViolation[] = [];
  const notes: string[] = [];
  const problems = await withDemoPageAsync(
    env.contexts[index],
    env.url,
    setting,
    async (page, problems) => {
      await alignBoxAsync(page, piece);
      await takeStepsAsync(page, piece, state.steps);
      // The pointer off the clicked button (its hover would change when the box is pinned for its
      // shot) to a corner no demo opens anything in, before the settle waits out the transitions
      await page.mouse.move(VIEWPORT.width - 1, VIEWPORT.height - 1);
      const pauseAt = UI_DEMO_CHECKS[piece]?.pauseAt ?? DEFAULT_PAUSE_AT;
      if (!(await settleAsync(page, pauseAt))) {
        problems.push(`not settled after ${SETTLE_TIMEOUT_MS} ms`);
      }
      const shot = await checkSnapshotAsync(
        getSnapshotFile(piece, state.name, setting),
        await captureStateAsync(page, piece),
        env.isUpdate && !problems.length
      );
      if (shot.problem) problems.push(shot.problem);
      if (shot.note) notes.push(shot.note);
      await page.addScriptTag({ content: getAxeSource() });
      violations = await page.evaluate(
        async ({ box, tags }) => {
          const result = await window.axe.run(
            { include: [[box], ['#hudRoot']] },
            { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] }
          );
          return result.violations.map((v) => ({
            rule: v.id,
            impact: v.impact ?? '',
            help: v.help,
            targets: v.nodes.map((n) => n.target.map(String).join(' ')),
          }));
        },
        { box: boxSelector(piece), tags: [...UI_AXE_TAGS] }
      );
    }
  );
  return { setting: formatSetting(setting), violations, problems, notes };
};

/** Where a problem or a violation came up: every setting, or the ones named */
const formatSettings = (settings: string[]) =>
  settings.length === UI_SETTINGS.length ? 'all settings' : settings.join(', ');

/** Prints a state's or a script's line and its problems; true when it failed */
const printRun = (name: string, runs: SettingRun[], piece: string, found: Set<string>) => {
  const lines: string[] = [];
  let isFailed = false;
  for (const { problem, settings } of groupProblems(runs)) {
    isFailed = true;
    lines.push(`${RED}${problem} (${formatSettings(settings)})${RESET}`);
  }
  const notes = groupProblems(runs.map((r) => ({ setting: r.setting, problems: r.notes })));
  for (const { problem, settings } of notes) {
    lines.push(`${DIM}${problem} (${formatSettings(settings)})${RESET}`);
  }
  for (const v of groupViolations(runs)) {
    found.add(`${v.rule}@${piece}`);
    const allowance = findAllowance(UI_ALLOWED_VIOLATIONS, v.rule, piece);
    if (!allowance) isFailed = true;
    const head = `${v.rule} (${v.impact}, ${formatSettings(v.settings)}): ${v.help}`;
    lines.push(
      allowance
        ? `${DIM}${head} (allowed until ${allowance.until})${RESET}`
        : `${RED}${head}${RESET}`
    );
    for (const target of v.targets.slice(0, MAX_TARGETS)) lines.push(`  ${DIM}${target}${RESET}`);
    if (v.targets.length > MAX_TARGETS) {
      lines.push(`  ${DIM}… ${v.targets.length - MAX_TARGETS} more${RESET}`);
    }
  }
  out(`  ${isFailed ? `${RED}✗` : `${GREEN}✓`} ${name}${RESET}`);
  for (const line of lines) out(`      ${line}`);
  return isFailed;
};

/**
 * Runs a piece's states and keyboard scripts, each in every setting at once, and prints them
 * @returns the rule@piece keys found, and how many states and scripts failed
 */
const checkPieceAsync = async (
  env: RunEnv,
  piece: string,
  states: UiState[],
  scripts: UiKeyScript[]
) => {
  const counts = `${states.length} states, ${scripts.length} keyboard scripts`;
  out(`\n${piece} ${DIM}(${counts}, × ${UI_SETTINGS.length} settings)${RESET}`);
  const found = new Set<string>();
  let failed = 0;
  for (const state of states) {
    const runs = await Promise.all(UI_SETTINGS.map((_, i) => runStateAsync(env, i, piece, state)));
    if (printRun(state.name, runs, piece, found)) failed++;
  }
  for (const script of scripts) {
    const runs = await Promise.all(
      UI_SETTINGS.map(async (setting, i) => ({
        setting: formatSetting(setting),
        violations: [],
        notes: [],
        problems: await withDemoPageAsync(
          env.contexts[i],
          env.url,
          setting,
          async (page, problems) => {
            problems.push(...(await runKeyStepsAsync(page, piece, script.steps)));
          }
        ),
      }))
    );
    if (printRun(`keys: ${script.name}`, runs, piece, found)) failed++;
  }
  return { found, failed };
};

const runAsync = async (args: UiArgs, browser: Browser, url: string) => {
  const discovery = await browser.newPage({ viewport: VIEWPORT });
  const boxes = await readBoxesAsync(discovery, url).finally(() => discovery.close());
  const pieces = boxes.map((b) => b.piece);
  for (const key of Object.keys(UI_DEMO_CHECKS)) {
    if (!pieces.includes(key)) fail(`_componentChecks.ts names ${key}, which no demo box is`);
  }
  for (const key of args.only) {
    if (!pieces.includes(key)) fail(`No demo box ${key} (the pieces: ${pieces.join(', ')})`);
  }
  const selected = boxes.filter((b) => !args.only.length || args.only.includes(b.piece));
  const contexts = await Promise.all(
    UI_SETTINGS.map((setting) => createSettingContextAsync(browser, setting))
  );
  const env: RunEnv = { contexts, url, isUpdate: args.update };
  startSnapshotRun();
  const found = new Set<string>();
  let failed = 0;
  for (const { piece, buttons } of selected) {
    const checks = UI_DEMO_CHECKS[piece];
    const states = getDemoStates(buttons, checks);
    const result = await checkPieceAsync(env, piece, states, checks?.keyboard ?? []);
    for (const key of result.found) found.add(key);
    failed += result.failed;
  }
  const stale = findStaleAllowances(
    UI_ALLOWED_VIOLATIONS,
    selected.map((b) => b.piece),
    found
  );
  for (const a of stale) {
    out(
      `${YELLOW}Allowed but not found: ${a.rule}@${a.piece} (until ${a.until}): remove it${RESET}`
    );
  }
  return failed;
};

/** The public Hub this run builds and serves (gitignored, next to the screenshots) */
const UI_HUB_DIR = path.join(ROOT, '.cache/verify/ui/hub');

/** `yarn hub:build --no-api --no-embed --out <UI_HUB_DIR>`, its lines in the progress log
 * @throws when it fails (its lines say why) */
const buildHubAsync = () =>
  new Promise<void>((resolve, reject) => {
    const tsx = path.join(ROOT, 'node_modules/.bin/tsx');
    const outDir = path.relative(ROOT, UI_HUB_DIR);
    out(`${DIM}Building the public Hub into ${outDir}/ (--no-api --no-embed)${RESET}`);
    const child = spawn(tsx, ['devTools/hubBuild.ts', '--no-api', '--no-embed', '--out', outDir], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let rest = '';
    const onData = (chunk: Buffer) => {
      const lines = (rest + chunk.toString()).split('\n');
      rest = lines.pop() ?? '';
      for (const line of lines) if (line.trim()) out(`${DIM}  ${line}${RESET}`);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', reject);
    child.on('close', (code) => {
      if (rest.trim()) out(`${DIM}  ${rest}${RESET}`);
      if (code === 0) resolve();
      else reject(new Error(`yarn hub:build failed (exit ${code}): its lines are above`));
    });
  });

/**
 * Builds the public Hub (unless `noBuild`) and serves it on a free `localhost` port
 * @throws when the build fails, or there's no build to serve
 */
const startHubAsync = async (noBuild: boolean) => {
  if (!noBuild) await buildHubAsync();
  else if (!fs.existsSync(path.join(UI_HUB_DIR, 'index.html'))) {
    throw new Error(`--no-build: no Hub build in ${path.relative(ROOT, UI_HUB_DIR)}/ yet`);
  }
  const server = createHubPreviewServer(UI_HUB_DIR, '/');
  await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve));
  return { server, url: `http://localhost:${(server.address() as AddressInfo).port}/` };
};

const main = async () => {
  let args: UiArgs;
  try {
    args = parseUiArgs(process.argv.slice(2));
  } catch (err) {
    return fail((err as Error).message);
  }
  out(`UI check${args.only.length ? `: ${args.only.join(', ')}` : ''}`);
  out(`${DIM}Watch it: ${PROGRESS_LOG_WATCH}${RESET}`);
  const started = Date.now();
  const own = args.url
    ? null
    : await startHubAsync(args.noBuild).catch((err: Error) => fail(err.message));
  const hubUrl = args.url || own!.url;
  const url = `${hubUrl}${UI_PAGE_PATH}`;
  out(`${DIM}${url}, Chromium, ${VIEWPORT.width} × ${VIEWPORT.height}${RESET}`);
  const browser = await launchChromium({ useWebGL: false, headed: args.headed });
  const close = async () => {
    await browser.close().catch(() => undefined);
    if (!own) return;
    own.server.closeAllConnections();
    await new Promise((resolve) => own.server.close(resolve));
  };
  process.once('SIGINT', () => {
    void close().then(() => process.exit(130));
  });
  let failed: number;
  try {
    failed = await runAsync(args, browser, url);
  } finally {
    await close();
  }
  const took = `${((Date.now() - started) / 1000).toFixed(1)} s`;
  out(`${DIM}This run's screenshots: ${path.relative(ROOT, UI_LAST_RUN_DIR)}/${RESET}`);
  if (failed) {
    out(`\n${RED}${failed} state(s) or script(s) failed${RESET} in ${took}`);
    process.exit(1);
  }
  out(`\n${GREEN}All UI checks passed${RESET} in ${took}`);
};

declare global {
  interface Window {
    /** axe-core, injected by the run */
    axe: typeof import('axe-core');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err: Error) => fail(`The UI check stopped: ${err.message}`));
}
