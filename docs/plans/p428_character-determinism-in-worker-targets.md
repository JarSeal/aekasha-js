Status: stub — not-implemented
Category: Characters, Physics
Blocks: p512_client-prediction-and-reconciliation.md (the local player predicted in the default worker target)
Related: \_DONE_p610_character-and-input-action-architecture.md (D1: made characters deterministic on `MAIN_THREAD` and left the worker targets here), p614_review-physics.md (the worker protocol and its transport interface, which this changes), p421_kinematic-character-controller.md (the KCC's sweeps must run inside the step: its open question 1 is this plan's), \_DONE_p603_gameplay-architecture-contracts.md (C2: the controller contract), \_DONE_p604_multiplayer-viability-study.md (§4: step-index time, the simulation reads its own state)

# Character Determinism in the Worker Targets — Stub

**This is a stub.** It records the goal, what p610 left and the open questions so the real plan can
be written with p614 and p421. Nothing here is a final design.

## Goal

Characters simulate identically on every run in the `WORKER_THREAD` targets too (with and without
`SharedArrayBuffer`), as p610 made them on `MAIN_THREAD`: the same recorded input gives the same
path whatever the frame timing and the worker's latency. `WORKER_THREAD` is the default target, so
until then a scene with characters isn't reproducible where apps run, and p512's prediction can't
replay the local player there.

## Grounding (2026-10-13, after p610)

- **Deterministic already, in every target:** the brains and the action sample (the sub-step index,
  which `stepPhysics` passes in both worker targets), step-index time in the controller, the seeded
  stream of the tumble start, the body writes (only the tick writes the body; in `WORKER_THREAD`
  mode its commands are captured per sub-step and replayed in the worker before their own sub-step),
  and the body type (`bodyTypeSync()` reads the worker proxy's cached type).
- **What isn't** (the controller ticks on the main thread, `characterControllerSystem` at
  `APP_PHYSICS_STEP` order -10, in every target):
  - **The pose and velocities** come from the snapshot latched once per frame
    (`latchPhysicsSnapshot`, stamped `getPhysicsSnapshotStepIndex()`): every sub-step captured in a
    frame reads the same snapshot, some steps behind the sub-step it runs for, how many depending
    on the frame timing and the worker's reply.
  - **The casts** (`controllers/dynamic/Casts.ts`, `Floor.ts`, `Wall.ts`): the sync casts throw off
    the main thread's world, so the floor ray and the wall cast are async there, at most one in
    flight each (`inFlight`), and the latest resolved result is used meanwhile.
  - **The sensor events** arrive as `EVENTS_PUSH` messages, queued on arrival and delivered by
    `flushPhysicsEvents` at the start of the next captured sub-step: which step sees them depends on
    when the message landed.
- **The checks:** `devTools/verify/scenes.config.ts` keeps `thirdPersonGymScene` in `unstableHash`
  for `workerSab` and `workerMsg` (the characters push the hashed bodies), and the runner compares
  the characters' path hash on `MAIN_THREAD` only (`devTools/verify/scenes.ts`). The `space` scene's
  `MutualGravity` has the same cause (it reads the worker's last synced poses) and the same entry.
- **The controller's dependencies:** `controllers/dynamic/` is built on `three/webgpu` maths, the
  physics facade (since p614: `PhysicsState.ts`' `getPhysicsWorld` for its casts and
  `PhysicsStepping.ts`' step clock, plus the `types/` enums) and the ECS, and its configuration's hooks are app closures. The physics worker
  bundles without three, `MainLoop`, `Config` or the facade's 14 modules
  (`features/physics/worker/PhysicsWorker.test.ts`), and a worker can't be handed code: it
  `import()`s a module by name, as the assets worker does with its jobs.

## The two directions (p610 D1)

1. **The controller in the worker:** the worker loads the controller's module by its registered
   kind and ticks it inside the step against the live world, with the sync casts, as `MAIN_THREAD`
   does; the brain stays on the main thread and its intent goes with the sub-step's commands in the
   STEP message; the controller's state comes back with the poses (for the locomotion state, the
   debug tools and the app). The same path as `MAIN_THREAD`, so one baseline for every target. Costs:
   a tick free of three and of the facade (or a worker build of them), the hooks and the debug edits
   carried as data, a protocol addition.
2. **Fixed-lag step-stamped reads:** the controller stays on the main thread, and the tick at step
   N reads the state of step N - L for a fixed lag L (a history of per-step snapshots, or per-step
   character state written by the worker), its casts fired at N used at N + L, its events delivered
   at the step they're stamped with, and stepping held with `addPhysicsStepGate` when one hasn't
   arrived. Deterministic, but a path of its own (L steps of input lag that `MAIN_THREAD` doesn't
   have, unless it takes the same lag), and a slow worker stalls the step.

## Open questions

1. **Which direction**, decided here: p614 left both open (its D5). The protocol is in
   `features/physics/protocol/` (a new message takes the next free number in its switch's range,
   `PhysicsProtocolType.ts`), the transport in `transport/PhysicsTransport.ts` (plain data, in order,
   one message handled to the end before the next); the first direction adds a message type, the
   second a step stamp on the `EVENTS_PUSH` records. With p421 (the KCC's `computeColliderMovement` is a synchronous query too: one
   answer for both controllers).
2. **One baseline or one per target:** must a worker target give `MAIN_THREAD`'s path hash (only
   the first direction can), or only the same hash on every run of that target?
3. **Step-stamped events:** stamp `EVENTS_PUSH` records with their step and deliver them at the
   sub-step after it, in both directions (and for every gameplay code that reacts to contacts).
4. **The other main-thread readers of the snapshot** (`MutualGravity`, the tier policy's `'FRAMES'`
   cadence): the same mechanism, or left as presentation.
5. **The debug tools** (the state window, the gizmos, the saved overrides) when the controller's
   state lives in the worker.

## Done when

- The gym's `unstableHash` entry is gone (or names only what isn't a character), and the runner
  compares the characters' path hash in all three targets, in Chromium and Firefox.
- `p512_client-prediction-and-reconciliation.md` can replay the local player's recorded actions in
  `WORKER_THREAD` mode.
