/**
 * The Smallest Build Possible report and budgets (p611 Phases 1-2, embeds Phase 4):
 *
 *   yarn sbp [--profile <id>[,<id>…] | all] [--no-build | --no-app-build]
 *            [--why <group | module path>] [--json] [--brief]
 *
 * Builds the profiles (`sbp.config.ts`; `app` by default, on one production gather: `yarn build`'s bundle steps, as
 * `yarn verify:baselines` runs them; an embed into `dist-embed/<id>/`, `sbp/embedBuild.ts`), then
 * reports what loads before the first frame and what loads later, each group's share, each engine
 * feature's size and why it's in the initial chunks (the shortest static import chain from the
 * entry) next to the scenes whose data needs it, and the diff against the profile's committed
 * baseline (`devTools/verify/baselines/bundle.json`, an embed's `bundle.<id>.json`;
 * `verify:baselines` records them; the diff never fails), then checks the profile's budgets.
 *
 * Exits 1 when a budget fails (over it, or a chunk budget with no file in the build), so
 * `yarn build` fails as it does for an asset over its budget; a budget well under is only
 * reported. With `--why` nothing fails but a query that matches nothing (1). Errors exit 2.
 *
 * - `--profile` takes a profile, several (`app,banner`) or `all`.
 * - `--no-build` measures the profiles' last builds (`dist/`, `dist-embed/<id>/`);
 *   `--no-app-build` measures the app's and builds the embeds: `yarn build` runs
 *   `yarn sbp --profile all --no-app-build --brief` on the app it just built (p611 D4).
 * - `--why <x>` prints the import chains to a group (`physics`, `kernel/assets`, `three`) or to
 *   the modules a path matches (`PhysicsTiers.ts`), instead of the report.
 * - `--json` prints the profile's report on stdout (the rest goes to the log, errors to stderr).
 *   `--why` and `--json` take one profile.
 * - `--brief` prints only the totals and the budgets (the whole report still goes to the log and
 *   the report file).
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
import { buildBundles } from './sbp/appBuild';
import { isBudgetFailure } from './sbp/budgets';
import { readSceneFeatures } from './sbp/bundleFeatures';
import { APP_BUILD, collectBundle } from './sbp/bundleModel';
import { getEmbedBuildLocation } from './sbp/embedBuild';
import { APP_ENTRY, checkSbpProfiles, type SbpProfile } from './sbp/config';
import { getEmbedProfiles } from './gatherOutput';
import {
  type Colors,
  type ProfileReport,
  type SbpReportFile,
  formatBriefReport,
  formatReport,
  formatWhy,
  measureProfile,
  mergeReport,
  SBP_REPORT_FILE,
} from './sbp/report';
import { out, setProgressLogConsole, setProgressLogFile } from './verify/progressLog';

const LOG_FILE = path.join(ROOT, '.cache/sbp/progress.log');
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
  'yarn sbp [--profile <id>[,<id>…] | all] [--no-build | --no-app-build] [--why <group | module path>] [--json] [--brief]';

const fail = (msg: string): never => {
  out(`${COLORS.red}${msg}${COLORS.reset}`, true);
  process.exit(2);
};

const parseArgs = (argv: string[]) => {
  const args = {
    profile: 'app',
    build: true,
    isAppBuilt: false,
    why: '',
    json: false,
    brief: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const next = argv[++i];
      if (!next || next.startsWith('--')) fail(`${arg} needs a value (usage: ${USAGE})`);
      return next;
    };
    if (arg === '--profile') args.profile = value();
    else if (arg === '--no-build') args.build = false;
    else if (arg === '--no-app-build') args.isAppBuilt = true;
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

/** The profiles `--profile` names (a list, or `all`), in `sbp.config.ts`' order */
const selectProfiles = (query: string) => {
  if (query === 'all') return sbpProfiles;
  const ids = query.split(',').filter(Boolean);
  const unknown = ids.filter((id) => !sbpProfiles.some((p) => p.id === id));
  if (unknown.length) {
    fail(
      `No profile ${unknown.join(', ')} in sbp.config.ts (${sbpProfiles.map((p) => p.id).join(', ')})`
    );
  }
  return sbpProfiles.filter((p) => ids.includes(p.id));
};

