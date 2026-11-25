Status: implemented (Phases 0-2)
Category: Physics
Related: p026 (impulse joints, implemented; its plan file has been removed, so replan against the shipped code, named below), _DONE_p500_restore-physics-snapshot.md (a restore rebinds every joint proxy: multibody joints need their own pass), p422_animation-state-graph-and-ik.md (ragdoll joints)
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

- Rapier (`@dimforge/rapier3d-compat`, 0.21.0 since Phase 0) exposes multibody joints as a fully
  separate API from impulse joints: `RAPIER.World.createMultibodyJoint(params: JointData, parent1,
parent2, wakeUp): MultibodyJoint`, `RAPIER.World.multibodyJoints: MultibodyJointSet`
  (`createJoint`, `remove`, `get`, `contains`, `forEach`, `forEachJointHandleAttachedToRigidBody`),
  and joint classes `MultibodyJoint`/`UnitMultibodyJoint` plus concrete subclasses
  (`FixedMultibodyJoint`, `PrismaticMultibodyJoint`, `RevoluteMultibodyJoint`,
  `SphericalMultibodyJoint`). They take the same `RAPIER.JointData` as impulse joints, all seven
  types (`ROPE`, `SPRING` and `GENERIC` insert and step too, as a plain `MultibodyJoint`). The
  joint object has only `isValid()`, `setContactsEnabled()` and `contactsEnabled()`: no
  `body1()`/`body2()`, no anchors, no `configureMotor*`/`setLimits` (checked on 0.19.3 and
  0.21.0), so the engine keeps the body ids itself, as `proxies/JointProxyAPI.ts` already does.
  Multibody joints use Rapier's reduced-coordinate articulated-body solver — no drift between
  connected bodies, better suited to rigid chains (e.g. robot arms) than impulse joints'
  soft-constraint solver, at the cost of the missing motor/limit controls.
- p026 (implemented) is the direct precedent this plan extends: the `JointParams`/`JointAPI`
  shape, the `JOINT` numeric range (800-999), the `worker/PhysicsSwitchJoint.ts`
  switch, and the backend's and the facade's joint registries it introduced. **This
  document was written before p026 landed: re-check every shape below against the shipped code
  before detailed design** (done: the Design decisions below are replanned against it).

## Rapier's multibody joints, measured (Phase 0)

Probed in Node, each case in its own process (a WASM panic, `RuntimeError: unreachable`, kills the
world: every later call throws "recursive use of an object"), on a chain of revolute links hanging
from a fixed root:

| Operation                                                                                              | 0.19.3          | 0.21.0          |
| ------------------------------------------------------------------------------------------------------ | --------------- | --------------- |
| Insert closing a loop (both bodies in one multibody)                                                   | panic at insert | panic at insert |
| Insert whose second body already has a parent (not its multibody's root)                               | panic at insert | panic at insert |
| A non-root link `FIXED` or kinematic (two fixed bodies, a fixed body as a child, a link made so later) | panic at step   | panic at step   |
| A dynamic body made the parent of a fixed root                                                         | panic at step   | panic at step   |
| Delete a body in the middle of a chain                                                                 | panic           | ok              |
| Remove the last joint of a chain, or all of them; rejoin after a split                                 | panic           | ok              |
| A free (dynamic) root made `FIXED` later                                                               | panic           | ok              |
| `applyImpulse` on a link                                                                               | ignored         | applied         |
| `setEnabled(false)` on one link                                                                        | ignored         | ignored         |
| `setEnabled(false)` on every link                                                                      | freezes it      | freezes it      |
| `setTranslation` on a link                                                                             | ignored         | ignored         |
| An impulse joint closing a multibody loop (Rapier's way to make one)                                   | ok              | ok              |
| Snapshot take / restore (handles kept), the restored world steps                                       | ok              | ok              |
| The same run twice                                                                                     | identical       | identical       |

So on 0.19.3 deleting any entity of a chain killed the world, which is why Phase 0 upgrades Rapier.
What still panics on 0.21.0 the engine refuses itself before calling Rapier (Phase 1).

Probed again on 0.21.0 in Phase 1 section 1, the same way:

| Operation                                                                               | 0.21.0                                                                                                                                                     |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A kinematic child; a link with a parent made kinematic later                            | panic at step                                                                                                                                              |
| Insert on a disabled child, a disabled parent, two disabled bodies                      | ok                                                                                                                                                         |
| A kinematic root; a free root made kinematic; a fixed root made dynamic                 | ok                                                                                                                                                         |
| `setNextKinematicTranslation` or a velocity on a kinematic root                         | ignored (the body alone follows them)                                                                                                                      |
| `setTranslation` on a fixed, kinematic or free root                                     | moves the whole chain                                                                                                                                      |
| A `body2` that is the root of its own chain                                             | ok, its chain goes under `body1`                                                                                                                           |
| Every link of one branch under a fixed root disabled                                    | that branch frozen, the other swings                                                                                                                       |
| A free root deleted                                                                     | ok, its child the new root                                                                                                                                 |
| An impulse joint between two branches of one multibody, one branch disabled (section 3) | panic at step; the whole multibody disabled is ok, and so is an impulse joint to a body outside it                                                         |
| The joint's handle                                                                      | its child body's handle: a joint made again on the same child gets the deleted one's handle, and the deleted joint's object answers `isValid()` true again |

What this means for Phases 1-2 (found in Phase 0; the Design decisions below decide each):

- **Guards before Rapier's insert:** the engine tracks each multibody's tree (each body's parent
  and its multibody's root) and refuses, with an error naming the bodies, a joint whose bodies are
  in one multibody already (a loop: an impulse joint closes one) or whose second body has a parent;
  a second body that isn't `DYNAMIC`; a first body that isn't dynamic unless it's its multibody's
  root (a fixed base).
- **Body type changes:** a multibody link made `FIXED` or kinematic panics, so `setBodyType` (the
  backend's proxy) refuses it on a link (a free root's `FIXED` is fine on 0.21.0).
- **Simulation tiers:** the impulse joints' rule (i250: a jointed group's `DISABLED` is `STATIC`)
  panics for a multibody group, whose `STATIC` must never be used; `DISABLED` works for the whole
  group only (one disabled link is ignored). So `toJointSafeTier` and `onPhysicsJointCreated`
  branch on the joint kind, and a group with both kinds needs a rule.
- **World bounds:** an exited jointed body is made `FIXED` (`RapierWorldBounds.ts`), which panics
  for a link: a multibody link needs another action (disable its whole multibody, or delete).
- **Unhelpful on a link:** `setTranslation` is ignored (teleport the root, or the whole chain);
  worth a debug warning.
- **Body ids:** Rapier's `MultibodyJoint` has no `body1()`/`body2()`, so both proxies keep the ids
  from the params, and the delete's reap reads the backend's own map.

## Design decisions

Replanned against the shipped impulse joints (the modules at the top) and Phase 0's measurements.

1. **A separate API surface.** `createMultibodyJoint(params): Promise<MultibodyJointAPI>`,
   `deleteMultibodyJoint(id, wakeUp?)` and `getMultibodyJoint(id)` on `aekasha/physics`, beside
   `createJoint` / `deleteJoint` / `getJoint`. `MultibodyJointParams` is `JointParams`' `FIXED`,
   `REVOLUTE`, `PRISMATIC` and `SPHERICAL` members (an `Extract`, so the shapes and
   `toWireJointParams` are shared); `body1Id` is the parent, `body2Id` the child. `ROPE`, `SPRING`
   and `GENERIC` are left out: they insert and step, but Rapier gives them no class and what a
   rope or a spring means in reduced coordinates is unverified (adding them later is additive).
   `MultibodyJointAPI` has what Rapier's `MultibodyJoint` has: `id`, `isBeingDeleted`, the user
   data (`uData`, `getUserData`, `getUserDataSync`, `setUserData`), `isValid` (+ `Sync`),
   `body1Id` / `body2Id` (+ `Sync`, from the params in both targets), `contactsEnabled` (+ `Sync`)
   and `setContactsEnabled`. No anchors (Rapier has no getter for them), no limits or motors.
   `WorldAPI`'s commented-out three become `createMultibodyJoint` / `createMultibodyJointSync`,
   `getMultibodyJoint` / `getMultibodyJointSync` and `removeMultibodyJoint`, which bypass the
   facade's registry as `createJoint` does (the backend's guards still apply).
2. **The guards are the backend's** (`backends/rapier/RapierMultibodyJoints.ts`), so they hold in
   both worker targets and for the world's own creates. The backend keeps each linked body's
   parent (`multibodyParents`, `RapierState.ts`: child body id → its parent's id and the joint's
   id); a body's multibody root is the walk up. `createMultibodyJoint` throws before calling
   Rapier, the error naming both bodies and the rule (on `WORKER_THREAD` the worker's `ERROR`
   rejects the caller's promise), for:

   - one body joined to itself;
   - a `body2` that isn't `DYNAMIC` (covers two fixed bodies, a fixed or kinematic child, a
     dynamic parent of a fixed root);
   - a `body2` that has a parent already;
   - two bodies in one multibody (one root): a loop, and the error says an impulse joint closes
     one;
   - a `body1` that isn't `DYNAMIC` and has a parent (a fixed or kinematic body is a root only);
   - a detached (`REMOVED`) body: not found, as for impulse joints.

   A `body2` that is the root of a multibody of its own is allowed (its subtree goes under
   `body1`), and so is an insert on a disabled body: both step fine (Phase 1 section 1's probes,
   below).

3. **Keeping the tree true.** The body proxy's `setBodyType` throws for a body with a parent
   unless the type is `Dynamic` (a root may change: a free root made `FIXED` or kinematic, a fixed
   one made dynamic, all step fine). `deleteRigidBody` reaps the body's multibody joints
   (`multibodyJoints.forEachJointHandleAttachedToRigidBody`) and returns their ids as
   `multibodyJointIds` beside `jointIds` (the `DELETE_RIGID_BODY(IES)` replies, the facade's
   `forgetBodyParts`), and drops their parent entries: its children become roots, as Rapier splits
   the multibody there. `deleteMultibodyJoint` drops its child's entry. `detachRigidBody` refuses a
   body with a multibody joint too. `deleteWorld` clears the maps (the running ids go on).
   `setTranslation` / `setRotation` on a body with a parent warn in the debug env (Rapier ignores
   them; moving the root moves its whole chain). A kinematic root stays where it is under
   `setNextKinematicTranslation` / `Rotation` and a velocity (both kinematic types; the same body
   without a chain follows them), and only `setTranslation` moves it: those two warn in the debug
   env on a root with children, and the docs say to move a multibody's base by `setTranslation`
   each step, or to hang the chain from it with an impulse joint.
4. **Its own ids, maps and messages.** The backend's `multibodyJoints` (id → handle),
   `multibodyJointAPIs`, `handleToMultibodyJointId` and `multibodyParents`, with their own running
   id; the facade's `multibodyJoints` registry in `PhysicsRegistry.ts` (cleared, forgotten and
   counted with the others: `getPhysicsObjectCounts().multibodyJoints`). The protocol's
   `MULTIBODY_JOINT` range, 1000-1199: `CREATE_MULTIBODY_JOINT` 1000, `DELETE_MULTIBODY_JOINT` 1001,
   `MULTIBODY_JOINT_IS_VALID` 1002, `MULTIBODY_JOINT_CONTACTS_ENABLED` 1003,
   `MULTIBODY_JOINT_SET_CONTACTS_ENABLED` 1004, `MULTIBODY_JOINT_GET_USERDATA` 1005,
   `MULTIBODY_JOINT_SET_USERDATA` 1006, the id field `multibodyJointId`, the switch
   `worker/PhysicsSwitchMultibodyJoint.ts` (`getSubType`'s `'MULTIBODY_JOINT'`). No batch forms:
   the impulse joints' `CREATE_JOINTS` / `DELETE_JOINTS` have no facade caller.
5. **Simulation tiers.** A tier group follows both kinds of joint through dynamic bodies, and ends
   at a fixed or kinematic one as now: every link of a branch under a fixed root disabled freezes
   that branch while another swings (measured), so a multibody's branches are groups of their own.
   A link disabled alone isn't frozen (Phase 0), which is why a group changes tier whole. The
   group's joints decide what it can be (`toJointSafeTier`, by the kinds in the group):

   | The group has    | `STATIC`                     | `DISABLED`              | `REMOVED`                       |
   | ---------------- | ---------------------------- | ----------------------- | ------------------------------- |
   | impulse joints   | `STATIC`                     | `STATIC` (i250, as now) | refused (the batch: `STATIC`)   |
   | multibody joints | `DISABLED` (no `FIXED` link) | `DISABLED`              | refused (the batch: `DISABLED`) |
   | both             | `FULL`                       | `FULL`                  | refused (the batch: `FULL`)     |

   Both kinds is the loop-closing case: `STATIC` panics a link, and `DISABLED` is i250's unchecked
   second symptom on the impulse joints, so it stays simulated; `requestPhysicsTier` warns in the
   debug env when it maps a request to `FULL`. `onPhysicsJointCreated` gets the joint's kind and
   applies the rule to the joined group when a body's tier or target isn't `FULL` (a multibody
   joint in flight counts as jointed, as impulse ones do). `applyTier`'s net, per body: `STATIC`
   on a body with a multibody joint is `DISABLED`, `FULL` with both kinds. `isBodyJointed` and the
   policy's `unifyJointGroups` read both registries (`forEachJointBodyPair` gains the multibody
   pairs).

