/**
 * The embed check (`yarn verify:embed`, p611 Phase 4): mounts each embed profile's build into a
 * plain host page (`embedHost.html`) in Chromium, as a site would, and fails when the mount
 * breaks the page or its own promises:
 *
 *   yarn verify:embed [--profile <id>] [--no-build] [--headed] [--webgl]
 *
 * - `INLINE` at `width: '50%'`, `height: '80%'` of a 640 × 360 target: the container and the
 *   canvas at 320 × 288 (and its drawing buffer), something drawn, both following when the target
 *   grows to 800 × 400; then `unmount()` leaves the target empty, and a second mount throws (one
 *   engine per page load, `mountAekasha`).
 * - `BACKGROUND`: the container and the canvas fill the viewport, drawn behind the page's content
 *   (a click on its heading reaches the heading) and without pointer events (a click in the middle
 *   reaches the page); `unmount()` leaves nothing.
 * - In both, no computed style of the host's elements (`HOST_STYLE_SELECTORS`) changes while
 *   mounted or after the unmount, and no console error or page error.
 * - The banner only: the Hub's embed example (`embedExample.html`, its regions on
 *   `hub/pages/examples/embed/`) mounts into its hero at the target's size, turns, and its pause
 *   button pauses and resumes it, without an error.
 *
 * It builds the profiles first (`yarn sbp`'s build, `dist-embed/<id>/`) unless `--no-build`,
 * serves the page and the build from its own static server (a free port on localhost: the page at `/`, the build
 * at `/aekasha/`), and runs headless on WebGPU (WebGL2 through SwiftShader with `--webgl`, and on
 * WSL2 without `--headed`). Every line also goes to `.cache/verify/progress.log`. Exits 1 on a
 * failed check, 2 on an error.
 */
import fs from 'fs';
import http from 'http';
import path from 'path';
import type { Page } from 'playwright-core';
import sbpProfiles from '../../sbp.config';
import { ROOT } from '../assetPipeline/sources';
import { getEmbedProfiles } from '../gather/output';
import { buildBundles } from '../sbp/appBuild';
import { getEmbedEntryFileName, getEmbedOutDir } from '../sbp/embedPaths';
import { isWSL, launchChromium } from './browser';
import {
  type Box,
  type StyleSnapshot,
  checkBox,
  diffComputedStyles,
  HOST_STYLE_SELECTORS,
} from './embedChecks';
import { out, PROGRESS_LOG_WATCH } from '../progressLog';

const HOST_PAGE = path.join(ROOT, 'devTools/verify/embedHost.html');
/** The Hub's embed example (its regions), which imports the banner's entry by name */
const EXAMPLE_PAGE = path.join(ROOT, 'devTools/verify/embedExample.html');
const EXAMPLE_PROFILE = 'banner';
const PAGES: Record<string, string> = { '/': HOST_PAGE, '/example.html': EXAMPLE_PAGE };
const VIEWPORT = { width: 1000, height: 700 };
/**
 * How long a check waits for the page to reach a state (a mount drawn, a resize reaching the
 * canvas): it polls, so a fast machine doesn't wait and a slow one isn't failed by a fixed delay
 * (p619 §1.4 V5)
 */
const SETTLE_TIMEOUT_MS = 10_000;
const SETTLE_POLL_MS = 50;
/** The page load and its `__embedTestReady` */
const READY_TIMEOUT_MS = 60_000;
/** How long the paused scene must not change: a window measured, not a settle */
const PAUSED_WINDOW_MS = 400;

/** Polls `isDone` until it's true or {@link SETTLE_TIMEOUT_MS} passed; the checks after it report */
const waitFor = async (isDone: () => Promise<boolean>) => {
  const end = Date.now() + SETTLE_TIMEOUT_MS;
  while (!(await isDone()) && Date.now() < end) {
    await new Promise((resolve) => setTimeout(resolve, SETTLE_POLL_MS));
  }
};

const color = (code: string) => (process.env.NO_COLOR ? '' : `\x1b[${code}m`);
const RED = color('31');
const GREEN = color('32');
const DIM = color('2');
const RESET = color('0');

const USAGE = 'yarn verify:embed [--profile <id>] [--no-build] [--headed] [--webgl]';

