import path from 'path';
import type { Plugin, ViteDevServer } from 'vite';
import type { AppConfig } from 'aekasha';
import { AEK_GATHER_EVENT, type DevDataGatheredEvent } from '../src/_engine/debug/DevFilesProtocol';
import { runAssetsCommand } from './assetPipeline/command';
import { AEK_ASSETS_DIR } from './assetPipeline/outputs';
import {
  listAssetJsonFiles,
  listAssetSourceFiles,
  type PipelineAsset,
} from './assetPipeline/pipeline';
import type { PipelineRun, PipelineRunResult } from './assetPipeline/run';
import { ASSETS_CONFIG_FILE } from './assetPipeline/settings';
import { CONFIG_FILE, resolveProjectOptOut, type ProjectOptOut } from './assetPipeline/switches';
import { DEV_FILES_TEMP_SUFFIX } from './devFiles/commit';
import { gatherSceneData } from './gatherAppData';
import { createWorkQueue } from './workQueue';
import { isGatheredJsonFile } from './gather/gatheredJson';
import { writeJsonSchemas } from './gather/jsonSchemas';
import { GENERATED_DIR, ROOT } from './paths';

/**
 * The dev server's gatherer (`yarn dev`): re-gathers the generated data when an asset JSON is
 * added, changed or deleted, and runs the asset pipeline (p300) first when what it reads changed:
 * - an asset JSON (`*.texture.json`, `*.importedAsset.json`, `*.textureArray.json`,
 *   `*.textureAtlas.json`): its assets are built, and the arrays and atlas slots that have one of
 *   its textures as a layer or a cell;
 * - a source file of an asset (a pack's files and a .gltf's external files too): the assets that
 *   read it are built;
 * - `assets.config.json`, or the switches in `src/CONFIG.ts` (`assets.optimization`, loaded
 *   through Vite: Node can't import .ts): every asset is built, which is a cache hit for those
 *   whose settings didn't change.
 * Every other asset is only looked up in the cache, so the gather keeps its `__url`. A run never
 * removes stale outputs (`yarn assets` does). Changes are queued (`devTools/workQueue.ts`): one run
 * at a time, and the changes that come in during a run go into the next one.
 *
 * Each gather ends with the custom HMR event `aek:gather` (`DevDataGatheredEvent`: how it went,
 * the changed files, whether a reload follows), before the `full-reload`. The page reloads only
 * when the gather changed the generated data, or a source file changed (one served as it is
 * changes no `__url`). The dev files' client delivers the event to `onDevDataGathered` (p342
 * §2.5); Vite's client handles the reload only after its listeners have settled.
 */

const ASSET_JSON_SUFFIXES = [
  '.texture.json',
  '.importedAsset.json',
  '.textureArray.json',
  '.textureAtlas.json',
];

/** Lets a burst of saves (eg. a debug tool writing several JSONs) go into one run */
const DEBOUNCE_MS = 100;

/** What a run does, folded from the file events since the last one */
type PendingWork = {
  /** Changed asset JSONs and source files: the assets that read them are built */
  files: Set<string>;
  /** Every asset is built (its settings may have changed) */
  isAllSelected: boolean;
  /** The pipeline runs before the gather */
  needsRun: boolean;
  /** src/CONFIG.ts changed: reload the switches, and run with all assets if they differ */
  isSwitchesCheck: boolean;
  needsGather: boolean;
  /** A source file changed: the page reloads even when the generated data didn't */
  hasSourceChange: boolean;
  /** Every file whose event queued this work, for the `aek:gather` event */
  changedFiles: Set<string>;
};

const createPendingWork = (): PendingWork => ({
  files: new Set(),
  isAllSelected: false,
  needsRun: false,
  isSwitchesCheck: false,
  needsGather: false,
  hasSourceChange: false,
  changedFiles: new Set(),
});

/** What the plugin keeps between runs */
type GathererState = {
  /** The last pipeline run, which the gather reads (null until the first) */
  lastRun: PipelineRun | null;
  /** Every file the last run's assets read, so a change to one of them can be told apart */
  sourceFiles: Set<string>;
  /** `assets.optimization` as src/CONFIG.ts had it at the last check */
  projectOptOut: ProjectOptOut | null;
  /** A file that comes or goes may be what the failed gather missed */
  isLastGatherFailed: boolean;
  /** Vite's error overlay is up: the next clean gather reloads, which closes it */
  hasErrorOverlay: boolean;
};

const listRunSourceFiles = (run: PipelineRun) => {
  const files = new Set<string>();
  for (const { asset } of run.results.values()) {
    try {
      for (const file of listAssetSourceFiles(asset)) files.add(file);
    } catch {
      // A pack's missing source: the gather reports it, and the file's 'add' re-runs it
    }
  }
  return files;
};

