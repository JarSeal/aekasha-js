// The physics step statistics (p027): the step time, the messaging overhead around it, and the
// bodies awake and asleep. Measured only while AppConfig.physics.stepStatsEnabled (or
// setPhysicsStepStatsEnabled) is on.

import { updatePhysicsPanel } from '../../debug/Stats';
import { IS_DEBUG_ENV } from '../../kernel/config/Config';
import { readStatsClock } from '../../utils/StatsClock';
import { facade } from './PhysicsState';
import { PHYSICS_STEP_STATS_FIELD_COUNT, PHYSICS_STEP_STATS_SLOTS } from './PhysicsStepStatsBuffer';
import type { TransformsPushMessage } from './protocol/PhysicsResponses';
import type { PhysicsBodyActivity } from './types/PhysicsBodyTypes';

/** Step statistics (p027), all only ever populated while physicsState.stepStatsEnabled is on.
 * Pure simulation time for the last stepped frame — the sum of that frame's engine step()
 * calls, with nothing else folded in. Deliberately never includes messaging overhead; that
 * is reported separately by lastPhysicsMessagingLatency. */
let lastPhysicsStepDurationMs: number | undefined;
/** Messaging overhead bracketing the step, WORKER_THREAD only (stays undefined on
 * MAIN_THREAD, where no message crosses a thread at all). */
let lastPhysicsMessagingLatency: { dispatchMs: number; writeBackMs: number } | undefined;
/** SHARED_MEMORY-transport view onto the current world's step-stats buffer (handed over at
 * every CREATE_WORLD, whatever stepStatsEnabled is). Undefined in every other configuration
 * (MAIN_THREAD, MESSAGE_BATCH). */
let stepStatsFloats: Float64Array | undefined;

/** Dynamic bodies awake and asleep after the last measured step (p352), mutated in place. Only
 * meaningful while hasBodyActivity is set (a measured step has reported it). */
const bodyActivity: PhysicsBodyActivity = { awake: 0, sleeping: 0 };
let hasBodyActivity = false;

/**
 * MAIN_THREAD: records a stepped frame's measurement (stepPhysics, while measuring).
 * @internal
 */
export const recordMainThreadStepStats = (stepMs: number) => {
  lastPhysicsStepDurationMs = stepMs;
  if (facade.engAPI) {
    facade.engAPI.countDynamicBodyActivity(bodyActivity);
    hasBodyActivity = true;
  }
  // No thread boundary is crossed here, so there is no messaging overhead to report.
  lastPhysicsMessagingLatency = undefined;
  updatePhysicsPanel(stepMs);
};

/**
 * MESSAGE_BATCH: records the measurement a TRANSFORMS_PUSH carries (only while measuring).
 * @internal
 */
export const recordPushedStepStats = (data: TransformsPushMessage) => {
  if (data.stepDuration === undefined) return;
  lastPhysicsStepDurationMs = data.stepDuration;
  lastPhysicsMessagingLatency = {
    dispatchMs: data.dispatchMs ?? 0,
    writeBackMs: data.stepEndAt !== undefined ? readStatsClock() - data.stepEndAt : 0,
  };
  if (data.awakeBodies !== undefined && data.sleepingBodies !== undefined) {
    bodyActivity.awake = data.awakeBodies;
    bodyActivity.sleeping = data.sleepingBodies;
    hasBodyActivity = true;
  }
  // The panel shows the pure step time only — never step + messaging overhead. The flag here
  // too (the panel exists only there): a production build drops the call
  if (IS_DEBUG_ENV) updatePhysicsPanel(data.stepDuration);
};

/**
 * SHARED_MEMORY: the current world's step-stats buffer, handed over at every CREATE_WORLD
 * (whatever stepStatsEnabled is). Undefined in every other configuration.
 * @internal
 */
export const setStepStatsBuffer = (statsBuffer: SharedArrayBuffer | undefined) => {
  stepStatsFloats = statsBuffer
    ? new Float64Array(statsBuffer, 0, PHYSICS_STEP_STATS_FIELD_COUNT)
    : undefined;
};

/**
 * Clears the last figures, so a reader sees `undefined` ("no measured step yet") instead of what
 * an earlier measuring period left behind (setPhysicsStepStatsEnabled).
 * @internal
 */
