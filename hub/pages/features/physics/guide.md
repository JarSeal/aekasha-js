## Installing it

List [`physics()`](api:physics), from `aekasha/physics`, in `InitEngine`'s `features` (see
[How the app starts](hub:examples/quick-start#how-the-app-starts)). It installs the physics API
and physics entities, and drives the fixed steps. Without it, neither physics nor Rapier is
loaded, or in a production build. With `AppConfig.physics.enabled: false` it's installed, but no
world is created at boot. The [simulation tiers](#simulation-tiers) are a feature of their own,
[`physicsTiers()`](api:physicsTiers), listed right after it.

An [embedded engine](hub:examples/embed)'s `unmount()` stops physics for good: the world is
deleted (in worker mode, the worker is terminated with it), and every query or create still
waiting for the worker rejects.

## Bodies on entities

A physics object is an ECS entity with a rigid body and its colliders.
[`createPhysicsEntity`](api:createPhysicsEntity) attaches them to an entity you already have (its
`target`, a mesh from [`createMeshEntity`](api:createMeshEntity)), or makes a new one:

<<< src/app/examples/physics/examplePhysics.ts#physics-drop

- A body is `FIXED` (nothing moves it), `DYNAMIC` (the simulation moves it), or kinematic:
  `POS_BASED` or `VELO_BASED`, moved by your code through its next position or its velocity.
- A collider is a box, ball, capsule, cone, cylinder, triangle, triangle mesh, convex hull or
  heightfield. A primitive collider without its sizes takes them from the entity's mesh, when
  [`createGeometry`](api:createGeometry) made its geometry.
- A heightfield's heights are column-major ((`nrows` + 1) × (`ncols` + 1), `nrows` cells along +z
  and `ncols` along +x, centred on the body, each cell split along the diagonal from (row + 1,
  col) to (row, col + 1)). Don't fill them by hand:
  [`toHeightfieldColliderParams({ heights, rows, cols, width, depth })`](api:toHeightfieldColliderParams)
  takes a row-major grid (a generator's, an image's: row r along z, column c along x) and its size,
  and returns the collider's params. [`generateTerrain`](api:generateTerrain)'s `collider: true`
  returns them for its mesh, its cells split as the mesh's, so the collider lies on the mesh
  between vertices too.
- It resolves with the entity id once the body exists (in `WORKER_THREAD` mode, after the
  worker's reply). Deleting the entity removes its body and colliders.
- When the body or a collider can't be made (a `TRIMESH` without indices), it rejects with the
  error, and nothing of it is left: a new entity is deleted, an entity you passed is left as it
  was.
- A dynamic body's pose is written into the entity's transform every frame (at
  `APP_POST_PHYSICS`), and the transform moves its mesh. Your code never copies a position.

## From imported models

[`spawnImportedAsset`](api:spawnImportedAsset) gives a glTF node physics from its custom
properties (Blender's custom properties, the glTF `extras`):

- `isPhysObj: true` makes it a physics node, and `colliderType` picks its collider: `BOX`,
  `BALL`, `CAPSULE`, `CONE`, `CYLINDER`, `TRIMESH`, `CONVEXHULL` or `HEIGHTFIELD`. A physics node
  is a collider only, unless `keepMesh` keeps it rendered too.
- The node with a `rigidType` (`FIXED`, `DYNAMIC`, `POS_BASED`, `VELO_BASED`) carries the body,
  and the physics nodes with the same `index` are its colliders: one compound body. A node with a
  `rigidType` and no `index` is a body of its own. The physics nodes with neither join the file's
  one body without an `index`; when there are several, they join none.
- A physics node left without a body logs a warning naming the import and the node: a second
  `rigidType` in one `index`, a collider without an `index` in a file with several bodies without
  one, or a group with no `rigidType` at all. Give each body and its colliders an `index` when a
  file has more than one.
- A collider's sizes come from its node's geometry and scale, unless the properties give them
  (`hx`, `radius`, `halfHeight`, …). A capsule, cone or cylinder stands on Y, and `spineAxis:
'x'` or `'z'` lays it along that axis. Each shape is centred on its node's origin.
- A `HEIGHTFIELD` node's heights are read by position, not vertex order: each vertex goes to the
  grid point under it (`nCols` / `nRows` count the cells, else they're counted), so Blender's and
  three's row orders both work, and a quantized or reordered mesh too. The collider is skipped,
  naming the node, when a vertex was moved off its grid line in x or z (an overhang: use
  `TRIMESH`) or a grid point has no vertex; a grid that isn't centred on its node gets the offset.
  It warns when the triangles split cells along the other diagonal, since the collider then misses
  the mesh inside them. A [terrain block](hub:features/terrain#terrain-blocks) from the Blender
  add-on follows all of it.
- `density`, `friction` and `restitution` default to 0.2.
- `spawnImportedAsset`'s `physicsParams` override the properties per node from code, or give
  physics to a node without any.
- A `merge` property (`AUTO` or a group's id) draws the node's mesh in a
  [merge group](hub:features/mesh-merging#imported-models); a node whose body isn't `FIXED` is
  refused, unless its group is a
  [batched one](hub:features/mesh-merging#batched-groups-members-that-move).
  [`deriveColliderFromGeometry`](api:deriveColliderFromGeometry) sizes a collider of your own
  from an imported node the same way.

## Where the simulation runs

`AppConfig.physics.workerTarget` picks the thread: `WORKER_THREAD` (the default) or
`MAIN_THREAD`. The API is the same in both. In worker mode:

- The transforms come back through a buffer the physics owns: a real `SharedArrayBuffer` when
  the page is cross-origin isolated, else one batched message per frame. Never one message per
  body.
- The shared buffer is a lock-free triple buffer. At the start of every frame the engine takes
  the newest complete step, so everything that reads physics in a frame (systems, interpolation,
  the debug wireframes) sees the same step.
- `maxBodies` (default 2048) is the buffer's size. A full buffer rejects `createPhysicsEntity`
  with a `PhysicsCapacityError`. `FIXED` bodies take no slot.
- Queries (ray and shape casts) and the body, collider and joint getters return a promise. Their
  `…Sync` twins answer at once on `MAIN_THREAD` and throw in worker mode, except the few the
  worker side keeps a copy of (`bodyTypeSync`, `isEnabledSync`, `getUserDataSync`, …): each API's
  reference says which.
- Every message between the main thread and the worker goes through one transport, as plain
  data and in order. It's internal for now: the seam a network channel will plug into.

::: tip Hosting
`SharedArrayBuffer` needs cross-origin isolation: the headers `Cross-Origin-Opener-Policy:
same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. The dev server sends them. Your
production host should too, or physics falls back to the batched messages.
:::

## Stepping

Physics steps at a fixed rate (`AppConfig.physics.timestep`, 60 steps a second by default), zero
or more times per frame. Systems in the `APP_PHYSICS_STEP` stage run right before each step,
with the fixed step as their delta: that's where anything that must move in lockstep with the
simulation goes (kinematic platforms, character controllers, impulses). Collision and contact
force events arrive at the start of the next step.

In worker mode, the commands those systems send are captured per step, carried in the frame's
one STEP message and replayed in order in the worker.

The world's settings come from `AppConfig.physics`: `gravity`, `solverIterations`,
`internalPgsIterations` and `maxCcdSubsteps` (how many times continuous collision detection, a
body's `ccdEnabled`, continues a fast body's path after a hit in one step; 0 turns it off). Every
world is made from them, each scene load's too, so a value set on the running world
(`getPhysicsWorld().setMaxCcdSubsteps(2)`) lasts until the next scene load. The Physics API debug tab edits and saves them.

## Deterministic scene loads

A scene load holds physics, replaces the world with a fresh one, and lets it step only after
every `createPhysicsEntity` call of the load has finished, awaited or not. So a scene simulates
the same way on every visit, on either thread. What follows from it:

- No physics entity survives a scene switch, and a body or collider from the previous scene is
  stale.
- Physics writes (poses, velocities, impulses, kinematic targets) belong in `APP_PHYSICS_STEP`
  systems or in the scene's load code. Writes from the other stages depend on frame timing.
- Input read at the step is deterministic too: an [action map](hub:features/input)'s `read()`
  returns the sample taken right before each step, so a press lands on the same step whatever
  the frame rate, and a recorded run replays step by step.
- [Characters](hub:features/characters#determinism) are deterministic on `MAIN_THREAD`: they
  count fixed steps, draw from a seeded stream and cast their probes synchronously. In
  `WORKER_THREAD` mode they aren't yet.
- Simulation code that needs random numbers draws from a named stream
  ([getRandomStream](api:getRandomStream)), never `Math.random`: every scene load restarts the
  streams, so a scene draws the same numbers on every visit.

To check a scene, open it with `?isDebug=true&physicsProbe=N`, or use "Determinism probe" in the
Physics API debug tab. It freezes physics N steps after the scene starts, hashes every dynamic
body's state, and compares the hash with the last run of the same scene.

## Snapshots

A snapshot is the physics world's state at one fixed step, to put it back later: a checkpoint to
return to, or a point to rewind to and step again.
[takePhysicsSnapshot](api:takePhysicsSnapshot) takes one, and
[restorePhysicsSnapshot](api:restorePhysicsSnapshot) restores it, as often as you like, in either
thread mode:

```ts
import { restorePhysicsSnapshot, takePhysicsSnapshot } from 'aekasha/physics';

const checkpoint = await takePhysicsSnapshot();
// … later, in the same scene visit
if (checkpoint) await restorePhysicsSnapshot(checkpoint);
```

A restore puts every body back where it was, with its velocity, and sets the step clock back to
the snapshot's step, so step-timed code goes on from there. It's an exact rewind when nothing was
created or deleted since the snapshot. Otherwise the restored world holds what both know: a body
created since is deleted with its entity, and one deleted since stays gone (the debug build warns
when either happens). The restore's result lists them.

- A snapshot belongs to its scene's visit: every scene load makes a new physics world, and a
  snapshot of an earlier one is refused.
- Only physics is in it: no entity, mesh or game state of your own.
- Stepping on from a restore reproduces the original run only when you replay your own inputs
  (forces, impulses, creates and deletes) on the same steps. On one machine it does: 90 steps
  after a restore came out bit for bit the same, on either thread.
- A [multibody joint](#multibody-joints) deleted since the snapshot stays deleted whatever the
  restore's `orphanPolicy`: one put back without the engine knowing its bodies could break a
  chain's tree.

In debug mode the Physics API tab's "Snapshot" folder takes, restores and clears one snapshot, and
shows its size and step, the time each took and what the last restore deleted.

## World bounds

A body that tunnels through a floor or rolls off the edge of a level falls forever, stepping all
the while. A scene's world bounds stop that: a dynamic body whose position leaves the box is taken
out of the simulation on the step it left, on that same step in every run and on either thread,
and its entity is deleted (or handled as its action says, below).

```ts
import { setSceneWorldBounds } from 'aekasha/physics';

// In the scene's code: 50 m below the level, a body is gone
setSceneWorldBounds({ min: { y: -50 } });
```

Or without code, in the scene's JSON:

```json title="myScene.scene.json"
{
  "id": "myScene",
  "sceneFile": "scenes/myScene/myScene.ts",
  "worldBounds": { "min": { "y": -50 }, "max": { "y": 500 }, "action": "DISABLE" }
}
```

Every side of the box is optional, and a missing side is open; where both corners give an axis,
`min` must be below `max`, or the gather fails. The JSON's `action` is `"DELETE"` or `"DISABLE"`: a
callback is code, so a scene-wide `onExit` goes through `setSceneWorldBounds`. A scene keeps its
bounds for its later visits, and its code's `setSceneWorldBounds` replaces its JSON's (for the
later visits too). `AppConfig.physics.worldBounds` gives every scene without its own the same box,
and `null` (`"worldBounds": null`, or `setSceneWorldBounds(null)`) turns them off for one scene.
A scene whose JSON sets them needs `physics()` in `InitEngine`'s features (the
[feature manifest](hub:features/scenes-and-assets#the-feature-manifest)); a `null` one doesn't.

Only dynamic bodies are checked, by their position, not their colliders. In the debug env each exit logs a warning naming the entity:
a body leaving the level is usually a bug (a collider smaller than its mesh, a body spawned inside
another). The determinism probe leaves out the bodies that left by its step.

An entity can have bounds of its own, with
[`setEntityWorldBounds`](api:setEntityWorldBounds) or `createPhysicsEntity`'s `worldBounds`
option (sent with the body, so they apply from its first step). A box with any side replaces the
scene's for that entity; `ignore: true` exempts it. The `action` says what happens to an entity
whose body leaves, the entity's own or else the scene's:

- `'DELETE'` (the default): the entity is deleted.
- `'DISABLE'`: the entity stays, disabled (`world.setDisabled`), its mesh hidden.
- `'CALLBACK'`: `onExit` is called with the exit, and the entity stays as it is, its body out of
  the simulation until your code puts it back.

```ts
import { setEntityWorldBounds } from 'aekasha/physics';

// No box: the scene's kill height applies, but the player respawns instead of being deleted
setEntityWorldBounds(playerId, {
  action: 'CALLBACK',
  onExit: ({ world, entityId }) => {
    const body = world.getRigidBody(entityId);
    body?.setTranslation(spawnPoint, true);
    body?.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body?.setEnabled(true);
  },
});
```

Move a body inside before you enable it again, or the next step takes it out again. A body with
joints is made `FIXED` instead of disabled (the event's `frozen`): put it back with `setBodyType`.
A link of a [multibody](#multibody-joints) takes its whole multibody out with it: every dynamic
body of the tree is disabled and gets the action, each exit's `takenWith` naming the body that
left (`null` for that body itself), so put the chain back whole.
Bounds on a fixed or kinematic body are never read, and the debug env says so.

[`getWorldBoundsStats`](api:getWorldBoundsStats) reads the current scene's bounds (where they come
from: the scene, the app's default or none), how many bodies have left them, and the last 20 exits,
each with its entity's name, step, position and the action taken. In the debug env the Physics API
tab shows the same in its "World bounds" folder, can draw the box (each closed side as a grid; an
open side isn't drawn), and lists the latest exits: a row opens the entity's edit window while it
still exists. That window's "World bounds" folder shows the entity's own bounds and draws their
box.

## Queries and events

- Ray and shape casts go through the world: [`getPhysicsWorld`](api:getPhysicsWorld)`().castRay(…)`,
  `castShape`, `intersectionsWithRay`. The debug env can draw them, and the Physics API tab
  counts them per frame.
- A collider's `collisionEventFn` and `contactForceEventFn` (in its params) are called when it
  starts or stops touching another collider, and with the contact forces.

## Joints

A joint ties two bodies together. Rapier has two solvers for them, and each has its own API:

|           | Impulse joints                                                                         | Multibody joints                                                          |
| --------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Create    | [`createJoint`](api:PhysicsJoints.createJoint)                                         | [`createMultibodyJoint`](api:PhysicsMultibodyJoints.createMultibodyJoint) |
| Types     | fixed, revolute, prismatic, spherical, rope, spring, generic                           | fixed, revolute, prismatic, spherical                                     |
| Bodies    | any two, loops included                                                                | a tree: each body has at most one parent                                  |
| Solved as | constraints between the bodies: under load, a long chain can drift apart at its joints | one articulated body, in reduced coordinates: a chain never comes apart   |
| Controls  | motors and limits                                                                      | none: the bodies, contacts and user data only                             |
| For       | doors, wheels, ropes, springs, anything driven by a motor                              | chains that must hold their shape: robot arms, cranes, ragdolls' limbs    |

Both take the same params (`body1Id`, `body2Id`, the anchors in each body's own space, the axis),
and `deleteJoint` / `deleteMultibodyJoint` remove one. Deleting a body deletes its joints of both
kinds. The `physicsTest` scene's joint row shows each impulse type, and a chain made both ways
side by side (`?isDebug=true&startScene=physicsTest`):

<<< src/app/scenes/physicsTest/physicsTest.ts#multibody-chain

### Multibody joints

A multibody joint's `body1Id` is the parent and `body2Id` the child; the body without a parent is
the multibody's root, fixed (a base), kinematic or dynamic (a free chain). Rapier kills the
physics world on a tree it can't hold, so the engine refuses these before Rapier sees them, and
the create rejects with the bodies and the rule:

- a body joined to itself;
- a child that isn't `DYNAMIC`, or that has a parent already;
- two bodies of one multibody (a loop): close a loop with an impulse joint instead;
- a fixed or kinematic parent that has a parent itself (it can only be a root).

A child that is the root of a multibody of its own joins with its whole tree. Living with a tree:

- `setBodyType` on a body with a parent throws for any type but `DYNAMIC`; the root can change
  type.
- Deleting a body deletes its multibody joints and splits the tree there: its children become
  roots of their own, free to join again.
- Rapier ignores `setTranslation` and `setRotation` on a body with a parent, and a kinematic root
  with children ignores its kinematic targets and velocity: move the chain by `setTranslation` on
  its root (each step, for a moving base), or hang the chain from a kinematic body by an impulse
  joint. The debug env warns once per body.

## Simulation tiers

A large world doesn't have to simulate every body. The tiers are a feature of their own,
[`physicsTiers()`](api:physicsTiers) from `aekasha/physics`, listed right after `physics()`:

```ts
features: [physics(), physicsTiers(), character(), skyBox(), appECSPlugins],
```

With it, a `DYNAMIC` body made by `createPhysicsEntity` can change its tier with
[`requestPhysicsTier`](api:requestPhysicsTier):

| Tier       | The body                                                                            |
| ---------- | ----------------------------------------------------------------------------------- |
| `FULL`     | Simulated as usual.                                                                 |
| `STATIC`   | Made `FIXED`: frozen in place, and other bodies still collide with it.              |
| `DISABLED` | Disabled: nothing collides with it.                                                 |
| `REMOVED`  | Taken out of the physics world, its state kept, and its transform buffer slot free. |

A request applies at the next physics step, and a body comes back where it left off.

### Joints and tiers

Bodies joined by joints change tier together, a group ending at a fixed or kinematic body (so a
multibody's branches under a fixed base are groups of their own), and can't be `REMOVED`. Their
joints decide what else they can be, since Rapier mishandles impulse joints on disabled bodies and
panics on a multibody link made `FIXED`:

| The group has    | `STATIC` asked | `DISABLED` asked | `REMOVED` asked |
| ---------------- | -------------- | ---------------- | --------------- |
| impulse joints   | `STATIC`       | `STATIC`         | refused         |
| multibody joints | `DISABLED`     | `DISABLED`       | refused         |
| both             | `FULL`         | `FULL`           | refused         |

A group with both kinds (an impulse joint closing a multibody loop) stays simulated, and the debug
env warns. A refused `REMOVED` leaves the group in its tier (the distance policy's `REMOVED` ring
too); a [streaming](hub:features/streaming#physics) cell asks again for `STATIC`, which the table
then maps. A joint created on a tiered body moves its group to the tier its joints allow before
the next step.

A body can also start in a tier: `createPhysicsEntity`'s `initialTier` (`STATIC` or `DISABLED`)
switches it in its own create, before the first step, so it never simulates one `FULL`:

```ts
await createPhysicsEntity(
  { colliders: { type: 'BOX' }, body: { rigidType: 'DYNAMIC' }, target: crateId },
  { initialTier: 'STATIC' }
);
```

World streaming gives a cell's bodies the cell's tier this way, and keeps them out of the policy
while the cell isn't `RESIDENT` (see [World streaming](hub:features/streaming#physics)).

A distance policy picks the tiers for you, from rings around a focus (the main camera by
default, an entity or a point). Its members are the bodies created with `tierPolicy: true`:

```ts
setPhysicsTierPolicy({
  focus: () => playerId, // An entity id or a position; leave it out for the main camera
  rings: [
    { tier: 'FULL', within: 40 },
    { tier: 'STATIC', within: 90 },
    { tier: 'DISABLED', within: 160 },
    { tier: 'REMOVED' }, // Everything farther
  ],
  sceneId: 'myScene', // Removed when the scene exits
});
```

It measures and decides on fixed physics steps, so a scene driven by it stays deterministic.
The app's `physicsTiers` scene is its demo: open it with `?isDebug=true&startScene=physicsTiers`.

An app without `physicsTiers()` doesn't download the tiers' code. There `requestPhysicsTier`,
`setPhysicsTierPolicy` and `setPhysicsTierPolicyMember` throw naming the feature, `tierPolicy:
true` and `initialTier` are ignored with one warning, and `getPhysicsTier` answers `FULL` for
every body.

## Key APIs

- [`createPhysicsEntity`](api:createPhysicsEntity): a body and its colliders on an entity, and
  [`getPhysicsEntityByAppId`](api:getPhysicsEntityByAppId) to find one again.
- [`spawnImportedAsset`](api:spawnImportedAsset): an imported model's nodes, with their physics.
- [`toHeightfieldColliderParams`](api:toHeightfieldColliderParams): a `HEIGHTFIELD` from a
  row-major grid; [`deriveColliderFromGeometry`](api:deriveColliderFromGeometry): a collider from
  a geometry, as the import makes it.
- [`getPhysicsWorld`](api:getPhysicsWorld): the world, for queries.
- [`createJoint`](api:PhysicsJoints.createJoint) and [`deleteJoint`](api:PhysicsJoints.deleteJoint):
  impulse joints; [`createMultibodyJoint`](api:PhysicsMultibodyJoints.createMultibodyJoint) and
  [`deleteMultibodyJoint`](api:PhysicsMultibodyJoints.deleteMultibodyJoint): multibody joints.
- [`physicsTiers`](api:physicsTiers) (the feature), [`requestPhysicsTier`](api:requestPhysicsTier),
  [`getPhysicsTier`](api:getPhysicsTier) and [`setPhysicsTierPolicy`](api:setPhysicsTierPolicy).
- [`getPhysicsSubStepIndex`](api:getPhysicsSubStepIndex): the step clock for `APP_PHYSICS_STEP`
  systems.
- [`setSceneWorldBounds`](api:setSceneWorldBounds) (or a scene's JSON `worldBounds`): the box a
  scene's bodies must stay in, and
  [`setEntityWorldBounds`](api:setEntityWorldBounds): an entity's own, and what happens when it
  leaves them; [`getWorldBoundsStats`](api:getWorldBoundsStats): the bounds in use and their exits.

## Read more

- The [physics example](hub:examples/physics), with the code of the scene above.
- [Characters](hub:features/characters): the character controller, built on physics.
- The API reference: [`aekasha/physics`](hub:documentation/aekasha/physics).

::: claude-md
:::
