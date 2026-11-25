**Title:** Rapier panics on a joint created between disabled bodies, and mis-solves joints with disabled bodies

Status: not filed yet (the panic is gone in 0.21.0; the second symptom unchecked on it)
Category: Physics
Found: 2026-11-06, p353 Phase 4 section 4 (the `streamingPhysics` scene's chains in a `NEARBY` cell)
Our workaround: a jointed body is never `DISABLED` (the tiers give it `STATIC`: `toJointSafeTier` and `onPhysicsJointCreated`, `features/physics/PhysicsTiers.ts`), and the backend enables a disabled body for a joint's insert and disables it again (`createImpulseJointOnDisabled`, `features/physics/backends/rapier/RapierJoints.ts`)

## What happens

With `@dimforge/rapier3d-compat` 0.19.3, `world.createImpulseJoint` between two bodies that are
both disabled (`setEnabled(false)`), or between a disabled dynamic body and a fixed one, makes the
next `world.step()` panic with `RuntimeError: unreachable`, when the bodies have been through a
step disabled. After that every call into the world throws "recursive use of an object detected
which would lead to unsafe aliasing in rust": the world is dead. On `WORKER_THREAD` the worker
logs it and every request fails.

A joint created before the first step, or with one enabled dynamic body, steps fine; so does
disabling bodies that already have joints. The engine's `DISABLED` physics tier (p352) disables
bodies, and a streaming cell's bodies start `DISABLED` in a `NEARBY` cell with
`nearbyPhysicsTier: 'DISABLED'` (p353 Phase 4), so content that creates its bodies, awaits them,
and then joins them hits it.

A second symptom, without a panic: with disabled jointed bodies in the world (chains created
`DISABLED`, joined, enabled later, while other chains were disabled and deleted), a chain resting
elsewhere, touched by nothing, started rising and was flung to 50-75 m/s, only in the
`WORKER_THREAD` timing. No command reached its bodies in between (every Rapier call was logged in
the worker), and the world's snapshot from 40 steps before, restored in Node, stepped calmly: the
live world's islands or joint graph were corrupted, which a restore rebuilds. With the chains
never `DISABLED` (made `STATIC` instead) it didn't happen in any run.

## Reproduce

```js
const w = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
const [a, b] = [0, 1].map((i) => {
  const body = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(i * 1.6, 0, 0));
  w.createCollider(RAPIER.ColliderDesc.cuboid(0.6, 0.6, 0.6), body);
  body.setEnabled(false);
  return body;
});
w.step();
w.createImpulseJoint(RAPIER.JointData.spherical({ x: 0.8, y: 0, z: 0 }, { x: -0.8, y: 0, z: 0 }), a, b, true);
w.step(); // RuntimeError: unreachable
```

## What to do

File it upstream (dimforge/rapier) with the repro above (the second symptom has no small repro
yet: `streamingPhysics` with `nearbyPhysicsTier: 'DISABLED'` and the `STATIC` rule taken out shows
it within 30 s), and drop the workarounds once a release fixes both (`PhysicsFacade.test.ts`
keeps the cases covered).

## On Rapier 0.21.0 (p250 Phase 0, 2026-11-24)

The repro above steps fine on `@dimforge/rapier3d-compat` 0.21.0 (and 0.20.0), both cases: two
disabled bodies, and a disabled one with a fixed one. The second symptom has no small repro, so
it's unchecked: the workarounds stay. To drop them, take the `STATIC` rule out (`toJointSafeTier`,
`onPhysicsJointCreated`) and run `streamingPhysics` with `nearbyPhysicsTier: 'DISABLED'` in
`WORKER_THREAD` for a few minutes, watching the resting chains.

Multibody joints (p250) don't follow this issue: on 0.21.0 a disabled link is ignored unless the
whole chain is disabled, and a `FIXED` link panics, so the `STATIC` rule above is wrong for them.
Their rule is p250 D5's (`toSafeTier`, `features/physics/PhysicsTiers.ts`; the table in
`src/_engine/features/physics/CLAUDE.md`'s Simulation tiers): a group with multibody joints only is
`DISABLED` for `STATIC` and `DISABLED`, and one with both kinds (an impulse joint closing a
multibody loop) stays `FULL`, since `STATIC` panics its links and `DISABLED` is this issue's
second symptom. Checking that symptom on 0.21.0 would let such a group be `DISABLED` too. The
world bounds follow the same split: an exited link takes its whole multibody out disabled (p250
D6), never `FIXED`.
