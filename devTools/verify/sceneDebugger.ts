/**
 * The scene runner's `debugger` configuration (`yarn verify:scenes`, p806 D14), after the probe
 * froze the scene: through the test bridge's debugger methods
 * (`src/_engine/debug/_dbg__TestBridgeDebugger.ts`, by tab id, list row and control name, never
 * the debugger's classes) it records each tab host's tab order, opens every drawer tab, profiler
 * tab, window and dialog the scene's `debugger` settings name and the material editor's selector
 * and drawer tabs, shoots each element against its
 * baseline (`verify:ui`'s tolerance, the live figures masked), counts axe's violations on it (a
 * ratchet: a rule's count may not grow), then runs the undo / redo scripts.
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import type { Page } from 'playwright-core';
import { ROOT } from '../paths';
import type { TestBridgeDebuggerRoot, TestBridgeTabHost } from '../../src/_engine/debug/TestBridge';
import { EVALUATE_MARGIN_MS, withTimeout } from './browser';
import {
  compareAxeCounts,
  type DebuggerAxeCounts,
  debuggerShotFile,
  diffTabOrders,
  formatValue,
  isSameValue,
} from './debuggerChecks';
import { type Backend, type BaselineEntry, getResultPaths, type RunResult } from './sceneBaseline';
import {
  DEBUGGER_LIVE_MASKS,
  DEBUGGER_VIEWPORT,
  type DebuggerUndoScript,
  type DebuggerWindowOpener,
  type SceneDebuggerConfig,
} from './scenes.config';
import { compareSnapshots } from './snapshotDiff';
import { UI_AXE_TAGS, UI_SNAPSHOT_TOLERANCE } from './ui.config';

/** How long a step's DOM gets before it's read or shot: a tab's first refresh, a window's open */
const SETTLE_MS = 300;
const UNDO_KEY = 'Control+z';
const REDO_KEY = 'Control+Shift+z';

/** axe-core's browser build, read on the first use */
let axeSource = '';
const getAxeSource = () =>
  (axeSource ||= fs.readFileSync(
    createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
    'utf8'
  ));

/** One page's debugger run: where its shots go, and what it collected */
type DebuggerRun = {
  page: Page;
  sceneId: string;
  backend: Backend;
  entry: BaselineEntry | undefined;
  isRecording: boolean;
  cacheDir?: string;
  result: RunResult;
  shots: string[];
  /** The shots without a baseline file, for one note */
  newShots: string[];
  axe: DebuggerAxeCounts;
  unstableShots?: SceneDebuggerConfig['unstableShots'];
};

/** A root the bridge opened or marked */
type OpenRoot = Extract<TestBridgeDebuggerRoot, { status: 'OPEN' }>;

/** A bridge call with the runner's page call limit */
const callBridge = <T>(what: string, call: Promise<T>) =>
  withTimeout(call, EVALUATE_MARGIN_MS, what);

const openTabAsync = (page: Page, host: TestBridgeTabHost, id: string) =>
  callBridge(
    'openDebuggerTab',
    page.evaluate((opts) => window.__AEK_TEST__!.openDebuggerTab(opts), { host, id })
  );

const openListRowAsync = (page: Page, index: number) =>
  callBridge(
    'openDebuggerListRow',
    page.evaluate((i) => window.__AEK_TEST__!.openDebuggerListRow({ index: i }), index)
  );

const focusControlAsync = (page: Page, root: string | undefined, name: string, nth?: number) =>
  callBridge(
    'focusDebuggerControl',
    page.evaluate((opts) => window.__AEK_TEST__!.focusDebuggerControl(opts), { root, name, nth })
  );

/** The windows opened since the last call, after the step's settle */
const markNewWindowsAsync = async (page: Page) => {
  await page.waitForTimeout(SETTLE_MS);
  const marked = await callBridge(
    'markDebuggerWindows',
    page.evaluate(() => window.__AEK_TEST__!.markDebuggerWindows())
  );
  return marked.filter((w): w is OpenRoot => w.status === 'OPEN');
};

const closeWindowsAsync = (page: Page) =>
  callBridge(
    'closeDebuggerWindows',
    page.evaluate(() => window.__AEK_TEST__!.closeDebuggerWindows())
  );

