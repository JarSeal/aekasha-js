import type { EngineFeature } from 'aekasha';
import {
  registerHoverToolEffect,
  registerFollowToolEffect,
  registerSunShadowFitEffect,
  registerMutualGravityEffect,
  registerMovingPlatformSystem,
  registerFollowObjectCameraRigSystem,
} from 'aekasha/toolkit/ecs';
import { registerSpinSystem } from './app/examples/ecs/SpinSystem';

/**
 * The app's own feature: wires the app's and the toolkit's ECS systems and hooks into the engine.
 * `src/index.ts` lists it last in `InitEngine`'s `features`, so it installs after the engine's.
 * Register your own managers' plugins and component hooks here too (`ctx.registerPlugin`,
 * `ctx.registerComponentHooks`), or give a bigger part of the app its own feature.
 */
// #region ecs-register-plugin (shown in the Hub: hub/pages/examples/ecs/)
export const appECSPlugins: EngineFeature = {
  id: 'app',
  install: (ctx) => {
    // Runs for every ECS world, the ones that exist and every one created later
    ctx.registerPlugin((world) => {
      registerHoverToolEffect(world);
      registerFollowToolEffect(world);
      registerSunShadowFitEffect(world);
      registerMutualGravityEffect(world);
      registerMovingPlatformSystem(world);
      registerFollowObjectCameraRigSystem(world);
      registerSpinSystem(world);
    });
  },
};
// #endregion ecs-register-plugin
