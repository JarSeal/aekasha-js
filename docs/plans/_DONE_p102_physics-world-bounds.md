Status: implemented (Phases 1-4; Phase 5 dropped)
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
- `getWorldBoundsStats()`: exit count for the current scene, last N exits. Used by the debug tab (Phase 3; as built: the definition and its source too, the last 20 exits).

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

### Phase 2 — Per-entity overrides and actions — done

From Phase 1 (see its As built): widen `WorldBoundsAction` and `OutOfBoundsSource` (`'ENTITY'`) in `types/PhysicsWorldBoundsTypes.ts`; the per-body map goes in `RapierWorldBounds.ts` beside the box (cleared by `clearWorldBounds` and by the body's delete); the handler is `PhysicsWorldBounds.ts`' `handleOutOfBounds`, its action from the entity's `WORLD_BOUNDS`, else the scene's def, else `'DELETE'` (the scene's def is in `sceneDefs`; keep the active one beside it). On `WORKER_THREAD` the proxy's cached `isEnabledSync` / `bodyTypeSync` don't know the backend disabled (or froze) the body: `'DISABLE'` and `'CALLBACK'` must refresh them, and allow for a jointed body made `FIXED`.

- `WORLD_BOUNDS` component, `setEntityWorldBounds`, `entityOpts.worldBounds`, `RIGID_SET_BOUNDS`, `IGNORE`.
- `'DISABLE'` and `'CALLBACK'` actions.
- Dev warning for overrides on fixed/kinematic bodies.
- Character default (§8).

As built (section 1, the overrides):

- **The create-time check is queued now**, not run inside `createRigidBody`: an override sent with the create would otherwise come after the check that already took the body out. `queueBodyCheck` (create, reattach, `setBodyWorldBounds`); `checkQueuedWorldBounds` runs right before each `step()` and at the start of a drain, so a record keeps Phase 1's step value (the count before the next step). Two Phase 1 tests changed: a body created outside is still enabled right after its create.
- **Backend:** `bodyBounds` (`Map<id, Float64Array | 'IGNORE'>`) in `RapierWorldBounds.ts`; a box open on every side is `'IGNORE'`; an unknown id is ignored, a detached one keeps its entry; the delete forgets it (`forgetBodyWorldBounds`), `clearWorldBounds` clears all. `setBodyWorldBounds` on `EngineAPIType`. The step check skips only when there are neither global nor per-body bounds.
- **Protocol:** `RIGID_SET_BOUNDS = 476` (the rigid switchboard gets `engAPI`, so the rigid range works, unlike Phase 1's world message), quiet for an unknown body; `CREATE_PHYSICS_ENTITY.worldBounds`. `createRigidBodyWithColliders`' third argument is an options object `{ tier, worldBounds }`. Wire types: `BodyWorldBounds` (`WorldBoundsBox | 'IGNORE'`).
- **ECS:** `WORLD_BOUNDS` in `ECSCoreComponents.ts` only (`ECSRegistry.ts` lists no core components). `setEntityWorldBounds` in `PhysicsWorldBounds.ts` (works on an entity without a body yet; a dead entity is a debug warning). Its hooks send when the entity owns a body; `createPhysicsEntity` sends the component in the create and again if it changed while the create was in flight; a failed create on a `target` restores the entity's previous `WORLD_BOUNDS`. `copyWorldBounds` / `toWireWorldBounds` / `toWireBodyWorldBounds` are in `PhysicsMessaging.ts` (so `PhysicsEntity.ts` uses them without a cycle). `installPhysicsWorldBounds` takes the `FeatureContext`.
- `EntityWorldBounds` has only the box and `ignore` so far: `action` and `onExit` come with section 2.

As built (section 2, the actions):

- **Types:** `WorldBoundsAction` is `'DELETE' | 'DISABLE' | 'CALLBACK'`; `WorldBoundsExitEvent` adds `world` and `frozen` to §3's sketch; `WorldBoundsExitCallback`. `onExit` is on `WorldBoundsDef` too (a scene-wide respawn; answers §11's question 2: the action is configurable per scene, in `AppConfig` and per entity). `'CALLBACK'` without `onExit` acts as `'DISABLE'` with a debug warning (a runtime rule, not a type union).
- **An entity override without any side** (`{ action: 'CALLBACK', onExit }`) follows the scene's box: only the action is its own (`toWireBodyWorldBounds` returns null for it). That's §8's character case. A box open on every side stays `'IGNORE'` in the backend's raw API.
- **Records:** `OutOfBoundsRecord.frozen` (the body was made `FIXED`). On `WORKER_THREAD` the delivery updates the proxy first (`RigidBodyProxyAPI._noteWorldBoundsExit`: `isEnabledSync` false, or `bodyTypeSync` `Fixed`).
- **The handler:** the action is the entity's `WORLD_BOUNDS.action`, else `activeDef` (the definition `applySceneWorldBounds` or a current-world `setSceneWorldBounds` applied last), else `'DELETE'`. `'DISABLE'` and `'CALLBACK'` remove `PHYSICS_TIER_POLICY` and drop a pending tier target (component writes, so no tiers module is imported). `'DISABLE'` is `world.setDisabled(id, true)`, but only the `DISABLED` component for a frozen body (setDisabled would disable a jointed body, i250). `'CALLBACK'` calls `onExit` in record order, a throw logged. Putting a body back is app code's (move inside, then `setEnabled(true)`, or `setBodyType` to `Dynamic` when frozen); no helper.
- **`INIT_PHYSICS`** sends the state with `worldBounds: null`: a config `onExit` can't be cloned, and the worker gets the box by `SET_WORLD_BOUNDS`.
- §11's question 1 (the spatial index while disabled): unchanged, `'DISABLE'` does what `world.setDisabled` does.

As built (section 3, the warning): the type checked is the one the body was created with (`PhysicsBodyOwner.rigidType`), so a `DYNAMIC` body a `STATIC` tier froze still gets its override. A fixed or kinematic body's override, or one on colliders without a body, isn't sent, and the debug env warns (`warnWorldBoundsNotChecked`, `PhysicsEntity.ts`), at the create or at the set; removing one warns about nothing. The component stays on the entity.

As built (section 4, the character default): no engine default, decided in Phase 2: a character follows the scene's bounds like any dynamic body (deleted by default), since a respawn needs a place only the app knows, and `'CALLBACK'` without `onExit` would leave an invisible player. `createCharacter` and `createDynamicCharacter` take a `worldBounds` option, passed to `createPhysicsEntity` (so it rides in the create); `createCharacterOfKind` takes none (a callback isn't data): `setEntityWorldBounds(character.entityId, …)` after. The Hub's physics page (World bounds: the entity's bounds, the actions) and characters page (Falling out of the level) are updated here rather than in Phase 4.

