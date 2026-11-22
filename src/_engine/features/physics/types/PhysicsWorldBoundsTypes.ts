// The world bounds (p102): the region dynamic bodies must stay in, and the record of one that
// left it. Engine-agnostic: the backend reads the box, the main thread the records.

/**
 * An axis-aligned box in world space, in metres. Every side is optional: a missing side (or a
 * missing `min` / `max`) is open, so `{ min: { y: -50 } }` is a kill height alone.
 */
export type WorldBoundsBox = {
  /** The lower corner: a body whose translation is below it on an axis is outside. */
  min?: { x?: number; y?: number; z?: number };
  /** The upper corner: a body whose translation is above it on an axis is outside. */
  max?: { x?: number; y?: number; z?: number };
};

/**
 * What happens to a body's entity when the body leaves the world bounds. `'DELETE'`: the entity
 * is deleted (its body and colliders with it).
 */
export type WorldBoundsAction = 'DELETE';

/**
 * The world bounds of a scene, or the app's default (`AppConfig.physics.worldBounds`): dynamic
 * bodies whose translation leaves the box are disabled on the fixed step they left it on, and
 * their entities handled by `action`.
 */
export type WorldBoundsDef = WorldBoundsBox & {
  /** What happens to an exited body's entity. Default `'DELETE'`. */
  action?: WorldBoundsAction;
};

/**
 * Which bounds a body left: the global ones (a scene's or the app's default).
 * @internal
 */
export type OutOfBoundsSource = 'GLOBAL';

/**
 * A body found outside its bounds and disabled by the backend: plain data, from the backend (or
 * the worker's `EVENTS_PUSH`) to the main thread.
 * @internal
 */
export type OutOfBoundsRecord = {
  /** The body's running id. */
  bodyId: number;
  /** The steps the current world had run when the body was disabled, the exit step included: the
   * first snapshot that shows it disabled (`getPhysicsSnapshotStepIndex`). */
  step: number;
  /** The body's translation then. */
  x: number;
  y: number;
  z: number;
  /** Which bounds it left. */
  source: OutOfBoundsSource;
};
