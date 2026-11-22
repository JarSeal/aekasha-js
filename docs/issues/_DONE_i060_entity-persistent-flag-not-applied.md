**Title:** `persistent: true` on a camera, light or mesh entity doesn't keep it on a scene switch

Status: fixed | 2026-11-21, `createEntity` adds `PERSISTENT` for `persistent`, and a scene load reuses a JSON camera, light or mesh that's persistent and live
Category: ECS, Scenes
Found: 2026-10-21, p619 §1.4 S8 (read from the code); again 2026-10-22, p620 §1.4 N3 (W4: the start scene's camera JSON set it)
Our workaround: none needed so far: no scene relies on it (p620 removed the one flag a JSON set). An entity that must survive a switch gets the `PERSISTENT` component itself, as the debug camera does

## What happens

`CoreEntityOpts.persistent` (`schemas/_HelperSchemas.ts`, on every camera, light and mesh JSON's
entity options) reads "keeps the entity on a scene switch". `ECSWorld.createEntity` doesn't add
the `PERSISTENT` component for it, so the scene switch's wipe (`ECSWorld`'s clear, which keeps
the entities that have `PERSISTENT`) deletes the entity anyway. Only `createLines` and a
directional or spot light's target entity read the flag. p619 documented it on the field
(`@remarks`, and the JSON Schema's description) and left the fix.

## Why it's not a one-line fix

Adding `PERSISTENT` in `createEntity` makes the flag work, and then a scene that sets it leaks:
`createCameras` and the lights and meshes of a scene's JSON are created on every visit, so each
visit adds another persistent entity with the same `appId`. p620's W4 was that case (the start
scene's `mainCamera.camera.json`). So the fix needs one of:

- the scene load skips a persistent entity whose `appId` is already live (and reuses it), or
- `persistent` leaves the asset JSONs' options (code only), where the caller decides once.

Either is a kernel behaviour change for the ECS's owner, with a changelog line.

Instanced mesh pools inherit it: `CreateInstancedMeshPoolOptions.entityOpts` says it marks a long-lived pool `persistent`, but `createPoolMesh` (`features/instancing/InstancedMeshPool.ts`) adds no `PERSISTENT` either (found 2026-11-09, p354 Phase 1 step 4; `createInstanceSetAsync` adds it itself, as `createLineEntity` does).

## The fix

The first way out: the scene load reuses a persistent entity whose app id is live.

- **`ECSWorld.createEntity`** adds `PERSISTENT` when `opts.persistent`, so every creator has it
  (meshes, cameras, lights, groups, lines, instance sets, an instanced pool's meshes and the
  instances `spawn` makes with it). Lines, instance sets and the debug camera added it themselves:
  those lines went. A light's target is an entity of its own, created without the flag: it keeps
  its explicit add (the core `TARGET_LINK` hook would give it too, but only once the kernel's hooks
  are installed).
- **The scene load** (`kernel/scene/SceneDataLoader.ts`, `findLivePersistentEntity`): before it
  creates a JSON camera, light or mesh with `entityOpts.persistent`, it looks the entity's app id up
  (its props' `appId`, else `entityOpts.appId`); a live entity with it that has `PERSISTENT` is
  reused, as it is. A reused camera with `active` is made active again. A live entity with the id
  that isn't persistent is no reason to skip: the load creates one, and the duplicate id warns as
  before. A reused entity isn't in `createSceneObject3Ds`' returned ids.
- **The first load's props stay**: another scene's props, or its save entry, for the same id
  aren't applied (the rule i050 gave assets). Documented on the schema field and in the Hub's
  scenes and assets guide; no warning.
- **The gather** (`devTools/gather/sceneAssets.ts`, `checkPersistentAppIds`) fails on a persistent
  camera, light or mesh without an app id: every visit would give it a new generated one, so the
  load couldn't find it. A streaming scene's cut (`streamingManifest.ts`) keeps a persistent mesh
  or light in the base, where it's created with the scene: a cell deletes its own entities.
- **Found on the way:** `createCameraEntity` and `createLightEntity` never gave the entity their
  props' `appId`, though the schema says they do and the gather always writes one there (the file
  name by default): a JSON camera or light without `entityOpts.appId` had a generated id, so the
  load's look-up (and `getCameraByAppId`, `getLightByAppId`) missed it. Both now pass it, as
  `createMeshEntity` and `createGroupEntity` did.
- **The second way out** (`persistent` code only) wasn't taken: it removes a field from a public
  schema (a major), and leaves a JSON scene no way to keep a camera or light.
- Tests: `ECS.test.ts` (the component, kept by `clearNonPersistent`), `SceneDataLoader.test.ts`
  (a light, a mesh and a camera reused, the active camera back, a live entity that isn't
  persistent), `InstancedMeshPool.test.ts` (a persistent pool, its persistent instances, a LOD
  pool's level meshes), `gather.test.ts` (no app id fails for each kind; a streaming scene's
  persistent mesh and light stay in the base).
