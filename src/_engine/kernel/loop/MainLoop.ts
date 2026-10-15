import { Timer, type Renderer, type Scene, type Camera } from 'three/webgpu';
import { getStats, initStats, startCustomMeasurements, updateRestOfStats } from '../../debug/Stats';
import { getCurrentCamera } from '../camera/Camera';
import { getRenderer } from '../render/Renderer';
import {
  getRootScene,
  getSceneResizers,
  runSceneAppLoopers,
  runSceneMainLateLoopers,
  runSceneMainLoopers,
} from '../scene/Scene';
import { lerror, lwarn } from '../../utils/Logger';
import { getCanvasSize, onCanvasResize } from '../render/CanvasSize';
import { getEnv, IS_DEBUG_ENV, IS_PROD_TEST_MODE } from '../config/Config';
import { initDebugTools } from '../../debug/DebugTools';
import { pollHeldKeyBindings } from '../input/KeyboardInput';
import { initRayCasting } from '../render/Raycast';
import { getAllECSWorlds } from '../ecs/ECS';
import { getActiveCamera } from '../camera/Camera';
import type { DebugModuleRef } from '../config/DebugModules';
import { loadDebugModuleAsync, useDebug } from '../config/DebugModules';
import { getRenderPipeline, runAfterRenderHooks } from '../render/RenderHooks';
import { updateDebuggerTab } from '../../debug/DebuggerGUI';
import { getActiveView, runActiveViewAfterRender, runActiveViewFrame } from '../render/Views';

/** Debugger drawer tab id of the loop controls. */
export const LOOP_DEBUGGER_TAB_ID = 'loopControls';

const timer = new Timer();
let delta = 0;
let deltaApp = 0;
/** getElapsedTime's clock (see advanceElapsedClock); the first delta is time since module load */
const elapsedClock: ElapsedClock = { elapsed: 0, discardNext: true };
let mainLoopInitiated = false;
/** stopMainLoop ran (a mounted engine's unmount): no frame runs again, a queued one included */
let isMainLoopStopped = false;
/** A frame is requested and hasn't run yet: requestMainLoopFrame asks for no second one */
let isFrameRequested = false;
/** Removes what initMainLoop and addWindowListeners added (the resize subscription, the listeners) */
const loopListenerRemovers: (() => void)[] = [];
let lastRenderTime = performance.now();
// Debug and test only: when set, every frame advances by this many seconds (setFixedFrameDelta)
let fixedFrameDelta: number | null = null;
const resizers: { [key: string]: () => void } = {};

/**
 * The max FPS limiter's step: the reference time of the frame rendered at `nowMs`, or -1 to skip
 * rendering it. The reference advances by exactly one interval per rendered frame rather than
 * jumping to "now", so the time a frame arrives late is carried over instead of discarded —
 * otherwise a frame landing a hair under the interval gets skipped and the rate falls to the next
 * display-rate divisor (a 30 FPS cap on a 60Hz display averaged ~24). After a hitch (two
 * intervals or more) it re-anchors at `nowMs` instead of bursting to catch up.
 * @internal
 */
export const nextMaxFPSReference = (nowMs: number, lastRenderMs: number, intervalMs: number) => {
  const sinceLast = nowMs - lastRenderMs;
  if (sinceLast < intervalMs) return -1;
  return sinceLast < 2 * intervalMs ? lastRenderMs + intervalMs : nowMs;
};

/** Max FPS limiter: whether to skip rendering this frame (nextMaxFPSReference) */
const shouldSkipFrameForMaxFPS = () => {
  if (loopState.maxFPS <= 0) return false;
  const next = nextMaxFPSReference(performance.now(), lastRenderTime, loopState.maxFPSInterval);
  if (next === -1) return true;
  lastRenderTime = next;
  return false;
};

