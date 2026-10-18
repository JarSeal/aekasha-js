// Stepping the physics world: the fixed-timestep accumulator, the hold, pause and visibility
// handling, the simulated-time clock and the snapshot stamps (render interpolation, p059), the
// step limit (debug), the step gates, and the step stats switch.

import * as THREE from 'three/webgpu';
import { IS_DEBUG_ENV } from '../../kernel/config/Config';
import {
  getFixedFrameDelta,
  getReadOnlyLoopState,
  toggleMainPlay,
} from '../../kernel/loop/MainLoop';
import type { LoopState } from '../../kernel/loop/MainLoop';
import { readStatsClock } from '../../utils/StatsClock';
import {
  beginSubStepCapture,
  endSubStepCapture,
  flushPhysicsEvents,
  messageWorker,
} from './PhysicsMessaging';
import { facade, isWorkerTarget } from './PhysicsState';
import {
  readSharedStepStats,
  recordMainThreadStepStats,
  resetPhysicsStepStats,
} from './PhysicsStepStats';
import { readPhysicsWallClock } from './PhysicsWallClock';
import { PhysicsProtocolType } from './protocol/PhysicsProtocolType';
import type { PhysicsUpProtocol } from './protocol/PhysicsUpProtocol';

/**
 * Steps the physics world (called in the main loop). No-op until a physics world
 * has been created via createPhysicsWorld().
 *
 * Runs a fixed-timestep accumulator so simulated motion doesn't speed up/slow down with
 * the render framerate: real elapsed time (scaled by playSpeedMultiplier, clamped by
 * maxDeltaTime) is accumulated, then drained in physicsState.timestepRatio-sized slices,
 * up to maxSubSteps per frame. Also handles backgroundBehavior/pause bookkeeping (see
 * physicsVisibilityChangeHandler for the window-hidden 'PAUSE' path, which halts the whole
 * main loop before this is reached).
 *
 * Calls `onBeforeStep` once per fixed-timestep slice, right before that slice's step (held-key
 * polling, event delivery and APP_PHYSICS_STEP systems, see MainLoop.ts's runFixedSubStep).
 * In WORKER_THREAD mode the steps themselves run off-thread,
 * so the callbacks all run here up front, and whatever one-way commands each one issues are
 * carried in the STEP message and replayed on the worker right before their own sub-step.
 *
 * Returns how many fixed-timestep slices were actually taken this call (0 if physics is
 * disabled/paused/hasn't accumulated a full slice yet).
 * @internal
 */
export const stepPhysics = (
  loopState: LoopState,
  /** Called once per fixed sub-step, right before it, with dt = the fixed timestep (this is
   * what drives held-key polling, flushPhysicsEvents and the APP_PHYSICS_STEP ECS stage, see
   * MainLoop.ts), and the step's index (getPhysicsSubStepIndex). Without one, events are flushed
   * before each sub-step here instead. */
  onBeforeStep?: (stepDelta: number, stepIndex: number) => void
): number => {
  if (!facade.worldEnabled) return 0;
  // Scene load in progress (holdPhysicsStepping): no timer update either, releasing it
  // resumes through the paused branch below.
  if (isSteppingHeld) return 0;
  const dt = takeFrameDelta(loopState);
  if (dt === null) return 0;
  const stepsTaken = takeDueSteps(loopState, dt);
  if (stepsTaken === 0) return 0;
  return isWorkerTarget()
    ? sendWorkerSteps(stepsTaken, onBeforeStep)
    : runMainThreadSteps(stepsTaken, onBeforeStep);
};

/** stepPhysics' pause and resume handling: the frame's dt, or null when this frame doesn't step
 * (paused, hidden with 'PAUSE', or resuming, which restarts the timer). */
