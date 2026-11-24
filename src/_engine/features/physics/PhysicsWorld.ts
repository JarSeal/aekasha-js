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
  dropEventPushesAfterRestore,
  hasWorkerTransport,
  messageWorker,
  messageWorkerAsync,
  openWorkerTransport,
  toWireWorldBounds,
} from './PhysicsMessaging';
import { getPhysicsQueryObserver } from './PhysicsQueryStats';
import {
  clearPhysicsRegistry,
  forgetCollider,
  forgetJoint,
  forgetRigidBody,
  getBodyMovedListener,
  rigidBodies,
} from './PhysicsRegistry';
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
import { initPhysicsEngine, isF32Changed } from './PhysicsUtils';
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
import type { RigidBodyProxyAPI } from './proxies/RigidBodyProxyAPI';
import { WorldProxyAPI } from './proxies/WorldProxyAPI';
import type { PhysVector } from './types/PhysicsCommonTypes';
import type {
  PhysicsSnapshot,
  RestoreSnapshotDelta,
  RestoreSnapshotOpts,
  RestoreSnapshotResult,
  WorldAPI,
} from './types/PhysicsWorldTypes';
import type { WorldBoundsBox } from './types/PhysicsWorldBoundsTypes';

/** Set by stopPhysics (a mounted engine's unmount): no world is created after it. */
let isPhysicsStopped = false;
/** The visibility listener's remover, from the first world's create until stopPhysics. */
let removeVisibilityListener: (() => void) | null = null;
/** Which hot-path transport createPhysicsWorld() resolved to for the current world (WORKER_THREAD only). */
let resolvedTransportMode: 'SHARED_MEMORY' | 'MESSAGE_BATCH' | undefined;
/** Snapshot restores called and not resolved yet (only WORKER_THREAD's can overlap). */
let restoresInFlight = 0;

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
      // Plain data: the world bounds may hold an onExit callback, and the worker gets the box by
      // SET_WORLD_BOUNDS anyway
      physicsState: { ...facade.state, worldBounds: null },
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
    /** Integer, 0 turns CCD off */
    maxCcdSubsteps?: number;
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
    // 0 is a value (CCD off), so not `||`
    maxCcdSubsteps: opts?.maxCcdSubsteps ?? facade.state.maxCcdSubsteps,
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
 * Sets (or clears, with null) the current world's bounds (p102): from then on, a dynamic body whose
 * translation is outside the box after a step is taken out of the simulation on that step (disabled,
 * or FIXED when jointed) and handed to the out-of-bounds handler (setOutOfBoundsHandler). Every
 * enabled dynamic body is checked against them at once. A new world starts without (physics' scene
 * hooks set a scene's). A no-op without a world. `WORKER_THREAD`: applies when the worker gets it;
 * from an `APP_PHYSICS_STEP` system, before that sub-step, as on `MAIN_THREAD`.
 * @internal
 */
export const setPhysicsWorldBounds = (box: WorldBoundsBox | null) => {
  if (!facade.worldEnabled) return;
  const bounds = box && toWireWorldBounds(box);
  if (!isWorkerTarget()) {
    facade.engAPI?.setWorldBounds(bounds);
    return;
  }
  messageWorker({ type: PhysicsProtocolType.SET_WORLD_BOUNDS, bounds, isOneWay: true });
};

/**
 * Takes a snapshot of the physics world (p500), to put it back later with
 * {@link restorePhysicsSnapshot}: its state serialized by the backend, the world it was taken in
 * and its step. Only physics: no entity, mesh or creation params. Throws without a world.
 * @returns the snapshot, plain data the caller keeps as long as it likes
 * @remarks A snapshot belongs to its world: every scene load makes a new one, so a snapshot never
 * outlives its scene's visit (restoring it after a load throws).
 * @example
 * ```ts
 * import { restorePhysicsSnapshot, takePhysicsSnapshot } from 'aekasha/physics';
 *
 * // A checkpoint, and back to it: the bodies made since are deleted with their entities
 * const checkpoint = await takePhysicsSnapshot();
 * if (checkpoint) await restorePhysicsSnapshot(checkpoint);
 * ```
 */
export const takePhysicsSnapshot = async (): Promise<PhysicsSnapshot | undefined> => {
  existsOrThrow(
    facade.worldEnabled,
    'Physics world is not created. Create the world before taking a snapshot.'
  );
  if (!isWorkerTarget()) return facade.engAPI?.takeSnapshot();
  const response = await messageWorkerAsync<TakeSnapshotResponse>({
    type: PhysicsProtocolType.TAKE_SNAPSHOT,
  });
  return response.snapshot;
};

/** Called after every snapshot restore (onPhysicsRestore). */
type PhysicsRestoreFn = (delta: RestoreSnapshotDelta) => void;
const restoreFns = new Set<PhysicsRestoreFn>();

/**
 * Calls `fn` after every snapshot restore, with the restore's delta, once the facade has applied
 * it (the reaped objects forgotten, the world's settings and the step clock set; p500 D15).
 * Returns its remover.
 * @internal
 */
export const onPhysicsRestore = (fn: PhysicsRestoreFn) => {
  restoreFns.add(fn);
  return () => {
    restoreFns.delete(fn);
  };
};

/**
 * Brings the facade in line with a restore's delta, the same in both worker targets: forgets the
 * reaped bodies, colliders and joints (marked `isBeingDeleted`, their worker callbacks dropped),
 * drops the events not delivered yet, takes the world's settings the snapshot carried into the
 * physics state, restarts the step clock at the snapshot's step (dropping the gates and the time
 * banked toward the next step), and calls the restore hooks.
 */
const applyRestoreDelta = (delta: RestoreSnapshotDelta) => {
  for (const id of delta.reapedRigidBodyIds) forgetRigidBody(id);
  for (const id of delta.reapedColliderIds) forgetCollider(id);
  for (const id of delta.reapedJointIds) forgetJoint(id);
  dropEventPushesAfterRestore(delta.step);

  const { state } = facade;
  const { gravity } = delta;
  if (
    isF32Changed(state.gravity.x, gravity.x) ||
    isF32Changed(state.gravity.y, gravity.y) ||
    isF32Changed(state.gravity.z, gravity.z)
  ) {
    state.gravity = { ...gravity };
  }
  if (isF32Changed(state.timestepRatio, delta.timestep)) {
    state.timestepRatio = delta.timestep;
    state.timestep = 1 / delta.timestep;
  }
  state.solverIterations = delta.solverIterations;
  state.internalPgsIterations = delta.internalPgsIterations;
  state.maxCcdSubsteps = delta.maxCcdSubsteps;

  // Every body may have jumped: earlier poses no longer lead up to the restored ones, and
  // step-timed code goes on from the snapshot's step
  resetSimClock(delta.step);
  dropStepAccumulator();

  for (const fn of restoreFns) {
    try {
      fn(delta);
    } catch (err) {
      lerror('A physics restore hook failed:', err);
    }
  }
};

/**
 * Puts the physics world back to a snapshot taken in it (p500), keeping every body, collider and
 * joint that both the snapshot and the API know (their entities need nothing). What was made after
 * the snapshot is deleted, physics entities included, and what was deleted since stays gone
 * ({@link RestoreSnapshotDelta}); the world's settings become the snapshot's, and the step clock
 * (`getPhysicsSubStepIndex`) goes back to its step. Stepping waits meanwhile. The snapshot isn't
 * used up: restore it again and again. Throws without a world, for a snapshot of another world (a
 * scene load replaces the world), or for bytes the backend can't read; then nothing changed.
 *
 * `WORKER_THREAD`: the snapshot is copied to the worker (p500 D9: the caller's stays usable, to
 * restore again), and the restored poses are in the transform buffer when it resolves. The worker
 * handles messages in order: steps and commands sent before the call run on the replaced world,
 * those sent after on the restored one. Overlapping restores apply in call order, the last one
 * wins, and stepping waits until every one has resolved.
 * @param snapshot a snapshot {@link takePhysicsSnapshot} took in the current world
 * @param opts what to do with the bodies deleted since (default: take them out)
 * @returns what the restore changed besides the poses, and the world
 * @remarks An exact rewind only when nothing was created or deleted since the snapshot (the debug
 * env warns otherwise). Stepping on from it reproduces the original run only when the app replays
 * its own inputs (forces, impulses, creates, deletes, setting changes) on the same steps. An
 * entity's `DISABLED` component isn't reset. Use this rather than `getPhysicsWorld()`'s
 * `restoreSnapshot`, which on `MAIN_THREAD` restores the backend alone.
 * @example
 * ```ts
 * import { restorePhysicsSnapshot, takePhysicsSnapshot } from 'aekasha/physics';
 *
 * const snapshot = await takePhysicsSnapshot();
 * // … later, in the same scene visit
 * if (snapshot) {
 *   const { reapedRigidBodyIds } = await restorePhysicsSnapshot(snapshot);
 *   console.log(`${reapedRigidBodyIds.length} bodies made since were deleted`);
 * }
 * ```
 */
export const restorePhysicsSnapshot = async (
  snapshot: PhysicsSnapshot,
  opts?: RestoreSnapshotOpts
): Promise<RestoreSnapshotResult> => {
  existsOrThrow(
    facade.worldEnabled,
    'Physics world is not created. Create the world before restoring a snapshot.'
  );
  const engAPI = isWorkerTarget()
    ? undefined
    : existsOrThrow(facade.engAPI, 'Physics engine is not initialized.');
  restoresInFlight++;
  facade.isRestoringSnapshot = true;
  try {
    if (engAPI) {
      const result = engAPI.restoreSnapshot(snapshot, opts);
      applyRestoreDelta(result);
      return result;
    }
    // A world delete or create sent meanwhile is replied to after this, and stopPhysics rejects
    // it: the world it resolves in is the one it was sent to
    const {
      type: _type,
      requestId: _requestId,
      worldCreated: _worldCreated,
      bodies,
      ...delta
    } = await messageWorkerAsync<RestoreSnapshotResponse>({
      type: PhysicsProtocolType.RESTORE_SNAPSHOT,
      snapshot,
      opts,
    });
    for (let i = 0; i < bodies.length; i++) {
      const proxy = rigidBodies.get(bodies[i].id) as RigidBodyProxyAPI | undefined;
      proxy?._restore(bodies[i]);
    }
    if (facade.world instanceof WorldProxyAPI) facade.world._restoreSettings(delta);
    applyRestoreDelta(delta);
    return { ...delta, world: facade.world };
  } finally {
    restoresInFlight--;
    facade.isRestoringSnapshot = restoresInFlight > 0;
  }
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