/** The main loop's play state, which a {@link FixedStepDriver} reads to know when it is paused. */
export type LoopState = {
  /** The master loop is set to play (everything runs). */
  masterPlay: boolean;
  /** The app loop is set to play (physics and the app stages run). */
  appPlay: boolean;
  /** The master loop played this frame. */
  isMasterPlaying: boolean;
  /** The app loop played this frame. */
  isAppPlaying: boolean;
  /** Scales every delta (1: real time). */
  playSpeedMultiplier: number;
  /** The max FPS limiter's rate (0: off). */
  maxFPS: number;
  /** `1000 / maxFPS`, in milliseconds. */
  maxFPSInterval: number;
  /** The page is hidden (another tab, a minimized window). */
  isWindowHidden: boolean;
  /** The page is unloading. */
  isUnloading: boolean;
  /** A scene load is in progress. */
  isLoadingScene: boolean;
  /** An editor view is active (`kernel/render/Views.ts`): the loaded scene is neither rendered nor
   * ticked, and physics sees it as a pause. */
  isSceneSuspended: boolean;
};

const loopState: LoopState = {
  masterPlay: true,
  appPlay: true,
  isMasterPlaying: false,
  isAppPlaying: false,
  playSpeedMultiplier: 1,
  maxFPS: 0, // 0 = maxFPS limiter is off and is not used
  maxFPSInterval: 0, // if maxFPS = 60, then this would be 1000 / 60
  isWindowHidden: false,
  isUnloading: false,
  isLoadingScene: false,
  isSceneSuspended: false,
};

/**
 * Debug and test only: makes every frame advance by `seconds` of time, whatever the wall clock
 * says (null: real time again). Physics stepping takes the same delta, so at the default 60 Hz
 * timestep a 1/60 s frame is exactly one step, and everything driven by the loop's deltas (app
 * systems, scene loopers, the elapsed time, the day-night cycle) is the same on every run for the
 * same number of frames. The scene runner's test bridge sets it (p601).
 * @param seconds (number | null) the frame delta in seconds, or null
 */
export const setFixedFrameDelta = (seconds: number | null) => {
  fixedFrameDelta = seconds !== null && seconds > 0 ? seconds : null;
};

/** The fixed frame delta in seconds (setFixedFrameDelta), or null when frames run in real time */
export const getFixedFrameDelta = () => fixedFrameDelta;

/**
 * Returns the main loop delta time
 * @returns (number) delta time
 */
export const getDelta = () => delta;

/**
 * Returns the app loop delta time
 * @returns (number) delta time
 */
export const getAppDelta = () => deltaApp;

/**
 * Returns the main loop's accumulated elapsed time in seconds: the sum of every main loop
 * delta, so it scales with loopState.playSpeedMultiplier and stands still while the master
 * loop is paused or the scene is suspended by an editor view (it keeps running while only the
 * app loop is paused). Unlike TSL's `time`
 * node (renderer wall-clock), this is the clock anything that must freeze and speed up with
 * the loop should read.
 * @returns (number) elapsed time in seconds
 */
export const getElapsedTime = () => elapsedClock.elapsed;

/**
 * Returns linear speed value in relation to main loop delta time
 * @param unitsPerSecond (number) units per second
 * @returns (number) transformed speed value (delta * unitsPerSecond)
 */
export const transformMainSpeedValue = (unitsPerSecond: number) => delta * unitsPerSecond;

/**
 * Returns linear speed value in relation to app loop delta time
 * @param unitsPerSecond (number) units per second
 * @returns (number) transformed speed value (delta * unitsPerSecond)
 */
export const transformAppSpeedValue = (unitsPerSecond: number) => deltaApp * unitsPerSecond;

/**
 * Transforms time value in relation to the loopState.playSpeedMultiplier
 * @param durationInMs (number) duration in milliseconds to transform
 * @returns (number) transformed duration in milliseconds (durationInMs * loopState.playSpeedMultiplier)
 */
export const transformTimeValue = (durationInMs: number) =>
  durationInMs * loopState.playSpeedMultiplier;

/** Measures every main loop frame (see {@link setFrameProbe}). */
export type FrameProbe = {
  /** At the start of the loop function. */
  begin: (now: number) => void;
  /** At the end of the loop function. `rendered` is false on a frame the max FPS limiter skipped. */
  end: (now: number, rendered: boolean) => void;
};

let frameProbe: FrameProbe | null = null;

/**
 * Sets (or with null clears) the frame probe the main loop calls at the start and end of every
 * frame. Only the profiler sets one, while its window is open, so without it a frame costs two null
 * checks.
 * @param probe ({@link FrameProbe} | null)
 */
export const setFrameProbe = (probe: FrameProbe | null) => {
  frameProbe = probe;
};