### Phase 3 — Debug tooling — done

- Physics API debug tab: a "World bounds" folder (`DebuggerPaneItem`s next to the others in `debug/_dbg__PhysicsTabFolders.ts`: the UI kit's property grid, compact density) with the active global box (monitors, source: config / scene / none), the exit count for the current scene and a list of the last exits (a `debuggerListCMP` list, clicking a row opens the entity's edit window, `_dbg__PhysicsEntityWindow.ts`).
- A toggle that draws the global box with the `lines()` feature (`createLines`), open sides clipped to a large finite size, and per-entity boxes for selected entities (the entity window's own toggle). Implementation in a `_dbg__` file, dynamically imported; without `lines()` installed, the toggle is left out.
- Optional: live editing of the scene's global box, stored as a debug override with an undo action (`registerUndoRedoActionHandler`, `src/_engine/debug/UndoRedo.ts`; the world settings' undo in `_dbg__PhysicsSettingsUndo.ts` is the pattern). Skip if it isn't needed.

As built (engine 6.22.0, unchanged: the branch's minor bump covers it):

- **`getWorldBoundsStats()`** (section 1) is in `PhysicsWorldBounds.ts`, not beside the facade's exit steps (`getOutOfBoundsExitSteps` is a body id → step map without names or actions), public on `aekasha/physics` as §3 lists it: `{ def, source, exitCount, recentExits }` (types `WorldBoundsStats`, `WorldBoundsSource`: `'SCENE'` (a scene's `null` included), `'CONFIG'`, `'NONE'`; `WorldBoundsExitInfo`), the last 20 exits, a new snapshot per call. `activeSource` is kept beside `activeDef`. `handleOutOfBounds` records every exit before its action (a deleted entity is still named; a body without a live entity as `body <id>` with a null entity and action); the name is the debug log's (`getExitName`), so it's computed in production too now. The count and list start over in `applySceneWorldBounds` (each scene's world), not in `resetPhysicsWorld`. `getActiveWorldBoundsDef` (`@internal`) is the definition without the snapshot's allocation, for the drawing.
- **The tab** (section 2): a new `debug/_dbg__PhysicsWorldBounds.ts` (the tab's folders module doesn't import the entity window, and the exits list opens it): the "World bounds (live)" folder after the tiers' (the box as text, its source and action, the exit count, the entities with `WORLD_BOUNDS`, the box toggle) and a "World bounds exits (latest 20)" list, **after** the entities' list: the scene runner's `debugger` script opens the physics entity window through row 0 of the tab's first list (`devTools/verify/scenes.config.ts`). Newest first; a row opens the entity's window while it's alive with a body in the default world, else it's dimmed with the reason in its tooltip.
- **The drawing** (section 3): `debug/_dbg__WorldBoundsDraw.ts`, imported **statically** (the tab already loads the lines modules through `_dbg__PhysicsDebugDraw.ts`, so a chunk of its own saves nothing; the streaming overlay does the same). A 2 px `FAT` line per box at 0.8 opacity, `depthTest: false`; each closed side a 10 × 10 grid, an open side not drawn, the closed sides reaching 250 m past the box's other side (or the origin). A `LATE_MAIN` system, registered on the first toggle, compares references per frame (the active definition, each entity's `WORLD_BOUNDS`: a set always stores a copy) and refills a line only on a change, so a scene change or a mid-scene set redraws by itself; an entity's line goes with the entity. The global toggle ("Draw the box (orange)") is saved as `worldBoundsBoxShown` in `PHYSICS_UI_LS_KEY` and turned on again at the tab's registration. The entity window's "World bounds" folder (bodies created `DYNAMIC` only, closed by default): the entity's own bounds as text (`describeEntityWorldBounds`, through `toWireBodyWorldBounds`) and "Draw its own box (magenta)"; the window's folder-state callback now saves only the wireframe folder's. Without `lines()` both toggles are left out.
- **Live editing** (section 4): skipped. The bounds are set in a scene's code, so an edit lasts until the reload unless kept as a new kind of debug override; Phase 4's scene JSON key is where they change without code.
- Checked in the gym (Chrome, WebGPU): with `{ min: { y: -50 }, max: { x: 5 }, action: 'DISABLE' }` set from the page, Suzanne exited and showed in the folder and the list, its row opened its window, and both boxes drew; no console errors.
- Tests: `PhysicsFacade.test.ts` (the stats: the source, names and actions, the 20 limit, the reset), `debug/_dbg__WorldBoundsDraw.test.ts` (the box and the entity's bounds as text).

### Phase 4 — Scene JSON — done

From Phase 3 (see its As built): a JSON key applied through `setSceneWorldBounds` reads as `source: 'SCENE'` in `getWorldBoundsStats` and the tab. If the tab should tell the JSON's bounds from code's, widen `WorldBoundsSource` (a public type: a value added). The tab's folder and drawing need nothing else: they follow `activeDef`.

- Optional `worldBounds` scene key, same shape as `WorldBoundsDef` without callbacks, as physics' part of the scene schema (a `FeatureSchemaPart`, `src/_engine/schemas/FeatureSchemas.ts`: a feature brings its own scene fields, the kernel's `SceneSchema.ts` imports none), so a scene that sets it names `physics` in its feature manifest (`devTools/gather/CLAUDE.md`).
- `gatherAppData` passes it through; physics' scene hook calls `setSceneWorldBounds`. The JSON Schema for editor autocomplete updates automatically.
- The Hub: the physics feature page (`hub/pages/features/physics/`) documents the bounds.

