Status: in progress | Phases 0-7 implemented
Category: Refactoring, Documentation, Toolkit, App
Epic: p600_whole-codebase-refactoring-and-documentation.md (Stage C)
Blocks: p621_hub-docs-readme-and-claude-md-final.md
Related: \_DONE_p609_toolkit-and-app-restructure.md (the layout; `characterVisual.ts` and `p341AlphaCutTest` left here), \_DONE_p619_review-schemas-pipeline-devtools-hub.md (the plan this one follows; R2's four toolkit types, S8's `persistent`), \_DONE_p605_coding-standards-and-documentation-tooling.md (the JSDoc style and the ratchet), \_DONE_p610_character-and-input-action-architecture.md (`createSeededRandom` moved to the engine), \_DONE_p618_review-debug-public-api.md (the app's `_dbg__` modules left here), p622_engine-6-major.md (toolkit 3.0.0's removals), p299 (the texture array and atlas scenes)

# Review: Toolkit and App Code

Applies p600 §5 (the per-file review standard) and p605's JSDoc style to the toolkit and to the
example app. Records the findings per file group, and fixes or files them. The toolkit is
documented API, held to the ratchet's 100 % with an `@example` per piece. The app is the reference
app, not documented API: its bar is correctness and reading as examples a developer copies. Comes
with p619's leftover: the four toolkit types that public names use but no entry exports.

## 1. As found (2026-10-22, `main` at `1964613`, after p619's merge; Engine 5.10.0, Toolkit 2.1.3, App 1.13.2)

### 1.1 The stub's scope, checked

| Stub | Now |
| --- | --- |
| "`geometry` 8 of 21 exports documented, its 13 interfaces none" | `docs.json`: `geometry/generate` **4 / 14** exports, 32 / 48 members; `geometry/scatter` **3 / 6**, 7 / 17. Every option and result type lacks a summary, and many fields lack one. |
| "`materials` 5 of 13, 0 of 14 internal functions commented" | `materials` **5 / 7** (`TriplanarProjection` and `TriplanarProjectionOptions` undocumented), the `*.tsl.ts` socket exports **1 / 4** (only `asteroid`'s `colorNode`). 11 of the 14 internal functions have a `//` comment; the other three are covered by a section comment or their name. |
| (not in the stub) `ecs` | `ecs/effects` 21 / 22, 11 / 15 members; `ecs/gameplay` 10 / 10, 0 / 0 members (the ratchet doesn't count the members of a type-literal alias: `FollowObjectCameraParams` is `type … = { … }`). |
| "every piece with an example in its JSDoc and a Hub entry" | One `@example` in the toolkit (`createFollowObjectCameraRig`). Each piece has a line on the toolkit feature page (`hub/pages/features/toolkit/guide.md`), not a section. |
| "`scene_thirdPersonGym.ts`'s ~544-line `scene` function split" | `scenes/thirdPersonGymScene/thirdPersonGymScene.ts` (799 lines): `scene` is 544 lines at `:256`. Seven more are over 150 lines: `largeWorld` 550, `physicsTest` 421, `createMovingPlatform` 397 (toolkit), `scene01V2` 301, `scene01` 227, `physicsTiers` 203, `sceneTestECS` 183 (§1.4 C9, W7; D7). |
| "the app's own `_dbg__` modules on the engine's pattern" | Five: `space/_dbg__spaceDemo.ts`, `lodShowcase/_dbg__lodShowcase.ts`, `assetCompare/_dbg__assetCompare.ts`, `examples/debugTab/_dbg__exampleDebugTab.ts`, `examples/_dbg__exampleHub.ts`. Each is loaded by `if (IS_DEBUG_ENV) { await import('./_dbg__…') }`, which folds in production (`verify:baselines` checks it). That's the app's pattern, which the Hub's debug tab example teaches; the engine's thin wrapper with `loadDebugModuleAsync` is for public entry points. One debug module isn't one: `PhysicsStressTest.ts` (P7). |

Sizes: the toolkit is 22 files, 3,167 lines (TypeScript and JSON); the app is 52 `.ts` files,
10,042 lines, 111 asset JSONs, 29 PNGs; the root files (`index.ts`, `CONFIG.ts`,
`AppECSPlugins.ts`, `AppECSRegistry.ts`) 224 lines. Hygiene in both is clean: no `any`, no
`eslint-disable`, no TODO, no `@ts-`, no `console.*`. `Math.random` and the wall clock appear only
in the app's debug tools and examples (§1.4 P6, W5).

### 1.2 The stub's inputs, checked

- **p619 Phase 5 (R2), the four leaked types:** all four in `yarn hub:build` on `main`, each at its
  reference: `MovingPlatformControls` (`MovingPlatform.ts:74`, named by `MovingPlatformReturn`),
  `AsteroidNoiseOptions` (`Asteroid.ts:7`) and `AsteroidCraterOptions` (`:16`, both named by
  `AsteroidOptions`), `TerrainNoiseOctave` (`Terrain.ts:5`, named by `TerrainOptions`). The fifth
  warning is p621's `{@link getRandomStream}` (`utils/SeededRandom.ts:15`). The build: 84 pages,
  16 entries, 920 names, 99 % documented.
- **p609:** `characterVisual.ts` is still in the gym's folder, imported by `topDownTestScene.ts:26`.
  `src/app/shared/` doesn't exist (the layout rules and CLAUDE.md have it). `p341AlphaCutTest`
  (`src/app/textures/`) is still used by nothing.
- **p600 §2:** of its toolkit and app items, only the gym's `scene` is left. The toolkit's
  `AppECSRegistry` imports and `as any` storage reads went with p606.
- **Not in the stub:**
  - The scene runner on this machine: `thirdPersonGymScene`'s three debug configurations fail
    ("the physics probe didn't reach step 600 in 300 s") in p619's Phases 0, 7 and 8, and in this
    plan's Phase 0 (`MAIN_THREAD` included, 292 s). Its `prodTest` run passes and records its
    system order. So on this machine the gym is checked by its errors and system order; its
    hashes, paths and snapshot only on a faster machine (D3).
  - Toolkit names on no entry, and not `@internal`: the three effect systems (`hoverToolSystem`,
    `followToolSystem`, `sunShadowFitSystem`), `MutualGravity.ts`' `GravityBody`,
    `clearGravityBodies`, `getGravityBodies`, `getMutualGravityDefaults`, and
    `TriplanarProjection.ts`' `blendProjections`, `blendProjectionGradients`,
    `readBooleanDefines`, `ProjectionPattern`, `TriplanarProjection` (C10, T7).

### 1.3 Documentation (the ratchet's `docs.json`)

| Folder | Exports | Members |
| --- | ---: | ---: |
| `toolkit/ecs/effects` | 21 / 22 | 11 / 15 |
| `toolkit/ecs/gameplay` | 10 / 10 | 0 / 0 |
| `toolkit/geometry/generate` | 4 / 14 | 32 / 48 |
| `toolkit/geometry/scatter` | 3 / 6 | 7 / 17 |
| `toolkit/materials` | 5 / 7 | 0 / 0 |
| `toolkit/materials/asteroid` | 1 / 1 | 0 / 0 |
| `toolkit/materials/triplanarCheckerboard` | 0 / 1 | 0 / 0 |
| `toolkit/materials/triplanarGrid` | 0 / 2 | 0 / 0 |
| **toolkit** | **44 / 63** | **50 / 80** |

The engine is at 2,321 / 2,321 and 890 / 890 (p619), so the toolkit is what's left of p621's
"100 % of the public API". The app isn't counted (TypeDoc reads the engine and the toolkit).

### 1.4 Findings by file group

Numbered for the phases. Tags: **(bug)** wrong behaviour, **(hang)** a load that never settles,
**(race)** scene switch or overlapping calls, **(det)** determinism, **(perf)**; the rest is API
shape, placement, size, docs and hygiene. Read from the code by five read-only review passes and a
`perf-auditor` pass (2026-10-22); the ones marked ✔ were rechecked by hand. Phase 0 reproduces the
rest before fixing.

**Toolkit ECS (`toolkit/ecs/`): `MovingPlatform.ts` (507 lines)**

- C1 **(bug)** ✔ The geo + mat path can't run: `if (shape && shape.geo && !shape.mesh)` throws
  "must have either a geo or mesh" whenever `geo` is given without `mesh` (`:138`), so the
  `shape.geo && shape.mat` branch and its shadow flags are dead. The gym passes `shape.mesh` only.
- C2 **(bug)** ✔ `play()` after `pause()` leaves the platform's user data velocity at zero
  (`pause` zeroes it; `play()` without an index only sets `isPlaying`). The dynamic character reads
  `velo` / `angVelo` from it (`features/character/controllers/dynamic/Platform.ts`), so a character
  slides off a resumed platform until the segment ends.
- C3 **(bug)** ✔ A platform that stops at the end of its loops, or by `stop()`, keeps its last
  velocity in the user data: a character on it is pushed at the old speed. `setOptions` while
  paused writes a non-zero one.
- C4 **(bug)** `BACKWARD`: the first segment is the wrap 0 → last, and the loop is counted when it
  ends, so `loopTimes: 0` moves one segment where `FORWARD` runs the whole path. A backward segment
  uses `points[curIndex].dur`, but `dur` is documented as the time to the next point (forward).
- C5 **(bug)** ✔ `stop()` ("resets to start") doesn't reset the loop count or the target segment:
  after a finished run, `stop()` + `play()` runs one loop, and a plain `play()` does nothing.
- C6 **(bug)** A point without `rot` is read two ways: as the next point, the current rotation is
  kept; as the current point, it resets to identity. A path with `rot` on point 0 only snaps.
- C7 **(bug, small)** An empty `physicsParams` array throws a `TypeError`; a point with `dur: 0`
  writes `Infinity` / `NaN` velocities (Phase 0: `speedMultiplier: 0` doesn't, it freezes the
  platform with zero velocities); the input `rigidBody.userData` is overwritten in the
  caller's own params object (`:234`); `:321` hard-codes `3000` next to
  `DEFAULT_SEGMENT_DURATION`; eight `!` on `points[i].rot`.
- C8 **(race)** The controls (`play(i)`, `playSegment`, `stop`, `setOptions`) write physics
  (`setTranslation`, kinematic targets, user data) when called, which is per-frame or UI code, not
  `APP_PHYSICS_STEP`. Flipping `direction` mid-segment keeps `t` while from and to swap, so the
  platform jumps. Nothing re-checks the world after `await createPhysicsEntity` (a platform
  created outside a load).
- C9 **(size)** `createMovingPlatform` is one 397-line closure: validation, the mesh, the
  move-and-turn check, a path state machine, the segment velocities and the controls.
- C10 **(api)** On the entry: `PhysicsParams` (a generic name next to `aekasha/physics`'
  `RigidBodyParams` and friends, and `aekasha`'s `ImportPhysicsParams`) and `DeleteMeshOptions`
  (its own JSDoc: "Not read yet"; nothing reads it). The parameter type is an anonymous literal,
  so a caller can't name the points or the options. `scene` is required, but only used for a mesh
  that has no parent (`createMeshEntity` already adds one). `MovingPlatformControls` isn't on the
  entry (§1.2).
- C11 Comments: "the legacy scene physics looper" and `addScenePhysicsLooper` (gone), "ordered
  after the default-order systems (character controllers …)" (the brains run at -5 and the
  controllers at -10, `Character.ts`), `PhysicsParams`' "callers still on the legacy shape until
  they're ported in a later phase". No `@example`, and the JSDoc doesn't say what it throws,
  `loopTimes`' values, `BACKWARD`, or that the controls write physics outside the step.

**Toolkit ECS: the effects and the camera rig**

- C12 **(bug)** ✔ `MutualGravity.ts:51-72`: `ensureCapacity(n + 1)` inside the collect loop
  allocates a new `stepMasses`, dropping the masses already collected, so when the 17th, 33rd, …
  body joins, the first 16 pull with mass 0 for that sub-step. `space` starts with 8 asteroids; its
  debug tab's spawn button reaches 17. The scene runner's hash isn't affected.
- C13 **(bug, small)** `setMutualGravityConfig({ G: undefined })` passes its `Partial<>` type and
  makes every force `NaN`. `bodies` is keyed by entity id across worlds, and `hasAppliedForces` is
  global while the system runs per world (latent: one physics world).
- C14 **(race)** `FollowObjectCameraRig.ts`: rigs are module-global and never scene-scoped. One a
  scene forgets to delete keeps moving the old camera and holds the old mesh. The system ignores
  its `world`, so every world it's registered in ticks every rig (latent: the second world, `ui`,
  has `applyGlobalPlugins: false`). "Safety check for NaN DT" (`:267`) lets `NaN` through
  (`NaN <= 0.0001` is false).
- C15 **(api)** `HoverToolData.time` is state the caller must give (the examples use it as a phase
  offset). `addGravityBody(entityId, mass, world?)`: an optional positional parameter. `targetMesh:
  THREE.Mesh` needs only an `Object3D` (`createLookAhead` already takes one). The component keys
  are TS `enum`s commented "Internal Key (Values)", but they're entry exports.
- C16 **(perf)** `FollowTool` and `SunShadowFit` read a second storage per entity
  (`getComponent(…, TARGET_LINK / OBJECT3D / MANAGED_BY)`), and `SunShadowFit` resolves the main
  camera per component per frame (an iterator over `TAG_IS_MAIN_CAMERA`). `MovingPlatform`
  allocates two quaternions, a vector and three objects per segment change
  (`updateUserDataVelocities`). The `if (!storage) return` checks are dead (`getStorage` always
  returns one).
- C17 Docs: `HoverEffect.ts`' header names `src/toolkit/ecs/systems/`; `FollowTool`'s fields talk
  about a "Light Source" and the "Player" (it's generic: `largeWorld` puts it on a camera); the
  register helpers' summaries ("The Registration Helper") say nothing (the stage, the order, a
  second call a no-op); `MutualGravity.ts`' module overview sits on `MutualGravityConfig`, so the
  type's API entry is the module text; the rig's `offset` is documented as an offset, but with
  `getMouseMoveInput` only its length counts; its defaults (`{0, 5, 10}`, `smoothingTime` 0.1 /
  0.2, `targetHeight` 0) aren't stated; four params have no comment.

**Toolkit geometry and materials (`toolkit/geometry/`, `toolkit/materials/`)**

- T1 **(bug)** ✔ `spawnScatterAsMeshEntities` loses the scale: it sets the `Object3D`'s scale
  after `createMeshEntity` (`ScatterOnSurface.ts:208`), and the first sync copies `TRANSFORM`'s
  scale (1) back. `MeshProps.scale` exists now; the comment saying it doesn't is why. Nothing
  calls the function.
- T2 **(bug)** ✔ `generateTerrain`'s `getHeightAt` interpolates bilinearly (`Terrain.ts:132`), but
  the mesh splits each cell along the b–c diagonal (`:120`), so inside a cell they differ by up to
  |h00 + h11 − h10 − h01| / 4, against the doc's "the mesh, `heights` and `getHeightAt` all agree".
  `topDownTestScene` places obstacles with it on a trimesh of that mesh.
- T3 **(bug)** Edge cases: `generateBushGeometry({ clusterCount: 0 })` throws in
  `mergeGeometries([])`; a terrain with 0 segments is all `NaN`, with fractional ones the arrays
  are truncated while the loops aren't.
- T4 **(bug)** `bakeScatterToInstancedMesh`: no capacity check (the returned index keeps growing),
  `mesh.count` untouched (when `scatterOnSurface` returns fewer than `count` under `minSpacing`,
  the rest draw at the origin), world-space placements written as instance matrices (right only
  under an identity world matrix). `triplanarGrid`'s `normalNode` doesn't check its input, where
  `colorNode` does.
- T5 **(api)** ✔ The four leaked types (§1.2).
- T6 **(api)** The `createSeededRandom` deprecation on `geometry/index.ts` is a comment on an
  `export … from` line, which attaches to nothing: the Hub page shows "Re-exports
  createSeededRandom from aekasha" without the deprecation.
- T7 **(api)** The materials entry exports `triplanarProjection` alone. Its helpers
  (`blendProjections`, `blendProjectionGradients`, `readBooleanDefines`, `ProjectionPattern`,
  `TriplanarProjection`) are on no entry, so the Hub's "Copy it" advice fails for both triplanar
  materials: a copy under `src/app/` can't import the toolkit file (the layer lint) and the entry
  doesn't have what it needs.
- T8 **(api)** The `*.tsl.ts` socket exports (`colorNode`, `normalNode`) are imported only by the
  generated loaders and looked up by socket name (`Material.ts`). They're on no entry and not
  `@internal`, and only `asteroid`'s has a summary.
- T9 Docs: every option and result type lacks a summary; the defaults are unstated (eg.
  `AsteroidNoiseOptions` 1.6 / 0.22 / 4, `AsteroidCraterOptions` 5 / [10, 28] / 0.12 / 0.35, the
  tree's and bush's, `TerrainOptions.seed` 1, the default octaves, `maxAttemptsPerPoint` 30);
  seeds are integers (`seed >>> 0`); "may return fewer than `count`" is in a code comment, not the
  doc. Stale: links to `docs/plans/p090_large-ecs-test-world-scene.md` (gone, 7 places), "already
  used elsewhere via `BufferGeometryUtils.js`" (unrelated), "a future heightfield collider" (the
  HEIGHTFIELD collider exists, column-major, while `heights` is row-major), three@0.183.2 (the
  project is on 0.186), "covers both cases the request asked for", `Foliage.ts` pointing readers at
  an app file. No `@example` in geometry or materials.
