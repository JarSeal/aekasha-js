/**
 * The scene runner's pure parts (`yarn verify:scenes`, `scenes.ts`): its arguments, which scenes
 * and configurations run, a page's URL, and which config entries apply to a run. No file system,
 * no browser: `sceneSelect.test.ts` covers them.
 */
import type { RunResult } from './sceneBaseline';
import {
  DEFAULT_CONFIG_SET,
  VERIFY_BROWSERS,
  VERIFY_CONFIG_SETS,
  VERIFY_CONFIGS,
  type VerifyBrowser,
  type VerifyConfigDef,
  type VerifyConfigName,
} from './scenes.config';

/** `yarn verify:scenes`' arguments */
export type SceneRunArgs = {
  only: string[];
  configs: VerifyConfigName[];
  update: boolean;
  url: string | null;
  webgl: boolean;
  headed: boolean;
  browser: VerifyBrowser;
};

/** The arguments, or the first problem with them (the CLI exits 2 on it) */
export const parseSceneRunArgs = (argv: string[]): { args: SceneRunArgs } | { error: string } => {
  const args: SceneRunArgs = {
    only: [],
    configs: [],
    update: false,
    url: null,
    webgl: false,
    headed: false,
    browser: 'chromium',
  };
  let configArg = DEFAULT_CONFIG_SET;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const needsValue = ['--only', '--config', '--url', '--browser'].includes(arg);
    const value = needsValue ? argv[++i] : undefined;
    if (needsValue && value === undefined) return { error: `${arg} needs a value` };
    if (arg === '--only') args.only.push(...value!.split(','));
    else if (arg === '--config') configArg = value!;
    else if (arg === '--url') args.url = value!;
    else if (arg === '--update') args.update = true;
    else if (arg === '--webgl') args.webgl = true;
    else if (arg === '--headed') args.headed = true;
    else if (arg === '--browser') {
      if (!VERIFY_BROWSERS.includes(value as VerifyBrowser)) {
        return { error: `Unknown browser "${value}" (${VERIFY_BROWSERS.join(', ')})` };
      }
      args.browser = value as VerifyBrowser;
    } else return { error: `Unknown argument: ${arg}` };
  }
  const names = new Set<VerifyConfigName>();
  for (const name of configArg.split(',')) {
    if (VERIFY_CONFIG_SETS[name]) VERIFY_CONFIG_SETS[name].forEach((n) => names.add(n));
    else if (name in VERIFY_CONFIGS) names.add(name as VerifyConfigName);
    else {
      const known = [...Object.keys(VERIFY_CONFIG_SETS), ...Object.keys(VERIFY_CONFIGS)];
      return { error: `Unknown configuration or set "${name}" (${known.join(', ')})` };
    }
  }
  args.configs = [...names];
  if (args.browser === 'firefox') {
    if (args.update) {
      return {
        error:
          "--browser firefox has no baseline of its own: it compares with Chromium's (no --update)",
      };
    }
    const skipped = args.configs.filter((name) => VERIFY_CONFIGS[name].mode !== 'DEBUG');
    args.configs = args.configs.filter((name) => VERIFY_CONFIGS[name].mode === 'DEBUG');
    if (!args.configs.length) {
      return {
        error: `--browser firefox runs the debug configurations only (not ${skipped.join(', ')})`,
      };
    }
  }
  return { args };
};

/** Whether a config entry (`skip`, `unstableHash`, an allowed error) applies to this run; a null
 * `config` matches only entries without `configs` */
export const appliesTo = (
  filter: { configs?: VerifyConfigName[]; browsers?: VerifyBrowser[] },
  config: VerifyConfigName | null,
  browser: VerifyBrowser
) =>
  (!filter.configs || (config !== null && filter.configs.includes(config))) &&
  (!filter.browsers || filter.browsers.includes(browser));

const globToRegExp = (glob: string) =>
  new RegExp(`^${glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);

/** The scenes `--only` picks (ids or globs), in the data's order; all without it. A pattern that
 * matches nothing is an error. */
export const selectScenes = (
  allIds: string[],
  only: string[]
): { ids: string[] } | { error: string } => {
  if (!only.length) return { ids: allIds };
  const selected = new Set<string>();
  for (const pattern of only) {
    const re = globToRegExp(pattern);
    const matches = allIds.filter((id) => re.test(id));
    if (!matches.length) {
      return { error: `--only "${pattern}" matches no scene (${allIds.join(', ')})` };
    }
    matches.forEach((id) => selected.add(id));
  }
  return { ids: allIds.filter((id) => selected.has(id)) };
};

/** A scene's page: the configuration's mode, the test bridge, the start scene and, in the debug
 * mode, the probe's steps */
export const buildSceneUrl = (
  baseUrl: string,
  sceneId: string,
  def: VerifyConfigDef,
  steps: number
) => {
  const params = new URLSearchParams();
  params.set(def.mode === 'DEBUG' ? 'isDebug' : 'isProdTest', 'true');
  params.set('aekTest', 'true');
  params.set('startScene', sceneId);
  if (def.mode === 'DEBUG') params.set('physicsProbe', String(steps));
  return `${baseUrl.replace(/\/$/, '')}/?${params}`;
};

/** A scene's debug configurations should hash alike (p101: deterministic in every target): the
 * hashes per configuration when they don't, else null */
export const checkCrossTargetHashes = (results: RunResult[]) => {
  const hashes = new Map<string, string>();
  for (const r of results) if (r.hash) hashes.set(r.config, r.hash);
  if (new Set(hashes.values()).size <= 1) return null;
  return [...hashes].map(([config, hash]) => `${config} ${hash}`).join(', ');
};
