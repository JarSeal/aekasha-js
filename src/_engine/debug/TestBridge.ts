import { IS_DEBUG_ENV, IS_PROD_TEST_MODE } from '../kernel/config/Config';
import { loadDebugModuleAsync, useDebug } from '../kernel/config/DebugModules';
import type { PhysicsProbeReport } from '../features/physics/PhysicsProbeTypes';

/** The URL param that installs the test bridge: `?aekTest=true`, next to `?isDebug=true` or `?isProdTest=true` */
const TEST_BRIDGE_QUERY_PARAM = 'aekTest';

/**
 * The bridge's protocol version: bump it when a method's arguments or results change. The test
 * bridge's and the scene runner's.
 * @internal
 */
export const TEST_BRIDGE_VERSION = 5;

/**
 * Key events the bridge dispatches right before fixed physics steps of the first scene's world
 * (`step`: its getPhysicsSubStepIndex, 0 = the first step after the load). Set as
 * `window.__AEK_TEST_INPUT__` before the page's scripts run (the runner's init script), so the
 * first step is covered. Keys are `KeyboardEvent.key` values; the modifier flags follow the held
 * modifier keys. The test bridge's and the scene runner's.
 * @internal
 */
export type TestBridgeInputScript = {
  frames: { step: number; down?: string[]; up?: string[] }[];
};

/**
 * A scene's character paths ({@link AekTestBridge.getCharacterPaths}): what the scene runner
 * compares, run to run, to check that the characters move the same way (p610). The test bridge's
 * and the scene runner's.
 * @internal
 */
export type TestBridgeCharacterPaths =
  /** Every character's pose (and locomotion state) per step, over the probe's steps: `hash` covers
   * them all, `states` lists the locomotion states each character went through */
  | {
      status: 'DONE';
      steps: number;
      hash: string;
      characterCount: number;
      states: Record<string, string[]>;
    }
  /** No probe armed, or no character */
  | { status: 'NONE' };

/**
 * `whenSceneReady`'s result: the first scene is ready, or the wait timed out.
 * @deprecated Only the test bridge and the scene runner (by path, in `devTools/verify/`) use it.
 * It leaves `aekasha/debug` in engine 6.0.0 (`@internal` then). No replacement.
 */
export type TestBridgeSceneReady =
  /** `backend`: what the renderer runs on (WebGPU falls back to WebGL2 without `navigator.gpu`) */
  | { status: 'READY'; sceneId: string; backend: 'WEBGPU' | 'WEBGL' }
  | { status: 'TIMEOUT'; sceneId: string | null };

/**
 * `whenProbeDone`'s result: the determinism probe's report, or why there is none.
 * @deprecated Only the test bridge and the scene runner (by path, in `devTools/verify/`) use it.
 * It leaves `aekasha/debug` in engine 6.0.0 (`@internal` then). No replacement.
 */
export type TestBridgeProbeResult =
  | ({ status: 'DONE' } & PhysicsProbeReport)
  /** The probe isn't armed (no `?physicsProbe=N`, or prod test mode, where it doesn't load) */
  | { status: 'NOT_ARMED' }
  /** No report for the current scene in time (eg. a scene whose physics doesn't step) */
  | { status: 'TIMEOUT'; sceneId: string | null };

/**
 * `snapshot`'s result: what the canvas shows, as a PNG.
 * @deprecated Only the test bridge and the scene runner (by path, in `devTools/verify/`) use it.
 * It leaves `aekasha/debug` in engine 6.0.0 (`@internal` then). No replacement.
 */
export type TestBridgeSnapshot = {
  width: number;
  height: number;
  /** A PNG of the snapshot's RGBA8 pixels, byte exact, base64 encoded */
  pngBase64: string;
  /** Whether it went through the scene's PostFX pipeline */
  postFx: boolean;
};

/**
 * Every ECS world's systems in the order they run: world id → stage → `id@order` per system. Equal
 * `order`s run in registration order, so this is what a change in registration order shows in. The
 * test bridge's and the scene runner's.
 * @internal
 */
export type TestBridgeSystemOrder = Record<string, Record<string, string[]>>;

/**
 * A debugger tab host the scene runner's `debugger` configuration drives: the drawer or the
 * profiler window (p806 D14). The test bridge's and the scene runner's.
 * @internal
 */
export type TestBridgeTabHost = 'DRAWER' | 'PROFILER';

/**
 * Each tab host's tab ids in menu order: what the runner records beside the system order. The
 * test bridge's and the scene runner's.
 * @internal
 */
export type TestBridgeTabOrder = Record<TestBridgeTabHost, string[]>;

/**
 * A debugger element the bridge opened or found, marked for the runner's shot and axe as
 * `[data-aek-test-root="<root>"]`. The test bridge's and the scene runner's.
 * @internal
 */
export type TestBridgeDebuggerRoot =
  | { status: 'OPEN'; root: string; title: string }
  /** Not there (an unknown tab id, a list without the row, the debug env missing) */
  | { status: 'MISSING'; reason: string };

