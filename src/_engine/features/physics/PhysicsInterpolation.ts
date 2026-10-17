// Render interpolation (p059): every frame, each BODY_DYNAMIC_VISUAL entity's Object3D gets its
// body's pose blended between the last physics snapshots, while TRANSFORM keeps the stepped pose.
// The physics entities' install (PhysicsEntity.ts) registers its system and transform reset
// listener.

import * as THREE from 'three/webgpu';

import { lwarn } from '../../utils/Logger';
import { IS_DEBUG_ENV } from '../../kernel/config/Config';
import type { ECSWorld, TransformResetListener } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import { getPhysicsState } from './PhysicsState';
import {
  getPhysicsSimClock,
  getPhysicsSimClockEpoch,
  getPhysicsSimHistoryEpoch,
  getPhysicsWriteVisibleStep,
  readPhysicsSnapshotStamp,
} from './PhysicsStepping';
import type { PhysicsInterpolationMode } from './types/PhysicsConfigTypes';

// --- Render interpolation (p059) ------------------------------------------------------------
//
// Every rendered pose is a monotone render clock, measured in simulated fixed steps, evaluated
// against the last three snapshots, whose endpoints carry the step index they describe:
//   alpha = (renderClock - prevStep) / (currStep - prevStep)
// The two modes run identical blend math and differ only in where the render clock comes from:
// - 'FIXED_PHYSICS' (open-loop): renderClock = simClock - delay, straight from the stepper.
//   Exact, but only valid when snapshots are visible in the frame they are issued (MAIN_THREAD).
// - 'RENDERER' (closed-loop): renderClock only ever advances by the stepper's own per-frame
//   advance, slightly sped up/slowed down (never displaced) toward a target anchored on every
//   newly visible snapshot. Worker latency is never estimated — it ends up as a constant lag.
// On MAIN_THREAD the target sits exactly on the FIXED_PHYSICS clock, so both modes converge.

/** Poses kept per entity (oldest → newest). Three, not two: under jitter the render clock can
 * legitimately fall before the previous snapshot, and two slots would clamp/stall there. */
const HISTORY_SLOTS = 3;
/** Floats per history slot: position xyz + (normalized) quaternion xyzw. */
const POSE_FLOATS = 7;
/** How many recent snapshot intervals the delay is the max of (~0.5s at 60 snapshots/s). */
const DELAY_WINDOW = 32;
/** Max render-clock speed-up/slow-down (and delay slew) relative to the simulation: a 15%
 * velocity error on a moving object is invisible, a position jump is not. */
const MAX_RATE_DEVIATION = 0.15;
/** Time constant (simulated seconds) of the RENDERER servo's lag correction. */
const SERVO_TIME_CONSTANT = 0.5;
/** Extra RENDERER delay under WORKER_THREAD, as a fraction of the delay, absorbing snapshot
 * arrival jitter (dominated by when the main thread gets around to reading). */
const JITTER_MARGIN_RATIO = 0.5;
/** RENDERER re-anchors outright (instead of servoing) once off by more than this many delays. */
const HARD_RESET_ERROR_RATIO = 4;
/** A quaternion shorter than this is no valid pose yet (e.g. rb.rot before the first snapshot
 * reads all zeros) — the entity is skipped rather than slerping NaN into its matrix. */
const MIN_QUAT_LENGTH_SQ = 1e-6;
const NO_SNAPSHOT = -1;

type InterpolationHistory = {
  /** HISTORY_SLOTS × POSE_FLOATS, oldest → newest, mutated in place. */
  poses: Float32Array;
  /** Step index of the snapshot the newest slot was captured at. Anything but the world
   * state's previous `lastStep` when a new snapshot arrives means this entity missed one (new,
   * disabled, skipped) — its history has a hole and gets reseeded instead of shifted. */
  capturedAt: number;
  /** Set by an explicit pose reset (setTransform/teleport): until a snapshot stamped at least
   * this step is visible, no snapshot reflects the new pose yet, so snapPose is shown as-is and
   * nothing is captured. 0 = not snapping. */
  snapUntilStep: number;
  /** The reset pose (POSE_FLOATS), allocated on the entity's first reset. */
  snapPose: Float32Array | null;
};

