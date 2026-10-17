// The physics facade: the engine-agnostic Physics API in front of the physics engine (Rapier, the
// backend) and its threading. It's modelled on Rapier's API, and another engine may need some of
// it reshaped. Its modules (p614 D7): this one (the state they share, a leaf), PhysicsRegistry
// (the API objects by id), PhysicsStepStats, PhysicsQueryStats, PhysicsMessaging (the worker's
// transport), PhysicsStepping, PhysicsBodies, PhysicsColliders, PhysicsJoints, PhysicsWorld and
// proxies/ (the WORKER_THREAD API objects).

import type { PhysicsDebugStateBuffer } from './PhysicsDebugStateBuffer';
import type { PhysicsTransformBuffer } from './PhysicsTransformBuffer';
import type { EngineAPIType } from './types/PhysicsBackendTypes';
import type { PhysicsState } from './types/PhysicsConfigTypes';
import type { WorldAPI } from './types/PhysicsWorldTypes';

/**
 * The state the facade's modules share: a leaf module, so none of them can read it before it
 * exists. Each field says which module writes it.
 * @internal
 */
export const facade: {
  /** The settings: `AppConfig.physics` over these defaults. initPhysics replaces the object. */
  state: PhysicsState;
  /** The backend, MAIN_THREAD only (initPhysics). */
  engAPI: EngineAPIType | null;
  /** Whether initPhysics has loaded the engine (or the worker has). */
  engineInitiated: boolean;
  /** The current world (PhysicsWorld.ts), or a no-op stub while there is none. */
  world: WorldAPI;
  /** Whether a world exists (PhysicsWorld.ts). */
  worldEnabled: boolean;
  /** Main-thread wrapper for the worker's hot-path transform buffer (WORKER_THREAD mode only).
   * SHARED_MEMORY: set once at createPhysicsWorld() and never replaced; every read sees the
   * snapshot latched at the start of the frame (latchPhysicsSnapshot). MESSAGE_BATCH: undefined
   * until the first TRANSFORMS_PUSH, then re-pointed at every subsequent push.
   */
  transformBuffer: PhysicsTransformBuffer | undefined;
  /** Main-thread wrapper for the worker's debug wireframe state buffer (WORKER_THREAD
   * only). Undefined until setPhysicsDebugStateTracking() turns tracking on for the first
   * time. SHARED_MEMORY: set once and never replaced. MESSAGE_BATCH: replaced on every
   * DEBUG_STATE_PUSH. */
  debugStateBuffer: PhysicsDebugStateBuffer | undefined;
} = {
  state: {
    enabled: false,
    physicsEngine: 'RAPIER',
    // AppConfig.physics' documented defaults live here (the one owner, p612 D4)
    workerTarget: 'WORKER_THREAD',
    timestep: 60,
    timestepRatio: 1 / 60,
    backgroundBehavior: 'PAUSE',
    isPaused: false,
    pausedTime: 0,
    pauseDurationTotal: 0,
    pauseReason: null,
    minDeltaTime: 1 / 30,
    maxDeltaTime: 1 / 10,
    maxSubSteps: 60,
    worldStepEnabled: true,
    visualizerEnabled: false,
    gravity: { x: 0, y: -9.81, z: 0 },
    solverIterations: 10,
    internalPgsIterations: 1,
    interpolationMode: 'NONE',
    useSAB: true,
    maxBodies: 2048,
    stepStatsEnabled: false,
  },
  engAPI: null,
  engineInitiated: false,
  world: { step: () => {} } as unknown as WorldAPI,
  worldEnabled: false,
  transformBuffer: undefined,
  debugStateBuffer: undefined,
};

/** Returns the current physicsState */
export const getPhysicsState = () => facade.state;

/** Returns the current WorldAPI instance (for live setGravity/setNumSolverIterations/etc.
 * calls), or the no-op stub if no world has been created yet via createPhysicsWorld(). */
export const getPhysicsWorld = () => facade.world;

/** Whether a physics world currently exists (i.e. createPhysicsWorld() has resolved and
 * deletePhysicsWorld() hasn't run since) — guards calls on the getPhysicsWorld() stub. */
export const isPhysicsWorldEnabled = () => facade.worldEnabled;