export const resetPhysicsStepStats = () => {
  lastPhysicsStepDurationMs = undefined;
  lastPhysicsMessagingLatency = undefined;
  hasBodyActivity = false;
  // The worker writes it only while measuring, which it isn't yet, so this can't race
  if (stepStatsFloats) stepStatsFloats[PHYSICS_STEP_STATS_SLOTS.STEP_END_AT] = 0;
};

/** Polls the SHARED_MEMORY step-stats buffer, if one exists. No-op in every other transport.
 *
 * Note the asymmetry this creates in writeBackMs: in MESSAGE_BATCH mode that figure is real
 * postMessage transit time, whereas here there is no return message to time, so it measures
 * how long after the worker finished stepping the main thread got around to reading — a
 * read-cadence latency. The two transports' writeBackMs are therefore not comparable.
 * @internal
 */
export const readSharedStepStats = () => {
  if (!stepStatsFloats) return;
  const stepEndAt = stepStatsFloats[PHYSICS_STEP_STATS_SLOTS.STEP_END_AT];
  // Zero means the worker hasn't completed a step yet — nothing to report.
  if (!stepEndAt) return;
  lastPhysicsStepDurationMs = stepStatsFloats[PHYSICS_STEP_STATS_SLOTS.STEP_MS];
  lastPhysicsMessagingLatency = {
    dispatchMs: stepStatsFloats[PHYSICS_STEP_STATS_SLOTS.DISPATCH_MS],
    writeBackMs: readStatsClock() - stepEndAt,
  };
  bodyActivity.awake = stepStatsFloats[PHYSICS_STEP_STATS_SLOTS.AWAKE_BODIES];
  bodyActivity.sleeping = stepStatsFloats[PHYSICS_STEP_STATS_SLOTS.SLEEPING_BODIES];
  hasBodyActivity = true;
  updatePhysicsPanel(lastPhysicsStepDurationMs);
};

/**
 * Time the physics engine spent stepping the world on the last stepped frame, in
 * milliseconds — the sum of that frame's fixed-timestep sub-steps and nothing else.
 *
 * Returns `undefined` until a measured step has happened, and stays frozen at its last value
 * while step stats are off (the default), since nothing measures then. The boot value is
 * `AppConfig.physics.stepStatsEnabled` (the Physics API debug tab's reloading switch);
 * {@link _engine/features/physics/PhysicsStepping!setPhysicsStepStatsEnabled} switches it at runtime, which resets this to `undefined`.
 *
 * This figure never includes main-thread↔worker messaging overhead, in any `workerTarget` or
 * transport configuration — see {@link getLastPhysicsStepMessagingLatency} for that, which is
 * measured independently and is never summed into this one.
 * @internal
 */
export const getLastPhysicsStepDuration = () => lastPhysicsStepDurationMs;

/**
 * Main-thread↔worker messaging overhead bracketing the last measured physics step, in
 * milliseconds. `undefined` in `MAIN_THREAD` mode (nothing crosses a thread boundary), and
 * until a measured step has happened.
 *
 * - `dispatchMs` — main→worker: how long the one-way STEP message took to reach the worker.
 * - `writeBackMs` — worker→main, and **it does not mean the same thing in both transports**:
 *   in `MESSAGE_BATCH` it is real postMessage transit time of the TRANSFORMS_PUSH carrying
 *   the results; in `SHARED_MEMORY` there is no return message at all, so it is instead the
 *   read-cadence latency (worker finished stepping → main thread next polled the shared
 *   buffer). Surface that distinction anywhere these are displayed rather than comparing the
 *   two transports' numbers as like for like.
 *
 * Disjoint from {@link getLastPhysicsStepDuration} by construction: the intervals are
 * adjacent, never overlapping, and the two are never combined into a single figure.
 * @internal
 */
export const getLastPhysicsStepMessagingLatency = () => lastPhysicsMessagingLatency;

/**
 * Dynamic bodies awake and asleep after the last measured physics step (p352): a body that
 * should be resting but stays awake shows here. Measured with the step stats, so `undefined`
 * while they are off and until a measured step has happened, like
 * {@link getLastPhysicsStepDuration}. The returned object is reused: read it, don't keep it.
 * @internal
 */
export const getLastPhysicsBodyActivity = (): Readonly<PhysicsBodyActivity> | undefined =>
  hasBodyActivity ? bodyActivity : undefined;
