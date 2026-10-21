import fs from 'node:fs';
import path from 'node:path';
import { createWorkQueue } from '../workQueue';
import type { HubBuildResult } from './build';
import type { HubDevEvent } from './devProtocol';
import { diagnosticKey, formatDiagnostic } from './diagnostics';
import {
  FAVICON_FILES,
  HUB_ASSETS_DIR,
  HUB_DEV_URL_BASE,
  HUB_DIR,
  HUB_STATIC_ASSET_DIRS,
} from './paths';

/**
 * The dev Hub's runs (`devTools/hubPlugin.ts` wires them to the server): the first build on the
 * first request, then a run per burst of saves, one at a time (`createWorkQueue`), each compared
 * with the last to send the open pages their `aek:hub` events. And the API docs' state: stale
 * after an engine or toolkit save, rebuilt in a child process on the next API page request.
 * - Lazy: the first request starts the watching (`start`), then builds; a save during that build
 *   is the next run's (p619 §1.4 H3: it was lost).
 * - A request during a run waits for that run only, not for the runs saves queue after it (H3).
 * - Every run builds the whole Hub, then `diffBuilds` sends `css` when only the stylesheet
 *   changed, `pages` with the pages whose HTML changed, `all` for the scripts and static assets.
 *   Never a `full-reload`: open app tabs aren't touched.
 * - The API docs are never rebuilt by a save. The builds take the last good model, and a save of
 *   one of its inputs only marks it stale. The next request for an API page while it's stale
 *   starts the conversion (`extractApi`, a child process: in the server's it would block every
 *   request for seconds) and gets the rebuilding page; the run that renders the new model sends
 *   `api`, which reloads it. A failed run sends it too, so those pages reload into the last ones.
 */

/** What the runner needs from the server and the generator: injected, so tests fake them */
export type HubDevRunnerDeps = {
  /** A dev build of the whole Hub into `outDir`; `last` is the last build (its assets the fallback) */
  buildAsync: (last: HubBuildResult | null) => Promise<HubBuildResult>;
  /** The API model's conversion in a child process */
  extractApiAsync: () => Promise<HubApiExtract>;
  /** Before the first build: empties the output, starts watching `hub/` (`onHubFileEvent`) */
  start: () => void;
  /** The build's sources outside `hub/`, for Vite's watcher (`onWatcherEvent`) */
  watch: (paths: string[]) => void;
  send: (event: HubDevEvent) => void;
  log: HubDevLog;
  /** Is the file an API model input (an engine or toolkit `.ts`, `tsconfig.json`, …) */
  isApiInput: (file: string) => boolean;
  /** The dev output folder, where removed pages and assets are deleted */
  outDir: string;
  debounceMs?: number;
};

export type HubApiExtract = { isOk: boolean; durationMs: number };

export type HubDevLog = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string, err?: unknown) => void;
};

export type HubDevRunner = {
  /** A file under `hub/` changed (`fs.watch`) */
  onHubFileEvent: (file: string) => void;
  /** A file Vite's watcher reported (the sources outside `hub/`, and every API input) */
  onWatcherEvent: (file: string) => void;
  /**
   * The last build, after the first build or the run in progress (not the runs queued after it)
   * @throws when the first build failed
   */
  getBuildAsync: () => Promise<HubBuildResult>;
  /**
   * For an API page request: true while the model is stale or rebuilding, and then the rebuild is
   * started (once), so the request gets the rebuilding page
   */
  takeApiRebuild: () => boolean;
  /** Stops the queue and its pending run; a run in progress finishes without effects */
  close: () => void;
};

const DEBOUNCE_MS = 100;
/** The pages an update line names (an API rebuild can change them all) */
const MAX_LOGGED_PAGES = 5;

const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

/** The `?v=` of these changes with any page's text or with the SCSS: not a page change */
const VOLATILE_ASSET_REF_REGEX = /(_assets\/(?:hub\.css|hub-search\.js))\?v=[\w-]+/g;