const takeFrameDelta = (loopState: LoopState): number | null => {
  updateTimer();
  // The main loop's fixed frame delta when one is set (debug and test only, setFixedFrameDelta)
  let dt = getFixedFrameDelta() ?? timer.getDelta();

  if (
    !loopState.masterPlay ||
    !loopState.appPlay ||
    loopState.isSceneSuspended ||
    !facade.state.worldStepEnabled
  ) {
    // Explicit pause (unrelated to window visibility) always halts stepping outright —
    // backgroundBehavior only governs what happens while the window is hidden. Switching
    // the world step off counts as one too, so switching it back on resumes cleanly instead
    // of catching up on the time it was off, and so does a scene suspended by an editor view
    // (Views.ts).
    if (!facade.state.isPaused) setPhysicsPauseTime();
    facade.state.isPaused = true;
    timerRunning = false;
    return null;
  }

  if (loopState.isWindowHidden) {
    if (facade.state.backgroundBehavior === 'PAUSE') {
      // Normally already handled by physicsVisibilityChangeHandler halting the whole main
      // loop (toggleMainPlay(false), which makes loopState.masterPlay false and is caught
      // above) — this is a defensive fallback in case stepPhysics is still reached directly
      // while hidden.
      if (!facade.state.isPaused) setPhysicsPauseTime();
      facade.state.isPaused = true;
      timerRunning = false;
      return null;
    }
    if (
      facade.state.backgroundBehavior === 'KEEP_RUNNING_USE_MIN_DELTA' &&
      facade.state.minDeltaTime > 0
    ) {
      dt = facade.state.minDeltaTime;
    }
    // 'KEEP_RUNNING': keep the real dt, still subject to the maxDeltaTime clamp below.
  } else if (facade.state.isPaused) {
    // Resuming: the dt just computed above is either stale (the timer wasn't updated while
    // timerRunning was false) or spans the entire paused duration — discard it and the stale
    // accumulator rather than trying to simulate the whole paused duration in one go. The
    // timer restarts from now, whatever paused it, so the next frame's dt is one frame long.
    facade.state.isPaused = false;
    facade.state.pauseDurationTotal += readPhysicsWallClock() - facade.state.pausedTime;
    facade.state.pausedTime = 0;
    accDelta = 0;
    simClockEpoch++;
    timerRunning = true;
    timer.update();
    return null;
  }
  return dt;
};

/** stepPhysics' accumulator: banks the frame's dt and takes the steps due, within the sub-step
 * ceiling, the step gates and the debug step limit. */
const takeDueSteps = (loopState: LoopState, dt: number) => {
  // Debug-only freeze (setPhysicsStepLimit): at the limit, hold there without banking time
  // toward the next step, so releasing it resumes cleanly instead of catching up.
  const stepsToLimit = stepLimit === null ? Infinity : stepLimit - stepsIssued;
  if (stepsToLimit <= 0) {
    accDelta = 0;
    return 0;
  }
  // Step gates (addPhysicsStepGate): unlike the limit, time keeps banking while one holds.
  const stepsToGate = getLowestStepGate() - stepsIssued;

  const scaledDelta = dt * loopState.playSpeedMultiplier;
  accDelta +=
    facade.state.maxDeltaTime > 0 ? Math.min(scaledDelta, facade.state.maxDeltaTime) : scaledDelta;

  const maxSteps = facade.state.maxSubSteps > 0 ? facade.state.maxSubSteps : Infinity;
  let stepsTaken = 0;
  while (
    accDelta >= facade.state.timestepRatio &&
    stepsTaken < maxSteps &&
    stepsTaken < stepsToGate
  ) {
    accDelta -= facade.state.timestepRatio;
    stepsTaken++;
  }
  if (stepsTaken >= maxSteps) {
    // Hit the sub-step ceiling with backlog still left over: drop it instead of deferring it,
    // so a sustained slowdown can't make the accumulator (and next frame's catch-up cost) grow
    // without bound — the actual "prevent the spiral of death" behavior.
    // Only a discontinuity if there was backlog to drop (sitting exactly at the ceiling isn't).
    if (accDelta >= facade.state.timestepRatio) simClockEpoch++;
    accDelta = 0;
  } else if (accDelta >= facade.state.timestepRatio && stepsTaken >= stepsToGate) {
    // Held at a gate with steps due: they wait in the accumulator and run once it's released,
    // but never more of them than one frame could catch up (the ceiling above drops the rest).
    const maxBacklog = maxSteps * facade.state.timestepRatio;
    if (accDelta > maxBacklog) {
      accDelta = maxBacklog;
      simClockEpoch++;
    }
    noteStepGateHeld(true);
  }
  if (stepsTaken > 0 && stepsTaken < stepsToGate) noteStepGateHeld(false);
  if (stepsTaken >= stepsToLimit) {
    stepsTaken = stepsToLimit;
    accDelta = 0;
  }
  return stepsTaken;
};

