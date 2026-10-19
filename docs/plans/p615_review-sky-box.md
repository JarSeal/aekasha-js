Status: in progress | Phases 0-3 implemented
Category: Refactoring, Documentation, Sky box
Epic: p600_whole-codebase-refactoring-and-documentation.md (Stage C)
Blocks: p621_hub-docs-readme-and-claude-md-final.md
Related: \_DONE_p613_review-rendering-scene-assets.md (Phase 5's `toSkyColor` input, §1.2), \_DONE_p614_review-physics.md (D6's `onUnmount`, which the sky box gets too: F1), p622_engine-6-major.md (what waits for the major: D3), `docs/issues/lodshowcase-sky-snapshot-drift.md` (the clouds' clock: D5), p990_follow-ups-from-done-plans.md (its "Sky box" items stay there: out of scope)

# Review: Sky Box

Applies p600 §5 (the per-file review standard) and p605's JSDoc style to every file in scope,
records the findings per file group, and fixes them or files them. It also fixes two activation
bugs, puts the preset helper code is told to use on the entry, reads the sky's colours the way
the kernel does (p613's input), gives `skyBox()` a stop for `unmount()`, and moves the clouds off
three's wall clock (the snapshot drift issue).

## 1. As found (2026-10-18, branch `review-skybox` at `698b502`, = `main` after p614's merge, Engine 5.5.0)

### 1.1 The stub's names, checked

The stub was written before p608's move (and p605's ratchet, which changed the counts).

| Stub | Now |
| --- | --- |
| `SkyBox/` (10 files) | `features/skybox/`: 12 modules (`SkyBox.ts` 771 lines, `SkyLights.ts` 580, `SkyBoxSchema.ts` 579, `SkyComposite.ts` 405, `SkyTime.ts` 303, `SkyEnvironment.ts` 197, `SkyStaticLayers.ts` 196, `LegacySkyBox.ts` 159, `Presets.ts` 150, `SkyBoxTypes.ts` 95, `SkyBoxFeature.ts` 64, `SkyColor.ts` 7), the entry `index.ts`, `SkyTime.test.ts` and the nested `CLAUDE.md` |
| `SkyBox/layers/` (8; 47 of 79 exports documented) | `features/skybox/layers/`: the same 8 (85-324 lines each), still **47 / 79** |
| its debug folders (17 files) | `features/skybox/debug/`: **18** `_dbg__` modules, 2,981 lines; `_dbg__SkyBoxShared.ts` is 850 (G1) |
| "the folder's nested `CLAUDE.md` (the sky box section, moved there verbatim by `_DONE_p605`)" | `features/skybox/CLAUDE.md`, one `## Sky box` section (§1.4 K) |

Every file is under the 800-line limit but `_dbg__SkyBoxShared.ts`; Phase 0 checks the functions against the 150-line one.

In scope (D1): `features/skybox/` with its `layers/` and `debug/` (the debug modules for
structure and docs only: p800 rewrites the panels), and its `CLAUDE.md`. Outside it, only what a
change here breaks: the debug modules that import the feature's internals (`debug/_dbg__EnvBall.ts`,
`debug/gpuMemory/_dbg__GPUMemorySources.ts`, `debug/_dbg__TestBridge.ts`), the schemas entry, and
the Hub's two sky box pages.

### 1.2 The stub's inputs, checked