- T10 Hygiene: `Foliage.ts` registers each part with `createGeometry` only to `deleteGeometry` it;
  `!` on `getIndex()` and `mergeGeometries()`; duplicate `from 'aekasha'` lines. The material
  JSONs carry inert params (`color` on both triplanar materials, `color` and `roughness` on
  `asteroid`, all replaced by their nodes) that the material editor shows; the triplanar ones have
  no `debugData`; each TSL file's `DEFAULT_DEFINES` differs from its JSON's (legal, confusing).
- T11 **(perf, build time)** `scatterOnSurface`'s `minSpacing` check is O(n² × attempts)
  (`largeWorld` scatters 1,500, 2,000, 300 and 10 points; Phase 0 measured about 50 ms for the
  four, about 1.5 % of the scene's load), with two vector clones, a quaternion and an
  object per placement. `Terrain`'s `indices` is a `number[]`.
- T12 `devTools/toolkit/buildAekashaSymbol.ts`: `build().catch(…)` runs at import (the devTools'
  rule: only when its file is the script run), and cites the deleted p554.
- T13 No tests in `geometry/` or `materials/`. The only toolkit test is
  `FollowObjectCameraRig.test.ts` (it lacks LERP, the mouse orbit and its clamp, same-id
  replacement and `NaN` dt).

**The app root files and the examples (`src/*.ts`, `app/examples/`, `app/profiles/`, `app/postFx/`)**

- A1 **(bug)** ✔ `src/index.ts:87-95`'s `updateLoaderStatusFn` checks `params.loaded` after testing
  `'loadedCount' in params` (no caller sends `loaded`), and returns `true` where the type is
  `void`. The Quick start page includes the whole file (`<<< src/index.ts`), so readers copy it.
- A2 **(api, perf)** ✔ `SpinSystem.ts` (Hub region `spin-system`), `banner.ts` (`banner-scene`)
  and `exampleUiKit.ts` mutate the quaternion `world.getRotation()` returns, which its JSDoc says
  is read-only, and pass a new `{ rot }` object per entity per frame, under the file's own "a
  system that runs for every entity shouldn't allocate".
- A3 `exampleUiKit.ts` registers its window kind from scene code on every visit (the UI kit's
  CLAUDE.md and the JSDoc: once, in `start` or an install); the walkthrough says why it works.
- A4 **(perf)** `exampleSkyBox.ts` (`sky-controls`) builds two strings per frame before comparing
  them; `exampleCharacter.ts` awaits its 12 blocks one by one.
- A5 Casts and `!` in example code: `exampleLod.ts` (`getGeometry(id) as BufferGeometry`,
  `boundingBox!`), `exampleDebugTab.ts` (`debug-tab-scene`) and `exampleUiKit.ts`
  (`getMaterial(id) as MeshStandardMaterial | undefined`). `saveBufferGeometry` used two ways (the
  passed geometry disposed when the id was taken, or not: `exampleLod.ts`, `textureAtlases.ts`).
- A6 Root hygiene: `AppComponentType.HEALTH` (`AppECSRegistry.ts`) is used nowhere (the template's
  example key; the engine-5 migration page shows the file); `index.ts` keeps commented-out shadow
  map types inside the `create-renderer` region, and `background: 'blue'`, `text: ''` placeholders;
  `CONFIG.ts` overrides the drawer key with the engine's default `'h'` and keeps a commented-out
  `debugDrawer` block; `@param sceneId (string)` in `_dbg__exampleHub.ts` and `exampleHud.ts`.
- A7 `SpinComponent.ts` / `SpinSystem.ts` are used by three scenes and `AppECSPlugins.ts`, but stay
  in `examples/ecs/` (the ECS page shows them from there; the layout allows it). Nowhere says so.

**Physics and character scenes (`thirdPersonGymScene`, `topDownTestScene`, `physicsTest`, `physicsTiers`, `space`)**

- P1 **(hang)** ✔ `thirdPersonGymScene.ts:256` is `async () => new Promise(async (resolve) => …)`:
  a `throw` inside (a missing material `:303`, `:314`, a failed import `:396`) rejects only the
  executor's promise, so the load never settles, and every later `loadScene` waits behind it. Also
  `scene01` and `scene01V2` (W1).
- P2 **(race)** ✔ `PhysicsStressTest.ts` binds `J` globally (`createKeyBinding`, no `sceneId`, never
  deleted): after one gym visit, `J` spawns 50 bodies into whatever scene is current. Its creates
  are `void`ed: at `maxBodies` each rejects unhandled and leaves its mesh entity behind.
- P3 **(race, det)** `physicsTest.ts:148-194`: the shape-cast demo waits a 200 ms `setTimeout`, then
  casts. Physics is held for the whole load, so a slower load casts before the first step ("No hit
  (unexpected)"); a switch within 200 ms casts into the next scene's world; its rejections are
  unhandled. Its 17-line comment names APIs that are gone (`renderPhysicsObjects`, `appStartFn`).
- P4 **(bug, small)** `topDownTestScene`'s loader ends at 2 / 2 after starting at 0 / 3.
  `physicsTiers.ts` registers its cleanup (4 material refs, two systems) after everything that can
  throw, and covers it with `removeSystem` before each `addSystem`.
- P5 **(placement)** `characterVisual.ts` is used by the gym and the top-down scene. The gym's
  `characterTestObjects.ts` exports `characterTestObstacles` and `characterTestObstacles.ts`
  exports `getTestObstacle` (each file named after the other's export), a one-entry map with an
  impossible `null` check.
- P6 **(det)** `PhysicsStressTest.ts` and `space.ts:250` (`spawnSpaceAsteroid`, the debug tab's
  button) draw from `Math.random`, from a DOM event: loads and probes are unaffected, but a spawn
  can't be replayed, and the examples show what the simulation rules forbid. The stress test's
  rotation `{ x, y, z: random, w: 1 }` isn't a unit quaternion.
- P7 `PhysicsStressTest.ts` is debug tooling (`if (!IS_DEBUG_ENV) return;`) in a module the gym
  imports statically: it folds, but it isn't a `_dbg__` module as `space`'s is.
- P8 The gym's `followWithSun` (64 lines) re-implements the toolkit's `SunShadowFit`, which
  `topDownTestScene` and `physicsTiers` use.
- P9 Gym readability: six platforms repeat the same 35-line block (about 230 lines, `:444-676`),
  the ferris wheel's 16 points are written out, the `staticModels` table is built inside `scene`
  and its GLBs imported one by one, the throwaway PHONG materials `characterTestObjects.ts` makes
  are replaced at once, `setImportedRigidBodyTranslationPartial` moves FIXED bodies a position prop
  would place, the stair collider's numbers (`-Math.PI / 6.8`, `0.83`, `-0.32`, the landing) aren't
  derived, two sky boxes are created in code with no comment, the player's id is `'topDownChar'`,
  the models' appIds are `customPropTest4…15`, and comments say "legacy" and number their steps.
- P10 Duplicated helpers: `physicsTest` re-implements its own `createDynamicBall` /
  `createDynamicBox` inline twice and repeats seven joint blocks; `topDownTestScene` defines
  `between` twice.
- P11 Hygiene: `space.ts`' `SPACE_GRAVITY` export has no importer; `spawnCount` is never reset, so
  ids grow across visits; `_dbg__spaceDemo.ts`' energy sum reuses the last pose of a missing body;
  `void` promises on its buttons; `saveBufferGeometry('stairsGeo')` doesn't dispose the passed
  geometry when the id is taken (`topDownTestScene.ts:134`, `characterTestObjects.ts:30`); the
  `physicsTiers` and `topDownTestScene` description blocks are floating JSDoc that attaches to the
  next constant; `!` and casts (`getMeshByAppId(…)!` ×8 in the gym, `physicsTiers.ts:110` and
  `:206`); plan citations in code and in the scene JSONs' descriptions, which the scene loader
  shows (`_DONE_p026`, `_DONE_p066`, `_DONE_p352`, `p343`, `p114`, `p101`, `p428`).

**World, LOD and test scenes (`largeWorld`, `lodShowcase`, `skyShowcase`, `scene01`, `scene01V2`, `sceneTestECS`, `testDebugScene`, `oneMoreScene`)**

- W1 **(hang)** `scene01.ts:23` and `scene01V2.ts:24`: the same async executor as P1.
- W2 **(not reproduced, Phase 0)** `scene01` and `scene01V2` create assets with the same ids and
  other props (`ground` BASIC vs LAMBERT, `sphere1Material`, `box1`, `box1Texture`,
  `cylinder01Material`, `importedBox01Material`). `createMaterial` returns a registered id and
  ignores the props, and the previous scene's assets are released after the next one loads, so a
  switch between them renders the second with the first's materials. Phase 0's run: after a
  switch in either direction, `ground` and `sphere1Material` are the target scene's own (BASIC /
  LAMBERT), the previous scene's released before the next one creates its own. The other listed
  ids have the same props in both. D9's merge removes the duplicate ids anyway.
- W3 **(bug)** `scene01` binds `d` globally (`scene01-log-d-press`, no `sceneId`; its comment says
  so), logging `'PRESSED'` with a `performance.now()` delta on every `d` in every later scene, the
  gym's WASD included. Its spin looper is frame-timed (`transformMainSpeedValue`), where V2's was
  moved to the sim clock for the snapshot.
- W4 ✔ `sceneTestECS/mainCamera.camera.json` sets `"persistent": true`. It does nothing today
  (p619 S8: `createEntity` never adds `PERSISTENT`), and it would leak a camera per visit if S8 were
  fixed: `createCameras` creates it on every visit.
- W5 **(placement)** `largeWorld.ts` and `lodShowcase/lanes/rockImpostors.ts` duplicate the rock
  (seed, shape, colour, impostor options) that must match for `largeWorldRockImpostor`'s
  fingerprint: an edit to one breaks the other's export. `testDebugScene.ts` and
  `lanes/instanceCell.ts` hand-build an instanced cell entity the same way. Lane 4 imports lane 2's
  knot helpers.
- W6 **(perf)** `_dbg__lodShowcase.ts`' dolly calls `getStartPose()` per frame (two vector clones,
  an object; debug only). `getShowcaseKnot()` builds a 16k-triangle knot on every call and
  disposes it when the id is taken (lane 4 calls it again).
- W7 **(size)** `largeWorld.ts`' `scene` is 550 lines (terrain, three pools, static props, lanterns,
  dynamic objects, a crate stack, a barbell, the follow camera, the toggle, the sky lights), with
  merge → normals → bounds → save → dispose written twice.
