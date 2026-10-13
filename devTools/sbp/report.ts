/**
 * `yarn sbp`'s report (p611 Phase 1): a profile's build measured (the initial / lazy split, the
 * groups, the feature view, the diff against `bundle.json`) as data for `.cache/sbp/report.json`,
 * and as the lines the command prints.
 */
import { type BundleFinding, diffBundle, formatKB, readBundleBaseline } from './bundleDiff';
import { buildFeatureView } from './bundleFeatures';
import type { CollectedBundle, Size } from './bundleModel';
import { type SplitGroupSize, measureSplitGroups, splitBundle, sumSizes } from './bundleSplit';
import {
  type ModuleGraph,
  type WhyResult,
  answerWhy,
  formatImportChain,
  getEntryModuleId,
  indexModuleGraph,
} from './bundleWhy';
import { APP_ENTRY, type SbpProfile } from './config';

/** Bump when the report's shape changes: Hub pages read it (p611 D9) */
export const REPORT_FORMAT_VERSION = 1;

export type LoadReport = { total: Size; files: Record<string, Size> };

export type FeatureReport = {
  feature: string;
  initialGzip: number;
  lazyGzip: number;
  /** Why it's in the initial chunks, one line (`src/index.ts → aekasha/physics (…) → …`) */
  why: string | null;
  hasDataPart: boolean;
  scenes: string[];
  isUnneededByData: boolean;
};

export type ProfileReport = {
  profile: { id: string; entry: string; scenes: string[] };
  /** What loads before the first frame: the entry chunk, its static imports, their CSS */
  initial: LoadReport;
  /** The rest of `dist/assets/` */
  lazy: LoadReport;
  groups: Record<string, SplitGroupSize>;
  features: FeatureReport[];
  /** Against `devTools/verify/baselines/bundle.json` (the `app` profile only); null without one */
  diff: BundleFinding[] | null;
};

export type SbpReportFile = { formatVersion: number; profiles: Record<string, ProfileReport> };

const pick = (keys: string[], sizes: Record<string, Size>): LoadReport => ({
  total: sumSizes(keys, sizes),
  files: Object.fromEntries(keys.map((key) => [key, sizes[key]])),
});

/** A measured profile and what its `--why` answers need */
export type MeasuredProfile = { report: ProfileReport; graph: ModuleGraph; from: string };

/**
 * Measures a profile's build.
 * @param opts.scenes each of the profile's production scenes' `__features`
 * @param opts.dataFeatures the features a scene manifest can name
 */
export const measureProfile = (opts: {
  profile: SbpProfile;
  collected: CollectedBundle;
  scenes: Record<string, string[]>;
  dataFeatures: readonly string[];
}): MeasuredProfile => {
  const { bundle, manifest, data, fileKeys } = opts.collected;
  const split = splitBundle(manifest, fileKeys);
  const graph = indexModuleGraph(data, split.initialFiles);
  const from = getEntryModuleId(manifest);
  const groups = measureSplitGroups(data, split);
  const features = buildFeatureView({
    graph,
    from,
    groups,
    scenes: opts.scenes,
    dataFeatures: opts.dataFeatures,
  }).map(({ why, ...row }) => ({ ...row, why: why && formatImportChain(why) }));
  const baseline = opts.profile.entry === APP_ENTRY ? readBundleBaseline() : null;
  return {
    report: {
      profile: {
        id: opts.profile.id,
        entry: opts.profile.entry,
        scenes: Object.keys(opts.scenes).sort(),
      },
      initial: pick(split.initial, bundle.chunks),
      lazy: pick(split.lazy, bundle.chunks),
      groups,
      features,
      diff: baseline && diffBundle(baseline, bundle),
    },
    graph,
    from,
  };
};

/** The report file with one profile's report replaced (the others kept) */
export const mergeReport = (file: SbpReportFile | null, report: ProfileReport): SbpReportFile => ({
  formatVersion: REPORT_FORMAT_VERSION,
  profiles: {
    ...(file?.formatVersion === REPORT_FORMAT_VERSION ? file.profiles : {}),
    [report.profile.id]: report,
  },
});

// --- Text ---

export type Colors = { red: string; green: string; yellow: string; dim: string; reset: string };

/** Files listed per load in the text; the rest are summed in one line */
const MAX_FILES = 12;
const KB_WIDTH = 9;

const kb = (bytes: number) => formatKB(bytes).padStart(KB_WIDTH);
/** A size, or a dimmed `-` for none */
const kbOrDash = (bytes: number, c: Colors) =>
  bytes ? kb(bytes) : `${c.dim}${'-'.padStart(KB_WIDTH)}${c.reset}`;

