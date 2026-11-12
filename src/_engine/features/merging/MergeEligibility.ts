// Which mesh entities a merge group takes (docs/plans/_DONE_p372_mesh-merge-groups.md §5): a refused one
// is drawn on its own, with a warning naming the reason (`addToMergeGroup`). A `BATCHED` group
// (p375) takes moving bodies and transparent materials (its batch sorts its members, Phase 3), but
// only a mesh directly under the root scene whose geometry's attributes and index are the group's
// exactly (`BatchedMesh` copies every geometry into one set of buffers) and whose `renderOrder` is
// the group's (a batch is drawn at one place in the render order). A `BAKED` group refuses a `LOD` (p376 not adopted); a `BATCHED` one draws a member's
// levels (p375 Phase 2) when each is drawable in its batch (`getBatchLodRefusal`).
import type * as THREE from 'three/webgpu';
import type { ECSWorld } from '../../kernel/ecs/ECS';
import { ComponentType, type ComponentDataMap } from '../../kernel/ecs/ECSCoreComponents';
import { getRootScene } from '../../kernel/scene/Scene';
import { getGroupPaletteIndex } from './MergePalettes';
import type { MergeGroupData, MergeGroupMode } from './MergeTypes';

/** A geometry's attribute sizes differ from the other's where both have one: the merge throws on
 * that (p371 D1). The name of the first, or undefined. */
const getAttributeMismatch = (a: THREE.BufferGeometry, b: THREE.BufferGeometry) => {
  for (const name in a.attributes) {
    const other = b.attributes[name];
    if (other && other.itemSize !== a.attributes[name].itemSize) return name;
  }
  return undefined;
};

/** How a geometry differs from a batch's (its first member's, or a member's own for its LOD
 * levels, named by `owner`): an index on one only, an attribute one has and the other hasn't, or
 * one of another item size or normalization. `BatchedMesh` throws on the first two kinds and would
 * drop an extra attribute. Undefined when they agree. */
const getBatchMismatch = (
  geometry: THREE.BufferGeometry,
  batch: THREE.BufferGeometry,
  owner = 'the group'
) => {
  if (!geometry.index !== !batch.index)
    return `an index where ${owner} has none, or none where it has one`;
  for (const name in batch.attributes) {
    const own = geometry.attributes[name];
    if (!own) return `no "${name}" attribute, which ${owner} has`;
    const other = batch.attributes[name];
    if (own.itemSize !== other.itemSize || own.normalized !== other.normalized) {
      return `a "${name}" attribute of another item size or normalization than ${owner}'s`;
    }
  }
  for (const name in geometry.attributes) {
    if (!batch.attributes[name]) return `a "${name}" attribute ${owner} hasn't`;
  }
  return undefined;
};

/** The first live member's mesh, for the attribute and render order checks. */
const getGroupMesh = (group: MergeGroupData, world: ECSWorld) => {
  for (const entityId of group.members) {
    const object = world.getComponent(entityId, ComponentType.OBJECT3D)?.value;
    if ((object as Partial<THREE.Mesh> | undefined)?.isMesh) return object as THREE.Mesh;
  }
  return undefined;
};

/** A `LOD`'s resolved levels (merging imports no LOD code: the kernel's component data). */
type LodLevels = ComponentDataMap[(typeof ComponentType)['LOD']]['_levels'];

/**
 * Why a `BATCHED` group can't draw a mesh's LOD levels, or null. Each level must be drawable in the
 * batch the mesh is: its geometry agreeing exactly with the mesh's (which agrees with the
 * group's), the mesh's material (a batch draws one) and the mesh's `castShadow` (a batch casts
 * shadows as a whole). The levels are the ones `lod()`'s add hook resolved: none (no `lod()`, or
 * its hook not run yet) is nothing to check.
 * @internal
 */
