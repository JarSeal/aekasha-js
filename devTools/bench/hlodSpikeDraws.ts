/**
 * p377 Phase 0 (`hlodSpike.ts --step draws`, docs/plans/p377_hlod-streaming-cell-proxies.md): which
 * way to fewer draws. largeWorld's far field (`?hlodField=<sites>`) drawn each way, a page per case
 * and run, under the day-night sky box paused at `--time`, on each backend, from each view.
 *
 * Cases (`--cases`, default all of steps 1-4):
 * - `floor`: no field (step 1's floor).
 * - `<as>@<cell>`: the field as `members`, `proxy` or `instanced` (`?hlodFieldAs`) in cells of
 *   `<cell>` m (`?hlodFieldCell`). `members@32` is the reference (p376's `FULL`).
 * - `<as>@<cell>+cull25|50|75`: that page's field culled (the probe's `setCull`) at the screen
 *   size below which about 25, 50 or 75 % of its objects are from the `far` view (`screenSizes`),
 *   measured on the same page as its uncull'd case (step 2: `members@32+cull50`).
 *
 * The sky's clouds are held still (`setupSkyAsync`'s `holdClouds`): they drift per frame, and the
 * pages run different frame counts, so their shots would differ in the sky alone.
 *
 * Per case and view: the probe's CPU split (`cpuSplitAsync`: the frame, the render submit, the
 * scene graph walk in it, the systems, the scene's objects), the renderer's draws and triangles,
 * the field's objects drawn per pass (`fieldDraws`), the GPU (WebGL2: the stats panel's figure;
 * WebGPU: the scene passes, docs/issues/gpu-timer-webgpu-frame-sum.md) and a snapshot (the test
 * bridge's, the canvas without debug helpers) in `.cache/bench/hlodSpike/draws/<backend>/`,
 * compared with the reference's of the same run (`snapshotDiff.ts`: the changed share and the mean
 * delta); the reference's runs compared with its first give the noise. Per page: the load (the
 * navigation to the scene ready), the field's creation and, for `members`, `--rebuilds` groups
 * rebuilt one at a time (`rebuildAsync`, after the last view). The case order is reversed on every
 * second run, and so is the order of a page's cull cases within each view.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { ROOT } from '../paths';
import { out } from '../progressLog';
import { EVALUATE_MARGIN_MS, withTimeout } from '../verify/browser';
import { DEFAULT_SNAPSHOT_TOLERANCE } from '../verify/scenes.config';
import { compareSnapshots } from '../verify/snapshotDiff';
import { FRAME_VIEWS, measureAsync, measureWithGpuAsync, type GpuContext } from './hlodSpikeFrames';
import {
  buildSceneUrl,
  fmt,
  int,
  med,
  openSceneAsync,
  printErrors,
  RED,
  RESET,
  VIEWPORT,
  type Backend,
} from './hlodSpikePage';

const SCENE_ID = 'largeWorld';
export const DRAWS_DIR = path.join(ROOT, '.cache/bench/hlodSpike/draws');
const REFERENCE = 'members@32';
const CULLS = { cull25: 'quarter', cull50: 'half', cull75: 'threeQuarters' } as const;
type CullName = keyof typeof CULLS;

/** Steps 1-4's cases: the floor, the reference and its culls, larger cells, proxies, far entries */
export const DEFAULT_DRAW_CASES = [
  'floor',
  REFERENCE,
  `${REFERENCE}+cull25`,
  `${REFERENCE}+cull50`,
  `${REFERENCE}+cull75`,
  'members@64',
  'members@128',
  'members@256',
  'proxy@32',
  'proxy@128',
  'proxy@256',
  'instanced@128',
  'instanced@256',
];

export type DrawsArgs = {
  backends: Backend[];
  runs: number;
  warmup: number;
  frames: number;
  views: string[];
  timeOfDay: number;
  /** The far field's sites */
  field: number;
  cases: string[];
  /** Groups rebuilt per `members` page (0: none) */
  rebuilds: number;
};

type CaseDef = { name: string; page: string; cull: CullName | null };
type PageDef = {
  name: string;
  params: Record<string, string>;
  as: string | null;
  /** The page's cases: itself (null) and its culls */
  culls: (CullName | null)[];
};