const missingControl = (name: string, focused: { seen: string[] }) =>
  `no control "${name}" (seen: ${focused.seen.slice(0, 20).join(' | ') || 'none'})`;

/** Writes a shot to the last run's folder and compares it with its baseline file */
const compareShotAsync = async (run: DebuggerRun, name: string, png: Buffer) => {
  const file = debuggerShotFile(run.sceneId, name);
  const paths = getResultPaths(run.backend, run.cacheDir);
  const current = path.join(paths.lastRunDir, file);
  const diffFile = current.replace(/\.png$/, '.diff.png');
  fs.mkdirSync(path.dirname(current), { recursive: true });
  fs.writeFileSync(current, png);
  fs.rmSync(diffFile, { force: true });
  run.shots.push(file);
  if (run.isRecording) return;
  const baselineFile = path.join(paths.baselineDir, file);
  if (!run.entry?.debuggerShots?.includes(file) || !fs.existsSync(baselineFile)) {
    run.newShots.push(name);
    return;
  }
  const diff = await compareSnapshots(png, baselineFile, UI_SNAPSHOT_TOLERANCE, diffFile);
  const unstable = run.unstableShots?.shots.includes(name) ? run.unstableShots : null;
  const report = (msg: string) =>
    unstable
      ? run.result.warnings.push(`${msg}: ${unstable.reason}`)
      : run.result.failures.push(msg);
  if ('sizeMismatch' in diff) {
    report(`shot ${name}: size ${diff.sizeMismatch}`);
  } else if (
    diff.meanDelta > UI_SNAPSHOT_TOLERANCE.maxMeanDelta ||
    diff.changedRatio > UI_SNAPSHOT_TOLERANCE.maxChangedRatio
  ) {
    report(
      `shot ${name} differs (mean ${diff.meanDelta.toFixed(3)}, changed ${(diff.changedRatio * 100).toFixed(2)} %): ${path.relative(ROOT, diffFile)}`
    );
  }
};

/** Shoots a marked root (its live figures masked) and counts axe's violations on it */
const shootAsync = async (run: DebuggerRun, root: string, name: string) => {
  const { page } = run;
  await page.waitForTimeout(SETTLE_MS);
  const selector = `[data-aek-test-root="${root}"]`;
  const locator = page.locator(selector);
  const png = await locator.screenshot({
    animations: 'disabled',
    caret: 'hide',
    mask: DEBUGGER_LIVE_MASKS.map((mask) => locator.locator(mask)),
  });
  await compareShotAsync(run, name, png);
  const counts = await page.evaluate(
    async ({ selector, tags }) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const axeResult = await window.axe.run(element, {
        runOnly: { type: 'tag', values: tags },
        resultTypes: ['violations'],
      });
      const byRule: Record<string, number> = {};
      for (const v of axeResult.violations) byRule[v.id] = v.nodes.length;
      return byRule;
    },
    { selector, tags: [...UI_AXE_TAGS] }
  );
  if (counts) run.axe[name] = counts;
};

/** A tab host's shot prefix */
const HOST_SHOT_PREFIX: Record<TestBridgeTabHost, string> = {
  DRAWER: 'drawer',
  PROFILER: 'profiler',
  MATERIAL_EDITOR: 'materialEditor',
};

const shootTabAsync = async (run: DebuggerRun, host: TestBridgeTabHost, id: string) => {
  const opened = await openTabAsync(run.page, host, id);
  if (opened.status === 'MISSING') {
    run.result.failures.push(`${HOST_SHOT_PREFIX[host]} tab: ${opened.reason}`);
    return;
  }
  await shootAsync(run, opened.root, `${HOST_SHOT_PREFIX[host]}.${id}`);
};

/** Enters the material editor with its material loaded, shoots its selector and each tab of its
 * drawer, and goes back to the Runtime view */
