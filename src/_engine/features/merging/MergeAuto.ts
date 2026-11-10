// `merge: 'AUTO'`'s buckets (docs/plans/p372_mesh-merge-groups.md §4.1): a mesh goes into the group
// of its compatibility key (its material, its attributes' names and sizes, both shadow flags, its
// layers, and whether it's persistent) and its x/z cell (`worldToCell` of its world position, the
// cells streaming uses, so a cell size that divides a streaming scene's keeps each group inside
// one streaming cell). A bucket whose group would pass `maxVertices` opens another in that cell.
// Ids are derived: `auto:<key hash>:<cx>,<cz>:<n>`.
import type * as THREE from 'three/webgpu';
import type { ECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import { worldToCell } from '../../utils/CellKey';
import { lwarn } from '../../utils/Logger';
import { getMergeRefusal } from './MergeEligibility';
import {
  createGroup,
  findQueued,
  getGroups,
  getMemberMesh,
  getQueued,
  syncMemberPose,
} from './MergeState';
import type { MeshMergeDef } from './MergeTypes';

/**
 * The group id that means "the engine picks": `merge: 'AUTO'`, `addToMergeGroup('AUTO', …)`.
 * @internal
 */
export const AUTO = 'AUTO';

/**
 * The prefix of the `AUTO` groups' derived ids, reserved.
 * @internal
 */
export const AUTO_ID_PREFIX = 'auto:';

/**
 * `AUTO`'s default cell size, in metres (§4.1).
 * @internal
 */
export const DEFAULT_AUTO_CELL_SIZE = 32;

/**
 * `AUTO`'s default vertex cap per group (§4.1).
 * @internal
 */
export const DEFAULT_AUTO_MAX_VERTICES = 262_144;

/** A bucket's open group (`n`) and the vertices that joined it so far (the members removed
 * since aren't taken off: a bucket opens its next group early rather than late). */
type AutoBucket = { n: number; vertices: number };

const bucketsByWorld = new WeakMap<ECSWorld, Map<string, AutoBucket>>();

const getBuckets = (world: ECSWorld) => {
  let buckets = bucketsByWorld.get(world);
  if (!buckets) bucketsByWorld.set(world, (buckets = new Map()));
  return buckets;
};

/** FNV-1a, 32 bits, in base 36: a short id for a compatibility key. */
const hashKey = (key: string) => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
};

/**
 * A mesh's `AUTO` compatibility key: what its group's members must share. The material by its
 * registered id (the same instance: a clone carrying the id is refused by the group), else its
 * uuid.
 * @internal
 */
export const getAutoCompatibilityKey = (mesh: THREE.Mesh, isPersistent: boolean) => {
  const material = mesh.material as THREE.Material;
  const { attributes } = mesh.geometry;
  const signature = Object.keys(attributes)
    .sort()
    .map((name) => `${name}:${attributes[name].itemSize}`)
    .join(',');
  return [
    (material.userData.id as string | undefined) ?? material.uuid,
    signature,
    mesh.castShadow ? 1 : 0,
    mesh.receiveShadow ? 1 : 0,
    mesh.layers.mask,
    isPersistent ? 1 : 0,
  ].join('|');
};

/** The `AUTO` group a mesh joins: its id, and whether it's a persistent one. */
export type AutoGroupPick = { groupId: string; isPersistent: boolean };

/**
 * Picks the `AUTO` group a mesh entity joins, from its pose now (its `TRANSFORM`), and counts its
 * vertices into the bucket. Call it once per joining member, in a fixed order (the same groups on
 * every load).
 * @internal
 */