- W8 Docs: `_dbg__lodShowcase.ts:268` and `features/lod/CLAUDE.md:35` say "only the stop is
  persisted" (`persistKeys: ['stop', 'side']`); its "for a harness" exports
  (`getShowcaseCameraStops`, `setShowcaseCameraStop`, `isShowcaseDollyRunning`) have no importer
  and aren't on the test bridge; `skyShowcase.ts:3`'s "front (south) to back (north)" is wrong (row
  index 0 is north, and the rows run right to left in the start view); `largeWorld`'s and the
  lanes' "the export is in `src/app/impostors/`" (three of the four exports are in their scene
  folders); the dead p090 citations, `largeWorld.scene.json`'s "Phase 4: terrain + static overview
  camera + sun, no dynamics yet", "Static until the crates get rigid bodies" (they bob with
  `HoverEffect`), the "p308 builds a static cell" (p308 is unstarted), the lanes numbered by plan
  order, not slot order; `scene01V2.ts:311`'s "while a scene loads there is no current scene to
  default to" (loopers default to the loading scene).
- W9 Dead and leftover: `scene01`'s `export const assets = {}`, `SCENE01_ID`, loader updates that
  jump with nothing between; `llog`s (texture counts, `'PRESSED'`, `'SENSOR ALERT'` per contact,
  `oneMoreScene`'s), which ship; commented-out code in `sceneTestECS` (an ambient light, PBR params
  on a LAMBERT material) and tutorial leftovers ("// To spawn it:", "// 3. (Optional)"); the start
  scene's JSON lists `otherTestBox` and `testMaterial`, used by nothing; the description "This is
  what next gen games is all about".
- W10 Casts and `!` throughout (`largeWorld.ts` ×5, `scene01*` ×8, `testDebugScene.ts`,
  `handMadeLevels.ts`' `props.mat as unknown as string`, `testTslMat.tsl.ts`' `.mul!`).
- W11 Readability: the start scene (`sceneTestECS`) is a grab bag (an inactive orthographic camera
  with no comment, a second world named `'ui'` that holds a 3D ball, a ground that's a rotated
  box, positions set by `setTransform` next to `position` props, the K / L stress keys);
  `scene01V2`'s four sky boxes each default to `isDefault: true` (the last wins, unsaid);
  `scene01.ts:54`'s 7-digit hex.
- W12 Which scenes are which. Showcases with Hub pages: `lodShowcase` (LOD guide and walkthrough),
  `skyShowcase` (sky box guide), `largeWorld` (spatial index guide). Test and dev scenes:
  `scene01`, `scene01V2` (its JSON: "Same basic physics demo as scene01.ts plus …"; V2 is a
  superset but for a batch texture load and the `d` key), `sceneTestECS` (the start scene),
  `testDebugScene` (`isDebugScene`; its LOD checks repeat `lodShowcase`'s lanes, its KTX2 / meshopt
  row overlaps `assetCompare`, no camera in its JSON so the gatherer adds one), `oneMoreScene` (a
  `llog` and the auto camera: an empty view that ships as `assets/oneMoreScene.js`). The Hub's
  debug suite guide names `scene01` and `scene01Camera`. No scene loads another by id.

**Verification scenes (`assetCompare`, `textureArrays`, `textureAtlases`; all `isDebugScene`)**

- V1 **(race)** `assetCompare`: nothing re-checks the scene after an await. Leaving during "Measure
  all variants" (13 runs, up to 30 s each) builds the remaining slots into the next scene, owned by
  it; `setCompareChangeListener` is never cleared on exit.
- V2 **(race)** `textureArrays.ts`' `runSwaps()` and `textureAtlases.ts`' `nextFrames(10).then(…)`
  run after the load, unawaited: an exit first (the scene runner, a switch) makes them log an error
  the runner's `allowedErrors` don't cover. Phase 0: `textureArrays` logs `[textureArrays] Swaps
  failed … No texture array "textureArrays/swapKtx" is registered`; `textureAtlases`' callback runs
  after the exit (reading the released slots) but logs nothing.
- V3 **(size)** `assetCompare.ts`' `buildSlot` 146 lines; `_dbg__assetCompare.ts` 741 lines with
  four concerns (report, slot rows, the collider check ~260 lines, measure). The three scenes
  duplicate their harness helpers (the TSL shim casts, `nextFrames`, `expectError`, `leaveTo`, the
  `getGeneratedAppData() as unknown as …` cast, the backend name cast).
- V4 `window.__textureArrays` / `__textureAtlases` and their `results` are read by nothing: the
  checks they record are never asserted. `assetCompare`'s header says "Throwaway: it goes with
  `testOptimized/phase1/` once Phase 1f has picked the profiles" (p300 is done and kept it), and its
  name, description and a button (`'DD6'`) cite plan sections. Its LS key `'appDebugAssetCompare'`
  isn't `AEK_debug…`; `reportRequest ??=` caches a failed `report.json` for the page's life.

**Asset JSONs (`src/app/**/*.json`, 111)**

- J1 ✔ `textures/p341AlphaCutTest.texture.json` and its source `textures/source/p341AlphaCut.png`
  are used by nothing (p341 is done).
- J2 `textures/testTexture.texture.json`: `useHDRLoader: true` on a JPG (a no-op), undone by a
  `__saveData.sceneTestECS` entry without version stamps.
- J3 Placement: every shared asset is in its type folder and every scene-only one in its scene
  (checked against every scene JSON, scene file and asset JSON); no PNG without a JSON. A merge of
  `scene01` and `scene01V2` (D9) leaves `scene01Camera`, `scene01Ambient`, `scene01Sun` with one
  scene. `thirdPersonGymScene/characterObstacles.blend` is a source no JSON names (the GLBs' Blender
  file). `topDownTestScene.scene.json` inlines a copy of `basicSkybox`'s base.
- J4 Plan citations in user-visible descriptions: `dayNight.skybox.json` (p113), `banner.scene.json`
  (p611 D8), the gym camera's "legacy gym's offset/lens settings", and §1.4 P11 and W8's. p299's in
  the texture array and atlas scenes stand (p299 is open).

**The Hub and `CLAUDE.md`**

