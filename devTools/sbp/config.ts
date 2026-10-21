import fs from 'fs';
import path from 'path';
import { ROOT } from '../paths';
/**
 * `yarn sbp`'s profiles (p611 D2), listed in `sbp.config.ts` at the repo root: what a build holds,
 * which scenes it serves and the budgets it must stay within: the template app's full-page build,
 * and the embeds (Phase 4), each a module that binds the app's parts and exports the mount (D7).
 */

/** A kibibyte, for budgets written as `400 * KIB` */
export const KIB = 1024;

/**
 * A profile's budgets, each in gzip bytes. Over one fails `yarn sbp` (and so `yarn build`); under
 * one by more than {@link isWellUnderBudget}'s margin is reported, so a budget is tightened when a
 * build shrinks instead of leaving room for the next growth.
 */
export type SbpBudgets = {
  /** What loads before the first frame: the entry chunk, its static imports and their CSS (the
   * report's `initial.total`, the files' gzip) */
  initial?: number;
  /** A file of the build's `assets/` by its key (`assets/index.js`, as `bundle.json` names it), or
   * an embed's entry (`banner.embed.js`), initial or lazy; a key with no file in the build fails
   * too */
  chunks?: Record<string, number>;
  /** A group's modules in the initial chunks (`three`, `_engine/features/physics`, `app`: the
   * report's groups, the modules' gzip before minification); a group with no code there is 0 */
  groups?: Record<string, number>;
  /** The modules under a path from `src/` in the initial chunks, a file
   * (`_engine/ui/icons/BuiltInIcons.ts`) or a folder ending in `/`, measured as the groups are:
   * for what a group is too coarse for */
  modules?: Record<string, number>;
};

/** A build `yarn sbp` measures */
export type SbpProfile = {
  /** `--profile <id>`, and the key of `.cache/sbp/report.json` */
  id: string;
  /** The build's entry from the repo root: `src/index.html` is the template app's `yarn build`;
   * any other is an embed, a `.ts` module under `src/` (`src/app/profiles/banner/banner.embed.ts`) */
  entry: string;
  /** The scene ids it serves (their `__features` go next to the feature view). The app's are all
   * when omitted; an embed lists its own, and the gatherer writes only those into its data
   * (`src/generated/profiles/<id>/`, the first is the mount's default scene) */
  scenes?: string[];
  /** None checked when omitted */
  budgets?: SbpBudgets;
};

/** The app's full-page build, its every scene: what `yarn build` makes */
export const APP_ENTRY = 'src/index.html';

/** Under a budget by more than this share of it (and by {@link WELL_UNDER_MIN_BYTES}) is
 * reported */
export const WELL_UNDER_RATIO = 0.1;
/** Keeps a small budget's normal headroom from being reported */
export const WELL_UNDER_MIN_BYTES = 2 * KIB;

/** Whether a size is far enough under its budget to report that the budget can be tightened */
export const isWellUnderBudget = (size: number, budget: number) =>
  budget - size > Math.max(budget * WELL_UNDER_RATIO, WELL_UNDER_MIN_BYTES);

const isDir = (file: string) => !!fs.statSync(file, { throwIfNoEntry: false })?.isDirectory();

/**
 * Whether a `groups` key names a group the report can have (`getModuleGroup`): its fixed groups,
 * an installed package, or an engine folder (a kernel or features subfolder). A typo measured 0
 * and always passed (p619 §1.4 B3).
 */
const isPossibleGroup = (key: string) => {
  if (['vite', 'other', 'app', 'toolkit', '_engine'].includes(key)) return true;
  const parts = key.split('/');
  if (parts[0] === '_engine') {
    const isNested = parts[1] === 'kernel' || parts[1] === 'features';
    if (parts.length > (isNested ? 3 : 2)) return false;
    return isDir(path.join(ROOT, 'src', ...parts));
  }
  return fs.existsSync(path.join(ROOT, 'node_modules', key, 'package.json'));
};

/** Whether a `modules` key is a file, or a folder written with its `/`, under `src/` */
const isExistingModulePath = (key: string) => {
  const file = path.join(ROOT, 'src', ...key.split('/'));
  return key.endsWith('/') ? isDir(file) : !!fs.statSync(file, { throwIfNoEntry: false })?.isFile();
};

const isBudget = (value: unknown) =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

const checkBudgets = (id: string, budgets: SbpBudgets): string[] => {
  const problems: string[] = [];
  const at = `profile ${id}: budgets`;
  if (budgets.initial !== undefined && !isBudget(budgets.initial)) {
    problems.push(`${at}.initial: a whole number of bytes, 0 or more`);
  }
  const keyRules: Record<'chunks' | 'groups' | 'modules', [RegExp, string]> = {
    chunks: [/^(?:assets\/)?[^/\s]+$/, "a file of assets/, or an embed's entry (assets/index.js)"],
    groups: [/^[^/\s](?:\S*[^/\s])?$/, 'a group (three, _engine/features/physics)'],
    modules: [/^[^/\s.][^\s]*$/, 'a path from src/ (_engine/ui/icons/ or …/BuiltInIcons.ts)'],
  };
  for (const [kind, [pattern, text]] of Object.entries(keyRules)) {
    for (const [key, value] of Object.entries(budgets[kind as keyof typeof keyRules] ?? {})) {
      if (!pattern.test(key)) {
        problems.push(`${at}.${kind} ${JSON.stringify(key)}: ${text}`);
      } else if (kind === 'groups' && !isPossibleGroup(key)) {
        problems.push(
          `${at}.groups ${JSON.stringify(key)}: no such group (a package in node_modules/, an engine folder, app, toolkit, vite, other)`
        );
      } else if (kind === 'modules' && !isExistingModulePath(key)) {
        problems.push(
          `${at}.modules ${JSON.stringify(key)}: no such file or folder under src/ (a folder ends in /)`
        );
      }
      if (!isBudget(value)) {
        problems.push(`${at}.${kind} ${key}: a whole number of bytes, 0 or more`);
      }
    }
  }
  return problems;
};

/** Checks the profiles' shape; returns the problems, one line each */
export const checkSbpProfiles = (profiles: readonly SbpProfile[]): string[] => {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const profile of profiles) {
    if (!/^[a-z][A-Za-z0-9-]*$/.test(profile.id)) {
      problems.push(`profile id ${JSON.stringify(profile.id)}: a letter, then letters, digits, -`);
    }
    if (ids.has(profile.id)) problems.push(`profile ${profile.id} listed twice`);
    ids.add(profile.id);
    if (profile.entry !== APP_ENTRY) {
      if (!/^src\/[^\s]+\.ts$/.test(profile.entry) || profile.entry.includes('..')) {
        problems.push(
          `profile ${profile.id}: entry ${JSON.stringify(profile.entry)}: ${APP_ENTRY}, or an embed's .ts module under src/`
        );
      }
      if (!profile.scenes?.length) {
        problems.push(`profile ${profile.id}: an embed lists its scenes (scenes: ['<sceneId>'])`);
      }
    }
    const scenes = profile.scenes ?? [];
    if (new Set(scenes).size !== scenes.length) {
      problems.push(`profile ${profile.id}: a scene listed twice`);
    }
    if (profile.budgets) problems.push(...checkBudgets(profile.id, profile.budgets));
  }
  return problems;
};
