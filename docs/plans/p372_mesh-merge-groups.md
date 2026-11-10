Status: in progress | Phases 1-3 implemented
Category: Merging, ECS, Rendering
Epic: p370_static-mesh-merging-and-texture-atlas-systems.md (Tier 1.2)
Blocks: p373_merge-debug-and-member-editing.md, p374_multi-material-merging.md, p375_batched-mesh-batches.md, p376_hlod-merged-cluster-proxies.md
Related: \_DONE_p346_spatial-domains.md (cell maths, DEFAULT domain), \_DONE_p348_ecs-lod-selection.md (`LOD` members are refused until p376), \_DONE_p352_physics-simulation-tiers.md (static body sync), \_DONE_p353_macro-streaming-grid.md (groups stay inside a cell), p301_terrain-texturing-epic.md (the modular kit terrain page, Phase 5), \_DONE_p345_gpu-memory-and-draw-call-debugger.md

# Mesh Merge Groups

The "merge meshes" tool. Mesh entities that share a material are drawn as one merged mesh, owned
by a group entity, while each source mesh stays an entity with its own transform, physics body and
data. A member can be moved, removed or added later: its vertex range in the merged buffers is
rewritten in place.

Members join a group by id or automatically:

```json
{
  "props": { "geo": "ruinKit/wallStraight", "mat": "ruinStone", "position": [4, 0, 0] },
  "merge": "AUTO"
}
```

---

## 1. Grounding

- **Meshes** (`kernel/mesh/Mesh.ts`): `createMeshEntity` builds a `THREE.Mesh`, adds `OBJECT3D`
  and `TAG_IS_MESH`, adds the mesh to the root scene (unless `doNotAddToScene`), sets `TRANSFORM`,
  and adds `SPATIAL_INDEXED` unless `entityOpts.spatialIndex` is `false`. `object3DSyncSystem`
  (`kernel/ecs/ECSCoreSystems.ts`) copies `TRANSFORM` onto the Object3D every frame.
  `disposeMesh` releases the geometry and material refs. A mesh's `lod` prop reaches `lod()`
  through a resolver the feature sets (`setAutoLodResolverLoader`): the pattern for `merge`.
- **Visibility** (`kernel/ecs/ECSCoreSystems.ts`): `reconcileObject3DVisibility(entityId, world,
overrides?)` sets `.visible` from `DISABLED`, `TAG_FRUSTUM_CULLED`, `TAG_OBJECT_CULLED` and
  `TAG_LOD_CULLED` (kept visible while `TAG_LOD_TRANSITIONING`); each tag's hooks call it, with an
  `overrides` field for the tag being toggled. The tags are kernel component types
  (`kernel/ecs/ECSRegistry.ts`) whose hooks a feature registers (`lod()` for its two).
- **Managed entities**: `CoreEntityOpts.managedBy` adds `MANAGED_BY { manager, ownerId, role }`
  (`kernel/ecs/ECS.ts`); debug tools treat managed entities as read-only.
- **Scene load** (`kernel/scene/SceneLoader.ts`, `src/_engine/kernel/scene/CLAUDE.md`):
  `createNextSceneObject3Ds` (`kernel/scene/SceneDataLoader.ts`) creates the scene JSON's meshes
  after the scene code and the features' `created` hooks; then the enter listeners run (scene
  code creates its meshes there or in its code), then the features' `entered` hooks, in install
  order (physics' waits for its pending creates, `settlePendingPhysicsEntities`, and releases its
  stepping), while the loader is still shown.
- **Static bodies** (`_DONE_p352` Phase 1): `BODY_STATIC` isn't synced per frame. A fixed body
  moved by `world.setTransform` or a direct `setTranslation` / `setRotation` is synced once
  (`setBodyMovedListener` in `features/physics/PhysicsRegistry.ts`, `queueStaticBodySync` in
  `features/physics/PhysicsEntity.ts`), which marks its transform dirty.
- **Render-sync order** (`APP_RENDER_SYNC_ORDER`, `kernel/loop/SystemStages.ts`, on `aekasha`):
  `POSE_PRODUCERS` 0, `POSE_CONSUMERS` -0.5, `SHADOW_FIT` -0.75, `FRUSTUM_CULLING` -1,
  `LOD_SELECTION` -1.5, `LIGHT_CULLING` -2 (higher runs earlier).
- **Cell maths** (`src/_engine/utils/CellKey.ts`, `@internal`, pure): `worldToCell`, `packCellKey`,
  `cellBounds`; moved out of `spatial()` by p353 Phase 1 (p370 §13), so this plan imports it.
- **Imported assets** share one engine material per asset (`SpawnImportedParams.material`), and
  Blender custom props already group physics nodes (`index`, `kernel/assets/import/CustomProps.ts`,
  `ImportTypes.ts`).
- **Placement** (p370 §13): this plan starts the `merging()` feature (`features/merging/`,
  `aekasha/merging`); the kernel gains only types, a component type and seams.
- p371's `mergeGeometryParts` returns a merged geometry with a part table
  (`vertexStart/Count`, `indexStart/Count`, `key`).

## 2. Data

| Component      | On           | Data                                                                                              |
| -------------- | ------------ | ------------------------------------------------------------------------------------------------- |
| `MERGE_GROUP`  | group entity | `{ id, members: number[], cellKey?, settings, partIndex: Map<entityId, part>, wasted, rebuilds }` |
| `MERGE_MEMBER` | member       | `{ groupEntityId, groupId, partIndex }`                                                           |
| `TAG_MERGED`   | member       | runtime-only; a fifth reason in `reconcileObject3DVisibility`, a kernel type                      |

- **The group entity** is a plain mesh entity (`OBJECT3D` + `TAG_IS_MESH`, so `disposeMesh` and
  the profiler handle it) created with `managedBy: { manager: 'MERGE', ownerId: <scene or
caller>, role: 'group' }`. Its geometry is registered (`mergeGroup:<id>`), its material is the
  members' (one ref).
- **A member keeps everything** except being drawn: `TAG_MERGED` hides its own Object3D, and it
  leaves the DEFAULT spatial domain (its `SPATIAL_INDEXED` is removed and restored on leave).
  Its geometry and material refs stay, so leaving the group needs no reload.

## 3. API (`features/merging/MergeGroups.ts`, on `aekasha/merging`)

