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

/** The settings init() was given: the facade's own (p612 D4, one owner of the defaults). */
let physicsState: PhysicsState | undefined;

let worldCreated = false;
let physicsWorldAPI: WorldAPI | undefined;

/**
 * Keeps the settings and the debug flag, and creates the world from the settings (none with
 * `doNotCreateWorld`, then undefined). Throws when initPhysicsEngine hasn't loaded Rapier.
 * @internal
 */
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
    physicsWorldAPI = createWorld(physicsSt.gravity, {
      timestep: physicsSt.timestepRatio,
      numSolverIterations: physicsSt.solverIterations,
      numInternalPgsIterations: physicsSt.internalPgsIterations,
    });
    return physicsWorldAPI;
  } catch (err) {
    throw new Error(`Failed to initialize Rapier physics: ${(err as Error)?.message ?? err}`);
  }
};

/**
 * Creates the world; while one exists, returns it as it is (deleteWorld first to replace it). The
 * timestep defaults to init's settings, then to Rapier's.
 * @internal
 */
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
  if (worldCreated && physicsWorldAPI) return physicsWorldAPI;
  existsOrThrow(
    backend.RAPIER,
    'Could not get physics engine. Make sure the physics is initialized before creating a world.'
  );
  backend.world = new backend.RAPIER.World(
    new backend.RAPIER.Vector3(gravity.x, gravity.y, gravity.z)
  );
  // Without either, Rapier's own default (1/60) stays
  const timestep = opts?.timestep ?? physicsState?.timestepRatio;
  if (timestep !== undefined) backend.world.timestep = timestep;
  if (opts?.numSolverIterations) backend.world.numSolverIterations = opts.numSolverIterations;
  if (opts?.numInternalPgsIterations)
    backend.world.numInternalPgsIterations = opts.numInternalPgsIterations;
  physicsWorldAPI = new EngineWorldProxyAPI();
  worldCreated = true;
  return physicsWorldAPI;
};

/**
 * Frees the world and forgets its bodies, colliders, joints and event callbacks. The running ids go
 * on.
 * @internal
 */
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
  physicsWorldAPI = undefined;
  backend.eventQueue?.free();
  backend.eventQueue = undefined;

  // Free the world
  backend.world.free();
  backend.world = { step: () => {} } as Rapier.World;

  return { worldDeleted: true };
};

/**
 * The world serialized by Rapier (undefined without a world); see p500.
 * @internal
 */
export const takeSnapshot = () => backend.world?.takeSnapshot();

/**
 * Replaces the world with one restored from takeSnapshot's bytes. The id maps aren't rebuilt
 * (p500).
 * @internal
 */
export const restoreSnapshot = (snapshot: Uint8Array) => {
  // @TODO: we maybe need check all the rigidBodies and colliders
  // and recreate all the maps (rigidBodies, rigidBodyAPIs, colliders, colliderAPIs) here.
  backend.world = Rapier.World.restoreSnapshot(snapshot);
  physicsWorldAPI = new EngineWorldProxyAPI();
  return physicsWorldAPI;
};

/**
 * The world's debug render lines, as Rapier draws them.
 * @internal
 */
export const debugRender = () => {
  const buffers = backend.world.debugRender();
  return { vertices: buffers.vertices, colors: buffers.colors };
};

/**
 * Runs one fixed step on Rapier's own event queue (not `_eventQueue`) and collects its events for
 * dispatchPendingEventRecords / drainPendingEventRecords.
 * @internal
 */
export const step = (_eventQueue?: unknown, hooks?: unknown) => {
  backend.world.step(backend.eventQueue, hooks as Rapier.PhysicsHooks | undefined);
  drainAndDispatchEvents();
};
