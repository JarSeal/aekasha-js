Status: stub — not-implemented
Category: Refactoring, API
Related: p600_whole-codebase-refactoring-and-documentation.md (Stage C bumps are minor or patch, so its deprecations wait here), \_DONE_p614_review-physics.md (D3: the physics items below), \_DONE_p615_review-sky-box.md (D3: the sky box items below), \_DONE_p616_review-lod-spatial-instancing-lines.md (D3: the LOD, spatial, instancing and lines items below), p617_review-input-ui-hud.md (D3: the UI kit items below), \_DONE_p610_character-and-input-action-architecture.md, \_DONE_p612_review-ecs-loop-config-init.md, \_DONE_p613_review-rendering-scene-assets.md (their deprecations), \_DONE_p611_sbp-tooling-profiles-and-marketing.md (the tiers' measurement)

# Engine 6.0.0 — Stub

**This is a stub.** It collects what the engine's next major removes or reshapes, so the minors
in between can deprecate instead of break. Expand it into a full plan (grounding, phases, the
codemod and migration guide, versioning with a new codename from the sun's path after Golden
Hour) when the major is scheduled.

## Goal

One major that removes every API deprecated "until engine 6.0.0" and lands the breaking changes
the Stage C reviews deferred, with a codemod (as p606's `migrateToEntries.ts`) and a Hub
migration page, so an app made from the template upgrades in one step.

## Scope

- **Every `@deprecated` that names engine 6.0.0.** Today (`grep -rln "6\.0\.0" src/_engine`):
  - characters (p610 D5): `CharacterTypes.ts`, `Character.ts`, `CharacterBodyPlans.ts`,
    `CharacterInputSchemes.ts`, `controllers/dynamic/DynamicCharacter.ts`,
    `DynamicCharacterData.ts` (listed in `features/character/CLAUDE.md`);
  - the kernel (p612, p613): `CoreComponentType` (`ECSRegistry.ts`), `sceneDeleted`
    (`SceneHooks.ts`), `Group.ts`' three release options, `SceneLoader.ts`' status option,
    `Scene.ts`' old all-scene-enters hook, `TextureSync.ts`' synchronous loaders;
  - physics: `getPhysGameTime()` and `PhysicsWallClock.ts` (and its allow-list entry in
    `SIMULATION_FILES`);
  - the sky box (p615): `LegacySkyBox.ts`, `SkyBox.ts`' legacy `createSkyBox` overload,
    `SkyBoxSchema.ts`' conversions and the debug tab's migration (`debug/_dbg__SkyBoxShared.ts`;
    below).
- **From p614 (its D3):**
  - `physicsTiers()`, a feature of its own (below);
  - `createPhysicsEntity` with an options object instead of five positional parameters (36 call
    sites in the app and the toolkit, 2 in the engine, the readme's and the Hub's examples, counted
    2026-10-18: the codemod's job);
  - only if a second physics backend is planned: `WorldAPI`'s positional queries (they mirror
    Rapier's today);
  - `WorldAPI.setMaxCcdSubstepsSync`: a one-way setter named like a sync getter, so `OmitSync`
    drops it from the worker proxy's type (p614 Phase 3). Renamed `setMaxCcdSubsteps` (the old name
    deprecated in a minor first, or removed here);
  - the Rapier enums nothing in the API takes or returns (`ActiveHooks`, `ActiveCollisionTypes`,
    `CoefficientCombineRule`, `ActiveEvents`, `SolverFlags`; `PhysicsHooks` can't run without
    them): dropped here, unless `docs/issues/physics-unused-rapier-enums.md` wires them into
    `ColliderParams` in a minor first.
- **From p615 (its D3):**
  - the pre-3.0 sky box shape (`{ type, params }`): `features/skybox/LegacySkyBox.ts` with its
    entry names (`LegacySkyBoxProps`, `isLegacySkyBoxProps`, `LEGACY_SKYBOX_WARNING`),
    `createSkyBox`'s legacy overload (`SkyBox.ts`), the schema's two conversions
    (`SkyBoxAssetSchema`'s preprocess and the `__saveData` entries' `fromLegacySkyBoxOverrides`,
    `SkyBoxSchema.ts`), the gatherer's `warnOnLegacySkyBox` (`devTools/gatherAppData.ts`) and the
    debug tab's one-time `AEK_debugSkyBoxStates` migration (`migrateLegacySkyBoxLS`,
    `debug/_dbg__SkyBoxShared.ts`). Nothing in the template uses the shape (no JSON, no
    `createSkyBox` call; checked 2026-10-18);
  - candidates, decided here: the optional positional parameters of `setActiveSkyBox(id,
    sceneId?)`, `getSunDirection(out, i = 0)`, `getMoonDirection(out, i = 0)`,
    `getSunElevation(i = 0)` and `getMoonPhase(i = 0)` (the coding standard asks for an options
    object; a trailing index is common enough that keeping them is an option).
    `registerSkyBox(def, sceneId?)` is `@internal` since p615, so it can change in any release.
- **From p616 (its D3; candidates, decided here; call sites counted 2026-10-20):**
  - the spatial API's argument order: `registerSpatialDomain(world, opts)`,
    `getSpatialDomain(world, id)`, `invalidateSpatialDomain(world, id)` and the rest take the world
    first, but `joinSpatialDomain`, `leaveSpatialDomain` and `isInSpatialDomain` take
    `(entityId, domainId, world?)` and `refreshSpatialRadius` `(entityId, world?)`. World first
    everywhere, or an options object (outside their module: `joinSpatialDomain` once in the Hub,
    `refreshSpatialRadius` three times in the engine);
  - an instanced pool's `spawn(world, placements, entityOpts?)` and `despawn(world, entityId)`
    without their `world`: the pool's own (`opts.world`, which owns the mesh). Instances spawned
    into another world outlive the mesh's scene there and keep slots in a disposed mesh (6 calls
    in the app and the Hub's LOD example, all passing the pool's world);
  - `createLineEntity(props, entityOpts?, ecsWorld?)` and `bindLineToEntity(line, entityId,
    ecsWorld?)`: optional positional parameters, where the coding standard asks for an options
    object (no call outside the engine).
