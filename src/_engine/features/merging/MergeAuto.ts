// `merge: 'AUTO'`'s buckets (docs/plans/_DONE_p372_mesh-merge-groups.md §4.1): a mesh goes into the group
// of its compatibility key (its material, its attributes' names and sizes, both shadow flags, its
// layers, and whether it's persistent) and its x/z cell (`worldToCell` of its world position, the
// cells streaming uses, so a cell size that divides a streaming scene's keeps each group inside
// one streaming cell). A bucket whose group would pass `maxVertices` opens another in that cell.
// Ids are derived: `auto:<key hash>:<cx>,<cz>:<n>`. A mesh of a material in one of its `AUTO`
// palettes (p374 D4) is keyed by the palette in place of its material, so the palette's materials
// share its cell's group, drawn by the palette's merge material. A `BATCHED` mesh (p375) goes into
// its cell's `BATCHED` group (the mode is in the key), whose cap counts each geometry once: a
// batch holds a geometry once, whatever its instances.
import type * as THREE from 'three/webgpu';
import { IS_DEBUG_ENV } from '../../kernel/config/Config';
import type { ECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import { worldToCell } from '../../utils/CellKey';
import { lwarn } from '../../utils/Logger';
import { getMergeRefusal } from './MergeEligibility';
import { findPaletteMaterial, getMergeMaterialInfo, getPaletteIndex } from './MergePalettes';
import {
  getActiveSceneMergeSettings,
  warnIfCellSizeSplitsStreaming,
  warnPaletteNotRegistered,
} from './MergeSceneSettings';
import {
  createGroup,
  findQueued,
  getGroups,
  getMemberMesh,
  getQueued,
  holdForSceneLoad,
  noteMergeRefusal,
  syncMemberPose,
} from './MergeState';
import type { MergeGroupMode, MeshMergeDef } from './MergeTypes';

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

/** A bucket's open group (`n`) and the vertices that joined it so far (the members removed
 * since aren't taken off: a bucket opens its next group early rather than late). A `BATCHED`
 * bucket counts each geometry once (`geometries`, the open group's). */
type AutoBucket = { n: number; vertices: number; geometries?: Set<THREE.BufferGeometry> };

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
 * uuid; a palette member's palette in its place (`palette:<id>`).
 * @internal
 */
export const getAutoCompatibilityKey = (
  mesh: THREE.Mesh,
  isPersistent: boolean,
  paletteId?: string
) => {
  const material = mesh.material as THREE.Material;
  const { attributes } = mesh.geometry;
  const signature = Object.keys(attributes)
    .sort()
    .map((name) => `${name}:${attributes[name].itemSize}`)
    .join(',');
  return [
    paletteId !== undefined
      ? `palette:${paletteId}`
      : (material.userData.id as string | undefined) ?? material.uuid,
    signature,
    mesh.castShadow ? 1 : 0,
    mesh.receiveShadow ? 1 : 0,
    mesh.layers.mask,
    isPersistent ? 1 : 0,
  ].join('|');
};

/** The `AUTO` group a mesh joins: its id, whether it's a persistent one, and its palette. */
export type AutoGroupPick = {
  groupId: string;
  isPersistent: boolean;
  palette?: string;
  mode?: MergeGroupMode;
};

/** What bounds a mesh's `AUTO` group: its scene's defaults or its own `merge` options. */
export type AutoGroupBounds = {
  /** The group's mode (its own `merge`'s). Default `BAKED`. */
  mode?: MergeGroupMode;
  /** The cells' side, in metres. */
  cellSize: number;
  /** A group's vertex cap. */
  maxVertices: number;
  /** The palettes whose materials share a group, first match wins. */
  palettes: readonly string[];
};

/** The first of `palettes` that has the mesh's material (a registered member instance), if any.
 * One with no merge material registered warns once per scene and is skipped. */
const findMeshPalette = (material: THREE.Material, palettes: readonly string[]) => {
  for (const paletteId of palettes) {
    const info = getMergeMaterialInfo(findPaletteMaterial(paletteId));
    if (!info) warnPaletteNotRegistered(paletteId);
    else if (getPaletteIndex(info, material) !== -1) return paletteId;
  }
  return undefined;
};

/**
 * Picks the `AUTO` group a mesh entity joins, from its pose now (its `TRANSFORM`), and counts its
 * vertices into the bucket. Call it once per joining member, in a fixed order (the same groups on
 * every load). A persistent or a `BATCHED` mesh ignores the palettes (a palette group is its
 * scene's, and `BAKED`).
 * @internal
 */
export const pickAutoGroup = (
  entityId: number,
  bounds: AutoGroupBounds,
  world: ECSWorld
): AutoGroupPick => {
  const { cellSize, maxVertices, palettes } = bounds;
  const isBatched = bounds.mode === 'BATCHED';
  const mesh = getMemberMesh(entityId, world);
  syncMemberPose(entityId, mesh, world);
  const isPersistent = world.hasComponent(entityId, ComponentType.PERSISTENT);
  const palette =
    isPersistent || isBatched || palettes.length === 0
      ? undefined
      : findMeshPalette(mesh.material as THREE.Material, palettes);
  const { elements } = mesh.matrixWorld;
  const invCellSize = 1 / cellSize;
  const cx = worldToCell(elements[12], invCellSize);
  const cz = worldToCell(elements[14], invCellSize);
  // The cell size is in the key: two sizes' cells with the same coordinates are other places. A
  // BAKED key has no mode, so the ids of the groups made before p375 stay
  const hash = hashKey(
    `${getAutoCompatibilityKey(mesh, isPersistent, palette)}|${cellSize}${isBatched ? '|BATCHED' : ''}`
  );
  const bucketKey = `${hash}:${cx},${cz}`;
  const buckets = getBuckets(world);
  let bucket = buckets.get(bucketKey);
  if (!bucket) buckets.set(bucketKey, (bucket = { n: 0, vertices: 0 }));

  const { geometry } = mesh;
  if (isBatched) bucket.geometries ??= new Set();
  const groups = getGroups(world);
  const idOf = (n: number) => `${AUTO_ID_PREFIX}${bucketKey}:${n}`;
  if (!groups.has(idOf(bucket.n))) {
    // Its open group was deleted (its scene left, a dissolve, its last member gone): back to the
    // first id after the full groups still alive, so a scene's next load gets the same ids
    while (bucket.n > 0 && !groups.has(idOf(bucket.n - 1))) bucket.n--;
    bucket.vertices = 0;
    bucket.geometries?.clear();
  }
  // A batch's open group holds this geometry already: it adds no vertices
  const vertices = bucket.geometries?.has(geometry) ? 0 : geometry.getAttribute('position').count;
  if (vertices > 0 && bucket.vertices > 0 && bucket.vertices + vertices > maxVertices) {
    bucket.n++;
    bucket.vertices = 0;
    bucket.geometries?.clear();
  }
  bucket.vertices += vertices;
  bucket.geometries?.add(geometry);
  return {
    groupId: idOf(bucket.n),
    isPersistent,
    ...(palette ? { palette } : {}),
    ...(isBatched ? { mode: bounds.mode } : {}),
  };
};

/** `createPhysicsEntity` tags the entity at once and adds its colliders (`COLLIDER`, with its
 * `BODY_*`) when the body exists; a failed creation takes the tag off. */
const isPhysicsCreationPending = (entityId: number, world: ECSWorld) =>
  world.hasComponent(entityId, ComponentType.TAG_IS_PHYSICS_OBJECT) &&
  !world.hasComponent(entityId, ComponentType.COLLIDER);

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
  const isPaletteList = (value: unknown) =>
    value === undefined ||
    (Array.isArray(value) && value.every((id) => typeof id === 'string' && id !== ''));
  const isMode = (value: unknown) =>
    value === undefined || value === 'BAKED' || value === 'BATCHED';
  const isValid =
    typeof groupId === 'string' &&
    groupId !== '' &&
    (groupId === AUTO || !groupId.startsWith(AUTO_ID_PREFIX)) &&
    (typeof def === 'string' ||
      (isPositive(def.cellSize) &&
        isPositive(def.maxVertices) &&
        isPaletteList(def.palettes) &&
        isMode(def.mode)));
  if (!isValid) {
    lwarn(
      `Entity ${entityId}'s merge ${JSON.stringify(def)} is invalid (a group id, 'AUTO', or { group?, mode?, cellSize?, maxVertices?, palettes? } with mode BAKED or BATCHED, sizes over 0 and palette ids; 'auto:' ids are reserved): it's drawn on its own.`
    );
    if (IS_DEBUG_ENV) {
      noteMergeRefusal(world, entityId, String(groupId), `invalid merge ${JSON.stringify(def)}`);
    }
    return;
  }
  getQueued(world).set(entityId, def);
  holdForSceneLoad(entityId, world);
};

