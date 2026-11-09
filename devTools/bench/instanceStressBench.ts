/**
 * The instance stress bench's pure parts (`instanceStress.ts`, p354 Phase 1 step 7): its
 * arguments, a case's URL, the averages and the tables. No browser, no file system:
 * `instanceStressBench.test.ts` covers them.
 */

/** What draws the forest: instanced LOD pools or an instance set (`?stressPath=`) */
export type BenchPath = 'cpu' | 'gpu';

/** The page's mode: the debug env (every readout, the stats panels' GPU figures included) or
 * prod test mode (closer to production: no stats panels, so no GPU figures) */
export type BenchMode = 'debug' | 'prodTest';

/** `npx tsx devTools/bench/instanceStress.ts`' arguments */
export type BenchArgs = {
  counts: number[];
  paths: BenchPath[];
  mode: BenchMode;
  /** A running server's root (a dev server, or a served build), else its own */
  url: string | null;
  /** Serves `dist/` (a `yarn build:test` build) instead of a dev server */
  build: boolean;
  shadow: boolean;
  /** `?stressFadeSeconds=`; null: the scene's (the global setting) */
  fadeSeconds: number | null;
  /** The orbit holds until the measuring starts it: every path sees the same camera path */
  orbitHold: boolean;
  camera: 'ORBIT' | 'STILL';
  warmupFrames: number;
  frames: number;
  headed: boolean;
  webgl: boolean;
  /** Writes the results there too, as JSON */
  json: string | null;
};

/** Phase 0's counts */
export const DEFAULT_BENCH_COUNTS = [5_000, 20_000, 50_000, 100_000, 200_000];
/** The scene's own cap (`instanceStress.ts`' MAX_COUNT) */
export const MAX_BENCH_COUNT = 1_000_000;

const toCount = (text: string) => {
  const match = /^(\d+(?:\.\d+)?)([km]?)$/i.exec(text.trim());
  if (!match) return NaN;
  const scale = { '': 1, k: 1_000, m: 1_000_000 }[match[2].toLowerCase() as '' | 'k' | 'm'];
  return Math.round(Number(match[1]) * scale);
};

/** The arguments, or the first problem with them */
export const parseBenchArgs = (argv: string[]): { args: BenchArgs } | { error: string } => {
  const args: BenchArgs = {
    counts: DEFAULT_BENCH_COUNTS,
    paths: ['cpu', 'gpu'],
    mode: 'debug',
    url: null,
    build: false,
    shadow: false,
    fadeSeconds: null,
    orbitHold: false,
    camera: 'ORBIT',
    warmupFrames: 120,
    frames: 300,
    headed: false,
    webgl: false,
    json: null,
  };
  const withValue = [
    '--counts',
    '--paths',
    '--mode',
    '--url',
    '--fade-seconds',
    '--camera',
    '--warmup',
    '--frames',
    '--json',
  ];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = withValue.includes(arg) ? argv[++i] : undefined;
    if (withValue.includes(arg) && value === undefined) return { error: `${arg} needs a value` };
    if (arg === '--counts') {
      const counts = value!.split(',').map(toCount);
      const bad = counts.find((n) => !(n >= 1 && n <= MAX_BENCH_COUNT));
      if (bad !== undefined) return { error: `--counts: 1 to ${MAX_BENCH_COUNT} each (${value})` };
      args.counts = counts;
    } else if (arg === '--paths') {
      const paths = value!.split(',');
      if (!paths.every((p) => p === 'cpu' || p === 'gpu')) {
        return { error: `--paths: cpu, gpu or both (${value})` };
      }
      args.paths = paths as BenchPath[];
    } else if (arg === '--mode') {
      if (value !== 'debug' && value !== 'prodTest') {
        return { error: `--mode: debug or prodTest (${value})` };
      }
      args.mode = value;
    } else if (arg === '--camera') {
      if (value !== 'ORBIT' && value !== 'STILL') {
        return { error: `--camera: ORBIT or STILL (${value})` };
      }
      args.camera = value;
    } else if (arg === '--fade-seconds') {
      const seconds = Number(value);
      if (!(seconds >= 0)) return { error: `--fade-seconds: 0 or more (${value})` };
      args.fadeSeconds = seconds;
    } else if (arg === '--warmup' || arg === '--frames') {
      const frames = Number(value);
      if (!Number.isInteger(frames) || frames < (arg === '--frames' ? 1 : 0)) {
        return { error: `${arg}: a whole number of frames (${value})` };
      }
      if (arg === '--warmup') args.warmupFrames = frames;
      else args.frames = frames;
    } else if (arg === '--url') args.url = value!;
    else if (arg === '--json') args.json = value!;
    else if (arg === '--build') args.build = true;
    else if (arg === '--shadow') args.shadow = true;
    else if (arg === '--orbit-hold') args.orbitHold = true;
    else if (arg === '--headed') args.headed = true;
    else if (arg === '--webgl') args.webgl = true;
    else return { error: `Unknown argument: ${arg}` };
  }
  if (args.build && args.url) return { error: '--build serves dist/ itself: not with --url' };
  return { args };
};

/** One measured case */
export type BenchCase = { count: number; path: BenchPath };