/**
 * Throws away one entity's pose history: its next capture reseeds it, so it doesn't blend from
 * a pose it left (a body back from the REMOVED physics tier, p352; a deleted entity).
 * @internal
 */
export const resetPhysicsInterpolationHistory = (world: ECSWorld, entityId: number) => {
  worldInterpolationStates.get(world)?.histories.delete(entityId);
};

/**
 * Live values for the Physics API debug tab, mutated in place (never reallocated).
 * @internal
 */
export type PhysicsInterpolationReadout = {
  /** Render clock behind the stepper's clock (ms of simulated time). */
  lagMs: number;
  /** Render clock speed relative to the simulation over the last frame (1 = nominal). */
  rate: number;
  /** Current (slewed) delay D (ms) — the max recent snapshot interval. */
  delayMs: number;
  /** Most recently measured snapshot interval (ms). */
  intervalMs: number;
  /** RENDERER: target minus render clock (ms); 0 for FIXED_PHYSICS. */
  errorMs: number;
  /** Hard resets (re-anchors) since boot. */
  resets: number;
};

type WorldInterpolationState = {
  histories: Map<number, InterpolationHistory>;
  /** Step index of each history slot, oldest → newest. Shared by the whole world — every
   * entity captures on the same snapshots, and a reseeded history holds one pose in all slots,
   * so its stamps don't matter. */
  stamps: Float64Array;
  /** Step index of the newest snapshot captured (NO_SNAPSHOT: none yet). */
  lastStep: number;
  clockEpoch: number;
  historyEpoch: number;
  mode: PhysicsInterpolationMode | null;
  timestepRatio: number;
  lastSimClock: number;
  /** Slewed D, in steps. */
  delay: number;
  intervals: Int32Array;
  intervalIndex: number;
  wasLastIntervalOutlier: boolean;
  /** RENDERER only. */
  renderClock: number;
  targetClock: number;
  hasTarget: boolean;
  isClockAnchored: boolean;
  readout: PhysicsInterpolationReadout;
  /** Renders the newest snapshot, no blend (setPhysicsInterpolationPinnedToNewest). */
  isPinnedToNewest: boolean;
};

// Per world: entity ids (and so history keys) are only unique within one world.
const worldInterpolationStates = new WeakMap<ECSWorld, WorldInterpolationState>();

const getWorldInterpolationState = (world: ECSWorld) => {
  let state = worldInterpolationStates.get(world);
  if (!state) {
    state = {
      histories: new Map(),
      stamps: new Float64Array(HISTORY_SLOTS),
      lastStep: NO_SNAPSHOT,
      clockEpoch: -1,
      historyEpoch: -1,
      mode: null,
      timestepRatio: 0,
      lastSimClock: 0,
      delay: 1,
      intervals: new Int32Array(DELAY_WINDOW).fill(1),
      intervalIndex: 0,
      wasLastIntervalOutlier: false,
      renderClock: 0,
      targetClock: 0,
      hasTarget: false,
      isClockAnchored: false,
      readout: { lagMs: 0, rate: 1, delayMs: 0, intervalMs: 0, errorMs: 0, resets: 0 },
      isPinnedToNewest: false,
    };
    worldInterpolationStates.set(world, state);
  }
  return state;
};

/** Throws away every pose history (they'll reseed on their next capture). Rare — world
 * replaced / snapshot restored — so the per-entity walk is fine. */
