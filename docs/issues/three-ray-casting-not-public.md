**Title:** three.js ray casting (`castRayFrom*`) is on no entry: should apps get it?

Status: open | for a feature plan, or close as intended
Category: API, Rendering
Found: 2026-10-17, p614 Phase 7 (C2: its six deprecated `RayCastOpts` aliases removed, since no entry exports them and nothing used them)
Our workaround: none needed; apps cast through physics or pick through input bindings

## What happens

`kernel/render/Raycast.ts` casts three.js rays against `Object3D`s (`castRayFromDirection`,
`castRayFromPoints`, `castRayFromAngle`, `castRayFromScreenPosition`), with the engine's ray
statistics (the profiler's) and debug helpers (the Ray cast controls tab, `RayDebugOpts`). Since
p606's entries none of it is on `aekasha`: the kernel's input picking (`kernel/input/InputPicking.ts`,
for pointer bindings with `targets`) and the debug tools' ray tester are its only callers, and p614
marked it `@internal`. An app that wants a ray against meshes (not colliders) uses three's own
`Raycaster`, without the stats or the helpers, or a physics query (`getPhysicsWorld().castRay`),
which needs colliders.

## What it would take

- Put the four functions and `RayCastOpts` on `aekasha` (a minor: new API), with `@example`s and
  a Hub section next to physics' queries saying when to use which.
- Their contract as it is: one shared raycaster (no cast from inside `perIntersect`), `target`
  reused without allocating, `near` / `far` restored after each cast.
- `RayDebugOpts` is on `aekasha` already (p614: `WorldAPI`'s queries name it).