6. **World bounds.** A multibody link that leaves its box takes its multibody out with it: every
   dynamic link of its tree, through a fixed or kinematic root too, is disabled and recorded as an
   exit (the one that left first). Not just its branch: with an impulse joint between two branches,
   one branch disabled alone panics (section 3's probe). So
   the action runs for each of their entities (`'DELETE'` deletes the chain, `'DISABLE'` disables
   it, and a put-back enables it whole; a link's own `ignore` doesn't keep it in when another link
   leaves). The others' records name the body that left
   (`OutOfBoundsRecord.takenWith`, and the public `WorldBoundsExitInfo.takenWith`, null for a body
   that left itself; the exits list shows it). A body with only impulse joints keeps the i250 rule
   (`FIXED`); one with both kinds follows its multibody (`FIXED` would panic).
7. **Snapshots** (p500): the restore's walk gets a fourth kind, multibody joints, claimed by
   handle (rebound or reaped) like the impulse ones. Their orphans are always taken out, whatever
   `orphanPolicy`: Rapier can't tell the engine a multibody joint's bodies, so a kept one would
   hide a parent from the guards. Then the parent map is rebuilt from the surviving proxies.
   `RestoreSnapshotDelta` gains `reapedMultibodyJointIds` and `orphanCounts.multibodyJoints`; the
   facade forgets them, and the debug tab's readout lists them.
8. **The demo** (Phase 2): a chain of four links on multibody `REVOLUTE` joints from a fixed root,
   in the joint demos' row (`JOINT_DEMO_Z`) beside the impulse `REVOLUTE` pendulum, so the two
   solvers' drift can be compared.

## Phases

### Phase 0: Rapier 0.19.3 → 0.21.0 — done

Done in this branch, before the multibody work (the user's call: one branch, one PR). On 0.19.3
multibody joints are safe only if never deleted (the table above).

As built:

- `package.json` pins `@dimforge/rapier3d-compat` `0.21.0` (`yarn.lock`; yarn also merged two
  identical `string-width` / `strip-ansi` entries). The package moved its files under `dist/`;
  the engine imports only the package name, so nothing else changed.
- The API's mirrored enums gained Rapier's new members, which `EngineRapier.test.ts` pins:
  `RigidBodyTypeAPI.SoftFrame = 4` (Rapier's soft bodies' frame; the API makes none; the entity
  window's `BODY_TYPE_LABELS` has it) and `ShapeType.Compound = 8` (no other number moved).
  `proxies/ColliderProxyAPI.ts` typed `shapeType()` with Rapier's `ShapeType` instead of the
  API's: it compiled only while they were identical.
- Other API changes checked and needing nothing: every getter takes an optional `target` and still
  returns a fresh object without one; `halfExtents()` / `heightfieldScale()` may return null (the
  engine's paths only reach them for their shapes); `IntegrationParameters.minIslandSize` and
  `fromRaw` (unused) are gone; ray and shape-cast hits keep their field names.
- **Sensors:** `normalizedPredictionDistance`'s default went from 0.002 to 0.02, and a capsule
  sensor reports touching up to 9 mm before it does (0 on 0.19.3); on a hard landing (the gym's
  characters, 6-9 m/s) the character's wall sensor, lifted 5 cm, touched the floor 29 mm before
  it would have, which counted as hitting a wall at the fall speed: the players tumbled. Setting the
  old prediction distance shrinks the resting margin to 2 mm but not the landing's. Fix: the wall
  tumble reads the horizontal speed (`Wall.ts`, `tumblingWallSpeedThreshold`'s docs and debug
  hint), after which the gym's players go through `main`'s locomotion states again; the
  random-walking `testDummyChar` adds a `SLIDE` (its route drifts with the solver).
- **i250:** its panic repro steps fine on 0.21.0 (and 0.20.0); the second symptom (other joints
  mis-solved) has no small repro, so the workarounds stay (the issue's new section; the comments
  in `RapierJoints.ts`, `PhysicsTiers.ts` and `PhysicsFacade.test.ts`).
- **Size:** `assets/rapier.js` 810.2 → 1605.2 KiB gzip (its WASM's soft bodies, convex
  decomposition and compound shapes; 0.20.0, with the same fixes, was ~1085 KiB). The user chose
  0.21.0: `sbp.config.ts`' budget 843 → 1670 KiB, `devTools/verify/baselines/bundle.json`
  recorded. API, docs and the embeds' bundles unchanged.
- **Scenes:** baselines recorded on `main` (d68cc2c7) first, then the branch run: 46 of 219 runs
  failed, all probe hashes (the same new hash in every configuration of a scene), character path
  hashes and snapshots, no errors or system order changes. Re-recorded on the branch; every
  scene's hashes agree across configurations but `space`'s, already `unstableHash` in the worker
  targets (on `main` they happened to agree).
- Versioning (the last phase): the engine's bump covers the upgrade (the public enums' new
  members, the wall tumble's rule) with the multibody API; `CHANGELOG.md` names the upgrade, the
  bundle growth and the character change.

### Phase 1: Engine API — done

Mirrors the impulse joints' modules, section by section, each stopped for review. Every section
leaves `yarn test`, the lint and `tsc` clean.

1. **The backend** (D1-D4's backend side) — done. `MultibodyJointParams` / `MultibodyJointAPI` in
   `types/PhysicsJointTypes.ts` (documented: the docs ratchet), the maps in `RapierState.ts`,
   `RapierMultibodyJoints.ts` (the create with D2's guards, the delete),
   `proxies/EngineMultibodyJointProxyAPI.ts`, the contract (`EngineAPIType`:
   `createMultibodyJoint`, `deleteMultibodyJoint`, `getMultibodyJointAPIWithId`;
   `deleteRigidBody(ies)`' `multibodyJointIds`) and `EngineRapier.ts`' exports, D3 in
   `RapierBodies.ts`, the body proxy and `RapierWorld.ts`' `deleteWorld`. Tests in
   `EngineRapier.test.ts`: each guard throws and the world still steps; each of Phase 0's "ok"
   rows through the engine (a middle body deleted, the tree split and a rejoin allowed; the last
   joint removed; a free root made `FIXED`); a `body2` root with a subtree; a kinematic root; an
   insert on a disabled body; `setTranslation` on the root.

   As built:

   - The probes the plan asked for ran first, in Node (the second table under the measurements).
     They changed D2 (an insert on a disabled body is fine: no guard), D3 (a kinematic root ignores
     kinematic targets and velocities: a warning) and D5 / D6 (a disabled branch under a fixed root
     freezes, so a group ends at a fixed or kinematic body as now), all written into the
     decisions. And a multibody joint's handle is its child body's: `EngineMultibodyJointProxyAPI`
     checks its id is still in `multibodyJoints` (`isValidSync` false after a delete, and
     `contactsEnabled` / `setContactsEnabled` throw "has been deleted": the Rapier object would
     reach a joint made again on that child). Section 4's restore must allow for it too: the
     handle test can't tell a joint deleted and made again on the same child since the snapshot.
   - The tree is two maps in `RapierState.ts`, `multibodyParents` (child → `{ parentId, jointId }`)
     and `multibodyChildCounts`, written only by `RapierMultibodyJoints.ts`' `link` / `unlink`;
     `isInMultibody(bodyId)` reads them (the detach's refusal). `reapBodyMultibodyJoints` is the
     body delete's reap.
   - `RapierJoints.ts`' `JointData` switch is `toJointData` now, which both kinds use. The create
     also refuses a type outside the four at run time (a wire message isn't type-checked).
   - The guards' errors: "Could not create a multibody joint (body1 id: …, body2 id: …): <rule>."
     `setBodyType`'s: "Rigid body … can't be made Fixed: it's a multibody link with a parent (body
     …, multibody joint …), …". The ignored-move warnings come once per body (`setTranslation` /
     `setRotation` on a link with a parent, `setNextKinematicTranslation` / `Rotation` on a root
     with children), debug env only. `RigidBodyAPI.setBodyType`'s docs name the rule.
   - `WorldAPI`'s three methods moved to section 2: `WorldProxyAPI` implements `WorldAPI`, so
     they land together. Section 2 also checks the link rule in `RigidBodyProxyAPI.setBodyType`
     on the main thread from the facade's registry (a child is a joint's `body2`): it caches the
     type before sending, so a refusal only in the worker would leave the cache wrong.
   - Until section 4 a snapshot restore left the multibody proxies on the replaced world's joints
     (section 4 fixed it).

2. **The facade and the worker** (D1, D4) — done. `PhysicsMultibodyJoints.ts` (the create and delete,
   branching once on `isWorkerTarget()`; the bodies in flight; `forEachMultibodyJointBodyPair`,
   `isBodyInMultibody`), the registry, the protocol (the range, up and down messages,
   `PhysicsResponses.ts`), `proxies/MultibodyJointProxyAPI.ts`, the switch and `getSubType`, the
   body delete replies and `forgetBodyParts`, `WorldAPI`'s three methods (the types,
   `EngineWorldProxyAPI`, `WorldProxyAPI`), the main thread's link check in
   `RigidBodyProxyAPI.setBodyType`, the entry's exports. Tests in
   `PhysicsFacade.test.ts` and `PhysicsWorkerRequests.test.ts`: create, each query, a guard's error
   reaching the caller, a body delete forgetting its multibody joints, the world's reset clearing
   them; `worker/PhysicsWorker.test.ts` keeps the worker bundle clean.

   As built:

   - `PhysicsMultibodyJoints.ts`: `createMultibodyJoint` (with an `@example`) / `Sync`,
     `deleteMultibodyJoint` / `Sync`, `forEachMultibodyJointBodyPair`, `isBodyInMultibody`,
     `hasMultibodyParent` and `hasMultibodyJoints` (the last four for the tiers, section 3). A
     `WORKER_THREAD` create counts its bodies, and its child apart, as in flight until the reply, so
     `isBodyInMultibody` and `hasMultibodyParent` see the joint from the request on. The create
     doesn't tell the tiers yet (section 3's listener).
   - `aekasha/physics` gains `createMultibodyJoint`, `deleteMultibodyJoint`, `getMultibodyJoint`
     (the registry's lookup, beside `getJoint`) and the types `MultibodyJointAPI` /
     `MultibodyJointParams`.
   - `RigidBodyProxyAPI.setBodyType` throws for a type other than `Dynamic` when
     `hasMultibodyParent`, before caching it; the message is the backend's, less the parent's ids
     (the main thread doesn't keep them).
   - The switch (`physicsSwitchMultibodyJoint`) takes the backend only, and is synchronous: the
     create calls `engAPI.createMultibodyJoint` directly (the impulse switch goes through the world
     proxy).
   - `toWireJointParams` is generic over the params' type; `PhysicsBodies.ts`' `forgetBodyParts`
     takes the delete's reply whole (`BodyParts`), its `multibodyJointIds` included.
   - `getPhysicsObjectCounts()` has `multibodyJoints`; the profiler's overview line shows it in
     section 4.
   - Tests: `PhysicsFacade.test.ts` (`MAIN_THREAD`: the registry, a refusal rejecting, the link
     rule, a body's delete, a joint's delete, the world's own create and lookup bypassing the
     registry, a new world forgetting them) and `PhysicsWorkerRequests.test.ts` (the proxy, a
     FIXED joint's frames sent plain, each query and setter, the worker's refusal rejecting, the
     link rule from the request on with the cache unchanged, the deletes).

3. **Tiers and world bounds** (D5, D6) — done. `PhysicsTiers.ts` (the group walk, `toJointSafeTier`,
   `applyTier`, the listener), `PhysicsTierPolicy.ts`' groups, `RapierWorldBounds.ts`' exit,
   `takenWith` through the records, the stats and the exits list. Tests next to the impulse
   joints' tier cases in `PhysicsFacade.test.ts` (each row of D5's table, a group through a fixed
   root, a joint made on a `DISABLED` group) and the world bounds' cases (a link's exit disabling
   and recording its multibody, `'DELETE'` deleting every entity).

   As built:

   - The probe this section's first backend test hit: an impulse joint between two branches of one
     multibody panics at the next step with one branch disabled (the table). D6 takes the whole
     multibody (`getMultibodyLinks`, `RapierMultibodyJoints.ts`: the tree from its root, the
     dynamic links, the exited one first), not the branch; D5's branch groups stay safe, since such
     an impulse joint joins the branches into one group with both kinds (`FULL`).
   - The tiers (`PhysicsTiers.ts`): `hasAnyJoints` and `forEachJointedBodyPair` (both kinds; the
     policy's `unifyJointGroups` uses them too) instead of extending `forEachJointBodyPair`;
     `toSafeTier(kinds, tier)` is D5's table, on bits from `getBodyJointKinds` (in-flight joints
     included); `toJointSafeTier` ORs the group's, `applyTier` uses the body's own.
     `requestPhysicsTier` warns in the debug env when it maps a request to `FULL`.
   - The listener takes no kind: the group's joints are read from both registries. An impulse
     joint still tells the tiers at its call; a multibody one once it exists
     (`setMultibodyJointCreatedListener`, `PhysicsMultibodyJoints.ts`, after the create or the
     reply), since a tiered body is safe to insert on and a refused create shouldn't move a tier.
     `onPhysicsJointCreated` acts on a body whose target is `STATIC` or `DISABLED` (no longer on a
     `DISABLED` tier with a `FULL` target pending: that's leaving it anyway).
   - `OutOfBoundsRecord.takenWith` is optional (absent for a body that left itself, so the wire and
     the impulse records are unchanged); `WorldBoundsExitInfo` and `WorldBoundsExitEvent` (the
     `onExit` argument too) have `takenWith: number | null`. The debug env's exit log names the
     body that left for a taken link, and the exits list shows "with its multibody".
   - Tests: `EngineRapier.test.ts` (a link outside its box: its multibody disabled, not `FIXED`,
     with an impulse joint between its branches, recorded in order), `PhysicsFacade.test.ts` (D5's
     rows, the batch, a branch as its own group, a group with both kinds staying `FULL` with the
     warning, the listener, `applyTier`'s net with the listener off; `'DELETE'` deleting every link
     entity, the fixed root kept).

4. **Snapshots, the debug tab and the docs** (D7) — done. `RapierRestore.ts`' fourth walk and the
   parent map's rebuild, `RestoreSnapshotDelta`, `PhysicsWorld.ts`' forget, the Snapshot folder's
   readout and the tab's counts; a restore test (rebind, reap, an orphan taken out under `'KEEP'`)
   in both targets. `src/_engine/features/physics/CLAUDE.md` (the layout, Simulation tiers' joints,
   World bounds' exit, the restore), the i250 issue's multibody note pointing at D5,
   `yarn verify:baselines --update` for the API, docs and bundle baselines (the physics chunk
   grows; the reason in the plan's As built).

   As built:

   - **The parent test.** A multibody joint's handle is its child body's, so the handle test alone
     would rebind a joint deleted and made again on the same child since the snapshot to the
     snapshot's joint, under another parent too. Probed in Node first: in the restored world a
     body's `forEachJointHandleAttachedToRigidBody` lists its own link's joint and its children's,
     so the restored joint is the stored one's only when the stored parent lists it
     (`isSameMultibodyParent`, also checking the stored child's handle is the joint's). The claim
     takes it as an optional `isSame` check, and runs after the bodies' reap, so a parent made
     since the snapshot has no handle and its joint is reaped. Under the same parent the joint is
     the same link and is kept as the snapshot's: its frames, type and contacts setting are the
     snapshot's, which no API reads (`MultibodyJointAPI` has no frame getters). The delta's docs
     say so.
   - **Orphans** (`removeOrphanMultibodyJoints`) are taken out after the `'DELETE'` policy's bodies,
     whatever the policy. `orphanCounts.multibodyJoints` counts every unclaimed one, those an
     orphan body's removal took with it included (collected before the removal, as the impulse
     joints' are). The debug env's not-an-exact-rewind warning names the multibody counts.
   - **The tree** is made again after the safety net (`rebuildMultibodyTree`,
     `RapierMultibodyJoints.ts`, from the kept proxies' body ids), so a joint reaped or invalid
     leaves no parent behind. The safety net checks the multibody joints too.
   - **The facade:** `applyRestoreDelta` forgets `reapedMultibodyJointIds` (marked
     `isBeingDeleted`); the worker's reply spreads the delta, so nothing changed there.
     `RestoreSnapshotOpts.orphanPolicy`'s docs say multibody joints are always taken out.
   - **Debug:** the Snapshot folder's reaped and orphans readouts list multibody joints. The tab
     has no object counts of its own: "the tab's counts" is the profiler's overview line
     (`_dbg__ProfilerOverview.ts`, "Physics bodies"), which adds "· N multibody joints" only when
     there are some.
   - **Tests:** `EngineRapier.test.ts` (a chain rebound with its tree and guards, the restored
     world's contacts setting, the same steps after; reaped joints, including one between bodies
     the snapshot had, dropped from the tree; orphans taken out under `'KEEP'` and `'DELETE'`, a
     kept middle body's joints included, its child free to join again; a joint made again on the
     same child, reaped under another parent and kept under the same one),
     `PhysicsFacade.test.ts` and `PhysicsWorkerRequests.test.ts` (rebind, reap, an orphan taken
     out under `'KEEP'`, the child free to join again, in each target).
   - **The docs:** `src/_engine/features/physics/CLAUDE.md` gets the modules in the layout, a
     Multibody joints bullet in its Physics section (not a `##` section of its own, so the Hub's
     `aek:covers` is unchanged), the restore's fourth walk, the world bounds' multibody exit and
     the tier table under Simulation tiers. The i250 issue's multibody note points at D5 and D6.
   - **Baselines** (`yarn verify:baselines --update`, Phase 1 whole): the backend chunk
     `EngineRapier.js` 11.2 → 12.9 KiB gzip (+1.7: the multibody module, its proxy, the guards,
     the tree and the restore's walk; the worker's copy the same), `PhysicsWorker.js` 9.7 → 10.0
     (+0.3: the switch), the main chunk's `_engine/features/physics` 27.1 → 28.0 (+0.8, 31 → 33
     modules: `PhysicsMultibodyJoints.ts` and the proxy; the app lists `physics()`). The API
     baseline adds the five entry exports and the internal modules' names; docs stay at 100 %.
     No debug code in the production build or the embeds, whose bundles are unchanged.

### Phase 2: The demo, the Hub and the release — done

1. D8's chain — done. In `src/app/scenes/physicsTest/physicsTest.ts`, checked by eye with `?isDebug=true`
   in both worker targets against the impulse pendulum; `yarn verify:scenes --only physicsTest
--update` (its probe hash changes once, with the demo: the reason in the As built).

   As built:

   - **A twin, not one chain.** The row's impulse `REVOLUTE` demo is a single arm spun by a
     velocity motor about Y, not a pendulum, so it has no drift to compare a chain against. The
     demo is two chains made by one function (`createChainDemoAsync`): four 0.5 m links hinged end
     to end on Z axes from a static anchor at y = 8, started level to the anchor's right, so they
     fold and swing in the row's plane (the camera looks down the row's normal). One on impulse
     joints (yellow, the `REVOLUTE` arm's colour), one on multibody joints (deep blue; white was lost
     against the sky), each joint's contacts off as in the other demos. They sit right after the
     `REVOLUTE` arm.
   - **The row's spacing** is 42 m over the demos (`42 / (JOINT_DEMOS.length - 1)`, 5.25 m for
     nine; it was 7 m for seven), so x still runs from -21 to 21 on the 50 m ground. Clearances:
     a chain reaches 2.1 m from its anchor, the `REVOLUTE` arm 2.0 m, the `SPHERICAL` ball 3 m;
     the closest pairs keep about 1 m.
   - **The scene runner:** the probe hash went `ba5d3240` → `d45557a0`, the same in `workerSab`,
     `workerMsg` and `mainThread` (the demo's 10 bodies and the moved row); the snapshots stayed
     within tolerance, `prodTest` passed, no errors. Re-recorded with `--update`. The scene JSON's
     `description` names the chains.
   - **By eye:** only the runner's 512 px snapshots (both chains hanging joined, in every target);
     the close-up comparison in both worker targets was left to the user's review.

2. The physics feature page — done. `hub/pages/features/physics/`: multibody joints next to the impulse
   ones, what each solver is for, the guards and the tier table, a snippet from the demo through a
   `#region`; `yarn hub:build`. `readme.md`'s physics line.

   As built:

   - **The physics page** (`guide.md`): "Queries, events and joints" split into "Queries and events"
     and "Joints": a table of the two solvers (create, types, bodies, how they're solved, controls,
     what each is for), the demo's `multibody-chain` region from `physicsTest.ts` (the
     `createChainDemoAsync` function and its constants: it makes both chains, so it shows both
     APIs), and a "Multibody joints" subsection (parent and child, the root, D2's refusals, D3's
     body type, delete and ignored-move rules). "Simulation tiers" gets a "Joints and tiers"
     subsection with D5's table; the `REMOVED` column says "refused" only, since the distance
     policy's `REMOVED` is refused like any request (`PhysicsTierPolicy.ts`): only streaming's
     batch asks again for `STATIC`, which the table then maps. World bounds names D6's whole
     multibody and `takenWith`; Snapshots D7's orphans; Key APIs the two creates and deletes. The
     page's `aek:tags` add multibody, articulation and ragdoll.
   - **Other pages:** the game HUD walkthrough's `#queries-events-and-joints` link is
     `#queries-and-events` now; the streaming page's tier table lost its two joint lines for a
     paragraph under it giving each kind's mapping, linking the physics page's table.
   - **No `::: scene` panel**: `physicsTest` has no Hub image (only the examples and
     `OTHER_HUB_SCENES` do), so the page names the scene and its `?startScene` URL instead.
   - `readme.md`'s Physics API line names both kinds of joint.

3. Versioning — done. Phase 0's notes: the engine's bump covers the upgrade with the multibody API;
   `CHANGELOG.md` (the upgrade, the bundle growth, the character change, the multibody joints),
   `yarn checkVersions --against main`, and the plan marked done.

   As built:

   - **Engine 6.26.0 → 6.27.0** (minor: the multibody API, the enums' new members, `takenWith`
     and the restore delta's fields only add; the simulation's change with Rapier's is no API
     break), the project version with it. **App 1.35.0 → 1.36.0** (minor: the demo). The toolkit
     is unchanged (3.8.1). `yarn checkVersions --against main` passes.
   - `CHANGELOG.md`'s entry (Engine: Added, the multibody API, its tree and checks, `takenWith`,
     the restore delta, the enums, the profiler line; Changed, Rapier 0.21.0 with the scenes'
     simulation, its download and the SBP budget, the tiers by joint kind, the wall tumble. App:
     the chains and the row's spacing).
   - The file is `_DONE_p250_…` now; `p422`'s Related line and `_DONE_p500`'s two mentions name
     it. No `CLAUDE.md` names the file, and the nested physics one has the multibody joints since
     Phase 1 section 4; the root's Physics section names no joints, so it's unchanged.

## Non-goals

- Motor/limit control for multibody joints: Rapier's JS `MultibodyJoint` has none.
- `ROPE`/`SPRING`/`GENERIC` multibody joints (D1): Rapier accepts and steps them, unverified.
- Unifying the impulse-joint and multibody-joint API surfaces into one type (D1).
- Multibody joints in the scene JSON: joints are code only, like the impulse ones.

## Risks / open questions

| Risk / question                                                                                                                              | Notes                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| A group with both kinds stays `FULL` (D5)                                                                                                    | The safe choice until i250's second symptom is checked on 0.21.0; `DISABLED` for it is the alternative, accepting that risk. |
| Rapier's behaviour Phase 0 didn't probe (an insert on a disabled body, a kinematic root, a moved root, a disabled branch under a fixed root) | Section 1's tests pin each; a panic becomes a guard, a surprise a change to D3 or D5 written into the plan.                  |
| A unified vs. separate API surface long-term                                                                                                 | Worth a second look once both exist side by side and real usage patterns emerge.                                             |

## Verification

- `yarn test`, the lint and `tsc` clean after each phase (the Stop hook runs them).
- `yarn verify:scenes` (the physics test scene's hash in all three targets) and
  `yarn verify:baselines` (the new API and its docs).
- Manual visual verification of the articulated-chain demo against the impulse-joint `REVOLUTE`
  pendulum, in both `workerTarget` modes.
