/**
 * The scene runner's settings (`yarn verify:scenes`, `devTools/verify/scenes.ts`, p601): the
 * configurations every scene loads in, the snapshot tolerance, and per scene what to skip or
 * allow. Every exception carries its reason, so a later reader can tell whether it still holds.
 */

/** One page load of a scene: the mode and, in the debug env, the physics target */
export type VerifyConfigDef = {
  /** `?isDebug=true` (probe hash and snapshot) or `?isProdTest=true` (errors only: prod test mode
   * has no probe and no step freeze, so its snapshot would catch physics at any step) */
  mode: 'DEBUG' | 'PROD_TEST';
  /** The physics boot overrides (debug env only), written to localStorage before the page loads */
  physicsBoot?: { workerTarget: 'MAIN_THREAD' | 'WORKER_THREAD'; useSAB?: boolean };
  /** The probe's config string must start with this, or the configuration didn't apply (eg. the
   * dev server sent no COOP/COEP headers and SAB fell back to messages) */
  expectProbeConfig?: string;
  /** The debugger checks too (p806 D14), after the probe: in Chromium, on the scenes with
   * `debugger` settings only (`SceneVerifyConfig.debugger`) */
  debugger?: boolean;
};

/** The configurations a scene runs in: the three physics targets in the debug env, and prod test */
export const VERIFY_CONFIGS = {
  workerSab: {
    mode: 'DEBUG',
    physicsBoot: { workerTarget: 'WORKER_THREAD', useSAB: true },
    expectProbeConfig: 'WORKER_THREAD/SHARED_MEMORY',
  },
  workerMsg: {
    mode: 'DEBUG',
    physicsBoot: { workerTarget: 'WORKER_THREAD', useSAB: false },
    expectProbeConfig: 'WORKER_THREAD/MESSAGE_BATCH',
  },
  mainThread: {
    mode: 'DEBUG',
    physicsBoot: { workerTarget: 'MAIN_THREAD' },
    expectProbeConfig: 'MAIN_THREAD/',
  },
  prodTest: { mode: 'PROD_TEST' },
  /** `mainThread` (its hash and snapshot too), then the debugger: its tab order, each tab's,
   * window's and dialog's shot and axe counts, and the undo / redo scripts */
  debugger: {
    mode: 'DEBUG',
    physicsBoot: { workerTarget: 'MAIN_THREAD' },
    expectProbeConfig: 'MAIN_THREAD/',
    debugger: true,
  },
} satisfies Record<string, VerifyConfigDef>;

/** A configuration's name (`--config workerSab`) */
export type VerifyConfigName = keyof typeof VERIFY_CONFIGS;

/** Named sets for `--config`; a single configuration's name works too */
export const VERIFY_CONFIG_SETS: Record<string, VerifyConfigName[]> = {
  all: ['workerSab', 'workerMsg', 'mainThread', 'prodTest', 'debugger'],
  /** The inner loop: one physics target, debug only */
  quick: ['workerSab'],
};

/** The set a run without `--config` takes */
export const DEFAULT_CONFIG_SET = 'all';

/**
 * `--browser`: Chromium runs every configuration against its own baselines; Firefox runs the debug
 * configurations on WebGL2 and compares only their probe hashes, against Chromium's baseline (a
 * difference means the simulation depends on the JS engine)
 */
export type VerifyBrowser = 'chromium' | 'firefox';

/** `--browser`'s values */
export const VERIFY_BROWSERS: VerifyBrowser[] = ['chromium', 'firefox'];

/** The snapshot's size (16:9) */
export const SNAPSHOT_SIZE = { width: 512, height: 288 };

/**
 * A snapshot matches its baseline when both hold:
 * - `maxMeanDelta`: the mean absolute channel difference (0-255) over every RGB channel;
 * - `maxChangedRatio`: the share of pixels whose largest channel difference is over
 *   `pixelThreshold` (an edge that moved, not a gradient that shifted by a step).
 */
export type SnapshotTolerance = {
  maxMeanDelta: number;
  maxChangedRatio: number;
  pixelThreshold: number;
};

/** A snapshot's tolerance unless the scene's `snapshot.tolerance` sets its own */
export const DEFAULT_SNAPSHOT_TOLERANCE: SnapshotTolerance = {
  maxMeanDelta: 0.5,
  maxChangedRatio: 0.002,
  pixelThreshold: 24,
};

