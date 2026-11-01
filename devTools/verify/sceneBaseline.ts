/**
 * The scene runner's baselines and results (`yarn verify:scenes`, `scenes.ts`): the files under
 * `.cache/verify/scenes/<backend>/` (local: snapshots depend on the GPU, the driver and the
 * backend), what a run records into them, and the lookups Firefox's run compares with.
 */
import fs from 'fs';
import path from 'path';
import { ROOT } from '../paths';
import { writeFileAtomic } from '../files';
import type { TestBridgeSystemOrder, TestBridgeTabOrder } from '../../src/_engine/debug/TestBridge';
import type { VerifyConfigName } from './scenes.config';
import type { DebuggerAxeCounts } from './debuggerChecks';

/** Bump when the baseline file's shape changes: an old one then stops a run (`readBaseline`) */
export const BASELINE_FORMAT_VERSION = 1;
/** The runner's folder: a baseline and a last run per backend, Firefox's last run */
export const SCENES_CACHE_DIR = path.join(ROOT, '.cache/verify/scenes');

/** The backend a page rendered on, which keys its baseline */
export type Backend = 'webgpu' | 'webgl';
/** A folder under `.cache/verify/scenes/`: Chromium's per backend, Firefox's for its last run */
export type ResultDir = Backend | 'firefox';

/** A run recorded as good: what the next runs compare with */
export type BaselineEntry = {
  hash?: string;
  steps?: number;
  /** The characters' path hash over the probe's steps (p610 D6) */
  pathHash?: string;
  pathSteps?: number;
  probeConfig?: string;
  /** File name in the baseline folder */
  snapshot?: string;
  /** Every world's systems per stage once the scene ran (p607) */
  systemOrder?: TestBridgeSystemOrder;
  /** The `debugger` configuration's (p806 D14): each tab host's tab ids in menu order, */
  tabOrder?: TestBridgeTabOrder;
  /** its shots' files in the baseline folder (`debuggerShotFile`), */
  debuggerShots?: string[];
  /** and axe's violations per shot */
  axe?: DebuggerAxeCounts;
  recordedAt: string;
  commit: string;
};

/** A backend's `baseline.json`: an entry per scene and configuration (`runKey`) */
export type BaselineFile = {
  formatVersion: number;
  entries: Record<string, BaselineEntry>;
};

export type RunStatus = 'PASS' | 'FAIL' | 'NEW' | 'UPDATED' | 'SKIPPED';

/** One page load's result: a scene in a configuration */
export type RunResult = {
  sceneId: string;
  config: VerifyConfigName;
  status: RunStatus;
  failures: string[];
  warnings: string[];
  notes: string[];
  errors: string[];
  hash?: string;
  steps?: number;
  pathHash?: string;
  pathSteps?: number;
  probeConfig?: string;
  snapshotFile?: string;
  systemOrder?: TestBridgeSystemOrder;
  tabOrder?: TestBridgeTabOrder;
  debuggerShots?: string[];
  axe?: DebuggerAxeCounts;
  durationMs: number;
};

/** A result folder's files */
export type ResultPaths = {
  baselineFile: string;
  baselineDir: string;
  lastRunFile: string;
  lastRunDir: string;
};

/** A result folder's files, under `cacheDir` (the runner's own by default) */
export const getResultPaths = (resultDir: ResultDir, cacheDir = SCENES_CACHE_DIR): ResultPaths => {
  const dir = path.join(cacheDir, resultDir);
  return {
    baselineFile: path.join(dir, 'baseline.json'),
    baselineDir: path.join(dir, 'baseline'),
    lastRunFile: path.join(dir, 'last-run.json'),
    lastRunDir: path.join(dir, 'last-run'),
  };
};

/** A baseline entry's key: a scene in a configuration */
export const runKey = (sceneId: string, config: VerifyConfigName) => `${sceneId}|${config}`;
/** A snapshot's file name in the last run's and the baseline's folders */
export const snapshotFileName = (sceneId: string, config: VerifyConfigName) =>
  `${sceneId}.${config}.png`;

/** A JSON file's content; null when it's missing or doesn't parse */
export const readJSON = <T>(file: string): T | null => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
  } catch {
    return null;
  }
};

/**
 * Stops the whole run, not one page (a baseline it can't compare with): the run so far is written
 * and the browser and server closed before the exit (2)
 */
export class RunAbort extends Error {}

/**
 * A baseline file; empty when there's none (every run is NEW). One that's there but unreadable or
 * of another format stops the run (p619 §1.4 V2: it read as none, so every run was NEW and
 * passed), unless `--update` records a new one over it: then `problem` says what was wrong.
 * @throws {@link RunAbort} for a bad file when not recording
 */