/**
 * The loop's fixed-step seam (p607 D5): what drives a simulation at a fixed timestep, set by the
 * feature that owns it (`physics()`, through `FeatureContext.setFixedStepDriver`). One per page.
 * Without one, the loop polls held keys once per frame with the frame's delta.
 */
export type FixedStepDriver = {
  /** Once per frame, right after the timer update: makes this frame's simulation state visible
   * (every reader in the frame sees the same snapshot). */
  latch: () => void;
  /** Once per frame: takes this frame's fixed steps from the time that passed, calling
   * `onBeforeStep` right before each one with the fixed timestep and the step's index (counted
   * from 0 in each simulation world; without it, the action layer numbers its samples itself).
   * While `loopState` says paused
   * (the app or master loop, or the scene suspended by an editor view), the loop calls it
   * without `onBeforeStep`: it steps nothing then, only notes the pause, so resuming doesn't
   * catch up on the paused time. */
  step: (
    loopState: Readonly<LoopState>,
    onBeforeStep?: (stepDelta: number, stepIndex?: number) => void
  ) => void;
  /** Delivers the previous step's events (collisions, contact forces): the loop calls it in each
   * sub-step, after the held keys and before the `APP_PHYSICS_STEP` systems. */
  flushEvents: () => void;
  /** Whether the simulation steps at all (enabled and its world stepping): when it doesn't, the
   * loop polls held keys once per frame itself. */
  isStepping: () => boolean;
};

let fixedStepDriver: FixedStepDriver | null = null;

/**
 * Sets the fixed-step driver (`FeatureContext.setFixedStepDriver`). Throws on a second one.
 * @internal
 */
export const setFixedStepDriver = (driver: FixedStepDriver) => {
  if (fixedStepDriver) {
    throw new Error(
      'setFixedStepDriver: a fixed-step driver is already set (one feature drives the fixed steps).'
    );
  }
  fixedStepDriver = driver;
};

let preStepHook: (() => void) | null = null;

/**
 * The action layer's hooks in the loop (`kernel/input/Actions.ts`, set by its first map, so an
 * app without action maps bundles none of it).
 * @internal
 */
export type ActionSampler = {
  /** Once per frame, right after the latch, in every view and while the app loop is paused. */
  pollFrame: () => void;
  /** Right before each fixed sub-step (after the pre-step hook, before the held keys), or once per
   * frame when nothing steps, with -1. */
  sample: (stepIndex: number) => void;
  /** On a frame that doesn't step because the app loop is paused or the scene is suspended. */
  skip: () => void;
};

let actionSampler: ActionSampler | null = null;

/**
 * Sets the action layer's hooks (`Actions.ts`, once).
 * @internal
 */
export const setActionSampler = (sampler: ActionSampler) => {
  actionSampler = sampler;
};

/**
 * Sets the function run at the very start of every fixed sub-step, before the held keys (null
 * removes it): the test bridge's scripted input and character path recording.
 * @internal
 */
export const setPreStepHook = (fn: (() => void) | null) => {
  preStepHook = fn;
};

/** Everything that has to run in lockstep with the simulation, once per fixed sub-step right
 * before it (see FixedStepDriver.step): the pre-step hook, the action sample, held-key input,
 * then the previous step's events, then every world's APP_PHYSICS_STEP systems (see
 * PhysicsAPI.ts's flushPhysicsEvents for why the order matters). Only called by the driver, so it
 * is set. */
const runFixedSubStep = (stepDelta: number, stepIndex = -1) => {
  preStepHook?.();
  actionSampler?.sample(stepIndex);
  pollHeldKeyBindings(stepDelta);
  fixedStepDriver!.flushEvents();
  const worlds = getAllECSWorlds();
  for (let i = 0; i < worlds.length; i++) worlds[i].updatePhysicsStep(stepDelta);
};

/** Takes the frame's fixed steps (running runFixedSubStep before each). Falls back to polling
 * held keys once with the raw frame delta whenever nothing steps (no driver, or physics off), so
 * held-key-driven input (e.g. debug camera movement) still works without physics. */
const stepFixedAndPollHeldKeys = (delta: number) => {
  const driver = fixedStepDriver;
  if (driver) {
    driver.step(loopState, runFixedSubStep);
    if (driver.isStepping()) return;
  }
  actionSampler?.sample(-1);
  pollHeldKeyBindings(delta);
};

