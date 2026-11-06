**Title:** Rapier panics on a joint created between disabled bodies

Status: not filed yet
Category: Physics
Found: 2026-11-06, p353 Phase 4 section 4 (the `streamingPhysics` scene's chains in a `NEARBY` cell)
Our workaround: the backend enables a disabled body for the joint's insert and disables it again (`createImpulseJointOnDisabled`, `features/physics/backends/rapier/RapierJoints.ts`)

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

File it upstream (dimforge/rapier) with the repro above, and drop the workaround once a release
fixes it (`PhysicsFacade.test.ts`' joint test keeps the case covered).
