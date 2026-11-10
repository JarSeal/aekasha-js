// The merge groups' shared state and helpers (docs/plans/p372_mesh-merge-groups.md): the groups and
// pending builds per world, and a member's mesh and pose. MergeGroups.ts (the API and the builds)
// and MergeInPlace.ts (the in-place range updates) both use them.
import type * as THREE from 'three/webgpu';
import type { ECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import { getCurrentSceneId, getLoadingSceneId } from '../../kernel/scene/Scene';
import type { MergedGeometry } from '../../kernel/assets/GeometryMergeCore';
import type { MergeGroupData, MergeGroupSettings, MeshMergeDef } from './MergeTypes';

/** Per world: the group entities by group id, the groups waiting for a build, and the meshes
 * whose `merge` waits for the next build to join. */
const groupsByWorld = new WeakMap<ECSWorld, Map<string, number>>();
const pendingByWorld = new WeakMap<ECSWorld, Set<number>>();
const queuedByWorld = new WeakMap<ECSWorld, Map<number, MeshMergeDef>>();

/**
 * The world's group entities by group id (made on first use).
 * @internal
 */
export const getGroups = (world: ECSWorld) => {
  let groups = groupsByWorld.get(world);
  if (!groups) groupsByWorld.set(world, (groups = new Map()));
  return groups;
};

/**
 * The world's groups waiting for a build (made on first use).
 * @internal
 */
export const getPending = (world: ECSWorld) => {
  let pending = pendingByWorld.get(world);
  if (!pending) pendingByWorld.set(world, (pending = new Set()));
  return pending;
};

/**
 * The world's groups waiting for a build, if it ever had any: for the per-frame check.
 * @internal
 */
export const findPending = (world: ECSWorld) => pendingByWorld.get(world);

/**
 * Creates a group's entity and its `MERGE_GROUP`, and lists it under its id (no checks: the API's
 * `createMergeGroup` and the `AUTO` groups' resolution make them).
 * @internal
 */
export const createGroup = (
  opts: MergeGroupSettings & { id: string },
  ecsWorld: ECSWorld,
  isAuto: boolean
) => {
  const { id, ...settings } = opts;
  const sceneId = getLoadingSceneId() ?? getCurrentSceneId() ?? '';
  const groupEntityId = ecsWorld.createEntity({
    appId: `mergeGroup:${id}`,
    managedBy: { manager: 'MERGE', ownerId: settings.persistent ? '' : sceneId, role: 'group' },
    debugData: { name: `Merge group ${id}` },
  });
  if (settings.persistent) ecsWorld.addComponent(groupEntityId, ComponentType.PERSISTENT, true);
  ecsWorld.addComponent(groupEntityId, ComponentType.MERGE_GROUP, {
    id,
    members: [],
    settings,
    partIndex: new Map(),
    wasted: 0,
    rebuilds: 0,
    _material: null,
    _isPending: false,
    _buildToken: 0,
    _isBuilding: false,
    _isAuto: isAuto,
  });
  getGroups(ecsWorld).set(id, groupEntityId);
  return groupEntityId;
};

/**
 * The world's meshes whose `merge` joins at the next build, in creation order (made on first use).
 * @internal
 */
export const getQueued = (world: ECSWorld) => {
  let queued = queuedByWorld.get(world);
  if (!queued) queuedByWorld.set(world, (queued = new Map()));
  return queued;
};

/**
 * The world's queued `merge`s, if it ever had any: for the per-frame check.
 * @internal
 */
export const findQueued = (world: ECSWorld) => queuedByWorld.get(world);

/**
 * Marks a group for a build at the build system's next run.
 * @internal
 */
export const markPending = (world: ECSWorld, groupEntityId: number, group: MergeGroupData) => {
  group._isPending = true;
  getPending(world).add(groupEntityId);
};

/**
 * A member's own mesh.
 * @internal
 */
export const getMemberMesh = (entityId: number, world: ECSWorld) =>
  world.getComponent(entityId, ComponentType.OBJECT3D)!.value as THREE.Mesh;

/**
 * A built group's mesh and merged geometry, or undefined before its first build.
 * @internal
 */
export const getGroupMesh = (groupEntityId: number, world: ECSWorld) =>
  world.getComponent(groupEntityId, ComponentType.OBJECT3D)?.value as
    | (THREE.Mesh & { geometry: MergedGeometry })
    | undefined;

/**
 * Puts a member's mesh at its `TRANSFORM` now and updates its world matrix: object3DSyncSystem
 * copies a `TRANSFORM` only in MAIN, so one set later in the frame (an `APP_LOGIC` move followed
 * by `updateMergeMember`) isn't on the mesh yet. The sync's dirty flag stays for the sync.
 * @internal
 */
export const syncMemberPose = (entityId: number, mesh: THREE.Mesh, world: ECSWorld) => {
  const store = world.getTypedTransformStore();
  if (store) {
    const slot = store.getSlot(entityId);
    if (slot !== -1) store.copyToObject3D(slot, mesh);
  } else {
    const transform = world.getComponent(entityId, ComponentType.TRANSFORM);
    if (transform) {
      mesh.position.copy(transform.position);
      mesh.quaternion.copy(transform.quaternion);
      mesh.scale.copy(transform.scale);
    }
  }
  mesh.updateWorldMatrix(true, false);
};

/**
 * Lets a member go: drawn on its own again, back in the spatial index if it was.
 * @internal
 */
export const releaseMember = (entityId: number, world: ECSWorld) => {
  const member = world.getComponent(entityId, ComponentType.MERGE_MEMBER);
  if (!member) return;
  world.removeComponent(entityId, ComponentType.MERGE_MEMBER);
  world.removeComponent(entityId, ComponentType.TAG_MERGED);
  if (member._wasSpatialIndexed) world.addComponent(entityId, ComponentType.SPATIAL_INDEXED, true);
};