/** Called instead of stepFixedAndPollHeldKeys while the app loop is paused (or the scene is
 * suspended). It steps nothing, but the driver's step is what notices the pause, so it can discard
 * the paused time on resume instead of catching up on it (up to maxDeltaTime worth of steps in one
 * frame). The action layer drops what happened meanwhile the same way. */
const noteFixedStepPause = () => {
  fixedStepDriver?.step(loopState);
  actionSampler?.skip();
};

/**
 * getElapsedTime's clock: the elapsed seconds, and whether the next delta is dropped.
 * @internal
 */
export type ElapsedClock = { elapsed: number; discardNext: boolean };

/**
 * Advances the elapsed time by this frame's delta, while `isRunning` (the master loop plays and
 * the scene isn't suspended). The timer is never reset across a pause, so the first delta after
 * one spans the whole paused duration: it is discarded (as the fixed-step driver does for
 * physics), so the elapsed time stands still instead of jumping forward. `discardNext` starts out
 * true, which also covers a loop that starts paused (saved loop state). Detected here, every
 * frame, rather than in toggleMainPlay, because the debug GUI's master loop toggle flips
 * loopState.masterPlay directly.
 * @internal
 */
export const advanceElapsedClock = (
  clock: ElapsedClock,
  frameDelta: number,
  isRunning: boolean
) => {
  if (!isRunning) {
    clock.discardNext = true;
    return;
  }
  if (clock.discardNext) {
    clock.discardNext = false;
    return;
  }
  clock.elapsed += frameDelta;
};

const renderScene = () => {
  const renderer = getRenderer() as Renderer | undefined;
  // A plain check: the message is built only when it fails, not every frame
  if (!renderer) throw new Error('Error in renderScene: no renderer (createRenderer).');

  if (loopState.isSceneSuspended) {
    // An editor view: its own scene and camera, without the scene's render pipeline (PostFX's,
    // built for the root scene and its camera). Between two editor views (no active one), or without a
    // view camera, nothing is rendered and the canvas keeps its last frame.
    const view = getActiveView();
    const viewCamera = view?.getCamera();
    if (!view || !viewCamera) return;
    renderer.render(view.scene, viewCamera);
    runAfterRenderHooks(renderer, delta);
    return;
  }

  const rootScene = getRootScene() as Scene;
  const camera = getActiveCamera() as Camera;

  if (!rootScene || !camera) {
    throw new Error(
      `Error in renderScene, missing the root scene and/or the camera. Status:\nrootScene: ${Boolean(rootScene)}\ncamera: ${Boolean(camera)}`
    );
  }

  // The render pipeline seam (PostFX's, when a scene's chain is on), else a direct render
  const pipeline = getRenderPipeline();
  if (pipeline) {
    pipeline.render();
  } else {
    renderer.render(rootScene, camera);
  }

  // The after-render seam (viewports: picture-in-picture, the debug axes gizmo) draws over the
  // finished frame
  runAfterRenderHooks(renderer, delta);
};

/**
 * Requests the next frame, unless one is already requested (two requests would run two frame
 * chains, each frame twice) or the loop has stopped for good.
 * @internal
 */
export const requestMainLoopFrame = () => {
  if (isFrameRequested || isMainLoopStopped) return;
  isFrameRequested = true;
  requestAnimationFrame(runFrame);
};

