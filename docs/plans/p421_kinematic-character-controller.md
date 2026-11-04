Status: stub — not-implemented
Category: Characters, Physics
Blocks: p420_npc-simulation-tiers.md (soft: the NPC default controller)
Related: `src/_engine/features/character/CLAUDE.md` (the controller contract and `registerControllerKind` in code; the dynamic controller it sits next to), p420_npc-simulation-tiers.md (The gameplay contracts: C2, which this second implementation makes firm), p510_headless-simulation-runtime.md (The multiplayer path: step-index time, no async casts in the tick), p512_client-prediction-and-reconciliation.md (predicts the local player with this controller), p428_character-determinism-in-worker-targets.md (where a controller's in-step queries run in the worker targets: open question 1, decided together), the "Refactor dynamic character code" (p070) prompt in `docs/templates/todo-plan-prompts.txt` (crouch shape, grace time and air control apply here too)

# Kinematic Character Controller — Stub

**This is a stub.** It records the goal, the contract and the open questions so the real plan can
be written on the contracts p610 built. Nothing here is a final design.

## Goal

A second character controller on Rapier's `KinematicCharacterController` (KCC): a kinematic body
moved by sweeps, with step-up, slope limits, snap to ground, moving platforms and pushing dynamic
bodies. It's the controller most engines give NPCs, and the one p420's `FULL` and `REDUCED` tiers
can use; `DynamicCharacter` stays for the player who wants physical movement and for tumbling.

## The contract it implements (C2, p420's The gameplay contracts)

- `kind: 'KINEMATIC_CHARACTER'`, registered with `registerControllerKind` (C1) from `character()`'s
  install, its factory `import()`ing its module (`controllers/kinematic/`) as `DYNAMIC_CHARACTER`'s
  does, so the controller is its own chunk; its kind and params declared on `CharacterControllerKinds`.
- `tick(dt, intent, step)` reads the same `CharacterIntent` (C3) the dynamic controller reads, so
  any brain drives either one; `characterControllerSystem` calls it at `APP_PHYSICS_STEP` (-10),
  after the brains (-5).
- Only the tick writes the body; the step index is its clock.
- The first controller that uses `attach` / `detach` (C2): swapping it with the dynamic controller
  on a live actor (ragdoll and back, p420's tiers) means the body plan's colliders get an owner other
  than the controller.

## Grounding (2026-11-04)

- Rapier's KCC is a commented-out signature on `WorldAPI`
  (`src/_engine/features/physics/types/PhysicsWorldTypes.ts`, `createCharacterController` /
  `removeCharacterController`, ~l.434). The Physics API exposes nothing of it; the worker's
  switchboard (`features/physics/worker/PhysicsSwitch*.ts`) has no KCC commands, and a restored
  Rapier snapshot drops character controllers (p500's non-goals).
- The KCC's `computeColliderMovement` is a synchronous query against the world. On `MAIN_THREAD`
  it runs in the tick like the dynamic controller's sync casts; in `WORKER_THREAD` mode it has to
  run in the worker, inside the step, or the tick gets a reply a frame or more late (the dynamic
  controller's async casts there, `controllers/dynamic/Casts.ts`).
- The body plans (`HUMANOID_CAPSULE`, `CharacterBodyPlans.ts`) are built for the dynamic body
  (floor and wall sensors, four colliders, sized from `CharacterBodyData`). A KCC needs one
  collider and no sensors.
- The dynamic controller's known limit (`src/_engine/features/character/CLAUDE.md`): a crouched
  character can't pass under a low ceiling, because the wall sensor keeps the standing size and
  `slideAlongWall` cancels the move. The KCC's crouch resizes its one collider, so it shouldn't
  have the limit; whether the dynamic one gets the fix here or in the p070 prompt's plan is that
  plan's call.
- The checks a controller change keeps: the gym's and `topDownTestScene`'s path hashes
  (`yarn verify:scenes`, `MAIN_THREAD`, driven by `devTools/verify/inputs/thirdPersonGymScene.json`).
  A KCC character in the gym gets its own path in the hash, so its first baseline is recorded with
  the reason.

## Open questions

1. **Where the KCC runs in `WORKER_THREAD` mode:** a controller half in the worker (the tick's
   intent sent in the STEP message, the result back with the poses) or a synchronous main-thread
   world copy. The first keeps determinism and costs a protocol addition. The dynamic controller has
   the same question (p428: the controller in the worker, or fixed-lag step-stamped reads), so one
   answer for both. A tick in the worker can't use three or the facade (`worker/PhysicsWorker.test.ts`
   fails on them in the worker bundle), so the KCC's tick is written on the Physics API's plain
   types from the start.
2. **Body plans:** one plan with per-controller collider sets, or a plan per controller kind.
3. **Interaction with dynamic bodies:** the KCC pushes nothing by itself; how much push and how
   much a dynamic body pushes back (Rapier's `computedCollisions` plus impulses applied by the tick).
4. **Locomotion states:** which of the ten `LocomotionState`s it reports (no tumbling), so an
   animation graph (p422) works with both controllers.
5. **Debug tools:** the Character state window reads a controller's `state`, `config.values` and
   `internal` as property-grid folders (`getGroupSource`) and its gizmos draw `probes`, so this
   controller's three objects and probes plug into the same window (`src/_engine/features/character/CLAUDE.md`,
   Character debugging); its saved overrides go through `applySavedCharacterConfig`.
6. **Moving platforms:** the dynamic controller rides them in `Platform.ts`; the KCC has its own
   (Rapier's ground velocity), and the toolkit's `MovingPlatform` must carry both.
