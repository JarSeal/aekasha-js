Status: implemented (Phases 0-4)
Category: Physics
Epic: https://trello.com/c/8ROzNdXe/161-make-a-possibility-to-run-the-physics-engine-in-a-thread-threading-architecture-for-all-upcoming-thread-implemantations-not-just
Blocks: p512_client-prediction-and-reconciliation.md
Related: p510_headless-simulation-runtime.md (The multiplayer path: this plan is the prerequisite for client prediction and rollback), p250_physics-api-support-for-multibody-joints.md (a fourth rebind pass), _DONE_p102_physics-world-bounds.md (bounds are re-sent after a restore), `src/_engine/features/physics/CLAUDE.md` (the layout below)

# Restore Physics Snapshot — Plan

Makes snapshot capture/restore a working part of the engine-agnostic Physics API, in both
`MAIN_THREAD` and `WORKER_THREAD` modes, targeted at deterministic rewind/replay. A partial
skeleton for this already exists in the codebase and is dead, duplicated and incorrect — this
plan is mostly **repair**, not greenfield. The core problem is not the byte array (Rapier hands
that over in one call) but what happens to the API's own object graph afterwards: Rapier's
`World.restoreSnapshot()` returns a *brand new* `World`, so every cached WASM wrapper the engine
holds becomes stale, and the set of bodies in the restored world may no longer match the set the
API and the ECS still believe in.

## Context (grounded in code)

**Where it lives since p614 (2026-10-18).** The grounding below predates p608's move and p614's
split: its paths and line numbers are the old files'. The code it names moved as it was (p614
D12), so read each item at its new place, by name:

- `core/Physics/PhysicsAPITypes.ts` → `features/physics/types/` (`WorldAPI` and its four snapshot
  `@CHORE`s in `PhysicsWorldTypes.ts`, `EngineAPIType` in `PhysicsBackendTypes.ts`; the commented-out
  controllers are still in `PhysicsWorldTypes.ts`) and `protocol/` (`TAKE_SNAPSHOT = 2` /
  `RESTORE_SNAPSHOT = 3` in `PhysicsProtocolType.ts`, unchanged).
- `core/PhysicsAPI.ts` → the facade's modules: `takePhysicsSnapshot` / `restorePhysicsSnapshot`
  (with their `@TODO`s), `deletePhysicsWorld` and `initPhysics` in `PhysicsWorld.ts`; the id → API
  maps and the worker event-callback registries in `PhysicsRegistry.ts`; `transformBuffer` on
  `PhysicsState.ts`' `facade`; `messageWorker` / `messageWorkerAsync` in `PhysicsMessaging.ts`;
  `WorldProxyAPI` (its `_cache`) and `RigidBodyProxyAPI` in `proxies/`.
- `core/Physics/EngineRapier.ts` → `backends/rapier/`: the module-level `takeSnapshot` /
  `restoreSnapshot` (still the static `Rapier` import) in `RapierWorld.ts`; the id → handle maps,
  `handleToColliderId` / `handleToJointId`, `detachedBodies` and the `getRigidBody` / `getCollider` /
  `getJoint` resolvers in `RapierState.ts` (on its `backend` object or module-level); the
  `userData` writes (with `lockRotations*`) in `RapierBodies.ts`; the engine proxy classes, their
  `private rb` / `coll` / `joint` and `restoreSnapshotSync` / `takeSnapshotSync` in
  `proxies/Engine*ProxyAPI.ts`.
- `workers/physicsWorker.ts` → `features/physics/worker/PhysicsWorker.ts` (the snapshot cases);
  `physicsSwitchRigid.ts` / `physicsSwitchColl.ts` → `worker/PhysicsSwitchRigid.ts` (`allocateBodySlot`)
  / `PhysicsSwitchColl.ts`.
- `PhysicsManager.ts` → `features/physics/PhysicsEntity.ts` (the `BODY_*` writes,
  `physicsToTransformSystem`; `PhysicsTiers.ts` writes `BODY_STATIC` too) and
  `PhysicsInterpolation.ts` (the interpolation states, now with `resetPhysicsInterpolationHistory`
  per entity). `registerOnAllSceneEnterings` is gone: physics takes part in scene loads through its
  scene hooks (`physicsSceneHooks`, `PhysicsFeature.ts`), and `addVisibilityChangeFn` is
  `onVisibilityChange` (`kernel/loop/MainLoop.ts`).
- `core/Debug/_dbg__PhysicsAPI.ts` → `features/physics/debug/_dbg__PhysicsAPI.ts` (its folders,
  the UI kit's property grid since p806, in `_dbg__PhysicsTabFolders.ts`); `core/ECS.ts` →
  `kernel/ecs/ECS.ts`; `core/Character/DynamicCharacter.ts` → `features/character/controllers/dynamic/`
  (its user data read is `Floor.ts`' `getUserDataSync()`, the API-level data, which a restore
  keeps).

What p614 changed in what this plan relies on:

- **Fixed:** `deletePhysicsWorld` now clears the facade's maps and event registries
  (`clearPhysicsRegistry`, marking each API object `isBeingDeleted`), so the second pre-existing
  bug below is gone. `initPhysics`' always-truthy `worldCreated` is fixed (it reads the reply's
  field). A worker request now rejects on the worker's `ERROR` and on `stopPhysics`.
- **Transferables:** every message goes through a `PhysicsTransport` (`transport/`), whose `send`
  takes `transfer?`; the facade's `messageWorker*` still pass none (decision 9 stands).
- `restorePhysicsSnapshot` already calls `breakSimHistory()` (`PhysicsStepping.ts`), and the
  interpolation and the tier policy reset their histories on its epoch
  (`getPhysicsSimHistoryEpoch`): the `interpolationStates` item below no longer applies.

- **A dead, broken skeleton already exists, and nothing outside the physics files touches it.**
  `PhysicsProtocolType.TAKE_SNAPSHOT = 2` / `RESTORE_SNAPSHOT = 3`
  (`src/_engine/core/Physics/PhysicsAPITypes.ts:2705-2706`, ENGINE band 0–104);
  `takePhysicsSnapshot()` (`src/_engine/core/PhysicsAPI.ts:579-595`) and
  `restorePhysicsSnapshot()` (`:597-616`), both already branching on `workerTarget` and both
  carrying the `@TODO`s this plan closes; worker cases at
  `src/_engine/workers/physicsWorker.ts:114-121`. Because none of it is reachable from app code,
  **every signature named in this plan can be changed freely** — none is public surface yet.
- **There are two competing engine-side implementations.** Module-level `restoreSnapshot`
  (`Physics/EngineRapier.ts:737-743`) uses the static default import `Rapier` (`:1`) and returns a
  *new* `EngineWorldProxyAPI`; `EngineWorldProxyAPI.restoreSnapshotSync` (`:860-870`) uses the
  runtime-initialised `RAPIER` (`:81`, assigned `:165`) and returns `this`. Only the module-level
  one is actually reachable, via `EngineAPIType.restoreSnapshot` (`PhysicsAPITypes.ts:43`). Same
  duplication for `takeSnapshot` (`:735` and `:853-858`).
- **The type-level gap was already flagged.** Four `@CHORE: change the type to have the rb and
  coll data` markers sit on the `WorldAPI` snapshot methods (`PhysicsAPITypes.ts:1257, 1258, 1264,
  1265`). Design decision 5 resolves them.

### Rapier behaviour — verified against the shipped sources

All of the following was read out of the original TypeScript embedded in
`node_modules/@dimforge/rapier3d-compat/rapier.mjs.map` (version `0.19.3`, pinned exactly in
`package.json`), not inferred from documentation.