// THE FRAME
// **************************************
// One function for every build: the debug env's parts (the stats, the editor views) sit behind
// IS_DEBUG_ENV, which a production build folds away. The max FPS limiter skips the render (and
// LATE_MAIN after it) only: every stage before it runs on every frame, so no game time is lost.
const runFrame = () => {
  isFrameRequested = false;
  if (isMainLoopStopped) return;
  frameProbe?.begin(performance.now());
  if (IS_DEBUG_ENV) startCustomMeasurements();

  timer.update();
  fixedStepDriver?.latch();
  actionSampler?.pollFrame();
  const dt = fixedFrameDelta ?? timer.getDelta();

  if (loopState.masterPlay) {
    delta = dt * loopState.playSpeedMultiplier;
    requestMainLoopFrame();
    loopState.isMasterPlaying = true;
  } else {
    loopState.isMasterPlaying = false;
  }
  advanceElapsedClock(elapsedClock, delta, loopState.masterPlay && !loopState.isSceneSuspended);

  // --- Max FPS limiter ---
  const skipFrame = shouldSkipFrameForMaxFPS();

  // An editor view is active (kernel/render/Views.ts, debug env only): the scene is suspended.
  // None of its per-frame work runs (every world's stages, the scene loopers, physics and held
  // keys), the view's runs instead.
  const isSceneSuspended = loopState.isSceneSuspended;

  if (isSceneSuspended) {
    loopState.isAppPlaying = false;
    // Steps nothing, but lets physics notice the pause, so resuming never catches up on it
    noteFixedStepPause();
    runActiveViewFrame(delta);
  } else {
    // main loopers
    const worlds = getAllECSWorlds();
    for (let i = 0; i < worlds.length; i++) worlds[i].updateMainLoop(delta);
    runSceneMainLoopers(delta, skipFrame);

    if (loopState.appPlay) {
      loopState.isAppPlaying = true;
      deltaApp = dt * loopState.playSpeedMultiplier;

      // Step the physics and poll held-key input at the same cadence
      stepFixedAndPollHeldKeys(delta);

      // app loopers
      const appWorlds = getAllECSWorlds();
      for (let i = 0; i < appWorlds.length; i++) appWorlds[i].updateAppLoop(deltaApp);
      runSceneAppLoopers(deltaApp);
    } else {
      // Only master loop is playing (app loop is paused)
      loopState.isAppPlaying = false;
      noteFixedStepPause();
    }
  }

  if (skipFrame) {
    frameProbe?.end(performance.now(), false);
    return;
  }

  // Update stats-gl
  if (IS_DEBUG_ENV) getStats()?.update();

  renderScene();

  if (isSceneSuspended) {
    runActiveViewAfterRender(delta);
  } else {
    const lateWorlds = getAllECSWorlds();
    for (let i = 0; i < lateWorlds.length; i++) lateWorlds[i].updateLateMainLoop(delta);
    runSceneMainLateLoopers(delta);
  }

  if (IS_DEBUG_ENV) updateRestOfStats(getRenderer() as Renderer);
  frameProbe?.end(performance.now(), true);
};

/** Runs the global resizers, then the current scene's. */
const runResizers = () => {
  const ids = Object.keys(resizers);
  for (let i = 0; i < ids.length; i++) {
    resizers[ids[i]]();
  }

  const sceneResizers = getSceneResizers();
  if (sceneResizers) {
    for (let i = 0; i < sceneResizers.length; i++) {
      sceneResizers[i]();
    }
  }
};

/**
 * Initializes the main loop. Requires that the renderer, camera, and scene have been created.
 */
export const initMainLoop = () => {
  // Make sure initMainLoop is only initiated once
  if (mainLoopInitiated) return;
  mainLoopInitiated = true;

  const renderer = getRenderer();
  const currentCamera = getCurrentCamera();
  if (!renderer) {
    const msg = 'Renderer has not been created or has been deleted (initMainLoop).';
    lerror(msg);
    throw new Error(msg);
  }
  if (!currentCamera) {
    const msg = 'Current camera has not been created or has been deleted (initMainLoop).';
    lerror(msg);
    throw new Error(msg);
  }

  // Add three.js global resizer
  addResizer('canvasResizer', () => {
    const renderer = getRenderer();
    if (!renderer) throw new Error('Could not find current renderer in canvas resizer.');
    const { width, height } = getCanvasSize();
    renderer.setSize(width, height);
  });
  // The window's resize, or the mounted container's (kernel/render/CanvasSize.ts)
  loopListenerRemovers.push(onCanvasResize(runResizers));

  const maxFPS = Number(getEnv('VITE_MAX_FPS'));
  if (maxFPS !== undefined && !isNaN(maxFPS)) {
    loopState.maxFPS = maxFPS;
    // In ms, like the performance.now() deltas it's compared against (and the debug GUI's own
    // 1000 / value) — as 1 / maxFPS (seconds) the limiter never engaged.
    if (maxFPS > 0) loopState.maxFPSInterval = 1000 / maxFPS;
  }

  initWinVisibilityListener();

  if (IS_DEBUG_ENV || IS_PROD_TEST_MODE) {
    const gui = useDebug(debugGUI, true);
    // Also hydrates loopState's persisted debug values
    if (gui) gui.createLoopDebugControls(loopState);
  }

  initRayCasting();

  if (IS_DEBUG_ENV) {
    initStats();
    initDebugTools();
  }

  renderScene();

  if (loopState.masterPlay) {
    // Wait for a few loops and start the main loop (which steps physics itself each frame). A
    // frame requested meanwhile (toggleMainPlay) is the same chain
    setTimeout(requestMainLoopFrame, 100);
  }
};

