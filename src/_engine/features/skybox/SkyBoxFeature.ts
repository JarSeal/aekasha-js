import { IS_DEBUG_ENV } from '../../kernel/config/Config';
import type { EngineFeature } from '../../kernel/init/Features';
import { isCurrentScene } from '../../kernel/scene/Scene';
import type { SceneHooks } from '../../kernel/scene/SceneHooks';
import { deleteTexture, getTexture } from '../../kernel/assets/Texture';
import {
  activateSceneDefaultSkyBox,
  clearSkyBox,
  createSkyBoxDebugGUI,
  getActiveSkyBoxTexture,
  getSceneSkyBoxTextureIds,
  installSkyBoxSystem,
  registerSkyBox,
  registerSkyBoxDebugGUI,
} from './SkyBox';

/**
 * The sky box's part of the scenes' life: each scene's JSON sky boxes are registered with it, a
 * load clears the previous scene's sky box and shows the next one's default, and a deleted scene's
 * sky box textures go (except the one showing).
 * @internal
 */
export const skyBoxSceneHooks: SceneHooks = {
  sceneRegistered: (sceneId, data) => {
    for (const def of data.skyboxes ?? []) {
      // The gatherer resolves a sky box asset's id into its definition: a string left is skipped
      if (typeof def !== 'string') registerSkyBox(def, sceneId);
    }
  },
  // Its baked PMREMs go with the textures
  sceneDeleted: (sceneId) => {
    if (isCurrentScene(sceneId)) clearSkyBox();
    const activeTexture = getActiveSkyBoxTexture();
    for (const textureId of getSceneSkyBoxTextureIds(sceneId)) {
      const texture = getTexture(textureId);
      if (texture && texture !== activeTexture) deleteTexture(textureId);
    }
  },
  // The texture showing stays, whichever scene owns it
  retainedTextures: () => {
    const texture = getActiveSkyBoxTexture();
    return texture ? [texture] : [];
  },
  exit: () => clearSkyBox(),
  // The scene code has run (it can register its own sky boxes) and the scene is current
  created: async (sceneId) => {
    await activateSceneDefaultSkyBox(sceneId);
  },
};

/**
 * The sky box feature: a procedural or texture sky as the root scene's background and
 * environment, with day-night, sky lights and the scenes' JSON sky boxes (`skyboxes`).
 * Without it, a scene's sky boxes aren't registered or shown.
 * @example
 * ```ts
 * import { InitEngine } from 'aekasha';
 * import { skyBox } from 'aekasha/skybox';
 * import { appData } from './generated';
 *
 * InitEngine({ data: appData, features: [skyBox()], start: async () => {} });
 * ```
 */
export const skyBox = (): EngineFeature => ({
  id: 'skybox',
  install: (ctx) => {
    installSkyBoxSystem(ctx);
    ctx.addSceneHooks(skyBoxSceneHooks);
    // Gated like every debug hook (the hooks run only in the debug env): a production build then
    // drops the calls and the debug wrappers they name (verify:baselines fails on an ungated one)
    if (IS_DEBUG_ENV) {
      ctx.onDebug(registerSkyBoxDebugGUI);
      ctx.onDebugAfterStart(() => createSkyBoxDebugGUI());
    }
  },
});
