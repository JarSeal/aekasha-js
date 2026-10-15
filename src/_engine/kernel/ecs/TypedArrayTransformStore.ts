import type * as THREE from 'three/webgpu';
import { Transform } from './ECSCoreComponents';
import type { IComponentStorage } from './ECSComponentStorage';

/** Float32 fields per entity: position(3) + quaternion(4) + scale(3). */
export const TRANSFORM_FIELD_COUNT = 10;

/**
 * Allocates the backing buffer for a TypedArrayTransformStore. A plain
 * `ArrayBuffer` today — kept as a factory so a future worker-based Physics
 * API can swap in a `SharedArrayBuffer` later without touching the store's
 * field layout. `useSAB` is never passed `true` yet (worker-thread physics
 * uses its own features/physics/PhysicsTransformBuffer.ts instead); `SharedArrayBuffer`
 * requires cross-origin isolation (COOP/COEP).
 */
export function createTransformBuffer(
  maxEntities: number,
  useSAB = false
): ArrayBuffer | SharedArrayBuffer {
  const byteLength = maxEntities * TRANSFORM_FIELD_COUNT * Float32Array.BYTES_PER_ELEMENT;
  return useSAB ? new SharedArrayBuffer(byteLength) : new ArrayBuffer(byteLength);
}

/**
 * TypedArray-backed sparse-set storage for the TRANSFORM component.
 *
 * Flat, contiguous `Float32Array`s indexed by a dense "slot" (not the
 * entity index, and not the packed entity id) replace the per-entity
 * Transform/Vector3/Quaternion object allocation used by Map-based storage.
 * Entity -> slot lookup goes through a sparse array indexed by the entity's
 * stable ECS index (`ECSWorld.getEntityIndex`); removal is an O(1)
 * swap-remove, so iteration order is not insertion order and reshuffles on
 * delete (see `getStorage()`'s doc comment in ECS.ts).
 *
 * Two access patterns:
 * - Hot path (per-frame systems): call `getSlot(entityId)` once, then use
 *   the slot with the other index-based methods or the public typed-array
 *   fields directly. Zero allocation.
 * - Cold path (`IComponentStorage` conformance — `get`/`entries`/etc.):
 *   builds a fresh, disconnected `Transform` (real `THREE.Vector3`/
 *   `Quaternion`) on every call. Mutating that returned object does NOT
 *   write back into this store — callers that fetch, mutate in place, and
 *   expect the change to persist must call `set()` again afterward (see
 *   `ECSWorld.commitTransform`).
 */
export class TypedArrayTransformStore implements IComponentStorage<Transform> {
  private readonly maxEntities: number;
  private readonly getEntityIndex: (entityId: number) => number;

  // Sparse set bookkeeping
  private readonly sparse: Int32Array; // sparse[entityIndex] -> dense slot, or -1
  private readonly denseEntityId: Int32Array; // denseEntityId[slot] -> packed entityId
  private readonly dirtyFlags: Uint8Array; // dirtyFlags[slot] -> 0 | 1
  private liveCount = 0;

  // Flat fields, indexed by dense slot, carved from one contiguous buffer
  /** Position x by slot (write through `setPosition` to mark the slot dirty). */
  public readonly posX: Float32Array;
  /** Position y by slot. */
  public readonly posY: Float32Array;
  /** Position z by slot. */
  public readonly posZ: Float32Array;
  /** Quaternion x by slot (write through `setQuaternion`). */
  public readonly quatX: Float32Array;
  /** Quaternion y by slot. */
  public readonly quatY: Float32Array;
  /** Quaternion z by slot. */
  public readonly quatZ: Float32Array;
  /** Quaternion w by slot. */
  public readonly quatW: Float32Array;
  /** Scale x by slot (write through `setScale`). */
  public readonly scaleX: Float32Array;
  /** Scale y by slot. */
  public readonly scaleY: Float32Array;
  /** Scale z by slot. */
  public readonly scaleZ: Float32Array;

