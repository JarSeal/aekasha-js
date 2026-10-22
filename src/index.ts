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
import { CMP } from 'aekasha/ui';
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

    // The scene loader: a full-screen cover that fades in before a scene loads, shows its
    // progress, and fades out once the next scene is in
    createSceneLoader({
      id: 'main-scene-loader',
      loaderContainerFn: () =>
        CMP({
          id: 'main-scene-loader-cmp',
          text: 'Loading…',
          style: {
            width: '100vw',
            height: '100vh',
            background: '#101218',
            color: '#e6e8ee',
            position: 'fixed',
            top: 0,
            left: 0,
            zIndex: 1000,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            transition: 'opacity 0.5s ease-in',
            opacity: 0,
          },
        }),
      // Each fade starts a task later, so the transition runs from the opacity the cover has
      loadStartFn: (loader) =>
        new Promise((resolve) => {
          setTimeout(() => {
            loader.loaderContainer?.updateStyle({ opacity: 1 });
            setTimeout(() => resolve(true), 500);
          }, 0);
        }),
      loadEndFn: (loader) =>
        new Promise((resolve) => {
          setTimeout(() => {
            loader.loaderContainer?.updateStyle({ opacity: 0 });
            setTimeout(() => resolve(true), 500);
          }, 0);
        }),
      // Scene code reports its progress through getLoaderStatusUpdater()
      updateLoaderStatusFn: (loader, params) => {
        if (params && 'loadedCount' in params && 'totalCount' in params) {
          loader.loaderContainer?.update({
            text: `Loading, ${params.loadedCount} / ${params.totalCount}`,
          });
        }
      },
    });

    // The example scenes' Hub tab (debug env)
    if (IS_DEBUG_ENV) {
      const { registerExampleHubTabs } = await import('./app/examples/_dbg__exampleHub');
      registerExampleHubTabs();
    }

    // The first scene (with ?isDebug=true or ?isProdTest=true, ?startScene=<sceneId> picks another)
    await loadScene({ sceneId: 'sceneTestECS' });
  },
});