```ts
createMergeGroup(opts: { id: string; sceneId?: string; castShadow?: boolean; receiveShadow?: boolean }, world?): number;
addToMergeGroup(groupId: string, entityIds: number[], world?): void; // batched to the next build
removeFromMergeGroup(entityIds: number[], world?): void;
updateMergeMember(entityId: number, world?): void; // after the member's TRANSFORM changed
rebuildMergeGroup(groupId: string, world?): void;
dissolveMergeGroup(groupId: string, world?): void; // members drawn on their own again
getMergeGroupOf(entityId: number, world?): string | undefined;
```

- **Builds** are batched: adds and removes mark the group pending; `mergeGroupBuildSystem` at
  `APP_RENDER_SYNC`, registered by `merging()`'s install (new `APP_RENDER_SYNC_ORDER.MERGE_BUILD
= 0.5`, before the pose producers; the scene runner's system order baseline records it)
  builds pending groups once per frame with `mergeGeometryParts` (or its worker variant above a
  vertex threshold, the members staying visible until the new mesh is in).
- **`updateMergeMember`** rewrites the member's range in place: positions by the new world matrix,
  normals and tangents by its normal matrix, then `attribute.addUpdateRange` + `needsUpdate` per
  attribute and a bounds refresh. No rebuild, no allocation; the vertex count doesn't change.
- **Remove** collapses the member's index range to degenerate triangles (one index write range)
  and counts the vertices as `wasted`. Past `max(wasted / total, 25%)` the group rebuilds compact.
- **Remerge is explicit**, never driven by `TRANSFORM` dirty flags: members are static by
  contract, and a dirty flag is also set by writes that aren't a member move (a moved fixed
  body's one-off sync, §1; a tier-frozen body's settling sync), so it's no reliable trigger. A
  debug check (debug env only) compares a member's world matrix with its baked one every N frames
  and warns once per member that moved without `updateMergeMember`.

## 4. Options and JSON

### 4.1 `merge`

On `createMeshEntity` props (`MeshProps` in `kernel/mesh/Mesh.ts`, its type imported from the
feature with `import type`), `*.mesh.json` and inline scene meshes: a `mesh` field of
`merging()`'s `FeatureSchemaPart` (`schemas/FeatureSchemas.ts`; `mergeGroups` its `scene` field),
so the feature manifest names the feature and `InitEngine` fails a scene that merges without it.
Without `merging()`, a code mesh's `merge` warns once and the mesh renders on its own (as `lod:
'AUTO'` does without `lod()`):

```ts
merge?: string | 'AUTO' | { group?: string | 'AUTO'; cellSize?: number; maxVertices?: number };
```

- `"<groupId>"`: an explicit group. Created on first use with default settings, or from the
  scene's `mergeGroups` entry.
- `"AUTO"`: the engine picks the group from a **compatibility key** (material ref id, geometry
  attribute signature, `castShadow`, `receiveShadow`, layers, `renderOrder` when p309 adds it) plus
  the member's **cell** (`worldToCell` of its world position at `cellSize`, default 32 m) and a
  vertex cap (`maxVertices`, default 262 144). A full bucket opens a second group in that cell.
  `AUTO` group ids are derived (`auto:<key hash>:<cellKey>:<n>`).
- Groups are scene-scoped: created during a load, they belong to that scene and go with it;
  `persistent` members can only join groups created with `sceneId: undefined`.

### 4.2 Scene `mergeGroups`

```json
"mergeGroups": [
  { "id": "ruins", "castShadow": true },
  { "id": "AUTO", "cellSize": 48, "maxVertices": 131072 }
]
```

The `AUTO` entry sets the scene's defaults for automatic groups. A scene with `streaming` (p353)
gets an `AUTO` cell size that divides its streaming cell size (a dev warning otherwise), and an
explicit group whose members span two streaming cells is warned about.

### 4.3 Imported assets

- A `merge` custom prop on Blender nodes (`"AUTO"` or a group id), parsed with the other custom
  props (`kernel/assets/import/CustomProps.ts`, its template in `customPropTemplates.blend`),
  like `index` for compound bodies, and handed to `merging()` through an import extension
  (`ctx.registerImportExtension`, as physics' and LOD's).
- `spawnImportedAsset` options: `merge: 'AUTO' | string` applies to every eligible node of the
  asset (the common case: one imported level, one material).

## 5. Eligibility

Refused with a dev warning naming the entity and the reason (it then renders on its own):

- skinned meshes, morph targets, `InstancedMesh` / pool instances;
- transparent materials (`material.transparent`), which need per-object sorting;
- material arrays (a multi-material mesh): merge with p374 instead;
- `BODY_DYNAMIC_*` and kinematic bodies;
- `managedBy` entities (their manager owns the Object3D);
- entities with `LOD` (p348) until p376;
- members whose geometry's attribute signature can't be unified (p371 D1 reports why).

## 6. Scene load

`buildSceneMergeGroups()` is `merging()`'s `entered` scene hook (awaited, before the loader's
`loadEndFn`): by then the scene JSON's meshes and the scene code's meshes exist, and the loader
still hides the scene. It builds every pending group synchronously (or awaits worker builds), so
the first frame already draws merged. Physics members' transforms are their creation transforms
at that point (bodies spawn at the entity's `TRANSFORM`; `merging()` listed after `physics()`
runs after physics has settled them).

On scene exit, the group entities are deleted with the scene's non-persistent entities;
`disposeMesh` releases their geometry, and the members' refs go with the members.

## 7. Integration

- **Culling:** three culls the group mesh by its bounding sphere, and ECS frustum culling
  (`ecsFrustumCullingEnabled`) can be set on the group from its settings. Members are hidden, so
  their own culling flags do nothing while merged.
- **Spatial index:** the group entity is `SPATIAL_INDEXED` with its geometry radius (the mesh
  radius provider); `AUTO`'s cell size keeps it out of the oversized tier in a default grid.
- **Shadows:** a group casts and receives as its settings say; mixed members land in different
  `AUTO` groups (the key includes both flags).
- **Physics:** untouched. A member's body stays per member (p370 §7).
- **Raycasts:** the engine's mesh raycasts hit the group mesh; `getMergeMemberAtFace(groupEntity,
faceIndex)` (p373 D4) maps the hit to its member.
- **Disabling a member** (`DISABLED`) collapses its range like a remove, without counting it as
  wasted; enabling restores it from the member's geometry.

## 8. Phases

### Phase 1 — Components and runtime API (§2, §3) — done

The `merging()` feature (its install, entry, a `sbp.config.ts` budget line), components,
`TAG_MERGED` in the reconcile, `createMergeGroup` / `addToMergeGroup` / `dissolveMergeGroup`, the
build system, unit tests next to the modules. **Exit:** 200 `testDebugScene` boxes with one
material in one group: one draw (profiler), same image as unmerged, dissolving restores 200
draws; without `merging()` in `features` the app's first download is unchanged (`yarn sbp`).

As built (2026-11-10):

- The feature: `features/merging/` with `MergingFeature.ts` (`merging()`, id `merging`),
  `index.ts` (`aekasha/merging`: the alias in `devTools/aliases.ts` and `tsconfig.json`,
  `ENGINE_FEATURE_FACTORIES`), `MergeTypes.ts`, `MergeGroups.ts` (the API, the hooks, the build
  system, the install) and `MergeEligibility.ts` (§5's checks). The template lists it twelfth,
  after `streaming()` (`src/index.ts`, `InitEngine`'s example); the docs that say "eleven" are
  Phase 5's.
- Kernel: `MERGE_GROUP`, `MERGE_MEMBER` and `TAG_MERGED` are kernel component types
  (`ECSCoreComponents.ts`, the data types `import type` from `MergeTypes.ts`, as `LOD`'s);
  `TAG_MERGED` is the sixth reason in `reconcileObject3DVisibility` (after p353's
  `TAG_DRAW_HELD`), its hooks `merging()`'s; `APP_RENDER_SYNC_ORDER.MERGE_BUILD = 0.5`.
- API (§3), with these differences:
  - `createMergeGroup({ id, castShadow?, receiveShadow?, persistent? }, world?)`: `persistent`
    in place of `sceneId` (§4.1's "`sceneId: undefined`" is `persistent: true`). A group goes
    with the scene it was created in (`MANAGED_BY { manager: 'MERGE', ownerId: <scene id>, role:
'group' }`, appId `mergeGroup:<id>`); a persistent one gets `PERSISTENT` and takes persistent
    members. `castShadow` / `receiveShadow` default to the first member's. A taken id throws.
  - `addToMergeGroup` makes the group with default settings on first use (as §4.1 says of
    `"<groupId>"`). A member gets `MERGE_MEMBER` (`partIndex` -1) when it joins, so
    `getMergeGroupOf` answers before the build; `TAG_MERGED` and leaving the spatial index at the
    build that includes it.
  - Also in Phase 1: `rebuildMergeGroup` and `getMergeGroupOf`. Without `merging()` every one
    throws, naming the feature (as `createLines`). `buildPendingMergeGroupsAsync(world?)`
    (`@internal`) builds what's pending now, awaiting worker builds: Phase 3's scene step.
- The group entity has no mesh until its first build (the material is the first member's, kept as
  `MergeGroupData._material`): the build adds `OBJECT3D` and `TAG_IS_MESH` (so `disposeMesh`
  releases its refs on delete), the material's ref and `SPATIAL_INDEXED`. The mesh sits at the
  centre of the members' world bounds, the members baked relative to it (`TRANSFORM` set too):
  `spatial()`'s mesh radius is measured from the mesh's origin, so a world-space merge at the
  origin would get a radius reaching from there. Each build re-joins the spatial index (remove
  and add `SPATIAL_INDEXED`) so the radius is measured again.
- The geometry is registered as `mergeGroup:<id>` (`#<rebuilds>` appended only when something
  else still holds the previous one under the id), never persistent: the group mesh's ref keeps
  it through a scene release, and a persistent registration would outlive a dissolve. A rebuild
  releases the previous one (its last ref disposes it).
