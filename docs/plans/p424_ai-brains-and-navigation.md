Status: stub — not-implemented
Category: AI, Characters
Blocks: p420_npc-simulation-tiers.md (soft: its `REDUCED` tier moves on the navmesh)
Related: `src/_engine/features/character/CLAUDE.md` (the brain contract and `registerBrainKind` in code; the gym's `GYM_DUMMY` is the first app brain), p420_npc-simulation-tiers.md (The gameplay contracts: C4, the AI brain), p421_kinematic-character-controller.md (the NPC default controller), p425_game-events-missions-and-save-games.md (AI reacting to game events), p510_headless-simulation-runtime.md (The multiplayer path: step-index time, the seeded RNG), \_DONE_p346_spatial-domains.md (neighbour queries)

# AI Brains and Navigation — Stub

**This is a stub.** It records the goal, the contract and the open questions so the real plan can
be written on the contracts p610 built.

## Goal

The AI brain, navmesh generation and pathfinding, and steering:

- **Engine:** the brain contract (built by p610) and navmesh queries (find a path, the nearest point on the
  mesh, a raycast along it).
- **Toolkit:** ready-made AI (a behaviour tree or utility AI runner, patrol, follow, flee) as brain
  kinds.
- **App:** the game's AI.

## The contract it implements (C4, p420's The gameplay contracts)

- An AI brain is a brain kind (`registerBrainKind`, from a feature's install), its
  `think(intent, step, dt)` run by the one brain system (`characterBrainSystem`, order -5) before
  the controllers. It writes `CharacterIntent` (or a vehicle's `VehicleIntent`) and never touches
  a body or a device; it counts durations in steps and draws randomness from a named stream, and
  its file goes on the simulation lint (`SIMULATION_FILES`, `eslint.config.js`).
- It reads the world through queries (navmesh, spatial domains, raycasts), never by holding a
  controller's internals.
- A brain that skips steps (thinking every N steps for cheap NPCs) reads `step` itself (the
  contracts' risk 3); whether the brain system schedules it is p420's question.

## Grounding (2026-11-04)

- The gym's dummy is the scripted brain kind `GYM_DUMMY`
  (`src/app/scenes/thirdPersonGymScene/GymDummyBrain.ts`, registered in `AppECSPlugins.ts`' install):
  it counts steps from its first think and switches between walking forward and turning every
  period. The pattern for an app brain; this plan's first AI brain replaces its script with a goal.
- No navmesh or pathfinding dependency (`package.json` has no recast, yuka or similar).
- Spatial domains (`registerSpatialDomain`, the `spatial()` feature,
  `src/_engine/features/spatial/CLAUDE.md`) give neighbour queries for perception and crowd
  avoidance.

## Open questions

1. **Navmesh generation:** recast-navigation-js (WASM, runs in a worker) at build time from the
   scene's colliders, at load time, or both (tiles regenerated for moving obstacles).
2. **Where pathfinding runs:** the assets worker, a navigation worker, or the physics worker next to
   the colliders it was built from; queries answering a step late are the async-cast problem again.
3. **Crowd steering:** Detour's crowd, our own RVO on spatial domains, or none until p420.
4. **Behaviour authoring:** code-first behaviour trees, utility AI, or data assets; which the toolkit
   ships first.
5. **Determinism:** pathfinding results and random choices through the seeded RNG streams
   (`getRandomStream`), so an AI scene probes the same hash every load; its characters' paths are
   checked by the scene runner's path hash (an input script, or none for AI alone).
6. **Debug tools:** a navmesh overlay (the `lines()` feature), the selected NPC's path and current
   task in its Character state window (a brain group next to the controller's folders, on the UI
   kit's property grid).
