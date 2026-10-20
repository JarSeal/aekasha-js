# Changelog

One entry per branch merged to `main`, newest first, written in that branch's PR next to its version bumps (see "Versioning" in `.claude/CLAUDE.md`). Each entry has a section per part that changed: **Engine** (`src/_engine/`), **Toolkit** (`src/toolkit/`) and **App** (`src/app/` and the app-level files in `src/`). **Project** covers repo tooling that belongs to none of them. A part without a section kept its version.

Earlier releases are only recorded in the git history.

## 2026-10-20 — review-lod-spatial-instancing-lines

### Engine 5.7.0 (Golden Hour)

LOD, the spatial index, instanced mesh pools and lines are reviewed file by file (p616). Three bugs are fixed, the per-frame work of the pool sync, the spatial refresh and light culling is lighter, and the entries carry the names their own docs told apps to call. Every export and member of the four features is documented. Lines get the nested `CLAUDE.md` and the Hub page every other feature has. No public export is removed or renamed.

**Added**

- On `aekasha/lod`: `refreshLodBounds`, `setLodMaxSelectionsPerFrame` with its getter `getLodMaxSelectionsPerFrame`, and `getLodFadeSeconds` (the docs and `AppConfig.lod.maxSelectionsPerFrame` named them). The kernel's `enableLodDither`, `createLodFadeAttribute` and `LOD_FADE_OPAQUE`, which a `LodTarget` that cross-fades needs (the contract was on the entry, the helpers weren't). The types `LodLevelDef`, `LodResolvedLevel`, `LodChainLevel`, `SimplifiedLevel`, `ImpostorShading` and `OctahedralImpostorLayout`, each named by a public signature.
- On `aekasha/spatial`: `DEFAULT_SPATIAL_DOMAIN`, the type `SpatialUpdatePolicy` and `validateSpatialGridQuery`. `SpatialGrid.queryVisit` and `queryAABBVisit` stop when the visitor returns `true`, and return whether one did (a void visitor visits everything, as before).
- On `aekasha/instancing`: the types `InstancePlacement` (what `spawn` takes) and `InstancedLodPoolLevel`.
- On `aekasha/lines`: `createLineEntity`, `bindLineToEntity`, `getLineForEntity` and `isFatLineBackendAvailable`; the allocation-free writers for a per-frame refill, `writeBoxEdges`, `writeBox3Edges`, `writePolyline`, `writeGeometryEdges` and `writeGeometryWireframe`, with `BOX_EDGE_SEGMENT_COUNT` and `polylineSegmentCount`; the types `LineObject` (what `createLines` returns), `LineWriter` (what `beginWrite()` returns), and the ones `LineProps` names (`LineColorStyle`, `LineDash`, `LineAttachment`, `LineBackendChoice`, `LineBackendKind`, `LineGrowth`, `LineLocalTransform`, `LinePulseEasing`, `LinePulseMode`).
- JSDoc on every export and member of `features/lod` (with `impostors` and `worker`), `features/spatial`, `features/instancing` and `features/lines`, and on their debug modules' exports. `@example`s on the additions an app calls. The r186 traps the four features work around are `@remarks` on the functions that guard them (a chain's shared vertex buffers, the fade copy's `dispose`, cross-quads' tangents, the impostor's instance matrix, the widened index uploads, the impostor bake's shadow and `alphaTest` traps, a line's `TAG_IS_MESH` retag). Adding a `LOD` to an entity that has one is a `@remarks` on `LodData`.

**Changed**