As built (engine 6.22.0, app 1.34.0, unchanged: the branch's bumps cover it):

- **The schema part** (section 1): physics had none, so `PhysicsSchema.ts` is new beside the feature: `SceneWorldBoundsSchema` (strict; each corner's `x` / `y` / `z` optional; `action` only `'DELETE'` or `'DISABLE'`: a callback is code, and a JSON `'CALLBACK'` would only act as `'DISABLE'`; a refinement fails an axis whose `min` isn't below its `max`, at `max.<axis>`) and `physicsSchemaPart` (feature `'physics'`, the scene field `worldBounds`, nullable), on `aekasha/schemas` with the type `SceneWorldBounds`, last in the gatherer's `ENGINE_SCHEMA_PARTS` (so `.schemas/`' property order moved for no other field). A `null` names no `physics` in the manifest (`isFieldUsed`): without physics there are no bounds to turn off. Nothing else in the gather changed: the part passes the key through.
- **The scene hook** (section 2): `beforeAssets` gets no scene data, so physics' new `sceneRegistered` hook (`registerSceneJsonWorldBounds`, `PhysicsWorldBounds.ts`) keeps a scene's JSON bounds as its own through `setSceneWorldBounds(def, sceneId)` (a missing key does nothing), and `applySceneWorldBounds` applies them to each of its worlds as before. A code `setSceneWorldBounds` for the scene replaces them, for its later visits too (decided: the JSON is the scene's starting definition, the code's call wins, as it did over nothing). `WorldBoundsSource` wasn't widened: both read `'SCENE'`. `SceneData.worldBounds` (`kernel/scene/Scene.ts`, `import type` of the schema's type).
- **The gym** moved its kill height from its code into its JSON (`thirdPersonGymScene.scene.json`); `getWorldBoundsStats` reads `{ min: { y: -50 } }`, `'SCENE'` there in the browser. Same box, applied in `beforeAssets` now rather than by the scene's code: no body starts outside it, so no step changes.
- **The Hub** (section 3): the physics page's World bounds has the JSON form and its rules; the scenes and assets page's feature manifest names `worldBounds`.
- Tests: `PhysicsSchema.test.ts`, `PhysicsFacade.test.ts` (the JSON's bounds over the config's, a `null`, a scene without the key, the code's replacing them), `gather.test.ts` (passed through, `null` too, the manifest, the refusals), `engineSchemas.test.ts` (the field list, the manifest).

### Phase 5 — Optional: non-physics entities — dropped

Dropped when the plan was closed: no use case has appeared. If one does, a plan of its own.

Only if a real use case appears. A main-thread system in `APP_LOGIC` for entities with `WORLD_BOUNDS` + `TRANSFORM` and no rigid body. Not deterministic-relevant, since those entities are not simulated.

---

## 10. Versioning

- Phases 1–4: engine **minor** bump each (new feature, non-breaking). Adding a field to `EVENTS_PUSH` is internal protocol, not public API.
- Phase 1 app change (gym kill-Y): app **minor** bump.
- Toolkit: unchanged.
- One `CHANGELOG.md` entry per merged branch, as usual.

---

## 11. Open questions

All answered:

1. Should `'DISABLE'` also remove the entity from the spatial index (`SPATIAL_INDEXED`) while disabled, or is hiding the `OBJECT3D` enough? Phase 2: unchanged, `'DISABLE'` does what `world.setDisabled` does.
2. Should the global default action be configurable per scene only, or also globally in `AppConfig` (the sketch allows both, via `WorldBoundsDef.action`)? Phase 2: both, and per entity; a scene's JSON takes `'DELETE'` or `'DISABLE'` (Phase 4).
3. Is a body's translation always the right test point, or does a very large body (eg. a long plank) need a `margin`? Left out: nobody has needed it.
