// Which mesh entities a merge group takes (docs/plans/p372_mesh-merge-groups.md §5): a refused one
// is drawn on its own, with a warning naming the reason (`addToMergeGroup`).
import type * as THREE from 'three/webgpu';
import type { ECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType } from '../../kernel/ecs/ECSCoreComponents';
import type { MergeGroupData } from './MergeTypes';

/** A geometry's attribute sizes differ from the other's where both have one: the merge throws on
 * that (p371 D1). The name of the first, or undefined. */
const getAttributeMismatch = (a: THREE.BufferGeometry, b: THREE.BufferGeometry) => {
  for (const name in a.attributes) {
    const other = b.attributes[name];
    if (other && other.itemSize !== a.attributes[name].itemSize) return name;
  }
  return undefined;
};

/** The first live member's geometry, for the attribute check. */
const getGroupGeometry = (group: MergeGroupData, world: ECSWorld) => {
  for (const entityId of group.members) {
    const object = world.getComponent(entityId, ComponentType.OBJECT3D)?.value;
    if ((object as Partial<THREE.Mesh> | undefined)?.isMesh) {
      return (object as THREE.Mesh).geometry as THREE.BufferGeometry;
    }
  }
  return undefined;
};

/**
 * Why a merge group can't take the entity, or null when it can. Without `group`, only what any
 * group refuses (an `AUTO` member before its bucket is picked).
 * @internal
 */
export const getMergeRefusal = (
  entityId: number,
  world: ECSWorld,
  group?: MergeGroupData
): string | null => {
  if (!world.isAlive(entityId)) return 'it was deleted';
  const object = world.getComponent(entityId, ComponentType.OBJECT3D)?.value;
  // three's type flags, not `instanceof`: a class named here ships with every app that lists
  // merging() (BatchedMesh alone is ~18 kB minified, and no other shipping code uses it)
  if (!(object as Partial<THREE.Mesh> | undefined)?.isMesh) return "it isn't a mesh entity";
  const mesh = object as THREE.Mesh & {
    isSkinnedMesh?: boolean;
    isInstancedMesh?: boolean;
    isBatchedMesh?: boolean;
  };
  const member = world.getComponent(entityId, ComponentType.MERGE_MEMBER);
  if (member) return `it's in the merge group "${member.groupId}" already`;
  if (mesh.isSkinnedMesh) return 'skinned meshes are never merged';
  if (mesh.isInstancedMesh || mesh.isBatchedMesh) return 'instanced meshes are never merged';
  if (world.hasComponent(entityId, ComponentType.INSTANCED_MESH_SLOT)) {
    return "it's an instanced mesh pool's instance";
  }
  const geometry = mesh.geometry as THREE.BufferGeometry;
  if (Object.keys(geometry.morphAttributes).length > 0) return 'it has morph targets';
  const position = geometry.getAttribute('position');
  if (!position || position.itemSize !== 3) return 'its geometry has no 3-component position';
  if (Array.isArray(mesh.material)) {
    return 'it has a material array (multi-material merging is p374)';
  }
  if (mesh.material.transparent) return 'its material is transparent (drawn sorted per object)';
  if (group?._material && mesh.material !== group._material) {
    return "its material isn't the group's (one material per group)";
  }
  if (
    world.hasComponent(entityId, ComponentType.BODY_DYNAMIC_VISUAL) ||
    world.hasComponent(entityId, ComponentType.BODY_DYNAMIC_HEADLESS) ||
    world.hasComponent(entityId, ComponentType.PHYSICS_SIM_TIER)
  ) {
    return 'it has a dynamic or kinematic body (members are static)';
  }
  if (world.hasComponent(entityId, ComponentType.MANAGED_BY)) {
    return 'a manager owns it (MANAGED_BY)';
  }
  if (world.hasComponent(entityId, ComponentType.LOD)) return 'it has a LOD';
  if (!group) return null;
  if (world.hasComponent(entityId, ComponentType.PERSISTENT) && !group.settings.persistent) {
    return "it's persistent and the group isn't";
  }
  const groupGeometry = getGroupGeometry(group, world);
  const mismatch = groupGeometry && getAttributeMismatch(geometry, groupGeometry);
  if (mismatch) return `its "${mismatch}" attribute has another item size than the group's`;
  return null;
};