  /**
   * A store for up to `maxEntities` transforms. `getEntityIndex` maps a packed entity id to its
   * slot index in the world (`ECSWorld.getEntityIndex`).
   */
  constructor(maxEntities: number, getEntityIndex: (entityId: number) => number, useSAB = false) {
    this.maxEntities = maxEntities;
    this.getEntityIndex = getEntityIndex;

    this.sparse = new Int32Array(maxEntities).fill(-1);
    this.denseEntityId = new Int32Array(maxEntities);
    this.dirtyFlags = new Uint8Array(maxEntities);

    const buffer = createTransformBuffer(maxEntities, useSAB);
    const bytesPerField = maxEntities * Float32Array.BYTES_PER_ELEMENT;
    this.posX = new Float32Array(buffer, 0 * bytesPerField, maxEntities);
    this.posY = new Float32Array(buffer, 1 * bytesPerField, maxEntities);
    this.posZ = new Float32Array(buffer, 2 * bytesPerField, maxEntities);
    this.quatX = new Float32Array(buffer, 3 * bytesPerField, maxEntities);
    this.quatY = new Float32Array(buffer, 4 * bytesPerField, maxEntities);
    this.quatZ = new Float32Array(buffer, 5 * bytesPerField, maxEntities);
    this.quatW = new Float32Array(buffer, 6 * bytesPerField, maxEntities);
    this.scaleX = new Float32Array(buffer, 7 * bytesPerField, maxEntities);
    this.scaleY = new Float32Array(buffer, 8 * bytesPerField, maxEntities);
    this.scaleZ = new Float32Array(buffer, 9 * bytesPerField, maxEntities);
  }

  /** Fixed capacity this store was allocated with. */
  get capacity(): number {
    return this.maxEntities;
  }

  /** Dense-slot lookup for `entityId`, or -1 if it has no Transform here. */
  getSlot(entityId: number): number {
    const slot = this.sparse[this.getEntityIndex(entityId)];
    return slot !== -1 && this.denseEntityId[slot] === entityId ? slot : -1;
  }

  /** Whether the slot changed since the Object3D sync last copied it. */
  isDirty(slot: number): boolean {
    return this.dirtyFlags[slot] === 1;
  }

  /** Marks the slot synced. */
  clearDirty(slot: number): void {
    this.dirtyFlags[slot] = 0;
  }

  /** Sets the slot's position and marks it dirty. */
  setPosition(slot: number, x: number, y: number, z: number): void {
    this.posX[slot] = x;
    this.posY[slot] = y;
    this.posZ[slot] = z;
    this.dirtyFlags[slot] = 1;
  }

  /** Sets the slot's rotation and marks it dirty. */
  setQuaternion(slot: number, x: number, y: number, z: number, w: number): void {
    this.quatX[slot] = x;
    this.quatY[slot] = y;
    this.quatZ[slot] = z;
    this.quatW[slot] = w;
    this.dirtyFlags[slot] = 1;
  }

  /** Sets the slot's scale and marks it dirty. */
  setScale(slot: number, x: number, y: number, z: number): void {
    this.scaleX[slot] = x;
    this.scaleY[slot] = y;
    this.scaleZ[slot] = z;
    this.dirtyFlags[slot] = 1;
  }

  /** Reads an Object3D's current quaternion back into this slot (e.g. after `Object3D.lookAt()` mutated it). */
  setQuaternionFromObject3D(slot: number, object3D: THREE.Object3D): void {
    this.setQuaternion(
      slot,
      object3D.quaternion.x,
      object3D.quaternion.y,
      object3D.quaternion.z,
      object3D.quaternion.w
    );
  }

  /** Writes position+quaternion+scale from this slot into an Object3D. */
  copyToObject3D(slot: number, object3D: THREE.Object3D): void {
    object3D.position.set(this.posX[slot], this.posY[slot], this.posZ[slot]);
    object3D.quaternion.set(this.quatX[slot], this.quatY[slot], this.quatZ[slot], this.quatW[slot]);
    object3D.scale.set(this.scaleX[slot], this.scaleY[slot], this.scaleZ[slot]);
  }

  private _materialize(slot: number): Transform {
    const transform = new Transform();
    transform.position.set(this.posX[slot], this.posY[slot], this.posZ[slot]);
    transform.quaternion.set(
      this.quatX[slot],
      this.quatY[slot],
      this.quatZ[slot],
      this.quatW[slot]
    );
    transform.scale.set(this.scaleX[slot], this.scaleY[slot], this.scaleZ[slot]);
    // Approximate: reflects only whether this slot is currently unsynced (0|1),
    // not a true monotonic counter like Map-mode's Transform.version.
    transform.version = this.dirtyFlags[slot];
    return transform;
  }