const runMaterialEditorAsync = async (
  run: DebuggerRun,
  settings: NonNullable<SceneDebuggerConfig['materialEditor']>,
  tabIds: string[]
) => {
  const { page } = run;
  await closeWindowsAsync(page);
  await markNewWindowsAsync(page);
  const opened = await callBridge(
    'openMaterialEditor',
    page.evaluate((opts) => window.__AEK_TEST__!.openMaterialEditor(opts), {
      material: settings.material,
    })
  );
  try {
    if (opened.status === 'MISSING') {
      run.result.failures.push(`material editor: ${opened.reason}`);
      return;
    }
    await shootAsync(run, opened.root, 'materialEditor.selector');
    for (const id of tabIds) await shootTabAsync(run, 'MATERIAL_EDITOR', id);
  } finally {
    await callBridge(
      'closeMaterialEditor',
      page.evaluate(() => window.__AEK_TEST__!.closeMaterialEditor())
    );
  }
};

/** Opens a drawer tab, and the window its list row opens: the root its controls are in, or null
 * after a failure (`fail`) */
const openScopeAsync = async (
  run: DebuggerRun,
  steps: { tab?: string; row?: number },
  fail: (msg: string) => void
) => {
  if (!steps.tab) return { root: undefined, windows: [] as OpenRoot[] };
  const opened = await openTabAsync(run.page, 'DRAWER', steps.tab);
  if (opened.status === 'MISSING') {
    fail(opened.reason);
    return null;
  }
  if (steps.row === undefined) return { root: opened.root, windows: [] };
  const clicked = await openListRowAsync(run.page, steps.row);
  if (clicked.status === 'MISSING') {
    fail(clicked.reason);
    return null;
  }
  const windows = await markNewWindowsAsync(run.page);
  const top = windows[windows.length - 1];
  if (!top) {
    fail(`the row "${clicked.itemId}" opened no window`);
    return null;
  }
  return { root: top.root, windows };
};

/** Opens a window or dialog by the opener's steps (every window closed first) and shoots the
 * windows its last step opened */
const runOpenerAsync = async (run: DebuggerRun, opener: DebuggerWindowOpener) => {
  const fail = (msg: string) => run.result.failures.push(`window ${opener.name}: ${msg}`);
  await closeWindowsAsync(run.page);
  await markNewWindowsAsync(run.page);
  const scope = await openScopeAsync(run, opener, fail);
  if (!scope) return;
  let { root, windows } = scope;
  for (const name of opener.press ?? []) {
    const focused = await focusControlAsync(run.page, root, name);
    if (focused.status === 'MISSING') {
      fail(missingControl(name, focused));
      return;
    }
    await run.page.keyboard.press('Enter');
    windows = await markNewWindowsAsync(run.page);
    const top = windows[windows.length - 1];
    if (top) root = top.root;
  }
  const opened = windows;
  if (!opened.length) {
    fail('its steps opened no window');
    return;
  }
  for (let i = 0; i < opened.length; i++) {
    const name = opened.length > 1 ? `window.${opener.name}-${i + 1}` : `window.${opener.name}`;
    await shootAsync(run, opened[i].root, name);
  }
};

/** Reads a script's bound value and the value localStorage keeps for it */
const readScriptValuesAsync = async (page: Page, script: DebuggerUndoScript) => {
  const value: unknown = await page.evaluate(`(async () => (${script.read}))()`);
  const saved = script.ls
    ? await page.evaluate(({ key, path: keys }) => {
        let node: unknown;
        try {
          node = JSON.parse(localStorage.getItem(key) ?? 'null');
        } catch {
          return undefined;
        }
        for (const k of keys) node = (node as Record<string, unknown> | null)?.[k];
        return node;
      }, script.ls)
    : undefined;
  return { value, saved };
};

/**
 * Changes a control by keys, then undoes and redoes it (when `undoable`): the bound value must
 * change, go back and forward again, and localStorage follow it at each step
 */
