Status: stub — not-implemented
Category: Gameplay, Save games
Related: p420_npc-simulation-tiers.md (The gameplay contracts: C7's events, missions and the save service; `ABSTRACT` NPC state is game state), p510_headless-simulation-runtime.md (The multiplayer path, rule 7: serializable components, shared with network replication), p511_network-transport-and-replication.md (what is replicated), p500_restore-physics-snapshot.md (the physics part of a save), `src/_engine/features/character/CLAUDE.md` (controllers and brains rebuilt from `{ kind, params }`, `createCharacterOfKind`), p355_save-menu-and-file-server-settings.md (not this: it saves debug edits into asset JSONs)

# Game Events, Missions and Save Games — Stub

**This is a stub.** The gameplay contracts (p420) leave all three as a direction (C7): nothing
implements them. This plan decides their shapes.

## Goal

- **Game events:** a typed event bus in the simulation (`emitGameEvent`), delivered in a fixed
  order at a fixed stage, which missions, achievements, audio and UI subscribe to.
- **Missions and objectives:** state machines over game events, with their state in save data.
- **Save games:** components marked serializable, saved and loaded by one service, which mission
  state, p420's `ABSTRACT` NPCs and network snapshots (p511) share.

## The direction it starts from (C7)

- Collision events already have a fixed delivery point: `flushPhysicsEvents`
  (`features/physics/PhysicsMessaging.ts`), once per sub-step, after the action sample and the held
  keys and before `APP_PHYSICS_STEP` (`MainLoop.ts`' `runFixedSubStep`). The bus delivers there or
  right after.
- Event types are declared by declaration merging (like the actor `kind`), so the toolkit and the
  app add their own.
- Actors save their controller and brain as `{ kind, params }` (C1); the registries rebuild them.

## Grounding (2026-11-04)

- No event bus. The listener APIs are per feature with their own shapes: `onLocomotionStateChange`,
  per-collider collision callbacks, `onSkyBoxChange`, `registerOnSceneExit`, `onDevDataGathered`,
  `onGeometryDeleted`.
- No missions and no save games. `__saveData` is the debug tools' per-scene asset overrides, and
  p355 is about writing those into the repo.
- No ECS serializer. `takePhysicsSnapshot` / `restorePhysicsSnapshot` exist (`@internal`) but don't
  rebind the cached proxies (p500 repairs them). Entity ids are per world (index + generation);
  `appId` (the `APP_ID` component) is the stable id, looked up by a map (`getEntityIdByAppId`,
  `getPhysicsEntityByAppId`).
- Components holding closures exist (a collider's event callbacks, a brain's state inside its
  factory's closure): a serializable component is data only, so what a save restores of an actor is
  its `{ kind, params }` plus a state the kind can write and read back.
- The UI kit's game UI (p808) shows objectives but tracks none: its objective tracker displays what
  it's given, so the quest logic is this plan's. The player's settings (key rebinding, audio,
  graphics) are saved by the app today, not by a save service.

## Open questions

1. **Which existing listeners move onto the bus:** gameplay ones (locomotion, collisions) or none,
   keeping the bus for game code.
2. **Delivery:** within the sub-step that emitted (re-entrant, ordered by emission) or queued to the
   next fixed point; and whether presentation code (UI, audio) gets its own frame-time delivery.
   In the worker targets a contact's `EVENTS_PUSH` lands at whichever sub-step follows its
   arrival, so an event emitted from one isn't on a fixed step until p428 step-stamps them (its
   open question 3).
3. **Save format and storage:** JSON or binary, versioned per component; localStorage, IndexedDB,
   a file, or a backend; the slot UI belongs to the app (on the UI kit's game UI: its menus and items,
   `src/_engine/ui/CLAUDE.md`).
4. **What a load restores:** a scene load plus component state, or a physics snapshot too (p500);
   bodies mid-flight need the second.
5. **Mission authoring:** code-first state machines or a data asset (`*.mission.json`), and the
   debug tab that shows and forces their state.
