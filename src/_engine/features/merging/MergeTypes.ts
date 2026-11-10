// The mesh merge groups' data (docs/plans/_DONE_p372_mesh-merge-groups.md §2): the components' types,
// which the kernel names with `import type` (its component registry, ECSCoreComponents.ts).
import type * as THREE from 'three/webgpu';

/** A merge group's settings: `createMergeGroup`'s options, kept on its `MERGE_GROUP`. */
export type MergeGroupSettings = {
  /** Whether the group's mesh casts shadows. Default: its first member's `castShadow`. */
  castShadow?: boolean;
  /** Whether the group's mesh receives shadows. Default: its first member's `receiveShadow`. */
  receiveShadow?: boolean;
  /** Keeps the group on a scene switch (a `PERSISTENT` group entity).
   * Default false: the group goes with the scene it was created in. Only a persistent group takes
   * persistent members. */
  persistent?: boolean;
};

/**
 * A merge group's `MERGE_GROUP` component, on its group entity: its members and the merged
 * mesh's bookkeeping. Read it, don't change it: the merge groups' functions keep it.
 */
export type MergeGroupData = {
  /** The group's id, unique per world. */
  id: string;
  /** Its members' entity ids: the built ones in their part order, then those waiting for the
   * next build. */
  members: number[];
  /** Its settings. */
  settings: MergeGroupSettings;
  /** A built member's part in the merged geometry (its index in `userData.mergeParts`), by
   * entity id. */
  partIndex: Map<number, number>;
  /** Vertices in the merged geometry that no member draws any more (a removed member's), until
   * the next compacting build. */
  wasted: number;
  /** How many times the group's geometry was built. */
  rebuilds: number;
  /** The members' material (the first member's): every member shares it. */
  _material: THREE.Material | null;
  /** A build is due: the build system builds the group at its next run. */
  _isPending: boolean;
  /** Counts the builds started, so an async build that finishes after a newer one started is
   * dropped. */
  _buildToken: number;
  /** A worker build is running (its token is `_buildToken`). */
  _isBuilding: boolean;
  /** An `AUTO` group (`merge: 'AUTO'`): its id is derived, and it's deleted when a build finds
   * no member left. */
  _isAuto: boolean;
};

/** `merge`'s object form: a group, and the `AUTO` bucket's bounds. */
export type MeshMergeOptions = {
  /** The group's id, or `'AUTO'` (the default): a group the engine picks by the mesh's material,
   * attributes, shadow flags, layers and cell. */
  group?: string;
  /** `AUTO` only: the side of the square x/z cells that bound an automatic group, in metres.
   * Default 32. */
  cellSize?: number;
  /** `AUTO` only: an automatic group's vertex cap; a full one opens another in its cell.
   * Default 262 144. */
  maxVertices?: number;
};

/**
 * A mesh's `merge` (`createMeshEntity`'s props, a mesh JSON's): a merge group's id, `'AUTO'`,
 * or the options. The mesh joins at the next build.
 */
export type MeshMergeDef = string | MeshMergeOptions;

/** A scene's `mergeGroups` entry for its `AUTO` groups: their defaults in that scene. */
export type SceneAutoMergeEntry = {
  /** `AUTO`: the entry for the scene's automatic groups. */
  id: 'AUTO';
  /** The cell size for the scene's meshes that don't give one. Default 32. */
  cellSize?: number;
  /** The vertex cap for the scene's meshes that don't give one. Default 262 144. */
  maxVertices?: number;
};

/** A scene's `mergeGroups` entry for one of its groups: its settings when it's made on first use
 * (a mesh's `merge`, `addToMergeGroup`). */
export type SceneMergeGroupEntry = {
  /** The group's id. */
  id: string;
  /** Whether the group's mesh casts shadows. Default: its first member's. */
  castShadow?: boolean;
  /** Whether the group's mesh receives shadows. Default: its first member's. */
  receiveShadow?: boolean;
};

/**
 * A merge group member's `MERGE_MEMBER` component: added when it joins (`addToMergeGroup`),
 * before the build that draws it merged.
 */
export type MergeMemberData = {
  /** Its group's entity. */
  groupEntityId: number;
  /** Its group's id. */
  groupId: string;
  /** Its part in the group's merged geometry, or -1 until a build includes it. */
  partIndex: number;
  /** Whether it was in the `DEFAULT` spatial domain (`SPATIAL_INDEXED`) when it was merged: it
   * leaves it while merged and gets it back when it leaves the group. */
  _wasSpatialIndexed: boolean;
  /** The world matrix its range in the merged geometry was written with (its build, or its last
   * `updateMergeMember`). */
  _bakedMatrix: THREE.Matrix4;
  /** Its range in the merged index is collapsed because it's disabled (`DISABLED`): enabling it
   * writes the range again from its geometry. */
  _isCollapsed: boolean;
};
