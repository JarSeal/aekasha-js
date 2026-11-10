// The merge groups' shared state and helpers (docs/plans/p372_mesh-merge-groups.md): the groups and
// pending builds per world, and a member's mesh and pose. MergeGroups.ts (the API and the builds)
// and MergeInPlace.ts (the in-place range updates) both use them.
import type * as THREE from 'three/webgpu';
import type { ECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import type { MergedGeometry } from '../../kernel/assets/GeometryMergeCore';
import type { MergeGroupData } from './MergeTypes';

/** Per world: the group entities by group id, and the groups waiting for a build. */
const groupsByWorld = new WeakMap<ECSWorld, Map<string, number>>();
const pendingByWorld = new WeakMap<ECSWorld, Set<number>>();

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