const resetInterpolationHistory = (state: WorldInterpolationState) => {
  for (const history of state.histories.values()) {
    history.capturedAt = NO_SNAPSHOT;
    history.snapUntilStep = 0; // a stale target from the previous timeline could never be reached
  }
  state.lastStep = NO_SNAPSHOT;
  state.intervals.fill(1);
  state.wasLastIntervalOutlier = false;
  state.hasTarget = false;
  state.isClockAnchored = false;
};

/**
 * Debug and test only: while pinned, every interpolated body of `world` is drawn at the newest
 * visible snapshot, with no blend toward it. The scene runner's test bridge pins it once the
 * determinism probe has held physics, so a still frame shows the exact step the probe hashed,
 * not a pose between the last two steps that depends on frame timing (p601).
 * @internal
 */
export const setPhysicsInterpolationPinnedToNewest = (world: ECSWorld, isPinned: boolean) => {
  getWorldInterpolationState(world).isPinnedToNewest = isPinned;
};

/**
 * Live interpolation clock values of `world`, for the debug tab. Stable object, updated every
 * frame the interpolation system runs in an interpolating mode.
 * @internal
 */
export const getPhysicsInterpolationReadout = (world: ECSWorld) =>
  getWorldInterpolationState(world).readout;

const snapshotStamp = { step: 0, phase: 0 };
const scratchQuatA = new THREE.Quaternion();
const scratchQuatB = new THREE.Quaternion();
// Checked here rather than at initPhysics() so it also catches a mode restored from
// localStorage or switched live from the Physics API debug tab.
let hasWarnedInvalidInterpolationPairing = false;

/** [pos xyz, quat xyzw] every capture is read into (rb.readPoseInto, no per-read allocation). */
const capturePose = new Float64Array(POSE_FLOATS);

/** Normalizes capturePose's quaternion in place — at capture, since Float32 round-trips drift
 * off unit length and slerp assumes unit inputs. False when it is no valid pose yet (a (near)
 * zero quaternion, e.g. rb.rot before the first snapshot): the caller must skip the entity
 * rather than slerp NaN into its matrix. */
const normalizeCapturePose = (): boolean => {
  const p = capturePose;
  const quatLengthSq = p[3] * p[3] + p[4] * p[4] + p[5] * p[5] + p[6] * p[6];
  if (quatLengthSq < MIN_QUAT_LENGTH_SQ) return false;
  const invQuatLength = 1 / Math.sqrt(quatLengthSq);
  p[3] *= invQuatLength;
  p[4] *= invQuatLength;
  p[5] *= invQuatLength;
  p[6] *= invQuatLength;
  return true;
};

/** Copies capturePose into history slot `slot`. */
const writeHistorySlot = (poses: Float32Array, slot: number) => {
  const o = slot * POSE_FLOATS;
  for (let i = 0; i < POSE_FLOATS; i++) poses[o + i] = capturePose[i];
};

const createInterpolationHistory = (): InterpolationHistory => ({
  poses: new Float32Array(HISTORY_SLOTS * POSE_FLOATS),
  capturedAt: NO_SNAPSHOT,
  snapUntilStep: 0,
  snapPose: null,
});

/**
 * The transform reset listener (the physics entities' install registers it): explicit pose
 * resets (setTransform/teleport) are discontinuities, and without this the history would blend
 * from the old position to the new one, a visible streak across the jump. The history isn't
 * reseeded here: under WORKER_THREAD rb.pos is still the not-yet-stepped pending value, and
 * stamping it with the latest snapshot's step would place it at a simulated time it doesn't
 * belong to. The reset pose is shown as-is instead until a later-stamped snapshot lands.
 * @internal
 */