- **The three r186 traps** the nested `CLAUDE.md` lists: a TSL `If` mustn't be the first to build
  a shared node (`layers/Stars.ts`); a render target sampled before its first render gets its GPU
  texture destroyed in place (`SkyEnvironment.ts`' `initEnvBakeTarget`, `SkyStaticLayers.ts`'
  `initTarget`, `SkyLights.ts`' first shadow map); a `castShadow` toggled back on in place crashes
  with PostFX (`SkyLights.ts`' header). Plus two direction traps written as comments: the
  background looks up `normalWorldGeometry`, not `normalWorld`, and PMREMNode applies
  `environmentRotation` only to materials without an `envMap` (`layers/Base.ts`). Each is a
  comment at its code; none is a `@remarks` yet (Phase 4).
- **p613's `toSkyColor`** (`SkyColor.ts`, 17 callers, as the stub says): a `'#rrggbb'` string goes
  through `THREE.Color`'s sRGB → linear conversion, a `{ r, g, b }` (0-255) is taken as linear,
  so the two forms of one colour render differently. The kernel's `toThreeColor`
  (`kernel/render/ThreeMath.ts:143`) reads both as sRGB. **All 7 sky box JSONs write strings**, so
  moving to it changes no scene. The debug tab's colour pickers: `_dbg__SkyBoxShared.ts:429`'s
  `toHex` is `toSkyColor(value).getHexString()`, which converts back to sRGB, so a `{ r, g, b }`
  value shows a different hex than its JSON gives; the pickers write strings, so nothing they
  store changes. C5.
- **`docs/issues/lodshowcase-sky-snapshot-drift.md`** (not in the stub): five scenes' snapshots
  drift in the clouds, because `layers/Clouds.ts`' `VIEW` clouds read three's `time` node (the
  renderer's wall clock), and the env bake's frozen clouds read its private
  `_nodes.nodeFrame.time` (`SkyBox.ts:755`, `getFrameTime`). It's the sky box's own clock. D5.
- **p614 D6** gave `FeatureContext` an `onUnmount`; `skyBox()` has none (F1).
- **p990's "Sky box" items** (the day sky's tuning, three upgrades, the deferred epic ideas, a lit
  env ball) are features or look changes, not review findings: they stay in p990.

### 1.3 Documentation (the ratchet's `docs.json`)

| Folder | Exports documented | Undocumented |
| --- | ---: | --- |
| `features/skybox` | 149 / 173 | `LEGACY_SKYBOX_WARNING`; `SKYBOX_PRESETS`, `SKYBOX_PRESET_NAMES`, `SkyBoxPresetName`, `isSkyBoxPresetName`; `SkyBoxChangeReason`, `isDayNightPlaying`, `registerSkyBoxDebugGUI`; `SkyBoxBaseType`; `StaticLayersUniforms`, `createSkyUniforms`, `getMoonCount`, `isAtmosphereEnabled`, `isGroundEnabled`, `isMilkyWayEnabled`, `isStarsEnabled`; `_setEnvBakeHooks`, `isEnvBakeRequested`; `SUN_LIGHT_DEFAULTS`, `MOON_LIGHT_DEFAULTS`, `AMBIENT_LIGHT_DEFAULTS`; `_setStaticLayersBakeHooks`; `DAY_NIGHT_DEFAULTS`, `createSkyTimeState` |
| `features/skybox/layers` | 47 / 79 | each layer's `*_DEFAULTS`, `*Uniforms` type and `create*Uniforms`, four `*_STRUCTURAL_KEYS` (C2), `BaseLayer`, `ENV_DEFAULTS`, `MOON_TEXTURE_DEFAULTS`, `atmosphereParts`, `applyCloudsUniforms`, `applyGroundUniforms` |

56 exports; the ratchet counts no members here. The `_dbg__` modules are outside TypeDoc: 10 of
their exports have no comment (`BakeStats`, `createBakeStats`, `hasNoEntries`, `SKYBOX_TAB_ID`,
`LIST_MAX`, `getSelectedIndex`, `getSkyBoxOverrides`, `skyBoxProxy`, `NO_SKYBOX_ID`,
`syncSkyBoxProxy`; G2). The schema's Zod shapes are documented on most keys, not all (P3).

### 1.4 Findings by file group

Numbered for the phases. **(bug)** marks wrong behaviour, **(perf)** per-frame cost; the rest are
hygiene, placement and API shape. Read from the code, not reproduced, unless a finding says so.

**State and API (`SkyBox.ts`)**

- S1 **(bug)** An `updateSkyBox` made while a structural one is loading its texture is lost.
  The structural update calls `activate` (`:490`), which awaits the textures and then shows a new
  `ActiveSkyBox` built from the definition it was given and fresh uniforms (`:360-369`). Until it
  does, `active` is still the old one, so a second `updateSkyBox` merges into the old definition
  and writes the old uniforms (`:467`, `:493`): both are dropped when the activation lands. The
  debug tab can do it (a base file change, then a slider before the file has loaded). The JSDoc
  says nothing about overlapping calls (the coding standard asks it to).
- S2 **(bug, debug env)** A sky box texture that fails to load fails the scene load in the debug
  env only. `layers/Base.ts:80` / `:103` and `layers/Moon.ts:170` pass `throwOnError: IS_DEBUG_ENV`,
  so `loadBaseTexture` / `loadMoonTexture` reject, `activate` rejects, and with it the `created`
  scene hook (`SkyBoxFeature.ts:34`), which `loadScene` treats as a failed load (p613 D3). In
  production `loadTextureAsync` returns its placeholder and the sky shows black. `setActiveSkyBox`
  and `createSkyBox` reject the same way.
- S3 Placement and API: `resolveSkyBoxPreset` (the typed helper: `Presets.ts:149`) isn't on the
  entry, while the entry exports `mergeSkyBoxPreset`, whose own JSDoc says code uses
  `resolveSkyBoxPreset`. `registerSkyBox`' warning (`:183`), `SkyBoxTypes.ts:86` and the nested
  `CLAUDE.md` send app code to it, and the lint forbids the deep import, so an app can't put a
  preset under a code sky box. `SkyBoxPresetDef`, `SkyBoxPresetName` and `SKYBOX_PRESET_NAMES`
  aren't on the entry either. `SkyBox.ts:78-83` and `:139` re-export the presets and
  `SKYBOX_MANAGER_ID`, so each has two paths.
- S4 API shape: the public `SkyBoxChangeListener` takes an `ActiveSkyBox` (not on the entry), which
  carries the internals: `uniforms: SkyUniforms`, the nodes, the textures, `time: SkyTimeState`.
  `SkyBoxChangeReason` is exported, undocumented and not on the entry. `SkyBoxUpdate` names
  `SkyBoxOverrides` and `SkyBoxEnvDef`, and `SkyBoxDef` the layer types, none on the entry (Phase 0
  lists `yarn hub:build`'s `notExported` warnings for the folder). The template's one listener
  (`largeWorld.ts:594`) reads neither argument.
- S5 API shape: `setActiveSkyBox(id, sceneId?)`, `registerSkyBox(def, sceneId?)`,
  `getSunDirection(out, i = 0)`, `getMoonDirection(out, i = 0)`, `getSunElevation(i = 0)` and
  `getMoonPhase(i = 0)` take optional positional parameters (the standard asks for an options
  object). Changing them is breaking (D3).
- S6 Exports that aren't on the entry and aren't `@internal`: `registerSkyBox`,
  `getSceneDefaultSkyBoxId`, `activateSceneDefaultSkyBox`, `getActiveSkyBox`, `clearSkyBox`,
  `getActiveSkyBoxTexture`, `getActiveEnvironmentTexture`, `registerSkyBoxDebugGUI`,
  `createSkyBoxDebugGUI`, `ActiveSkyBox`. Their users are the feature, its debug tab, the env
  ball, GPU memory and the test bridge. Undocumented: `isDayNightPlaying`, `SkyBoxChangeReason`,
  `registerSkyBoxDebugGUI` (§1.3).
- S7 Stale: `layers/base.ts` (`:254`), `SkyBox/presets.ts` (`SkyBoxTypes.ts:86`),
  `SkyBox/SkyBoxTypes.ts` (`SkyBoxSchema.ts:506`), `layers/sun.ts`, `layers/moon.ts`,
  `layers/stars.ts` in the layers' comments (the files are PascalCase since p608);
  `activateSceneDefaultSkyBox` "called by the scene loader" (the feature's `created` hook is).
- S8 `getFrameTime` (`:755`) reads the renderer's private `_nodes.nodeFrame.time` through an
  `unknown` cast: it goes with D5.

**Composite and layers (`SkyComposite.ts`, `layers/`)**

- C1 **(perf)** `applySkyTimeUniforms` runs every frame while the cycle plays and says it
  allocates nothing, but (Phase 0's `perf-auditor`, corrected and completed):
  - `getSunAtmosphere` (`SkyComposite.ts:278`, called at `:315`) makes a `{ u, def }` object every
    moved frame with an atmosphere: the one allocation every day-night sky pays.
  - `hasStaticLayers` (`:320`, reached only with the stars off: `isStarsEnabled(def) ||` comes
    first) makes two or three arrays through `getEnabledNebulae` (`layers/Nebula.ts:131`) to
    compare a length with 0.
- C1b **(perf, CPU)** Redundant work on the same path, every moved frame: each extra sun with
  `rotateWithSky` computes the start time's sky rotation again (`turnWithSky`, `SkyTime.ts:296`:
  two `computeSkyRotation` per sun, the `from` one never changes); sun 0's extinction is computed
  twice (`applyAtmosphereSunUniforms`' `extinctionAtSun` and `applySunLightingUniforms`); and
  every frame, sky still or not, each disc light calls `getActiveCamera()?.getWorldPosition(p)`
  (`SkyLights.ts:343`), which updates the camera's world matrix up its parents, once per light (up
  to 6) and against the function's own comment ("the camera's world matrix is last frame's").
  Smaller, left as they are: array destructuring and `for…of` on hot paths (V8 optimises them),
  unchanged intensity writes, `applyMoonPosition` for an absent moon, the trig of `SkyTime.ts`'
  getters per call. No redundant GPU state change; bakes run once per request.
- C2 Dead code: `SUN_STRUCTURAL_KEYS`, `GROUND_STRUCTURAL_KEYS`, `ATMOSPHERE_STRUCTURAL_KEYS`,
  `CLOUDS_STRUCTURAL_KEYS` have no reader (only `BASE_STRUCTURAL_KEYS` is read, by `SkyBox.ts`).
- C3 `layers/Nebula.ts:134`'s `seededRandom` is `createSeededRandom` (`utils/SeededRandom.ts`,
  p610) line for line: the same numbers, so using it changes no nebula.
- C4 The layers are internal (nothing on the entry), and 32 of their exports are undocumented
  (§1.3). Their defaults repeat the schema's "Default …" comments; the schema is what an author
  reads, the constants are what the code reads, and both stay (the debug tab shows the constants).
- C5 The colour conversion (§1.2): `toSkyColor` should read both forms as sRGB, as
  `toThreeColor` does. It's on the activation and update paths only (it allocates a `THREE.Color` per call), never per
  frame: checked at its 17 callers.

**Bakes (`SkyEnvironment.ts`, `SkyStaticLayers.ts`)**

- B1 Activation before the renderer has initialized skips `initEnvBakeTarget` / `initTarget`
  (`hasInitialized()`), so the destroyed-texture trap would come back, and `setEnvBake` creates its
  `PMREMGenerator` with `getRenderer() as THREE.Renderer` even when it's `undefined`. The boot
  creates the renderer before the first scene loads, so no path is known to hit it: Phase 0
  checks (a `createSkyBox` in `start` before `createRenderer`, a mount).
- B2 Undocumented: `_setEnvBakeHooks`, `_setStaticLayersBakeHooks` (debug hooks, `@internal`),
  `isEnvBakeRequested`.
- B3 Otherwise clean: new targets cleared on allocation, a bake scene disposed with its one node
  (three r186's `Background.js` ties its mesh's disposal to the first node a scene is given, so a
  bake scene is never given a second: checked), one long-lived generator per size, the texture
  PMREMs disposed with their source.

**Lights (`SkyLights.ts`)**

- L1 `SUN_LIGHT_DEFAULTS`, `MOON_LIGHT_DEFAULTS`, `AMBIENT_LIGHT_DEFAULTS` undocumented;
  `getSkyLightIds` says "(debug and tests)", but it's on the entry and the Hub tells apps to use it
  (largeWorld does). Otherwise clean: the per-frame path allocates nothing, the light is read from
  `OBJECT3D` every time, an entity deleted from outside is created again.

**Time (`SkyTime.ts`, `SkyTime.test.ts`)**

- T1 Clean and tested. `DAY_NIGHT_DEFAULTS` and `createSkyTimeState` undocumented; `layers/moon.ts`
  in two comments (S7).

**Presets, legacy, schema and types (`Presets.ts`, `LegacySkyBox.ts`, `SkyBoxSchema.ts`, `SkyBoxTypes.ts`)**

- P1 S3's entry gap.
- P2 Undocumented: §1.3's preset and legacy names, `SkyBoxBaseType`.
- P3 The Zod rule (each shape key documented): undocumented keys are `id`, `env`, `atmosphere`,
  `stars`, `ambientLight`, `ground`, `debugData` and the meta keys of `SkyBoxDefSchema`; `type`,
  `color`, `file`, `path`, `textureId`, `intensity` of the base shapes; `backgroundIntensity`,
  `environmentIntensity`; `zenithTint`; `shadowBias`, `shadowNormalBias`; the moon texture's
  `file`, `path`, `textureId`; and the type `SkyBoxAsset`.
- P4 The pre-3.0 legacy shape (`{ type, params }`, `LegacySkyBox.ts`, `createSkyBox`'s second
  form, the schema's preprocess) has no `@deprecated` and no removal version. Nothing in the
  template uses it (no JSON, no `createSkyBox` call). D3.

**The feature and the entry (`SkyBoxFeature.ts`, `index.ts`)**

- F1 `skyBox()` has no `onUnmount` (p614 D6): `unmount()` leaves the env bake's target and
  generator, the nebula cube, the sky lights' state and the listeners; `deleteRenderer()` runs
  right after the features' stops, so the GPU side goes with the device, and the module state is
  what's left (`docs/issues/remount-after-unmount.md` lists the sky box among it).
- F2 The entry: S3's additions; otherwise every name on it is used and documented.

**The debug tab (`debug/`, structure and docs only)**

- G1 `_dbg__SkyBoxShared.ts` is 850 lines: overrides and the proxy (`:192-520`), then undo / redo,
  "Apply preset" and the pre-p111 migration (`:522-850`). Split in two along that line, moved
  as is.
- G2 10 exports without a comment (§1.3).
- G3 C5's `toHex`, fixed with it.
- G4 Otherwise clean: no `any`, no `eslint-disable`, no TODO; it imports the feature's modules and
  the debugger framework only.

**The nested `CLAUDE.md` (K)**

- K1 The `skyBox()` feature is described twice (its first bullet, and again in the second's
  middle).
- K2 `resolveSkyBoxPreset` "for code definitions" (S3: not reachable from the entry today).
- K3 It says the clouds and the time stop as described; D5 changes the clouds' clock, F1 adds the
  stop.

## 2. Decisions (confirmed 2026-10-18, as recommended)

### D1. Scope: §1.1's files

`features/skybox/` with `layers/`, `debug/` (structure and docs: G1, G2, G3) and `CLAUDE.md`;
outside it, only the imports a change breaks and the Hub's sky box pages.

### D2. Versions

Engine **minor** (5.5.0 → 5.6.0): new names on the entry (S3, S4's type), the stop (F1), the
fixes (S1, S2), the clouds' clock (D5, a behaviour change: they stop with the loop), the
deprecations (D3). Toolkit: no change expected. App **patch** only if an app file changes. Project
= engine.

### D3. What waits for engine 6.0.0 (p622)

- The legacy `{ type, params }` shape (P4): `@deprecated` now, removed in engine 6.0.0 with
  `LegacySkyBox.ts`, `createSkyBox`'s legacy form and the schema's conversion. The save data's
  pre-p111 migration (`fromLegacySkyBoxOverrides`, the debug tab's one-time key migration) goes
  with it. **Recommended:** deprecate (nothing uses it, and 6.0.0 is a breaking major already).
- S5's positional parameters: listed in p622 as candidates, not changed in a minor (as p614 did
  with `createPhysicsEntity`). An index parameter (`i`) is common enough that p622 decides.

### D4. Two bugs fixed first, each with a test where it runs in Node

- **S1:** activations and updates run one after another: an `updateSkyBox` made while an
  activation is in flight waits for it, then applies to what it showed (or drops itself if that
  is another sky box, as today's id check does). The JSDoc says which call wins.
- **S2:** the sky box loads its textures without throwing, in every env: a failed texture is
  logged (and in the debug env shown as a toast), and the sky shows its black base, as production
  does today. A scene load never fails on a sky texture.

### D5. The clouds run on the engine's clock

The clouds' drift (and the env bake's frozen clouds) read a `time` uniform of the sky box's,
advanced in `skyBoxSystem` by `getElapsedTime()`'s change, like the day-night step: it stands
still while the master loop is paused, in editor views and during a scene load. `getFrameTime`
and its private-field read go (S8). It's a visible change only in that paused clouds stop.
Phase 0 measures whether that alone makes the five scenes of the drift issue snapshot-stable
across runs; if it doesn't (the elapsed time at the snapshot varies with the page's load), the
test bridge gets a debug hook to set it before a snapshot. The issue is closed in Phase 6.

**Added in Phase 0** (the test clock, below): the sky box's own schedules read the same clock.
`scheduleDayNightBake`'s rate limit and the nebula bake's 150 ms throttle use `performance.now()`
today, so how many bakes run before a snapshot, and when (the env bake freezes its clouds and the
sun's place at that moment), depends on how fast the page ran, even under the test clock. They
move to the main loop's elapsed time, which is real time in an app and frame-counted under
`setFixedFrameDelta`. A bake's CPU timing for the debug stats keeps `performance.now()` (it's a
measurement, read only with the hooks set).

**Alternative:** keep three's `time` and only pin three's node frame time in the runner. That
leaves the clouds running while the game is paused, which the root `CLAUDE.md`'s Views section
lists as a known gap.

### D6. Colours: one reading (C5)

`toSkyColor` keeps its name and callers and reads both forms as sRGB (`toThreeColor`), so the
debug pickers show what the JSON says. No template scene changes (§1.2): the scene baselines
must not move.

### D7. The public API

- **On the entry** (S3): `resolveSkyBoxPreset`, `SKYBOX_PRESET_NAMES`, `SkyBoxPresetDef`,
  `SkyBoxPresetName`. `mergeSkyBoxPreset` stays on it (the gatherer's untyped form; documented
  as such) but its JSDoc points at the new one. `SkyBox.ts`' re-exports go: one path per name.
- **The listener's type** (S4): a public `SkyBoxState` (`Readonly<{ id, sceneId, def }>`) on the
  entry; `SkyBoxChangeListener` takes it, and `SkyBoxChangeReason` goes on the entry documented.
  `ActiveSkyBox` (the internals) is `@internal`. Every `ActiveSkyBox` is a `SkyBoxState`, so no
  caller breaks. The layer types `SkyBoxDef` names go on the entry if Phase 0's `notExported`
  list names them.
- **`@internal`** (S6): everything exported and not on the entry, with a summary saying who uses
  it.

### D8. `skyBox()` gets a stop (F1)

`ctx.onUnmount(clearSkyBox)` plus the listener set cleared: the bakes disposed, the lights
deleted, the scene properties reset, before `deleteRenderer()`. The Hub's SBP page and the mount
JSDoc say which features stop.

### D9. Documentation

§1.3's 56 exports to 100 %, the schema's keys (P3), the debug tab's 10 (G2), the five traps of §1.2
as `@remarks` on the functions that guard them (`setEnvBake`, `setStaticLayers`, the disc light's
create, `buildBaseLayer`, `starsNode`), stale names fixed (S7).

### D10. Tests

`SkyTime.test.ts` stays. New, in Node: `toSkyColor` (both forms equal; C5), the presets
(`resolveSkyBoxPreset` against each template, arrays and `base` replaced), the composite
signature and `needsRebuild`'s cases, and S1 / S2 through `SkyBox.ts` with a stub root scene and
texture loader if its imports allow it in Node (else the test bridge in the scene runner).

### D11. No example scene

A review plan adds no feature to show. The sky box feature and example pages are checked against
the code (Phase 6).

## 3. Phases

Each phase leaves the tree green: `yarn test`, the lint and `tsc` (the Stop hook), and the phase's
own checks. `yarn verify:scenes` runs at the end of Phases 1, 2 and 4 and in Phase 7 (snapshots
and hashes unchanged unless a phase says otherwise; no file is edited while it runs). Each phase
ends with its "As built" list, its files' JSDoc at 100 % and `docs.json` updated
(`yarn verify:baselines --docs --update`).

### Phase 0: baselines and measurements — done

1. `yarn verify:scenes --update` on this commit (= `main`), then `yarn verify:baselines` clean.
2. `perf-auditor` over `features/skybox/`: confirm or add to C1. The functions over 150 lines, if any.
3. `yarn hub:build`: the folder's `notExported` warnings (S4's list for D7).
4. Reproduce S1 (the debug tab: a base file change, then a slider) and S2 (a missing base file
   with `?isDebug=true`); check B1's paths (a sky box before `createRenderer`, a mount).
5. D5's measurement: run the drift issue's five scenes twice, minutes apart, and record what
   moves.
6. Record the numbers here and confirm D1-D11.

As built (2026-10-18, at `698b502` plus this plan; macOS, headless Chromium, WebGPU):

- **D1-D11 confirmed** as recommended (2026-10-18), before Phase 0.
- **Baselines:** `yarn verify:scenes --update` recorded 104 runs (26 scenes × 4 configurations) in
  407 s, without errors outside the allowed ones. `yarn verify:baselines`: all unchanged, no debug
  code in either build (`docs.json` 2,062 / 2,382 exports, 890 / 968 members).
- **The perf audit (step 2)** is §1.4's C1 (corrected: `hasStaticLayers` runs only with the stars
  off; `getSunAtmosphere`'s object added) and C1b (new). No function in scope is over 150 lines
  (the longest: `starGrid` ~67, `nebulaNode` ~57, `updateSkyBox` ~51), so G1 is the only size item.
  The module-level allocations are scratch vectors, default objects and TSL `Fn` nodes, none a
  registration.
- **`yarn hub:build` (step 3):** 419 pages, 16 warnings, **none in the sky box**. TypeDoc documents
  every engine module, not only the entry, so `ActiveSkyBox` and the layer types count as included:
  D7's "the layer types `SkyBoxDef` names go on the entry if Phase 0's list names them" adds
  nothing. S4 stays an entry-shape item (an app can't name `ActiveSkyBox`).
- **Repro (step 4):** `features/skybox/SkyBox.test.ts` drives `SkyBox.ts` in Node (a plain root
  scene, a fixed current scene id, the texture loads as promises the test settles, a default ECS
  world for the lights). Two `it.fails`, each failing on its own assertion when run as `it`: S1
  (`backgroundIntensity` is `undefined`, not 0.5, after the structural activation lands) and S2
  (the activation rejects with the load's error). `yarn test`: 622 passed, 2 expected fails, 1
  skipped.
- **B1 (step 4):** no path. `src/index.ts`' `start` and `mountAekasha` both await
  `createRenderer` (`renderer.init()`) before their first `loadScene`; an app that loads a scene
  before creating its renderer has no canvas to show it on. Phase 4 states it as a `@remarks` on
  the activation instead of guarding it.
- **The drift (step 5):** the five scenes passed twice, 3 and 6 minutes after recording (20 / 20
  each, snapshots within tolerance: at most 13 levels on a pixel, 0.00 % changed). The drift
  isn't reproducible minutes apart. Two things learned:
  - The test bridge already pins three's `time` to a frame-counted clock
    (`_dbg__TestBridge.ts:98-110`, `NodeFrame.prototype.update` replaced), so the VIEW clouds
    aren't on the wall clock under the runner.
  - What still reads the wall clock is the sky box's bake schedule (`performance.now()` in
    `scheduleDayNightBake` and the nebula throttle), and `space`, which has no clouds but has the
    throttled nebula bake, shows the same small noise. So D5 now covers the schedules too (D5's
    "Added in Phase 0"). Phase 2 runs the five scenes before and after, with an hour or more
    between the recording and a run.

### Phase 1: the bugs (D4) and the stop (D8) — done

1. S1 and S2, each with its test (D10).
2. F1: `skyBox()`'s `onUnmount`; `yarn verify:embed`.
3. C1 (`getSunAtmosphere`'s object kept on the uniforms; `hasStaticLayers` a loop), C1b (the
   start-time rotation kept per activation, sun 0 reusing `extinctionAtSun`, the camera position
   read once per frame from its `matrixWorld`), and B1 if Phase 0 found a path.
4. `yarn verify:scenes`: unchanged.

As built, section 1 (2026-10-18): S1 and S2.

- **S1:** `SkyBox.ts` keeps the latest activation in flight (`activate` wraps `loadAndShow`, the
  former body). `updateSkyBox` made meanwhile is queued by sky box id, its changes `deepMerge`d in
  call order (a drag is one update), and applied when that activation has shown, through the
  ordinary path (`applyUpdate`, the former body): a structural one among them starts another
  activation, and the ones after it queue again. A superseded activation leaves the queue to the
  later one; an update for a sky box no longer active resolves with the active one and changes
  nothing (as the id check did). The structural call resolves with what its own activation
  showed. The JSDoc says which call wins.
- **S2:** `layers/Base.ts`' `loadSkyTextureAsync` loads with `throwOnError: true` in every env
  and turns a failure into `null` with a promise `catch` (not a `try`: the debug toast's gate
  would keep it in the bundle), and `reportSkyTextureFailure` logs it once more with what the sky
  shows instead (and a debug toast). The base shows black, a moon a plain disc. Production
  behaves the same as before on screen (its placeholder was image-less, so black too) but no
  longer holds an unregistered placeholder texture. The cube loader had no null check: it has
  one now.
- **Tests:** `SkyBox.test.ts`' two `it.fails` are `it`, plus the queue's call order (a drag
  merged, the later value winning, every caller settled) and an update dropped for a sky box
  replaced meanwhile. `yarn test`: 626 passed, 1 skipped.

As built, section 2 (2026-10-18): the stop (F1, D8).

- `SkyBox.ts`' `stopSkyBox` (`@internal`): the updates waiting for an activation are taken off
  the queue, `clearSkyBox` runs (the in-flight activation is superseded by its sequence number,
  the bakes disposed, the lights deleted, the root scene's background, environment and their
  intensities reset, and the listeners told `'clear'` one last time), the listener set is
  cleared, and the queued callers settle with `null`. `skyBox()` registers it with
  `ctx.onUnmount`; `teardown` runs the features' stops before `deleteRenderer()`, so the sky box
  disposes its targets while the renderer and the ECS world still exist. The registry and the
  definitions stay: nothing mounts again in the page load.
- `Mount.ts`' JSDoc (the handle's `unmount`, `mountAekasha`'s `@remarks`) and `teardown`'s comment
  name the sky box next to physics. The Hub pages (the embed walkthrough's `unmount()` line, the
  sky box guide) are Phase 6's.
- **Test:** `SkyBox.test.ts`' `stopSkyBox, for unmount()` (the sky box cleared, a waiting update and
  a pending activation settled with `null`, the listener told and then dropped). `yarn test`: 627
  passed, 1 skipped.
- **`yarn verify:embed`:** passed (the banner: `INLINE` and `BACKGROUND`, each then unmounted, and
  the Hub's example page). The only embed profile has no features, so it doesn't exercise the sky
  box's stop: the Node test does.

As built, section 3 (2026-10-18): C1, C1b, and the scenes.

- **C1:** `SkyUniforms.sunAtmosphere`, one `{ u, def }` per activation that `getSunAtmosphere`
  writes `def` into, so the day-night step makes no object. `hasStaticLayers` is
  `layers/Nebula.ts`' new `hasEnabledNebula` (an indexed loop; `getEnabledNebulae`' cap at
  `MAX_NEBULAE` never decided "any").
- **C1b:**
  - Sun 0 reads the atmosphere's `extinctionAtSun` and `sunE` instead of computing them again:
    `applySunUniforms` and `applySunLightingUniforms` take `isPrimary` (the same inputs, so the
    same values to the bit).
  - `turnWithSky` keeps its two rotations (`SkyTime.ts`' `SkyRotationCache`), keyed by the
    day-night definition object and the time: the start time's is computed once per definition,
    now's once per frame for all extra suns (was two per sun). Definitions are never changed in
    place, which the cache's comment says. A test checks the turns against uncached ones over
    changing definitions and times.
  - `updateSkyLightsFrame` reads the active camera's position once per frame from its
    `matrixWorld` (the last render's), not once per light through `getWorldPosition` (which
    updated the matrix up its parents every time), and walks the lights with indexed loops.
  - Left as the audit found them (listed in C1b): the destructuring, the unchanged intensity
    writes, `applyMoonPosition` without a moon, `SkyTime.ts`' getter trig.
- B1: no path (Phase 0); its `@remarks` is Phase 4's.
- **Checks:** `yarn test` 628 passed, 1 skipped; `tsc` and the lint clean. `yarn verify:scenes`:
  104 passed in 409 s, every probe hash unchanged, snapshots within the tolerance with Phase 0's
  noise (at most 9 levels on a pixel, 0.00 % changed).

### Phase 2: colours and the clouds' clock (D5, D6) — done

1. C5 / G3 with its test.
2. D5: the sky box's time uniform, the bake's frozen clouds from it, `getFrameTime` removed, and
   the bake schedules (`scheduleDayNightBake`, the nebula throttle) on the main loop's elapsed
   time.
3. `yarn verify:scenes`: hashes unchanged; snapshots of the scenes with clouds may move once
   (recorded again with the reason), then stay put across two runs.

As built, section 0 (2026-10-18, before any Phase 2 change): the drift "before" run. The five
scenes against the 15:21 baselines at 16:31 (70 minutes): 20 passed, snapshots within the
tolerance (at most 3 levels on a pixel, 0.00 % changed). The issue's drift (0.12 % of the pixels)
didn't reproduce an hour on either.

As built, section 1 (2026-10-18): the colours (C5, G3, D6).

- `SkyColor.ts`' `toSkyColor` takes a `ColorJSON` and is `new THREE.Color(toThreeColor(color))`:
  `{ r, g, b }` is sRGB like a `'#rrggbb'`, and still a new linear Color per call (activation
  and updates only). Its 17 callers are unchanged. `@internal`.
- The debug tab's `toHex` (`_dbg__SkyBoxShared.ts`) types its value as `ColorJSON`; a
  `{ r, g, b }` now shows its own hex in a picker.
- Nothing writes the object form (no sky box JSON, preset, default or debug value: checked), so
  no scene changes.
- **Test:** `SkyColor.test.ts` (each form of three colours equal, and back to the same hex; mid
  grey linear).

As built, section 2 (2026-10-18): the sky clock (D5, S8).

- `SkyBox.ts`' `skyClockSec`: `skyBoxSystem` computes the elapsed time's change once per frame
  (it was `stepDayNight`'s, which now takes it), adds it to the clock unless a scene is loading,
  and writes it to the clouds' new `time` uniform every frame (`layers/Clouds.ts`; the VIEW
  clouds read it instead of three's `time` node, and `bakeTime` is set from it before an env
  bake). The clock lives in the module, not the uniforms, so a rebuild or a structural update
  doesn't make the clouds jump; `clearSkyBox` (a scene's exit) restarts it at 0, so a scene's
  clouds start from the same place on every visit. `getFrameTime` and its read of the renderer's
  private `_nodes.nodeFrame.time` are gone (S8), and with them `SkyBox.ts`' import of the
  renderer.
- The bake schedules: `scheduleDayNightBake`'s rate limit (`lastBakeTimeSec`) and
  `SkyStaticLayers.ts`' 150 ms throttle read `getElapsedTime()` (monotonic, never reset: a reset
  clock would block a re-bake). The two bakes' debug CPU timing keeps `performance.now()`, read
  only while the stats' hooks are set.
- The stars' twinkle stays on three's `time` (ambient; the test clock pins it): the test bridge's
  comment says which of the two clocks covers what.
- **Test:** `SkyBox.test.ts`' "the sky clock" drives the system the feature installs, with the
  elapsed time and the loading flag mocked: the clouds' time follows the elapsed time, stands
  still while loading, survives a rebuild, and restarts after a clear. `yarn test`: 633 passed,
  1 skipped.

As built, section 3 (2026-10-18): the scenes.

- `yarn verify:scenes`: 92 passed, 12 failed. The 12 are the snapshots of the four scenes with
  clouds (`exampleLod`, `exampleSkyBox`, `lodShowcase`, `skyShowcase`) in the three debug
  configurations: 0.00-1.49 % of the pixels, at most 179 levels, every probe hash unchanged. The
  diffs are the clouds and their reflections in mirror balls (the env bake's frozen clouds),
  nothing else: the clouds now start from 0 per scene (D5). `exampleHubHero` and `space` (no
  clouds) passed.
- Recorded again: `yarn verify:scenes --update --only exampleLod,exampleSkyBox,lodShowcase,skyShowcase`
  (16 runs). Right after, the six sky scenes (those four, `exampleHubHero`, `space`): 24 passed,
  most identical to the baseline, the rest within the tolerance (at most 13 levels, 0.00 %).
- The check an hour or more later is Phase 4's `yarn verify:scenes` (it runs against these
  baselines); the drift issue is closed in Phase 6 if it holds.
- The scene runner's baselines are local: the changelog says to record these four scenes again on
  `main` after the merge (Phase 7).

### Phase 3: the API (D7) and the deprecations (D3) — done

1. The entry's additions, `SkyBoxState`, the re-exports removed, `@internal` on S6's names.
2. `@deprecated` on the legacy shape; p622's list.
3. JSDoc of `SkyBox.ts`, `SkyBoxFeature.ts`, `Presets.ts`, `LegacySkyBox.ts`, `SkyBoxTypes.ts`,
   `SkyBoxSchema.ts` (P3), and S7's stale names. **And `SkyBox.ts` split** (decided 2026-10-18,
   below): the day-night API, its bake schedule, the sky clock and `skyBoxSystem` move into a
   module of their own, importing from `SkyBox.ts` one way (`clearSkyBox`'s clock reset through a
   small hook, not an import back).
4. `yarn hub:build`: no `notExported` left in the folder.

As built, section 1 (2026-10-18): the entry, `SkyBoxState`, `@internal`.

- **Found:** `SkyBox.ts` was 843 lines when Phase 3 started (771 at Phase 0: Phase 1's queue and
  stop, Phase 2's clock), over the 800-line limit, and section 1 took it to 890. Decided: split it
  in section 3 (step 3 above), not a header note.
- The entry adds `resolveSkyBoxPreset`, `SKYBOX_PRESET_NAMES`, `SkyBoxPresetDef`,
  `SkyBoxPresetName`, `SkyBoxChangeReason` and `SkyBoxState`. `resolveSkyBoxPreset` has an
  `@example` and `@throws`; `mergeSkyBoxPreset` says it's the untyped form (schema, gatherer) and
  links the typed one.
- `SkyBoxState` = `Readonly<{ id, sceneId, def }>`. **Beyond D7's letter:** besides the listener,
  `setActiveSkyBox`, `createSkyBox` and `updateSkyBox` return `Promise<SkyBoxState | null>` (they
  returned `ActiveSkyBox`, the same leak). `ActiveSkyBox` is `@internal`.
- `SkyBox.ts`' re-exports (the presets, `SkyBoxDef`, `SKYBOX_MANAGER_ID`) are gone;
  `_dbg__SkyBox.ts` imports `SKYBOX_MANAGER_ID` from `SkyLights.ts`.
- `@internal`, each with who uses it: `registerSkyBox`, `getSceneDefaultSkyBoxId`,
  `activateSceneDefaultSkyBox` (its stale "called by the scene loader" fixed, S7),
  `getActiveSkyBox`, `clearSkyBox`, `getActiveSkyBoxTexture`, `getActiveEnvironmentTexture`,
  `registerSkyBoxDebugGUI`, `createSkyBoxDebugGUI`. `registerSkyBox`'s preset warning names the
  entry. Left for section 3: the non-entry names of `Presets.ts` and `SkyBoxTypes.ts`,
  `isDayNightPlaying`'s comment.

As built, section 2 (2026-10-18): the legacy shape deprecated (D3).

- `LegacySkyBox.ts`: the header says the module goes in 6.0.0 and with what; `@deprecated`
  ("removed in engine 6.0.0") on `LegacySkyBoxParams`, `LegacySkyBoxProps`,
  `LEGACY_SKYBOX_WARNING`, `isLegacySkyBoxProps`, and (also `@internal`) `fromLegacySkyBoxProps`,
  `fromLegacySkyBoxOverrides`. `LEGACY_SKYBOX_WARNING`'s text named "p111 migration notes", which
  no longer exist: it now says the shape is deprecated, removed in engine 6.0.0, and to write a
  layered definition (base, env).
- `createSkyBox` is two `export function` overloads (as `getGeometry`): the `SkyBoxDef` one, and
  the `LegacySkyBoxProps` one `@deprecated`, so a legacy call is struck through in the editor.
  A caller passing the union type would no longer compile (none does).
- The schema's two conversions, the gatherer's `warnOnLegacySkyBox` and the debug tab's
  `migrateLegacySkyBoxLS` say they go in 6.0.0 (so p622's `grep 6\.0\.0` finds them).
- p622: the sky box under "Every `@deprecated` that names engine 6.0.0", and a "From p615" list
  (the legacy shape's parts; S5's positional parameters as candidates).
- `yarn test` 633 passed, 1 skipped; `tsc` and the lint clean; the docs ratchet: skybox 156 / 175.

As built, section 3 (2026-10-18): the split, the JSDoc, S7.

- **The split:** `SkyDayNight.ts` (279 lines) holds the day-night API (`setTimeOfDay` …
  `getMoonPhase`), the env bake schedule, the sky clock, `stepDayNight`, `installSkyBoxSystem` and
  `skyBoxSystem`, moved as they were except that they read the active sky box through
  `getActiveSkyBox()` (once per frame in the system, passed to `stepDayNight` and `noteEnvBake`).
  `SkyBox.ts` (729 lines with this section's JSDoc) imports nothing from it: `clearSkyBox` runs a
  hook (`_setSkyBoxClearHook`, `@internal`) that `installSkyBoxSystem` sets to restart the clock.
  `isBakeDynamic` is exported `@internal` for the schedule. The entry, `SkyBoxFeature.ts`, the
  test, `_dbg__DayNightFolder.ts`, `_dbg__SkyBoxShared.ts` and `_dbg__TestBridge.ts` import from
  the new module; the comments that named `SkyBox.ts` for it (`SkyTime.ts`, `layers/Clouds.ts`, the
  nested `CLAUDE.md`'s "all in `SkyBox.ts`") name `SkyDayNight.ts`. The rest of the nested
  `CLAUDE.md` is Phase 6's.
- **JSDoc:** `@example`s (type-checked) on `createSkyBox`, `updateSkyBox`, `onSkyBoxChange`,
  `setTimeOfDay`, `getSunDirection` and `SkyBoxDef`, as p614 did for its main entry calls, not every
  function. `setActiveSkyBox` gets `@param`s and its failure cases (S2's black base; an unknown id
  warns), `updateSkyBox` its three costs as a list, `onSkyBoxChange` when a listener in scene code
  hears its own scene's sky box, `isDayNightPlaying` that playing isn't moving. `SkyBoxState`'s,
  `ActiveSkyBox`'s and `SkyBoxUpdate`'s members are documented. `skyBox()` names its unmount stop.
- `@internal` with who uses them: `Presets.ts`' `SkyBoxPreset`, `SKYBOX_PRESETS`,
  `isSkyBoxPresetName`; `SkyBoxTypes.ts`' `SkyBoxBaseType`, `SkyBoxEnvSize`, `SkyBoxNebulaSize`,
  `SkyTimeSource`. The types `SkyBoxDef` names stay public.
- **P3:** every shape key in `SkyBoxSchema.ts` has a comment (the base types', `file` / `path` /
  `textureId` from the loaders: `file` loads relative to `path`, default `./`, and registers under
  `textureId`; without `file`, `textureId` names a registered texture), the meta keys included
  (no other schema documents them yet), and `SkyBoxAsset`.
- **S7:** `layers/base.ts`, `sun.ts`, `moon.ts`, `stars.ts` → PascalCase in six files;
  `SkyBox/presets.ts`, `SkyBox/SkyBoxTypes.ts` gone with their comments' rewrites.
- `{@link resolveSkyBoxPreset}` from `SkyBox.ts` and `SkyBoxTypes.ts` linked nowhere (TypeDoc
  resolves a link by what the module has in scope; a type-only import for it is a lint warning):
  written in backticks there. Within `Presets.ts` the links resolve.
- **Checks:** `yarn test` 633 passed, 1 skipped; `tsc`, `tsc -p hub` and the lint clean.
  `docs.json` recorded: skybox 162 / 177 (the 15 left are Phase 4's files), layers 50 / 82
  (Phase 2's clouds `time` uniform, recorded now).

As built, section 4: `yarn hub:build` passed, 420 pages, 16 warnings (Phase 0's count), none in
the sky box: no `notExported`, no dead link.

### Phase 4: the internals

(Its `yarn verify:scenes` runs more than an hour after Phase 2's recording: it's D5's late check
of the six sky scenes too.)

1. `SkyComposite.ts`, `SkyEnvironment.ts`, `SkyStaticLayers.ts`, `SkyLights.ts`, `SkyTime.ts` and
   `layers/`: C2 (removed), C3, C4, B2, L1, T1, the `@remarks` (D9).
2. D10's remaining tests (the presets, the signature).
3. `yarn verify:scenes`: unchanged.

As built, section 1 (2026-10-19): the internals' code and JSDoc.

- **`@internal` throughout** (the coding standard, as Phase 3 did for `Presets.ts` and
  `SkyBoxTypes.ts`): every export of `SkyComposite.ts`, `SkyEnvironment.ts`, `SkyStaticLayers.ts`,
  `SkyTime.ts`, `SkyLights.ts` (but `getSkyLightIds`) and `layers/` has a summary and `@internal`;
  each module's header says who uses it (the sky box, its debug tab; the env ball for `Base.ts`,
  GPU memory for the two bakes). Nothing outside `features/skybox/` and those two debug modules
  imports them (checked).
- **C2:** the four unread `*_STRUCTURAL_KEYS` removed (`Sun.ts`, `Ground.ts`, `Atmosphere.ts`,
  `Clouds.ts`); `BASE_STRUCTURAL_KEYS` stays (SkyBox.ts' update reads it).
- **C3:** `layers/Nebula.ts` draws its offsets from `createSeededRandom` (its own mulberry32 copy
  removed, the same numbers).
- **C4:** the layers' 28 remaining undocumented exports documented: the defaults say the schema's
  "Default …" comments match and the debug tab shows them (both stay, as C4 says), the uniform
  types and creators what writes their real values.
- **B2:** `_setEnvBakeHooks` / `_setStaticLayersBakeHooks` (the bake stats set them when their
  debug module loads; without hooks a bake reads no wall clock), `isEnvBakeRequested`.
- **L1:** the three light defaults documented; `getSkyLightIds` is public: its summary says what
  it returns and to read it in an `onSkyBoxChange` listener, with a type-checked `@example`
  (largeWorld's use). It was "(debug and tests)".
- **T1:** `DAY_NIGHT_DEFAULTS`, `createSkyTimeState` and the rest of `SkyTime.ts` (`@returns` where
  a function returns its `out`). S7's `layers/moon.ts` there was already fixed in Phase 3.
- **D9's `@remarks`**, from the comments that held them (each comment at the code shortened to
  point at it, or kept where it explains a line):
  - `setEnvBake`: the destroyed-texture trap (`initEnvBakeTarget`), and **B1** (activated before
    `createRenderer` resolves, the clear is skipped and the generator gets no renderer; no path
    does, so it isn't guarded). Put here, not on `setActiveSkyBox`: the public call has no path
    that hits it, so its JSDoc would only warn about the boot's own order.
  - `setStaticLayers`: the same trap (`initTarget`), pointing at `setEnvBake`'s.
  - The disc light's create: on `syncSkyLights` (exported; `createDiscLight` isn't): the first
    shadow map render, and a `castShadow` change re-creating the light (the PostFX crash).
  - `buildBaseLayer`: `normalWorldGeometry` (not `normalWorld`), and PMREMNode's
    `environmentRotation` skipping materials without an `envMap`.
  - `starsNode`: the TSL `If` that mustn't build a shared node first.
- Hygiene: comment lines over 100 columns reflowed (left over from earlier phases' renames);
  `Moon.ts`' import that sat after its re-export moved above it.
- **Checks:** `yarn test` 633 passed, 1 skipped; `tsc` and the lint clean. `docs.json` recorded:
  skybox 177 / 177, layers 78 / 78 (4 fewer: C2). `api.json` still lists C2's constants and
  Phase 3's removed re-exports: Phase 7's `yarn verify:baselines --update` records them.

As built, section 2 (2026-10-19): D10's remaining tests (with Phase 1's S1 / S2 and Phase 2's
`toSkyColor`, D10 is complete).

- `Presets.test.ts` (10): each template through `resolveSkyBoxPreset` (the template with the id,
  no `preset` key), a definition without a preset as it is, a layer merged key by key, the arrays
  (`suns`, `moons`) and `base` replacing the template's, no result sharing the template (a
  changed result leaves the next one and `SKYBOX_PRESETS` as they were), an unknown name throwing
  with the list, and `resolveSkyBoxPreset` equal to `mergeSkyBoxPreset`.
- `SkyComposite.test.ts` (36): `getCompositeSignature` stays the same for 11 value changes (the
  base, positions, a light's values, a nebula's values but its octaves, day-night, the env values)
  and changes with 16 structural ones (each layer, sun, moon, light, moon texture and nebula
  added or turned off, a nebula's octaves, the cube size); suns and moons past MAX_SUNS /
  MAX_MOONS don't count; clouds without an atmosphere and the cube size without nebulae are left
  out. `hasProceduralLayer`: false for a base alone and with every layer off (day-night isn't
  one), true with each layer.
- `SkyBox.test.ts`' "updateSkyBox: new nodes or uniform writes" (13): `needsRebuild` is private,
  so the cases run through `updateSkyBox` with a colour base and check whether the root scene's
  `backgroundNode` was replaced and the activation's uniforms kept. Uniform writes for 5 value
  changes (a blur staying above 0 among them); new nodes, the uniforms kept, for 7 (direct to
  composite and back, a layer, a sun, `env.size`, day-night's own 128 default size, the blur
  leaving 0). Checked that the 7 fail with `needsRebuild` forced to false.
- `yarn test` 692 passed, 1 skipped; `tsc` and the lint clean.

### Phase 5: the debug tab (G1, G2)

1. `_dbg__SkyBoxShared.ts` split, moved as is; its importers updated.
2. G2's comments.
3. The tab checked by hand on `skyShowcase` (a param, undo / redo, a list edit, "Apply preset").

### Phase 6: the Hub, CLAUDE.md, readme, and what's filed

1. The sky box feature and example pages against the code (the preset helper, the stop, the
   clouds' clock, the API links); `yarn hub:build`.
2. The nested `CLAUDE.md` (K1-K3, D5, D8); the root's map line if it changes; `readme.md` if a
   listed API changed.
3. p622's sky box items; the drift issue closed (or updated, if D5's runner hook was needed).

### Phase 7: versions and done

1. D2's bumps, a `CHANGELOG.md` entry (D5's paused clouds and D8 called out),
   `yarn checkVersions --against main`.
2. `yarn test`, `yarn verify:scenes`, `yarn verify:baselines` (no unexplained growth), `yarn build`
   (the SBP budgets), `yarn hub:build`.
3. Mark the plan done (`docs/plans/CLAUDE.md`); time for a PR: `review-skybox` into `main`.

## 4. Risks

1. **D5 and the scene runner.** If the elapsed time at the snapshot varies between runs, the
   clouds still drift: Phase 0 measures it before Phase 2 commits to the hook.
2. **D7's narrowed listener type.** An app reading `uniforms` or `time` from the listener's
   argument stops compiling; the template has no such reader, and `ActiveSkyBox` stays reachable
   through `@internal` for the debug tools.
3. **S1's queue.** A debug-tab drag issues an update per frame: queued behind an activation, they
   must coalesce (the latest wins), not replay one by one.

## Done when

- Every file in scope reviewed against p600 §5, the findings fixed or filed (`docs/issues/` or a plan item).
- JSDoc coverage of the scope's public exports at 100% (p601's `docs.json`), members included; the ratchet raised.
- `yarn test`, `yarn verify:scenes` (snapshots and hashes unchanged unless stated), `yarn verify:baselines` (no unexplained growth), `yarn build`, `yarn hub:build`. The verify commands run for minutes to hours: when one starts, give the watch command, `tail -f .cache/verify/progress.log`.
- The Hub pages of the features in scope checked against the code; CLAUDE.md's nested files for them current.
