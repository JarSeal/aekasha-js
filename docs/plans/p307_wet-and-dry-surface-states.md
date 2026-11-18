Status: in progress | Phases 1-4 implemented
Category: Materials, Terrain, Weather
Blocks: p310_terrain-preview-scenes.md
Epic: p301_terrain-texturing-epic.md
Related: p427_weather-and-mood.md (its weather state drives this plan's surface conditions), p990_follow-ups-from-done-plans.md (precipitation, clouds, a weather driver, SSR)

# Wet & Dry Surface States

This plan has two halves:

- **A study** of how wet and dry surfaces can be rendered in a real-time WebGPU forward renderer. What each technique costs and what it looks like.
- **An implementation** of the chosen techniques:
  - a global, engine-level **surface conditions** state (wetness, rain, puddle level, water level, snow coverage);
  - a toolkit **wet response** node used by the terrain material generator (p305), structure materials, scatter (p308) and decals (p309).

This plan doesn't add a weather system, rain particles or audio. The surface-conditions state is the part of a future weather system that materials read: p427 (weather and mood, a stub) drives this state rather than replacing it, and p990 keeps precipitation, volumetric clouds and a weather driver open. Visual weather may run at frame time; anything that changes gameplay (wet friction, T14) would run on the step clock and the seeded streams (p603 C7, the root `CLAUDE.md`'s Physics rules).

---

## Context (grounded)