- U1 `hub/pages/features/toolkit/guide.md`: the tree lists `geometry/SeededRandom.ts` (moved to the
  engine, p610) and presents `createSeededRandom` as a toolkit piece (deprecated there until toolkit
  3.0.0); "a component and its system each" is wrong for `MutualGravity` (a body list, no
  component; the root `CLAUDE.md`'s toolkit line says the same); "their node inputs are params in
  the JSON" (node inputs are under `nodes.<socket>`, the switches under `staticDefines`); bake and
  spawn are presented as the way to place scatter results (the app feeds `createInstancedMeshPool`,
  spawn has T1). Missing: the triplanar defines, the asteroid material's per-mesh `seed`,
  `generateAsteroid`'s `hullVertices` / `hullVolume`, the TSL socket contract
  (`(inputs, material, staticDefines)`, uniforms named `<socket>_<input>`), which no page documents.
- U2 Example pages: `examples/embed/walkthrough.md:73-75` has a broken rewrap;
  `examples/lod/walkthrough.md` says the export writes into `src/app/impostors/` without the
  "move it next to the scene" the code says; `quick-start/setup.md` doesn't mention the debug-only
  `_dbg__exampleHub` import its included `index.ts` shows; `banner.ts`' "runs every frame while the
  scene is current" (an app looper stops while paused). The rest of the example pages match the
  code (the knots, the coalesce, the keys, the rig defaults, the CMP listeners, `AekashaMount`).
- U3 `features/lod/CLAUDE.md:35` (W8). The Hub regions the fixes touch: `spin-system`,
  `banner-scene`, `create-renderer`, `lod-scene`, `debug-tab-scene`, `sky-controls`,
  `character-level`, `dynamic-box` (physicsTest; its include's `{20-24}` is relative to the
  region), and `src/index.ts` whole. No rename is proposed.

**Engine findings (not this plan's to fix)**

- N1 `createMaterial` (and the other `create*` with ids) silently ignores the props of an id
  that's taken, which is how W2 went unseen: a debug-env warning when the props differ.
- N2 No public way to create an instanced mesh entity (W5's two hand-built copies: `new
  InstancedMesh`, refs, `OBJECT3D` + `TAG_IS_MESH`, `userData.entityId`).
- N3 S8 (p619): `persistent` isn't applied by `createEntity` (W4).
- N4 The HEIGHTFIELD collider is column-major; `generateTerrain`'s `heights` is row-major (T9).

## 2. Decisions

Confirmed 2026-10-22: every recommendation as written; the alternatives under them aren't taken.

### D1. Scope

- **Full review (p600 §5):** `src/toolkit/**` (code, the material JSONs, the model JSON);
  `src/app/**` (scenes, examples, the banner profile, PostFX, asset JSONs); the root files
  (`index.ts`, `CONFIG.ts`, `AppECSPlugins.ts`, `AppECSRegistry.ts`).
- **Hub and docs:** the toolkit feature page, the example pages and every page that includes app
  code (the regions in U3), the debug suite guide if D9 touches `scene01`, `features/lod/CLAUDE.md`'s
  showcase lines, the root `CLAUDE.md`'s toolkit and app lines.
- **Added:** `devTools/toolkit/buildAekashaSymbol.ts`' run at import and its citation (T12).
- **Not in scope:** engine code. N1-N4 become issue files (N3 is p619's remark, linked), and the
  toolkit works around N2 and N4 where it needs to. p621's `{@link getRandomStream}` stays p621's.

### D2. Versions

- **Toolkit minor** (2.1.3 → 2.2.0): names added to entries (D5), behaviour fixes (D4), new
  options (D5's `sceneId` on the rig). Nothing removed: renames keep the old name `@deprecated`
  until toolkit 3.0.0 (p622 gets the list).
- **App minor** (1.13.2 → 1.14.0) if D9's scene changes land (a merged and a removed scene,
  `src/app/shared/`); a patch otherwise.
- **Engine:** none expected (no engine file changes; N1-N4 filed). `features/lod/CLAUDE.md` and the
  root `CLAUDE.md` change with no engine bump, as in p619.
  - **Corrected (Phase 5):** **engine patch** (5.10.0 → 5.10.1). `checkVersions --against main`
    counts every file under `src/_engine/`, the `CLAUDE.md` files included, and Phase 5 changes
    the input `CLAUDE.md`, `features/lod/CLAUDE.md` and `debug/DevFiles.ts`' `@example` (the moved
    `scene01Camera` path). Decided 2026-10-22: a patch, not a `checkVersions` exception.

### D3. Behaviour changes, and the scene baselines

Every change below is in the changelog. The scene runner's baselines are recorded on `main` first
(Phase 0); a phase that changes a scene's snapshot, hash or system order on purpose re-records
that scene in the same commit and names it.

- **Toolkit:** `MovingPlatform`'s fixes (C1-C7: `play` after `pause`, `stop` resets, the loop end
  zeroes the velocity, `BACKWARD` counts and durations, a missing `rot`), `getHeightAt` per
  triangle (T2), scatter spawn's scale (T1), the edge cases (T3, T4), `MutualGravity`'s capacity
  (C12). Phase 0 checks the gym's platforms touch none of C2-C6 (they use neither `BACKWARD`,
  `loopTimes`, nor the controls, and give `rot` on every point or none: read, not run), so its
  hash stays.
- **Scenes whose baselines change** (expected): `topDownTestScene` (T2 moves its obstacles),
  `thirdPersonGymScene` (P8's `SunShadowFit`: the snapshot; P9's ids if renamed, D8), `scene01`
  (D9's merge), `physicsTest` (P3: the shape cast after a step; the hash shouldn't change),
  `sceneTestECS` (D9's rewrite), the removed `oneMoreScene`, `testDebugScene` (D9).
- **The gym on this machine:** its three debug configurations fail the probe's 600-step wait in
  300 s (§1.2), `MAIN_THREAD` included (Phase 0). Decided 2026-10-22: the gym's checks here are its
  errors and its system order (the `prodTest` run); its hashes, character paths and snapshot are
  checked only on a faster machine. A failure of the probe wait alone is this machine's, as in
  p619. Phase 0's reading of the platforms (C2-C6 can't reach the gym's six) stands in for the
  hash check in Phase 1.

### D4. The bugs first, with tests

The bugs first, each with a test that fails before the fix where Node runs it, and a scene runner
check where it doesn't:

- **Loads that hang (P1, W1):** the three scenes become plain `async` functions. The scene runner
  can't see a hang today (no scene throws); a Vitest test is out of reach (scene code needs a
  renderer), so the check is reading plus a one-off throw in `yarn dev` (each recorded in "As
  built").
- **Leaks across scenes (P2, W3, V1, V2, P3):** the global key bindings get a `sceneId` (or go,
  D12); `assetCompare` and the texture scenes stop at their scene's exit; the shape cast runs from
  `registerOnSceneEnter` after the first step, re-checking the scene.
- **The toolkit's (C1-C7, C12-C14, T1-T4):** tested in Node (D13). `MovingPlatform`'s path logic
  is tested through D7's pure module.
- **Small app bugs:** A1, P4, W4 (the flag goes). W2 didn't reproduce (Phase 0); D9's merge
  removes its duplicate ids.

### D5. The toolkit's public surface (T5-T8, C10, C15)

- **The four leaked types** go on their entries, each with a summary
  (`MovingPlatformControls` on `aekasha/toolkit/ecs`; `AsteroidNoiseOptions`,
  `AsteroidCraterOptions`, `TerrainNoiseOctave` on `aekasha/toolkit/geometry`).
  `yarn hub:build` then has no R2 warning.
- **`MovingPlatform`:** `MovingPlatformParams` and `MovingPlatformPoint` exported (the parameter
  type gets a name). `PhysicsParams` becomes `MovingPlatformPhysicsParams`, the old name a
  `@deprecated` alias until toolkit 3.0.0. `DeleteMeshOptions` and `opts.deleteMeshOptions`
  `@deprecated` (never read), removed in 3.0.0. `scene` optional (the mesh is in the root scene
  already).
- **Names exported by a module but on no entry:** the three effect systems and `MutualGravity`'s
  four (`GravityBody`, `clearGravityBodies`, `getGravityBodies`, `getMutualGravityDefaults`) are no
  longer exported (the register helpers are the API; nothing imports them). The triplanar helpers
  go on `aekasha/toolkit/materials`, each with a summary, so a copied material compiles (T7).
- **The `*.tsl.ts` sockets (T8):** each gets a summary naming its inputs and the defines it reads,
  and `@internal` (on no entry; asset code read by socket name). The socket contract itself is
  documented on the toolkit page (D14).
  - **Alternative:** no `@internal`, and an exception in the JSDoc standard ("a TSL file's socket
    exports are asset code").
- **`createSeededRandom` (T6):** a toolkit module holding
  `/** @deprecated … */ export const createSeededRandom = …`, re-exported by the entry, so the Hub
  and the editor show the deprecation.
- **Kept, documented (breaking to change):** `addGravityBody`'s positional `world?`, the component
  key `enum`s (their "Internal" labels fixed). Both listed for toolkit 3.0.0 in p622.
- **Additions (non-breaking):** `HoverToolData.time` optional (a phase in seconds, default 0);
  `FollowObjectCameraParams.targetMesh` widened to `Object3D`; the rig takes an optional `sceneId`
  (deleted on that scene's exit, as viewports do) and ticks only in the world it was created in
  (C14).

### D6. JSDoc to 100 %, an `@example` per piece

- Every toolkit export and member documented, the defaults read from the code (T9, C17), the
  traps as `@remarks` (the controls write physics outside the step, world-space placements, the
  rig reads `targetMesh.position` as local, the `afterLookAtFn` params reused per frame).
- The option and result types that are `type X = { … }` become `interface`s where they're plain
  object shapes, so the ratchet counts their members (`ecs/gameplay`'s 0 / 0).
- **An `@example` on every entry-point API** (checked by `examples.test.ts`):
  `createMovingPlatform`, `registerMutualGravityEffect` with `addGravityBody`, each
  `register*Effect` with its component, `generateAsteroid`, `generateTerrain`,
  `generateTreeGeometry` / `generateBushGeometry`, `scatterOnSurface` with
  `bakeScatterToInstancedMesh`, `triplanarProjection`.
- `docs.json`: the toolkit at 100 % (exports and members), the ratchet recorded.

### D7. Size

- **`MovingPlatform`** moves to `ecs/gameplay/movingPlatform/` (a piece that grows a second file
  gets its folder): `MovingPlatform.ts` (the factory and the controls), `PlatformPath.ts` (a pure
  path state machine: `step(dt)` writes the pose and returns the segment change or the end;
  validation with one `function fail(…): never`; the move-and-turn check), `PlatformVelocity.ts`
  (pure, scratch objects, C16). The entry's names don't change.
- **The app's `scene` functions over 150 lines** become named steps, each with a line of what it
  shows, with their data as module-level tables: the gym (544; P9's platforms as a table and a
  `createPlatform` helper, the static models imported together and spawned in table order),
  `largeWorld` (550; a `mergeIntoGeometry` helper for its two copies), `physicsTest` (421; one
  function per joint), `scene01` / `scene01V2` (227 / 301, or one after D9), `physicsTiers` (203),
  `sceneTestECS` (183, or D9's rewrite). `assetCompare`'s `buildSlot` (146) and
  `_dbg__assetCompare.ts`' collider check split too.
- **What a split keeps:** every id and appId (they key saved data and the baselines), the order
  entities and bodies are created in (body ids, so the hashes) and the order systems are added in
  (the system order baseline). Each split is checked by its scene's run with an unchanged hash.

### D8. The app's placement and readability

- **`src/app/shared/`** is created, with what two scenes use: `characterVisual.ts` (P5),
  the large world's rock (W5: one module, used by `largeWorld` and the `rockImpostors` lane),
  `instanceCell.ts`' cell helper if `testDebugScene` keeps its copy (D9), and the verification
  scenes' harness (`verifyHarness.ts`, V3). `SpinComponent` / `SpinSystem` stay in
  `examples/ecs/` (the ECS page), said in their headers.
- **The gym:** `followWithSun` replaced by `SunShadowFit` on the gym's sun (P8: the snapshot
  changes, D3). `characterTestObjects.ts` / `characterTestObstacles.ts` become one
  `gymStairsAndWall.ts` taking the material and positions; `slideAngles` a row of the models table.
  `PhysicsStressTest.ts` becomes `_dbg__PhysicsStressTest.ts`, loaded behind `IS_DEBUG_ENV`, with a
  scene action map, a seeded stream and a unit quaternion (P2, P6, P7).
- **Ids stay** (the player's `'topDownChar'`, the `customPropTest*` appIds): they key the saved
  debug state and the path hashes. A comment says what each is.
  - **Alternative:** rename them (`gymPlayer`, descriptive appIds), re-recording the gym's
    baselines and losing its saved debug state.
- **Debug tools' randomness (P6):** `getRandomStream('gym:stress')` and `('space:spawn')` (restarted
  on every load, so the Nth spawn of a visit repeats).
- **Example code:** `existsOrThrow` with a message instead of `!` and casts (A5, P11, W10), one
  `saveBufferGeometry` pattern (`getGeometry(id) ?? saveBufferGeometry(…)`, the engine's example).

### D9. Which scenes stay

- **`scene01` and `scene01V2` merge** into `scene01` (V2's content, scene01's batch texture load,
  no `d` key), keeping the id the Hub's debug suite guide names. `scene01Camera`, `scene01Ambient`,
  `scene01Sun` move into its folder (one scene left). Fixes W1 and W3, and removes W2's duplicate
  ids.
- **`oneMoreScene` goes** (an empty view that ships; nothing references it).
- **`testDebugScene`** drops its LOD checks (`lodShowcase`'s lanes cover them) and keeps the KTX2
  / meshopt orientation row, with its camera and lights in its JSON. The id stays.
- **`sceneTestECS`, the start scene,** is rewritten into a short first scene a developer reads
  first: one ground, lights from its JSON, the hover ball, one camera; no second world, no stress
  keys, no unused assets, no commented-out code. The id stays (`src/index.ts`, saved data).
  - **Alternative:** make `skyShowcase` the start scene and turn `sceneTestECS` into a debug scene.
- **`p341AlphaCutTest`** and its PNG go (J1), its lock entry and output pruned by `yarn assets`.

### D10. The app's debug modules

- They stay on the app's pattern (`IS_DEBUG_ENV` + `import()` of a `_dbg__` module in the scene),
  which the Hub's debug tab example teaches: the engine's wrapper-and-loader is for public entry
  points.
- What's missing is cleanup at the scene's exit (V1's listener), P7's stress test, the LOD
  showcase's harness exports (W8: removed with `features/lod/CLAUDE.md`'s sentence, nothing reads
  them), and `assetCompare`'s LS key (`AEK_debugAssetCompare`, migrating the old key once) and
  report cache.
- `window.__textureArrays` / `__textureAtlases` (V4): kept, the headers saying they're read by
  hand; asserting them from the scene runner is a p299 item.
  - **Alternative:** a scene runner hook that asserts them (a runner change, p601's area).

### D11. Determinism and the simulation lint

- `physicsTiers.ts` (its plough writes in `APP_PHYSICS_STEP`) joins `SIMULATION_FILES`. The gym
  scene's and `space.ts`' step code is already under rules (the brain is listed; MutualGravity is
  the toolkit's). The debug spawners use seeded streams (D8), not the lint.
- `scene01`'s spin moves to the sim clock (W3), as V2's did.

### D12. Hygiene

- **Comments:** the plan citations in code and in user-visible JSON descriptions replaced by what
  they meant (the open p299's stay); "legacy", step numbers, tutorial leftovers and stale claims
  (C11, C17, T9, P3, W8, V4) rewritten.
- **Dead code:** the unread exports (`SPACE_GRAVITY`, `SCENE01_ID`, `assets`), `llog`s that log
  timings or per-contact alerts, commented-out code, `HEALTH` kept as the template's example key
  with a comment saying so, `CONFIG.ts`' no-op override and commented-out block, the material
  JSONs' inert params (T10), `testTexture`'s flag and save entry (J2).
- **The global key bindings** (P2, W3): scene action maps.
- **Imports:** one `from 'aekasha'` line per file.

### D13. Tests (Node)

- `toolkit/ecs/gameplay/movingPlatform/*.test.ts`: the path (forward and backward loop counts,
  `loopTimes`, `playSegment`'s stop, `stop` / `play` after a finished run, a missing `rot`), the
  velocities (zeroed on pause, stop and the end), the validation (C1, the empty array).
- `toolkit/ecs/effects/MutualGravity.test.ts`: on a stub world and stub bodies (as the rig test
  does): equal and opposite forces, softening, the 17th body (C12), `undefined` config keys, the
  reset when disabled, dead bodies dropped. `SunShadowFit`'s slice sphere and light-space axes;
  `HoverEffect` and `FollowTool` on a MAP-mode `ECSWorld`.
- `FollowObjectCameraRig.test.ts`: LERP, the orbit's clamp, a same-id replacement, `NaN` dt, the
  `sceneId` delete.
- `toolkit/geometry/**/*.test.ts`: `generateAsteroid` (the same seed gives the same hull, the
  vertex count 10(d+1)²+2, finite normals, `volume <= hullVolume`), `generateTerrain`
  (`getHeightAt` equals `heights` at the vertices and the mesh's triangle inside a cell, 0
  segments), `Foliage` (the groups, 0 clusters), `scatterOnSurface` (deterministic by seed,
  `minSpacing` held, unit normals), spawn's scale in `TRANSFORM`, bake's capacity and `count`.
- The app: no unit tests (scene code needs a renderer; the scene runner covers it), but the pure
  helpers moved to `shared/` get one where they compute something (the verification harness'
  expectation helpers).

### D14. The Hub and `CLAUDE.md`

- **The toolkit page** (`features/toolkit/guide.md`): U1's fixes, a short section per piece with
  its `api:` link, and a "Writing a TSL material" section (the socket contract, `nodes`,
  `staticDefines`, the uniforms' names, copying one into the app) taken from the toolkit's two
  triplanar materials.
- **Example pages:** U2's fixes, and the pages whose regions change (U3) checked against the
  rendered code.
- **The debug suite guide** if `scene01Camera` moves (D9: its path in the dev files example).
- **`CLAUDE.md`:** the root's toolkit line (`MutualGravity`), the app's `shared/` (now used);
  `features/lod/CLAUDE.md`'s showcase lines (W8).
- **No new example scene:** the toolkit's pieces each get an `@example`, and `exampleToolkit`,
  `exampleHubHero`, `largeWorld` and the gym already run them.
  - **Alternative:** extend `exampleToolkit` with a generated terrain and scatter (the geometry
    half of the toolkit has no example scene on the Hub).

### D15. Performance

- The toolkit's per-frame code: C16's storage reads once per frame, the main camera once per run,
  the platform velocity's scratch objects.
- The examples' per-frame code: A2 (a scratch quaternion and a hoisted patch object, in the Hub
  regions), A4, W6, and `physicsTiers`' tint system over parallel arrays instead of a 686-entry
  `Map` per frame.
- Build time (`largeWorld`'s load): a grid hash for `scatterOnSurface`'s `minSpacing` (T11),
  measured before and after (the scene's load time in `yarn dev`), the placements unchanged for a
  seed (the test pins them). **Optional** (Phase 0): the four calls take about 50 ms of a 3.3–3.9 s
  load. Phase 1 does it only if it stays small; otherwise T11 is a remark in the JSDoc.
- `perf-auditor` reran on the changed files in the last code phase.

## 3. Phases

Each phase leaves the tree green: `yarn test`, the lint and both `tsc` (the Stop hook), and the
phase's own checks. Each is split into sections, stopped after for review, and ends with its "As
built" list, `docs.json` updated where the toolkit changed (`yarn verify:baselines --docs` never
grows a folder's undocumented count), and a line on whether the next phase starts in a new session.
Branch `review-toolkit-and-app-code` from `main` (`1964613`).

The scene runner: Phase 0 records the baselines on `main`'s code; Phases 1-6 run
`yarn verify:scenes --only <their scenes>` after their code changes (the hashes and system orders
unchanged, or re-recorded with `--update` for the scenes D3 names, with the diff described in "As
built"); Phase 8 runs every scene against Phase 0's baselines (and those re-records). Nothing is
edited while a run is going, and `yarn test` doesn't run beside a `yarn build` (p619 Phase 8).

### Phase 0: baselines, repros and the open checks — done

1. `yarn verify:scenes --update`, then `yarn verify:baselines`, `yarn sbp --profile all`,
   `yarn hub:build` (the five warnings of §1.2).
2. Repros as `it.fails` tests, each checked to fail on its own assertion:
   - `MovingPlatform` (C1-C7) through `createMovingPlatform` with `createPhysicsEntity` and the
     world stubbed (`vi.mock('aekasha')`, as `FollowObjectCameraRig.test.ts` stubs its inputs): the
     geo + mat path, `play` after `pause`, the loop end's and `stop`'s velocity, `BACKWARD`'s loop
     count and duration, `stop` + `play`, a missing `rot`, an empty `physicsParams`,
     `speedMultiplier: 0`, the caller's `userData`.
   - `MutualGravity` (C12, C13): the 17th body, `{ G: undefined }`.
   - The rig (C14): `NaN` dt.
   - Geometry (T1-T4): spawn's scale, `getHeightAt` against the mesh's triangle, 0 clusters, 0 and
     fractional segments, bake's capacity and `count`.
3. By hand in `yarn dev`, recorded in "As built" (not committed):
   - P1 / W1: a temporary `throw` in each of the three scenes leaves the load pending (the scene
     loader stays, a later `loadScene` never runs).
   - W2: `scene01` → `scene01V2` renders V2's ground with scene01's BASIC material.
   - P2 / W3: after the gym, `J` spawns into `physicsTiers`; after `scene01`, `d` logs in the gym.
   - V1 / V2: a switch during `assetCompare`'s measure, and right after `textureArrays` loads.
4. The checks the decisions depend on:
   - the gym's six platforms against C2-C6 (no `BACKWARD`, `loopTimes`, controls, partial `rot`),
     so Phase 1 leaves its hash (D3);
   - which baselines record `scene01V2`, `oneMoreScene` and the start scene (the bundle's chunks,
     the scene runner's, `api.json`), for Phase 5's removals;
   - `largeWorld`'s load time and `scatterOnSurface`'s share of it in `yarn dev` (D15's before);
   - the placements `scatterOnSurface` returns for `largeWorld`'s three calls, hashed (the grid
     hash must give the same ones, T11).

As built (2026-10-22, steps 1-2 committed as `899dd57`):

- **Baselines (step 1):** `yarn verify:scenes --update` recorded 105 runs in 65 min (WebGL2 on
  SwiftShader, `.cache/verify/scenes/webgl/`); the gym's `workerSab`, `workerMsg` and `mainThread`
  failed the probe's 600-step wait (285-293 s each), so their entries are still the stale ones of
  2026-10-09 (`ee5a641+dirty`, 120 steps); its `prodTest` recorded the system order (D3).
  `yarn verify:baselines` unchanged (bundle 388.7 kB gzip; `api.json` 2,480 exports, 919 on
  entries; `docs.json` 2,365 / 2,384 exports, 940 / 970 members; no debug code). `yarn sbp
  --profile all` unchanged against both baselines, every budget within (`index.css` 0.9 of 3 kB:
  "lower it to 2 * KIB", not this plan's). `yarn hub:build`: 84 pages, 16 entries, 920 names, 99 %,
  and exactly §1.2's five warnings.
- **Repros (step 2):** 25 `it.fails`, each checked to fail on its own assertion when run as an
  `it`: `ecs/gameplay/MovingPlatform.test.ts` (14: C1-C7), `ecs/effects/MutualGravity.test.ts` (2:
  C12 first in its file, since the scratch arrays grow once per module; C13),
  `FollowObjectCameraRig.test.ts` (1: C14's `NaN` dt), `geometry/scatter/ScatterOnSurface.test.ts`
  (4: T1, T4's capacity, `count`, and a world-space placement under a moved mesh),
  `geometry/generate/Terrain.test.ts` (3: T2 by a ray cast down on the mesh, max 0.117 off at
  `maxHeight` 5; T3's 0 and fractional segments), `geometry/generate/Foliage.test.ts` (1: T3's 0
  clusters, as `not.toThrow()`). The platform test mocks `aekasha` (spread from the real module)
  and `aekasha/physics` with a stub world and a body recording its user data and kinematic targets;
  ticks go through the system `registerMovingPlatformSystem` registers. T1's test checks that
  `createMeshEntity` gets `scale` in its props (the real one needs the root scene, on no entry).
  Each file's header names this plan's Phase 1 as the fix. `yarn test`: 1,126 passed, 25 expected
  fails.
- **Hand repros (step 3),** driven by Playwright on `yarn dev` (WebGL2 on SwiftShader, scenes
  switched through the page's own `SceneLoader` module; `.cache/runs/p620-repros.ts`, gitignored,
  for Phase 3 to rerun): P1 / W1 reproduced in all three scenes (a temporary throw behind a URL
  flag, reverted: the page gets the uncaught error, the load and a following `loadScene` stay
  pending, the old scene stays current); P2 (`J` after the gym spawned 50 bodies into
  `physicsTiers`), W3 (`d` after `scene01` logs `PRESSED` in `physicsTiers`) and V1 (slot B's ground
  and sphere built into `exampleQuickStart` 30 s after a switch mid-measure) reproduced; V2 only for
  `textureArrays`, W2 not at all (§1.4).
- **Checks (step 4):** the gym's six platforms pass no `opts`, discard the controls and give `rot`
  on every point (the carousels, the ferris wheel) or none (sideways, elevator): C2-C6 can't reach
  them, so Phase 1 leaves the gym's simulation as it is. `scene01V2`, `oneMoreScene` and
  `sceneTestECS` are named only by `bundle.json` (`assets/<id>.js`) and the local scene runner
  entries: no `api.json` entry, no `scenes.config.ts` entry, no SBP config. `largeWorld`'s
  `loadScene` takes 3,253-3,890 ms (three runs, headless); its four `scatterOnSurface` calls about
  50 ms (D15's grid hash optional). The placements, hashed in Node (sha256 over each placement's
  position, normal, quaternion and scale as `Float64Array`, first 16 hex; the terrain on a plain
  mesh at the origin): trees (1,500) `0c342af0072c8b03`, bushes (2,000) `8f083de1fbe93bd0`, rocks
  (300) `1add797c4c9e4930`, lanterns (10) `ae1afc5258d7b5dd`
  (`.cache/runs/scatterHash.scratch.test.ts`); Phase 1's scatter test pins them.

### Phase 1: the toolkit's bugs and `MovingPlatform`'s split (D4, D7, D13) — done

Sections: 1. `MovingPlatform` into `ecs/gameplay/movingPlatform/` (`PlatformPath.ts`,
`PlatformVelocity.ts`, the factory), C1-C8's fixes, its tests, C16's scratch objects; 2.
`MutualGravity` (C12, C13) and the rig (C14: `NaN` dt, the world it ticks in, `sceneId`), with
their tests; 3. geometry (T1-T4), `getHeightAt` per triangle, the generator tests (D13), the
scatter grid hash if it stays small (T11, D15; the placements' hashes from Phase 0 unchanged, the
load time measured); 4.
checks.

- Each Phase 0 `it.fails` becomes an `it`. The controls keep writing physics when called (C8),
  documented in Phase 2; `setOptions` flipping `direction` restarts the segment from the current
  pose instead of jumping.
- `yarn verify:scenes --only thirdPersonGymScene,topDownTestScene,space,largeWorld`: `space`'s
  hashes unchanged, the gym's errors and system order unchanged (D3), `topDownTestScene`
  re-recorded (T2 moves its obstacles: the diff is its obstacle heights), `largeWorld` unchanged.

As built (2026-10-22, sections 1-3 committed as `8dcf7f7`, `3349f4e`, `a265514`):

- **`MovingPlatform` (section 1):** `ecs/gameplay/movingPlatform/` holds `MovingPlatform.ts` (the
  factory, the controls, the shared system; the closure about 150 lines), `PlatformPath.ts` (the
  path as a pure state machine: `createPlatformPath`, `stepPlatformPath` returning `IDLE` /
  `MOVED` / `SEGMENT` / `END`, the controls' operations, `validateMovingPlatform` with one
  `function fail(): never`, `hasMoveAndTurn`) and `PlatformVelocity.ts` (the segment velocities,
  scratch quaternions). The entry's names and the parameter literal are unchanged; the mesh helper
  types its `shape` as `Parameters<typeof createMovingPlatform>[0]['shape']` until Phase 2 names
  `MovingPlatformParams`. `MovingPlatformPoint`, `PlatformPathOptions`, `PlatformDirection` and
  `PlatformVec3` are exported by the modules (documented, on no entry): Phase 2 puts them on the
  entry or folds them into its names. `SIMULATION_FILES` and the root `CLAUDE.md` name
  `movingPlatform/`.
- **Its behaviour:** a loop ends on each arrival at point 0, in either direction (C4); a backward
  segment takes the `dur` of the point it runs to (its forward edge); the user data velocity is
  zero whenever the platform doesn't play (pause, stop, the end, `setOptions` while paused, created
  paused) and recomputed on `play()` (C2, C3); `stop()` resets the loops and `playSegment`'s target,
  a play after the end starts the loops over (C5); a point without `rot` keeps the one before it,
  point 0 without one none (C6), and `hasMoveAndTurn` counts the segment back to point 0 too; a
  direction flip mid-segment swaps the ends with `t → 1 - t` (C8: no jump, the same speed);
  `dur: 0` jumps in one step with zero velocities, a speed of 0 holds (no `NaN` either way); the
  validation throws on an empty `physicsParams`, no points, a negative or non-finite `dur`, a
  `loopTimes` that isn't -1 or a whole number, a negative speed (C7); the caller's rigid body
  params are copied, not written (C7); after the `createPhysicsEntity` await a deleted entity
  throws with its own message (C8); `stop()` and `playSegment()` also set the next kinematic pose.
  The per-platform user data objects are reused (C16): worker commands are cloned when sent and the
  character reads the user data fresh each step. The comments the move touched were rewritten
  (part of C11: the legacy looper, the system order -100 after the brains' -5 and the controllers'
  -10); the rest of C11 is Phase 2's.
- **The gym, checked in Node (D3's stand-in):** the gym's six paths ticked at 1/60 for 10 min
  through the old module and the new one (`.cache/runs/platformGym.scratch.test.ts`, the old module
  in `MovingPlatformOld.ts`): every body write identical, 433,974 writes, hash `ab3c98e989a411b8`
  both, friction and the initial user data included.
- **`MutualGravity` and the rig (section 2):** the scratch growth keeps the collected masses
  (C12); `setMutualGravityConfig` skips `undefined` keys; the bodies are kept per world
  (`Map<ECSWorld, Map<entityId, mass>>`) and the "forces applied" flag is a set of worlds (C13).
  `removeGravityBody(entityId)` removes the id from every world that has it (signature unchanged).
  The rig skips a `NaN` dt (`!(dt > 0.0001)`), ticks only in the world it was created for (the
  default world, read at creation), and takes an optional `sceneId`: one `registerOnAllSceneExits`
  listener, registered by `registerFollowObjectCameraRigSystem`, deletes the exiting scene's rigs
  (the exiting scene is still current then; `registerOnSceneExit` is one per scene and would
  replace the scene's own). The app's scenes still delete their rigs themselves (Phases 4 and 6
  may switch them to `sceneId`).
- **Geometry (section 3):** `getHeightAt` is the height of the mesh's triangle under the point
  (the b–c diagonal, the far edges in the last cell) (T2); the segment counts are rounded and at
  least 1, and returned as used (T3); a bush of 0 clusters is an empty geometry (T3); spawn passes
  `scale` in the mesh props (T1); bake bakes what fits after `startIndex` (a warning for the rest),
  sets `mesh.count` to the returned index and undoes the mesh's world matrix (T4); `triplanarGrid`'s
  `normalNode` throws on a missing `seamNormalStrength` (T4). The doc lines the fixes touched were
  rewritten (`widthSegments`, `getHeightAt`, `minSpacing`, bake, spawn); the rest of T9 is Phase 2's.
- **The scatter grid (T11, D15):** done (about 40 lines): accepted positions in cells a hair wider
  than `minSpacing`, the 27 around a candidate checked. It finds every position the scan did, so
  the placements are the same: Phase 0's four hashes, now pinned by `ScatterOnSurface.test.ts`.
  The four calls: about 40 → 21 ms in Node. `largeWorld`'s `loadScene` in `yarn dev` (headless,
  `.cache/runs/p620-largeWorldTime.ts`): 2,954-3,532 ms against Phase 0's 3,253-3,890: the gain
  is below the runs' spread.
- **Tests:** the 25 `it.fails` are `it`s, each failing on the old code. Added: `PlatformPath.test.ts`
  (17), `PlatformVelocity.test.ts` (6), `MutualGravity` (5 more), the rig (5 more),
  `HoverEffect.test.ts`, `FollowTool.test.ts`, `SunShadowFit.test.ts` (on a real `ECSWorld` in
  both storage modes, each system captured through its register helper, so they survive Phase 2's
  C16 and D5 changes), `Asteroid.test.ts`, more in `Terrain`, `Foliage` and `ScatterOnSurface`,
  and `materials/triplanarGrid/TriplanarGrid.test.ts` (PascalCase: the layout's naming rule exempts
  only `<id>.tsl.ts`). One Phase 0 repro was wrong: the backward-loop test ran both platforms in
  the one shared system, so it now records each one's stop while they tick together. `yarn test`:
  1,223 passed, no expected fails.
- **D3, corrected:** T2 also moves `largeWorld`'s placements (it places props, dynamic objects, the
  crate stack and the barbell with `getHeightAt`): of its 15 points 11 lie on grid lines
  (unchanged), four move by 1 mm, 1.5 mm, 3 mm and 4.2 cm. Its probe hashes nothing (no physics
  bodies, `scenes.config.ts`) and its snapshot is within tolerance, so the runner sees no change.
  `topDownTestScene`'s four hill obstacles move by at most 0.20 m (mean 1 cm over their area; they
  sink 0.3 m anyway): they're `FIXED` bodies the probe doesn't hash, the character's path doesn't
  reach them in the probe steps, and the snapshots are within tolerance, so it wasn't re-recorded.
- **The scene runner** (`--only thirdPersonGymScene,topDownTestScene,space,largeWorld`, 25 min): 13
  passed, every hash, character path, snapshot and system order as Phase 0 recorded; the gym's
  `prodTest` passed (its errors and system order), its three debug configurations failed the
  probe's 600-step wait (310 s each), this machine's (D3).
- **`yarn verify:baselines --update`:** `api.json` (the six names moved to
  `movingPlatform/MovingPlatform.ts`, the split modules' 17 exports added, on no entry: still 919
  names in 16 entries), `bundle.json` (the main chunk's toolkit group 5.5 → 6.2 kB gzip, 6 → 8
  modules; `assets/largeWorld.js` 3.9 → 4.1 kB: the scatter grid and bake's changes), `docs.json`
  (`toolkit/ecs/gameplay/movingPlatform` 23 / 23 exports, 27 / 27 members). `bundle.banner.json`'s
  1-2 byte gzip drift not committed. No debug code in either build.

### Phase 2: the toolkit's surface and its JSDoc (D5, D6, D15's toolkit part) — done

Sections: 1. the entries (the four leaked types, `MovingPlatformParams` / `Point`, the renames and
deprecations, the triplanar helpers, the unexported module names, `createSeededRandom`'s module,
the `*.tsl.ts` sockets `@internal`), the additions (`HoverToolData.time`, `targetMesh`), the
`type` → `interface` changes; 2. JSDoc on every export and member (T9, C11, C15, C17), the
`@remarks`; 3. an `@example` per entry-point API (D6's list, `examples.test.ts`); 4. the rest of
the toolkit's hygiene and per-frame reads (C16's storages and main camera, T10's JSON params and
`debugData`, T12, the import lines); 5. checks.

- `yarn hub:build`: no leaked type (p621's `getRandomStream` link the only warning), the toolkit
  entry pages showing the deprecations.
- `docs.json`: the toolkit at 100 %, recorded. `api.json`: the added names, nothing removed from an
  entry.
- The material JSON changes keep the rendering: `yarn verify:scenes --only
  exampleToolkit,exampleQuickStart,space,exampleHubHero,thirdPersonGymScene,topDownTestScene`
  unchanged.

As built (2026-10-22, sections 1-4 committed as `5bfd44d`, `36e638f`, `cefa2b1`, `b3fdf1f`):

- **The entries (section 1):** `aekasha/toolkit/ecs` adds `MovingPlatformControls`,
  `MovingPlatformParams`, `MovingPlatformPoint`, `MovingPlatformOptions` (the path options plus
  `isPlayingFromStart` and the deprecated `deleteMeshOptions`), `MovingPlatformPathOptions` (Phase
  1's `PlatformPathOptions`, renamed for the entry; `setOptions` takes it) and
  `MovingPlatformPhysicsParams` (`PhysicsParams` its `@deprecated` alias). `PlatformDirection` is
  gone (the union inline) and `PlatformVec3` is `@internal`, the point's `pos` and `rot` inline
  literals, so no entry name leaks a type. `createMovingPlatform(props: MovingPlatformParams)`;
  `scene` optional (a parentless raw mesh goes into the root scene). `aekasha/toolkit/geometry`
  adds the three leaked types; `createSeededRandom` is a declaration of its own in
  `geometry/SeededRandom.ts` (a layout rule for it), `@deprecated`. `aekasha/toolkit/materials`
  adds `blendProjections`, `blendProjectionGradients`, `readBooleanDefines`, `ProjectionPattern`,
  `TriplanarProjection`. The `*.tsl.ts` sockets are `@internal` with summaries (inputs, defines).
  `yarn hub:build`: 935 names, no leaked type, p621's `getRandomStream` the only warning; the
  pages show the four deprecations.
- **Unlike D5:** `MutualGravity`'s `clearGravityBodies`, `getGravityBodies`,
  `getMutualGravityDefaults` and `GravityBody` stay exported, `@internal` (Phase 1's
  `MutualGravity.test.ts` imports them); the three effect systems are unexported. The toolkit's own
  `createSeededRandom` made `api:createSeededRandom` ambiguous, so the toolkit guide and the coding
  standards page link `api:utils/SeededRandom.createSeededRandom` (the guide's U1 fixes stay
  Phase 7's).
- **`type` → `interface`:** `FollowObjectCameraParams`, `MutualGravityConfig`, `GravityBody`,
  `DeleteMeshOptions`, `MovingPlatformControls`, `MovingPlatformReturn`,
  `TriplanarProjectionOptions` (`TriplanarProjection` stays a `ReturnType` alias).
  `HoverToolData.time` is optional (the phase, default 0); the rig's `targetMesh` is an
  `Object3D` (in `afterLookAtFn` too).
- **JSDoc (section 2):** every toolkit export and member documented (C11, C15, C17, T9): the
  component key enums' "Internal" labels replaced, the register helpers' stage, order and
  "a second call is a no-op", `MutualGravity`'s overview moved onto `registerMutualGravityEffect`,
  the rig's defaults and `afterLookAtFn`'s reuse, `createMovingPlatform`'s `@throws`, the
  controls' physics writes as `@remarks`, the geometry types' defaults, `heights` row-major against
  the `HEIGHTFIELD` collider's column-major (`@remarks`), the stale citations and claims gone.
- **Examples (section 3):** 10 added (the rig's kept): the four register helpers (an
  `EngineFeature` install, then the component), `createMovingPlatform`, `generateAsteroid`,
  `generateTerrain`, `generateTreeGeometry` (an instanced pool) and `generateBushGeometry`,
  `scatterOnSurface` with `bakeScatterToInstancedMesh`, `triplanarProjection` (a `colorNode`
  socket). `examples.test.ts` was checked to fail on a wrong type in one; every name they use is
  on an entry (a misspelled name would pass as the reader's own).
- **Hygiene (section 4):** C16: `HoverEffect` and `FollowTool` read their storages once per run,
  `SunShadowFit` its storages and the main camera once per run (not per light), the dead
  `if (!storage)` checks gone. T10: `Foliage` builds its parts with three's geometries, never
  registered (the output hashed identical before and after); `existsOrThrow` for the `!`s; one
  value import from `aekasha` per file (a value line plus an `import type` line kept, the
  codemod's convention); the material JSONs lose `color` (both triplanar) and `color` /
  `roughness` (`asteroid`), the triplanar ones get `debugData`, their TSL files say the JSON sets
  each define. T12: `buildAekashaSymbol.ts` builds only when run as the script, without p554.
- **Checks (section 5):** `yarn verify:baselines --update`: `api.json` (14 names added to the
  three toolkit entries, none removed from an entry; the module exports above added, moved or
  removed, seven `TypeAlias → Interface`), `docs.json` (the toolkit at 100 %, exports and members:
  2,401 / 2,401 and 1,043 / 1,043 in all), `bundle.json` (`assets/Asteroid.js` +69 B,
  `assets/Foliage.js` -7 B, the main chunk -175 B); `bundle.banner.json`'s 1-2 byte gzip drift not
  committed. No debug code in either build. `yarn verify:scenes --only
  exampleToolkit,exampleQuickStart,space,exampleHubHero,thirdPersonGymScene,topDownTestScene` (27
  min): 21 passed, every hash and snapshot as recorded (`space`'s worker / main thread hashes
  differ as before); the gym's `prodTest` passed, its three debug configurations failed the
  probe's 600-step wait (308-312 s), this machine's (D3). `yarn test`: 1,223 passed.

### Phase 3: the app's bugs and leaks (D4's app part) — done

Sections: 1. the hangs (P1, W1: the three scenes become plain `async` functions; scene01 and V2
merge in Phase 5, from working code); 2. the leaks (P2's and
W3's keys as scene action maps, V1's exit and listener, V2's scene checks, P3's shape cast from
`registerOnSceneEnter` after the first step); 3. the small ones (A1's loader status, P4's loader
and `physicsTiers`' cleanup order, W4's flag, P2's rejections caught); 4. checks.

- Phase 0's hand repros rerun and pass (recorded).
- `yarn verify:scenes --only thirdPersonGymScene,scene01,scene01V2,physicsTest,physicsTiers,
  topDownTestScene,assetCompare,textureArrays,textureAtlases,sceneTestECS`: unchanged but for
  what's named (`physicsTest`'s hash shouldn't change; a changed one is explained or the fix
  revisited).

As built (2026-10-22, sections 1-3 committed as `2f2d49a`, `5008e7a`, `2dfe051`):

- **The hangs (section 1):** the gym, `scene01` and `scene01V2` are plain `async` functions (the
  bodies only dedented); the loader ignores a scene function's value (`Promise<void>`), so the
  `resolve(…)`s went without a return, and with them `scene01V2.ts`' `SCENE01_ID` (D12's, early:
  it was only the resolved value). Checked by Phase 0's `P1W1` repro with a temporary throw after
  each scene's first `await` (`?p620Throw`, reverted): each load now resolves `false` with the
  loader's "Could not load scene … (phase 'LOAD')", and the next `loadScene` runs (`physicsTiers`
  current), where Phase 0 left both pending.
- **The keys (section 2):** the gym's `J` is a scene action map (`physicsStressTest`, the gym's
  `sceneId`, `enabledInDebugCam: 'ENABLED_IN_DEBUG'` as the binding had);
  `initPhysicsStressTest({ sceneId, batchSize? })`. **Unlike the plan,** `scene01`'s `d` stays a
  key binding with `sceneId: 'scene01'` (D4's other option): it's the input `CLAUDE.md`'s example
  of a binding that reads the event's `time`, and Phase 5's merge removes it (that line with it).
- **`assetCompare` (V1):** the scene's exit marks both slots `isLeft` and clears the change
  listener. A build re-checks after each `await` (`throwIfLeft`, a `SceneLeftError` the queue
  doesn't log) and a stopped build clears its slot, the textures, import and entities it
  registered into the next scene included, and the shared base colour. A new visit's slots queue
  after both of the last visit's (the ids are the same), so the clearing never hits the new
  visit's assets. The measure stops at its next `await` (no final rebuild, slot B's settings and
  `shown` restored, `null` returned).
- **The texture scenes (V2):** a per-visit `{ isLeft }` set by the scene's exit: `runSwaps` and
  the atlas readout stop at their next `await`, and a swap the exit interrupts logs nothing.
- **`physicsTest` (P3):** **unlike the plan,** the trigger is a scene app looper, not
  `registerOnSceneEnter` (it runs while physics is still held): it waits for
  `getPhysicsSimClock() >= 1` (a step issued to this visit's world; the worker runs it before the
  casts), deletes itself and runs `runShapeCasts` (now module level), which stops after an
  `await` once the scene is left; its errors are caught. The 17-line comment is rewritten.
- **The small ones (section 3):** A1: `updateLoaderStatusFn` is a `void` callback updating the
  text (no `loaded`, no `return true`). P4: the top-down loader ends at 3 / 3; `physicsTiers`
  takes its tint refs (`tint.retain()`) and registers its exit right before adding its systems,
  after everything that can throw (a load that fails never exits, so an earlier registration
  wouldn't help), and the `removeSystem`s before each `addSystem` are gone; the systems keep
  their place after `setPhysicsTierPolicy`. W4: `mainCamera.camera.json` loses `persistent`. P2:
  a stress body that isn't created deletes its mesh, and the batch warns once (not once its scene
  is left).
- **Hand repros** (Playwright on `yarn dev`, `.cache/runs/p620-repros.ts`; logs
  `.cache/runs/p620-p3-*.log`): W3 (`d` after `scene01` logs nothing in `physicsTiers`), P2 (`J`
  after the gym spawns nothing in `physicsTiers`; in the gym it still spawns 50), V1 (no slot of
  a mid-measure switch in `exampleQuickStart` 30 s later), V1b (new: leave mid-measure and come
  back: the measure resolves `null`, both slots build, the settings restored), V2 (only the
  scenes' allowed errors after a switch right after the load), P3 (a hit at TOI 4.25 with normal
  (0, 1, 0) and no hit up, as the start scene (logged: no toaster yet) and after a switch-in
  (toasts); a switch right after the load logs nothing). W2 wasn't rerun (Phase 0: not
  reproduced). Seen, not this phase's: `saveBufferGeometry: "assetCompareGround" is registered
  already` on every slot B build (A5 / P11's pattern, Phase 6).
- **The scene runner** (`--only` the ten scenes, 41 min): 37 passed, every hash, snapshot and
  system order as recorded (`physicsTest` `d5c1562a`, `physicsTiers` `49157b8f` in all three
  targets); the gym's `prodTest` passed, its three debug configurations failed the probe's
  600-step wait (297-308 s), this machine's (D3). No baseline re-recorded. `yarn test`: 1,223
  passed.
- **For the next phases:** Phase 4 moves `PhysicsStressTest.ts` (now taking `{ sceneId }`, its
  rejections caught) to `_dbg__`, and keeps `physicsTest`'s `runShapeCasts` and its visit guard
  through the joint split; Phase 5's merge drops `scene01`'s `d` binding and the input
  `CLAUDE.md`'s line citing it; Phase 6's harness work (V3) keeps the visit guards of
  `assetCompare` and the texture scenes.

### Phase 4: the physics and character scenes (D7, D8, D11, D12 for them) — done

Sections: 1. `src/app/shared/` and `characterVisual.ts`; the gym's split (named steps, the
platform table and `createPlatform`, the models table and imports, `gymStairsAndWall.ts`), the ids
kept; 2. `SunShadowFit` on the gym's sun (P8), `_dbg__PhysicsStressTest.ts` (P6, P7); 3.
`physicsTest` (one function per joint, its own helpers), `physicsTiers` (steps, the tint arrays,
`SIMULATION_FILES`), `topDownTestScene` (`between`, the loader), `space` (P11, the seeded spawn);
4. comments, casts and citations in these scenes and their JSONs (P9, P11, J4); 5. checks.

- Section 1 alone first: `yarn verify:scenes --only thirdPersonGymScene,topDownTestScene` with
  `topDownTestScene`'s hashes and paths, and both scenes' system orders, unchanged (the split moved
  code, nothing else; the gym's hashes and snapshot only on a faster machine, D3). Then section 2's
  `SunShadowFit` changes the gym's system order (re-recorded, the diff described); its snapshot
  change is left to a faster machine's run.
- `physicsTest`, `physicsTiers`, `space`: hashes and system orders unchanged.

As built (2026-10-22, sections 1-4 committed as `532910a`, `d9665e9`, `d1b88cd`, `582d535`):

- **The gym's hash, checked here (unlike D3):** for this phase the gym's `probeSteps` was 120
  (`scenes.config.ts`, temporary, reverted in section 5: 600 steps never finish here, 120 take
  ~87 s). Before section 1, a `mainThread` baseline recorded on `1ea399c`: hash `a098ff98`,
  character paths `492487c1`. Every section after it ran against that: the hash and the paths
  never changed. The gym's four entries are now 120-step ones (section 2's re-record), so a
  600-step run compares against no hash of its own until a faster machine records one.
- **`src/app/shared/` and the gym's split (section 1):** `shared/characterVisual.ts` (the gym and
  the top-down scene; its `!`s `existsOrThrow`). `gymStairsAndWall.ts` replaces
  `characterTestObjects.ts` and `characterTestObstacles.ts`: `createGymStairsAndWallAsync({
  material, stairsPosition, wallPosition })` places the meshes and bodies where they go (no
  throwaway PHONG materials, no `setImportedRigidBodyTranslationPartial`), the step a plain
  `BoxGeometry`, `stairsGeo` by `getGeometry(id) ?? saveBufferGeometry(…)`; the mesh user data
  flags nothing read are gone (the body's `isStairs` / `stairsColliderIndex` stay). The stair
  colliders' numbers are explained, not derived (-π / 6.8 is 26.5°, the steps' slope 26.6°: a
  derived angle changes the character paths). The gym (796 → ~720 lines, `scene` ~30): named
  steps, the `PLATFORMS` table (yaw in degrees; the ferris wheel's 16 points from
  `getFerrisWheelPoints`, exact values), the models in two tables, `PROP_MODELS` (with
  `slideAngles`) before the platforms and `COURSE_MODELS` after (the body order), every GLB
  imported at once with `throwOnError` beside the sky boxes (imports create no entities; a
  missing model now fails the load instead of being skipped). Every id and appId kept, `scene`
  no longer passed to `createMovingPlatform`. The loader steps 0 → 4.
- **The sun and the stress test (section 2):** `followWithSun` and its `gymSunFollow` system are
  gone; the sun gets `SUN_SHADOW_FIT` on enter (`maxDistance: 36`, `casterExtension: 15`, both
  derived in the comment): the whole view is shadowed, in a ~±42 m box at 16:9 against the old
  fixed ±25 m (texels ~1.7× coarser). The rig takes `sceneId`, so the gym has no exit callback.
  `_dbg__PhysicsStressTest.ts`, `import()`ed behind `IS_DEBUG_ENV`: `getRandomStream('gym:stress')`,
  a uniform unit quaternion (Shoemake), its appId count restarted per visit. Re-recorded: the
  gym's system order (`APP_LOGIC` lost `gymSunFollow@0`) in all four configurations; the
  `mainThread` hash and paths unchanged and its snapshot within tolerance at step 120. Phase 3's
  P2 repros rerun and pass (`J` spawns nothing in `physicsTiers` after the gym, 50 in the gym).
- **`physicsTest`, `physicsTiers`, `topDownTestScene`, `space` (section 3):** `physicsTest`'s
  helpers at module level with an options object, the falling ball and box through them (ids,
  appIds, names and spins kept), a function per joint run from `JOINT_DEMOS`; the Hub's
  `dynamic-box` highlight `{20-24}` → `{16-20}` (still the `createPhysicsEntity` call).
  `physicsTiers`: named steps, the tint over parallel arrays, no casts, the id unexported, in
  `SIMULATION_FILES` (and the root `CLAUDE.md`'s list). `topDownTestScene`: one `between`, the
  rig's `sceneId` (no exit callback), the hills geometry by the `getGeometry` pattern,
  `existsOrThrow` for `getIndex()`. `space`: the spawn's seed from `getRandomStream('space:spawn')`,
  `spawnCount` reset per load, `SPACE_GRAVITY` unexported; `_dbg__spaceDemo.ts`' energy sum over
  the bodies it read only, its buttons' errors logged. The scene descriptions (P11's floating
  JSDoc) sit on `scene`. Every hash, snapshot and system order unchanged.
- **Comments and JSONs (section 4):** the citations gone but p428's (open, kept like p299's);
  the gym camera's and scene's descriptions rewritten ("legacy", "ported"), `physicsTest`'s
  "MVP" name and descriptions, the top-down and tiers scene descriptions' plan paths. Left: the
  top-down scene's `as StaticObstacleKind[]` (literal arrays, still checked) and `as Float32Array`
  (three's `TypedArray` narrowed).
- **Checks (section 5):** `yarn verify:scenes --only thirdPersonGymScene,topDownTestScene,
  physicsTest,physicsTiers,space` (the gym at 120 steps, 19 min): 20 passed, every hash, path,
  snapshot and system order as recorded (`physicsTest` `d5c1562a`, `physicsTiers` `49157b8f`,
  `topDownTestScene` `c7786d74`, the gym `a098ff98` / `492487c1`; `space`'s worker and main thread
  hashes differ as before). Then `probeSteps` back to 600. `yarn verify:baselines --update`:
  `bundle.json` only (`assets/thirdPersonGymScene.js` 4.0 → 3.6 kB gzip, the stress test folded
  out; `assets/physicsTest.js` 1.7 → 1.8 kB; the main chunk's `kernel/light` -0.1 kB, its
  `getLightTargetId` used by the gym's `followWithSun` only); `api.json` and `docs.json`
  unchanged, no debug code; `bundle.banner.json`'s 1-2 byte gzip drift not committed.
  `yarn hub:build`: 84 pages, 935 names, no warning; the `dynamic-box` include highlights the
  `createPhysicsEntity` call. `yarn test`: 1,223 passed.
- **For the next phases:** `largeWorld.ts`' compound-object comment now names
  `gymStairsAndWall.ts` (Phase 5 rewrites its comments). Phase 8's full run compares the gym
  against 120-step entries at 600 steps (the probe wait fails here anyway, D3); a faster machine
  records 600-step ones. `src/app/shared/` is used: Phase 7's root `CLAUDE.md` line. The
  engine-5 migration page's row for `characterTestObjects.ts` / `characterTestObstacles.ts`
  (`hub/pages/documentation/migration/engine-5.md:272`) still points at the gym's folder, where
  `gymStairsAndWall.ts` replaced both: Phase 7 rewords it.

### Phase 5: the world, LOD and test scenes, and D9 — done

Sections: 1. `scene01` (V2 merged in, the camera and lights moved into its folder, the debug suite
guide's path), `oneMoreScene` removed, `p341AlphaCutTest` removed (`yarn assets` prunes it); 2.
`sceneTestECS` rewritten as the first scene, `testDebugScene` trimmed (its camera and lights in its
JSON); 3. `largeWorld`'s split (`mergeIntoGeometry`, the tables), the shared rock (W5), the LOD
showcase (lane helpers, W6, W8's harness exports and `features/lod/CLAUDE.md`), `skyShowcase`'s
comment; 4. comments, logs, dead code and casts in these scenes and their JSONs (W8-W11, J4); 5.
checks.

- `yarn verify:scenes --only scene01,sceneTestECS,testDebugScene,largeWorld,lodShowcase,
  skyShowcase`: `scene01`, `sceneTestECS` and `testDebugScene` re-recorded (D9), the others
  unchanged (`lodShowcase` and `largeWorld`'s rock impostor fingerprint unchanged: no re-export).
  `scene01V2`'s and `oneMoreScene`'s baselines removed.
- `yarn verify:baselines --update`: the bundle loses `assets/scene01V2.js` and
  `assets/oneMoreScene.js`; nothing else moves.

As built (2026-10-22, sections 1-4 committed as `656ae9f`, `ca93a16`, `0523ca3`, `e54c2fc`; D2's
correction as `7e07d37`):

- **`scene01` (section 1):** V2 merged in, in named steps with module-level tables (every id,
  appId and the body order kept): the batch load now loads the three metal rust maps (the box's
  `box1Texture` among them) and counts each on the scene loader, with the sky boxes and the
  model (8 steps; the `llog`s and V2's 0 → 1 jump gone); the desert dunes are the scene's sky
  box, the other three created with `isDefault: false` (W11). **Beyond the plan:** the ball is a
  STANDARD `metalRustMaterial` with the batch's colour, AO and metalness maps (the batch's
  textures were only logged), and the sensor counts the bodies in it and turns the wireframe
  sphere green while there are any, instead of a `'SENSOR ALERT'` per contact. No `d` key; the
  input `CLAUDE.md`'s line no longer cites it. Its camera and lights moved into its folder
  (`src/app/cameras/` and `src/app/lights/` are gone), the debug suite guide's and
  `debug/DevFiles.ts`' `@example` path with them. The probe hash is `803f291b` in all three debug
  configurations: `scene01V2`'s (p614), so the merged scene simulates as V2 did; the snapshot is
  V2's but for the sphere's colour and the ball's material. `oneMoreScene`, `p341AlphaCutTest` and
  its PNG removed; `yarn assets` pruned the lock entry and the KTX2 output.
- **D2, corrected:** an engine patch in Phase 8 (`checkVersions` counts the `src/_engine/`
  `CLAUDE.md` files and the `DevFiles.ts` example).
- **The start scene (section 2):** the data-first counterpart of the quick-start example (which
  already makes a ground and a hovering cube in code): its JSON gives the camera, the lights
  (ambient and a new shadow-casting `directionalLight.light.json`), the sky box, the sphere with
  the app's TSL material and the imported box; `sceneTestECS.ts` (35 lines) adds the ground (a
  flat box) and the hover ball (appId `hoverBall`). Gone: the orthographic camera, the
  hemisphere, point and spot lights, the `'ui'` world, the K / L stress test, the commented-out
  code, `otherTestBox`, `testMaterial` (its JSON deleted). The scene's unstamped save entries are
  folded into the base values, the layout reset so everything stands on the ground (the sphere's
  radius 1, not the saved 2.6). `testTslMat.tsl.ts`: a summary, no `!`; its texture input keeps
  `.sample()` (the shim's typed `TextureNode.uv()` isn't there at runtime: the load failed).
  `testTexture`'s save entry stays Phase 6's (J2).
- **`testDebugScene` (section 2):** the LOD sphere and the hand-built cell gone (so W5's cell
  copy, and `shared/` needs no cell helper); its camera and lights in JSON (`p300Camera`,
  `p300Ambient`, `p300Sun` kept), a name and a description; the header on `scene`.
- **`largeWorld` (section 3):** `scene` is twelve named steps on a `WorldContext`, the props and
  resting objects module-level tables; `saveMergedGeometry` (the plan's `mergeIntoGeometry`,
  named like `saveBufferGeometry`) merges three's own geometries, never registered;
  `saveGeometryOnce` is D8's `getGeometry(id) ?? saveBufferGeometry(…)`. The comments and the
  scene's JSON say what the scene does (no "render-only for now", no "static until the crates get
  rigid bodies", the exports where they are, no citations); its name is "Large world".
- **The shared rock (W5):** `src/app/shared/largeWorldRock.ts` (geometry, material, hemi
  impostor), used by `largeWorld` and the rock lane. No stale-export warning in either scene.
- **The LOD showcase (sections 3-4):** the knot helpers in `lanes/showcaseKnot.ts`, the knot
  built only when not registered (W6); the dolly writes a scratch pose (W6); the harness exports
  gone, the dolly functions unexported; the tab's JSDoc and `features/lod/CLAUDE.md` say the stop
  and its side are persisted (and drop the "no-pop recorder" citation: no such code). The lanes
  are named by title (the numbers followed plan order), every plan citation gone, the casts in
  `handMadeLevels.ts` (narrowed by a check), `knotImpostor.ts` and `_dbg__lodShowcase.ts` gone.
- **`skyShowcase`:** the rows run north (-z) to south, right to left in the start view.
- **JSONs (section 4, J4):** the descriptions of `largeWorld`, its camera and sun, `lodShowcase`,
  its hand-made mesh and level geometries, `skyShowcase` and the shared `dayNight` sky box (its
  users are this phase's scenes and the sky box example). Left: the five impostor exports'
  "Written by the LOD tab's impostor Export (docs/plans/_DONE_p351… Phase 4)", which the engine's
  exporter writes (`features/lod/debug/_dbg__ImpostorExport.ts:143`).
- **Checks (section 5):** `yarn verify:scenes --only scene01,sceneTestECS,testDebugScene,
  largeWorld,lodShowcase,skyShowcase` (17 min): `largeWorld`, `lodShowcase` and `skyShowcase`
  passed in all four configurations; the others failed on exactly the expected diffs (`scene01`'s
  hash `7788c6ec` → `803f291b` and its snapshot, `sceneTestECS`' snapshot and system order (the
  `ui` world gone), `testDebugScene`'s snapshot), then `--update` recorded their 12 runs.
  `scene01V2`'s and `oneMoreScene`'s 8 entries and 6 snapshots removed from the local baseline by
  hand (the runner never prunes). `yarn verify:baselines --update`: `bundle.json` only
  (`assets/Foliage.js` → `assets/largeWorldRock.js`, the chunk `largeWorld` and `lodShowcase`
  share, +302 B for the shared module; `assets/scene01.js` 3.5 → 4.8 kB, `assets/sceneTestECS.js`
  1.9 → 0.6 kB, `scene01V2.js` and `oneMoreScene.js` gone; the main chunk −0.8 kB, the generated
  data's two scenes; `features/skybox` +214 B minified with no source change, Rollup's renaming);
  `api.json` and `docs.json` unchanged, no debug code; `bundle.banner.json`'s drift not committed.
  `yarn hub:build`: 84 pages, 935 names, no warning. `yarn test`: 1,223 passed.
- **For the next phases:** Phase 7 adds two issue files: the scene runner waits its 180 s
  timeout on a scene whose load failed (`loadScene` had resolved `false`: seen with the start
  scene's first try in section 2), and the impostor exporter's plan citation (an engine file).
  The root `CLAUDE.md`'s list of shared type folders loses `cameras/` and `lights/` (none left),
  and its toolkit line's "the bobbing ball" and `largeWorld.ts`' comment still hold. The LOD
  example page's "the export writes into `src/app/impostors/`" (U2) stands for the rock only.

### Phase 6: the examples, the root files and the verification scenes — done

Sections: 1. the examples (A2 in the `spin-system`, `banner-scene` regions and `exampleUiKit`, A3's
reason kept in a comment, A4, A5, A7's headers), the region line ranges the Hub includes checked;
2. the root files (A1 done, A6); 3. the verification scenes (`verifyHarness.ts` in `shared/`, V3's
splits, V4's headers and labels, `assetCompare`'s LS key and report cache, D10); 4. the asset JSONs
(J2, J4); 5. checks.

- `yarn verify:scenes --only` the examples, `banner`'s embed (`yarn verify:embed`) and the three
  verification scenes: unchanged.
- `yarn hub:build`: every include resolves, the Hub's example images unchanged (no visual change).

As built (2026-10-22, sections 1-4 committed as `0094ea4`, `6dc5c8e`, `5349b99`, `b9f2b21`):

- **The examples (section 1):** A2: `SpinSystem.ts`, `banner.ts` and `exampleUiKit.ts` copy the
  `getRotation` quaternion into a scratch one (the spin system and the banner pass one hoisted
  `{ rot }` patch; `setTransform` copies it). `banner-scene` now starts above the constants, so the
  Hub shows the scratch objects its looper uses. A4: `exampleSkyBox`'s looper compares the minute,
  state and speed and builds the HUD text only on a change; `exampleCharacter`'s level starts
  every create and awaits them together (`createRamp`, `createStairs`; each create sends its body
  before its first await, so the body order and the hash stay). **Beyond the plan:** the
  character's rig takes the scene's `sceneId` (no exit callback, as the gym's since Phase 4). A3:
  `exampleUiKit` says in a comment why registering the kind per visit is safe. A5 / D8:
  `exampleLod`, `banner` and `exampleHubHero` use `getGeometry(id) ?? saveBufferGeometry(…)`;
  `existsOrThrow` for the LOD levels and the knot's bounds; the colour set behind an
  `instanceof THREE.MeshStandardMaterial` check (`exampleUiKit`, `exampleDebugTab`). A7: the spin
  files' headers say why they stay in `examples/ecs/` (two scenes use them, not three). The
  `(string)` param notes and a cast in `_dbg__exampleHub.ts` and `exampleHud.ts` gone. The Hub's
  character, sky box and LOD walkthroughs follow the changed regions (no highlighted range in any
  example include). Left: `examplePhysics.ts`' `dropped.shift()!` (behind its length check), the
  UI kit's `data?.shapeId as ShapeId` (untyped window data).
- **The root files (section 2):** `index.ts`: the shadow map types as a comment, the loader's
  "Loading…" on `#101218` (no `text: ''`, no `'blue'`), comments saying what each step does.
  `CONFIG.ts`: `debugKeys: []` with a rebind example in the comment (the `h` entry was the
  default), no `debugDrawer` block, no citation. `AppECSRegistry.ts`: `HEALTH` commented as the
  template's example key. **For Phase 7:** `readme.md:409` shows the old `debugKeys` entry, and the
  root `CLAUDE.md`'s Debug system line says `h` is "bound in `src/CONFIG.ts`" (it's the engine's
  default).
- **The verification scenes (section 3):** `src/app/shared/verifyHarness.ts` (the TSL shim's
  `sampleTexture` / `meshUv`, `nextFrames`, `expectError` / `expectSyncError`, `getErrorMessage`,
  `getBackendName` on `isWebGPURenderer`, `getCountedGpuBytes`, `getGeneratedTextureProps`,
  `projectToScreen`, the console handles), with `verifyHarness.test.ts` (D13). `assetCompare`'s
  `buildSlot` is `buildSlotAsync` over `loadSlotTextureAsync`, `buildGround`, `buildSphere` and
  `buildPropAsync` (ids, appIds and order kept; the ground by the `getGeometry` pattern, so no
  "registered already" warning); `PHASE1_URL` is `VARIANTS_URL` (the path stays). Its debug
  module is four: `_dbg__assetCompare.ts` (the tab and slot rows, 246 lines),
  `_dbg__assetCompareReport.ts` (report.json, refetched after a failed load), `…Colliders.ts`
  (the check, its loop split; **beyond the plan:** it stops and releases its import when the scene
  is left) and `…Measure.ts`. The LS key is `AEK_debugAssetCompare` (the old key and its `UI` key
  moved once). The header, the scene JSON and the "DD6" label (now "Copies vs source") say what
  they do; p303's citation stays (open). The texture scenes' headers say `window.__…` is read by
  hand and what the runner checks; p351's citations (done) rewritten, p299's stay.
- **The asset JSONs (section 4):** `testTexture` without `useHDRLoader` and its save entry (a
  no-op that warned in every other scene); the banner's and `p299TestAtlasImage`'s citations gone.
  The impostor exports' p351 text stays (the engine's exporter writes it: Phase 7's issue file).
- **Checks (section 5):** `yarn verify:scenes --only 'example*,banner,assetCompare,textureArrays,
  textureAtlases'` (18 min, WebGL2): 56 passed, every hash, snapshot and system order as recorded
  (`exampleCharacter` included). `yarn verify:embed`: all passed (INLINE, BACKGROUND, the Hub's
  example page). `yarn verify:baselines --update`: within tolerance, no debug code; `bundle.json`
  and `bundle.banner.json` recorded for this phase's byte changes (the examples' chunks:
  `banner` +28 B, `exampleLod` +76, `exampleSkyBox` +55, `exampleHubHero` -44; the main chunk -39);
  `api.json` and `docs.json` unchanged. `yarn hub:build`: 84 pages, 935 names, only p621's
  warning. `yarn test`: 1,227 passed (the Stop hook's run beside `hub:build` failed
  `buildGuard.test.ts`, the clash §3 warns of; alone it passes).

### Phase 7: the Hub, `CLAUDE.md` and the filed findings (D14) — done

1. The toolkit page (U1, a section per piece, "Writing a TSL material"), the example pages (U2,
   U3), the debug suite guide (Phase 5's path), the root `CLAUDE.md`'s toolkit and app lines,
   `features/lod/CLAUDE.md`; `readme.md` where it lists the toolkit or the app's scenes.
2. The issue files N1, N2, N4 (N3 linked from p619's remark, an issue file if it has none); p622's
   toolkit 3.0.0 list (`PhysicsParams`, `DeleteMeshOptions`, `addGravityBody`'s positional
   `world`, the component key enums, `createSeededRandom`'s re-export already there).
3. `perf-auditor` over the changed toolkit and app files; anything it finds fixed or listed.
4. `yarn hub:build` (no dead link, the one p621 warning).

As built (2026-10-22, sections 1-2 committed as `2eac899`, `1bd9e6e`; section 3 changed no code):

- **The toolkit page (section 1):** U1's errors fixed (`SeededRandom.ts` out of the tree and
  `createSeededRandom` the engine's, the effects as systems registered once per world with
  `MutualGravity`'s body list, scatter results into an instanced pool's `spawn` first); a short
  section per piece with its `api:` links and what U1 found missing (the triplanar defines, the
  asteroid's per-mesh `seed`, `hullVertices` / `hullVolume`, the rig's `sceneId`, the platform's
  controls writing outside the step, `getHeightAt`, `heights` against the `HEIGHTFIELD` collider);
  a "Writing a TSL material" section (the checkerboard's JSON and TSL file included whole, so no
  region; the socket call, the input wrapping, the `<socket>_<input>` uniforms and the socket
  order, defines against `matOverrides` variants, `loadTslMaterialFileAsync`, the `Node` types,
  copying one into the app). **Beyond the plan:** "See it" names `largeWorld` and the gym.
- **The other pages (section 1):** U2: the embed walkthrough's rewrap, the LOD walkthrough's "move
  the four files next to the scene", the quick start's line on the debug-only `_dbg__exampleHub`
  import (the banner's "every frame" was Phase 6's). The engine-5 migration row names
  `_dbg__PhysicsStressTest.ts` and `gymStairsAndWall.ts` (Prettier re-padded its table). The
  scenes-and-assets page's layout: `cameras/` and `lights/` among the folders that appear with
  the first shared asset. The debug suite guide's path and `features/lod/CLAUDE.md` were Phase 5's.
- **`CLAUDE.md` and `readme.md` (section 1):** the root's effects line (three components,
  `MutualGravity`'s body list), the `createSeededRandom` line (the toolkit's deprecated copy),
  `shared/`'s contents and why the spin files stay in `examples/ecs/`, the shared asset folders,
  and the `h` key as the engine's default rebound in `debugKeys` (Phase 6's note). The readme:
  the geometry line, the folder tree (no "a seeded random", no `cameras/, lights/`), the mesh JSON
  example under `myScene/` (the start scene's mesh has another material), `debugKeys` as a rebind
  to `j`.
- **Issue files (section 2):** N1 `create-with-a-taken-id-ignores-props.md`, N2
  `no-public-instanced-mesh-entity.md`, N3 `entity-persistent-flag-not-applied.md` (p619 had none:
  its S8 remark now names the file; it also says why the one-line fix leaks a camera per visit),
  N4 `heightfield-grid-layout.md` (also: the type's "`nrows` × `ncols`" against the import's
  (`nrows` + 1) × (`ncols` + 1), and the import's indexing met only square grids; the toolkit
  page's terrain line links it), and Phase 5's two: `scene-runner-waits-on-a-failed-load.md` and
  `impostor-export-plan-citation.md` (eight files: four impostor JSONs and their atlases).
- **p622 (section 2):** the toolkit 3.0.0 list: `createSeededRandom`'s copy, `PhysicsParams`,
  `DeleteMeshOptions` / `deleteMeshOptions` removed; `addGravityBody`'s positional `world` to an
  options object; the component key `enum`s against `as const` objects left to decide with the
  engine's `ComponentType` (also an enum).
- **`perf-auditor` (section 3)** over the 66 toolkit and app `.ts` files the branch changed: every
  shipping per-frame and per-step path clean (the earlier phases' fixes confirmed). Two low,
  debug-only remarks, left as they are: `_dbg__lodShowcase.ts`' dolly resolves the camera by appId
  each frame it plays (one map lookup and one storage read, no allocation; caching it would add a
  stale-id case on a reload), and `_dbg__spaceDemo.ts`' energy sum is O(n²) every 250 ms over the
  scene's 8-17 bodies.
- **Checks (section 4):** `yarn hub:build` on `1bd9e6e`: 90 pages (the six issue pages added), 935
  names, only p621's `getRandomStream` warning.

### Phase 8: verify, versions and done (D2)

1. `yarn verify:scenes` (every scene, against Phase 0's baselines and the phases' re-records),
   `yarn verify:baselines`, `yarn verify:embed`, `yarn build`, `yarn hub:build`.
2. `package.json` (D2), the `CHANGELOG.md` entry (D3's behaviour changes, the deprecations, the
   removed scenes), `yarn checkVersions --against main`.
3. Mark the plan done; p621's `Blocked by` (this plan only, so it goes), p622's toolkit list, p600's
   references.

As built (2026-10-23, on `ae32894`):

- **Checks (section 1):** `yarn verify:scenes`, every scene (64 min, WebGL2 on SwiftShader): 97
  passed, 3 failed; every hash, character path, snapshot and system order as Phase 0 and the
  phases' re-records left them (`space`'s worker targets differ as before, its `unstableHash`).
  The three failures are the gym's debug configurations, the probe's 600-step wait (303-310 s),
  this machine's (D3); its `prodTest` passed (errors, system order). So the gym's hash, paths and
  snapshot were last compared in Phase 4, at 120 steps (`a098ff98` / `492487c1`): the PR says so.
  `yarn verify:baselines`: all unchanged (`api.json` 2,497 exports, 933 on the 16 entries;
  `docs.json` 2,401 / 2,401 and 1,043 / 1,043; the main chunk 389.4 kB gzip), no debug code in
  either build. `yarn verify:embed`: all passed. `yarn build` (both `tsc`, the build, `yarn sbp
  --profile all`: the app 379.8 kB initial, the banner 285.5 kB, every budget within; the Hub):
  passed. `yarn hub:build`: 90 pages, 935 names, only p621's warning. `yarn test`: 1,227 passed.
- **Versions and changelog (section 2):** engine 5.10.0 → 5.10.1 (D2's correction: the docs in
  `src/_engine/`), toolkit 2.1.3 → 2.2.0, app 1.13.2 → 1.14.0, the project version the engine's;
  no codename changes. The `CHANGELOG.md` entry (2026-10-23) has Engine, Toolkit, App and Project
  sections: the behaviour changes (D3), the deprecations, the removed scenes, the fixes.
  `yarn checkVersions --against main` passes; `yarn hub:build` shows the entry on the homepage.

## 4. Risks

1. **The gym on this machine** (D3): none of its debug configurations reaches the probe's step in
   time (`MAIN_THREAD` included), so its hashes, paths and snapshot are never compared here. Its
   errors and system order are the checks; a gym change that only a hash or the snapshot would
   catch goes unseen until a faster run. Phases 1 and 4 keep the gym's simulation code paths as
   they are (read, D3), and the PR says the gym's hash wasn't compared.
2. **Splits that move creation order.** A body created earlier changes the hashes. Each split runs
   its scene alone before anything else changes in it (Phases 4, 5).
3. **Removing scenes** (D9) drops their baselines and bundle chunks: the diffs are named in the
   phase, and the changelog lists the scenes.
4. **The toolkit's renames** keep the old names deprecated, so an app on Toolkit 2.x compiles; the
   removals are p622's.
5. **Hub regions** (U3): a moved line inside a region shifts a highlighted range (`{20-24}`), which
   `hub:build` doesn't catch. Each changed region's rendering is checked in the phase.

## Done when

- Every file in scope reviewed against p600 §5, the findings fixed or filed (`docs/issues/` or a
  plan item).
- JSDoc coverage of the toolkit's public exports at 100 % (`docs.json`), members included; the
  ratchet raised. `yarn hub:build` with no leaked type left (p621 checks for no warnings).
- `yarn test`, `yarn verify:scenes` (snapshots and hashes unchanged unless stated, D3),
  `yarn verify:baselines` (no unexplained growth), `yarn build`, `yarn hub:build`. The verify
  commands run for minutes to hours: when one starts, give the watch command,
  `tail -f .cache/verify/progress.log`.
- The Hub pages of the toolkit and the examples checked against the code; the nested `CLAUDE.md`
  files current.