/** Fixed steps the probe runs before it freezes physics (2 s at 60 Hz) */
export const DEFAULT_PROBE_STEPS = 120;

/** How long prod test mode runs after the scene is ready, to catch errors of its first frames */
export const PROD_TEST_SETTLE_MS = 3000;

/** Per page load: the scene's load, then the probe. The test clock runs one physics step per
 * rendered frame, so the probe takes its steps in frames: a heavy scene on SwiftShader (about 1 s a
 * frame) needs minutes. The limit only catches a page that never gets there. */
export const READY_TIMEOUT_MS = 180_000;
/** How long the probe may take to reach its steps (see {@link READY_TIMEOUT_MS}) */
export const PROBE_TIMEOUT_MS = 300_000;

/** An error that doesn't fail a run, matched against the console line or page error message, in
 * every browser or only in `browsers` */
export type AllowedError = { pattern: RegExp; reason: string; browsers?: VerifyBrowser[] };

/** Allowed in every scene and configuration */
export const GLOBAL_ALLOWED_ERRORS: AllowedError[] = [];

/**
 * The `debugger` configuration's page size: tall, so a drawer tab's shot holds its whole content
 * (the drawer is the viewport's height)
 */
export const DEBUGGER_VIEWPORT = { width: 1280, height: 2000 };

/**
 * What a debugger shot masks (Playwright's `mask`, Playwright's selectors): the figures that change
 * run to run with the loops frozen (timings, memory, clocks, a build's time): the UI kit's
 * monitors, Tweakpane's in the windows still on it (p806 Phase 3 ports them), the profiler
 * Overview's figures (p807 rewrites that tab) and the About dialog's build line
 */
export const DEBUGGER_LIVE_MASKS: string[] = [
  '.aekMonitor',
  '.tp-sglv',
  '.tp-mllv',
  '.tp-grlv',
  '.profilerValue',
  '.profilerSub',
  // The About dialog's build: the commit, local changes and the time (Playwright's selector)
  'dt:text-is("Build") + dd',
];

/**
 * A window or dialog the `debugger` configuration opens, shoots (`window.<name>`) and checks with
 * axe. Its steps start with every window closed; the shot is of the windows its last step opened.
 */
export type DebuggerWindowOpener = {
  /** The shot's name */
  name: string;
  /** The drawer tab the steps start on; none: the drawer stays as it is (the on-screen tools) */
  tab?: string;
  /** A row of the tab's first list with row clicks (0-based), clicked first */
  row?: number;
  /** Controls pressed with Enter, in order, each found by its name (its label, title or text): in
   * the window the step before opened, else in the tab, else in any debugger root */
  press?: string[];
  /** Why the controls are clicked instead (a DOM click on the focused control), eg. a scene whose
   * action map takes Enter */
  clickReason?: string;
};

/**
 * An undo / redo script (p806 D14): a control changed by keys, then (when `undoable`) Ctrl+Z and
 * Ctrl+Shift+Z with the focus on the page. The bound value must change, go back on the undo and
 * forward on the redo, and the saved value (`ls`) follow it at each of the three. It says what's
 * true today: a phase that changes a control's keys changes its script.
 */
export type DebuggerUndoScript = {
  /** The script's name in a failure */
  name: string;
  /** The drawer tab it starts on */
  tab: string;
  /** A row of the tab's list whose click opens the window the control is in */
  row?: number;
  /** The control, by its name (as {@link DebuggerWindowOpener.press}); `nth` among several */
  control: string;
  nth?: number;
  /** Pressed on the control (Playwright's key names) */
  keys: string[];
  /** A page expression, awaited, giving the bound value as JSON (it may `await import()` a module
   * by its dev server URL, `/_engine/…` or `/app/…`) */
  read: string;
  /** Where localStorage keeps the bound value: the key, and the path into its JSON */
  ls?: { key: string; path: string[] };
  /** false: the change isn't recorded for undo (the day-night speed buttons), so only the change is
   * checked */
  undoable: boolean;
};