export const getBatchLodRefusal = (mesh: THREE.Mesh, levels: LodLevels): string | null => {
  const geometry = mesh.geometry as THREE.BufferGeometry;
  for (let i = 0; i < levels.length; i++) {
    const level = levels[i];
    if (level.material !== mesh.material) {
      return `its LOD level ${i}'s material isn't the mesh's (a batch draws one material)`;
    }
    if (level.castShadow !== mesh.castShadow) {
      return `its LOD level ${i}'s castShadow isn't the mesh's (a batch casts shadows as a whole)`;
    }
    const mismatch =
      level.geometry === geometry
        ? undefined
        : getBatchMismatch(level.geometry, geometry, 'the mesh');
    if (mismatch) {
      return `its LOD level ${i}'s geometry has ${mismatch} (a batch's geometries agree exactly)`;
    }
  }
  return null;
};

/**
 * Why a merge group can't take the entity, or null when it can. Without `group`, only what any
 * group of `requestedMode` refuses (an `AUTO` member before its bucket is picked).
 * `requestedMode` is the mode the entity's `merge` asks for, if it names one: a group of the other
 * mode refuses it.
 * @internal
 */
export const getMergeRefusal = (
  entityId: number,
  world: ECSWorld,
  group?: MergeGroupData,
  requestedMode?: MergeGroupMode
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
  const mode = (group ? group.settings.mode : requestedMode) ?? 'BAKED';
  if (group && requestedMode && requestedMode !== mode) {
    return `its merge asks for a ${requestedMode} group and "${group.id}" is ${mode}`;
  }
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
    return 'it has a material array (one draw per material): split it into one mesh per material, which a palette can merge';
  }
  if (mesh.material.transparent && mode === 'BAKED') {
    return 'its material is transparent (drawn sorted per object: a BATCHED group sorts its members)';
  }
  const paletteIndex = group && getGroupPaletteIndex(group, mesh.material);
  if (paletteIndex === -1) {
    return `its material isn't one of the palette "${group!.settings.palette}"'s (a variant or a clone of a member is another material)`;
  }
  if (paletteIndex === undefined && group?._material && mesh.material !== group._material) {
    return "its material isn't the group's (one material per group)";
  }
  if (mode === 'BAKED') {
    if (
      world.hasComponent(entityId, ComponentType.BODY_DYNAMIC_VISUAL) ||
      world.hasComponent(entityId, ComponentType.BODY_DYNAMIC_HEADLESS) ||
      world.hasComponent(entityId, ComponentType.PHYSICS_SIM_TIER)
    ) {
      return "it has a dynamic or kinematic body (a BAKED group's members are static: a BATCHED group takes it)";
    }
  } else if (mesh.parent !== getRootScene()) {
    // Its matrix in the batch is its TRANSFORM's, which is its world pose only at the root
    return "it isn't directly under the root scene (a BATCHED member is drawn at its TRANSFORM)";
  }
  if (world.hasComponent(entityId, ComponentType.MANAGED_BY)) {
    return 'a manager owns it (MANAGED_BY)';
  }
  const lod = world.getComponent(entityId, ComponentType.LOD);
  if (lod && mode === 'BAKED') return 'it has a LOD (a BATCHED group draws its levels)';
  const lodRefusal = lod && getBatchLodRefusal(mesh, lod._levels);
  if (lodRefusal) return lodRefusal;
  if (!group) return null;
  if (world.hasComponent(entityId, ComponentType.PERSISTENT) && !group.settings.persistent) {
    return "it's persistent and the group isn't";
  }
  const groupMesh = getGroupMesh(group, world);
  if (!groupMesh) return null;
  const groupGeometry = groupMesh.geometry as THREE.BufferGeometry;
  if (mode === 'BATCHED') {
    if (mesh.renderOrder !== groupMesh.renderOrder) {
      return "its renderOrder isn't the group's (a batch is drawn at one place in the render order)";
    }
    const mismatch = getBatchMismatch(geometry, groupGeometry);
    return mismatch ? `its geometry has ${mismatch} (a batch's geometries agree exactly)` : null;
  }
  const mismatch = getAttributeMismatch(geometry, groupGeometry);
  if (mismatch) return `its "${mismatch}" attribute has another item size than the group's`;
  return null;
};
