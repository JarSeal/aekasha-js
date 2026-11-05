import type { PhysVector } from './PhysicsCommonTypes';

/**
 * A contact-force event, handed to a collider's `contactForceEventFn` when the sum of the contact
 * forces' magnitudes between two colliders passes the collider's threshold.
 *
 * Shaped like Rapier's event, whose values are valid only inside its drain closure, but both
 * worker targets hand the callback a copy read from it (`ContactForceEventSnapshot`), so it can be
 * kept.
 */
export interface TempContactForceEvent {
  /**
   * The first collider handle involved in the contact.
   */
  collider1(): number;
  /**
   * The second collider handle involved in the contact.
   */
  collider2(): number;
  /**
   * The sum of all the forces between the two colliders.
   */
  totalForce(): PhysVector;
  /**
   * The sum of the magnitudes of each force between the two colliders.
   *
   * Note that this is **not** the same as the magnitude of `totalForce()`.
   * Here we are summing the magnitude of all the forces, instead of taking
   * the magnitude of their sum.
   */
  totalForceMagnitude(): number;
  /**
   * The world-space (unit) direction of the force with strongest magnitude.
   */
  maxForceDirection(): PhysVector;
  /**
   * The magnitude of the largest force at a contact point of this contact pair.
   */
  maxForceMagnitude(): number;
}

/**
 * Serializable (structured-clone-safe) record of a single collision event,
 * used to cross the worker -> main thread boundary (EVENTS_PUSH).
 */
export type CollisionEventRecord = {
  /** The first collider's id. */
  collider1Id: number;
  /** The second collider's id. */
  collider2Id: number;
  /** True when the contact started, false when it stopped. */
  started: boolean;
};

/**
 * Serializable (structured-clone-safe) record of a single contact-force event,
 * used to cross the worker -> main thread boundary (EVENTS_PUSH).
 */
export type ContactForceEventRecord = {
  /** The first collider's id. */
  collider1Id: number;
  /** The second collider's id. */
  collider2Id: number;
  /** As {@link TempContactForceEvent.totalForce}. */
  totalForce: PhysVector;
  /** As {@link TempContactForceEvent.totalForceMagnitude}. */
  totalForceMagnitude: number;
  /** As {@link TempContactForceEvent.maxForceDirection}. */
  maxForceDirection: PhysVector;
  /** As {@link TempContactForceEvent.maxForceMagnitude}. */
  maxForceMagnitude: number;
};

/**
 * Wraps an eagerly-read ContactForceEventRecord so it can be handed to a
 * contactForceEventFn with the same TempContactForceEvent shape Rapier's live
 * (drain-closure-only-valid) event has, on both MAIN_THREAD (wrapping the live
 * Rapier event's values immediately) and WORKER_THREAD (reconstructed from the
 * pushed record) code paths. The backends' and the facade's, not an app's.
 * @internal
 */
export class ContactForceEventSnapshot implements TempContactForceEvent {
  /** Wraps `record`, which it keeps (not a copy). */
  constructor(private record: ContactForceEventRecord) {}
  collider1(): number {
    return this.record.collider1Id;
  }
  collider2(): number {
    return this.record.collider2Id;
  }
  totalForce(): PhysVector {
    return this.record.totalForce;
  }
  totalForceMagnitude(): number {
    return this.record.totalForceMagnitude;
  }
  maxForceDirection(): PhysVector {
    return this.record.maxForceDirection;
  }
  maxForceMagnitude(): number {
    return this.record.maxForceMagnitude;
  }
}

/**
 * A structure responsible for collecting events generated
 * by the physics engine (Rapier's `EventQueue`, its shape mirrored here).
 *
 * To avoid leaking WASM resources, this MUST be freed manually with `eventQueue.free()`
 * once you are done using it.
 * @remarks `WorldAPI.step` takes one, but the Rapier backend ignores it: it collects the
 * events in its own queue and delivers them to the colliders' callbacks.
 */
export type EventQueue = {
  /**
   * Release the WASM memory occupied by this event-queue.
   */
  free(): void;
  /**
   * Applies the given javascript closure on each collision event of this collector, then clear
   * the internal collision event buffer.
   * @param f JavaScript closure applied to each collision event. The
   * closure must take three arguments: two integers representing the handles of the colliders
   * involved in the collision, and a boolean indicating if the collision started (true) or stopped
   * (false).
   */
  drainCollisionEvents(f: (handle1: number, handle2: number, started: boolean) => void): void;
  /**
   * Applies the given javascript closure on each contact force event of this collector, then clear
   * the internal collision event buffer.
   * @param f JavaScript closure applied to each collision event. The
   *   closure must take one `TempContactForceEvent` argument.
   */
  drainContactForceEvents(f: (event: TempContactForceEvent) => void): void;
  /**
   * Removes all events contained by this collector
   */
  clear(): void;
};