- Builds: the merge code (`GeometryMerge.ts`) loads with an `import()` on the first pending
  group, so the build system's first run with one only starts the load and the next run builds;
  then `mergeGeometryParts` up to `WORKER_BUILD_VERTICES` (65 536, `@internal`, a constant, not
  a setting), `mergeGeometryPartsAsync` above, members drawn on their own until it's in. A worker
  result is dropped when a newer build started (`_buildToken`), the group was deleted or a
  member left meanwhile. A build with no members left takes the mesh out of the scene (a
  persistent group whose members went with their scene).
- Phase 1's membership changes: a deleted member (`MERGE_MEMBER`'s `onDeleteEntity`) marks the
  group pending and the next build leaves it out; until then the old mesh still draws it (a
  frame, or a worker build's time; Phase 2's collapse replaces this). A disabled member is
  merged as it is (Phase 2). Dissolving deletes the group entity, whose `onDeleteEntity` lets the
  members go (`TAG_MERGED` and `MERGE_MEMBER` removed, `SPATIAL_INDEXED` back if it had it).
- Refusals (§5) in `addToMergeGroup`, each a warning naming the entity and the reason, plus: a
  material other than the group's, an entity already in a group, a `PHYSICS_SIM_TIER` (a
  tier-frozen dynamic body, in `BODY_STATIC`), a persistent entity in a group that isn't, an
  attribute whose item size differs from the group's first member's (the merge would throw).
- Tests: `MergeGroups.test.ts` (in Node: `TAG_MERGED` with the other reasons; a build's
  placement, bounds, part indices and refs; a late member; a rebuild; dissolving; a deleted
  member; both scene exits; the refusals; a held worker build and a stale one dropped, with
  `GeometryMerge.ts`' async merge mocked; the system's lazy load and its order).
- The check (`testDebugScene`, `createMergeGroupCheck`): 200 boxes of `p372_gridMat` (the
  checker), each turned its own way, in two 10 × 10 blocks left and right of the rows, in the
  group `p372_grid`; no shadows, so one pass. Measured 2026-11-10 in Chrome on macOS, prod test,
  from a `LATE_MAIN` system after the render (`renderer.info.render`, as the profiler reads it):
  37 draws merged, 236 after `dissolveMergeGroup('p372_grid')`, 64 151 triangles both; the two
  snapshots differ in 3 of 700 000 pixels by 1 level (WebGL2: the same counts, 7 pixels by 1).
