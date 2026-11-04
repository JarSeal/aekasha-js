Status: stub — not-implemented
Category: Networking, Characters, Physics
Blocked by: p500_restore-physics-snapshot.md (restore that rebinds the proxies), p428_character-determinism-in-worker-targets.md (deterministic characters in the worker targets, the default), p511_network-transport-and-replication.md (the snapshots it reconciles against)
Related: `src/_engine/features/character/CLAUDE.md` and `src/_engine/kernel/input/CLAUDE.md` (deterministic characters on `MAIN_THREAD`, the per-step action recording), p510_headless-simulation-runtime.md (The multiplayer path: model 2, the measurements), p421_kinematic-character-controller.md (the controller the local player is predicted with), p423_vehicles.md (a vehicle the local player drives)

# Client Prediction and Reconciliation — Stub

**This is a stub.** It records the goal, what the multiplayer study (p604, summarized in p510)
measured and the open questions so the real plan can be written after its blockers. Nothing here
is a final design.

## Goal

The local player's character responds to input at once instead of a round trip later: the client
simulates it ahead with its own actions, the server's snapshots confirm or correct it, and on a
mismatch the client rewinds the character to the server's state and replays the actions it sent
since. Remote entities stay interpolated (p511).

## Grounding (2026-11-04, the measurements from p604)

- **Snapshots are cheap; re-simulation isn't.** Rapier, plain in Node, with box stacks mid-collapse:
  take / restore 0.25 / 0.54 ms with 256 awake bodies, 0.89 / 1.33 ms with 1,568, 3.0 / 4.0 ms
  with 4,000 (0.4-7.4 MB). But Rapier re-simulates only the whole world, and one step after a
  restore is 0.8, 4.5 and 11.7 ms for those three, so replaying 6-10 steps per correction fits
  only a small active world.
- **So the local character is predicted alone:** a kinematic controller (p421) moved against the
  world by sweeps can be re-run for N steps without stepping the world, and corrected by itself.
  Whole-world rewind is for small worlds (and for rollback, p510's model 4).
- **Characters are deterministic on `MAIN_THREAD` only** (step-index time, the seeded stream
  `character:<id>`, synchronous casts); in the worker targets they still tick on the main thread against the latched
  snapshot and async casts (p428), and the KCC's sweeps must run inside the step (p421's open
  question 1, the same decision). Prediction needs the client's character to match the server's
  for the same actions, but not bit for bit across machines: small differences are corrected.
- p500 makes a physics snapshot restorable with the API's proxies rebound; its non-goals are ECS
  rewind and character state, which this plan adds for the predicted entity.

## Open questions

1. **What is predicted:** the local character only, or also what it touches (a pushed crate, a
   vehicle it drives, p423).
2. **The rewind unit:** the character's controller state plus its body (KCC), or a physics world
   restore (p500) for small worlds.
3. **Correction smoothing:** snap, or blend the visual over a few frames while the simulation
   snaps (presentation only: it reads the simulation and never writes it).
4. **The action history:** the action layer's per-step recording (`recordActions`: a frame per
   step, plain data; `playActionRecording` stands in for a map's devices) as the replay buffer, its
   length against the round-trip time, and how acknowledged steps trim it.
5. **Mismatch detection:** a per-step state hash or a position tolerance (the determinism probe's
   hash per entity, or the scene runner's per-step character path hash, as a debug view).
