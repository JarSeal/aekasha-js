**Title:** A `Vector3.set` in the app allocates 12 B per call: maybe three's maths fields generalized

Status: open | needs a closer look; not physics'
Category: Performance, Three.js
Found: 2026-10-17, p614 Phase 6 section 1 (looking for what `physicsInterpolationSystem` allocates)
Our workaround: none needed yet (GC is under 0.05 ms per frame in the measured scenes)

## What happens

In the dev app (`?isDebug=true`, `physicsTiers` and the gym, Chromium), a loop of
`v.set(x + i * 1e-9, y, z)` on an entity's `Object3D.position` allocates about 12 B per call
(the CDP sampling heap profiler, the loop warmed up first). The same loop with
`Quaternion.set` allocates nothing.

In bare three (Node 22, `three.module.js`) neither allocates. After one store of a non-number
into any `Vector3`'s `x` (`w.x = undefined`), the `Vector3.set` loop allocates 16 B per call
there: V8 generalizes the field for every `Vector3`, and every later double store then boxes a
new HeapNumber. If that's what happens in the app, every `Vector3` write in the engine and in
three's renderer allocates.

## What isn't known

- Whether the app's 12 B is that, or the boxed argument of a `set` call Maglev didn't inline
  (the probe loop can't tell them apart).
- `--js-flags=--trace-generalization` doesn't name the map. In the app it lists three double →
  tagged generalizations, all in three's code (`y` in a `set`, `z` in the render list's
  `resetRenderItem` and `get`); the engine sites it lists are object literals.

## How to look

- The probes in p614 Phase 6 section 1's "As built" (`storeProbe.ts`, `traceGeneralization.ts`,
  kept in the gitignored `.cache/p614/`; they don't survive a clean clone, the plan describes them).
- `%DebugPrint(new Vector3())` under `--allow-natives-syntax` shows the fields' representation;
  if `x` is tagged, bisect with `--trace-generalization` on a page that loads less of the app.