export const onPhysicsTransformReset: TransformResetListener = (world, entityId) => {
  if (!world.hasComponent(entityId, ComponentType.BODY_DYNAMIC_VISUAL)) return;
  const transform = world.getComponent(entityId, ComponentType.TRANSFORM);
  if (!transform) return;
  const state = getWorldInterpolationState(world);
  let history = state.histories.get(entityId);
  if (!history) {
    history = createInterpolationHistory();
    state.histories.set(entityId, history);
  }
  const { position: pos, quaternion: q } = transform;
  capturePose[0] = pos.x;
  capturePose[1] = pos.y;
  capturePose[2] = pos.z;
  capturePose[3] = q.x;
  capturePose[4] = q.y;
  capturePose[5] = q.z;
  capturePose[6] = q.w;
  if (!normalizeCapturePose()) return;
  history.snapPose ??= new Float32Array(POSE_FLOATS);
  writeHistorySlot(history.snapPose, 0);
  history.snapUntilStep = getPhysicsWriteVisibleStep();
};

/**
 * Render-only smoothing on top of the discrete physics-step pose: writes the blended pose only
 * into the Object3D — TRANSFORM stays the authoritative, non-interpolated pose for gameplay
 * code (collision queries, AI, etc.). No-ops entirely for 'NONE', leaving object3DSyncSystem's
 * own MAIN-stage sync as the sole writer. See the section comment above for the clock model.
 * @internal
 */
