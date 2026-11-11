// A batched group's geometry slots (docs/plans/p375_batched-mesh-batches.md, Phase 3 S1, D5): a
// batch whose geometries change (a decal pool's patches, members leaving with geometries no other
// member has) frees a geometry's slot when no instance uses it, and refills a free slot with a
// geometry that fits (`setGeometryAt`) before it adds one. three's own `deleteGeometry` +
// `addGeometry` reuses the id but appends the data (r187 never reuses a range: the spike's buffers
// filled up after 9 rounds), so a slot freed here stays active in three: no instance draws it, and
// only this module gives it a geometry again. A slot holding a member's LOD level stays until the
// next full build, as the member may swap to it. The group's `geometryReserve` sizes every slot at
// least that large, so a pool's slots are interchangeable. In MergeBatch.ts' lazy chunk.
import type * as THREE from 'three/webgpu';
import type { ECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import type { BatchState } from './MergeBatch';
import type { MergeGroupSettings } from './MergeTypes';

/**
 * A batch is made, and grows, with this share of room over what it holds.
 * @internal
 */
export const BATCH_RESERVE = 1.25;

/** `getGeometryRangeAt`'s target, reused. */
const range = {
  vertexStart: 0,
  vertexCount: 0,
  reservedVertexCount: 0,
  indexStart: 0,
  indexCount: 0,
  reservedIndexCount: 0,
  start: 0,
  count: 0,
};

/**
 * The vertices a geometry's slot reserves: its own, or the group's `geometryReserve` when larger.
 * @internal
 */
export const getReservedVertices = (settings: MergeGroupSettings, geometry: THREE.BufferGeometry) =>
  Math.max(geometry.getAttribute('position').count, settings.geometryReserve?.vertices ?? 0);

/**
 * The indices a geometry's slot reserves: its own, or the group's `geometryReserve` when larger; 0
 * without an index (a batch's geometries agree on it).
 * @internal
 */
export const getReservedIndices = (settings: MergeGroupSettings, geometry: THREE.BufferGeometry) =>
  geometry.index ? Math.max(geometry.index.count, settings.geometryReserve?.indices ?? 0) : 0;

/** Whether a slot's reserve holds `vertices` and `indices` (three's -1 for an unindexed batch). */
const fitsSlot = (state: BatchState, slot: number, vertices: number, indices: number) => {
  state.batch.getGeometryRangeAt(slot, range);
  return range.reservedVertexCount >= vertices && Math.max(range.reservedIndexCount, 0) >= indices;
};

/** Takes the free slot that fits best (the fewest reserved vertices), or -1 for none. */
const takeFreeSlot = (state: BatchState, vertices: number, indices: number) => {
  const { freeSlots } = state;
  let best = -1;
  let bestVertices = Infinity;
  for (let i = 0; i < freeSlots.length; i++) {
    if (!fitsSlot(state, freeSlots[i], vertices, indices)) continue;
    if (range.reservedVertexCount < bestVertices) {
      best = i;
      bestVertices = range.reservedVertexCount;
    }
  }
  if (best < 0) return -1;
  const slot = freeSlots[best];
  freeSlots[best] = freeSlots[freeSlots.length - 1];
  freeSlots.pop();
  return slot;
};

/** Gives `slot` to `geometry` in the batch's books (three holds its data already). */
const holdSlot = (state: BatchState, slot: number, geometry: THREE.BufferGeometry) => {
  state.slotGeometries[slot] = geometry;
  state.slotInstances[slot] ??= 0;
  state.slotIsLevel[slot] = false;
  state.geometryIds.set(geometry, slot);
};

/** Frees a slot no instance uses: the batch lets go of its geometry, and the next geometry that
 * fits takes it. */
const freeSlot = (state: BatchState, slot: number) => {
  const geometry = state.slotGeometries[slot];
  if (geometry) state.geometryIds.delete(geometry);
  state.slotGeometries[slot] = undefined;
  state.slotIsLevel[slot] = false;
  state.freeSlots.push(slot);
};

/**
 * Adds the geometries the batch doesn't hold yet: each into the free slot that fits it best, else
 * a new slot (its reserve the group's `geometryReserve` when larger), the buffers grown when full.
 * @internal
 */
export const addGeometries = (state: BatchState, geometries: Iterable<THREE.BufferGeometry>) => {
  const { batch, geometryIds } = state;
  const { settings } = state.group;
  const added = new Set<THREE.BufferGeometry>();
  let vertices = 0;
  let indices = 0;
  for (const geometry of geometries) {
    if (geometryIds.has(geometry) || added.has(geometry)) continue;
    const slotVertices = getReservedVertices(settings, geometry);
    const slotIndices = getReservedIndices(settings, geometry);
    const slot = takeFreeSlot(state, slotVertices, slotIndices);
    if (slot >= 0) {
      batch.setGeometryAt(slot, geometry);
      holdSlot(state, slot, geometry);
      continue;
    }
    added.add(geometry);
    vertices += slotVertices;
    indices += slotIndices;
  }
  if (added.size === 0) return;
  if (vertices > batch.unusedVertexCount || indices > batch.unusedIndexCount) {
    state.maxVertexCount = Math.ceil(
      (state.maxVertexCount - batch.unusedVertexCount + vertices) * BATCH_RESERVE
    );
    state.maxIndexCount = Math.max(
      Math.ceil((state.maxIndexCount - batch.unusedIndexCount + indices) * BATCH_RESERVE),
      1
    );
    batch.setGeometrySize(state.maxVertexCount, state.maxIndexCount);
  }
  for (const geometry of added) {
    const slot = batch.addGeometry(
      geometry,
      getReservedVertices(settings, geometry),
      geometry.index ? getReservedIndices(settings, geometry) : -1
    );
    holdSlot(state, slot, geometry);
  }
};

/**
 * Marks the slots of `members`' LOD levels: kept while no instance uses them, until the next full
 * build (a member may swap to one).
 * @internal
 */
export const markLevelSlots = (state: BatchState, members: readonly number[], world: ECSWorld) => {
  for (const entityId of members) {
    const levels = world.getComponent(entityId, ComponentType.LOD)?._levels;
    if (!levels) continue;
    for (let i = 0; i < levels.length; i++) {
      const slot = state.geometryIds.get(levels[i].geometry);
      if (slot !== undefined) state.slotIsLevel[slot] = true;
    }
  }
};

/**
 * Sets the geometry id an instance draws in the batch's books (-1: the instance was deleted): the
 * slots' instance counts follow, and a slot left with none is freed unless it's a LOD level. The
 * caller sets three's side (`addInstance`, `setGeometryIdAt`, `deleteInstance`).
 * @internal
 */
export const setInstanceSlot = (state: BatchState, instanceId: number, geometryId: number) => {
  const { geometryAt, slotInstances } = state;
  const previous = geometryAt[instanceId] ?? -1;
  if (previous === geometryId) return;
  geometryAt[instanceId] = geometryId;
  state.isOrderDirty = true;
  if (geometryId >= 0) slotInstances[geometryId]++;
  if (previous >= 0 && --slotInstances[previous] === 0 && !state.slotIsLevel[previous]) {
    freeSlot(state, previous);
  }
};

/**
 * Writes a held geometry's slot again from its data now (`updateMergeMember`), its bounds measured
 * again first (three keeps a copy of a geometry's own). A geometry past its slot's reserve moves to
 * a slot that fits, every instance of it with it, and its old slot is freed.
 * @internal
 * @returns its geometry id
 */
export const rewriteGeometry = (state: BatchState, geometry: THREE.BufferGeometry) => {
  const { batch, geometryAt } = state;
  const slot = state.geometryIds.get(geometry)!;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const indices = geometry.index?.count ?? 0;
  if (fitsSlot(state, slot, geometry.getAttribute('position').count, indices)) {
    batch.setGeometryAt(slot, geometry);
    return slot;
  }
  const isLevel = state.slotIsLevel[slot];
  const hadInstances = state.slotInstances[slot] > 0;
  // Out of the old slot, which goes with its last instance (or now, when none uses it)
  state.slotIsLevel[slot] = false;
  state.slotGeometries[slot] = undefined;
  state.geometryIds.delete(geometry);
  addGeometries(state, [geometry]);
  const next = state.geometryIds.get(geometry)!;
  state.slotIsLevel[next] = isLevel;
  for (let id = 0; id < geometryAt.length; id++) {
    if (geometryAt[id] !== slot) continue;
    batch.setGeometryIdAt(id, next);
    setInstanceSlot(state, id, next);
  }
  if (!hadInstances) freeSlot(state, slot);
  return next;
};
