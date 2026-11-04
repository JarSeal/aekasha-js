Status: stub — not-implemented
Category: Refactoring, API
Related: `docs/issues/physics-unused-rapier-enums.md` and `docs/issues/physics-ccd-substeps-setting.md` (the physics items below), `hub/pages/documentation/migration/engine-6.md` and `CHANGELOG.md`'s "Unreleased — engine-6" entry (what this major finishes)

# Engine 6.0.0 — Stub

**This is a stub.** It collects what the engine's next major removes or reshapes, so the minors
in between can deprecate instead of break. Expand it into a full plan (grounding, phases, the
codemod and migration guide, versioning with a new codename) when the major is scheduled. The
provenance tags ("p615 D3") name the plan that decided an item; each item says what to do
without it.

## Goal

One major that removes every API deprecated "until engine 6.0.0" and lands the breaking changes
the Stage C reviews deferred, with a codemod (on the model of `devTools/layout/migrateToEntries.ts`,
engine 5.0.0's) and the Hub migration page's "Engine 5 → 6" section, so an app made from the
template upgrades in one step.

## Where 6.0.0 stands (checked 2026-11-04)

- **No `engine-6` branch exists**, locally or on `origin` (`git branch -a`). It was planned as an
  integration branch, but the debugger migration (p806), the stats and profiler graphs (p807) and
  the game UI components (p808) merged straight into `main` (PRs #73-#75). So `main` already
  carries unreleased 6.0.0 work, the tab types' breaking changes included (below), while
  `package.json` still says engine 5.14.0 (Golden Hour), toolkit 2.2.1 (Half Moon), app 1.18.0.
- **`CHANGELOG.md`'s top entry is "## Unreleased — engine-6"**, holding p806-p808: an intro,
  "### Engine 6.0.0 (unreleased)" (with the tab types' 5.x → 6.0 table under **Breaking**),
  "### Toolkit (unreleased: a minor at the 6.0.0 release)" (p808's `registerWorldAnchorSync`
  and the rig's orbit), "### App (unreleased: a minor at the 6.0.0 release)" and "### Project".
  Its intro says branches merge into `main` with no bump and this plan's branch is the release
  (rewritten 2026-11-04; it had called itself the `engine-6` integration branch's entry).
- **The Hub's migration guide** has the section: `hub/pages/documentation/migration/engine-6.md`
  ("Engine 5 → 6": "The debugger on the UI kit" with the same table, "What reads differently",
  "New in a tab"), under a `::: note In progress` that says the changes merge into `main` ahead
  of the release (rewritten 2026-11-04 from "land on the `engine-6` branch"). `migration/intro.md`
  says the section is in progress and that the 5.x deprecations go next.
- **Until this major merges:** a branch that changes the engine merges into `main` with its
  changelog sections added to the unreleased entry and no version bump, and its
  `yarn checkVersions --against main` fails on purpose (engine files changed, version unchanged;
  p807 D2). A branch that changes only the Project (repo tooling, docs) gets a dated entry of its
  own under the unreleased one (p809).
- **So the release is an ordinary branch from `main`** (no integration branch to merge): it lands
  the scope below, the codemod and the migration page, and its merge into `main` is engine 6.0.0
  (see Versioning and the changelog).

## Scope

- **Every `@deprecated` that names engine 6.0.0.** Today (`grep -rn "6\.0\.0" src/_engine`,
  2026-11-04):
  - characters (p610 D5; `features/character/CLAUDE.md` lists most): `DynamicCharacterOpts.input`
    and `charData`, `DynamicCharacter.data` (`controllers/dynamic/DynamicCharacter.ts`; replaced
    by `brain`, `config` and the controller's `state` / `config.values` / `internal`), the
    `CharacterData` type (`DynamicCharacterData.ts`), `CharacterInputScheme`,
    `CharacterInputHoldMode` (→ `PlayerBrainHoldMode`), `CharacterInputOpts` and
    `getInputBrainSpec`'s mapping (`CharacterInputSchemes.ts`), `CreateCharacterOpts.controls` and
    `data` (`Character.ts`), and in `CharacterTypes.ts` `CharacterObject.kind`, `keyBindingIds`,
    `mouseBindingIds` (its tag says only "See `keyBindingIds`": give it the version in a minor, or
    remove it here with the rest), `data` and `initialConfig` (→ `config.initial`),
    `CharacterBodyKindField`'s `kind` (→ `bodyKind`), `CharacterCastRecord.resolvedAt`
    (→ `resolvedAtStep`), and `HUMANOID_CAPSULE`'s `kind` (`CharacterBodyPlans.ts`). Before
    removing the flat `data` view, check that no debug tool reads it (none does today);
  - the kernel (p612, p613): `CoreComponentType` leaves the entry (`kernel/ecs/ECSRegistry.ts`;
    `ComponentType` is the same object), `SceneHooks.sceneDeleted` (`SceneHooks.ts`, no
    replacement), `Group.ts`' `deleteGeometries`, `deleteMaterials` and `deleteTextures` (never
    read: `deleteMeshes` releases them), the scene load options' `updateLoaderStatusFn`
    (`SceneLoader.ts`, never read: the loader's own from `createSceneLoader` is used),
    `registerOnAllSceneEnterings` (`Scene.ts`, → `registerOnAllSceneEnters`), and
    `TextureSync.ts`' `loadTextures` and `loadTexture` (→ `loadTextureAsync`);
  - physics: `getPhysGameTime()` (`PhysicsStepping.ts`, → the step index times the fixed
    timestep) with `PhysicsWallClock.ts`, and its allow-list entry in `eslint.config.js` (the
    known-violations block after `SIMULATION_FILES`);
  - the sky box (p615): `LegacySkyBox.ts` and the rest of the legacy shape (from p615 below);
  - the debug entry (p618): `debug/DevFilesProtocol.ts`, `debug/TestBridge.ts`,
    `debug/DebuggerGUI.ts` (from p618 below);
  - the UI kit (p617, p803, p804): from p617 below;
  - the dev tools that name what goes: `devTools/hub/api/entries.ts`' `ACCEPTED_LEAKS` (both
    entries, `PhysicsProbeReport` and `LegacySkyBoxParams`, leak only through names removed
    here: the map is then empty), `devTools/engineImports.test.ts`' `LegacySkyBox.ts` entry, and
    the nested `CLAUDE.md` lists of what waits for 6.0.0 (`ui/`, `features/character/`,
    `features/skybox/`, `features/physics/`, `debug/`); `yarn verify:baselines --update` for
    `api.json` and `docs.json`.
- **From p614 (physics):**
  - `physicsTiers()`, a feature of its own (below);
  - `createPhysicsEntity(colliderParams, rigidBodyParams?, target?, entityOpts?, ecsWorld?)`
    with an options object instead of five positional parameters (counted 2026-11-04: 31 calls in
    `src/app`, 2 in `src/toolkit`, 2 in engine code (`Character.ts`, `import/ImportPhysics.ts`)
    plus 4 in its tests and 2 `@example`s, the readme's example and 3 in the Hub: the codemod's
    job);
  - only if a second physics backend is planned: `WorldAPI`'s positional queries (they mirror
    Rapier's today);
  - `WorldAPI.setMaxCcdSubstepsSync` (`types/PhysicsWorldTypes.ts`, `proxies/WorldProxyAPI.ts`,
    `backends/rapier/proxies/EngineWorldProxyAPI.ts`, the worker's `PhysicsSwitchWorld.ts`): a
    one-way setter named like a sync getter, so `OmitSync` drops it from the worker proxy's
    type. Renamed `setMaxCcdSubsteps` (the old name deprecated in a minor first, or removed here);
    `docs/issues/physics-ccd-substeps-setting.md` (a config setting for it) can land with it;
  - the Rapier enums nothing in the API takes or returns (`ActiveHooks`, `ActiveCollisionTypes`,
    `CoefficientCombineRule`, `ActiveEvents`, `SolverFlags`; `PhysicsHooks` can't run without
    them): dropped here from `aekasha/physics` and the backend's mirrors (and
    `EngineRapier.test.ts`' pairs), unless `docs/issues/physics-unused-rapier-enums.md` wires them
    into `ColliderParams` in a minor first.
- **From p615 (the sky box):**
  - the pre-3.0 sky box shape (`{ type, params }`): `features/skybox/LegacySkyBox.ts` with its
    entry names (`LegacySkyBoxProps`, `LegacySkyBoxParams`, `isLegacySkyBoxProps`,
    `LEGACY_SKYBOX_WARNING`, `fromLegacySkyBoxProps`), `createSkyBox`'s legacy overload
    (`SkyBox.ts`), the schema's two conversions (`SkyBoxAssetSchema`'s preprocess and the
    `__saveData` entries' `fromLegacySkyBoxOverrides`, `SkyBoxSchema.ts`), the gatherer's
    `warnOnLegacySkyBox` (`devTools/gather/registries.ts`) and the debug tab's one-time
    `AEK_debugSkyBoxStates` migration (`migrateLegacySkyBoxLS`,
    `features/skybox/debug/_dbg__SkyBoxShared.ts`). Nothing in the template uses the shape (no
    JSON, no `createSkyBox` call; checked 2026-10-18);
  - candidates, decided here: the optional positional parameters of `setActiveSkyBox(id,
sceneId?)`, `getSunDirection(out, i = 0)`, `getMoonDirection(out, i = 0)`,
    `getSunElevation(i = 0)` and `getMoonPhase(i = 0)` (the coding standard asks for an options
    object; a trailing index is common enough that keeping them is an option).
    `registerSkyBox(def, sceneId?)` is `@internal`, so it can change in any release.
- **From p616 (candidates, decided here; call sites counted 2026-11-04):**
  - the spatial API's argument order: `registerSpatialDomain(world, opts)`,
    `getSpatialDomain(world, id)`, `invalidateSpatialDomain(world, id)` and the rest take the world
    first, but `joinSpatialDomain`, `leaveSpatialDomain` and `isInSpatialDomain` take
    `(entityId, domainId, world?)` and `refreshSpatialRadius` `(entityId, world?)`
    (`features/spatial/SpatialIndexSystem.ts`). World first everywhere, or an options object
    (outside their module: `joinSpatialDomain` once in the Hub, `refreshSpatialRadius` twice in
    the engine's light debug modules);
  - an instanced pool's `spawn(world, placements, entityOpts?)` and `despawn(world, entityId)`
    (`features/instancing/InstancedMeshPool.ts`) without their `world`: the pool's own
    (`opts.world`, which owns the mesh). Instances spawned into another world outlive the mesh's
    scene there and keep slots in a disposed mesh (6 calls in the app, the Hub's LOD example's
    among them, all passing the pool's world, and `Foliage.ts`' `@example` in the toolkit);
  - `createLineEntity(props, entityOpts?, ecsWorld?)` and `bindLineToEntity(line, entityId,
ecsWorld?)` (`features/lines/Lines.ts`): optional positional parameters, where the coding
    standard asks for an options object (no call outside the engine).
  - With them, the ones p613 kept by decision (documented, not filed): `getScene(id, silent?,
throwOnError?)` (`Scene.ts`) and `createSceneLoader(sceneLoader, isCurrent?)`
    (`SceneLoader.ts`)' positional booleans, and the kernel's positional `world` parameters
    (optional on the entity creators, `createXEntity(props, entityOpts?, ecsWorld?)`, required on
    the light setters). `createLineEntity` above has the creators' shape, so decide them
    together: reshape them all, or keep them all.
- **From p617, p803 and p804 (the UI kit, all on `aekasha/ui`):**
  - `AppConfig.draggableWindows` (`kernel/config/Config.ts`, deprecated in engine 5.8.0): the
    windows' content functions are a module map (`registerDraggableWindow`,
    `registerDraggableWindowKind`), and the key is only read as a fallback (`buildContent`,
    `ui/overlays/windows/DraggableWindow.ts`). Removed with `Config.ts`' `CMPHandle` and
    `DraggableWindow` type imports (`ui/core/CMPTypes.ts`,
    `ui/overlays/windows/DraggableWindowTypes.ts`), the last kernel → ui imports of `Config.ts`;
    after it `DraggableWindow.ts` no longer reads `getConfig()`;
  - `AddToastResponse.timeout` (`ui/overlays/Toaster.ts`, deprecated in engine 5.8.0): the
    toast's first timer, which its later phases replace (→ `removeToast`);
  - `CMPSettings.doCheckIsInDom` (`ui/core/CMPTypes.ts`, deprecated in engine 5.8.0): stored,
    never read;
  - the `T`-prefixed type names' deprecated aliases (p803 D3, engine 5.12.0): `TCMP`
    (→ `CMPHandle`), `TProps` (→ `CMPProps`), `TSettings` (→ `CMPSettings`), `TListener`,
    `TListenerCache`, `TListenerCreator`, `TStyle`, `TAttr`, `TClassAction`, `TAnimChain` and
    `TAnimState` (each → its `CMP` name: `CMPListener`, …, `CMPAnimState`) at the end of
    `ui/core/CMPTypes.ts`, and `TDropDown` (→ `DropDown`) in `ui/forms/DropDown.ts`. Removed
    here, with their rows in the migration page (a rename, the codemod's job);
  - `getSvgIcon`'s `size` value `'small'` (p803 D5, deprecated in engine 5.12.0: `'sm'`;
    `ui/core/icons/SvgIcon.ts`), and the `uiIcon` / `smallIcon` classes it writes next to
    `aekIcon` (no style reads them since the debugger's restyle removed their rules);
  - the string form of `kbd` (p804 D13, deprecated in engine 5.13.0: a `Kbd` handle from
    `createKbd`) on `ButtonProps`, `SplitButtonProps`, `MenuActionItem` and `MenuCheckboxItem`:
    `ui/components/ShortcutHint.ts`' string path (its `import('./Kbd')`) goes with it, and the
    props' type is `Kbd` alone.
- **From p618 (the debug entry):**
  - the names on `aekasha/debug` that only the dev files protocol's two sides and the scene runner
    use (deprecated in engine 5.9.0): the dev server's route, header and meta constants
    (`DEV_FILES_ROUTE_BASE`, `DEV_FILES_TOKEN_HEADER`, `DEV_FILES_TOKEN_META`,
    `DEV_FILES_HASH_HEADER`), `AEK_GATHER_EVENT`, `DevFilesStageBody`, `DevFilesSaveDataWrite`,
    `DevFilesErrorBody` (`debug/DevFilesProtocol.ts`) and the test bridge's `TestBridgeProbeResult`,
    `TestBridgeSceneReady`, `TestBridgeSnapshot` (`debug/TestBridge.ts`). They leave the entry and
    become `@internal`; `devTools/` already imports them by path, so only the entry changes. The
    protocol types the client API names stay public (`DevFilesStatusBody`, `DevFilesCommitBody`,
    `DevFilesConflicts`, `DevFilesSchemaIssues`, `DevFilesErrorCode`, `DevFilesWriteStatus`,
    `DevFilesSaveData`, `DevDataGatheredEvent`);
  - `createDebuggerTab(def, opts?)`'s second parameter and `DebugGUIOpts` (`debug/DebuggerGUI.ts`,
    deprecated in engine 5.9.0): it moves the drawer's button for the whole drawer, whichever tab
    passes it, and nothing passes it. Removed; the button stays in the middle (an app moves it
    with CSS).
- **Already on `main`, nothing left in code: the tab types' break** (p806 D3). The debugger runs
  on the UI kit and Tweakpane is gone from `package.json`: a binding takes the kit's field props
  only, `view: 'color'` is `kind: 'color'`, `onChange` gets `{ prev, last, source, field }`,
  `onCreate(field)`, `custom.build(container: CMPHandle)`, `prev` on the `last: true` call is the
  value before the gesture, a `THREE.Euler` is a rotation field in degrees, a typed number is
  rounded to the step's decimals. The table is in the changelog entry and the migration page;
  this major only releases it (below). One behaviour the page doesn't list yet: `onChange` also
  fires on a field's `setValue` (`source: 'api'`).
- **The deprecations without a version:** none in a tag's version (`mouseBindingIds`' "See
  `keyBindingIds`" aside, above).
- **The toolkit** keeps its own scale: toolkit 3.0.0 (Gibbous) ships with this major only if an
  engine change requires it, or if the list below is taken (Versioning). Its list (p620 D5; each
  `@deprecated` names toolkit 3.0.0):
  - `createSeededRandom` on `aekasha/toolkit/geometry` (`geometry/SeededRandom.ts`, a deprecated
    copy): removed, import it from `aekasha`. Its layout rule in `devTools/layout/layoutRules.ts`
    goes with it.
  - `PhysicsParams` (`ecs/gameplay/movingPlatform/MovingPlatform.ts`): removed, its name is
    `MovingPlatformPhysicsParams`.
  - `DeleteMeshOptions` and `MovingPlatformOptions.deleteMeshOptions`: removed, never read
    (`controls.delete()` deletes the platform's entity and its mesh).
  - Not deprecated, breaking to change: `addGravityBody(entityId, mass, world?)`'s optional
    positional `world` (`ecs/effects/MutualGravity.ts`) becomes an options object (`{ world }`),
    the coding standards' shape.
  - Not deprecated, to decide: the component keys (`HoverToolComponentType`,
    `FollowToolComponentType`, `SunShadowFitComponentType`, and p808's `WorldAnchorComponentType`)
    are TS `enum`s, where the app's keys are `as const` objects (`src/AppECSRegistry.ts`, the ECS
    page's pattern). An enum member is a type of its own, so the change breaks a caller that names
    one as a type; decide it with the engine's `ComponentType` (`CoreComponentType`, also an enum).

## The tiers as a feature (from p611, 2026-10-14)

- **Leaving the tiers and the tier policy out** (p611 D10, measured then). `physics()`
  (`features/physics/PhysicsFeature.ts`) installs both (`installPhysicsTiers`,
  `installPhysicsTierPolicy`, and the exit hook's `deleteScenePhysicsTierPolicies`) whether the
  app uses them or not (still so 2026-11-04). A scratch build of the app without those three calls:
  - The initial load 389.0 → **384.8 KiB gzip (−4.2 KiB, −1.1%)**: `PhysicsTiers.ts` (2.4 kB
    before minification) and `PhysicsTierPolicy.ts` (3.7 kB) left the main chunk, and the
    `physicsTiers` scene's lazy chunk grew 0.7 KiB (the policy API it calls). It matched the
    −4.0 kB measured when they loaded with that scene.
  - Not counted, and kept unless split further: the tiers' parts of the facade and the worker:
    `detach` / `reattachRigidBody` and `readBodyPositionsAtStep` in `PhysicsBodies.ts`,
    `addPhysicsStepGate` in `PhysicsStepping.ts` (public API of its own, though only the policy
    uses it today), the `REMOVED` body in `PhysicsEntity.ts`' `getPhysicsEntityBody`,
    `isBodyJointed` in `PhysicsJoints.ts`.
- **The shape:**
  - A runtime option (`physics({ tiers: false })`) saves nothing: `physics()`'s install still
    names the install functions, so the build keeps them.
  - Installing on first use (`requestPhysicsTier`, `setPhysicsTierPolicy`) would save it, but
    registers systems mid-run: they were moved into the install because their late registration
    gave a build another system order than the dev server, and their exit hook needs the feature
    context.
  - So **a feature of its own, `physicsTiers()`** (`requires: ['physics']`): its systems, component
    hooks and exit hook installed there, `requestPhysicsTier`, `setPhysicsTierPolicy` and
    `createPhysicsEntity`'s `tierPolicy` throw or warn naming it without it, as `createLines` does
    for `lines()`. Listed right after `physics()`, every tie stays: physics' own systems are in
    other stages (`APP_POST_PHYSICS`, `APP_RENDER_SYNC`, `LATE_MAIN`), the characters' are at other
    orders (-10 and -5 against 100 and 110), and the policy's `APP_LOGIC` system still registers
    before every later feature's and the app's. The scene runner's system order baseline and hashes
    check it.
  - One order does change: `exit` hooks run in reverse install order, so the policies would go
    before the physics entities (today after). Check that a policy's members don't need their
    bodies while it's deleted.
- An app that uses tiers adds `physicsTiers()` to `features` (the template does, for
  `physicsTiers`), a line in the migration guide; the scenes' manifests can't name it (tiers are
  code only, like physics). `features/physics/CLAUDE.md`, the root `CLAUDE.md`'s Bootstrap flow
  (the ten features) and the physics feature page change with it. 4.2 KiB is small, but it's the
  "you only bring into existence what you need" principle at no cost to the apps that don't use
  tiers.

## Versioning and the changelog

- **Versions** (the root `CLAUDE.md`'s Versioning): engine and project 6.0.0 with the next
  codename on the sun's path after Golden Hour; the toolkit at least a minor (p808's additions
  are in the unreleased entry), or 3.0.0 Gibbous if its list above is taken; the app a minor
  (p806-p808 changed it), more if the codemod's changes to it say so.
- **`CHANGELOG.md`:** the "Unreleased — engine-6" entry becomes a dated entry for this branch
  (`## <date> — <branch>`): its intro rewritten (no integration branch; what the major holds),
  its headings without "(unreleased …)", and this plan's removals and reshapes added under
  Engine 6.0.0 (and Toolkit) as **Breaking**, each with its replacement.
- **The migration page** (`hub/pages/documentation/migration/engine-6.md`): a subsection per
  removal or reshape with its replacement (and the codemod's command), the `setValue` line above,
  the `::: note In progress` dropped; `migration/intro.md`'s "in progress" paragraph updated.
- After the merge, `yarn tagRelease` and push its tags.

## Inputs

- The engine 5.0.0 codemod `devTools/layout/migrateToEntries.ts` (`--check`, the folders and
  files it takes) and its migration section, `hub/pages/documentation/migration/engine-5.md`:
  the model for this one.
- The `@deprecated` tags themselves (each names its replacement), and the nested `CLAUDE.md`
  lists named above.

## Done when

- No `@deprecated` in `src/_engine` names 6.0.0, and none is left without a version (in
  `src/toolkit`, none names 3.0.0 if the toolkit major is taken).
- The codemod migrates the template app (`yarn test`, `yarn verify:scenes` with unchanged hashes,
  `yarn build`), and the Hub's migration page lists every removal with its replacement.
- `yarn checkVersions --against main` passes with the new codename(s), and `CHANGELOG.md` has no
  unreleased entry left.
