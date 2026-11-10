Status: stub — not-implemented
Category: Characters, AI
Blocked by: p421_kinematic-character-controller.md (soft: the NPC default controller), p424_ai-brains-and-navigation.md (soft: the AI brain and the navmesh `REDUCED` moves on)
Related: `src/_engine/features/character/CLAUDE.md` (the actor, controller and brain contracts in code, p610), The gameplay contracts below (p603's C1-C7, which the other 42x stubs refer to), p425_game-events-missions-and-save-games.md (where `ABSTRACT` NPC state is saved), p422_animation-state-graph-and-ik.md (animation cost per tier), \_DONE_p350_lod-system-research.md (§6 physics simulation tiers, §8 roadmap), \_DONE_p352_physics-simulation-tiers.md (generic rigid bodies; it refuses tier changes on characters and leaves them to this plan), \_DONE_p353_macro-streaming-grid.md (cells around the player), \_DONE_p351_impostor-billboard-lod.md (`CROWD` rendering), p102_physics-world-bounds.md, p510_headless-simulation-runtime.md (The multiplayer path: the determinism rules an `ABSTRACT` simulation would follow)

# NPC Simulation Tiers — Stub

**This is a stub.** It records the direction from a design discussion so the real plan can be
written later. Nothing here is a final design, and the numbers below are estimates from reading
the code, not measurements.

## Goal

Support a large world with many NPCs (hundreds to around a thousand), some of which carry on
with their own world tasks while the player is far away. Only the NPCs near the player should
cost what a full character costs today.

## Core idea: the NPC is data, the body is attached per tier

An NPC is an ECS data entity that holds its state, schedule, current task and coarse world
position. A body (a `DynamicCharacter` today) is something the NPC gets while it is near the
player and loses when it moves away.

AI writes the character's intent (`CharacterIntent`: `moveX`/`moveZ`, `moveForward`, `faceYaw`,
`jump`, ...) whichever body is attached. Because `CharacterObject.controller` is pluggable, a
cheaper mover can be another controller that reads the same intent.

### In the gameplay contracts' terms (below)

- **The NPC is an actor** (C1): an entity with an actor record (`CHARACTER`, or a record of an NPC
  kind of its own) whose brain is an AI brain (C4, p424). The actor stays for the NPC's whole life; the tiers change its controller and its
  representation, never its brain or its intent schema (`CharacterIntent`, C3).