const fail = (msg: string): never => {
  out(`${RED}${msg}${RESET}`, true);
  process.exit(2);
};

const parseArgs = (argv: string[]) => {
  const args = { profile: '', build: true, headed: false, webgl: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--profile' && argv[i + 1]) args.profile = argv[++i];
    else if (arg === '--no-build') args.build = false;
    else if (arg === '--headed') args.headed = true;
    else if (arg === '--webgl') args.webgl = true;
    else fail(`Unknown argument: ${arg} (usage: ${USAGE})`);
  }
  return args;
};

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ktx2': 'image/ktx2',
  '.glb': 'model/gltf-binary',
};

/**
 * The host page at `/`, the example at `/example.html`, the profile's build at `/aekasha/`; the
 * favicon a 204 (no error)
 */
const startServer = (buildDir: string) =>
  new Promise<http.Server>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
      if (pathname === '/favicon.ico') return void res.writeHead(204).end();
      const buildFile = pathname.startsWith('/aekasha/')
        ? path.join(buildDir, pathname.slice('/aekasha/'.length))
        : null;
      const file = PAGES[pathname] ?? buildFile;
      if (!file || (file === buildFile && !file.startsWith(buildDir + path.sep))) {
        return void res.writeHead(404).end();
      }
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return void res.writeHead(404).end();
      res.writeHead(200, {
        'Content-Type': CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream',
      });
      fs.createReadStream(file).pipe(res);
    });
    server.once('error', reject);
    // A free port, on this machine only (a fixed one failed when taken, V5)
    server.listen(0, 'localhost', () => resolve(server));
  });

const getPort = (server: http.Server) => (server.address() as { port: number }).port;

/** A box on the page: its position too */
type PageBox = Box & { x: number; y: number };
type Boxes = {
  container: PageBox | null;
  canvas: PageBox | null;
  buffer: Box | null;
  viewport: Box;
};

/** Runs a scenario on a fresh page load (one mount per page load), printing its problems; 1 when it failed */
const runScenario = async (
  page: Page,
  url: string,
  title: string,
  steps: (ctx: { problems: string[]; styles: () => Promise<StyleSnapshot> }) => Promise<void>
) => {
  const problems: string[] = [];
  const errors: string[] = [];
  page.removeAllListeners('console');
  page.removeAllListeners('pageerror');
  page.on('console', (msg) => msg.type() === 'error' && errors.push(`console: ${msg.text()}`));
  page.on('pageerror', (err) => errors.push(`page error: ${err.message}`));
  const styles = () =>
    page.evaluate(
      (s) => window.__embedTest.styles(s),
      HOST_STYLE_SELECTORS
    ) as Promise<StyleSnapshot>;
  try {
    // In the try: a page that never gets ready is this scenario's failure (V5)
    await page.goto(url, { timeout: READY_TIMEOUT_MS });
    await page.waitForFunction(
      () => (window as { __embedTestReady?: boolean }).__embedTestReady,
      null,
      { timeout: READY_TIMEOUT_MS }
    );
    await steps({ problems, styles });
  } catch (err) {
    problems.push(`stopped: ${(err as Error).message.split('\n')[0]}`);
  }
  problems.push(...errors);
  out(`  ${problems.length ? `${RED}✗` : `${GREEN}✓`} ${title}${RESET}`);
  for (const problem of problems) out(`    ${RED}${problem}${RESET}`);
  return problems.length ? 1 : 0;
};

const expectNoStyleChange = (
  problems: string[],
  when: string,
  before: StyleSnapshot,
  after: StyleSnapshot
) => {
  const lines = diffComputedStyles(before, after);
  if (lines.length) {
    problems.push(`host styles changed ${when}:`, ...lines.slice(0, 10).map((l) => `  ${l}`));
    if (lines.length > 10) problems.push(`  … ${lines.length - 10} more`);
  }
};

const pushIf = (problems: string[], problem: string | null) => problem && problems.push(problem);