const sendError = (server: ViteDevServer, state: GathererState, message: string, stack: string) => {
  state.hasErrorOverlay = true;
  server.ws.send({
    type: 'error',
    err: { message, stack, plugin: 'vite-plugin-scene-gatherer' },
  });
};

const toAssetErrors = (errors: PipelineRunResult[]) =>
  errors.map((result) => ({
    id: result.asset.id,
    reason: 'reason' in result ? result.reason : '',
  }));

const sendGatherEvent = (
  server: ViteDevServer,
  work: PendingWork,
  event: Omit<DevDataGatheredEvent, 'files'>
) => {
  const data: DevDataGatheredEvent = {
    ...event,
    files: [...work.changedFiles].map((file) =>
      path.relative(ROOT, file).split(path.sep).join('/')
    ),
  };
  server.hot.send({ type: 'custom', event: AEK_GATHER_EVENT, data });
};

/**
 * What a file event adds to the pending work, or null when the gather doesn't care: its own
 * outputs, the pipeline's, a dev files commit's temporary, and any file no asset reads.
 */
const getWorkUpdate = (
  state: GathererState,
  event: 'add' | 'change' | 'unlink',
  file: string
): ((work: PendingWork) => void) | null => {
  if (file.startsWith(GENERATED_DIR + path.sep)) return null; // The profiles' too
  if (file.startsWith(AEK_ASSETS_DIR + path.sep)) return null;
  if (file.endsWith(DEV_FILES_TEMP_SUFFIX)) return null; // A commit renames it into place
  if (file === CONFIG_FILE) return (work) => (work.isSwitchesCheck = true);
  if (file === ASSETS_CONFIG_FILE) {
    return (work) => (work.needsRun = work.isAllSelected = work.needsGather = true);
  }
  if (ASSET_JSON_SUFFIXES.some((suffix) => file.endsWith(suffix))) {
    return (work) => {
      work.files.add(file);
      work.needsRun = work.needsGather = true;
    };
  }
  if (isGatheredJsonFile(file)) return (work) => (work.needsGather = true);
  if (state.sourceFiles.has(file) || (event !== 'change' && state.isLastGatherFailed)) {
    // A source changed, or a file came or went that the failed gather may have missed
    return (work) => {
      work.files.add(file);
      work.needsRun = work.needsGather = work.hasSourceChange = true;
    };
  }
  return null;
};

