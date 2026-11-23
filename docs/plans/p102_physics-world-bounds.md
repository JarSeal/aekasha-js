Status: in progress | Phase 1 implemented
Category: Physics
Related: p101 scene-load determinism (implemented, see the Physics section of `.claude/CLAUDE.md` and `src/_engine/features/physics/CLAUDE.md`'s Deterministic scene loads: exits must happen on a fixed step, and the determinism probe must stay green), p500_restore-physics-snapshot.md (bounds are configuration, not simulation state, see §8), the `lines()` feature (`src/_engine/features/lines/`, `createLines`: Phase 3 draws the bounds with it), `src/_engine/features/physics/CLAUDE.md`'s Simulation tiers (p352, p343: the tiers and their distance policy, §8)

# Physics World Bounds (Kill Volume) — Plan

**Paths** are relative to `src/_engine/features/physics/` unless they say otherwise (its layout:
`src/_engine/features/physics/CLAUDE.md`).

Dynamic physics bodies that leave a defined region of the world are taken out of the simulation and handled: deleted by default, or disabled, or handed to a callback. A body that tunnels through a thin floor, gets launched by a bad impulse or rolls off the edge of a level currently falls forever: it keeps stepping, keeps syncing its transform, keeps a slot in the transform buffer (`maxBodies`) and never goes away until the scene is switched.

The feature has two layers:

- **Global bounds**: one region for the whole physics world. `AppConfig.physics.worldBounds` is the app-wide default, and each scene can register its own, which replaces the default while that scene is active.
- **Per-entity bounds**: an optional override on a single physics entity. It replaces the global region for that entity (it is not intersected with it), can exempt the entity completely (`ignore: true`) and chooses what happens on exit (`action`, `onExit`).

Off by default: with no bounds configured anywhere, nothing is checked and every existing scene behaves exactly as today. All phases are non-breaking.

---

## 1. Scope decisions

### 1.1 Which bodies are checked

Only **dynamic** rigid bodies (`BODY_DYNAMIC_VISUAL` and `BODY_DYNAMIC_HEADLESS`).

- Only the simulation can move a body somewhere unintended. Fixed bodies never move under simulation, and kinematic bodies are moved by app code, which already knows where it puts them.
- A per-entity bounds override on a fixed or kinematic body is ignored with a dev warning (`lwarn`, debug env only).
- Non-physics entities are out of scope for Phases 1–4. Phase 5 is an optional opt-in for them, only if a real use case shows up.

### 1.2 What "outside" means

- The test is the rigid body's **translation** (its origin) against an axis-aligned box. Not the collider AABB: cheaper, no shape dependency, and for a kill volume the difference does not matter.
- Every side of the box is optional. A missing side is open (±Infinity). The most common setup is a single kill height: `{ min: { y: -50 } }`.
- Because the outside of the box is unbounded, there is no tunnelling problem: a body that is outside after a step is caught on that step, however fast it moved.

### 1.3 What happens on exit

The engine side **always** does the same thing: it disables the body (`setEnabled(false)`) on the exact fixed step where it was found outside, and records an exit. The _action_ is main-thread ECS policy, applied when the record is delivered:

| `action`             | Main-thread result                                                                                                                     |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `'DELETE'` (default) | `world.deleteEntity(entityId)`. The existing `TAG_IS_PHYSICS_OBJECT` delete hook removes the (already disabled) body and colliders.    |
| `'DISABLE'`          | The entity stays. The body stays disabled, and its `OBJECT3D` (if any) is hidden. App code can re-enable it later.                     |
| `'CALLBACK'`         | `onExit(event)` is called. The body stays disabled; the callback decides (eg. teleport the player back to a checkpoint and re-enable). |

Splitting it this way keeps the engine side free of ECS and app concepts: it only knows geometry and body ids.

---

## 2. Why the check runs engine-side, per fixed step

p101 made scene loads deterministic, in both worker targets. A main-thread check in `APP_POST_PHYSICS` would break that: `APP_POST_PHYSICS` runs once per frame after 0–N sub-steps, so the step on which a body is removed would depend on frame timing, and the determinism probe's hash would differ between runs.

So the check runs right after each `engAPI.step()`, inside the backend (`backends/rapier/RapierWorld.ts`' `step`), in whichever thread the simulation runs:

- The body is disabled on the same fixed step in every run and in both worker targets, so the simulation itself stays deterministic.
- The **delivery** of the exit record to the main thread uses the existing event path (`flushPhysicsEvents`, at the start of the next sub-step, before `APP_PHYSICS_STEP`), with the same timing contract as collision events. That is already documented (`PhysicsMessaging.ts`, the root `CLAUDE.md`'s Physics), and gameplay code already relies on it.
- Headless bodies never sync to `TRANSFORM`. An engine-side check reads the real body pose, so it does not care.

### 2.1 Cost

- Global bounds unset and no per-body overrides: the check is skipped with one boolean test per step.
- Otherwise: Rapier's `World.forEachActiveRigidBody` (in the pinned `@dimforge/rapier3d-compat` 0.19.3 — verify the exact signature before building; the API's `WorldAPI` has it only commented out, in `types/PhysicsWorldTypes.ts`, and the backend calls Rapier directly). Sleeping bodies cannot move, so iterating only the active set is both correct and cheap. Per body: one map lookup for an override, then six float compares.
- Edge case: a body **created** asleep (`sleeping: true`) outside the bounds is never active, so it is never caught. Also run the check once when a dynamic body is created (engine-side, in the create path), which covers it.

---

## 3. API sketch

Types live in `types/` (engine-agnostic; the messages in `protocol/`) and `PhysicsEntity.ts` (ECS side); the public ones go on `aekasha/physics`.

```ts
/** A missing side (or a missing min/max) is open. */
export type WorldBoundsBox = {
  min?: { x?: number; y?: number; z?: number };
  max?: { x?: number; y?: number; z?: number };
};

export type WorldBoundsAction = 'DELETE' | 'DISABLE' | 'CALLBACK';

/** Global (config / per-scene) bounds. */
export type WorldBoundsDef = WorldBoundsBox & {
  /** Default 'DELETE'. Applies to every body without its own action. */
  action?: WorldBoundsAction;
};

/** Per-entity override: replaces the global bounds for this entity. */
export type EntityWorldBounds = WorldBoundsBox & {
  /** Exempt this entity completely (eg. the player, handled by its own respawn logic). */
  ignore?: boolean;
  action?: WorldBoundsAction;
  /** Required when action is 'CALLBACK'. Main thread only, never crosses the worker boundary. */
  onExit?: (e: WorldBoundsExitEvent) => void;
};

export type WorldBoundsExitEvent = {
  entityId: number;
  bodyId: number;
  /** The fixed step index the body was disabled on (getPhysicsSnapshotStepIndex scale). */
  step: number;
  /** Body translation on that step. */
  position: { x: number; y: number; z: number };
  source: 'GLOBAL' | 'ENTITY';
};
```

Public functions:

- `setSceneWorldBounds(def: WorldBoundsDef | null, sceneId?: string)` (`PhysicsEntity.ts`): per-scene registration. Default target is the loading scene, else the current one — the same rule as `registerSkyBox`. `null` explicitly turns bounds off for that scene even if `AppConfig` has a default.
- `setEntityWorldBounds(entityId: number, bounds: EntityWorldBounds | null, ecsWorld?)` (`PhysicsEntity.ts`): adds, replaces or removes the override.
- `createPhysicsEntity(..., entityOpts)`: `entityOpts.worldBounds?: EntityWorldBounds` as a shorthand for calling `setEntityWorldBounds` right after creation, applied before the creation promise resolves (so it is in place before the scene-load hold is released).
- `getWorldBoundsStats()`: exit count for the current scene, last N exits. Used by the debug tab (Phase 3).

---

## 4. Engine side (`backends/rapier/`)

State (on `RapierState.ts`' `backend`), all plain numbers so it is identical in both threads:

- `globalBounds: Float64Array(6) | null` — `[minX, minY, minZ, maxX, maxY, maxZ]`, open sides as ±Infinity.
- `bodyBounds: Map<bodyId, Float64Array(6) | IGNORE>` — per-body overrides. `IGNORE` is a shared sentinel.
- `pendingOutOfBoundsRecords: OutOfBoundsRecord[]` — `{ bodyId, step, x, y, z, source }`.

`step()` becomes: `physicsWorld.step(...)`, `drainAndDispatchEvents()`, then `checkWorldBounds(stepIndex)`. For every active dynamic body that is outside its effective box: `setEnabled(false)`, push a record. Disabled bodies are not active, so a body is reported once.

`resetPhysicsWorld` / world deletion (`RapierWorld.ts`) clears `globalBounds`, `bodyBounds` and the pending records. Deleting a body removes its `bodyBounds` entry.

Engine functions, exposed through the same `EngineAPIType` surface as the rest: `setWorldBounds(box | null)`, `setBodyWorldBounds(bodyId, box | 'IGNORE' | null)`, `drainPendingOutOfBoundsRecords()`.

### 4.1 Protocol (`protocol/`, the worker switchboards)

- `WORLD_SET_BOUNDS` in the world range (200-399, `worker/PhysicsSwitchWorld.ts`), `RIGID_SET_BOUNDS` in the rigid-body range (400-599, `worker/PhysicsSwitchRigid.ts`), each the next free number of its range (`PhysicsProtocolType.ts`). Both one-way, like the other setters (`commandWorker`).
- `EVENTS_PUSH` gets an `outOfBounds: OutOfBoundsRecord[]` field. `worker/PhysicsWorker.ts`' `pushPendingEvents` includes it and its "nothing to send" gate checks it too.

### 4.2 Main-thread delivery (`PhysicsMessaging.ts`)

The facade stays ECS-free. It gets `registerOutOfBoundsHandler(fn)`, and `flushPhysicsEvents` hands the records to it — MAIN_THREAD straight from the backend, WORKER_THREAD from the queued `EVENTS_PUSH` messages — after collision/contact-force dispatch, in record order. `PhysicsEntity.ts` registers the handler from physics' install (`PhysicsFeature.ts`; nothing registers at module load).

---

## 5. ECS side (`PhysicsEntity.ts`)

- **Body id → entity id map.** There is none today (storages are keyed by entity id). Maintain `bodyIdToEntityId` from the `onAddComponent` / `onRemoveComponent` hooks of `BODY_DYNAMIC_VISUAL` and `BODY_DYNAMIC_HEADLESS`.
- **`WORLD_BOUNDS` component** (core type in `kernel/ecs/ECSRegistry.ts` + `ECSCoreComponents.ts`, like `PHYSICS_SIM_TIER`) holding the `EntityWorldBounds`. Sparse: only entities with an override have it. Its add/remove hooks send `RIGID_SET_BOUNDS` (with `onExit` stripped — same pattern as `collisionEventFn`), and `onDeleteEntity` needs nothing extra because the body deletion clears the engine entry.
- **Out-of-bounds handler:** resolve `bodyId → entityId` (skip quietly if the entity is gone — same rule as stale collider events), pick the action (entity override, else the active global def, else `'DELETE'`), apply it per §1.3. Deletions are collected and run after the loop over the records.
- **Scene lifecycle:** physics' scene hooks (`physicsSceneHooks`, `PhysicsFeature.ts`) apply the scene's bounds (registered def, else `AppConfig.physics.worldBounds`, else none) in the `beforeAssets` hook right after `resetPhysicsWorld()`, before any `createPhysicsEntity` call, so the very first step of the scene already uses them. Registered scene defs are kept across visits (like sky boxes); per-entity overrides die with their entities.

---

## 6. Determinism probe (`debug/_dbg__PhysicsDeterminism.ts`)

The body is disabled on a fixed step, but its ECS entity is deleted when the record is delivered, which in `WORKER_THREAD` mode can be a frame later. If the probe freezes on or just after an exit step, one run may still see the entity and another may not.

Fix: the probe excludes every body with an exit record whose `step` is ≤ its target step, whether or not the ECS deletion has happened yet. `PhysicsEntity.ts` keeps the exit steps for the current scene (they are needed for the stats in Phase 3 anyway). Verify with `?physicsProbe=N` on a scene where bodies fall out on purpose, in both worker targets, with N set to just before, on and just after an exit, and keep `yarn verify:scenes`' probe hashes unchanged (all three targets).

---

## 7. Debug environment

- In debug env, each exit logs one `lwarn` with the entity's name/appId, position and step. An exit is usually a bug signal (a collider that is smaller than its mesh, a body spawned inside another), and today nothing tells you it happened.
- Phase 3 adds the visual and the tab section (§9).

---

## 8. Interaction with other systems

- **Characters** (`features/character/Character.ts`, `controllers/dynamic/DynamicCharacter.ts`) are created through `createPhysicsEntity`, so they are covered. A player character usually wants `action: 'CALLBACK'` (respawn) or `ignore: true`. The default `'DELETE'` is safe for them: deleting a character's entity any way runs the `CHARACTER` delete hook, which disposes its brain and controller (`src/_engine/features/character/CLAUDE.md`). Whether `createCharacter` should still default characters to `'CALLBACK'` (respawn rather than vanish) is a gameplay default. Decide in Phase 2.
- **Joints:** deleting a body that has joints goes through the existing body deletion path; nothing new. `'DISABLE'` leaves the joint in place with a disabled body on one end: document it.
- **Snapshots (p500):** bounds are configuration, not simulation state, so a Rapier snapshot does not contain them. When p500 is implemented, a restore must re-send the current global and per-body bounds (the ECS side is the source of truth). Add a line to p500 when this lands.
- **`maxBodies` / transform buffer:** deleting exited bodies frees their slots, which is a real benefit in long-running scenes with spawners.
- **Simulation tiers (p352, `src/_engine/features/physics/CLAUDE.md`'s Simulation tiers):** only `FULL` bodies are in the checked buckets. A `STATIC` or `DISABLED` tier body is in `BODY_STATIC` and a `REMOVED` one has no bucket, and none of them moves, so skipping them is right; the engine-side check must skip a detached body too. The catch is the engine side's own `setEnabled(false)` on exit: the tiers know only `world.setDisabled` ("a tier change keeps a world-disabled body disabled": `PhysicsTiers.ts`' `applyTier` and `returnToWorld`), so a later round trip through the `DISABLED` tier (from the app or the tier policy, `PhysicsTierPolicy.ts`) would re-enable an exited body on its way back to `FULL`. The exit record's handling must win: `'DISABLE'` goes through `world.setDisabled`, and an exited entity leaves the tier policy (`setPhysicsTierPolicyMember(id, false)`). Between the exit step and the record's delivery, a tier request for the body can still apply; it changes nothing that matters (the body stays out of bounds), but the record's action must not assume the body is still `FULL`.

---

## 9. Phases

Each phase compiles, lints and can merge on its own.

### Phase 1 — Global bounds, delete only — done

- Engine side (§4): `globalBounds`, `checkWorldBounds`, the create-time check, records, `WORLD_SET_BOUNDS`, `EVENTS_PUSH.outOfBounds`.
- The facade's delivery (§4.2).
- `PhysicsEntity.ts`: `bodyIdToEntityId`, the handler with `'DELETE'` only, `setSceneWorldBounds`.
- `AppConfig.physics.worldBounds?: WorldBoundsDef | null` (`types/PhysicsConfigTypes.ts`; default `null` in `PhysicsState.ts`, the defaults' one owner).
- The scene hook wiring (§5).
- Tests: the backend's check in `backends/rapier/EngineRapier.test.ts`, the delivery and the delete in `PhysicsFacade.test.ts` (`MAIN_THREAD`) and `PhysicsWorkerRequests.test.ts` (`WORKER_THREAD`).
- Debug log (§7) and the probe fix (§6).
- App: set a kill-Y in the third-person gym scene (`src/app/scenes/thirdPersonGymScene/`) as the first consumer; its probe and path hashes must not move.

As built (engine 6.22.0, app 1.34.0; branch `p102_physics-world-bounds`):

- **Backend** (`backends/rapier/RapierWorldBounds.ts`, a module of its own): the box, the pending records and the step check are module state there, not on `backend`; `backend.stepCount` (`RapierState.ts`) counts the current world's steps, since `step()` gets no step index. A record's `step` is that count after the exit step (the first snapshot showing the body disabled, `getPhysicsSnapshotStepIndex`'s scale); one found when the bounds are set or at a create gets the current count. The check iterates `forEachActiveRigidBody` through a new reverse map, `handleToRigidBodyId` (`RapierState.ts`, kept by create, delete, detach, reattach and `deleteWorld`), collects first and disables after Rapier's loop, and reads "inside" (a `NaN` translation is outside).
- **A jointed body is made `FIXED`, not disabled** (i250: Rapier mis-solves the joints of disabled bodies, and on `WORKER_THREAD` the delete lands a frame or more later). Phase 2's `'DISABLE'` and `'CALLBACK'` must allow for an exited body that is `FIXED` and enabled.
- **`setWorldBounds` checks every enabled dynamic body at once**, sleeping ones included, besides the create-time check: a scene's code runs after the `beforeAssets` hook, so its `setSceneWorldBounds` comes after its imports' bodies exist.
- **Protocol:** `SET_WORLD_BOUNDS = 8` in the ENGINE range (handled in `PhysicsWorker.ts` with `engAPI`; the WORLD switchboard gets only the `WorldAPI`, and the plan's world-range message would have needed a public `WorldAPI` method). `EVENTS_PUSH.outOfBounds` as planned.
- **Facade:** `setPhysicsWorldBounds` (`PhysicsWorld.ts`, plain data on the wire, a no-op without a world) and `setOutOfBoundsHandler` (one handler, `PhysicsMessaging.ts`; not `register…`: the standards pair that with `unregister`). Each exit's step is noted when it reaches the main thread (`getOutOfBoundsExitSteps`, the facade's, not `PhysicsEntity.ts`'), and `MAIN_THREAD` takes the backend's records into a queue of the facade's, so the probe can read the last step's exits while frozen. Both are dropped with the world (`clearPendingEventPushes`).
- **ECS side** in a new `PhysicsWorldBounds.ts` (`PhysicsEntity.ts` is at 633 lines): `setSceneWorldBounds`, `applySceneWorldBounds` (the `beforeAssets` hook, after `resetPhysicsWorld`) and `handleOutOfBounds`. No new `bodyIdToEntityId`: `PhysicsEntity.ts`' `bodyOwners` / `getPhysicsBodyOwner` already maps a body to its entity. `setSceneWorldBounds` applies at once when its scene's world is the current one (the loading scene, else the current), throws without a scene (as `registerSkyBox`), and stores a copy. `getWorldBoundsStats` is left for Phase 3.
- **Probe:** it waits for one `flushPhysics()` before hashing (on `WORKER_THREAD` the shared buffer is visible before the push carrying its exits is handled), and leaves out bodies whose exit step is at most its target; the second log line adds ", N out of the world bounds left out". Checked in the gym with three balls dropped past the ground's edge (a local edit, not committed; characters off): exits on steps 192, 210 and 227 in all three targets, and the same hash in all three targets and two runs each at N = 191, 192, 193 and 600. On 60 fps the worker got one step per frame there, so a step batch whose exits arrive after the buffer wasn't exercised.
- **Tests:** the worker harness's fake `self` needed `performance` (Rapier's step reads its clock through it; any `STEP` panicked with `unreachable`, on `main` too).
- **The gym:** `verify:scenes` against a baseline recorded on `main`: `mainThread`, `prodTest` and `debugger` pass (hash `84a78084`, character paths unchanged); the worker configurations' snapshots fail with or without the kill height (`main`'s worker recording was an odd run: `ca7ca2ad` against every other run's `84a78084`), so record them on `main` again.
- **Hub:** a World bounds section on the physics feature page now (the root's rule: a public API updates its page in the same branch), not only in Phase 4.

### Phase 2 — Per-entity overrides and actions

From Phase 1 (see its As built): widen `WorldBoundsAction` and `OutOfBoundsSource` (`'ENTITY'`) in `types/PhysicsWorldBoundsTypes.ts`; the per-body map goes in `RapierWorldBounds.ts` beside the box (cleared by `clearWorldBounds` and by the body's delete); the handler is `PhysicsWorldBounds.ts`' `handleOutOfBounds`, its action from the entity's `WORLD_BOUNDS`, else the scene's def, else `'DELETE'` (the scene's def is in `sceneDefs`; keep the active one beside it). On `WORKER_THREAD` the proxy's cached `isEnabledSync` / `bodyTypeSync` don't know the backend disabled (or froze) the body: `'DISABLE'` and `'CALLBACK'` must refresh them, and allow for a jointed body made `FIXED`.

- `WORLD_BOUNDS` component, `setEntityWorldBounds`, `entityOpts.worldBounds`, `RIGID_SET_BOUNDS`, `IGNORE`.
- `'DISABLE'` and `'CALLBACK'` actions.
- Dev warning for overrides on fixed/kinematic bodies.
- Character default (§8).

As built so far (section 1, the overrides; not committed yet):

- **The create-time check is queued now**, not run inside `createRigidBody`: an override sent with the create would otherwise come after the check that already took the body out. `queueBodyCheck` (create, reattach, `setBodyWorldBounds`); `checkQueuedWorldBounds` runs right before each `step()` and at the start of a drain, so a record keeps Phase 1's step value (the count before the next step). Two Phase 1 tests changed: a body created outside is still enabled right after its create.
- **Backend:** `bodyBounds` (`Map<id, Float64Array | 'IGNORE'>`) in `RapierWorldBounds.ts`; a box open on every side is `'IGNORE'`; an unknown id is ignored, a detached one keeps its entry; the delete forgets it (`forgetBodyWorldBounds`), `clearWorldBounds` clears all. `setBodyWorldBounds` on `EngineAPIType`. The step check skips only when there are neither global nor per-body bounds.
- **Protocol:** `RIGID_SET_BOUNDS = 476` (the rigid switchboard gets `engAPI`, so the rigid range works, unlike Phase 1's world message), quiet for an unknown body; `CREATE_PHYSICS_ENTITY.worldBounds`. `createRigidBodyWithColliders`' third argument is an options object `{ tier, worldBounds }`. Wire types: `BodyWorldBounds` (`WorldBoundsBox | 'IGNORE'`).
- **ECS:** `WORLD_BOUNDS` in `ECSCoreComponents.ts` only (`ECSRegistry.ts` lists no core components). `setEntityWorldBounds` in `PhysicsWorldBounds.ts` (works on an entity without a body yet; a dead entity is a debug warning). Its hooks send when the entity owns a body; `createPhysicsEntity` sends the component in the create and again if it changed while the create was in flight; a failed create on a `target` restores the entity's previous `WORLD_BOUNDS`. `copyWorldBounds` / `toWireWorldBounds` / `toWireBodyWorldBounds` are in `PhysicsMessaging.ts` (so `PhysicsEntity.ts` uses them without a cycle). `installPhysicsWorldBounds` takes the `FeatureContext`.
- `EntityWorldBounds` has only the box and `ignore` so far: `action` and `onExit` come with section 2.

### Phase 3 — Debug tooling

- Physics API debug tab: a "World bounds" folder (`DebuggerPaneItem`s next to the others in `debug/_dbg__PhysicsTabFolders.ts`: the UI kit's property grid, compact density) with the active global box (monitors, source: config / scene / none), the exit count for the current scene and a list of the last exits (a `debuggerListCMP` list, clicking a row opens the entity's edit window, `_dbg__PhysicsEntityWindow.ts`).
- A toggle that draws the global box with the `lines()` feature (`createLines`), open sides clipped to a large finite size, and per-entity boxes for selected entities (the entity window's own toggle). Implementation in a `_dbg__` file, dynamically imported; without `lines()` installed, the toggle is left out.
- Optional: live editing of the scene's global box, stored as a debug override with an undo action (`registerUndoRedoActionHandler`, `src/_engine/debug/UndoRedo.ts`; the world settings' undo in `_dbg__PhysicsSettingsUndo.ts` is the pattern). Skip if it isn't needed.

### Phase 4 — Scene JSON

- Optional `worldBounds` scene key, same shape as `WorldBoundsDef` without callbacks, as physics' part of the scene schema (a `FeatureSchemaPart`, `src/_engine/schemas/FeatureSchemas.ts`: a feature brings its own scene fields, the kernel's `SceneSchema.ts` imports none), so a scene that sets it names `physics` in its feature manifest (`devTools/gather/CLAUDE.md`).
- `gatherAppData` passes it through; physics' scene hook calls `setSceneWorldBounds`. The JSON Schema for editor autocomplete updates automatically.
- The Hub: the physics feature page (`hub/pages/features/physics/`) documents the bounds.

### Phase 5 — Optional: non-physics entities

Only if a real use case appears. A main-thread system in `APP_LOGIC` for entities with `WORLD_BOUNDS` + `TRANSFORM` and no rigid body. Not deterministic-relevant, since those entities are not simulated.

---

## 10. Versioning

- Phases 1–4: engine **minor** bump each (new feature, non-breaking). Adding a field to `EVENTS_PUSH` is internal protocol, not public API.
- Phase 1 app change (gym kill-Y): app **minor** bump.
- Toolkit: unchanged.
- One `CHANGELOG.md` entry per merged branch, as usual.

---

## 11. Open questions

1. Should `'DISABLE'` also remove the entity from the spatial index (`SPATIAL_INDEXED`) while disabled, or is hiding the `OBJECT3D` enough?
2. Should the global default action be configurable per scene only, or also globally in `AppConfig` (the sketch allows both, via `WorldBoundsDef.action`)?
3. Is a body's translation always the right test point, or does a very large body (eg. a long plank) need a `margin`? Suggestion: leave it out until someone needs it.