/** Static files copied as they are: no `?v=` changes when they do, so open pages reload */
const STATIC_DIRS = HUB_STATIC_ASSET_DIRS.map((name) => path.join(HUB_ASSETS_DIR, name));
const isStaticAsset = (file: string) =>
  FAVICON_FILES.includes(file) || STATIC_DIRS.some((dir) => file.startsWith(dir + path.sep));

/** A static asset's copy in the dev output: the favicons at its root, the rest in `_assets/` */
const getStaticAssetCopy = (outDir: string, file: string) =>
  FAVICON_FILES.includes(file)
    ? path.join(outDir, path.basename(file))
    : path.join(outDir, '_assets', path.relative(HUB_ASSETS_DIR, file));

/**
 * An editor's temporary or backup file (vim's `.swp` and `4913`, `~` backups, emacs' `.#` locks,
 * JetBrains' `___jb_tmp___`, VS Code's `.crswap`), or a dot file: no run, so it can't reload the
 * open tabs (H3)
 */
export const isEditorTempFile = (file: string) => {
  const name = path.basename(file);
  return (
    name.startsWith('.') ||
    name.endsWith('~') ||
    name === '4913' ||
    /\.(swp|swx|swo|tmp|crswap)$|___jb_(tmp|old)___$/.test(name)
  );
};

/** The plural `s` */
const s = (count: number) => (count === 1 ? '' : 's');

/** The events open pages need after `next`: none when nothing a page shows changed */
export const diffBuilds = (
  prev: HubBuildResult,
  next: HubBuildResult,
  changedFiles: Set<string>
): HubDevEvent[] => {
  const scriptKeys = (build: HubBuildResult) =>
    (build.assets.scripts ?? []).map((file) => `${file.outPath}?${file.hash}`).join();
  if (
    scriptKeys(prev) !== scriptKeys(next) ||
    [...changedFiles].some((file) => isStaticAsset(file))
  ) {
    return [{ kind: 'all' }];
  }

  const events: HubDevEvent[] = [];
  const nextCss = next.assets.styles?.hash;
  if (nextCss && nextCss !== prev.assets.styles?.hash)
    events.push({ kind: 'css', version: nextCss });

  const normalise = (html: string) => html.replace(VOLATILE_ASSET_REF_REGEX, '$1');
  const prevPages = new Map(prev.pages.map((page) => [page.path, normalise(page.html)]));
  const paths = next.pages
    .filter((page) => prevPages.get(page.path) !== normalise(page.html))
    .map((page) => page.path);
  const nextPaths = new Set(next.pages.map((page) => page.path));
  // A removed page's open tab reloads into the 404 page
  paths.push(...prev.pages.filter((page) => !nextPaths.has(page.path)).map((page) => page.path));
  if (paths.length) events.push({ kind: 'pages', paths });
  return events;
};

const describeEvents = (events: HubDevEvent[]) =>
  events
    .map((event) => {
      if (event.kind === 'api') return 'the API docs';
      if (event.kind === 'all') return 'scripts or static assets: every page reloads';
      if (event.kind === 'css') return 'styles';
      const names = event.paths.slice(0, MAX_LOGGED_PAGES).map((p) => p || '/');
      const more = event.paths.length - names.length;
      if (more) names.push(`and ${more} more`);
      return `${event.paths.length} page${s(event.paths.length)} (${names.join(', ')})`;
    })
    .join(', ');

/**
 * Removed pages, script chunks a TS change renamed (every page reloads for it), and the copies of
 * static assets removed from `hub/_assets/` (H3: they kept being served)
 */
const removeStaleFiles = (
  outDir: string,
  result: HubBuildResult,
  prev: HubBuildResult,
  changedFiles: Set<string>
) => {
  for (const file of changedFiles) {
    if (isStaticAsset(file) && !fs.existsSync(file)) {
      fs.rmSync(getStaticAssetCopy(outDir, file), { recursive: true, force: true });
    }
  }
  const outPaths = (build: HubBuildResult) => [
    ...build.pages.map((page) => page.outPath),
    ...(build.assets.scripts ?? []).map((file) => file.outPath),
  ];
  const current = new Set(outPaths(result));
  for (const outPath of outPaths(prev)) {
    if (!current.has(outPath)) fs.rmSync(path.join(outDir, outPath), { force: true });
  }
};