/**
 * Adds a global resizer function.
 * @param id (string) resizer id
 * @param resizer (() => void) resizer function
 */
export const addResizer = (id: string, resizer: () => void) => {
  if (resizers[id]) {
    throw new Error(
      `A resizer with the id "${id}" already exists. Delete the old resizer first before adding one with this id or pick another id.`
    );
  }
  resizers[id] = resizer;
};

/**
 * Deletes a resizer with an id
 * @param id (string) resizer id
 */
export const deleteResizer = (id: string) => {
  if (!resizers[id]) {
    lwarn(`Could not find resizer with id "${id}" in deleteResizer.`);
    return;
  }
  delete resizers[id];
};

/**
 * Toggles the main loop player state (play / pause)
 * @param value (boolean) optional value whether the loop state in playing (true) or paused (false). If not provided then value is the opposite to the current value.
 */
export const toggleMainPlay = (value?: boolean) => {
  if (value !== undefined) {
    loopState.masterPlay = value;
  } else {
    loopState.masterPlay = !loopState.masterPlay;
  }
  if (loopState.masterPlay && !loopState.isMasterPlaying) {
    loopState.isMasterPlaying = true;
    requestMainLoopFrame();
  }
  updateDebuggerTab(LOOP_DEBUGGER_TAB_ID);
};

/**
 * Toggles the app loop player state (play / pause)
 * @param value (boolean) optional value whether the loop state in playing (true) or paused (false). If not provided then value is the opposite to the current value.
 */
export const toggleAppPlay = (value?: boolean) => {
  if (value !== undefined) {
    loopState.appPlay = value;
  } else {
    loopState.appPlay = !loopState.appPlay;
  }
  updateDebuggerTab(LOOP_DEBUGGER_TAB_ID);
};

/**
 * Sets the loopState.isLoadingScene boolean.
 * @param isLoading (boolean) value for whether the scene is loading or not.
 */
export const setIsLoadingScene = (isLoading: boolean) => (loopState.isLoadingScene = isLoading);

/**
 * Sets loopState.isSceneSuspended. `kernel/render/Views.ts` only: it owns the enter and leave
 * sequence of an editor view around it.
 * @param isSuspended (boolean) whether the scene is suspended
 */
export const setSceneSuspended = (isSuspended: boolean) => {
  loopState.isSceneSuspended = isSuspended;
};

/** Renders one frame while the master loop is paused (after a view switch), so the canvas shows
 * the view that is now active. A no-op while the loop runs or before it has started. */
export const renderFrameWhileMasterPaused = () => {
  if (!mainLoopInitiated || loopState.isMasterPlaying) return;
  renderScene();
};

/** Renders the current view's frame now, outside the loop, when something cleared the canvas
 * (a snapshot resizes the renderer, `kernel/render/Snapshot.ts`): in the same task, the browser never
 * shows the cleared canvas. Not for per-frame use; a no-op before the loop has started. */
export const renderFrameNow = () => {
  if (!mainLoopInitiated) return;
  renderScene();
};

/**
 * A copy of the loop state (a snapshot: changing it changes nothing). Allocates: per-frame code
 * reads {@link isAppPlaying} instead.
 * @returns ({@link LoopState}) copy of LoopState
 */
export const getReadOnlyLoopState = (): LoopState => ({ ...loopState });

/**
 * Whether the app loop is set to play (loopState.appPlay): a cheap read for per-frame code,
 * unlike getReadOnlyLoopState. Read at the MAIN stage it already tells this frame's state
 * (loopState.isAppPlaying is only set later in the frame).
 * @returns (boolean) loopState.appPlay
 */
export const isAppPlaying = () => loopState.appPlay;