export const pickAutoGroup = (
  entityId: number,
  cellSize: number,
  maxVertices: number,
  world: ECSWorld
): AutoGroupPick => {
  const mesh = getMemberMesh(entityId, world);
  syncMemberPose(entityId, mesh, world);
  const isPersistent = world.hasComponent(entityId, ComponentType.PERSISTENT);
  const { elements } = mesh.matrixWorld;
  const invCellSize = 1 / cellSize;
  const cx = worldToCell(elements[12], invCellSize);
  const cz = worldToCell(elements[14], invCellSize);
  // The cell size is in the key: two sizes' cells with the same coordinates are other places
  const hash = hashKey(`${getAutoCompatibilityKey(mesh, isPersistent)}|${cellSize}`);
  const bucketKey = `${hash}:${cx},${cz}`;
  const buckets = getBuckets(world);
  let bucket = buckets.get(bucketKey);
  if (!bucket) buckets.set(bucketKey, (bucket = { n: 0, vertices: 0 }));

  const vertices = mesh.geometry.getAttribute('position').count;
  const groups = getGroups(world);
  const idOf = (n: number) => `${AUTO_ID_PREFIX}${bucketKey}:${n}`;
  if (!groups.has(idOf(bucket.n))) {
    // Its open group was deleted (its scene left, a dissolve, its last member gone): back to the
    // first id after the full groups still alive, so a scene's next load gets the same ids
    while (bucket.n > 0 && !groups.has(idOf(bucket.n - 1))) bucket.n--;
    bucket.vertices = 0;
  } else if (bucket.vertices > 0 && bucket.vertices + vertices > maxVertices) {
    bucket.n++;
    bucket.vertices = 0;
  }
  bucket.vertices += vertices;
  return { groupId: idOf(bucket.n), isPersistent };
};

/**
 * Queues a mesh's `merge` for the next build (the kernel's mesh merge handler,
 * `setMeshMergeHandler`): an invalid one warns and is dropped. A later one for the same entity
 * replaces it.
 * @internal
 */
export const queueMerge = (entityId: number, def: MeshMergeDef, world: ECSWorld) => {
  const groupId = typeof def === 'string' ? def : def.group ?? AUTO;
  const isPositive = (value: number | undefined) =>
    value === undefined || (Number.isFinite(value) && value > 0);
  const isValid =
    typeof groupId === 'string' &&
    groupId !== '' &&
    (groupId === AUTO || !groupId.startsWith(AUTO_ID_PREFIX)) &&
    (typeof def === 'string' || (isPositive(def.cellSize) && isPositive(def.maxVertices)));
  if (!isValid) {
    lwarn(
      `Entity ${entityId}'s merge ${JSON.stringify(def)} is invalid (a group id, 'AUTO', or { group?, cellSize?, maxVertices? } with sizes over 0; 'auto:' ids are reserved): it's drawn on its own.`
    );
    return;
  }
  getQueued(world).set(entityId, def);
};

/**
 * Empties the world's queued `merge`s into the groups they join, by group id (in creation order,
 * so `AUTO` picks the same groups on every load), creating the `AUTO` groups they open. An entity
 * deleted meanwhile is dropped, and a refused `AUTO` one warns. Undefined when none is queued.
 * @internal
 */
export const collectQueuedJoins = (world: ECSWorld) => {
  const queued = findQueued(world);
  if (!queued?.size) return undefined;
  const joins = new Map<string, number[]>();
  const join = (groupId: string, entityId: number) => {
    const ids = joins.get(groupId);
    if (ids) ids.push(entityId);
    else joins.set(groupId, [entityId]);
  };
  for (const [entityId, def] of queued) {
    if (!world.isAlive(entityId)) continue;
    const groupId = typeof def === 'string' ? def : def.group ?? AUTO;
    if (groupId !== AUTO) {
      join(groupId, entityId);
      continue;
    }
    const refusal = getMergeRefusal(entityId, world);
    if (refusal) {
      lwarn(`merge 'AUTO': entity ${entityId} is drawn on its own: ${refusal}.`);
      continue;
    }
    const options = typeof def === 'string' ? undefined : def;
    const pick = pickAutoGroup(
      entityId,
      options?.cellSize ?? DEFAULT_AUTO_CELL_SIZE,
      options?.maxVertices ?? DEFAULT_AUTO_MAX_VERTICES,
      world
    );
    if (!getGroups(world).has(pick.groupId)) {
      createGroup({ id: pick.groupId, persistent: pick.isPersistent || undefined }, world, true);
    }
    join(pick.groupId, entityId);
  }
  queued.clear();
  return joins;
};
