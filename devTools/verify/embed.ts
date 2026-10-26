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
 *   mounted or after the unmount (but the custom properties `tokens.css` registers, which CSS
 *   puts on every element: `readRegisteredProperties`), and no console error or page error.
 * - The banner only: the Hub's embed example (`embedExample.html`, its regions on
 *   `hub/pages/examples/embed/`) mounts into its hero at the target's size, turns, and its pause
 *   button pauses and resumes it, without an error.
 * - The uiKit profile only (p801 D9), `INLINE` in the 640 × 360 target on a host with a 16 px
 *   root and again with `html { font-size: 62.5% }`: the window, the dialog (opened from the
 *   window's button) with its backdrop, the toast, the drop-down list (opened from its trigger)
 *   and the window's tooltip (p803 D11) inside the container; the window at its px position from
 *   the container's corner, the dialog centred in it, the backdrop covering it and not the page;
 *   the window's, the toast's, the list's and the tooltip's font sizes the same at both roots, their font IBM
 *   Plex Sans (the scene opts in, p801 D8) and its face loaded; the list's last option shown
 *   where the list overflows the dialog (the top layer); Escape on the host page leaving
 *   the dialog open and Escape inside it closing it (p803 D7); with the dialog closed, a drag of
 *   the window's title moving it by the pointer's distance, and the window inside the container
 *   after the target shrinks.
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
import { ROOT } from '../paths';
import { getEmbedProfiles } from '../gather/output';
import { buildBundles } from '../sbp/appBuild';
import { getEmbedEntryFileName, getEmbedOutDir } from '../sbp/embedPaths';
import { isWSL, launchChromium } from './browser';
import {
  type Box,
  type Rect,
  type StyleSnapshot,
  checkBox,
  checkInside,
  checkPosition,
  diffComputedStyles,
  HOST_STYLE_SELECTORS,
  readRegisteredProperties,
} from './embedChecks';
import { out, PROGRESS_LOG_WATCH } from '../progressLog';

const HOST_PAGE = path.join(ROOT, 'devTools/verify/embedHost.html');
/** The UI kit's tokens, whose `@property` registrations are in every element's computed style */
const TOKENS_CSS = path.join(ROOT, 'src/_engine/ui/styles/tokens.css');
/** The Hub's embed example (its regions), which imports the banner's entry by name */
const EXAMPLE_PAGE = path.join(ROOT, 'devTools/verify/embedExample.html');
const EXAMPLE_PROFILE = 'banner';
const PAGES: Record<string, string> = { '/': HOST_PAGE, '/example.html': EXAMPLE_PAGE };
/** The profile whose scene opens one of each of the UI kit's pieces (p801 D9) */
const UI_KIT_PROFILE = 'uiKit';
/**
 * Its elements, by the ids and classes its scene gives them
 * (`src/app/profiles/uiKit/uiKitEmbed.ts`: change them there too), and the mount's container
 */
const UI_KIT = {
  container: '.aekMount',
  window: '#uiKitEmbedWindow',
  windowTitle: '#uiKitEmbedWindow .aekWindow__title',
  dialog: '#uiKitEmbedDialog',
  // Escape is pressed with the focus on its drop-down's trigger: on its close button, the button's
  // tooltip would show and take the first Escape (the innermost overlay, p803 D7)
  dialogFocus: '#uiKitEmbedDialog .aekDropDownTrigger',
  backdrop: '.uiKitEmbedBackdrop',
  // The host page's own button (embedHost.html), outside the HUD root
  hostButton: 'body > p > button',
  toast: '#uiKitEmbedToasts .aekToast',
  list: '.uiKitEmbedList',
  tooltip: '.uiKitEmbedTooltip',
  listItem: '.uiKitEmbedList li',
} as const;
/** The window's button that opens the dialog, and the dialog's drop-down trigger the list opens
 * from: the scene opens neither at load (p803 Phase 8: a page's focus would jump into the embed) */
const UI_KIT_OPEN_DIALOG = '#uiKitEmbedWindow .uiKitEmbedOpenDialog';
const UI_KIT_LIST_TRIGGER = '#uiKitEmbedDialog .aekDropDownTrigger';
/** The elements that must stay inside the container */
const UI_KIT_INSIDE = ['window', 'dialog', 'backdrop', 'toast', 'list', 'tooltip'] as const;
/** The elements whose font size must not follow the host's root */
const UI_KIT_FONTS = ['window', 'toast', 'listItem', 'tooltip'] as const;
/** The kit's font, which the profile's scene opts into (`aekasha/ui/fonts`, p801 D8) */
const UI_KIT_FONT_FAMILY = 'IBM Plex Sans';
/** The window's px position in the scene, from the container's top left corner */
const UI_KIT_WINDOW_AT = { x: 16, y: 16 };
/** The drag, which keeps the 220 × 190 window inside the 640 × 360 container */
const UI_KIT_DRAG = { x: 120, y: 60 };
/** The shrunk target, which the dragged window no longer fits at its place */
const UI_KIT_SHRUNK = { width: 320, height: 200 };
/** The host roots: the browsers' default, and a site's 62.5 % (the template's before p801) */
const UI_KIT_ROOTS = [
  { label: '16 px root', root: '' },
  { label: 'html { font-size: 62.5% }', root: '62.5%' },
];
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

/** Prints the message and exits 2 */
function fail(msg: string): never {
  out(`${RED}${msg}${RESET}`, true);
  process.exit(2);
}

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

type Boxes = {
  container: Rect | null;
  canvas: Rect | null;
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

/** The custom properties `tokens.css` registers, read on the first style check */
let registeredProperties: string[] | null = null;

const expectNoStyleChange = (
  problems: string[],
  when: string,
  before: StyleSnapshot,
  after: StyleSnapshot
) => {
  registeredProperties ??= readRegisteredProperties(fs.readFileSync(TOKENS_CSS, 'utf8'));
  const lines = diffComputedStyles(before, after, registeredProperties);
  if (lines.length) {
    problems.push(`host styles changed ${when}:`, ...lines.slice(0, 10).map((l) => `  ${l}`));
    if (lines.length > 10) problems.push(`  … ${lines.length - 10} more`);
  }
};

const pushIf = (problems: string[], problem: string | null) => problem && problems.push(problem);

type UiKitRects = Record<
  keyof typeof UI_KIT,
  (Rect & { fontSize: string; fontFamily: string }) | null
>;

/**
 * The uiKit profile's scenario at one host root (p801 D9; see the file's header), on its own page
 * load. `fonts` is the first root's font sizes, which this one's must match; null the first time.
 * @returns 1 when it failed, and this root's font sizes
 */
const checkUiKitAtRoot = async (
  page: Page,
  url: string,
  label: string,
  fonts: Record<string, string> | null
) => {
  const rects = () =>
    page.evaluate(
      (selectors) => window.__embedTest.rects(selectors),
      Object.values(UI_KIT)
    ) as Promise<Record<string, UiKitRects[keyof UiKitRects]>>;
  const read = async () => {
    const bySelector = await rects();
    return Object.fromEntries(
      Object.entries(UI_KIT).map(([name, selector]) => [name, bySelector[selector]])
    ) as UiKitRects;
  };
  const measured: Record<string, string> = {};

  const failed = await runScenario(
    page,
    url,
    `the UI kit, INLINE, ${label}`,
    async ({ problems, styles }) => {
      const before = await styles();
      // The `<style>` elements in the host's head before the mount: the kit writes none (p803 D5:
      // the toaster's settings are custom properties on its element, its styles a stylesheet)
      const headStyles = () => page.evaluate(() => document.head.querySelectorAll('style').length);
      const headStylesBefore = await headStyles();
      const mounted = await page.evaluate(() => window.__embedTest.mount({ target: '#inline' }));
      if (mounted.isFallback) problems.push('mounted as the fallback');
      // The dialog from the window's button, and its drop-down's list from its trigger
      await page.click(UI_KIT_OPEN_DIALOG, { timeout: 10_000 });
      await page.click(UI_KIT_LIST_TRIGGER, { timeout: 10_000 });
      // Every piece open, and the toast done sliding in (its box the same on two polls)
      let lastToast = '';
      await waitFor(async () => {
        const r = await read();
        const toast = JSON.stringify(r.toast);
        const isSettled = toast === lastToast;
        lastToast = toast;
        return isSettled && UI_KIT_INSIDE.every((name) => r[name]) && !!r.container;
      });
      let r = await read();
      const container = r.container;
      if (!container) {
        problems.push('no container');
        return;
      }
      for (const name of UI_KIT_INSIDE) pushIf(problems, checkInside(name, r[name], container));
      const headStylesAfter = await headStyles();
      if (headStylesAfter !== headStylesBefore) {
        problems.push(`the host's head has ${headStylesAfter - headStylesBefore} more <style>`);
      }
      pushIf(
        problems,
        checkPosition('window', r.window, {
          x: container.x + UI_KIT_WINDOW_AT.x,
          y: container.y + UI_KIT_WINDOW_AT.y,
        })
      );
      if (r.dialog) {
        pushIf(
          problems,
          checkPosition('dialog (centred)', r.dialog, {
            x: container.x + (container.width - r.dialog.width) / 2,
            y: container.y + (container.height - r.dialog.height) / 2,
          })
        );
      }
      // The list overflows the dialog (in the top layer, p803 D7): its last option isn't clipped
      const isLastOptionShown = await page.evaluate((selector) => {
        const items = document.querySelectorAll(selector);
        const last = items[items.length - 1];
        if (!last) return false;
        const box = last.getBoundingClientRect();
        return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === last;
      }, UI_KIT.listItem);
      if (!isLastOptionShown)
        problems.push('the list’s last option is hidden (clipped or covered)');
      // The container's box, not the page's
      pushIf(problems, checkPosition('backdrop', r.backdrop, container));
      pushIf(problems, checkBox('backdrop', r.backdrop, container));
      for (const name of UI_KIT_FONTS) {
        const size = r[name]?.fontSize ?? '(missing)';
        measured[name] = size;
        if (fonts && fonts[name] !== size) {
          problems.push(`${name}'s font size: ${size}, ${fonts[name]} at the first host root`);
        }
        // The kit's font, not the host's (its Georgia): the opt-in's family first
        const family = r[name]?.fontFamily ?? '(missing)';
        if (!family.replace(/["']/g, '').startsWith(`${UI_KIT_FONT_FAMILY},`)) {
          problems.push(`${name}'s font family: ${family}, not ${UI_KIT_FONT_FAMILY} first`);
        }
      }
      // ... and its face downloaded and used (font-display: swap loads it after the first paint)
      const loadedPlex = async () =>
        (await page.evaluate(() => window.__embedTest.loadedFonts())).filter((face) =>
          face.startsWith(`${UI_KIT_FONT_FAMILY} normal`)
        );
      await waitFor(async () => (await loadedPlex()).length > 0);
      if (!(await loadedPlex()).length) problems.push(`${UI_KIT_FONT_FAMILY} never loaded`);
      expectNoStyleChange(problems, 'while mounted', before, await styles());

      // Escape on the host page is the page's (p803 D7: the overlay stack listens on the HUD
      // root only), so the closeOnEscape dialog stays open
      await page.focus(UI_KIT.hostButton);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(100); // A close would be at once: nothing to poll for
      if (!(await read()).dialog) problems.push('Escape on the host page closed the dialog');

      // Escape inside the dialog closes it, so the window is no longer under its backdrop
      await page.focus(UI_KIT.dialogFocus);
      await page.keyboard.press('Escape');
      await waitFor(async () => {
        const closed = await read();
        return !closed.dialog && !closed.backdrop;
      });
      r = await read();
      if (r.dialog || r.backdrop) problems.push('Escape inside the dialog didn’t close it');

      // A drag by the title moves the window by the pointer's distance (no jump by the
      // container's offset: Phase 2's fix of a drag's start)
      const start = r.window;
      const title = r.windowTitle;
      if (start && title) {
        const from = { x: title.x + 16, y: title.y + title.height / 2 };
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(from.x + UI_KIT_DRAG.x, from.y + UI_KIT_DRAG.y, { steps: 6 });
        await page.mouse.up();
        const to = { x: start.x + UI_KIT_DRAG.x, y: start.y + UI_KIT_DRAG.y };
        await waitFor(async () => !checkPosition('window', (await read()).window, to));
        pushIf(problems, checkPosition('window after the drag', (await read()).window, to));
      } else {
        problems.push('no window title to drag');
      }

      // The windows clamp on the container's resize (the kit's ResizeObserver on its bounds,
      // onBoundsResize), and the toast follows the container's right edge
      await page.evaluate(
        (size) => window.__embedTest.resizeTarget('#inline', size.width, size.height),
        { width: `${UI_KIT_SHRUNK.width}px`, height: `${UI_KIT_SHRUNK.height}px` }
      );
      await waitFor(async () => {
        const s = await read();
        return (
          !!s.container &&
          !checkBox('container', s.container, UI_KIT_SHRUNK) &&
          !checkInside('window', s.window, s.container)
        );
      });
      r = await read();
      pushIf(problems, checkBox('container after the target shrank', r.container, UI_KIT_SHRUNK));
      if (r.container) {
        pushIf(problems, checkInside('window after the target shrank', r.window, r.container));
        pushIf(problems, checkInside('toast after the target shrank', r.toast, r.container));
      }
      await page.evaluate(() => window.__embedTest.resizeTarget('#inline', '', ''));

      await page.evaluate(() => window.__embedTest.unmount());
      const left = await page.evaluate(() => window.__embedTest.leftovers());
      if (left.containers || left.canvases || left.inlineChildren) {
        problems.push(`left after unmount: ${JSON.stringify(left)}`);
      }
      expectNoStyleChange(problems, 'after unmount', before, await styles());
    }
  );
  return { failed, fonts: measured };
};

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

  if (profileId === UI_KIT_PROFILE) {
    let fonts: Record<string, string> | null = null;
    for (const { label, root } of UI_KIT_ROOTS) {
      const rootParam = root ? `&root=${encodeURIComponent(root)}` : '';
      const result = await checkUiKitAtRoot(page, `${url}${rootParam}`, label, fonts);
      failed += result.failed;
      fonts ??= result.fonts;
    }
  }

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
      rects: (
        selectors: string[]
      ) => Record<string, (Rect & { fontSize: string; fontFamily: string }) | null>;
      loadedFonts: () => string[];
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
