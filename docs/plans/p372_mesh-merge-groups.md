Status: in progress | Phase 1 implemented
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

### Phase 2 — In-place updates (§3)

`updateMergeMember`, remove by collapse, compaction, disable/enable, the moved-member check.
**Exit:** moving one member rewrites only its range (no rebuild counted); removing 30% compacts.

### Phase 3 — JSON, AUTO and scene load (§4, §6)

The cell maths to `src/_engine/utils/` unless p353 moved it (p370 §13), `merge` in the feature's
schema part and `createMeshEntity`, scene `mergeGroups`, `AUTO` buckets, imported asset custom
prop and option, the scene-load step. **Exit:** a scene with 500 `AUTO` meshes in 3
materials over 4 cells loads with 12 groups, and its first frame is already merged.

### Phase 4 — Adoption and measurements

1. largeWorld's static props (and its imported level pieces) use `AUTO`.
2. Record draws, triangles and CPU frame time before and after (profiler, main + shadow pass) in
   this file.

**Exit:** largeWorld's draw count drops by the measured amount with no visual change, on both
backends.

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