/** A scene's `debugger` settings: what the `debugger` configuration opens in it */
export type SceneDebuggerConfig = {
  /** The drawer tabs it shoots and checks: every tab, or these (a scene's own tabs) */
  tabs: 'ALL' | string[];
  /** The profiler window's tabs too */
  profiler?: boolean;
  windows?: DebuggerWindowOpener[];
  undoScripts?: DebuggerUndoScript[];
  /** The material editor (p806 Phase 2 section 3): its view entered with `material` (a material
   * asset's id) loaded, its selector and each tab of its drawer shot and checked
   * (`materialEditor.selector`, `materialEditor.<tabId>`), then the Runtime view again */
  materialEditor?: { material: string };
  /** Shots (`drawer.<id>`, `window.<name>`) whose difference only warns, with the reason (eg. rows
   * in the order their loads finished) */
  unstableShots?: { shots: string[]; reason: string };
};

/** A scene's own settings, `SCENE_VERIFY_CONFIG[sceneId]` */
export type SceneVerifyConfig = {
  /** Fixed steps before the probe freezes physics (default {@link DEFAULT_PROBE_STEPS}) */
  probeSteps?: number;
  /** Key events played right before given steps (`devTools/verify/inputs/<name>.json`, the test
   * bridge's `TestBridgeInputScript`), so the characters' path hash covers a recorded run (p610
   * D6). The path hash is compared in every scene with characters, on `MAIN_THREAD` only (the worker
   * targets' characters aren't deterministic, p428); `unstableHash` applies to it */
  inputScript?: string;
  /** Not loaded at all, or not in these configurations / browsers */
  skip?: { reason: string; configs?: VerifyConfigName[]; browsers?: VerifyBrowser[] };
  allowedErrors?: AllowedError[];
  /** A changed hash only warns (eg. characters: not hashed, but they push bodies around), in every
   * configuration and browser or only in these. In Firefox, "changed" is against Chromium's
   * baseline: a Firefox-only entry is a finding (the simulation depends on the JS engine), so its
   * reason names its issue file */
  unstableHash?: { reason: string; configs?: VerifyConfigName[]; browsers?: VerifyBrowser[] };
  /** No snapshot comparison, or a looser tolerance (eg. characters, which aren't deterministic) */
  snapshot?:
    | { skip: true; reason: string }
    | { tolerance: Partial<SnapshotTolerance>; reason: string };
  /** The `debugger` configuration runs only on the scenes that have these */
  debugger?: SceneDebuggerConfig;
};

