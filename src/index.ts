import * as THREE from 'three/webgpu';
import { createRenderer, InitEngine, createSceneLoader, loadScene, IS_DEBUG_ENV } from 'aekasha';
import { character } from 'aekasha/character';
import { instancing } from 'aekasha/instancing';
import { lines } from 'aekasha/lines';
import { lod } from 'aekasha/lod';
import { physics } from 'aekasha/physics';
import { postFx } from 'aekasha/postfx';
import { skyBox } from 'aekasha/skybox';
import { spatial } from 'aekasha/spatial';
import { viewports } from 'aekasha/viewports';
import { createLoadingOverlay, type LoadingOverlay } from 'aekasha/ui';
import config from './CONFIG';
import { appData } from './generated';
import { appECSPlugins } from './AppECSPlugins';

InitEngine({
  config,
  data: appData,
  // Installed in this order, after the engine's kernel (the app's last)
  features: [
    physics(),
    character(),
    skyBox(),
    lod(),
    spatial(),
    instancing(),
    lines(),
    postFx(),
    viewports(),
    appECSPlugins,
  ],
  start: async () => {
    // The renderer first: everything drawn needs it
    // #region create-renderer (shown in the Hub: hub/pages/features/rendering/)
    await createRenderer({
      antialias: true,
      forceWebGL: false,
      toneMapping: THREE.ACESFilmicToneMapping,
      toneMappingExposure: 0.7,
      outputColorSpace: THREE.SRGBColorSpace,
      alpha: true,
      enableShadows: true,
      // Soft, blurred shadow edges. three's others: PCFSoftShadowMap, PCFShadowMap (its default)
      // and BasicShadowMap, the cheapest
      shadowMapType: THREE.VSMShadowMap,
    });
    // #endregion create-renderer

    // #region app-scene-loader (shown in the Hub: hub/pages/examples/ui-kit/)
    // The scene loader: the UI kit's loading overlay over the HUD, faded in before a scene loads
    // and out once the next scene is in, with the progress scene code reports
    let loaderOverlay: LoadingOverlay | null = null;
    createSceneLoader({
      id: 'main-scene-loader',
      // A new overlay per load: the load removes its container at its end
      loaderContainerFn: () => {
        // 500 ms fades, as the app's loader had: the frames a load renders while it fades are
        // the sky's clock (the scene runner's sky snapshots), so its pacing stays the same
        loaderOverlay = createLoadingOverlay({
          text: 'Loading the scene',
          fadeInMs: 500,
          fadeOutMs: 500,
        });
        return loaderOverlay.cmp;
      },
      loadStartFn: () => loaderOverlay?.showAsync() ?? Promise.resolve(true),
      loadEndFn: () => loaderOverlay?.hideAsync() ?? Promise.resolve(true),
      // Scene code reports its progress through getLoaderStatusUpdater(): the spinner becomes a bar
      updateLoaderStatusFn: (_loader, params) => {
        const loaded = Number(params?.loadedCount);
        const total = Number(params?.totalCount);
        if (!loaderOverlay || !(total > 0)) return;
        loaderOverlay.setProgress((loaded / total) * 100);
        loaderOverlay.setText(`Loading the scene, ${loaded} / ${total}`);
      },
    });
    // #endregion app-scene-loader

    // The example scenes' Hub tab (debug env)
    if (IS_DEBUG_ENV) {
      const { registerExampleHubTabs } = await import('./app/examples/_dbg__exampleHub');
      registerExampleHubTabs();
    }

    // The first scene (with ?isDebug=true or ?isProdTest=true, ?startScene=<sceneId> picks another)
    await loadScene({ sceneId: 'sceneTestECS' });
  },
});
