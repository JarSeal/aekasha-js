// The Rapier backend's world: init, create, delete, step, snapshots and the debug render.

import Rapier from '@dimforge/rapier3d-compat';
import { getPhysicsEngine } from '../../PhysicsUtils';
import type { PhysVector } from '../../types/PhysicsCommonTypes';
import type { PhysicsState } from '../../types/PhysicsConfigTypes';
import type { WorldAPI } from '../../types/PhysicsWorldTypes';
import type { LoopState } from '../../../../kernel/loop/MainLoop';
import { existsOrThrow } from '../../../../utils/Assert';
import { EngineWorldProxyAPI } from './proxies/EngineWorldProxyAPI';
import { clearEventRegistrations, drainAndDispatchEvents } from './RapierEvents';
import {
  backend,
  colliderAPIs,
  colliders,
  detachedBodies,
  handleToColliderId,
  handleToJointId,
  jointAPIs,
  joints,
  rigidBodies,
  rigidBodyAPIs,
} from './RapierState';

// @CHORE: needs a setter function
let physicsState: PhysicsState = {
  enabled: false,
  physicsEngine: 'RAPIER',
  workerTarget: 'MAIN_THREAD',
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
};

let worldCreated = false;
let physicsWorldAPI: WorldAPI;

export const init = (
  physicsSt: PhysicsState,
  isDebugEnv: boolean,
  _loopSt: LoopState,
  doNotCreateWorld?: boolean
) => {
  try {
    backend.RAPIER = existsOrThrow(
      getPhysicsEngine() as typeof Rapier,
      'Could not initialize RAPIER in RapierWorld.ts init().'
    );
    physicsState = physicsSt;
    backend.isDebugEnvironment = isDebugEnv || false;
    if (doNotCreateWorld) return;
    physicsWorldAPI = createWorld(physicsState.gravity, {
      timestep: physicsState.timestepRatio,
      numSolverIterations: physicsState.solverIterations,
      numInternalPgsIterations: physicsState.internalPgsIterations,
    });
    return physicsWorldAPI;
  } catch (err) {
    throw new Error(`Failed to initialize Rapier physics: ${(err as Error)?.message ?? err}`);
  }
};

export const createWorld = (
  gravity: PhysVector,
  opts?: {
    /** Timestep as delta time (eg. 1/60 = 0,0166666666667) */
    timestep?: number;
    /** Integer */
    numSolverIterations?: number;
    /** Integer */
    numInternalPgsIterations?: number;
  }
) => {
  if (worldCreated) return physicsWorldAPI;
  existsOrThrow(
    backend.RAPIER,
    'Could not get physics engine. Make sure the physics is initialized before creating a world.'
  );
  backend.world = new backend.RAPIER.World(
    new backend.RAPIER.Vector3(gravity.x, gravity.y, gravity.z)
  );
  backend.world.timestep = opts?.timestep ?? physicsState.timestepRatio;
  if (opts?.numSolverIterations) backend.world.numSolverIterations = opts.numSolverIterations;
  if (opts?.numInternalPgsIterations)
    backend.world.numInternalPgsIterations = opts.numInternalPgsIterations;
  physicsWorldAPI = new EngineWorldProxyAPI();
  worldCreated = true;
  return physicsWorldAPI;
};

export const deleteWorld = () => {
  // Clear the maps
  rigidBodies.clear();
  colliders.clear();
  joints.clear();
  rigidBodyAPIs.clear();
  colliderAPIs.clear();
  jointAPIs.clear();
  handleToColliderId.clear();
  handleToJointId.clear();
  detachedBodies.clear();
  clearEventRegistrations();

  // Reset (the running id counters are deliberately kept, see RapierState.ts' maps)
  worldCreated = false;
  physicsWorldAPI = undefined as unknown as WorldAPI;
  backend.eventQueue?.free();
  backend.eventQueue = undefined;

  // Free the world
  backend.world.free();
  backend.world = { step: () => {} } as Rapier.World;

  return { worldDeleted: true };
};

export const takeSnapshot = () => backend.world?.takeSnapshot();

export const restoreSnapshot = (snapshot: Uint8Array) => {
  // @TODO: we maybe need check all the rigidBodies and colliders
  // and recreate all the maps (rigidBodies, rigidBodyAPIs, colliders, colliderAPIs) here.
  backend.world = Rapier.World.restoreSnapshot(snapshot);
  physicsWorldAPI = new EngineWorldProxyAPI();
  return physicsWorldAPI;
};

export const debugRender = () => {
  const buffers = backend.world.debugRender();
  return { vertices: buffers.vertices, colors: buffers.colors };
};

export const step = (_eventQueue?: unknown, hooks?: unknown) => {
  backend.world.step(backend.eventQueue, hooks as Rapier.PhysicsHooks | undefined);
  drainAndDispatchEvents();
};
