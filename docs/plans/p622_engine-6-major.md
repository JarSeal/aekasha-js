Status: stub — not-implemented
Category: Refactoring, API
Related: p600_whole-codebase-refactoring-and-documentation.md (Stage C bumps are minor or patch, so its deprecations wait here), p614_review-physics.md (D3: the physics items below), \_DONE_p610_character-and-input-action-architecture.md, \_DONE_p612_review-ecs-loop-config-init.md, \_DONE_p613_review-rendering-scene-assets.md (their deprecations), \_DONE_p611_sbp-tooling-profiles-and-marketing.md (the tiers' measurement)

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
    `SIMULATION_FILES`).
- **From p614 (its D3):**
  - the six deprecated `RayCastOpts` aliases (`kernel/render/Raycast.ts`; p614 tags them
    "removed in engine 6.0.0");
  - `physicsTiers()`, a feature of its own (below);
  - `createPhysicsEntity` with an options object instead of five positional parameters (53
    callers in the app and the readme's example: the codemod's job);
  - only if a second physics backend is planned: `WorldAPI`'s positional queries (they mirror
    Rapier's today).
- **The deprecations without a version** (`ui/DraggableWindow.ts`'s six, `debug/Stats.ts`' two,
  `debug/PercentagePieHtml.ts`' one): each gets a version or a removal here.
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
    worker. (p614 splits `PhysicsAPI.ts`: these are in its `PhysicsBodies.ts` then.)
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
