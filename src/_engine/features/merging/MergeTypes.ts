// The mesh merge groups' data (docs/plans/_DONE_p372_mesh-merge-groups.md §2): the components' types,
// which the kernel names with `import type` (its component registry, ECSCoreComponents.ts).
import type * as THREE from 'three/webgpu';

/**
 * How a merge group draws its members. `BAKED` (the default, p372): merged into one geometry, one
 * draw, culled whole; for static content. `BATCHED` (p375): instances of one `BatchedMesh`, each
 * member's matrix written when it moves and each culled on its own; for members that move (bodies
 * included), or that need their own culling.
 */
export type MergeGroupMode = 'BAKED' | 'BATCHED';

/** A merge group's settings: `createMergeGroup`'s options, kept on its `MERGE_GROUP`. */
export type MergeGroupSettings = {
  /** How the group draws its members. Default `BAKED`. A `BATCHED` group takes moving bodies,
   * but no `palette`. */
  mode?: MergeGroupMode;
  /** `BATCHED` only: each member is frustum-culled on its own, in every pass (shadow passes
   * included). Turn it off for a batch that is always in view: the per-member walk is then skipped.
   * Default true. */
  perMemberCulling?: boolean;
  /** Whether the group's mesh casts shadows. Default: its first member's `castShadow`. */
  castShadow?: boolean;
  /** Whether the group's mesh receives shadows. Default: its first member's `receiveShadow`. */
  receiveShadow?: boolean;
  /** Keeps the group on a scene switch (a `PERSISTENT` group entity).
   * Default false: the group goes with the scene it was created in. Only a persistent group takes
   * persistent members. */
  persistent?: boolean;
  /** A merge material palette's id (`*.mergeMaterial.json`, p374): the group takes meshes of any
   * of the palette's materials and draws them in one draw with the palette's merge material. The
   * scene must list the palette (`mergeMaterials`), and a palette group can't be `persistent`
   * (the merge material is the scene's) or `BATCHED`. Default: none, one material per group. */
  palette?: string;
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
  /** The members' material (the first member's): every member shares it. A palette group's is
   * the palette's merge material, from its creation. */
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
  /** The mode of the group the mesh joins: a group made on first use takes it (unless its scene
   * entry gives one), and a group of the other mode refuses the mesh. `AUTO` keeps each mode's
   * groups apart. Default: the group's (`BAKED` for one it makes). */
  mode?: MergeGroupMode;
  /** `AUTO` only: the side of the square x/z cells that bound an automatic group, in metres.
   * Default 32. */
  cellSize?: number;
  /** `AUTO` only: an automatic group's vertex cap; a full one opens another in its cell.
   * Default 262 144. */
  maxVertices?: number;
  /** `AUTO` only: the merge material palettes (`*.mergeMaterial.json` ids, p374) whose materials
   * share an automatic group: a mesh of a palette's material goes into its cell's group of that
   * palette, drawn by the palette's merge material. The first palette in the list that has its
   * material wins. Replaces the scene's `AUTO` entry's list; `[]`: none. The scene must list each
   * (`mergeMaterials`); one it doesn't is warned about and left out. */
  palettes?: string[];
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
  /** The merge material palettes (p374) whose materials share an automatic group, for the
   * scene's meshes that don't give their own list: palettes the scene lists (`mergeMaterials`).
   * Default: none, one material per automatic group. */
  palettes?: string[];
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
  /** A merge material palette the scene lists (`mergeMaterials`): the group takes meshes of any
   * of its materials, drawn by its merge material. Not with `BATCHED`. */
  palette?: string;
  /** How the group draws its members. Default `BAKED`. */
  mode?: MergeGroupMode;
  /** `BATCHED` only: each member culled on its own. Default true. */
  perMemberCulling?: boolean;
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
  /** Its part in the group's merged geometry, or -1 until a build includes it. Always -1 in a
   * `BATCHED` group. */
  partIndex: number;
  /** A `BATCHED` group's (p375): its instance in the group's `BatchedMesh`, or -1 until a build
   * adds it. Always -1 in a `BAKED` group. */
  instanceId: number;
  /** Whether it was in the `DEFAULT` spatial domain (`SPATIAL_INDEXED`) when it was merged: it
   * leaves it while merged and gets it back when it leaves the group. */
  _wasSpatialIndexed: boolean;
  /** The world matrix its range in the merged geometry was written with (its build, or its last
   * `updateMergeMember`). */
  _bakedMatrix: THREE.Matrix4;
  /** Its range in the merged index is collapsed because it's disabled (`DISABLED`) or in an edit
   * session: enabling it (or the session's end) writes the range again from its geometry. */
  _isCollapsed: boolean;
  /** Its material's palette index in a palette group (its vertices' `aekMatIndex`), from when it
   * joined; undefined in a group of one material. */
  _paletteIndex?: number;
  /** Its `TRANSFORM`'s pose when its edit session began (`beginMergeMemberEdit`), while one is
   * open: it's drawn by its own mesh, its range collapsed. */
  _editPose?: MergeMemberEditPose;
};

/** A merge member's pose when its edit session began: what `cancelMergeMemberEdit` restores. */
export type MergeMemberEditPose = {
  /** Its position. */
  position: THREE.Vector3;
  /** Its rotation. */
  quaternion: THREE.Quaternion;
  /** Its scale. */
  scale: THREE.Vector3;
};
