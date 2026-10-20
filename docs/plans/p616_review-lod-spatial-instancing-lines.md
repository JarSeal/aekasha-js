Status: in progress | Phases 0-5 done
Category: Refactoring, Documentation, LOD, Rendering
Epic: p600_whole-codebase-refactoring-and-documentation.md (Stage C)
Blocks: p621_hub-docs-readme-and-claude-md-final.md
Related: \_DONE_p612_review-ecs-loop-config-init.md (Phase 7's `LodSystem.ts` link, §1.2), \_DONE_p605_coding-standards-and-documentation-tooling.md (Phase 5's `Vec2Node` / `Vec3Node`, §1.2), \_DONE_p613_review-rendering-scene-assets.md (`kernel/render/LodFade.ts`, reviewed there; §1.4 L7), \_DONE_p615_review-sky-box.md (the plan this one follows), p622_engine-6-major.md (what waits for the major: D3), \_DONE_p050_spatial-index.md (the grid's design and its deferred optimizations), `docs/issues/three-instanced-node-attribute-leak.md` (three's, not ours: out of scope)

# Review: LOD, Spatial Index, Instancing and Lines

Applies p600 §5 (the per-file review standard) and p605's JSDoc style to every file in scope,
records the findings per file group, and fixes or files them. It also fixes a spatial grid
false negative between rebuilds, takes the per-frame lookups and allocations out of the pool
sync, the spatial refresh and light culling, puts on the entries what their own docs tell apps
to call, and gives lines the nested `CLAUDE.md` and Hub page every other feature has.

## 1. As found (2026-10-19, branch `review-lod-spatial-instancing-lines` at `5bdd370`, = `main` after p615's merge, Engine 5.6.0)

### 1.1 The stub's names, checked

The stub was written before p608's move (and p605's ratchet, which changed the counts).

| Stub | Now |
| --- | --- |
| `Lod/` (10 files), `LodSystem.ts` 1,086 lines | `features/lod/`: 12 modules (`LodSystem.ts` **1,097**, `LodChains.ts` 370, `LodSimplify.ts` 280, `LodChainGLTF.ts` 212, `LodSchema.ts` 134, `LodAuto.ts` 122, `LodTypes.ts` 115, `LodChainOptions.ts` 73, `LodImport.ts` 70, `LodBounds.ts` 66, `LodFeature.ts` 35, `LodChainRequests.ts` 23), the entry, `worker/AssetsSwitchSimplify.ts`, `debug/` (4 `_dbg__` modules, 1,596 lines) and the nested `CLAUDE.md` (two sections) |
| `Lod/Impostors/` (9) | `features/lod/impostors/`: 10 modules (`CrossQuads.ts` 483, `OctahedralImpostor.ts` 459, `OctahedralImpostorMaterial.ts` 427, `ImpostorBake.ts` 376, `ImpostorSourceHash.ts` 183, `Octahedral.ts` 149, `ImpostorSchema.ts` 123, `ImpostorExports.ts` 91, `ImpostorRegistry.ts` 60, `ImpostorFormat.ts` 42), 2 tests, a nested `CLAUDE.md` |
| `Spatial/` (`SpatialIndexSystem.ts` 1,128) | `features/spatial/`: `SpatialIndexSystem.ts` **1,108**, `SpatialGrid.ts` 447, `LightObjectCullingSystem.ts` 133, `CellKey.ts` 80, `SpatialFeature.ts` 53, `SpatialSchema.ts` 11, the entry, `CellKey.test.ts`, `debug/_dbg__SpatialGrid.ts` 706, a nested `CLAUDE.md` |
| `Instancing/` | `features/instancing/`: `InstancedMeshPool.ts` 643, `InstancedMeshPoolTypes.ts` 31, `InstancingFeature.ts` 23, the entry, a nested `CLAUDE.md` |
| `Lines/` "and the line manager" | `features/lines/`: 13 modules (`LineObject.ts` 521, `LineBackendFat.ts` 338, `Lines.ts` 206, `LineBuilders.ts` 166, `LinePulse.ts` 123, `LineTypes.ts` 120, `LineWriter.ts` 94, `LineBackendThin.ts` 93, `LineBackend.ts` 90, `LineEntity.ts` 59, `LinesFeature.ts` 34, `LineRegistry.ts` 28, `LineSystem.ts` 27) and the entry. The line manager (`core/LineManager.ts`) is gone: p608 split it into these. **No nested `CLAUDE.md`, no Hub feature page** (§1.4 N) |
| "the LOD sections of CLAUDE.md (they become nested files)" | Done by `_DONE_p605`: `features/lod/CLAUDE.md` (LOD chains, LOD selection), `features/lod/impostors/CLAUDE.md`, `features/spatial/CLAUDE.md`, `features/instancing/CLAUDE.md` |

Two files are over the 800-line limit: `LodSystem.ts` and `SpatialIndexSystem.ts`. Three functions are over 150 lines:
`createOctahedralImpostorNodes` (`OctahedralImpostorMaterial.ts:176`, 217 lines) and two debug tab
builders, `_createLodDebugGUI` (`_dbg__LOD.ts:212`, 425; its `content` closure 324) and
`_createSpatialGridDebugGUI` (`_dbg__SpatialGrid.ts:335`, 372; `content` 197).

In scope (D1): the four feature folders with their `debug/` modules (structure and docs only:
p800 rewrites the panels) and nested `CLAUDE.md` files. Outside them, only what a change here
touches: the kernel seams `kernel/ecs/LodTargets.ts` and `kernel/ecs/SpatialMembership.ts` (their
docs), the imports a moved name breaks (the kernel's assets types import LOD chain types; the
physics, character and ray debug modules import from `lines/Lines.ts`), and the Hub's LOD,
spatial index and new lines pages. Not in scope: `kernel/render/LodFade.ts` (p613 reviewed it;
only its entry exposure, L7), `schemas/SpatialDomainSchema.ts` and `schemas/LodChainSchema.ts`
(p619's).

### 1.2 The stub's inputs, checked

- **p605 Phase 5's `notExported`:** `Octahedral.ts:106-107`'s local `Vec2Node` / `Vec3Node`, named
  by the exported `encodeOctahedralNode` / `decodeOctahedralNode`. `OctahedralImpostorMaterial.ts`
  declares the same two (and `Vec4Node`) for its own use. Writing `THREE.Node<'vec2'>` in the two
  signatures removes the warning with no new export (D7).
- **p612 Phase 7's link:** `LodSystem.ts:993` (`lodApplySystem`'s doc) links `{@link LodTarget}`,
  and the file imports only `LodData` and `LodResolvedLevel` from `LodTypes.ts`. An `import type`
  fixes it (D7).
- **The hot loops:** CLAUDE.md quotes LOD selection at about 0.15-0.2 µs per entity (largeWorld's
  3,500 pool instances). The selection reads its storages once per frame, as the standard asks.
  The spatial rebuild doesn't (P2), nor does the pool sync that runs over the same 3,500 instances
  every frame (P1). Phase 0 measures all of them; Phase 2 measures again.
- **The three r186 traps** in the nested files: a chain's shared vertex buffers freed by
  disposing any of its geometries (`LodChains.ts`), a plain mesh's fade copy kept until it fires
  `dispose` (`LodSystem.ts`), `tangentLocal` not rotated per instance and double-sided normal maps
  negating the frame (`CrossQuads.ts`), the instance matrix applied before `positionNode` and kept
  private (`OctahedralImpostorMaterial.ts`), `VSMShadowMap` drawing receivers into the shadow
  map, a shadow map rendered once per node frame, `NodeMaterial.clone()` losing `alphaTest`, a
  16 / 8-bit index widened to 32 bits on upload (`ImpostorSourceHash.ts`). Each is a comment at
  its code; none is a `@remarks` yet (D9).

### 1.3 Documentation (the ratchet's `docs.json`)

