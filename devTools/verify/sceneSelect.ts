/**
 * The scene runner's pure parts (`yarn verify:scenes`, `scenes.ts`): its arguments, which scenes
 * and configurations run, a page's URL, and which config entries apply to a run. No file system,
 * no browser: `sceneSelect.test.ts` covers them.
 */
import type { RunResult } from './sceneBaseline';
import {
  DEFAULT_CONFIG_SET,
  SCENE_VERIFY_CONFIG,
  VERIFY_BROWSERS,
  VERIFY_CONFIG_SETS,
  VERIFY_CONFIGS,
  type SceneVerifyConfig,
  type VerifyBrowser,
  type VerifyConfigDef,
  type VerifyConfigName,
} from './scenes.config';

/** Whether a configuration runs the debugger checks (p806 D14) */
const isDebuggerConfig = (name: VerifyConfigName) =>
  Boolean((VERIFY_CONFIGS[name] as VerifyConfigDef).debugger);

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
    // The debugger configuration's hash is mainThread's, and its checks are Chromium's
    const isHashRun = (name: VerifyConfigName) =>
      VERIFY_CONFIGS[name].mode === 'DEBUG' && !isDebuggerConfig(name);
    const skipped = args.configs.filter((name) => !isHashRun(name));
    args.configs = args.configs.filter(isHashRun);
    if (!args.configs.length) {
      return {
        error: `--browser firefox runs the debug configurations' hashes only (not ${skipped.join(', ')})`,
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

/** Between a scene's id and its variant's in a run's name (`instanceStress@set`) */
export const VARIANT_SEPARATOR = '@';

/** The URL parameters the runner sets itself, which a scene's `params` can't replace */
const RUNNER_PARAMS = new Set(['isDebug', 'isProdTest', 'aekTest', 'startScene', 'physicsProbe']);

/** What the runner loads: a scene, or one of its variants (`SceneVerifyConfig.variants`) */
export type SceneTarget = {
  /** The run's name: the scene's id, or `<sceneId>@<variant>` (its results and baselines) */
  id: string;
  sceneId: string;
  /** Its URL parameters: the scene's `params` and the variant's */
  params: Record<string, string>;
};

/** The scene a run's name (`RunResult.sceneId`) is of */
export const getTargetSceneId = (id: string) => id.split(VARIANT_SEPARATOR)[0];

/** A run's scene settings: its scene's, which every variant shares */
export const getSceneVerifyConfig = (id: string): SceneVerifyConfig | undefined =>
  SCENE_VERIFY_CONFIG[getTargetSceneId(id)];

/** A scene's runs: one, or one per variant. Throws on a bad variant id or a runner parameter. */
export const getSceneTargets = (
  sceneId: string,
  sceneConfig: SceneVerifyConfig | undefined
): SceneTarget[] => {
  const base = sceneConfig?.params ?? {};
  const variants = sceneConfig?.variants;
  const targets: SceneTarget[] = variants?.length
    ? variants.map((variant) => {
        if (!/^[\w-]+$/.test(variant.id)) {
          throw new Error(
            `scenes.config.ts: ${sceneId}'s variant id "${variant.id}" isn't [\\w-]+`
          );
        }
        return {
          id: `${sceneId}${VARIANT_SEPARATOR}${variant.id}`,
          sceneId,
          params: { ...base, ...variant.params },
        };
      })
    : [{ id: sceneId, sceneId, params: { ...base } }];
  const ids = new Set(targets.map((t) => t.id));
  if (ids.size !== targets.length)
    throw new Error(`scenes.config.ts: ${sceneId} repeats a variant id`);
  for (const target of targets) {
    const taken = Object.keys(target.params).filter((key) => RUNNER_PARAMS.has(key));
    if (taken.length) {
      throw new Error(`scenes.config.ts: ${target.id} sets the runner's own ${taken.join(', ')}`);
    }
  }
  return targets;
};

/** The runs `--only` picks (ids or globs, matching a scene's id, so all its variants, or a run's
 * own name), in the data's order; all without it. A pattern that matches nothing is an error. */
export const selectTargets = (
  targets: SceneTarget[],
  only: string[]
): { targets: SceneTarget[] } | { error: string } => {
  if (!only.length) return { targets };
  const selected = new Set<string>();
  for (const pattern of only) {
    const re = globToRegExp(pattern);
    const matches = targets.filter((t) => re.test(t.id) || re.test(t.sceneId));
    if (!matches.length) {
      const names = [...new Set(targets.flatMap((t) => [t.sceneId, t.id]))];
      return { error: `--only "${pattern}" matches no scene (${names.join(', ')})` };
    }
    matches.forEach((t) => selected.add(t.id));
  }
  return { targets: targets.filter((t) => selected.has(t.id)) };
};

/** The configurations a scene runs in: the `debugger` ones only on a scene with `debugger`
 * settings (p806 D14), so the others don't print a skipped line each */
export const getSceneConfigs = (
  configs: VerifyConfigName[],
  sceneConfig: SceneVerifyConfig | undefined
) => configs.filter((name) => !isDebuggerConfig(name) || Boolean(sceneConfig?.debugger));

/** A run's page: the configuration's mode, the test bridge, the start scene, the run's own
 * parameters and, in the debug mode, the probe's steps */
export const buildSceneUrl = (
  baseUrl: string,
  target: Pick<SceneTarget, 'sceneId' | 'params'>,
  def: VerifyConfigDef,
  steps: number
) => {
  const params = new URLSearchParams();
  params.set(def.mode === 'DEBUG' ? 'isDebug' : 'isProdTest', 'true');
  params.set('aekTest', 'true');
  params.set('startScene', target.sceneId);
  for (const [key, value] of Object.entries(target.params)) {
    if (!RUNNER_PARAMS.has(key)) params.set(key, value);
  }
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