/** A case name's page and cull; throws on a name it can't read */
export const parseDrawCase = (name: string): CaseDef => {
  const match = /^(floor|(members|proxy|instanced)@(\d+))(?:\+(cull25|cull50|cull75))?$/.exec(name);
  if (!match || (match[1] === 'floor' && match[4])) {
    throw new Error(
      `unknown case ${name}: floor, <members|proxy|instanced>@<cell m>, or one of those with +cull25|50|75`
    );
  }
  return { name, page: match[1], cull: (match[4] as CullName | undefined) ?? null };
};

/** The cases' pages, in first-named order, each with its cases (a cull case brings its page's
 * uncull'd one, which it's measured against) */
const toPages = (cases: string[], field: number): PageDef[] => {
  const pages = new Map<string, PageDef>();
  for (const def of cases.map(parseDrawCase)) {
    let page = pages.get(def.page);
    if (!page) {
      const [as, cell] = def.page === 'floor' ? [null, null] : def.page.split('@');
      page = {
        name: def.page,
        as,
        params: as ? { hlodField: String(field), hlodFieldAs: as, hlodFieldCell: cell! } : {},
        culls: [null],
      };
      pages.set(def.page, page);
    }
    if (def.cull && !page.culls.includes(def.cull)) page.culls.push(def.cull);
  }
  return [...pages.values()];
};

const caseName = (page: string, cull: CullName | null) => (cull ? `${page}+${cull}` : page);

/** `cpuSplitAsync`'s figures */
type Split = Record<
  | 'cpuMs'
  | 'cpuMsP90'
  | 'renderMs'
  | 'walkMs'
  | 'walkCalls'
  | 'systemsMs'
  | 'drawCalls'
  | 'triangles'
  | 'objects'
  | 'hidden'
  | 'seconds',
  number
>;
type PassCount = { objects: number; triangles: number };
type FieldDraws = {
  objects: number;
  visible: number;
  lodCulled: number;
  main: PassCount | null;
  shadows: PassCount[];
  draws: number;
};
type ImageDiff = { changedRatio: number; meanDelta: number } | null;
type CaseRun = {
  split: Split;
  gpuMs: number;
  scenePassesMs: number;
  contexts: GpuContext[];
  draws: FieldDraws | null;
  snapshot: string;
  /** Against the reference's snapshot of the same run and view (filled after the runs) */
  image?: ImageDiff;
};
type RebuildResult = {
  groups: number;
  baselineCpuMs: number;
  overMs: { median: number; max: number };
  builds: {
    vertices: number;
    onWorker: boolean;
    applied: boolean;
    frames: number;
    overMs: number;
  }[];
};
type PageRun = {
  loadMs: number;
  createMs: number | null;
  objects: number | null;
  cullSizes: Record<string, number> | null;
  rebuild: RebuildResult | null;
};
type DrawsApi = {
  setupSkyAsync: (hours: number, holdClouds: boolean) => Promise<void>;
  view: (pose: (typeof FRAME_VIEWS)[string]) => void;
  measure: (frames: number) => Promise<unknown>;
  field: () => { objects: number; createMs: number };
  screenSizes: () => { cullFor: Record<string, number> };
  setCull: (size: number) => number;
  fieldDraws: () => FieldDraws;
  cpuSplitAsync: (frames: number) => Promise<Split>;
  rebuildAsync: (n: number) => Promise<RebuildResult>;
};
type DrawsWindow = Window & {
  __aekHlod?: DrawsApi;
  __AEK_TEST__?: {
    snapshot: (o: { width: number; height: number }) => Promise<{ pngBase64: string }>;
  };
};

/** Results by backend: each case's runs per view, and each page's runs */
export type DrawsResults = Record<
  string,
  { cases: Record<string, Record<string, CaseRun[]>>; pages: Record<string, PageRun[]> }
>;

/** The probe's CPU split of the next `frames` frames (at 20 fps or better) */
const cpuSplitAsync = (page: Page, frames: number) =>
  withTimeout(
    page.evaluate((n) => (window as DrawsWindow).__aekHlod!.cpuSplitAsync(n), frames),
    (frames / 20) * 1000 + EVALUATE_MARGIN_MS,
    `cpuSplitAsync(${frames})`
  );

const snapshotFile = (backend: Backend, name: string, view: string, run: number) =>
  path.join(DRAWS_DIR, backend, `${name.replace(/[@+]/g, '-')}-${view}-${run + 1}.png`);

