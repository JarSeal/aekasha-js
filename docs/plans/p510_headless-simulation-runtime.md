Status: stub — not-implemented
Category: Networking, Architecture, Physics
Blocks: p511_network-transport-and-replication.md, p512_client-prediction-and-reconciliation.md
Related: `src/_engine/kernel/init/CLAUDE.md` (the boot and the feature installs a headless runner picks from), `src/_engine/features/physics/CLAUDE.md` (the worker, its bundle check and the transport), the Hub's coding standards (`hub/pages/documentation/coding-standards/intro.md`, The simulation: the rules below as the code follows them), p420_npc-simulation-tiers.md (The gameplay contracts: C4, a network brain is a brain), p500_restore-physics-snapshot.md, p428_character-determinism-in-worker-targets.md

# Headless Simulation Runtime — Stub

**This is a stub.** It records the goal, the multiplayer study's verdict and measurements (p604,
summarized below for p511, p512 and the other plans that cite it) and the open questions.
Nothing here is a final design.

## Goal

The simulation half of the engine runs without a browser: the kernel's ECS, the `APP_PHYSICS_STEP`
systems, physics and a scene's gameplay code, in Node (an authoritative server) or a worker,
stepped by the step clock, with no renderer, DOM, styles or Vite. It's the base of the first
network model (an authoritative server with interpolating clients, below) and a useful tool
without a network: simulation tests and recorded replays in CI.

## The multiplayer path (p604)

p604 asked whether a multiplayer backend fits the engine, measured it, and turned the answer into
rules the refactoring adopted. **Verdict: viable, with a staged path; design for the first two
models.**

| Model | How it works | Verdict | Needs from the engine |
| --- | --- | --- | --- |
| **1. Authoritative server + interpolation** | The server simulates; clients send intents per step and render snapshots interpolated a little in the past | Go: this plan, then p511 | Headless simulation, intents, replicated identity, serializable components, snapshot encoding, interest management |
| **2. + client prediction and reconciliation** | The local player is simulated ahead on the client and corrected from the server | Go, staged: p512 | All of 1, plus deterministic characters (p428 for the worker targets), a physics snapshot restore (p500) and re-simulation per correction |
| **3. Deterministic lockstep** | Every peer simulates; only inputs are exchanged | Possible later; not a reason to shape the engine now | Bit-exact determinism across machines: Rapier's deterministic build, a fixed-point or engine-independent `Math` for simulation code, ordered input |
| **4. Rollback (GGPO-style)** | Lockstep that predicts remote inputs and rolls back on a mismatch | Possible later, for small worlds | Lockstep's, plus a snapshot and N-step re-simulation per misprediction |

What it measured (2026-10-09; `physicsTiers`: 687 bodies, a kinematic plough, tier changes):

- **The physics worker runs in Node unchanged**, fed a message stream recorded in the browser:
  1,200 steps bit for bit the same as Chromium, Rapier snapshot bytes included. Every one of the
  2,580 messages was plain data. Server cost: 0.29 ms per `physicsTiers` step on average, so one
  core runs many such worlds at 60 Hz.
- **Cross-platform:** the compat build (the one shipped) reproduced bit for bit across Chromium,
  Firefox, Node and an Android phone, on x86-64 and ARM. The deterministic build
  (`@dimforge/rapier3d-deterministic-compat`) did too, costs 0-9 % in step time and +12 kB gzip,
  and gives different results from compat (they part at step 55). Rapier guarantees cross-platform
  determinism only for the deterministic build, so a lockstep or rollback game switches to it, at
  that cost. Not covered: characters, joints, trimesh and convex colliders, CCD, scene queries
  feeding the simulation, iOS / Safari. JS `Math` functions aren't specified to be exact across
  engines; matching there was luck (the scene runner's Firefox run watches it).
- **Bandwidth and snapshots, restore and re-simulation:** p511's and p512's grounding.

The rules the refactoring adopted for it (each in the code and the Hub's coding standards, The
simulation; the plans cite them by number):

1. Simulation time is the step index (`getPhysicsSubStepIndex()`), never the wall clock or the
   frame delta.
2. Randomness comes from named seeded streams (`getRandomStream`), with a lint rule against
   `Math.random` in the simulation files.
3. Intents are the only input to the simulation: a network brain is a brain (C4).
4. Replicated identity: `appId` is the stable id of a networked entity, with an id → entity map
   (`getEntityIdByAppId`).
5. A transport interface in front of `postMessage` (`features/physics/transport/`), and protocol
   messages stay plain data, so a recording, a replay in Node and a network can carry them.
6. A headless-capable core: no `window`, `document`, `import.meta.env` or Vite `?worker` at module
   load (`ModuleLoad.test.ts`); type-only imports across the simulation boundary are `import type`
   (`verbatimModuleSyntax`, the lint). A server's stand-in for the worker global is the real
   global object: Rapier's WASM reads `performance.now()` through `self`, and a plain object
   panics it on the first step.
7. Serializable simulation components: data, not closures; a component marks itself serializable
   (the save service, p425, and network replication, p511, share it).
8. The simulation reads its own state at the step, never the presentation's (synced `TRANSFORM`s,
   interpolated poses, `Object3D`s, which lag a frame behind the worker): step-stamped reads
   (`readBodyPositionsAtStep`) and step gates. `MutualGravity` breaks it, which is why `space`
   isn't deterministic in the worker targets.