/** Measures a profile's last build and writes its report into the report file */
const measure = (profile: SbpProfile, appData: Parameters<typeof readSceneFeatures>[0]) => {
  const isApp = profile.entry === APP_ENTRY;
  const measured = measureProfile({
    profile,
    collected: collectBundle(isApp ? APP_BUILD : getEmbedBuildLocation(profile.id)),
    scenes: readSceneFeatures(appData, profile.scenes),
    dataFeatures: ENGINE_SCHEMA_PARTS.map((part) => part.feature),
  });
  fs.mkdirSync(path.dirname(SBP_REPORT_FILE), { recursive: true });
  fs.writeFileSync(
    SBP_REPORT_FILE,
    `${JSON.stringify(mergeReport(readJSON<SbpReportFile>(SBP_REPORT_FILE), measured.report), null, 2)}\n`
  );
  return measured;
};

/** The report's lines; with `--brief` the whole report into the log only, the brief one on the
 * console only */
const printReport = (report: ProfileReport, args: ReturnType<typeof parseArgs>) => {
  const lines = formatReport(report, COLORS);
  if (!args.brief) {
    for (const line of lines) out(line);
    return;
  }
  setProgressLogConsole(false);
  for (const line of lines) out(line);
  setProgressLogConsole(!args.json);
  for (const line of args.json ? [] : formatBriefReport(report, COLORS)) {
    // eslint-disable-next-line no-console -- already in the log, as part of the report
    console.log(line);
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
  const profiles = selectProfiles(args.profile);
  if ((args.why || args.json) && profiles.length !== 1) {
    fail(`--why and --json take one profile (usage: ${USAGE})`);
  }

  const watch = setProgressLogFile(LOG_FILE);
  if (args.json) setProgressLogConsole(false);
  const ids = profiles.map((p) => p.id).join(', ');
  out(
    `Smallest Build Possible: ${profiles.length > 1 ? 'profiles' : 'profile'} ${ids}${args.build ? (args.isAppBuilt ? ", the app's last build" : '') : ', the last builds'}`
  );
  out(`${COLORS.dim}Watch it: ${watch}${COLORS.reset}\n`);
  const started = Date.now();

  if (args.build) {
    const isApp = !args.isAppBuilt && profiles.some((p) => p.entry === APP_ENTRY);
    const embedIds = getEmbedProfiles(profiles).map((p) => p.id);
    if (isApp || embedIds.length) await buildBundles({ isApp, embedIds });
  }
  // The dev gather (a build ends with it): its debug scenes are left out, as the production
  // gather leaves them out
  const appData = readJSON<Parameters<typeof readSceneFeatures>[0]>(APP_DATA_FILE);
  if (!appData)
    fail(`No gathered data in ${path.relative(ROOT, APP_DATA_FILE)}: yarn gatherAppData`);

  let failed = 0;
  let isWhyFound = true;
  for (const [index, profile] of profiles.entries()) {
    if (index) out('');
    const measured = measure(profile, appData!);
    if (args.why) {
      const why = formatWhy(measured, args.why, COLORS);
      for (const line of why.lines) out(line);
      isWhyFound = why.isFound;
    } else {
      printReport(measured.report, args);
    }
    // eslint-disable-next-line no-console -- the one line on stdout with --json
    if (args.json) console.log(JSON.stringify(measured.report, null, 2));
    const profileFailed = measured.report.budgets?.filter(isBudgetFailure).length ?? 0;
    if (profileFailed && !args.why) {
      out(
        `${COLORS.red}✗ ${profileFailed} budget(s) of profile ${profile.id} failed${COLORS.reset}`,
        true
      );
      failed += profileFailed;
    }
  }
  out(
    `\n${COLORS.green}Done${COLORS.reset} in ${((Date.now() - started) / 1000).toFixed(1)} s; the report: ${path.relative(ROOT, SBP_REPORT_FILE)}`
  );
  if (!isWhyFound || failed) process.exit(1);
};

main().catch((err: Error) => fail(`yarn sbp stopped: ${err.message}`));
