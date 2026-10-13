// The engine's boot (InitEngine's steps), shared by the full-page boot (InitEngine) and an engine
// mounted into a page it doesn't own (mountAekasha, p611 D6). Apart from InitEngine.ts so a mount
// doesn't import the page's styles, which that module imports.
import type { Scene } from 'three/webgpu';
import {
  getConfig,
  initEnvironment,
  IS_DEBUG_ENV,
  IS_PROD_TEST_MODE,
  loadConfig,
  PROJECT_METADATA,
} from '../config/Config';
import { initAssets } from '../assets/AssetsAPI';
import { setAppData } from '../scene/AppData';
import { createHudContainer, getHUDRootCMP, KEEP_IN_VIEWS_CLASS } from '../../ui/HUD';
import {
  registerDefaultDebugKeyBindings,
  registerDefaultProdTestKeyBindings,
} from '../../debug/DefaultDebugKeyBindings';
import { addWindowListeners, initMainLoop, registerMainLoopDebugGUI } from '../loop/MainLoop';
import { createRootScene, getRootScene, registerScenesFromGeneratedData } from '../scene/Scene';
// The components' styles only: the page's (page.scss) are InitEngine's, which a mounted engine
// (mountAekasha) doesn't import (p611 D6)
import '../../ui/styles/index.scss';
import { llog } from '../../utils/Logger';
import { createRendererDebugGUI } from '../render/Renderer';
import { loadDraggableWindowStatesFromLS } from '../../ui/DraggableWindow';
import { createToaster } from '../../ui/Toaster';
import { getStatsCmp, registerStatsModule } from '../../debug/Stats';
import { createAssetsDebugGUI } from '../../debug/Assets';
import { getSvgIcon, registerBuiltInIcons } from '../../ui/icons/SvgIcon';
import { restoreSavedView } from '../render/Views';

// The kernel's systems and hooks, installed by the boot (here, where their modules were
// imported for their registrations, so the modules still load in the same order)
import { installKernel } from './Kernel';
import {
  createFeatureHost,
  installFeaturesAsync,
  checkFeatures,
  checkSceneFeatures,
  runFeatureDebugHooksAsync,
} from './Features';

import { initECSWorld, registerECSModule } from '../ecs/ECS';
import { initDebugCamera, registerCameraManager } from '../camera/Camera';
import { registerLightManager } from '../light/Light';
import { load3DSymbols } from '../../debug/symbols/3DSymbols';
import { registerDebugToolsModule } from '../../debug/DebugTools';
import { registerRaycastDebugGUI } from '../render/Raycast';
import { registerOnScreenTools } from '../../debug/OnScreenTools';
import {
  DEBUG_TOASTER_ID,
  flushQueuedDebugToasts,
  registerDebuggerGUI,
} from '../../debug/DebuggerGUI';
import { initUndoRedo, registerUndoRedoModule } from '../../debug/UndoRedo';
import { registerAxesGizmoModule } from '../../debug/AxesGizmo';
import { registerEnvBallModule } from '../../debug/EnvBall';
import { registerMaterialEditor } from '../../debug/MaterialEditor';
import { registerGPUMemoryDebugGUI } from '../../debug/GPUMemory';
import { registerProfiler } from '../../debug/Profiler';
import { registerTestBridge } from '../../debug/TestBridge';

import type { InitEngineOptions } from './InitEngine';

/**
 * The boot's options: {@link InitEngineOptions}, and where the HUD goes.
 * @internal
 */
export type BootOptions = InitEngineOptions & {
  /** The element the HUD root takes the place of. Default: the page's `#hudRoot` or
   * `#guiContainer` element. */
  hudSlot?: HTMLElement;
};

let isBooted = false;

/**
 * Whether the engine has booted (or is booting) in this page load.
 * @internal
 */
export const isEngineBooted = () => isBooted;

/**
 * The engine's boot, in order: InitEngine's steps. Once per page load: the engine's state is
 * module-level, and its registrations can't be undone, so a second boot throws.
 * @internal
 */
export const bootEngineAsync = async ({ config, data, features, start, hudSlot }: BootOptions) => {
  if (isBooted) {
    throw new Error(
      'The engine has already booted in this page (InitEngine or mountAekasha): it boots once per page load.'
    );
  }
  isBooted = true;

  // The environment first (env vars, URL params): every IS_* flag reads as production before
  // it. Then the configuration, which reads the debug flag for its LS overrides, and the data
  initEnvironment();
  loadConfig(config);
  // A list that can't install fails here, before anything boots, and so does a scene whose data
  // needs a feature the list doesn't have (the gatherer's manifest)
  checkFeatures(features);
  checkSceneFeatures(data.json.scenes, features);
  setAppData(data);
  addWindowListeners();

  // The debug tools' icons, before any debug module loads (prod test mode shows some too). A
  // production build drops the call and every built-in SVG: an app registers its own (registerIcon)
  if (IS_DEBUG_ENV || IS_PROD_TEST_MODE) registerBuiltInIcons();

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
  createHudContainer(hudSlot);

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
