**Title:** The world's max CCD substeps has no setting: always Rapier's default of 1

Status: open | for a physics feature plan
Category: Physics
Found: 2026-10-17, p614 Phase 4 (A9: a `TODO` on `WorldProxyAPI`'s settings copy, removed)
Our workaround: none needed yet; call `getPhysicsWorld().setMaxCcdSubstepsSync(n)` after each world is created

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