- **`World.restoreSnapshot()` can return `null`.** It delegates to
  `new SerializationPipeline().deserializeAll(data)` → `World.fromRaw(...)`, and `fromRaw` opens
  with `if (!raw) return null;` (`gen3d/pipeline/world.ts`). Neither current implementation guards
  this — both would assign `null` straight into the module-level `physicsWorld` and take the whole
  engine down on a corrupt or version-mismatched byte array. This is a real bug in the skeleton.
- **Handles are stable across a restore, but the JS-side lookup silently discards the
  generation.** `RigidBodySet`/`ColliderSet`/`ImpulseJointSet` constructors rebuild their `Coarena`
  from `raw.forEach*Handle((handle) => ... new Wrapper(..., handle))`, and the Rust arena's
  index+generation survives serde — so the numeric handle values in
  `EngineRapier.ts`'s id→handle maps stay valid and **need no remapping**. However,
  `Coarena.index()` (`gen3d/coarena.ts`) extracts only the **low 32 bits** of the handle; its own
  source comment reads *"`this.uconv[1]` then contains the generation number … which we don't
  really need."* Consequently `Coarena.get(staleHandle)` will **silently alias** onto whatever now
  occupies that arena index rather than returning null. The generation *is* still carried on the
  returned wrapper's own `handle` field, which gives an exact, O(1) staleness test:
  **`wrapper.handle === storedHandle`**. The entire delta computation in this plan hangs off that
  one comparison.
- **JS wrapper identity is not preserved.** The set constructors build `new RigidBody(raw, null,
  handle)` / `new Collider(this, handle, null)` / `ImpulseJoint.newTyped(...)` per handle. So the
  cached `private rb` / `private coll` / `private joint` fields on the three engine proxy classes
  (`EngineRapier.ts:1203` + ctor `1229-1234`; `:1620` + ctor `1631-1635`; `:1923` + ctor
  `1936-1939`) point at freed WASM memory immediately after a restore. These are captured once at
  construction and refreshed nowhere.
- **Gravity and `integrationParameters` ARE serialized** (`takeSnapshot` passes both into
  `serializeAll`). So timestep, `numSolverIterations`, `numInternalPgsIterations` and gravity can
  silently change out from under `WorldProxyAPI._cache` (`PhysicsAPI.ts:1325-1332`) and under
  `physicsState`.
- **`fromRaw` passes 9 of the constructor's 13 raw arguments.** `ccdSolver`, `physicsPipeline`,
  `serializationPipeline` and `debugRenderPipeline` are freshly allocated (so `step()` and
  `debugRender()` still work on the restored world), while `characterControllers`,
  `pidControllers` and `vehicleControllers` become new empty Sets. The new API exposes none of
  those — they are commented out at `PhysicsAPITypes.ts:1563-1605` — so this costs nothing here.
- **Rapier-side `userData` is write-only in the new API.** It is written at
  `EngineRapier.ts:281-292` (including the `lockRotationsX/Y/Z` mirror) and `:292`, and read
  **nowhere** in `core/Physics/`, `core/PhysicsAPI.ts` or `workers/` — every other `.userData` hit
  in those files is the proxy's own `this.uData` field or a constructor pass-through. The only
  reader in the repo is `core/Character/DynamicCharacter.ts` (the legacy
  `core/PhysicsRapier.ts` reader has since been removed). Rapier does not serialize `userData` — but because nothing reads it back, **no userData
  sidecar inside the snapshot is required.** The API-level `uData` lives on the engine proxy
  objects and therefore survives re-pointing for free. (This is worth stating explicitly because
  the sidecar is the obvious-looking design, and it is unnecessary here.)
- **`RigidBody.isValid()` → `rawSet.contains(handle)`**, which *does* check the generation
  Rust-side — useful as a belt-and-braces post-sweep check where the cheap handle comparison is
  not enough.

### Repo-side constraints

- **The engine's bookkeeping is id-keyed, with only two reverse maps.**
  `EngineRapier.ts:62-78` holds `rigidBodies`/`colliders`/`joints` (running id → handle),
  `rigidBodyAPIs`/`colliderAPIs`/`jointAPIs` (id → API), and `handleToColliderId`/
  `handleToJointId`. There is deliberately **no** `handleToRigidBodyId`, and this plan does not add
  one (Design decision 4).
- **Re-pointing is cheap because the proxy constructors already resolve the way the refresh pass
  needs to.** They call `getRigidBody(id)` / `getCollider(id)` / `getJoint(id)`
  (`EngineRapier.ts:106-135`), which go id → handle → `physicsWorld.getX(handle)`. After the world
  reference is swapped, those same resolvers return the new wrappers.
- **The main-thread facade keeps its own parallel state.** `PhysicsAPI.ts:181-183` id→API maps;
  `:191-192` worker event-callback registries; `:172` `transformBuffer`. `RigidBodyProxyAPI`
  (`:1787-1801`) bakes in `id` and `slot` at construction and reads pose from the transform buffer
  by slot — neither of which a restore disturbs.
- **Transform slots are allocated in the worker**, keyed by running id
  (`workers/physics/physicsSwitchRigid.ts:38-55`, freed at `:59-63`). Surviving bodies keep their
  slot for free; reaped ones must have it explicitly freed or the slot leaks and silently caps
  `maxBodies`.
- **ECS stores live API object references, not ids.** `PhysicsManager.ts:124-135`:
  `BODY_STATIC`/`BODY_DYNAMIC_VISUAL`/`BODY_DYNAMIC_HEADLESS` hold the `RigidBodyAPI` itself,
  `COLLIDER` holds the `ColliderAPI[]`. `physicsToTransformSystem` (`:152-177`) reads `rb.pos`/
  `rb.rot` off those stored objects every frame. **This is why Design decision 1 matters so much:
  if the proxy objects survive, the ECS needs no reconciliation at all for survivors.**
- **`PhysicsManager.ts:129-134` is the only code in the repo that writes a `BODY_*` component**
  (confirmed by repo-wide grep; the only other hits are the commented-out block at
  `ECS/ECSCoreComponents.ts:216-220` and read-only call sites). It wires from *creation params*, so
  reconciliation that needs to wire ECS from an already-existing `RigidBodyAPI` has no existing
  path to reuse. Two pieces that *are* reusable: the body-bucket array already enumerated at
  `core/Debug/_dbg__PhysicsAPI.ts:70-72`, and `ECSWorld.getRigidBody(entityId)`
  (`core/ECS.ts:776-782`), which already resolves "whichever of the three buckets this entity is
  in".
- **`interpolationStates` (`PhysicsManager.ts:195`) is module-private with no exported clear.** Its
  value-comparison change detection would read a restore as one enormous step and lerp across it.
- **`messageWorkerAsync` resolves with the entire down-message object**
  (`PhysicsAPI.ts:411` → `utils/PromiseResolver.ts:18-30`). That is why `initPhysics`'s
  `messageWorkerAsync<boolean>` + `if (worldCreated)` (`PhysicsAPI.ts:221-232`) is a latent
  always-truthy bug — the object is truthy regardless. Harmless today; **do not copy the shape.**
- **Transferables are already supported worker→main but not main→worker.**
  `physicsWorker.ts:187-201`'s `sendMessage` takes an optional `transfer?: Transferable[]`, and
  `physicsSwitchColl.ts:215-221` (`COLL_VERTICES`) is the canonical copy-then-transfer template.
  `messageWorker`/`messageWorkerAsync` (`PhysicsAPI.ts:328, 333`) have no transfer parameter — and
  per Design decision 9 they deliberately still won't.

