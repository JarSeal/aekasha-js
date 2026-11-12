/**
 * p376 Phase 0's bench (`hlodSpike.ts`): what its steps share. The page: a scene opened in the
 * debug env with the HLOD probe (`window.__aekHlod`, `src/app/shared/_dbg__hlodSpike.ts`), the
 * stats panels' GPU figure on, WebGL2 through the renderer tab's persisted "Force WebGL"; the
 * formatting helpers.
 */
import type { Page } from 'playwright-core';
import { out } from '../progressLog';
import { EVALUATE_MARGIN_MS, withTimeout } from '../verify/browser';

export const RED = '\x1b[31m';
export const YELLOW = '\x1b[33m';
export const DIM = '\x1b[2m';
export const RESET = '\x1b[0m';
export const VIEWPORT = { width: 1600, height: 900 };
const READY_TIMEOUT_MS = 180_000;

export type Backend = 'webgpu' | 'webgl';

export const fail = (message: string): never => {
  out(`${RED}${message}${RESET}`, true);
  process.exit(2);
};

/** The stats panels with the GPU figure (`AEK_debugStats`), which step 2 samples */
const STATS_SETTINGS = JSON.stringify({
  enabled: true,
  trackTFPS: true,
  trackFPS: true,
  trackCPU: true,
  trackHz: false,
  trackGPU: true,
  trackCPT: false,
  horizontal: false,
});

export const buildSceneUrl = (
  base: string,
  sceneId: string,
  extra: Record<string, string> = {}
) => {
  const params = new URLSearchParams({
    isDebug: 'true',
    aekTest: 'true',
    startScene: sceneId,
    ...extra,
  });
  return `${base.replace(/\/$/, '')}/?${params}`;
};

/**
 * Opens the scene on `backend` and waits for its load and the probe; the page's errors (and a
 * second load) go to `errors`.
 */
export const openSceneAsync = async (
  page: Page,
  url: string,
  backend: Backend,
  errors: string[]
) => {
  page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('crash', () => errors.push('[crash] the page crashed'));
  await page.addInitScript(
    ({ stats, webgl }) => {
      localStorage.setItem('AEK_debugStats', stats);
      if (webgl) localStorage.setItem('debugRenderer', JSON.stringify({ forceWebGL: true }));
      else localStorage.removeItem('debugRenderer');
    },
    { stats: STATS_SETTINGS, webgl: backend === 'webgl' }
  );
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__AEK_TEST__), null, { timeout: 60_000 });
  const ready = await withTimeout(
    page.evaluate((ms) => window.__AEK_TEST__!.whenSceneReady({ timeoutMs: ms }), READY_TIMEOUT_MS),
    READY_TIMEOUT_MS + EVALUATE_MARGIN_MS,
    'whenSceneReady'
  );
  if (ready.status !== 'READY') throw new Error(`the scene didn't load (${ready.status})`);
  await page.waitForFunction(
    () => Boolean((window as Window & { __aekHlod?: unknown }).__aekHlod),
    null,
    { timeout: 60_000 }
  );
};

/** Prints a page's first five distinct errors */
export const printErrors = (errors: string[]) => {
  for (const e of [...new Set(errors)].slice(0, 5)) out(`    ${RED}${e.slice(0, 300)}${RESET}`);
};

export const fmt = (n: number | null | undefined, digits = 2) =>
  n === null || n === undefined || Number.isNaN(n) ? 'n/a' : n.toFixed(digits);
export const int = (n: number) => Math.round(n).toLocaleString('en');
export const pct = (part: number, whole: number) =>
  whole > 0 ? `${((part / whole) * 100).toFixed(1)} %` : 'n/a';
export const med = (values: number[]) => {
  const v = values.filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : NaN;
};