/** MAIN_THREAD: runs the steps, each after its onBeforeStep (or an event flush). Returns the
 * steps run (fewer when a gate an earlier sub-step added holds the rest). */
const runMainThreadSteps = (
  stepsTaken: number,
  onBeforeStep: ((stepDelta: number, stepIndex: number) => void) | undefined
) => {
  const stepDelta = facade.state.timestepRatio;
  const trackStats = facade.state.stepStatsEnabled;
  let stepMs = 0;
  try {
    for (let i = 0; i < stepsTaken; i++) {
      if (isSubStepGated(i, stepsTaken)) {
        stepsTaken = i;
        break;
      }
      subStepIndex = stepsIssued + i;
      if (onBeforeStep) onBeforeStep(stepDelta, subStepIndex);
      else flushPhysicsEvents();
      if (!trackStats) {
        facade.engAPI?.step();
        continue;
      }
      // Timed around step() alone: onBeforeStep above runs app/ECS work, and including it
      // would reproduce exactly the contamination that made the legacy PHY panel misleading.
      const subStepStart = readStatsClock();
      facade.engAPI?.step();
      stepMs += readStatsClock() - subStepStart;
    }
  } finally {
    subStepIndex = -1;
  }
  if (trackStats) recordMainThreadStepStats(stepMs);
  stampStepBatch(stepsTaken);
  return stepsTaken;
};

/**
 * WORKER_THREAD: runs every sub-step's onBeforeStep here up front, capturing the one-way commands
 * each issues, and sends all the steps in one STEP message (A7: a sub-step without commands, and
 * a frame without any, allocates no capture). Returns the steps sent (fewer when a gate an
 * earlier sub-step added holds the rest).
 */
const sendWorkerSteps = (
  stepsTaken: number,
  onBeforeStep: ((stepDelta: number, stepIndex: number) => void) | undefined
) => {
  const stepDelta = facade.state.timestepRatio;
  const trackStats = facade.state.stepStatsEnabled;
  // Sparse: a sub-step's commands at its index, none for a sub-step that issued none
  let substepCommands: PhysicsUpProtocol[][] | undefined;
  if (onBeforeStep) {
    for (let i = 0; i < stepsTaken; i++) {
      if (isSubStepGated(i, stepsTaken)) {
        stepsTaken = i;
        break;
      }
      beginSubStepCapture();
      subStepIndex = stepsIssued + i;
      try {
        onBeforeStep(stepDelta, subStepIndex);
      } finally {
        const commands = endSubStepCapture();
        if (commands) (substepCommands ??= [])[i] = commands;
        subStepIndex = -1;
      }
    }
  }
  // One-way, no response awaited — transform results arrive via the hot-path buffer
  // (transformBuffer), not via a STEP reply. A single message runs all of this frame's
  // sub-steps (each preceded by its own captured commands) and writes back exactly once,
  // never one message per sub-step.
  messageWorker({
    type: PhysicsProtocolType.STEP,
    steps: stepsTaken,
    substepCommands,
    isOneWay: true,
    // Only stamped while measuring; the worker derives dispatchMs from it.
    sentAt: trackStats ? readStatsClock() : undefined,
  });
  stampStepBatch(stepsTaken);
  // SHARED_MEMORY has no per-step return message, so the stats are polled here instead,
  // one frame behind — the same latency tradeoff the transform buffer itself already makes.
  if (trackStats) readSharedStepStats();
  return stepsTaken;
};

