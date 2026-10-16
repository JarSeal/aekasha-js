Status: stub — not-implemented
Category: Refactoring, Documentation, Physics
Epic: p600_whole-codebase-refactoring-and-documentation.md (Stage C)
Blocks: p621_hub-docs-readme-and-claude-md-final.md, p511_network-transport-and-replication.md (the transport interface)

# Review: Physics — Stub

**This is a stub.** It fixes the scope, the inputs and the done criteria. Expand it into a full plan (grounding checked against the code, non-breaking phases, the Hub phase, versioning) when its blockers land: its details depend on p602's decisions.

## Goal

Applies p600 §5 (the per-file review standard) and p605's JSDoc style to every file in scope, and records the findings per file group in an "As found" list.

## Scope

- **Split the three largest files:** `PhysicsAPI.ts` (4,481 lines; `RigidBodyProxyAPI` alone ~985) into world, rigid body, collider, query, joint and stepping modules; `PhysicsAPITypes.ts` (3,212) along the same lines plus the protocol; `EngineRapier.ts` (2,612; `step` ~517 lines) per area, like the worker's `physicsSwitch*` files.
- The physics manager, tiers and tier policy, raycast, the worker and its switchboard.
- **The transport interface** in front of `postMessage` (p604 §4.5).
- **Remove the deprecated `RayCastOpts` aliases** (from p990: due in a major, this epic's).
- **The sync queries allocate per call** (p610 Phase 4's `perf-auditor` run): `castRayAndGetNormalSync`
  makes a `new RAPIER.Ray` and a result object (`EngineRapier.ts`, the dynamic character's floor ray:
  every step, per character), `castShapeSync` a new Rapier shape through `paramsToShape` (the wall
  cast: every step near a wall while moving). Reuse one `Ray` (set its origin and dir), cache the
  shape by its params.
- JSDoc: `core/Physics` is the worst folder (65 of 221 documented, 153 type aliases).

## Inputs

- p604 §4, p990's ray casting item (moved here), p500 (its snapshot repair touches the same modules: coordinate), p600 §2.
- p428 (characters in the worker targets: the controller in the worker or fixed-lag step-stamped reads, with step-stamped `EVENTS_PUSH` records; its protocol side is decided with the transport interface here).
- p605 Phase 5's `notExported` warnings in scope (`yarn hub:build` lists each with its file and line; export the type with a summary or change the signature): `EngineColliderProxyAPI`, `EngineRigidBodyProxyAPI`, `EngineJointProxyAPI` (`EngineRapier.ts`) and `RigidBodyProxyAPI` (`PhysicsAPI.ts`), named by the `create*` functions' results.
- p612 D2: the kernel names physics' types (`RigidBodyAPI` / `ColliderAPI` and the tier data in
  `ECSCoreComponents.ts`, `ECS.ts`' `RigidBodyAPI`, `AppConfig.physics`' types) with
  `import type` only, a rule in the coding standards and a lint (`KERNEL_FEATURE_IMPORT`); they
  stay. `ECSWorld`'s physics members (`setTransform`, `setVelocity`, `setDisabled`,
  `getRigidBody`, …) stay public.
- p612 D7: `PhysicsTierPolicy.ts:324` still finds the main camera with its own
  `getEntitiesWith(TAG_IS_MAIN_CAMERA)` query; `getMainAppCameraId()` (`kernel/camera/Camera.ts`)
  reads p612's cached id (default world only).
- p612 Phase 7: `CharacterTypes.ts:142`'s `{@link getBodyKind}` links nowhere (`yarn hub:build`
  warns): TypeDoc resolves a link in the file's scope, and the file doesn't import the name.
- p613 Phase 8 (`yarn hub:build`, from before p613; p610 Phase 7 listed them and left them):
  three `notExported` in `features/character/`, `CharacterBrainKinds` and `KindSpec` (named by
  `CharacterBrainSpec`, `ActorTypes.ts:106`) and `PlayerBrainCommonActions` (named by
  `DirectionalBrainActions`, `brains/PlayerBrains.ts:43`).

## From p611 (2026-10-14)

- **`physics()` has no stop:** `mountAekasha`'s `unmount()` (p611 Phase 3) stops the loop, the
  input, the assets worker and the renderer, but leaves a physics worker running.
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
    worker.
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
- **Recommendation: do it in this epic's engine major, which breaks physics' API anyway** (the
  `RayCastOpts` aliases above). An app that uses tiers adds `physicsTiers()` to `features` (the
  template does, for `physicsTiers`), a line in the migration guide; the scenes' manifests can't
  name it (tiers are code only, like physics). 4.2 KiB is small, but it's the "you only bring into
  existence what you need" principle at no cost to the apps that don't use tiers. If the major
  ships without it, leave `physics()` as it is: an option that doesn't shrink the build isn't
  worth an API.

## Done when

- Every file in scope reviewed against p600 §5, the findings fixed or filed (`docs/issues/` or a plan item).
- JSDoc coverage of the scope's public exports at 100% (p601's `docs.json`), members included; the ratchet raised.
- `yarn test`, `yarn verify:scenes` (snapshots and hashes unchanged unless stated), then `yarn verify:scenes --browser firefox` (p605 Phase 6: Firefox's hashes equal Chromium's), `yarn verify:baselines` (no unexplained growth), `yarn build`, `yarn hub:build`. The verify commands run for minutes to hours: when one starts, give the watch command, `tail -f .cache/verify/progress.log`.
- The Hub pages of the features in scope checked against the code; CLAUDE.md's nested files for them current.