export const readBaseline = (
  baselineFile: string,
  isRecording: boolean
): { baseline: BaselineFile; problem: string | null } => {
  const empty = { formatVersion: BASELINE_FORMAT_VERSION, entries: {} };
  if (!fs.existsSync(baselineFile)) return { baseline: empty, problem: null };
  const file = readJSON<BaselineFile>(baselineFile);
  const problem = !file
    ? "isn't readable JSON"
    : file.formatVersion !== BASELINE_FORMAT_VERSION
      ? `is format ${String(file.formatVersion)}, this runner reads ${BASELINE_FORMAT_VERSION}`
      : null;
  if (!problem) return { baseline: file!, problem: null };
  const where = path.relative(ROOT, baselineFile);
  if (isRecording)
    return { baseline: empty, problem: `${where} ${problem}: --update records a new one` };
  throw new RunAbort(
    `${where} ${problem}. Record a new one: yarn verify:scenes --update (on main)`
  );
};

/** The baselines a run reads, each on first use (`getBaseline`) */
export type BaselineContext = {
  /** `--update`: nothing is compared, and a bad baseline is recorded over */
  isRecording: boolean;
  baselines: Map<Backend, BaselineFile>;
  /** Told what was wrong with a baseline `--update` records over */
  onProblem: (problem: string) => void;
  cacheDir?: string;
};

/** A backend's baseline, read on first use */
export const getBaseline = (ctx: BaselineContext, backend: Backend) => {
  let baseline = ctx.baselines.get(backend);
  if (!baseline) {
    const read = readBaseline(getResultPaths(backend, ctx.cacheDir).baselineFile, ctx.isRecording);
    if (read.problem) ctx.onProblem(read.problem);
    baseline = read.baseline;
    ctx.baselines.set(backend, baseline);
  }
  return baseline;
};

/** What Firefox compares with: Chromium's entry with a hash, the `webgl` file's first */
export const getChromiumEntry = (ctx: BaselineContext, key: string) => {
  for (const backend of ['webgl', 'webgpu'] as const) {
    const entry = getBaseline(ctx, backend).entries[key];
    if (entry?.hash) return { entry, backend };
  }
  return null;
};

/** The runs both Chromium baselines hashed, at the same steps, with different hashes. Any means
 * the hash depends on the render backend, and Firefox (WebGL2) should compare with `webgl` only */
export const findBackendHashMismatches = (ctx: BaselineContext) => {
  const webgpu = getBaseline(ctx, 'webgpu').entries;
  const mismatches: string[] = [];
  let shared = 0;
  for (const [key, gl] of Object.entries(getBaseline(ctx, 'webgl').entries)) {
    const gpu = webgpu[key];
    if (!gl.hash || !gpu?.hash || gl.steps !== gpu.steps) continue;
    shared++;
    if (gl.hash !== gpu.hash) mismatches.push(`${key} webgl ${gl.hash}, webgpu ${gpu.hash}`);
  }
  return { shared, mismatches };
};

/**
 * Records the runs that passed or were new into the baseline (merged: the other entries stay),
 * each snapshot and debugger shot copied from the last run's folder, and marks them `UPDATED`;
 * writes the file atomically.
 * @param now the entries' `recordedAt`
 */
export const recordBaseline = (opts: {
  paths: ResultPaths;
  baseline: BaselineFile;
  results: RunResult[];
  commit: string;
  now: string;
}) => {
  const { paths, baseline } = opts;
  fs.mkdirSync(paths.baselineDir, { recursive: true });
  for (const r of opts.results) {
    if (r.status !== 'PASS' && r.status !== 'NEW') continue;
    const entry: BaselineEntry = { recordedAt: opts.now, commit: opts.commit };
    if (r.hash) Object.assign(entry, { hash: r.hash, steps: r.steps, probeConfig: r.probeConfig });
    if (r.pathHash) Object.assign(entry, { pathHash: r.pathHash, pathSteps: r.pathSteps });
    if (r.systemOrder) entry.systemOrder = r.systemOrder;
    if (r.tabOrder) entry.tabOrder = r.tabOrder;
    if (r.axe) entry.axe = r.axe;
    if (r.debuggerShots) {
      for (const file of r.debuggerShots) {
        fs.mkdirSync(path.dirname(path.join(paths.baselineDir, file)), { recursive: true });
        fs.copyFileSync(path.join(paths.lastRunDir, file), path.join(paths.baselineDir, file));
      }
      entry.debuggerShots = r.debuggerShots;
    }
    if (r.snapshotFile) {
      fs.copyFileSync(
        path.join(paths.lastRunDir, r.snapshotFile),
        path.join(paths.baselineDir, r.snapshotFile)
      );
      entry.snapshot = r.snapshotFile;
    }
    baseline.entries[runKey(r.sceneId, r.config)] = entry;
    r.status = 'UPDATED';
  }
  writeFileAtomic(paths.baselineFile, `${JSON.stringify(baseline, null, 2)}\n`);
};