/**
 * Switches the physics step measurement
 * ({@link _engine/features/physics/PhysicsStepStats!getLastPhysicsStepDuration},
 * {@link _engine/features/physics/PhysicsStepStats!getLastPhysicsStepMessagingLatency}) on or off at runtime. Its initial value is
 * `AppConfig.physics.stepStatsEnabled`. The debug "PHY" stats panel exists only when that boot
 * value is on.
 *
 * Switching it on clears the last figures, so a reader sees `undefined` ("no measured step
 * yet") instead of what an earlier measuring period left behind. `WORKER_THREAD`: the worker
 * gets a one-way message and measures from its next STEP message on (in every transport).
 * Called before {@link _engine/features/physics/PhysicsWorld!initPhysics}, the config value
 * replaces it.
 * @internal
 */
export const setPhysicsStepStatsEnabled = (enabled: boolean) => {
  if (facade.state.stepStatsEnabled === enabled) return;
  facade.state.stepStatsEnabled = enabled;
  if (enabled) resetPhysicsStepStats();
  if (isWorkerTarget()) {
    messageWorker({ type: PhysicsProtocolType.SET_STEP_STATS, enabled, isOneWay: true });
  }
};

/**
 * Whether the physics step measurement is on (see {@link setPhysicsStepStatsEnabled}).
 * @internal
 */
export const isPhysicsStepStatsEnabled = () => facade.state.stepStatsEnabled;

/** The transform buffer step index from which a write made right now is visible in it: the
 * worker applies the write before (or, for captured sub-step commands, during) the next STEP,
 * whose steps are all numbered after the ones issued so far. Keyed on the producer's own step
 * stamp, so it can't drift from the worker when a world is recreated (unlike a count of posted
 * messages, which MESSAGE_BATCH never reset — p059 D10).
 * @internal
 */
export const getWriteVisibleStep = () => stepsIssued + 1;

/** Whether a write tagged with getWriteVisibleStep() hasn't reached the transform buffer yet.
 * Without any buffer (MESSAGE_BATCH before its first push) nothing has reached it.
 * @internal
 */
export const isWritePending = (visibleAt: number) =>
  !facade.transformBuffer || facade.transformBuffer.getStepIndex() < visibleAt;

const setPhysicsPauseTime = () => {
  const now = readPhysicsWallClock();
  if (facade.state.pausedTime > 0) {
    facade.state.pauseDurationTotal += now - facade.state.pausedTime;
  }
  facade.state.pausedTime = now;
};

/**
 * The wall clock (ms) minus the time physics was paused. Not deterministic: simulation code
 * counts fixed steps instead.
 * @internal
 * @deprecated Use the step index ({@link getPhysicsSubStepIndex}) times the fixed timestep
 * (removed in engine 6.0.0).
 */
export const getPhysGameTime = () => {
  const now = readPhysicsWallClock();
  let currentTotalPauseDuration = facade.state.pauseDurationTotal;

  // If currently paused, add the time since the last pause began
  if (facade.state.pausedTime > 0) {
    currentTotalPauseDuration += now - facade.state.pausedTime;
  }

  return now - currentTotalPauseDuration;
};

/**
 * Window visibility change handler (PhysicsWorld.ts adds it with the first world).
 * @internal
 */
export const physicsVisibilityChangeHandler = (isHidden: boolean) => {
  const loopState = getReadOnlyLoopState();
  if (isHidden) {
    if (loopState.masterPlay && facade.state.backgroundBehavior === 'PAUSE') {
      setPhysicsPauseTime();
      facade.state.isPaused = true;
      timerRunning = false;
      facade.state.pauseReason = 'BACKGROUND_BEHAVIOR';
      toggleMainPlay(false);
    }
  } else {
    if (facade.state.pauseReason === 'BACKGROUND_BEHAVIOR') {
      facade.state.pauseReason = null;
      // Re-enable the timer; stepPhysics()'s own resume-detection branch discards the
      // resulting pause-spanning dt and resets accDelta on its next call, so no flush is
      // needed here.
      timerRunning = true;
      toggleMainPlay(true);
    }
  }
};

/** Whether holdPhysicsStepping() is in effect. */
let isSteppingHeld = false;

/**
 * Stops the world from stepping until releasePhysicsStepping() is called. Physics' scene hooks
 * hold it for the whole scene load (loadStart to entered), so every body of the next scene starts stepping on the same
 * step no matter how long its assets took to load. Counts as a pause for getPhysGameTime().
 * @internal
 */
