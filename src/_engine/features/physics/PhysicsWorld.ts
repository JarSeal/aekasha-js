// The physics world's life: initPhysics, the world's create, delete and reset, flushPhysics, the
// stop (an unmount), the snapshots, the debug-state tracking and the Physics API debug tab.

import { IS_DEBUG_ENV, getConfig } from '../../kernel/config/Config';
import { loadDebugModuleAsync, useDebug } from '../../kernel/config/DebugModules';
import type { DebugModuleRef } from '../../kernel/config/DebugModules';
import { getReadOnlyLoopState, onVisibilityChange } from '../../kernel/loop/MainLoop';
import { initWorker } from '../../kernel/loop/Workers';
import { existsOrThrow } from '../../utils/Assert';
import { lerror, lwarn } from '../../utils/Logger';
import { PhysicsDebugStateBuffer } from './PhysicsDebugStateBuffer';
import {
  clearPendingEventPushes,
  closeWorkerTransport,
  hasWorkerTransport,
  messageWorkerAsync,
  openWorkerTransport,
} from './PhysicsMessaging';
import { getPhysicsQueryObserver } from './PhysicsQueryStats';
import { clearPhysicsRegistry, getBodyMovedListener } from './PhysicsRegistry';
import { facade, isWorkerTarget } from './PhysicsState';
import { setStepStatsBuffer } from './PhysicsStepStats';
import {
  breakSimHistory,
  clearPhysicsStepGates,
  dropStepAccumulator,
  physicsVisibilityChangeHandler,
  releasePhysicsStepping,
  resetSimClock,
} from './PhysicsStepping';
import { PhysicsTransformBuffer } from './PhysicsTransformBuffer';
import { initPhysicsEngine } from './PhysicsUtils';
import type { PhysicsDownProtocol } from './protocol/PhysicsDownProtocol';
import { PhysicsProtocolType } from './protocol/PhysicsProtocolType';
import type {
  CreateWorldResponse,
  DeleteWorldResponse,
  FlushResponse,
  InitPhysicsResponse,
  RestoreSnapshotResponse,
  SetDebugStateTrackingResponse,
  TakeSnapshotResponse,
} from './protocol/PhysicsResponses';
import { WorldProxyAPI } from './proxies/WorldProxyAPI';
import type { PhysVector } from './types/PhysicsCommonTypes';
import type { WorldAPI } from './types/PhysicsWorldTypes';

/** Set by stopPhysics (a mounted engine's unmount): no world is created after it. */
let isPhysicsStopped = false;
/** The visibility listener's remover, from the first world's create until stopPhysics. */
let removeVisibilityListener: (() => void) | null = null;
/** Which hot-path transport createPhysicsWorld() resolved to for the current world (WORKER_THREAD only). */
let resolvedTransportMode: 'SHARED_MEMORY' | 'MESSAGE_BATCH' | undefined;

/**
 * Initializes physics from `AppConfig.physics` (a no-op when it isn't enabled): loads the backend
 * on this thread (`MAIN_THREAD`), or starts the worker and has it load the backend
 * (`WORKER_THREAD`, the default), then creates the first world unless `doNotCreateWorld`.
 * `physics()`'s install calls it.
 * @internal
 */
