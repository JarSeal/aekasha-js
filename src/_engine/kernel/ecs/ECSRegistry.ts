// NO OTHER LOCAL IMPORTS ALLOWED HERE

/**
 * Marks an entity as owned by a manager, which creates, drives and deletes it (only created in
 * code, never from JSON). Tools treat it as read-only: no persisted debug overrides, no editing
 * or deleting from the debugger, no undo entries.
 */
export type ManagedByData = {
  /** The manager's id, eg. 'SKYBOX'. */
  manager: string;
  /** The owner within that manager, eg. the sky box id. */
  ownerId: string;
  /** What the entity is for its owner, eg. 'SUN_0'. */
  role: string;
};

/**
 * An entity's `DEBUG_DATA` (`CoreEntityOpts.debugData`): what the debug tools show for it. Stored only
 * in the debug env and prod test mode.
 */
export type EntityDebugData = {
  /** A display name (the on-screen tools' camera names, the debug listings). */
  name?: string;
  /** A longer description. */
  description?: string;
  /** Notes with their times. */
  comments?: { timestamp: number; comment: string }[];
  /** Open items, by key. */
  todo?: { [key: string]: unknown };
  /** Anything else a debug tool keeps for the entity. */
  debugObj?: Record<string, unknown>;
};
