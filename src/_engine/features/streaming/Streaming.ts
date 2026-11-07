// World streaming's runtime (p353): the current scene's cell machine (StreamingCells.ts), the
// focus it measures from, the scenes' settings, the system that decides and pumps it, and the
// scene hooks that load the cells around the focus inside a scene load and drop them on its exit.
// The streaming() feature (StreamingFeature.ts) installs it.
import * as THREE from 'three/webgpu';
import { countReleasedAssets, releaseCellOwnedAssets } from '../../kernel/assets/SceneAssetRelease';
import { getMainCamera } from '../../kernel/camera/Camera';
import { IS_DEBUG_ENV, IS_PROD_TEST_MODE } from '../../kernel/config/Config';
import { isDeterminismProbeArmed } from '../../kernel/config/DeterminismProbe';
import {
  type DebugModuleRef,
  loadDebugModuleAsync,
  useDebug,
} from '../../kernel/config/DebugModules';
import { DEFAULT_ECS_WORLD_ID, type ECSWorld, getECSWorld } from '../../kernel/ecs/ECS';
import type { FeatureContext } from '../../kernel/init/Features';
import { ECSSystemStage } from '../../kernel/loop/SystemStages';
import type { SceneHooks } from '../../kernel/scene/SceneHooks';
import type {
  StreamingBudgets,
  StreamingFader,
  StreamingPrimer,
  StreamingRuntime,
} from './StreamingCells';
import {
  type StreamingCellContent,
  STREAMING_CONTENT_RANGES,
  addStreamingCellContent,
  clearSceneStreamingContent,
  isStreamingCellKey,
  removeStreamingCellContent,
} from './StreamingContent';
import type { StreamingDataContent } from './StreamingDataContent';
import type { StreamingManifest } from './StreamingManifest';
import type { StreamingPrimeBudgets } from './StreamingPriming';
import type { SceneStreamingSettings } from './StreamingSchema';
import {
  DEFAULT_STREAMING_FADE_SECONDS,
  getStreamingSettingsProblem,
  resolveStreamingSettings,
} from './StreamingSettings';
import { lwarn } from '../../utils/Logger';

/**
 * What the streaming cells measure their distance from: an entity (its `TRANSFORM` position), or
 * a point read at every decision (a `THREE.Vector3` you keep moving works). Only x and z count.
 */
export type StreamingFocus = number | { readonly x: number; readonly z: number };

const DEFAULT_UPDATE_INTERVAL_FRAMES = 10;
const DEFAULT_MAX_CONCURRENT_LOADS = 2;
const DEFAULT_MAX_CREATE_MS_PER_FRAME = 2;
const DEFAULT_MAX_PRIME_MS_PER_FRAME = 2;

let isInstalled = false;
let updateIntervalFrames = DEFAULT_UPDATE_INTERVAL_FRAMES;
const budgets: StreamingBudgets = {
  maxConcurrentLoads: DEFAULT_MAX_CONCURRENT_LOADS,
  maxCreateMsPerFrame: DEFAULT_MAX_CREATE_MS_PER_FRAME,
};
const primeBudgets: StreamingPrimeBudgets = {
  maxPrimeMsPerFrame: DEFAULT_MAX_PRIME_MS_PER_FRAME,
  maxNewStructuresPerFrame: null,
};
/** The cells' machine (StreamingCells.ts and its layers), loaded with the first scene that streams
 * (p353 Phase 5 D12: a build's first download carries the API and the hooks, not the machine) */
type StreamingMachine = typeof import('./StreamingCells');
let machine: StreamingMachine | null = null;
/** Primes the layers streamed in during play (StreamingPriming.ts, loaded with the machine), its
 * budgets read every frame */
let primer: StreamingPrimer | null = null;
/** Fades the layers' entities in and out (StreamingFades.ts, loaded with the machine) */
let fader: StreamingFader | null = null;
/** The fade a scene's settings leave out: `AppConfig.lod.fadeSeconds`, read at the install */
let defaultFadeSeconds = DEFAULT_STREAMING_FADE_SECONDS;

/** The gathered scenes' settings, by scene id */
const dataSettings = new Map<string, SceneStreamingSettings>();
/** Settings set in code, by scene id: over the data's; null turns a scene's streaming off */
const codeSettings = new Map<string, SceneStreamingSettings | null>();
/** The gathered scenes' cell manifests (their JSON cell content), by scene id */
const manifests = new Map<string, StreamingManifest>();
/** The current scene's JSON cell content, or null */
let dataContent: StreamingDataContent | null = null;
let hasWarnedBuildTimeFields = false;