export const initPhysics = async (doNotCreateWorld?: boolean) => {
  const physicsConfig = getConfig().physics;
  if (!physicsConfig?.enabled) return;

  facade.state = { ...facade.state, ...physicsConfig };
  facade.state.timestepRatio = 1 / (facade.state.timestep || 60);

  if (!isWorkerTarget()) {
    const { engine, engineAPI } = await initPhysicsEngine(facade.state.physicsEngine);
    facade.engineInitiated = Boolean(engine);
    facade.engAPI = engineAPI;
    facade.engAPI.setQueryObserver(getPhysicsQueryObserver());
    facade.engAPI.setBodyMovedObserver(getBodyMovedListener());
    const worldOrUndefined = facade.engAPI.init(
      facade.state,
      IS_DEBUG_ENV,
      getReadOnlyLoopState(),
      doNotCreateWorld
    );
    if (worldOrUndefined) facade.world = worldOrUndefined;
  } else {
    // Imported here, not at load: an app without physics, or on the main thread, never loads it
    const { default: PhysicsWorker } = await import('./worker/PhysicsWorker?worker');
    // No onMessage: the transport listens once the handshake is done
    const startedWorker = await initWorker<PhysicsDownProtocol>({
      WorkerClass: PhysicsWorker,
      name: 'Physics Worker',
      onError: onWorkerError,
    });
    openWorkerTransport(startedWorker);
    const { worldCreated } = await messageWorkerAsync<InitPhysicsResponse>({
      type: PhysicsProtocolType.INIT_PHYSICS,
      physicsState: facade.state,
      isDebugEnvironment: IS_DEBUG_ENV,
      loopState: getReadOnlyLoopState(),
      doNotCreateWorld,
      mainTimeOrigin: performance.timeOrigin,
    });
    // Resolving without throwing means the worker's own engAPI.init() already
    // completed — mirrors the MAIN_THREAD branch's engineInitiated = Boolean(engine).
    facade.engineInitiated = true;
    if (worldCreated) facade.world = new WorldProxyAPI();
  }
};

const onWorkerError = (err: ErrorEvent) => {
  lerror(`Physics worker error: ${err.message}`);
};

/**
 * Creates the physics world from the physics state's settings (`gravity` and `opts` over them).
 * Resolves with it, or undefined after {@link stopPhysics}; warns and does nothing when a world
 * exists. Throws before {@link initPhysics}.
 * @internal
 */
export const createPhysicsWorld = async (
  gravity?: PhysVector,
  opts?: {
    /** Timestep as delta time (eg. 1/60 = 0,0166666666667) */
    timestep?: number;
    /** Integer */
    solverIterations?: number;
    /** Integer */
    internalPgsIterations?: number;
  }
) => {
  // A scene load still running when the engine unmounted: nothing to create a world for
  if (isPhysicsStopped) return;
  existsOrThrow(
    facade.engineInitiated,
    'Physics engine not initiated. Initiate the engine (initPhysics) before creating the world'
  );
  if (facade.worldEnabled) {
    if (IS_DEBUG_ENV)
      lwarn(
        'Trying to create another physics world even though the physics world has been already created.'
      );
    return;
  }

  const gravityArg = gravity || facade.state.gravity;
  const timestep = opts?.timestep || facade.state.timestepRatio;
  const solverIterations = opts?.solverIterations || facade.state.solverIterations;
  const internalPgsIterations = opts?.internalPgsIterations || facade.state.internalPgsIterations;
  const optsArg = {
    timestep,
    numSolverIterations: solverIterations,
    numInternalPgsIterations: internalPgsIterations,
  };

  if (!isWorkerTarget()) {
    facade.world = existsOrThrow(
      facade.engAPI?.createWorld(gravityArg, optsArg),
      'Could not create physics world (main thread): the physics engine is not initialized.'
    );
    facade.worldEnabled = true;
    resetSimClock();
    removeVisibilityListener ??= onVisibilityChange(physicsVisibilityChangeHandler);
  } else {
    const response = await messageWorkerAsync<CreateWorldResponse>({
      type: PhysicsProtocolType.CREATE_WORLD,
      gravity: gravityArg,
      opts: optsArg,
    });
    if (response.worldCreated) {
      facade.world = new WorldProxyAPI();
      facade.worldEnabled = true;
      resetSimClock();
      resolvedTransportMode = response.transportMode;
      if (response.transportMode === 'SHARED_MEMORY' && response.buffer) {
        facade.transformBuffer = new PhysicsTransformBuffer(
          facade.state.maxBodies,
          response.buffer,
          response.bankCount ?? 1
        );
        clearPendingEventPushes();
      } else {
        // MESSAGE_BATCH: a previous world's last pushed copy must never be read as this one's.
        facade.transformBuffer = undefined;
      }
      // Handed over in SHARED_MEMORY mode (p027), whatever stepStatsEnabled is, so the flag can
      // be switched at runtime (setPhysicsStepStatsEnabled). A fresh one per world.
      setStepStatsBuffer(response.statsBuffer);
      // MESSAGE_BATCH: transformBuffer stays undefined until the first TRANSFORMS_PUSH arrives.
      removeVisibilityListener ??= onVisibilityChange(physicsVisibilityChangeHandler);
    } else {
      lerror(
        `Could not create physics world (WORKER_THREAD), gravity: ${JSON.stringify(gravity)}, opts: ${JSON.stringify(opts)}`
      );
    }
  }

  return facade.world;
};