/** One page: its load, then every view's cases, then (members) the rebuilds */
const runPageAsync = async (
  page: Page,
  def: PageDef,
  args: DrawsArgs,
  backend: Backend,
  run: number,
  results: DrawsResults[string],
  loadMs: number
) => {
  await page.evaluate(
    (hours) => (window as DrawsWindow).__aekHlod!.setupSkyAsync(hours, true),
    args.timeOfDay
  );
  const field = def.as
    ? await page.evaluate(() => (window as DrawsWindow).__aekHlod!.field())
    : null;
  let cullSizes: Record<string, number> | null = null;
  if (def.culls.some((c) => c !== null)) {
    await page.evaluate((pose) => (window as DrawsWindow).__aekHlod!.view(pose), FRAME_VIEWS.far);
    await measureAsync(page, 30);
    cullSizes = await page.evaluate(() => (window as DrawsWindow).__aekHlod!.screenSizes().cullFor);
  }
  const order = run % 2 === 0 ? def.culls : [...def.culls].reverse();
  for (const viewName of args.views) {
    await page.evaluate(
      (pose) => (window as DrawsWindow).__aekHlod!.view(pose),
      FRAME_VIEWS[viewName]
    );
    await measureAsync(page, 30);
    for (const cull of order) {
      const name = caseName(def.name, cull);
      if (def.as) {
        const size = cull ? cullSizes![CULLS[cull]] : 0;
        await page.evaluate((s) => (window as DrawsWindow).__aekHlod!.setCull(s), size);
      }
      if (args.warmup > 0) await measureAsync(page, args.warmup);
      const { measure, gpuMs, contexts, scenePassesMs } = await measureWithGpuAsync(
        page,
        args.frames,
        backend,
        cpuSplitAsync
      );
      const draws = def.as
        ? await page.evaluate(() => (window as DrawsWindow).__aekHlod!.fieldDraws())
        : null;
      const shot = await withTimeout(
        page.evaluate((size) => (window as DrawsWindow).__AEK_TEST__!.snapshot(size), VIEWPORT),
        EVALUATE_MARGIN_MS,
        'snapshot'
      );
      const file = snapshotFile(backend, name, viewName, run);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(shot.pngBase64, 'base64'));
      const byView = (results.cases[name] ??= {});
      (byView[viewName] ??= []).push({
        split: measure,
        gpuMs,
        scenePassesMs,
        contexts,
        draws,
        snapshot: file,
      });
      out(
        `    ${viewName} ${name}: CPU ${fmt(measure.cpuMs)} ms (submit ${fmt(measure.renderMs)}, walk ${fmt(measure.walkMs)}, systems ${fmt(measure.systemsMs)}), GPU ${fmt(gpuMs)} ms${backend === 'webgpu' ? ` (scene passes ${fmt(scenePassesMs)} ms)` : ''}, ${int(measure.drawCalls)} draws${draws ? ` (field ${draws.main?.objects ?? 'n/a'} in view, ${draws.lodCulled} culled)` : ''}`
      );
    }
  }
  if (def.as) await page.evaluate(() => (window as DrawsWindow).__aekHlod!.setCull(0));
  let rebuild: RebuildResult | null = null;
  if (def.as === 'members' && args.rebuilds > 0) {
    await measureAsync(page, 30);
    rebuild = await withTimeout(
      page.evaluate((n) => (window as DrawsWindow).__aekHlod!.rebuildAsync(n), args.rebuilds),
      args.rebuilds * 15_000 + EVALUATE_MARGIN_MS,
      'rebuildAsync'
    );
    out(
      `    ${args.rebuilds} rebuilds: over the median frame ${fmt(rebuild.overMs.median)} ms (max ${fmt(rebuild.overMs.max)}), ${rebuild.builds.filter((b) => b.onWorker).length} on the worker`
    );
  }
  (results.pages[def.name] ??= []).push({
    loadMs,
    createMs: field?.createMs ?? null,
    objects: field?.objects ?? null,
    cullSizes,
    rebuild,
  });
};

/** Each case's snapshot against the reference's of the same backend, view and run; the reference's
 * later runs against its first give the noise */
