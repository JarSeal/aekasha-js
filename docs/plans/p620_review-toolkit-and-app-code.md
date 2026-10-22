Status: draft | decisions to confirm — not-implemented
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
| "`scene_thirdPersonGym.ts`'s ~544-line `scene` function split" | `scenes/thirdPersonGymScene/thirdPersonGymScene.ts` (799 lines): `scene` is 544 lines at `:256`. Seven more functions are over 150 lines (§1.4 Z). |
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
    ("the physics probe didn't reach step 600 in 300 s") in p619's Phases 0, 7 and 8, with no
    system order baseline. Every change to the gym is checked by its `MAIN_THREAD` hash and
    snapshot only where that run passes, or on a faster machine (D3).
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
- C7 **(bug, small)** An empty `physicsParams` array throws a `TypeError`; `speedMultiplier: 0`
  writes `Infinity` / `NaN` velocities; the input `rigidBody.userData` is overwritten in the
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
  (`largeWorld` scatters 1,500, 2,000 and 300 points), with two vector clones, a quaternion and an
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
- W2 **(bug)** `scene01` and `scene01V2` create assets with the same ids and other props (`ground`
  BASIC vs LAMBERT, `sphere1Material`, `box1`, `box1Texture`, `cylinder01Material`,
  `importedBox01Material`). `createMaterial` returns a registered id and ignores the props, and the
  previous scene's assets are released after the next one loads, so a switch between them renders
  the second with the first's materials.
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
  the runner's `allowedErrors` don't cover.
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

## 2. Decisions (to confirm)

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
  300 s (§1.2). The gym's checks are its `MAIN_THREAD` run where it passes, and the snapshot. A
  failure of the probe wait alone is this machine's, as in p619.

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
- **Small app bugs:** A1, P4, W2 (the merge or prefixed ids, D9), W4 (the flag goes).

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
  `scene01Sun` move into its folder (one scene left). Fixes W1-W3 and W2's ids.
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
  seed (the test pins them).
- `perf-auditor` reran on the changed files in the last code phase.

## 3. Phases

Written after the decisions above are confirmed. Branch `review-toolkit-and-app-code` from `main`
(`1964613`).

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
