/**
 * The instance stress page's steps that the bench (`instanceStress.ts`) and the LOD tab check
 * (`instanceStressLodTab.ts`) share: waiting for the scene and its probe, and forcing the set onto
 * its CPU backend (p354 Phase 4: the LOD tab's "CPU backend (next sets)" ticked, then the scene
 * reloaded from its own tab; the debug env only).
 */
import type { Page } from 'playwright-core';
import { EVALUATE_MARGIN_MS, withTimeout } from '../verify/browser';
import type { StressSummary } from './instanceStressBench';

/** The scene's load at 1M trees takes a while on the pool path */
export const STRESS_READY_TIMEOUT_MS = 240_000;
const PROBE_TIMEOUT_MS = 60_000;
const LOD_TAB_ID = 'lodControls';
const STRESS_TAB_ID = 'instanceStressDemo';

/** The scene's window global (`_dbg__instanceStress.ts`), the parts these scripts call */
export type StressApi = {
  measure: (frames: number, startOrbit?: boolean) => Promise<StressSummary>;
};
export type StressWindow = Window & { __aekInstanceStress?: StressApi };

/** Waits for the scene's load (the test bridge's `whenSceneReady`) and its probe (its window
 * global); throws on a timeout, naming it. */
export const whenStressReadyAsync = async (page: Page) => {
  const ready = await withTimeout(
    page.evaluate(
      (ms) => window.__AEK_TEST__!.whenSceneReady({ timeoutMs: ms }),
      STRESS_READY_TIMEOUT_MS
    ),
    STRESS_READY_TIMEOUT_MS + EVALUATE_MARGIN_MS,
    'whenSceneReady'
  );
  if (ready.status !== 'READY') {
    throw new Error(`the scene didn't load in ${STRESS_READY_TIMEOUT_MS / 1000} s`);
  }
  await page
    .waitForFunction(() => Boolean((window as StressWindow).__aekInstanceStress), null, {
      timeout: PROBE_TIMEOUT_MS,
    })
    .catch(() => {
      throw new Error("the scene's probe didn't load (window.__aekInstanceStress) in 60 s");
    });
};

/** The scene's `measure(frames)`, with a timeout from its frames */
export const measureStressAsync = (page: Page, frames: number, startOrbit = false) =>
  withTimeout(
    page.evaluate(
      ({ n, orbit }) => (window as StressWindow).__aekInstanceStress!.measure(n, orbit),
      { n: frames, orbit: startOrbit }
    ),
    (frames / 20) * 1000 + EVALUATE_MARGIN_MS,
    `measure(${frames})`
  );

/** Focuses a control of the drawer's open tab by its name, through the test bridge */
export const focusDrawerControlAsync = async (page: Page, name: string) => {
  const focused = await page.evaluate(
    (n) => window.__AEK_TEST__!.focusDebuggerControl({ root: 'drawer', name: n }),
    name
  );
  if (focused.status !== 'FOCUSED') {
    throw new Error(`no "${name}" control in the drawer (seen: ${focused.seen.join(', ')})`);
  }
};

/** Focuses a control of the drawer's open tab and presses a key on it */
export const pressOnDrawerControlAsync = async (page: Page, name: string, key: string) => {
  await focusDrawerControlAsync(page, name);
  await page.keyboard.press(key);
};

/** The focused element's checkbox state, through shadow roots: null when it isn't a checkbox */
const readFocusedCheckboxAsync = (page: Page) =>
  page.evaluate(() => {
    let element: Element | null = document.activeElement;
    while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
    return element instanceof HTMLInputElement && element.type === 'checkbox'
      ? element.checked
      : null;
  });

/** Ticks a checkbox of the drawer's open tab, and checks it took: the LOD tab rebuilds its
 * Instance sets folder when a set's cameras change (the debug camera's slot freed 120 frames
 * after the load), and a key pressed on the control a rebuild just replaced is lost. So it reads
 * the control again (focused anew) and presses only while it's unticked, at most three times. */
const tickDrawerCheckboxAsync = async (page: Page, name: string) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    await focusDrawerControlAsync(page, name);
    const checked = await readFocusedCheckboxAsync(page);
    if (checked === null) throw new Error(`"${name}" isn't a checkbox`);
    if (checked) return;
    await page.keyboard.press(' ');
    // A frame for the binding and a rebuild to settle
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  }
  await focusDrawerControlAsync(page, name);
  if (!(await readFocusedCheckboxAsync(page))) throw new Error(`"${name}" didn't tick`);
};

/** Opens a drawer tab through the test bridge */
export const openDrawerTabAsync = async (page: Page, id: string) => {
  const opened = await page.evaluate(
    (tabId) => window.__AEK_TEST__!.openDebuggerTab({ host: 'DRAWER', id: tabId }),
    id
  );
  if (opened.status !== 'OPEN') throw new Error(`the ${id} tab didn't open: ${opened.reason}`);
};

/** Ticks the LOD tab's "CPU backend (next sets)" and reloads the scene from its own tab, so its
 * set is made again on the CPU backend (the debug env only); throws when it isn't. Leaves the
 * scene's tab open. */
export const forceSetCpuBackendAsync = async (page: Page) => {
  await openDrawerTabAsync(page, LOD_TAB_ID);
  await tickDrawerCheckboxAsync(page, 'CPU backend (next sets)');
  await openDrawerTabAsync(page, STRESS_TAB_ID);
  // The reload makes the scene's window global again: a new object is the reloaded scene's. Not
  // "the global gone" (its exit removes it): a small scene's reload removes and adds it between
  // two of the wait's polls, which then never sees it gone
  await page.evaluate(() => {
    const w = window as StressWindow & { __aekStressBeforeReload?: unknown };
    w.__aekStressBeforeReload = w.__aekInstanceStress;
  });
  await pressOnDrawerControlAsync(page, 'Reload the scene', 'Enter');
  await page
    .waitForFunction(
      () => {
        const w = window as StressWindow & { __aekStressBeforeReload?: unknown };
        return (
          Boolean(w.__aekInstanceStress) && w.__aekInstanceStress !== w.__aekStressBeforeReload
        );
      },
      null,
      { timeout: STRESS_READY_TIMEOUT_MS }
    )
    .catch(() => {
      throw new Error(
        `'Reload the scene' didn't reload the scene in ${STRESS_READY_TIMEOUT_MS / 1000} s`
      );
    });
  await whenStressReadyAsync(page);
  const summary = await measureStressAsync(page, 1);
  if (summary.setBackend !== 'CPU') {
    throw new Error(`the set is on the ${summary.setBackend} backend after the reload, not CPU`);
  }
};