const checkProfile = async (page: Page, port: number, profileId: string, entry: string) => {
  const url = `http://localhost:${port}/?entry=${encodeURIComponent(entry)}`;
  const boxes = () => page.evaluate(() => window.__embedTest.boxes()) as Promise<Boxes>;
  out(`\nprofile ${profileId} ${DIM}(${entry})${RESET}`);
  let failed = 0;

  failed += await runScenario(
    page,
    url,
    "INLINE, width '50%', height '80%', then unmount",
    async ({ problems, styles }) => {
      const before = await styles();
      const empty = await page.locator('#inline').screenshot();
      const mounted = await page.evaluate(() =>
        window.__embedTest.mount({ target: '#inline', width: '50%', height: '80%' })
      );
      if (mounted.isFallback)
        problems.push('mounted as the fallback (no WebGPU / WebGL2, or the boot failed)');
      const at = { width: 320, height: 288 };
      await waitFor(async () => {
        const settled = await boxes();
        return (
          !checkBox('canvas', settled.canvas, at) &&
          !checkBox('buffer', settled.buffer, at) &&
          !empty.equals(await page.locator('#inline').screenshot())
        );
      });
      let b = await boxes();
      pushIf(problems, checkBox('container', b.container, at));
      pushIf(problems, checkBox('canvas', b.canvas, at));
      pushIf(problems, checkBox("canvas's drawing buffer", b.buffer, at));
      if (empty.equals(await page.locator('#inline').screenshot())) problems.push('nothing drawn');
      expectNoStyleChange(problems, 'while mounted', before, await styles());

      await page.evaluate(() => window.__embedTest.resizeTarget('#inline', '800px', '400px'));
      const grown = { width: 400, height: 320 };
      await waitFor(async () => {
        const settled = await boxes();
        return !checkBox('canvas', settled.canvas, grown) && !checkBox('b', settled.buffer, grown);
      });
      b = await boxes();
      pushIf(problems, checkBox('canvas after the target grew', b.canvas, grown));
      pushIf(problems, checkBox('drawing buffer after the target grew', b.buffer, grown));
      await page.evaluate(() => window.__embedTest.resizeTarget('#inline', '', ''));

      await page.evaluate(() => window.__embedTest.unmount());
      const left = await page.evaluate(() => window.__embedTest.leftovers());
      if (left.containers || left.canvases || left.inlineChildren) {
        problems.push(`left after unmount: ${JSON.stringify(left)}`);
      }
      expectNoStyleChange(problems, 'after unmount', before, await styles());
      const again = await page.evaluate(() => window.__embedTest.mountAgain());
      if (!again)
        problems.push('a second mount after unmount didn’t throw (one engine per page load)');
    }
  );

  failed += await runScenario(
    page,
    url,
    'BACKGROUND, then unmount',
    async ({ problems, styles }) => {
      const before = await styles();
      const empty = await page.screenshot();
      const mounted = await page.evaluate(() =>
        window.__embedTest.mount({ target: '#background', layout: 'BACKGROUND' })
      );
      if (mounted.isFallback) problems.push('mounted as the fallback');
      await waitFor(async () => !empty.equals(await page.screenshot()));
      // Behind the page's content, not under its background
      if (empty.equals(await page.screenshot())) problems.push('nothing drawn behind the page');
      const b = await boxes();
      pushIf(problems, checkBox('container', b.container, b.viewport));
      pushIf(problems, checkBox('canvas', b.canvas, b.viewport));
      if (b.container && (b.container.x !== 0 || b.container.y !== 0)) {
        problems.push(`container at ${b.container.x}, ${b.container.y}, expected 0, 0`);
      }
      const hits = await page.evaluate(() => window.__embedTest.hits());
      if (hits.h1 !== 'h1')
        problems.push(`a click on the heading reaches ${hits.h1}, not the heading`);
      if (hits.center === 'the embed') problems.push('a click in the middle reaches the embed');
      expectNoStyleChange(problems, 'while mounted', before, await styles());
      await page.evaluate(() => window.__embedTest.unmount());
      const left = await page.evaluate(() => window.__embedTest.leftovers());
      if (left.containers || left.canvases || left.backgroundChildren) {
        problems.push(`left after unmount: ${JSON.stringify(left)}`);
      }
      expectNoStyleChange(problems, 'after unmount', before, await styles());
    }
  );

  if (profileId === EXAMPLE_PROFILE) {
    failed += await runScenario(
      page,
      `http://localhost:${port}/example.html`,
      'the Hub’s example page: mounts in its hero, turns, pauses',
      async ({ problems }) => {
        const isFallback = await page.evaluate(() => window.__embedExample.isFallback);
        if (isFallback) problems.push('mounted as the fallback');
        // No named function in the page: tsx wraps those in a helper the page doesn't have
        const readSizes = () =>
          page.evaluate(() =>
            ['#heroScene', '#heroScene canvas'].map((selector) => {
              const rect = document.querySelector(selector)?.getBoundingClientRect();
              return rect ? { width: rect.width, height: rect.height } : null;
            })
          );
        await waitFor(async () => {
          const [hero, heroCanvas] = await readSizes();
          return !!hero && !checkBox('canvas', heroCanvas, hero);
        });
        const [target, canvas] = await readSizes();
        if (target) pushIf(problems, checkBox('canvas', canvas, target));
        const scene = page.locator('#heroScene');
        const first = await scene.screenshot();
        await waitFor(async () => !first.equals(await scene.screenshot()));
        if (first.equals(await scene.screenshot())) problems.push('the scene doesn’t turn');
        await page.click('#heroPause');
        if (!(await page.evaluate(() => window.__embedExample.isPaused()))) {
          problems.push('the pause button didn’t pause it');
        }
        await page.waitForTimeout(100); // The frame in flight
        const paused = await scene.screenshot();
        await page.waitForTimeout(PAUSED_WINDOW_MS);
        if (!paused.equals(await scene.screenshot())) problems.push('it turns while paused');
        await page.click('#heroPause');
        if (await page.evaluate(() => window.__embedExample.isPaused())) {
          problems.push('the button didn’t resume it');
        }
      }
    );
  }
  return failed;
};