- **A tier change is a controller swap** (C2's `attach` / `detach`): `FULL` attaches a character
  controller with its body (the kinematic one, p421, as the NPC default; the dynamic one where an
  NPC must tumble or be pushed), `REDUCED` a navmesh mover controller (p424) with a kinematic proxy
  or no body, `CROWD` a presentation-only mover with no body, and `ABSTRACT` no controller at all.
- **The brain decides at every tier**, but not at the same rate: it gets the `step` and skips steps
  itself (the contracts' risk 3), or the brain system schedules it per tier (this plan's
  question). At `ABSTRACT` it works on the schedule and the coarse graph, not on an intent.
- **Saves:** `ABSTRACT` state, the brain's `{ kind, params }` and the current tier go through the
  save service (p425).

| Tier       | Where (rough)          | Representation                                                                                                                  | Physics                       |
| ---------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `FULL`     | near, ~0–50 m          | `DynamicCharacter`: full controller, animation, later IK and ragdoll                                                            | dynamic body with 4 colliders |
| `REDUCED`  | mid range              | follows a navmesh and snaps to its height, ticks every N sub-steps, simpler animation, crowd avoidance instead of contacts      | none, or a kinematic proxy    |
| `CROWD`    | far, visible           | instanced mesh with vertex animation textures or impostors, moves along the navmesh or splines                                  | none                          |
| `ABSTRACT` | off-screen or unloaded | data only: schedule, task and a node on a coarse world graph; the position is worked out from the time when the NPC is promoted | none                          |

Each tier needs:

- **Hysteresis**, so an NPC doesn't flicker between tiers (eg. promote at 60 m, demote at 80 m).
- **No popping** (p350 §3): a tier change that changes the representation (`FULL` / `REDUCED` to
  `CROWD`, `CROWD` to hidden) cross-fades with p351's dither, both representations drawn for
  `fadeSeconds` (0 = instant).
- **A hard budget**: when a tier is full, the least relevant NPC is demoted. Relevance should
  cover more than distance, eg. whether the player is in combat with or talking to the NPC.
- **Safe promotion**: snap to the ground with one ray, and spawn out of sight where possible.

## Rough current limits (to be measured in Phase 0)

- About 100–150 active `DynamicCharacter`s in `MAIN_THREAD` mode, and somewhat fewer in
  `WORKER_THREAD` mode. Animation and rendering likely limit you first, at around 50–100
  animated characters on screen.
- Hot spots in the dynamic controller (`src/_engine/features/character/controllers/dynamic/`):
  - A floor ray every tick, also while idle (`Floor.ts`' `refreshFloorNormal`; a skip at rest
    changes the gym's and `topDownTestScene`'s path hashes, so it's a deliberate baseline update).
  - A wall shape cast while near a wall (`Wall.ts`' `refreshWallHit`).
  - On `MAIN_THREAD` both casts are synchronous. In `WORKER_THREAD` mode each is its own
    `postMessage` round trip with a Promise (`messageWorkerAsync`, `features/physics/PhysicsMessaging.ts`;
    at most one in flight per cast, `Casts.ts`). Casts don't travel in the frame's STEP message.
  - Captured sub-step commands (`setLinvel`, `setRotation`) are `structuredClone`d one by one at
    capture (`PhysicsMessaging.ts`).
- `features/character/Character.ts`' two systems (`characterBrainSystem`, `characterControllerSystem`)
  run every brain and tick every controller every sub-step. There is no way to tick a character
  less often.

## Rough phases (to be refined)

0. **Measure.** Build a stress scene with N characters (idle, walking, crowded), in both worker
   targets, with and without animation. Record main-thread, worker and GC cost per character.
1. **Make `FULL` cheaper.** Skip or throttle the floor ray while grounded and idle, batch the
   worker casts into the STEP message, and add a per-character tick-rate option. This is useful
   on its own, even without NPCs.
2. **NPC actor and tier manager.** NPC actors (C1) with an AI brain, and a tier-selection
   system (distance plus relevance, hysteresis, budgets). Attach and detach a character controller
   (C2: the first caller of `attach` / `detach`, with p421) on `FULL` promotion and demotion, while
   the actor itself stays. The tier policy's step-clock pattern (`PhysicsTierPolicy.ts`: measure on
   step multiples, decide `interval` steps later, `addPhysicsStepGate` in the worker) is the
   model for a deterministic selection.
3. **`ABSTRACT` simulation.** Schedules and tasks on a coarse world graph, and "where should
   they be now?" worked out on promotion.
4. **`REDUCED` tier.** A navmesh mover as another character controller, on p424's navmesh
   generation and pathfinding (eg. recast-navigation-js); the engine has neither today.
5. **`CROWD` tier.** Instanced or impostor rendering. This overlaps p350's impostor work (p351).

## Dependencies and open questions

- **World streaming.** The physics world is per-scene and reset on every scene load, so an NPC
  out in the world can't rely on colliders existing under it. `FULL` NPCs need the streamed cells
  around the player (p353).
- **Runtime body migration in `WORKER_THREAD` mode** is an async round trip. It needs an explicit
  mid-transition state (p350 §6; the generic tiers' `REMOVED` round trip, `_DONE_p352`), or an NPC
  can be double-created or operated on while it has no body. The generic tiers refuse characters
  (`src/_engine/features/physics/CLAUDE.md`'s Simulation tiers): this plan owns their tiers.
- **`PhysicsTransformBuffer`'s fixed `maxBodies`.** Promotion churns slots; a full buffer rejects
  a create with `PhysicsCapacityError`, which the promotion catches and treats as a refusal (p350 §6).
- **Large-world float precision.** Rapier uses 32-bit floats, so positions start to jitter a few
  km from the origin. Is an origin rebase needed?
- **Kinematic or dynamic `FULL` bodies?** Most AAA engines move NPCs with kinematic sweep
  controllers and use a dynamic body only as a ragdoll. The contracts point NPCs at the kinematic
  controller (p421, on Rapier's `KinematicCharacterController`, only a commented-out signature in
  `features/physics/types/PhysicsWorldTypes.ts` today) and keep `DynamicCharacter` for the player
  and for tumbling; this plan confirms it with Phase 0's numbers.
- **Determinism.** Characters are deterministic on `MAIN_THREAD` (step-index time, the seeded
  stream `character:<id>`, synchronous casts), not yet in the worker targets (p428). Does
  `ABSTRACT` simulation need to be deterministic or replayable, eg. for save games? If so it
  follows the simulation rules (the Hub's coding standards, The simulation; p510's multiplayer
  path).
- **Save data.** `ABSTRACT` NPC state is game state, saved through p425's save service; what it
  holds is this plan's question.

## The gameplay contracts (p603)

p603 fixed the contracts every gameplay feature builds on; this is their summary for the 42x stubs
(p421-p428), which refer to them by number. A contract is firm when it has two real
implementations (or one and a named second one in a stub); otherwise it's a direction that waits.
C1-C5 are in the code since p610: the user guide is the Hub's architecture page
(`hub/pages/documentation/architecture/guide.md`, Actors, controllers, brains and intents), the
detail `src/_engine/features/character/CLAUDE.md` and `src/_engine/kernel/input/CLAUDE.md`.

- **One model for everything that acts in the world:** a player character, an NPC, a vehicle, a
  remote player and a cutscene actor differ in which controller moves them and which brain decides
  what they want, not in their base code. Generic contracts and one solid implementation each in
  the engine; ready-made controllers, brains and effects in the toolkit; game logic in the app.
- **C1. Actor (firm).** An ECS entity whose record holds `{ kind, controller, brain }` (for
  characters the `CHARACTER` component, kind `'CHARACTER'`); `kind` is open (`'VEHICLE'`, … by
  declaration merging). No class hierarchy: what an actor can do is the components it has.
  Controller and brain kinds are registered by name with a factory (`registerControllerKind`,
  `registerBrainKind`), so a save or a network message records `{ kind, params }` and the factory
  rebuilds the instance (`createCharacterOfKind`). The body's own kind is `bodyKind`.
- **C2. Controller (firm: dynamic today, kinematic next, p421).** `ActorController<TIntent>`:
  `kind`, `tick(dt, intent, step)` at `APP_PHYSICS_STEP`, `attach` / `detach` (typed, never called
  until a controller is swapped on a live actor: p421, this plan), `dispose`, `probes` (what the
  debug gizmos draw), `config` (the live-editable values). It moves bodies only through the
  Physics API, so a backend's own controller is another kind. Only the tick writes the body:
  collision callbacks record, the tick applies. `step` is the step index.
- **C3. Intent (firm for `CharacterIntent`; direction for `VehicleIntent`, p423, and a
  `CameraIntent`).** Plain, serializable data written by brains, read by one controller per step,
  cleared by the controller's rules (the moves, turn and jump last one step). One schema per actor
  kind, not a general intent (risk 1).
- **C4. Brain (firm).** `ActorBrain<TIntent>`: `kind`, `think(intent, step, dt)`,
  `configDefaults`, `dispose`. One system runs every brain at `APP_PHYSICS_STEP` (order -5),
  before the controllers (-10); a brain writes the intent and never touches a body or a device. It
  goes with its actor and can be switched at runtime (`setCharacterBrain`: possession, a cutscene
  takeover, a disconnected player handed to AI). Built: the player brains `TANK`, `WORLD_FIXED`,
  `CAMERA_RELATIVE` and the app's `GYM_DUMMY`; to come: AI (p424), `SCRIPT` (p426) and network
  brains (p511).
- **C5. Actions above devices (firm).** Devices produce actions through bindings per context
  (`GAMEPLAY`, `DEBUG`, app contexts such as "in a vehicle", p423), sampled right before each step
  and recordable per step (`createActionMap`, `recordActions`). Brains and UI read actions, never
  keys.
- **C6. Animation (direction, p422).** Presentation side (`APP_RENDER_SYNC`, `POSE_CONSUMERS`):
  it reads the simulation and never writes it; root motion is the open question (risk 2). Ragdoll
  is a control mode (`PHYSICS_ONLY`) plus jointed bodies (p250).
- **C7. World systems (direction; randomness firm and built).** Game events, missions and save
  games (p425), the sequencer and splines (p426), weather and mood with the time-of-day clock
  (p427). Randomness is named seeded streams (`getRandomStream(name)`, `utils/RandomStreams.ts`,
  restarted on every scene load), never `Math.random` in simulation code.
- **Where each lives:** the actor, controller and brain contracts in `features/character/` (named
  generically, so a vehicle feature can lift them); controllers in `features/character/controllers/`;
  a vehicle controller in `features/vehicle/`; the action layer in `kernel/input/`; animation in
  `features/animation/`; events, missions, the sequencer and splines in `features/gameplay/`;
  weather in `features/weather/`; the save service in the kernel. The toolkit ships ready-made
  brains, graphs, mission templates and presets; the app its own.
- **Risks:** (1) the intent is humanoid today: generalizing it into one schema for every actor
  kind would be over-abstraction, so one schema per kind, the brain and controller agreeing on it.
  (2) Root motion in a deterministic simulation means the animation graph runs in the simulation
  too; most networked games keep it off for remote actors (p422). (3) Brains and controllers on
  different tick rates: the contract passes `step`, so either can skip steps itself; whether the
  brain system schedules it is this plan's question.

## Prior art

- **Unreal:** Significance Manager (tick budget by importance), animation Update Rate
  Optimization, and the Mass framework (City Sample: thousands of agents, where only the nearby
  ones become full actors with physics).
- **GTA V:** distant peds and vehicles become cheap "dummies" moved along road and path networks,
  then are despawned and regenerated statistically.
- **Skyrim / Oblivion:** off-screen NPCs follow their schedules on a coarse path graph between
  cells.