export const physicsInterpolationSystem = (world: ECSWorld) => {
  const physicsState = getPhysicsState();
  const mode = physicsState.interpolationMode;
  if (mode === 'NONE') return;
  // Reserved, not implemented.
  if (mode === 'EXTRAPOLATION') return;

  if (
    IS_DEBUG_ENV &&
    !hasWarnedInvalidInterpolationPairing &&
    mode === 'FIXED_PHYSICS' &&
    physicsState.workerTarget === 'WORKER_THREAD'
  ) {
    hasWarnedInvalidInterpolationPairing = true;
    lwarn(
      "interpolationMode 'FIXED_PHYSICS' is not valid with workerTarget 'WORKER_THREAD': its clock comes from the main thread's accumulator, but the snapshots arrive asynchronously from the worker, later than that clock assumes, so the pose freezes and jumps. Use 'RENDERER' for WORKER_THREAD (see PhysicsState.interpolationMode)."
    );
  }

  const state = getWorldInterpolationState(world);
  const timestepRatio = physicsState.timestepRatio;

  // --- Reset events (snap and re-anchor, no servoing) ---
  let resetClock = false;
  const historyEpoch = getPhysicsSimHistoryEpoch();
  if (state.historyEpoch !== historyEpoch) {
    state.historyEpoch = historyEpoch;
    resetInterpolationHistory(state);
    resetClock = true;
  }
  if (state.mode !== mode) {
    // The mode may have been 'NONE' until now, during which nothing here ran: the snapshot
    // tracking is stale (its next interval would span the whole gap).
    if (state.mode !== null) resetInterpolationHistory(state);
    state.mode = mode;
    resetClock = true;
  }
  const clockEpoch = getPhysicsSimClockEpoch();
  if (state.clockEpoch !== clockEpoch || state.timestepRatio !== timestepRatio) {
    state.clockEpoch = clockEpoch;
    state.timestepRatio = timestepRatio;
    resetClock = true;
  }

  // --- Newly visible snapshot? (identified by the step index it was stamped with) ---
  let prevStep = state.lastStep;
  let isNewSnapshot = false;
  if (readPhysicsSnapshotStamp(snapshotStamp) && snapshotStamp.step !== state.lastStep) {
    isNewSnapshot = true;
    const newestStep = state.stamps[HISTORY_SLOTS - 1];
    if (prevStep === NO_SNAPSHOT || snapshotStamp.step <= newestStep) {
      // First snapshot of a timeline (or one that doesn't follow the last): nothing to
      // interpolate from yet.
      if (prevStep !== NO_SNAPSHOT) resetInterpolationHistory(state);
      prevStep = NO_SNAPSHOT;
      state.stamps.fill(snapshotStamp.step);
      resetClock = true;
    } else {
      const interval = snapshotStamp.step - newestStep;
      const isOutlier = interval > HARD_RESET_ERROR_RATIO * state.delay;
      if (isOutlier && !state.wasLastIntervalOutlier) {
        // A one-off hitch (or a stall in delivery), not a cadence: snap past it rather than
        // stretching D — and so the lag — for the whole window.
        resetClock = true;
      } else {
        // Two in a row is a new cadence (e.g. the render rate dropped well below the physics
        // rate): adopt it at once.
        if (isOutlier) resetClock = true;
        state.intervals[state.intervalIndex] = interval;
        state.intervalIndex = (state.intervalIndex + 1) % DELAY_WINDOW;
      }
      state.wasLastIntervalOutlier = isOutlier;
      state.stamps.copyWithin(0, 1);
      state.stamps[HISTORY_SLOTS - 1] = snapshotStamp.step;
    }
    state.lastStep = snapshotStamp.step;
  }
  if (state.lastStep === NO_SNAPSHOT) return; // nothing stamped yet — leave the MAIN sync pose

  // --- Delay D: one snapshot interval, measured (max over the recent window, so alternating
  // intervals are extra-delayed on the short ones instead of clamping on the long ones) ---
  let maxInterval = 1;
  for (let i = 0; i < DELAY_WINDOW; i++) {
    if (state.intervals[i] > maxInterval) maxInterval = state.intervals[i];
  }
  const simClock = getPhysicsSimClock();
  const simAdvance = resetClock ? 0 : Math.max(0, simClock - state.lastSimClock);
  state.lastSimClock = simClock;
  if (resetClock) {
    state.delay = maxInterval;
  } else {
    const maxSlew = MAX_RATE_DEVIATION * simAdvance;
    state.delay += Math.min(maxSlew, Math.max(-maxSlew, maxInterval - state.delay));
  }

  // --- Render clock ---
  const prevRenderClock = state.renderClock;
  let error = 0;
  if (mode === 'FIXED_PHYSICS') {
    state.renderClock = simClock - state.delay;
  } else {
    const margin =
      physicsState.workerTarget === 'WORKER_THREAD' ? JITTER_MARGIN_RATIO * maxInterval : 0;
    if (isNewSnapshot) {
      // Where the render clock belongs at the moment this snapshot becomes visible: its step
      // plus the clock phase it was issued at (on MAIN_THREAD that is exactly simClock now).
      state.targetClock = snapshotStamp.step + snapshotStamp.phase - state.delay - margin;
      state.hasTarget = true;
    } else {
      state.targetClock += simAdvance;
    }

    if (!state.hasTarget) {
      state.renderClock = state.stamps[HISTORY_SLOTS - 1];
      state.isClockAnchored = false;
    } else if (resetClock || !state.isClockAnchored) {
      state.renderClock = state.targetClock;
      state.isClockAnchored = true;
      state.readout.resets++;
    } else {
      // Against where the clock lands this frame at nominal rate — the target has already
      // been advanced by this frame's simAdvance above.
      const nominalRenderClock = state.renderClock + simAdvance;
      error = state.targetClock - nominalRenderClock;
      if (Math.abs(error) > HARD_RESET_ERROR_RATIO * maxInterval) {
        state.renderClock = state.targetClock;
        state.readout.resets++;
      } else {
        // Time dilation, never displacement: the correction is bounded by a fraction of this
        // frame's own advance, so the clock is monotone and the pose continuous.
        const maxCorrection = MAX_RATE_DEVIATION * simAdvance;
        const gain = Math.min(1, (simAdvance * timestepRatio) / SERVO_TIME_CONSTANT);
        const correction = Math.min(maxCorrection, Math.max(-maxCorrection, error * gain));
        state.renderClock = nominalRenderClock + correction;
      }
    }
  }
  // Pinned: the newest snapshot as is (the servoed clock keeps running underneath)
  const renderClock = state.isPinnedToNewest ? state.stamps[HISTORY_SLOTS - 1] : state.renderClock;

  const toMs = timestepRatio * 1000;
  const readout = state.readout;
  readout.lagMs = (simClock - renderClock) * toMs;
  if (simAdvance > 0) readout.rate = (renderClock - prevRenderClock) / simAdvance;
  readout.delayMs = state.delay * toMs;
  readout.intervalMs =
    state.intervals[(state.intervalIndex + DELAY_WINDOW - 1) % DELAY_WINDOW] * toMs;
  readout.errorMs = error * toMs;

  // --- Segment (shared by every entity: same stamps) ---
  const stamps = state.stamps;
  let slotA = 0;
  let slotB = 0;
  let alpha = 0;
  if (renderClock >= stamps[2]) {
    slotA = slotB = 2;
  } else if (renderClock >= stamps[1]) {
    slotA = 1;
    slotB = 2;
    alpha = (renderClock - stamps[1]) / (stamps[2] - stamps[1]);
  } else if (renderClock >= stamps[0]) {
    slotB = 1;
    alpha = (renderClock - stamps[0]) / (stamps[1] - stamps[0]);
  } // else: before the oldest snapshot — freeze on it rather than reverse (alpha stays 0)

  const a = slotA * POSE_FLOATS;
  const b = slotB * POSE_FLOATS;
  // Each storage read once per frame, not per entity
  const dynamicVisuals = world.getStorage(ComponentType.BODY_DYNAMIC_VISUAL);
  const disabled = world.getStorage(ComponentType.DISABLED);
  const object3Ds = world.getStorage(ComponentType.OBJECT3D);
  for (const entityId of dynamicVisuals.keys()) {
    if (disabled.has(entityId)) continue;
    const rb = dynamicVisuals.get(entityId)!;
    const obj3D = object3Ds.get(entityId)?.value;
    if (!obj3D) continue;

    let history = state.histories.get(entityId);
    if (history && history.snapUntilStep > 0) {
      if (state.lastStep < history.snapUntilStep) {
        const p = history.snapPose!;
        obj3D.position.set(p[0], p[1], p[2]);
        obj3D.quaternion.set(p[3], p[4], p[5], p[6]);
        continue;
      }
      // The first snapshot that includes the reset: start the history over from it.
      history.snapUntilStep = 0;
      history.capturedAt = NO_SNAPSHOT;
    }
    if (!history || history.capturedAt !== state.lastStep) {
      rb.readPoseInto(capturePose);
      if (!normalizeCapturePose()) continue;
      if (!history) {
        history = createInterpolationHistory();
        state.histories.set(entityId, history);
      }
      const poses = history.poses;
      if (isNewSnapshot && prevStep !== NO_SNAPSHOT && history.capturedAt === prevStep) {
        poses.copyWithin(0, POSE_FLOATS);
        writeHistorySlot(poses, HISTORY_SLOTS - 1);
      } else {
        // Hole in the history (new, re-enabled, skipped, or reset): reseed every slot with the
        // current pose, which makes this frame (and the history) snap to it.
        for (let slot = 0; slot < HISTORY_SLOTS; slot++) {
          writeHistorySlot(poses, slot);
        }
      }
      history.capturedAt = state.lastStep;
    }

    const poses = history.poses;
    const invAlpha = 1 - alpha;
    obj3D.position.set(
      poses[a] * invAlpha + poses[b] * alpha,
      poses[a + 1] * invAlpha + poses[b + 1] * alpha,
      poses[a + 2] * invAlpha + poses[b + 2] * alpha
    );
    scratchQuatA.set(poses[a + 3], poses[a + 4], poses[a + 5], poses[a + 6]);
    scratchQuatB.set(poses[b + 3], poses[b + 4], poses[b + 5], poses[b + 6]);
    obj3D.quaternion.copy(scratchQuatA.slerp(scratchQuatB, alpha));
  }
};