- **Behaviour change:** an instanced mesh pool's bounds grow with its instances. A plain pool's bounds were computed at `spawn` and a LOD pool's at the union of its placements, so an instance moved through its `Transform` could leave them, and three culled the whole `InstancedMesh` while it was on screen. The sync now grows them for each instance it bakes (never shrinking, allocation-free), as does the LOD pool's un-cull path. Pools whose instances don't move are unchanged, and no template scene's snapshot moved.
- **Behaviour change:** a spatial query sees a leave at once. Between a removal and the next rebuild it could miss a live member, the one the removal moved into the freed slot, so light culling could cull a light for a frame (a flicker) after any indexed entity was deleted in `APP_LOGIC`. A join or a move is still seen after the rebuild.
- Less work per frame. The pool sync reads the `TRANSFORM` storage once, sets `needsUpdate` where it writes and makes no `Set` a frame: about 25 % cheaper in `largeWorld` with nothing moving (3,500 instances). The spatial refresh reads the storage once and writes by slot (`SpatialGrid.updatePositionAt` / `updateRadiusAt`). Light culling makes no closure per light, stops at the first visible receiver, updates each light's world matrix once and reads its storages once per frame: about 20 % cheaper in `largeWorld`. LOD selection didn't change (0.12-0.17 µs per entity).
- Docs that said the wrong thing: lines aren't pooled (the readme), `LineObject` named the removed `LineManager`, the spatial grid's header said nothing used it, and comments named files and modules from before p608's move (`Lod/`, `ECS/`, `MeshManager`, `LineManager`).
- Internal (no entry exports them). `LodSystem.ts` is split into `LodSettings.ts`, `LodMeasure.ts` and `LodFades.ts`, and `SpatialIndexSystem.ts` into `SpatialDomains.ts` and `SpatialOracle.ts`; the system registrations kept their order. The octahedral impostor's node builder is split into helpers that build the same graph. One path per name: `Lines.ts`, `InstancedMeshPool.ts`, `LodChains.ts`, `LodSimplify.ts` and `LodChainGLTF.ts` re-export nothing, and their importers name the defining module. `ImpostorSchema.ts`' `ImpostorShading` is `ResolvedImpostorShading` (the entry's `ImpostorShading` is the bake option). Every export of the four features not on an entry is `@internal`, with who uses it.
- Internal, removed: `setSpatialGridCellSize` (`registerSpatialDomain` sets it), `disposeAllLines` and `getLodChains`; `getAllLines` isn't exported.

**Fixed**

- In `TYPED_ARRAY` storage mode, pool instances never moved after spawn: the store's dirty flag, which only `object3DSyncSystem` cleared (for entities with an `OBJECT3D`), stood in for the `Transform`'s version, so the sync skipped every later move. The pool sync and the spatial refresh read the store's arrays by slot in that mode, and the pool clears an instance's flag once baked. `MAP`, the default, wasn't affected.

### App 1.12.4 (Preschooler)

**Changed**

- `lodShowcase`'s layout comment names `LodMeasure.ts`, where the LOD's projection moved.

### Project

**Added**

- Tests, in Node: `SpatialGrid.test.ts` (the removal case and the grid's queries, tiers and capacity), `SpatialIndexSystem.test.ts` (the refresh in both storage modes), `InstancedMeshPool.test.ts` (the bounds for both pools, the swap-remove, `TYPED_ARRAY` moves), `LodSystem.test.ts` (level selection), `LodAuto.test.ts`, `LodChainOptions.test.ts` and `LineWriter.test.ts` (the writer, the builders, the pulse phase's spread).
- `src/_engine/features/lines/CLAUDE.md`, its line in the root `CLAUDE.md`'s map, and the Hub's Lines feature page (group World).
- `docs/issues/pool-instances-not-light-receivers.md` (pool instances in `DEFAULT` never count as light receivers; documented on the pools' `spatialDomain`, not fixed) and `docs/issues/spatial-refresh-and-rebuild-cost.md` (a large `DYNAMIC` domain's per-member cost).
- `docs/plans/p622_engine-6-major.md`: the spatial API's argument order, a pool's `spawn` / `despawn` without their `world`, and the line entity functions' positional parameters, as candidates.

**Changed**

- The Hub: the LOD guide (the pool bounds, the receivers, the new Key APIs) and the spatial index guide (when a leave, a join and a move are seen, a visitor that stops, `DEFAULT_SPATIAL_DOMAIN`, `validateSpatialGridQuery`, the receivers, its known issues). The LOD, impostor, spatial and instancing `CLAUDE.md` files say where the split modules are and what changed. `readme.md`'s Lines line.
- `.schemas/impostor.schema.json`: the schema's five undescribed keys have descriptions.
- `yarn verify:baselines`: `api.json` (the entries' additions, the splits' moves, the internal names added and removed, `selectLevel` for its test), `docs.json` (the four features fully documented) and both bundle baselines. The app's main chunk (`assets/index.js`) is 386,821 B gzip, 767 B more than on `main`.

## 2026-10-19 — review-skybox

### Engine 5.6.0 (Golden Hour)

The sky box feature is reviewed file by file (p615). Two bugs are fixed, `skyBox()` stops when a mounted engine unmounts, the clouds move on the engine's clock instead of the browser's, and every export of the feature and its layers is documented. The preset helper the docs sent code to is on the entry now. The scene runner gives every scene the same probe hash as on `main`. The snapshots of the four scenes with clouds changed once (the first behaviour change under Changed). No public export is removed or renamed.

**Added**

- On `aekasha/skybox`: `resolveSkyBoxPreset` (a code definition's `preset` merged under it, typed; an unknown name throws with the list) and `SKYBOX_PRESET_NAMES`, with the types `SkyBoxPresetDef` and `SkyBoxPresetName`. `registerSkyBox`'s warning and the docs told code to use it, but it wasn't on the entry, so an app couldn't. Also the types `SkyBoxState` (`Readonly<{ id, sceneId, def }>`) and `SkyBoxChangeReason`, for the change listener and the three calls' results (see Changed).
- JSDoc on every export of `features/skybox` and `features/skybox/layers` (149 / 173 and 47 / 79 were documented), on every key of the sky box schema and on the debug tab's exports. `@example`s on `createSkyBox`, `updateSkyBox`, `onSkyBoxChange`, `setTimeOfDay`, `getSunDirection`, `getSkyLightIds`, `resolveSkyBoxPreset` and `SkyBoxDef`. The three r186 traps the sky box works around are `@remarks` on the functions that guard them (the env bake, the static layers, the sky lights, the base layer, the stars).

**Changed**

- **Behaviour change:** the clouds move on the engine's clock (the main loop's elapsed time). They keep drifting while only the app is paused, and stop with the master pause, in an editor view and while a scene loads. They start from the same place on every visit to a scene. They read three's `time` before, the browser's clock, so they drifted through all of those, and the env bake's frozen clouds read the renderer's private node frame time. The sky box's bake schedules (the day-night env bake's rate limit, the nebula bake's 150 ms throttle) read the same clock instead of `performance.now()`. The stars' twinkle stays on three's `time`. The four template scenes with clouds (`exampleLod`, `exampleSkyBox`, `lodShowcase`, `skyShowcase`) render other clouds in the scene runner's snapshots (see Project).
- **Behaviour change:** a mounted engine's `unmount()` stops the sky box (`skyBox()` registers a `FeatureContext.onUnmount`). The updates waiting for an activation and an activation still loading settle with `null`. The sky box is cleared: its env bake and nebula cube are disposed, its lights deleted, and the root scene's background, environment and their intensities reset. The change listeners are told `'clear'` one last time, then dropped. It runs before the renderer is disposed. The registered definitions stay.
- `setActiveSkyBox`, `createSkyBox` and `updateSkyBox` resolve with a `SkyBoxState`, and an `onSkyBoxChange` listener gets one. It's the same object as before, typed by what an app may read (`id`, `sceneId`, `def`): code reading the sky box's internals from it (`uniforms`, the nodes, `time`) stops compiling. The template has none.
- Less work per frame while the day-night cycle plays. The atmosphere's sun makes no object per frame. Sun 0 reuses the atmosphere's extinction instead of computing it again. A sun turning with the sky computes the start time's rotation once per definition (two rotations per sun per frame before). The sky lights read the camera's position once per frame from its world matrix: once per light, they updated the camera's matrices up its parents.
- Docs that said the wrong thing: `getSkyLightIds` is public API (it said "debug and tests"). `LEGACY_SKYBOX_WARNING` named migration notes that no longer exist. Comments named the files before their PascalCase renames.
- Internal (no entry exports them). The day-night API, its env bake schedule, the sky clock and `skyBoxSystem` moved from `SkyBox.ts` to `SkyDayNight.ts`. The debug tab's undo / redo edits and "Apply preset" moved from `_dbg__SkyBoxShared.ts` (850 lines) to `_dbg__SkyBoxEdits.ts`. The nebula draws its offsets from `createSeededRandom` (the same numbers). Every sky box export not on the entry is `@internal`, with who uses it (`ActiveSkyBox`, `registerSkyBox`, `getActiveSkyBox`, `clearSkyBox` among them).
- Internal, removed: `SkyBox.ts`' re-exports of the presets, `SkyBoxDef` and `SKYBOX_MANAGER_ID` (one path per name), the four unread `*_STRUCTURAL_KEYS` of the sun, ground, atmosphere and clouds layers, `getFrameTime`, the nebula's own copy of the seeded random, and the debug tab's unused `currentSceneHasOverrides`.

**Deprecated**

- The legacy `{ type, params }` sky box shape, removed in engine 6.0.0: `LegacySkyBoxProps`, `isLegacySkyBoxProps`, `LEGACY_SKYBOX_WARNING` and `createSkyBox`'s legacy form (now an overload of its own, struck through in the editor). The schema's conversion, the gatherer's warning and the save data's pre-p111 migration go with it. Write a layered definition (`base`, `env` and the layers). Nothing in the template uses the shape.

**Fixed**

- An `updateSkyBox` made while an activation was loading a texture was lost when the activation showed. That was a structural update or a `setActiveSkyBox` meanwhile, or in the debug tab a base file change, then a slider before the file had loaded. Updates made meanwhile now wait for that activation, merged in call order (a drag is one update, its last value wins), and apply to what it showed. One for a sky box no longer active changes nothing, as before.
- In the debug env, a sky box texture that failed to load failed the scene load, and `setActiveSkyBox` and `createSkyBox` rejected. In every env now, it's logged (in the debug env also a toast) and the sky shows a black base (a moon, a plain disc). Production shows what it did, without holding an unregistered placeholder texture. A cube texture's failed load wasn't checked for at all.
- A sky colour written as `{ r, g, b }` was read as linear, so it rendered unlike the same colour written `'#rrggbb'`. Both are sRGB now, as in the kernel's colours, and the debug tab's pickers show the object form's own hex. No template sky box writes the object form.

### Project

**Added**

- Tests: `features/skybox/SkyBox.test.ts` drives the sky box in Node with a plain root scene and texture loads the test settles. It covers the update queue, a failed texture, the stop, the sky clock and which updates rebuild the sky. Also `Presets.test.ts` (each template, the merge rules), `SkyComposite.test.ts` (which changes rebuild the composite), `SkyColor.test.ts` (both colour forms equal), and the cached sky rotation in `SkyTime.test.ts`.
- `docs/plans/p622_engine-6-major.md`: the sky box's 6.0.0 removals, and its positional parameters (`setActiveSkyBox`, `getSunDirection` and the like) as candidates for options objects.

**Changed**

- The Hub: the sky box guide (the stop, presets in code, the clouds' clock, `SkyBoxState`, overlapping calls, failed textures; `bakeEnvironment` bakes on the next frame, not now), the sky box example's walkthrough (the clouds' clock), the embed walkthrough (what `unmount()` stops) and the ECS guide (`ctx.onUnmount`).
- `src/_engine/features/skybox/CLAUDE.md`: the feature described once with its stop, the public API, the presets, the update queue, failed textures, the sky clock and the colour reading. The root `CLAUDE.md`'s map line and `onUnmount` sentence name the sky box's stop. `docs/plans/CLAUDE.md`'s "Epic" line covers epics made of plans.
- `lodshowcase-sky-snapshot-drift.md` is fixed (the clouds and the bake schedules off the wall clock). `remount-after-unmount.md` says the sky box stops.
- `yarn verify:baselines`: `api.json` (the day-night functions in `SkyDayNight.ts`, the entry's additions, the internal names added and removed) and both bundle baselines. `docs.json` (every sky box folder fully documented) was recorded with the phases.
- `sbp.config.ts`: the app's sky box group budget raised from 28 to 30 KiB. The group measures 26.4 → 28.4 kB, mostly its new JSDoc, since a group counts its comments. Its code is about 1.1 kB larger: the sky clock, the update queue, the stop, and `SkyDayNight.ts` as a module of its own. The app's main chunk (`assets/index.js`) is 386,054 B gzip, 1,491 B more than on `main`.
- The scene runner's baselines are local: after this merge, `yarn verify:scenes --update --only exampleLod,exampleSkyBox,lodShowcase,skyShowcase` on `main` records the clouds' snapshots.
- `devTools/refactor/`'s layout report, move map and entry exports regenerated.

## 2026-10-18 — review-physics

### Engine 5.5.0 (Golden Hour)

The physics feature is reviewed file by file (p614), along with ray casting and the collider derivation of imported models. The bugs found are fixed, and every export and member is documented. The three largest files of the engine are split into modules of under ~800 lines each. A transport interface now sits in front of the physics worker's messages, and `physics()` stops when a mounted engine unmounts. The scene runner gives every scene the same probe hash and snapshot as on `main`, in all three physics targets and in prod test mode. The exception is the three scenes with `friction: 0` colliders (the first behaviour change under Changed). No public export is removed or renamed.

**Added**

- `FeatureContext.onUnmount(fn)`: a feature's stop, run by `mountAekasha`'s `unmount()` (and its teardown after a failed boot) right after the loop stops, in reverse install order. It's synchronous, and a hook that throws is logged while the others still run. A full-page app (`InitEngine`) never unmounts, so it never runs them. Physics registers one (see Changed).
- On `aekasha`: the type `RayDebugOpts`. On `aekasha/physics`: the type `PhysicsTierPolicyCadence`. On `aekasha/character`: the types `KindSpec` and `PlayerBrainCommonActions`. A public signature names each of them.
- JSDoc on every export and member of `features/physics` (its types, the worker protocol, the backend, the worker, the transport and the proxies), of `kernel/render/Raycast.ts` and of the character types that name physics. `@example`s on `createPhysicsEntity`, `getPhysicsEntityByAppId`, `deriveColliderFromGeometry`, `setPhysicsTierPolicy`, `setPhysicsTierPolicyMember`, `requestPhysicsTier` and `getPhysicsTier`. The four body, collider, joint and world APIs each say which `*Sync` twins answer on `WORKER_THREAD` from the proxy's copy, and which throw.
- The physics transport (`features/physics/transport/`, internal): every message between the main thread and the physics worker goes through one interface, in both directions. Its contract: plain data, delivered in order, one message handled to the end before the next. It's the seam for networked physics (p511).

**Changed**

- **Behaviour change:** a collider's `friction: 0` applies. The backend skipped a friction of 0, so such a collider got Rapier's default of 0.5. In the template, eleven colliders in `scene01`, `scene01V2` and `thirdPersonGymScene` ask for 0, so those scenes' probe hashes changed, and so did the gym's character path hash. The gym's players pass through the same locomotion states and end elsewhere on the floor. The moving platforms and carousels were played by hand in both worker targets, and the scenes keep their `friction: 0`.
- **Behaviour change:** a mounted engine's `unmount()` stops physics. `MAIN_THREAD` deletes the world. `WORKER_THREAD` terminates the worker and rejects every pending request. Both release the stepping hold and the step gates, and remove the visibility listener. After the stop no world is created, so a scene load still running at unmount makes none. It used to leave the worker, its world and the listener running.
- **Behaviour change:** `getPhysicsEntityByAppId` returns `undefined` for an entity that isn't a physics entity. It returned any entity's id, like `getEntityIdByAppId`. An entity counts as a physics entity as soon as `createPhysicsEntity` is called, before its body exists.
- Deleting with no world is a quiet no-op for every delete. Eight of them threw: `deleteRigidBodySync`, `deleteRigidBodies(Sync)`, `deleteCollider(Sync)`, `deleteCollidersSync` and `deleteJoint(Sync)`. A `*Sync` delete still throws on `WORKER_THREAD` (a misuse, not a stale id), now before it forgets the id. The world proxy's `removeRigidBody`, `removeCollider` and `removeJoint` log a rejected delete instead of leaving an unhandled rejection.
- `createRigidBodies([])` and `createColliders([])` resolve `[]` on `WORKER_THREAD` too (they threw). On `WORKER_THREAD`, a rigid body's `isEnabledSync()` answers from the proxy's copy (it threw). `isBeingDeleted` (bodies, colliders, joints) is set by every delete and by a world delete, as `MutualGravity` expects; it was never set.
- `AppConfig.physics.physicsEngine` is typed `'RAPIER'`. It accepted any string.
- Less work per frame. In `MESSAGE_BATCH` mode a transforms push carries only the used body slots: 736 B in the gym instead of 106 kB, and its copy takes a seventh of the time. The worker's write-back walks the slots, not every body. A `WORKER_THREAD` frame whose systems issue no physics command allocates no capture arrays. The tier policy's pass allocates nothing on `MAIN_THREAD` (3 KiB per frame less in `physicsTiers`), and on `WORKER_THREAD` nothing beyond its request. The world proxy's ray queries reuse one Rapier `Ray`, and the interpolation reads its storages once per frame.
- The ray caster and the ray stats are made on first use. The banner embed's main chunk (`assets/banner.embed.js`) is 292,882 B gzip, 414 B less than on `main`. The app's main chunk (`assets/index.js`) is 4.7 kB smaller rendered and 593 B larger gzip (384,563 B): the split's shared state is read through property names the minifier can't shorten.
- Docs that said the wrong thing: `JointAxesMask` names the axes a `GENERIC` joint locks (it said the free ones). `QueryFilterFlags`' `EXCLUDE_KINEMATIC` and `EXCLUDE_DYNAMIC` were swapped. `ColliderParams.density` said "Mass", and its `translation` / `rotation` are relative to the parent body. `ColliderParams.orientation` comes from an imported node's `spineAxis`. A contact force callback gets a copy, so keeping it is fine.
- Internal (no entry exports them). `PhysicsAPI.ts` is split into the facade's modules (`PhysicsState.ts`, `PhysicsRegistry.ts`, `PhysicsMessaging.ts`, `PhysicsStepping.ts`, `PhysicsBodies.ts`, `PhysicsColliders.ts`, `PhysicsJoints.ts`, `PhysicsWorld.ts`, the two stats modules) and `proxies/`. `PhysicsAPITypes.ts` is split into `types/` and `protocol/`, and `EngineRapier.ts` into `backends/rapier/`'s modules and `proxies/`. Each create and delete has one branch per worker target instead of four copies. The render interpolation is in `PhysicsInterpolation.ts`. `kernel/mesh/MeshUserData.ts` is `features/physics/import/ColliderBounds.ts`, a pure function. `deriveColliderDimensionsFromMesh` is in `features/physics/ColliderDimensions.ts`.
- Internal, removed: `RayCastOpts`' six deprecated fields (`helperId`, `helperColor`, `startLength`, `endLength`, `perIntersectFn`, `optionalTargetArr`; nothing passed them) and `resolveDebugOpts`. Also removed: `PhysicsUtils.ts`' `getColliderShapeName`, `getPhysicsEngineKey`, `setPhysicsPauseTime` and `getEngineAPI`; `setMeshCreatePropsToUserData`; `DEFAULT_TIER_POLICY_CADENCE` and `DEFAULT_TIER_POLICY_INTERVAL`; and the export of `disposePhysicsEntity` and `ThreeVector3`. The worker protocol's `RIGID_TRANSLATION`, `RIGID_ROTATION`, `RIGID_LINVEL` and `RIGID_ANGVEL` are removed (nothing sent them), and no other message number moved. Now `@internal`: every physics export not on `aekasha/physics` (`getPhysGameTime` among them, still deprecated), the tier policy's debug getters and setters, every `Raycast.ts` export, and `getBodyKind`.

**Fixed**

- A physics worker request whose call threw in the worker never settled. The facade only logged the worker's `ERROR`, and the rigid body, collider and joint calls threw past the worker's `catch`. So a `createPhysicsEntity` with a bad collider (a `TRIMESH` without indices, a shape the backend refuses) hung its scene load. It now rejects with `Error('Physics worker: …')`, and the scene load resolves `false`.
- A body created with its colliders wasn't all or nothing in either target. A collider that threw left the body in the world (and its transform slot taken), owned by nothing. Now the body and the colliders made before it are deleted. `createColliders` is all or nothing too.
- An entity deleted while its `WORKER_THREAD` create was in flight (a scene exit) got its components and body registered again. The create now deletes what it made and resolves with the dead id.
- `createRigidBodies` with a `THREE.Quaternion` rotation, and a `FIXED` joint's `frame1` / `frame2`, reached the worker without `x` / `y` / `z` / `w`.
- Collider 0 (the page's first collider) got no contact or intersection pairs on `WORKER_THREAD`, and was nobody's pair.
- `createCollider` wrote `parentId` into the caller's params object, so on `MAIN_THREAD` a params object reused for a second collider carried the first's parent.
- Three backend warnings about a body, collider or joint Rapier no longer has were logged only in production builds. They now log only in the debug env.
- Imported `CAPSULE`, `CONE` and `CYLINDER` colliders got the default `halfHeight`, and a cone or cylinder no radius from its mesh. A capsule's `halfHeight` is now its straight part's, and a cone's or cylinder's half its length.
- An imported node's `spineAxis` (`x` / `z`) was ignored, so the shape stayed Y-up. Separately, a collider's `orientation` was replaced by its `rotation` instead of composed with it, so a rotated compound member lost its spine.
- An imported `HEIGHTFIELD` whose vertex count isn't a grid is skipped. It logged "importing failed" and then made a collider without heights, which threw. With only `nrows` or only `ncols` given, the other count was read wrong for an oblong grid.
- On `WORKER_THREAD`, a body's `bodyTypeSync()` was stale after a `REMOVED` tier returned it to the world as `STATIC`.
- On `WORKER_THREAD` with `physics.enabled: false`, `getPhysicsWorld()` returned a worker proxy with no world behind it.

### Toolkit 2.1.2 (Half Moon)

**Changed**

- The comments of `MutualGravity`, `Terrain` and `ScatterOnSurface` name `createPhysicsEntity` (they named `PhysicsManager` or a `PhysicsAPI.ts` still to come). No behaviour change.

### App 1.12.3 (Preschooler)

**Changed**

- Comments only. `physicsTest`'s `GENERIC` joint demo says what its `axesMask` does: it names the axes the joint locks, in the joint's frame. `largeWorld`'s comments name `createPhysicsEntity`. No behaviour change: the scenes with `friction: 0` colliders keep them (see Engine).

### Project

**Added**

- Tests: `PhysicsWorkerRequests.test.ts` runs the real worker module and Rapier in Node behind a fake `Worker`, covering the worker request errors, the stop, plain rotations, collider 0, all-or-nothing creates and the in-flight delete. `PhysicsFacade.test.ts` covers `MAIN_THREAD`: deletes, the stop, `getPhysicsEntityByAppId`, `isBeingDeleted` and the tiers' reattach. `backends/rapier/EngineRapier.test.ts` covers friction 0, the params left alone, the rotation composition, the ray reuse, and every mirrored enum pinned to Rapier's. The other new tests are `PhysicsTransformBuffer.test.ts`, `transport/PhysicsTransport.test.ts`, `import/MeshColliderGeometry.test.ts` (the derivation per shape, the heightfield grids), `kernel/render/Raycast.test.ts`, and the unmount hooks in `Features.test.ts` and `Mount.test.ts`.
- `src/_engine/features/physics/CLAUDE.md`: the physics detail (the layout, the worker targets, the deterministic loads, the tiers, imported physics), moved from the root `CLAUDE.md`, which keeps the rules for simulation code.
- `docs/plans/p622_engine-6-major.md`: every removal the engine's `@deprecated` tags promise for 6.0.0, plus this review's candidates (`physicsTiers()`, `createPhysicsEntity`'s options object).
- Issue files: `ecs-components-on-deleted-entities.md`, `import-physics-second-body-without-index.md`, `physics-ccd-substeps-setting.md`, `physics-unused-rapier-enums.md`, `three-ray-casting-not-public.md` and `three-vector3-store-allocates-in-app.md`.

**Changed**

- The Hub: the physics guide (the stop, the transport, the `*Sync` twins, what a failed create leaves, a new "From imported models" section), the ECS guide (`ctx.onUnmount`), the embed walkthrough (what `unmount()` stops) and the smallest-build guide (`yarn sbp --why physics`).
- The root `CLAUDE.md` (Physics, `onUnmount`, the map line), `docs/techniques/hub-authoring.md`'s `api:` examples, and the readme's physics, threading, embedding and ray casting lines.
- `yarn verify:baselines`: `api.json`, `docs.json` (every physics folder fully documented) and both bundle baselines.
- The scene runner's baselines are local: after this merge, `yarn verify:scenes --update --only scene01,scene01V2,thirdPersonGymScene` on `main` records the friction fix's hashes and snapshots.
- `sbp.config.ts`: the app's physics group budget raised from 36 to 44 KiB. The split took the group from 12 to 30 modules, and a group sums its modules' gzip, so it measures 34.7 → 42.6 kB while its code is 1.4 kB smaller rendered.
- `devTools/refactor/`'s layout report, move map and entry exports regenerated.
- p102, p250, p306, p428, p500, p511 and p619 name the files the physics code is in now. `lodshowcase-sky-snapshot-drift.md` lists the five scenes it shows in, and `remount-after-unmount.md` says physics stops.

## 2026-10-16 — review-rendering-scene-assets

### Engine 5.4.0 (Golden Hour)

The kernel's rendering, scenes, cameras, lights, meshes and assets, the assets worker, the glTF import path, PostFX and the viewports are reviewed file by file (p613): the bugs found are fixed, every export is documented, dead code is removed and two more parts of the engine leave the first download. The scene runner gives every scene the same probe hash and snapshot as on `main`, in all three physics targets and in prod test mode. One behaviour change is on purpose, under Changed. No public export is removed or renamed.

**Added**

- `loadScene` resolves `true` once the scene is current and `false` when the load failed or was replaced (it resolved `void`). It never rejects. The mount handle's `loadScene` returns the same, and `false` after `unmount()` and on a fallback handle.
- `registerOnSceneEnter`, `registerOnSceneExit`, `registerOnAllSceneEnters` and `registerOnAllSceneExits` return a remover, which removes the listener only while it's still the one under its key. Each key still holds one listener: registering again replaces it (a scene file registers on every visit).
- `registerOnAllSceneEnters`: the correct name of `registerOnAllSceneEnterings` (deprecated below).
- On `aekasha`: `decGeometryRef` (the pair of `incGeometryRef`), and the types `TextureArrayInfo` (`getTextureArrayInfo`'s result) and `UpdateLoaderStatusFn` (`SceneLoader` names it).
- On `aekasha/viewports`: `setViewportInteractive`, and the types `ViewportAnchor` and `ViewportRect`. On `aekasha/postfx`: the types `PostFxPassContext`, `PostFxPassApi`, `PostFxLiveParams` and `PostFxPassProps`. On `aekasha/schemas`: the type `PostFxParamMeta`. Each is named by a public signature.
- JSDoc on every export of `kernel/render`, `kernel/scene`, `kernel/camera`, `kernel/light`, `kernel/mesh`, `kernel/assets` (its `import/` and `worker/` too), `features/postfx` and `features/viewports`, with `@example`s on the entry functions (the deprecated loaders aside).

**Changed**

- **Behaviour change:** one scene load runs at a time. A `loadScene` call during a load used to start at once, so both loads ran every step interleaved (both ran the exit hooks, both created cameras and loaded assets, and the later one became current while the earlier one's hooks still ran). Now it waits for the running load, and a later call replaces the waiting one, which resolves `false` without loading. The waiting load starts as soon as the running one settles. Never await `loadScene` from scene code or a scene hook: the call would wait for the load it runs in.
- A failed load keeps the page working: the inputs, the canvas's pointer events, the debugger and the draggable windows are back as before the load, and the scene that was current stays current (torn down if the failure came after the teardown). An unknown scene, scene file or loader now resolves `false` before anything changes; it used to reject and leave the loading state set. A mount whose first scene fails shows its `fallbackImage` instead of a blank canvas.
- The glTF import path (`kernel/assets/import/`) loads with an `import()` the first time a scene's data names an imported asset, or app code calls `importAssetAsync`, instead of being in every first download. A scene file's own imports are still released with its scene.
- The draggable windows (`ui/DraggableWindow.ts`) are no longer in every production build: they add their scene hooks and the restore of their saved states on their first use, the restore as a step after `start` in every build. Their scene-change handling runs at the start of a load (before the exit hooks, so a window goes before the entities it shows) and once the scene has entered.
- The production build's first download is smaller: the app's main chunk (`assets/index.js`) is 383,970 B gzip, 11.1 kB less than on `main`, and its CSS 1.6 kB (was 2.7); the banner embed's main chunk is 293,296 B (12.1 kB less) and its CSS 0.9 kB (was 2.0). The new `ImportRegistry.js` chunk (4.6 kB gzip in the app) loads with the first scene that imports a model.
- `isWebGPURenderer()` and `RendererOptions.currentApi` come from the backend three picked once `createRenderer` has resolved (before, they said WebGPU wherever `navigator.gpu` exists, also when three fell back to WebGL 2 for lack of an adapter). `setRendererOptions` isn't `async`. The shadow map type defaults to PCF (three's own) and is always applied, so the Renderer debug tab's saved type applies in every app.
- `getGeometry(id)` returns `undefined` for an unregistered id (it threw a `TypeError`), so `createMeshEntity`'s own error message shows and a scene's unknown geometry id is skipped.
- Wider types, no caller breaks: `MeshProps.mat` takes a registered material's id (`createMeshEntity` already did), `MeshProps.quaternion` a plain `{ x, y, z, w }`, `ViewportProps.camera`'s resolver may return `undefined` (so `camera: getActiveCamera` works), and `LightProps.shadowPreset` the string `'LOW' | 'MEDIUM' | 'HIGH' | 'ULTRA'` (it was typed with a string enum on no entry, which no literal fits). `Materials` is `THREE.Material` (it listed every material class).
- A light's `color` / `groundColor` and the scene's `backgroundColor` take a `{ r, g, b }` colour (0-255, sRGB, as the asset JSON allows); it rendered white.
- The scene JSON's `backgroundTexture` takes a texture id only. An inline texture object passed validation and reached the scene's background as plain JSON; no scene used it.
- A missing texture input of a TSL material warns and samples one white texel (it sampled three's empty texture).
- A material's last release, and a scene's asset release, keep the textures the scene's background and environment use and those a `retainedTextures` hook names: a texture shared with them was disposed while showing. A light's cookie texture isn't covered.
- The looper indexes don't restart at 0 when a scene's loopers are cleared on its exit, so an index kept from an earlier visit can't delete a looper of the next one, and an index out of range does nothing.
- `loadTexture` and `loadTextures` moved to `kernel/assets/TextureSync.ts` (the same names on `aekasha`).
- Internal (no entry exports them): dead code removed: `Disposal.ts`, `deleteScene`, the scene resizers, `getAllScenes`, `setSceneOpts`, `getCurrentSceneOpts`, the `getScene*Loopers` getters, `getCurrentCamera` / `getCurrentCameraId` (use `getActiveCamera`), `syncCameraHelpersFromLS`, the camera's debug LS types, `getLightTargetTransform`, `setLightTargetPosition`, `aimLightAtEntity`, `setLightShadowEnabled`, the `ShadowQuality` enum, `slerp`, `GRAVITY_DOWN_NORMAL`, `isJPG`, `isPNG`, `freeGeometryGPUMemory`, `getAllGeometries`, the three `set*Persistence`, `incTextureRef` / `decTextureRef`, `updateAllMaterials`, `getMaterials`, `getAllMaterials`, `getTextures`, `togglePostFx`, `togglePostFxPass`, `invalidatePostFxPipeline`, `getCurrentSceneLoaderId`, `setCurrentSceneLoader`. `RENDERER_SHADOW_OPTIONS` moved into the renderer's debug module, `DEBUG_HELPER_USER_DATA_KEY` into `kernel/render/Object3DHelpers.ts` (with `isDebugHelperObject`), and what a load builds from the scene's data into `kernel/scene/SceneDataLoader.ts`. One FNV-1a hash (`utils/Hash.ts`) replaces four copies, with the same values, so the random streams draw the same numbers.

**Fixed**

- A scene revisit reused textures the previous visit's release had disposed: the load wrote the texture objects into the cached scene data's material params.
- `smoothDampVec3` changed the caller's `target` whenever `maxSpeed` clamped.
- A camera's `zoom` applied only from the next resize.
- A camera created in another world could become the active camera, or clear it when deleted; `setCurrentCamera` with an id that isn't a camera threw.
- `removeFromGroupEntity`'s `deleteMeshes` disposed the child's shared geometry; `disposeGroup` and `removeFromGroupEntity` looked a child's entity up in the default world, not the group's; every scene exit deleted persistent groups too.
- `setCurrentScene` ignored `backgroundColor: 0`.
- `loadTexture` without an id registered its texture twice (a release disposed it twice); the synchronous loaders' load errors threw where nobody could catch them (they log now); `loadTextures` didn't register its `EMPTY_TEXTURE` stand-ins and, with `THROW_ERROR`, never counted a failed file.
- `prewarmGeometry` leaked a material; it and `preWarmMesh` made a camera per call and left a failed compile as an unhandled rejection.
- `buildTextureArray` kept the members that had loaded when another failed; `setTextureArrayLayer` wrote into an array deleted while its member loaded.
- A failed chunk load of the KTX2 loader or the meshopt decoder broke KTX2 or meshopt for the rest of the page; the next call now loads again.
- A throw in a viewport's `onBeforeRender` or render left the renderer's target, viewport, tone mapping and colour space changed; a viewport syncing a camera entity's aspect rendered stretched after the canvas was resized; the viewports' `<body>` observer outlived an unmounted engine.

**Deprecated** (removed in engine 6.0.0)

- `registerOnAllSceneEnterings`: use `registerOnAllSceneEnters`.
- `loadTexture` and `loadTextures`: use `loadTextureAsync`, which loads the asset pipeline's output (KTX2 too) in the assets worker; await several with `Promise.all`.
- `SceneHooks.sceneDeleted`: never called, nothing replaces it.
- `LoadSceneProps.updateLoaderStatusFn`: never read; give the loader its own in `createSceneLoader`.
- `removeFromGroupEntity`'s `deleteGeometries`, `deleteMaterials` and `deleteTextures`: never read; `deleteMeshes` releases a mesh entity's geometry, materials and their textures.

### App 1.12.2 (Preschooler)

**Changed**

- `scene01` and `scene01V2` load their textures with `loadTextureAsync` instead of the deprecated `loadTexture(s)`; `scene01`'s batch example awaits them. The character visual of the gym and the top-down scene is `createCharacterVisualAsync`, awaiting its texture.
- The Hub tab of the examples uses `registerOnAllSceneEnters`.

### Project

**Added**

- Tests for the scene loader (the queue, a failed load's cleanup, the cached params over a revisit, the lazy import registry), the scene loopers and listeners, groups, cameras, lights, meshes, geometries, materials, the scene asset release, the synchronous texture loaders, texture arrays, the decoder imports, the viewports, `smoothDampVec3`, `toThreeColor`, the boot's after-start hooks, the draggable windows' lazy hooks and the hash. `schemas/RuntimeTypes.test.ts` checks that each asset JSON's type fits its runtime props type (`tsc`).
- Issue files: `failed-scene-load-keeps-its-assets.md`, `postfx-rebuilds-on-camera-change.md` and `three-animation-classes-in-builds-without-models.md` (what's left of the import path in a build without models).

**Changed**

- The Hub: the rendering, scenes and assets, viewports and smallest-build pages, and the embed walkthrough.
- The root `CLAUDE.md` (Bootstrap flow, the data pipeline's scene loads, Viewports, Snapshots, Engine features' `retainedTextures`), the sky box's `CLAUDE.md` and the readme's scene system line.
- `.schemas/scene.schema.json` regenerated (`backgroundTexture`).
- `yarn verify:baselines`: `api.json`, `docs.json` (the scope fully documented) and both bundle baselines.
- `sbp.config.ts`: six budgets lowered to their new sizes, each with its reason: in both profiles `_engine/kernel/assets` (app 27 → 20 KiB, banner 25 → 16: the import path loads on demand), `_engine/ui` (15 → 7 KiB: the draggable windows load only where used) and the CSS chunk (`index.css` 4 → 3 KiB, `banner.css` 3 → 2: the windows' styles).
- `devTools/refactor/`'s layout report, move map and entry exports regenerated. The layout report's "ui → kernel" lists the draggable windows' imports of the scene hooks and the boot's after-start hooks.
- The scene loopers issue file's "Also seen" (the scene resizers) is closed: they're removed.
- p614, p615, p618 and p619 have this review's findings in their Inputs.

## 2026-10-15 — review-ecs-loop-config-init

### Engine 5.3.0 (Golden Hour)

The kernel's ECS, main loop, config, init and views are reviewed file by file (p612): the bugs found are fixed, every export and member is documented, and the main camera lookup is cached. No public export is removed or renamed. The scene runner gives every scene the same probe hash, snapshot and system order as on `main`, in all three physics targets. Two behaviour changes are on purpose, both under Changed.

**Added**

- `ECSWorld.getEntityIdByAppId(appId)`: the world keeps a map of app ids, so `getEntityIdByAppId` is one lookup instead of a scan of every `APP_ID`. The first entity created with an id keeps it until it's deleted or its `APP_ID` removed or replaced, then the next live entity with that id takes over. A second entity given a fixed id (`isFixed`) logs a warning in the debug env. Changing `APP_ID.id` in place isn't supported: add a new `APP_ID`.
- JSDoc on every export of `kernel/ecs`, `kernel/loop`, `kernel/config` and `kernel/init`, and on every member of `ECSWorld`, `Transform`, `TypedArrayTransformStore`, `IComponentStorage` and `AppConfig` (each `physics` key included), with `@example`s on `ECSWorld`, `getEntitiesWith`, `getEntityIdByAppId`, `setTransform` and `AppConfig`.

**Changed**

- **Behaviour change:** `physics.workerTarget` defaults to `'WORKER_THREAD'`, as `AppConfig` always documented. An app that passed a `physics` section without `workerTarget` ran on `MAIN_THREAD`; it now runs on a worker. Set `workerTarget: 'MAIN_THREAD'` to keep the old behaviour. The template passes it, so no scene changes.
- `loadConfig` keeps no engine defaults: a key the app leaves out keeps the default of the module that reads it (physics in `PhysicsAPI.ts`, assets in `AssetsAPI.ts`, LOD in `LodSystem.ts`). The debug-only defaults (debug camera, drawer tabs, undo / redo, dev files) left the production bundle. The env var and debug overrides go into copies of `physics`, `assets` and `ecs`, no longer into the app's own config objects. One edge changes with it: physics turned on by `VITE_PHYS_ENABLED` alone, with no `physics` section, gets gravity −9.81 (the physics default) instead of 0.
- **Behaviour change:** with a max FPS cap (`VITE_MAX_FPS`, or the Loop controls tab's), a frame that isn't drawn still runs every stage up to `APP_RENDER_SYNC`; only the render, `LATE_MAIN` and the late scene loopers are skipped. A production build used to stop such a frame right after physics, so the app stages lost its time and the `TRANSFORM` sync lagged. A development build without `?isDebug` now honours the cap too.
- The loop is one frame function in every build (it was three variants), and isn't `async`: no promise per frame. `getAllECSWorlds()` returns the world list itself, read-only, instead of a new array each call (four per frame and one per physics sub-step).
- Fixed: a `toggleMainPlay(true)` in the first 100 ms after the start queued a second frame chain, so every frame ran twice from then on. Every frame request now goes through one guard.
- Fixed: `ECSWorld.clearWorld()` cleared the storages without running any hook (leaking Object3Ds, bodies and lines), restarted the ids at 0 and brought stale ids back to life. It now deletes each entity through `deleteEntity`.
- Fixed: `getEntitiesWith(type)` threw for a type no entity had been given yet; it now returns nothing.
- Fixed: `removeComponent` ran the remove hooks for an entity that didn't have the component. It now returns first, and a hook that removes the same component from the same entity again while it runs is ignored, so two entities whose `TARGET_LINK`s point at each other no longer recurse until the stack overflows when disabled, enabled or made persistent.
- `getMainCamera()` and `getMainAppCameraId()` read a cached entity id instead of querying `TAG_IS_MAIN_CAMERA` (p200's cache). Frustum culling, light culling, LOD and the player brains call it every frame.
- Frustum culling of point and spot lights updates each light's world matrix once per frame instead of twice; the lifetime and look-at systems return at once when no entity has their component; `addComponent` runs its hooks without a closure per add.
- The boot: the cameras' and lights' hooks install in `installKernel`, and the debug steps are three functions, each called behind its flags. When `start` resolves with nothing in the root scene and no scene load running, development and test builds log a warning (the loop starts when the first scene is set).
- The features' `onDebug` / `onDebugAfterStart` calls sit behind `IS_DEBUG_ENV`, so their closures leave a production build; physics' wireframe sync no longer registers a scene-enter listener there.
- The production build's main chunk (`assets/index.js`) is 395,092 B gzip, 501 B smaller than on `main`; the banner embed's is 246 B smaller (305,348 B).
- Internal (no entry exports them, and the lint has made deep imports an error since 5.0.0): the env flag functions and duplicates (`isDebugEnvironment`, `isProdTestMode`, `isProductionEnvironment`, `isCurrentEnvironment`, `isNotCurrentEnvironment`, `IS_PROD_TEST_ENV`, `CUR_ENV`, `APP_CONFIG`, which always held the defaults) are removed: read `IS_DEBUG_ENV`, `IS_PROD_TEST_MODE`, `IS_PROD_ENV` and `getCurrentEnvironment()`. The loop's `add*Fn` / `delete*Fn` listener sets are `onVisibilityChange`, `onBeforeUnload` and `onWindowBlur`, each returning its remover; `mainLoop` isn't exported; `initWorker` takes an options object; `registerECSModule` is `registerECSDebugGUI`; `registerCameraManager` and `registerLightManager` are `installCameras` / `registerCameraDebugGUI` and `installLights` / `registerLightDebugGUI`.

**Deprecated** (removed in engine 6.0.0)

- `CoreComponentType`: use `ComponentType`, the same object.

### Toolkit 2.1.1 (Half Moon)

**Changed**

- `FollowTool`, `HoverEffect` and `SunShadowFit` use `ComponentType` instead of the deprecated `CoreComponentType`. No behaviour change.

### App 1.12.1 (Preschooler)

**Changed**

- The asset compare scene uses `ComponentType` instead of the deprecated `CoreComponentType`.

### Project

**Added**

- A lint rule for the kernel's imports of features (`KERNEL_FEATURE_IMPORT` in `eslint.config.js`): only `import type`, for the data the kernel holds or carries for a feature. The rule is in the coding standards (Layering) and the root `CLAUDE.md`.
- `yarn verify:baselines` fails on a feature's `.onDebug(` / `.onDebugAfterStart(` call left in a production build (the app's or an embed's).
- Tests: the ECS world (`clearWorld`, unknown types, removals, the app id map), the link hooks, the main camera cache, the loop's frame cap, elapsed clock and single frame chain, the config without defaults, and `ENGINE_FEATURE_FACTORIES` against the features' entries (`FeatureFactories.test.ts`).
- An issue file for mounting again after `unmount()` (`docs/issues/remount-after-unmount.md`): won't fix until an app needs it, with what a reset would take.

**Changed**

- The Hub's API pages show a `{@link module!Name}` link as `Name`, not as the module path.
- The Hub: the ECS page (the app id lookup, the frame cap, the `onDebug` rule), the quick start (config defaults, the one public env flag) and the coding standards.
- The root `CLAUDE.md` (ECS core, the loop, Bootstrap flow, Engine features), `kernel/input/CLAUDE.md`, `devTools/verify/CLAUDE.md`, `devTools/hub/CLAUDE.md` (the search index is over its 1 MB warning on `main` too) and the readme's config sentence.
- `devTools/refactor/`'s layout report, move map and entry exports regenerated.
- `yarn verify:baselines`: `api.json` with the internal renames above, `docs.json` with the kernel's folders fully documented, and both bundle baselines. The last update moved no file's size, only gzip sizes by a few bytes (chunks name each other's new hashes) and the `#2` keys of two same-named chunk pairs (`EngineRapier.js`, `three.module.js`), which follow the hashed names' order.
- `sbp.config.ts`: the `_engine/kernel/ecs` group's budget is 17 KiB (was 15) in both profiles. A group is measured before minification, so its comments count: the new JSDoc grew it from 14.1 to 16.1 KiB in the app, while its minified code grew about 0.4 KiB.

## 2026-10-14 — sbp-tooling-profiles-and-marketing

### Engine 5.2.0 (Golden Hour)

The engine can be mounted into an element of a page it doesn't own (p611): a site's hero, a banner, a background behind the page's content. `InitEngine` stays the full-page boot: every new seam defaults to how it worked before, so the template app boots as before, and the scene runner gives every scene the same hash and snapshot as on `main`.

**Added**

- `mountAekasha({ target, config, data, features, … })` (on `aekasha`) boots the engine into its own container inside `target` (an element or a selector) and changes nothing else on the page. It resolves with a handle: `loadScene`, `pause`, `resume`, `isPaused`, `unmount`, `container` and `isFallback`. The options:
  - `width` and `height`: any CSS length, set on the container. The canvas and the cameras follow the container's box (a `ResizeObserver`), so `%`, `rem`, `vh` and `calc()` all work.
  - `layout`: `INLINE` (in the target's flow) or `BACKGROUND` (fixed behind the page's content, without pointer events).
  - `sceneId`: the first scene, by default the first one in `data`. The mount has its own scene loader, without UI.
  - `input`: `NONE` (no listeners at all, the default) or `CANVAS` (pointer and touch on the canvas; keys and gamepads while it has focus). The page's own input is never taken.
  - `pauseWhenHidden` (default true): paused while the container is out of the viewport.
  - `reducedMotion`: `RESPECT` (the default) renders the scene once and pauses until `resume()`; `IGNORE` runs either way.
  - `fallbackImage`: shown until the first frame, and instead of the scene when neither WebGPU nor WebGL2 is available or the boot fails. The handle's `isFallback` is then true and its methods do nothing.
  - `assetBaseUrl`: the folder the app's files (`aek-assets/`, `basis/`, `draco/`) load from, in place of the page's. An embed served from its own folder passes its module's URL.
  - `canvas` and `renderer`: the canvas's attributes and `createRenderer`'s options (`alpha: true` lets the page show through).
- Limits: one engine per page load. A second mount throws, also after `unmount()`, since the registrations are static (p612 owns that). `unmount()` stops the loop, removes the listeners, the observers and the container, and disposes the renderer, but doesn't stop a physics worker (p614).
- `getCanvasSize()` (on `aekasha`): the canvas's size, the window's for the full-page boot and the container's for a mount. The renderer's resize and the cameras read it.
- `createRenderer({ parent, canvas: { id, className, style } })`: the element the canvas goes into (default `#mainCanvas`) and the canvas's id, classes and inline styles. New types `CreateRendererOptions` and `RendererCanvasOptions`. Neither is saved with the renderer's debug options.

**Changed**

- The page styles (normalize, the rules on `html`, `body`, `*`, `#mainCanvas` and `#guiContainer`) moved into `ui/styles/page.scss`, which only `InitEngine` imports. A mount loads only the components' styles (2.0 kB gzip). The app's `index.css` holds the same rules in another order, at the same size. The dev server doesn't tree-shake, so a mount served by it still gets the page styles.
- The input devices register a remover each, and the gamepad reads its pads only in scope (always for the full-page boot, never for `NONE`, while the canvas has focus for `CANVAS`).
- `getCanvasParentElem` returns `createRenderer`'s `parent`, and `getCanvasElem` the renderer's canvas.
- The asset URLs (`aek-assets/`, KTX2's transcoder, Draco's decoder, textures, glTF sources) are resolved through one base, which `assetBaseUrl` replaces. The default is the same URL as before.
- A production build no longer ships the 3D symbols' files (`3DSymbols.glb` and `3DSymbolsTextures.png`, 114.5 kB gzip). They were never loaded, but deployed: Vite emits a `?url` import's file when it loads the module, and Rollup loads every `import()`. Their imports moved into the `_dbg__` module, loaded behind `__AEK_DEBUG__ ?` (the trap is in `src/_engine/debug/CLAUDE.md`).
- The production build's main chunk (`assets/index.js`) grew from 394.3 to 395.6 kB gzip: the input scope, the size source and the boot's split.

### App 1.12.0 (Preschooler)

**Added**

- The `banner` embed profile (`src/app/profiles/banner/`), the Smallest Build Possible's floor: one code-made scene, no feature, built as an embed module.
  - The scene: a dodecahedron (Plato's solid of the aether) turned by a scene app looper, one directional light, the camera and no background, so the page shows through.
  - Its material, `bannerAether` (TSL): an indigo-to-teal gradient, a breathing cyan rim and the brand orange on the faces turned upward.
  - The entry, `banner.embed.ts`: `mount(opts)` binds the profile's data, `features: []` and a transparent renderer, and loads its files from its own folder in a build.
  - A transparent Hub image, `banner.hub.png`: the live embed's poster. The banner has the Hub tab (`_dbg__exampleHub.ts`), which saves it without the background.
- Built, it's 300.6 KiB gzip before the first frame, three nearly all of it.

### Project

**Added**

- `yarn sbp` (the Smallest Build Possible report, `devTools/sbp.ts` and `devTools/sbp/`): builds the profiles of `sbp.config.ts` and reports what loads before the first frame and what later, each group's and feature's size, why each feature is in the first download (the shortest import chain from the entry, `--why <group | module path>` for anything), the scenes' feature manifests next to it, and the diff against the committed baseline. `--profile <id>[,<id>…] | all`, `--no-build`, `--no-app-build`, `--json`, `--brief`. Its output goes to `.cache/sbp/progress.log` and `.cache/sbp/report.json`.
- Budgets in `sbp.config.ts`, gzip bytes, per profile: the initial download, chunks, groups and modules. Over a budget fails (exit 1); well under one is reported with a tighter value. The app has 25 (initial 404 KiB), the banner 19, with every feature group at 0.
- `yarn build` runs `yarn sbp --profile all --no-app-build --brief` (the app it just built, and each embed profile built and checked) before the Hub. `AEK_SBP=false` skips it.
- Embed profiles: a profile whose entry is a `.ts` module builds with `vite build` into `dist-embed/<id>/` (gitignored), its entry unhashed at the root, the rest in `assets/`, the CSS linked by the entry. The data's files are copied, and what the entry can't reach (the physics worker and Rapier without `physics()`) is pruned. The gatherer writes each embed profile's data, with only its scenes and their loaders, into `src/generated/profiles/<id>/`. Vite's library mode was compared and not used: it inlines every `new URL` file as base64 and doesn't minify ES output.
- `yarn verify:embed`: mounts each embed profile's build into a plain host page in Chromium, `INLINE` at a size in % and `BACKGROUND`, checks the canvas's size, that something is drawn, the unmount, a second mount rejecting and that no computed style of the host's elements changes, and runs the Hub's embed example page. `--webgl` for WebGL2.
- `yarn verify:baselines` builds and records each embed profile too (`bundle.banner.json`, next to `bundle.json`) and fails on a debug asset in a production build: a file whose source is in a debug folder or which only debug modules import.
- Hub:
  - The Smallest build possible feature page, featured on the homepage in place of the debug suite, so the four featured match the four principles. The banner runs live on it, next to the real numbers.
  - The example page "Embedding a scene": the profile, the entry, building it, a site's page (checked by `yarn verify:embed`), the options, the handle and the limits.
  - The `::: embed <profile> [height]` directive: the profile's Hub image as a poster, the embed imported when it scrolls into view and mounted, a pause button; the poster with a play button for reduced motion, and a line saying why without WebGPU or WebGL2. `yarn hub:build` copies the build into `_assets/embed/<id>/` (`--no-embed` keeps the poster).
  - `{{sbp:<profile>.<measure>}}`: a size from the last `yarn sbp` report, so a page can't state a stale number.
- `devTools/sbp/CLAUDE.md` (the report, the profiles, the budgets, the embed build).
- The lite-renderer study (p611 §7): no lite profile on three's `WebGLRenderer` now. It would save about 110 KiB for a second material path; the engine's own 62.9 KiB over three come first. Those, the manifest fold and a `physicsTiers()` feature are filed in p612, p613, p614 and p617's "From p611" sections.

**Changed**

- The fourth core principle, Smallest Build Possible, in the root `CLAUDE.md`'s brand section, the readme's "Why Ækasha?" and the Hub's Features intro.
- `readme.md`: Features (Smallest build possible, Embedding), a highlight, the commands, the project tree and example 7, "Embed a scene in a site".
- `verify:baselines`' bundle model moved into `devTools/sbp/bundleModel.ts`, which `yarn sbp` shares; the browser launch into `devTools/verify/browser.ts`, which the scene runner and `verify:embed` share.
- `yarn verify:baselines`: `bundle.json` without the 3D symbols' files and with the banner scene's two chunks; `api.json` and `docs.json` with the new exports, every one documented.

## 2026-10-13 — character-and-input-action-architecture

### Engine 5.1.0 (Golden Hour)

Characters are rebuilt on p603's contracts (actors, controllers and brains) over a new input action layer, and simulate identically on every run on `MAIN_THREAD` (p610). Every removal is a `@deprecated` alias until engine 6.0.0 (Deprecated, below), so an app made from 5.0 still compiles and runs. The scene runner gives every scene the same probe hash and snapshot as on `main`, except the gym's (Changed, below). The system order is also the same, except for the new brain system.

**Added**

- The input action layer (`kernel/input/`, on `aekasha`): `createActionMap({ id, context, actions, bindings })` maps devices to named actions of four types: `BUTTON`, `AXIS_1D`, `AXIS_2D` (clamped to length 1, so a keyboard diagonal is no faster) and `DELTA_2D` (summed between samples). Bindings are plain data per device:

  - keyboard: `keys`, and the `negative` / `positive` and `up` / `down` / `left` / `right` composites;
  - mouse: `button`, and `delta: 'MOVE' | 'WHEEL'`;
  - touch: `gesture: 'TAP' | 'DRAG'`;
  - gamepad: `button`, `axis` and `stick` (radial deadzone).

  `createActionMap` has a `const` type parameter, so action ids are typed and each binding is checked against its action's type. Also: `getActionMap`, `getActionMaps` and the types.

- Two ways to read an action:
  - At the step: `map.read(id)`, sampled right before each fixed sub-step. Presses and releases between two samples are counted, so a tap shorter than a step isn't lost, and a jump lands on exactly one step. Simulation code reads this.
  - At the event: `map.onPressed` / `onReleased`, called when the device reports it, also while the loop is paused or an editor view is active. Debug keys and UI use this.
- Action contexts: `GAMEPLAY` (suspended in editor views and, by default, while the debug camera is on), `DEBUG` (every view) and app-defined ones, switched with `setActionContextEnabled` / `isActionContextEnabled`. A map can also be scene-scoped (`sceneId`).
- Action recording, per step as plain data: `recordActions(map).stop()` gives `{ mapId, firstStep, lastStep, frames }`, and `playActionRecording` stands in for the map's devices while it plays.
- An app without action maps bundles none of the layer: the main loop calls its sampler through a hook the first `createActionMap` sets.
- The gamepad (`GamepadInput.ts`, a stub before): the standard mapping's buttons, axes and sticks by name. The pads are polled once per frame while a map has a gamepad binding. Also `getConnectedGamepads`, `onGamepadConnected` and `onGamepadDisconnected`.
- Seeded random streams (`utils/RandomStreams.ts`, on `aekasha`): `getRandomStream(name)` returns a `() => number` seeded from the world seed and the name, so one stream's draws don't depend on another's. Also `setRandomSeed` and `getRandomSeed`. Every `loadScene` restarts the streams right before the physics world is replaced, so a scene draws the same numbers on every visit. `createSeededRandom` moved here from the toolkit, with the same output.
- Actors, controllers and brains (`aekasha/character`):
  - The contracts: `ActorController` (`kind`, `tick(dt, intent, step)`) and `ActorBrain` (`kind`, `think(intent, step, dt)`, `configDefaults`, `dispose`).
  - The registries: `registerBrainKind`, `registerControllerKind`, their `unregister*` and `get*Kinds`. Kinds and their params come by declaration merging (`CharacterBrainKinds`, `CharacterControllerKinds`), so a `{ kind, params }` spec is type-checked per kind.
  - `createCharacterOfKind({ id, visual, controller, brain? })` makes a character from data.
  - `setCharacterBrain(id, spec | null)` switches a brain at runtime.
  - One system runs every brain at `APP_PHYSICS_STEP` order -5, between the app's systems (0) and the controllers (-10).
- Player brains, registered by `character()`: `TANK`, `WORLD_FIXED` and `CAMERA_RELATIVE`. Each owns an action map (`<characterId>:input`, `GAMEPLAY`) built from its `bindings` param, with `runMode` / `crouchMode` (`HOLD` or `TOGGLE`) and `turnToMoveDirection`.
- `turnToLastMoveDirection` (`WORLD_FIXED`, `CAMERA_RELATIVE`): the character keeps turning in place until it faces the last direction it moved in. A short tap of W while facing South turns it all the way North. `releaseGraceMs` (default 80 ms, counted in steps) keeps a diagonal whose keys are let go a step or two apart.
- `createDynamicCharacter` gains three things:

  - Its `brain` option.
  - Its `config` option (`Partial<DynamicCharacterConfig>`, unprefixed keys).
  - The `controller` it returns, which keeps its data as `state`, `config` (`{ values, initial, bakedKeys, onChange, applyDefaults }`) and `internal`.

  New types on the entry: `DynamicCharacterState`, `DynamicCharacterConfig`, `DynamicCharacterInternal`, `DynamicCharacterController`, `CharacterController`, `CharacterControllerConfig`, `CharacterConfigValues`, `CharacterIntent`, the actor types and the player brains' params.

- `bodyKind` on `CharacterObject`, `CharacterBodyPlan` and `CreateCharacterOpts`. `CharacterCastRecord.resolvedAtStep`.
- `bodyTypeSync()` works in `WORKER_THREAD` mode. The worker's body proxy keeps its type, from creation and `setBodyType`.
- `FixedStepDriver.step`'s `onBeforeStep` gets the step index as an optional second argument.
- The test bridge (version 4) adds two things. `getCharacterPaths()` hashes every character's pose and locomotion state per step. A scripted input plays key events right before given steps, from a debug-only pre-step hook in the main loop.

**Changed**

- Characters are deterministic on `MAIN_THREAD`. These behaviour changes are on purpose:
  - Durations are whole steps. The configured values stay in ms and are compared against the steps passed × the fixed timestep, so `jumpCooldown: 100` is 6 steps at 60 Hz. The stamps are step indices (`…Step`, `-1` for "not set").
  - The floor ray and the wall cast are synchronous on `MAIN_THREAD` and used in the step that fires them. Before, the result landed a microtask after the frame, one or more steps later depending on the frame timing.
  - Only the tick writes the body. The wall sensor's tumble start runs in the next tick, not when its promise resolves, and `isNearWall` is set in the event flush of the same sub-step. The floor sensor's tumble start and landing velocity are applied by the tick.
  - The tumble's direction comes from `getRandomStream('character:<id>')`, not `Math.random`.
- The gym's probe hash changed, at its new 600 probe steps.
- Characters stay non-deterministic in the worker targets: the controller ticks on the main thread against the latched snapshot and async casts. `docs/plans/p428_character-determinism-in-worker-targets.md` owns that.
- Player characters no longer move while the debug camera is on: gameplay action maps default to `NOT_ENABLED_IN_DEBUG`.
- The dynamic character is split into `features/character/controllers/dynamic/`: `DynamicCharacter.ts` holds the factory and the tick's order, beside `Floor`, `Wall`, `Platform`, `Jump`, `Tumble`, `Crouch`, `Locomotion`, `Casts` and `DynamicCharacterData`. The player brains are in `brains/`. The `DYNAMIC_CHARACTER` kind `import()`s the controller, so it's a chunk of its own.
- `CharacterBodyData` and the body plans' sizes are unprefixed (`height`, `radius`, …). A custom body plan that read the `_` keys must change; it was never on an entry, so there is no alias.
- The engine's debug keys are three `DEBUG` action maps: `aek:debugKeys` (the defaults with `AppConfig.debugKeys`' overrides), `aek:appDebugKeys` and `aek:prodTestKeys`. `AppConfig.debugKeys` keeps its shape. Behaviour changes:
  - A new keydown of a key that is already down counts as a press, for every action map. On macOS, ⌘Z followed by Z again is a second undo: macOS sends no keyup for Z while ⌘ is held.
  - A debug key's keydown is prevented outside a text field (h, u, i, o, p and § too; no visible effect).
  - A held F key's key-repeats in a text field aren't prevented any more (the press still is).
  - A `CONFIG.ts` debug key's fn no longer gets key-repeats, and `setKeyInputsEnabled` no longer stops the debug keys.
  - A key binding with a debug key's id no longer replaces it: both run, with the reserved-chord warning. That warning now covers action maps' keyboard bindings too.
- The keyboard shortcuts dialog lists the engine keys from the live map (rebound, unbound, disabled) and, under App, each action map's actions next to the key bindings.
- The character state window reads the controller's `state`, `config.values` and `internal`, and shows stamps as "N steps (M ms) ago". "Copy changes" gives a `config` snippet. The saved tuning (`AEK_debugCharConfig`) keeps its format, so values saved before still apply.
- `getPhysGameTime()`'s wall clock (`PhysicsWallClock.ts`) is read by no simulation code. It stays until 6.0.0.
- The production build's main chunk (`assets/index.js`) grew from 386.4 to 394.3 kB gzip, and from 155 to 165 modules:
  - `kernel/input` grew from 3.5 to 11.5 kB, for the action layer: the player brains, registered at install, keep it in the main chunk.
  - `features/character` grew from 2.3 to 5.3 kB, and `utils` from 2.5 to 3.0 kB (the streams).
  - The controller is its own `DynamicCharacter.js` chunk (7.4 kB). The gym's `characterVisual.js` chunk carried it before, and fell from 7.4 to 0.5 kB.
  - The `SeededRandom.js` chunk is gone.

**Deprecated** (removed in engine 6.0.0)

- `getPhysGameTime()`: use the step index (`getPhysicsSubStepIndex()`) times the fixed timestep.
- `CharacterCastRecord.resolvedAt`: use `resolvedAtStep`.
- `DynamicCharacterOpts.input` and its scheme types: use `brain`. `input` still works, mapped to the same kind's player brain with its `mappings` as keyboard bindings, and `brain` wins over it, with a warning.
- `charData`: use `config`, which wins over it.
- `CharacterObject.kind` and `CharacterBodyPlan.kind`: use `bodyKind`.
- `CharacterObject.keyBindingIds` and `mouseBindingIds`, and `CreateCharacterOpts.controls`: use a brain.
- The flat data view, made once at creation, with nothing per frame: `CharacterObject.data` and `initialConfig`, `CreateCharacterOpts.data`, `DynamicCharacter.data` and the `CharacterData` type. Use the controller's `state`, `config.values` / `config.initial` and `internal`.

### Toolkit 2.1.0 (Half Moon)

**Added**

- The follow camera rig's options (`FollowObjectCameraParams`); the defaults keep the old behaviour:
  - `orientation: 'LOOK_AT_TARGET' | 'FIXED'`. `'FIXED'` looks along `-offset` and only moves the camera, so the view never swings while it catches up. It applies only without mouse input.
  - `lookAhead: { distance, smoothingTime?, returnSpeed? }`. The followed point leads the target by `distance` in its horizontal direction of travel, eased in over `smoothingTime` (0.6 s). When the target stops, the lead returns at `returnSpeed` (1 m/s; 0 keeps it where it is).
  - An `@example` on `createFollowObjectCameraRig`.
- The toolkit's first unit tests: `FollowObjectCameraRig.test.ts`.

**Changed**

- The rig's `LERP` and `SMOOTH_DAMP` ticks are one tick, with the smoothing step chosen once. The camera path is the same as before, bit for bit.
- `afterLookAtFn`'s `targetPos` is the followed point, which differs from before only with `lookAhead`. `targetHeight` is documented as mouse-only, which it always was.
- The generators (`Asteroid`, `Foliage`, `Terrain`, `ScatterOnSurface`) import `createSeededRandom` from `aekasha` and draw the same numbers.

**Deprecated**

- `createSeededRandom` on `aekasha/toolkit/geometry`, now a re-export from `aekasha`: import it from there (removed in toolkit 3.0.0). `geometry/SeededRandom.ts` moved to the engine.

### App 1.11.0 (Preschooler)

**Added**

- The character example, `exampleCharacter` (`src/app/examples/character/`). The level:

  - a 30 × 30 ground with a low wall round it;
  - a 17° ramp to a 1.5 m platform, and stairs to a 1 m one;
  - crates and a low block.

  The character runs on a `WORLD_FIXED` brain:

  - W/A/S/D and the arrow keys move it North, West, South and East;
  - Space jumps, Shift (held) runs and C crouches;
  - `turnToLastMoveDirection` is on.

  The camera follows with `orientation: 'FIXED'` and a 1.5 m `lookAhead`. It has a HUD line, a Hub image and Hub regions.

- The gym's dummy is an app brain kind, `GYM_DUMMY` (`scenes/thirdPersonGymScene/GymDummyBrain.ts`), registered in `AppECSPlugins.ts`' install. The scene no longer adds or removes a system for it.

**Changed**

- The gym's players and `topDownTestScene`'s character use `brain` and `config` (not `input` and `charData`). The gym's TANK player is on a gamepad too:
  - the left stick turns and moves;
  - South jumps, East crouches;
  - pressing the left stick runs.
- On action maps: `physicsTiers` and `largeWorld` (C, the camera), `assetCompare` (V, the slot), `examplePhysics` (Space or the gamepad's South drops a shape) and `exampleSkyBox` (Space and the arrows). Changes:

  - The keys do nothing while the debug camera is on.
  - The toggles act on the press, not the release.
  - `exampleSkyBox` ignores key-repeats: holding an arrow moves one hour.
  - Ctrl+C and Ctrl+V don't toggle anything.

  `scene01`'s D (a latency log) and the gym's stress test J stay key bindings.

- `examplePhysics` draws its drops from `getRandomStream('examplePhysics:drops')`, so they come in the same order on every visit. Its Hub walkthrough explains the map and the stream.
- The app imports `createSeededRandom` from `aekasha` (seven modules); the same numbers.

### Project

**Added**

- Recorded runs in the scene runner. A scene's `inputScript` (`devTools/verify/scenes.config.ts`) plays key events right before given steps, and the characters' path hash is compared with its baseline on `MAIN_THREAD`. The gym runs 600 steps of `devTools/verify/inputs/thirdPersonGymScene.json`: two players walking, turning, running, crouching, jumping and tumbling into the props, and the dummy looping. That path hash (`a51d785e`) stayed the same through every phase of the refactor.
- Hub:
  - The Input feature page: action maps, bindings per device, reading at the step or at the event, contexts, the gamepad, recording, and the device bindings as the low-level API.
  - The character example's page.
  - The characters page's scene panel, and in its guide brains, your own brain, controllers and determinism.
  - A line each in the physics and debug suite guides.
- Nested `CLAUDE.md` files for `features/character/` (characters, brains, the dynamic controller, its debugging) and `kernel/input/` (devices, action maps, the gamepad).
- `docs/plans/p428_character-determinism-in-worker-targets.md` (stub): characters in the worker targets. p512 and p421 point at it, and p614 lists it as an input.

**Changed**

- The simulation lint's randomness message names `getRandomStream`. The dynamic character's `Math.random` allow-list entry is gone, and `GymDummyBrain.ts` is on the list.
- `scenes.config.ts`: the gym's `unstableHash` covers only `workerSab` and `workerMsg`, with the reason (p428). The scene baselines are recorded again for the gym (600 probe steps), `topDownTestScene` and `exampleCharacter` (new), and for the system order (`characterBrainSystem`).
- `yarn verify:baselines`: the API, docs and bundle baselines updated for the new exports and the chunks above. `kernel/input`'s documented exports go from 27 of 51 to 99 of 122: every new export is documented.
- `readme.md`'s Features (input, characters, deterministic scene loads, the toolkit's rig), a highlights row ("Input at the step") and the Hub's example list. The root `CLAUDE.md`: physics' determinism and RNG lines, the toolkit's geometry, and the map's two new nested files.
- The Hub's search index is 1.19 MB, still over its 1 MiB budget (p619).

## 2026-10-13 — toolkit-and-app-restructure

### Engine 5.0.2 (Golden Hour)

No code changes.

**Changed**

- The nested `CLAUDE.md` files of the debug system, LOD and impostors name the app's new paths (`app/scenes/lodShowcase/`, `app/scenes/space/_dbg__spaceDemo.ts`), and say where an exported impostor goes when one scene uses it.

### Toolkit 2.0.2 (Half Moon)

The toolkit becomes a catalogue by kind (p609). Only moves and renames: every `aekasha/toolkit/*` entry exports the same names, and every scene's hash and snapshot is the same as before. An app that imports the toolkit through its entries has nothing to change; one that copied a toolkit file keeps its copy.

**Changed**

- `ecs/`: `FollowObjectCameraRig.ts` and `MovingPlatform.ts` move into `ecs/gameplay/`, next to `ecs/effects/`.
- `geometry/`: the generators move into `generate/` and drop their `generate` prefix (`generateAsteroid.ts` → `generate/Asteroid.ts`, `Foliage.ts`, `Terrain.ts`), `scatterOnSurface.ts` → `scatter/ScatterOnSurface.ts`, and `seededRandom.ts` → `SeededRandom.ts`.
- `materials/`: a folder per material, named by its id (`materials/asteroid/asteroid.material.json` and `asteroid.tsl.ts`, `triplanarCheckerboard/`, `triplanarGrid/`); `triplanarProjection.ts` → `TriplanarProjection.ts`.
- `models/`: models sit by category, `models/<category>/<id>/`; the Æ symbol is in `models/brand/aekashaSymbol/`. Its optimized output keeps its bytes under the new path (`aek-assets/toolkit/models/brand/…`), which only the generated data names.
- On a case-insensitive file system (macOS, Windows), a checkout can keep `seededRandom.ts` or `triplanarProjection.ts` under its old name after the pull; `tsc`'s casing check names it.

### App 1.10.2 (Preschooler)

The app gets a folder per scene (p609). Every scene keeps its id, so `__saveData`, `?startScene=`, the debugger's saved state and the scene runner's baselines carry over.

**Changed**

- `src/app/scenes/<sceneId>/` holds each scene's JSON, its scene file, its `_dbg__` module and Hub image, its own modules and the assets only it uses. The files are named after the scene id: `scene01_v2.ts` → `scenes/scene01V2/scene01V2.ts`, `testECS.ts` → `scenes/sceneTestECS/sceneTestECS.ts`, `scene_thirdPersonGym.ts` → `scenes/thirdPersonGymScene/thirdPersonGymScene.ts`, `scene_topDownTest.ts` → `scenes/topDownTestScene/topDownTestScene.ts`, `debugScene.scene.ts` → `scenes/testDebugScene/testDebugScene.ts`, and the scene JSONs the same way.
- The assets only one scene uses move into its folder: the large world's, LOD showcase's, physics test's, physics tiers', sky showcase's, space's, gym's and top-down test's cameras and lights, their impostors, the asset compare's sky box, the texture arrays and atlases (with the atlas sources) and `sceneTestECS`'s camera, light, materials, meshes, geometry and import. `characterVisual.ts` moves into the gym's folder; the top-down test imports it from there.
- The shared assets stay in their type's folder (`cameras/`, `lights/`, `impostors/`, `skyboxes/`, `textures/`, `postFx/`); `materials/`, `meshes/`, `geometries/` and `importedAssets/` are empty and gone. `src/app/shared/` is the place for code several scenes use (none yet). The rule is on the Hub's Scenes and assets page ("Where the files go").
- Every moved asset JSON's `$schema` points at its schema from its new folder; the scene JSONs whose `$schema` was broken (ten of them), `testDebugScene` and `oneMoreScene` (which had none) and `ambientLight` (whose key was misspelled `"$schemas"`) now check and autocomplete in the editor.
- The optimized outputs of the moved textures, atlases and impostors keep their bytes under their new paths (`aek-assets/app/scenes/<id>/…`).

### Project

**Added**

- The move codemod rewrites asset JSONs (`devTools/refactor/moveJson.ts`, tested): a moved or pointed-at file's `$schema`, a scene's `sceneFile` and a TSL material's `tslFile` (both from the JSON's root under `src/`), and every other `./` or `../` path, as text edits on the string values, so formatting and `__saveData` stay byte for byte.
- An issue file for `lodShowcase`'s snapshot, which fails against a baseline recorded earlier because its clouds follow the wall clock (`docs/issues/lodshowcase-sky-snapshot-drift.md`).

**Changed**

- `devTools/refactor/moveRules.ts` describes the toolkit's and the app's layouts as keep rules, like the engine's since p608: `moveMap.ts` fails on a file outside them (app files included now), and its map is all keeps. Its scan for mentions of moved paths no longer matches every position when nothing moves.
- The lint's Prettier rule skips `src/generated/`: `yarn lint --fix` and every gather undid each other's formatting of a generated import the move made longer.
- The root `CLAUDE.md`, the readme and the Hub (Toolkit, Scenes and assets, the quick start, LOD) describe the new layouts. The readme's toolkit list is corrected besides (it named a plain checkerboard material, and missed `MutualGravity`, the gameplay pieces and the asteroids), and the toolkit page lists the gameplay pieces.
- The p450 prompt (`docs/templates/todo-plan-prompts.txt`) records what p300 and p609 decided about the asset locations and the toolkit's folders, and keeps moving the debugger test files out of `public/`.

## 2026-10-12 — engine-folder-restructured

### Engine 5.0.1 (Golden Hour)

The engine's files move into the layout of p602: the folder says what a file is. Only moves and renames: every entry exports the same names, and every scene's hash, snapshot and system order is the same as before (the scene runner ran 96 of 96 against `main`'s baselines, in all four configurations). An app that imports only the `aekasha*` entries (the lint makes anything else an error since 5.0.0) has nothing to change.

**Changed**

- `core/`, `workers/`, `styles/`, `3dModels/` and most of `utils/` move into new folders:
  - `kernel/`: what every app runs, one folder per area (`ecs/`, `loop/`, `config/`, `init/`, `scene/`, `assets/` with `import/` and the assets worker, `render/`, `camera/`, `light/`, `mesh/`, `input/`).
  - `features/<name>/`: each of the nine features, with its entry, its `<Name>Feature.ts`, its worker, its `debug/` modules and its nested `CLAUDE.md`.
  - `ui/`: the UI kit, with the global styles in `ui/styles/`.
  - `debug/`: the debugger framework.
  - `utils/` holds only pure modules. `schemas/` and `types/` stay. The engine root holds only `index.ts` and `ModuleLoad.test.ts`.
- Debug modules sit next to the code they debug: a kernel area's or a feature's own `debug/` folder (`kernel/render/debug/_dbg__Renderer.ts`, `features/skybox/debug/`). `core/Debug/` is gone, and a debug folder holds nothing that ships. `debug/Assets.ts` and `debug/PostFXProfiler.ts` stay wrappers in `debug/` until p618 merges them into their features.
- File names follow one rule: every module is PascalCase, and no file has a `Manager` suffix:
  - PascalCase: the 19 schemas (`sceneSchema.ts` → `SceneSchema.ts`), `assert.ts`, `deepMerge.ts`, `jsIdentifier.ts`, the worker modules (`physicsWorker.ts` → `PhysicsWorker.ts`, `assetsSwitchGLTF.ts` → `AssetsSwitchGLTF.ts`).
  - No `Manager` suffix: `CameraManager.ts` → `kernel/camera/Camera.ts`, `LightManager.ts` → `kernel/light/Light.ts`, `MeshManager.ts` → `kernel/mesh/Mesh.ts`, `GroupManager.ts` → `kernel/scene/Group.ts`, `LineManager.ts` → `features/lines/Lines.ts`, `PhysicsManager.ts` → `features/physics/PhysicsEntity.ts`, `ViewManager.ts` → `kernel/render/Views.ts`, `DebugToolsManager.ts` → `debug/DebugTools.ts`.
  - Also renamed: `InitApp.ts` → `kernel/init/InitEngine.ts` and `core/Helpers.ts` → `debug/SceneHelpers.ts`.
  - On a case-insensitive file system (macOS, Windows), a checkout can keep an old file name after the pull. `tsc`'s casing check names any such file.
- `utils/helpers.ts` and `utils/constants.ts` are split into nine modules by what they hold: `AssetFiles`, `Disposal`, `ThreeMath`, `Numbers`, `MeshUserData`, `Workers`, `DebugModules`, `LightHelpers` and `Constants`. The debug loaders (`loadDebugModule`, `loadDebugModuleAsync`, `useDebug`, `isDebugReady`, `DebugModuleRef`) are now in `kernel/config/DebugModules.ts`, next to `Config.ts`. Shipping code calls them, so they belong to the kernel, not to a debug folder.
- The Hub's API pages are per module path, so every engine API URL moved (`documentation/engine/core/SceneLoader/` → `documentation/engine/kernel/scene/SceneLoader/`). There are no redirects: bookmarks and outside links to engine API pages break, until p619 switches the API reference to the entries.
- The production build: the main chunk (`assets/index.js`) is 4589 B smaller rendered and 403 B smaller gzipped, with 151 → 155 modules (the split parts). `setMeshCreatePropsToUserData` (`kernel/mesh/MeshUserData.ts`) is used only by the physics import's mesh colliders, so it left the main chunk for the lazy `ImportPhysics.js` chunk (2067 → 2549 B gzip). In all, the build is 84 B smaller gzipped. The seven chunks named after a renamed module take its new name (`PhysicsWorker.js`, `AssetsWorker.js`, `AssetsSwitchGLTF.js`, `AssetsSwitchSimplify.js`, `AssetsSwitchTexture.js`).

**Removed**

- `utils/materials/checkerBoardPattern.ts` and `nestedGridPattern.ts`: nothing imported them, and no entry exported them.

### Toolkit 2.0.1 (Half Moon)

**Changed**

- `bakeScatterToInstancedMesh`'s JSDoc names the engine's new path for the ECS stress test (`kernel/ecs/debug/ECSStressTest.ts`).

### App 1.10.1 (Preschooler)

**Changed**

- The comments in `_dbg__lodShowcase.ts` and `examples/_dbg__exampleHub.ts` name the engine's new paths.

### Project

**Added**

- The move codemod, `npx tsx devTools/refactor/applyMoveMap.ts --plan <plan>` (in `refactor/`: `moveApply.ts`, `moveText.ts`, `moveSplit.ts`, `moveEdits.ts`, `moveTree.ts`, each tested on in-memory trees). It applies `moveMap.json`'s entries for a plan:

  - renames, through a temporary name for the case-only ones; deletes; and splits a module per export;
  - rewrites every import specifier (static, `import type`, `export … from`, `import()`, `typeof import`, `vi.mock`, `new URL`, `?raw` / `?url` / `?worker`, `import.meta.glob`) and the SCSS `@use` / `@forward`;
  - rewrites the paths in documents and comments, the Hub's `hub:documentation/engine/…` links and TypeDoc's module links;
  - edits the globs and regexes through a checked table (`MOVE_EDITS`).

  It computes everything before writing anything, and writes nothing on an error. Its other modes:

  - `--dry-run`: applies in a scratch worktree, then runs `tsc`, the tests, the lint and `yarn build` there.
  - `--verify-commit <sha>`: checks that a commit is exactly the tool's output on its parent.
  - `--leftovers <base-sha>`: lists the old paths still named anywhere.

  The move commit (`1d65320`) is its output on `5491035`. p609 moves the toolkit and the app with the same tool.

- `npx tsx devTools/refactor/compareBaselines.ts --plan <plan> <base-sha>`: compares the API, docs and bundle baselines after a move with the base's, mapped through the base's map. The exports may differ only by their modules' paths, `entries` must be the same, the documented and undocumented totals the same, and each chunk within the tolerance under its mapped name. The tolerance rule moved to `devTools/verify/bundleGrowth.ts`.

**Changed**

- The debug rule: the lint's `DEBUG_FILES` and the side-effects test find debug code by the `_dbg__` name alone. `yarn verify:baselines`' production check fails on a `_dbg__` module or on any module in an engine folder named `debug` (in any case), except the entry `src/_engine/debug/index.ts`. This replaces the `core/Debug/` pattern and the wrapper regex.
- `moveRules.ts`' engine rules are nine keep rules for the new layout: `index.ts`, `ModuleLoad.test.ts`, and the folders `kernel/`, `features/`, `ui/`, `debug/`, `utils/`, `schemas/`, `types/`. `moveMap.ts` fails on a file outside them. The layout report shows the same boundary findings as before the move, by their new paths: 23 kernel → feature imports (type-only), 2 ui → kernel, 1 schemas → kernel, and no feature cycle. p609's entries don't change.
- `eslint.config.js`' `SIMULATION_FILES` covers the same files as before: `features/physics/**` and `features/character/**`, with `SIMULATION_IGNORES` leaving out each feature's install, its entry, the physics import extension and the debug modules.
- The baselines are recorded under the new paths: `api.json`, `docs.json`, and `bundle.json`, whose main chunk groups split `kernel/` and `features/` per subfolder.
- The root `CLAUDE.md` (the three-folder split, the debug system, physics), the nested `CLAUDE.md` files, `readme.md`'s tree, the Hub's guides and coding standards, and `docs/issues/` describe the new layout.
- Tests: 305 in all (`moveApply.test.ts`, `moveText.test.ts`, `moveSplit.test.ts`, `moveEdits.test.ts`, `moveTree.test.ts`, `compareBaselines.test.ts`, and the production check's case for each kind of debug folder).

## 2026-10-11 — stage-b

### Engine 5.0.0 (Golden Hour)

The engine stops importing the app, gets public entry points, and installs only the features an app lists: a production bundle holds what the app lists and uses. Apps made from the template migrate with the Hub's guide (Documentation → Migration → "Engine 4 → 5") and the import codemod (Project, below).

**Changed**

- `InitEngine({ config, data, features, start })` (`InitEngineOptions`) takes what it used to import: `config` is `src/CONFIG.ts`'s default export, merged over the defaults as before (`loadConfig(appConfig)`); `data` is the gathered data (`appData` from `src/generated/`); `features` (required) is the engine features to install, in order, and the app's own (Added, below); `start` is the callback `InitEngine` took before. The engine no longer imports `src/AppECSPlugins.ts`: the app's plugins are a feature it lists last.
- Nothing registers at module load. The kernel (the core systems, frustum culling, meshes, groups, raycasting) installs itself right before the first ECS world, and each feature registers its systems, hooks, scene work and debug tools in its install; cameras, lights and input still register in `InitEngine`. `[]` installs the kernel alone. The system order is the same in every scene but for one system: `instancedMeshPoolSync` is in every world from boot (it registered when a scene's code first imported the pools), and `physicsTierPolicyFrameSystem` now has the same place in a build as on the dev server.
- Scene loads run the features' scene hooks (`loadStart`, `exit`, `worldCleared`, `beforeAssets`, `created`, `entered`, `loadSettled`; `exit` in reverse install order). So the sky box's clear, the lines' dispose, the PostFX chain's dispose and the scene's viewports' delete run in `exit`, before characters and physics, and PostFX and viewports before the exited scene's own exit hooks. The PostFX chain is built in `created`, before the scene's JSON objects and enter hooks, so a scene's enter hook sees its chain. The scenes register after the features install. Every hash and snapshot is unchanged.
- Rapier loads with `import()` (`ENGINES.ts`' `loadEngineAPI`): in the physics worker, or on the page in `MAIN_THREAD` mode. The physics and assets workers are imported when they start and are ES module workers, so a build splits them: the worker and the page share one Rapier chunk, and the assets worker loads each job's module (texture, GLTF, simplify) on its first job, LOD's chain reader only while `lod()` is installed. An app without `physics()` loads no Rapier.
- Debug code folds out of a production build: `__AEK_DEBUG__` (a build define, true only when `VITE_APP_ENV` is `development` or `test`) guards `initEnvironment`'s debug flags and both debug loaders, so the `debug/*.ts` wrappers, every `_dbg__` module, Tweakpane, the default debug key bindings, the toaster and the 3D symbols are left out. An app's own Vite config defines it (the migration guide). `InitEngine`'s body runs outside a `try` block (a promise `.catch`, the same error), since Rollup keeps whatever a `try` block calls.
- three's loaders load where used: `GLTFLoader` with the first `loadGLTF`, `DRACOLoader` with the first Draco-compressed file, `HDRLoader` with the first `.hdr` (the synchronous `loadTexture` still returns its `DataTexture` at once and fills it when the file is in).
- TSL material and PostFX files load with their scene: the generated data holds a loader per file, a scene load loads its TSL materials' files with its other assets, and `postFx()` loads its passes' files before building the chain. A TSL material created outside a scene load needs `loadTslMaterialFileAsync` first; `createMaterial` throws naming it. A JSON `nodes` socket its file doesn't export warns at runtime instead of failing `tsc`.
- Icons are a registry: the built-in SVGs are registered only in the debug env and prod test mode, so a production build holds none. An app's own `icon` (a draggable window's, a debug tab's, a view's) needs `registerIcon` in a production build, or shows `??`.
- The scene and mesh schemas are composed from the kernel's fields and each feature's part. The sky box, LOD and impostor schemas moved next to their features (`SkyBox/SkyBoxSchema.ts`, `Lod/LodSchema.ts`, `Lod/Impostors/ImpostorSchema.ts`), still on `aekasha/schemas`. `SceneAsset` / `MeshAsset` are the kernel's fields. The JSON Schemas in `.schemas/` are byte for byte the same.
- Without its feature the API says so: `createLines` and `createViewport` throw naming it; `lod: 'AUTO'`, an import's physics nodes or `lodChain`, and a pool's `spatialDomain` warn once. The debug tools that draw lines or viewports are off without them, with one log line each.
- `registerLodTarget`, `registerSpatialRadiusProvider` and `getConservativeGeometryRadius` moved into the kernel (`core/ECS/LodTargets.ts`, `core/ECS/SpatialMembership.ts`, `core/Geometry.ts`), on the same entries, so the instanced pools need neither `lod()` nor `spatial()`.
- The environment is read when `InitEngine` runs (`initEnvironment({ search?, env? })`, `core/Config.ts`), not when a module loads. `IS_DEBUG_ENV`, `IS_PROD_TEST_MODE`, `IS_PROD_TEST_ENV`, `IS_PROD_ENV` and `CUR_ENV` are live bindings that read as a production build until then. No engine module reads `window` or `import.meta.env` at load. `env` is a copy, so `loadConfig` no longer writes into `import.meta.env`. The `beforeunload` / `blur` listeners `MainLoop.ts` added at load are added by `InitEngine` (`addWindowListeners`).
- `ECSSystemStage` and `APP_RENDER_SYNC_ORDER` moved into the engine (`core/ECS/SystemStages.ts`), with the same names and values. `src/AppECSRegistry.ts` doesn't re-export them.
- Component types use declaration merging. `ComponentDataMap` is an interface that the app and the toolkit extend from their own files (`declare module 'aekasha' { interface ComponentDataMap { … } }`), and `ComponentType` / `ComponentData` are its keys and itself, so `addComponent`, `getComponent` and `getStorage` are typed for every key without `as any`. The `ComponentType` value holds only the engine's keys (it used to spread in the app's and the toolkit's), and the engine no longer has `AppComponentType` / `AppComponentData`.
- The gathered data left the engine: `src/_engine/generatedAppData.json` and `generatedAppFns.ts` are now in `src/generated/`, which the engine never imports. It keeps `InitEngine`'s `data` in `core/AppData.ts` (types `AppData` and `GeneratedAppJson`), and `getGeneratedAppData` / `getGeneratedSceneData` read it from there.
- The ECS stress test no longer borrows the app's and the toolkit's components: it has two core debug keys (`DEBUG_STRESS_TEST_INSTANCE`, `DEBUG_STRESS_TEST_HOVER`) and its own hover system, registered on its first spawn.
- The entity inspector and the profiler list component types by value (`CORE_TRANSFORM`, `APP_SPIN`) instead of by key name. They read `ECSWorld.getComponentTypes()`, the types the world has a storage for. App and toolkit storages are now created on first use.
- `utils/PromiseResolver.ts` imports nothing: `resolveRequest(requestId, value)` returns whether the request was pending, and the physics API logs a missing one in the debug env.
- `Texture.ts`, `ECSCoreComponents.ts` and `MeshColliderGeometry.ts` import three's loaders directly, not through the `Addons.js` barrel (its `TTFLoader` can't load in Node).
- The production build's main chunk (`assets/index.js`, `devTools/verify/baselines/bundle.json`): **1251.3 → 377.2 kB gzip** (3778 → 1396 kB minified), 222 → 151 modules. Rapier (809.8 kB gzip) left it, and so did the debug wrappers (7.5 kB) and 52 of `core/UI`'s 55 modules (29.2 → 7.8 kB, the icons); `three` 674.2 → 616.9 kB (the loaders, `OrbitControls`, the PostFX passes' nodes), `core/Physics` 19.7 → 6.8 kB, `core/Input` 6.3 → 3.4 kB, `toolkit` 12.9 → 8.5 kB. `dist/` holds one Rapier chunk (810 kB) instead of two copies (`physicsWorker.js` 828.2 → 9.2 kB), no `_dbg__` chunk (57 before) and no `tweakpane.js`: its JavaScript is 2703 → 1629 kB gzip. The gathered JSON moved from the main chunk's `_engine` group to `app`, and the camera rig and moving platform from `_engine/utils` to `toolkit`.

**Added**

- The public entries, the only way into the engine from outside it: `aekasha` (`src/_engine/index.ts`), `aekasha/character`, `/instancing`, `/lines`, `/lod`, `/physics`, `/postfx`, `/skybox`, `/spatial`, `/viewports` (`src/_engine/features/<name>/index.ts`), `aekasha/ui`, `aekasha/debug` and `aekasha/schemas`. Each entry is a list of named re-exports from the engine's current paths, so later folder moves don't touch the code that uses it. Every module but the stylesheets is side-effect free (`package.json`'s `sideEffects`), so a chunk takes only the modules it uses.
- The nine engine features, a factory each on its entry: `physics()`, `character()` (requires `physics()`), `skyBox()`, `lod()`, `spatial()` (with light culling), `instancing()`, `lines()`, `postFx()`, `viewports()`. `InitEngine` checks the list before anything installs (a missing list, an id listed twice, a `requires` id not listed earlier) and installs them in list order, each awaited.
- The install contract, on `aekasha`: `EngineFeature` (`{ id, requires?, install(ctx) }`) and `FeatureContext`, a feature's only way into the kernel: the ECS registrations, `addSceneHooks` (`SceneHooks`: the load phases above, plus `sceneRegistered`, `sceneDeleted` and `retainedTextures`), `setFixedStepDriver` (`FixedStepDriver`, `LoopState`), `setRenderPipeline` (`RenderPipelineProvider`), `addAfterRender` (`AfterRenderHook`), `registerImportExtension`, and `onDebug` / `onDebugAfterStart` (`FeatureDebugHook`, kept only in a debug build).
- The feature manifest: each gathered scene lists the features its data needs (`__features`), and `InitEngine` fails the boot on a scene that needs a feature the app doesn't list, naming each scene, feature, factory and entry.
- The icon registry on `aekasha/ui`: `registerIcon(name, svg)` (also restyles a built-in), `registerBuiltInIcons()`, `BuiltInIconName`, and the 49 built-in SVGs as `<name>Icon`. `getSvgIcon` warns once for a name nobody registered.
- `loadTslMaterialFileAsync(materialId)` on `aekasha`.
- On `aekasha/schemas`: `FeatureSchemaPart`, `createSceneAssetSchema(parts)` and `createMeshAssetSchema(parts)`, and the parts `skyBoxSchemaPart`, `lodSchemaPart`, `postFxSchemaPart` and `spatialSchemaPart`.
- `ECSWorld.getComponentTypes()`, `initEnvironment` and its `EnvironmentInput`, `addWindowListeners`, `InitEngineOptions`, `AppData`, `GeneratedAppJson`. `@example`s on `InitEngine` and `ComponentDataMap`.
- The test bridge's `getSystemOrder()` (every world's systems per stage; bridge version 3).

**Removed**

- `utils/cameras/followObjectCameraRig.ts` and `utils/world/movingPlatform.ts` moved to the toolkit (`aekasha/toolkit/ecs`). `utils/commontTypes.ts` is removed: its one type, `XYZObject`, is written out in the camera rig's `offset` option.
- The gym's test code moved to the app (`src/app/scenes/thirdPersonGymScene/`): `utils/PhysicsStressTest.ts`, `utils/world/characterTestObjects.ts`, `characterTestObstacles.ts` and `3dModels/characterObstacles.blend`.
- `SceneAssetSchema` and `MeshAssetSchema` (`aekasha/schemas`): use `createSceneAssetSchema` / `createMeshAssetSchema` with the parts of the features you install.

**Fixed**

- Debug env: the light and camera helpers' sync systems (`LATE_MAIN`, order 0) registered when their debug chunks happened to land, and swapped in about 1 of 6 loads. The light and camera managers and the debug camera now await their debug modules, so the order is fixed.

### Toolkit 2.0.0 (Half Moon)

**Changed**

- `HoverEffect`, `FollowTool` and `SunShadowFit` add their keys to the engine's `ComponentDataMap` themselves, and read their storages typed (no `as any`). Their data types are exported as `HoverToolData`, `FollowToolData` and `SunShadowFitData`. The four effects (`MutualGravity` too) import the system stages from the engine.
- The toolkit imports the engine only through `aekasha` entries, and other toolkit categories only through their entries.
- `createMovingPlatform`'s `deleteMeshOptions` is typed and documented as unread (`controls.delete()` deletes the entity only); the behaviour is the same.
- The TSL materials are their own chunks in a build, loaded with the scenes that use them (the main chunk's `toolkit` group is 12.9 → 8.5 kB gzip). `registerFollowObjectCameraRigSystem`'s JSDoc says why its explicit order still matters now that the app's plugins install after `physics()`.

**Added**

- Entries: `aekasha/toolkit/ecs`, `aekasha/toolkit/geometry`, `aekasha/toolkit/materials`.
- From the engine, with JSDoc: the follow camera rig (`ecs/FollowObjectCameraRig.ts`: `createFollowObjectCameraRig`, `deleteFollowObjectCameraRig`, `registerFollowObjectCameraRigSystem`) and the moving platform (`ecs/MovingPlatform.ts`: `createMovingPlatform`, `registerMovingPlatformSystem`).

**Removed**

- `HoverComponentData`, `FollowComponentData` and `SunShadowFitComponentData`: the toolkit adds its keys itself.
- `ecs/InstancedMeshPool.ts` and `ecs/InstancedMeshPoolTypes.ts`, deprecated re-exports of the engine's pools until this major: use `aekasha/instancing`.

### App 1.10.0 (Preschooler)

**Changed**

- `src/index.ts` passes `config`, `data`, `features` and `start` to `InitEngine`: all nine engine features, then the app's.
- `AppECSPlugins.ts` exports the app's feature, `appECSPlugins` (`id: 'app'`), which registers the app's and the toolkit's systems in its install instead of at import (the Hub region `ecs-register-plugin` moved with it). `createExampleHud` registers its exit hook with its first panel, and `scene01`'s `d` key binding is created in its scene function: no app module runs code at load.
- The app imports the engine and the toolkit only through their entries (57 modules rewritten by the codemod).
- Code uses each module's key object (`HoverToolComponentType.HOVER`, `SpinComponentType.SPIN`, …) instead of `ComponentType`. `AppECSRegistry.ts` keeps only `HEALTH`, added to the component map, with no imports. `SpinComponent.ts` adds its key itself (the region `spin-component-map`, which the ECS walkthrough shows).
- The gym's test code from the engine is under `src/app/scenes/thirdPersonGymScene/`.
- Every scene's snapshots and determinism hashes are the same as on `main`'s commit (the scene runner, 96 of 96 in every phase), in all three physics targets, and so is the system order but for `instancedMeshPoolSync` (Engine, above).

### Project

**Added**

- The entries' import aliases from one list, `devTools/aliases.ts`: `tsconfig.json`'s `paths` (a copy that `aliases.test.ts` checks) and `resolve.alias` in `vite.config.ts` and `vitest.config.ts`. Each alias is exact, so an entry that isn't in the list doesn't resolve.
- `package.json`'s `"sideEffects": ["**/*.scss", "**/*.css", "./devTools/**"]`: every other module is side-effect free, so a build keeps only what's used of a module and drops one none of whose names are used. It replaced the build's `treeshake.moduleSideEffects` for the entries (the same chunks without it), and is what an app's own bundler reads too. `devTools/**` is listed because esbuild reads the field when Vite bundles `vite.config.ts`, and the Hub's Markdown directives register at load.
- The `__AEK_DEBUG__` define (`vite.config.ts`: true when `VITE_APP_ENV` is `development` or `test`; `vitest.config.ts`: true; declared in `src/_engine/types/typings.d.ts`).
- The boundary lint, all errors (`eslint-plugin-import` loaded, `LAYER_ZONES` in `eslint.config.js`): the engine imports no toolkit, app, `src/generated/` or `src/*.ts` file, and the toolkit no app, `src/generated/` or `src/*.ts` file. Nothing outside the engine uses an `_engine/` path, a toolkit category imports no other category's files, and the app imports no toolkit file. The engine imports no `aekasha*` entry, and nothing outside the debug modules imports a `_dbg__` module statically. The paths are resolved, so `import type` and `import()` are checked too.
- The import codemod, `npx tsx devTools/refactor/migrateToEntries.ts [--check] <folder | file>...` (rules in `refactor/entryImports.ts`, tested): deep engine and toolkit imports become entry imports, one value import and one `import type` per entry, formatted with Prettier. On any error it lists them all and writes nothing. It ships with the major for apps made from the template.
- Tests: the physics worker bundles without three, `MainLoop`, `Config` or `PhysicsAPI` (`workers/physicsWorker.test.ts`, esbuild 0.25.12 as a direct dev dependency); every engine module loads in Node without a DOM (`moduleLoad.test.ts`); each entry file holds only named `export … from` (`aliases.test.ts`); every `@example` type-checks against the entries (`devTools/verify/examples.ts`, `examples.test.ts`); plus `Config.test.ts` and `PromiseResolver.test.ts`.
- No module-level side effects, as a test (`devTools/verify/moduleSideEffects.test.ts`): no statement runs at load outside the debug loader's modules, the worker entries and `src/index.ts`. Its allow-list started with 42 statements in 19 files and is empty. More tests: `Features.test.ts`, `SceneHooks.test.ts`, `RenderHooks.test.ts`, `ImportExtensions.test.ts`, `featureSchemas.test.ts`, `devTools/engineSchemas.test.ts`, `systemOrder.test.ts`, `debugInProduction.test.ts` (259 tests in all).
- `yarn verify:scenes` records every world's system order per stage in each baseline entry (`systemOrder`, through the test bridge; Chromium only) and fails on a difference, naming the first position that differs or the systems added and removed.
- `yarn verify:baselines` fails on debug code in the production build it measures (`devTools/verify/debugInProduction.ts`): a `_dbg__` file in `dist/assets/`, or a `_dbg__`, `core/Debug/` or `debug/*.ts` wrapper module with rendered code in any chunk. It builds with `VITE_APP_ENV=production` itself, and `--update` records nothing while there is a finding.
- `api.json` (`yarn verify:baselines`) gains each entry's export list, so the public surface is a baseline.
- Hub: the migration guide (Documentation → Migration, "Engine 4 → 5": `features`, the `__AEK_DEBUG__` define, the app's plugins as a feature and the `sideEffects` trap of a bare `import './AppECSPlugins'`, icons, TSL files loading with their scene, the scene and mesh schemas); the Documentation intro's "Importing the engine" (the 16 entries and the lint, the factories, the icons); the Quick start's "How the app starts" (`src/index.ts`, `InitEngine`'s options, the boot check). Each feature page's guide starts with "Installing it"; the ECS guide has a "Features" section; scenes and assets has the lazy TSL / PostFX loaders and "The feature manifest"; the debug suite guide has the icon registry. The ECS and toolkit walkthroughs and the coding standards' "Smallest build" follow the changes.

**Changed**

- `yarn gatherAppData` writes `src/generated/` (`generatedAppData.json`, `generatedAppFns.ts` and an `index.ts` exporting `appData`), with `aekasha` type imports. `checkVersions` counts `src/generated/` in no part. It composes the scene and mesh schemas from the engine's parts (`devTools/engineSchemas.ts`), writes each scene's `__features` (`[]` included), and a loader per TSL material and PostFX file (`() => import(…)`) instead of namespace imports. `generatedAppData.json` is otherwise byte for byte the same.
- The move map's import graph resolves the aliases, so code that imports through an entry still counts as a consumer. `moveRules.ts` maps the new files. The layout report's "Kernel → feature" has no runtime or dynamic import left (23 type-only), and the assets worker's `import()`s of its feature job modules are listed in their own section; the only feature → feature runtime imports are character → physics.
- TypeDoc and the Hub's API extraction leave the entry files out, so the API pages stay per module (until p619).
- CLAUDE.md (the three-folder split as lint rules, the ECS core, a new "Engine features" section, the data pipeline, the bootstrap flow, physics, the debug system, the build config, the commands and tests, the coding standards' "Smallest build") and `readme.md` (the examples' imports, `InitEngine`'s signature and `features`, the tree, "Public entries", "Feature modules" and "Smallest build" highlights, the icon registry, the migration guide).
- The plans that build on this stage (p608, p611, p612, p510) have a "From p607" section: what it did and left for them.
- The Hub's search index is 1.07 MB, over the build's 1 MiB warning; left for p619.

## 2026-10-10 — coding-standards-and-documentation-tooling

### Engine 4.15.1 (Afternoon)

**Changed**

- Every import used only as a type is an `import type` (`verbatimModuleSyntax`), so a type import can't load a module into the physics worker. The built bundle is the same byte for byte.
- Wall-clock reads in the physics and character code go through two `@internal` clocks: `readStatsClock` (`utils/StatsClock.ts`) for profiling (step timing, write-back latency, step-gate hold time, ray stats) and `readPhysicsWallClock` (`core/Physics/PhysicsWallClock.ts`) for the characters' game time, which p610 replaces. Same values as before.
- Types that public signatures already named are exported with a summary, so the API reference links them: `LoadSceneProps`, the toaster's `ToasterSettings`, `ToasterProps`, `ToastType` and `ToastDirection` (the module-private `Direction` until now), the input bindings' bases, the listener types (`ViewChangeListener`, `ViewFrameListener`, `SkyBoxChangeListener`, `GeometryDeleteListener`, `LSKeyListener`), `RemovalTypes` and 16 more.
- JSDoc: `@param` tags name their parameter, `@internal` is an empty tag with its reason in the summary, type parameters are `@template`, and unresolved `{@link}`s are backticks. `friction` and `restitution` document Rapier's defaults (0.5 and 0).

### Toolkit 1.4.1 (Crescent)

**Changed**

- `import type` for type-only imports, as in the engine.
- `ProjectionPattern` (`materials/triplanarProjection.ts`), the type `blendProjections` takes, is exported with a summary.

### App 1.9.1 (Preschooler)

**Fixed**

- `scene01V2`: the red wireframe sphere's spin follows the physics world's simulated time (`getPhysicsSimClock`, 2 rad/s as before), not the frames counted from the scene's first one. A load spends a varying number of frames with physics held, so the sphere was one frame off on some loads and failed the scene runner's snapshot.

**Changed**

- `import type` for type-only imports, and JSDoc fixes, as in the engine.

### Project

**Added**

- The coding standards (`hub/pages/documentation/coding-standards/`, on the Hub under Documentation): layering, the public API and `@internal`, naming, size, async and disposal, per-frame code, the smallest build, the simulation rules, type hygiene, tests and the JSDoc style, each naming the check that enforces it. CLAUDE.md has one line per rule.
- Lint rules, as errors on a clean tree: `consistent-type-imports` and `no-import-type-side-effects`, with `verbatimModuleSyntax` in `tsconfig.json`; the simulation rules (`SIMULATION_FILES` in `eslint.config.js`: no `Math.random`, `performance.now()`, `Date.now()` or `new Date` in the physics and character code, the known violations allow-listed with the plan that removes them); JSDoc's shape (`eslint-plugin-jsdoc` 63.3.3, pinned: the newest that runs on `.nvmrc`'s Node 22.13.0).
- The documentation ratchet: per folder, the undocumented exports and members may not grow. `docs.json` (format 2) lists them by name, and a failure names each new one with its file and line. `yarn verify:baselines --docs` checks only that, without the bundle build (about 1 s on a cached model), and the Stop hook runs it when the engine or the toolkit changed. `--update` refuses a grown count without `--allow-docs-drop`.
- `yarn verify:scenes --browser firefox`: the debug configurations in Playwright's Firefox (WebGL2), each probe hash compared with the Chromium baseline's; no snapshots, no baseline of its own. The first run: 72 of 72 hashes equal Chromium's, in all three physics targets.
- The Hub's API extraction runs TypeDoc's `notExported` validation (a public signature naming a type the API doesn't export; 56 found, 31 fixed, the rest listed in their review plans), and loads `typedoc-plugin-zod` 1.4.3, so a `z.infer` type shows its fields. A union's object variants get a table each. Stored search summaries are clipped at 120 characters, keeping the index under 1 MB.

**Changed**

- The hooks report lint: the Stop hook and the per-edit lint fix what they can and fail with the errors left, where before they only autofixed.
- CLAUDE.md is split: the subsystems contained in one folder (sky box, LOD, impostors, spatial index, instancing, the debug tooling, the editor views, the Hub, its generator, the asset pipeline, dev files, the verify commands, the plans) have a `CLAUDE.md` next to their code, and the root keeps a map of them. The root went from 123 kB to 44 kB. The Hub reads the nested files' `##` sections like the root's Architecture sections, and the move map scans them for moving paths.
- The move map is regenerated (`RemovalTypes` has its split target).

## 2026-10-09 — architecture-and-gameplay-contracts

### Project

**Added**

- The target architecture for the p600 refactoring (`docs/plans/_DONE_p602_architecture-and-target-structure.md`): a kernel and opt-in features installed explicitly through `InitEngine`, one `aekasha` alias root (`aekasha`, `aekasha/<feature>`, `aekasha/toolkit/*`), debug code next to its feature, a UI kit, a pure `utils/`, PascalCase module names, the generated data out of the engine, and the boundaries as lint rules. Stage B builds on these decisions; nothing in `src/` moves yet.
- The move map, `npx tsx devTools/refactor/moveMap.ts [--check]` (`devTools/refactor/`): the target layout as rules (`moveRules.ts`) applied to the tracked tree. It writes `moveMap.json` (every engine and toolkit file's target, and the app files that move, for p608's codemod), `layoutReport.md` (the import graph checked against the target layout: 101 imports the layout doesn't allow, no cycles between features) and `entryExports.json` (each documented export under its target entry point, with who imports it today). It fails on a file no rule maps; `--check` exits 1 when an output is stale. Its import graph comes from the TypeScript AST.
- The gameplay architecture contracts (`docs/plans/_DONE_p603_gameplay-architecture-contracts.md`): actors, controllers, intents, brains and actions above devices are firm (p610 builds them on the character code), and so is a seeded RNG service with named streams. Animation, game events, missions, the sequencer, weather and save games are recorded as directions. A stub plan each for what comes next: a kinematic character controller, animation and IK, vehicles, AI brains and navigation, game events, missions and save games, a sequencer with splines, and weather and mood (`p421`-`p427`). p420's NPC tiers are rewritten in these terms. Documents only: nothing in `src/` changes.
- The multiplayer viability study (`docs/plans/_DONE_p604_multiplayer-viability-study.md`): viable, with a staged path. The engine's physics worker, run in Node from a message stream recorded in the browser, reproduced 1,200 steps of `physicsTiers` bit for bit, and so did Chromium, Firefox and an Android phone, with Rapier's compat build and its deterministic one alike (which differ from each other; the engine stays on compat). Bandwidth for its 687 bodies: 45-62 kbit/s per client when only the changed bodies are sent, quantized, at 20 Hz. An authoritative server with interpolating clients is a go after the structural stage, client prediction after p500 and p610; lockstep and rollback stay possible later. Nine simulation rules the refactoring adopts now (step-index time, a seeded RNG, intents as the only input, stable ids, a plain-data transport, a headless core with `import type` across its boundary, serializable components, the simulation reading its own state at the step, one Rapier build), written into p600, p605, p606 and p610. Stubs for the network work: a headless simulation runtime, transport and replication, client prediction (`p510`-`p512`). Documents only: nothing in `src/` changes.

## 2026-10-09 — mega-refactoring-safety-net

### Engine 4.15.0 (Afternoon)

**Added**

- A test bridge for the scene runner (`debug/TestBridge.ts` → `core/Debug/_dbg__TestBridge.ts`): `?aekTest=true`, next to `?isDebug=true` or `?isProdTest=true`, installs `window.__AEK_TEST__` before the first scene load (never in a production build). `whenSceneReady()` resolves once the first scene has loaded and the physics hold is released (with the renderer's backend), `whenProbeDone({ freeze? })` with the determinism probe's report (optionally freezing in that frame), `freeze()` pauses the app and master loops and the day-night cycle, and `snapshot({ width, height })` returns a byte-exact PNG of what the canvas shows. It also runs a test clock: every frame advances 1/60 s, TSL's `time` included, so what a page shows depends on how many frames ran, not on how long they took. `TEST_BRIDGE_VERSION` is its protocol version.
- `setFixedFrameDelta(seconds | null)` / `getFixedFrameDelta()` (`core/MainLoop.ts`, debug and test): every loop frame, and physics stepping, uses that delta instead of the measured one.
- `setPhysicsInterpolationPinnedToNewest(world, isPinned)` (`core/PhysicsManager.ts`, debug and test): interpolated bodies are drawn at the newest physics snapshot, with no blend, so a still frame shows the exact step.
- `onPhysicsProbeReport` (`core/Debug/_dbg__PhysicsDeterminism.ts`): the determinism probe's report as data, not only as a log line.

**Fixed**

- ECS: an entity slot reused 4096 times gave entities that were never alive and couldn't be deleted (the stored generation outgrew the id's 12 bits). `deleteEntity` now wraps it at 12 bits; an id repeats after 4096 reuses of its slot (`docs/issues/ecs-generation-wrap-after-4096-reuses.md`).
- Scene loopers and resizers created by scene code without a scene id went nowhere on a first load (`scene01`'s sphere never turned) or to the previous scene after a switch: scene code runs before its scene is current. An omitted scene id now means the loading scene while its code runs (`setLoadingSceneId`, set by `loadScene`), and the running looper lists follow the current scene (`docs/issues/scene-loopers-registered-on-the-previous-scene.md`).

### Project

**Added**

- Unit tests: `yarn test` / `yarn test:watch` (Vitest 5.0.3, `vitest.config.ts`, Node environment). The first tests cover the ECS (entity ids and generations, storages, hooks), `deepMerge`, `CellKey`, `SkyTime`, the octahedral impostor maps, `ImpostorFormat` and the asset schemas (every gathered JSON in `src/` validates through the gatherer, and broken copies of repo assets fail at the expected field). The Stop hook runs them when `src/`, `devTools/` or `vitest.config.ts` changed. Tests are left out of the API docs.
- The scene runner, `yarn verify:scenes [--only <sceneId|glob>] [--config <name|set>] [--update] [--url <url>] [--webgl] [--headed]` (`devTools/verify/scenes.ts`, `scenes.config.ts`): every scene in four configurations (the physics worker with and without `SharedArrayBuffer` and the main thread in debug, plus prod test mode), failing on console or page errors that aren't allowed, a changed determinism hash, a snapshot over the tolerance (with a diff image), or a load that ran in another physics configuration. Its baselines are local, per backend (`.cache/verify/scenes/`); `--update` records the current run. On WSL2 it renders on WebGL2 (SwiftShader) unless `--headed`. New dev dependency `playwright-core` 1.63.0.
- `yarn verify:baselines [--update] [--no-build]` (`devTools/verify/baselines.ts`): bundle sizes per chunk and per main-chunk module group, the documented API's exports and the JSDoc coverage per folder, diffed against the committed `devTools/verify/baselines/*.json`. It fails on a chunk that grew over 1 % or 2 kB gzip, a new chunk, an added, removed or moved export, or a coverage drop.
- Both verify commands log to `.cache/verify/progress.log`, so `tail -f .cache/verify/progress.log` follows a run from any terminal.
- The Hub's `::: dev-only [title]` blocks: content only the dev server's Hub shows, left out of `yarn hub:build` before parsing (no text, TOC entry or search result). A directive gets the same with `devOnly: true`. The Quick start's "Check your changes" (the test and verify commands) and the debug suite page's "Test bridge" use it.
- CLAUDE.md: the test and verify commands, the verification every p600 refactoring plan runs, the watch command, and the test bridge. The run-aekasha-js skill points at the scene runner for checking every scene. The readme lists the new commands and `?aekTest=true`.

## 2026-10-08 — aekasha-hub

### Engine 4.14.0 (Afternoon)

**Added**

- `?startScene=<sceneId>`: next to `?isDebug=true` or `?isProdTest=true`, the page boots into that scene. It wins over the Debug tools' start scene and over the scene `src/index.ts` asks for, on the first load only. An id without its scene data and scene file warns (also as a debug toast) and loads the usual start scene. Production builds never read it. `getStartSceneQueryParam()` (`core/Config.ts`) returns it.
- Snapshots (`core/Snapshot.ts`): `takeSnapshotAsync({ width, height, scene?, camera?, postFx?, hideDebugHelpers?, transparent?, samples? })` renders a scene through a camera off screen and reads it back as RGBA8 (sRGB as the canvas shows it, top row first), for thumbnails, the Hub's scene images and save game pictures. By default it's what the canvas shows (the current view's scene and camera, through the scene's PostFX), without the viewports and with the debug helpers hidden. `snapshotToBlobAsync` encodes one as PNG, WebP or JPEG, and `readRenderTargetRGBA8Async` is its readback.
- `renderFrameNow()` (`core/MainLoop.ts`): draws the current view's frame outside the loop, after something cleared the canvas (a PostFX snapshot resizes the renderer).
- `addDebugToastWhenReady` (`debug/DebuggerGUI.ts`): a debug toast added before the debug toaster exists waits for it, for messages from the boot.

**Fixed**

- `WORKER_THREAD` physics: a `THREE.Quaternion` as a rigid body's or a collider's `rotation` reached the worker without its x / y / z / w (structured clone drops class fields), so the body spawned unrotated. It's sent as a plain object now.

**Changed**

- The texture preview's GPU readback uses `readRenderTargetRGBA8Async`.
- The engine's UI icons (`core/UI/icons/svg/`) all follow one form: a 16 × 16 viewBox, `currentColor`, the `bi bi-<name>` class and no transforms. `runtime-view`, `starttime-view` and `profiler-pulse` had their transforms baked into their paths (they look the same; the two view icons are now square, so they draw at full height), and five icons got their missing class. New `github.svg` and `three-js.svg` (not in the bundle: the Hub's brand marks).
- Bootstrap Icons' MIT licence, which most of those icons are from, is now with them (`core/UI/icons/LICENSE-bootstrap-icons.txt`), and the bundle carries its `@license` comment.

### Toolkit 1.4.0 (Crescent)

**Added**

- The toolkit's first model, the Ækasha symbol (`toolkit/models/aekashaSymbol/`, id `aekashaSymbol`): the Æ glyph of the favicon extruded with a small bevel, 1 unit high, centred and facing +z, Draco-compressed (its asset JSON keeps the pipeline's output Draco). `devTools/toolkit/buildAekashaSymbol.ts` builds the GLB from `src/public/favicon.svg`.

**Removed**

- The `checkerBoard` material (`toolkit/materials/checkerBoard.material.json` and `.tsl.ts`): a placeholder whose node functions never drew a checkerboard. Use `triplanarCheckerboard`, with its `plusSigns` static define off for plain squares (`matOverrides: { staticDefines: { plusSigns: false } }`).

### App 1.9.0 (Preschooler)

**Added**

- Example scenes for the Hub (`src/app/examples/<name>/`, named "Example: …"), each with its own camera, lights and asset ids, and `#region` markers around the code its Hub page shows:
  - `exampleQuickStart`: a hovering cube with the triplanar checkerboard material (a variant without its plus signs), a camera and two lights, the smallest complete scene.
  - `examplePhysics`: a static ground with a box, a sphere, a capsule and a cylinder dropping on it; Space drops more (the oldest go past 80).
  - `exampleToolkit`: the toolkit's Æ symbol, hovering, with the triplanar checkerboard material.
  - `exampleSkyBox`: a `DAY_NIGHT` sky box with a two-minute day; Space plays and pauses it, ← → move the time and ↑ ↓ change the speed.
  - `exampleEcs`: a `SPIN` component and its `APP_LOGIC` system (`examples/ecs/SpinComponent.ts`, `SpinSystem.ts`), registered in `AppECSRegistry.ts` and `AppECSPlugins.ts`.
  - `exampleLod`: 180 torus knots in one instanced LOD pool, the knot's generated chain then a flat octahedral impostor (baked at load).
  - `exampleDebugTab`: a scene-scoped debug tab with persisted settings the scene builds from, and a button.
  - `exampleHubHero`: the Hub homepage's render, a `SPACE` sky box, a large toolkit asteroid in an emissive ring, smaller ones turning beside it, and a bloom PostFX. It has no Hub page.
- `createExampleHud` (`examples/exampleHud.ts`), the examples' HUD line.
- A scene-scoped "Hub" debug tab (`examples/_dbg__exampleHub.ts`) for every scene under `src/app/examples/` and for `lodShowcase`, with **Save Hub image**: a snapshot of what the canvas shows (1600 × 1000, the hero 1560 × 960) written next to the scene as `<sceneId>.hub.png` through the dev files (downloaded, with the path to put it at, without them). The Hub images of every example are saved.

**Changed**

- The `testECS` scene no longer lists the removed `checkerBoard` material.
- `src/app/physicsTest.ts` marks its dynamic box code as the region `dynamic-box` (a comment only), which the Hub's "Code blocks" page includes. Renaming the region breaks that page.

### Project

**Added**

- The Ækasha Hub: the engine's instructions, examples and documentation as a static site, with its sources in `hub/` and its generator in `devTools/hub/`. This first version is the site itself, its code blocks, its search, the API documentation, the examples, the feature pages and the homepage's content.
  - Pages: a folder under `hub/pages/` per URL, with an `index.html` (the title and the `aek:` menu metadata in its `<head>`, the page's markup in its `<body>`) and a Markdown file for each of its slots. The nav is built from the pages' metadata, at build time.
  - Markdown (markdown-it): heading anchors and an "On this page" table of contents, `hub:` links between pages that are checked at build time (a dead link or `#hash` fails the build with its file and line), `::: tip|note|warning|danger` callouts and a directive registry for later ones, and images converted to WebP.
  - The design shell: a top nav with dropdowns, breadcrumbs, a footer, a dark and a light theme (saved, else the system's), a mobile menu, keyboard navigation, self-hosted Inter and Lucide icons, the Hub's own favicons (the Æ in its accent blue, in `hub/_assets/favicons/`; the app's stay as they were), and a homepage with a hero and the slots for its later content.
  - Generated sections: Issues (a page per `docs/issues/*.md`, listed by status) and Version (the engine, toolkit, app and project versions and the build, then the whole `CHANGELOG.md` with an anchor per entry).
  - Code blocks, highlighted by shiki when the Hub is built (no highlighter in the pages), in a dark and a light theme of the Hub's own: line numbers, line highlights (`{3,5-7}`), diff, focus, error and warning lines (shiki's `// [!code …]` comments, removed from the page), a title and language badge, a copy button that copies the clean source, `wrap`, `collapse` (by itself above 30 lines), `::: code-group` tabs, and highlighted inline code (`` `fn()`{ts} ``). The Documentation section's "Code blocks" page is the reference.
  - Snippet includes: `<<< path/from/repo/root.ts#region` shows a file's region (or the whole file, or `#L10-L24`) as a code block, so a page shows the real code. Regions are marked with `#region name` / `#endregion name` comments in the source. A missing file or region fails the build with the page and line, and in dev an edit to an included file reloads the pages that show it.
  - Search (⌘K, Ctrl+K or `/`): a dialog over a minisearch index of every page's sections, built with the Hub, with prefix and typo-tolerant matching, results grouped by section with their breadcrumbs and the matches marked, and the closest page titles when nothing matches. The search code and the index load on first use. `yarn hub:build` prints the index's size, and warns over 1 MB.
  - Documentation: the engine's and the toolkit's API reference, generated from their JSDoc by TypeDoc and rendered in the Hub's own style (`devTools/hub/api/`). A page per folder and per module, each export with its kind, its highlighted signature (its types linked to theirs), its comment, parameter and property tables (object types as nested rows), badges (optional, readonly, deprecated, internal, …), defaults, examples and a link to its source line (GitHub at the build's commit; in dev, the file in your editor). Undocumented exports are listed as "No description", and the landing page shows each folder's coverage, a summary per module and an A-Z index of every export. The `_dbg__*` debug implementations and the generated app data aren't part of it.
  - `api:` links on any Hub page (`[loadScene](api:loadScene)`, `api:ECSWorld.addSystem`, `api:PhysicsAPI.createRigidBody` for a name two modules export), checked at build time: an unknown name fails the build and suggests close ones, an ambiguous one lists the candidates. A JSDoc `{@link X}` lands on the same anchor; one that doesn't resolve is shown as text, with a warning at its line.
  - Search finds every module, export and class or interface member by name, with its kind and module.
  - The TypeDoc model is cached in `.cache/hub/typedoc.json` and reused while the engine's and the toolkit's sources are unchanged. In `yarn dev`, an engine or toolkit save rebuilds nothing: the next API page opened shows "Rebuilding the API documentation…" while TypeDoc runs in a child process, then reloads into the new page. Other Hub pages don't wait for it.
  - Examples: a page per example scene (Quick start with the dev environment set-up, Physics, Toolkit, Sky box & day-night, Custom component & system, LOD & instancing, Your own debug tab), each showing the scene's own code through its regions, and the Examples page listing them as cards.
  - `::: scene <sceneId>` panels: the scene's Hub image, the directive's text, and in `yarn dev` "Open in debug" / "Open in prod test" buttons (`?startScene`); the public Hub shows a note on running it locally instead. An unknown scene id fails the build, a missing image warns.
  - `::: cards <page path>`: a card per child page (its image, else its icon, its label and description). A page's image is `aek:image` in its head, a scene's Hub image (`scene:<sceneId>`) or an image file. Scene images are converted to WebP at the sizes the layout uses, and in `yarn dev` saving one rebuilds the Hub by itself.
  - The homepage hero is the engine's render (`exampleHubHero`'s Hub image), through `<img data-aek-scene="<sceneId>">`.
  - Features: a page per feature (Rendering, ECS, Physics, Scenes and assets, Asset optimization, Sky box and day-night, LOD and impostors, Spatial index, Viewports and views, Debug suite, Characters, Toolkit), each with a summary, how it works with the real code, its key APIs as `api:` links, the issues that affect it, its example scene, and "Read more" links to the technique docs. The Features page lists them in four groups (Core, World, Performance, Tools).
  - `::: cards` filters: `featured` (pages with `aek:featured`) and `group=<name>` (pages with that `aek:group`).
  - `repo:` links (`[budgets](repo:docs/techniques/asset-optimization.md#budgets)`): a file in the repo, checked with its `#heading` or `#L<line>`, linking GitHub at the build's commit (in `yarn dev`, the file in your editor).
  - `aek:covers` names the CLAUDE.md Architecture sections a feature page covers, and `::: claude-md` links them in `yarn dev` only. `yarn hub:build` checks the coverage: a name CLAUDE.md doesn't have fails the build, and an Architecture section without a feature page is a warning, unless `hub.config.ts`'s `coverageIgnore` lists it as not a feature.
  - The homepage's content: the engine's description from `package.json` beside the hero, the four featured features as icon columns and three featured examples (Quick start, Physics, Toolkit) as image cards, "What's new" from `CHANGELOG.md`'s latest entry (its date, branch and each part's version and codename, linked to the entry on the Version page), and quick links to the Documentation, Examples, Issues and GitHub. The quick start is its own page under Examples.
  - The changelog on the Version page is left out of the search index, which was over 1 MB with it.
- `yarn dev` serves the Hub at `/hub/` (`devTools/hubPlugin.ts`, dev server only; `AEK_HUB=false` turns it off). It builds on the first request, rebuilds on every save under `hub/` and in its other sources, and refreshes only the open Hub tabs whose page changed (a stylesheet change without a reload). It never reloads the app's tabs. A page with an error is served as an error page with the file and line, and comes back by itself when it's fixed.
- `yarn hub:build [--out <dir>] [--no-api]` builds the public site into `dist-hub/`: relative links (it works at a domain root and under `/hub/`), a `404.html`, a Netlify `_headers` file, and `?v=<content hash>` on every asset. An error fails it. `--no-api` skips the API documentation (no TypeDoc run, `api:` links and `hub:` links to API pages unchecked) for fast content work. `yarn hub:preview [--base /hub/]` serves the build as a static host would.
- The Hub's GitHub and Three.js marks: a GitHub link in the header's tools, the icons on the footer's GitHub and Three.js links (with Rapier, now links too), and the GitHub mark on the API pages' source links in the public build. The GitHub mark is Bootstrap Icons': the Hub ships its licence (`_assets/icons/LICENSE-bootstrap-icons.txt`) next to Lucide's.
- `docs/techniques/hub-authoring.md`: how to write Hub pages, their code blocks, snippet includes and region markers, `api:` links, scene panels, cards and Hub images, and what search indexes.
- `devTools/toolkit/buildAekashaSymbol.ts` (`npx tsx`): builds the toolkit's Æ symbol GLB from the favicon's glyph. New dev dependency `linkedom` 0.18.13 (its `DOMParser` for three's `SVGLoader` in Node).
- CLAUDE.md: the Hub's section (the feature pages, `aek:covers` and the coverage check among it), the issue-file convention (`**Title:**` on line 1, then `Key: value` lines with `Status:` first), the rule that a change to an engine or toolkit feature or public API updates its Hub content in the same branch, that a `#region` marker in engine, toolkit or app code is a Hub include (renaming it breaks a page), `?startScene`, snapshots, the example scenes and their Hub tab, and the toolkit's model.

**Changed**

- `yarn build` and `yarn build:test` also type-check `hub/` (`tsc -p hub`) and build the Hub into `dist-hub/` at the end. `AEK_HUB=false` skips the Hub build, and `AEK_HUB_IN_DIST=true` also copies it into `dist/hub/` (off by default).
- The project metadata (versions, codenames, packages, build commit and time) is built by `devTools/projectMetadata.ts`, shared by `vite.config.ts` and the Hub. `__PROJECT_METADATA__` and `index.html`'s placeholders are unchanged.
- The Stop hook runs on changes in `hub/`, `devTools/` and `vite.config.ts` too, and type-checks `hub/`. ESLint ignores `dist-hub/`.
- The repository was renamed `JarSeal/aekasha-js`: `package.json`'s `repository` fields, the readme's and the Hub's clone commands and its GitHub links point to it.
- `tsconfig.json`'s `typedocOptions` document `src/_engine/**/*.ts` and `src/toolkit/**/*.ts` without the `_dbg__*` debug implementations and `generatedApp*`, so `yarn docs` lists what the Hub's Documentation does (the bare `**` globs also matched SVGs, SCSS and JSON, a TypeDoc warning each). `yarn docs` itself is unchanged and stays as a fallback.
- New dev dependencies: `markdown-it` 14.3.1, `@types/markdown-it` 14.1.2, `shiki` 4.5.0, `@shikijs/transformers` 4.5.0 and `minisearch` 7.2.0.

## 2026-10-08 — finalize-impostor-billboard-lod

### Engine 4.13.0 (Afternoon)

**Added**

- Exported impostors: an impostor can be baked once in the debug build, written into the repo, and loaded by a scene instead of baked at load. Both kinds export (octahedral and cross-quads).
  - The `*.impostor.json` asset type (`schemas/impostorSchema.ts`, `kind: "OCTAHEDRAL" | "CROSS_QUADS"`): the atlas id, the layout the bake used, `alphaTest`, the resolved shading, `surfaceDepth` (octahedral) or `normals` (cross-quads), a format version and a fingerprint of the source. Written by the export, not by hand.
  - A scene JSON's `impostors: [id]` loads the listed impostors' atlas slots with the scene's textures. `generateOctahedralImpostor` / `generateCrossQuads` called with a listed `id` then build from the export: no bake, and the export's layout, shading and flags win over the call's options. An impostor that isn't listed, or whose export is of another format version or didn't load, bakes as before (with a warning when it's listed).
  - Stale exports: in the debug env, using an export hashes the call's geometry, material and resolved options (`getImpostorSourceHash`) and warns when they no longer match the export's fingerprint. The export is used anyway; re-exporting it is the fix. Production skips the hash.
  - The bake and the build are split: `bakeOctahedralImpostorAtlases` / `bakeCrossQuadsAtlases` bake into unregistered targets, and `buildOctahedralImpostor` / `buildCrossQuads` build the quad (or planes) and the material from a layout and two atlases, with `vOrigin: 'TOP' | 'BOTTOM'` (a bake's render target against a loaded KTX2's v-up atlas).
  - `IMPOSTOR_EXPORT_FORMAT_VERSION`, the kinds and their atlas slots (`getImpostorDefSlots`) in `core/Lod/Impostors/ImpostorFormat.ts`; the impostor registry (`getImpostorRecord`, `getImpostorRecords`: every impostor generated this session, baked or loaded, with its bake time).
  - `AppConfig.lod.impostorExportDir` (default `src/app/impostors`): where a new export is written. A re-export writes where the impostor's files already are.
- Texture atlases: `slots.<name>.image`, a ready-made image of the whole layout (the slot isn't composed from its cells; every cell needs a `rect`), and `mipChain: "FULL"`, every mip level down to 1 × 1 instead of stopping where cells would mix. `TextureAtlasSlotInfo` gets `mipChain` and `fromImage`.
- Alpha-coverage-preserving mips: `optimize.alphaCoverage` on a `*.texture.json` or an atlas slot (the material's `alphaTest`, 0-1) scales each mip level's alpha so the share of it passing that cut stays level 0's, so thin alpha-cut features (an impostor's trunks and edges, leaf cards) don't break up with distance. Refused on a `normal` or `data` slot (their alpha isn't coverage). `AlphaCoverageSchema` and `NON_COVERAGE_SLOTS` in `schemas/assetsConfigSchema.ts`.
- Debug: the LOD tab's Impostors folder lists the impostors generated in the scene (kind, baked or loaded from its export, export state: not exported, up to date, stale or another format; atlas size, bake time) with Export / Re-export and Export all. An export bakes again from the impostor's source, reads the atlases back and writes the `*.impostor.json`, the `*.textureAtlas.json` and the PNGs in one dev files batch, and the gather's result is shown as a toast after the reload. The albedo slot gets `alphaCoverage` at the impostor's `alphaTest`. Without the dev files (a LAN device, `AEK_DEV_FILES=false`, no dev server) it downloads the files and lists the paths to put them at.
- The Assets tab's atlas slot info shows the mip chain and whether the slot is a ready-made image.

### App 1.8.0 (Preschooler)

**Added**

- The `lodShowcase` scene: the LOD system lane by lane, each lane running away from the start camera with an object in every level band (placed from the levels' screen sizes, `lodShowcase/layout.ts`), so every level of every lane is on screen at once, under the `dayNight` sky box held at 15:00. Left to right: an instanced tree pool ending in exported cross-quads and a cull fade; hand-made levels in a `*.mesh.json` (sphere geometries in `*.geometry.json`, the mesh's `lod` and `fadeSeconds`); a 16k-triangle torus knot with an `AUTO` lod, its chain simplified at load; the same knot as an instanced pool, its chain's levels then an exported flat octahedral impostor (cheaper than the chain's 982-triangle last level); largeWorld's rock as a baked and an exported impostor beside the mesh; and static instance cells (one `InstancedMesh` entity per cell) that swap and fade as a whole. A later LOD plan adds a lane with a module and a list entry.
- The scene's "LOD demo" debug tab: camera stops (the start view, overhead, and both sides of every lane's level switches and cull), a dolly down the lanes and back, the time of day, each lane's entities per level and triangles, and buttons to the LOD tab and the profiler. Only the camera stop is saved.
- Exported impostors for the scene: `lodShowcaseTreeCross` and `lodShowcaseKnotImpostor` (`src/app/impostors/`).

**Changed**

- largeWorld loads its rock and tree impostors from their exports (`src/app/impostors/`, listed in `largeWorld.scene.json`'s `impostors`): no bake at load (the scene loads in about 1,385 ms against 1,450 ms), and the atlases take about a quarter of the GPU memory (UASTC KTX2: 1.0 MB against 4.0 MB per rock atlas).
- largeWorld's impostor exports are re-exported with `alphaCoverage` on their albedo atlases: the trees' cross-quads no longer thin out at their switch distance (their area against the mesh they replace went from 0.86 to 0.94 on average; the runtime bake's is 0.99), and the rocks look as before.
- The `textureAtlases` scene gets a third test atlas, `p299TestAtlasImage`: a ready-made two-slot image with a full mip chain, each slot and cell drawn at every level. Its albedo slot uses `alphaCoverage`.
- `p341AlphaCutTest`, a test texture for `alphaCoverage` on a plain texture (thin twigs, a fence and grass blades; in no scene).

### Project

**Added**

- The asset pipeline builds atlas `image` slots (the image's size checked, no composition) and `mipChain: "FULL"` chains (exact 2 × 2 box, then area-filtered past an odd size). The cache key changes only for atlases that set them. A run labels such a slot "N cells in an image, full chain".
- The asset pipeline builds `alphaCoverage` textures and atlas slots (`devTools/assetPipeline/alphaCoverage.ts`): level 0's coverage measured at the cut with 4 × 4 bilinear sub-samples per texel on the 8-bit alpha, then each later level's alpha scale found by bisection, per cell on the levels the padding keeps apart and over the whole image past them. Each level is halved from the unscaled one. A plain texture with it builds its own box-filtered chain (`ktx create --levels`) instead of `--generate-mipmap`, measured on the source before `maxSize`. The cache key changes only for assets that set it (with `ALPHA_COVERAGE_VERSION`), and a run labels them "alpha coverage 0.5".
- The gatherer validates `*.impostor.json` files (their atlas must exist, have the slots the kind reads and be the layout's size) and expands a scene's `impostors` into the definitions on its generated data and the slots into its `textures`. An impostor of another format version is left out with a warning.

## 2026-10-07 — dev-server-implementation

### Engine 4.12.0 (Afternoon)

**Added**

- Dev files (`debug/DevFiles.ts`, implementation `core/Debug/_dbg__DevFiles.ts`): debug tooling writes files into the repo while `yarn dev` runs, through the dev server's file routes (see Project). Debug env with the dev server only; in a build, or with the routes off, it reports itself unavailable.
  - `getDevFilesStatus()`: whether this page can write and why not (`NOT_DEBUG_ENV`, `NO_DEV_SERVER`, `UNREACHABLE`, `NOT_ENABLED`, `NOT_LOCAL`, `NO_TOKEN`), with the server's settings. It never rejects.
  - `writeDevFiles(writes)`: a batch of `{ path, json }`, `{ path, blob }` and `{ path, saveData: { sceneId, entry } }` writes that all land or none does. Each has an optional `expectedHash` (the hash `readDevFile` returned; `null`: the file must not exist yet), and resolves per file with `created`, `updated` or `unchanged`. A refusal rejects with `DevFilesError` and its code (`CONFLICT` with the hashes on disk, `INVALID_SCHEMA` with the gatherer's issues, …).
  - A `saveData` write puts a save entry first in an asset JSON's `__saveData[sceneId]` (the older entries after it), stamped with the engine, toolkit and app versions and the date. It keeps `getDevFilesSaveHistorySize()` entries for that scene, and an entry equal to the latest one is `unchanged`.
  - `readDevFile(path)`: the bytes, the hash and, for a `.json`, the parsed value; `null` for a missing file.
  - `encodePNG(source, { flipY? })`: `ImageData`, an RGBA8 buffer or a canvas to a PNG `Blob`. Its own encoder keeps a fully transparent pixel's colour (a canvas loses it to premultiplied alpha), for atlases read back from render targets.
  - `onDevDataGathered(fn)`: how the gather after a write went (`done` / `failed`, the changed files, asset errors, whether the page reloads), before the reload. The reload waits up to 2 s for `fn`'s promise.
- `AppConfig.devFiles.saveHistorySize` (default 20): the save entries a save keeps per scene; -1 keeps every entry, 0 turns saving into `__saveData` off. Always 0 outside the debug env.
- The Debug tools tab's "File server" folder: whether this page can write files (on, LAN too, off, or unavailable and why), the save history size (overrides the config's in this browser, saved once changed) and what it means.

### App 1.7.0 (Preschooler)

**Added**

- `src/CONFIG.ts` sets `devFiles.saveHistorySize` (20).

### Project

**Added**

- The dev file server (`devTools/devFilesPlugin.ts`, `devTools/devFiles/`), part of `yarn dev` and never in a build. It serves routes under `/__aek/files/`: `status`, `read`, `stage` (a raw upload, kept 10 minutes) and `commit`.
  - Security: a token per server start in `index.html`, a `Host` and `Origin` check, and writes from the server's machine only. `AEK_DEV_FILES_LAN=true` allows the LAN (a phone under `yarn dev:https`); `AEK_DEV_FILES=false` turns the routes off.
  - Paths: only in `src/app/`, `src/toolkit/` and `src/public/` (not the pipeline's `aek-assets/`, `draco/` or `basis/`). No dot folders and no symlinks out; `.json` and image files only, 32 MB per file and 128 MB per batch.
  - JSON is validated against its gathered schema and written Prettier-formatted.
  - A commit writes through temporary files and renames, restores every file on a failure, and keeps the last 20 commits' backups in `.cache/dev-files/backup/`. A file whose bytes don't change isn't written.
  - Save entries are written on the server, which stamps the versions from `package.json` and trims the scene's list.
- `npx tsx devTools/devFiles/selfCheck.ts`: the dev file server's self-check. It starts its own dev server, or runs against one with `--url`, and covers every refusal, rollback (forced rename failures included) and save entry case, the last ones through a real gather.
- The scene gatherer's dev server plugin sends the custom HMR event `aek:gather` before each reload, and ignores a commit's temporary files. `gatherAppData.ts` exports `validateGatheredJson` and `hasGatheredSaveData`.

**Changed**

- `vite.config.ts`: `server.fs.strict: false` is now `server.fs.allow: [<repo root>]`. With the dev server on the LAN, any device could read any file the user can through `/@fs/`; now only the repo is served.

## 2026-10-07 — impostor-billboard-lod

### Engine 4.11.0 (Afternoon)

**Added**

- Cross-quad impostors (`core/Lod/Impostors/CrossQuads.ts`): `generateCrossQuads(geometry, material, opts?)` bakes an object into two or three intersecting alpha-cut planes through its vertical axis, a far LOD level for vegetation. It returns a registered `{ geometry, material, albedo, normal }`, which goes straight into `createInstancedLodPool`'s last level.
  - The bake renders the object (a per-group material array works) from each plane's direction with an orthographic camera fitted to its bounds, into one albedo atlas (sRGB) and one normal atlas, with mipmaps. Transparent texels take the nearest opaque colour, so filtering and mips leave no dark fringes.
  - Nothing is lit in the bake: the impostor material shades with the scene's lights, shadows and environment at runtime, with each texel's baked normal. It uses the shading model of the source material drawing the most triangles (Phong, Lambert, unlit, else standard). The planes are double-sided, cast alpha-cut shadows, and a plane seen from behind is lit correctly.
  - Options: `id` (default `${geometry id}#crossQuads`), `planes` (2 or 3, default 3), `frameSize` (default 128), `gutter`, `alphaTest`, `normals` and `shading`. Its assets are owned by the loading scene and released with it; a later call with the same `id` returns them while they're registered.
  - The bake helpers both kinds of impostor share (bake materials, frame and atlas targets, the dilating copy, the shading model pick) are in `core/Lod/Impostors/ImpostorBake.ts`.
- Octahedral impostors (`core/Lod/Impostors/OctahedralImpostor.ts`): `generateOctahedralImpostor(geometry, material, opts?)` bakes an object from a grid of directions on a sphere into two atlases, and draws it with one quad per instance that faces the camera from any angle, overhead included. A far LOD level for rocks, buildings and anything seen from above. It returns a registered `{ id, layout, geometry, material, albedo, normalDepth }`, which goes into `createInstancedLodPool`'s last level (or onto a plain mesh).
  - The atlases hold albedo and coverage, and the object-space normal with the depth in alpha; never light, so the impostor is lit by the scene's lights, shadows and day-night cycle at runtime. `hemi: true` bakes the upper hemisphere only, for objects never seen from below: twice the frames per direction.
  - The material blends the three frames nearest to the view direction with barycentric weights, each sampled where the pixel's view ray meets the object's surface (a depth parallax), so the frames line up and nothing pops as the camera orbits. A hemi impostor seen from well below the horizon draws its horizon frames flat.
  - Shadows: in the shadow pass the quad faces the light and casts the silhouette seen from it. The impostor writes its surface's depth in both passes and receives shadows on that surface, so it meets the ground and shadows itself like the mesh. `surfaceDepth: false` draws the flat quad and receives no shadows instead: about a quarter of the GPU cost where impostors cover many pixels, for objects standing on the ground.
  - Options: `id` (default `${geometry id}#octahedral`), `frames` (2-32, default 12), `hemi`, `frameSize` (default 64), `gutter`, `alphaTest`, `shading` and `surfaceDepth`. Owned by the loading scene, and a later call with the same `id` returns the registered assets, like cross-quads. It gets `enableLodDither` from the pool like any level material, so switching to and from it cross-fades.
  - The octahedral maps and frame bases, on the CPU and in TSL (`Octahedral.ts`), and the material's nodes (`createOctahedralImpostorNodes`, `createOctahedralImpostorQuad` in `OctahedralImpostorMaterial.ts`) are exported for custom materials.
- Dithered LOD cross-fades (`core/Lod/LodFade.ts`): a level change, and hiding or showing at `cullScreenSize`, no longer pops. For `fadeSeconds` both levels are drawn and dissolve into each other through a screen-space dither. Everything stays opaque, so there's no sorting, and shadows and post effects work as before. Shadows dither with the same split, so they don't darken during a fade.
  - `fadeSeconds` on a `LodDef` (and `lod` in `*.mesh.json`, scene mesh overrides, `AUTO` LODs and `createInstancedLodPool`'s `lod`), else `AppConfig.lod.fadeSeconds` (default 0.25), changed at runtime with `setLodFadeSeconds` / read with `getLodFadeSeconds`. 0 switches at once and leaves the level materials undithered.
  - Instanced LOD pools fade per instance: during a fade the instance is in both level meshes, so a fade adds no draw call. Plain meshes and `InstancedMesh` entities draw the outgoing level through a temporary copy of the mesh for the fade. Skinned meshes don't fade.
  - `lodDither(fade)` (a TSL mask for custom node materials), `enableLodDither(material)` (pools and LOD meshes call it on their level materials; it keeps an existing `maskNode`), `createLodFadeAttribute(mesh)` and `setLodObjectFade` / `clearLodObjectFade`.
  - `TAG_LOD_TRANSITIONING` (runtime only) marks a fading entity, and `lodFadeSystem` runs right after `lodApplySystem`, over the fading entities only (about 0.3 ms for 3,000 fading pool instances). `LodFrameStats` gets `fading` and `fadeMs`.
  - `LodTarget`: `applyLevel` and `setCulled` get a `fade` flag, and a target fades when it has the new optional `setFade(entityId, world, progress)`. Existing targets keep switching at once.
  - Debug: the LOD tab's Fades folder (a global fade seconds override and a time scale for slow motion, `setLodDebugOptions`'s `fadeTimeScale`), the fading count in its stats and rows, and the LOD window's fade state, progress and duration.

**Changed**

- LOD changes cross-fade by default (0.25 s). Set `AppConfig.lod.fadeSeconds: 0` (or a LOD's `fadeSeconds: 0`) for the old instant switch.

### App 1.6.1 (Preschooler)

**Changed**

- largeWorld's trees get a third LOD level, cross-quads, below a screen size of 0.032 (about 180 m from the overview camera); level 1 now ends there.
- largeWorld gets 300 rocks in an instanced LOD pool: a toolkit asteroid (500 triangles), the same rock at 80 triangles from a screen size of 0.05 (about 50 m) and a hemi octahedral impostor below 0.025 (about 100 m), a third of each in the ground.
- largeWorld also lists the `dayNight` sky box (its default stays `basicSkybox`). While a sky box with a sun light is active, the scene's own sun and ambient light are off, so its night falls on the whole scene.

## 2026-10-06 — physics-simulation-tiers

### Engine 4.10.0 (Afternoon)

**Added**

- Physics simulation tiers (`core/PhysicsTiers.ts`, types in `Physics/PhysicsTierTypes.ts`): a dynamic body made by `createPhysicsEntity` can be `FULL` (simulated as created), `STATIC` (switched to `FIXED`: it still collides, but nothing moves or wakes it), `DISABLED` (out of the broad phase, contacts and queries; pose and velocities kept exactly) or `REMOVED` (the body and its colliders leave the physics world and free their transform-buffer slot; the entity and its visual stay).
  - `requestPhysicsTier(entityId, tier, world?)` applies at the start of the next `APP_PHYSICS_STEP` sub-step, so a request from a step system or scene-load code is deterministic; requests made before then collapse into the latest. It returns `false` (with a debug-env warning) for a character, a body not yet created, or one not created `DYNAMIC` by `createPhysicsEntity`. `getPhysicsTier(entityId, world?)` returns `{ tier, pending, inFlight }`.
  - `STATIC` and `DISABLED` move the entity to `BODY_STATIC` (no per-frame sync or interpolation). `REMOVED` takes its bucket and `COLLIDER` components away, and `world.setTransform` moves only its visual until it's back.
  - Bodies connected by impulse joints change tier together; `REMOVED` is refused for a body with joints.
  - A `REMOVED` body keeps its ids and proxies, so app references to it and its colliders, collider event callbacks and later collider changes survive. A body at rest comes back exactly as if it had never left. A moving one keeps its pose, velocities and sleep state, but Rapier's contact and solver state starts over. In `WORKER_THREAD` mode a full transform buffer refuses the return: the entity stays `REMOVED` and a `PhysicsCapacityError` is logged.
  - Engine side: `detachRigidBody` / `reattachRigidBody` (plus `*Sync`, `PhysicsAPI.ts` and `EngineRapier.ts`) and the worker requests `RIGID_DETACH` / `RIGID_REATTACH`.
- The physics tier distance policy (`core/PhysicsTierPolicy.ts`): `setPhysicsTierPolicy({ rings, focus?, hysteresis?, cadence?, interval?, sceneId? } | null, world?)`. Each member gets the tier of the ring around the focus it's in (default focus: the world's main camera; or a position, or an entity id), with hysteresis moving out (default 0.15) and a joint group taking its nearest member's tier. A refused tier isn't requested again until the entity's ring changes.
  - `cadence: 'STEPS'` (default) measures the members and the focus on fixed steps that are multiples of `interval` (default 10) and decides `interval` steps later, so with a deterministic focus a scene plays out the same on every load and in both worker targets. `focus` gets the step index. `'FRAMES'` runs every `interval` frames at `APP_LOGIC` from the members' `TRANSFORM` positions.
  - Members: `createPhysicsEntity`'s `tierPolicy` option (the new `PhysicsEntityOpts`), or `setPhysicsTierPolicyMember(entityId, member, world?)`.
  - `getPhysicsTierPolicy`, `getPhysicsTierPolicyStatus` (cadence, interval, last measured step, pending measurements), `setPhysicsTierPolicyFrozen(frozen, source?, world?)` (each source freezes on its own), `isPhysicsTierPolicyFrozen` and `getPhysicsTierPolicyFreezeSources`. A policy with `sceneId` is removed when that scene exits.
- Step plumbing (`PhysicsAPI.ts`):
  - `getPhysicsSubStepIndex()`: inside an `APP_PHYSICS_STEP` system, the index of the fixed step about to run (a write made in step `k` shows in the snapshot stamped `k + 1`), else -1.
  - `addPhysicsStepGate(step)` returns a release function: no sub-step at or past `step` runs while it's held (several gates: the lowest holds). It also cuts the frame's batch it was added in. Time keeps accumulating while it holds (at most `maxSubSteps` steps of it) and is caught up after. A new physics world drops every gate. `getPhysicsStepGateStats()` counts the holds and their time.
  - `readBodyPositionsAtStep(ids)` / `readBodyPositionsSync(ids, out)`: body positions read right before the current step runs, the same values in both worker targets (also for a `REMOVED` body; NaN for an unknown id). Engine side `readBodyPositions` and the worker request `RIGID_READ_POSITIONS`.
- `getPhysicsBodyCapacity()` (`WORKER_THREAD`: transform-buffer slots used, max and refused creates) and `getLastPhysicsBodyActivity()` (awake and sleeping dynamic bodies, measured with the step stats, in the worker too).
- `getPhysicsBodyOwner(rigidBodyId)` (`PhysicsManager.ts`): the entity, world and created rigid type of a `createPhysicsEntity` body. `hasJoints()` and `forEachJointBodyPair(fn)` (`PhysicsAPI.ts`).
- `setBodyMovedListener` / `setBodyMovedObserver`: told about every `setTranslation` / `setRotation`, so a body moved directly reaches its entity's transform when it isn't synced every frame.
- Physics API debug tab:
  - "Bodies (live)": slots used / max, refused creates, awake and sleeping dynamic bodies.
  - "Simulation tiers (live)": counts per tier, pending and in-flight transitions, the policy's rings, cadence and state, its last measured step, measurements waiting for their step, step gate waits, and a "Freeze tier policy" toggle (its own freeze source, session only).
- Collider wireframes have two more colour states, `tierDisabled` and `tierStatic`, which lead the priority list (`PhysicsWireframeColors` in `AppConfig.debugPhysicsWireframe`, the tab's palette and the per-entity overrides).

**Changed**

- Fixed bodies take no transform-buffer slot in `WORKER_THREAD` mode, and `physicsToTransformSystem` no longer syncs `BODY_STATIC` every frame: a fixed body moved by `world.setTransform` or a direct `setTranslation` / `setRotation` is synced when it moves. A body whose pose didn't change no longer marks its transform dirty, so a sleeping body costs one pose read and compare per frame.
- `ECSWorld.setTransform`, `setVelocity` and `setDisabled` treat an entity with a physics tier as dynamic, and `setDisabled` keeps a `DISABLED`-tier body disabled.
- Determinism probe: an entity in a tier other than `FULL` hashes its tier too (scenes without tiers keep their hashes), and a `REMOVED` one its transform. While armed it freezes `FRAMES` tier policies; a `STEPS` policy keeps running, so the probe tests it.
- The `runtime` view icon is redrawn.

**Fixed**

- A full transform buffer (`maxBodies`) threw in the worker, the create never settled and a scene load hung. A create is now refused: `createPhysicsEntity` removes what it made and rejects with a `PhysicsCapacityError`, and `CREATE_RIGID_BODIES` is all or nothing.

### App 1.6.0 (Preschooler)

**Added**

- The `physicsTiers` demo scene (`physicsTiers.ts`): 686 crates in 49 piles on a 600 m ground, every crate in a `STEPS` tier policy (rings `FULL` 40, `STATIC` 90, `DISABLED` 160, `REMOVED` beyond) around a kinematic plough ball that mows a serpentine through the piles on fixed steps. Crates are tinted by tier and the rings are drawn around the plough. `C` switches between the overview and a chase camera. A visit plays out the same every time, in both worker targets.

## 2026-10-06 — editor-creator-view

### Engine 4.9.0 (Afternoon)

**Added**

- Views (`core/ViewManager.ts`): a view is what the whole canvas shows and what the main loop ticks. The built-in **Runtime** view is the loaded scene; editor views are registered by debug modules with `registerView({ id, title, icon, orderNr?, scene, getCamera, getCameraRig?, onEnter?, onExit?, mainUpdate?, update?, toggleDrawer? })` and switched with `setActiveView(id)` (calls run one after another; a failed `onEnter` returns to the Runtime view and resolves `false`). Also `unregisterView`, `getViews`, `getActiveViewId`, `getActiveView`, `getActiveViewCamera` and `isRuntimeViewActive`.
  - While an editor view is active the scene is suspended: no ECS stage of any world, no scene looper, no held keys and no physics step run, and `getElapsedTime()` stands still. Physics resumes without catching up, so a visit to an editor view keeps a scene deterministic. The loop runs the view's `mainUpdate` and, while it plays, its `update`, then renders its scene and camera (no PostFX) with the viewports on top.
  - `toggleViewPlay()` / `isViewPlaying()`: the active view's own play flag (in the Runtime view, the app loop's). The pause button and F7 call it.
  - `addViewFrameListener(fn, 'BEFORE_UPDATE' | 'AFTER_RENDER')` for debug tools that must run in every view (the axes gizmo, the env ball and the profiler's samplers use it), and `addViewChangeListener`.
  - The active view and each view's play flag are saved (`AEK_debugViews`), and `restoreSavedView()` switches back to the view after a refresh.
  - `renderFrameWhileMasterPaused()` (`MainLoop.ts`) renders one frame, so a switch shows the new view while the master loop is paused.
- A view tools group in the top on-screen row, left of the play group: Runtime, then each editor view, with a toast on every switch. It shows only when an editor view is registered. New icons: `runtime` and `material`.
- Editor view rules for the rest of the debugger:
  - Input: `setAppInputsSuspended` (`Input/InputState.ts`) stops mouse, touch, held keys and every key binding without `isDebugKey`, which the engine's debug keys and the CONFIG.ts `debugKeys` have. A scene load doesn't lift it.
  - HUD: `<body>` gets `aekEditorView` and `aekView_<id>`, and the scene's HUD is hidden as it was. `KEEP_IN_VIEWS_CLASS` (`core/HUD.ts`) keeps an element (the top row, undo/redo, stats, the toaster, the viewports layer, debug dialogs), and a draggable window kind registered with `keepInViews: true` (the profiler) is kept too.
  - The scene drawer keeps its open state while a view is active (`setDrawerSuspendedByView`) and leaves `debugDrawerOpen` to the editor's own drawer.
  - Undo: `perScene` actions recorded in an editor view go to that view's own history.
  - Profiler: in an editor view the census counts the view's scene against its camera, under the view's title.
- Camera rigs (`ViewCameraRig`, `core/Debug/Camera/_dbg__CameraRig.ts`): the axes gizmo follows, aligns and orbits the active view's camera, and the env ball follows it and shows the view scene's own environment.
- `createViewCamera({ viewId, defaultPose, near?, far?, store? })` (`core/Debug/Editors/_dbg__ViewCamera.ts`): every editor view's orbit camera, with its rig and a pose saved per view and per pose key (eg. per material) in `AEK_debugViewCams` or the editor's own store. `createViewCameraLSStore` and `clearViewCameraPoses(viewId)` go with it.
- `createEditorDrawer` (`core/Debug/Editors/_dbg__EditorDrawer.ts`): an editor view's right drawer, built like the scene debug drawer and mounting ordinary debugger tab definitions. Each editor creates its own.
- The **material editor**, the first editor view (`materialEditor`, the `material` icon, `debug/MaterialEditor.ts` → `core/Debug/Editors/Material/`):
  - A stage of its own: a preview ball (points, lines or a sprite for those material types, a notice for types it can't preview), its own lights, a studio environment (`RoomEnvironment`) and a grey background. The scene's sky box and lights aren't used.
  - It shows an editor copy of the material (`__matEditor__<id>`), so the scene's own instance is never changed. The copy lives only while the view is active, and the material's textures are loaded on demand. A material that fails to load shows a toast and a magenta ball.
  - A bottom drawer lists every project material (`*.material.json`) as a card with a swatch, its type and a `TSL` badge, filtered by id and name. Its right edge follows the right drawer.
  - The right drawer's **Params** tab shows the material's info (status, id, name, type, source, description, TSL file and textures) and its editable params, in Base, Surface, Transparency, Rendering and Points / lines folders. One list covers every material type: a param shows only when the material has it. A TSL material's inputs are edited live through their uniforms (numbers, colours, booleans, vectors); its texture inputs and `staticDefines` are read-only, and so are the asset params no binding covers. "Reset params" removes the material's edits.
  - The **Settings** tab holds the material's stage settings (background, studio environment on or off and its intensity, key, fill and hemisphere light intensities), auto-rotation (paused with the view), and the camera's FOV, pose and "Reset camera to default". "Clear editor data of all materials" asks first.
  - Each material keeps its own record (`AEK_debugMatEditorMat_<id>`): its edits, deviation-only in the material JSON's `params` / `nodes` shape (a value set back to the JSON's follows the JSON again), its settings and its camera pose. Both tabs' clear button removes it. A refresh brings everything back, plus the selected material, both drawers, the tab, the filter, the scroll positions (`AEK_debugMatEditorUI`) and the folder states (`AEK_debugMatEditorTabsUI`).
  - Undo and redo for every edited value, in the editor view's own history, with a slider drag as one step. Undoing an edit of another material selects that material first.
- `confirmClearLS({ message, confirmText, onConfirm, note? })` (`core/Debug/_dbg__ClearLSButtons.ts`): a confirm dialog for a clear without a scope to pick. `createClearLSButton`'s `icon` takes any icon.
- `ViewCamera.setFov(fov, save?)`.
- `lsGetKeysWithPrefix(prefix)` (`utils/LocalAndSessionStorage.ts`).

**Changed**

- The play group moved into a centred top row (`onScreenTopRow`) with the view tools; it still shifts with the open drawer.
- In an editor view, `h` toggles the view's own drawer (`toggleActiveViewDrawer()`), F1 and F5 do nothing, and `o` / `p` do nothing (the switch tools aren't built there).
- The debug camera is a camera rig too: the gizmo's align and drag suspend its controls through `setDebugCameraControlsSuspended`, and its pose is saved to `AEK_debugCams` when a gizmo move ends.

## 2026-10-05 — ecs-lod-selection

### Engine 4.8.0 (Afternoon)

**Added**

- LOD selection (`core/Lod/LodSystem.ts`): an entity with the `LOD` component gets a level from its projected screen size (bounding-sphere diameter / viewport height, perspective or orthographic), with hysteresis (default 0.1). Below `cullScreenSize` it's hidden by the new `TAG_LOD_CULLED`, a fourth reason in `reconcileObject3DVisibility`.
  - `lodSelectionSystem` and `lodApplySystem` run at `APP_RENDER_SYNC_ORDER.LOD_SELECTION` (-1.5): after frustum culling, so they skip frustum-culled and disabled entities, before light culling. They use the main camera.
  - Each level has a `screenSize` and optional `geo`, `mat` and `castShadow` (omitted ones come from the previous level). A plain mesh swaps its geometry, material and `castShadow`. The component holds a ref on every level's assets, which are released with it. A mesh with `preWarm` pre-warms every level.
  - Global bias: `AppConfig.lod.bias` (default 1), `setLodBias` / `getLodBias`. A definition has its own `bias`.
  - Selection budget: `AppConfig.lod.maxSelectionsPerFrame` (default Infinity), `setLodMaxSelectionsPerFrame` / `getLodMaxSelectionsPerFrame`. With a cap, the selection walks the `LOD` entities round-robin from where it stopped. Entities that come into view (frustum culling, `DISABLED` removed) or just got their `LOD` are still selected in that frame, past the cap. `getLodFrameStats` has `lapFrames`, the frames the last full walk took.
  - `setLodDebugOptions` / `getLodDebugOptions` (`freeze`, `forceLevel`, `useActiveCamera`) and `getLodFrameStats(world)` (selections, swaps, selection time in the debug environment).
- Mesh LODs: `setMeshLod(entityId, def, world)` / `removeMeshLod(entityId, world)` (`MeshManager.ts`), and `lod` on `createMeshEntity`'s props, in `*.mesh.json` and in a scene's mesh overrides (`schemas/lodSchema.ts`, levels checked to be strictly descending). `setMeshLod` returns `Promise<boolean>`: whether the LOD was set.
  - `lod: 'AUTO'` (or `{ auto: true, maxPixelError?, cullScreenSize?, hysteresis?, bias? }`) reads the geometry's LOD chain: a level is used while its error projects to at most `maxPixelError` pixels (default 1) at 1080 px high. It waits for a chain that is still requested or generating, also one an import has asked for but not started. A geometry without a chain warns and gets no LOD.
  - `setMeshGeometry(mesh, geometry)` moves a mesh's geometry ref, like `setMeshMaterial`. `preWarmMesh(mesh, label)` is `createMeshEntity`'s pre-warm, exported.
  - `getPendingLodChain(baseId)` (`LodChains.ts`).
- Instanced mesh pools are an engine system (`core/Instancing/InstancedMeshPool.ts`, they were in the toolkit). Their component is the core `ComponentType.INSTANCED_MESH_SLOT`, and their sync system registers itself with the module. `spawn` takes `InstancePlacement` (the toolkit's `ScatterPlacement` is one).
  - `despawn(world, entityId)` frees an instance's slot with a swap-remove (the pool's last instance moves into it), as do deleting the entity and removing its slot. Read an instance's `index` from its component, never keep it.
  - `createInstancedLodPool({ world, levels: [{ geometry, material, screenSize, castShadow? }], maxInstances, lod?, ... })`: one `InstancedMesh` per level, each instance an entity with `INSTANCED_MESH_SLOT` and `LOD` that moves to its level's mesh. A LOD-culled instance is in no mesh. Every level mesh gets the bounds of every placement at spawn.
  - `registerLodTarget(componentType, target)` lets `LOD` work on entities without a plain mesh (`LodTarget` in `Lod/LodTypes.ts`): the target resolves and applies the levels and handles LOD culling, and the entity's `Transform` gives its world position and scale.
- An `InstancedMesh` entity (eg. a static instance cell, `OBJECT3D` + `TAG_IS_MESH`) can have a mesh LOD: the whole mesh switches levels, measured by level 0's bounds over all its instances (`Lod/LodBounds.ts`) instead of one instance at the mesh's origin. `refreshLodBounds(entityId, world?)` re-reads them after the instances change. Its levels pre-warm on instanced stand-ins, and `AUTO` thresholds account for the instances' scale.
- "LOD" debug tab (`lodControls`, last in the default tab order): entities per level on screen, LOD culled and out of view, the last frame's stats, and the global bias, selection cap, freeze, force level and "use active camera" controls (runtime only).
  - Level overlay: a wire box per LOD entity in the selection camera's view, coloured by the level it shows, around the sphere the selection measures.
  - LOD window per entity (from the tab's mesh list, "Nearest in view" for pool instances, or the profiler's heaviest objects): the live screen size, distance and state, and each level's threshold as the distance it switches at with the current camera and biases.
  - `getLodSelectionCamera`, `measureLodEntity` and `getLodWorldSphere` (`Lod/LodSystem.ts`) measure an entity the way the selection does.

**Fixed**

- Deleting a pooled instance's entity left its matrix drawn: the pool had no despawn.
- A pool took no registry ref on its geometry and material(s) but released one when its mesh was deleted. It now takes them, and its mesh has `userData.entityId`, so `setMeshGeometry` / `setMeshMaterial` move them and `deleteScene` deletes its mesh entity.
- Pre-warm stand-ins aren't frustum culled: `compileAsync` culls against its own camera, which skipped a mesh far from the origin.

### Toolkit 1.3.1 (Crescent)

**Changed**

- `ecs/InstancedMeshPool.ts` and `ecs/InstancedMeshPoolTypes.ts` are deprecated re-exports of the engine's pool until the toolkit's next major version. `InstancedMeshPoolComponentType.INSTANCED_MESH_SLOT` is the core key, and `registerInstancedMeshPoolEffect` does nothing (the engine registers the sync system).

### App 1.5.1 (Preschooler)

**Changed**

- largeWorld's trees and bushes are instanced LOD pools. Their levels are the same generators at lower segment counts (the default tree and bush are too low-poly for a LOD chain): trees 30 → 18 triangles, bushes 120 → 36, and bushes hidden far away. From the overview camera that cuts the foliage from 285k to 91k triangles.
- `AppECSRegistry.ts` has the `LOD_SELECTION` order and no longer merges the toolkit pool's component, and `AppECSPlugins.ts` no longer registers the pool's effect.
- `testDebugScene` has a sphere with three hand-made levels (`p348LodSphere`, a colour per level) for checking LOD switches, and a static instance cell on the same levels (`p348LodCell`, 25 spheres in one `InstancedMesh` entity).

## 2026-10-05 — lod-chain-generation

### Engine 4.7.0 (Afternoon)

**Added**

- LOD chains (`core/Lod/`): `generateLodChain(geometryId, opts?)` simplifies a registered geometry with meshoptimizer into levels registered as geometries `${baseId}#lod${n}`. Each level records its triangle count and error, relative to the chain's `extent` (the base's largest bounding box side) and including the normal and uv deviation.
  - Levels share the base's vertex attributes (only the index differs) unless `compactVertices` gives each its own. A non-indexed base is welded first. Material groups are simplified per group and rebuilt.
  - Options: `ratios` (default `[0.5, 0.25, 0.1]`), `maxError` (0.05), `attributeWeights`, `compactVertices`, `lockBorder` (tiling geometry) and `permissive` (flat-shaded geometry doesn't simplify without it). A chain without levels warns.
  - Skinned and morph-target geometry is refused. Nothing selects a level yet.
  - Also `getLodChain`, `getLodChains`, `getLodChainOfLevel`, `isLodChainPending` and `releaseLodChain`. The chain holds a ref on each level and is released with its base (`onGeometryDeleted` in `core/Geometry.ts`). Levels take the base's scene owner.
- The simplifier runs in the assets worker (new kind `SIMPLIFY`) or on the main thread. `AppConfig.assets.simplifyWorkerTarget` (env `VITE_ASSETS_SIMPLIFY_WORKER_TARGET`, plus a boot override in the Assets tab) defaults to `WORKER_THREAD`, whatever `workerTarget` is. meshoptimizer loads on first use on both threads.
- `lodChain` (`true` or the options) on `*.importedAsset.json` and `ImportAssetParams`: `importAssetAsync` generates a chain for each rendered geometry after the import, without being awaited.
- Build-time chains: a GLB built by the asset pipeline carries its chains (levels as meshes `<mesh>__lod<n>` that no node uses, described by the root's `aekLodChains` extras). The import registers them (`LodChain.origin: 'BUILD'`) and doesn't simplify on the client. The generated data's `__lodChain` lists each primitive's levels for tooling.
- Assets tab: the geometry info window shows a geometry's chain (per level: triangles, error, bytes, shared or own vertices), with "Generate LOD chain" and release buttons.
- The Ækasha symbol, a black and white Æ with rounded corners: a UI icon (`getSvgIcon('aekasha')`, `core/UI/icons/svg/aekasha.svg`, in `currentColor`) and the favicon: `favicon.svg` (white on a dark browser theme), `favicon.ico` (16, 32, 48, with a white halo for dark tabs) and `apple-touch-icon.png` in `src/public/`, linked from `index.html`.
- About Ækasha dialog (`core/Debug/_dbg__About.ts`, `openAboutDialog()`), opened by the Æ button left of undo / redo (debug mode): the engine, toolkit and app versions, the version checksum and the build (commit, local changes, time), the runtime packages and main build tools, the runtime (environment, renderer, GPU, viewport, browser) and physics (every backend in `ENGINES` with its package version, status, thread, transform transport, SharedArrayBuffer availability, timestep and sub-steps, solver, gravity, interpolation, background behavior, body counts). "Copy info" copies it all as text, for bug reports.
- A physics backend in `Physics/ENGINES.ts` has a display `name` and its npm `packageName`.
- `PROJECT_METADATA` (`__PROJECT_METADATA__`, from `vite.config.ts`) has `license`, `packages` (the runtime dependencies), `buildTools` (vite, typescript) and `build` (`commit`, `hasLocalChanges`, `time`).

**Changed**

- The workers build as ES modules (`worker: { format: 'es' }` in `vite.config.ts`), so they can load chunks on demand.
- `meshoptimizer` is a runtime dependency (it was a dev dependency).

### Project

**Added**

- The asset pipeline builds an imported asset's `lodChain` into its GLB (`devTools/assetPipeline/lodChains.ts`), with the mesh side on. Uses of one file share one output, with the first use's options; a use with other options is warned. The cache key has the resolved options, the simplifier version and the GLB format version, so assets without `lodChain` keep their keys.

## 2026-10-04 — asset-optimization-pipeline

### Engine 4.6.0 (Afternoon)

**Added**

- KTX2 textures: `loadTextureAsync` loads a `.ktx2` file (picked by the resolved URL's extension) through a shared `KTX2Loader` on the main thread (`core/Import/KTX2.ts`). The loader is imported on first use and transcodes in its own workers, into what the device supports (BC7, ASTC, ETC2). It loads the Basis transcoder from `${BASE_URL}basis/`. `getKTX2Loader()` replaces the loader when the renderer has changed, and `disposeKTX2Loader()` disposes it. The sync `loadTexture` / `loadTextures` refuse `.ktx2` with an error that points to `loadTextureAsync`.
- Meshopt and KTX2 in GLBs: `GLTFLoader` gets the meshopt decoder (`MeshoptDecoder.ts`, imported only when a file uses `EXT_meshopt_compression`) and the KTX2 loader for `KHR_texture_basisu`. Both are set per file from its `extensionsUsed` (`GLTFExtensions.ts`), on the main thread and in the asset worker. The worker gets the main thread's transcoder path and detected formats (`KTX2WorkerSettings`), and `TextureTransfer.ts` sends a compressed texture's mip levels back.
- Pipeline outputs at runtime: `loadTextureAsync` and `importAssetAsync` load an asset's generated `__url` instead of its `fileName` (`resolveAssetUrl`, `core/Assets/AssetUrl.ts`). Generated URLs resolve against `BASE_URL`. In dev data, an asset without an output loads its `__sourceUrl`, with a warning. A relative `fileName` with neither is an error that names `yarn assets`. A packed texture (a `__url` and no `fileName`) loads too. An import keeps its id and source key on the declared `fileName`, so scenes still share one import.
- Asset JSON keys:
  - `*.texture.json` and `*.importedAsset.json` take `optimize`: a profile, a slot (textures), texture and mesh settings, a `budget`, or `false`.
  - Their `fileName` can be relative to the JSON (`./`, `../`).
  - `*.texture.json` takes `pack` (channel packing from several sources) in place of `fileName`.
  - The generated data has `__url`, `__sourceUrl`, `__bytes`, `__vramBytes` and, for textures, `__codec`.
  - `assets.config.json`'s schema is `AssetsConfigSchema` (`schemas/assetsConfigSchema.ts`), compiled to `.schemas/assetsConfig.schema.json`.
- `AppConfig.assets.optimization` (`enabled`, `textures`, `meshes`, each default true): the asset pipeline's project switches. Build time only: the runtime never reads them.
- Assets debug tab, Asset loading folder: "Load source files (boot)" loads the source files instead of the pipeline outputs from the next reload (debug env only). A production build ignores it with a warning, and a packed texture keeps its output. The "Resolved" box has a `Files:` line.
- The texture and geometry info windows show the file this page load loaded and what it is: a pipeline output, a pass-through source, a packed output, or the source (the override, or no output). A new "Asset pipeline" section shows the output, the source, the codec, and the download and VRAM estimates as in → out.
- GPU memory: a compressed texture counts its uploaded mip levels in the format the device transcoded it to (`installCompressedTextureSizer`). three r186 counts it as 1 B. This applies to every figure of the GPU memory tab and the profiler, and to the Assets tab's info window.
- `isKTX2(fileName)` (`utils/helpers.ts`).

**Changed**

- Imported HEIGHTFIELD colliders refuse a quantized position attribute (any array other than `Float32Array`) with an error that names the fix (`"optimize": { "mesh": { "quantize": false } }`), and the collider is skipped, as with Draco. Interleaved float attributes now work.
- Scene-inline textures and a scene's `backgroundTexture` have their own schemas (`InlineTextureSchema`, `InlineTextureOverridesSchema`) and take no relative `fileName`: the pipeline reads only `*.texture.json` files.

**Fixed**

- Imported CONVEXHULL colliders sit on their meshes. The derivation centred the hull's vertices on their bounding box while the body stayed at the node's origin, so a hull whose mesh isn't centred on its origin sat off it (57.8 mm on `obstacles`). This moves the hulls in existing scenes (eg. the gym's Suzanne). Hulls made in code (`vertices` given) are unaffected.
- CONVEXHULL colliders from quantized geometry: the hull was built from the raw integer values (32.7 km off). It now reads positions through the attribute getters, like TRIMESH. A quantized HEIGHTFIELD no longer throws in `mergeVertices` (see Changed).

### App 1.5.0 (Preschooler)

**Added**

- The `assetCompare` debug scene and its "Asset compare" tab, where the pipeline's profiles were chosen. It has a tiled ground at grazing angles, a MetalRust sphere and a Poly Haven prop. Two slots each hold one texture variant (PNG, ETC1S, UASTC with RDO λ 0–4, normal mode on or off), and V switches between them instantly. The tab lists each texture's VRAM, file size and encode error. "Measure all variants" and "Copy results" record per-device formats and timings, and "Run collider check" compares colliders from quantized and meshopt geometry with their sources. Its sky box is `assetCompare.skybox.json`.
- `testDebugScene` (`debugScene.scene.ts`) has PNG / KTX2 texture pairs and meshopt / KTX2 GLB copies, which check the decoders.
- `src/CONFIG.ts`: the `assets.optimization` switches, all on. It imports `AppConfig` with `import type`, because the asset pipeline imports the file in Node.

**Changed**

- `testTexture` and `testImport` load their pipeline outputs: a 1K UASTC KTX2 (VRAM 22.4 → 1.4 MB) and a meshopt GLB (46.7 → 14.7 KB).

### Project

**Added**

- The asset optimization pipeline (`devTools/assetPipeline/`, guide in `docs/techniques/asset-optimization.md`). `yarn assets [--only <id|glob>]` encodes the sources of `*.texture.json` / `*.importedAsset.json` into `src/public/aek-assets/`:
  - textures as KTX2 (UASTC or ETC1S) through KTX-Software's `ktx`;
  - GLBs through glTF Transform, with meshopt (lossless for collider sources) or Draco, and their textures as KTX2. Without `importTextures`, a GLB's textures are dropped.
  - Settings come from defaults, profiles and glob rules in `assets.config.json`, then the asset's own `optimize`. Channel packing and resizing use sharp.
  - A content-hash cache: the committed `assets.lock.json` plus `.cache/asset-pipeline/store/`, so a clone needs no encoder. Only a full run removes stale outputs and lock entries. Run stats go to `.cache/asset-pipeline/last-run.json`.
  - Opt-outs: `"optimize": false` (JSON or rule), the `src/CONFIG.ts` switches, and `AEK_ASSETS_OPTIMIZE=false` for one run. A skipped asset is passed through as it is.
- `yarn gatherAppData` and the dev server run the cached pipeline before they gather. The dev server's plugin (`devTools/sceneGathererPlugin.ts`, moved out of `vite.config.ts`) builds only what a change touched and shows a failed asset in the error overlay.
- Production builds:
  - The gather fails when an asset that a shipped scene uses has no output (encoder missing, or a failed encode) or is over its budget. Budgets are a `budget` per profile or asset, plus a per-texture ceiling from the profile's `maxSize` and codec.
  - `AEK_ASSETS_ALLOW_UNOPTIMIZED=true yarn build` ships the assets without `ktx` unoptimized instead.
  - `dist/aek-assets/` gets only the outputs the build loads (`devTools/assetOutputsBuildPlugin.ts`).
- `yarn setupAssetTools [--force]` downloads the pinned KTX-Software 4.4.2 into `.tools/` (Linux incl. WSL2, macOS; x64, arm64), checks its SHA-256 and unpacks it in Node. The pipeline runs the same setup before its first encode. It needs `ktx` ≥ 4.4.0, and names a skipped one that is too old or broken. A download times out after 120 s, and the dev server doesn't retry a failed one for 5 minutes.
- `yarn dev:https` (port 8443, a self-signed certificate through `@vitejs/plugin-basic-ssl`): a phone on the LAN needs a secure context for WebGPU and `SharedArrayBuffer`.
- `.nvmrc` (22.13.0) and `.claude/hooks/use-node.sh`, which the hooks and Claude's commands source.
- `devTools/assetPipeline/phase1Variants.ts` builds the `assetCompare` scene's variants into `src/public/debugger/assets/testOptimized/phase1/`.
- Dev dependencies: `@gltf-transform/core`, `/functions`, `/extensions` and `/cli` 4.5.1, `meshoptimizer` 1.1.1, `draco3dgltf` 1.5.7, `sharp` 0.35.5, `@vitejs/plugin-basic-ssl` 2.3.0.

**Changed**

- `yarn copyDracoDecoders` is now `yarn copyDecoders`. It also copies the Basis transcoder to the gitignored `src/public/basis/`.
- The dev server sets COOP / COEP on every response, 304s included (`crossOriginIsolationPlugin` replaces `server.headers`). With Web Inspector open, Safari revalidated the physics worker and blocked it.
- `tsconfig.json` lists `"types": ["node"]`: yarn 1 installs the stub `@types/wrap-ansi@8.1.0` for `@gltf-transform/cli`, and tsc failed on it (TS2688; `docs/issues/gltf-transform-cli-types-wrap-ansi-stub.md`).

**Fixed**

- A failed production gather stops `yarn build`. Its result was ignored before.

## 2026-10-03 — spatial-domains

### Engine 4.5.0 (Afternoon)

**Added**

- Spatial domains (`core/Spatial/SpatialIndexSystem.ts`): an ECS world can hold several named spatial grids, each with its own cell size, capacity and update policy. `registerSpatialDomain(world, { id, cellSize, maxMembers, update?, oversizedRadiusMultiplier? })`, `getSpatialDomain`, `getSpatialDomainIds`, `getSpatialDomainOptions`. The existing grid is the `DEFAULT` domain (`getSpatialGrid` still returns it); an app can register `DEFAULT` itself to set its settings. Registering an id again with other settings re-creates its grid and re-inserts the members.
- Update policies: `DYNAMIC` (refreshed and rebuilt every frame, as before), `STATIC` (rebuilt only in a frame where a member joined or left) and `MANUAL` (rebuilt only by `rebuildSpatialDomain`). `invalidateSpatialDomain(world, id)` refreshes and rebuilds any domain at the next frame; `rebuildSpatialDomain(world, id)` does it now.
- Membership: `joinSpatialDomain`, `leaveSpatialDomain` and `isInSpatialDomain`. An entity can be in several domains. `DEFAULT`'s membership is still `SPATIAL_INDEXED`; the others' is the new runtime `SPATIAL_DOMAINS` component (a bit mask, at most 31 domains besides `DEFAULT`). A full non-default domain refuses a member with one dev warning, where `DEFAULT` still throws.
- Radius providers: `registerSpatialRadiusProvider(componentType, fn, { scaleIndependent? })` replaces the hard-coded mesh and light radii. `refreshSpatialRadius(entityId)` re-reads a member's radius after what its provider measures changed, and `getConservativeGeometryRadius(geometry)` is the mesh provider's measure.
- `core/Spatial/CellKey.ts`: the cell maths (`worldToCell`, `packCellKey`, `unpackCellKey`, `isCellInRange`, `cellBounds`, the axis constants), shared by every cell-keyed structure so a cell key means the same thing everywhere for a given cell size.
- `SpatialGrid.getRadius(entityId)` and `memberAt(index)` (iterating the members without an allocation).
- Scene-scoped domains: `registerSpatialDomain`'s `sceneId` makes the settings that scene's. They win over the domain's world settings (registered without `sceneId`) until the scene exits, when the domain goes back to its world settings or, without any, is unregistered. `setSpatialGridCellSize(world, cellSize, sceneId?)` and `getSpatialDomainSceneId(world, id)` take and tell the scope. The scene loader releases the previous scene's settings right after its entities are deleted (`releaseSceneSpatialDomains`).
- `unregisterSpatialDomain(world, id)`: every member leaves the domain, its grid is dropped and its bit is reused by the next registration. `DEFAULT` can't be unregistered.
- Scene JSON `spatialDomains`: the domains a scene registers for itself, before any of its entities join one (`registerSceneSpatialDomains`). `DEFAULT` takes a partial entry merged over its world settings; other domains need `cellSize` and `maxMembers`.
- "Spatial index" debug tab: a domain dropdown; stats, histogram, oracle, overlays and the cell size apply to the selected domain, and each domain's overlays have their own colours, so several can be shown at once. New rows show how often the selected domain rebuilds and when it last did, and an "All domains" summary lists every domain's policy, members, rebuilds per frame and rebuild time (`getSpatialDomainRebuildStats`, debug env only). A cell size set in the tab now holds when the app registers the domain again, and "Reset to the app's cell size" goes back to the app's.
- The brute-force oracle works per domain (`setSpatialGridOracleEnabled(world, enabled, domainId?)` and the other oracle functions take a domain id, default `DEFAULT`; `getOracleCheckedQueryCount` is new). While on, it also runs 8 probe queries near random members every frame, so a domain nobody queries yet is checked too.

**Changed**

- A member's radius follows its Transform scale: the provider's local radius is multiplied by the largest scale axis on every refresh (light ranges are scale-independent). Mesh radii are `|center| + radius` of the geometry's bounding sphere, so geometry that isn't centred on its origin is covered (eg. `largeWorld`'s crate stack: 1.885 → 2.667).
- `SpatialGrid.addMember`, `removeMember` and `updateRadius` are O(1): the largest indexed radius is only ever raised between rebuilds and made exact by `rebuild()`. This also removes the O(n²) re-insert when the cell size changes.
- `setSpatialGridCellSize` re-registers `DEFAULT` with the new cell size.
- The tab's saved settings are kept per domain (`AEK_debugSpatialGrid`); the old flat settings become `DEFAULT`'s.
- `DEFAULT`'s grid is per scene: built on demand (by its first `SPATIAL_INDEXED` member, a `getSpatialGrid` call, or the rebuild system when persistent members are left) and freed on every scene change, so a scene that indexes nothing has no grid. Its settings outlive the grid, and registering `DEFAULT` without one only stores them. `getSpatialDomain(world, 'DEFAULT')` can now be undefined after a scene change, where it used to return the session's grid. Light object culling reads it that way and no longer creates the grid.
- The tab's cell size override is saved for the scope it was edited in (the world settings, or one scene's), and a scene's settings don't fall back to the world value. A "Scope" row shows which is in use, the dropdown lists only registered domains (plus unregistered ones with a value saved for the current scene or the world), and `DEFAULT` without a grid shows as `DEFAULT (no grid)`.
- The Lights tab's distance edits refresh the light's radius in the spatial index.

**Fixed**

- A mesh's spatial radius no longer goes stale when its scale changes.
- A query between a member's removal and the next rebuild no longer hands `-1` to the visitor.

### Toolkit 1.3.0 (Crescent)

**Added**

- `InstancedMeshPool`'s `spatialDomain` option: `spawn()` joins every instance to that domain, so pool instances can be indexed. The pool registers a radius provider for `INSTANCED_MESH_SLOT` (the pool geometry's radius, scaled by the instance's Transform).

**Changed**

- `InstancedMeshPool`'s component keys and data moved to `ecs/InstancedMeshPoolTypes.ts`, which `InstancedMeshPool.ts` re-exports, so the pool can import the engine's spatial index without an import cycle.

### App 1.4.1 (Preschooler)

**Changed**

- `largeWorld`'s trees are in their own `STATIC` spatial domain, `FOLIAGE` (cell size 16), apart from `DEFAULT`'s light culling members. It rebuilds once when the trees spawn and when they're deleted, never in between. It belongs to the scene, so leaving `largeWorld` unregisters it.
- `largeWorld.scene.json` sets `DEFAULT`'s cell size to 24 for that scene (`spatialDomains`).
- `AppECSRegistry.ts` imports the pool's component types from `InstancedMeshPoolTypes.ts`.

## 2026-10-03 — small-changes-and-refactorings-20261003

### Engine 4.4.0 (Afternoon)

**Added**

- Debug shortcut: F8 opens and closes the profiler window. In production test mode it does the same when the profiler is enabled there, and gives way to an app binding of the same key. It can be rebound through `AppConfig.debugKeys` (`sc-toggle-profiler`).
- Physics entity and character edit windows: a "Set position and cancel velocities" button under "Set position". It moves the body and zeroes its linear and angular velocity (undo restores the position only).
- Characters tab: each row has a Character state window toggle (lit while the window is open) next to the gizmo pin. It follows the row click rule: opens the window, brings it to the front, or closes it when on top. The edit window's button still opens it too.

**Changed**

- The profiler button in the top on-screen tools uses the small icon size, matching the drawer's tab icons.
- The Character state window's false boolean icon is a light grey (the debug text colour) bold X instead of a red circled X, so it no longer looks like the true icon and doesn't dominate the list. New `xBold` icon; `circleXCutout` removed. `$debugBoolFalse` changed with it; the GPU memory tab's over-budget red is now `$debugAlertLight`.

## 2026-10-03 — profiler-mega-window

### Engine 4.3.0 (Afternoon)

**Added**

- Profiler window (debug builds, and production test mode when it is enabled there): a draggable window with a row of icon tabs. It opens from three places: a click on the on-screen stats panels (a setting can turn this off), the Statistics tab's Profiler folder, and a speedometer button next to pause in the top on-screen tools (shown active while the window is open). It measures only while it is open, and releases every measurement it turned on when it closes.
  - Overview: one table of key figures, refreshed 1, 2, 4 or 10 times a second. Shown by default: TFPS estimate (from CPU and GPU time, or labelled CPU-bound without GPU timing), FPS, frame time (average and worst), CPU, GPU, physics (step, dispatch and write-back, plus sub-steps per frame, flagged at the maximum), draw calls and triangles drawn, triangles / vertices / meshes / entities in view and in total, JS heap, and three's GPU memory estimate. Hidden by default: instances, lights and shadow passes, physics bodies, ray casts, PostFX GPU time, long tasks and the scene. A row that can't be measured says why ("WebGPU only", "Chromium only").
  - Objects: breakdowns by kind and by owner (count, triangles, vertices) with two-tone bars (in view solid, culled faded), measured in triangles, vertices or objects; ECS entities per world and entities per component type; the 10 heaviest objects in view, with an Edit button where the entity has an edit window (debug env only); and sparklines of triangles in view, meshes in view and draw calls.
  - GPU memory: the drawer's GPU memory tab, moved here (see Changed).
  - Settings: the update rate, which Overview rows show and in what order, the stats panel entry point, GPU timing, leaving debug helpers out of the counts, and enabling the profiler in production test mode.
  - "In view" comes from a census that repeats three r186's frustum and layer culling against the active camera (the debug camera when it is active), at the update rate. It costs about 0.2 ms per sample in `largeWorld`. Draw calls and triangles drawn (`renderer.info`) remain the ground truth.
- `debug/Profiler.ts`:
  - Tabs: `createProfilerTab`, `openProfilerTab`, `updateProfilerTab` and `isProfilerTabOpen`, the drawer tab contract without `sceneId`.
  - Window and settings: `toggleProfilerWindow`, `isProfilerWindowOpen`, `isProfilerAvailable`, `isProfilerLoadedInThisMode`, `isProfilerEnabledInProdTest`, `getProfilerSettings` / `setProfilerSettings`.
  - `registerStatsSource({ id, label, acquire?, release?, read, availability? })`: a refcounted figure from engine or app code that the profiler views can show.
  - `markDebugHelper(obj)`: the census counts a debug object in its own row. The engine marks its light and camera helpers, physics wireframes, ray helpers, character gizmos, spatial grid overlays and 3D symbols.
  - `registerEntityWindowOpener`: an edit window the Objects tab's Edit button can open. Characters and physics entities register one.
- `setPhysicsStepStatsEnabled(on)` / `isPhysicsStepStatsEnabled()` (`PhysicsAPI.ts`): physics step stats can be switched on and off at runtime in every worker target, through a new one-way `SET_STEP_STATS` worker message. The `stepStatsEnabled` boot setting is the initial value. The PHY stats panel still follows the boot setting only. The `SharedArrayBuffer` stats buffer is now allocated at every `CREATE_WORLD`.
- `getPhysicsObjectCounts()` (bodies, colliders, joints) and `getPhysicsSubStepTotal()` (fixed sub-steps since boot) in `PhysicsAPI.ts`.
- `setFrameProbe(probe | null)` (`MainLoop.ts`): `begin(now)` and `end(now, rendered)` around every frame, in the debug loop and both production loops. While no probe is set, it costs one null check per frame.
- Draggable windows take an `icon`, shown in the header and persisted.
- `profiler`, `objectsCubes` and `gear` icons.

**Changed**

- The GPU memory tab moved from the debug drawer into the profiler window. Its id is `gpuMemory` (was `gpuMemoryControls`), and its settings are kept. The Statistics tab's "Draw calls, memory" button opens it there. It now also shows in production test mode when the profiler is enabled there, without the budget toast and the links to drawer tabs. `registerGPUMemorySource` registers wherever the profiler loads.
- `DEFAULT_DEBUG_DRAWER_TAB_ORDER` no longer lists `gpuMemoryControls`. An app `tabOrder` that still lists it is unaffected (unknown ids are ignored).
- The drawer's tab lifecycle moved into a tab host (`core/Debug/_dbg__TabHost.ts`) that the profiler uses too. The drawer behaves as before.
- The Physics API tab's "Track physics step time (reloads)" shows the boot setting, not the runtime state the profiler switches.
- While the profiler holds the ray stats, the Raycast tab shows live stats with its checkbox off.

**Fixed**

- Physics step stats in `WORKER_THREAD` mode: `dispatchMs` and `writeBackMs` were off by the worker's start time (about ±1.3 s), because a worker's `performance.now()` counts from the worker's creation. The worker now puts its stamps on the main thread's clock (`INIT_PHYSICS` carries `mainTimeOrigin`).

## 2026-10-03 — gpu-memory-debug-tab

### Engine 4.2.0 (Afternoon)

**Added**

- GPU memory tab in the debug drawer (debug builds only, after Renderer). Its figures are three's own bookkeeping of what it created (`renderer.info`), not a driver measurement, and the tab labels the backend (WebGPU or WebGL2).
  - Totals: `info.memory.total` and one row per category (bytes and count), plus render target and geometry counts. A budget bar against a budget in MB (default 512, persisted in `AEK_debugGPUMemory`), with a debug toast once per scene when it's over. The peak since boot and since the last scene enter, with the time it was reached.
  - Frame: draw calls, triangles, render calls and compute calls of the last frame, with min / avg / max over 500 ms. A debug `LATE_MAIN` system samples them right after the render, so the peaks and the budget toast work while the tab is closed too.
  - By owner: registered textures and geometries, the textures a registered material holds alone (eg. clones) and the sources below, summed per owner with three's per-object bytes, so the owners and "untracked" add up to the total. Owner keys of the form `sceneId#cellKey` are listed as cells under their scene. Untracked has its own table per category.
  - Sources: GPU resources that aren't registered assets. Built in: the renderer's output target (MSAA, output pass), shadow maps (VSM blur targets included), the PostFX chain (every render target reachable from its nodes), instance buffers of every `InstancedMesh` in the scene, the sky box env bake, nebula cube and texture-sky PMREM, each viewport, and the debug 3D symbols. Untracked is under 1 % of the total in `skyShowcase`, `space` and `largeWorld`.
  - Cube textures: three r186 counts a cube's faces as 1×1 each, so the tab estimates what's left out (eg. ~12 MB for `space`'s nebula cube) and shows it per source and under "By owner", outside every total.
  - Snapshot and live diff, for leak hunting across scene switches: changed categories; "Left behind", what earlier scene visits since the snapshot created and is still allocated (grouped by kind, label, scene visit and call site, with how many were garbage collected without being destroyed); and registered assets new, gone or changed. "Log diff to console" logs it all, and "Call sites" records where each allocation was made.
  - The Stats tab's "Draw calls, memory" button opens it.
- `registerGPUMemorySource({ id, label, getResources, owner? })` (`debug/GPUMemory.ts`): names a GPU resource that isn't a registered asset for the GPU memory tab. `getResources` returns the three objects (textures, render targets, geometries, attributes), and the tab counts three's bytes for them. Returns a function that removes the source; a no-op outside the debug env.
- `onRendererCreated(fn)` (`core/Renderer.ts`): runs `fn` once with the renderer, right after it is constructed and before its `init()`, or right away if it exists.
- A `memory` icon.

**Changed**

- `DEFAULT_DEBUG_DRAWER_TAB_ORDER` has `gpuMemoryControls` after `rendererControls`.

**Known issues**

- three r186 never deletes a removed `InstancedMesh`'s instance attributes, so `renderer.info.memory` grows by ~3.7 MB of counted attributes on every `largeWorld` visit (the GPU memory tab's diff names them). Fixed in three r187; see `docs/issues/three-instanced-node-attribute-leak.md`.

## 2026-10-02 — triple-buffered-physics-transform-buffer

### Engine 4.1.0 (Afternoon)

**Added**

- One debug edit window per entity: the Light, Camera, ECS world, PostFX pass, physics entity, asset info and character edit windows open a window per entity, so several can be open at a time.
  - A list row opens its entity's window. A second click brings it to the front when another window covers it, and closes it when it is on top. The list shows every entity with an open window as selected.
  - An edit, an undo/redo or a list toggle rebuilds only its entity's window. A global action (eg. toggling all light helpers) rebuilds every open window of the tab.
  - A new window opens where that tab's last window was moved, resized or closed, offset by one header height per window of the tab that is already open.
  - The windows come back after a reload, and stay open over a scene change when the next scene has their entity.
  - Deleting a light, a camera or an ECS world closes only its window. A sky light that the sky box re-creates under the same id keeps its window.
  - The character edit window now stays open over a scene change like the others (it used to be removed).
- Window kinds (`core/UI/DraggableWindow.ts`), for several windows of one kind: the `kind` open prop, `getKindWindowId(kind, key)`, `registerDraggableWindowKind(kind, { content, onClose, sceneTargetResolver })`, `getDraggableWindowsOfKind`, `updateDraggableWindowsOfKind` and `toggleDraggableWindow` (the list row rule above). A kind's options cover each of its windows, also one restored from LS. Closing a kind window removes it, so closed ones don't pile up in LS.
- `registerDraggableWindow(id, { content, onClose, sceneTargetResolver })`: the same once-at-module-load registration for a single window.
- A real stacking order: each layer (app and debug windows) keeps its windows in click order, and a reload restores it. `bringDraggableWindowToFront(id)` and `isDraggableWindowOnTop(id)`.
- Fit to screen: double-clicking a draggable window's header (not a dialog's) moves it to the top center, and shrinks a resizable one that still overflows, never below its min size. `fitDraggableWindowToScreen(id, cascadeIndex?)`, and `fitAllDraggableWindowsToScreen()`, which fits every open window cascaded so every header stays visible. The Debug tools tab's "Center and fit all windows" button runs it.

**Changed**

- Windows are dragged and resized with per-window pointer events, which write at most once per frame (touch dragging works as a side effect).
- Z-indexes follow the stack: app windows from 100 up (below the loaders' 1000), debug windows from 20000 up, two levels per window (its backdrop sits right below it). `getDraggableWindowsDefaultZIndexes`'s active values are the current top window's.
- A draggable window's position is stored and rendered in px. A non-px position (`%`, `vw`, `vh`, the window's centre) is converted when the window mounts. A non-draggable window with a non-px position, like a dialog, stays CSS-centred. Without a `position`, a window opens at the viewport's centre.
- The default max size is the viewport (`100vw` × `100vh`), not its size when the window opened.
- Windows stay reachable. A drag keeps 80 px of the title and the whole header on screen. A viewport resize, a mount and a restore from LS move a window fully on screen (to the top left when it is larger than the viewport). A manual resize stores that axis in px.
- A closed window keeps no DOM: closing tears its content down, and reopening builds it fresh.
- `updateDraggableWindow` rebuilds only the content: it no longer runs `onClose`, brings the window to the front or resets its scroll.
- `DraggableWindowConfig` is the persisted part of a window, with `geometry: { x, y, w, h }` in place of `position` and `size`. `getDraggableWindow` still returns the live objects too (`windowCMP`, `content`, …). The LS key (`AEK_popupWindows`) is the same and old entries load. A kind's last place is stored in it under `__kindGeometry`.
- The ray tester buttons follow the list row rule (open, bring to front, close).
- One time: a Light, Camera, ECS world, PostFX pass, physics entity or asset info window that was open before this update doesn't reopen. Its saved place becomes where the tab's next window opens.
- `PhysicsTransformBuffer` (internal to the physics transport): `markWritten` is `publish`, `latch()` is new, the constructor and `createPhysicsTransformArrayBuffer` take a bank count (1 or `PHYSICS_TRANSFORM_SHARED_BANKS`), and `getWriteCount()` is gone. `CREATE_WORLD`'s response carries `bankCount`.
- `latchPhysicsSnapshot()` (`PhysicsAPI.ts`), called by every main loop variant right after `timer.update()`. Custom loops that drive `stepPhysics` themselves must call it first in each frame.

**Deprecated**

- `registerDraggableWindowContentFn`, `registerDraggableWindowSceneTargetResolver`, `registerDraggableWindowCmp` and `addOnCloseToWindow`: use `registerDraggableWindow` or `registerDraggableWindowKind`.
- `getDraggableWindowsStartingWith` and `closeAllDraggableWindowsStartingWith`: use window kinds.

**Fixed**

- Physics reads no longer tear in `WORKER_THREAD` mode with the `SharedArrayBuffer` transport (`SHARED_MEMORY`). The worker used to rewrite the one shared transform buffer while the main thread read it, so a snapshot's step stamp could disagree with its poses, two systems in the same frame could see different steps, one pass over the bodies could mix two steps, and a single body could be half old, half new. This showed up as occasional interpolation spikes. The buffer is now a lock-free triple buffer: the worker publishes each finished, stamped write-back by an atomic bank swap, and the main loop latches the newest one at the start of every frame. Every reader in a frame (held keys, `APP_PHYSICS_STEP`, the TRANSFORM sync, interpolation, debug wireframes) sees the same complete snapshot, and a write-back that lands mid-frame is read from the next frame on. Memory: three banks, about 320 KiB at the default 2048 bodies. `MAIN_THREAD` and the `MESSAGE_BATCH` fallback are unchanged.
- Draggable windows:
  - Windows with a non-px position no longer jump by half their size when a drag starts, and come back at the same place after a reload.
  - A window can no longer be lost off screen after a viewport resize or a reload on a smaller screen, or left with only its header buttons on screen (which can't be grabbed).
  - A reopen with `resetPosition` / `resetSize` moves a live window. It used to overwrite the stored position while the window stayed where it was.
  - `onClose` ran twice for a `removeOnClose` window, and on every `updateDraggableWindow`.
  - Array `windowClass` / `backDropClass` values were ignored, and the height was clamped by the min width.
  - The last saveable window removed stayed in LS, and every window lookup parsed LS.
  - The clear-LS scope dialog opened under the debug windows.

## 2026-10-02 — character-definitions-and-refactoring

### Engine 4.0.0 (Afternoon)

**Added**

- Characters are ECS entities: a `CHARACTER` component (`CharacterObject`) and a `TAG_IS_CHARACTER` tag. Deleting the entity (or leaving the scene) removes the character, its key and mouse bindings and its controller. `getCharacterById(id)`, `getCharacters(world?)` and `deleteAllCharacters(world?)`.
- Character intent (`CharacterObject.intent`, `core/Character/CharacterIntent.ts`): what the player or AI wants this sub-step (`moveX`/`moveZ` in world space, `moveForward` along the facing, `turn`, `faceYaw`, `jump`, `run`, `crouch`). Input, AI and game code write it, and only the controller's tick moves the body. Helpers: `createIntent`, `addIntentMove`, `hasMoveIntent`, `yawFromDirection` and `wrapToPi`.
- Input schemes (`createDynamicCharacter`'s `input`, `core/Character/CharacterInputSchemes.ts`): `TANK`, `WORLD_FIXED` (`moveNorth`/`South`/`West`/`East`) and `CAMERA_RELATIVE` (`moveForward`/`Backward`/`Left`/`Right` on screen). The `jump`, `run` and `crouch` mappings are optional, and `runMode`/`crouchMode` are `TOGGLE` (default) or `HOLD`. Binding ids are namespaced per character (`<id>:…`), so several input-driven characters work side by side.
- `_turnToMoveDirection` (default per scheme) turns the character toward its world move direction at `_rotateSpeed`.
- Body plans (`core/Character/CharacterBodyPlans.ts`): `HUMANOID_CAPSULE` derives the colliders by role (`MAIN`, `CROUCH`, `WALL_SENSOR`, `FLOOR_SENSOR`) and the probe dimensions from the size keys. `createDynamicCharacter`'s `body` takes a custom `CharacterBodyPlan`. `CharacterObject.kind` is the plan's kind (`'HUMANOID'`).
- Locomotion state: `data.locomotionState` (`IDLE`, `WALK`, `RUN`, `CROUCH`, `CROUCH_WALK`, `JUMP`, `FALL`, `SLIDE`, `TUMBLE`, `GET_UP`), with `onLocomotionStateChange(id, listener)` (returns the unsubscribe function) or the creator's `onLocomotionStateChange` option.
- Control mode: `setControlMode(id, 'CONTROLLED' | 'PHYSICS_ONLY')`. `PHYSICS_ONLY` leaves the body to physics (state `TUMBLE`). Back to `CONTROLLED`, the character gets up.
- Character config keys that replace hard-coded values, with the same defaults: `_tumblingAngularDamping`, `_gettingUpAngularDamping`, `_gettingUpMaxAngVelo`, `_gettingUpTorque`, `_wallMicroPush`, `_slopeSlideSpeed`, `_jumpCooldown`, `_wallNormalMaxY`, `_wallCastDistance`, `_crouchHeight` and `_fallStateDelay`. Every `CharacterData` field has a JSDoc line.
- `RigidBodyAPI.readVelocitiesInto(out, offset?)`: an allocation-free read of the linear and angular velocity, the twin of `readPoseInto`.
- Character state window (debug), opened from a character's edit window. It replaces the Character data tracker and keeps its window id, so saved positions and sizes still apply. It shows the character's `data` in three collapsible groups by key prefix: State, Properties (`_`) and Internal memory (`__`, closed by default).
  - Rows are built once, and an update writes only the values that changed, in open groups only. The update interval (0 = every rendered frame) is in the header, next to the update's measured cost.
  - Values are formatted for reading: booleans as green/red icons, vectors on one line, fixed-width numbers, timestamps as "ms ago" and angles with degrees.
  - A row flashes when its value changes. Vectors and State numbers don't flash, and the Flash toggle turns it off.
  - Freeze keeps the current values on screen, and Copy JSON copies the live data.
  - Several windows run side by side. A window stays open over a scene change when the next scene has a character with the same id.
  - The interval, flash and group states persist in `AEK_charStateWin`.
- `CharacterController.probes` (`CharacterProbes`): the controller's body plan, dimensions and collider roles, and its last floor ray and wall cast as it used them (`CharacterCastRecord`: origin, direction, stance, length, hit point and normal, and when the result arrived). Read-only diagnostics, written in place with no allocation per cast. Rejected wall hits and misses are kept too.
- Character debug gizmos, toggled in a second header row of the Character state window: velocity, velocity relative to a moving platform, facing, the ground normal (green walkable, red too steep), the floor ray (solid to the hit, dashed past it), the floor sensor (lit while grounded), the last wall cast (its cylinder and sweep, with the hit normal green when used as a wall and red when rejected) and a trail of the last ~2 s.
  - They start from the visual's pose of the frame being drawn, so they don't jitter against an interpolated mesh. Freezing the window freezes them too.
  - Drawn on top by default, with a Depth toggle, and a Scale for the velocity arrows (metres per m/s). The toggles, depth and scale persist in `AEK_charGizmos`.
  - Pin keeps a character's gizmos after its window closes, set from the window or from the character's row in the Characters tab. A pin is kept over a scene change when the next scene has a character with the same id (session only).
- `CharacterObject.initialConfig`: a frozen copy of the character's configuration (the `_` keys of its data) as it was created. `CharacterController.config` (`CharacterConfigHooks`): the keys sized into the body at creation (`bakedKeys`) and `onChange(key)`, which recomputes what is derived from a key written from outside (the dynamic character's `__maxWalkableAngleCos`).
- Live character config editing (debug), in the Character state window's Properties group:
  - Number values are edited in place (Enter or blur commits, ArrowUp/ArrowDown step, Shift ×10, Escape cancels), clamped and stepped per key, with the unit and the key's description in the tooltip. `_maxWalkableAngle` is edited in degrees. Booleans toggle with a click on their icon. Keys typed into an editor don't reach the game's key bindings (the F-keys still do).
  - The keys sized into the body at creation (`_height`, `_radius`, `_crouchHeight`, `_skinThickness`, `_groundDetectorOffset`, `_groundDetectorRadius`) are shown locked.
  - A value that differs from the creation-time one is marked and gets a reset button. The group's header shows the changed count, "Reset all" and "Copy changes" (a `charData` snippet of the changed keys, to paste into the scene's code).
  - Every edit, reset and Reset all is one undo step (`character.config`); a held arrow key is one.
  - Edits are saved per scene and character id in `AEK_debugCharConfig` (only the values that differ from the creation-time ones) and applied when the character is created, in the debug environment only. A saved row has a blue dot, and the window header shows the saved count with a clear button for that character. The Characters tab's clear button clears them for this scene or all scenes. Clearing leaves the live values as they are.
- `applySavedCharacterConfig(character)`: for controllers, applies the character's saved debug config values. Call it once, right after assigning `character.controller` (`createDynamicCharacter` does). A no-op outside the debug environment.
- `confirmClearScope`'s optional `note`, a second paragraph in the clear dialog.
- The character edit window (debug) shows `kind` and `controlMode`.
- The `circleCheckCutout`, `circleXCutout`, `pin` and `lock` icons, and the `$debugBoolTrue`, `$debugBoolFalse` and `$debugValueFlash` Sass colours.

**Changed**

- Breaking: the dynamic character moved from `utils/character/dynamicCharacter.ts` to `core/Character/DynamicCharacter.ts`, with the shared types in `core/Character/CharacterTypes.ts`.
- Breaking: `createDynamicCharacter` takes `DynamicCharacterOpts` (`id`, `name`, `visual`, `body`, `charData`, `input`, `onLocomotionStateChange`) and returns `{ character, data, intent, controlFns }`. `input` replaces `inputMappings`. The `sceneId` option and the `camera` return field are gone.
- Breaking: `CharacterObject`'s `keyControlIds`/`mouseControlIds` are `keyBindingIds`/`mouseBindingIds`, and `meshId` is `visualId`. `createCharacter` takes `visual` (an object with an entity, or its app id; was `meshOrMeshId`) and a required `kind`.
- Breaking: `controlFns` only write the intent. `move(direction)` and `rotate` lost their `delta` argument (the tick applies its sub-step delta).
- Breaking: `getCharacters()` returns an array (was an id → object map).
- Breaking: the character system registers itself (`Character.ts`, order -10 in `APP_PHYSICS_STEP`); `registerDynamicCharacterSystem` is gone.
- The move is a vector: speed holds through turns, with no lag between the velocity and the facing. Diagonals are normalized. Holding W+S cancels out and counts as no move input.
- Jump, run and crouch are applied by the tick, so a jump while moving in `WORKER_THREAD` mode is no longer overwritten by that sub-step's velocity write.
- `CharacterObject.data` is mutated in place: nested objects keep their identity, so re-read `data[key]`.
- The tick makes no `isMoving()` call each sub-step (an RPC per character in `WORKER_THREAD` mode), allocates nothing and doesn't round values. `isAwake` is derived from the velocities.
- The wall cast and the floor ray ignore sensors. The floor ray also runs while idle, with at most one in flight per character.
- `createCharacter` with an id already in use replaces the old character, with a warning.

**Removed**

- `deleteDynamicCharacter`.
- The config keys `_groundedRayMaxDistance`, `_tumblingAngDamping` (now `_tumblingAngularDamping`), `__wasOnMovingPlatformLastFrame` and `_roundVelocitiesScalingFactor`.

**Fixed**

- The capsule was the wrong size for anything but the default height and radius, so the collider didn't match the mesh.
- A second input-mapped character took over the first one's keys, and deleting either one removed both sets.
- `hasMoveInput` cleared when one move key was released while another was still held.
- The get-up torque never eased in after the first minute of a session.
- `CharacterObject.data` was always `{}`, so the debug tracker showed an empty list.
- Holding W+S ran the move twice per sub-step.
- A character could cross or stand on slopes steeper than `_maxWalkableAngle`. It now slides down them, pushed by `_slopeSlideSpeed`.
- A sensor in front of a wall cancelled the wall slide, the wall cast was off-centre while crouching, and all characters shared one wall-hit result.
- `controlFns` kept writing to the body after the character was deleted, which crashed Rapier in `MAIN_THREAD` mode.
- `ShapeCastHitAPI`'s docs had the witness and normal pairs the wrong way round: `witness1`/`normal1` are on the hit collider, in world space.

### Toolkit 1.2.0 (Crescent)

**Added**

- `SunShadowFit` (`ecs/effects/SunShadowFit.ts`, `registerSunShadowFitEffect`): a `SUN_SHADOW_FIT` component on a directional light fits its shadow camera to the main camera's view, up to `maxDistance`, plus `casterExtension` toward the sun. The fit is snapped to shadow texels and written only when it changes. Optional: `cameraEntityId`, `followEntityId`, `direction` (setting it turns the sun), `lightDistance` and `snapToTexels`. It skips non-directional lights and managed ones (like the sky box's sun), with a warning.
- `generateTerrain`'s `heightModifier(x, z, h)` option, applied per vertex so the mesh, `heights` and `getHeightAt` agree.

### App 1.4.0 (Preschooler)

**Added**

- `topDownTest` scene: a `WORLD_FIXED` character on a 300 × 300 ground with hills on the East side (`generateTerrain` with a `heightModifier`, a TRIMESH collider), 15 seeded static obstacles and 25 dynamic props. The follow camera looks from the South, so W moves straight up the screen, and `SunShadowFit` keeps the sun's shadow over the view.
- `characterVisual.ts` (`createCharacterVisual`): the capsule-and-beak character visual, used by the gym and the top-down scene.
- `SunShadowFit` is registered in `AppECSPlugins.ts`, and `AppECSRegistry.ts` has its component and `APP_RENDER_SYNC_ORDER.SHADOW_FIT` (-0.75: after the camera rigs, before frustum culling).

**Changed**

- The gym uses the new character API. The player is `TANK` on WASD. A second character, `arrowKeysChar`, is `CAMERA_RELATIVE` on the arrow keys, with Enter to jump. The dummy writes its intent from an `APP_PHYSICS_STEP` system.
- `AppECSPlugins.ts` no longer registers the character system (the engine does).

## 2026-09-29 — skybox-overhaul

### Engine 3.0.0 (Zenith)

**Added**

- Layered sky box definitions (`SkyBoxDef`): a `base` layer (`COLOR`, `EQUIRECTANGULAR` or `CUBE_TEXTURE`, with `rotate`, cube `flipY` and `intensity`) and an `env` layer (`backgroundRoughness`, `backgroundIntensity`, `environmentIntensity`, and the env bake's `size`, `dynamic`, `updateAngleDeg` and `maxUpdatesPerSec`). `preset` names a template (see Presets below).
- Procedural sky layers: `atmosphere` (Preetham scattering, a port of three's `SkyMesh`, with a sky-only `exposure`, `sunIntensity`, `twilightLength`, `nightSkyColor` and horizon/zenith tints), `suns[]` (disc and halo; `suns[0]` drives the atmosphere), `clouds` (SkyMesh's, with a tint and wind direction; they need the atmosphere) and `ground` (the lower hemisphere's colour, with a `height` and aerial perspective). A layer is on when its key is there, unless it says `enabled: false`.
- Sky boxes with a procedural layer composite every layer into one background node and bake their environment from it (`fromScene` into a fixed target, at most once per frame and never while a scene loads). `env.size` is 64, 128, 256 or 512; `env.dynamic: false` bakes only on activation, rebuilds and `bakeEnvironment()` (new). Texture-only and colour-only sky boxes are unchanged.
- Sky lights: `suns[i].light` adds a directional light that follows the sun (AUTO colour from the atmosphere, fading out below the horizon, shadows following the active camera snapped to shadow texels), and `ambientLight` a hemisphere or ambient light (off by default). Both are ordinary ECS lights.
- Day-night cycle (`dayNight`): the sun and moon are placed from a time of day (latitude, day of year, axial tilt, north offset), and the stars turn with the sky. It advances with the app loop by default (`timeSource: 'APP' | 'MAIN' | 'MANUAL'`) and is driven at runtime with `setTimeOfDay`/`getTimeOfDay`, `playDayNight`, `pauseDayNight`, `isDayNightPlaying`, `setDayNightSpeed`/`getDayNightSpeed` (negative runs it backwards) and `setDayNightCycleDuration`. `getSunDirection`, `getSunElevation`, `getMoonDirection` and `getMoonPhase` read the sky. Nothing is allocated per frame while it plays.
- While the cycle moves, the environment re-bakes once the sun or moon has turned `env.updateAngleDeg` (default 1°), at most `env.maxUpdatesPerSec` (default 1) times a second, and once more when it stops or reverses. `env.size` defaults to 128 with day-night.
- `moons[]`: a disc lit into its `phase` (fixed, or `phaseMode: 'CYCLE'` over `lunarCycleDays`), with earthshine, limb darkening and an optional `texture` (`DISC` or `EQUIRECTANGULAR`). `moons[i].light` is a managed directional light that only shines at night (scaled by the lit fraction; no shadow by default). Clouds get moonlight at night.
- `stars`: procedural stars (cube-projected, two grids, colour temperatures, twinkle), faded in through twilight by `fadeRange` and turning with the sky, with an optional `milkyWay` band. They cost nothing by day and are never baked.
- `isAppPlaying()` in `MainLoop.ts`: a cheap per-frame read of whether the app loop plays.
- Sky box debug tab: a Day-night folder (a runtime transport: play, ×−10…×100 speed buttons, a speed slider, a time scrub that pauses while dragged, and readouts; and the cycle's config), Moons (with a Light subfolder) and Stars folders, and a bakes-per-second readout.
- Managed entities: `CoreEntityOpts.managedBy` (code only) adds the new `MANAGED_BY` component. A managed light gets no saved debug overrides, and the Lights tab shows it read-only with a link to its manager's tab.
- `openDebuggerTab(id)`.
- Sky box debug tab: Suns (with a Light subfolder), Atmosphere, Clouds, Ground and Ambient light folders, and env bake settings and stats (bake count, CPU and GPU ms) in the Environment folder.
- Sky box API in `core/SkyBox/SkyBox.ts`: `registerSkyBox`, `setActiveSkyBox`, `getActiveSkyBox`, `updateSkyBox`, `activateSceneDefaultSkyBox`, `getSceneDefaultSkyBoxId`, `getActiveEnvironmentTexture` and `onSkyBoxChange`, plus the `SkyBoxDef` and `ActiveSkyBox` types.
- `gatherAppData` validates `*.skybox.json` files and inline scene sky boxes, keeps their `debugData` outside production, and deep-merges a scene's save entry into the definition.
- Sky box debug tab: Base and Environment folders (each with "Reset layer"), Copy JSON, and a clear button for the stored edits. Edits persist per scene and sky box, and only the values that differ from the definition are stored. Undo/redo covers every value, layer resets and the selection.
- `utils/deepMerge.ts`.
- `nebulae[]` (up to 8): procedural nebulae (`seed`, `direction`, `size`, `falloff`, `stretch`/`orientation`, 2–3 colour stops, `density`, `octaves`, `warp`, `dust` lanes, `brightness`). They are baked into one HalfFloat cube (`env.nebulaSize`: 256, 512 (default) or 1024 per face, no mipmaps) only when they change, at most once per 150 ms while a value is dragged, and the sky samples it with one lookup. They turn with the sky under day-night, and the env bake samples the same cube, so reflections take their colours. `starBoost` adds live stars inside a nebula.
- Up to 4 suns and 2 moons. An extra sun is a disc and glow with an `AUTO` or hex `color` and an optional managed light (no shadow by default); with day-night, `rotateWithSky` (default true) turns it with the sky from where it stands at the start time. `moons[1]` is a second orbit with its own phase. `suns[0]` still drives the atmosphere, the stars' fade, the clouds, the ground and the ambient light. `getSunDirection`, `getSunElevation`, `getMoonDirection` and `getMoonPhase` take an index (default 0). The debugger warns when more than two sky lights cast shadows.
- Presets: `preset: 'DAY_SKY' | 'NIGHT_SKY' | 'DAY_NIGHT' | 'SPACE'` (template version 1). The definition's keys merge over the template, and its arrays and `base` replace the template's. `gatherAppData` resolves JSON presets at build time, so the runtime only sees plain definitions; code definitions go through `resolveSkyBoxPreset`. `base` is optional with a preset. SPACE is a near-black base, dense always-visible stars, one sun with a light and two nebulae, with no atmosphere, ground or clouds.
- Sky box debug tab: a Nebulae folder (the nebula creator: a list with add at view, duplicate and remove; every param; "Randomize seed"; "Point at view"; and the nebula cube's size, memory and bake stats), Suns and Moons lists, and "Apply preset" (undoable, `skybox.applyPreset`). List edits are one undo step each.
- Scene-scoped debugger tabs: `createDebuggerTab({ sceneId })` removes the tab when that scene exits. If the tab was open, the drawer opens it again when the scene re-creates it, including after a reload.
- `hydrateDebuggerTabState` is exported, for values a module needs before its tab registers.
- Debug environment ball: a reflective sphere left of the axes gizmo that shows the environment map PBR materials sample (not the background) and turns with the active camera. Debug Tools → Helpers: "Show environment ball [F9]", "Show env ball in main camera" and "Env ball roughness" (persisted in `AEK_debugTools`).
- Debug shortcuts: F5 plays in production test mode, F6 toggles the main loop and F7 pauses or plays the app loop (both with a toast), F9 toggles the environment ball. With the main camera active, F9 and F10 on a hidden gizmo also turn on its "in main camera" option, and every gizmo toggle shows a toast. All of them can be rebound through `AppConfig.debugKeys`. Undo/redo toasts show the undo or redo icon.
- Production test mode keys: F5 stops production test mode, F6 toggles the main loop and F7 pauses or plays the app loop (no toasts). Each gives way to an app binding of the same key.
- `yieldToOtherBindings` on `KEY_UP`/`KEY_DOWN` key bindings: the binding doesn't fire for an event another binding also fires for.
- `registerPhysicsAPIDebugGUI()`: loads the Physics API debug module and restores its saved world settings before the first physics world is created (`InitEngine` calls it).

**Changed**

- Breaking: the sky box module moved from `core/SkyBox.ts` to `core/SkyBox/SkyBox.ts`.
- Breaking: `createSkyBox` takes a `SkyBoxDef`. The legacy `{ type, params }` props and JSON still work, with a dev warning. `isCurrent` becomes `isDefault`, `params.roughness` becomes `env.backgroundRoughness`, and `rotate` is in radians (the legacy cube rotate was a multiple of π).
- Sky boxes use three.js's standard orientation, and the background and the environment sample the same direction. Legacy definitions convert to `rotate: π` (equirect) or `flipY: true` (cube), which keeps their look. A cube's `flipY` now turns it upside down (a half turn about X).
- Activating a sky box sets `scene.environmentIntensity`, `backgroundIntensity` and `environmentRotation` from its definition; clearing resets them.
- The debug localStorage key `AEK_debugSkyBoxStates` is replaced by `AEK_debugSkyBox`. A saved background roughness is migrated once, and the old key is removed.
- `deepMerge` merges an index object (`{ "0": { ... } }`) into an array by index instead of replacing the array.
- The PostFX profiler's GPU timing moved to a shared debug timer (`_dbg__GPUTimer.ts`), also used by the env bake stats.
- `createPhysicsAPIDebugGUI()` is synchronous and needs `registerPhysicsAPIDebugGUI()` first.
- The axes gizmo shortcut moved from F8 to F10.
- Debug Tools → Helpers: the environment ball options come before the axes ones.

**Removed**

- `defaultRoughness`, `defaultSkyBoxState`, `SkyBoxState`, `SkyBoxProps` (now `LegacySkyBoxProps`), `LS_KEY_ALL_STATES`, `NO_SKYBOX_ID`, `extractSkyBoxParamsFromState`, `getEnvMapRoughnessBg`, `getCurSceneSkyBoxSceneId`, `deleteCurrentSkyBox` (use `setActiveSkyBox(null)`) and `applySkyBoxForScene`.
- `DebugToolsState.env` (the unused env ball state).
- `PROJECT_METADATA.mergeVersion` (deprecated in 2.1.0).

**Fixed**

- Materials got no view-dependent reflections and ignored their own roughness: the environment was sampled with the background's direction and roughness. Scenes can look more reflective; tune `env.environmentIntensity`.
- Cube sky boxes didn't light materials at all, and equirect lighting came in upside down relative to the background.
- A non-HDR equirect's `path` was dropped, a roughness of `0` was lost, and an empty `colorSpace` wasn't treated as unset.
- An equirect's orientation depended on where its texture loaded (main thread or assets worker).
- Sky box selections in the debugger could race each other.
- `setCurrentScene` didn't reset the root scene's `environmentNode`.
- `createRigidBody` ignored `gravityScale: 0` (a falsy check), so such a body still fell.
- The Physics API tab's saved world settings (gravity, timestep, solver iterations) were pushed into the running world after the start scene had loaded, overwriting what the scene set. They are now restored before the first world is created, and every world is built from them.
- While the drawer showed a fallback tab, its scroll position overwrote the saved tab's.

### Toolkit 1.1.0 (Crescent)

**Added**

- `generateAsteroid` (`geometry/generateAsteroid.ts`): a seeded, semi-low-poly asteroid (`radius`, `detail` 1–10, `seed`, `shape`, `noise` lumps, `craters` with raised rims, `flatShading`). It returns the `geometry`, the `hullVertices` for a `CONVEXHULL` collider, `volume`, `hullVolume` (what Rapier's mass uses) and `boundingRadius`.
- The `asteroid` material (`materials/asteroid.material.json` + `asteroid.tsl.ts`): procedural object-space mottling, pits and speckles, with roughness and a derivative bump from the same field. Every input sits on `colorNode`, so one `seed` override changes the colour, roughness and bump together.
- `MutualGravity` (`ecs/effects/MutualGravity.ts`): N-body gravity between dynamic bodies, in `APP_PHYSICS_STEP`, with Plummer softening, each pair computed once and no per-step allocations. `registerMutualGravityEffect`, `addGravityBody`/`removeGravityBody`/`clearGravityBodies`/`getGravityBodies` and `setMutualGravityConfig`/`getMutualGravityConfig`/`getMutualGravityDefaults` (`G`, `softening`, `enabled`). Its bodies are cleared on scene exit. It isn't deterministic in `WORKER_THREAD` mode.

### App 1.3.0 (Preschooler)

**Added**

- `skyShowcase` scene: a `dayNight` sky box with every procedural layer on a 5-minute day, rows of metal and dielectric PBR spheres (roughness 0 to 1) and a stone gate that casts long shadows. It is the verification scene for the sky box plans.
- `scene01_v2`: a row of PBR spheres (roughness 0 to 1) that show the environment.
- `space` scene: the `space` sky box (SPACE, plus a small blue second sun) around four procedural asteroids with zero world gravity and mutual gravity. Three start on loose orbits round the biggest, and one falls in to hit it. In the debug env, the scene's own "Space demo" tab has the gravity's G, softening and on/off, "Reset asteroids", "Spawn asteroid", the group's energy and an asteroid list.
- The showcase also lists the `space` sky box, to check the nebula reflections on its spheres.
- `MutualGravity` is registered in `AppECSPlugins.ts`.

**Changed**

- The app's sky boxes (`scene01`, `scene01_v2`, the gym and `basicSkybox.skybox.json`) use layered definitions, with the same look.
- `dayNight.skybox.json` uses `"preset": "DAY_NIGHT"` plus its own cycle, with the same look.
- The gym's environment intensity is set in its sky box definitions (`env.environmentIntensity`) instead of by hand on scene enter and exit.

## 2026-09-30 — add-on-screen-tools-disabler-settings

### Engine 2.3.0 (Morning)

**Added**

- "Disable on-screen tools" (debug only): the on-screen tool groups, the debug drawer handle, the stats panel and the axes gizmo become click-through, so clicks and drags reach the canvas under them. All but the gizmo (which renders into the canvas) are dimmed to a configurable opacity. Keyboard shortcuts and the drawer contents keep working. It is applied at boot, before the first scene load, and set with a body class (`aekOnScreenToolsDisabled`) and a CSS variable (`--aek-disabled-on-screen-tools-opacity`), so rebuilt tool groups keep it.
- The `§` debug shortcut (`sc-toggle-on-screen-tools`, rebindable through `AppConfig.debugKeys`) toggles it and shows a toast naming the key that was pressed. It also matches with modifiers held, for layouts where § is a shifted key.
- `toggleOnScreenToolsDisabled()` (`debug/DebugToolsManager.ts`).
- The axes gizmo slot has a global class, `aekAxesGizmoSlot`.

**Changed**

- The Debug Tools Controls tab's "Production test mode" folder is now "On-screen tools". It holds "Disable on-screen tools [§]", "Disabled on-screen tools opacity" and the existing prod test switch.
- `DebugToolsState.prodTestMode` is replaced by `onScreenTools` (`showOnScreenToolsInProdTest`, `disableOnScreenTools`, `disabledOnScreenToolsOpacity`). A saved `prodTestMode` is migrated on load and written back right away.
- The on-screen tool groups, the drawer handle and the stats panel fade their opacity changes (0.2s).

## 2026-09-29 — ray-casting-refactoring

### Engine 2.2.0 (Morning)

**Added**

- `castRayFromDirection(objects, origin, direction, opts?)` (what `castRayFromPoints` used to do).
- `RayCastOpts` (exported): `near`, `far`, `target`, `perIntersect` (return `false` to stop), `countInStats` and `debug` (`RayDebugOpts`: `id`, plus optional `color`, `inactiveColor`, `width`, `holdMs`, `fadeOutMs`, `showHit` and `depthTest`).
- Opt-in screen-space dashes for thick lines: `LineProps.dash` (`{ dashPx, gapPx }`, fixed at creation, FAT backend only) and `LineObject.setDash(dashPx, gapPx)`, a uniform write where a gap of 0 draws solid. The pattern restarts at each segment. Lines without `dash` keep their exact shader.
- Ray cast controls tab: a "Three.js rays" folder with the helper settings (show, show rays without an id, force kind colors, active and inactive color, width, hold, fade out, dash and gap), applied live and persisted.
- Ray cast statistics API, now in the core (it used to live in the debug module): `setRayCastStatsEnabled`, `isRayCastStatsEnabled`, `getRayCastStats` (one reused snapshot object, rays per rendered frame) and `resetRayCastStats`.
- `IntervalCounterStats` (`utils/stats/`): an allocation-free per-frame counter with rolling min/max and average windows.
- `createPercentagePie()`: a pie CMP updated with `set(percentage)`.
- Physics query statistics (`PhysicsAPI.ts`): `setPhysicsRayStatsEnabled`, `isPhysicsRayStatsEnabled`, `getPhysicsRayStats` (one reused `PhysicsRayStats` object: rays and shape casts per rendered frame, counted when issued, plus `pendingQueries` waiting for a worker reply) and `resetPhysicsRayStats`, reset on every scene enter.
- Physics queries can be drawn as `'PHYSICS'` ray helpers (debug only, `setPhysicsRayHelpersEnabled`). The line appears when the query is issued and gets its hit when the result arrives, about a frame later in `WORKER_THREAD` mode.
- An optional trailing `debug?: RayDebugOpts` parameter on `castRay`, `castRayAndGetNormal`, `intersectionsWithRay` and `castShape` (and their `*Sync` forms). It stays on the main thread.
- `PhysicsQueryObserver`/`PhysicsQueryKind`, and `EngineAPIType.setQueryObserver`, which a physics backend must now implement. With nothing observing, a query costs one null check, and the worker's engine never observes.
- Ray cast controls tab: a "Physics rays" folder with the same helper settings, an "Enable physics ray statistics" toggle and the physics stats (rays, shape casts and, in `WORKER_THREAD` mode, pending queries), persisted.
- `RAY_STATS_WINDOWS`: the stats windows shared by the Three.js and physics ray counters.
- A "Respect depth" helper setting per ray kind (Three.js and physics folders, persisted): geometry in front then hides the helpers. Off by default, so they still draw on top. A ray's `debug.depthTest` overrides it.
- `dynamicCharacter`'s floor ray and wall cast carry helper ids (`char_floor_<entityId>`, `char_wall_<entityId>`).
- Ray tester windows (debug only), opened from two new buttons in the Ray cast controls tab. The Three.js ray tester casts through `castRayFromDirection`/`castRayFromPoints` into the current scene or one entity. The physics ray tester runs `castRay`, `castRayAndGetNormal` or `intersectionsWithRay` in either `workerTarget` mode, with filter flags, filter groups and exclude-by-app-id. Each has three aim modes (origin + direction, origin → target point, active camera forward), its own helper settings, and a Fire button. The results list each hit's distance or toi, point, normal and entity/app id, with copy as JSON. The origin and target point can be picked with a click on the scene.
- The ray testers' params are saved per scene (`AEK_debugRayTester`), with a clear button in each window and one for both in the Ray cast controls tab. The tester state holds a list of rays, ready for multi-ray patterns.
- `RAY_TESTER_ID_PREFIX` (`'rayTester_'`): physics queries whose `debug.id` starts with it are drawn but not counted in the physics ray statistics.

**Changed**

- `castRayFromPoints(objects, from, to)` is point-to-point: `to` is the end point (it was treated as a direction), and hits beyond it are left out.
- `near`/`far` (and the deprecated `startLength`/`endLength`) are applied by the raycaster, so they filter the returned hits too, not only the per-hit callback. A passed `target` array is cleared before it is filled.
- The ray cast statistics count rays per rendered frame (frames skipped by the FPS limiter are no longer counted as frames).
- The Ray cast controls tab updates its statistics from cached elements five times a second while the tab is visible, instead of re-rendering the block every frame. The max and min rows are merged into one "max / min" row per window.
- `PercentagePieHtml` renders one element (a CSS conic gradient) instead of seven nested ones.
- `castRayFromAngle` no longer allocates a vector per cast.
- The Ray cast controls tab's Three.js stats heading is "Three.js ray stats:".
- `filterPredicate` on the physics query methods is documented as not supported yet (it was always ignored).
- Ray debug helpers are pooled thick lines with a hit cross, drawn by a shared renderer (`core/Debug/_dbg__RayHelpers.ts`, ready for physics rays). A helper stays solid for a hold time after its last cast, then turns dashed in the inactive color and fades out, instead of being disposed the first frame its ray isn't cast. Rays without an id can be shown too. `deleteAllRayHelpers()` hides and recycles them. The persisted `showAllRayDebugHelpers` toggle is migrated to the new `threeShow` setting.

**Deprecated**

- The `RayCastOpts` aliases `helperId`, `helperColor`, `startLength`, `endLength`, `perIntersectFn` and `optionalTargetArr` (use `debug.id`, `debug.color`, `near`, `far`, `perIntersect` and `target`).
- `PercentagePieHtml`'s `size` option (it has no effect).

**Removed**

- `countRayCastFrames` and `cleanUpRayHelpers` (internal plumbing).

**Fixed**

- `PercentagePieHtml` joined extra classes with a comma.
- The ray helper cleanup ran once per ECS world each frame instead of once.
- `castRayAndGetNormal` in `WORKER_THREAD` mode returned the raw worker message instead of the hit, with an unmapped collider id, and dropped the exclude filters. **Behavior change:** the character controller now really evaluates ground slopes in worker mode (its floor normal was always read as flat) and its floor ray no longer hits its own body.
- `intersectionsWithRay` threw in `WORKER_THREAD` mode (the worker replied with `hits` instead of `intersections`), and it ignored a callback returning `false`.
- The physics `pendingQueries` count was lowered by the results of queries it never counted (eg. issued while the statistics were off, with the physics helpers on).

## 2026-09-29 — spatial-index-system-visualizer

### Engine 2.1.0 (Morning)

**Added**

- Spatial index visualizer in the "Spatial index" debugger tab: wireframe boxes for the occupied grid cells and, separately, for the oversized tier's members, each with its own checkbox and color picker (persisted).
- `SpatialGrid.cellSize`, `SpatialGrid.getOccupiedCellBoundsInto(out)` and `SpatialGrid.getOversizedBoundsInto(out)`.
- `PROJECT_METADATA.toolkit`, the `x-toolkit` meta tag, the `%TOOLKIT_*%` HTML placeholders and a toolkit line in the boot console log.
- Optional `engineVersion`/`toolkitVersion`/`appVersion` in save data `__meta`. `gatherAppData` warns when an applied save entry was stamped under another major version.

**Changed**

- The version checksum also covers the toolkit version and codename, and no longer includes the merge version (existing checksum values change once).
- The boot log no longer writes versions into `#engineVersion`/`#appVersion` DOM elements (they no longer exist).

**Deprecated**

- `PROJECT_METADATA.mergeVersion`, to be removed in the next major version. The `x-merge-version` meta tag is removed.

**Fixed**

- The physics debug wireframe of heightfield colliders was drawn with the wrong layout (sheared and transposed).
- A heightfield collider's column count was read from `nrows`, which broke non-square heightfields.

### Toolkit 1.0.0 (Crescent)

**Added**

- Versioned on its own for the first time (`toolkit_metadata` in `package.json`; it was previously covered by the engine version). Its codenames follow the moon's phases.
- Included in the `yarn docs` TypeDoc output.

### Project

**Added**

- `yarn checkVersions` checks the versioning rules; `--against main` also checks each part's bump. The Stop hook runs the base check whenever `package.json` changes.
- `yarn tagRelease` tags a merge on `main` per part (`engine-v…`, `toolkit-v…`, `app-v…`).
- This changelog.