const compareImagesAsync = async (results: DrawsResults) => {
  for (const [backend, { cases }] of Object.entries(results)) {
    const reference = cases[REFERENCE];
    if (!reference) continue;
    for (const [name, byView] of Object.entries(cases)) {
      for (const [view, runs] of Object.entries(byView)) {
        for (let i = 0; i < runs.length; i++) {
          // The reference against its own first run (its first run: none)
          const against =
            name === REFERENCE ? (i > 0 ? reference[view]?.[0] : undefined) : reference[view]?.[i];
          if (!against) continue;
          const diff = await compareSnapshots(
            fs.readFileSync(runs[i].snapshot),
            against.snapshot,
            DEFAULT_SNAPSHOT_TOLERANCE,
            runs[i].snapshot.replace(/\.png$/, '.diff.png')
          );
          runs[i].image = 'sizeMismatch' in diff ? null : diff;
        }
      }
    }
    out(`  ${backend}: snapshots compared`);
  }
};

/** Runs the cases on every backend, `args.runs` pages each, the case order reversed every second run */
export const runDrawsStepAsync = async (browser: Browser, baseUrl: string, args: DrawsArgs) => {
  const pages = toPages(args.cases, args.field);
  fs.rmSync(DRAWS_DIR, { recursive: true, force: true });
  const results: DrawsResults = {};
  for (const backend of args.backends) {
    const byBackend: DrawsResults[string] = { cases: {}, pages: {} };
    results[backend] = byBackend;
    // An unrecorded load first: the dev server's first load of a backend's page is cold
    out(`  ${backend}: a warm-up load (${pages[0].name}, not recorded)`);
    const warmup = await browser.newPage({ viewport: VIEWPORT });
    const warmupErrors: string[] = [];
    try {
      await openSceneAsync(
        warmup,
        buildSceneUrl(baseUrl, SCENE_ID, pages[0].params),
        backend,
        warmupErrors
      );
    } catch (err) {
      out(`${RED}✗ ${backend} warm-up: ${(err as Error).message}${RESET}`);
    } finally {
      printErrors(warmupErrors);
      await withTimeout(warmup.close(), 30_000, 'closing the page').catch(() => undefined);
    }
    for (let run = 0; run < args.runs; run++) {
      const order = run % 2 === 0 ? pages : [...pages].reverse();
      for (const def of order) {
        out(
          `  ${backend} run ${run + 1}: ${def.name}${def.culls.length > 1 ? ` (+${def.culls.filter(Boolean).join(', ')})` : ''}`
        );
        const page = await browser.newPage({ viewport: VIEWPORT });
        const errors: string[] = [];
        try {
          const { loadMs } = await openSceneAsync(
            page,
            buildSceneUrl(baseUrl, SCENE_ID, def.params),
            backend,
            errors
          );
          await runPageAsync(page, def, args, backend, run, byBackend, loadMs);
        } catch (err) {
          out(`${RED}✗ ${backend} run ${run + 1} ${def.name}: ${(err as Error).message}${RESET}`);
        } finally {
          printErrors(errors);
          await withTimeout(page.close(), 30_000, 'closing the page').catch(() => undefined);
        }
      }
    }
  }
  await compareImagesAsync(results);
  return results;
};

const range = (values: number[], digits = 2) => {
  const v = values.filter((x) => !Number.isNaN(x));
  return v.length ? `${fmt(Math.min(...v), digits)} to ${fmt(Math.max(...v), digits)}` : 'n/a';
};
const pctOf = (ratio: number) => (Number.isNaN(ratio) ? 'n/a' : `${(ratio * 100).toFixed(2)} %`);
/** The GPU figure compared: WebGL2's frame, WebGPU's scene passes */
const gpuOf = (backend: string, r: CaseRun) => (backend === 'webgpu' ? r.scenePassesMs : r.gpuMs);

/** The tables: per backend the cases' figures, each against the reference, the pages, and what
 * decides (p377 Phase 0: ≥ 1 ms of CPU saved in two of the views, no GPU lost beyond the reference's
 * spread, the image inside its noise) */
