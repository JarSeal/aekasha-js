import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HubBuildResult } from './build';
import type { HubDevEvent } from './devProtocol';
import {
  createHubDevRunner,
  diffBuilds,
  isEditorTempFile,
  type HubApiExtract,
  type HubDevRunnerDeps,
} from './devRunner';
import { HubDiagnostics } from './diagnostics';
import { HUB_DIR } from './paths';

const DEBOUNCE_MS = 100;
const PAGE_FILE = path.join(HUB_DIR, 'pages', 'examples', 'intro.md');
const OUTSIDE_FILE = path.resolve(HUB_DIR, '..', 'CHANGELOG.md');
const API_INPUT = path.resolve(HUB_DIR, '..', 'src', '_engine', 'index.ts');

const createResult = (html: string, fields: Partial<HubBuildResult> = {}): HubBuildResult => ({
  isOk: true,
  diag: new HubDiagnostics(),
  pageCount: 1,
  durationMs: 1,
  files: [PAGE_FILE, OUTSIDE_FILE],
  dirs: [],
  pages: [{ path: 'examples/', outPath: 'examples/index.html', html, isErrorPage: false }],
  assets: { styles: null, scripts: null },
  search: null,
  api: null,
  isApiStale: false,
  apiRebuildingHtml: '<p>Rebuilding</p>',
  ...fields,
});

/** A build per call, each finished by the test (`finish`) with its page's HTML, or failed */
const createFakeBuilds = () => {
  const pending: { resolve: (result: HubBuildResult) => void; reject: (err: Error) => void }[] = [];
  const buildAsync = vi.fn(
    () => new Promise<HubBuildResult>((resolve, reject) => pending.push({ resolve, reject }))
  );
  const take = () => {
    const next = pending.shift();
    if (!next) throw new Error('No build is running');
    return next;
  };
  return {
    buildAsync,
    finish: (html: string, fields?: Partial<HubBuildResult>) =>
      take().resolve(createResult(html, fields)),
    fail: () => take().reject(new Error('The build threw')),
    get running() {
      return pending.length;
    },
  };
};

let outDir = '';
let builds: ReturnType<typeof createFakeBuilds>;
let events: HubDevEvent[];
let extracts: { resolve: (extract: HubApiExtract) => void }[];
let deps: HubDevRunnerDeps;

beforeEach(() => {
  vi.useFakeTimers();
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aek-hub-runner-'));
  builds = createFakeBuilds();
  events = [];
  extracts = [];
  deps = {
    buildAsync: builds.buildAsync,
    extractApiAsync: () => new Promise((resolve) => extracts.push({ resolve })),
    start: vi.fn(),
    watch: vi.fn(),
    send: (event) => events.push(event),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    isApiInput: (file) => file === API_INPUT,
    outDir,
    debounceMs: DEBOUNCE_MS,
  };
});

afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(outDir, { recursive: true, force: true });
});

/** The runner after its first build (`<p>1</p>`) */
const startRunnerAsync = async () => {
  const runner = createHubDevRunner(deps);
  const first = runner.getBuildAsync();
  builds.finish('<p>1</p>');
  await first;
  return runner;
};