- **No weather, rain, wetness or puddle concept exists** in `src` (p301 survey).
- **No global shared-uniform registry exists.** Sky uniforms are created per activation (`createSkyUniforms`, `src/_engine/features/skybox/CLAUDE.md`), so a material that binds them goes stale when a sky box re-activates. Surface conditions therefore need **stable uniform nodes created once**, which materials bind at build time.
- **Sky box API** (`aekasha/skybox`, the day-night getters in `features/skybox/SkyDayNight.ts`):
  - `getSunElevation(opts?)` (radians, `null` without an active sky box or past its suns; `opts.index` picks the sun, p622 D6), `getSunDirection(out, opts?)`, `getTimeOfDay`, `isDayNightPlaying`;
  - the time advances in `skyBoxSystem` (MAIN, order 1) by `getElapsedTime()` deltas per `dayNight.timeSource` (default `APP`: stops with the app loop; `MAIN`, `MANUAL`), and stands still while a scene loads;
  - the sky clock (p615 D5, `skyClockSec`) is the model for a visual clock: held in the module (so a rebuild doesn't jump it), advanced unless a scene loads, restarted on the scene's exit, never three's `time` node (a snapshot would differ per run);
  - `onSkyBoxChange` reports activations and updates; there are no day-night events (`onSunrise`, p990), so drying follows the sun by polling the getter.
  - p427 may move the time-of-day clock out of the sky box into its world state; the sun factor below reads it through one provider, so only that line changes.
- **Engine layout:** new engine state that only some apps use is an opt-in feature (`src/_engine/kernel/init/CLAUDE.md`, Engine features): it reaches the kernel through its `FeatureContext` (`registerPlugin`, `addSceneHooks`, `onDebug`), and the only feature → feature runtime import today is character → physics, so it can't call the sky box's getters itself.
- **Environment reflections:** both the background and the environment sample one PMREM (`features/skybox/SkyEnvironment.ts`). With day-night on, the environment re-bakes every ~1° of sun movement or 1/s at most.
- **No SSR** (p990: "More PostFX passes … SSR"). Puddle reflections are environment reflections only. Outdoors, under the sky, that's the dominant term; reflections of nearby objects are missing. three r187 made its `SSRNode` addon more usable (#35238-#35243: the full GGX lobe, material F0 and F90, validated ray bounds and refined hits), so the p990 SSR pass is a more realistic follow-up for puddles than when this was written.
- **`aoNode`** affects indirect light only.
- **The GTAO pass** multiplies the final colour (p301 survey). Wet darkening and AO stack multiplicatively; that's fine.
- **p305** didn't reserve `wet` after all: `createTerrainMaterial` rejects it (`TerrainMaterial.test.ts`: `has no field "wet"`) and there's no `WETNESS` debug view, so Phase 2 adds both. Layers have `surface.porosity`, `wetDarkening` and `wetRoughness` from their texture set (p303 D1).
- **p304** (done, `docs/plans/_DONE_p304_procedural-texture-baker.md` Phase 5) provides `rippleAtlas` and `macroNoise` (`aekasha/toolkit/terrain`; baked with `bakeRippleAtlas` / `bakeMacroNoise`, or the committed KTX2 textures `rippleAtlas` and `macroNoise`). The atlas (256², 4 × 4 cells, linear RGBA8) isn't a ring at a moment: per texel RG is the direction away from its cell's drop, B the falloff from the drop to the ring's largest radius, A the cell's time offset. `decodeRippleAtlas(sample, time, { width?, halfWaves? })` makes the ring (`age = fract(A + time)`, a wave train behind a front at radius `age`, fading as it grows) and returns `normalXY` and `mask`; `time` is in ring lifetimes (`surfaceTime / lifetime`). Layer two samples at other scales and times.

---

## Part 1 — Study

### S1 — What actually happens to a wet surface

Based on Lagarde, "Water drop 2a/2b" (2012–2013), and the BRDF measurements it cites:

1. **Porous materials** (sand, soil, mud, concrete, rough stone) soak up water first.
   - Water filling the pores lowers the refractive-index contrast inside the material, so light scatters deeper and more of it is absorbed. The **diffuse albedo darkens**: strongly for porous materials, barely for dense stone.
   - Roughness falls only a little in this stage.
2. **When the pores are full, a water film forms** on top.
   - The film is smooth, so **roughness drops toward water's** (≈ 0.02–0.1).
   - The **film flattens the normal** (small bumps are filled), so detail normals fade under it.
   - Water's F0 (≈ 0.02) is close to typical dielectric F0 (0.04), so **specular colour barely changes**. What changes is the gloss.
3. **Puddles** form where water collects: low points of the micro-relief (between pebbles, in tyre ruts) and low, flat areas of the macro shape.
   - A puddle is a water surface: roughness ≈ 0.01–0.05, normal = the geometry normal (flat), plus rain ripples.
   - The ground below is darker and slightly visible.
4. **Non-porous materials** (ice, polished stone, metal, glossy plastic) skip stage 1 and get the film straight away. Ice is the extreme: melting makes it a mirror.
5. **Drying runs the other way:**
   - film first;
   - then pores;
   - exposed high points and sun-facing or wind-exposed surfaces first;
   - cavities, shade and porous dense soils last.
   - Sand dries visibly fast at the surface; mud stays wet for a long time.
6. **Rain exposure:** surfaces facing the sky get wet; overhangs and the undersides of rocks stay dry. Vertical surfaces don't collect puddles; they show **streaks and drips** running down.
7. **Snow-melt and slush:** melting snow darkens, turns greyish and translucent, roughness drops, and meltwater wets what's around it.

### S2 — Technique catalogue

| #   | Technique                                                                                                                                                        | What it models           | Cost                                                               | Verdict                                                                                                    |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| T1  | **Porosity darkening + roughness lerp** (two-stage: pores then film)                                                                                             | S1.1–2, S1.4             | ~10–15 ALU, no fetches                                             | **Implement**: the core of everything                                                                      |
| T2  | **Height-driven wetness distribution** (cavities wet first, peaks dry first) using the blended layer height (p305) + AO                                          | S1.3, S1.5               | ~5 ALU (height already sampled)                                    | **Implement**                                                                                              |
| T3  | **Puddles from height + macro mask** (`puddleLevel` vs combined height, macro-noise patches, a flat-slope gate, regional vertex attribute)                       | S1.3                     | ~10 ALU + optional `macroNoise` (already sampled when macro is on) | **Implement**                                                                                              |
| T4  | **Rain ripples** from the ripple atlas (2 time-offset samples, only in film/puddle areas, branch-gated on rain > 0)                                              | S1.3                     | 0–2 fetches                                                        | **Implement**                                                                                              |
| T5  | **Streaks / drips** on steep faces (scrolling along −Y with a streak noise; wetness runs down)                                                                   | S1.6                     | 1 fetch on steep pixels only (slope-gated `If`)                    | **Implement** for cliffs and structures                                                                    |
| T6  | **Sky exposure from the normal** (`normalWorld.y` gate: overhangs and undersides stay dry)                                                                       | S1.6                     | ~3 ALU                                                             | **Implement**                                                                                              |
| T7  | **Regional wetness attribute** (`_WETNESS` vertex attribute or a splat channel: riverbanks, swamps, permanently wet zones)                                       | Authored wetness         | 0 fetches (vertex)                                                 | **Implement**                                                                                              |
| T8  | **Shoreline band** (wet sand above `waterLevel`, noisy edge, optional run-up animation)                                                                          | Beaches, lakes           | ~8 ALU                                                             | **Implement**                                                                                              |
| T9  | **Drying model** in the state: rise with rain, decay by drying rate × sun factor (from `getSunElevation`) × per-layer drying speed                               | S1.5                     | CPU only                                                           | **Implement**                                                                                              |
| T10 | **Snow coverage** (dynamic snow over any layer: normal-up and height-noise mask, blended to a snow set; melting raises wetness)                                  | S1.7                     | +1 set sample (P fetches) where coverage > 0, branch-gated         | **Implement** (Phase 5)                                                                                    |
| T11 | **Frost** on ice and rock (roughness up, slight white, sparkle)                                                                                                  | Cold dry state           | ~5 ALU                                                             | Implement with T10                                                                                         |
| T12 | **Rain occlusion map**: an orthographic depth render from above around the camera, every N frames; a surface below an occluder stays dry (roofs, trees, bridges) | S1.6 for structures      | 1 fetch + a depth render (~0.2–0.5 ms per update)                  | **Optional** (Phase 6). T6 + T7 cover open terrain                                                         |
| T13 | Screen-space reflections in puddles                                                                                                                              | Nearby objects reflected | A PostFX pass (several ms)                                         | **Not here**: environment reflections only; SSR is a p990 PostFX follow-up                                 |
| T14 | Wetness-dependent physics friction                                                                                                                               | Gameplay                 | —                                                                  | **Not here**. Note it for a future surface-material query (`getSurfaceAt(x, z)` → layer weights + wetness) |
| T15 | Footprints / wet trails                                                                                                                                          | Interaction              | Decals                                                             | Via p309's runtime decals (a wet-footprint decal), not a material feature                                  |

### S3 — Per-category response defaults (written into p303's set `surface`)

| Category       | porosity | wetDarkening | wetRoughness (pores) | puddleResponse | dryingSpeed | Notes                                                                                     |
| -------------- | -------- | ------------ | -------------------- | -------------- | ----------- | ----------------------------------------------------------------------------------------- |
| SAND           | 0.9      | 0.55         | 0.45                 | 0.3            | 1.6         | Darkens strongly, stays fairly rough until saturated; absorbs puddles; surface dries fast |
| MUD            | 0.7      | 0.6          | 0.15                 | 1.0            | 0.4         | Glossy quickly, puddles everywhere low, dries slowly                                      |
| ROCKS (gravel) | 0.4      | 0.35         | 0.2                  | 0.6            | 1.0         | Puddles between stones (height-driven)                                                    |
| CLIFF          | 0.2      | 0.25         | 0.15                 | 0.0            | 1.2         | No puddles (steep); streaks                                                               |
| SNOW           | 0.5      | 0.25         | 0.3                  | 0.5            | 0.6         | Wet = slush: + grey-blue tint, slight translucency look via albedo                        |
| ICE            | 0.0      | 0.1          | 0.02                 | 1.0            | 1.0         | Film straight away; a mirror when melting                                                 |
| GRASS (ground) | 0.6      | 0.35         | 0.35                 | 0.2            | 0.8         | Vegetation sheds water; stays rough                                                       |
| CONCRETE       | 0.5      | 0.45         | 0.15                 | 0.7            | 0.9         | Puddles in low spots; streaks on walls                                                    |

These are starting values, tuned by eye in the gallery's wet row (Phase 2). p303's `surface` schema gains `puddleResponse` and `dryingSpeed` (optional, category defaults).

### S4 — How it composes (per pixel, after p305's layer accumulation)

```
exposure   = T6 (normal-up) × (1 − rainOcclusion [T12 optional])
wetGlobal  = conditions.wetness × exposure
wetLocal   = saturate(wetGlobal·(1 + k₁) − heightN·k₂ + cavity·k₃ + regional[T7] + shoreline[T8])   // T2
pores      = saturate(wetLocal·2)               // stage 1
film       = saturate(wetLocal·2 − 1)           // stage 2
albedo    *= mix(1, 1 − wetDarkening·porosity, pores)          // T1 (weighted per layer)
roughness  = mix(roughness, wetRoughness, pores); roughness = mix(roughness, 0.05, film)
normal     = mix(normal, geometryNormal, film)
puddle     = smoothstep(edge, puddleLevel·puddleResponse − heightN, …) × flatGate × macroPatch   // T3
→ puddle: roughness 0.02, normal = geometry normal (+ ripples T4), albedo *= 0.85
streaks    = steep ? scroll(streakNoise, time)·wetGlobal : 0    // T5
snow       = coverage mask → blend to the snow set; melting → wetness += melt                   // T10
```

- Per-layer values (porosity, darkening, wetRoughness, puddleResponse) are **weight-blended** like the other layer outputs. A beach blends sand's response with rock's.
- Height is the normalized combined height from p305's height blend, so puddles settle between pebbles and in ruts.

---

## Part 2 — Implementation

### D1 — Surface conditions state (engine: the `surfaceConditions()` feature, `features/surface/`)

**Why the engine:**

- It's global environment state, read by any material (terrain, structures, props, characters later) and in future by fog, particles, audio and physics.
- Its uniforms must be stable for the app's lifetime.

```ts
type SurfaceConditions = {
  wetness: number; // 0..1 current
  rain: number; // 0..1 intensity (drives wetness rise and ripples)
  puddleLevel: number; // 0..1 how full puddles are (follows wetness with lag)
  waterLevel: number; // world Y for shoreline effects (−Infinity = off)
  snowCoverage: number; // 0..1
  temperature: number; // °C, melting/freezing thresholds
  dryingRate: number; // base wetness decay per minute
  wind: [number, number]; // xz, streak bend and drying
  mode: 'SIMULATED' | 'MANUAL';
};
```

- **Where:** `src/_engine/features/surface/` (`SurfaceConditions.ts`, `SurfaceConditionsFeature.ts` with the `surfaceConditions()` factory, the entry `index.ts` as `aekasha/surface` in `devTools/aliases.ts`, its schema part, its `debug/` and a nested `CLAUDE.md`), listed in the template's `features` after `skyBox()`. Opt-in: an app without wet surfaces carries none of it, and the banner profile budgets its group at 0 by itself (`FEATURE_GROUPS`).
- **`getSurfaceConditionNodes()`** returns uniform nodes created **once**, plus `surfaceTime` (seconds, from `getElapsedTime()` deltas; `timeSource` `APP` | `MAIN` like day-night, so pausing the app loop freezes ripples). It lives in the module like the sky clock, stands still while a scene loads and restarts on the scene's exit; the test bridge's test clock and `freeze()` then hold it, so the scene runner's snapshots of a wet scene are the same on every run.
- **Setters:**
  - `setSurfaceConditions(partial, { transitionSec? })` (smooth transitions);
  - `getSurfaceConditions()`;
  - `startRain(intensity, { rampSec })`, `stopRain({ rampSec })`.
- **`surfaceConditionsSystem`** (MAIN, after `skyBoxSystem`), in `SIMULATED` mode:

  - `wetness` rises with `rain` (rate scaled by intensity);
  - `wetness` decays with `dryingRate × sunFactor × windFactor`, where `sunFactor = clamp(sin(elevation), 0.2, 1)` from a sun source, else 1. The source is a provider (`setSurfaceSunSource(() => number | null)`): the template's app sets it to the sky box's `getSunElevation` in its install, so neither feature imports the other (a kernel registry the sky box fills instead, if a second reader appears);
  - `puddleLevel` lags `wetness` (fills slower, drains slower);
  - `snowCoverage` melts above 0 °C into wetness.

  `MANUAL` leaves all values to the app. The system is registered from the feature's install (`ctx.registerPlugin`), never at module load.

- **Per scene:**
  - the scene schema gets an optional `surfaceConditions` object (initial values), the feature's `FeatureSchemaPart` (`schemas/FeatureSchemas.ts`), so a scene that sets it names the feature in its manifest;
  - the feature's scene hooks (`addSceneHooks`: `exit` resets to the defaults and the clock to 0, `worldCleared` applies the next scene's values, before its scene code, which can set its own; `entered` gets no scene data and runs after the scene code) reset the state on every visit;
  - the state never runs while a scene loads (same rule as the sky).