let focus: StreamingFocus | null = null;
/** The debug tools' focus (frozen, teleported, `?streamingFocus`): over `focus` while set */
let focusOverride: { x: number; z: number } | null = null;
let runtime: StreamingRuntime | null = null;
/** The cells the last exit dropped: released after a load of the same scene (SceneLoader releases
 * nothing then), once the cells it loads again have claimed what they share */
let droppedCells: { sceneId: string; keys: number[] } | null = null;
let isSceneLoading = false;
let framesToDecision = 0;

const now = () => performance.now();

/** A runtime's release of one of its cells' layers' assets */
const createCellRelease = (sceneId: string) => (cellKey: number, layer?: string) =>
  countReleasedAssets(releaseCellOwnedAssets(sceneId, cellKey, layer));

/** A cell's owner key layers (`StreamingLayers.ts`' layers: near, far, kept) */
const CELL_OWNER_LAYERS = [undefined, 'far', 'kept'] as const;

/** After a load of the scene the last exit dropped cells of: releases the dropped cells it didn't
 * load again (a cell loaded again keeps its owner key, for its own next unload). Another scene's
 * load has SceneLoader release them with their scene. */
const releaseDroppedCells = (sceneId: string) => {
  const dropped = droppedCells;
  droppedCells = null;
  if (dropped?.sceneId !== sceneId) return;
  for (const key of dropped.keys) {
    if (runtime?.cells.has(key)) continue;
    for (const layer of CELL_OWNER_LAYERS) releaseCellOwnedAssets(sceneId, key, layer);
  }
};
const _focus = new THREE.Vector3();

const assertInstalled = (fn: string) => {
  if (!isInstalled) {
    throw new Error(
      `${fn}: world streaming needs the streaming() feature (aekasha/streaming) in InitEngine's features.`
    );
  }
};

/** The focus's x/z into `_focus`, or null when there's none to measure from (its entity is gone,
 * or no main camera). */
const readFocus = (world: ECSWorld): THREE.Vector3 | null => {
  if (focusOverride) return _focus.set(focusOverride.x, 0, focusOverride.z);
  if (focus === null) {
    const camera = getMainCamera();
    return camera ? camera.getWorldPosition(_focus) : null;
  }
  if (typeof focus === 'number') {
    if (!world.isAlive(focus)) return null;
    const position = world.getPosition(focus);
    return position ? _focus.copy(position) : null;
  }
  return _focus.set(focus.x, 0, focus.z);
};

/** The scene's settings: the code's over the data's, null when it doesn't stream. */
const getSceneSettings = (sceneId: string): SceneStreamingSettings | null => {
  const fromCode = codeSettings.get(sceneId);
  return fromCode !== undefined ? fromCode : dataSettings.get(sceneId) ?? null;
};

/**
 * Sets the streaming focus: an entity, or a point read at every decision. `null` (the default)
 * measures from the main camera. Kept across scene loads; while its entity doesn't exist, the
 * cells keep their states. Throws without the `streaming()` feature.
 * @example
 * ```ts
 * import { setStreamingFocus } from 'aekasha/streaming';
 *
 * setStreamingFocus(playerEntityId);
 * ```
 */
export const setStreamingFocus = (next: StreamingFocus | null) => {
  assertInstalled('setStreamingFocus');
  focus = next;
};

/**
 * The streaming focus `setStreamingFocus` set (`null`: the main camera).
 */
export const getStreamingFocus = (): StreamingFocus | null => focus;

/**
 * Sets a scene's streaming settings from code, over its JSON's `streaming`; `null` turns its
 * streaming off, `undefined` goes back to its JSON's. Read when the scene loads, after its scene
 * code: set them from the scene's code or before its load. Throws on invalid settings, and
 * without the `streaming()` feature.
 * @example
 * ```ts
 * import { setSceneStreamingSettings } from 'aekasha/streaming';
 *
 * setSceneStreamingSettings('myWorld', { cellSize: 64, rings: { resident: 1, nearby: 2 } });
 * ```
 */
export const setSceneStreamingSettings = (
  sceneId: string,
  settings: SceneStreamingSettings | null | undefined
) => {
  assertInstalled('setSceneStreamingSettings');
  if (settings === undefined) {
    codeSettings.delete(sceneId);
    return;
  }
  if (settings) {
    const problem = getStreamingSettingsProblem(settings);
    if (problem) throw new Error(`setSceneStreamingSettings('${sceneId}'): ${problem}`);
    if ((settings.base || settings.radii) && !hasWarnedBuildTimeFields) {
      hasWarnedBuildTimeFields = true;
      lwarn(
        `setSceneStreamingSettings('${sceneId}'): base and radii are read by the gather only (they cut the scene JSON's content into cells); ignored here.`
      );
    }
  }
  codeSettings.set(
    sceneId,
    settings && { ...settings, rings: settings.rings && { ...settings.rings } }
  );
};

