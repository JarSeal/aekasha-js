// The mesh merge groups' data (docs/plans/p372_mesh-merge-groups.md §2): the components' types,
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
};
