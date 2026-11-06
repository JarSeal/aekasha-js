// World streaming's runtime (p353): the current scene's cell machine (StreamingCells.ts), the
// focus it measures from, the scenes' settings, the system that decides and pumps it, and the
// scene hooks that load the cells around the focus inside a scene load and drop them on its exit.
// The streaming() feature (StreamingFeature.ts) installs it.
import * as THREE from 'three/webgpu';
import { getMainCamera } from '../../kernel/camera/Camera';
import { DEFAULT_ECS_WORLD_ID, type ECSWorld, getECSWorld } from '../../kernel/ecs/ECS';
import type { FeatureContext } from '../../kernel/init/Features';
import { ECSSystemStage } from '../../kernel/loop/SystemStages';
import type { SceneHooks } from '../../kernel/scene/SceneHooks';
import {
  type StreamingBudgets,
  type StreamingRuntime,
  createStreamingRuntime,
  decideStreamingCells,
  dropStreamingCells,
  loadStreamingCellsNowAsync,
  pumpStreamingCells,
} from './StreamingCells';
import {
  type StreamingCellContent,
  addStreamingCellContent,
  clearSceneStreamingContent,
  isStreamingCellKey,
  removeStreamingCellContent,
} from './StreamingContent';
import type { SceneStreamingSettings } from './StreamingSchema';
import { getStreamingSettingsProblem, resolveStreamingSettings } from './StreamingSettings';

/**
 * What the streaming cells measure their distance from: an entity (its `TRANSFORM` position), or
 * a point read at every decision (a `THREE.Vector3` you keep moving works). Only x and z count.
 */
export type StreamingFocus = number | { readonly x: number; readonly z: number };

const DEFAULT_UPDATE_INTERVAL_FRAMES = 10;
const DEFAULT_MAX_CONCURRENT_LOADS = 2;
const DEFAULT_MAX_CREATE_MS_PER_FRAME = 2;

let isInstalled = false;
let updateIntervalFrames = DEFAULT_UPDATE_INTERVAL_FRAMES;
const budgets: StreamingBudgets = {
  maxConcurrentLoads: DEFAULT_MAX_CONCURRENT_LOADS,
  maxCreateMsPerFrame: DEFAULT_MAX_CREATE_MS_PER_FRAME,
};

/** The gathered scenes' settings, by scene id */
const dataSettings = new Map<string, SceneStreamingSettings>();
/** Settings set in code, by scene id: over the data's; null turns a scene's streaming off */
const codeSettings = new Map<string, SceneStreamingSettings | null>();

let focus: StreamingFocus | null = null;
let runtime: StreamingRuntime | null = null;
let isSceneLoading = false;
let framesToDecision = 0;

const now = () => performance.now();
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
  }
  codeSettings.set(
    sceneId,
    settings && { ...settings, rings: settings.rings && { ...settings.rings } }
  );
};

/**
 * A streaming cell's state: where its content is. `RESIDENT`, `NEARBY` and `FAR` are loaded
 * (`FAR` loads nothing until far representations exist, p353 Phase 5).
 */
export type StreamingCellState =
  | 'UNLOADED'
  | 'LOADING'
  | 'RESIDENT'
  | 'NEARBY'
  | 'FAR'
  | 'UNLOADING';

const LOADED_STATES: readonly StreamingCellState[] = ['RESIDENT', 'NEARBY', 'FAR', 'UNLOADED'];

/**
 * Registers a unit of a scene's cell's content: `load` runs when the cell loads (with the scene,
 * when it's around the focus then, else when the focus comes within its rings), `unload` when it
 * unloads (by default the entities `load` returned are deleted). A scene's registrations go when
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
 * The loading budgets in use (the debug tab edits them).
 * @internal
 */
export const getStreamingBudgets = (): StreamingBudgets => budgets;

const streamingSystem = (world: ECSWorld) => {
  if (!runtime || isSceneLoading || world.id !== DEFAULT_ECS_WORLD_ID) return;
  if (--framesToDecision <= 0) {
    framesToDecision = updateIntervalFrames;
    const at = readFocus(world);
    if (at) decideStreamingCells(runtime, at.x, at.z);
  }
  pumpStreamingCells(runtime, budgets);
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
  },
  loadStart: () => {
    isSceneLoading = true;
  },
  exit: (prevSceneId) => {
    if (runtime) dropStreamingCells(runtime);
    runtime = null;
    // Its code registers its content again on its next load
    if (prevSceneId !== undefined) clearSceneStreamingContent(prevSceneId);
  },
  created: async (sceneId) => {
    const settings = getSceneSettings(sceneId);
    if (!settings) return;
    const problem = getStreamingSettingsProblem(settings);
    if (problem) throw new Error(`The scene '${sceneId}' can't stream: ${problem}`);
    const world = getECSWorld();
    const rt = createStreamingRuntime(sceneId, resolveStreamingSettings(settings), world, now);
    runtime = rt;
    const at = readFocus(world);
    if (!at) return;
    decideStreamingCells(rt, at.x, at.z);
    await loadStreamingCellsNowAsync(rt);
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
  ctx.registerPlugin((world) => {
    world.addSystem(ECSSystemStage.MAIN, 'streamingSystem', streamingSystem);
  });
  ctx.addSceneHooks(streamingSceneHooks);
  isInstalled = true;
};