export const holdPhysicsStepping = () => {
  if (isSteppingHeld) return;
  isSteppingHeld = true;
  if (!facade.state.isPaused) setPhysicsPauseTime();
  facade.state.isPaused = true;
  facade.state.pauseReason ??= 'SCENE_LOAD';
};

/**
 * Ends holdPhysicsStepping(). The next stepPhysics() call takes the resume-from-pause path: it
 * discards the dt spanning the hold and the accumulator and restarts the timer, so stepping
 * restarts from a clean step boundary. That also covers the first boot, where the loop only
 * starts after the first load.
 * @internal
 */
export const releasePhysicsStepping = () => {
  if (!isSteppingHeld) return;
  isSteppingHeld = false;
  if (facade.state.pauseReason === 'SCENE_LOAD') facade.state.pauseReason = null;
};

/**
 * Whether {@link holdPhysicsStepping} holds stepping (a scene load).
 * @internal
 */
export const isPhysicsSteppingHeld = () => isSteppingHeld;

// Physics step accumulator variables
let timerRunning = true;
let accDelta = 0;
const timer = new THREE.Timer();
const updateTimer = () => {
  if (timerRunning) {
    timer.update();
  }
};

// --- Simulated-time clock + snapshot stamps (render interpolation, p059) ---
// Everything here is measured in fixed steps (1 = one timestepRatio of simulated time), so the
// stamps are integers and nothing drifts.

/** Fixed steps issued to the current world since it was created (MAIN_THREAD: stepped;
 * WORKER_THREAD: sent in STEP messages, possibly not executed yet). */
let stepsIssued = 0;
/** Fixed steps issued since boot, over every world (never reset, unlike stepsIssued). */
let subStepTotal = 0;
/** Bumped whenever the simulated-time clock is discontinuous: the accumulator is discarded
 * (pause → resume, maxSubSteps overflow) or the world is replaced. */
let simClockEpoch = 0;
/** Bumped whenever earlier snapshots stop describing the current world (world created/deleted,
 * snapshot restored), so pose histories captured before it must be thrown away. */
let simHistoryEpoch = 0;

// The clock phase each issued batch was stamped with, keyed by the step index its snapshot
// will carry. Only the phase lives here — the step index itself comes from the producer
// (PhysicsTransformBuffer.getStepIndex() on WORKER_THREAD), which can't know the main thread's
// accumulator. 64 steps is over a second of in-flight worker latency at 60Hz; a snapshot older
// than that just gets phase 0.
const SNAPSHOT_PHASE_RING_SIZE = 64;
const snapshotPhaseStep = new Float64Array(SNAPSHOT_PHASE_RING_SIZE).fill(-1);
const snapshotPhase = new Float64Array(SNAPSHOT_PHASE_RING_SIZE);

/** Counts the steps stepPhysics() just issued and records the accumulator's leftover fraction
 * of a step at that moment (the phase of the continuous clock when this batch was issued). */
const stampStepBatch = (stepsTaken: number) => {
  stepsIssued += stepsTaken;
  subStepTotal += stepsTaken;
  const i = stepsIssued % SNAPSHOT_PHASE_RING_SIZE;
  snapshotPhaseStep[i] = stepsIssued;
  snapshotPhase[i] = facade.state.timestepRatio > 0 ? accDelta / facade.state.timestepRatio : 0;
};

/** A new world starts a new simulated timeline: the step count restarts with it (as the
 * worker's own count does at CREATE_WORLD).
 * @internal
 */
export const resetSimClock = () => {
  stepsIssued = 0;
  // A gate's step is the old world's: it would hold the new one at a step it has nothing for
  clearPhysicsStepGates();
  snapshotPhaseStep.fill(-1);
  simClockEpoch++;
  simHistoryEpoch++;
};