- **Detached bodies (p352's `REMOVED` tier) are a fourth kind.** `detachRigidBody`
  (`EngineRapier.ts`) takes a body and its colliders out of the Rapier world but keeps their ids
  and proxies in `detachedBodies`, and `reattachRigidBody` puts them back with `_rebind()` (the
  method decision 2 describes, already on the body and collider proxies). A restore must neither
  reap them (they aren't in the snapshot, but they aren't gone) nor count them as survivors, and
  a snapshot taken while one is detached doesn't contain it.

### Pre-existing bugs this plan folds in

- **Neither `restoreSnapshot` frees the world it replaces** — a whole `Rapier.World` leaks per
  restore.
- **`deletePhysicsWorld()` (`PhysicsAPI.ts:554-577`) never clears the main-thread maps.** It resets
  `physicsWorldEnabled` and `physicsWorld` but leaves `rigidBodies`/`colliders`/`joints`
  (`:181-183`) and the event registries (`:191-192`) populated, so a delete→create cycle
  resurrects stale proxies.

## Design decisions

1. **Restore re-points the existing proxy objects; it never recreates them.** Because handles are
   stable, every surviving object keeps its running id, its engine proxy instance, its main-thread
   proxy instance, its transform-buffer slot, its event registrations, and therefore its ECS
   component reference. The only thing that must change is the cached WASM wrapper inside the three
   engine proxy classes. Verified hop by hop: `PhysicsAPI.ts:641` stores the identical
   `EngineRigidBodyProxyAPI` instance the ECS component holds in `MAIN_THREAD` mode, and
   `RigidBodyProxyAPI` in `WORKER_THREAD` mode stores only `id` + `slot`, neither of which a restore
   touches. **ECS reconciliation for survivors is therefore zero work**, which is what keeps the
   rewind/replay path cheap.
2. **Rebinding is exposed as one `/** @internal */ _rebind(raw)` method per proxy class, not by
   relaxing `private`.** `_rebind(rb: Rapier.RigidBody)` on `EngineRigidBodyProxyAPI`,
   `_rebind(coll: Rapier.Collider)` on `EngineColliderProxyAPI`, `_rebind(joint:
   Rapier.ImpulseJoint)` on `EngineJointProxyAPI`. These are not added to the public
   `RigidBodyAPI`/`ColliderAPI`/`JointAPI` interfaces — they are engine-internal and called only by
   the refresh pass in the same module. Keeps the fields private and the public surface unchanged.
3. **Restore has *intersection* semantics, and that is the contract.** After a restore the world
   contains exactly `{objects alive at snapshot time} ∩ {objects the API still knows about}`:
   - **Survivors** (in both) — rebound. Exact, and free.
   - **Reaped** (known to the API, absent from the snapshot — i.e. created after it) — removed from
     every engine map and every main-thread map, transform slot freed, ECS entity deleted.
   - **Orphans** (present in the snapshot, no longer known to the API — i.e. deleted since) —
     removed from the restored world by default (`orphanPolicy: 'DELETE'`). Keeping them would
     produce invisible bodies that collide with the live scene and are unreachable from any API
     handle. `orphanPolicy: 'KEEP'` exists as the escape hatch for a future resurrection feature.

   This is the only semantics that is exact and free in the common case (membership unchanged),
   never leaves a dangling reference or an invisible collider, and requires no data Rapier does not
   already provide.
4. **No sidecar manifest, and no fourth reverse map.** This falls out of the generation test above.
   The delta is computed entirely from the restored world plus the existing id→handle maps, in one
   O(n) walk per restore:

   ```
   for each [id, handle] of rigidBodies:
     const w = newWorld.getRigidBody(handle);
     (w && w.handle === handle) ? survivor → api._rebind(w) : reaped
     claimed.add(handle)
   then: newWorld.bodies.forEach(rb => if (!claimed.has(rb.handle)) → orphan)
   ```

   The `claimed` set is local to the function and thrown away — cheaper and less error-prone than
   maintaining a persistent `handleToRigidBodyId`.
5. **`takeSnapshot()` returns a `PhysicsSnapshot` object, not a bare `Uint8Array`.** This is exactly
   what the four existing `@CHORE`s ask for, and it is free because nothing outside the physics
   files calls these methods:

   ```ts
   export type PhysicsSnapshot = {
     /** Rapier's own serialized world state. */
     bytes: Uint8Array;
     /** Which world instance produced this. Restoring into a different world is rejected. */
     worldEpoch: number;
     /** Capture timestamp, for debug UI and ordering. */
     takenAt: number;
   };
   ```

   `worldEpoch` is a module-level counter in `EngineRapier.ts`, incremented in `createWorld`
   (`:183-206`) and `deleteWorld` (`:704-733`); restore throws on a mismatch. **Without this guard,
   restoring a snapshot taken before a `deletePhysicsWorld()`/`createPhysicsWorld()` cycle would
   reap every live body and silently wipe the scene** — the hardest failure mode in this feature to
   diagnose after the fact.
6. **Rapier-side `userData` gets a cheap private mirror on the rigid-body proxy, re-applied by
   `_rebind()`.** Add `private rapierUserData?: Record<string, unknown>` to
   `EngineRigidBodyProxyAPI`, populated where `createRigidBody` already writes `rigidBody.userData`
   (`EngineRapier.ts:281-292`, including the `lockRotations*` keys). This is belt-and-braces, **not
   load-bearing** — per the Context section nothing in the new API reads it back — and it is about
   six lines. Colliders and joints need nothing: `createCollider` (`:467`) and `createJoint`
   (`:555`) only pass userData to the proxy's `uData`, never to Rapier.
7. **Cached world parameters are refreshed from the restored world, not assumed unchanged.**
   Because gravity and integration parameters are serialized, `RestoreSnapshotDelta` carries
   gravity/timestep/solver iterations read back off the restored world, and the facade writes them
   into `WorldProxyAPI._cache` (`PhysicsAPI.ts:1325-1332`) and `physicsState`. In `WORKER_THREAD`
   mode, **keep the existing `WorldProxyAPI` instance and refresh its cache** — do not
   `new WorldProxyAPI()` as `PhysicsAPI.ts:613` does today, which throws the cache away.
8. **There is exactly one engine-side implementation.** Keep the exported module-level
   `restoreSnapshot()` (it is what `EngineAPIType.restoreSnapshot` and the worker call) as the
   single implementation; `EngineWorldProxyAPI.restoreSnapshotSync` (`:860-870`) becomes a one-line
   delegation to it. Same for `takeSnapshot` (`:735`, `:853-858`). Standardise on `RAPIER`, the
   runtime-initialised namespace.
9. **Snapshot bytes are structured-cloned main→worker, and transferred worker→main.** This reverses
   the intuitive choice, so it is recorded as a decision: transferring main→worker would **neuter
   the caller's copy**, which breaks the primary use case of restoring the *same* snapshot
   repeatedly (rollback, reset-to-checkpoint, replay scrubbing). So `messageWorker`/
   `messageWorkerAsync` stay untouched — no new transfer parameter, no new pattern, no
   main→worker transferables introduced anywhere. Worker→main (`TAKE_SNAPSHOT` response) uses the
   existing `sendMessage(msg, data, false, [bytes.buffer])` support, following the `COLL_VERTICES`
   template. Snapshots are megabyte-scale, but the operation is rare rather than per-frame.
10. **The old `Rapier.World` is freed, in this exact order:** capture `old` → assign
    `physicsWorld = newWorld` → run the full rebind and orphan sweep against `newWorld` →
    `old.free()`. Freeing last keeps the failure mode benign if the sweep throws. Note one
    unavoidable upstream leak: Rapier never frees the temporary `SerializationPipeline` it
    allocates inside `World.restoreSnapshot` (a few hundred bytes per call). Document it; do not
    reimplement `restoreSnapshot` to work around it.
11. **"Coherent restore requires the ECS scene to be at the same point" is an explicit constraint,
    not a bug.** Restoring is *exact* only when no physics entity was created or deleted since the
    snapshot. Otherwise decision 3's pruning runs, which is safe and deterministic but is not a
    rewind: entities created since are destroyed, and entities deleted since do not come back. Full
    scene rewind is a non-goal (see below). In debug builds, a restore that produces a non-empty
    reaped or orphan set emits an `lwarn` naming the counts, so this never happens silently.
12. **The interpolation history is reset on restore**, which `restorePhysicsSnapshot` already
    does (`breakSimHistory()`: the interpolation and the tier policy reset on its epoch), so no new
    export. Resetting rather than patching is correct because the interpolation re-seeds
    `prev == curr` from the restored pose, so the restored frame renders with zero smear.
13. **The worker writes transforms back immediately at the end of the restore handler.** Otherwise
    `RigidBodyProxyAPI.pos`/`rot` keep serving pre-restore poses out of the transform buffer until
    the next `STEP` — which in a paused world is forever. The `RESTORE_SNAPSHOT` case calls the
    existing `writeBackTransforms()` and `writeBackDebugState()` (`physicsWorker.ts:205-262`) before
    replying. In `MESSAGE_BATCH` mode this also pushes the fresh buffer, which is what makes
    `useSAB: false` behave identically to `useSAB: true`.
14. **The debug-state tracked-id arrays are NOT mutated on restore.**
    `debugTrackedRigidBodyIds`/`debugTrackedColliderIds` (`physicsWorker.ts:36-37`) are positional —
    index *is* slot — so removing reaped ids would shift every subsequent slot and mis-colour the
    wireframes. `writeBackDebugState` already zeroes the flags for an id whose API is gone, which is
    the correct rendering for a reaped object, and the debug layer re-declares the full set on its
    own cadence via `setPhysicsDebugStateTracking`.
15. **Restore is announced through a registration hook, not a direct import.** `PhysicsEntity.ts`
    imports the facade's modules, so the reverse call has to be inverted (the facade's imports are a
    DAG with state in leaf modules: a cycle reads a binding before its module ran). Add
    `onPhysicsRestore(fn)`, returning its remover (the `on*` naming rule), plus the dispatch in
    `PhysicsWorld.ts`, like `onVisibilityChange` (`kernel/loop/MainLoop.ts`). Physics' install
    (`PhysicsFeature.ts`) registers `PhysicsEntity.ts`' reconciler there, never at module load.