/**
 * `openDebuggerListRow`'s result: the row clicked, by its id. The test bridge's and the scene
 * runner's.
 * @internal
 */
export type TestBridgeListRowResult =
  | { status: 'CLICKED'; itemId: string }
  | { status: 'MISSING'; reason: string };

/**
 * `focusDebuggerControl`'s result: the control is focused, or the names of the controls it saw.
 * The test bridge's and the scene runner's.
 * @internal
 */
export type TestBridgeFocusResult =
  | { status: 'FOCUSED'; tag: string }
  | { status: 'MISSING'; seen: string[] };

/**
 * `window.__AEK_TEST__`: what the scene runner (`devTools/verify/scenes.ts`, p601) drives a page
 * through. Every method is safe to call more than once.
 * @internal
 */
export type AekTestBridge = {
  version: number;
  mode: 'DEBUG' | 'PROD_TEST';
  /** Resolves once the first scene has loaded: its load finished and the physics hold released,
   * plus two rendered frames */
  whenSceneReady: (opts?: { timeoutMs?: number }) => Promise<TestBridgeSceneReady>;
  /** Resolves with the determinism probe's report for the current scene, once the probe has
   * frozen physics at its step. Freeze only after it: a paused app loop never reaches the step. */
  whenProbeDone: (opts?: {
    timeoutMs?: number;
    /** Freeze (as {@link AekTestBridge.freeze}) in the frame the report arrives, and resolve once
     * frozen: a separate freeze() call would let frames run during its round trip */
    freeze?: boolean;
  }) => Promise<TestBridgeProbeResult>;
  /** Pauses the app and master loops and the day-night cycle, so a snapshot doesn't depend on
   * timing. Physics interpolation is pinned to the newest snapshot first (two frames), so moving
   * bodies show the step the probe hashed. The test clock's TSL `time` stops with them. */
  freeze: () => Promise<void>;
  /** `takeSnapshotAsync` of what the canvas shows (debug helpers hidden, PostFX included) */
  snapshot: (opts: { width: number; height: number }) => Promise<TestBridgeSnapshot>;
  /** Every world's system order now ({@link TestBridgeSystemOrder}) */
  getSystemOrder: () => TestBridgeSystemOrder;
  /** The current scene's character paths so far ({@link TestBridgeCharacterPaths}): read it after
   * whenProbeDone, when the probe's steps have all run */
  getCharacterPaths: () => TestBridgeCharacterPaths;
  /** The debugger's tab hosts' tab ids in menu order (the debug env only; empty lists without
   * the debugger) */
  getDebuggerTabOrder: () => Promise<TestBridgeTabOrder>;
  /** Opens the drawer, or the profiler window, on a tab, and marks the drawer or the window as
   * root `drawer` / `profiler` once the tab is mounted (two frames later) */
  openDebuggerTab: (opts: {
    host: TestBridgeTabHost;
    id: string;
  }) => Promise<TestBridgeDebuggerRoot>;
  /** Runs the row click of the open drawer tab's first list with row clicks (`index` 0-based),
   * which opens an edit window: see {@link AekTestBridge.markDebuggerWindows} */
  openDebuggerListRow: (opts: { index: number }) => Promise<TestBridgeListRowResult>;
  /**
   * Focuses a control by its name, inside a marked root (`root`) or any debugger root: a control
   * whose label, `aria-label`, title or text is `name`, else the first control after an element
   * whose text or title is `name` in its row (Tweakpane's labels aren't tied to their inputs).
   * `nth` picks among several (0-based).
   */
  focusDebuggerControl: (opts: {
    root?: string;
    name: string;
    nth?: number;
  }) => Promise<TestBridgeFocusResult>;
  /** Marks the open windows that have no mark yet as roots `window-<n>`, and returns them, bottom
   * to top in each layer: the windows the last step opened */
  markDebuggerWindows: () => TestBridgeDebuggerRoot[];
  /** Closes every open window (a kind's window is removed, as its close button does) */
  closeDebuggerWindows: () => Promise<void>;
};

declare global {
  interface Window {
    __AEK_TEST__?: AekTestBridge;
    /** The runner's input script ({@link TestBridgeInputScript}), read when the bridge installs */
    __AEK_TEST_INPUT__?: TestBridgeInputScript;
  }
}

/**
 * Installs `window.__AEK_TEST__` ({@link AekTestBridge}) when the page has `?aekTest=true`, in the
 * debug env and prod test mode only (never in a production build). Before the first scene load.
 * It also starts the test clock: every frame advances by 1/60 s (`setFixedFrameDelta`, and three's
 * TSL `time`), so what a page shows depends on how many frames ran, not on how long they took. The
 * boot's.
 * @internal
 */
export const registerTestBridge = async () => {
  if (!IS_DEBUG_ENV && !IS_PROD_TEST_MODE) return;
  if (new URLSearchParams(window.location.search).get(TEST_BRIDGE_QUERY_PARAM) !== 'true') return;
  const bridge = await loadDebugModuleAsync(() => import('./_dbg__TestBridge'), true, 'TestBridge');
  useDebug(bridge, true)?._installTestBridge();
};