| Folder | Exports | Members | Undocumented exports |
| --- | ---: | ---: | --- |
| `features/lod` | 60 / 72 | — | `InstancedLodBounds`; `TransferableLodChain`; `DEFAULT_LOD_CHAIN_OPTIONS`, `LodChainOptions`, `ResolvedLodChainOptions`; `LodChain`, `LodChainLevel`; `SimplifiedLevel`, `SimplifiedLodChain`; `getLodDebugOptions`, `registerLodDebugGUI`; **`LodDef`** |
| `features/lod/impostors` | 64 / 73 | — | **`CrossQuads`, `CrossQuadsOptions`**; `disposeBakeMaterials`; `IMPOSTOR_KINDS`, **`ImpostorKind`**; `ImpostorRecord`; **`OctahedralImpostor`, `OctahedralImpostorOptions`**; `OctahedralImpostorNodes` |
| `features/lod/worker` | 1 / 1 | — | |
| `features/spatial` | 41 / 55 | 20 / 38 | `CELL_AXIS_*` (4), `CellCoords`; `lightObjectCullingSystem`; **`SpatialGrid`, `SpatialGridOptions`, `SpatialGridStats`**; **`SpatialDomainOptions`**, **`isInSpatialDomain`**, `getOracleMismatchCount`, `isSpatialGridOracleEnabled`, `registerSpatialIndexDebugGUI` |
| `features/instancing` | 7 / 12 | 26 / 35 | **all five option and result types** of `InstancedMeshPool.ts` |
| `features/lines` | 56 / 70 | 38 / 54 | `LineOpacityNode`; `createThinLineBackend`; **the five `*ToSegments` builders**; `LineColorUniforms`; `LineRegistry.ts`' five (`@internal` without a summary); **`LineProps`** |

54 exports and 43 members; **bold** names are on an entry. The `_dbg__` modules are outside
TypeDoc: 5 of their exports have no comment (`_createLodDebugGUI`, `isImpostorKindExported`,
`LOD_OVERLAY_COLOR_NAMES`, `isLodOverlayEnabled`, `_createSpatialGridDebugGUI`; G2).

### 1.4 Findings by file group

Numbered for the phases. **(bug)** marks wrong behaviour, **(perf)** per-frame cost; the rest are
hygiene, placement and API shape. Read from the code, not reproduced, unless a finding says so.
Type hygiene is clean in scope: no `any`, no `eslint-disable`, no TODO / FIXME.

**LOD selection (`LodSystem.ts`, `LodTypes.ts`, `LodBounds.ts`, `LodAuto.ts`, `LodFeature.ts`)**

- L1 Size: 1,097 lines. Its parts are separate already: the settings (fade seconds, bias, the
  budget, the debug options and frame stats, `:67-437`), the plain-mesh and per-kind fades
  (`:91-245`), the measuring (camera terms, `measureEntity`, `getScreenSize`, `getLodWorldSphere`,
  `measureLodEntity`, `:676-988`), and the hooks, selection, apply, fade system and install.
  No function is over 150 lines.
