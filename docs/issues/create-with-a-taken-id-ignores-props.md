**Title:** `createMaterial` and `createGeometry` silently ignore the props of an id that's taken

Status: open | for the assets' next review
Category: Assets
Found: 2026-10-22, p620 §1.4 N1 (W2: `scene01` and `scene01V2` gave the same material ids other props)
Our workaround: give each scene's assets ids of their own (the example scenes do, `hub/CLAUDE.md`), and build a geometry with `getGeometry(id) ?? saveBufferGeometry(…)`

## What happens

`createMaterial` and `createGeometry` (`kernel/assets/Material.ts`, `Geometry.ts`) return the
registered asset when the `id` is taken, re-tagged to the scene asking, and build nothing. The
JSDoc says so ("the props are ignored"), but nothing says so at runtime: a second call with other
props, from another scene or the same one, gets the first call's material or geometry.

The previous scene's assets are released after the next one loads, so two scenes that use the
same id with other props render the second with the first's when the first's are still held.
p620 found `scene01` and `scene01V2` doing it with six ids (`ground` BASIC against LAMBERT among
them); its Phase 0 run didn't reproduce it only because the previous scene's assets were released
before the next one created its own. p620's merge of the two scenes removed the duplicates.

`saveBufferGeometry` already warns in the debug env when the id is taken by another geometry
(p619).

## A way out

In the debug env, compare the props a call gives with the props the id was created with, and warn
naming the id and the keys that differ. The material registry already keeps them (`props`, the
base of its variants); the geometry registry would keep its own. Compare the resolved props (a
texture id against a texture id, not against the texture), and skip `debugData`, which doesn't
change what's built. No production cost: the check folds with `IS_DEBUG_ENV`.
