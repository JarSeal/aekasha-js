// The world bounds (p102): the region dynamic bodies must stay in, and the record of one that
// left it. Engine-agnostic: the backend reads the box, the main thread the records and the actions.

import type { ECSWorld } from '../../../kernel/ecs/ECS';

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
 * What happens to a body's entity when the body leaves the world bounds. The body is out of the
 * simulation either way from the step it left on (disabled, or made `FIXED` when it has joints).
 *
 * - `'DELETE'`: the entity is deleted, its body and colliders with it.
 * - `'DISABLE'`: the entity stays, disabled (`world.setDisabled`: its `OBJECT3D` hidden, its body
 *   kept disabled through physics tier changes). `world.setDisabled(id, false)` brings it back;
 *   move its body inside first, or the next step's check takes it out again.
 * - `'CALLBACK'`: `onExit` is called; the entity stays, as it is, and its body out of the
 *   simulation until the callback (or later code) puts it back (eg. at a checkpoint).
 */
export type WorldBoundsAction = 'DELETE' | 'DISABLE' | 'CALLBACK';

/**
 * A body's exit from the world bounds, as `onExit` gets it (the `'CALLBACK'` action).
 */
export type WorldBoundsExitEvent = {
  /** The body's entity. */
  entityId: number;
  /** The entity's ECS world. */
  world: ECSWorld;
  /** The body's id. */
  bodyId: number;
  /** The steps the physics world had run when the body was taken out, the exit step included
   * (`getPhysicsSnapshotStepIndex`'s scale). */
  step: number;
  /** The body's translation then. */
  position: { x: number; y: number; z: number };
  /** Which bounds it left: the scene's (or the app's default), or the entity's own. */
  source: 'GLOBAL' | 'ENTITY';
  /** True when the body was made `FIXED` (it has joints: Rapier mishandles the joints of a disabled
   * body), false when it was disabled. Put it back with `setBodyType` to `Dynamic` or
   * `setEnabled(true)` respectively, after moving it inside. */
  frozen: boolean;
};

/**
 * What an exit calls with the `'CALLBACK'` action, on the main thread at the start of the
 * sub-step after the exit reaches it (when collision callbacks run).
 */
export type WorldBoundsExitCallback = (event: WorldBoundsExitEvent) => void;

/**
 * The world bounds of a scene, or the app's default (`AppConfig.physics.worldBounds`): dynamic
 * bodies whose translation leaves the box are disabled on the fixed step they left it on, and
 * their entities handled by `action`.
 */
export type WorldBoundsDef = WorldBoundsBox & {
  /** What happens to an exited body's entity, unless the entity has its own `action`. Default
   * `'DELETE'`. */
  action?: WorldBoundsAction;
  /** Called for each exit when `action` is `'CALLBACK'` (without it, `'CALLBACK'` acts as
   * `'DISABLE'`, with a debug-env warning). Main thread only: it never reaches the backend. */
  onExit?: WorldBoundsExitCallback;
};

/**
 * One physics entity's own world bounds (`setEntityWorldBounds`, `createPhysicsEntity`'s
 * `worldBounds` option). With any side given, its box replaces the scene's for this entity (it
 * isn't intersected with it), so a side it leaves out is open even where the scene's box has one.
 * Without one (no `min`, no `max`, or only empty ones), the scene's box applies and only the
 * `action` is the entity's.
 */
export type EntityWorldBounds = WorldBoundsBox & {
  /** Exempts the entity from every world bounds (eg. a player whose own respawn logic catches a
   * fall). The box and the action are then not read. */
  ignore?: boolean;
  /** What happens to the entity when its body exits, instead of the scene's `action`. */
  action?: WorldBoundsAction;
  /** Called for each exit when `action` is `'CALLBACK'` (without it, `'CALLBACK'` acts as
   * `'DISABLE'`, with a debug-env warning). Main thread only: it never reaches the backend. */
  onExit?: WorldBoundsExitCallback;
};

/**
 * One exit from the world bounds as `getWorldBoundsStats` lists it, read when it was handled.
 */
export type WorldBoundsExitInfo = {
  /** The body's entity then, or null for a body without a physics entity (made through the bare
   * Physics API, or its entity deleted before the exit was handled). With `'DELETE'` it no longer
   * exists. */
  entityId: number | null;
  /** The entity's ECS world, or null without an entity. */
  world: ECSWorld | null;
  /** The entity's stable app id, else its object's name, else `entity <id>` (`body <id>` without
   * an entity). */
  name: string;
  /** The body's id. */
  bodyId: number;
  /** The steps the physics world had run when the body was taken out, the exit step included. */
  step: number;
  /** The body's translation then. */
  position: { x: number; y: number; z: number };
  /** Which bounds it left: the scene's (or the app's default), or the entity's own. */
  source: 'GLOBAL' | 'ENTITY';
  /** What was done to the entity (a `'CALLBACK'` without `onExit` is `'DISABLE'`), or null without
   * an entity. */
  action: WorldBoundsAction | null;
  /** True when the body was made `FIXED` (it has joints), false when it was disabled. */
  frozen: boolean;
};

/**
 * Where the current world's bounds come from: the scene's own (`setSceneWorldBounds`; with a null
 * `def` the scene turned them off), the app's default (`AppConfig.physics.worldBounds`), or none.
 */
export type WorldBoundsSource = 'SCENE' | 'CONFIG' | 'NONE';

/**
 * The current scene's world bounds and their exits, as `getWorldBoundsStats` reads them.
 */
export type WorldBoundsStats = {
  /** The definition the current world uses (its box, action and onExit), or null for none. */
  def: Readonly<WorldBoundsDef> | null;
  /** Where `def` comes from. */
  source: WorldBoundsSource;
  /** The exits handled since the scene's world was made, a body without an entity included. */
  exitCount: number;
  /** The latest exits (at most the last 20), oldest first. */
  recentExits: readonly WorldBoundsExitInfo[];
};

/**
 * A body's own bounds as the backend takes them: a box, or `'IGNORE'` (never checked; a box open
 * on every side is the same). Plain data.
 * @internal
 */
export type BodyWorldBounds = WorldBoundsBox | 'IGNORE';

/**
 * Which bounds a body left: the global ones (a scene's or the app's default), or its entity's own
 * (`EntityWorldBounds`).
 * @internal
 */
export type OutOfBoundsSource = 'GLOBAL' | 'ENTITY';

/**
 * A body found outside its bounds and taken out of the simulation by the backend: plain data, from the backend (or
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
  /** True when the body was made FIXED (it has joints), false when it was disabled. */
  frozen: boolean;
};
