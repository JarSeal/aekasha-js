import * as THREE from 'three/webgpu';
import type { EngineFeature } from 'aekasha';
import {
  registerHoverToolEffect,
  registerFollowToolEffect,
  registerSunShadowFitEffect,
  registerMutualGravityEffect,
  registerMovingPlatformSystem,
  registerFollowObjectCameraRigSystem,
} from 'aekasha/toolkit/ecs';
import { setFogColorSource, setFogSunSource } from 'aekasha/fog';
import { getSkyHorizonColor, getSunDirection, getSunElevation } from 'aekasha/skybox';
import { setSurfaceSunSource } from 'aekasha/surface';
import { registerTerrainGenerators, registerTerrainScatter } from 'aekasha/toolkit/terrain';
import { registerSpinSystem } from './app/examples/ecs/SpinSystem';
import { registerGymDummyBrain } from './app/scenes/thirdPersonGymScene/GymDummyBrain';

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
    // The app's brain kinds (a brain goes with its character, so no scene adds a system for it)
    registerGymDummyBrain();
    // The toolkit's terrain block generators (`noiseTerrain`, `rulesTerrain`), which blocks name
    registerTerrainGenerators();
    // The toolkit's terrain scatter generator (`terrainScatter`), which scatters name
    registerTerrainScatter();
    // Wet surfaces dry with the sky box's sun: fastest under a high sun, slowest at night
    setSurfaceSunSource(() => getSunElevation());
    // The fog takes the sky's horizon colour away from the sun, and glows toward the sky's
    // horizon on the sun's side, so the far fog meets the sky all round the day-night cycle
    setFogColorSource((out) => getSkyHorizonColor(out) !== null);
    const sunHorizon = { direction: new THREE.Vector3() }; // read every frame: no allocation
    setFogSunSource((direction, color) => {
      if (!getSunDirection(direction)) return false;
      sunHorizon.direction.copy(direction);
      return getSkyHorizonColor(color, sunHorizon) !== null;
    });
  },
};
// #endregion ecs-register-plugin