/**
 * Returns the play speed multiplier
 * @returns (number) loopState.playSpeedMultiplier
 */
export const getPlaySpeedMultiplier = () => loopState.playSpeedMultiplier;

/**
 * Sets the play speed multiplier, which scales every delta (1: real time, 0: frozen; a negative
 * value is 0).
 * @param multiplier (number) the multiplier
 */
export const setPlaySpeedMultiplier = (multiplier: number) =>
  (loopState.playSpeedMultiplier = multiplier < 0 ? 0 : multiplier);

// The page's visibility, unload and blur listeners (run in the order added)
const visibilityChangeListeners = new Set<(isHidden: boolean) => void>();
const beforeUnloadListeners = new Set<() => void>();
const windowBlurListeners = new Set<() => void>();

/**
 * Adds a listener for the page's visibility (another tab, a minimized window), called with
 * whether it's hidden now; not while the page unloads. Adding the same function again does
 * nothing.
 * @internal
 * @returns its remover
 */
export const onVisibilityChange = (fn: (isHidden: boolean) => void) => {
  visibilityChangeListeners.add(fn);
  return () => {
    visibilityChangeListeners.delete(fn);
  };
};

/**
 * Adds a listener for the window's `beforeunload` (after {@link addWindowListeners}).
 * @internal
 * @returns its remover
 */
export const onBeforeUnload = (fn: () => void) => {
  beforeUnloadListeners.add(fn);
  return () => {
    beforeUnloadListeners.delete(fn);
  };
};

/**
 * Adds a listener for the window losing focus (`blur`, after {@link addWindowListeners}): eg.
 * releasing held keys, whose keyup the page won't see.
 * @internal
 * @returns its remover
 */
export const onWindowBlur = (fn: () => void) => {
  windowBlurListeners.add(fn);
  return () => {
    windowBlurListeners.delete(fn);
  };
};

const handleVisibilityChange = () => {
  if (loopState.isUnloading) return;
  const isHidden = document.hidden;
  loopState.isWindowHidden = isHidden;
  for (const fn of visibilityChangeListeners) fn(isHidden);
};
const initWinVisibilityListener = () => {
  document.addEventListener('visibilitychange', handleVisibilityChange);
  loopListenerRemovers.push(() =>
    document.removeEventListener('visibilitychange', handleVisibilityChange)
  );
};

let areWindowListenersAdded = false;

/**
 * Adds the window's `beforeunload` and `blur` listeners that run the functions added with
 * {@link onBeforeUnload} and {@link onWindowBlur}. `InitEngine` calls it first (not at
 * module load: the engine's modules read no `window` at load); later calls do nothing.
 * @internal
 */
export const addWindowListeners = () => {
  if (areWindowListenersAdded) return;
  areWindowListenersAdded = true;
  const handleBeforeUnload = () => {
    loopState.isUnloading = true;
    for (const fn of beforeUnloadListeners) fn();
  };
  const handleBlur = () => {
    for (const fn of windowBlurListeners) fn();
  };
  window.addEventListener('beforeunload', handleBeforeUnload);
  window.addEventListener('blur', handleBlur);
  loopListenerRemovers.push(() => {
    window.removeEventListener('beforeunload', handleBeforeUnload);
    window.removeEventListener('blur', handleBlur);
  });
};

/**
 * Stops the main loop for good (a mounted engine's unmount, `mountAekasha`): no frame runs again,
 * one already requested included, and the resize subscription and the window and document
 * listeners (visibility, `beforeunload`, `blur`) are removed. The engine doesn't start again in
 * this page load.
 * @internal
 */
export const stopMainLoop = () => {
  isMainLoopStopped = true;
  loopState.masterPlay = false;
  loopState.isMasterPlaying = false;
  for (const remove of loopListenerRemovers.splice(0)) remove();
};

// Debug
type MainLoopGUIModule = typeof import('./debug/_dbg__MainLoop');
let debugGUI: DebugModuleRef<MainLoopGUIModule> | null = null;

/**
 * Loads the loop's debug module (the Loop tab; debug env and prod test mode). `InitEngine` calls it.
 * @internal
 */
export const registerMainLoopDebugGUI = async () => {
  debugGUI = await loadDebugModuleAsync(() => import('./debug/_dbg__MainLoop'), true);
};
