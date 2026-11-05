Status: in progress | Phases 0-5 implemented
Category: Refactoring, API
Related: `docs/issues/physics-unused-rapier-enums.md` and `docs/issues/physics-ccd-substeps-setting.md` (closed by Phase 3), `hub/pages/documentation/migration/engine-6.md` and `CHANGELOG.md`'s "Unreleased — engine-6" entry (what this major finishes)

# Engine 6.0.0 (Sunset)

One branch that releases engine 6.0.0 "Sunset" and toolkit 3.0.0 "Gibbous": it removes every API
deprecated "until engine 6.0.0" (and the toolkit's "until toolkit 3.0.0"), lands the breaking
reshapes the Stage C reviews deferred, ships a codemod that migrates an app made from the template,
and finishes the Hub's "Engine 5 → 6" migration section and the unreleased changelog entry that
p806-p808 started on `main`. The provenance tags ("p615 D3") name the plan that decided an item;
each item here says what to do without it.

**Paths** are relative to `src/_engine/` unless they say otherwise.

## Goal

- Every `@deprecated` that names engine 6.0.0 or toolkit 3.0.0 is gone, with its replacement in
  the migration page.
- The public API follows the coding standards' options-object rule, with one written exception
  for the ECS world (D2), so later minors don't need another round of positional reshapes.
- The tiers are an opt-in feature (`physicsTiers()`), so an app without them doesn't download them.
- `npx tsx devTools/migrate/migrateEngine6.ts src` migrates the template app (and an app made from
  it) mechanically, and reports what needs a person.
- The merge into `main` is the release: versions bumped, the changelog entry dated, the tags made.

## 1. Grounding (checked 2026-11-04, on `a0b15403`)

### Where 6.0.0 stands

- **No `engine-6` integration branch exists.** The debugger migration (p806), the stats and
  profiler graphs (p807) and the game UI components (p808) merged straight into `main` (PRs
  #73-#75), so `main` already carries unreleased 6.0.0 work, the tab types' breaking changes
  included, while `package.json` still says engine 5.14.0 (Golden Hour), toolkit 2.2.1 (Half
  Moon), app 1.18.0. This plan's branch is `p622_engine-6-major`, made from `main` at `a0b15403`.
- **`CHANGELOG.md`'s top entry is "## Unreleased — engine-6"**: an intro, "### Engine 6.0.0
  (unreleased)" (the tab types' 5.x → 6.0 table under **Breaking**), "### Toolkit (unreleased: a
  minor at the 6.0.0 release)" (p808's `registerWorldAnchorSync` and the rig's orbit), "### App
  (unreleased: a minor at the 6.0.0 release)" and "### Project". p809's Project-only entry
  (2026-11-04) sits under it. The Hub's homepage "What's new" shows the latest entry.
- **The Hub's migration guide** has the section: `hub/pages/documentation/migration/engine-6.md`
  (89 lines: "The debugger on the UI kit" with the same table, "What reads differently", "New in
  a tab") under a `::: note In progress`; `migration/intro.md` says the section is in progress and
  that the 5.x deprecations go next. `engine-5.md` (286 lines, a subsection per change, "Before
  you start" first) is the model.
- **Until this branch merges:** an engine branch merges into `main` with its changelog sections
  added to the unreleased entry and no version bump, and its `yarn checkVersions --against main`
  fails on purpose (p807 D2). A Project-only branch gets a dated entry of its own (p809).

### The deprecations

`grep -rn "@deprecated" src/_engine src/toolkit`: 65 tags, every one naming engine 6.0.0 or
toolkit 3.0.0 (some on the tag's next line), except `CharacterObject.mouseBindingIds`' "See
`keyBindingIds`" (removed with it here). By area:

- **Kernel** (p612, p613): `CoreComponentType` (`kernel/ecs/ECSRegistry.ts`; `ComponentType` is
  the same object) leaves `aekasha`; `SceneHooks.sceneDeleted` (`kernel/scene/SceneHooks.ts`, no
  replacement); `Group.ts`' `deleteGeometries`, `deleteMaterials`, `deleteTextures` (never read:
  `deleteMeshes` releases them); the scene load options' `updateLoaderStatusFn`
  (`kernel/scene/SceneLoader.ts`, never read: the loader's own from `createSceneLoader` is used);
  `registerOnAllSceneEnterings` (`kernel/scene/Scene.ts`, → `registerOnAllSceneEnters`);
  `TextureSync.ts`' `loadTextures` and `loadTexture` (→ `loadTextureAsync`);
  `AppConfig.draggableWindows` (`kernel/config/Config.ts`, engine 5.8.0: the content is a module
  map, `registerDraggableWindow` / `registerDraggableWindowKind`, and the key is only read as a
  fallback in `ui/overlays/windows/DraggableWindow.ts`' `buildContent`).
- **Characters** (p610 D5; `features/character/CLAUDE.md` lists them): `DynamicCharacterOpts.input`
  and `charData`, `DynamicCharacter.data` (`controllers/dynamic/DynamicCharacter.ts`; replaced by
  `brain`, `config` and the controller's `state` / `config.values` / `internal`), the
  `CharacterData` type (`DynamicCharacterData.ts`), `CharacterInputScheme`,
  `CharacterInputHoldMode` (→ `PlayerBrainHoldMode`), `CharacterInputOpts` and
  `getInputBrainSpec`'s mapping (`CharacterInputSchemes.ts`), `CreateCharacterOpts.controls` and
  `data` (`Character.ts`), and in `CharacterTypes.ts` `CharacterObject.kind`, `keyBindingIds`,
  `mouseBindingIds`, `data` and `initialConfig` (→ `config.initial`), `CharacterBodyKindField`'s
  `kind` (→ `bodyKind`), `CharacterCastRecord.resolvedAt` (→ `resolvedAtStep`), and
  `HUMANOID_CAPSULE`'s `kind` (`CharacterBodyPlans.ts`). No debug tool reads the flat `data` view
  (re-check before removing it).
- **Physics:** `getPhysGameTime()` (`features/physics/PhysicsStepping.ts`, → the step index times
  the fixed timestep) with `PhysicsWallClock.ts` and its allow-list entry in `eslint.config.js`
  (the known-violations block after `SIMULATION_FILES`).
- **Sky box** (p615): the pre-3.0 `{ type, params }` shape: `features/skybox/LegacySkyBox.ts` with
  its entry names (`LegacySkyBoxProps`, `LegacySkyBoxParams`, `isLegacySkyBoxProps`,
  `LEGACY_SKYBOX_WARNING`, `fromLegacySkyBoxProps`), `createSkyBox`'s legacy overload (`SkyBox.ts`
  line ~497), the schema's two conversions (`SkyBoxAssetSchema`'s preprocess and the `__saveData`
  entries' `fromLegacySkyBoxOverrides`, `SkyBoxSchema.ts`), the gatherer's `warnOnLegacySkyBox`
  (`devTools/gather/registries.ts`) and the debug tab's one-time `AEK_debugSkyBoxStates` migration
  (`migrateLegacySkyBoxLS`, `features/skybox/debug/_dbg__SkyBoxShared.ts`). Nothing in the template
  uses the shape (no JSON, no `createSkyBox` call; checked 2026-10-18).
- **The debug entry** (p618, engine 5.9.0): on `aekasha/debug`, the dev files protocol's
  `DEV_FILES_ROUTE_BASE`, `DEV_FILES_TOKEN_HEADER`, `DEV_FILES_TOKEN_META`,
  `DEV_FILES_HASH_HEADER`, `AEK_GATHER_EVENT`, `DevFilesStageBody`, `DevFilesSaveDataWrite`,
  `DevFilesErrorBody` (`debug/DevFilesProtocol.ts`) and the test bridge's `TestBridgeProbeResult`,
  `TestBridgeSceneReady`, `TestBridgeSnapshot` (`debug/TestBridge.ts`) leave the entry and become
  `@internal` (`devTools/` imports them by path already). The protocol types the client API names
  stay public (`DevFilesStatusBody`, `DevFilesCommitBody`, `DevFilesConflicts`,
  `DevFilesSchemaIssues`, `DevFilesErrorCode`, `DevFilesWriteStatus`, `DevFilesSaveData`,
  `DevDataGatheredEvent`). `createDebuggerTab(def, opts?)`'s second parameter and `DebugGUIOpts`
  (`debug/DebuggerGUI.ts`): nothing passes it; removed, the drawer's button stays in the middle.
- **The UI kit** (p617, p803, p804, all `aekasha/ui`): `AddToastResponse.timeout`
  (`ui/overlays/Toaster.ts`, → `removeToast`); `CMPSettings.doCheckIsInDom` (`ui/core/CMPTypes.ts`,
  stored, never read); the `T`-prefixed aliases at the end of `ui/core/CMPTypes.ts` (`TCMP` →
  `CMPHandle`, `TProps` → `CMPProps`, `TSettings` → `CMPSettings`, `TListener`, `TListenerCache`,
  `TListenerCreator`, `TStyle`, `TAttr`, `TClassAction`, `TAnimChain`, `TAnimState`, each → its
  `CMP` name) and `TDropDown` (→ `DropDown`, `ui/forms/DropDown.ts`); `getSvgIcon`'s `size: 'small'`
  (→ `'sm'`, `ui/core/icons/SvgIcon.ts`) and the `uiIcon` / `smallIcon` classes it writes (no
  style reads them); the string form of `kbd` on `ButtonProps`, `SplitButtonProps`,
  `MenuActionItem` and `MenuCheckboxItem` (→ a `Kbd` from `createKbd`), with
  `ui/components/ShortcutHint.ts`' string path (its `import('./Kbd')`).
- **Toolkit** (p620 D5): `createSeededRandom` on `aekasha/toolkit/geometry`
  (`toolkit/geometry/SeededRandom.ts`, a copy; import it from `aekasha`) with its layout rule in
  `devTools/layout/layoutRules.ts`; `PhysicsParams` (→ `MovingPlatformPhysicsParams`,
  `toolkit/ecs/gameplay/movingPlatform/MovingPlatform.ts`); `DeleteMeshOptions` and
  `MovingPlatformOptions.deleteMeshOptions` (never read).
- **Dev tools naming what goes:** `devTools/hub/api/entries.ts`' `ACCEPTED_LEAKS`
  (`PhysicsProbeReport`, `LegacySkyBoxParams`; both leak only through names removed here, so the map
  ends empty), `devTools/engineImports.test.ts`' `LegacySkyBox.ts` entry, and the nested
  `CLAUDE.md` lists of what waits for 6.0.0 (`ui/` "Waiting for engine 6.0.0", `features/character/`
  "Deprecated, removed in engine 6.0.0", `features/skybox/` the legacy shape line,
  `features/physics/` the tiers line, `debug/` the public API line).
- **Already on `main`, nothing left in code: the tab types' break** (p806 D3). The table is in the
  changelog entry and the migration page; this branch only releases it. One behaviour the page
  doesn't list yet: `onChange` also fires on a field's `setValue` (`source: 'api'`).

### The reshapes' call sites

Counted with grep on 2026-11-04 (engine counts exclude the declaration and comments):

| API | Today | Outside the engine | In the engine |
| --- | --- | --- | --- |
| `createPhysicsEntity` | `(colliderParams, rigidBodyParams?, target?, entityOpts?, ecsWorld?)` | 31 app, 2 toolkit, 3 Hub, 1 readme | 13 (`Character.ts`, `import/ImportPhysics.ts`, tests), 2 `@example`s |
| `createMeshEntity` / `createCameraEntity` / `createGroupEntity` / `createLightEntity` | `(props, entityOpts?, ecsWorld?)` | 99 / 6 / 1 / 5, 4 of them with entity options, none with a world | 5 / 10 / 4 / 8 |
| `createEntity` (the helper, not `world.createEntity`) | `(opts?, ecsWorld?)` | few | ~10 |
| `createLineEntity` | `(props, entityOpts?, ecsWorld?)` | 0 | 0 |
| `getScene` | `(id, silent?, throwOnError?)` | 0 with flags | 2 |
| `createSceneLoader` | `(sceneLoader, isCurrent?)` | `src/index.ts`, readme, 1 Hub | 3 |
| `setActiveSkyBox` | `(id, sceneId?)` | 0 | 18 (6 with a scene id) |
| `getSunDirection` / `getMoonDirection` / `getSunElevation` / `getMoonPhase` | `(out, i = 0)` / `(i = 0)` | 0 | 2 / 0 / 1 / 2 |
| `joinSpatialDomain` / `leaveSpatialDomain` / `isInSpatialDomain` | `(entityId, domainId, world?)` | 1 Hub / 0 / 0 | their module |
| `refreshSpatialRadius` | `(entityId, world?)` | 0 | 3 (the light debug modules) |
| pool `spawn` / `despawn` | `(world, placements, entityOpts?)` / `(world, entityId)` | 6 app (lodShowcase, largeWorld, the LOD example), `Foliage.ts`' `@example` | their module |
| `setLightEnabled` / `setLightFrustumCullingEnabled` / `setLightObjectCullingEnabled` | `(lightId, enabled, world)` | 1 / 0 / 0 | 5 / 3 / 3 |
| `WorldAPI.setMaxCcdSubstepsSync` | `(substeps)` | 0 | 4 files (types, `WorldProxyAPI`, `EngineWorldProxyAPI`, `PhysicsSwitchWorld`) |

The optional trailing `world` is everywhere on the public API: the audit (`api.json`'s entries
against the declarations) finds it on 37 entry functions; 27 keep it (D2), eg. `getPosition(entityId, world?)`,
`setTransform(entityId, transform, world?)`, `hasComponent`, `deleteEntity`, the `get*ByAppId`
getters, `cameraLookAtPoint`, `setMeshLod`, `refreshLodBounds`, `getLineForEntity`,
`bindLineToEntity`, `requestPhysicsTier`, `getPhysicsTier`, `setPhysicsTierPolicy`,
`setPhysicsTierPolicyMember`, `validateSpatialGridQuery`, and the toolkit's `addGravityBody`. D2
keeps them.

### The physics leftovers

- The five mirrored Rapier enums (`docs/issues/physics-unused-rapier-enums.md`): `ActiveHooks`,
  `ActiveCollisionTypes`, `ActiveEvents`, `CoefficientCombineRule` (`types/PhysicsColliderTypes.ts`)
  and `SolverFlags` with `PhysicsHooks` (`types/PhysicsEventTypes.ts`). Correction to the issue
  file: `SolverFlags` and `PhysicsHooks` **are** on `aekasha/physics`
  (`features/physics/index.ts` lines 15-16); the other four aren't on an entry.
  `WorldAPI.step(eventQueue?, hooks?)` (`types/PhysicsWorldTypes.ts` line 96) names `PhysicsHooks`.
  `EngineRapier.test.ts` pins all five to Rapier 0.19.3.
- `setMaxCcdSubstepsSync` (`docs/issues/physics-ccd-substeps-setting.md`): a one-way setter named
  like a sync getter, so `OmitSync` drops it from the worker proxy's type; and no setting: every
  world starts at Rapier's 1, a value set is lost at the next scene load.

### The tiers (p611 D10, measured 2026-10-14, still so 2026-11-04)

`physics()` (`features/physics/PhysicsFeature.ts`) installs the tiers and the tier policy
(`installPhysicsTiers`, `installPhysicsTierPolicy`, and the exit hook's
`deleteScenePhysicsTierPolicies`) whether the app uses them or not. A scratch build without those
three calls: the initial load 389.0 → **384.8 KiB gzip (−4.2 KiB, −1.1%)**: `PhysicsTiers.ts`
(2.4 kB before minification) and `PhysicsTierPolicy.ts` (3.7 kB) left the main chunk, and the
`physicsTiers` scene's lazy chunk grew 0.7 KiB. Not counted, and kept: the tiers' parts of the
facade and the worker (`detach` / `reattachRigidBody`, `readBodyPositionsAtStep` in
`PhysicsBodies.ts`, `addPhysicsStepGate` in `PhysicsStepping.ts` (public on its own), the `REMOVED`
body in `PhysicsEntity.ts`' `getPhysicsEntityBody`, `isBodyJointed` in `PhysicsJoints.ts`). Only
`src/app/scenes/physicsTiers/physicsTiers.ts` and the physics feature page use the tiers' API.

### The codemod's model

`devTools/layout/migrateToEntries.ts` (108 lines, engine 5.0.0's): a CLI over `entryImports.ts`
(the logic without the file system, tested in `entryImports.test.ts`), using the `typescript`
compiler API (5.4.5) and `importGraph.ts`' `resolveSpecifier`; Prettier-formats what it rewrites;
on any error lists them all and writes nothing; `--check` writes nothing and exits 1 when a module
would change. `devTools/` has no layout rules, so a new `devTools/migrate/` folder needs none.

## 2. Design

### D1 — One release branch, `main` held for engine work

`p622_engine-6-major` lands everything below and merges into `main` as engine 6.0.0 "Sunset"
(project 6.0.0), toolkit 3.0.0 "Gibbous" and the app's next minor. While it's open, no other branch
that changes the engine or the toolkit merges into `main` (a Project-only branch may: it gets its
own dated entry, as p809's). If one has to, this branch merges `main` in and adds that branch's
changelog sections to the entry. Each phase is a commit (or a section per commit) that leaves the
tree compiling, lint-clean and green, so the PR can be reviewed by commit.

### D2 — The ECS world parameter (the options-object rule's one exception)

The coding standards ask for an options object "for a function with more than two parameters or
any optional one", and p613 kept the kernel's positional `world` by decision without writing it
down. 37 entry functions take an optional trailing `world`; reshaping them all would churn
`getPosition(entityId)` and its kind for nothing. So the rule gets its exception, written into
`hub/pages/documentation/coding-standards/intro.md`'s Public API:

- **A required `world` comes first** (`registerSpatialDomain(world, opts)`,
  `getPhysicsEntityBody(world, entityId)`, a system's `(world, dt)`), and **an optional `world`
  comes last** and defaults to the current world. Either way it doesn't count toward the two
  parameters.
- **A trailing optional `world` is the only optional positional parameter allowed.** Everything
  else optional goes in an options object, and a function that would need two optional trailing
  parameters takes them both in it (the world as `world`).

What changes under it (D3-D6): the entity creators and `createPhysicsEntity` (two optional
trailing parameters), `getScene`, `createSceneLoader` and the sky box functions (an optional that
isn't a world), the spatial membership functions and the light setters (a world in the wrong
place), and `getLightTargetId(world, lightId)` (D4) and `getLodWorldSphere(world, entityId, lod,
out)` (D5), a required world last, which an audit of the entries' signatures found in Phase 5
(only these two). What stays: the other 27 functions with a trailing optional world, among them
`bindLineToEntity(line, entityId, world?)` and the toolkit's `addGravityBody(entityId, mass,
world?)`, which the stub listed for a reshape (both fit the rule as they are), and
`createRawEntity(world?)`.

### D3 — `createPhysicsEntity(props, opts?)`

```ts
createPhysicsEntity(
  { colliders: { type: 'BALL', restitution: 0.6 }, body: { rigidType: 'DYNAMIC', translation }, target: ballId },
  { id: 'ball', tierPolicy: true, world }
);
```

- `PhysicsEntityProps = { colliders: ColliderParams | ColliderParams[]; body?: RigidBodyParams;
  target?: THREE.Object3D | number }` (the names say what the five-parameter version's JSDoc said:
  colliders attached to the body when there is one, no body makes the colliders alone, `target` an
  `Object3D` or an existing entity id).
- `opts?: PhysicsEntityOpts & { world?: ECSWorld }` (`PhysicsEntityOpts` is `CoreEntityOpts` with
  `tierPolicy`; for a `target` id only `tierPolicy` applies, as today).
- The same shape as the creators (D4): props, then the entity's options with the world.
- `createPhysicsEntityNow` and the pending-creates tracking are unchanged inside.

### D4 — The creators, the scene functions

- `CreateEntityOpts = CoreEntityOpts & { world?: ECSWorld }`, a new public type on `aekasha`
  (`CoreEntityOpts` has no `world` key: `id`, `appId`, `disabled`, `persistent`,
  `doNotAddToScene`, `userData`, `debugData`, `managedBy`). `createMeshEntity(props, opts?)`,
  `createCameraEntity`, `createGroupEntity`, `createLightEntity`, `createLineEntity` and the
  `createEntity(opts?)` helper take it. The scene JSONs' `entityOpts` are unchanged (the schema is
  `CoreEntityOptsSchema`; `world` is code only).
- `getScene(id, opts?: { silent?: boolean; throwOnError?: boolean })` and
  `createSceneLoader(sceneLoader, opts?: { isCurrent?: boolean })`.
- The light setters take the world first: `setLightEnabled(world, lightId, enabled)`,
  `setLightFrustumCullingEnabled(world, entityId, enabled)`,
  `setLightObjectCullingEnabled(world, lightId, enabled)`.

### D5 — The spatial membership and the pools

- `joinSpatialDomain(world, entityId, domainId)`, `leaveSpatialDomain(world, entityId, domainId)`,
  `isInSpatialDomain(world, entityId, domainId)` and `refreshSpatialRadius(world, entityId)`: the
  world required and first, like the rest of `features/spatial/SpatialIndexSystem.ts`.
- An instanced pool's `spawn(placements, entityOpts?)` and `despawn(entityId)`
  (`features/instancing/InstancedMeshPool.ts`, both `createInstancedMeshPool`'s and
  `createInstancedLodPool`'s) use the pool's own world (`opts.world`, which owns the mesh): an
  instance spawned into another world outlived the mesh's scene there and kept a slot in a disposed
  mesh. `entityOpts` is an options object already, so it may stay positional.

### D6 — The sky box functions

`setActiveSkyBox(id, opts?: { sceneId?: string })`, `getSunDirection(out, opts?: SkyBodyOpts)`,
`getMoonDirection(out, opts?)`, `getSunElevation(opts?)` and `getMoonPhase(opts?)`, with
`SkyBodyOpts = { index?: number }` (the sun or moon index, 0 by default) on `aekasha/skybox`. The
internal `*Of` helpers (`getMoonPhaseOf(def, state, isDayNight, index)` in `SkyTime.ts`) and
`registerSkyBox(def, sceneId?)` (`@internal`) aren't public and stay.

### D7 — The physics leftovers

- **The Rapier enums go:** `ActiveHooks`, `ActiveCollisionTypes`, `ActiveEvents`,
  `CoefficientCombineRule`, `SolverFlags`, `PhysicsHooks` and `WorldAPI.step`'s `hooks` parameter,
  from the types, the entry, the backend's mirrors and `EngineRapier.test.ts`' pairs. Wiring
  `activeCollisionTypes` or contact hooks into `ColliderParams` later is a minor (an addition) and a
  plan of its own; the issue file is closed with that note.
- **`setMaxCcdSubsteps(substeps)`** replaces `setMaxCcdSubstepsSync` on `WorldAPI`, its proxies and
  the worker's switch (the worker proxy's type then has it), and
  **`AppConfig.physics.maxCcdSubsteps`** (default 1, Rapier's) goes to every new world like the
  other world settings (`PhysicsState.ts`' defaults, the backend's world create on both targets,
  each scene load's `resetPhysicsWorld`), with a field in the Physics API debug tab saved like the
  other world settings. Both issue files are closed (`Status: fixed | p622`).

### D8 — `physicsTiers()`, a feature of its own

- `physicsTiers()` (`features/physics/PhysicsTiersFeature.ts`, on `aekasha/physics`,
  `requires: ['physics']`) installs what `physics()` installs for them today:
  `installPhysicsTiers`, `installPhysicsTierPolicy` and an exit hook running
  `deleteScenePhysicsTierPolicies`. `physics()` no longer names them, so a build without
  `physicsTiers()` drops both modules (a runtime option, `physics({ tiers: false })`, would save
  nothing; installing on first use would register systems mid-run, which once gave a build another
  system order than the dev server).
- Without it, `requestPhysicsTier`, `setPhysicsTierPolicy` and `setPhysicsTierPolicyMember` throw,
  and `createPhysicsEntity`'s `tierPolicy: true` warns once, each naming the feature, as
  `createLines` does for `lines()` (`features/lines/Lines.ts` line 81). The getters
  (`getPhysicsTier`, `getPhysicsTierPolicy`, `getPhysicsTierPolicyStatus`) answer as "no tiers"
  (`ACTIVE`, `null`).
- Listed right after `physics()` in the template's `features`, every system order tie stays:
  physics' own systems are in other stages (`APP_POST_PHYSICS`, `APP_RENDER_SYNC`, `LATE_MAIN`),
  the characters' at other orders (-10 and -5 against 100 and 110), and the policy's `APP_LOGIC`
  system still registers before every later feature's and the app's. The scene runner's system
  order baseline and hashes check it.
- **One order changes:** exit hooks run in reverse install order, so the scene's policies are
  deleted before the physics entities (today after). Phase 4 checks that deleting a policy doesn't
  read its members' bodies.
- The scenes' feature manifests can't name it (tiers are code only, like physics); an app that
  uses tiers adds `physicsTiers()` to `features`. Ten features: the root `CLAUDE.md`'s Bootstrap
  flow, `kernel/init/CLAUDE.md`, `features/physics/CLAUDE.md`'s Simulation tiers, the readme and
  the physics feature page say so.

### D9 — Toolkit 3.0.0

- The removals in Grounding (`createSeededRandom`'s copy and its layout rule, `PhysicsParams`,
  `DeleteMeshOptions`, `deleteMeshOptions`).
- The component keys become `as const` objects, the app's and the engine's pattern
  (`src/AppECSRegistry.ts`, `ComponentType` in `kernel/ecs/ECSCoreComponents.ts`):
  `HoverToolComponentType` (`ecs/effects/HoverEffect.ts`), `FollowToolComponentType`
  (`FollowTool.ts`), `SunShadowFitComponentType` (`SunShadowFit.ts`) and p808's
  `WorldAnchorComponentType` (`WorldAnchorSync.ts`). The string values stay (they key stores and
  saved data). A caller that names a member as a type (`HoverToolComponentType.HOVER` in a type
  position) writes `typeof HoverToolComponentType.HOVER`; the `declare module 'aekasha'` blocks'
  computed keys work as they are.
- `addGravityBody` stays (D2).

### D10 — The codemod (`devTools/migrate/`)

`npx tsx devTools/migrate/migrateEngine6.ts [--check] [--report] <folder | file>...`, run after the
app took the new engine (the migration page's order: the template's engine, toolkit and tools
first, then the section). Files:

- `migrateEngine6.ts`: the CLI, on `migrateToEntries.ts`' model (targets, Prettier, `--check`, a
  module with an error left as it was and every error listed, exit codes 0 / 1 / 2).
- `engine6Rules.ts`: the rules as data (one table, each with the plan decision it comes from).
- `engine6.ts`: the logic without the file system, on an in-memory `ts.Program` built from the
  target repo's `tsconfig.json` (the checker resolves each callee through the aliases and relative
  imports alike, so the same call rules migrate the engine's own calls).
- `engine6.test.ts`: fixtures as strings in a virtual program (as `examples.ts` does), one per
  rule, each also run twice (idempotent: a migrated call is left alone).

The rule kinds:

1. **Renames by import:** a name imported from an entry, renamed in the import and every reference
   in the module (merged when the new name is already imported): `CoreComponentType` →
   `ComponentType`, `registerOnAllSceneEnterings` → `registerOnAllSceneEnters`,
   `CharacterInputHoldMode` → `PlayerBrainHoldMode`, the `T*` aliases → their `CMP*` names,
   `TDropDown` → `DropDown`, the toolkit's `PhysicsParams` → `MovingPlatformPhysicsParams`.
2. **Moves by import:** `createSeededRandom` from `aekasha/toolkit/geometry` → `aekasha`.
3. **Call reshapes, by the callee's declaration** (the checker's symbol → its declaration's file
   and name, so a local function of the same name is never touched), each with an "old shape"
   test so a new-shaped call is skipped: `createPhysicsEntity` (D3), the creators and
   `createEntity` (D4: a third argument, or a second that isn't an object literal of entity
   options, folds into one object: `{ ...entityOpts, world }`, an object literal merged in place),
   `getScene`, `createSceneLoader`, the light setters, the spatial membership functions and
   `refreshSpatialRadius` (a world first; an omitted optional world becomes `getECSWorld()` with its
   import), the pools' `spawn` / `despawn` (first argument typed `ECSWorld` dropped), the sky box
   functions (D6), `WorldAPI.setMaxCcdSubstepsSync` → `setMaxCcdSubsteps`, `getSvgIcon`'s
   `size: 'small'` → `'sm'`, and the toolkit's component keys used as types (`typeof` added).
   An `undefined` placeholder argument is dropped; an argument with side effects keeps its
   evaluation order (the object literal lists them in the old order).
4. **Reports** (`--report`, and always on stderr): what needs a person, found by imported name or
   by the checker: the character fields and options (`data`, `charData`, `input`, `controls`,
   `kind`, `keyBindingIds`, `mouseBindingIds`, `initialConfig`, `resolvedAt`), `loadTexture` /
   `loadTextures` (async now), a legacy sky box object or name, `createDebuggerTab`'s second
   argument, a string `kbd`, `AddToastResponse.timeout`, `doCheckIsInDom`,
   `AppConfig.draggableWindows`, `SceneHooks.sceneDeleted`, the group delete flags, the load
   options' `updateLoaderStatusFn`, `getPhysGameTime`, a removed debug-entry name, a removed Rapier
   enum, `deleteMeshOptions`, and a use of the tiers' API in a project whose `InitEngine` call
   doesn't list `physicsTiers()`. Each line: file, line, the name, the migration page's anchor.

The Hub's Markdown code blocks aren't migrated (the snippets come from code, which is); `yarn
hub:build` and the `@example` check find what's left. The migration page's "Before you start"
gives the command; `devTools/migrate/CLAUDE.md` (a new nested file, a line in the root map)
documents it, and the rules table names the page's anchors.

### D11 — The migration page and the changelog

- `hub/pages/documentation/migration/engine-6.md`: "Before you start" (take the template's engine,
  toolkit and tools; run the codemod; `yarn build` and `yarn lint` show the rest), then a
  subsection per change, each with its before / after and whether the codemod does it: the
  debugger on the UI kit (as today, plus the `setValue` line), `physicsTiers()`, the entity
  creators and `createPhysicsEntity`, the scene functions, the spatial and pool functions, the
  light setters, the sky box functions, the physics leftovers, the removed deprecations by area
  (a table: name → replacement), the debug entry's names, the UI kit's, the toolkit 3.0.0
  changes. The `::: note In progress` goes; `migration/intro.md`'s paragraph is rewritten.
- `CHANGELOG.md`: the "Unreleased — engine-6" entry becomes `## <date> — p622_engine-6-major`,
  its intro rewritten (what the major holds, no "unreleased"), its headings "### Engine 6.0.0
  (Sunset)", "### Toolkit 3.0.0 (Gibbous)", "### App 1.19.0 (Preschooler)", "### Project", and
  this plan's removals and reshapes added as **Breaking**, each with its replacement.

## 3. Phases

Every phase: the Stop hook's lint, `tsc`, `tsc -p hub`, `yarn test` and the docs ratchet; `yarn
verify:scenes` with unchanged hashes (the baselines recorded on `main` first, Phase 0); `yarn
verify:baselines` (`--update` where a phase changes the API on purpose, its diff read first); `yarn
hub:build` after a Hub change. A phase that changes a subsystem updates its nested `CLAUDE.md`
and its feature page in the same commit.

### Phase 0 — Baselines — done

- Before the first change (the branch is still `main`'s `a0b15403`): `yarn verify:scenes
  --update` and `yarn sbp` (the report Phase 4 compares against).
- Run the reshapes' grep again (Grounding's table) and correct the table if `main` moved.

As built (2026-11-04, on `9ec145d4`: `a0b15403` plus this plan's edit, no code change):

- `yarn verify:scenes --update` (macOS, WebGPU): 114 runs recorded, 0 failed, in
  `.cache/verify/scenes/webgpu/` (local, per machine: a later phase run on another machine records
  its own on `main` first).
- `yarn sbp`: all 29 budgets within; initial **387.0 kB gzip** (1416.9 kB minified; the plan's 389.0
  was 2026-10-14's), `_engine/features/physics` 23.5 kB initial / 31.5 kB lazy. The report is kept
  as `.cache/p622/sbp-phase0-report.json` (`.cache/sbp/report.json` is overwritten per run).
- The table holds: `main` hasn't moved past `a0b15403`, and a re-count matches it within grep's
  noise (65 `@deprecated` tags; the 3 more hits are `CLAUDE.md` mentions).

### Phase 1 — The codemod's frame and the renames (D10 kinds 1-2) — done

- **Section 1:** `devTools/migrate/engine6.ts` (the program, the module walk, the rule runner, the
  error and report collection), `migrateEngine6.ts` (the CLI), `engine6Rules.ts` with the rename
  and move rules, `engine6.test.ts` with their fixtures. `devTools/engineImports.test.ts` and the
  root `CLAUDE.md`'s Dev tools rule apply (the codemod imports nothing of the engine).

  As built (section 1):

  - `engine6.ts` takes a `ts.Program` (`createMigrationProgram`: a base compiler host with
    virtual texts over it, and `directoryExists` answering for their folders, which the module
    resolution checks) and returns `{ changed, errors, reports }`, each finding `{ file, line,
    message, anchor? }`. One pass per module: the imports are modelled per declaration and a
    touched one is written again whole (so two rules on one import statement never collide), the
    references are renamed through the checker's symbols (`getSymbolAtLocation`, a shorthand
    property's value symbol, a local export's target), and `resolveName` checks each renamed
    reference first (shadowed, or a name the module declares: an error, the module left as it
    was). Two overlapping edits are an error for now: **the first call rule that nests (Phase 5's
    `createMeshEntity(…, getScene(…))` kind) adds a second pass** over the rewritten text, the
    runner then taking a program factory instead of a program.
  - Kinds 1-2 also cover a namespace import's `ns.Old` and an `import('entry').Old` type (a move
    through a namespace import is an error) and `export { Old } from` (the module's exported name
    stays: `export { New as Old } from`). A dynamic `import()` of an entry isn't followed. A value
    import left with only inline types becomes `import type`.
  - **Reports' lines are the module as it was read.** Phase 2 section 5, the first report rules,
    decides whether a writing run reports on its output instead (a second program over the
    formatted text, so the lines match the written file).
  - The CLI: targets anywhere in the repo, `src/generated/` skipped; `--report` writes nothing and
    prints only the reports; exits 0, 1 (`--check` found modules to migrate) or 2 (an error, a bad
    target or flag). About 3 s over `src` and `hub/_assets/ts` (962 modules).
  - The rules' anchors are the slugs of the headings D11 plans: `removed-deprecations`,
    `the-ui-kit-s-names`, `toolkit-3-0-0` (unique across the migration page, which concatenates
    `intro.md`, `engine-6.md` and `engine-5.md`). **Phase 8 writes those headings and adds a test
    that every rule's anchor is a heading of `engine-6.md`.**
  - `engine6.test.ts`: stand-in entries in engine 6's shape (the old names gone, as an app sees
    them) in a virtual `noLib` program; one generated fixture per rule plus the behaviours, each
    run twice (the second run changes nothing); and a check that every rule's target is exported
    by the repo's entry today (read with `importGraph.ts`' `parseModuleSource`).
  - Provenance: the `T` aliases and `TDropDown` are p803 (D3), not p617.
- **Section 2:** run it over `src` and `hub/_assets/ts` (`--check` first): the renames have
  replacements already, so whatever it changes is a remaining use of a deprecated name. The nested
  `devTools/migrate/CLAUDE.md`, the root map line and the command in the root's Commands.

  As built (section 2): `--check` and the run over `src hub/_assets/ts` changed none of the 962
  modules (a grep agrees: no deprecated name is left outside the engine). The nested file's one
  section, "Engine 6 codemod", is covered by the migration page's `aek:covers` (its first; the
  page's tags got `migrateEngine6`), and the readme's Migration guide line names the codemod.

### Phase 2 — The deprecated removals (engine) — done

Each section removes its names, their uses in the engine's own code, their entry lines and their
nested `CLAUDE.md` mentions, then `yarn verify:baselines --update` for `api.json` / `docs.json`.

- **Section 1, kernel and physics:** `CoreComponentType`, `sceneDeleted`, the group delete flags,
  `updateLoaderStatusFn`, `registerOnAllSceneEnterings`, `loadTextures` / `loadTexture`,
  `AppConfig.draggableWindows` (with `Config.ts`' `CMPHandle` and `DraggableWindow` type imports,
  the last kernel → ui imports of `Config.ts`; `DraggableWindow.ts` stops reading `getConfig()`),
  `getPhysGameTime` with `PhysicsWallClock.ts` and its `eslint.config.js` allow-list entry.

  As built (section 1):

  - **`ComponentType` is an `as const` object now** (`ECSCoreComponents.ts`, D9's pattern), and
    the enum `CoreComponentType` is gone from `ECSRegistry.ts`: kept as an `@internal` enum, the
    Hub's API check warned that `ComponentType` (public) named it. The string values are the
    same; the data map's keys are those literals. An app that names an engine key as a type
    (`ComponentType.TRANSFORM` in a type position) now writes `typeof ComponentType.TRANSFORM`
    (the engine and the template already did): **Phase 7's `typeof` rule covers `ComponentType`
    too**, and D11's page says so.
  - `TextureSync.ts` went whole, with its test: `createTexture` was its own; `Texture.ts`' helpers
    it used all have other callers.
  - With `getPhysGameTime` went its pause bookkeeping: `setPhysicsPauseTime` and **`PhysicsState`'s
    `pausedTime` and `pauseDurationTotal`** (a public type on `aekasha/physics`, read through
    `getPhysicsState()`): nothing else read them. Section 5's report rules and D11's removals
    table name them too. The `eslint.config.js` known-violations block is a comment now (empty).
  - `DraggableWindow.ts`' `buildContent` reads only the registered content;
    `DraggableWindow.test.ts`' config fallback test became a registered-content one.
  - `yarn verify:baselines`: the bundle's size unchanged (nothing in the template called these;
    one module fewer, `ECSRegistry.ts` being types only), the API diff only the removed names;
    recorded with `--update`. `yarn hub:build` without the leak warning. `yarn verify:scenes`
    not run for this section (no simulation change: the pause bookkeeping only fed
    `getPhysGameTime`); section 2's run covers it.
- **Section 2, characters:** the list in Grounding; `getInputBrainSpec`'s mapping goes with
  `CharacterInputScheme`. Re-check that no debug tool reads the flat `data` view first. The
  character scenes' hashes (`thirdPersonGymScene`, the character examples) must not move.

  As built (section 2):

  - Re-checked first: nothing read the flat `data` view; the Characters tab's info rows read
    `keyBindingIds` / `mouseBindingIds` (removed with them) and `Casts.ts` wrote `resolvedAt`.
  - **`CharacterInputSchemes.ts` went whole**, so `aekasha/character` also lost the mapping
    types only the `input` option used: `CharacterActionMappings`, `TankInputMappings`,
    `WorldFixedInputMappings`, `CameraRelativeInputMappings` and `CharacterInputCommonOpts`
    (not deprecated themselves; D11's table and section 5's reports name them with
    `CharacterInputOpts`). `CharacterInputScheme` wasn't on the entry.
  - `CharacterBodyKindField` stays, as `{ bodyKind: string }`; `getBodyKind` (`@internal`, the
    `bodyKind ?? kind` fallback) went, its callers read `bodyKind`.
  - `createCharacter` no longer imports the keyboard and mouse bindings; its delete hook disposes
    the brain and the controller only.
  - `yarn verify:scenes` (all scenes, after sections 1-2): 113 of 114 passed with every probe
    hash and the gym's character paths (`26f43551`) unchanged; the gym's `workerMsg` snapshot
    differed once (the follow camera a little off: characters in the worker targets aren't
    deterministic, p428) and passed twice on its own. The bundle baseline's main chunk −1.0 kB gzip
    (`aekasha/character` −0.7, the input bindings it no longer imports −0.2), the controller's
    chunk −0.2. Baselines recorded; `yarn hub:build` clean.
- **Section 3, sky box:** the legacy shape everywhere it's listed, the gatherer's
  `warnOnLegacySkyBox`, the debug tab's LS migration, `ACCEPTED_LEAKS`' `LegacySkyBoxParams` and
  `engineImports.test.ts`' entry. A legacy-shaped JSON is then a schema error naming its field
  (check one by hand in a scratch copy, not in `src/`).

  As built (section 3):

  - `SkyBoxAssetSchema` is `SkyBoxDefSchema` now (the name kept: the schemas entry, the gatherer
    and `.schemas/skyBox.schema.json` use it; the JSON Schema didn't change). The gatherer's scene
    reader lost its `prepare` (it only warned); the sky box reader's only sets the id default.
  - Checked by hand (a scratch script through `SkyBoxAssetSchema`): a `{ id, type, params }` sky
    box fails with `base: A sky box needs a base, unless it has a preset`. **A pre-p111 flat
    `__saveData` entry (`{ colorSpace, roughness }`) parses and is ignored**: the overrides schema
    strips unknown keys, so nothing applies. None in the template (checked every `*.skybox.json`
    and inline scene sky box); D11's page says to move such an entry's values by hand.
  - `createSkyBox(def: SkyBoxDef)` is a plain `async function` (no overloads); `type: ''`'s "no sky
    box" is `setActiveSkyBox(null)`. `layers/Base.ts`' empty-string colour space stays unset.
  - The debug tab's `AEK_debugSkyBoxStates` key is no longer read or removed: a browser that still
    has it keeps a dead key.
  - The main chunk −0.6 kB gzip (`features/skybox`, one module fewer); baselines recorded, `yarn
    hub:build` clean (no stale `ACCEPTED_LEAKS` key), `yarn verify:scenes` over the sky scenes
    (`skyShowcase`, `space`, `largeWorld`, `exampleHubHero`; 17 runs) unchanged.
- **Section 4, debug entry and UI kit:** the debug entry's names leave `debug/index.ts` (become
  `@internal`), `createDebuggerTab`'s second parameter and `DebugGUIOpts`; the UI kit's list;
  `ACCEPTED_LEAKS`' `PhysicsProbeReport` (the map is then empty: keep the mechanism, empty). The
  component library page and `yarn verify:ui` for the `kbd` and icon changes.

  As built (section 4):

  - The protocol's and the bridge's names keep their declarations, now `@internal` with the
    summary naming their users; the entry drops them. `ACCEPTED_LEAKS` is `{}`.
  - With `DebugGUIOpts` went the drawer's toggler placement: `_dbg__DrawerShell.ts`'
    `togglerPlace` / `setTogglerPlace`, the `TOP` / `MIDDLE` / `BOTTOM` classes,
    `DebuggerGUI.module.scss`' two rules and `AxesGizmo.module.scss`' rule that cleared a `TOP`
    toggler. The toggler stays in the middle.
  - `ShortcutHint.ts` takes a Kbd only (no `import('./Kbd')`, no stop-before-load case);
    `findMenuHintHandles` takes every item's `kbd`. The command palette's `kbd` stays text (p805:
    its rows are made on every query), so the UI kit example's two string `kbd`s are palette rows.
  - The Hub: the UI kit core guide's string `kbd` sentence, the public icons text's `'small'` line
    and the dev component library's icon and button notes.
  - `yarn verify:ui`: the full run failed 14 states on this machine's local baselines, recorded
    2026-11-03 before p806-p808's demos (boxes 77-99 px taller, a row they didn't have). With the
    changes stashed, the ten pieces involved (`window`, `menu`, `divider`, `icons`, `button`,
    `buttonGroup`, `dropDown`, `monitor`, `emptyState`, `settingsMenu`) were recorded at HEAD
    (`--update`), then the branch passed them all: no rendering change.
  - Bundle: the main chunk unchanged; the uiKit embed's `Kbd.js` chunk is gone (only the string
    path's `import('./Kbd')` split it off) and its game chunk, which makes Kbds, +0.8 kB gzip.
- **Section 5:** the codemod's report rules for everything removed here, with fixtures. Done when
  `grep -rn "6\.0\.0" src/_engine | grep -i deprecated` is empty.

  As built (section 5):

  - Three rule kinds in `engine6Rules.ts`, applied by `engine6.ts` from the checker's symbols:
    `removedImport` (an import, `export … from` or `ns.Name` of a name the entry dropped),
    `removedMember` (a member an entry's type lost: `x.member`, a destructuring, or an object
    literal whose contextual type is the type or has it in a union / intersection; `onlyString`
    for the `kbd` that became a Kbd) and `callArg` (an entry function's argument: any, an object
    literal's named properties, or a string literal, rewritten when the rule has `rewrite`).
    The entries' exports come from the first module that imports each entry (`createEntryExports`).
  - **`getSvgIcon`'s `'small'` is rewritten to `'sm'`** (a `callArg` with `rewrite`), not
    reported: D10 lists it under kind 3, and the literal swap needed no more machinery.
  - The rules (each with its anchor): the sync texture loaders; `SceneHooks.sceneDeleted`,
    `LoadSceneProps.updateLoaderStatusFn`, `AppConfig.draggableWindows`, `PhysicsState`'s
    `pausedTime` / `pauseDurationTotal`; `removeFromGroupEntity`'s three flags; the character
    imports (the input types, `CharacterData`) and members (`input`, `controls`, `charData`,
    `data`, `kind`, the binding ids, `initialConfig`, `resolvedAt`) on their eight types; the
    legacy sky box's imports and `createSkyBox({ type, params })`; the debug entry's names and
    `createDebuggerTab`'s second argument; `AddToastResponse.timeout`, `doCheckIsInDom` and a
    string `kbd`. The debug entry's anchor is `the-debug-entry-s-names` (**Phase 8 writes that
    heading** with the other two). `getPhysGameTime` has no rule: it was never on an entry.
  - **Reports' lines (Phase 1's open question):** `--check` and `--report` give the module as
    read; a writing run runs the rules again on a second program over the rewritten modules'
    formatted text and reports those modules from it, so the lines match the written files (an
    end-to-end run on a scratch module: line 6 read, line 5 written after an import merge). A
    module's reports are sorted by line. The CLI takes about 7 s over `src hub/_assets/ts` (957
    modules; Phase 1's 3 s, the member walk's contextual types the most of it).
  - `engine6.test.ts`: the stand-in entries grew the types the rules name (engine 6's shapes)
    and a `GLOBALS` file (a global `Array`, without which `noLib` gives an array literal's
    elements no contextual type: a menu's items); generated fixtures per removed name and per
    removed member (read and written), behaviour tests (a namespace import, calls,
    destructuring, a union of item types, a type that only shares a member's name, a Kbd
    handle, the call arguments, the rewrite and a local function of the same name), and the
    repo check (removed names not exported; member types and callees exported). **The check
    that a rename's old name is gone from its entry waits for Phase 7**: the toolkit still
    exports `PhysicsParams`. 47 tests.
  - Over the template: `--check src hub/_assets/ts` migrates nothing and reports nothing. No
    `@deprecated` is left in `src/_engine` (the grep's two hits are `CLAUDE.md` lines saying
    what 6.0.0 removed); `src/toolkit` keeps its four for Phase 7.
  - Later phases add their report rules to this frame: the Rapier enums (Phase 3), the tiers'
    API without `physicsTiers()` (Phase 4), `deleteMeshOptions` and the toolkit's and the
    engine's component keys named as types (`typeof`, Phase 7: a `removedMember`-like walk over
    type positions, or a rewrite).

### Phase 3 — Physics: `createPhysicsEntity`, the setter, the enums (D3, D7) — done

- **Section 1:** `createPhysicsEntity(props, opts?)` and its types on `aekasha/physics`; the codemod
  rule and fixtures; run the codemod over `src` (engine, toolkit, app); the two `@example`s, the
  readme's example and the Hub's three blocks by hand; `features/physics/CLAUDE.md`.

  As built (section 1):

  - `PhysicsEntityProps` (`colliders`, `body`, `target`, each key documented) is new on
    `aekasha/physics`; `opts` is `PhysicsEntityOpts & { world?: ECSWorld }` written inline
    (Phase 5's `CreateEntityOpts` may name it). `createPhysicsEntity` takes `world` out before
    the entity's options reach `world.createEntity`; `createPhysicsEntityNow` is unchanged.
  - **The codemod's kind 3 frame** (`ReshapeRule` in `engine6Rules.ts`, `reshapeCall` in
    `engine6.ts`): `params` names the old arguments, `args` the new ones (an old argument, or an
    object of `{ key, param }` / `{ spread }`). A call is in the old shape when it has more than
    `newArgCount` arguments, or when its argument at `newHas.index` has no `newHas.member`; an
    `any` there and a spread argument are reported. An `undefined` (and an empty literal to
    spread) is dropped, its comments carried to the next argument kept (`physicsTest.ts`' sensor
    comment). Comments go with their argument; an object of one spread is that argument as it
    was. **No second pass:** the reshaped argument list is written last, innermost first, with
    the edits inside its arguments applied to their text (`resolveReshapes`), so a rename or a
    reshaped call inside an argument isn't an overlap (Phase 1's note about nested calls is
    settled). A test checks that each rule's `args` name its `params` once, in order.
    **Phases 5-6 extend it:** the light setters and the spatial functions move the world first
    (reordered arguments: allow it only for arguments without side effects, or report the
    others), an omitted world becomes `getECSWorld()` with its import (nothing in the frame adds
    an import yet), and `getScene` / `createSceneLoader` / the sky box functions need another
    old-shape test (a boolean or number argument where the options object goes now).
  - The run over `src hub/_assets/ts`: 16 modules (the engine's `Character.ts`,
    `ImportPhysics.ts` and two tests, the toolkit's `MovingPlatform.ts`, 11 app modules), nothing
    reported; a second `--check` finds nothing. By hand: four `@example`s, not two
    (`PhysicsEntity.ts`, `PhysicsTiers.ts`, `PhysicsTierPolicy.ts`, the toolkit's
    `MutualGravity.ts`), `MovingPlatform.test.ts`' `vi.mock` factory, the readme, the code
    blocks page's three blocks (`documentation/intro.md` only imports the name) and the physics
    guide's `target` line.
  - `yarn verify:baselines`: the API diff is `PhysicsEntityProps` alone, the bundles unchanged
    (recorded). `yarn hub:build` clean except the search index's size warning (483 KiB gzipped,
    over 450; one name added, so not from this section). `yarn verify:scenes`: 114 passed, every
    hash unchanged (`space`'s worker hashes differ from `MAIN_THREAD`'s, as its `unstableHash`
    says).
- **Section 2:** `setMaxCcdSubsteps` and `AppConfig.physics.maxCcdSubsteps` through
  `PhysicsState.ts`, both targets' world create, `resetPhysicsWorld` and the Physics API tab
  (the tab's saved value applied before the first world, like the others). A unit test that a
  second world gets the configured value on both targets' paths that run in Node; the scene runner
  with the default 1 keeps the hashes.

  As built (section 2):

  - `maxCcdSubsteps` goes where `internalPgsIterations` goes: `PhysicsState` (default 1),
    `AppConfig.physics`, `createPhysicsWorld`'s options, the backend contract's and the
    `CREATE_WORLD` message's `opts`, `RapierWorld.ts`' `init` and `createWorld`. **0 is a value**
    (CCD off), so it's passed with `??` and set when it isn't `undefined` (the other settings'
    `||` / truthy checks would drop it). The worker proxy's copy starts from the state (Rapier's
    1 was hard-coded there).
  - The Physics API tab: a "Max CCD substeps (0 turns CCD off)" field after the PGS iterations,
    in `LIVE_PERSIST_KEYS` (saved under `PHYSICS_LS_KEY`, restored before the first world by
    `_hydratePhysicsLiveSettings`) and on the undo history with the solver settings
    (`_dbg__PhysicsSettingsUndo.ts`).
  - Tests: one per target (`PhysicsFacade.test.ts`, `PhysicsWorkerRequests.test.ts`, the config
    at 3): the first world, the setter, a `resetPhysicsWorld` world back at the setting, and 0
    reaching the world; on the worker target both the proxy's copy and the worker's answer.
  - **The codemod: a fifth rule kind, `renamedMember`** (`x.old` on a value of an entry's type →
    the new name; kind 3 in D10's terms), for `WorldAPI.setMaxCcdSubstepsSync`. Its anchor is
    `the-physics-leftovers` (**Phase 8 writes that heading** with the others). The run changes
    nothing (no caller in the template). 55 tests.
  - The Hub's physics guide's Stepping section names the world settings and that a value set on
    the running world lasts until the next scene load; `features/physics/CLAUDE.md` has a bullet
    on the settings' path. The issue file is closed in section 3, with the enums' (D7).
  - `yarn verify:baselines` unchanged (`api.json` lists exports, not members); `yarn
    hub:build` clean but the search index's size warning. `yarn verify:scenes`: every hash
    unchanged; the `debugger` shots of the Physics API tab (`testDebugScene`,
    `thirdPersonGymScene`) differ by the new row and were recorded (`--only … --config debugger
    --update`); the gym's `workerMsg` snapshot failed once and passed twice alone (p428, as in
    Phase 2). The `testDebugScene` `stats.panels` shot is intermittent: its graphs' bars aren't
    masked, so a recording run can catch another bar (failed once after the recording, passed the
    next run).
- **Section 3:** the enums, `PhysicsHooks` and `step`'s `hooks` out of the types, the entry, the
  backend and `EngineRapier.test.ts`; the report rule; both issue files closed.

  As built (section 3):

  - Gone: the four collider enums (`PhysicsColliderTypes.ts`), `SolverFlags` and `PhysicsHooks`
    (`PhysicsEventTypes.ts`; the two entry names), and `hooks` from `WorldAPI.step`, the backend
    contract's `step` and both world proxies. The backend's own uses of Rapier's
    `ActiveEvents` / `ActiveHooks` / `ActiveCollisionTypes` / `CoefficientCombineRule`
    (`RapierColliders.ts`, a detached body's colliders in `RapierBodies.ts` / `RapierState.ts`)
    are Rapier's types and stay. With `hooks` gone, the Rapier backend's two `step`s take no
    parameter (the contract's `eventQueue` was never read; the lint flagged it once last).
  - The report rule `removed:physicsHooks` (`removedImport`: `PhysicsHooks`, `SolverFlags`; the
    other four were on no entry). A call of `world.step(queue, hooks)` isn't reported: it's a
    type error, and the hooks' import is. 56 tests; the run over the template finds nothing.
  - Both issue files `Status: fixed | 2026-11-05, p622`, each with a "The fix" section; the
    enums' keeps option 1 (`activeCollisionTypes`, contact hooks both targets can run) as a
    later minor's plan.
  - `yarn verify:baselines`: the six removals and the entry's two names (recorded), the bundles
    unchanged; `yarn hub:build` clean but the search index's size warning (484 KiB).
    `yarn verify:scenes`: 113 of 114, every hash unchanged; the gym's `workerMsg` failed on its
    snapshot (the follow camera elsewhere: a character drifted, p428) and passed three times
    alone. **It failed in two of Phase 3's three full runs and in Phase 2's, never alone:**
    `unstableHash` skips the gym's worker hashes but not their snapshots, so a full run's timing
    fails it. Not filed yet (p428 owns the cause); an issue file or a snapshot skip for those two
    configurations would stop it reading as a regression.

### Phase 4 — `physicsTiers()` (D8) — done

- **Section 1:** `PhysicsTiersFeature.ts`, its entry line, `physics()` without the tiers' installs
  and exit hook, the "needs `physicsTiers()`" errors and warning, the template's `features` (right
  after `physics()`), the codemod's report rule. Read the exit order change: a policy's delete
  must not need its members' bodies.

  As built (section 1):

  - `physicsTiers()` (`PhysicsTiersFeature.ts`, id **`physicstiers`**: the ids are the factory
    names lowercased, `skybox`, `postfx`; `requires: ['physics']`) installs the tiers, the policy
    and its own exit hook (`physicsTiersSceneHooks`: `deleteScenePhysicsTierPolicies`), and sets
    **`facade.tiersInstalled`** (`PhysicsState.ts`, the facade's leaf), which
    `createPhysicsEntity` reads without importing either module. `physics()`' exit is
    `deleteAllPhysicsEntities()` alone. `ENGINE_FEATURE_FACTORIES` has the new id;
    `FeatureFactories.test.ts` no longer assumes one feature per entry (every entry has one or
    more).
  - Without it: `requestPhysicsTier`, `setPhysicsTierPolicy` (also with `null`) and
    `setPhysicsTierPolicyMember` throw through `assertPhysicsTiersInstalled` (logged, naming the
    feature and where to list it); `tierPolicy: true` warns once in every build and adds no
    component. The getters need no check: with nothing installed no entity gets
    `PHYSICS_SIM_TIER` and no policy is set, so `getPhysicsTier` answers **`FULL`** (D8's
    "`ACTIVE`" was a slip) and the policy getters `null`. The internal freeze functions (the
    probe's, the debug tab's) stay unguarded.
  - **The exit order, read:** `deletePolicy` drops the policy's measurements
    (`releaseMeasurement`: the step gate released, the positions dropped) and reads no member's
    body or component, so deleting the policies before the physics entities changes nothing.
  - The codemod: no new rule kind. `RemovedImportRule` and `CallArgRule` take an optional
    `withoutFeature` (an entry's factory): such a rule reports only when no module of the program
    (declarations, libraries and `*.test.ts` aside) calls it (`createFeatureCalls`, by the
    checker). The rules: `requires:physicsTiers` (the three setters' imports) and
    `requires:physicsTiersOption` (`createPhysicsEntity`'s second argument's `tierPolicy`), anchor
    **`physicstiers`** (a "`physicsTiers()`" heading: **Phase 8 writes it**). The repo check
    expects a `withoutFeature` rule's names and feature to be exported. 59 tests; `--check src
    hub/_assets/ts` (958 modules) migrates and reports nothing, `src/index.ts` listing the
    feature; `--report src/app/scenes/physicsTiers` alone gives both reports (its program has no
    boot module: the CLI's program is the targets and their imports, `devTools/migrate/CLAUDE.md`
    says so).
- **Section 2:** `yarn verify:scenes` (all scenes, the system order baseline unchanged, the
  `physicsTiers` scene's hashes unchanged), `yarn sbp` against Phase 0's report: the initial load
  about 4 KiB smaller for an app without the feature (measure with a scratch `features` list
  without it; the template keeps it, so its own number moves only by the lazy chunk). Record the
  numbers under the phase. `kernel/init/CLAUDE.md`, the physics `CLAUDE.md`, the root's Bootstrap
  flow (ten features), the readme's Features and the physics feature page.

  As built (section 2, 2026-11-05, on `ea610dc3`):

  - `yarn verify:scenes` (macOS, WebGPU): 114 passed, 0 failed, the system orders and every hash
    unchanged (`physicsTiers` `49157b8f` in all three targets, the gym's character paths
    `26f43551`). A comment-only `InitEngine.ts` edit reloaded the dev server's page once during
    the run (after `exampleLod`); every scene still passed. The gym's `workerMsg` snapshot passed
    this time.
  - `yarn sbp`, the template (with `physicsTiers()`): initial **385.7 kB gzip** (Phase 0's 387.0;
    Phases 2-3's removals), `_engine/features/physics` 23.8 kB initial (+0.3: the feature module
    and the guard) / 31.6 kB lazy. **A scratch build without `physicsTiers()`** (`src/index.ts`
    only, restored after): initial **381.0 kB (−4.7 kB, −1.2 %)**, the physics group 19.2 kB
    initial / 32.4 kB lazy, the `physicsTiers` scene's chunk 2.59 → 3.28 kB (the tiers' modules
    moved into it). The reports are `.cache/p622/sbp-phase4-with-report.json` and
    `-without-report.json`.
  - `yarn verify:baselines`: the API diff is `physicsTiers` (on `aekasha/physics`),
    `physicsTiersSceneHooks` and `assertPhysicsTiersInstalled` (both `@internal`), the main chunk
    +0.3 kB, the embeds unchanged, no debug code; recorded. `yarn hub:build` clean but the search
    index's size warning (484 KiB).
  - Docs: the physics feature page (Installing it, Simulation tiers with the `features` line and
    what happens without it, Key APIs), the Hub's architecture guide, documentation intro, quick
    start and SBP table ("ten features"), the readme's Feature modules and Physics simulation
    tiers lines, `InitEngine`'s JSDoc and `@example`, the root `CLAUDE.md` (Three-folder split,
    Bootstrap flow, Physics), `kernel/init/CLAUDE.md` (the ten features, the ids, the exit order,
    the throws and warnings) and the physics `CLAUDE.md` (the feature's bullet in Simulation
    tiers). `migration/engine-5.md`'s "all nine" stays (engine 5's list).

### Phase 5 — The kernel's reshapes (D2, D4) — done

- **Section 1:** `CreateEntityOpts` and the creators (`createMeshEntity`, `createCameraEntity`,
  `createGroupEntity`, `createLightEntity`, `createEntity`, and `createLineEntity` on
  `aekasha/lines`); the codemod rule; the codemod over `src`. Most of the 99 `createMeshEntity`
  calls pass only props and don't change.

  As built (section 1):

  - `CreateEntityOpts` (`kernel/ecs/ECSHelpers.ts`, next to `createEntity`, a type line on
    `aekasha`): `CoreEntityOpts & { world?: ECSWorld }`, the `world` documented as code only.
    Each creator destructures `const { world: ecsWorld, ...entityOpts } = opts ?? {}` first, so
    its body is unchanged and `world.createEntity` never sees a `world` key (an empty object
    where `undefined` went: `ECSWorld.createEntity` reads both alike). `createPhysicsEntity`'s
    options are now written `PhysicsEntityOpts & CreateEntityOpts`.
  - The codemod: no new machinery. `engine6Rules.ts`' `creator(entry, name)` makes the five
    creators' rules (`params: props, opts, world`, `newArgCount: 2`) and `createEntity`'s is
    written out (`newArgCount: 1`); all share `OPTS_WITH_WORLD` (`{ ...opts, world }`) with
    `createPhysicsEntity`'s. The test stand-ins grew the creators and an `aekasha/lines` entry;
    a fixture per rule and a behaviour test (placeholders dropped, an options variable spread,
    a new-shaped call left). 66 tests.
  - The run over `src hub/_assets/ts` (958 modules): 10 modules, all with a world passed
    (`SkyLights.ts`, `Camera.ts`' debug orbit camera, two engine tests, `largeWorld`, three
    `lodShowcase` lanes, `physicsTiers`, the toolkit's `ScatterOnSurface.ts`), nothing
    reported; `tsc` and `tsc -p hub` clean after it. Nothing in the Hub's Markdown, the readme or
    an `@example` passed a world; `p370`'s Grounding line names the new shape.
  - `yarn verify:baselines`: the API diff is `CreateEntityOpts` alone, the bundles unchanged
    (a byte or two of gzip per chunk), recorded. `yarn hub:build` clean. `yarn verify:scenes`:
    114 passed, every hash unchanged (`physicsTiers` `49157b8f`, the gym's character paths
    `26f43551`); the gym's `workerMsg` snapshot passed.
  - Docs: `kernel/ecs/CLAUDE.md` (a "The creators' options" bullet) and
    `devTools/migrate/CLAUDE.md` (kind 3's examples). The Hub's pages need nothing until Phase
    8's migration subsection.
- **Section 2:** `getScene`, `createSceneLoader` and the light setters; the codemod rules and run;
  `src/index.ts`, the readme's `createSceneLoader` example, the UI kit guide's block.

  As built (section 2):

  - `getScene(id, opts?)` and `createSceneLoader(sceneLoader, opts?)` take their options inline
    (each key documented); `setLightEnabled(world, lightId, enabled)` on `aekasha`, and the two
    `@internal` ones (`setLightFrustumCullingEnabled`, `setLightObjectCullingEnabled`) the same,
    their five engine calls moved by hand (the codemod's rules follow entry functions only).
    Nothing outside the engine passed `getScene`'s flags or `isCurrent` (only its `@example` and
    the debugger's loader, `false`), so `src/index.ts`, the readme and the UI kit guide didn't
    change; the `@example`s of `getScene`, `setLightEnabled` and `SkyLights.ts` by hand.
  - **The codemod's frame grew two things** (Phase 3's note): `ReshapeRule.oldType` (an old
    boolean or number where the options object goes now, `undefined` aside, `any` reported;
    `getScene`, `createSceneLoader`, and Phase 6's sky box index) and **the reorder check**: new
    arguments may name the old ones out of order, and per call two arguments that change places
    must both be pure (`isPure`: reads, literals, operators, closures, object and array literals
    of those, no assignment, `++`, `new` or call but of `PURE_CALLS`: `getECSWorld`) or one a
    literal, else the call is reported and left. `setLightEnabled`'s old shape is
    `newHas: { index: 0, member: 'addComponent' }` (the world's type has it, an id doesn't).
    Anchors `the-scene-functions` and `the-light-setters` (**Phase 8 writes those headings**).
    Phase 6's omitted-world default (`getECSWorld()` with its import) isn't built: the light
    setters' world is required.
  - **The codemod's modules split** at the size rule (`engine6.ts` was 984 lines before this
    phase, 1123 with the check): `engine6Reshape.ts` (kind 3's reshape) and `engine6Calls.ts`
    (`calleeOf`, `resolveAlias`, `isLiteral`, `isPure`); the tests likewise,
    `engine6Reshape.test.ts` and the shared `engine6TestHarness.ts`. 72 tests.
  - The run over `src hub/_assets/ts`: 5 modules (`Light.ts`, the two light debug modules, the
    debugger's scene loader, `largeWorld`), nothing reported; a second `--check` finds nothing.
  - `yarn verify:baselines` unchanged (signatures aren't in `api.json`); `yarn hub:build` clean;
    `yarn verify:scenes` 114 passed, every hash unchanged (the `debugger` runs use the debugger's
    loader, now `{ isCurrent: false }`).
- **Section 3:** D2 into the coding standards page (`hub/pages/documentation/coding-standards/
  intro.md`) and its one line in the root `CLAUDE.md`'s Coding standards.

  As built (section 3):

  - **`getLightTargetId(world, lightId)`** too (D2's "a required world first": section 2's audit
    of every entry function's signatures found it and `getLodWorldSphere`, which no D listed;
    decided to reshape both, the LOD one in Phase 6 section 1). Its rule is a reorder like
    `setLightEnabled`'s; the codemod moved `SkyLights.ts`' call, the `@example` by hand. 73 tests.
  - The coding standards page's Public API has the exception as its own bullet after the options
    objects one, with an example of each case; the root `CLAUDE.md`'s Coding standards line names
    it in a clause.
  - `yarn test`, `yarn hub:build` and `yarn verify:baselines` clean (unchanged); `yarn
    verify:scenes` over the sky scenes (`skyShowcase`, `space`, `largeWorld`, `exampleHubHero`,
    the sky lights' `getLightTargetId`): 17 passed.

### Phase 6 — The features' reshapes (D5, D6)

- **Section 1:** the spatial membership functions and `refreshSpatialRadius` (world first);
  `getLodWorldSphere(world, entityId, lod, out)` (`aekasha/lod`, D2: a required world first; a
  reorder rule, `newHas` on the world's type); the pools' `spawn` / `despawn`; the codemod rules
  and run; the Hub's `joinSpatialDomain` block; the
  spatial and instancing `CLAUDE.md`s (`refreshSpatialRadius(entityId)` there).
- **Section 2:** the sky box functions with `SkyBodyOpts`; the codemod rules and run (engine-only
  calls today); the sky box `CLAUDE.md` and feature page.

### Phase 7 — Toolkit 3.0.0 (D9)

- The removals, the layout rule, the component keys as `as const` objects; the codemod's toolkit
  rules (the `PhysicsParams` rename and the `createSeededRandom` move are Phase 1's; here the
  `typeof` rule) and run; `yarn verify:baselines --update`. Done when no `@deprecated` in
  `src/toolkit` names 3.0.0.

### Phase 8 — The migration page, the docs, the full check

- **Section 1:** `engine-6.md` and `migration/intro.md` (D11), every subsection naming its codemod
  rule or saying it's by hand; the root `CLAUDE.md` (Bootstrap flow, Physics, Commands, the map,
  Coding standards), the readme (its examples type-check through `examples.test.ts`).
- **Section 2, the upgrade rehearsal:** a scratch copy of the template at `main` (`git worktree`
  under the scratchpad), the branch's engine, toolkit and `devTools/` copied over it, then the
  codemod, `yarn build` and `yarn lint`: what's left must be exactly the reports. Fix the codemod
  or the page until it is. Then the full set on the branch: `yarn test`, `yarn build` (with its
  SBP and Hub), `yarn verify:scenes`, `yarn verify:baselines`, `yarn verify:embed`, `yarn
  verify:ui`.

### Phase 9 — Versions, changelog, done

- `package.json`: `version` and `engine_metadata.version` 6.0.0, codename "Sunset";
  `toolkit_metadata` 3.0.0 "Gibbous"; `app_metadata` 1.19.0 (same codename). `yarn checkVersions
  --against main`.
- `CHANGELOG.md` (D11); the Hub's homepage "What's new" then shows it (`yarn hub:build`).
- Mark the plan done (`docs/plans/CLAUDE.md`), move p990's 6.0.0 items if any, and say it's time
  for the PR: `p622_engine-6-major` into `main`. After the merge, `yarn tagRelease` and push its
  tags.

## 4. Risks

- **The codemod on code that doesn't compile.** It runs after the app took the new engine, so the
  old calls are type errors; the checker still resolves a callee's symbol through them. A call it
  can't resolve (a callee through `any`, a re-export the program can't follow) is reported, never
  guessed at.
- **A reshape that type-checks in both shapes.** `createMeshEntity(props, opts)` reads the same
  before and after; only calls whose old shape differs are rewritten, and each rule's fixtures
  include the already-new shape.
- **A long branch with `main` held** (D1). Phases 2-7 are independent enough to land in any order
  after Phase 1; keep the branch short, and merge `main` in rather than rebasing once pushed.
- **Determinism:** none of the reshapes changes what runs, but the tiers' exit order (D8) and the
  character removals touch simulation code. `yarn verify:scenes`' hashes are the check, per phase.
- **Bundle:** removing the legacy sky box and the deprecated paths shrinks the build; the
  options objects add a few bytes. `yarn sbp`'s budgets catch a surprise; record the before and
  after in Phase 9's changelog.

## 5. Open questions

- **`bindLineToEntity` and `addGravityBody`** stay under D2 although the stub listed them; reshape
  them anyway if a uniform "every creator and binder takes an options object" reads better.

## Done when

- No `@deprecated` in `src/_engine` names 6.0.0 and none in `src/toolkit` names 3.0.0; none is
  left without a version.
- The codemod migrates the template (Phase 8's rehearsal: what's left is its report), with a fixture
  per rule in `yarn test`.
- `yarn test`, `yarn build`, `yarn verify:scenes` (unchanged hashes), `yarn verify:baselines`,
  `yarn verify:embed` and `yarn verify:ui` pass; the Hub's migration page lists every change with
  its replacement.
- `yarn checkVersions --against main` passes with Sunset and Gibbous, and `CHANGELOG.md` has no
  unreleased entry left.
