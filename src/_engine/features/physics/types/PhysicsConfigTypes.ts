import type { ENGINES } from '../backends/Engines';

export type PhysicsEngine = keyof typeof ENGINES;
export type PhysicsWorkerTarget = 'MAIN_THREAD' | 'WORKER_THREAD'; // + possible 'SERVER_AND_MAIN' | 'SERVER_AND_WORKER' if implemented
export type PhysicsBackgroundBehavior = 'KEEP_RUNNING' | 'KEEP_RUNNING_USE_MIN_DELTA' | 'PAUSE';
export type PhysicsInterpolationMode = 'NONE' | 'RENDERER' | 'FIXED_PHYSICS' | 'EXTRAPOLATION';

export type PhysicsState = {
  enabled: boolean;
  physicsEngine: PhysicsEngine;
  workerTarget: PhysicsWorkerTarget;
  timestep: number;
  timestepRatio: number;
  /** What stepPhysics() should do while the window is hidden (another tab, another window,
   * minimized). Only consulted while hidden — an explicit pause (loopState.masterPlay or
   * loopState.appPlay = false) always halts stepping outright, regardless of this setting.
   * 'KEEP_RUNNING' = Keep stepping using the real elapsed time (still subject to maxDeltaTime).
   * 'KEEP_RUNNING_USE_MIN_DELTA' = Keep stepping, but substitute minDeltaTime for the real
   *   elapsed time so a throttled background tab doesn't try to catch up to real time. Requires: minDeltaTime > 0.
   * 'PAUSE' = Halt the physics loop (and, via the visibility handler, the whole main loop) while hidden.
   */
  backgroundBehavior: PhysicsBackgroundBehavior;
  isPaused: boolean;
  /** When the physics loop is on pause (backgroundBehavior = 'PAUSE', loopState.masterPlay = false, or loopState.appPlay = false)
   * the time it was paused (performance.now()). 0 = not paused.
   */
  pausedTime: number;
  /** Total pause duration, used for the getPhysGameTime helper (in the helpers.ts) */
  pauseDurationTotal: number;
  /** Why physics is paused, when something other than an explicit play toggle paused it:
   * 'BACKGROUND_BEHAVIOR' = the app window is hidden, 'SCENE_LOAD' = a scene is loading (see
   * holdPhysicsStepping). */
  pauseReason: 'BACKGROUND_BEHAVIOR' | 'SCENE_LOAD' | null;
  /** Minimum delta time (seconds) substituted for the real elapsed time when
   * backgroundBehavior is 'KEEP_RUNNING_USE_MIN_DELTA' and the window is hidden.
   * 0 = not in use.
   */
  minDeltaTime: number;
  /** Upper bound (seconds) on how much elapsed time a single frame may feed into the
   * fixed-timestep accumulator, guarding against a huge delta after a stall or a
   * throttled background tab (e.g., if rendering stalls). 0 = not in use.
   */
  maxDeltaTime: number;
  /** Maximum fixed-timestep sub-steps stepPhysics() may run in a single frame; once hit,
   * any remaining accumulated time is dropped (not deferred) to prevent an ever-growing
   * backlog under sustained slowdowns ("spiral of death"). 0 = not in use.
   */
  maxSubSteps: number;
  worldStepEnabled: boolean;
  visualizerEnabled: boolean;
  gravity: { x: number; y: number; z: number };
  solverIterations: number;
  internalPgsIterations: number;
  /** Render-time smoothing applied on top of the discrete physics-step pose (never written
   * back into the ECS TRANSFORM, which always stays the authoritative, non-interpolated
   * pose for gameplay code). Engine default 'NONE'. Both smoothing modes blend the last
   * snapshots with identical math, at a render clock measured in simulated time and one
   * snapshot interval behind; they differ only in where that clock comes from.
   * 'NONE' = the Object3D shows the latest discrete physics-step pose as-is (one render frame
   *   stale, and it judders whenever the render rate exceeds the physics rate — by design).
   * 'RENDERER' = closed-loop: the clock advances with the simulation and is gently sped up or
   *   slowed down toward the snapshots actually received. Worker latency ends up as a constant
   *   extra lag (plus a jitter margin), late or bunched write-backs are ridden out. Use this
   *   with WORKER_THREAD. On MAIN_THREAD it converges to 'FIXED_PHYSICS'.
   * 'FIXED_PHYSICS' = open-loop: the clock is the stepper's own accumulator. Exact and
   *   frame-reproducible, lowest latency, but MAIN_THREAD only: under WORKER_THREAD the
   *   snapshots arrive asynchronously, so the pose freezes and jumps (a one-time warning is
   *   logged in debug builds).
   * 'EXTRAPOLATION' = reserved, not implemented.
   */
  interpolationMode: PhysicsInterpolationMode;
  /** Intent to use SharedArrayBuffer for the worker-thread hot-path transform buffer.
   * Actual capability (cross-origin isolation) is resolved at initPhysics() time;
   * this is the configured intent, not the resolved capability.
   */
  useSAB: boolean;
  /** Fixed capacity for the worker-thread hot-path transform buffer (PhysicsTransformBuffer). */
  maxBodies: number;
  /** Whether per-frame step-duration (and, in WORKER_THREAD mode, messaging-latency)
   * measurement is on. Opt-in, default false: with it off, no extra performance.now() call,
   * buffer allocation or message field is paid anywhere in the step hot path. The boot value
   * reaches the worker inside the INIT_PHYSICS payload; setPhysicsStepStatsEnabled() changes
   * it at runtime (SET_STEP_STATS). */
  stepStatsEnabled: boolean;
};