describe('createHubDevRunner', () => {
  it('builds on the first request, starting the watching first, and only once', async () => {
    const runner = createHubDevRunner(deps);
    const a = runner.getBuildAsync();
    const b = runner.getBuildAsync();
    expect(deps.start).toHaveBeenCalledTimes(1);
    builds.finish('<p>1</p>');
    expect((await a).pages[0].html).toBe('<p>1</p>');
    expect(await b).toBe(await a);
    expect(builds.buildAsync).toHaveBeenCalledTimes(1);
    expect(deps.watch).toHaveBeenCalledWith([OUTSIDE_FILE]);
  });

  it('runs a save made during the first build after it (H3: it was lost)', async () => {
    const runner = createHubDevRunner(deps);
    const first = runner.getBuildAsync();
    runner.onHubFileEvent(PAGE_FILE);
    // A source outside hub/: not known until the first build ends, then queued
    runner.onWatcherEvent(OUTSIDE_FILE);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 2);
    expect(builds.running).toBe(1); // The run waits for the first build
    builds.finish('<p>1</p>');
    await first;
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(builds.running).toBe(1);
    builds.finish('<p>2</p>');
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toEqual([{ kind: 'pages', paths: ['examples/'] }]);
    expect(builds.buildAsync).toHaveBeenCalledTimes(2);
  });

  it('ignores editor temp files and saves before the first request', async () => {
    const runner = createHubDevRunner(deps);
    runner.onHubFileEvent(PAGE_FILE);
    const first = runner.getBuildAsync();
    builds.finish('<p>1</p>');
    await first;
    runner.onHubFileEvent(`${PAGE_FILE}.swp`);
    runner.onHubFileEvent(path.join(path.dirname(PAGE_FILE), '4913'));
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 2);
    expect(builds.buildAsync).toHaveBeenCalledTimes(1);
  });

  it('lets a request wait for the run in progress only, not for the runs queued after it', async () => {
    const runner = await startRunnerAsync();
    runner.onHubFileEvent(PAGE_FILE);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    const request = runner.getBuildAsync();
    runner.onHubFileEvent(PAGE_FILE); // Queued behind the run in progress
    builds.finish('<p>2</p>');
    expect((await request).pages[0].html).toBe('<p>2</p>');
    expect(builds.running).toBe(0); // The queued run hasn't started: its debounce is still set
  });

  it('makes a burst that straddles the end of a run one more run, not two (G9)', async () => {
    const runner = await startRunnerAsync();
    runner.onHubFileEvent(PAGE_FILE);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    runner.onHubFileEvent(PAGE_FILE); // During the run
    builds.finish('<p>2</p>');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS / 2);
    runner.onHubFileEvent(PAGE_FILE); // After it, within the debounce
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    builds.finish('<p>3</p>');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 2);
    expect(builds.buildAsync).toHaveBeenCalledTimes(3);
  });

  it('rebuilds a stale API model once on request, and sends `api` with the run that renders it', async () => {
    const runner = await startRunnerAsync();
    expect(runner.takeApiRebuild()).toBe(false);
    runner.onWatcherEvent(API_INPUT);
    expect(builds.running).toBe(0); // An API input only marks the model stale
    expect(runner.takeApiRebuild()).toBe(true);
    expect(runner.takeApiRebuild()).toBe(true); // Still rebuilding: no second conversion
    expect(extracts).toHaveLength(1);
    extracts[0].resolve({ isOk: true, durationMs: 6000 });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    builds.finish('<p>1</p>');
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toEqual([{ kind: 'api' }]);
    expect(runner.takeApiRebuild()).toBe(false);
  });

  it('sends `api` when the run that would render the new model fails', async () => {
    const runner = await startRunnerAsync();
    runner.onWatcherEvent(API_INPUT);
    runner.takeApiRebuild();
    extracts[0].resolve({ isOk: true, durationMs: 6000 });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    builds.fail();
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toEqual([{ kind: 'api' }]);
    expect(deps.log.error).toHaveBeenCalled();
    expect(runner.takeApiRebuild()).toBe(false);
  });

  it('marks the model stale from the first build', async () => {
    const runner = createHubDevRunner(deps);
    const first = runner.getBuildAsync();
    builds.finish('<p>1</p>', { isApiStale: true });
    await first;
    expect(runner.takeApiRebuild()).toBe(true);
  });

  it('tries the first build again on the next request when it threw', async () => {
    const runner = createHubDevRunner(deps);
    const first = runner.getBuildAsync();
    builds.fail();
    await expect(first).rejects.toThrow('The first Hub build failed');
    const second = runner.getBuildAsync();
    builds.finish('<p>1</p>');
    expect((await second).pages[0].html).toBe('<p>1</p>');
    expect(deps.start).toHaveBeenCalledTimes(1);
  });

  it('runs nothing after close', async () => {
    const runner = await startRunnerAsync();
    runner.onHubFileEvent(PAGE_FILE);
    runner.close();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 2);
    expect(builds.buildAsync).toHaveBeenCalledTimes(1);
  });

  it('deletes the output of a page a run removed', async () => {
    const runner = await startRunnerAsync();
    const removed = path.join(outDir, 'examples', 'index.html');
    fs.mkdirSync(path.dirname(removed), { recursive: true });
    fs.writeFileSync(removed, '<p>1</p>');
    runner.onHubFileEvent(PAGE_FILE);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    builds.finish('', { pages: [] });
    await vi.advanceTimersByTimeAsync(0);
    expect(fs.existsSync(removed)).toBe(false);
    expect(events).toEqual([{ kind: 'pages', paths: ['examples/'] }]);
  });
});

describe('diffBuilds', () => {
  const page = (html: string) => createResult(html);

  it("ignores a page whose only change is the stylesheet's or the search payload's `?v=`", () => {
    const prev = page(
      '<link href="../_assets/hub.css?v=aaa"><meta content="../_assets/hub-search.js?v=bbb">'
    );
    const next = page(
      '<link href="../_assets/hub.css?v=ccc"><meta content="../_assets/hub-search.js?v=ddd">'
    );
    expect(diffBuilds(prev, next, new Set([PAGE_FILE]))).toEqual([]);
  });

  it('sends `css` for a new stylesheet and `all` for a static asset', () => {
    const styles = (hash: string) => ({ outPath: '_assets/hub.css', content: '', hash });
    const prev = createResult('', { assets: { styles: styles('a'), scripts: null } });
    const next = createResult('', { assets: { styles: styles('b'), scripts: null } });
    expect(diffBuilds(prev, next, new Set())).toEqual([{ kind: 'css', version: 'b' }]);
    const icon = path.join(HUB_DIR, '_assets', 'icons', 'search.svg');
    expect(diffBuilds(prev, next, new Set([icon]))).toEqual([{ kind: 'all' }]);
  });
});

describe('isEditorTempFile', () => {
  it.each(['a.md.swp', '4913', 'a.md~', '.#a.md', 'a.md___jb_tmp___', 'a.md.crswap', '.DS_Store'])(
    '%s is one',
    (name) => expect(isEditorTempFile(path.join(HUB_DIR, name))).toBe(true)
  );

  it('a page source is not', () => expect(isEditorTempFile(PAGE_FILE)).toBe(false));
});