- L2 API gaps: the docs send apps to names no entry has. `refreshLodBounds` (`:566`: the nested
  `CLAUDE.md` says "call `refreshLodBounds` after they change"), `setLodMaxSelectionsPerFrame`
  (`AppConfig.lod.maxSelectionsPerFrame`'s JSDoc names it), `getLodFadeSeconds`, and `LodLevelDef`
  (named by `LodDef`, which is on the entry). `setLodDebugOptions` / `LodDebugOptions` are debug
  API the tab uses.
- L3 Exports that aren't on the entry and aren't `@internal`: `getLodFadeSeconds`,
  `getLodMaxSelectionsPerFrame`, `getLodDebugOptions`, `setLodDebugOptions`, `LodDebugOptions`,
  `lodSelectionSystem`, `lodApplySystem`, `lodFadeSystem`, `getLodSelectionCamera`, `LodMeasure`,
  `measureLodEntity`, `registerLodDebugGUI`, `LOD_AUTO_REFERENCE_HEIGHT`, `lodDefFromChain`,
  `getInstancedLodBounds`, `InstancedLodBounds`, `LodResolvedLevel`. Their users are the feature,
  its debug tab and instancing.
- L4 Undocumented: `LodDef` (on the entry), `registerLodDebugGUI`, `getLodDebugOptions`,
  `InstancedLodBounds`. `:993`'s link (§1.2).
- L5 Trap without a `@remarks`: adding a `LOD` to an entity that has one replaces it without the
  remove hook, so the old levels keep their refs and a running fade its copy. `setMeshLod` removes
  first (`kernel/mesh/Mesh.ts:361`); a direct `world.addComponent(id, LOD, …)` doesn't.
  `LodData`'s JSDoc tells apps how to add one.
- L6 Stale: `Lod/LodBounds.ts` (`LodSystem.ts:56`, `LodTypes.ts:62`), `Lod/LodSystem.ts`
  (`LodTypes.ts:68`), `ECS/LodTargets.ts` (`LodSystem.ts:284`), `MeshManager.ts` (`LodAuto.ts:2`).
- L7 The `LodTarget` contract (on the entry, with `registerLodTarget`) says a target with
  `setFade` cross-fades, but `enableLodDither`, `createLodFadeAttribute` and `LOD_FADE_OPAQUE`
  (`kernel/render/LodFade.ts`), which a fading target needs (the pool calls them), are on no
  entry. `lodDither`'s own JSDoc says custom node materials "can combine it".
- L8 Otherwise clean: the selection loop reads its storages once per frame and allocates nothing
  (the queue, cursor and pending arrays are per world and reused); no race (nothing async but
  `AUTO`, which `setMeshLod` cancels on a later call, a geometry swap or the entity's delete).

**LOD chains (`LodChains.ts`, `LodSimplify.ts`, `LodChainGLTF.ts`, `LodChainOptions.ts`, `LodChainRequests.ts`, `LodImport.ts`, `worker/`)**

- C1 One path per name: `LodChains.ts:42` re-exports the option types, `LodSimplify.ts:17-22`
  the options and their resolver, `LodChainGLTF.ts:23` `GLTF_LOD_FORMAT_VERSION`. The kernel
  imports `ResolvedLodChainOptions` through `LodSimplify` (`kernel/assets/AssetsAPI.ts:39`,
  `AssetsAPITypes.ts:7`).
- C2 Exports that aren't on the entry and aren't `@internal`: `getLodChains`,
  `getLodChainOfLevel`, `isLodChainPending`, `getPendingLodChain`, `registerPrebuiltLodChain`,
  `LodChainLevel`, `releaseLodChain` (the Assets tab's "release"; public-shaped, no app use), and
  the GLB transfer types and functions.
- C3 Undocumented: §1.3's chain types and options.
- C4 Stale: `LodChains.ts:3` "Nothing selects a level yet (p348)"; `Import/GLTFExtract.ts`
  (`LodChainGLTF.ts:58`), `Import/ImportRegistry.ts` (`LodImport.ts:2`).
- C5 Otherwise clean: the generation re-checks the base after its `await` (`:228`), a pending
  generation is shared, the module and meshoptimizer load on first use, and the delete listener is
  added with the first chain, not at load.

**Impostors (`impostors/`)**

- I1 Size: `createOctahedralImpostorNodes` is 217 lines: the vertex part (the instance basis, the
  billboard, the grid position, the varyings, `:186-237`), the per-frame sampler (`:252-316`), and
  the blend, normal and depth nodes. A TSL graph builder split into helpers builds the same graph.
- I2 `Octahedral.ts`' `Vec2Node` / `Vec3Node` (§1.2).
- I3 Two types named `ImpostorShading`: `ImpostorBake.ts:83` (`'AUTO' | 'PHONG' | …`, the option)
  and `ImpostorSchema.ts:116` (the resolved `{ type, params }`, undocumented). Only the first is
  public (it's in `CrossQuadsOptions`); the second is on no entry.
- I4 `ImpostorSchema.ts:5-11` is a `/** */` module comment followed by a `const`: TypeDoc attaches
  it to `Vec3Schema`. The schema's shape keys `alphaTest`, `shading`, `debugData`, `$schema`,
  `__sourcePath` have no description.
- I5 Duplicated: `CrossQuads.ts`' and `OctahedralImpostor.ts`' `getRegistered` / `deleteLeftovers`
  differ only in the slot names. Small; left as is unless Phase 4 finds a third copy.
- I6 Stale: "core loads no zod" (`ImpostorFormat.ts:3`), "core imports no zod"
  (`ImpostorExports.ts:24`).
- I7 Undocumented: §1.3's impostor names (four of them on the entry).
- I8 Otherwise clean: every bake restores the renderer state in a `finally`, disposes its bake
  materials, dilate copies and frame target (and its atlases when it throws), and clears every
  atlas before the first cell. A registered result is a cache hit retagged to the loading scene.

**Spatial index (`SpatialGrid.ts`, `SpatialIndexSystem.ts`, `LightObjectCullingSystem.ts`, `CellKey.ts`, `SpatialFeature.ts`, `SpatialSchema.ts`)**

- S1 **(bug)** Between a removal and the next rebuild, a query can miss a live member. Removal
  is a swap-remove (`SpatialGrid.ts:167`): the last slot's member moves into the freed slot, and
  the cells still hold the old slots, so the moved member is found only in the *removed* member's
  cell (its own cell's entry now points at the emptied slot, which queries skip). The nested
  `CLAUDE.md` asks a `MANUAL` owner to rebuild first, but `DEFAULT` is `DYNAMIC` and rebuilds at
  `APP_POST_PHYSICS`. Light culling then queries it at `APP_RENDER_SYNC`, so deleting any indexed
  entity in `APP_LOGIC` (a projectile mesh, a despawned pickup) can hide another mesh from its
  light for that frame. If that was the light's only receiver, the light is culled for a frame
  (a flicker). A new member is missing until the rebuild too, which only makes a light come on
  a frame late. Phase 0 reproduces it with a Node test of `SpatialGrid` (D4).
- S2 **(perf)** `refreshDomainMembers` (`SpatialIndexSystem.ts:821`), every frame for each
  `DYNAMIC` domain, does four Map lookups per member: `world.getComponent(TRANSFORM)` (the
  storage looked up again for each member, which the standard forbids in a hot loop),
  `grid.updatePosition` and `grid.updateRadius` (each `entityToSlot.get` for a slot the loop
  already has), and `localRadius.get`. largeWorld's `FOLIAGE` domain has 3,500 members.
- S3 **(perf)** `LightObjectCullingSystem.ts:57` allocates a closure per opted-in light per
  frame (`grid.queryVisit(…, (candidateId) => …)`), and the visit goes on after a receiver is
  found: `queryVisit` has no way to stop. `light.updateWorldMatrix` (`:90`) and
  `getWorldPosition` (`:51`, which updates it again) do the same work twice.
- S4 Dead per-frame write: `SpatialGrid`'s `lastCell` (`:63-70`, "not read by anything in Phase
  1") is written for every member on every rebuild and never read. S1's fix reads it.
- S5 Size: `SpatialIndexSystem.ts` is 1,108 lines: the domain registry and its settings layers
  (scene scope, the debug override, the stats, `:49-610`), membership and radii (`:612-782`), the
  rebuild (`:820-915`), and the brute-force oracle (debug env only, `:917-1065`).
- S6 API: `DEFAULT_SPATIAL_DOMAIN` (what `joinSpatialDomain` and `getSpatialDomain` take for the
  default domain) and `SpatialUpdatePolicy` (named by `SpatialDomainOptions`, on the entry) are on
  no entry. `setSpatialGridCellSize` and `validateSpatialGridQuery` (its JSDoc tells a consumer to
  call it after its own query) are public-shaped and on no entry either. The rest of what isn't
  on the entry (`releaseSceneSpatialDomains`, `registerSceneSpatialDomains`,
  `getSpatialDomainIds` / `Options` / `SceneId`, the override, the stats, the oracle,
  `computeLightInfluenceRadius`, `spatialIndexRebuildSystem`, `lightObjectCullingSystem`,
  `CellKey.ts`' helpers) isn't `@internal`.
- S7 API shape: argument order differs within the API, `registerSpatialDomain(world, opts)` and
  `getSpatialDomain(world, id)` but `joinSpatialDomain(entityId, domainId, world?)`; changing it
  is breaking (D3).
- S8 Pool instances that join `DEFAULT` are never light receivers: `meshIsVisibleReceiver` reads
  `getMeshWorldBoundingSphere`, which needs an `OBJECT3D` an instance doesn't have. Nothing in the
  template does it (largeWorld's pools join `FOLIAGE`). D5.
- S9 Detached module comments: `SpatialIndexSystem.ts:33-47` (a `/** */` before another one: the
  first is lost), `SpatialGrid.ts:5-14` (stale too: "nothing else in the engine references it
  yet"), `CellKey.ts`' header (attached to `CELL_AXIS_BITS` by accident). Stale:
  `ECS/SpatialMembership.ts` (`:728`, `:1090`), `computeIsVisible` (`:712`, a function that no
  longer exists), `SpatialGrid`'s "Phase 4" dedup stamps (`:82-87`).
- S10 Undocumented: §1.3's spatial names (seven on the entry, `SpatialGrid`'s members among them).
- S11 Otherwise clean: domain re-registration, scene scope and unregistering keep the masks and
  grids consistent, and the debug-only work (the oracle, rebuild timings, `Math.random` probes)
  sits behind `IS_DEBUG_ENV`.

**Instanced mesh pools (`InstancedMeshPool.ts`, `InstancedMeshPoolTypes.ts`, `InstancingFeature.ts`)**

- P1 **(perf)** `instancedMeshPoolSyncSystem` (`:588`) allocates a `Set` every frame (`:592`) and
  looks up `world.getComponent(entityId, TRANSFORM)` per instance (`:598`): 3,500 storage
  lookups a frame in largeWorld, whether or not anything moved.
- P2 **(bug)** A plain pool's bounds are computed at `spawn` (`:406`) and never again, so
  instances moved through their `Transform` (which the docs invite: "can be queried/moved later
  like any other entity") can leave them. three then frustum-culls the whole `InstancedMesh` while
  moved instances are on screen. An instanced LOD pool keeps the union of every placement at
  spawn (`:569`), with the same gap. Nothing in the template moves pool instances; Phase 0
  checks. D5.
- P3 API shape: `spawn(world, placements, entityOpts?)` and `despawn(world, entityId)` take a
  world besides the pool's own (`opts.world`, which owns the mesh). Instances spawned into another
  world outlive the mesh's scene there and keep slots in a disposed mesh. Breaking to change (D3).
- P4 `export type * from './InstancedMeshPoolTypes'` (`:31`) is a second path. `InstancePlacement`
  (what `spawn` takes) and `InstancedLodPoolLevel` are on no entry.
- P5 Undocumented: the five interfaces and nine of their members (§1.3). Stale: `MeshManager`
  (`:218`, `:239`, `:323-324`), `ECS/SpatialMembership.ts` (`:254`).
- P7 **(bug, found in Phase 2)** In `TYPED_ARRAY` storage mode pool instances never move after
  spawn: the store's `Transform` copy carries the slot's dirty flag (0 / 1) as its `version`, and
  only `object3DSyncSystem` clears the flag, for `OBJECT3D` holders, which an instance isn't. So
  its flag stays 1 and the sync's `_lastVersion === version` check skips every later move.
  Reproduced in Node (a move to x = 50 left the matrix at x = 1). The same mode also makes a
  `Transform` per instance per frame in the sync, and per member in the spatial refresh. `MAP` is
  the default, and the scene runner never runs `TYPED_ARRAY`.
- P6 Otherwise clean: the swap-remove patches the moved instance's slot or fade copy, a LOD-culled
  instance re-bakes from its `Transform`, and both hooks free the slot.

**Lines (`features/lines/`)**

- N1 No nested `CLAUDE.md` and no Hub feature page: lines are the one engine feature without
  either. Their traps live only in comments: a thick line is a `Mesh` retagged from `TAG_IS_MESH`
  to `TAG_IS_LINE` (else the mesh delete hook would dispose it too), `object3D` changes on a
  backend swap, the thick backend is a lazy chunk (a wide line draws 1px until it loads), a scene
  exit disposes every line that isn't `persistent` or bound to an entity.
- N2 API gaps: `createLines` returns a `LineObject` whose type isn't on the entry, and
  `beginWrite()` a `LineWriter` (neither is). The types `LineProps` names (`LineColorStyle`,
  `LineDash`, `LineAttachment`, `LineBackendChoice`, `LineGrowth`, `LineLocalTransform`,
  `LinePulseEasing`, `LinePulseMode`) aren't there either. `createLineEntity`, which
  `lines()`' own JSDoc names, isn't, nor are `bindLineToEntity`, `getLineForEntity`,
  `isFatLineBackendAvailable`, or the allocation-free writers (`writeBox3Edges`, `writeBoxEdges`,
  `writePolyline`, `BOX_EDGE_SEGMENT_COUNT`, `polylineSegmentCount`) that the per-frame refill is
  for.
- N3 One path per name: `Lines.ts:14-18` re-exports `LineObject`, `LineWriter`, `LineTypes`,
  `LineBuilders` and `LinePulse`; five debug modules import them from there.
- N4 API shape: `createLineEntity(props, entityOpts?, ecsWorld?)` and `bindLineToEntity(line,
  entityId, ecsWorld?)` take optional positional parameters (D3).
- N5 Undocumented: §1.3's line names; `LineRegistry.ts`' five `@internal` without a summary;
  `@returns (number)` and `@returns (Promise<boolean>)` (`Lines.ts:132`, `:201`) write a type,
  which the style forbids. Detached module comments: `LinePulse.ts:7-19`, `LineBuilders.ts:4-12`.
  Stale: `LineManager` (`LineEntity.ts:49`, `LineObject.ts:73`, `:100`), `MeshManager`
  (`LineEntity.ts:17`).
- N6 Otherwise clean: the refill writes in place and uploads only the written range, a backend
  swap keeps the object's place, transform and children, the thick backend's load re-checks
  `disposed`, `FIXED` lines warn once and never reallocate.

**The debug modules (`lod/debug/`, `spatial/debug/`, structure and docs only)**

- G1 The two tab builders are 425 and 372 lines (§1.1). p800 rewrites the panels; D8.
- G2 5 exports without a comment (§1.3). Stale `Lod/` paths (`_dbg__LOD.ts:47`, `:49`).
- G3 Otherwise clean: no `any`, no `eslint-disable`; they import the features' modules and the
  debugger framework only, and register their systems on first use.

**The nested `CLAUDE.md` files (K)**

- K1 Each describes its subsystem correctly as of today; D4-D7 change what they say about the
  grid between rebuilds, the pool bounds and what's on the entries.
- K2 Lines has none (N1).

## 2. Decisions (confirmed 2026-10-19, as recommended)

### D1. Scope: §1.1's files

The four feature folders with `debug/` (structure and docs: G1, G2) and their `CLAUDE.md` files.
Outside them, only the kernel seams' docs, the imports a change breaks, and the Hub's pages for
these features.

### D2. Versions

Engine **minor** (5.6.0 → 5.7.0): new names on the entries (D6), the grid fix (D4), the pool
bounds (D5), the perf work (D10). Toolkit: no change expected (its scatter feeds the pools'
`InstancePlacement`, by shape). App **patch** only if an app file changes. Project = engine.

### D3. What waits for engine 6.0.0 (p622)

Listed in p622 as candidates, not changed in a minor (as p614 and p615 did):

- The spatial API's argument order (S7): world first everywhere, or an options object.
- A pool's `spawn` / `despawn` without their `world` (P3): the pool's own.
- `createLineEntity` and `bindLineToEntity`'s optional positional parameters (N4).

### D4. The grid's false negative fixed first, with a test (S1)

`SpatialGrid.removeMember` keeps the swap-remove (dense slots: the members are iterated by
index) and patches the cells: the moved member's entry in its own cell (found through
`lastCell`) is pointed at its new slot, and the removed member's entry becomes a sentinel that
queries skip. That's one cell scan per removal, never a false negative, and `lastCell` gets its
reader (S4). A member added since the last rebuild stays missing until the rebuild (documented,
not a false negative of a member queries could see before). Test first (`SpatialGrid.test.ts`,
in Node: add, rebuild, remove a member whose slot isn't last, query at the moved member's
position): `it.fails` in Phase 0, `it` after the fix.

**Alternative:** tombstones (no move until the rebuild compacts), which needs a sparse member
iteration everywhere `memberAt` is used.

### D5. The pool bounds grow with their instances (P2); `DEFAULT` receivers documented (S8)

- **P2:** `instancedMeshPoolSyncSystem`, which already visits each moved instance, grows its
  mesh's bounds when the instance's sphere leaves them (allocation-free, never shrinking, like
  `removeAt` already assumes). A LOD pool grows every level mesh's. No change for pools whose
  instances don't move, so no template scene should change (the hashes say).
- **S8:** a `@remarks` on `spatialDomain` and in the spatial index's `CLAUDE.md` (pool instances
  in `DEFAULT` aren't light receivers), and an issue file (`docs/issues/`) with the fix: a
  receiver test that reads the grid's own position and radius. Not fixed here: it changes which
  lights are culled for meshes too.

**Alternative for P2:** a `@remarks` only (move pool instances and the bounds are yours).

### D6. The public API

- **On the entries** (minor additions):
  - `aekasha/lod`: `refreshLodBounds`, `setLodMaxSelectionsPerFrame`, `getLodFadeSeconds`,
    `LodLevelDef` (L2); `enableLodDither`, `createLodFadeAttribute`, `LOD_FADE_OPAQUE` from the
    kernel's `LodFade.ts`, as `registerLodTarget` already is (L7); `ImpostorShading`,
    `CrossQuadsLayout`, `OctahedralImpostorLayout` (named by the options and results).
  - `aekasha/spatial`: `DEFAULT_SPATIAL_DOMAIN`, `SpatialUpdatePolicy`, `validateSpatialGridQuery`
    (S6).
  - `aekasha/instancing`: `InstancePlacement`, `InstancedLodPoolLevel` (P4).
  - `aekasha/lines`: `LineObject` and `LineWriter` (as types), `LineProps`' named types,
    `createLineEntity`, `bindLineToEntity`, `getLineForEntity`, `isFatLineBackendAvailable`, and
    the writers with their counts (N2).
- **Not added:** `setLodDebugOptions` / `LodDebugOptions` (the tab's; a harness reaches them
  through the test bridge), `setSpatialGridCellSize` (`registerSpatialDomain` does it), the chain
  internals (C2), `releaseLodChain` (no app use).
- **`@internal`** (L3, C2, S6): everything exported and on no entry, with a summary saying who
  uses it.
- **One path per name** (C1, P4, N3): the re-exports go, and the importers name the defining
  module.
- **`ImpostorSchema.ts`' `ImpostorShading`** becomes `ResolvedImpostorShading` (I3; on no entry,
  so nothing breaks).

### D7. The two inherited warnings

`Octahedral.ts`' exported signatures write `THREE.Node<'vec2'>` / `<'vec3'>` (no new export);
`LodSystem.ts` imports `LodTarget` as a type for its link. `yarn hub:build` then has none in scope.

### D8. Size

- `LodSystem.ts` (L1) splits along its parts, moved as they are: `LodSettings.ts` (fade seconds,
  bias, the budget, the debug options, the frame stats), `LodMeasure.ts` (camera terms, measuring,
  `getLodWorldSphere`, `measureLodEntity`, the selection camera), `LodFades.ts` (plain-mesh fade
  copies and the per-kind fade helpers); `LodSystem.ts` keeps the hooks, the selection, apply and
  fade systems and the install (about 550 lines).
- `SpatialIndexSystem.ts` (S5): `SpatialDomains.ts` (the registry, settings layers, scene scope,
  the debug override and stats) and `SpatialOracle.ts` (the oracle's state and checks, handed the
  domain, so no import cycle); `SpatialIndexSystem.ts` keeps membership, radii, the rebuild and
  the install.
- `createOctahedralImpostorNodes` (I1): its vertex part and its frame sampler become functions
  of their own; the snapshots must not move.
- The debug tab builders (G1) stay: a `Size:` line in each header says why (p800 rewrites the
  panels, and a builder split now is churn p800 throws away).
- Registration order doesn't change (the install functions call the same registrations in the
  same order): the scene runner's system order baseline must not move.

### D9. Documentation

§1.3's 54 exports and 43 members to 100 %, the debug modules' 5 (G2), `LodDef` and the other
entry types first. The r186 traps of §1.2 as `@remarks` on the functions that guard them, L5's
`LOD` replacement as a `@remarks` on `LodData`, the detached comments as `//` headers (I4, S9, N5),
stale names fixed (L6, C4, I6, S9, P5, N5, G2), the schema's undescribed keys (I4).

### D10. Performance

S2 (the TRANSFORM storage read once, slot-indexed position and radius writes on the grid: the
refresh loop's index is the slot), S3 (one module-level visitor, a `queryVisit` visitor that may
return `true` to stop, which void visitors don't, one world matrix update), P1 (the storage read
once, `needsUpdate` set at each write instead of the per-frame `Set` and its second loop), P7
(confirmed 2026-10-20, found in Phase 2: a `TYPED_ARRAY` branch in the pool sync and the spatial
refresh that reads the store's arrays by slot, as `object3DSyncSystem` does; the pool sync clears
an instance's dirty flag once baked, which nothing else reads for an entity without `OBJECT3D`;
spawn and the un-cull path, which bake outside the sync, clear it too). Each measured before (Phase 0) and after (Phase 2) on the same
camera; LOD selection is measured both times and must not regress. `perf-auditor` runs over the
four folders in Phase 0 and confirms or adds to these.

### D11. Tests

New, in Node: `SpatialGrid.test.ts` (D4's case, add / remove / update / query, the oversized tier,
capacity), LOD level selection (`selectLevel` with hysteresis, exported `@internal` for the test or
tested through the module), `lodDefFromChain`, `resolveLodChainOptions`, `LineWriter` and the
builders (counts, `FIXED` overflow, `raw`'s partial segment), `hashLinePhase`'s spread. The pool's
swap-remove and bounds (P2) through `InstancedMeshPool.ts` with a plain ECS world if its imports
allow it in Node (else the scene runner).

### D12. Lines get their docs (N1)

A nested `features/lines/CLAUDE.md` (one `## Lines` section: the feature, the backends, the
refill, the entity binding, the scene exit, the traps above), its line in the root's map, and a
Hub feature page "Lines" (group Rendering) whose `aek:covers` names it, pointing at the
`physicsTiers` scene, which draws with lines. No example scene: a review plan adds no feature to
show.

## 3. Phases

Each phase leaves the tree green: `yarn test`, the lint and `tsc` (the Stop hook), and the
phase's own checks. `yarn verify:scenes` ran at the end of Phase 1; after that it runs once, in
Phase 6, for Phases 2-5 together (an hour a run on this machine; snapshots, hashes and system
order unchanged unless a phase says otherwise; no file is edited while it runs). Each phase ends with its "As built" list, its files' JSDoc at 100 % and
`docs.json` updated (`yarn verify:baselines --docs --update`).

### Phase 0: baselines and measurements — done

1. `yarn verify:scenes --update` on this commit (= `main`), then `yarn verify:baselines` clean.
2. `perf-auditor` over the four folders: confirm or add to S2, S3, P1. The functions over 150
   lines rechecked.
3. `yarn hub:build`: the folders' warnings (D7's two expected; D6's type list checked against it).
4. The hot loops, measured in `largeWorld` (3,500 pool instances, the `FOLIAGE` domain) and
   `lodShowcase` from their start cameras, debug env, three runs each: `lodSelectionSystem`
   (`getLodFrameStats(world).selectionMs` over the `LOD` count), `spatialIndexRebuildSystem`
   whole (the profiler's system time: `lastRebuildMs` leaves out the refresh),
   `instancedMeshPoolSync` and `lightObjectCullingSystem`.
5. Reproduce S1 with D4's test (`it.fails`), and check P2 in a scene (a pool instance moved out of
   the spawn bounds, the camera turned toward it) and S8 (an indexed pool in `DEFAULT` beside an
   object-culled light).
6. Record the numbers here.

As built (2026-10-19, at `5bdd370` plus this plan and the two repro tests; WSL2, headless Chromium,
WebGL2 through SwiftShader):

- **D1-D12 confirmed** as recommended (2026-10-19), before Phase 0.
- **Baselines (step 1):** `yarn verify:scenes --update` recorded 101 of 104 runs in 3,979 s. The
  three it didn't are `thirdPersonGymScene`'s debug configurations: "the physics probe didn't
  reach step 600 in 300 s" on SwiftShader. That's this machine, not the branch: both of the
  day's earlier runs (09:51 and 12:49, `main` before p616) failed the same three the same way,
  and the gym's `prodTest` passes. Phase 1's and later runs compare the other 101. `yarn
  verify:baselines`: all unchanged, no debug code in either build (`docs.json` 2,121 / 2,385
  exports, 890 / 968 members).
- **The perf audit (step 2)** confirmed S2, S3, P1 and S4, and added three, now in D10: a
  `queryVisit` visitor can't stop (S3: an existence check walks the whole range); the pool sync's
  per-frame `Set` exists only for its second loop, and `needsUpdate` set at each write needs
  neither (P1); `refreshDomainMembers`' loop index is already the slot (S2). It found nothing to
  fix in the LOD selection's per-entity path (no allocation, every storage read once per frame),
  the line writers and backends, `lodApplySystem` / `lodFadeSystem` (bounded by the frame's
  changes) or the impostor material's per-object update. No new function over 150 lines.
- **`yarn hub:build` (step 3):** 420 pages, 16 warnings; in scope exactly D7's three
  (`Octahedral.ts:112` `Vec2Node`, `:128` `Vec3Node`, `LodSystem.ts:994` `{@link LodTarget}`).
  TypeDoc documents every engine module, so D6's type additions are about what an app can import,
  not about warnings (as p615 found).
- **The hot loops (step 4)**, timed in the page by wrapping each system's function
  (`.cache/runs/p616-measure.ts`, gitignored: `npx tsx .cache/runs/p616-measure.ts <label>
  [scenes]`, results in `.cache/runs/p616-measure-<label>.json`). Debug env with the test bridge's
  frame clock, 512 × 288, 30 warm-up and 300 measured frames, three page loads per scene; the
  page is cross-origin isolated (5 µs timer steps, averaged over the frames). Mean µs per frame,
  the three runs:

  | System | largeWorld | largeWorld, FOLIAGE refreshed every frame | lodShowcase |
  | --- | --- | --- | --- |
  | `lodSelectionSystem` | 649, 518, 510 | 526, 524, 521 | 30, 29, 28 |
  | `lodApplySystem` / `lodFadeSystem` | 1.7-1.9 / 1.2-1.6 | 1.2-2.2 / 0.9-1.5 | 1.3-1.4 / 0.5-0.8 |
  | `spatialIndexRebuildSystem` | 35, 33, 31 | 344, 371, 344 | 22, 23, 21 |
  | `instancedMeshPoolSync` | 188, 190, 172 | 116, 141, 166 | 3.5, 8.1, 3.3 |
  | `lightObjectCullingSystem` | 59, 49, 51 | 45, 54, 66 | 1.2, 1.0, 1.1 |

  largeWorld has 3,800 `LOD` entities and pool instances, `DEFAULT` with 26 members (`DYNAMIC`),
  `FOLIAGE` with 1,500 (`STATIC`: it never refreshes in steady state, so the third column
  invalidates it every frame from an `APP_LOGIC` system to time S2's path) and 10 object-culled
  lights; lodShowcase 30 `LOD` entities, 18 pool instances, 18 indexed. LOD selection is
  0.13-0.17 µs per entity, as CLAUDE.md says. The pool sync costs 170-190 µs a frame with nothing
  moving (P1); the refresh path 310-340 µs over the static rebuild for 1,500 members (S2).
- **Repro (step 5):** both bugs reproduced in Node, each kept as a `test.fails` that fails on its
  own assertion when run as `test`. S1: `features/spatial/SpatialGrid.test.ts` (after a
  removal moved entity 2's slot, the query at its position returns `[]`, not `[2]`). P2:
  `features/instancing/InstancedMeshPool.test.ts` (an instance moved 100 units through its
  `Transform`, synced, is outside `pool.mesh.boundingSphere`; three's frustum test reads that
  sphere). S8 is read from the code and needs no scene: `meshIsVisibleReceiver` asks
  `getMeshWorldBoundingSphere`, which returns undefined for an entity without `OBJECT3D`, which a
  pool instance is. `yarn test`: 87 files, 692 passed, 2 expected fails, 1 skipped.

### Phase 1: the grid fix (D4), the pool bounds (D5) and the tests (D11) — done

1. S1 with its test; S4 goes with it.
2. P2 (the bounds grown in the sync system), with its test or a scene check.
3. D11's other tests.
4. S8's `@remarks` and issue file.
5. `yarn verify:scenes`: unchanged.

As built (2026-10-20):

- **S1 / S4 (D4):** `SpatialGrid.removeMember` patches the cells through `lastCell`: the removed
  member's entry becomes `REMOVED_ITEM` (`0xffffffff`) first, then the moved member's entry is
  pointed at its new slot (that order, so a cell holding both can't match the wrong one). Beyond
  D4: removing the *last* slot also turns its entry into the sentinel (else a member added into
  the freed slot was an extra candidate at the old cell), `lastCell` moves with the slot and is
  NaN for the emptied slot and, at rebuild, for oversized members. Queries skip the sentinel
  instead of the old `entityId >= 0` check: no entry points at an empty slot any more.
  `addMember` / `removeMember` got JSDoc; the spatial `CLAUDE.md`'s "stale slots after a leave"
  became "a leave is seen at once, a join or a move after the rebuild".
- **P2 (D5):** `growPoolBounds(mesh, matrix)` in `InstancedMeshPool.ts`, allocation-free, never
  shrinking. A plain pool unions into the mesh's own bounds (three's `union` leaves bounds that
  hold the instance as they are; null bounds stay null, three computes them on first use). A LOD
  pool's local and union bounds moved from `spawn`'s closure to `LodPoolState`; the union is
  copied to each level mesh only when it grew (copies, not one shared Box3 / Sphere: a
  `computeBoundingSphere()` on one level mesh would overwrite the others'). Called by the sync for
  each instance it bakes and, beyond D5, by the LOD target's un-cull path (it re-bakes from the
  `Transform` without a sync, so an instance moved while culled came back outside). A re-baked
  instance pays a WeakMap lookup and the box and sphere transforms: Phase 2's P1 rework can fold
  the lookup into the loop. The pools' JSDoc and the instancing `CLAUDE.md` say what the bounds do.
- **D11's tests** (91 files, 744 tests, no expected fails left): `SpatialGrid.test.ts` (S1 and
  five removal cases, then add / update / query, the radius expansion, the oversized tier and its
  multiplier, capacity, `queryInto` overflow, the AABB query, `memberAt`),
  `InstancedMeshPool.test.ts` (P2 for both pools and the un-cull path, the bounds left alone
  inside them, `despawn`'s swap-remove, removing the slot component; the test context registers
  the slot hooks for real), `lod/LodSystem.test.ts` (`selectLevel`), `lod/LodAuto.test.ts`
  (`lodDefFromChain`), `lod/LodChainOptions.test.ts`, `lines/LineWriter.test.ts` (the writer, the
  builders, `hashLinePhase`'s spread). All in Node: the pool needed no scene runner.
- **`selectLevel` is exported `@internal`** for its test (D11's option): one `api.json` entry
  (`features/lod/LodSystem`) that Phase 3's `--update` records on top of D6's.
- **S8 (D5):** a `@remarks` on both pools' `spatialDomain`, a sentence in the spatial
  `CLAUDE.md`, and `docs/issues/pool-instances-not-light-receivers.md` (open; the fix: the grid
  member's sphere for an entity without `OBJECT3D`, counting a pool instance only while drawn, or
  a bounding-volume provider per component type). Only largeWorld's tree pool joins a domain
  (`FOLIAGE`); its other pools and lodShowcase's join none.
- **`yarn verify:scenes`:** 101 passed, 3 failed in 3,887 s, the same three as Phase 0
  (`thirdPersonGymScene`'s debug configurations, the probe's 300 s timeout on SwiftShader). Every
  snapshot within tolerance, no hash or system order moved; `space`'s worker targets hash apart
  from `mainThread` as in Phase 0 (`MutualGravity`, its JSDoc), its `mainThread` hash = baseline.

### Phase 2: performance (D10) — done

1. S2, S3, P1, P7, and what Phase 0's audit added.
2. The Phase 0 measurements again, same scenes and cameras; recorded here side by side.

As built (2026-10-20):

- **S2:** `SpatialGrid` got `updatePositionAt(index, …)` and `updateRadiusAt(index, …)` (the index
  as `memberAt`'s; `updatePosition` / `updateRadius` call them). `refreshDomainMembers` reads the
  TRANSFORM storage once and writes by slot. The `localRadius` Map stays: every `FOLIAGE` member
  is in it, and moving it into the grid would have to follow the swap-remove (filed, below).
- **S3:** a `queryVisit` / `queryAABBVisit` visitor may return `true` to stop, and both return
  whether it stopped (an additive change on the entry's `SpatialGrid`). The visitor type is written
  out, not a new exported name (entry additions are Phase 3's). Light culling has one module-level
  visitor (the light id and world in module state, the world cleared after the query) that stops
  at the first visible receiver, and one world matrix update per light (`setFromMatrixPosition`
  after `updateWorldMatrix`, not `getWorldPosition`). Beyond D10: the system reads its
  `OBJECT3D`, `TAG_FRUSTUM_CULLED` and `TAG_OBJECT_CULLED` storages once per frame (`addComponent`
  and `removeComponent` keep the same storage object). The oracle's and `SpatialGrid.test.ts`'
  visitors got braces (`found.add(id)` returns the Set).
- **P1:** the TRANSFORM storage read once; `instanceMatrix.needsUpdate` set at each write, no
  per-frame `Set` and no second loop. Phase 1's `lodPoolsByMesh` lookup in `growPoolBounds` is a
  one-entry cache in the loop (`growPoolBounds` takes the pool state).
- **P7 (§1.4, found here, confirmed 2026-10-20):** both loops have a `TYPED_ARRAY` branch reading
  the store's arrays by slot (`getTypedTransformStore`, as `object3DSyncSystem` does). The pool
  sync bakes on `isDirty` and clears it. `clearTypedTransformDirty` clears it at spawn and on the
  un-cull path too, which bake outside the sync (else the first sync baked every instance again).
  `_lastVersion` is documented as `MAP` mode's. The instancing `CLAUDE.md` says how the sync
  decides; the spatial one says a visitor can stop.
- **Tests** (92 files, 749 passed, 1 skipped): `spatial/SpatialIndexSystem.test.ts` (new: the
  refresh's position and scaled radius, in both storage modes, through the real install), and in
  `InstancedMeshPool.test.ts` the P7 repro and "nothing moved, nothing uploaded", in both modes.
- **`ReadonlyVec3`** got a summary. Phase 1's `REMOVED_ITEM` came between it and the detached module
  comment (S9) that used to document it by accident, so the ratchet saw a new undocumented export.
  The comment itself stays for Phase 4. `yarn verify:baselines --docs`: nothing to look at.
- **The measurements**, Phase 0's script, scenes and settings (`.cache/runs/p616-measure-after.json`).
  Mean µs per frame, the three runs:

  | System | Phase 0 | Phase 2 |
  | --- | --- | --- |
  | **largeWorld** | | |
  | `lodSelectionSystem` | 649, 518, 510 | 460, 474, 441 |
  | `lodApplySystem` / `lodFadeSystem` | 1.7-1.9 / 1.2-1.6 | 1.8-3.0 / 1.6-2.1 |
  | `spatialIndexRebuildSystem` | 35, 33, 31 | 29, 30, 28 |
  | `instancedMeshPoolSync` | 188, 190, 172 | 132, 151, 130 |
  | `lightObjectCullingSystem` | 59, 49, 51 | 38, 42, 48 |
  | **largeWorld, FOLIAGE refreshed every frame** | | |
  | `lodSelectionSystem` | 526, 524, 521 | 449, 514, 439 |
  | `spatialIndexRebuildSystem` | 344, 371, 344 | 318, 329, 322 |
  | `instancedMeshPoolSync` | 116, 141, 166 | 106, 91, 92 |
  | `lightObjectCullingSystem` | 45, 54, 66 | 55, 50, 62 |
  | **lodShowcase** | | |
  | `lodSelectionSystem` | 30, 29, 28 | 27, 32, 31 |
  | `spatialIndexRebuildSystem` | 22, 23, 21 | 21, 24, 27 |
  | `instancedMeshPoolSync` | 3.5, 8.1, 3.3 | 2.5, 3.5, 3.5 |
  | `lightObjectCullingSystem` | 1.2, 1.0, 1.1 | 1.1, 1.3, 1.1 |

  The pool sync is about 25 % cheaper with nothing moving. It still pays about 35 ns per instance
  for the slot iteration and the TRANSFORM `get`. Light culling is about 20 % cheaper in
  largeWorld and within noise in the refreshed variant: `DEFAULT`'s 26 members leave the early
  stop few candidates to skip. LOD selection didn't regress. It wasn't touched, so its lower
  numbers are noise (Phase 0's runs ranged 510-649). The refresh path saved only about 25 µs.
- **The refresh path split** (`.cache/runs/p616-measure-split.ts`, the refreshed variant with
  `getLastRebuildDurationMs` averaged per frame): of 300-349 µs, the `FOLIAGE` rebuild is 113-158,
  `DEFAULT`'s 16-17, and the refresh with the rest ~171-174 (~110 ns per member, with the TRANSFORM
  `get` and the `localRadius` lookup left). Not changed here. The real largeWorld's `FOLIAGE` is
  `STATIC` and costs nothing in steady state. Filed: `docs/issues/spatial-refresh-and-rebuild-cost.md`
  (skip a rebuild when no member changed cell, through `lastCell`; the local radius per slot).

### Phase 3: the API (D6, D7) and the deferrals (D3) — done

1. The entry additions, each with its JSDoc and an `@example` where it's an entry API.
2. `@internal` on the rest; the re-exports gone and their importers repointed; the schema type
   renamed.
3. D7's two warnings; `yarn hub:build` has none in scope.
4. p622's candidate list gets D3's three items.
5. `yarn verify:baselines`: the API baseline's changes are exactly D6's (recorded with `--update`).

As built (2026-10-20):

- **The entries (D6)**, each addition with its JSDoc, and an `@example` on `createLodFadeAttribute`,
  `enableLodDither`, `refreshLodBounds`, `setLodMaxSelectionsPerFrame`, `validateSpatialGridQuery`,
  `createLineEntity`, `bindLineToEntity`, `writeBoxEdges` and `writePolyline`. Beyond D6, the names
  an entry's types name: `LodResolvedLevel` (`LodTarget.resolveLevels` returns it),
  `LodChainLevel` (`LodChain.levels`), `SimplifiedLevel` (`SimplifiedLodChain.levels`),
  `LineBackendKind` (`LineBackendChoice`, `LineObject.backendKind`); and
  `getLodMaxSelectionsPerFrame` (the setter's getter, as `getLodBias`), `writeGeometryEdges` /
  `writeGeometryWireframe` (the writer twins of the two `*ToSegments` already there). Not added:
  `CrossQuadsLayout` (no public signature names it: the `CrossQuads` result has no `layout`; it's
  `@internal`), `lodDither` (`enableLodDither` already ANDs an existing `maskNode`),
  `LINE_PULSE_MAX_COLORS` and `lineTimeUniform` (no use outside `lines/`). Stale bits of entry docs
  fixed with them: `LineObject`'s "(LineManager)", `createLineEntity`'s `@returns (number)`.
- **`@internal`** on the 136 exports on no entry, each summary saying who uses it (p615's pattern);
  17 had no summary. CellKey's header, attached to `CELL_AXIS_BITS`, is a `//` header now (S9),
  and its constants' trailing comments went into their summaries. D6's "a harness reaches
  `setLodDebugOptions` through the test bridge" doesn't hold (the bridge has nothing for LOD); its
  summary says the LOD debug tab only.
- **One path per name:** the re-exports in `Lines.ts`, `InstancedMeshPool.ts`, `LodChains.ts`,
  `LodSimplify.ts` and `LodChainGLTF.ts` are gone; ten importers name the defining module (five
  debug modules, `AssetsAPI.ts`, `AssetsAPITypes.ts`, `_dbg__Assets.ts`, `_dbg__RayHelpers.ts`,
  `devTools/assetPipeline/lodChains.ts`). `ImpostorSchema.ts`' type is `ResolvedImpostorShading`.
- **Unused code** (Phase 4's step 3, done here): `setSpatialGridCellSize`, `disposeAllLines`,
  `getLodChains` deleted, `getAllLines` unexported.
- **D7:** `Octahedral.ts`' three exported TSL signatures (D7 named two; `getOctahedralFrameBasisNode`
  took the alias too) write `THREE.Node<'vec2'>` / `<'vec3'>`, the aliases gone. `LodSystem.ts`
  links `{@link _engine/features/lod/LodTypes!LodTarget}` instead of importing it: an `import type`
  used only in JSDoc trips `no-unused-vars`, and the JSDoc standard prescribes the module form.
  Removing `LodSimplify`'s re-export broke its `{@link resolveLodChainOptions}`, now
  module-qualified too. `yarn hub:build`: none in scope, 13 in all (Phase 0's 16 less D7's three).
- **D3:** p622's "From p616" section (the three candidates, with their call sites: 6 pool `spawn`
  calls, all with the pool's world; `joinSpatialDomain` once in the Hub; no line entity call outside
  the engine).
- **Baselines** (`--update`): `api.json` exactly the above, plus Phase 1's `selectLevel`.
  `bundle.json`: the main chunk within tolerance; per folder (before minification, comments
  counted: Risk 3) `spatial` +0.8 kB and `instancing` +0.5 kB gzip, Phases 1-3 together; the two
  `EngineRapier.js` chunks swapped their `#2` (9.5 / 9.3 kB). `bundle.banner.json` moved only by
  gzip noise and was left as committed. `docs.json`: only gains.
- **Found, not fixed:** `LodChain.report` names the kernel's `AssetLoadReport`, on no entry (D1:
  outside scope).

### Phase 4: the internals (D8, D9) — done

1. The three splits, moved as they are.
2. Stale names, detached comments, the traps as `@remarks`, the remaining undocumented exports and
   members; the debug builders' `Size:` lines.
3. Unused code (found in Phase 3's `@internal` pass, confirmed 2026-10-20; done then): deleted
   `setSpatialGridCellSize` (`registerSpatialDomain` does it), `disposeAllLines` and `getLodChains`;
   `getAllLines` is no longer exported (only `Lines.ts` uses it). `decodeImpostorDepth` stays
   (`@internal`, the encoding's inverse).

As built (2026-10-20):

- **Step 1, `LodSystem.ts`** (1,153 → 673 lines): `LodSettings.ts` (160: fade seconds, bias, the
  budget setting, the debug options, the frame stats; the stats' writer is
  `getWritableLodFrameStats`, `@internal`), `LodMeasure.ts` (184: camera terms, `measureEntity`,
  `getScreenSize`, the selection camera, `getLodWorldSphere`, `measureLodEntity`), `LodFades.ts`
  (257: the plain-mesh helpers both sides use, `getLodMesh`, `setMeshLevel`, `createStandIn`, the
  plain-mesh fades and the per-kind helpers). The suppression flag stays private behind
  `removeLodCulledInstantly` (the `LOD` remove hook's try / finally). `LodSystem.ts` keeps the
  priority queue and the walk's cursor (the selection's state, not a setting), `DEFAULT_LOD_HYSTERESIS`,
  `selectLevel`, the hooks, the three systems and the install; the systems read
  `getLodDebugOptions()` once per call.
- **Step 1, `SpatialIndexSystem.ts`** (1,191 → 364): `SpatialDomains.ts` (721: D8's registry,
  settings layers, scene scope, debug override and stats, plus what the registry does to members:
  `insertMember`, `addToDomain`, `removeFromDomain`, the mask bits, `rebuildDomain`,
  `maxAbsScale`; else the registry and the membership would import each other) and
  `SpatialOracle.ts` (199: the oracle, `validateSpatialGridQuery`, and `computeSpatialRadius`, its
  only user). No cycle: the oracle's per-domain state moved onto the world's registry
  (`WorldDomains.oracles`, the same per-world lifetime, dropped by `unregisterSpatialDomain` as
  before), so `SpatialOracle.ts` imports `SpatialDomains.ts` and nothing imports back. The
  detached module comment (S9) became `SpatialDomains.ts`' `//` header.
- **Step 1, `createOctahedralImpostorNodes`** (217 → about 100 lines): `createImpostorVertexNodes`
  and `createFrameSampler`, called in the original order. The TSL graph is identical: every node's
  type and creation id walked from the five outputs, both v origins, 2,781 lines the same before
  and after (`.cache/runs/p616-tslgraph.ts`).
- Importers name the defining modules (the entries, the debug modules, `SpatialFeature.ts`,
  `LightObjectCullingSystem.ts`, the spatial test); comments naming a moved symbol's module fixed
  (`Scene.ts`, `SpatialDomainSchema.ts`, `_dbg__LodEntityWindow.ts`), and both nested `CLAUDE.md`
  files say where things are, and `app/scenes/lodShowcase/layout.ts:87`'s "`k` … (LodSystem.ts's
  perspective projection)" names `LodMeasure.ts`: an app file, so the app is 1.12.4 already
  (confirmed 2026-10-20; D2's patch, its changelog line in Phase 6).
- Checks: `tsc`, the lint, `yarn test` (92 files, 749 passed, 1 skipped, as Phase 2).
  `yarn verify:baselines`: 40 exports moved and 31 new `@internal` ones, no entry change, no debug
  code; the main chunk within tolerance (per folder before minification `lod` +0.8 kB and
  `spatial` +0.5 kB gzip, the new headers), the banner unchanged. Recorded at the phase's end.
- **Step 2 (D9):** §1.3's names and the members the ratchet still listed (25 exports, 37 members;
  Phase 3 had done the rest) and G2's five: `instancing`, `lines`, `lod`, `lod/impostors`,
  `lod/worker` and `spatial` at 100 %, exports and members. The traps as `@remarks` where they're
  guarded: the chain's shared buffers on `generateLodChain`, the fade copy's `dispose` on
  `setMeshFade`, `tangentLocal` and double-sided normal maps on cross-quads'
  `createPlaneNormalNode`, the instance matrix on `ImpostorInstanceMatrixNode`, the widened
  uploads on `asUploaded` and `getImpostorSourceHash`, the line's `TAG_IS_MESH` on
  `retagLineEntity`. §1.2's other three (`VSMShadowMap`, one shadow map per node frame,
  `NodeMaterial.clone()` losing `alphaTest`) were only in `impostors/CLAUDE.md`, at no code: a
  `@remarks` on `generateOctahedralImpostor`. L5 on `LodData` (with `setMeshLod`'s second
  consequence: level 0 resolves from what the mesh shows then). New types got summaries
  (`SpatialGrid` a class summary with its between-rebuilds `@remarks`).
- Detached comments as `//` headers: `ImpostorSchema.ts`, `SpatialGrid.ts` (rewritten: it said
  nothing referenced the grid), `LinePulse.ts`, `LineBuilders.ts`, and one the plan didn't list,
  `LineBackendFat.ts`. Stale names: L6, C4, I6, S9 (`computeIsVisible`: the light radius doc now
  says what it shares with frustum culling; the dedup stamps name p050 §11's Phase 4), P5, N5
  (`@returns (Promise<boolean>)` on `preloadFatLineBackend`), G2. `ImpostorSchema`'s five keys
  described (`.schemas/impostor.schema.json` regenerated).
- The debug builders' `Size:` lines: a `// Size:` line in `_dbg__LOD.ts`' header and in a new
  header for `_dbg__SpatialGrid.ts` (it had none). No other file uses the form yet.
- Step 1's split had added three Hub warnings, fixed: `lodSelectionSystem` links the two moved
  setters module-qualified, and `DomainSettingsLayers` is exported `@internal` (the exported
  `SpatialDomain` names it). `yarn hub:build`: 13 warnings, none in scope (as Phase 3).
- Checks: `tsc`, the lint, `yarn test` (92 files, 749 passed, 1 skipped). `yarn verify:baselines
  --update` recorded: `api.json` step 1's moves and internal exports (40 moved, 32 added with
  `DomainSettingsLayers`), no entry change; `docs.json` the gains; `bundle.json`: chunk bytes
  changed only in `OctahedralImpostor.js` (lazy, +338 B: the builder's helpers and the object
  they return) and the main chunk (+39 B, the splits), per folder before minification `lod`
  +0.8, `spatial` +0.6, `lines` +0.2 kB gzip (comments); the two `EngineRapier.js` chunks swapped
  `#2` again (names only). `bundle.banner.json`: `LodChainGLTF.js` 2,222 → 2,193 B, Phase 3's
  removed re-export (Phase 3 left the file as gzip noise), recorded with it.

### Phase 5: the Hub, CLAUDE.md, readme, and what's filed — done

1. D12: `features/lines/CLAUDE.md`, the root map's line, the Lines feature page.
2. The LOD and spatial index pages and the nested `CLAUDE.md` files checked against the code
   (D4's grid, D5's bounds and receivers, D6's names in their Key APIs).
3. `readme.md` if a listed API changed (none expected: D6 only adds).
4. `yarn hub:build`: no dead link, no new warning.

As built (2026-10-20):

- **Step 1 (D12):** `features/lines/CLAUDE.md` (one `## Lines` section: the modules, no world
  and the one time system, build once or refill, the backends and `object3D` swaps, bounds and
  culling, the entity binding, the `TAG_IS_MESH` trap, the scene exit), its line in the root's map,
  and `lines` in `hub/CLAUDE.md`'s list of feature page slugs. The Hub's Lines page
  (`hub/pages/features/lines/`, `aek:covers` "Lines") is in group **World** at order 72, next to
  Viewports: D12's "Rendering" isn't one of the Features page's groups (Core, World, Performance,
  Tools). No `::: scene` panel: `physicsTiers` has no Hub image (the Hub tab isn't given to it, and
  adding it to `OTHER_HUB_SCENES` is an app change), and a panel without one warns. The page names
  it with its `?startScene` URL, as the physics page does. New icon `hub/_assets/icons/spline.svg`
  (lucide). Two summaries Phase 3's `@internal` pass had doubled (`lineTimeUniform`,
  `disposeNonPersistentLines`) lost their repeated sentence.
- **Step 2:** every name and file the four nested files and the two pages quote exists. What they
  lacked was Phases 1-3's. The spatial index page: when a leave, a join and a move are seen (D4), a
  `queryVisit` visitor that stops, `DEFAULT_SPATIAL_DOMAIN`, `validateSpatialGridQuery`, the pool
  receivers (S8), a "Known issues" section linking both filed issues, and `isInSpatialDomain`,
  `invalidateSpatialDomain`, `rebuildSpatialDomain` in its Key APIs. The LOD page: the pool bounds
  growing (D5), the receivers (S8), and `setLodMaxSelectionsPerFrame`, `refreshLodBounds`,
  `enableLodDither`, `createLodFadeAttribute` in its Key APIs. Nested files: `lod` (the selection's
  cost as measured here, 0.12-0.17 µs per entity over 3,800; the `LodFade` names on the entry; L5's
  trap), `spatial` ("31 per world besides `DEFAULT`", `validateSpatialGridQuery`, a `DYNAMIC`
  domain's per-member cost with the issue), `instancing` (a pointer to the receivers). `impostors`
  unchanged. What's filed checked against the code after Phase 4's splits: both issue files' names
  and paths hold, and p622's "From p616" has D3's three items.
- **Step 3:** no API the readme's examples use changed. Its Lines line said "pooled" (lines aren't:
  each has its own buffer, in a registry); rewritten to what the feature does.
- **Step 4:** `yarn hub:build`: 428 pages, no dead link, 13 warnings (Phase 4's 13, none in scope).

### Phase 6: versions and done

1. D2's bumps, a `CHANGELOG.md` entry, `yarn checkVersions --against main`.
2. `yarn test`, `yarn verify:scenes`, `yarn verify:baselines` (no unexplained growth), `yarn build`
   (the SBP budgets: the `lod`, `spatial`, `instancing` and `lines` groups), `yarn hub:build`.
   The scene run is the only one since Phase 1: it covers Phase 2's per-frame changes (snapshots
   and hashes unchanged) and Phase 4's splits (the system order unchanged, Risk 2). A difference
   is traced to its phase through the scene and what moved.
3. Mark the plan done (`docs/plans/CLAUDE.md`).
4. Time for a PR: this branch into `main` (p600's "Branches and PRs").

## 4. Risks

1. **D4 changes what queries return** between a removal and a rebuild: fewer misses, a few more
   candidates (the sentinel). Light culling may then keep a light on in a frame where it was
   wrongly culled; the scene runner's snapshots are taken in steady state, so none should move.
2. **D8's splits move registration-adjacent code.** The install functions keep their order; the
   system order baseline is the check, in Phase 6's scene run.
3. **SBP groups count comments** (p612's lesson): D9's JSDoc grows the `lod` and `spatial` groups
   before minification. Phase 6's `yarn build` says whether a budget needs its reason updated.

## Done when

- Every file in scope reviewed against p600 §5, the findings fixed or filed (`docs/issues/` or a
  plan item: S8's issue, D3's p622 items).
- JSDoc coverage of the scope's public exports at 100 % (`docs.json`), members included; the
  ratchet raised.
- `yarn test`, `yarn verify:scenes` (snapshots and hashes unchanged unless stated),
  `yarn verify:baselines` (no unexplained growth), `yarn build`, `yarn hub:build`. The verify
  commands run for minutes to hours: when one starts, give the watch command,
  `tail -f .cache/verify/progress.log`.
- The hot loops measured before and after: no regression, and Phase 2's numbers recorded.
- The Hub pages of the features in scope checked against the code; the nested `CLAUDE.md` files
  current, lines' new.
