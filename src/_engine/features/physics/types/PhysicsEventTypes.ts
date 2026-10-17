import type { PhysVector } from './PhysicsCommonTypes';

/**
 * Event occurring when the sum of the magnitudes of the
 * contact forces between two colliders exceed a threshold.
 *
 * This object should **not** be stored anywhere. Its properties can only be
 * read from within the closure given to `EventHandler.drainContactForceEvents`.
 */
// USED TO BE (@TODO: remove this line at some point): export declare class TempContactForceEvent {
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
   * Note that this is **not** the same as the magnitude of `self.total_force`.
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
  collider1Id: number;
  collider2Id: number;
  started: boolean;
};

/**
 * Serializable (structured-clone-safe) record of a single contact-force event,
 * used to cross the worker -> main thread boundary (EVENTS_PUSH).
 */
export type ContactForceEventRecord = {
  collider1Id: number;
  collider2Id: number;
  totalForce: PhysVector;
  totalForceMagnitude: number;
  maxForceDirection: PhysVector;
  maxForceMagnitude: number;
};

/**
 * Wraps an eagerly-read ContactForceEventRecord so it can be handed to a
 * contactForceEventFn with the same TempContactForceEvent shape Rapier's live
 * (drain-closure-only-valid) event has, on both MAIN_THREAD (wrapping the live
 * Rapier event's values immediately) and WORKER_THREAD (reconstructed from the
 * pushed record) code paths.
 */
export class ContactForceEventSnapshot implements TempContactForceEvent {
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
 * by the physics engine.
 *
 * To avoid leaking WASM resources, this MUST be freed manually with `eventQueue.free()`
 * once you are done using it.
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
   *            closure must take one `TempContactForceEvent` argument.
   */
  drainContactForceEvents(f: (event: TempContactForceEvent) => void): void;
  /**
   * Removes all events contained by this collector
   */
  clear(): void;
};

export enum SolverFlags {
  EMPTY = 0,
  COMPUTE_IMPULSE = 1,
}

export interface PhysicsHooks {
  /**
   * Function that determines if contacts computation should happen between two colliders, and how the
   * constraints solver should behave for these contacts.
   *
   * This will only be executed and taken into account if at least one of the involved colliders contains the
   * `ActiveHooks.FILTER_CONTACT_PAIR` flag in its active hooks.
   * @param collider1 − Handle of the first collider involved in the potential contact.
   * @param collider2 − Handle of the second collider involved in the potential contact.
   * @param body1 − Handle of the first body involved in the potential contact.
   * @param body2 − Handle of the second body involved in the potential contact.
   */
  filterContactPair(
    collider1: number,
    collider2: number,
    body1: number,
    body2: number
  ): SolverFlags | null;
  /**
   * Function that determines if intersection computation should happen between two colliders (where at least
   * one is a sensor).
   *
   * This will only be executed and taken into account if `one of the involved colliders contains the
   * `ActiveHooks.FILTER_INTERSECTION_PAIR` flag in its active hooks.
   * @param collider1 − Handle of the first collider involved in the potential contact.
   * @param collider2 − Handle of the second collider involved in the potential contact.
   * @param body1 − Handle of the first body involved in the potential contact.
   * @param body2 − Handle of the second body involved in the potential contact.
   */
  filterIntersectionPair(
    collider1: number,
    collider2: number,
    body1: number,
    body2: number
  ): boolean;
}
