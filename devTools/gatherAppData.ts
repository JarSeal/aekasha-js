/**
 * The data pipeline (`yarn gatherAppData`, and the dev server's `sceneGathererPlugin`): the asset
 * JSONs under `src/` gathered into the generated data (`src/generated/`). Its steps are in
 * `devTools/gather/`: pass 1 reads and registers every asset JSON (`registries.ts`,
 * `textures.ts`), the scene pass resolves each scene's lists against them (`scenePass.ts`,
 * `sceneAssets.ts`), a production build checks the shipped outputs (`shipChecks.ts`), and
 * `output.ts` writes the app's and each embed profile's files.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import sbpProfiles from '../sbp.config';
import type { PipelineRun } from './assetPipeline/run';
import { createSettingsResolver } from './assetPipeline/settings';
import { isUnoptimizedAllowed, loadProjectOptOut } from './assetPipeline/switches';
import { listGatheredFiles, type GatherContext } from './gather/context';
import { writeJsonSchemas } from './gather/jsonSchemas';
import { createGatherLog, type GatherLog } from './gather/log';
import {
  getEmbedProfiles,
  PROFILES_DIR_NAME,
  removeStaleProfileOutputs,
  selectProfileOutput,
  writeGeneratedOutput,
  type GeneratedOutput,
} from './gather/output';
import { readRegistries } from './gather/registries';
import { resolveScenes } from './gather/scenePass';
import { createShipChecks } from './gather/shipChecks';
import { ROOT, SRC_DIR } from './paths';
import { checkSbpProfiles, type SbpProfile } from './sbp/config';

/** A gather's options; each defaults to the repo's own */
export type GatherOptions = {
  /** An asset pipeline run over the same JSONs (p300 §5): each texture and imported asset gets
   * its output's `__url` and figures, per scene when a scene's save entry points at another file.
   * Without one, they get none. */
  pipeline?: PipelineRun;
  /** The SBP profiles (`sbp.config.ts` when omitted): each embed profile gets its own data in
   * `<outDir>/profiles/<id>/` (p611 D7), and a folder no profile writes is removed. */
  profiles?: readonly SbpProfile[];
  /** A production build's data (default: `NODE_ENV` is `production`) */
  isProduction?: boolean;
  /** The folder gathered (default `src/`); `__sourcePath`s are relative to its parent */
  srcDir?: string;
  /** The output folder (default `<srcDir>/generated`) */
  outDir?: string;
};

/** How a gather went */
export type GatherResult = {
  /** False when a problem was logged: nothing was written */
  isGathered: boolean;
  /** The generated files written (one whose content didn't change isn't, p619 §1.4 G7) and the
   * profile folders removed */
  changedFiles: string[];
};

const FAILED: GatherResult = { isGathered: false, changedFiles: [] };

/**
 * Each embed profile's output (p611 D7), selected from the app's; null when `sbp.config.ts` is
 * invalid or a profile names a scene the data doesn't ship (the problems are logged), which fails
 * the gather as an invalid asset does.
 */
const getProfileOutputs = (
  log: GatherLog,
  profiles: readonly SbpProfile[],
  app: GeneratedOutput,
  debugSceneIds: ReadonlySet<string>
): [string, GeneratedOutput][] | null => {
  const problems = checkSbpProfiles(profiles);
  const outputs: [string, GeneratedOutput][] = [];
  if (!problems.length) {
    for (const profile of getEmbedProfiles(profiles)) {
      const { output, errors } = selectProfileOutput({ profile, app, debugSceneIds });
      problems.push(...errors);
      outputs.push([profile.id, output]);
    }
  }
  if (!problems.length) return outputs;
  log.error('sbp.config.ts:');
  log.details(...problems.map((problem) => `  ${problem}`));
  return null;
};