16. **Determinism is documented, not guaranteed.** Two separate caveats, and neither should be
    overstated in either direction:
    - *Restoring state is not the same as reproducing a run.* A snapshot restores physics state
      only. Replaying forward from a restored point reproduces the original trajectory **only if
      the caller also replays its own per-frame inputs** — applied forces and impulses, body
      creation and deletion, parameter changes — in identical order. That is the consumer's
      responsibility, and it is the most likely way a rewind feature silently "doesn't work".
    - *Cross-build/cross-platform determinism is evidence, not a guarantee.* Rapier guarantees it
      only for its deterministic build (`@dimforge/rapier3d-deterministic-compat`); we ship the
      compat build. p604 measured the compat build anyway: a recorded `physicsTiers` run (1,200
      steps, 687 bodies, tier changes) came out bit for bit the same in Chromium, Firefox, Node and
      on an Android phone, x86-64 and ARM, Rapier snapshot bytes included. Not covered: joints,
      trimesh and convex colliders, CCD, iOS / Safari. The two builds disagree with each other, so
      every peer runs the same one (p510's multiplayer rule 9). Phase 1's check covers
      restore-then-replay on one machine.

## New / changed types (`Physics/PhysicsAPITypes.ts`)

```ts
export type PhysicsSnapshot = { bytes: Uint8Array; worldEpoch: number; takenAt: number };

export type RestoreSnapshotOpts = {
  /** What to do with objects that existed at snapshot time but are no longer known to the
   *  API (deleted since). 'DELETE' (default) removes them from the restored world. */
  orphanPolicy?: 'DELETE' | 'KEEP';
};

/** Everything the caller needs to reconcile after a restore. Identical in both thread modes. */
export type RestoreSnapshotDelta = {
  /** Known to the API but absent from the snapshot — created after it. Now destroyed. */
  reapedRigidBodyIds: number[];
  reapedColliderIds: number[];
  reapedJointIds: number[];
  /** Present in the snapshot but unclaimed — deleted since. Removed unless orphanPolicy: 'KEEP'. */
  orphanCounts: { rigidBodies: number; colliders: number; joints: number };
  /** Read back off the restored world — Rapier restores these. */
  gravity: PhysVector;
  timestep: number;
  solverIterations: number;
  internalPgsIterations: number;
};

export type RestoreSnapshotResult = RestoreSnapshotDelta & { world: WorldAPI };
```

Signature changes:

- `EngineAPIType.takeSnapshot` (`:42`) → `() => PhysicsSnapshot | undefined`
- `EngineAPIType.restoreSnapshot` (`:43`) → `(snapshot: PhysicsSnapshot, opts?: RestoreSnapshotOpts) => RestoreSnapshotResult`
- `WorldAPI.takeSnapshot`/`takeSnapshotSync` (`:1257-1258`) → `Promise<PhysicsSnapshot | undefined>` / `PhysicsSnapshot | undefined`
- `WorldAPI.restoreSnapshot`/`restoreSnapshotSync` (`:1264-1265`) → `(snapshot, opts?) => Promise<RestoreSnapshotResult>` / `RestoreSnapshotResult`
- Protocol UP `RESTORE_SNAPSHOT` (`:1962-1965`) → `{ type; snapshot: PhysicsSnapshot; opts?: RestoreSnapshotOpts }`
- Protocol DOWN `TAKE_SNAPSHOT` (`:2383-2386`) → `snapshot: PhysicsSnapshot | undefined`
- Protocol DOWN `RESTORE_SNAPSHOT` (`:2387-2390`) → `{ type; worldCreated: boolean } & RestoreSnapshotDelta`

All four `@CHORE` comments at `:1257-1265` are deleted as resolved.

## Phases

Each phase compiles clean, leaves the repo working, and is separately reviewable/committable.

**Phase 0 — Reconcile the duplicates and fix the pre-existing bug — done.** Small and
self-contained, no new feature. In the backend (`RapierWorld.ts`, `proxies/EngineWorldProxyAPI.ts`):
collapse to one implementation per design decision 8, add the `free()` of the replaced world per
decision 10, and add the `if (!newWorld) throw` guard for the `null` return. The
`deletePhysicsWorld()` half is done (p614: `clearDeletedWorld` clears the registry, the event
pushes and `transformBuffer`); left there: `debugStateBuffer` and `resolvedTransportMode`, if a
later world shows them stale.

Manual verification: `physicsTest.ts` behaves exactly as before. From the console, run
`deletePhysicsWorld()` then `createPhysicsWorld()` and confirm the physics debugger tab's entity
list shows no stale entries. Both `workerTarget` modes.

As built (Phase 0):

- `RapierWorld.ts`' `takeSnapshot` / `restoreSnapshot` are the one implementation;
  `EngineWorldProxyAPI`'s four snapshot methods delegate to them. That import makes a cycle
  `RapierWorld` ↔ `proxies/EngineWorldProxyAPI` (calls inside methods only, like the facade's
  `PhysicsWorld` ↔ `WorldProxyAPI`). The static `Rapier` import is now `import type`; the restore
  uses `backend.RAPIER`.
- **A restore keeps the world's API object** (decision 1 at the backend level):
  `EngineWorldProxyAPI` holds no per-world state (it reads `backend.world`), so `restoreSnapshot`
  returns the existing `physicsWorldAPI` instead of making a new one. The worker's
  `physicsWorldAPI = engAPI.restoreSnapshot(...)` gets the same object back.
- Restore order: no world → throw; `World.restoreSnapshot` → `null` → throw (the world is left as it
  was); swap `backend.world` with `restoringWorld` set (a `try` / `finally`, where Phase 1's rebind
  and sweep go); `free()` the replaced world last (decision 10).
- `takeSnapshot` returns `undefined` without a world (it threw on the no-op stub), and
  `deleteWorld` without a world is a quiet no-op (it threw freeing the stub).
- Tests: `EngineRapier.test.ts`' "EngineRapier snapshots (p500)" (no world, the API object kept and
  the old world freed, restore twice from one snapshot, `null` from Rapier).