declare global {
  interface Window {
    __embedTest: {
      styles: (selectors: string[]) => StyleSnapshot;
      mount: (opts: Record<string, unknown>) => Promise<{ isFallback: boolean }>;
      resizeTarget: (selector: string, width: string, height: string) => void;
      boxes: () => Boxes;
      hits: () => { h1: string; center: string };
      unmount: () => void;
      mountAgain: () => Promise<string | null>;
      leftovers: () => Record<string, number>;
    };
    /** `embedExample.html`'s mount */
    __embedExample: { isFallback: boolean; isPaused: () => boolean };
  }
}

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const profiles = getEmbedProfiles(sbpProfiles).filter(
    (p) => !args.profile || p.id === args.profile
  );
  if (!profiles.length) {
    fail(
      args.profile
        ? `No embed profile ${args.profile} in sbp.config.ts`
        : 'No embed profile in sbp.config.ts'
    );
  }
  out(
    `Embed check: ${profiles.map((p) => p.id).join(', ')}${args.build ? '' : ', the last builds'}`
  );
  out(`${DIM}Watch it: ${PROGRESS_LOG_WATCH}${RESET}`);
  const started = Date.now();
  if (args.build) await buildBundles({ isApp: false, embedIds: profiles.map((p) => p.id) });

  const useWebGL = args.webgl || (isWSL() && !args.headed);
  const browser = await launchChromium({ useWebGL, headed: args.headed });
  out(
    `${DIM}Chromium, ${useWebGL ? 'WebGL2 (SwiftShader)' : 'WebGPU'}, ${VIEWPORT.width} × ${VIEWPORT.height}${RESET}`
  );
  let failed = 0;
  try {
    for (const profile of profiles) {
      const buildDir = getEmbedOutDir(profile.id);
      const entry = getEmbedEntryFileName(profile);
      if (!fs.existsSync(path.join(buildDir, entry))) {
        fail(
          `No build of ${profile.id} in ${path.relative(ROOT, buildDir)}/: run without --no-build`
        );
      }
      const server = await startServer(buildDir);
      const page = await browser.newPage({ viewport: VIEWPORT });
      try {
        failed += await checkProfile(page, getPort(server), profile.id, entry);
      } finally {
        await page.close();
        await new Promise((resolve) => server.close(resolve));
      }
    }
  } finally {
    await browser.close();
  }
  const took = `${((Date.now() - started) / 1000).toFixed(1)} s`;
  if (failed) {
    out(`\n${RED}${failed} scenario(s) failed${RESET} in ${took}`);
    process.exit(1);
  }
  out(`\n${GREEN}All embed checks passed${RESET} in ${took}`);
};

main().catch((err: Error) => fail(`The embed check stopped: ${err.message}`));
