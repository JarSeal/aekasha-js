**Title:** Five mirrored Rapier enums aren't used by any API field, so `PhysicsHooks` can never run

Status: open | wire them in a minor, or drop them in p622
Category: Physics
Found: 2026-10-17, p614 Phase 3 (documenting the types); filed in Phase 8

## What happens

`features/physics/types/` mirrors five Rapier enums that nothing in the Physics API takes or
returns:

- `ActiveHooks` and `ActiveCollisionTypes` (`PhysicsColliderTypes.ts`): no `ColliderParams` field
  sets a collider's active hooks or collision types. The backend keeps Rapier's defaults (no
  hooks; collisions with dynamic bodies only, so a kinematic and a fixed collider, or two
  kinematic ones, never report a contact).
- `PhysicsHooks` and `SolverFlags` (`PhysicsEventTypes.ts`): `WorldAPI.step(eventQueue, hooks)`
  passes `hooks` to Rapier on `MAIN_THREAD`, but Rapier calls them only for colliders with
  `ActiveHooks` set, which no collider can have. The facade's own stepping passes none, and a
  worker can't be handed functions. So a contact filter can't be written today.
- `ActiveEvents` (`PhysicsColliderTypes.ts`): the backend derives a collider's active events from
  its `collisionEventFn` / `contactForceEventFn` and the `enable*ActiveEvents` flags, never from
  this enum.
- `CoefficientCombineRule` (`PhysicsColliderTypes.ts`): `ColliderParams`' combine rules are the
  string union `'AVERAGE' | 'MIN' | 'MULTIPLY' | 'MAX'`.

`EngineRapier.test.ts` pins all five to Rapier 0.19.3's names and numbers, so they're correct, just
unused.

## Options

1. **Wire them in (a minor):** `ColliderParams.activeCollisionTypes` (useful on its own: sensors
   and kinematic platforms that should report contacts with fixed geometry) and
   `activeHooks`; the hooks themselves need a registration that both targets can run, a named
   hook module the worker `import()`s like the assets worker's jobs, since a worker can't be handed
   a closure. That's a plan of its own.
2. **Drop them in engine 6.0.0** (p622 lists this as its fallback): `ActiveHooks`,
   `ActiveCollisionTypes`, `ActiveEvents`, `CoefficientCombineRule`, `SolverFlags`, `PhysicsHooks`
   and `WorldAPI.step`'s `hooks` parameter. None is on an entry, so in a minor they could already be
   marked `@internal` (only `WorldAPI.step`'s signature names `PhysicsHooks`).