/** The queued `merge`s' joins: the entities by group id, and the mode each one's `merge` names
 * (only those that name one), which a group of the other mode refuses. */
export type QueuedJoins = {
  joins: Map<string, number[]>;
  modes: Map<number, MergeGroupMode>;
};

/**
 * Empties the world's queued `merge`s into the groups they join, by group id (in creation order,
 * so `AUTO` picks the same groups on every load), creating the `AUTO` groups they open. An entity
 * deleted meanwhile is dropped, and a refused `AUTO` one warns. One whose physics body is still
 * being created stays queued for the next call. Undefined when none is queued.
 * @internal
 */
export const collectQueuedJoins = (world: ECSWorld): QueuedJoins | undefined => {
  const queued = findQueued(world);
  if (!queued?.size) return undefined;
  const settings = getActiveSceneMergeSettings();
  const joins = new Map<string, number[]>();
  const modes = new Map<number, MergeGroupMode>();
  const join = (groupId: string, entityId: number) => {
    const ids = joins.get(groupId);
    if (ids) ids.push(entityId);
    else joins.set(groupId, [entityId]);
  };
  for (const [entityId, def] of queued) {
    // Its body is being created (createPhysicsEntity awaits it): it waits, so the refusals see
    // what the body is
    if (isPhysicsCreationPending(entityId, world)) continue;
    queued.delete(entityId);
    if (!world.isAlive(entityId)) continue;
    const groupId = typeof def === 'string' ? def : def.group ?? AUTO;
    const mode = typeof def === 'string' ? undefined : def.mode;
    if (mode) modes.set(entityId, mode);
    if (groupId !== AUTO) {
      join(groupId, entityId);
      continue;
    }
    const refusal = getMergeRefusal(entityId, world, undefined, mode);
    if (refusal) {
      lwarn(`merge 'AUTO': entity ${entityId} is drawn on its own: ${refusal}.`);
      if (IS_DEBUG_ENV) noteMergeRefusal(world, entityId, AUTO, refusal);
      continue;
    }
    const options = typeof def === 'string' ? undefined : def;
    const cellSize = options?.cellSize ?? settings.autoCellSize;
    warnIfCellSizeSplitsStreaming(settings, cellSize);
    const pick = pickAutoGroup(
      entityId,
      {
        mode,
        cellSize,
        maxVertices: options?.maxVertices ?? settings.autoMaxVertices,
        palettes: options?.palettes ?? settings.autoPalettes,
      },
      world
    );
    if (!getGroups(world).has(pick.groupId)) {
      const { groupId: id, isPersistent, palette } = pick;
      const groupSettings = {
        id,
        persistent: isPersistent || undefined,
        ...(palette && { palette }),
        ...(pick.mode && { mode: pick.mode }),
      };
      createGroup(groupSettings, world, true);
    }
    join(pick.groupId, entityId);
  }
  return { joins, modes };
};