/** By scene id. A scene that isn't listed runs with the defaults */
export const SCENE_VERIFY_CONFIG: Record<string, SceneVerifyConfig> = {
  // The engine's tabs, the profiler, and the windows and dialogs that need no scene of their own
  testDebugScene: {
    debugger: {
      tabs: 'ALL',
      profiler: true,
      windows: [
        { name: 'camera', tab: 'camerasControls', row: 0 },
        { name: 'light0', tab: 'lightsControls', row: 0 },
        { name: 'light1', tab: 'lightsControls', row: 1 },
        { name: 'ecsWorld', tab: 'ecsControls', row: 0 },
        { name: 'asset', tab: 'assetsControls', row: 0 },
        { name: 'rayTesterThree', tab: 'rayCastControls', press: ['Three.js ray tester'] },
        { name: 'rayTesterPhysics', tab: 'rayCastControls', press: ['Physics ray tester'] },
        { name: 'about', press: ['About Ækasha'] },
        { name: 'keysAekasha', tab: 'debugToolsControls', press: ['Debug key shortcuts [I]'] },
        {
          name: 'keysApp',
          tab: 'debugToolsControls',
          press: ['App key shortcuts (current scene) [U]'],
        },
      ],
      // A TSL material without textures: its Params tab has numbers and colours
      materialEditor: { material: 'triplanarCheckerboard' },
      undoScripts: [
        {
          name: 'camera window position',
          tab: 'camerasControls',
          row: 0,
          control: 'Position',
          keys: ['ArrowUp'],
          read: "(async () => { const ecs = await import('/_engine/kernel/ecs/ECS.ts'); return ecs.getECSWorld().getComponent(ecs.getEntityIdByAppId('p300Camera'), 'CORE_TRANSFORM').position.x; })()",
          ls: {
            key: 'AEK_debugCams',
            path: ['testDebugScene', 'cams', 'p300Camera', 'position', 'x'],
          },
          undoable: true,
        },
        {
          name: 'light list toggle',
          tab: 'lightsControls',
          control: 'Enabled',
          keys: ['Enter'],
          read: "(async () => { const ecs = await import('/_engine/kernel/ecs/ECS.ts'); return ecs.getECSWorld().getComponent(ecs.getEntityIdByAppId('p300Ambient'), 'CORE_OBJECT3D').value.visible; })()",
          ls: {
            key: 'AEK_debugLights',
            path: ['testDebugScene', 'lights', 'p300Ambient', 'enabled'],
          },
          undoable: true,
        },
      ],
    },
  },
  assetCompare: {
    debugger: {
      tabs: ['assetCompare'],
      unstableShots: {
        shots: ['drawer.assetCompare'],
        reason: "the report lists each slot's textures in the order their loads finished",
      },
    },
  },
  exampleDebugTab: {
    debugger: {
      tabs: ['exampleBoxes', 'exampleHub'],
      undoScripts: [
        {
          name: 'declarative slider',
          tab: 'exampleBoxes',
          control: 'Boxes',
          // The slider's spin button (Tweakpane's knob took ArrowRight)
          keys: ['ArrowUp'],
          read: "(async () => (await import('/app/examples/debugTab/exampleDebugTab.ts')).boxSettings.count)()",
          ls: { key: 'AEK_debugExampleBoxes', path: ['count'] },
          undoable: true,
        },
      ],
    },
  },
  // No physics bodies (an empty hash): the steps only set the frames before the snapshot, and
  // its frames take about 1 s each on SwiftShader
  largeWorld: { probeSteps: 30 },
  lodShowcase: {
    debugger: {
      tabs: ['lodShowcaseDemo', 'exampleHub'],
      windows: [{ name: 'lodEntity', tab: 'lodControls', row: 0 }],
      undoScripts: [
        {
          name: 'day-night speed buttons (custom)',
          tab: 'skyBoxControls',
          control: '▶▶ ×10',
          keys: ['Enter'],
          read: "(async () => (await import('/_engine/features/skybox/SkyDayNight.ts')).getDayNightSpeed())()",
          undoable: false,
        },
      ],
    },
  },
  space: {
    debugger: { tabs: ['spaceDemo'] },
    unstableHash: {
      reason:
        "MutualGravity reads the worker's last synced poses, up to a frame stale, so the worker targets aren't deterministic (its JSDoc); MAIN_THREAD is",
      configs: ['workerSab', 'workerMsg'],
    },
  },
  thirdPersonGymScene: {
    // 10 s of the input script: the two players walk, turn, run, crouch and jump, the dummy loops
    probeSteps: 600,
    inputScript: 'thirdPersonGymScene',
    // Every engine tab with a scene's content, and the windows testDebugScene has no entity for
    debugger: {
      tabs: 'ALL',
      windows: [
        { name: 'physicsEntity', tab: 'physicsApiControls', row: 0 },
        { name: 'postFxPass', tab: 'postFxControls', row: 0 },
        { name: 'character', tab: 'charactersControls', row: 0 },
        {
          name: 'characterState',
          tab: 'charactersControls',
          row: 0,
          press: ['Open character state window'],
          clickReason:
            "the gym's action map binds Enter (jump) and prevents its default, so Enter on a focused debugger button does nothing (p806 D12's finding)",
        },
      ],
    },
    unstableHash: {
      reason:
        "in the worker targets its characters aren't deterministic (they tick on the main thread against the latched snapshot and async casts: p428) and push the hashed bodies around",
      configs: ['workerSab', 'workerMsg'],
    },
  },
  textureArrays: {
    allowedErrors: [
      {
        pattern:
          /^\[console\.error\] Could not load texture array "textureArrays\/(noOutputFallback|noOutput|layerCountMismatch)"/,
        reason:
          'The scene tests how loadTextureAsync fails for a texture array asset (it logs "Expected: the next 3 errors" first)',
      },
    ],
  },
  textureAtlases: {
    allowedErrors: [
      {
        pattern:
          /^\[console\.error\] Could not load texture atlas slot "textureAtlases\/(noOutputFallback|noOutput|tooManyLevels|droppedPlusStored|sizeMismatch|fullChainAsProtected)"/,
        reason:
          'The scene tests how loadTextureAsync fails for an atlas slot (it logs "Expected: the next 6 errors" first)',
      },
    ],
  },
};