const runUndoScriptAsync = async (run: DebuggerRun, script: DebuggerUndoScript) => {
  const { page } = run;
  const fail = (msg: string) => run.result.failures.push(`undo script "${script.name}": ${msg}`);
  await closeWindowsAsync(page);
  await markNewWindowsAsync(page);
  const scope = await openScopeAsync(run, script, fail);
  if (!scope) return;
  const focused = await focusControlAsync(page, scope.root, script.control, script.nth);
  if (focused.status === 'MISSING') {
    fail(missingControl(script.control, focused));
    return;
  }
  const before = await readScriptValuesAsync(page, script);
  for (const key of script.keys) await page.keyboard.press(key);
  await page.waitForTimeout(SETTLE_MS);
  const after = await readScriptValuesAsync(page, script);
  if (isSameValue(before.value, after.value)) {
    fail(`${script.keys.join(', ')} on "${script.control}" left it at ${formatValue(after.value)}`);
    return;
  }
  const checkSaved = (step: string, values: { value: unknown; saved: unknown }) => {
    if (script.ls && !isSameValue(values.saved, values.value)) {
      fail(
        `${step}: localStorage "${script.ls.key}" keeps ${formatValue(values.saved)}, the value is ${formatValue(values.value)}`
      );
    }
  };
  checkSaved('the change', after);
  if (!script.undoable) return;
  // The page's keys: a focused field keeps Ctrl+Z for its own text (DefaultDebugKeyBindings)
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const steps = [
    ['undo', UNDO_KEY, before.value],
    ['redo', REDO_KEY, after.value],
  ] as const;
  for (const [step, key, expected] of steps) {
    await page.keyboard.press(key);
    await page.waitForTimeout(SETTLE_MS);
    const now = await readScriptValuesAsync(page, script);
    if (!isSameValue(now.value, expected)) {
      fail(`${step}: the value is ${formatValue(now.value)}, expected ${formatValue(expected)}`);
    }
    checkSaved(step, now);
  }
};

/**
 * Runs the scene's `debugger` settings on its frozen page: the tab order, the shots and axe
 * counts, the undo / redo scripts; into `result` (its failures, notes and the fields the baseline
 * records)
 */
export const runDebuggerChecksAsync = async (opts: {
  page: Page;
  backend: Backend;
  entry: BaselineEntry | undefined;
  isRecording: boolean;
  cacheDir?: string;
  settings: SceneDebuggerConfig;
  result: RunResult;
}) => {
  const { page, settings, result, entry, isRecording } = opts;
  const run: DebuggerRun = {
    ...opts,
    sceneId: result.sceneId,
    shots: [],
    newShots: [],
    axe: {},
    unstableShots: settings.unstableShots,
  };
  await page.setViewportSize(DEBUGGER_VIEWPORT);
  await page.addScriptTag({ content: getAxeSource() });

  const tabOrder = await callBridge(
    'getDebuggerTabOrder',
    page.evaluate(() => window.__AEK_TEST__!.getDebuggerTabOrder())
  );
  result.tabOrder = tabOrder;
  if (!isRecording) {
    if (!entry?.tabOrder) result.notes.push('no baseline tab order');
    else {
      for (const diff of diffTabOrders(entry.tabOrder, tabOrder)) {
        result.failures.push(`tab order ${diff} (baseline ${entry.commit})`);
      }
    }
  }

  const drawerTabs = settings.tabs === 'ALL' ? tabOrder.DRAWER ?? [] : settings.tabs;
  for (const id of drawerTabs) await shootTabAsync(run, 'DRAWER', id);
  if (settings.profiler) {
    for (const id of tabOrder.PROFILER ?? []) await shootTabAsync(run, 'PROFILER', id);
  }
  for (const opener of settings.windows ?? []) await runOpenerAsync(run, opener);
  if (settings.materialEditor) {
    await runMaterialEditorAsync(run, settings.materialEditor, tabOrder.MATERIAL_EDITOR ?? []);
  }
  // Last: they change what the shots show
  for (const script of settings.undoScripts ?? []) await runUndoScriptAsync(run, script);
  await closeWindowsAsync(page);

  result.debuggerShots = run.shots;
  result.axe = run.axe;
  if (isRecording) return;
  if (run.newShots.length) {
    result.notes.push(`no baseline shot for ${run.newShots.join(', ')}`);
  }
  if (!entry?.axe) {
    result.notes.push('no baseline axe counts');
    return;
  }
  const axe = compareAxeCounts(entry.axe, run.axe);
  result.failures.push(...axe.failures);
  result.notes.push(...axe.notes);
};
