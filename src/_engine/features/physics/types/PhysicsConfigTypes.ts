/** A physics backend, by its key in `backends/Engines.ts`' `ENGINES`. Only Rapier exists. */
export type PhysicsEngine = 'RAPIER';

/**
 * Where the simulation runs: `'MAIN_THREAD'` (synchronous queries, deterministic characters) or
 * `'WORKER_THREAD'` (a worker, its transforms back through a shared buffer or one message per
 * frame). A server target would be a third (p511).
 */
export type PhysicsWorkerTarget = 'MAIN_THREAD' | 'WORKER_THREAD';

/** What the physics stepping does while the window is hidden: see `PhysicsState.backgroundBehavior`. */
export type PhysicsBackgroundBehavior = 'KEEP_RUNNING' | 'KEEP_RUNNING_USE_MIN_DELTA' | 'PAUSE';

/** How an `Object3D` shows its body's pose between steps: see `PhysicsState.interpolationMode`. */
export type PhysicsInterpolationMode = 'NONE' | 'RENDERER' | 'FIXED_PHYSICS' | 'EXTRAPOLATION';

/**
 * The physics settings and stepping state the facade keeps (`getPhysicsState`): `AppConfig.physics`
 * resolved at `initPhysics`, and what changes while it runs (the pause). Read it, don't write it:
 * the setters (`setPhysicsStepStatsEnabled`, the debug tab's) keep the worker in step.
 */
export type PhysicsState = {
  /** Whether a physics world was asked for at boot (`AppConfig.physics.enabled`). */
  enabled: boolean;
  /** The backend. */
  physicsEngine: PhysicsEngine;
  /** Where the simulation runs. */
  workerTarget: PhysicsWorkerTarget;
  /** Fixed steps per second. */
  timestep: number;
  /** One fixed step's length in seconds (`1 / timestep`). */
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
  /** Whether stepping is paused (an explicit play toggle, the background behaviour or a scene
   * load: `pauseReason`). */
  isPaused: boolean;
  /** When the physics loop is on pause (backgroundBehavior = 'PAUSE', loopState.masterPlay = false, or loopState.appPlay = false)
   * the time it was paused (the physics wall clock, `PhysicsWallClock.ts`). 0 = not paused.
   */
  pausedTime: number;
  /** Total pause duration, read by the deprecated `getPhysGameTime` (`PhysicsWallClock.ts`). */
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
  /** Whether the world steps at all (false: the bodies exist and nothing moves). */
  worldStepEnabled: boolean;
  /** Whether Rapier's debug render lines are drawn. */
  visualizerEnabled: boolean;
  /** Gravity in m/s². */
  gravity: { x: number; y: number; z: number };
  /** The constraint solver's iterations per step (`WorldAPI.setNumSolverIterations`). */
  solverIterations: number;
  /** The internal PGS iterations per solver iteration (`WorldAPI.setNumInternalPgsIterations`). */
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