/**
 * Ordering barrier. WORKER_THREAD: resolves once the worker has handled every message posted
 * before this call (including fire-and-forget deletes). MAIN_THREAD: everything already ran
 * synchronously, so it resolves right away.
 * @internal
 */
export const flushPhysics = async () => {
  if (!isWorkerTarget() || !hasWorkerTransport()) return;
  await messageWorkerAsync<FlushResponse>({ type: PhysicsProtocolType.FLUSH });
};

/**
 * Deletes the physics world and forgets every API object of it (each marked `isBeingDeleted`).
 * Throws without a world.
 * @internal
 */
export const deletePhysicsWorld = async () => {
  existsOrThrow(
    facade.worldEnabled,
    'Physics world is not created. Create the world before deleting it.'
  );
  let worldDeleted = false;
  if (!isWorkerTarget()) {
    const response = facade.engAPI?.deleteWorld();
    worldDeleted = Boolean(response?.worldDeleted);
  } else {
    const response = await messageWorkerAsync<DeleteWorldResponse>({
      type: PhysicsProtocolType.DELETE_WORLD,
    });
    worldDeleted = Boolean(response.worldDeleted);
  }

  if (worldDeleted) clearDeletedWorld();
  else lerror('Could not delete physics world.');
};

/** Forgets the deleted world: every API object and callback belonged to it. Keeps the settings in
 * physicsState (gravity, solver iterations, timestep), which the next world is built from. */
const clearDeletedWorld = () => {
  facade.worldEnabled = false;
  facade.world = { step: () => {} } as unknown as WorldAPI;
  clearPhysicsRegistry();
  clearPendingEventPushes();
  facade.transformBuffer = undefined;
  dropStepAccumulator();
  breakSimHistory();
};

/**
 * Stops physics for good: `physics()`'s `onUnmount` (a mounted engine's `unmount()`). Deletes the
 * world (`MAIN_THREAD`) or closes the worker's transport (`WORKER_THREAD`: the worker is
 * terminated, its world with it) and rejects every request still waiting for a reply, releases
 * the stepping hold and the step gates, and removes the visibility listener. No world is created
 * after it, and a later request rejects.
 * @internal
 */
export const stopPhysics = () => {
  if (isPhysicsStopped) return;
  isPhysicsStopped = true;
  removeVisibilityListener?.();
  removeVisibilityListener = null;
  releasePhysicsStepping();
  clearPhysicsStepGates();
  if (facade.worldEnabled && !isWorkerTarget()) facade.engAPI?.deleteWorld();
  closeWorkerTransport();
  if (facade.worldEnabled) clearDeletedWorld();
};

/**
 * Replaces the physics world with a new, empty one built from the current physicsState
 * settings (so debug-tab edits carry over). Physics' scene hooks call it on every scene load
 * (beforeAssets):
 * a reused world keeps Rapier's internal history (freed handle slots, broadphase, contact
 * graph, islands), which makes the same scene simulate differently on a revisit.
 * Delete every physics entity first; anything still referencing the old world goes stale.
 * @internal
 */
export const resetPhysicsWorld = async () => {
  if (!facade.worldEnabled) return;
  // Lets in-flight deletes of the previous scene's bodies finish against the old world
  await flushPhysics();
  await deletePhysicsWorld();
  await createPhysicsWorld();
};

/**
 * The world's state, serialized by the backend (p500: without the bodies' and colliders' user
 * data). Throws without a world.
 * @internal
 */
export const takePhysicsSnapshot = async () => {
  existsOrThrow(
    facade.worldEnabled,
    'Physics world is not created. Create the world before taking a snapshot.'
  );
  let snapshot;
  if (!isWorkerTarget()) {
    snapshot = facade.engAPI?.takeSnapshot();
  } else {
    // @TODO: we probably also need to save the userData for the rigid bodies and colliders (separate object/map).
    const response = await messageWorkerAsync<TakeSnapshotResponse>({
      type: PhysicsProtocolType.TAKE_SNAPSHOT,
    });
    snapshot = response.snapshot;
  }
  return snapshot;
};

