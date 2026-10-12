import type { Scene } from 'three/webgpu';
import {
  type AppConfig,
  getConfig,
  initEnvironment,
  IS_DEBUG_ENV,
  IS_PROD_TEST_MODE,
  loadConfig,
  PROJECT_METADATA,
} from './core/Config';
import { initAssets } from './core/Assets/AssetsAPI';
import { type AppData, setAppData } from './core/AppData';
import { createHudContainer, getHUDRootCMP, KEEP_IN_VIEWS_CLASS } from './core/HUD';
import {
  registerDefaultDebugKeyBindings,
  registerDefaultProdTestKeyBindings,
} from './core/Input/DefaultDebugKeyBindings';
import { addWindowListeners, initMainLoop, registerMainLoopDebugGUI } from './core/MainLoop';
import { createRootScene, getRootScene, registerScenesFromGeneratedData } from './core/Scene';
import './styles/index.scss';
import { lerror, llog } from './utils/Logger';
import { createRendererDebugGUI } from './core/Renderer';
import { loadDraggableWindowStatesFromLS } from './core/UI/DraggableWindow';
import { createToaster } from './core/UI/Toaster';
import { getStatsCmp, registerStatsModule } from './debug/Stats';
import { createAssetsDebugGUI } from './debug/Assets';
import { getSvgIcon } from './core/UI/icons/SvgIcon';
import { restoreSavedView } from './core/ViewManager';

// The kernel's systems and hooks, installed by InitEngine (here, where their modules were
// imported for their registrations, so the modules still load in the same order)
import { installKernel } from './core/Kernel';
import {
  createFeatureHost,
  type EngineFeature,
  installFeaturesAsync,
  checkFeatures,
  runFeatureDebugHooksAsync,
} from './core/Features';

import { initECSWorld, registerECSModule } from './core/ECS';
import { initDebugCamera, registerCameraManager } from './core/CameraManager';
import { registerLightManager } from './core/LightManager';
import { load3DSymbols } from './debug/3DSymbols';
import { registerDebugToolsModule } from './debug/DebugToolsManager';
import { registerRaycastDebugGUI } from './core/Raycast';
import { registerOnScreenTools } from './debug/OnScreenTools';
import { DEBUG_TOASTER_ID, flushQueuedDebugToasts, registerDebuggerGUI } from './debug/DebuggerGUI';
import { initUndoRedo, registerUndoRedoModule } from './debug/UndoRedo';
import { registerAxesGizmoModule } from './debug/AxesGizmo';
import { registerEnvBallModule } from './debug/EnvBall';
import { registerMaterialEditor } from './debug/MaterialEditor';
import { registerGPUMemoryDebugGUI } from './debug/GPUMemory';
import { registerProfiler } from './debug/Profiler';
import { registerTestBridge } from './debug/TestBridge';

/** {@link InitEngine}'s options. */
export type InitEngineOptions = {
  /** The app's configuration, merged over the engine defaults per top-level key (the template
   * keeps it in `src/CONFIG.ts`). Default: the engine defaults only. */
  config?: AppConfig;
  /** The app's gathered scenes and assets: `appData` from `src/generated/`, which
   * `yarn gatherAppData` writes. */
  data: AppData;
  /** The features to install, in this order, after the kernel (p607 D1): each once, awaiting
   * each `install`. The engine installs nothing else on its own: each engine feature comes from
   * its entry (`physics()` from `aekasha/physics`, …), and one not listed isn't installed
   * (`createLines` throws without `lines()`, a scene's `postFx` is ignored without `postFx()`).
   * The template lists all nine and the app's own last (`appECSPlugins`); `[]` is the kernel
   * alone. */
  features: EngineFeature[];
  /** The app's start: creates the renderer and the scene loader and loads the first scene. Runs
   * after the engine's own init (and the debug tools' registration), before the main loop starts. */
  start: () => Promise<void>;
};

