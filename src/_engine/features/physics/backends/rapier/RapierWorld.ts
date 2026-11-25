// The Rapier backend's world: init, create, delete, step, snapshots and the debug render.

import type Rapier from '@dimforge/rapier3d-compat';
import { getPhysicsEngine } from '../../PhysicsUtils';
import type { PhysVector } from '../../types/PhysicsCommonTypes';
import type { PhysicsState } from '../../types/PhysicsConfigTypes';
import type {
  PhysicsSnapshot,
  RestoreSnapshotOpts,
  RestoreSnapshotResult,
  WorldAPI,
} from '../../types/PhysicsWorldTypes';
import type { LoopState } from '../../../../kernel/loop/MainLoop';
import { existsOrThrow } from '../../../../utils/Assert';
import { EngineWorldProxyAPI } from './proxies/EngineWorldProxyAPI';
import { clearEventRegistrations, drainAndDispatchEvents } from './RapierEvents';
import { clearMultibodyJoints } from './RapierMultibodyJoints';
import { rebindRestoredWorld } from './RapierRestore';
import { checkQueuedWorldBounds, checkWorldBounds, clearWorldBounds } from './RapierWorldBounds';
import {
  backend,
  colliderAPIs,
  colliders,
  detachedBodies,
  handleToColliderId,
  handleToJointId,
  handleToRigidBodyId,
  jointAPIs,
  joints,
  rigidBodies,
  rigidBodyAPIs,
  toPlainVec,
} from './RapierState';

/** The settings init() was given: the facade's own (p612 D4, one owner of the defaults). */
let physicsState: PhysicsState | undefined;

let worldCreated = false;
let physicsWorldAPI: WorldAPI | undefined;
/** Which world this is: bumped by every create and delete, so a snapshot names its world and a
 * restore refuses one of another (p500 D5). */
let worldEpoch = 0;

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
      maxCcdSubsteps: physicsSt.maxCcdSubsteps,
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
    /** Integer, 0 turns CCD off */
    maxCcdSubsteps?: number;
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
  // 0 is a value (CCD off); without one, Rapier's 1 stays
  const maxCcdSubsteps = opts?.maxCcdSubsteps ?? physicsState?.maxCcdSubsteps;
  if (maxCcdSubsteps !== undefined) backend.world.maxCcdSubsteps = maxCcdSubsteps;
  physicsWorldAPI = new EngineWorldProxyAPI();
  worldCreated = true;
  worldEpoch++;
  backend.stepCount = 0;
  return physicsWorldAPI;
};

/**
 * Frees the world and forgets its bodies, colliders, joints (both kinds) and event callbacks. The running ids go
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
  handleToRigidBodyId.clear();
  clearMultibodyJoints();
  detachedBodies.clear();
  clearEventRegistrations();
  // Configuration of this world: a new one starts without, until physics' scene hooks set them
  clearWorldBounds();

  // Reset (the running id counters are deliberately kept, see RapierState.ts' maps)
  const hadWorld = worldCreated;
  worldCreated = false;
  worldEpoch++;
  physicsWorldAPI = undefined;
  backend.stepCount = 0;
  backend.eventQueue?.free();
  backend.eventQueue = undefined;

  // Free the world (without one, backend.world is the no-op stub)
  if (hadWorld) backend.world.free();
  backend.world = { step: () => {} } as Rapier.World;

  return { worldDeleted: true };
};

/**
 * The world's snapshot: Rapier's bytes, the world's epoch and its step count (undefined without a
 * world); see p500. The one implementation: the world's API object delegates to it.
 * @internal
 */
export const takeSnapshot = (): PhysicsSnapshot | undefined =>
  worldCreated
    ? { bytes: backend.world.takeSnapshot(), worldEpoch, step: backend.stepCount }
    : undefined;

/**
 * Puts the world back to a snapshot taken in it (p500): Rapier restores a new world from its
 * bytes, which replaces the current one, the API objects both know are rebound to it, the rest are
 * forgotten or taken out (RapierRestore.ts), the step count goes back to the snapshot's, and the
 * replaced world is freed. The world's API object stays (it reads `backend.world`). The one
 * implementation: the world's API object delegates to it. Throws without a world, for a snapshot
 * of another world, or when Rapier can't read the bytes; then the world is left as it was. Rapier
 * leaks the small serialization pipeline it makes per restore (a few hundred bytes).
 * @internal
 */
export const restoreSnapshot = (
  snapshot: PhysicsSnapshot,
  opts?: RestoreSnapshotOpts
): RestoreSnapshotResult => {
  const worldAPI = existsOrThrow(
    worldCreated ? physicsWorldAPI : undefined,
    'Could not restore a physics snapshot: there is no world to restore it into.'
  );
  if (snapshot.worldEpoch !== worldEpoch) {
    // Restoring it would reap every body of this world
    throw new Error(
      `Could not restore a physics snapshot: it was taken in another world (epoch ${snapshot.worldEpoch}, this one is ${worldEpoch}). A scene load, or a delete and create, replaces the world.`
    );
  }
  // Typed as World, but Rapier's fromRaw returns null for bytes it can't read
  const restored: Rapier.World | null = backend.RAPIER.World.restoreSnapshot(snapshot.bytes);
  if (!restored) {
    throw new Error('Could not restore a physics snapshot: Rapier could not read its bytes.');
  }
  const replaced = backend.world;
  worldAPI.restoringWorld = true;
  let sweep;
  try {
    backend.world = restored;
    sweep = rebindRestoredWorld(restored, opts);
  } finally {
    worldAPI.restoringWorld = false;
  }
  backend.stepCount = snapshot.step;
  // Freed last (p500 D10): a throw before this leaves the old world alive, not freed under a
  // reference still held
  replaced.free();
  return {
    ...sweep,
    // Rapier serializes these with the world, so the snapshot's are now the world's
    gravity: toPlainVec(restored.gravity),
    timestep: restored.timestep,
    solverIterations: restored.numSolverIterations,
    internalPgsIterations: restored.numInternalPgsIterations,
    maxCcdSubsteps: restored.maxCcdSubsteps,
    step: snapshot.step,
    world: worldAPI,
  };
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
 * Runs one fixed step on Rapier's own event queue (the contract's `eventQueue` isn't read), collects
 * its events for dispatchPendingEventRecords / drainPendingEventRecords, and takes the bodies that
 * left the world bounds on it out of the simulation (RapierWorldBounds.ts); the bodies created
 * since the last step are checked before it.
 * @internal
 */
export const step = () => {
  checkQueuedWorldBounds();
  backend.world.step(backend.eventQueue);
  backend.stepCount++;
  drainAndDispatchEvents();
  checkWorldBounds();
};