/** The gather after its context: the passes, the checks, and the writes when nothing failed */
const runGather = (ctx: GatherContext, opts: GatherOptions, outDir: string): GatherResult => {
  const { log, isProduction } = ctx;
  const reg = readRegistries(ctx);
  const ship = createShipChecks(ctx);
  const { scenes, debugSceneIds } = resolveScenes(ctx, reg, ship);
  ship.report();
  if (log.hasError) return FAILED;

  // The app's output (a production build's only the scenes), then each embed profile's
  const appOutput: GeneratedOutput = {
    json: isProduction
      ? { scenes }
      : {
          scenes,
          cameras: reg.cameras,
          lights: reg.lights,
          geometries: reg.geometries,
          textures: { ...reg.textures, ...reg.textureArrays, ...reg.atlasSlots },
          materials: reg.materials,
          meshes: reg.meshes,
          importedAssets: reg.importedAssets,
          skyboxes: reg.skyboxes,
          postFx: reg.postFx,
          impostors: reg.impostors,
        },
    loaders: reg.loaders,
  };
  const profileOutputs = getProfileOutputs(
    log,
    opts.profiles ?? sbpProfiles,
    appOutput,
    debugSceneIds
  );
  if (!profileOutputs) return FAILED;
  const profilesDir = path.join(outDir, PROFILES_DIR_NAME);
  const written = writeGeneratedOutput(outDir, appOutput, ctx.srcDir);
  for (const [id, output] of profileOutputs) {
    written.push(...writeGeneratedOutput(path.join(profilesDir, id), output, ctx.srcDir));
  }
  const removed = removeStaleProfileOutputs(
    profilesDir,
    profileOutputs.map(([id]) => id)
  );

  log.done(
    `Consolidated ${ctx.files.scene.length} scene configurations (${isProduction ? 'prod' : 'dev'})${written.length || removed.length ? '' : ', the generated data unchanged'}.`
  );
  for (const [id, output] of profileOutputs) {
    const sceneIds = Object.keys(output.json.scenes);
    log.done(
      `Profile ${id}: ${sceneIds.length} scene(s) (${sceneIds.join(', ')}) in ${path.relative(ROOT, path.join(profilesDir, id))}/`
    );
  }
  if (removed.length) {
    log.done(
      `Removed the data of the profile(s) sbp.config.ts no longer lists: ${removed.join(', ')}`
    );
  }
  return {
    isGathered: true,
    changedFiles: [...written, ...removed.map((id) => path.join(profilesDir, id))],
  };
};

/**
 * Gathers the asset JSONs into the generated data. Writes nothing when anything failed (every
 * problem is logged), so the dev server keeps the page as it was, and only the files whose
 * content changed otherwise.
 */
export const gatherSceneData = (opts: GatherOptions = {}): GatherResult => {
  const isProduction = opts.isProduction ?? process.env.NODE_ENV === 'production';
  const srcDir = opts.srcDir ?? SRC_DIR;
  const log = createGatherLog();
  // Validates assets.config.json (p300); its errors stop the gather like an asset's would
  let resolveSettings: GatherContext['resolveSettings'];
  try {
    resolveSettings = createSettingsResolver();
  } catch (err) {
    log.error((err as Error).message);
    return FAILED;
  }
  try {
    const ctx: GatherContext = {
      isProduction,
      srcDir,
      rootDir: path.dirname(srcDir),
      pipeline: opts.pipeline,
      log,
      resolveSettings,
      files: listGatheredFiles(srcDir),
    };
    return runGather(ctx, opts, opts.outDir ?? path.join(srcDir, 'generated'));
  } catch (err) {
    log.error(`Error gathering scene data (${isProduction ? 'production' : 'development'}):`);
    log.details(String((err as Error).stack ?? err));
    return FAILED;
  }
};

/**
 * `yarn gatherAppData` (before `dev` and `build`): the asset pipeline's cached run (p300), then
 * the gather with its outputs. It builds what isn't in the cache, but never removes stale outputs:
 * that's `yarn assets`' full run. A run that can't start (an invalid `assets.lock.json`) gathers
 * nothing, so the generated data keeps its `__url`s.
 *
 * In production (`yarn build`), a failed gather exits 1 and stops the build, and so does an asset
 * a shipped scene uses without an output or over its budget. `AEK_ASSETS_ALLOW_UNOPTIMIZED=true`
 * ships the ones that lack `ktx` unoptimized instead.
 */
const gatherWithAssetPipeline = async () => {
  writeJsonSchemas();
  const { runAssetsCommand } = await import('./assetPipeline/command');
  const isProduction = process.env.NODE_ENV === 'production';
  let pipeline: PipelineRun;
  try {
    ({ run: pipeline } = await runAssetsCommand({
      projectOptOut: await loadProjectOptOut(),
      verbosity: 'brief',
      isUnoptimizedFallback: isProduction && isUnoptimizedAllowed(),
    }));
  } catch (err) {
    // eslint-disable-next-line no-console -- the command's own log
    console.error(`\x1b[31m✗ [Assets] ${(err as Error).message}\x1b[0m`);
    process.exitCode = 1;
    return;
  }
  if (!gatherSceneData({ pipeline }).isGathered && isProduction) process.exitCode = 1;
};

// Run as a script (`yarn gatherAppData`), not when imported
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void gatherWithAssetPipeline();
}