const formatLoad = (title: string, load: LoadReport, c: Colors) => {
  const files = Object.entries(load.files).sort(([, a], [, b]) => b.gzip - a.gzip);
  const width = Math.max(...files.slice(0, MAX_FILES).map(([name]) => name.length), 0);
  const lines = [
    `${title}: ${files.length} file(s), ${formatKB(load.total.gzip)} gzip ${c.dim}(${formatKB(load.total.bytes)})${c.reset}`,
    ...files.slice(0, MAX_FILES).map(([name, size]) => `  ${name.padEnd(width)} ${kb(size.gzip)}`),
  ];
  const rest = files.slice(MAX_FILES);
  if (rest.length) {
    const gzip = rest.reduce((n, [, size]) => n + size.gzip, 0);
    lines.push(`  ${c.dim}… ${rest.length} more, ${formatKB(gzip)}${c.reset}`);
  }
  return lines;
};

/** The groups with code in the initial chunks, largest first (gzip, before minification) */
const formatGroups = (groups: Record<string, SplitGroupSize>, c: Colors) => {
  const rows = Object.entries(groups)
    .filter(([, size]) => size.initial.gzip)
    .sort(([, a], [, b]) => b.initial.gzip - a.initial.gzip);
  const width = Math.max(...rows.map(([name]) => name.length), 5);
  return [
    `groups ${c.dim}(the modules' gzip before minification, as bundle.json counts them)${c.reset}`,
    `  ${''.padEnd(width)} ${'initial'.padStart(KB_WIDTH)} ${'lazy'.padStart(KB_WIDTH)}`,
    ...rows.map(
      ([name, size]) =>
        `  ${name.padEnd(width)} ${kb(size.initial.gzip)} ${kbOrDash(size.lazy.gzip, c)}`
    ),
  ];
};

const formatScenes = (scenes: string[]) =>
  scenes.length > 4 ? `${scenes.slice(0, 4).join(', ')} … (${scenes.length})` : scenes.join(', ');

const formatFeatures = (features: FeatureReport[], c: Colors) => {
  const width = Math.max(...features.map((f) => f.feature.length), 7);
  return [
    `features ${c.dim}(initial, lazy; the scenes whose data needs it; why it's in the initial chunks)${c.reset}`,
    ...features.flatMap((f) => {
      const data = !f.hasDataPart
        ? `${c.dim}code only (no scene data names it)${c.reset}`
        : f.isUnneededByData
          ? `${c.yellow}no scene's data needs it${c.reset} ${c.dim}(code may)${c.reset}`
          : `scenes: ${formatScenes(f.scenes)}`;
      return [
        `  ${f.feature.padEnd(width)} ${kbOrDash(f.initialGzip, c)} ${kbOrDash(f.lazyGzip, c)}  ${data}`,
        ...(f.why ? [`  ${''.padEnd(width)} ${c.dim}${f.why}${c.reset}`] : []),
      ];
    }),
  ];
};

const formatDiff = (diff: BundleFinding[] | null, c: Colors) => {
  if (!diff) return [`diff against bundle.json: ${c.dim}none (the app profile only)${c.reset}`];
  if (!diff.length) return [`diff against bundle.json: ${c.green}unchanged${c.reset}`];
  return [
    `diff against bundle.json ${c.dim}(yarn verify:baselines records it)${c.reset}`,
    ...diff.map((f) => `  ${f.attention ? `${c.red}✗` : `${c.dim}·`} ${f.line}${c.reset}`),
  ];
};

/** The report's text, a line each */
export const formatReport = (report: ProfileReport, c: Colors): string[] => [
  `profile ${report.profile.id}: ${report.profile.entry}, ${report.profile.scenes.length} scene(s)`,
  '',
  ...formatLoad('initial', report.initial, c),
  '',
  ...formatLoad('lazy', report.lazy, c),
  '',
  ...formatGroups(report.groups, c),
  '',
  ...formatFeatures(report.features, c),
  '',
  ...formatDiff(report.diff, c),
];

const LOAD_TEXT = {
  initial: 'code in the initial chunks',
  lazy: 'code in lazy chunks only',
  none: 'no code in the build (tree-shaken, or only re-exports)',
};

/** `--why`'s answer, a line each; `isFound` false when the query matches nothing */
export const formatWhy = (
  measured: MeasuredProfile,
  query: string,
  c: Colors
): { lines: string[]; isFound: boolean } => {
  const { results, tooMany } = answerWhy(measured.graph, measured.from, query);
  if (!results.length) {
    return {
      lines: [`${c.red}why ${query}: no group or module matches${c.reset}`],
      isFound: false,
    };
  }
  const lines = results.flatMap((r: WhyResult) => [
    `${r.target.replace(/^\//, '')}: ${LOAD_TEXT[r.load]}${r.modules.length > 1 ? ` ${c.dim}(${r.modules.length} modules)${c.reset}` : ''}`,
    `  ${r.chain ? formatImportChain(r.chain) : `${c.dim}no import chain from the entry${c.reset}`}`,
  ]);
  if (tooMany.length) {
    lines.push(`${c.dim}… ${tooMany.length} more match: give more of the path${c.reset}`);
  }
  return {
    lines: [`why ${query} ${c.dim}(→ a static import, ⇢ an import())${c.reset}`, ...lines],
    isFound: true,
  };
};
