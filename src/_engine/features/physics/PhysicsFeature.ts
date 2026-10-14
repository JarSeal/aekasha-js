import { IS_DEBUG_ENV } from '../../kernel/config/Config';
import { getECSWorld } from '../../kernel/ecs/ECS';
import type { EngineFeature } from '../../kernel/init/Features';
import type { ImportExtension } from '../../kernel/assets/import/ImportExtensions';
import type { FixedStepDriver } from '../../kernel/loop/MainLoop';
import {
  createPhysicsAPIDebugGUI,
  createPhysicsWorld,
  flushPhysicsEvents,
  getPhysicsState,
  holdPhysicsStepping,
  initPhysics,
  latchPhysicsSnapshot,
  registerPhysicsAPIDebugGUI,
  releasePhysicsStepping,
  resetPhysicsRayStats,
  resetPhysicsWorld,
  stepPhysics,
} from './PhysicsAPI';
import {
  deleteAllPhysicsEntities,
  installPhysicsEntities,
  registerPhysicsDeterminismProbe,
  registerPhysicsWireframeDebugAsync,
  settlePendingPhysicsEntities,
} from './PhysicsEntity';
import { deleteScenePhysicsTierPolicies, installPhysicsTierPolicy } from './PhysicsTierPolicy';
import { installPhysicsTiers } from './PhysicsTiers';
import type { SceneHooks } from '../../kernel/scene/SceneHooks';
import { existsOrThrow } from '../../utils/Assert';

/**
 * The physics feature: the physics API (Rapier, on the main thread or in a worker, as
 * `AppConfig.physics` says), physics entities, simulation tiers and the tier distance policy.
 * It drives the main loop's fixed steps and takes part in every scene load (stepping is held until
 * the next scene's bodies exist, on a fresh world). With `physics.enabled` false it's installed
 * but creates no world at boot; without it in `features`, nothing of physics or Rapier loads.
 * @example
 * ```ts
 * import { InitEngine } from 'aekasha';
 * import { physics } from 'aekasha/physics';
 * import { appData } from './generated';
 *
 * InitEngine({ data: appData, features: [physics()], start: async () => {} });
 * ```
 */
export const physics = (): EngineFeature => ({
  id: 'physics',
  install: async (ctx) => {
    installPhysicsTiers(ctx);
    installPhysicsTierPolicy(ctx);
    installPhysicsEntities(
      ctx,
      existsOrThrow(getECSWorld(), 'Could not find the ECS world in the physics install.')
    );
    ctx.setFixedStepDriver(physicsFixedStepDriver);
    ctx.addSceneHooks(physicsSceneHooks);
    ctx.registerImportExtension(physicsImportExtension);

    await initPhysics(true); // doNotCreateWorld: createPhysicsWorld() below owns that
    // Before the first world: the debugger's saved world settings are what worlds are built from.
    // The flag here too (the loader checks it): a production build then drops the call
    if (IS_DEBUG_ENV) await registerPhysicsAPIDebugGUI();
    if (ctx.config.physics?.enabled) await createPhysicsWorld();

    // Gated like every debug hook (the hooks run only in the debug env): a production build then
    // drops the calls and the debug wrappers they name (verify:baselines fails on an ungated one)
    if (IS_DEBUG_ENV) {
      ctx.onDebug(async () => {
        // After the app's install: the wireframes' system ties with the app's camera rig system
        await registerPhysicsWireframeDebugAsync();
        // Before the first scene load, so `?physicsProbe=N` also catches the first scene enter
        await registerPhysicsDeterminismProbe();
      });
      ctx.onDebugAfterStart(createPhysicsAPIDebugGUI);
    }
  },
});

/**
 * Physics' part of a scene load (p101's deterministic loads): stepping is held from the start of
 * the load until every body of the next scene exists, which starts on a fresh world.
 * @internal
 */
export const physicsSceneHooks: SceneHooks = {
  // No stepping until the whole next scene exists (released in `entered`), so a scene's physics
  // never depends on how long its assets took to load
  loadStart: holdPhysicsStepping,
  // The previous scene's physics entities (its characters' went first, in their own exit hook),
  // then its scene-scoped tier policies
  exit: (prevSceneId) => {
    deleteAllPhysicsEntities();
    deleteScenePhysicsTierPolicies(prevSceneId);
  },
  // Every physics entity is gone by now: start the next scene on a fresh world, so a revisit
  // simulates exactly like the first visit (no leftover Rapier internal state). After the
  // cameras: in WORKER_THREAD mode this awaits the worker, and frames keep rendering meanwhile,
  // which needs a camera. Before the assets: imports can spawn bodies.
  beforeAssets: resetPhysicsWorld,
  entered: async () => {
    resetPhysicsRayStats();
    // Includes creates the scene code didn't await (and the prev scene's deletes, in
    // WORKER_THREAD mode), so every body starts stepping on the same step
    await settlePendingPhysicsEntities();
    releasePhysicsStepping();
  },
  // A failed load must not leave physics held (a no-op if it was already released)
  loadSettled: releasePhysicsStepping,
};

/**
 * Physics' part of the imports: `spawnImportedAsset` spawns the bodies and colliders the nodes'
 * custom props describe. Its code (and the collider derivation) loads on the first spawn with
 * physics nodes, so an app that never spawns one doesn't download it.
 * @internal
 */
export const physicsImportExtension: ImportExtension = {
  id: 'physics',
  spawnPhysics: async (spawn) =>
    (await import('./import/ImportPhysics')).spawnImportedPhysics(spawn),
};

/**
 * Physics as the loop's fixed-step driver: the transform snapshot latch, the fixed-timestep
 * accumulator (`stepPhysics`) and the collision events.
 * @internal
 */
export const physicsFixedStepDriver: FixedStepDriver = {
  latch: latchPhysicsSnapshot,
  step: (loopState, onBeforeStep) => {
    stepPhysics(loopState, onBeforeStep);
  },
  flushEvents: flushPhysicsEvents,
  isStepping: () => {
    const physicsState = getPhysicsState();
    return physicsState.enabled && physicsState.worldStepEnabled;
  },
};