/** The errors and warnings new since the last run, and "No errors" once they're fixed */
const report = (log: HubDevLog, result: HubBuildResult, prev: HubBuildResult | null) => {
  const prevKeys = new Set(prev?.diag.items.map(diagnosticKey));
  for (const item of result.diag.items) {
    if (prevKeys.has(diagnosticKey(item))) continue;
    if (item.level === 'error') log.error(`${RED}✗ [Hub] ${formatDiagnostic(item)}${RESET}`);
    else log.warn(`${YELLOW}⚠ [Hub] ${formatDiagnostic(item)}${RESET}`);
  }
  if (prev?.diag.errors.length && result.isOk) log.info(`${GREEN}✓ [Hub] No errors${RESET}`);
};

const logFirstBuild = (log: HubDevLog, result: HubBuildResult, isApiStale: boolean) => {
  const errors = result.diag.errors.length;
  log.info(
    `${errors ? YELLOW : GREEN}${errors ? '⚠' : '✓'} [Hub] ${result.pageCount} page${s(result.pageCount)} at ${HUB_DEV_URL_BASE}${errors ? `, ${errors} with errors` : ''} ${DIM}(${Math.round(result.durationMs)} ms${isApiStale ? '; the API docs aren’t current: rebuilt on their first request' : ''})${RESET}`
  );
};

const logApiExtract = (log: HubDevLog, extracted: HubApiExtract) => {
  const seconds = (extracted.durationMs / 1000).toFixed(1);
  if (extracted.isOk) {
    log.info(`${GREEN}✓ [Hub] API docs rebuilt${RESET} ${DIM}(TypeDoc ${seconds} s)${RESET}`);
  } else {
    log.error(
      `${RED}✗ [Hub] The API docs didn't rebuild: their pages list the errors, the other pages keep the last good api: links${RESET}`
    );
  }
};

/** A run's work: the files changed since the last run, and an API conversion that has ended */
type HubDevWork = { files: Set<string>; extracted: HubApiExtract | null };