/**
 * Replaces the world with one restored from {@link takePhysicsSnapshot}'s bytes, and resolves with
 * it (p500: the facade's registry isn't rebuilt). Throws without a world.
 * @internal
 */
export const restorePhysicsSnapshot = async (snapshot: Uint8Array) => {
  existsOrThrow(
    facade.worldEnabled,
    'Physics world is not created. Create the world before restoring a snapshot.'
  );
  if (!isWorkerTarget()) {
    const response = facade.engAPI?.restoreSnapshot(snapshot);
    if (response) facade.world = response;
  } else {
    // @TODO: we maybe need check all the rigidBodies and colliders
    // and recreate all the maps here (maybe the new bodies and colliders can come in the response if we also send the next running ids).
    // The problem is the userData. The snapshots do not have that data since the userData is on the rigidBodyAPI and colliderAPI.
    const response = await messageWorkerAsync<RestoreSnapshotResponse>({
      type: PhysicsProtocolType.RESTORE_SNAPSHOT,
      snapshot,
    });
    if (response.worldCreated) facade.world = new WorldProxyAPI();
  }
  // Every body may have jumped: earlier poses no longer lead up to the restored ones.
  breakSimHistory();
  return facade.world;
};

/**
 * Which hot-path transform transport the current world resolved to (WORKER_THREAD only). Undefined before a world is created or in MAIN_THREAD mode.
 * @internal
 */
export const getResolvedTransportMode = () => resolvedTransportMode;

/**
 * Declares which rigid bodies/colliders the worker should mirror live state for, so the
 * debug wireframes can be colored by sleep/kinematic/enabled/sensor state without an RPC
 * per object per frame.
 *
 * This is a full replacement of the tracked set, not a delta, and a body's/collider's
 * index in the arrays passed here is its slot in the buffer readable via
 * getPhysicsDebugStateBuffer(). Calling it with two empty arrays turns tracking off: the
 * worker then writes nothing and pushes nothing per step.
 *
 * No-op on MAIN_THREAD, where the *Sync state getters are already free.
 * @internal
 */
export const setPhysicsDebugStateTracking = async (
  rigidBodyIds: number[],
  colliderIds: number[]
) => {
  if (!isWorkerTarget()) return;
  const response = await messageWorkerAsync<SetDebugStateTrackingResponse>({
    type: PhysicsProtocolType.SET_DEBUG_STATE_TRACKING,
    rigidBodyIds,
    colliderIds,
  });
  if (response.buffer) {
    // SHARED_MEMORY, first enable: wrap the worker's SAB once and read it forever after.
    facade.debugStateBuffer = new PhysicsDebugStateBuffer(facade.state.maxBodies, response.buffer);
  }
};

/** The live debug-state buffer, or undefined while tracking has never been enabled (or
 * MESSAGE_BATCH mode hasn't received its first push yet). WORKER_THREAD only.
 * @internal
 */
export const getPhysicsDebugStateBuffer = () => facade.debugStateBuffer;

// Debug
type PhysicsAPIGUIModule = typeof import('./debug/_dbg__PhysicsAPI');
let debugGUI: DebugModuleRef<PhysicsAPIGUIModule> | null = null;

/** Debug env: loads the Physics API debug module and restores its persisted world settings
 * (gravity, timestep, solver iterations...) into the physics state. Call it before the first
 * physics world is created: every world, the boot one and each scene load's, is built from them.
 * @internal
 */
export const registerPhysicsAPIDebugGUI = async () => {
  debugGUI = await loadDebugModuleAsync(() => import('./debug/_dbg__PhysicsAPI'));
  useDebug(debugGUI)?._hydratePhysicsLiveSettings();
};

/**
 * Debug env: creates the Physics API debugger tab (after registerPhysicsAPIDebugGUI).
 * @internal
 */
export const createPhysicsAPIDebugGUI = () => {
  useDebug(debugGUI)?._createPhysicsAPIDebugGUI();
};
