/**
 * The Smallest Build Possible report and budgets (p611 Phases 1-2):
 *
 *   yarn sbp [--profile <id>] [--no-build] [--why <group | module path>] [--json] [--brief]
 *
 * Builds a profile (`sbp.config.ts`; `app` by default: `yarn build`'s bundle steps, as
 * `yarn verify:baselines` runs them), then reports what loads before the first frame and what
 * loads later, each group's share, each engine feature's size and why it's in the initial chunks
 * (the shortest static import chain from the entry) next to the scenes whose data needs it, and
 * the diff against the committed `devTools/verify/baselines/bundle.json` (`verify:baselines`
 * records it; the diff never fails), then checks the profile's budgets (`sbp.config.ts`).
 *
 * Exits 1 when a budget fails (over it, or a chunk budget with no file in the build), so
 * `yarn build` fails as it does for an asset over its budget; a budget well under is only
 * reported. With `--why` nothing fails but a query that matches nothing (1). Errors exit 2.
 *
 * - `--no-build` measures the last build in `dist/` and `dist-stats/`.
 * - `--why <x>` prints the import chains to a group (`physics`, `kernel/assets`, `three`) or to
 *   the modules a path matches (`PhysicsTiers.ts`), instead of the report.
 * - `--json` prints the profile's report on stdout (the rest goes to the log, errors to stderr).
 * - `--brief` prints only the totals and the budgets (the whole report still goes to the log and
 *   the report file): `yarn build` runs `yarn sbp --no-build --profile app --brief` on the build
 *   it just made (p611 D4).
 * - `AEK_SBP=false` does nothing (`yarn build` without it), as `AEK_HUB=false` for the Hub.
 *
 * Every line also goes to `.cache/sbp/progress.log` (emptied when a run starts), and the report to
 * `.cache/sbp/report.json` (a key per profile, the others kept). `NO_COLOR` turns colours off.
 */
import fs from 'fs';
import path from 'path';
import sbpProfiles from '../sbp.config';
import { ROOT } from './assetPipeline/sources';
import { ENGINE_SCHEMA_PARTS } from './engineSchemas';
import { buildAppBundle } from './sbp/appBuild';
import { isBudgetFailure } from './sbp/budgets';
import { readSceneFeatures } from './sbp/bundleFeatures';
import { collectBundle } from './sbp/bundleModel';
import { APP_ENTRY, checkSbpProfiles } from './sbp/config';
import {
  type Colors,
  type SbpReportFile,
  formatBriefReport,
  formatReport,
  formatWhy,
  measureProfile,
  mergeReport,
} from './sbp/report';
import { out, setProgressLogConsole, setProgressLogFile } from './verify/progressLog';

const LOG_FILE = path.join(ROOT, '.cache/sbp/progress.log');
const REPORT_FILE = path.join(ROOT, '.cache/sbp/report.json');
const APP_DATA_FILE = path.join(ROOT, 'src/generated/generatedAppData.json');

const color = (code: string) => (process.env.NO_COLOR ? '' : `\x1b[${code}m`);
const COLORS: Colors = {
  red: color('31'),
  green: color('32'),
  yellow: color('33'),
  dim: color('2'),
  reset: color('0'),
};

const USAGE =
  'yarn sbp [--profile <id>] [--no-build] [--why <group | module path>] [--json] [--brief]';

const fail = (msg: string): never => {
  out(`${COLORS.red}${msg}${COLORS.reset}`, true);
  process.exit(2);
};

const parseArgs = (argv: string[]) => {
  const args = { profile: 'app', build: true, why: '', json: false, brief: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const next = argv[++i];
      if (!next || next.startsWith('--')) fail(`${arg} needs a value (usage: ${USAGE})`);
      return next;
    };
    if (arg === '--profile') args.profile = value();
    else if (arg === '--no-build') args.build = false;
    else if (arg === '--why') args.why = value();
    else if (arg === '--json') args.json = true;
    else if (arg === '--brief') args.brief = true;
    else fail(`Unknown argument: ${arg} (usage: ${USAGE})`);
  }
  return args;
};

const readJSON = <T>(file: string): T | null => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
  } catch {
    return null;
  }
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (process.env.AEK_SBP === 'false') {
    // eslint-disable-next-line no-console -- no progress log for a run that does nothing
    console.log('[SBP] AEK_SBP=false: not checked');
    return;
  }
  const problems = checkSbpProfiles(sbpProfiles);
  if (problems.length) fail(`sbp.config.ts:\n  ${problems.join('\n  ')}`);
  const profile = sbpProfiles.find((p) => p.id === args.profile);
  if (!profile) {
    fail(
      `No profile ${args.profile} in sbp.config.ts (${sbpProfiles.map((p) => p.id).join(', ')})`
    );
    return;
  }
  // TODO(p611 Phase 4 §2): the embed build
  if (profile.entry !== APP_ENTRY) fail(`Profile ${profile.id}: embeds don't build yet`);

  const watch = setProgressLogFile(LOG_FILE);
  if (args.json) setProgressLogConsole(false);
  out(
    `Smallest Build Possible: profile ${profile.id}${args.build ? '' : ', the last build in dist/'}`
  );
  out(`${COLORS.dim}Watch it: ${watch}${COLORS.reset}\n`);
  const started = Date.now();

  if (args.build) await buildAppBundle();
  const collected = collectBundle();
  // The dev gather (a build ends with it): its debug scenes are left out, as the production
  // gather leaves them out
  const appData = readJSON<Parameters<typeof readSceneFeatures>[0]>(APP_DATA_FILE);
  if (!appData)
    fail(`No gathered data in ${path.relative(ROOT, APP_DATA_FILE)}: yarn gatherAppData`);
  const measured = measureProfile({
    profile,
    collected,
    scenes: readSceneFeatures(appData!, profile.scenes),
    dataFeatures: ENGINE_SCHEMA_PARTS.map((part) => part.feature),
  });

  fs.mkdirSync(path.dirname(REPORT_FILE), { recursive: true });
  fs.writeFileSync(
    REPORT_FILE,
    `${JSON.stringify(mergeReport(readJSON<SbpReportFile>(REPORT_FILE), measured.report), null, 2)}\n`
  );

  const why = args.why ? formatWhy(measured, args.why, COLORS) : null;
  const report = formatReport(measured.report, COLORS);
  if (why) {
    for (const line of why.lines) out(line);
  } else if (args.brief) {
    // The whole report into the log only, the brief one on the console only
    setProgressLogConsole(false);
    for (const line of report) out(line);
    setProgressLogConsole(!args.json);
    for (const line of args.json ? [] : formatBriefReport(measured.report, COLORS)) {
      // eslint-disable-next-line no-console -- already in the log, as part of the report
      console.log(line);
    }
  } else {
    for (const line of report) out(line);
  }
  out(
    `\n${COLORS.green}Done${COLORS.reset} in ${((Date.now() - started) / 1000).toFixed(1)} s; the report: ${path.relative(ROOT, REPORT_FILE)}`
  );
  // eslint-disable-next-line no-console -- the one line on stdout with --json
  if (args.json) console.log(JSON.stringify(measured.report, null, 2));
  if (why) {
    if (!why.isFound) process.exit(1);
    return;
  }
  const failed = measured.report.budgets?.filter(isBudgetFailure).length ?? 0;
  if (failed) {
    out(`${COLORS.red}✗ ${failed} budget(s) of profile ${profile.id} failed${COLORS.reset}`, true);
    process.exit(1);
  }
};

main().catch((err: Error) => fail(`yarn sbp stopped: ${err.message}`));