/**
 * A streaming cell's state: where its content is. `RESIDENT` and `NEARBY` hold its `NEAR` and
 * `NEAR_AND_FAR` content, `FAR` its `FAR` and `NEAR_AND_FAR` content, each once all of it is
 * shown. While some of it isn't, the cell is `LOADING`, or `PRIMING` (loaded, not shown yet,
 * while its textures upload and its new shaders compile), and a cell switching between `NEARBY`
 * and `FAR` still shows the content it's leaving meanwhile. `UNLOADING`: none of it is wanted and
 * some is still there.
 */
export type StreamingCellState =
  | 'UNLOADED'
  | 'LOADING'
  | 'PRIMING'
  | 'RESIDENT'
  | 'NEARBY'
  | 'FAR'
  | 'UNLOADING';

const LOADED_STATES: readonly StreamingCellState[] = ['RESIDENT', 'NEARBY', 'FAR', 'UNLOADED'];

/**
 * Registers a unit of a scene's cell's content: `load` runs when the cell loads (with the scene,
 * when it's around the focus then, else when the focus comes within its rings), `unload` when it
 * unloads (by default the entities `load` returned are deleted). `loadedAt` says at which levels:
 * the cell's full content (`NEAR`, the default), its stand-ins while `FAR`, or both. A scene's registrations go when
 * the scene is left, so register them from its scene code, which runs on every load before its
 * cells do. A cell already loading or loaded takes the unit the next time it loads. Throws on an
 * invalid key or a `load` that isn't a function, and without the `streaming()` feature.
 * @remarks Keep the object: {@link unregisterStreamingCellContent} takes the same one.
 * @example
 * ```ts
 * import { createMeshEntity } from 'aekasha';
 * import { getStreamingCellKey, registerStreamingCellContent } from 'aekasha/streaming';
 *
 * for (let cz = -8; cz < 8; cz++) {
 *   for (let cx = -8; cx < 8; cx++) {
 *     registerStreamingCellContent({
 *       sceneId: 'myWorld',
 *       cellKey: getStreamingCellKey(cx, cz),
 *       load: ({ cellSize }) => [
 *         createMeshEntity({
 *           appId: `ground_${cx}_${cz}`,
 *           geo: 'groundBlock',
 *           mat: 'grass',
 *           position: { x: (cx + 0.5) * cellSize, y: 0, z: (cz + 0.5) * cellSize },
 *         }),
 *       ],
 *     });
 *   }
 * }
 * ```
 */
export const registerStreamingCellContent = (content: StreamingCellContent) => {
  const fn = 'registerStreamingCellContent';
  assertInstalled(fn);
  if (typeof content.sceneId !== 'string' || !content.sceneId) {
    throw new Error(`${fn}: the content needs its sceneId.`);
  }
  if (!isStreamingCellKey(content.cellKey)) {
    throw new Error(
      `${fn}: ${String(content.cellKey)} isn't a streaming cell key (getStreamingCellKey makes one).`
    );
  }
  if (typeof content.load !== 'function')
    throw new Error(`${fn}: the content needs a load function.`);
  if (content.unload !== undefined && typeof content.unload !== 'function') {
    throw new Error(`${fn}: the content's unload isn't a function.`);
  }
  if (content.loadedAt !== undefined && !STREAMING_CONTENT_RANGES.includes(content.loadedAt)) {
    throw new Error(
      `${fn}: loadedAt is ${String(content.loadedAt)}: it takes ${STREAMING_CONTENT_RANGES.join(', ')}.`
    );
  }
  addStreamingCellContent(content);
};

/**
 * Unregisters a unit of cell content {@link registerStreamingCellContent} registered (the same
 * object). What a loaded cell made of it stays until the cell unloads. Returns whether it was
 * registered.
 */
export const unregisterStreamingCellContent = (content: StreamingCellContent) =>
  removeStreamingCellContent(content);

/**
 * A cell's state in the current scene: `UNLOADED` for a cell it doesn't track, and for every cell
 * when the scene doesn't stream.
 */
export const getStreamingCellState = (cellKey: number): StreamingCellState => {
  const cell = runtime?.cells.get(cellKey);
  if (!cell) return 'UNLOADED';
  return cell.phase === 'LOADED' ? LOADED_STATES[cell.level] : cell.phase;
};

