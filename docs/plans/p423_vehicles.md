Status: stub — not-implemented
Category: Vehicles, Physics
Related: `src/_engine/features/character/CLAUDE.md` and `src/_engine/kernel/input/CLAUDE.md` (the controller and brain contracts and the action layer's contexts in code), p420_npc-simulation-tiers.md (The gameplay contracts: C1 actor kind `VEHICLE`, C2, C3 `VehicleIntent`, C5 contexts), p421_kinematic-character-controller.md (`attach` / `detach`, used on enter and exit), p510_headless-simulation-runtime.md (The multiplayer path), p512_client-prediction-and-reconciliation.md (a vehicle the local player drives, its open question 1)

# Vehicles — Stub

**This is a stub.** It records the goal, the contracts and the open questions so the real plan can
be written on the contracts p610 built.

## Goal

A raycast-wheel vehicle controller, the `VehicleIntent` schema, and entering and leaving a vehicle:
the driver's brain moves from the character to the vehicle, and the player's bindings switch
context.

## The contracts it implements (p420's The gameplay contracts)

- **C1:** an actor of kind `VEHICLE` (the actor `kind` union extended by declaration merging).
  The contracts are named generically in `features/character/` (`ActorController`, `ActorBrain`,
  `registerControllerKind`, `registerBrainKind`, `KindSpec`) so this plan can lift them into a
  place of their own (a `features/vehicle/` feature, or a shared actor module both import).
- **C2:** a controller of kind `RAYCAST_VEHICLE`, its tick at `APP_PHYSICS_STEP` writing the chassis
  through the Physics API only.
- **C3:** `VehicleIntent` (`throttle`, `brake`, `steer`, `handbrake`, `gear`), firm when this plan
  gives it a writer and a reader. One schema per actor kind, not a general intent.
- **C4:** a player vehicle brain (and an AI one with p424); the brain is handed over on enter.
- **C5:** an "in a vehicle" binding context (an app-defined action context,
  `setActionContextEnabled`), entered and left with the vehicle.

## Grounding (2026-11-04)

- Rapier's `DynamicRayCastVehicleController` is a commented-out signature on `WorldAPI`
  (`src/_engine/features/physics/types/PhysicsWorldTypes.ts`, `createVehicleController` /
  `removeVehicleController`, ~l.466), like the KCC. Nothing in the Physics API or the worker
  exposes it, and a restored Rapier snapshot drops vehicle controllers (p500's non-goals).
- Its wheel rays are synchronous queries, so in `WORKER_THREAD` mode the controller runs in the
  worker inside the step (the same question as p421's and p428's).
- No `CameraIntent` exists yet; a vehicle camera is a camera rig (the toolkit's
  `createFollowObjectCameraRig`, `src/toolkit/ecs/gameplay/FollowObjectCameraRig.ts`: `orientation`,
  `lookAhead`) with other settings.

## Open questions

1. **Rapier's controller or our own raycast wheels:** Rapier's runs inside the physics engine (one
   backend); our own on the Physics API's rays would carry over to another backend.
2. **The driver on enter:** hidden, parented to the seat, or a ragdoll-free kinematic passenger;
   what happens to the character's body (removed, disabled, `attach` / `detach`).
3. **Wheel visuals:** a presentation system at `APP_RENDER_SYNC` reading the controller's wheel
   state (suspension, spin, steer).
4. **Other vehicle kinds** (boats, aircraft, hover): separate controllers on the same actor and
   intent model, or out of scope.
5. **An example scene** for the Hub (a track in the gym, or its own scene).