/**
 * Initializes the engine with the app's configuration and data, then runs the app's `start`. Call
 * it once, first thing: it reads the environment (the env vars and the `?isDebug` / `?isProdTest`
 * URL params), so the `IS_*` flags read as production until it runs.
 * @example
 * ```ts
 * import { InitEngine, createRenderer, loadScene } from 'aekasha';
 * import config from './CONFIG';
 * import { character } from 'aekasha/character';
 * import { instancing } from 'aekasha/instancing';
 * import { lines } from 'aekasha/lines';
 * import { lod } from 'aekasha/lod';
 * import { physics } from 'aekasha/physics';
 * import { postFx } from 'aekasha/postfx';
 * import { skyBox } from 'aekasha/skybox';
 * import { spatial } from 'aekasha/spatial';
 * import { viewports } from 'aekasha/viewports';
 * import { appData } from './generated';
 * import { appECSPlugins } from './AppECSPlugins';
 *
 * InitEngine({
 *   config,
 *   data: appData,
 *   features: [
 *     physics(),
 *     character(),
 *     skyBox(),
 *     lod(),
 *     spatial(),
 *     instancing(),
 *     lines(),
 *     postFx(),
 *     viewports(),
 *     appECSPlugins,
 *   ],
 *   start: async () => {
 *     await createRenderer({ antialias: true });
 *     await loadScene({ sceneId: 'myScene' });
 *   },
 * });
 * ```
 */
export const InitEngine = (options: InitEngineOptions) =>
  // A promise's catch, not a try block: Rollup keeps everything inside a try block whole (its
  // `tryCatchDeoptimization`), so the debug blocks below and the app's `start` stayed in a
  // production build after `__AEK_DEBUG__` had folded their conditions
  initEngineAsync(options).catch((err: unknown) => {
    const msg = 'Error at app start function (InitEngine)';
    lerror(msg, err);
    throw new Error(msg);
  });