/**
 * The current scene's streaming machine, or null when it doesn't stream (the debug tab reads it).
 * @internal
 */
export const getStreamingRuntime = (): StreamingRuntime | null => runtime;

/**
 * The current scene's JSON cell content (its manifest and shared meshes), or null (the debug tab
 * reads it).
 * @internal
 */
export const getStreamingDataContent = (): StreamingDataContent | null => dataContent;

/**
 * The loading budgets in use (the debug tab edits them).
 * @internal
 */
export const getStreamingBudgets = (): StreamingBudgets => budgets;

/**
 * The priming budgets in use (the debug tab edits them).
 * @internal
 */
export const getStreamingPrimeBudgets = (): StreamingPrimeBudgets => primeBudgets;

/**
 * How often the cells' states are decided, in frames (the debug tab edits it).
 * @internal
 */
export const getStreamingUpdateInterval = () => updateIntervalFrames;

/**
 * Sets how often the cells' states are decided, in frames (at least 1).
 * @internal
 */
export const setStreamingUpdateInterval = (frames: number) => {
  updateIntervalFrames = Math.max(1, Math.round(frames));
};

/**
 * The debug tools' focus, over the app's while set: "Freeze focus", "Teleport focus to cell" and
 * `?streamingFocus=x,z`. `null` gives the focus back to the app's.
 * @internal
 */
export const setStreamingFocusOverride = (at: { x: number; z: number } | null) => {
  focusOverride = at && { x: at.x, z: at.z };
  // Decided on the next frame, not up to an interval later
  framesToDecision = 0;
};

/**
 * The debug tools' focus, or null while the app's is used.
 * @internal
 */
export const getStreamingFocusOverride = (): { readonly x: number; readonly z: number } | null =>
  focusOverride;

/** `?streamingFocus=x,z`: the focus frozen at that point from the first scene on (read only in the
 * debug env and prod test mode, so a production build never reads it). */
const applyFocusQueryParam = () => {
  const param = new URLSearchParams(window.location.search).get('streamingFocus');
  if (!param) return;
  const [x, z] = param.split(',').map(Number);
  if (Number.isFinite(x) && Number.isFinite(z)) setStreamingFocusOverride({ x, z });
  else lwarn(`?streamingFocus=${param} isn't a point: it takes x,z in metres (eg. 512,-256).`);
};

type StreamingDebugModule = typeof import('./debug/_dbg__Streaming');
let debugGUI: DebugModuleRef<StreamingDebugModule> | null = null;

/**
 * Loads and builds the Streaming debug tab: the `streaming()` feature's `onDebug` hook.
 * @internal
 */
export const registerStreamingDebugGUI = async () => {
  debugGUI = await loadDebugModuleAsync(() => import('./debug/_dbg__Streaming'));
  useDebug(debugGUI)?._createStreamingDebugGUI();
};

const streamingSystem = (world: ECSWorld) => {
  if (!runtime || !machine || isSceneLoading || world.id !== DEFAULT_ECS_WORLD_ID) return;
  // An armed determinism probe holds the cells where the scene's load put them: a probe run
  // streams nothing (its hash would depend on frame timing, p353 §6)
  if (--framesToDecision <= 0 && !(IS_DEBUG_ENV && isDeterminismProbeArmed())) {
    framesToDecision = updateIntervalFrames;
    const at = readFocus(world);
    if (at) machine.decideStreamingCells(runtime, at.x, at.z);
  }
  machine.pumpStreamingCells(runtime, budgets);
};

/** The `created` hook's load: the scene's machine with its JSON cell content, and its cells
 * around the focus at once. A scene whose JSON content was cut into cells streams at the cell size
 * it was cut at (p353 Phase 3 D6). */