/** A case's page: the mode, the test bridge (its fixed frame delta: the same camera path on every
 * run), the scene and its flags */
export const buildBenchUrl = (baseUrl: string, args: BenchArgs, c: BenchCase) => {
  const params = new URLSearchParams();
  params.set(args.mode === 'debug' ? 'isDebug' : 'isProdTest', 'true');
  params.set('aekTest', 'true');
  params.set('startScene', 'instanceStress');
  params.set('stressInstances', String(c.count));
  params.set('stressPath', c.path);
  params.set('stressCamera', args.camera);
  if (args.shadow) params.set('stressShadow', 'true');
  if (args.fadeSeconds !== null) params.set('stressFadeSeconds', String(args.fadeSeconds));
  if (args.orbitHold) params.set('stressOrbitHold', 'true');
  return `${baseUrl.replace(/\/$/, '')}/?${params}`;
};

/** The pool path's entity cap past which a world fails to load (`VITE_ECS_MAX_ENTITIES`): what a
 * case of `count` trees needs, the camera and the level meshes included; 0 when the default does */
export const getNeededMaxEntities = (cases: BenchCase[]) => {
  const largest = Math.max(0, ...cases.filter((c) => c.path === 'cpu').map((c) => c.count));
  return largest > 90_000
    ? Math.ceil((Math.ceil((largest * 11) / 10) + 10_000) / 1_000) * 1_000
    : 0;
};

/** The mean of the samples that are numbers (NaN: a figure the panel showed as n/a), NaN for none */
export const averageSamples = (samples: number[]) => {
  const valid = samples.filter((n) => Number.isFinite(n));
  return valid.length ? valid.reduce((sum, n) => sum + n, 0) / valid.length : NaN;
};

/** What the scene's `measure()` returns, the fields the bench reads */
export type StressSummary = {
  count: number;
  path: string;
  backend: string;
  avg: Record<'poolSyncMs' | 'lodMs' | 'renderMs' | 'cpuMs' | 'intervalMs', number>;
  levels: number[];
  overflow?: number[];
  /** The set's other cameras (a shadow, a viewport): each one's drawn copies per level */
  cameras?: { name: string; drawn: number[] }[];
  state?: { levels: number[]; culled: number; fading: number };
  builds: { nodeBuilds: number; pipelines: number; vertex: number; fragment: number };
};

/** A case's result: the scene's summary, the GPU figures sampled from the stats panels, and the
 * page's errors */
export type BenchResult = BenchCase & {
  summary: StressSummary | null;
  gpuMs: number;
  computeMs: number;
  errors: string[];
  failure?: string;
};

const ms = (n: number | undefined) => (n !== undefined && Number.isFinite(n) ? n.toFixed(2) : '—');
const counts = (list: number[] | undefined) =>
  list?.length ? list.map((n) => n.toLocaleString('en-US')).join(' / ') : '—';

const table = (header: string[], rows: string[][], rightFrom: number) => {
  const lines = [`| ${header.join(' | ')} |`];
  lines.push(`| ${header.map((_, i) => (i >= rightFrom ? '---:' : '---')).join(' | ')} |`);
  for (const row of rows) lines.push(`| ${row.join(' | ')} |`);
  return lines;
};

/** Phase 0's tables, as Markdown: the cost per case, then the levels per case (drawn, and every
 * instance's state, the parity check's) */
export const formatBenchTables = (results: BenchResult[]) => {
  const ok = results.filter((r) => r.summary);
  const cost = table(
    [
      'Trees',
      'Path',
      'CPU frame',
      'Pool sync',
      'LOD systems',
      'Render submit',
      'GPU frame',
      'Compute',
    ],
    ok.map((r) => {
      const s = r.summary!;
      return [
        r.count.toLocaleString('en-US'),
        s.path,
        `${ms(s.avg.cpuMs)} ms`,
        `${ms(s.avg.poolSyncMs)} ms`,
        `${ms(s.avg.lodMs)} ms`,
        `${ms(s.avg.renderMs)} ms`,
        Number.isFinite(r.gpuMs) ? `${ms(r.gpuMs)} ms` : '—',
        Number.isFinite(r.computeMs) ? `${ms(r.computeMs)} ms` : '—',
      ];
    }),
    2
  );
  const levels = table(
    [
      'Trees',
      'Path',
      'Drawn (per level)',
      'Other cameras: drawn',
      'Overflow',
      'State (per level)',
      'Culled',
      'Fading',
      'Builds',
    ],
    ok.map((r) => {
      const s = r.summary!;
      const { nodeBuilds, pipelines } = s.builds;
      return [
        r.count.toLocaleString('en-US'),
        s.path,
        counts(s.levels),
        s.cameras?.length ? s.cameras.map((c) => `${c.name}: ${counts(c.drawn)}`).join('; ') : '—',
        s.overflow ? counts(s.overflow) : '—',
        counts(s.state?.levels),
        s.state ? s.state.culled.toLocaleString('en-US') : '—',
        s.state ? s.state.fading.toLocaleString('en-US') : '—',
        `${nodeBuilds} nodes, ${pipelines} pipelines`,
      ];
    }),
    2
  );
  return [...cost, '', ...levels];
};
