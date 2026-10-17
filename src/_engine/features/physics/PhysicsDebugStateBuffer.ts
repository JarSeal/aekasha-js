/**
 * Per-step live-state mirror for the physics debug wireframes.
 *
 * The wireframe colors depend on simulation state (sleeping / kinematic / enabled /
 * sensor), which in WORKER_THREAD mode is only reachable through async RPC —
 * RigidBodyProxyAPI.isSleepingSync() and friends throw there on purpose. Polling that
 * per visualized entity per frame would reintroduce exactly the per-object round trip
 * the Physics API exists to avoid, so state travels the same way transforms already do:
 * a flat typed array, either a real SharedArrayBuffer or one batched Transferable push
 * per step (see PhysicsTransformBuffer.ts for the same SAB/fallback split).
 *
 * Two things make it cheaper than the transform buffer:
 *
 * 1. It is allocated lazily. Nothing exists, and the worker writes nothing, until the
 *    first wireframe is switched on — so the always-on cost of the whole feature is zero.
 * 2. It tracks an explicit set of ids, not the whole world. The main thread sends the
 *    exact rigid bodies/colliders it is visualizing and their *array position is their
 *    slot*, so neither side needs a slot allocator and per-step cost scales with how
 *    many wireframes the user turned on, not with world size.
 *
 * MAIN_THREAD mode never uses this — the *Sync state getters are already free there.
 */

/**
 * Uint32 bitflags describing one tracked rigid body.
 * @internal
 */
export const DebugBodyFlag = {
  /** Slot holds a body that still resolved this step. Clear = read nothing else here. */
  VALID: 1 << 0,
  /** The body is asleep. */
  SLEEPING: 1 << 1,
  /** The body is enabled (a DISABLED physics tier, or `setEnabled(false)`, clears it). */
  ENABLED: 1 << 2,
  /** The body is kinematic (position or velocity based). */
  KINEMATIC: 1 << 3,
  /** The body is FIXED (also a body in the STATIC physics tier). */
  FIXED: 1 << 4,
} as const;

/**
 * Uint32 bitflags describing one tracked collider.
 * @internal
 */
export const DebugColliderFlag = {
  /** Slot holds a collider that still resolved this step. */
  VALID: 1 << 0,
  /** The collider is enabled. */
  ENABLED: 1 << 1,
  /** The collider is a sensor. */
  SENSOR: 1 << 2,
} as const;

/**
 * One Uint32 per body slot + one per collider slot, both capped at maxSlots.
 * @internal
 */
export const createPhysicsDebugStateArrayBuffer = (
  maxSlots: number,
  useSAB = false
): ArrayBuffer | SharedArrayBuffer => {
  const byteLength = maxSlots * 2 * Uint32Array.BYTES_PER_ELEMENT;
  return useSAB ? new SharedArrayBuffer(byteLength) : new ArrayBuffer(byteLength);
};

/**
 * Wrapper over the flat debug-state array. Layout is two fixed-capacity regions:
 * `[0 .. maxSlots)` = body flags, `[maxSlots .. maxSlots * 2)` = collider flags.
 *
 * A "slot" here is simply an index into the id arrays the main thread last sent via
 * SET_DEBUG_STATE_TRACKING, which is why there is no allocate/free pair — both sides
 * derive the same mapping from that one message.
 * @internal
 */
export class PhysicsDebugStateBuffer {
  /** The capacity of each region (bodies, colliders). */
  readonly maxSlots: number;
  /** The backing buffer: shared (SHARED_MEMORY) or the side's own (pushed per step). */
  readonly buffer: ArrayBuffer | SharedArrayBuffer;
  /** The flags, bodies' region first, then the colliders'. */
  readonly flags: Uint32Array;

  /**
   * Wraps `buffer` (made by createPhysicsDebugStateArrayBuffer with the same `maxSlots`), or
   * allocates a plain one.
   * @param maxSlots the capacity of each region
   * @param buffer the buffer to wrap; a new non-shared one when left out
   */
  constructor(maxSlots: number, buffer?: ArrayBuffer | SharedArrayBuffer) {
    this.maxSlots = maxSlots;
    this.buffer = buffer ?? createPhysicsDebugStateArrayBuffer(maxSlots, false);
    this.flags = new Uint32Array(this.buffer);
  }

  /** Writes a body slot's DebugBodyFlag bits; a slot out of range is ignored. */
  setBodyFlags(slot: number, flags: number): void {
    if (slot < 0 || slot >= this.maxSlots) return;
    this.flags[slot] = flags;
  }

  /** A body slot's DebugBodyFlag bits, 0 (not VALID) out of range. */
  getBodyFlags(slot: number): number {
    if (slot < 0 || slot >= this.maxSlots) return 0;
    return this.flags[slot];
  }

  /** Writes a collider slot's DebugColliderFlag bits; a slot out of range is ignored. */
  setColliderFlags(slot: number, flags: number): void {
    if (slot < 0 || slot >= this.maxSlots) return;
    this.flags[this.maxSlots + slot] = flags;
  }

  /** A collider slot's DebugColliderFlag bits, 0 (not VALID) out of range. */
  getColliderFlags(slot: number): number {
    if (slot < 0 || slot >= this.maxSlots) return 0;
    return this.flags[this.maxSlots + slot];
  }

  /** Zeroes every slot, so stale flags can't outlive a tracking-set change. */
  clear(): void {
    this.flags.fill(0);
  }
}