/** Latches the newest physics snapshot for this frame (p063). Called by MainLoop at the very
 * start of every frame, before any stage, held-key polling, APP_PHYSICS_STEP or event callback
 * reads a pose, so all of them see the same complete snapshot. Only SHARED_MEMORY has anything
 * to latch (the worker writes it concurrently); a write-back that lands mid-frame waits for the
 * next frame. MAIN_THREAD and MESSAGE_BATCH are already consistent, and this is a no-op there.
 * @internal
 */
export const latchPhysicsSnapshot = () => {
  facade.transformBuffer?.latch();
};

/** Step index of the latest physics snapshot readable on the main thread — how many steps had
 * been executed on the current world when its poses were captured (0 before the first one).
 * MAIN_THREAD steps synchronously, so it is simply the steps issued; WORKER_THREAD reads the
 * stamp the worker writes into the transform buffer with every write-back. Changes exactly when
 * a new snapshot becomes visible, and only ever increases within one world.
 * @internal
 */
export const getPhysicsSnapshotStepIndex = () =>
  isWorkerTarget() ? facade.transformBuffer?.getStepIndex() ?? 0 : stepsIssued;

/** The snapshot step index from which a pose/velocity write made right now shows up in the
 * snapshots (see getPhysicsSnapshotStepIndex) — anything stamped earlier predates it.
 * @internal
 */
export const getPhysicsWriteVisibleStep = () => getWriteVisibleStep();

/** Stamp of the latest visible snapshot: `step` = getPhysicsSnapshotStepIndex(), `phase` = the
 * accumulator's fraction of a step when its batch was issued (0 if no longer known). Returns
 * false before the first snapshot. Writes into `out`, allocation-free.
 * @internal
 */
export const readPhysicsSnapshotStamp = (out: { step: number; phase: number }): boolean => {
  const step = getPhysicsSnapshotStepIndex();
  if (step <= 0) return false;
  const i = step % SNAPSHOT_PHASE_RING_SIZE;
  out.step = step;
  out.phase = snapshotPhaseStep[i] === step ? snapshotPhase[i] : 0;
  return true;
};

/** The stepper's continuous simulated-time clock, in fixed steps: steps issued to the current
 * world plus the accumulator's fraction of the next one. Advances by exactly what stepPhysics()
 * accumulates, so the render clock can move on the very same number (never a separate timer). */
export const getPhysicsSimClock = () =>
  facade.state.timestepRatio > 0
    ? stepsIssued + accDelta / facade.state.timestepRatio
    : stepsIssued;

/**
 * See simClockEpoch: changes whenever getPhysicsSimClock() jumps.
 * @internal
 */
export const getPhysicsSimClockEpoch = () => simClockEpoch;

/**
 * See simHistoryEpoch: changes whenever earlier snapshots stop describing the current world.
 * @internal
 */
export const getPhysicsSimHistoryEpoch = () => simHistoryEpoch;

/** Absolute step index (in stepsIssued) stepPhysics() never steps past; null = no limit. */
let stepLimit: number | null = null;

/**
 * Debug only (a no-op returning null outside IS_DEBUG_ENV): freezes the simulation after
 * `steps` more fixed steps, in both worker targets, until called again with null. Returns the
 * step index it freezes at, which is what getPhysicsSnapshotStepIndex() reads once the frozen
 * pose is visible (WORKER_THREAD mode gets there a frame or more later than MAIN_THREAD).
 * Used by the physics determinism probe (_dbg__PhysicsDeterminism.ts).
 * @internal
 */
export const setPhysicsStepLimit = (steps: number | null) => {
  if (!IS_DEBUG_ENV) return null;
  stepLimit = steps === null ? null : stepsIssued + Math.max(0, Math.floor(steps));
  return stepLimit;
};

/** The sub-step stepPhysics() is in (see getPhysicsSubStepIndex), -1 outside of one. */
let subStepIndex = -1;

/**
 * Inside a sub-step's `APP_PHYSICS_STEP` systems (stepPhysics' onBeforeStep), the index of the
 * fixed step about to run: the steps run on the current world before it, the same in both worker
 * targets. The first step of a world is 0, and a write made in step `k` is in the snapshot
 * stamped `k + 1` (getPhysicsSnapshotStepIndex) and after. -1 outside a sub-step. A step clock
 * for systems that must decide on fixed steps (p343: the deterministic tier policy).
 */