- **From p617 (its D3):**
  - `AppConfig.draggableWindows` (`kernel/config/Config.ts`, deprecated in engine 5.8.0): the
    windows' content functions are a module map since p617 (`registerDraggableWindow`,
    `registerDraggableWindowKind`), and the key is only read as a fallback (`buildContent`,
    `ui/DraggableWindow.ts`). Removed with its `TCMP` and `DraggableWindow` type imports, the last
    kernel → ui imports of `Config.ts`;
  - `AddToastResponse.timeout` (`ui/Toaster.ts`, deprecated in engine 5.8.0): the toast's first
    timer, which its later phases replace;
  - `TSettings.doCheckIsInDom` (`ui/CMPTypes.ts`, deprecated in engine 5.8.0): stored, never read;
  - a candidate, decided here: the UI kit's `T`-prefixed type names, the only ones in the engine
    (`TCMP` → `Cmp`, `TProps` → `CmpProps`, `TListener`, `TListenerCache`, `TListenerCreator`,
    `TStyle`, `TAttr`, `TClassAction`, `TAnimChain`, `TAnimState`, `TSettings` in `ui/CMP.ts`, and
    `ui/DropDown.ts`' `TDropDown`), all on `aekasha/ui`, renamed together (the old names
    deprecated aliases in a minor first, or removed here: the codemod's job).
- **The deprecations without a version** (`debug/Stats.ts`' two, `debug/PercentagePieHtml.ts`'
  one): each gets a version or a removal here. (`ui/DraggableWindow.ts`' six were removed in
  p617: on no entry, no caller.)
- **The toolkit** keeps its own scale: its `createSeededRandom` re-export goes in toolkit 3.0.0,
  which ships with this major only if an engine change requires it (Versioning).

## The tiers as a feature (from p611, 2026-10-14)

- **Leaving the tiers and the tier policy out** (p611 D10, measured in its Phase 5 §2). `physics()`
  installs both (`installPhysicsTiers`, `installPhysicsTierPolicy`, and the exit hook's
  `deleteScenePhysicsTierPolicies`) whether the app uses them or not. A scratch build of the app
  without those three calls:
  - The initial load 389.0 → **384.8 KiB gzip (−4.2 KiB, −1.1%)**: `PhysicsTiers.ts` (2.4 kB
    before minification) and `PhysicsTierPolicy.ts` (3.7 kB) left the main chunk, and the
    `physicsTiers` scene's lazy chunk grew 0.7 KiB (the policy API it calls). It matches p607's
    −4.0 kB when they loaded with that scene.
  - Not counted, and kept unless split further: the tiers' parts of `PhysicsAPI.ts` (`detach` /
    `reattachRigidBody`, `readBodyPositionsAtStep`; `addPhysicsStepGate` is public API of its own,
    though only the policy uses it today), of `PhysicsEntity.ts` (the `REMOVED` body) and of the
    worker. (Since p614: `detach` / `reattachRigidBody` and `readBodyPositionsAtStep` in
    `PhysicsBodies.ts`, `addPhysicsStepGate` in `PhysicsStepping.ts`, the `REMOVED` body in
    `PhysicsEntity.ts`' `getPhysicsEntityBody`, `isBodyJointed` in `PhysicsJoints.ts`.)
- **The shape:**
  - A runtime option (`physics({ tiers: false })`) saves nothing: `physics()`'s install still
    names the install functions, so the build keeps them.
  - Installing on first use (`requestPhysicsTier`, `setPhysicsTierPolicy`) would save it, but
    registers systems mid-run: p607 moved them into the install because their late registration
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
  code only, like physics). 4.2 KiB is small, but it's the "you only bring into existence what you
  need" principle at no cost to the apps that don't use tiers.

## Inputs

- p606's codemod and migration page (the model for this one), p600 §11 (versioning), the
  `@deprecated` tags themselves (each names its replacement).
- p614 D3, p611 D10 / Phase 5 §2.

## Done when

- No `@deprecated` in `src/_engine` names 6.0.0, and none is left without a version.
- The codemod migrates the template app (`yarn test`, `yarn verify:scenes` with unchanged hashes,
  `yarn build`), and the Hub's migration page lists every removal with its replacement.
- `yarn checkVersions --against main` with the new codename.