/** {@link InitEngine}'s steps, in order. */
const initEngineAsync = async ({ config, data, features, start }: InitEngineOptions) => {
  // The environment first (env vars, URL params): every IS_* flag reads as production before
  // it. Then the configuration, which reads the debug flag for its LS overrides, and the data
  initEnvironment();
  loadConfig(config);
  // A list that can't install fails here, before anything boots
  checkFeatures(features);
  setAppData(data);
  addWindowListeners();

  // Logs the engine, toolkit and app versions (they are in the HTML meta tags too)
  consoleBootText();

  // Create base scene
  createRootScene();

  // The kernel before the first world: its core plugin's systems come first in every world
  const featureHost = createFeatureHost(getConfig());
  installKernel(featureHost.ctx);

  // Init ECS
  const ecsWorld = initECSWorld();

  // HUD container
  createHudContainer();

  // Resolve the assets config (the assets worker is only started by its first request)
  initAssets();

  // The flag here too (load3DSymbols checks it): a production build then drops the call
  if (IS_DEBUG_ENV) await load3DSymbols();

  // Register Managers
  await registerCameraManager();
  await registerLightManager(ecsWorld);

  // Initializes the debug camera (if in debug mode)
  await initDebugCamera(ecsWorld);

  // The features, in list order (p607 D1): physics boots in its install
  await installFeaturesAsync(features, featureHost);

  // Register scenes from generated data: after the installs, so each feature's sceneRegistered
  // hook sees every scene (the sky box registers the scenes' sky boxes)
  await registerScenesFromGeneratedData();

  if (IS_DEBUG_ENV) {
    await registerUndoRedoModule();
    initUndoRedo();
    await registerStatsModule();
    await registerRaycastDebugGUI();
    await registerDebuggerGUI();
    await registerAxesGizmoModule();
    await registerEnvBallModule();
    // Before restoreSavedView (the end of InitEngine) can switch back to it
    await registerMaterialEditor();
    registerDefaultDebugKeyBindings();
    await registerECSModule();
    // The features' own, in install order
    await runFeatureDebugHooksAsync(featureHost.debugHooks);
  }
  if (IS_DEBUG_ENV || IS_PROD_TEST_MODE) {
    // Loaded here (not the IS_DEBUG_ENV-only block above) so isProdTest mode can still read
    // the persisted "debug start scene" setting via getDebugToolsState() in SceneLoader.ts —
    // registerDebugToolsModule()/getDebugToolsState() are prod-test-aware themselves; the
    // debug tools UI panel they back stays IS_DEBUG_ENV-only regardless (initDebugTools()).
    await registerDebugToolsModule();
    // Debug env, and prodTest when enabled there. Before the windows are restored from LS
    await registerProfiler();
    // A profiler tab (loads where the profiler does). Before start: its allocation
    // tracker must see the renderer's init()
    await registerGPUMemoryDebugGUI();
    await registerMainLoopDebugGUI();
    await registerOnScreenTools();
    if (IS_PROD_TEST_MODE) registerDefaultProdTestKeyBindings();
  }

  // The scene runner's window.__AEK_TEST__ (?aekTest=true; debug env and prod test mode).
  // Before the first scene load, so it sees that load and its probe report. The flags here too
  // (registerTestBridge checks them): a production build then drops the call
  if (IS_DEBUG_ENV || IS_PROD_TEST_MODE) await registerTestBridge();

  await start();

  // Start engine/loop if root scene has children
  const rootScene = getRootScene() as Scene;
  if (rootScene.children.length) initMainLoop();

  // Create debug GUIs and utils
  if (IS_DEBUG_ENV) {
    await createRendererDebugGUI();
    await createAssetsDebugGUI();
    // The features' own, in install order
    await runFeatureDebugHooksAsync(featureHost.debugAfterStartHooks);

    // Make the debug toaster appear above the stats cmp
    const statsCmp = getStatsCmp();
    let yOffset = '-268px';
    if (statsCmp) yOffset = `${-statsCmp.elem.offsetHeight - 16}px`;
    getHUDRootCMP().add(
      createToaster({
        id: DEBUG_TOASTER_ID,
        // Shown in every view (ViewManager.ts)
        className: KEEP_IN_VIEWS_CLASS,
        settings: {
          animationTimeMs: 200,
          verticalPosition: 'bottom',
          horizontalPosition: 'left',
          toastDirection: 'up',
          toastAppearFromDirection: 'left',
          offset: { x: '18px', y: yOffset },
          closeBtnIcon: getSvgIcon('x'),
          icons: {
            info: getSvgIcon('info'),
            warning: getSvgIcon('warning'),
            alert: getSvgIcon('alert'),
          },
        },
      })
    );
    // Toasts from the boot, eg. an unknown ?startScene
    flushQueuedDebugToasts();
  }

  // Load draggableWindow states
  loadDraggableWindowStatesFromLS();

  // Back to the view that was active before the refresh: last, so the scene and every debug
  // GUI exist (hidden by the view) when switching back. Not awaited: the loop already runs
  if (IS_DEBUG_ENV) void restoreSavedView();
};

const consoleBootText = () => {
  const meta = PROJECT_METADATA;

  // Define styles
  const sBrand = 'color: #00d4ff; font-weight: bold; font-size: 1.2em;';
  const sInfo = 'color: #888;';
  const sBlue = 'color: #00d2ff; font-weight: bold;';
  const sEng = 'color: #ff9955; font-style: italic;';
  const sToolkit = 'color: #ff9955; font-style: italic;';
  const sApp = 'color: #ff9955; font-style: italic;';

  llog(
    `%c${meta.engine.name}%c starting...\n` +
      `%cEngine version: %c${meta.engine.version} %c${meta.engine.codename}\n` +
      `%cToolkit version: %c${meta.toolkit.version} %c${meta.toolkit.codename}\n` +
      `%cApp version: %c${meta.app.version} %c${meta.app.codename}\n` +
      `%cVersion checksum: %c${meta.versionChecksum}`,
    // Line 1 styles
    sBrand,
    sInfo,
    // Line 2 styles
    sInfo,
    sBlue,
    sEng,
    // Line 3 styles
    sInfo,
    sBlue,
    sToolkit,
    // Line 4 styles
    sInfo,
    sBlue,
    sApp,
    // Line 5 styles
    sInfo,
    sBlue
  );
};