export const getPhysicsSubStepIndex = () => subStepIndex;

/** Held step gates (addPhysicsStepGate): gate id → the step index they hold stepping before. */
const stepGates = new Map<number, number>();
let nextStepGateId = 1;

const getLowestStepGate = () => {
  if (!stepGates.size) return Infinity;
  let lowest = Infinity;
  for (const step of stepGates.values()) if (step < lowest) lowest = step;
  return lowest;
};

/** How often and how long gates held stepping back (getPhysicsStepGateStats). */
const stepGateStats = { waits: 0, heldMs: 0 };
let stepGateHeldSince: number | null = null;

/** Called by stepPhysics: `held` when a gate cut a frame's steps, false once a frame wasn't. */
const noteStepGateHeld = (held: boolean) => {
  if (held) {
    if (stepGateHeldSince !== null) return;
    stepGateHeldSince = readStatsClock();
    stepGateStats.waits++;
    return;
  }
  if (stepGateHeldSince === null) return;
  stepGateStats.heldMs += readStatsClock() - stepGateHeldSince;
  stepGateHeldSince = null;
};

/**
 * Whether sub-step `i` of a batch of `stepsTaken` is held by a gate an earlier sub-step of the
 * same batch added (p343: a measurement whose reply its decision step needs). The batch then ends
 * before it, and its remaining steps go back to the accumulator, to run once the gate opens.
 */
const isSubStepGated = (i: number, stepsTaken: number) => {
  if (!stepGates.size || stepsIssued + i < getLowestStepGate()) return false;
  accDelta += (stepsTaken - i) * facade.state.timestepRatio;
  noteStepGateHeld(true);
  return true;
};

/**
 * Holds stepping before the fixed step `step` (a getPhysicsSubStepIndex index): stepPhysics()
 * issues no sub-step with an index of `step` or more until the returned function is called. With
 * several gates the lowest holds. For work that must finish before a given step runs, eg. a worker
 * reply a decision on that step needs (p343). A gate at a step already issued holds from the next.
 * One added by an `APP_PHYSICS_STEP` system also cuts the frame's batch it was added in.
 *
 * Unlike the debug step limit, time keeps accumulating while a gate holds, so a short hold is
 * caught up on the next frames (at most `maxSubSteps` steps of it; more is dropped as a frame over
 * the ceiling would). A new physics world (a scene load) drops every gate, and their release
 * functions do nothing then.
 */
export const addPhysicsStepGate = (step: number): (() => void) => {
  const id = nextStepGateId++;
  stepGates.set(id, step);
  return () => {
    stepGates.delete(id);
  };
};

/**
 * Since boot: `waits`, how many times a gate held back steps that were due, and `heldMs`, for how
 * long in total (wall clock, until a frame stepped without being cut). A hold still going counts
 * up to now.
 * @internal
 */
export const getPhysicsStepGateStats = () => ({
  waits: stepGateStats.waits,
  heldMs:
    stepGateStats.heldMs + (stepGateHeldSince === null ? 0 : readStatsClock() - stepGateHeldSince),
});

/**
 * Fixed physics sub-steps issued since boot, over every world (WORKER_THREAD: sent, possibly not
 * executed yet). Never reset, so the difference of two reads is the sub-steps in between, eg. per
 * frame (a count near maxSubSteps warns of the spiral of death).
 * @internal
 */
export const getPhysicsSubStepTotal = () => subStepTotal;

/**
 * Drops every step gate (stopPhysics, and a new world's resetSimClock).
 * @internal
 */
export const clearPhysicsStepGates = () => {
  stepGates.clear();
  noteStepGateHeld(false);
};

/**
 * Drops the time banked toward the next step (a deleted world's).
 * @internal
 */
export const dropStepAccumulator = () => {
  accDelta = 0;
};

/**
 * Every body may have jumped (a deleted world, a restored snapshot): the simulated-time clock is
 * discontinuous, and earlier poses no longer lead up to the current ones.
 * @internal
 */
export const breakSimHistory = () => {
  simClockEpoch++;
  simHistoryEpoch++;
};