- GPU memory (§10's third risk), checked through three's geometry map on both backends: 20
  members merged before any frame drew them (`buildPendingMergeGroupsAsync` right after adding
  them) never had their own geometry uploaded. The grid's box geometry was uploaded: the members
  drew on their own in the frames before the first build (the merge code's `import()`), and three
  keeps a geometry's buffers until it's disposed. **For Phase 3:** the scene step must build
  before the load's first frame that would draw the members (or hold them from drawing until
  then), or every scene-loaded group carries both copies.
- `yarn sbp --profile all`: `_engine/features/merging` is 1.9 kB gzip in the app's first
  download (two modules; budget 3 KiB, `sbp.config.ts`), `GeometryMerge.js` still lazy; the
  banner and UI kit embeds, which don't list `merging()`, unchanged but for the kernel's part in
  every build (the three component keys, the reconcile's check, `MERGE_BUILD`: +202 B, 56 B gzip,
  in their main chunk).
- Baselines (2026-11-10): `yarn verify:scenes` before the update failed only on what this phase
  changes (`mergeGroupBuildSystem@0.5` in every scene's system order; `testDebugScene`'s
  snapshot, only at the two grid blocks, and its debugger shots of the Assets tab, the
  profiler's Objects and GPU memory and About) and on the local baseline's age (most scenes
  recorded at `d4decbdf`, before p353: `streamingSystem`, the Streaming tab, the gym's LOD tab;
  `streamingPhysics` had none); no hash, character path or console error changed, and
  `exampleSkyBox`'s one `workerSab` snapshot difference (a few pixels of a highlight) passed when
  run again. Then `yarn verify:scenes --update` (132 runs recorded, all passing; its one note,
  `thirdPersonGymScene`'s physics targets hashing differently in `workerSab`, e40a1d59 against
  84a78084, is the gym's known worker-target spread that earlier runs show with other configs,
  in a scene without merge groups) and `yarn verify:baselines --update`: `api.json` (the entry
  `aekasha/merging`, its exports), `docs.json` (merging 14 / 14 documented), the three
  `bundle*.json` (the embeds below the report's threshold: +202 B, 56 B gzip); no debug code in
  any build.

### Phase 2 — In-place updates (§3) — done

`updateMergeMember`, remove by collapse, compaction, disable/enable, the moved-member check.
**Exit:** moving one member rewrites only its range (no rebuild counted); removing 30% compacts.

As built (2026-11-10):

- Files: `MergeRanges.ts` (the buffer writes: `rewritePartVertices`, `flipPartWinding`,
  `growMergedBounds`, `collapsePartIndex`, `restorePartIndex`), `MergeInPlace.ts` (per member:
  `rewriteMember`, `dropMember`, `collapseDisabledMember`, `restoreEnabledMember`,
  `COMPACT_WASTE_SHARE`), `MergeState.ts` (the per-world maps, `markPending`, `syncMemberPose`,
  `releaseMember`: moved out of `MergeGroups.ts`, which keeps the API, the hooks, the builds and
  the install, and would have passed 800 lines) and `debug/_dbg__MergeGroups.ts`.
- `updateMergeMember(entityId, world?)` (§3): the pose read from `TRANSFORM` (both storage
  modes: object3DSyncSystem copies it only in MAIN, so a move later in the frame isn't on the
  mesh yet; the builds read it the same way since). Positions, normals (the normal matrix) and
  tangents (the linear part; a tangent the merge computed, the member having none, turned from
  the merged value by the change since `MERGE_MEMBER._bakedMatrix`, the world matrix its range
  was written with) rewritten, `w` and the winding flipped when the mirroring changed, one
  `addUpdateRange` per attribute written (uvs and colours untouched). The bounds only grow (box and
  sphere each: a box inside the merged box can still leave its sphere) until the next build, and
  the group re-joins the spatial index only when they grew. A running worker build
  (`MERGE_GROUP._isBuilding`) is dropped and the group builds again (it read the old pose). A
  member whose geometry has another vertex count warns and its group builds again; a non-member
  warns.
- `removeFromMergeGroup(entityIds, world?)`: a built member's index range collapsed to its first
  vertex (one index range), its vertices counted in `wasted`, the member released at once (drawn
  on its own, back in the spatial index). A deleted member the same (Phase 1 rebuilt instead).
  Past `COMPACT_WASTE_SHARE` (§3's "max(wasted / total, 25%)" read as past 25 % of the merged
  vertices) the group is marked for a compacting build. A member not built yet only leaves the
  lists (its group's pending build stays: a merge of the same members when nothing else changed).
  A worker build dropped because a member left marks the group again (not when a newer build
  replaced it or the group was deleted).
- Disable / enable (§7): `DISABLED` hooks from the install (one component lookup per disable or
  enable in an app with `merging()`). A built member's range collapses without counting as waste
  (`MERGE_MEMBER._isCollapsed`); enabling writes it back from the member's geometry with its
  baked matrix's winding (the group mesh is only ever moved, so the world matrix's mirroring is
  the part's); a geometry replaced meanwhile warns and the group builds again. A member disabled
  at its build is merged, then collapsed. `updateMergeMember` on a collapsed member writes its
  vertices, not its index; removing one counts its vertices as waste.
- The moved-member check (§3): `registerMergeDebug` (`MergeGroups.ts`, through `ctx.onDebug`,
  gated by `IS_DEBUG_ENV`) loads `debug/_dbg__MergeGroups.ts`, whose `mergeMoveCheckSystem`
  (`LATE_MAIN`, every 60 frames, `MOVE_CHECK_FRAMES`) compares each built member's world matrix
  with `_bakedMatrix` (1e-5 per element) and warns once per member, naming the group, the entity
  and `updateMergeMember`.
- Tests: `MergeGroups.test.ts` (each in-place update compared with a fresh merge of the same poses,
  a mirrored member with computed tangents included; the update ranges; the bounds and the spatial
  re-join; the typed store; a dropped worker build; the collapse and compaction through a remove
  and a delete; disabling: the round trip, at a build, moved while disabled, removed while
  disabled, a replaced geometry), `debug/_dbg__MergeGroups.test.ts` (once per member, the members
  waiting skipped, the 60-frame interval in `LATE_MAIN`). Each guarded path was checked failing
  without its code.
- The exit check (2026-11-10, Chrome on macOS, debug env; `testDebugScene`'s `p372_grid`, 200
  boxes, driven through the test bridge, its merged image against the one after
  `dissolveMergeGroup`):
  - In place: 3 members moved and turned with `updateMergeMember`, 10 disabled and 5 of them
    enabled again, 40 removed (20 %): no rebuild (`rebuilds` 1, the same geometry), `wasted` 960;
    draws 37 → 77 (the 40 removed on their own); the images differ in 2 of 700 000 pixels by 1
    level (WebGPU), 5 by 1 (WebGL2).
  - Compaction: 60 removed (30 %): `wasted` 1 440, pending, built in the next frame (`rebuilds`
    2, `wasted` 0, 140 members, 3 360 vertices); a member moved without `updateMergeMember`
    warned once within the interval. Images: 6 pixels by 1 (WebGPU); 13 on WebGL2, 11 by at most
    7 and 2 silhouette pixels at box corners over the background flipping coverage (the compacted
    group is centred elsewhere, so its baked vertices round differently).
  - Collapsed ranges still count in the triangles (degenerate ones are submitted until the
    compaction): 64 631 merged against 64 091 dissolved.
- `yarn sbp`: `_engine/features/merging` 1.9 → 2.8 kB gzip in the first download (5 modules),
  under its 3 KiB budget; **Phase 3** (the schema part, `AUTO`, the scene step) will need the
  budget raised. No debug code in any build.
- Baselines (2026-11-10): `yarn verify:scenes` before the update failed only on
  `mergeMoveCheckSystem` in `LATE_MAIN` (the 101 debug-env runs' system order) and on
  `thirdPersonGymScene` `workerSab`'s snapshot: its probe hash back at 84a78084 (the other
  configs'), from Phase 1's recorded e40a1d59, the camera following a character that ran
  differently (p428's worker-target spread; the gym has no merge groups). Then
  `yarn verify:scenes --update` (132 recorded) and `yarn verify:baselines --update` (`api.json`:
  `removeFromMergeGroup` and `updateMergeMember` on the entry, the new internal modules;
  `docs.json` merging 35 / 35; `bundle.json`).

### Phase 3 — JSON, AUTO and scene load (§4, §6) — done

The cell maths to `src/_engine/utils/` unless p353 moved it (p370 §13), `merge` in the feature's
schema part and `createMeshEntity`, scene `mergeGroups`, `AUTO` buckets, imported asset custom
prop and option, the scene-load step. **Exit:** a scene with 500 `AUTO` meshes in 3
materials over 4 cells loads with 12 groups, and its first frame is already merged.

Decided when it started (2026-11-10):

- **`merge` is a mesh prop** (in `props`, next to `lod`): a feature's `mesh` schema part adds
  fields to a mesh's `props`, as §4.1's text says; §4.1's JSON example, with `merge` beside
  `props`, is wrong.
- **A mesh's `merge` is queued and joins at the next build** (the build system's run, or the scene
  step), not in `createMeshEntity`: an import spawns a node's body after its mesh, and scene code
  can move a mesh right after creating it, so the refusals and `AUTO`'s cell see the final entity.
- **No import extension** (§4.3): `spawnImportedAsset` creates its pieces with `createMeshEntity`,
  so the custom prop and the spawn option reach `merging()` through the same `merge` prop.
- The cell maths was moved to `src/_engine/utils/CellKey.ts` by p353 Phase 1.

Sections:

1. The `merge` prop and its kernel seam, the queue, explicit ids, the `AUTO` buckets.
2. The schema part: a mesh's `merge`, the scene's `mergeGroups` (an explicit group's settings,
   `AUTO`'s defaults), the streaming cell size warning and the spanning group warning.
3. Imported assets: the `merge` custom prop and `spawnImportedAsset`'s `merge` option.
4. The scene-load step: the scene's members hidden from its first frames, the `entered` hook
   building (and awaiting the worker builds already running) before the loader's `loadEndFn`.
5. The exit check (500 `AUTO` meshes, 3 materials, 4 cells), the SBP budget, the baselines.

As built, section 1 (2026-11-10):

- `MeshProps.merge?: MeshMergeDef` (`kernel/mesh/Mesh.ts`, the type `import type` from
  `MergeTypes.ts`): `string | MeshMergeOptions` (`{ group?, cellSize?, maxVertices? }`, `group`
  defaulting to `'AUTO'`; the sizes only for `AUTO`), both on `aekasha/merging`.
  `createMeshEntity` hands it, last, to the handler `merging()`'s install sets
  (`setMeshMergeHandler`, `@internal`, as `setAutoLodResolverLoader`); without one it warns once
  and the mesh is drawn on its own.
- `MergeAuto.ts`: the queue (`queueMerge`: an empty id, an `auto:` id or a size that isn't a
  finite number over 0 warns and is dropped; a later `merge` for the entity replaces it) and its
  resolution (`collectQueuedJoins`, in creation order, the joins returned to `MergeGroups.ts`'
  `resolveQueuedMerges`, which adds them: no import cycle), run first by the build system and by
  `buildPendingMergeGroupsAsync`. A queued entity deleted meanwhile is dropped;
  `addToMergeGroup` with another id wins over a queued one, `removeFromMergeGroup` drops one
  without a warning; `getMergeGroupOf` answers only once it has joined.
- `AUTO` (`pickAutoGroup`): the key is the material's registered id (else its uuid: a clone
  carrying the id is then refused by the group), the attributes' names and item sizes, both
  shadow flags, the layers' mask, whether the entity is `PERSISTENT` (its group is then
  persistent), and the cell size; the cell is x/z only (`worldToCell` of the world position read
  from the `TRANSFORM` at the resolution), as streaming's cells. The id is
  `auto:<FNV-1a of the key, base 36>:<cx>,<cz>:<n>`, cell coordinates rather than a packed key
  (no range limit, readable). A refused mesh warns (`merge 'AUTO': …`) before a bucket is picked,
  so no group is opened for it (`getMergeRefusal` takes the group as optional: without one, only
  what every group refuses). A bucket counts the vertices that joined its open group (a removed
  member isn't taken off: it opens the next group early, never late); the first member of a group
  goes in whatever its size. When its open group is gone, the bucket goes back to the first id
  after the full groups still alive, so a scene's next load gets the same ids.
- `addToMergeGroup('AUTO', ids)` queues them as the prop does; `createMergeGroup` throws on
  `'AUTO'` and on an `auto:` id. An `AUTO` group (`MergeGroupData._isAuto`) is deleted when a
  build finds no member left; an explicit one keeps Phase 1's behaviour (its mesh leaves the
  scene). `createGroup` moved to `MergeState.ts` (`MergeGroups.ts` stays under 800 lines).
- Not in §3: `MERGE_GROUP.cellKey` (§2): the `AUTO` id carries the cell.
- Tests: `MergeAuto.test.ts` (the queue, the object form, invalid defs, a deleted queued mesh,
  add and remove against the queue, `addToMergeGroup('AUTO')` and the reserved ids, 3 materials ×
  4 cells = 12 groups, the shadow flags and attributes in the key, the same ids on a second load
  after a bucket overflowed, the cap, a mesh's cell size and its pose at the resolution, a
  refusal, a persistent member through `clearNonPersistent`, an emptied group deleted and its id
  reused), and `Mesh.test.ts` (the warning without `merging()`). The overflowed bucket's ids were
  found wrong by the test first (`:2` on the next load).

As built, section 2 (2026-11-10):

- `MergingSchema.ts`' `mergingSchemaPart` (feature `merging`; on `aekasha/schemas`, last in the
  gatherer's `ENGINE_SCHEMA_PARTS`, so `.schemas/`' new fields come last): a mesh's `merge`
  (`MeshMergeDefSchema`: `AUTO`, a group id, or `{ group?, cellSize?, maxVertices? }`, the cap
  an integer) and a scene's `mergeGroups` (an `AUTO` entry `{ id: 'AUTO', cellSize?,
maxVertices? }` or a group's `{ id, castShadow?, receiveShadow? }`, strict, so `AUTO` with a
  group's fields fails; an id listed twice fails). A group id isn't empty, `AUTO` or an `auto:`
  one. No `persistent` in a scene entry: a scene's groups are its own. `SceneData.mergeGroups`
  names the types with `import type` (`SceneMergeGroupEntry`, `SceneAutoMergeEntry`).
- `MergeSceneSettings.ts`: the `sceneRegistered` hook keeps each scene's entries and its JSON
  streaming cell size. The defaults moved here from `MergeAuto.ts`. The scene is the loading one,
  else the current one (`getActiveSceneMergeSettings`): an `AUTO` mesh without its own sizes takes
  the scene's, and a group made on first use (`addToMergeGroup`, a mesh's `merge`) takes its
  entry's settings; `createMergeGroup`'s own options don't read the scene.
- The streaming warnings, each once per scene: an `AUTO` cell size (the scene's or a mesh's) that
  doesn't divide the streaming cell size, at the resolution; a build whose members' positions are
  in two streaming cells, at `applyBuild` (any group). Only the JSON's `streaming` is seen
  (`setSceneStreamingSettings` in code isn't: merging imports nothing of streaming's). A
  streamed member that goes collapses in place: a group doesn't load, unload, prime or fade with
  a cell (Phase 5's docs say so; the group mesh pops where streaming would fade its members).
- Tests: `MergingSchema.test.ts` (the mesh and scene fields, an inline mesh's), `MergeAuto.test.ts`
  (the scene's `AUTO` defaults and a mesh's own options, a group's entry applied in its scene
  only, both warnings once), `devTools/gather/engineSchemas.test.ts` (the fields, `merging` in
  the manifest for either field). `yarn gatherAppData`: the generated data unchanged (no scene
  uses the fields yet), `.schemas/mesh.schema.json` and `scene.schema.json` regenerated.

As built, section 3 (2026-11-10):

- The `merge` custom prop (`kernel/assets/import/CustomProps.ts`): a string, trimmed, on
  `ParsedCustomProps.merge`; another value (or an empty string) is a parse warning and dropped.
  The id's rules are checked when the mesh joins (`queueMerge`). Not done:
  `customPropTemplates.blend` (a binary Blender file) has no `merge` prop yet; whoever edits it
  in Blender adds one.
- `SpawnImportedParams.merge?: MeshMergeDef`: each visible piece's `merge` is its `meshProps`
  entry's, else its node's custom prop, else the spawn's, which leaves out every node of a
  physics group (an `index`, or the nodes without one, as `ImportPhysics.ts` groups them) whose
  rigid node isn't `FIXED`: the anchor moves with the body. A node's own prop in such a group is
  kept, and refused (warned) when it joins.
- Found here, for every `merge`, not only imports: `createPhysicsEntity` adds the body's
  components after an `await`, so a queued mesh could join before its dynamic body existed and
  be drawn frozen. The resolution keeps a mesh queued while its creation is pending
  (`TAG_IS_PHYSICS_OBJECT`, added at once, without `COLLIDER`, added with the `BODY_*`; a failed
  creation takes the tag off), so the refusals see the body.
- Tests: `CustomProps.test.ts` and `SpawnImported.test.ts` (new, the kernel's: the handler a
  spy, so the order of the three sources and the moving groups left out), `MergeAuto.test.ts`
  (a fixed and a dynamic body waited for, then merged and refused). For Phase 5: the Hub's
  imported asset pages list the `merge` custom prop and the spawn option.

As built, section 4 (2026-11-10):

- The scene hooks (`installMergeGroups`): `loadStart` marks a load running
  (`setMergeSceneLoading`, `MergeState.ts`); `entered` is the scene step,
  `buildSceneMergeGroupsAsync` (§6's `buildSceneMergeGroups`): it joins the queued `merge`s and
  builds every pending group, awaiting the worker builds, up to three rounds (a worker build
  dropped because a member left marks its group again), then ends the load's state and lets go of
  the holds; `loadSettled` does the last two for a load that failed before `entered`. A failed
  build or merge code load is logged (the load doesn't fail): the members are drawn on their own
  until the build system builds them.
- The build system does nothing while a load runs, so a scene's groups are built once, after its
  code placed its meshes and physics created their bodies (`merging()`'s `entered` runs after
  physics' when it's listed after `physics()`, as the template does; listed before, a member
  whose body isn't created yet stays queued past the step and the build system takes it).
- Holds (Phase 1's GPU memory finding): a mesh that joins during a load (a queued `merge`, or
  `addToMergeGroup`) gets `TAG_DRAW_HELD`, the kernel's draw hold, from merging
  (`holdForSceneLoad`), unless something else holds it already; the step lets go of only the
  holds it added (`releaseSceneLoadHolds`). So a scene's members are never drawn on their own,
  and their own geometry is never uploaded; a refused one is drawn once the step is done.
- Not handled (for Phase 5's docs, or a follow-up): a streaming cell loaded during play makes
  its members' meshes outside a load, so they're drawn on their own (primed and held by
  streaming meanwhile) until the next frame's build, and the group mesh isn't primed by streaming
  (its first draw may compile). `testDebugScene`'s `p372_grid` is now built by the step (its
  scene code adds the boxes during the load): section 5 records its baselines.
- Tests: `MergeAuto.test.ts` (through the kernel's scene hooks: held while loading, the system
  waiting across frames, built and let go of at `entered`, a refused mesh shown; another owner's
  hold left; a failed load's holds let go of and the system building). Each guard was checked
  failing without its code (the system's wait, the hold).

As built, section 5 (2026-11-10):

- The check in `testDebugScene` (`createAutoMergeCheck`, under the right block): 500 boxes of
  `p372_autoBox` (an inline geometry of the scene JSON, used by nothing else), the materials
  `p372_autoMatA`-`C` in turn, in a 10 × 10 × 5 lattice at x 4.2-6.72, y -3.3 to -5.82, z -0.8 to
  0.8; the scene's `mergeGroups: [{ id: 'AUTO', cellSize: 2 }]` makes that four cells (x 4-6 /
  6-8, z -2-0 / 0-2). 496 come from the scene code, the bottom row's four corners from the JSON
  (`p372_autoJson_*`, `"merge": "AUTO"`); the manifest names `merging`.
- Measured 2026-11-10 in Chrome on macOS, debug env, 1000 × 700, through the test bridge
  (`whenSceneReady`, then a `LATE_MAIN` system after the render), the same on WebGPU and WebGL2:
  12 groups (`auto:<hash>:2,-1:0` …, 19-71 members, 456-1 704 vertices), 500 members merged (the
  4 JSON ones among them), none held, each group built once (`rebuilds` 1: the scene step);
  `p372_autoBox`'s position attribute never uploaded (three's backend has no data for it; after
  dissolving the 12 groups it has), the 12 group geometries uploaded. Draws 49 merged, 534 after
  `dissolveMergeGroup` of the 12 (+485: three boxes past the right edge of the 1000 × 700 view are
  culled on their own, 36 triangles); the merged and dissolved images differ in 5 of 700 000 pixels
  on WebGPU and 4 on WebGL2, all at the lattice's lower right corner by the view's edge (two box
  corners' coverage, 27 and 30 levels, and three by 1 level: the merged vertices are baked
  relative to the group's centre, Phase 2's rounding).
- `yarn sbp --profile all` found `BatchedMesh` (about 18 kB minified, +4.6 KiB gzip in
  `three`) in the app's first download since section 1: `MergeEligibility.ts`' `instanceof
THREE.BatchedMesh` had been there since Phase 1, but only `testDebugScene` (a debug scene, not
  in a production build) called `addToMergeGroup` until section 1's build system started joining
  the queue. Found by building each commit with the production gather and diffing the minified
  chunk's identifiers (`_initMatricesTexture`, `addGeometry`, …). The checks read three's type
  flags now (`isMesh`, `isSkinnedMesh`, `isInstancedMesh`, `isBatchedMesh`; three as a type
  import there), and `three` is back at its baseline. Then `_engine/features/merging` 2.8 →
  6.0 kB gzip in the first download (8 modules: `MergeGroups` 2.8, `MergeAuto` 1.3, `MergeState`
  0.8, `MergeEligibility` 0.8, `MergeSceneSettings` 0.7, `MergeInPlace` 0.6, `MergeRanges` 0.3,
  each gzipped alone) and `assets/index.js` 377.4 → 380.4 KiB: the budgets raised to 6 KiB and
  381 KiB (`sbp.config.ts`, decided over moving the AUTO bucketing and the in-place writes into
  the lazy merge chunk); `utils/CellKey.ts` is in the first download now (merging's
  `worldToCell`). The embeds unchanged.
- Baselines (2026-11-10): `yarn verify:scenes` failed only on `testDebugScene` (its snapshot in
  the four configurations, only at the new lattice; its debugger shots of the Assets tab and the
  profiler's Objects and GPU memory); the other 128 runs passed, `p372_grid` (now built by the
  scene step) unchanged, no hash, character path or console error changed. Then
  `yarn verify:scenes --only testDebugScene --update` (5 recorded) and
  `yarn verify:baselines --update` (`api.json`: `MeshMergeDef` and `MeshMergeOptions` on
  `aekasha/merging`, `mergingSchemaPart` on `aekasha/schemas`, the new internal modules;
  `docs.json` merging 65 / 65; the three `bundle*.json`); no debug code in any build.

### Phase 4 — Adoption and measurements

1. largeWorld's static props (and its imported level pieces) use `AUTO`.
2. Record draws, triangles and CPU frame time before and after (profiler, main + shadow pass) in
   this file.

**Exit:** largeWorld's draw count drops by the measured amount with no visual change, on both
backends.

Decided when it started (2026-11-10):

- **largeWorld has no imported level pieces**, and few static meshes: 8 props in 3 materials, 5
  resting objects and the barbell in one. With the default 32 m cells `AUTO` saves about 3 draws
  per pass (most props are alone in their cell). So the scene gains a **ruins kit**: a few
  hundred static wall, pillar and floor pieces built from a few geometries, in clusters on the
  terrain, all `merge: 'AUTO'`, so the measurement shows what merging is for (many small static
  pieces). App patch; the scene's look and its baselines change.
- **The three `offFrustum` props stay on their own**: they show the ECS frustum culling
  (`ecsFrustumCullingEnabled`), which a merged member's own flags don't do (§7). The crate stack
  hovers (`HoverEffect` writes its `TRANSFORM` every frame), so it isn't merged either.
- **`AUTO` cell size 50 m** (the scene's `mergeGroups`): 4 × 4 cells on the 200 m terrain, a
  group's bounding radius (at most about 36 m) under the DEFAULT domain's oversized threshold
  (its 24 m cells × 2).
- **"Before" is the same scene with every group dissolved** (`dissolveMergeGroup`), measured in
  the same run, as Phases 1-3's checks did.

Sections:

1. The existing props: `merge: 'AUTO'` on the five in-view static props, the resting objects and
   the barbell; the scene's `mergeGroups: [{ id: 'AUTO', cellSize: 50 }]`.
2. The ruins kit: its geometries and materials, the seeded clusters on the terrain, `merge:
'AUTO'`.
3. The measurements: draws and triangles per pass (main and shadow) and the CPU frame time,
   merged against dissolved, on WebGPU and WebGL2, the images compared.
4. The baselines (`yarn verify:scenes`, `yarn verify:baselines`, `yarn sbp`).

As built, section 1 (2026-11-10):

- `largeWorld.ts`: `merge: 'AUTO'` on `STATIC_PROPS` but the `offFrustum` ones, on the
  `RESTING_OBJECTS` and on the barbell; `largeWorld.scene.json`: `mergeGroups: [{ id: 'AUTO',
cellSize: 50 }]` (its manifest names `merging` now) and the description.
- Loaded in Chrome (debug env, through the test bridge): 11 members in 8 groups, each built once
  by the scene step, none held, no merge warning. Five are one prop alone (the rocks, platforms
  and wall are in different 50 m cells); the resting objects make three (3, 2 and the barbell).

As built, section 2 (2026-11-10):

- `largeWorldRuins.ts` (next to the scene file; `createRuins(world, terrain, materials)`, the
  materials `createStaticProps` now returns): 8 hand-placed sites (`RUIN_SITES`, each with its
  rubble inside one 50 m cell, away from the cell edges), each a floor of 2 m tiles
  (`largeWorldPlatformMat`), walls round its edge broken to 0.6-3 m and pillars at the corners and
  in two inner rows (`largeWorldWallMat`), and 12 tumbled rubble stones (`largeWorldRockMat`).
  Four registered geometries (`largeWorldRuin{Floor,Wall,Pillar,Rubble}Geo`; the walls and
  pillars scaled to their height, so non-uniform scales are merged too), a share of each kind left
  out, all from `createSeededRandom(7)`: the same ruins on every load. No app ids (only
  `debugData` names).
- Loaded in Chrome (debug env): 398 ruin pieces + the 11 props = 409 members in 28 groups (each
  site 3, one per material; `largeWorldWall1`, `largeWorldPlatform1` and both rocks in a site's
  groups; `largeWorldPlatform2` still alone; the resting objects' three), 12-25 members and
  312-776 vertices each, each built once, none held, no merge warning.

As built, section 3 (2026-11-10): the measurements.

- How: Chrome on macOS, prod test mode (`?isProdTest=true&aekTest=true&startScene=largeWorld`),
  1000 × 700, through the test bridge, a harness in the session's scratchpad (not committed). Per
  frame the main loop's frame probe (`setFrameProbe`, as the profiler's CPU figure: the loop
  function's time, the render's encoding included) and every draw (`renderer.info.update`, both
  backends) counted by the camera it was drawn with (`renderer._renderObjectDirect` wrapped, the
  outer camera put back after a nested render: a shadow map renders lazily inside the main pass's
  first draw that samples it). 60 frames to settle, 240 measured merged, every group dissolved
  (`dissolveMergeGroup` of the 28), 60 to settle, 240 measured. The images on a second load:
  `freeze()`, a snapshot, every group dissolved (the members show at once), a snapshot.
- The main camera draws the scene twice per frame (the ambient occlusion PostFX's scene pass
  and the colour pass), plus two fullscreen passes; three draws of fullscreen quads (4 triangles)
  on an orthographic camera are the same in both.
- With the default sky box (`basicSkybox`), the scene's `largeWorldSun` casts the shadows: its
  shadow camera is a fixed ±25 m box around the origin, which reaches no ruin site. With
  `dayNight` (`setActiveSkyBox('dayNight')`, paused at 10:00), the sky's sun casts them, its
  shadow following the camera, and the ruins are in it.

| Sky box, backend            | Main draws (2 passes) | Shadow draws | Triangles (main / shadow) | CPU frame median (p10-p90) |
| --------------------------- | --------------------- | ------------ | ------------------------- | -------------------------- |
| basic, WebGPU, merged       | 76                    | 18           | 287 140 / 135 894         | 2.25 ms (1.48-2.81)        |
| basic, WebGPU, dissolved    | 762                   | 19           | 287 164 / 134 694         | 3.23 ms (2.61-3.70)        |
| basic, WebGL2, merged       | 76                    | 18           | 287 140 / 135 894         | 2.48 ms (1.67-3.81)        |
| basic, WebGL2, dissolved    | 762                   | 19           | 287 164 / 134 694         | 3.59 ms (2.82-3.99)        |
| dayNight, WebGPU, merged    | 76                    | 15           | 287 140 / 134 846         | 2.39 ms (1.62-3.44)        |
| dayNight, WebGPU, dissolved | 762                   | 53           | 287 164 / 134 846         | 3.77 ms (3.23-3.92)        |
| dayNight, WebGL2, merged    | 76                    | 15           | 287 140 / 134 846         | 2.27 ms (1.51-2.82)        |
| dayNight, WebGL2, dissolved | 762                   | 53           | 287 164 / 134 846         | 3.40 ms (2.85-3.81)        |

- So merging the 409 members into 28 groups takes the main camera's draws from 381 to 38 per
  pass (686 a frame: 38 members are outside the view on their own, while their groups are drawn
  whole), and the day-night shadow pass's from 53 to 15; the triangles stay the same within 0.01 %
  (the groups are drawn whole, but almost every ruin is in view). The CPU frame time drops by
  about 1.0-1.4 ms (30-37 %) on both backends; medians move by about 0.3 ms between runs.
  The draw counts are the same in every frame and on both backends.
- Images, merged against dissolved (700 000 pixels): 606 differ on WebGPU (88 by more than 2
  levels, at most 43), 853 on WebGL2 (83, at most 41); with `dayNight` 699 (105) and 857 (103).
  All at the ruin sites. With the PostFX off (`setPostFxEnabled(false)`) 103 on WebGPU (78 by more
  than 2) and 81 on WebGL2 (68): the ambient occlusion turns the depth's rounding into the 1-level
  differences over the ruins' surfaces, and what's left are single pixels on the pieces' edges and
  where they intersect, flipping coverage (the merged vertices are baked relative to the group's
  centre, Phase 2's rounding). Side by side, no difference is visible.

### Phase 5 — Handbook, docs and versioning

1. `docs/techniques/terrain-modular-kits.md` (p301 §5 row): modular kit terrain and tile-chunk
   worlds, built on groups. Page template from p301 §5; p374 adds the array-material variation.
2. A Mesh merging feature page on the Hub (`hub/pages/features/mesh-merging/`, `aek:covers` the
   nested file's section, with p370 §3's decision table and when not to merge), linked from the
   asset optimization page; whether an example scene is built for it is asked when the plan
   starts (largeWorld's adoption may be enough); `yarn hub:build`.
3. `features/merging/CLAUDE.md` (a `## Mesh merging` section) and its line in the root's map, the
   root's Bootstrap flow (the features the template lists), `readme.md` Features.
4. Engine minor, app patch; `CHANGELOG.md`.

## 9. Versioning

Engine minor (components, API, schema). App patch (largeWorld adoption).

## 10. Risks

| Risk                                                                        | Mitigation                                                                                                                                                                                                              |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A member moved without `updateMergeMember` draws at its old place           | Debug moved-member check (§3); the API is the only documented way to move a merged member                                                                                                                               |
| `AUTO` groups too big for culling, or too small to matter                   | Per-scene `cellSize` / `maxVertices`; Phase 4 measures; p373 shows group sizes                                                                                                                                          |
| Merged buffers double memory while members keep their geometry refs         | Member geometry stays CPU/GPU-resident only while some unmerged mesh uses it: the member's own Object3D is hidden, so three never uploads a geometry only merged members use. Verify in Phase 1 with the GPU memory tab |
| Worker builds leave a frame where neither the old nor the new mesh is right | Members stay visible until the new group mesh replaces them in one frame                                                                                                                                                |
| Compatibility key misses a material property that changes rendering         | The key uses the material ref (same material instance), not a property hash; variants (`matOverrides`) are separate materials                                                                                           |

## 11. Open questions

1. Should `AUTO` also group across materials when a p374 palette covers them? Yes, but that's
   p374 D4.
2. Should the group mesh carry per-member vertex colours for debugging (a "colour by member" mode)?
   p373 D3 decides; it would need a debug-only extra attribute.
