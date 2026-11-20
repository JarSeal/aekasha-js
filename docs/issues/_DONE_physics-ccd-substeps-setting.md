**Title:** The world's max CCD substeps has no setting: always Rapier's default of 1

Status: fixed | 2026-11-05, p622 (D7, Phase 3 section 2)
Category: Physics
Found: 2026-10-17, p614 Phase 4 (A9: a `TODO` on `WorldProxyAPI`'s settings copy, removed)
Our workaround (until p622): call `getPhysicsWorld().setMaxCcdSubstepsSync(n)` after each world is created

## What happens

Every other world setting (gravity, timestep, solver and PGS iterations) comes from
`AppConfig.physics` through the physics state, is shown and edited in the Physics API debug tab,
and is applied to every new world (`createPhysicsWorld`, each scene load's `resetPhysicsWorld`).
The max CCD substeps isn't: each world starts at Rapier's default of 1, and a value set with
`WorldAPI.setMaxCcdSubstepsSync` is lost with the world at the next scene load.
`WorldProxyAPI` keeps 1 in its copy for `getMaxCcdSubstepsSync` until a getter or setter call.

## What it would take

- `AppConfig.physics.maxCcdSubsteps` (and `PhysicsState`'s), defaulted in `PhysicsState.ts`.
- Passed to the backend's world create with the other options, on both targets.
- A Physics API debug tab field, saved like the other world settings.
- p622 renames `setMaxCcdSubstepsSync`, a one-way setter named like a sync getter (p614 Phase 3).

## The fix (p622 Phase 3 section 2)

`AppConfig.physics.maxCcdSubsteps` (default 1, Rapier's) goes to every new world on both
targets, as the other world settings do: the physics state, `createPhysicsWorld`'s options, the
backend's `createWorld` and each scene load's `resetPhysicsWorld`. 0 is a value (CCD off), so it's
passed with `??`. The worker proxy's copy starts from the state. The Physics API tab has a field
for it, saved and on the undo history like the solver settings. The setter is
`WorldAPI.setMaxCcdSubsteps` (engine 6.0.0; the codemod renames `setMaxCcdSubstepsSync` calls).
`PhysicsFacade.test.ts` and `PhysicsWorkerRequests.test.ts` check that a new world gets the
setting, 0 included.