  // --- IComponentStorage<Transform> ---

  /** The entity's transform as a new `Transform` (a copy: changes need `set`), or undefined. */
  get(entityId: number): Transform | undefined {
    const slot = this.getSlot(entityId);
    return slot === -1 ? undefined : this._materialize(slot);
  }

  /** Stores `value`'s fields in the entity's slot (taking a new slot if it has none) and marks it dirty. */
  set(entityId: number, value: Transform): void {
    const entityIndex = this.getEntityIndex(entityId);
    let slot = this.sparse[entityIndex];
    if (slot === -1 || this.denseEntityId[slot] !== entityId) {
      if (this.liveCount >= this.maxEntities) {
        throw new Error(
          `TransformStore capacity (${this.maxEntities}) exceeded — raise CONFIG.ecs.maxEntities`
        );
      }
      slot = this.liveCount++;
      this.sparse[entityIndex] = slot;
      this.denseEntityId[slot] = entityId;
    }
    this.posX[slot] = value.position.x;
    this.posY[slot] = value.position.y;
    this.posZ[slot] = value.position.z;
    this.quatX[slot] = value.quaternion.x;
    this.quatY[slot] = value.quaternion.y;
    this.quatZ[slot] = value.quaternion.z;
    this.quatW[slot] = value.quaternion.w;
    this.scaleX[slot] = value.scale.x;
    this.scaleY[slot] = value.scale.y;
    this.scaleZ[slot] = value.scale.z;
    this.dirtyFlags[slot] = 1;
  }

  /** Frees the entity's slot, moving the last slot into it (the order changes). */
  delete(entityId: number): boolean {
    const entityIndex = this.getEntityIndex(entityId);
    const slot = this.sparse[entityIndex];
    if (slot === -1 || this.denseEntityId[slot] !== entityId) return false;

    const lastSlot = this.liveCount - 1;
    if (slot !== lastSlot) {
      // Swap-remove: move the last live slot's data into the removed slot.
      this.posX[slot] = this.posX[lastSlot];
      this.posY[slot] = this.posY[lastSlot];
      this.posZ[slot] = this.posZ[lastSlot];
      this.quatX[slot] = this.quatX[lastSlot];
      this.quatY[slot] = this.quatY[lastSlot];
      this.quatZ[slot] = this.quatZ[lastSlot];
      this.quatW[slot] = this.quatW[lastSlot];
      this.scaleX[slot] = this.scaleX[lastSlot];
      this.scaleY[slot] = this.scaleY[lastSlot];
      this.scaleZ[slot] = this.scaleZ[lastSlot];
      this.dirtyFlags[slot] = this.dirtyFlags[lastSlot];

      const movedEntityId = this.denseEntityId[lastSlot];
      this.denseEntityId[slot] = movedEntityId;
      this.sparse[this.getEntityIndex(movedEntityId)] = slot;
    }

    this.sparse[entityIndex] = -1;
    this.liveCount--;
    return true;
  }

  /** Whether the entity has a slot. */
  has(entityId: number): boolean {
    return this.getSlot(entityId) !== -1;
  }

  /** Frees every slot. */
  clear(): void {
    this.sparse.fill(-1);
    this.liveCount = 0;
  }

  /** How many slots are in use. */
  get size(): number {
    return this.liveCount;
  }

  /** The entity ids, in slot order. */
  *keys(): IterableIterator<number> {
    for (let slot = 0; slot < this.liveCount; slot++) {
      yield this.denseEntityId[slot];
    }
  }

  /** The entity ids with a new `Transform` copy each, in slot order. */
  *entries(): IterableIterator<[number, Transform]> {
    for (let slot = 0; slot < this.liveCount; slot++) {
      yield [this.denseEntityId[slot], this._materialize(slot)];
    }
  }

  /** Same as `entries()`. */
  [Symbol.iterator](): IterableIterator<[number, Transform]> {
    return this.entries();
  }
}