- **Allocation:** none per frame; values are written into the stable uniforms.
- **Debug tab "Surface conditions"** (`features/surface/debug/_dbg__SurfaceConditions.ts`, registered by the feature's `ctx.onDebug`, so it loads by `import()` in the debug env only and folds out of a production build):
  - one `createDebuggerTab({ id, title, icon, refreshIntervalMs: 250, content })` (`debug/DebuggerGUI.ts`, by relative path inside the engine; `src/_engine/debug/CLAUDE.md`'s drawer tabs) with a declarative pane: the UI kit's sliders and selects for the runtime values, with no overrides, no undo and no LS, like the sky box's day-night Transport;
  - buttons: Rain shower (ramp up 10 s, hold 60 s, stop), Dry now, Soak, Snowfall;
  - a readout of the simulated values (monitor items, refreshed while visible);
  - its icon a new built-in one (Bootstrap Icons' `droplet-fill` into `src/_engine/ui/core/icons/svg/`, which the Hub's design document lists by itself).

### D2 — Wet response nodes (toolkit: `src/toolkit/terrain/nodes/Wet.ts`, on `aekasha/toolkit/terrain`)

- **`applySurfaceWetness(surface, ctx, config)`:**
  - takes `{ albedo, roughness, normalWorld, height, cavity, response: { porosity, wetDarkening, wetRoughness, puddleResponse } }`;
  - returns the modified surface and the masks (`pores`, `film`, `puddle`, `streak`, `snow`) for debug views.
- **Used by:**
  - p305's generator (`wet` config, below);
  - structure materials;
  - p308's scatter rock material;
  - p309's decal material;
  - any app TSL material (exported, documented).
- **`WetConfig`** (p305's reserved `wet` key):
  ```ts
  wet?: {
    puddles?: { maxSlope?: number; macroPatchScale?: number; edgeSoftness?: number };
    ripples?: boolean;                        // needs rippleAtlas
    streaks?: { minSlope?: number; scale?: number };
    shoreline?: { band: number; noise?: number; runUp?: boolean };
    regional?: { attribute: '_WETNESS' } | { splatChannel: 'A' };
    snow?: { set: string; minUpDot?: number; noiseScale?: number };
    rainOcclusion?: 'NORMAL_Y' | 'MAP';       // MAP = T12 (Phase 6)
    quality?: 'FULL' | 'SIMPLE';              // SIMPLE = T1 + T6 only (LOW tier)
  };
  ```
- It binds the nodes from `getSurfaceConditionNodes()` (`aekasha/surface`, toolkit → engine entry); a material with `wet` in a scene without `surfaceConditions()` installed warns once and builds dry.
- Each sub-feature compiles only when present. The ripple, streak and snow fetches sit in `If` branches on their masks and uniforms. Shared coordinates are built before the branches (TSL `If` trap, p305 D5).
- **three r187 options** (optional, decided in implementation):
  - EON rough diffuse (`diffuseRoughness` / `diffuseRoughnessNode`, #34379, `MeshPhysicalNodeMaterial` only): the flat, dusty look of dry sand, regolith and soil, which wetting lowers. It costs a Physical material, so only where the material is Physical already.
  - `BumpMapNode`'s `normalNode` parameter (#35101): bumps on top of an existing normal (a normal-mapped surface), for the ripple and puddle detail and p309's wet decals. It still needs a height texture node.

### D3 — Defaults and data

- p303's `surface` gains `puddleResponse` and `dryingSpeed`. Category defaults come from S3; the library's 16 sets get tuned values.
- **`dryingSpeed`** (per layer, weighted) shifts the local wetness threshold, so sand pixels dry before mud pixels under the same global wetness. One global state, visually varied drying.
- **Regional wetness:** the Blender workflow (p306) documents painting `_WETNESS` (a float attribute through Geometry Nodes _Store Named Attribute_, or a second colour attribute converted) and the splat-alpha alternative.

---

## Phases

### Phase 1 — State (D1) — done

1. The feature (folder, factory, entry and alias, layout rule, listed in `src/index.ts`'s `features`), module, system, setters, transitions, scene defaults (schema part), time source, the sun source; unit tests next to it (the drying model, the transitions, the reset).
2. The debug tab.

**Exit:** a rain shower in the debug tab raises and lowers `wetness` and `puddleLevel` over time; it pauses with F7 (the app loop, `sc-toggle-app-pause`); it resets on scene re-enter; `yarn sbp` shows the feature's size in the app's first download (the template lists every feature) and no surface code in the banner's.

**As built:**

- **Files** (`src/_engine/features/surface/`): `SurfaceConditionsModel.ts` (the state's type and defaults, the transitions, the rain stop and the simulation, as plain functions of a state and a step: no three, no ECS), `SurfaceConditions.ts` (the running state, created at the install; the stable uniforms, the surface clock, `surfaceConditionsSystem` and the public API), `SurfaceConditionsSchema.ts` (the scene part, `SceneSurfaceConditionsSchema`), `SurfaceConditionsFeature.ts` (`surfaceConditions(opts?)`, id `surfaceconditions`; its scene hooks), `index.ts` (`aekasha/surface`), `debug/_dbg__SurfaceConditions.ts`; tests `SurfaceConditionsModel.test.ts`, `SurfaceConditions.test.ts`.
- **API** (`aekasha/surface`): `getSurfaceConditions()` (the live state, read-only), `setSurfaceConditions(input, { transitionSec? })`, `startRain(intensity, { rampSec?, durationSec? })` (`durationSec` added: a shower that stops by itself, which the tab's button uses), `stopRain({ rampSec? })`, `getSurfaceConditionNodes()`, `getSurfaceTime()`, `setSurfaceSunSource(source | null)`, `SURFACE_WATER_LEVEL_NONE`. Without the feature the getters return null and the setters throw, naming the factory.
- **`waterLevel` is `number | null`**, not `−Infinity` (JSON has none): null is none, the uniform then `SURFACE_WATER_LEVEL_NONE` (−1e9).
- **The time source** is the factory's option, `surfaceConditions({ timeSource: 'APP' | 'MAIN' })`, default `APP`. The clock and the simulation advance by `getElapsedTime()`'s change, never while a scene loads, and restart at every exit. The test bridge's `freeze()` pauses the loops, so it holds the clock with no change of its own.
- **Transitions** are linear per number (the wind two); a value set while it moves restarts from where it is; while one moves the simulation leaves it alone. `mode` and a water level from or to none switch at once. Values out of range are clamped, non-finite ones ignored.
- **The simulation's rates** (per minute of the surface clock; `SurfaceConditionsModel.ts`' constants, to tune in Phase 2): full rain wets 1 (dry to a film in a minute); drying is `dryingRate × sunFactor × windFactor × (1 − rain)`; puddles rise toward `wetness` at 0.5 and drain toward it at half the drying; snow melts 0.02 per °C above 0, all of it into `wetness`. `sunFactor = clamp(sin(elevation), 0.2, 1)`, 1 without a sun; `windFactor` 1 still to 3 at 20 m/s and over.
- **The uniforms** are made on the first `getSurfaceConditionNodes()` call (none at load: no module side effect) and written by the system every frame, by a setter at once.
- **The sun source:** the template's `appECSPlugins` sets `setSurfaceSunSource(() => getSunElevation())`.
- **The system:** `surfaceConditionsSystem`, MAIN, order 1 (with `skyBoxSystem`, after it by install order: `surfaceConditions()` is listed right after `skyBox()`), default world only.
- **Wiring:** `devTools/aliases.ts` and `tsconfig.json` (`aekasha/surface`), `ENGINE_FEATURE_FACTORIES`, `aekasha/schemas` (`surfaceConditionsSchemaPart`, `SceneSurfaceConditionsSchema`), `ENGINE_SCHEMA_PARTS` (last), `SceneData.surfaceConditions`, `.schemas/scene.schema.json`, `src/index.ts`.
- **The debug tab** (`surfaceConditionsControls`, after `skyBoxControls` in `DEFAULT_DEBUG_DRAWER_TAB_ORDER`; `keepOnSceneChange`, every field read through getters): Weather (Rain shower, Stop rain (added), Dry now, Soak, Snowfall), Conditions (runtime) (mode, the unit values, temperature, drying, the wind's x and z, the water level's switch and y), Simulation (the surface clock, the sun and wind factors). The icon `droplet` (Bootstrap Icons' `droplet-fill.svg`, 1.11.3) is a new built-in (`BuiltInIcons.ts`, `BUILT_IN_ICONS`, `aekasha/ui`'s `dropletIcon`).
- **SBP:** the feature is 1.7 KiB gzip in the app's first download (three modules; the tab is a lazy chunk): `sbp.config.ts` initial 401 → 402 KiB, `assets/index.js` 396 → 398 KiB, the group `_engine/features/surface` budgeted at 2 KiB; the banner's is 0 (`FEATURE_GROUPS`).
- **Left for Phase 7:** the nested `CLAUDE.md`, the feature counts in the root's and `kernel/init/CLAUDE.md`'s Bootstrap flow, the readme, the Hub page.

### Phase 2 — Wet response (T1, T2, T6, T9) — done

1. `applySurfaceWetness`, p305 integration (`wet` key), weighted per-layer responses, the `WETNESS` debug view.
2. Category defaults (S3), `dryingSpeed`.

**As built (section 1):**

- **The node** (`src/toolkit/terrain/nodes/Wet.ts`, on `aekasha/toolkit/terrain`): `applySurfaceWetness(surface, conditions, opts?)`. The conditions are the second parameter (an app material passes `getSurfaceConditionNodes()` and handles null itself). `surface`: `{ albedo, roughness, normal?, height?, cavity?, response: { porosity, wetDarkening, wetRoughness } }`, each response field a node or a number. `opts`: `quality` (`FULL` | `SIMPLE`), `geometryNormal` (in the shaded normal's space, default `normalWorldGeometry`), `up` (default `normalWorldGeometry.y`), `heightInfluence`, `cavityInfluence`, `shelter`. It returns `{ albedo, roughness, normal?, masks: { exposure, wetness, pores, film } }`. It adds no fetch and no branch.
- **The formula, differing from S4:**
  - Exposure: `smoothstep(cos(to), cos(from), up)` over `shelter`, the angles from straight up (default `[60, 120]`: a wall half wet, an underside dry).
  - Local wetness: `w + k₂·(w − height) + k₃·cavity·w`, saturated, with `w = wetness × exposure`. k₁ = k₂, so 0 stays dry and 1 wets every height. The cavity term is × w: S4's unscaled `cavity·k₃` would wet dry ground.
  - The stages follow the porosity, so a dense surface films at once (S1.4), which S4's fixed ×2 couldn't do: `split = 0.5·porosity`, `pores = saturate(local / max(split, 0.1))`, `film = saturate((local − split) / (1 − split))`. Porosity 1 gives S4's stages.
  - The pores never raise the roughness: `mix(r, min(r, wetRoughness), pores)`. The film roughness is 0.05.
  - The film flattens the normal × 0.6, not fully: a film fills small bumps, not a stone's shape.
  - `SIMPLE` reads no height or cavity and leaves the normal alone.
- **The terrain `wet` key** (schema and reader in step): `{ quality?, heightInfluence? (≥ 0, 0.5), cavityInfluence? (≥ 0, 0.5), shelter? ([from, to] in 0..180, [60, 120]) }`, also a tier override (`OVERRIDE_KEYS`), replacing the material's whole. D2's later keys (`puddles`, `ripples`, `streaks`, `shoreline`, `regional`, `snow`, `rainOcclusion`) come with their phases; until then the strict reader refuses them. Uniforms: `terrain_wetShelter` (degrees), plus `terrain_wetHeightInfluence` and `terrain_wetCavityInfluence` with `FULL`.
- **The graph** (`material/TerrainWet.ts`):
  - Order: after the far branch and the macro roughness, before the detail normals' fade. The cavities are `1 − aoNode` (a `FULL` layer's map × the vertex AO), so `LITE` and `MINIMAL` without vertex AO get none.
  - Per layer: `LayerParams` gained `porosity`, `wetDarkening` and `wetRoughness` (both bundle kinds had them already). `LayerSurface.wet` carries the sample's height and the response, which `blendSurfaces` blends by the final weights, slots included.
  - The far branch's struct gets `wetHeight` and `wetResponse` members. The far side takes the response by the raw weights (normalized), at height 0.5.
  - Without the feature: dry, warned once a page load.
  - The colour-map bake strips `wet` (the material's and each tier's), so a bake stays dry.
- **`WETNESS` view:** R the pores, G the film (B is left for Phase 3's puddles), over the faint checker, with a dark-grey floor. Both readers refuse it without `wet` (the material's or a tier's). `TAPS` doesn't change (no fetch).
- **For section 2:** the set array's `layerParams` is full (4 vec4 a layer, all 16 floats used), so `puddleResponse` and `dryingSpeed` need a fifth vec4 (`PARAMS_PER_LAYER` 4 → 5, `writeLayerParams`, `getTextureSetLayerParams`). The category defaults change `TEXTURE_SET_SURFACE_DEFAULTS`' flat wet values into a per-category table, which the gatherer fills.

**As built (section 2):**

- **The data (engine):** `surface` gained `puddleResponse` (0..1) and `dryingSpeed` (over 0). `TEXTURE_SET_WET_RESPONSES` (`aekasha/schemas`, with the type `TextureSetWetResponse`) holds S3's five values per category, `OTHER` the flat defaults. The gatherer fills a set's missing fields from its category first, then from `TEXTURE_SET_SURFACE_DEFAULTS`. The library's sets give none of the five, so they're their categories'. The set array's `layerParams` is 5 vec4 a layer (`puddleResponse`, `dryingSpeed`, two spare).
- **`dryingSpeed`** is a power: the wetness a surface shows is `(wetness × exposure)^dryingSpeed` (floored at 0.05), so 0 and 1 stay where they are, sand (1.6) shows less and mud (0.4) more.
- **Two changes from S4, after the first look on WebGPU:**
  - The darkening is `wetDarkening × pores`, no longer × the porosity too. S3's values already encode the material, and the product left cliffs at 5 % and snow at 12 %. The porosity sets only the stages.
  - The film is × `puddleResponse` ("how readily water stands on it": the film and Phase 3's puddles). Every set filmed into a mirror before, grass included, which S3 says sheds water: now grass gets a fifth of the film and cliffs none (their pores' 0.15 roughness still glistens).
  - Also: the film never raises the roughness (ice's 0.02 is under the film's 0.05).
- **The graph:** `LayerWet` is `{ height, response (vec4: porosity, darkening, wetRoughness, dryingSpeed), puddleResponse }`; the far branch adds the `wetPuddleResponse` member.
- **The gallery's Wet/dry row** (`src/app/scenes/terrainGallery/wetRow.ts`):
  - Layout: 3 × 3 library blocks left of the Splatting row, x −142..−98: sand02, mud02, rocks01 / cliffs01, snow01, ice01 / grass01, concrete02 and a beach (sand02 with rocks01 on slopes past 22°, `RULES`, height-blended). Code route materials with `wet: {}`; the quality and the view are variants.
  - The scene's JSON holds the conditions (`surfaceConditions: { mode: 'MANUAL', wetness: 0.6 }`), so nothing dries them.
  - The tab's "Wet/dry row" section (`_dbg__terrainGalleryWet.ts`): the wetness slider, the exit's steps (0, 0.3, 0.6, 1), the row's quality, the `WETNESS` switch and the blocks' list, each block showing its set's response. The tab's own Debug view and Quality don't reach the row (`WETNESS` would throw on a material without `wet`).
- **Measured** (2026-11-18, Windows Chrome on WebGPU, AMD RDNA 3; the row from 24 m up, the scene's 10:00 sky; no shader errors).
  - Mean brightness against dry at wetness 1: mud 0.57, concrete 0.73, the beach's sand 0.77, sand 0.81, rocks 0.84, grass 0.85, cliffs 0.96, snow and ice 0.95.
  - The bright and dense sets darken little on screen: their gloss reflects the bright sky back.
  - Mud, grass and concrete are as dark at 0.3 as at 1 (their pores fill early); sand barely changes before 0.6.
  - What this exit judges is the look against photos. The reference photos for the handbook page come with Phase 7's page.

**Gallery row "Wet/dry"** (p310 completes it): one 12 m block per category plus a blended beach block, with a global wetness slider.

**Exit:** each category reads as plausibly wet at 0.3 / 0.6 / 1.0 when judged side by side against reference photos (collect 1–2 photo references per category from CC0 sources into the handbook page).

### Phase 3 — Puddles and ripples (T3, T4, T7) — done

1. Puddle mask from height, macro patches, flat gate, regional attribute.
2. Ripples (`rippleAtlas`).

**Exit:** on `mud02` and the `rocks01` gravel, puddles fill the low points first and ripple only while it rains. Frames without rain sample no ripples (verify with the `TAPS` view).

**As built (section 1):**

- **Decided at the start:** the patches are a fetch of their own (not the `macro` sample's B, whose patch size `macro.scale / 5` ties them to the colour variation's 40-300 m); the regional wetness takes both sources, as D2 has them.
- **The node** (`applySurfaceWetness`): `surface.regional?` (a float node) and `opts.puddles?: { maxSlope?, edge?, patches?, patchAmount? }` (`SurfacePuddleOpts`; `patches` a node the caller samples, so the node stays fetch-free); `masks.puddle` (0 without puddles). `FULL` only.
- **The puddle, differing from S4:**
  - `waterline = level × puddleResponse × max(0, 1 + (patches − 0.5)·2·amount)`, `level = max(puddleLevel, regional)`; `puddle = smoothstep(0, edge, waterline − height) × smoothstep(cos maxSlope, cos(maxSlope/2), up)`. S4 adds the patches to the level, which put puddles in high patches at a puddle level of 0; here level 0 is dry. Without a `height`, the relief is flat at 0.5.
  - Under a puddle: the pores and film full (`max` with the puddle; the masks stay the stages before it), the albedo × (1 − 0.15·puddle) on top of the soaked darkening (S4's 0.85, the "holes" risk's cap), the roughness to 0.02 (`PUDDLE_ROUGHNESS`; never raised), the normal to the geometry's.
  - Defaults: `maxSlope` 15° (full puddles up to 7.5°: the gallery blocks' noise is under 10°), `edge` 0.05, `patchAmount` 0.75.
- **The regional wetness, differing from S4:** a floor, not a sum: the wetness shown is `max(wetness × exposure, regional)` (before the drying power, whatever the facing), and the puddle level `max(puddleLevel, regional)`. S4's `+ regional` would push wet ground past 1 and doesn't keep a swamp's puddles.
- **The terrain `wet` keys** (schema and reader in step):
  - `puddles?: { maxSlope? (over 0 to 45, 15), edge? (over 0 to 1, 0.05), patches?: { scale (metres a macro tile, over 0), amount? (0..1, 0.75) } }`; refused with `quality: 'SIMPLE'`. Uniforms `terrain_wetPuddleMaxSlope`, `terrain_wetPuddleEdge`, with patches `terrain_wetPuddlePatchScale` and `terrain_wetPuddlePatchAmount`.
  - `regional?: { attribute? } | { splatChannel: 'A' }`: the attribute's name defaults to `_wetness` (GLTFLoader lowercases glTF's `_WETNESS`; a mesh without it reads 0, warned by three); `A` needs `SPLAT_MAP` or `SPLAT_MAP_AND_RULES` painting at most 4 layers (the first map's A weighs none; `PaintedWeights.splatAlpha`, no extra fetch).
- **The macro input:** the patches read it like rule noise: `takesMacroTexture` counts the material's or a tier's patches, the code route's id is `macro.texture`, else `noiseTexture` (now also taken for patches), else `macroNoise`. The patches sample at the material's XZ (`sampleMacroTexture`, `OBJECT` space too) outside the far branch. `TAPS` counts the fetch. The colour-map bake drops the `macro` input when only the stripped `wet` read it.
- **`WETNESS` view:** B is the puddle (magenta to white over the stages).
- **The gallery's row:** every block `puddles: { patches: { scale: 30 } }` (patches of 6 m, about two a block); the `SIMPLE` variant drops them. The grass block has a `_wetness` band along its left edge (wet to 2 m, dry past 5 m: a riverbank), on its seed's geometry. The scene's JSON starts `puddleLevel: 0.6`; the tab has a Puddle level slider and steps (0, 0.3, 0.6, 1) and each block's `puddleResponse` in its row.
- **Seen** (2026-11-18, Windows Chrome on WebGPU, AMD RDNA 3; no shader errors):
  - `WETNESS`: mud has almost no puddles at a puddle level of 0.3 and most of its flat under water at 1, the higher spots and the 35° ramp left out; the rocks' gravel puddles between its stones, more in one patch than the other; cliffs none; the grass's regional band stays wet (with small puddles) at wetness and puddle level 0.
  - In colour a puddle reads little against a full film (mud from wetness 0.3: roughness 0.05 against 0.02, the normal 60 % flattened against 100 %, 15 % darker): open for section 2's review, with the ripples, which mark puddles apart from the film.

**As built (section 2):**

- **The node:** `nodes/Ripples.ts`' `sampleRainRipples` (internal), called by `applySurfaceWetness` with `opts.ripples: { atlas, position?, scale?, lifetime?, strength?, fade? }` (`SurfaceRippleOpts`; `FULL` and a shaded `normal` only); `masks.ripple` is the branch's weight × the rain (0 without). The node's doc no longer says "no fetch": the ripples' two are its only ones, in their branch.
  - Two samples of the atlas at the position's `(x, −z)` over `scale` and over `scale × 0.71` offset by (0.37, 0.61) tiles, half a ring's lifetime apart, decoded at `conditions.time / lifetime` (the surface clock); a drop is kept where `fract(A × 7.31) < rain`, so light rain has fewer rings. The offset (`normalXY × strength × weight`, the atlas's +v the world's −z) is added to the normal and normalized.
  - Where: `max(puddle, film × flat)` × the fade: the puddles, and a film on ground flatter than the puddles' `maxSlope` (15° without puddles; `getFlatGate`, which the puddles share). A film on a slope runs off: no rings.
  - The branch (`If(weight > 0 && rain > 0)` in a `Fn` returning a var, the slope gate's pattern): the UV's `dFdx` / `dFdy`, the weight, the rain, the clock and the numbers are declared before it (`declareBranchInput`); both taps `.grad()`. A dry frame or a pixel without standing water within the fade samples nothing.
  - Defaults (`SURFACE_WETNESS_DEFAULTS`): scale 1.5 m (16 drops a tile: rings up to about 25 cm across), lifetime 0.7 s, strength 0.5, fade `[10, 30]` m from the camera.
- **The terrain `wet.ripples`:** `{ scale? (over 0), lifetime? (over 0), strength? (≥ 0), distance? ([from, to] metres) }`, refused with `SIMPLE`; uniforms `terrain_wetRippleScale`, `…Lifetime`, `…Strength`, `…Distance` (the fade over the material's view distance). The atlas is the input `ripples` (`takesRippleTexture`: the material's or a tier's ripples; refused without, wanted with); the code route's `rippleTexture` (default `rippleAtlas`, the toolkit's KTX2; refused without ripples). It counts in the texture budget (`ripple atlas`) and the code route's `AUTO` storage. A scene with a code-route material lists `rippleAtlas` in its `textures` (the gallery's does).
- **`TAPS`:** the two taps gated by `masks.ripple` (`estimateTerrainFetches`' `gated`). The colour-map bake drops the `ripples` input with `wet`.
- **The gallery:** every block has `ripples: {}` (the `SIMPLE` variant drops them); the tab has a Rain slider (in `MANUAL` the rain only ripples) and the row's view is now a choice of Shaded, `WETNESS` and `TAPS`.
- **Seen** (2026-11-18, Windows Chrome on WebGPU, AMD RDNA 3; no shader errors):
  - `TAPS` on `mud02` from 5 m at puddle level 0.6: 3 fetches everywhere at rain 0 (its layer's 2 and the patches'), 5 at rain 1 where water stands, 3 on the ramp and the drier spots. Past 30 m (the row from 34 m) the same at rain 0 and 1.
  - From 1.5 m the rings read as rings on the puddles and the film, moving between frames 250 ms apart; from 5 m they're a few pixels, a sparkle on the water. On the rocks' gravel none show from 5 m (its puddles are specks between the stones); not looked at closer.

### Phase 4 — Streaks, shoreline (T5, T8) — done

1. Streaks (T5).
2. Shoreline (T8).

**Exit:** cliffs and concrete walls streak downward during rain and fade after; a beach block shows a wet band that follows `waterLevel`.

**Decided at the start:**

- D2's `streaks` gains `length` and `speed`; `shoreline.runUp` is `{ height?, period? }`, not a boolean (its numbers, like the other keys').
- No streak bend by the wind (D1): running water follows gravity; the wind bends the falling rain, not the rivulets.
- `SIMPLE` takes the streaks (they leave the normal alone) and the shoreline (like `regional`); the gallery gets a water plane over the beach (section 2).

**As built (section 1):**

- **The node:** `nodes/Streaks.ts`' `sampleRainStreaks` (internal), called by `applySurfaceWetness` with `opts.streaks: { texture, position?, minSlope?, scale?, length?, speed? }` (`SurfaceStreakOpts`); `masks.streak` is the branch's weight × `max(rain, wetness)` (0 without). Both qualities.
  - The weight: a face steeper than `minSlope` (faded in over the 10° below it) × `saturate(2 × exposure)` (a vertical face's full, an underside's none).
  - The pattern: the noise texture's R (the macro noise's fbm) over `scale` metres across and `scale × length` down, `smoothstep(0.55, 0.7, R)` the rivulets. The coordinate across is the space's x or z, whichever the face's normal turns from; the two cross-fade over about 40-50° (the normal's |x| share of |x| + |z| in 0.42..0.58), a second fetch in a nested branch there alone. A hard switch at 45° showed a seam on the boulder.
  - Damp: `rivulet × saturate(wetness / 0.15)`, the raw wetness (water runs down from above), a floor on the pores alone (never the film: a damp rivulet isn't glossy; concrete's pore roughness 0.15 still sheens). It stays full until the surface is nearly dry, so it's the last to dry. A first try at a floor on the local wetness gave damp rivulets a film; at full below 0.5 they didn't stand out from a drying face.
  - Running: `rivulet × rain × pulse`, a floor on the film (not × `puddleResponse`: running water is a film on a cliff too), and the albedo × (1 − 0.25 × running) (`STREAK_DARKENING`): during rain a vertical face's pores are full already and its gloss reflects the ground, so the darker water is the cue. The pulse is `0.8 + 0.2 sin(2π (y + t × speed) / 0.6 m + 12 R)`, moving down on the surface clock.
  - The branch: `If(weight > 0 && rain + wetness > 0)`, the slope gate's pattern; the coordinates, their gradients (each axis's own, from `dFdx` / `dFdy` of the position) and the weather declared before it; both taps `.grad()`.
  - Defaults (`SURFACE_WETNESS_DEFAULTS`): `minSlope` 60°, `scale` 4 m, `length` 8, `speed` 1 m/s.
- **The terrain `wet.streaks`:** `{ minSlope? (over 0 to 90), scale? (over 0), length? (over 0), speed? (≥ 0) }`, in both qualities; uniforms `terrain_wetStreakMinSlope`, `…Scale`, `…Length`, `…Speed`. The texture is the input `macro`, taken like the puddle patches' (`takesMacroTexture`, the code route's `noiseTexture` else `macroNoise`; `noiseTexture` is accepted with streaks). The pattern is in the material's space (`OBJECT`: it sticks to the piece; a tilted piece would streak along its own −Y), the steep gate on the world's up.
- **`TAPS`:** the one fetch gated by `masks.streak` (the band's second isn't counted). On the structure wall it doesn't show: its triplanar taps are in the 12-16 band wet or dry. The colour-map bake drops the macro input when only the stripped `wet` read it (as before).
- **`WETNESS`:** unchanged; the rivulets show in R (damp) and G (running).
- **The entry** also exports `SurfacePuddleOpts`, `SurfaceRippleOpts` and `SurfaceStreakOpts` (the first two were in `ApplySurfaceWetnessOpts` without an export).
- **The gallery:** a concrete wall (`concrete02`, 8 × 4 × 0.6 m) on the concrete block and a cliff boulder (`cliffs01`, a bulged icosphere 6 × 4.8 × 4 m, a third buried, its overhang under the bulge) on the cliff block, structure materials with `wet: { streaks: {} }`; the tab's list names them, its hints the streaks.
  - **A fix of Phase 3's:** the row's `SIMPLE` switch threw (its variant dropped the puddles' patches and the ripples, whose inputs a variant keeps: `Input "macro" has no use`). Every row material now has a `LOW` tier whose `wet` is the `SIMPLE` one, and the switch is `qualityLevel: 'LOW'` (a tier's variant shares the base's inputs).
- **Seen** (2026-11-18, Windows Chrome on WebGPU, AMD RDNA 3; no shader errors):
  - `WETNESS` at wetness 0.6 and rain 1: four or five rivulets on the 8 m wall and on the boulder, top to bottom; the boulder's underside dry; no seam where its axes switch.
  - Shaded, the wall from 6 m: in rain, darker bands down its lower half; at wetness 0.2 without rain, the rivulets clearly darker than the drying face (and sheened); at 0.05 traces on the cliff (its darkening is 0.25).

**As built (section 2):**

- **The node:** `nodes/Shoreline.ts`' `getShoreline` (internal), called by `applySurfaceWetness` with `opts.shoreline: { band, noise?, runUp?: { height?, period? }, position? }` (`SurfaceShorelineOpts`). Arithmetic only (no fetch, no branch), both qualities. No mask of its own: its bands show in the others.
  - The height above the water: the world position's Y − `waterLevel` − `noise` × the wander (two octaves of `valueNoise` at the world's XZ, 4 m and 1.1 m cells, the second at 0.35; −1..1). Without a water level its uniform (−1e9) makes every band 0. About 25 ALU and two value noises, over S2's ~8.
  - The run-up's reach: `height × (0.5 + 0.5 sin(2π t / period + 4 × wander))` on the surface clock, 0 without `runUp`.
  - Three bands, each 1 under the water: the **wash** below the reach (faded over 4 cm) is combined into the puddle mask (soaked, 0.02 rough, flat normal, 15 % darker; rings while it rains); the **saturated** sand below 15 cm over the higher of the reach now and 1.5 s ago (faded over 10 cm) is a floor on the film, not × `puddleResponse`; the **damp** band below `band` is a regional wetness (`max` with `regional`): the least wetness (before the drying power) and puddle level shown.
  - The saturated band followed the run-up's full height at first, so the wash moved inside a band that stood still and shaded almost alike (0.02 against 0.05 roughness): a wave didn't show. Its top now follows the reach, receding 1.5 s behind it (a second `sin`).
  - Defaults (`SURFACE_WETNESS_DEFAULTS`): `noise` 0.3 m, run-up 0.5 m every 6 s (`band` has none).
- **The terrain `wet.shoreline`:** `{ band (over 0, required), noise? (≥ 0), runUp?: { height? (over 0), period? (over 0) } }`, both qualities; uniforms `terrain_wetShoreBand`, `terrain_wetShoreNoise`, with a run-up `terrain_wetShoreRunUp` (height, period). Always at the world's position (the water level is the world's), whatever the material's space. No input.
- **The gallery:** the beach block has `shoreline: { band: 1.5, runUp: {} }`; a still water plane over it (12 m, `#1f4d5c` at 0.6 opacity, roughness 0.05) at the water level, hidden without one, follows it on the scene's looper (`createWetRow(sceneId)`). The scene's JSON starts `waterLevel: 0.15`; the tab has a Water level switch and a slider (−0.3 to 2.5 m).
- **Seen** (2026-11-18, Windows Chrome on WebGPU, AMD RDNA 3; no shader errors):
  - At 0.15 m most of the beach's flat is under the water, its islands washed; on the ramp (the rocks, past 22°) the bands in `WETNESS`: white (the wash), yellow (saturated) and a red damp band to 1.5 m, its top wandering. At 1 m they climb the ramp with the plane; off, the beach is dry.
  - Shaded against dry (the same camera, mean luminance in 40 px strips): the ramp 6 % darker at the band's top to 23 % at the water (rocks01's 0.35 darkening less the film's gloss).
  - The run-up: in `WETNESS` the wash and the saturated band move along the shore between frames 1.5 s apart; shaded, it's a moving gloss edge, a few levels in the lowest strips. A foam line would read better (left for a water material).
  - `SIMPLE`: the bands without the flat normal; the wash still darkens and glosses.

### Phase 5 — Snow coverage and frost (T10, T11)

**Exit:**

- `snowCoverage` 0 → 1 covers upward faces first;
- melting (temperature > 0) turns the snow to slush and wets the ground;
- the ice layer frosts below −5 °C.

### Phase 6 (optional) — Rain occlusion map (T12)

1. An orthographic depth render (512², 64 m around the camera, updated every N frames or on camera movement > X), sampled in `wet` when `rainOcclusion: 'MAP'`.

**Exit:** the area under a concrete roof stays dry in rain; the cost measured and recorded.

### Phase 7 — Handbook, Hub and versioning

1. **`docs/techniques/wet-dry-surfaces.md`** (page template):
   - the S1 physics in plain words;
   - the technique table with costs (S2);
   - the response table (S3);
   - **how to set up:**
     - per material: the `wet` config;
     - per set: `surface` values;
     - per block: regional wetness painted in Blender, or a splat alpha;
     - per scene: initial conditions in the scene JSON;
     - at runtime: the API, rain showers, tying drying to the day-night cycle;
   - **variations, each with why and cost:**
     - SIMPLE quality for LOW tier;
     - puddles without ripples;
     - wetness-only for top-down (puddle reflections barely read from above);
     - streaks only on structures;
   - **"Best for":**
     - first- and third-person, where gloss and reflections read close-up;
     - weather-driven games (survival, open world, racing on wet tracks);
     - stylized games use SIMPLE (darkening only);
     - top-down/RTS get little from puddles and ripples, so use SIMPLE.
2. **Hub** (`hub/CLAUDE.md`): a feature page for surface conditions (`hub/pages/features/surface-conditions/`, group World: the state, its time source, the scene field, the API as `api:` links, `aek:covers` for the nested `CLAUDE.md`'s sections) and the terrain feature page's wet section linking the handbook page; a `::: scene` panel on `terrainGallery`'s wet row (its showcase comes with p310). Then `yarn hub:build`.
3. **Repo docs:**
   - `readme.md` Features (engine: surface conditions; toolkit: wet response);
   - `src/_engine/features/surface/CLAUDE.md` (stable uniforms, time source, scene reset, the sun source), a line in the root's Architecture map, and the new feature in the root's Bootstrap flow and Three-folder split;
   - **p990:** its deferred "weather" bullet already points here (since 2026-10-02). When this plan lands, update that bullet to say the surface side is done;
   - **p427:** its grounding names the API that landed (`aekasha/surface`, the sun source it replaces when it owns the clock).
4. **Versions:** engine minor, toolkit minor, app minor; `CHANGELOG.md`.

---

## Risks

| Risk                                                                         | Mitigation                                                                                                                       |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Stable uniforms bound by many materials, then a material is disposed: leaks? | Uniform nodes are plain objects shared by reference; disposing a material doesn't touch them; nothing per material is registered |
| Puddles look like holes without reflections of nearby objects (no SSR)       | Keep puddles mostly in the open (sky reflections dominate); cap puddle darkness; document the SSR follow-up                      |
| Ripple atlas tiling visible                                                  | Two time-offset samples at different scales and rotations; ripples only in puddles and film                                      |
| Cost creep from every sub-feature                                            | Everything compiles out; SIMPLE for LOW; `TAPS` debug view; gallery measurements                                                 |
| `surfaceTime` vs determinism                                                 | Visual only; it follows `getElapsedTime()` deltas, stands still during a load and restarts per scene (the sky clock's rule), and never touches physics |