/** One queued run: the switches check, the pipeline, then the gather and its events */
const createWorkRunner = (server: ViteDevServer, state: GathererState) => {
  const configUrl = `/${path.relative(server.config.root, CONFIG_FILE).split(path.sep).join('/')}`;

  /** The switches as src/CONFIG.ts has them now; true when they changed */
  const reloadProjectOptOutAsync = async () => {
    const { moduleGraph } = server.environments.ssr;
    for (const mod of moduleGraph.getModulesByFile(CONFIG_FILE) ?? []) {
      moduleGraph.invalidateModule(mod);
    }
    const module = (await server.ssrLoadModule(configUrl)) as { default: AppConfig };
    const next = resolveProjectOptOut(module.default.assets?.optimization);
    const isChanged =
      !!state.projectOptOut && JSON.stringify(next) !== JSON.stringify(state.projectOptOut);
    state.projectOptOut = next;
    return isChanged;
  };

  const runPipelineAsync = async (work: PendingWork) => {
    const previous = state.lastRun;
    const isSelected = (key: string, asset: PipelineAsset) => {
      // The first run only looks up: `yarn dev` built everything just before
      if (!previous) return false;
      if (work.isAllSelected || !previous.results.has(key)) return true;
      if (listAssetJsonFiles(asset).some((file) => work.files.has(file))) return true;
      try {
        return listAssetSourceFiles(asset).some((file) => work.files.has(file));
      } catch {
        return true; // processAsset reports it
      }
    };
    const result = await runAssetsCommand({
      projectOptOut: state.projectOptOut ?? {},
      isSelected,
      verbosity: 'brief',
      isQuietWhenUpToDate: true,
    });
    state.lastRun = result.run;
    state.sourceFiles = listRunSourceFiles(result.run);
    return result.errors;
  };

  const gather = (work: PendingWork, run: PipelineRun, assetErrors: PipelineRunResult[]) => {
    const { isGathered, changedFiles } = gatherSceneData({ pipeline: run });
    state.isLastGatherFailed = !isGathered;
    if (!isGathered) {
      sendGatherEvent(server, work, {
        status: 'failed',
        assetErrors: toAssetErrors(assetErrors),
        willReload: false,
        message: 'The gather failed: check the terminal for its errors',
      });
      sendError(
        server,
        state,
        '[Scene Pipeline Error] Consolidation Failed',
        'Check the terminal for the gatherer’s errors.'
      );
      return;
    }
    if (assetErrors.length) {
      // The gather is done (the asset falls back to its source), but the error needs a look.
      // Vite reloads the page if the generated data changed: nothing accepts it
      const errors = toAssetErrors(assetErrors);
      sendGatherEvent(server, work, {
        status: 'done',
        assetErrors: errors,
        willReload: changedFiles.length > 0,
      });
      const message = errors.map(({ id, reason }) => `${id}: ${reason}`).join('\n');
      sendError(server, state, '[Asset Pipeline Error] An asset failed', message);
      return;
    }
    // An error overlay from an earlier run closes with the reload, also when the fix gave the
    // data as it was
    const willReload = changedFiles.length > 0 || work.hasSourceChange || state.hasErrorOverlay;
    sendGatherEvent(server, work, { status: 'done', assetErrors: [], willReload });
    if (!willReload) return;
    state.hasErrorOverlay = false;
    server.hot.send({ type: 'full-reload' });
  };

  return async (work: PendingWork) => {
    if (!state.projectOptOut || work.isSwitchesCheck) {
      if ((await reloadProjectOptOutAsync()) && state.lastRun) {
        const reasons = [...new Set(Object.values(state.projectOptOut ?? {}))];
        // eslint-disable-next-line no-console -- the plugin's log
        console.log(
          `[Assets] assets.optimization changed in src/CONFIG.ts: ${reasons.length ? `off (${reasons.join('; ')})` : 'all on'}, every asset runs again`
        );
        work.needsRun = work.isAllSelected = work.needsGather = true;
      }
    }
    let assetErrors: PipelineRunResult[] = [];
    if (work.needsRun || (work.needsGather && !state.lastRun)) {
      try {
        assetErrors = await runPipelineAsync(work);
      } catch (err) {
        // An invalid assets.lock.json or assets.config.json: the generated data stays as it is,
        // and the next file that comes or goes runs again (p619 §1.4 G9)
        const message = (err as Error).message;
        // eslint-disable-next-line no-console -- the plugin's log
        console.error(`\x1b[31m✗ [Assets] ${message}\x1b[0m`);
        if (work.needsGather) {
          state.isLastGatherFailed = true;
          sendGatherEvent(server, work, {
            status: 'failed',
            assetErrors: [],
            willReload: false,
            message: `The asset pipeline could not start: ${message}`,
          });
        }
        sendError(server, state, '[Asset Pipeline Error] The run could not start', message);
        return;
      }
    }
    if (work.needsGather && state.lastRun) gather(work, state.lastRun, assetErrors);
  };
};

/** The dev server's gatherer plugin (see the module's comment) */
export const sceneGathererPlugin = (): Plugin => ({
  name: 'vite-plugin-scene-gatherer',
  apply: 'serve',
  configureServer(server) {
    // On each (re)start: a schema change restarts the server (it's a config dependency)
    writeJsonSchemas();
    // The repo root isn't watched (the Vite root is src/)
    server.watcher.add(ASSETS_CONFIG_FILE);

    const state: GathererState = {
      lastRun: null,
      sourceFiles: new Set(),
      projectOptOut: null,
      isLastGatherFailed: false,
      hasErrorOverlay: false,
    };
    const queue = createWorkQueue({
      create: createPendingWork,
      runAsync: createWorkRunner(server, state),
      onError: (err, work) => {
        // eslint-disable-next-line no-console -- the plugin's log
        console.error('\x1b[31m✗ [Scene Gatherer]\x1b[0m', err);
        if (!work.needsGather) return;
        state.isLastGatherFailed = true;
        sendGatherEvent(server, work, {
          status: 'failed',
          assetErrors: [],
          willReload: false,
          message: `The gatherer failed: ${(err as Error).message}`,
        });
      },
      debounceMs: DEBOUNCE_MS,
    });
    server.httpServer?.once('close', queue.close);

    const handleFileEvent = (event: 'add' | 'change' | 'unlink') => (filePath: string) => {
      const file = path.resolve(filePath);
      const update = getWorkUpdate(state, event, file);
      if (!update) return;
      queue.schedule((work) => {
        update(work);
        work.changedFiles.add(file);
      });
    };
    server.watcher.on('add', handleFileEvent('add')); // New files created or moved into src
    server.watcher.on('change', handleFileEvent('change')); // Saves
    server.watcher.on('unlink', handleFileEvent('unlink')); // Deleted, moved out or renamed

    // Looks every asset up once (it builds nothing), so the first change has a run to gather with
    queue.schedule((work) => (work.needsRun = true));
  },
});