9. One Rapier build for every peer: the build is part of the simulation's version, a switch is
   deliberate and changes every stored probe hash once. The compat build until a lockstep or
   rollback game needs the deterministic one.

Cost: none in the hot paths (one indirection per message, a function call per draw, a `Map`
lookup, nothing at runtime for `import type`). Open from the study: whether a server runs three
too (raycasts against render meshes, animation-driven hitboxes); the recommendation is no, the
server uses physics colliders only (question 5).

## Grounding (2026-11-04)

- **The physics half runs headless:** `features/physics/worker/PhysicsWorker.ts` and the Rapier
  backend import no three, `MainLoop`, `Config` or facade module, and
  `worker/PhysicsWorker.test.ts` bundles the worker with esbuild in `yarn test` and fails when one
  gets in. `PhysicsWorkerRequests.test.ts` already runs the real worker module and Rapier in Node
  behind a fake `Worker`.
- **The headless boundary by construction:** no engine module reads `window`, `import.meta.env` or
  a flag at load (`src/_engine/ModuleLoad.test.ts` imports every engine module in Node), and
  nothing registers at module load (`devTools/verify/moduleSideEffects.test.ts`). `InitEngine({
  config, data, features, start })` calls `initEnvironment({ search?, env? })`
  (`kernel/config/Config.ts`) first; the `IS_*` flags read as production before it, and the
  window listeners are added by `addWindowListeners()` in the boot. Configuration and the
  gathered data (`AppData`, `kernel/scene/AppData.ts`) come in through `InitEngine`, so a headless
  runner hands in the same `data`. `initEnvironment` is on no entry: how a headless runner
  reaches it is question 1.
- **Installs are chosen:** the kernel installs in `installKernel` (`kernel/init/Kernel.ts`) and
  each feature in its `install`, so a headless runner picks what it installs (`physics()`: the
  tiers, the tier policy, the physics entities' systems, the fixed-step driver and the scene
  hooks). The physics worker and Rapier load by `import()` (`PhysicsWorld.ts`' `initPhysics`,
  `backends/Engines.ts`' `loadEngineAPI`), the assets worker on its first request. The loop reaches
  physics only through `FixedStepDriver` (`latch`, `step(loopState, runSubStep)`, `flushEvents`,
  `isStepping`), which a server clock (question 3) can drive. `__AEK_DEBUG__` is a build define (a
  headless build sets it false).
- **Left in the browser half:** the boot (`kernel/init/Boot.ts`, shared by `InitEngine` and
  `mountAekasha`) imports the kit's styles (`ui/styles/index.scss`), creates the HUD root, the root
  scene and the window listeners, and `InitEngine.ts` imports `page.scss`, so question 1 leans to
  an entry of its own. `MainLoop.ts` runs on `requestAnimationFrame` and a renderer. `ECS.ts`
  imports `three/webgpu`. The kernel's install holds render systems (frustum culling, meshes,
  groups, ray casting, cameras, lights) next to the core ECS plumbing.
- **The gameplay half doesn't run headless yet:** the `APP_PHYSICS_STEP` systems (the tier
  policy, kinematic movers, the characters' brains and controllers) live in the main thread's ECS,
  and the dynamic controller is built on `three/webgpu` maths.
- **Scene code mixes both halves:** a scene file creates meshes, materials and physics entities
  in one function (`physicsTiers.ts` creates each crate's mesh and body together), and physics
  objects are created in code, not in the scene JSON yet.

## Phase 1 (the study's dropped spike)

A throwaway branch: a Node process running `physicsTiers`' simulation, two browser clients on a
WebSocket sending intents and rendering interpolated snapshots. Measured: how much latency
interpolation hides, bandwidth against the study's estimate (45-62 kbit/s per client for the
changed bodies, quantized, at 20 Hz), server step time. The findings shape the phases below.

## Open questions

1. **The entry point:** `InitEngine({ headless: true })`, or a separate `initSimulation()` that a
   browser's `InitEngine` builds on; either way it takes `{ config, data, features }` and passes
   its own environment to `initEnvironment` (no `window.location`, no `import.meta.env`).
2. **Physics placement on a server:** in-process (the `MAIN_THREAD` path), a `worker_threads`
   worker behind the transport interface, or both.
3. **The server's clock:** a fixed-step loop on `setImmediate` / timers driving the
   `FixedStepDriver` (no `requestAnimationFrame`), and what a missed deadline does (never skip
   steps silently).
4. **Scene code:** how a scene's simulation part runs without its presentation part: a split in
   the scene file (a simulation function and a presentation function), physics objects in the scene
   JSON (the readme's roadmap item), or both.
5. **Components that hold three objects** (`OBJECT3D`, meshes): absent on a server, or present as
   bare transforms; which systems are presentation and don't run. The rule: the simulation
   (ECS game state, physics, controllers, AI, gameplay systems at `APP_PHYSICS_STEP`) runs; the
   presentation (rendering, interpolation, animation, UI, audio, debug) reads it and never writes
   it but through intents and commands, so it doesn't.
6. **The runtime:** Node only, or Deno and Bun too.