- The facade's `debugStateBuffer` and `resolvedTransportMode` aren't touched: the next world's
  create (`resolvedTransportMode`) and tracking call (`debugStateBuffer`) set them again.

**Phase 1 — Engine-side capture/restore and the rebind pass, `MAIN_THREAD` end to end — done.** Add the
new types (but not yet the protocol union members). In `EngineRapier.ts`: add `worldEpoch` next to
`worldCreated` (`:79`) and bump it in `createWorld`/`deleteWorld`; implement `takeSnapshot()`
returning the envelope; implement `restoreSnapshot(snapshot, opts)` as — epoch guard → restore and
null-check → swap the world reference → the decision-4 rebind/claim walk over rigid bodies, then
colliders, then joints → reaped bookkeeping mirroring what `deleteRigidBody` (`:571-613`) already
does, including `cleanupColliderEventRegistrations` (`:631-637`) → orphan sweep in the order bodies,
colliders, joints → `isValid()` safety net promoting anything that went invalid into the reaped sets
→ `eventQueue?.clear()` (the queue at `:82` may hold pre-restore handles) → `old.free()` → return
the delta with world params read off the restored world. Add `_rebind()` to the three proxy classes
and `rapierUserData` to the rigid-body one. In `PhysicsAPI.ts`: rewrite `takePhysicsSnapshot`/
`restorePhysicsSnapshot` around a single private `applyRestoreDelta(delta)` that runs identically
in both modes (prune the three maps, call the existing `cleanupWorkerColliderEventFns` per reaped
collider, write world params into `physicsState`, fire the decision-15 hooks); wire the
`MAIN_THREAD` branch only; add `onPhysicsRestore` and an `isRestoringSnapshot` guard that
makes `stepPhysics` (`PhysicsStepping.ts`) early-return and reset its accumulator while a restore
is in flight (or holds stepping, as a scene load does with `holdPhysicsStepping`).

Manual verification (`?isDebug=true`, `physicsTest.ts`, `MAIN_THREAD`): take a snapshot, let the
bodies fall, restore → everything snaps back and the meshes follow; delta is all-empty. Then create
a new physics entity and restore → it shows up in `reapedRigidBodyIds` and its collider in
`reapedColliderIds`. Then delete an entity and restore → `orphanCounts.rigidBodies === 1` and a
raycast where it was hits nothing. Restore twice from the same snapshot → identical result both
times (this is what proves decision 9's no-transfer stance and the `old.free()` ordering).
**Also run the decision-16 determinism check here**: capture, step N, record poses; restore, step N
again, compare. Record the outcome in this document.

As built (Phase 1):

- **The types** are in `types/PhysicsWorldTypes.ts` and exported from `aekasha/physics`, because
  `WorldAPI` (public) names them. That makes the `WorldAPI` snapshot signatures a public API change
  (the API baseline shows it). `PhysicsSnapshot` is `{ bytes, worldEpoch, step }`: **`takenAt` became
  `step`**, the backend's step count at capture. The physics files ban the wall clock (the
  simulation lint), the step orders snapshots as well, and a restore puts it back.
  `RestoreSnapshotDelta` also carries `maxCcdSubsteps` (p622 added it to the world settings) and
  `step`.
- **The protocol unions changed here, not in Phase 2:** the worker case has to compile against the
  backend's new signature. It passes `snapshot` and `opts` and replies with the delta; freeing slots
  and the write-back are still Phase 2's. Until then the facade's `WORKER_THREAD` restore throws
  (`takePhysicsSnapshot` works in both targets).
- **The backend:** the walk is in its own module, `backends/rapier/RapierRestore.ts`
  (`rebindRestoredWorld`). `RapierWorld.ts`' `restoreSnapshot` runs: no world → epoch guard → Rapier
  restore and the `null` check → swap `backend.world` → the walk → `backend.stepCount =
  snapshot.step` → `free()` the replaced world. `worldEpoch` is bumped by `createWorld` and
  `deleteWorld`. The walk:
  - claims bodies, then colliders, then joints with the handle test, rebinding each survivor;
  - forgets the reaped ones: their ids, reverse handles, a body's own world bounds, a collider's
    event registrations;
  - collects the orphans of all three kinds, then removes them (bodies first);
  - checks every survivor with `isValid()`: a failure is reaped, with an `lerror` in debug builds;
  - clears the event queue, the undelivered collision and contact-force records
    (`clearPendingEventRecords`) and the undelivered world-bounds exits
    (`clearPendingOutOfBoundsRecords`);
  - queues every survivor for a world-bounds check (the bounds may have changed since the snapshot,
    and a body restored asleep is never checked).

  The D11 `lwarn` is in the backend (`backend.isDebugEnvironment`), so both targets log it.
- **Decision 6 changed:** Rapier's `userData` isn't write-only after all: `detachRigidBody` reads it
  and `reattachRigidBody` writes it back. Instead of a private mirror, the restore's
  `_rebind(rb, true)` copies it from the old wrapper (a JS field, readable before the `free()`).
  `EngineJointProxyAPI` got its `_rebind`; the body and collider proxies already had one (p352).
- **The world bounds (risk table):** the backend keeps the global box and the bodies' own bounds
  (by id) through a restore, `handleToRigidBodyId` needs no rebuild (handles are stable; the reaped
  entries are removed), and `backend.stepCount` goes back to the snapshot's. So nothing is re-sent
  from the ECS side.
- **The facade:** `applyRestoreDelta` (`PhysicsWorld.ts`):
  - forgets the reaped objects (`forgetRigidBody` / `forgetCollider` / `forgetJoint`: marked
    `isBeingDeleted`, the worker callbacks dropped);
  - writes the world settings into the physics state only where they differ at f32 (Rapier stores
    f32, so an unchanged read-back would overwrite the state's doubles);
  - **rewinds the step clock to the snapshot's step** (`resetSimClock(step)`, which now takes one,
    and `dropStepAccumulator`). The plan didn't have this: `getPhysicsSubStepIndex` is the
    simulation code's clock (the tier policy's cadence, the characters' durations), so a replay has
    to run on the same step numbers. It drops the step gates and bumps both epochs, as a new
    world's reset does;
  - calls the hooks (`onPhysicsRestore`, a `Set`, each in a `try`).

  `facade.isRestoringSnapshot` makes `stepPhysics` return 0 and drop the accumulator. On
  `MAIN_THREAD` the restore is synchronous, so the guard is for Phase 2.
- **Bypass:** `facade.world` on `MAIN_THREAD` is the engine's world proxy, so app code's
  `getPhysicsWorld().restoreSnapshot()` bypasses the facade (no registry pruning, no step clock, no
  hooks), as the world's own creates do. `WorldAPI`'s `@remarks` say so. On `WORKER_THREAD` the
  proxy goes through the facade.
- **Known limit (intersection semantics):** a body detached (`REMOVED` tier) at snapshot time and
  reattached since isn't in the snapshot, so it's reaped, and Phase 3 will delete its entity. A body
  detached since the snapshot stays detached, and its copy in the snapshot counts as an orphan.
- **Determinism (D16), the outcome:** `EngineRapier.test.ts` drops 12 balls into a pile, steps 20,
  snapshots, steps 120 and records every pose; then restores and steps 120 again. The poses are bit
  for bit the same (Node, the compat build, Rapier 0.19.3). Restoring twice from one snapshot gives
  the same state too.