/** The dev Hub's runs and the API docs' state (see the module's comment) */
export const createHubDevRunner = (deps: HubDevRunnerDeps): HubDevRunner => {
  const { log } = deps;
  let lastBuild: HubBuildResult | null = null;
  /** The watching has started (on the first request) */
  let isStarted = false;
  /** The first build; null again when it threw, so the next request tries again */
  let firstBuild: Promise<void> | null = null;
  /** The run in progress: a request waits for it, not for the runs queued after it */
  let currentRun: Promise<void> | null = null;
  let isClosed = false;
  /** The build's sources and folders outside `hub/`, watched through Vite's watcher */
  let outsideFiles = new Set<string>();
  let outsideDirs = new Set<string>();
  /**
   * Saves during the first build, queued when it ends (as one run): `hub/`'s, and the ones Vite's
   * watcher reported, which are the build's only if it read them (not known until it ends)
   */
  const earlyHubFiles = new Set<string>();
  const earlyFiles = new Set<string>();
  /** An API input changed since the model was built, or there's none yet */
  let isApiStale = false;
  /** From the rebuild's start until the run that renders its model has written the pages */
  let isApiRebuilding = false;

  const isOutsideSource = (file: string) =>
    outsideFiles.has(file) || outsideDirs.has(path.dirname(file));

  const watchOutsideFiles = ({ files, dirs }: HubBuildResult) => {
    const isOutside = (file: string) => !file.startsWith(HUB_DIR + path.sep);
    outsideFiles = new Set(files.filter(isOutside));
    outsideDirs = new Set(dirs.filter(isOutside));
    deps.watch([...outsideFiles, ...outsideDirs]);
  };

  const sendApiEvent = () => {
    if (!isClosed) deps.send({ kind: 'api' });
  };

  /** A run after the first build; `extracted`: it renders an API rebuild's model */
  const runAsync = async ({ files, extracted }: HubDevWork) => {
    const result = await deps.buildAsync(lastBuild);
    const prev = lastBuild;
    lastBuild = result;
    if (isClosed || !prev) return; // A run is queued only once there's a first build
    watchOutsideFiles(result);
    report(log, result, prev);
    removeStaleFiles(deps.outDir, result, prev, files);
    const events = diffBuilds(prev, result, files);
    if (extracted) {
      isApiRebuilding = false;
      events.push({ kind: 'api' });
      logApiExtract(log, extracted);
    }
    for (const event of events) deps.send(event);
    if (events.length) {
      log.info(
        `[Hub] Updated: ${describeEvents(events)} ${DIM}(${Math.round(result.durationMs)} ms)${RESET}`
      );
    }
  };

  const queue = createWorkQueue<HubDevWork>({
    create: () => ({ files: new Set(), extracted: null }),
    runAsync: (work) => {
      const run = runAsync(work).finally(() => {
        currentRun = null;
        // A failed run: the rebuilding pages reload into the last build's pages
        if (work.extracted && isApiRebuilding) {
          isApiRebuilding = false;
          sendApiEvent();
        }
      });
      currentRun = run.catch(() => undefined);
      return run;
    },
    onError: (err) => log.error(`${RED}✗ [Hub] The build failed:${RESET}`, err),
    debounceMs: deps.debounceMs ?? DEBOUNCE_MS,
  });

  const schedule = (file: string) => {
    if (isClosed || isEditorTempFile(file)) return;
    queue.schedule((work) => work.files.add(file));
  };

  const startFirstBuild = () => {
    if (!isStarted) deps.start();
    isStarted = true;
    firstBuild = deps
      .buildAsync(null)
      .then((result) => {
        lastBuild = result;
        if (isClosed) return;
        watchOutsideFiles(result);
        report(log, result, null);
        isApiStale ||= result.isApiStale;
        logFirstBuild(log, result, isApiStale);
      })
      .catch((err: unknown) => {
        firstBuild = null;
        log.error(`${RED}✗ [Hub] The first build failed:${RESET}`, err);
        throw err;
      })
      .finally(() => {
        // Saved while it ran: hub/'s files, and the others the build read
        for (const file of earlyHubFiles) schedule(file);
        for (const file of earlyFiles) if (isOutsideSource(file)) schedule(file);
        earlyHubFiles.clear();
        earlyFiles.clear();
      });
    return firstBuild;
  };

  return {
    onHubFileEvent: (file) => {
      if (!isStarted) return;
      if (lastBuild) schedule(file);
      else earlyHubFiles.add(file);
    },
    onWatcherEvent: (file) => {
      if (!isStarted) return;
      // Only marked: the next API page request rebuilds them
      if (deps.isApiInput(file)) isApiStale = true;
      // The first build's sources aren't known yet: checked when it ends
      if (!lastBuild) earlyFiles.add(file);
      else if (isOutsideSource(file)) schedule(file);
    },
    getBuildAsync: async () => {
      if (!lastBuild) await (firstBuild ?? startFirstBuild()).catch(() => undefined);
      else if (currentRun) await currentRun;
      if (!lastBuild) throw new Error('The first Hub build failed: see the terminal');
      return lastBuild;
    },
    takeApiRebuild: () => {
      if (!isApiStale && !isApiRebuilding) return false;
      if (!isApiRebuilding) {
        isApiRebuilding = true;
        isApiStale = false; // A save from now on is newer than this conversion
        log.info(`[Hub] Rebuilding the API docs… ${DIM}(TypeDoc in a child process)${RESET}`);
        void deps.extractApiAsync().then((extracted) => {
          if (!isClosed) queue.schedule((work) => (work.extracted = extracted));
        });
      }
      return true;
    },
    close: () => {
      isClosed = true;
      queue.close();
    },
  };
};