export const formatDraws = (results: DrawsResults, args: DrawsArgs) => {
  const lines: string[] = [];
  /** Per case and backend: whether it pays there (null: no GPU figure to tell) */
  const paysByCase: Record<string, Record<string, boolean | null>> = {};
  for (const [backend, { cases, pages }] of Object.entries(results)) {
    const gpuLabel = backend === 'webgpu' ? 'Scene passes GPU (ms)' : 'GPU (ms)';
    lines.push(
      `\n${backend}: medians of ${args.runs} run(s), ${args.frames} frames each, ${args.field} sites, ${args.timeOfDay}:00`,
      `| Case | View | Field objects in view / shadow (draws) | LOD culled | Renderer draws | Triangles | CPU frame (ms) | Render submit | Scene walk (calls) | Systems | ${gpuLabel} | Scene objects (hidden) |`,
      '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'
    );
    for (const [name, byView] of Object.entries(cases)) {
      for (const [view, runs] of Object.entries(byView)) {
        const pick = (key: keyof Split) => med(runs.map((r) => r.split[key]));
        const d = runs[runs.length - 1].draws;
        const shadow = d ? d.shadows.reduce((sum, s) => sum + s.objects, 0) : NaN;
        lines.push(
          `| ${name} | ${view} | ${d ? `${int(d.main?.objects ?? NaN)} / ${int(shadow)} (${int(d.draws)})` : ''} | ${d ? int(d.lodCulled) : ''} | ${int(pick('drawCalls'))} | ${int(pick('triangles'))} | ${fmt(pick('cpuMs'))} | ${fmt(pick('renderMs'))} | ${fmt(pick('walkMs'))} (${fmt(pick('walkCalls'), 0)}) | ${fmt(pick('systemsMs'))} | ${fmt(med(runs.map((r) => gpuOf(backend, r))))} | ${int(pick('objects'))} (${int(pick('hidden'))}) |`
        );
      }
    }

    const reference = cases[REFERENCE];
    if (!reference) continue;
    // The noise: the reference's runs against its first, floored at the scene runner's "same
    // image" (its default tolerance): the bridge's snapshots are byte exact, so the runs alone
    // read as no noise, and a proxy's float rounding (another pivot) as a change
    const noise: Record<
      string,
      { runsChanged: number; runsDelta: number; changed: number; delta: number; gpuSpread: number }
    > = {};
    for (const [view, runs] of Object.entries(reference)) {
      const images = runs
        .map((r) => r.image)
        .filter((i): i is NonNullable<ImageDiff> => Boolean(i));
      const gpus = runs.map((r) => gpuOf(backend, r)).filter((g) => !Number.isNaN(g));
      const runsChanged = images.length ? Math.max(...images.map((i) => i.changedRatio)) : NaN;
      const runsDelta = images.length ? Math.max(...images.map((i) => i.meanDelta)) : NaN;
      noise[view] = {
        runsChanged,
        runsDelta,
        changed: Math.max(runsChanged || 0, DEFAULT_SNAPSHOT_TOLERANCE.maxChangedRatio),
        delta: Math.max(runsDelta || 0, DEFAULT_SNAPSHOT_TOLERANCE.maxMeanDelta),
        gpuSpread: gpus.length ? Math.max(...gpus) - Math.min(...gpus) : NaN,
      };
    }
    lines.push(
      `\n${backend}: against ${REFERENCE} (the median of the runs' differences, each run against the reference's run of the same index; the image against the reference's same run)`,
      `| Case | View | Draws saved | CPU frame saved (ms) | its spread | ${gpuLabel} saved | its spread | Image changed (median) | Mean delta (median) |`,
      '| --- | --- | ---: | ---: | --- | ---: | --- | ---: | ---: |'
    );
    for (const [view, n] of Object.entries(noise)) {
      lines.push(
        `| ${REFERENCE} (noise: its runs against its first; the limit, floored at the scene runner's tolerance) | ${view} | | | | | GPU spread ${fmt(n.gpuSpread)} | ${pctOf(n.runsChanged)} (max; limit ${pctOf(n.changed)}) | ${fmt(n.runsDelta, 3)} (max; limit ${fmt(n.delta, 3)}) |`
      );
    }
    const verdicts: string[] = [];
    for (const [name, byView] of Object.entries(cases)) {
      if (name === REFERENCE) continue;
      let cpuViews = 0;
      /** null: no GPU figure to compare */
      let gpuLost: boolean | null = false;
      let imageOut = false;
      for (const [view, runs] of Object.entries(byView)) {
        const refRuns = reference[view] ?? [];
        const pairs = runs.map((r, i) => ({ r, ref: refRuns[i] })).filter((p) => p.ref);
        if (!pairs.length) continue;
        const draws = med(pairs.map((p) => p.ref.split.drawCalls - p.r.split.drawCalls));
        const cpu = pairs.map((p) => p.ref.split.cpuMs - p.r.split.cpuMs);
        const gpu = pairs.map((p) => gpuOf(backend, p.ref) - gpuOf(backend, p.r));
        const changed = med(runs.map((r) => r.image?.changedRatio ?? NaN));
        const delta = med(runs.map((r) => r.image?.meanDelta ?? NaN));
        if (med(cpu) >= 1) cpuViews++;
        const lost = -med(gpu);
        const spread = noise[view]?.gpuSpread ?? NaN;
        if (Number.isNaN(lost) || Number.isNaN(spread)) gpuLost = gpuLost === true ? true : null;
        else if (lost > spread) gpuLost = true;
        if (changed > noise[view]?.changed || delta > noise[view]?.delta) imageOut = true;
        lines.push(
          `| ${name} | ${view} | ${int(draws)} | ${fmt(med(cpu))} | ${range(cpu)} | ${fmt(med(gpu))} | ${range(gpu)} | ${pctOf(changed)} | ${fmt(delta, 3)} |`
        );
      }
      if (name !== 'floor') {
        const views = Object.keys(byView).length;
        const pays = cpuViews >= Math.min(2, views) && gpuLost === false && !imageOut;
        (paysByCase[name] ??= {})[backend] = gpuLost === null && !pays ? null : pays;
        verdicts.push(
          `| ${name} | ${cpuViews} of ${views} | ${gpuLost === null ? 'n/a' : gpuLost ? 'yes' : 'no'} | ${imageOut ? 'no' : 'yes'} | ${pays ? 'yes' : gpuLost === null ? 'n/a (no GPU figure)' : 'no'} |`
        );
      }
    }
    lines.push(
      `\n${backend}: what decides (p377 Phase 0: ≥ 1 ms of CPU frame saved in two of the three views on both backends, no GPU lost beyond the reference's spread, the image inside the reference's noise: the culls and ways 2-4)`,
      `| Case | Views saving ≥ 1 ms CPU | GPU lost beyond the spread | Image inside the noise | Pays here |`,
      '| --- | ---: | --- | --- | --- |',
      ...verdicts
    );

    lines.push(
      `\n${backend}: pages (medians of the runs)`,
      '| Page | Field objects | Load (ms; spread) | Field creation (ms) | Cull sizes (25 / 50 / 75 %, at far) | Rebuilds: over the median frame (ms, median / max) | Rebuild frames | On the worker |',
      '| --- | ---: | --- | ---: | --- | --- | ---: | ---: |'
    );
    for (const [name, runs] of Object.entries(pages)) {
      const loads = runs.map((r) => r.loadMs);
      const sizes = runs.find((r) => r.cullSizes)?.cullSizes;
      const rebuilds = runs.map((r) => r.rebuild).filter((r): r is RebuildResult => Boolean(r));
      const builds = rebuilds.flatMap((r) => r.builds);
      lines.push(
        `| ${name} | ${runs[0].objects !== null ? int(runs[0].objects) : ''} | ${fmt(med(loads), 0)} (${range(loads, 0)}) | ${fmt(med(runs.map((r) => r.createMs ?? NaN)), 1)} | ${sizes ? `${fmt(sizes.quarter, 4)} / ${fmt(sizes.half, 4)} / ${fmt(sizes.threeQuarters, 4)}` : ''} | ${rebuilds.length ? `${fmt(med(builds.map((b) => b.overMs)))} / ${fmt(Math.max(...builds.map((b) => b.overMs)))}` : ''} | ${builds.length ? fmt(med(builds.map((b) => b.frames)), 0) : ''} | ${builds.length ? `${builds.filter((b) => b.onWorker).length} of ${builds.length}` : ''} |`
      );
    }
  }
  const backends = Object.keys(results);
  if (Object.keys(paysByCase).length) {
    lines.push(
      `\nWhat pays (on ${backends.join(' and ')}; the plan asks for both backends)`,
      `| Case | ${backends.join(' | ')} | Pays |`,
      `| --- | ${backends.map(() => '---').join(' | ')} | --- |`
    );
    for (const [name, byBackend] of Object.entries(paysByCase)) {
      const cells = backends.map((b) => byBackend[b]);
      const all = cells.every((c) => c === true) && backends.length >= 2;
      lines.push(
        `| ${name} | ${cells.map((c) => (c === null || c === undefined ? 'n/a' : c ? 'yes' : 'no')).join(' | ')} | ${all ? 'yes' : backends.length < 2 ? 'one backend run' : 'no'} |`
      );
    }
  }
  return lines;
};
