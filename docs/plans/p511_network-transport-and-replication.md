Status: stub — not-implemented
Category: Networking
Blocked by: p510_headless-simulation-runtime.md (a server to talk to)
Blocks: p512_client-prediction-and-reconciliation.md
Related: `src/_engine/features/physics/CLAUDE.md` (Worker targets: the transport interface in front of `postMessage`, `features/physics/transport/`), p510_headless-simulation-runtime.md (The multiplayer path: the verdict and rules 4, 5 and 7), p425_game-events-missions-and-save-games.md (serializable components, shared with save games), \_DONE_p346_spatial-domains.md and \_DONE_p352_physics-simulation-tiers.md (interest management), p420_npc-simulation-tiers.md (The gameplay contracts: C4 the network brain, C5 recorded actions, C7 game events)

# Network Transport and Replication — Stub

**This is a stub.** It records the goal, what the multiplayer study (p604, summarized in p510)
measured and the open questions so the real plan can be written after p510. Nothing here is a
final design.

## Goal

Clients and an authoritative server exchange intents and state: clients send their actions or
intents stamped with the step index, the server simulates (p510) and sends snapshots of the
replicated entities, and clients render them interpolated a little in the past. A remote player
is a network brain (C4) on the server and an interpolated entity on other clients.

## Grounding (2026-11-04, the measurements from p604)

- **The physics protocol is the model:** `STEP` carries the steps and the per-sub-step commands,
  replies match by `requestId`, poses come back in one batch per step. All 2,580 messages of p604's
  recording were plain data, which is why a recording, a Node replay and a network can carry them
  (rule 5 keeps it so). A transport interface sits in front of `postMessage` (p614 D5):
  `PhysicsTransport<Out, In>` (`send(message, transfer?)`, `onMessage(fn)` returning its remover,
  `close()`) in `src/_engine/features/physics/transport/PhysicsTransport.ts`, `@internal` until a
  second implementation, with its contract on the type (plain data, in order, one message handled
  to the end before the next). Its two implementations are `WorkerTransport.ts` (the main thread's,
  `close()` terminates the worker) and `WorkerScopeTransport.ts` (the worker's, around `self`).
  Requests stay in the facade (`PhysicsMessaging.ts`: `requestId`s, `ERROR` replies, `stopPhysics`
  rejecting what's pending), not in the transport. A WebSocket and a WebTransport channel are
  further implementations of it.
- **Bandwidth** (`physicsTiers`, 687 bodies, 1,200 steps; payload only, a 6 B packet header
  included, the transport's ~50 B not):

  | Encoding (per body) | Rate | Bodies per packet | Payload, mean / p95 |
  | --- | --- | --- | --- |
  | Full, raw pose (30 B) | 60 Hz | 687 | 9.9 / 9.9 Mbit/s |
  | Full, raw pose + velocities (54 B) | 60 Hz | 687 | 17.8 / 17.8 Mbit/s |
  | Full, quantized (12 B: 16-bit position at 1/64 m, smallest-three rotation in 32 bits) | 60 Hz | 687 | 4.0 / 4.0 Mbit/s |
  | Changed only, quantized 12 B | 60 Hz | 21 | 125 / 176 kbit/s |
  | Changed only, quantized 12 B | 20 Hz | 23 | 45 / 62 kbit/s |
  | Changed only, quantized 17 B (1 mm in ±8 km, 15-bit rotation) | 20 Hz | 23 | 63 / 88 kbit/s |
  | Changed only, raw + velocities (54 B) | 20 Hz | 23 | 199 / 277 kbit/s |

  Full snapshots aren't an option; a join's full state is 8 kB quantized. Only ~3 % of the bodies
  change per step there because the tier policy freezes and removes the far ones: replication
  rides on the tiers and on interest management, never on full snapshots.
- **Identity:** entity ids are per world (index + generation); `appId` (the `APP_ID` component)
  is the stable id (rule 4), looked up through a map (`getEntityIdByAppId`; physics'
  `getPhysicsEntityByAppId`). Without an `appId` an entity gets a generated UUID, so a networked
  entity needs one given.
- **Interest management** has bases: spatial domains (per-domain grids a server can query per
  client, `src/_engine/features/spatial/CLAUDE.md`) and the simulation tiers.

## Open questions

1. **Transport:** WebSocket first (works everywhere, TCP head-of-line blocking), WebTransport
   datagrams later, or both from the start behind the transport interface.
2. **What is replicated:** components marked serializable (rule 7, shared with p425's save
   games), per entity or per component, and who marks an entity networked (a required `appId`).
3. **Snapshot encoding:** delta against the last snapshot each client acknowledged, the
   quantization per component (the 12 B and 17 B pose encodings above), and a schema version.
4. **Interest management:** per-client spatial queries on a domain, the tiers as a replication
   priority, and what a client sees of an entity that leaves its interest.
5. **Interpolation:** the delay (two snapshots at 20 Hz is ~100 ms), extrapolation from velocities
   when a snapshot is late, and how it fits the engine's existing physics interpolation
   (`interpolationMode`).
6. **Input upstream:** actions (the action layer's per-step recording frames, `recordActions`) or
   intents per step, redundancy against loss, and the server's input buffer per client.
7. **Server events** (C7's game events, p425) to clients: reliable and ordered, next to the
   unreliable snapshots.
8. **The transport's scope:** `PhysicsTransport` is `@internal` until a second implementation;
   a network channel either implements it (and it moves out of physics, typed for any protocol)
   or gets an interface of its own with the same contract.