- Tests: `EngineRapier.test.ts`' "EngineRapier snapshots (p500)":
  - the epoch guard, the API objects kept and the replaced world freed, the `null` bytes;
  - the step count and the settings carried;
  - survivors, reaped (bodies, colliders, joints), orphans with `DELETE` and `KEEP` (raw Rapier ray
    casts, with a hit control: Rapier's queries see a collider only after a step);
  - the handle generation (a body made at a deleted body's index), a joint rebound with the user
    data kept, a detached body, and the determinism check above.

  `PhysicsFacade.test.ts`' three p500 tests: the reaped objects forgotten before the hooks run, the
  step clock rewound, the hook's remover; the settings, the doubles kept; another world refused,
  nothing changed.
- The manual browser checks ran in Phase 4, from its tab (see its As built), all passing.

**Phase 2 — Worker protocol — done.** Add the three protocol union changes. In `physicsWorker.ts`:
`TAKE_SNAPSHOT` replies with the transfer list per decision 9; `RESTORE_SNAPSHOT` calls
`engAPI.restoreSnapshot(data.snapshot, data.opts)`, then calls `transformBuffer?.freeSlot(id)` for
every reaped rigid body — the identical call `physicsSwitchRigid.ts:59` makes on
`DELETE_RIGID_BODY`, and **the single easiest thing to forget here, because a leaked slot fails
silently by capping `maxBodies`** — leaves `debugTracked*Ids` alone per decision 14, then calls
`writeBackTransforms()`/`writeBackDebugState()` per decision 13 before replying, and keeps
`physicsWorldAPI` pointing at `result.world`. In `PhysicsAPI.ts`: wire both `WORKER_THREAD`
branches through `applyRestoreDelta`, keep the existing `WorldProxyAPI` and refresh its cache per
decision 7, and delete the two stale `@TODO` blocks. Type the generic as the response object, never
`<boolean>`.

Manual verification: flip `CONFIG.physics.workerTarget` to `'WORKER_THREAD'` and repeat every Phase
1 check, once with `useSAB: true` and once with `useSAB: false` (the latter exercises
`TRANSFORMS_PUSH`, where decision 13's immediate write-back is what makes the restored pose visible
without stepping). Confirm pending resolver requests return to zero after each restore. Confirm slot
reuse: create → restore (reaps it) → create again, and check the new body reuses the freed slot.

As built (Phase 2):

- **The protocol unions** were Phase 1's. Phase 2 added `bodies: RestoredBodyState[]` to the
  `RESTORE_SNAPSHOT` reply (`protocol/PhysicsDownProtocol.ts`), see the proxies below.
- **The worker** (`worker/PhysicsWorker.ts`): `TAKE_SNAPSHOT` transfers the bytes' buffer (D9),
  only when the bytes own all of it (a view into Rapier's memory would detach it; Rapier 0.19.3's
  bytes do own theirs). `RESTORE_SNAPSHOT` frees the reaped bodies' slots, **sets `stepsExecuted`
  to the snapshot's step** (the plan's comment kept it going: Phase 1 rewinds the main thread's
  clock, and the pending writes compare their step with the buffer's stamp, so the two have to go
  back together), writes the transforms and the debug state back (D13, D14), and replies with the
  delta and every body the backend still has (a detached one isn't in its map).
- **The `WORKER_THREAD` proxies weren't zero work (D1 holds on `MAIN_THREAD` only).**
  `RigidBodyProxyAPI` caches the type and enabled state (a tier change or a world bounds exit since
  the snapshot leaves them wrong), a body created `FIXED` keeps its own pose (a move since leaves it
  wrong), and a write not shown yet is kept until the buffer's stamp reaches its step, which after
  the rewind would hide the restored pose for as many steps as were taken back. So the reply lists
  each kept body's type, enabled state and, without a slot, pose (`RestoredBodyState`), and
  `RigidBodyProxyAPI._restore` takes them and drops the writes not shown yet. The cached mass stays:
  reading it makes the backend recompute the mass properties, a write. A write made while a restore
  is in flight reaches the restored world, but its proxy drops it at the reply, so it shows a frame
  late.
- **The facade** (`PhysicsWorld.ts`): `restorePhysicsSnapshot` sends the restore (the response
  typed as itself, `RestoreSnapshotResponse`; the delta is its rest), gives each kept body's proxy
  its state, refreshes the existing world proxy's settings (`WorldProxyAPI._restoreSettings`, D7,
  with Phase 1's f32 compare, now `isF32Changed` in `PhysicsUtils.ts`), then runs
  `applyRestoreDelta`. `facade.isRestoringSnapshot` is now a count of the restores in flight
  (`restoresInFlight`): overlapping restores apply in call order, the last wins, and stepping waits
  for every one.
- **Events:** `applyRestoreDelta` drops the event pushes and the world bounds exits not delivered
  yet, and the noted exit steps after the restored step (`dropEventPushesAfterRestore`,
  `PhysicsMessaging.ts`), in both targets: on `MAIN_THREAD` the backend dropped its own records in
  Phase 1, but the exits the facade had taken from it stayed.
- The two `@TODO` blocks were gone with Phase 1.
- Tests: `PhysicsWorkerRequests.test.ts`' p500 tests, the matrix in `MESSAGE_BATCH` and
  `SHARED_MEMORY` (the harness boots with `useSAB: true` behind a `self` that isn't cross-origin
  isolated, and the SAB test makes it so): the transfer, the world proxy kept, reaped and orphans,
  the pose and velocity shown without a step on the snapshot's step, a write not shown dropped,
  the proxies' type, enabled state and fixed pose, the settings, the slot reused, a second restore
  from the same bytes, no request left pending; overlapping restores; a world bounds exit taken
  back and the bounds kept. Each change, removed alone, fails at least one of them.
- The manual browser checks ran in Phase 4 (both transports; slot reuse included), all passing.
  Pending requests returning to zero is the unit tests' only: the facade doesn't expose the count.

**Phase 3 — ECS reconciliation (`PhysicsEntity.ts`) — done.** Add
`reconcilePhysicsEntitiesAfterRestore(delta, world?)`:
walk `world.getStorage(ComponentType.TAG_IS_PHYSICS_OBJECT)`, resolve each entity's body via
`ECSWorld.getRigidBody(entityId)` (`ECS.ts:776-782`), and if its id is in `reapedRigidBodyIds`
call `world.deleteEntity(entityId)` — the same call the debugger's delete button makes. For an
entity whose body survived but some of whose `COLLIDER` entries were reaped, filter that array in
place rather than deleting the entity. A `REMOVED`-tier entity (no bucket, its body on
`PHYSICS_SIM_TIER.body`: read it with `getPhysicsEntityBody`) is neither. Register it via
`onPhysicsRestore`.
**Ordering constraint to preserve:** the facade's maps are pruned *before* the hooks fire, so when
`deleteEntity` triggers the `TAG_IS_PHYSICS_OBJECT.onDeleteEntity` hook → `disposePhysicsEntity` →
`deleteColliders`/`deleteRigidBody`, those run against already-removed ids. Confirm during
implementation that this is a benign no-op and not a throw — `EngineRapier.deleteRigidBody`'s
missing-handle path (`:575-581`) returns the same id, so `PhysicsAPI.ts`'s `deletedId !== id`
assertion is not reached. If the worker path diverges, add an `opts.skipEngineDispose` to
`disposePhysicsEntity` rather than loosening that assertion. Iterate a materialized array of entity
ids, never the live storage.

Found in Phase 2, for this phase to settle (both targets):

- **A `BODY_STATIC` entity's `TRANSFORM`.** `BODY_STATIC` isn't synced per frame; a moved body
  reaches its transform through the body-moved listener (`queueStaticBodySync`). A body moved since
  the snapshot (a `FIXED` one, or one a `STATIC` / `DISABLED` tier holds) is put back by the
  restore with no move to report, so its entity keeps the moved pose. Queue every survivor in
  `BODY_STATIC` for that sync (the delta doesn't list survivors: walk the storage).
- **`PHYSICS_SIM_TIER` and the `BODY_*` bucket.** A tier applied since the snapshot is undone in
  the backend (the body's type and enabled state are the snapshot's; the `WORKER_THREAD` proxy now
  says so) but not in the entity's component, its bucket or the policy's view. A body detached
  since stays detached (Phase 1's known limit). Decide whether the reconciler re-applies the
  entity's tier, or resets the component to what the body is.

Manual verification: snapshot → `createPhysicsEntity(...)` a new body → restore → its ECS entity is
gone, its mesh is out of the scene, no console errors, and the debugger tab's entity list matches
the ECS entity count. Both thread modes, both `useSAB` settings.

As built (Phase 3):

- **Two restore hooks, not one.** Physics' install registers `PhysicsEntity.ts`'
  `reconcilePhysicsEntitiesAfterRestore(delta)` (no `world` parameter: it covers every ECS world);
  `physicsTiers()`' install (`installPhysicsTiers`) registers `PhysicsTiers.ts`'
  `resetPhysicsTiersAfterRestore`, so a build without the tiers has none of it (and `PhysicsEntity.ts`
  can't import the tiers: they import it). Install order runs physics' first.
- **The reaped entities:** found through the body → entity map (`bodyOwners`, every ECS world, one
  lookup per reaped body), not a storage walk; an entity given another body since keeps it. A reaped
  body's entity is deleted (`world.deleteEntity`, its visual with it: a `target` mesh entity that got
  its physics after the snapshot goes whole). The reaped colliders left over (one added to a kept body,
  or a colliders-only entity's) are filtered out of the entities' colliders in place (a `REMOVED`
  tier's copy is the same array), the only storage walk, over every world's physics entities; an
  entity without a body left with none is deleted. Ids are collected first and deleted last. A
  restore that reaped nothing costs nothing there.
- **The ordering constraint holds, no `skipEngineDispose`:** the delete hook ends in the async
  `deleteRigidBody` / `deleteColliders` in both targets, which return early for an id the facade
  forgot; no delete reaches the worker (tested).
- **`BODY_STATIC` (the first Phase 2 note):** every `BODY_STATIC` entity of every world is queued for
  the transform sync (`queueStaticBodySync`) on every restore: after the clock's rewind it syncs until
  the first step after the restore, and the restored pose is there by then (the buffer, the worker's
  write-back, or a `FIXED` proxy's own pose).
- **The tiers (the second note): reset to the body, not re-applied.** Tier changes aren't creates or
  deletes, so the restore stays exact for them (re-applying a freeze would zero the restored
  velocities), and the policy decides again from the snapshot's step. Each tiered entity gets the tier
  its restored body is in (`FIXED`: `STATIC`; dynamic and enabled: `FULL`; dynamic and disabled:
  `DISABLED`) and its bucket (`moveToTierBucket`, taken out of `applyTier`); `target` = `tier`, so a
  request not applied yet finds nothing to do when its queue runs. The policy reads `target`, and drops
  its measurements on the restore's epoch: nothing of its own to reset. A world-disabled entity's body
  is disabled in `FULL` and `DISABLED` alike, so it keeps whichever it had (`STATIC` becomes `FULL`). A
  `REMOVED` entity stays; one in flight back gets its bucket from the reply as before. On
  `WORKER_THREAD` the proxies hold the reply's state when the hooks run.
- **Bodies of a deleted world are skipped** by both walks (`isBeingDeleted`): a scene load deletes the
  default world's physics entities only, so another ECS world can keep entities whose bodies went with
  an earlier world, and reading one crashed the facade test.
- **Known limit:** the entity's `DISABLED` component isn't reset. An entity disabled since the snapshot
  (app code's `world.setDisabled`, a world bounds `DISABLE` exit) keeps it while its restored body is
  enabled.
- Tests, in `PhysicsFacade.test.ts` and `PhysicsWorkerRequests.test.ts` (the entities' and the tiers'
  installs with stub contexts, once per file): the reaped entities deleted and colliders filtered, no
  delete sent and nothing pending; the moved `BODY_STATIC` entities synced (`FIXED` and a tier's, with
  and without a slot); the tiers and buckets reset, a pending request dropped, the world-disabled rule,
  `REMOVED` kept. Each change, removed alone, fails at least one of them.
- The manual browser checks ran in Phase 4 (the reaped entity gone, the entity count back), all
  passing.

**Phase 4 — Debugger tab affordance (`debug/_dbg__PhysicsTabFolders.ts`) — done.** A "Snapshot" folder
of `DebuggerPaneItem`s next to the determinism probe's (`Take snapshot` / `Restore snapshot` /
`Clear snapshot` `button`s), holding the last `PhysicsSnapshot` in a module-local, plus monitors
of `bytes.byteLength`, `step` (Phase 1's `takenAt`), and the last restore's reaped/orphan counts.
This is the primary manual-verification surface for every other phase and should not be skipped —
pull it earlier if any phase proves fiddly. The manual checks Phases 1-3 left (their "Not done"
lines) run from it.

Manual verification: take/restore/clear from the tab in all four configurations (`MAIN_THREAD`;
`WORKER_THREAD` × `useSAB` true/false).

As built (Phase 4):

- **The folder** (`getSnapshotFolder`, after the determinism probe's): `Take snapshot`, `Restore
  snapshot`, `Clear snapshot` and an orphan policy select (`DELETE` / `KEEP`, not in the plan: the
  `KEEP` path by hand too); monitors of the size (kB), the step, the scene it was taken in, the
  take's time, and the last restore's time (the round trip on `WORKER_THREAD`) and its reaped and
  orphan counts per kind. Every restore logs its whole delta (`[PhysicsSnapshot] restored step N:`).
  The buttons are disabled without a world or a snapshot, and while a take or restore is in flight;
  a failure goes to the console and an alert toast.
- **The held snapshot is dropped on every scene exit** (`registerOnAllSceneExits` at the module's
  load, as the merging debug modules do): a scene load replaces the world, so it couldn't be
  restored (the risk table's "reject or drop"). A world deleted and created from the console isn't
  caught: the restore refuses it, with the toast.
- **Public API (not in the plan):** `takePhysicsSnapshot` and `restorePhysicsSnapshot` are on
  `aekasha/physics`. `getPhysicsWorld().restoreSnapshot()` was app code's only way, and on
  `MAIN_THREAD` it restores the backend alone (Phase 1's bypass: no entity reconciled, no step
  clock), so the facade's pair is the app's, the same in both targets. `onPhysicsRestore` stays
  `@internal`. Engine minor bump: the `WorldAPI` snapshot signatures changed in Phase 1, but the old
  ones were broken and unused.
- **Fixed:** the D11 warning's wording (`RapierRestore.ts`).
- **Docs:** the Hub's physics guide has a Snapshots section (the two functions, the intersection
  rule, the replay caveat, the tab), the readme a Physics snapshots feature (its roadmap item
  dropped), physics' `CLAUDE.md` the tab and the public pair. The baselines were recorded: the
  Rapier chunk grew 1.1 kB gzip (both copies) and the worker 0.2 kB; the API baseline also took
  `registerInstanceBoundsProvider` and the embeds' few hundred bytes, which main's i090-i110 merge
  left unrecorded.
- **The manual checks** (all of Phases 1-4), driven through the tab's buttons by a Playwright
  script (the scene runner's server and browser: WebGPU in the Windows Chrome), `physicsTest`, in
  `MAIN_THREAD`, `WORKER_THREAD` with SAB and without (the "four configurations" are three): 61
  checks, all passing, no console error. In each: the take's size (15.6 kB) and step shown; a
  restore puts the 9 dynamic bodies back on the snapshot's poses exactly (after 0.8-2.1 m of
  movement), its delta empty, the step clock on the snapshot's step; restoring twice gives the same
  state; **90 steps after a restore replay bit for bit** (D16, in all three targets); a ball made
  since is reaped (body and collider in the delta, its entity deleted, the entity count back; on
  the worker its slot freed and the next ball given the same one); a joint demo's body deleted since
  is an orphan (1 body, 1 collider, 1 joint) and a ray cast where it was hits the ground below it;
  clear disables restore and empties the readouts. Measured: take 1.1-1.7 ms, restore 4 ms on
  `MAIN_THREAD` and 8-9 ms on the worker (round trip), for 18 bodies.
- Not checked: the meshes following (the checks read the bodies' poses; the screenshots look
  right), pending requests (unit tests only).

## Non-goals

- **Full scene rewind / resurrecting deleted bodies.** Design decision 11. A Rapier snapshot
  contains no `RigidBodyParams`, no `Object3D` and no ECS entity, so resurrection at the physics
  layer alone would produce invisible, entity-less bodies — strictly worse than deleting them.
  `orphanPolicy: 'KEEP'` plus a creation-params sidecar inside `PhysicsSnapshot` is the door this
  plan deliberately leaves open for a follow-up.
- **Snapshots that outlive their world.** The `worldEpoch` guard rejects them. No serialization to
  disk or localStorage, no cross-reload restore, no cross-session replay.
- **Multibody joints.** Serialized by Rapier but not exposed by the new API; tracked in
  `p250_physics-api-support-for-multibody-joints.md`. When they land they will need a fourth rebind
  pass — note it there.
- **Character-controller / PID-controller / vehicle-controller state.** Not restored by
  `World.fromRaw` and not exposed by the new API (`PhysicsAPITypes.ts:1563-1605`).
- **Adding a transfer list to `messageWorker`/`messageWorkerAsync`.** Design decision 9. No
  main→worker transferables are introduced.
- **Snapshot compression, ring buffers, or a replay timeline data structure.** The consumer's
  concern, not the API's.

## Risks / open questions

| Risk / question | Notes |
|---|---|
| **The generation test is the whole design.** If `wrapper.handle` from a deserialized set ever stopped carrying the generation in its high 32 bits, reaped bodies would silently alias onto unrelated restored bodies — corruption, not a crash. | Mitigate with a debug-build assertion in the rebind pass cross-checking `isValid()` (which *is* generation-checked Rust-side) against the handle comparison. `@dimforge/rapier3d-compat` is already pinned exactly at `0.19.3`; re-verify this on any version bump. |
| **`old.free()` after rebinding.** If any code path still holds a wrapper from the old world (e.g. a `ColliderAPI` handed to a raycast callback that outlived the call), `free()` turns it into a use-after-free surfacing as a WASM trap far from the cause. | Gated by the `isRestoringSnapshot` guard and the post-sweep `isValid()` check. If a trap shows up in manual testing, the fallback is to not free the old world in v1 and accept the leak — strictly less dangerous. |
| **`deleteEntity` re-entrancy during Phase 3.** Deleting entities while iterating an ECS storage, with the delete hook firing async physics disposal. | Iterate a materialized array of entity ids, never the live storage. Gated by Phase 3's ordering constraint above. |
| **Determinism (decision 16) gates the rewind/replay consumer.** Restoring state is not the same as reproducing a run; the compat build reproduced across machines in p604's run, which is evidence, not a guarantee. | Phase 1's empirical check answers the restore-then-replay half. If it fails, the rewind consumer needs rethinking — but the snapshot API itself would still be correct and useful for reset-to-checkpoint. |
| **Upstream leak in `World.restoreSnapshot`.** Rapier never frees the temporary `SerializationPipeline` it allocates. | Unavoidable without reimplementing `restoreSnapshot`; a few hundred bytes per call. Documented, not worked around. |
| **`useSAB: false` visibility window.** Between the restore reply and the `TRANSFORMS_PUSH` it triggers, the main thread reads stale poses. | Decision 13 puts both inside the same handler, so the window is one message hop. Confirm visually with `useSAB: false`. |
| **Snapshot cost per capture is O(world size)** and allocates a fresh `Uint8Array` out of WASM every time. | p604 measured plain Rapier in Node (box stacks mid-collapse): take / restore 0.25 / 0.54 ms with 256 awake bodies (444 kB), 0.89 / 1.33 ms with 1,568 (2.9 MB), 3.0 / 4.0 ms with 4,000 (7.4 MB); one step after a restore 0.8, 4.5 and 11.7 ms. Measure the engine's path in Phase 4's readout before any per-frame rewind consumer is built on top of it. |
| **World bounds (p102, engine 6.22.0: the scene's box and each body's own)** are configuration, not in a Rapier snapshot. The backend keeps the box and the per-body boxes (`bodyBounds`, by body id) as module state (`RapierWorldBounds.ts`), which survives a restore, but its step count (`backend.stepCount`, the exit records' `step`) and its body map by handle (`handleToRigidBodyId`, `RapierState.ts`) aren't in the snapshot. | A restore sets `backend.stepCount` to the restored step, rebuilds `handleToRigidBodyId` with the other id maps, and re-sends the current global and per-body bounds from the ECS side, their source of truth (p102 §8: the active definition in `PhysicsWorldBounds.ts`, `getActiveWorldBoundsDef`, and each entity's `WORLD_BOUNDS` component; `src/_engine/features/physics/CLAUDE.md`'s World bounds). The facade's noted exit steps (`getOutOfBoundsExitSteps`) are the restored world's only up to its step. |
| **Interplay with p101 (scene-load determinism, implemented).** Every scene load replaces the physics world (`resetPhysicsWorld`) while stepping is held, so a snapshot can never outlive its scene, and every body/collider reference from the previous scene is stale. Two questions p101 left open land here: (1) a `LoadSceneProps.keepPhysicsWorld` opt-out for persistent physics entities (none exist yet), and (2) whether identical output **across** `MAIN_THREAD` and `WORKER_THREAD` is a goal, or repeatability within one mode is enough (p101 delivered the latter). | Reject (or drop) a restore whose snapshot was taken in another scene load. Answer (2) together with decision 16; the determinism probe (`?physicsProbe=N`, `_dbg__PhysicsDeterminism.ts`) is the tool for both. |

## Verification

- `yarn test`, the lint and `tsc` clean at every phase boundary (the Stop hook runs them), and
  `yarn verify:scenes`' hashes unchanged (a restore is never on a scene's path).
- Every phase's functional verification runs in **both `workerTarget` modes**, and under
  `WORKER_THREAD` in **both `useSAB: true` and `useSAB: false`**.
- Phase 0: no behavioral change; delete→create leaves no stale proxies.
- Phase 1: the survivor / reaped / orphan matrix above, plus restore-twice-from-one-snapshot, plus
  the determinism check.
- Phase 2: the same matrix through the worker, plus resolver-pending returns to zero and transform
  slot reuse after a reap.
- Phase 3: ECS entity count and scene contents match after a restore that reaps.
- Phase 4: take/restore/clear from the debugger tab in all four configurations.
- Unit tests with each phase, next to the physics ones (`src/_engine/features/physics/CLAUDE.md`):
  the backend's matrix (survivors, reaped, orphans, the epoch guard, the `null` restore, restore
  twice) in `backends/rapier/EngineRapier.test.ts`, the facade's `MAIN_THREAD` path in
  `PhysicsFacade.test.ts`, the worker path (slots freed, the immediate write-back, both `useSAB`
  settings) in `PhysicsWorkerRequests.test.ts`. The manual checks stay for what a test can't see
  (the meshes following, the wireframes).
