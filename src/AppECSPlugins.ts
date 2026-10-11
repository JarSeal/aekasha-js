import { ECSWorld } from 'aekasha';
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
 * IMPORT YOUR MANAGERS HERE
 * This triggers their static ECSWorld.registerPlugin()
 * and ECSWorld.registerComponentHooks() calls.
 * Example:
 *
 * import './app/managers/CombatManager.ts
 *
 * and/or
 *
 * ECSWorld.registerPlugin((world) => {
 *   registerHoverToolEffect()
 * });
 *
 */

// #region ecs-register-plugin (shown in the Hub: hub/pages/examples/ecs/)
// Runs for every ECS world, the ones that exist and every one created later
ECSWorld.registerPlugin((world) => {
  registerHoverToolEffect(world);
  registerFollowToolEffect(world);
  registerSunShadowFitEffect(world);
  registerMutualGravityEffect(world);
  registerMovingPlatformSystem(world);
  registerFollowObjectCameraRigSystem(world);
  registerSpinSystem(world);
});
// #endregion ecs-register-plugin
