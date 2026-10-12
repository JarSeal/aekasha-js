import type { FixedStepDriver } from './MainLoop';
import {
  flushPhysicsEvents,
  getPhysicsState,
  holdPhysicsStepping,
  latchPhysicsSnapshot,
  releasePhysicsStepping,
  resetPhysicsRayStats,
  resetPhysicsWorld,
  stepPhysics,
} from './PhysicsAPI';
import { deleteAllPhysicsEntities, settlePendingPhysicsEntities } from './PhysicsManager';
import type { SceneHooks } from './SceneHooks';

/**
 * Physics' part of a scene load (p101's deterministic loads): stepping is held from the start of
 * the load until every body of the next scene exists, which starts on a fresh world.
 * @internal
 */
export const physicsSceneHooks: SceneHooks = {
  // No stepping until the whole next scene exists (released in `entered`), so a scene's physics
  // never depends on how long its assets took to load
  loadStart: holdPhysicsStepping,
  // The previous scene's physics entities (its characters' went first, in their own exit hook)
  exit: () => deleteAllPhysicsEntities(),
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