const loadSceneCellsAsync = async (sceneId: string) => {
  const settings = getSceneSettings(sceneId);
  const manifest = manifests.get(sceneId);
  if (!settings) {
    if (manifest) {
      lwarn(
        `The scene '${sceneId}' has streaming turned off in code, so its JSON content in cells (${Object.keys(manifest.cells).length}) doesn't load.`
      );
    }
    return;
  }
  const problem = getStreamingSettingsProblem(settings);
  if (problem) throw new Error(`The scene '${sceneId}' can't stream: ${problem}`);
  if (manifest && manifest.cellSize !== settings.cellSize) {
    throw new Error(
      `The scene '${sceneId}' can't stream at a cellSize of ${settings.cellSize}: its JSON content was cut into cells of ${manifest.cellSize} (set in code, the JSON's is the gathered one).`
    );
  }
  // On demand (the import registry's pattern, p613 D4): the machine, its priming and the cells'
  // bodies for a scene that streams, the JSON content only for one whose JSON content is in
  // cells. Before any state is set, so nothing changes across the await.
  const [cellsModule, primingModule, fadesModule, bodiesModule, dataModule] = await Promise.all([
    import('./StreamingCells'),
    import('./StreamingPriming'),
    import('./StreamingFades'),
    import('./StreamingBodies'),
    manifest ? import('./StreamingDataContent') : null,
  ]);
  machine = cellsModule;
  primer ??= primingModule.createStreamingPrimer(primeBudgets);
  fader ??= fadesModule.createStreamingFader(primingModule.forgetPrimedMaterial);
  const world = getECSWorld();
  const rt = cellsModule.createStreamingRuntime(
    sceneId,
    resolveStreamingSettings(settings, defaultFadeSeconds),
    world,
    now,
    createCellRelease(sceneId),
    primer
  );
  // Its layers dither in and out (p353 Phase 5 D4), unless its fadeSeconds is 0
  rt.fader = fader;
  // Its cells' bodies (StreamingBodies.ts): their tiers, and the hand-over of the ones that moved
  rt.bodies = bodiesModule.createStreamingBodies(rt.settings.nearbyPhysicsTier);
  if (manifest && dataModule) {
    const content = dataModule.createStreamingDataContent(sceneId, manifest);
    dataContent = content;
    rt.dataContent = content.getUnits;
    // Its oversized meshes are one entity in several cells: the machine asks which draws it
    rt.sharedEntities = content;
  }
  runtime = rt;
  const at = readFocus(world);
  if (!at) return;
  cellsModule.decideStreamingCells(rt, at.x, at.z);
  await cellsModule.loadStreamingCellsNowAsync(rt);
};

/**
 * Streaming's part of a scene load: the previous scene's cells go first on the exit (reverse
 * install order: before physics' entities), and the next scene's cells around the focus load in
 * `created`, awaited, so they're part of the load (inside physics' hold, p101).
 * @internal
 */
export const streamingSceneHooks: SceneHooks = {
  sceneRegistered: (sceneId, data) => {
    if (data.streaming) dataSettings.set(sceneId, data.streaming);
    if (data.__streaming) manifests.set(sceneId, data.__streaming);
  },
  loadStart: () => {
    isSceneLoading = true;
  },
  exit: (prevSceneId) => {
    if (runtime && machine) {
      droppedCells = { sceneId: runtime.sceneId, keys: [...runtime.cells.keys()] };
      machine.dropStreamingCells(runtime);
    }
    runtime = null;
    dataContent = null;
    // Its code registers its content again on its next load
    if (prevSceneId !== undefined) clearSceneStreamingContent(prevSceneId);
  },
  created: async (sceneId) => {
    await loadSceneCellsAsync(sceneId);
    releaseDroppedCells(sceneId);
  },
  loadSettled: () => {
    isSceneLoading = false;
    framesToDecision = 0;
  },
};

/**
 * Installs world streaming (the `streaming()` feature's install): its budgets from
 * `AppConfig.streaming`, its system (default world, `MAIN`) and its scene hooks.
 * @internal
 */
export const installStreaming = (ctx: FeatureContext) => {
  const config = ctx.config.streaming;
  updateIntervalFrames = Math.max(
    1,
    config?.updateIntervalFrames ?? DEFAULT_UPDATE_INTERVAL_FRAMES
  );
  budgets.maxConcurrentLoads = Math.max(
    1,
    config?.maxConcurrentLoads ?? DEFAULT_MAX_CONCURRENT_LOADS
  );
  budgets.maxCreateMsPerFrame = config?.maxCreateMsPerFrame ?? DEFAULT_MAX_CREATE_MS_PER_FRAME;
  primeBudgets.maxPrimeMsPerFrame = config?.maxPrimeMsPerFrame ?? DEFAULT_MAX_PRIME_MS_PER_FRAME;
  primeBudgets.maxNewStructuresPerFrame = config?.maxNewStructuresPerFrame ?? null;
  // A scene's streamed entities fade as long as its LOD cross-fades, unless it says otherwise
  defaultFadeSeconds = ctx.config.lod?.fadeSeconds ?? DEFAULT_STREAMING_FADE_SECONDS;
  ctx.registerPlugin((world) => {
    world.addSystem(ECSSystemStage.MAIN, 'streamingSystem', streamingSystem);
  });
  ctx.addSceneHooks(streamingSceneHooks);
  isInstalled = true;
  // Before the first scene load, so its cells load around that point
  if (IS_DEBUG_ENV || IS_PROD_TEST_MODE) applyFocusQueryParam();
};
