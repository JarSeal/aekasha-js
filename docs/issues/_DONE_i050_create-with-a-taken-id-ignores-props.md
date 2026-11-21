**Title:** `createMaterial` and `createGeometry` silently ignore the props of an id that's taken

Status: fixed | 2026-11-21, the debug env warns when a `createMaterial` or `createGeometry` call's props differ from those its taken id was created with, naming them
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

## The fix

The way out, as it says. The behaviour doesn't change: a taken id still returns the registered
asset, re-tagged, and builds nothing.

- **`kernel/assets/AssetPropsDiff.ts`** (`@internal`): `getChangedPropPaths(created, given)` names
  the paths that differ (`type`, `params.color`): a key whose values are plain objects (`params`,
  `inputs`, `nodes`, `staticDefines`, `userData`; a missing one as empty) by its own keys, any
  other by its value. `warnIfAssetPropsIgnored` warns with them. Both `createX` call it behind
  `IS_DEBUG_ENV` only, so a production build has none of it.
- **What compares as equal:** a texture by its registry id (the registered props hold the
  `Texture`s when the scene loader made the asset, since it resolves a material's texture ids
  first, and code passes the id), a colour by its hex, a vector by its components (a JSON's
  `[x, y]` normal scale against the `Vector2`), plain data deeply, anything else by identity: a
  TSL node in `params` (`colorNode`) is never walked. An `undefined` value is a missing key.
- **What's skipped:** `debugData` (it changes no build) and `id`. `isPersistent`, `preWarm` and
  `userData` count: the second call's are dropped just the same.
- **An id saved without props** (`saveMaterial`, `saveBufferGeometry`) warns too: a `createX` on
  it has nothing to compare, and its props are ignored all the same.
- **The geometry registry keeps its props** (the entry's `props`, as the material registry's),
  though `geo.userData.props` had them already: `userData` is anyone's to write.
- **The app's data:** every inline material and geometry of the generated data's 41 scenes (84),
  each against the first scene's entry of its id: none differ (p620's merge of the two scenes
  removed the duplicates). An asset code creates isn't in that scan; the warning names one when
  its scene runs. `yarn verify:scenes` fails on errors, not warnings, so it wouldn't catch one.
- Tests: `kernel/assets/AssetPropsDiff.test.ts` (the paths, the texture, colour, vector and node
  comparisons, `debugData`, the two warnings) and `createMaterial`'s and `createGeometry`'s in
  `Material.test.ts` and `Geometry.test.ts` (a scene loader's resolved texture against its id, other
  props, a saved id, no warning outside the debug env).
