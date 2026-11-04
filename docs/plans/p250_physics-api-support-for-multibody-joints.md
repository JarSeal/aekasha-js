Status: draft | not-implemented | needs-replanning
Category: Physics
Related: p026 (impulse joints, implemented; its plan file has been removed, so replan against the shipped code, named below), p500_restore-physics-snapshot.md (a restore rebinds every joint proxy: multibody joints need their own pass), p422_animation-state-graph-and-ik.md (ragdoll joints)
Epic: https://trello.com/c/8ROzNdXe/161-make-a-possibility-to-run-the-physics-engine-in-a-thread-threading-architecture-for-all-upcoming-thread-implemantations-not-just

# Physics API Support for Multibody Joints — Plan

**The shipped impulse joints** (paths relative to `src/_engine/features/physics/`, its layout in
`src/_engine/features/physics/CLAUDE.md`): `types/PhysicsJointTypes.ts` (`JointParams`, `JointAPI`;
`WorldAPI`'s commented-out `createMultibodyJoint` in `types/PhysicsWorldTypes.ts`), `protocol/`
(the `JOINT` range 800-999 in `PhysicsProtocolType.ts`), the backend's `backends/rapier/RapierJoints.ts`
(the maps in `RapierState.ts`, `proxies/EngineJointProxyAPI.ts`), the facade's `PhysicsJoints.ts`
(creates, deletes, `isBodyJointed`), `PhysicsRegistry.ts` (its joint map) and
`proxies/JointProxyAPI.ts`, the worker's `worker/PhysicsSwitchJoint.ts`, and the joint demos' row in
`src/app/scenes/physicsTest/physicsTest.ts`. A new message type takes free numbers in a range; a
retired one keeps its number, commented.

Adds Rapier **multibody-joint** support to the engine-agnostic Physics API, as a follow-up to
p026's impulse-joint work (implemented). Split out because multibody joints
are a genuinely separate Rapier solver with different tradeoffs and a smaller JS-level surface —
bundling both into one plan would roughly double p026's scope for a feature most game-engine use
cases don't need immediately.

## Context (grounded in code)

- Rapier (`@dimforge/rapier3d-compat@0.19.3`) exposes multibody joints as a fully separate API
  from impulse joints: `RAPIER.World.createMultibodyJoint(params: JointData, parent1, parent2,
wakeUp): MultibodyJoint`, `RAPIER.World.multibodyJoints: MultibodyJointSet` (`createJoint`,
  `remove`, `get`, `contains`, `forEach`, `forEachJointHandleAttachedToRigidBody`), and joint
  classes `MultibodyJoint`/`UnitMultibodyJoint` plus concrete subclasses (`FixedMultibodyJoint`,
  `PrismaticMultibodyJoint`, `RevoluteMultibodyJoint`, `SphericalMultibodyJoint`). They reuse the
  same `RAPIER.JointData` static factories (`fixed`/`revolute`/`prismatic`/`spherical`) as impulse
  joints, but the resulting joint object exposes no motor configuration at the JS level (only
  `isValid()`, `body1()`/`body2()`, `setContactsEnabled()`/`contactsEnabled()` — no
  `configureMotor*`/`setLimits`, unlike `UnitImpulseJoint`). Multibody joints use Rapier's
  reduced-coordinate articulated-body solver — no drift between connected bodies, better suited to
  rigid chains (e.g. robot arms) than impulse joints' soft-constraint solver, at the cost of the
  missing motor/limit controls.
- p026 (implemented) is the direct precedent this plan extends: the `JointParams`/`JointAPI`
  shape, the `JOINT` numeric range (800-999), the `worker/PhysicsSwitchJoint.ts`
  switch, and the backend's and the facade's joint registries it introduced. **This
  document was written before p026 landed: re-check every shape below against the shipped code
  before detailed design** — it is a placeholder outlining the shape of the work, not a fully
  grounded implementation plan yet.

## Design decisions (draft — revisit against the shipped p026 code)

1. **Separate id space and API surface from impulse joints**, not a `solver` flag on the existing
   `JointParams`/`JointAPI` — motor/limit methods don't apply to multibody joints, so folding them
   into one type would mean most `JointAPI` methods silently no-op/throw depending on solver type.
   Likely shape: `createMultibodyJoint(params: MultibodyJointParams): Promise<MultibodyJointAPI>`,
   a `MultibodyJointParams` union re-using the same per-type field shapes p026 defines for
   `FIXED`/`REVOLUTE`/`PRISMATIC`/`SPHERICAL` (multibody joints don't support `ROPE`/`SPRING`/
   `GENERIC` — Rapier only exposes the four listed concrete subclasses), and a
   `MultibodyJointAPI` with only the base `ImpulseJoint`-equivalent methods (no limits/motor).
2. **New protocol range**, e.g. `MULTIBODY_JOINT` at `1000-1199` (next free slot after the
   `JOINT` range ends at 999; the range list in `PhysicsProtocolType.ts`' doc grows with it), with
   a new `worker/PhysicsSwitchMultibodyJoint.ts` following `PhysicsSwitchJoint.ts`' template.
3. **The backend gets a second, parallel set of maps** (`multibodyJoints`/
   `multibodyJointAPIs` on `RapierState.ts`' `backend`, its own id counter; the code in a
   `RapierMultibodyJoints.ts` next to `RapierJoints.ts`) — mirroring, not reusing, the
   impulse-joint maps, since Rapier itself tracks them in a fully separate `MultibodyJointSet`.
4. **`deleteRigidBody` must reap both joint sets** — extend the `jointIds` cleanup (the backend's
   delete result, the facade's `forgetBodyParts` in `PhysicsBodies.ts`) with an equivalent pass over
   `world.multibodyJoints.forEachJointHandleAttachedToRigidBody`, likely via a second
   `multibodyJointIds: number[]` field next to `jointIds`.
5. **The simulation tiers count multibody joints too:** jointed bodies change tier as a group and
   can't be `REMOVED` (`isBodyJointed`, `PhysicsJoints.ts`; `src/_engine/features/physics/CLAUDE.md`'s
   Simulation tiers), so `isBodyJointed` and the tier group walk read both registries.
6. **Snapshots (p500):** Rapier serializes multibody joints, so p500's restore needs a fourth
   rebind pass (survivors rebound, reaped and orphans swept) for them; p500 lists it in its
   non-goals for this plan.
7. **Test scene example**: add one demo to the physics test scene (e.g. a short articulated chain
   of 3-4 links connected by multibody `REVOLUTE` joints) placed near the joint demos' row
   (`JOINT_DEMO_Z`), ideally positioned so it can be visually compared against the impulse-joint
   `REVOLUTE` demo to show the drift/stability difference between the two solvers.

## Phases (draft)

**Phase 1 — Engine API additions.** `MultibodyJointParams`/`MultibodyJointAPI` types (on
`aekasha/physics`, documented: the docs ratchet), protocol range, backend, facade (a
`PhysicsMultibodyJoints.ts` next to `PhysicsJoints.ts`, branching once on `isWorkerTarget()`),
`WORKER_THREAD` proxy and worker switch — mirroring the impulse joints' modules, substituting
`multibodyJoints`/`createMultibodyJoint` for `joints`/`createJoint` throughout. Tests next to the
impulse joints' (`backends/rapier/EngineRapier.test.ts`, `PhysicsFacade.test.ts`,
`PhysicsWorkerRequests.test.ts`); `worker/PhysicsWorker.test.ts` keeps the worker bundle free of
three and the facade.

**Phase 2 — Test scene example and the Hub.** Add the articulated-chain demo to the physics test
scene, near the joint demos' row; the physics feature page (`hub/pages/features/physics/`) gets
the multibody joints next to the impulse ones.

Manual verification for both phases: `?isDebug=true`, visually confirm correct behavior in both
`MAIN_THREAD`/`WORKER_THREAD` modes; `yarn test`, `yarn verify:scenes --only physicsTest` (the
scene's probe hash changes once, with the demo: update its baseline with the reason).

## Non-goals

- Motor/limit control for multibody joints — not exposed by Rapier at the JS level for this joint
  type; nothing to add.
- `ROPE`/`SPRING`/`GENERIC` multibody joints — Rapier doesn't expose multibody equivalents of
  these (only Fixed/Revolute/Prismatic/Spherical concrete subclasses exist).
- Unifying the impulse-joint and multibody-joint API surfaces into one type — see Design
  decision 1.

## Risks / open questions

| Risk / question                                                        | Notes                                                                                                                                  |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| The decisions were written before p026's shapes shipped              | Re-check each against the shipped joint modules (listed at the top) before detailed design: they extend them by analogy.                  |
| Whether a unified vs. separate API surface is the right call long-term | Worth a deliberate second look once both exist side by side and real usage patterns emerge — flagged here rather than decided.         |

## Verification

- `yarn test`, the lint and `tsc` clean after each phase (the Stop hook runs them).
- `yarn verify:scenes` (the physics test scene's hash in all three targets) and
  `yarn verify:baselines` (the new API and its docs).
- Manual visual verification of the articulated-chain demo against the impulse-joint `REVOLUTE`
  pendulum, in both `workerTarget` modes.
