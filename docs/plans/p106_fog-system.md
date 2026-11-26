Status: in progress | Phases 1-3 implemented
Category: Fog, Rendering
Related: p427_weather-and-mood.md (the world state that drives the fog through `updateFog`; its open question 3 is this plan), `src/_engine/features/skybox/CLAUDE.md` (the horizon colour and the sun the fog follows), `src/_engine/features/surface/CLAUDE.md` (the stable uniforms pattern this feature copies), `src/_engine/features/postfx/` (the light shafts pass, Phase 6), p990_follow-ups-from-done-plans.md (the deferred sky ideas: auto-exposure, volumetric clouds)

# Fog System — Plan

A `fog()` feature: one fog per scene, defined in a `*.fog.json` (or inline in the scene JSON),
switched on and off as a whole, in one of three modes, its colour the active sky box's horizon colour
by default (or a colour of its own), every parameter editable in a Fog tab of the debug drawer and saved back to its file.

The modes:

- **`LINEAR`**: three's `Fog` (a smoothstep between `near` and `far`).
- **`EXP2`**: three's `FogExp2` (`1 − exp(−(density · d)²)`).
- **`HEIGHT`**: an analytic exponential height fog, the "global volumetric" fog of the request:
  thick in valleys and thin over the hills, glowing toward the sun. Arithmetic in the materials, no
  pass of its own.

Each mode can glow toward the sun (on by default for `HEIGHT`, off for the other two).

And, gated on a measurement (Phase 6), sun light shafts as a PostFX pass.

## Why not a raymarched volumetric fog (read before changing the modes)

The request asked for a global volumetric fog "or something like it". A real one (froxels, or a
raymarch per pixel) isn't planned:

- three r187's `VolumeNodeMaterial` (`src/materials/nodes/VolumeNodeMaterial.js`, its lighting
  model `src/nodes/functions/VolumetricLightingModel.js`) lights only from lights with a
  `distance` (point and spot lights, rect area lights): **no directional light**, so not the sky
  box's sun, which is what an outdoor fog scatters. It's also a mesh volume, not a global fog.
- A screen-space raymarch needs the scene's depth: in the PostFX chain that's the non-MSAA
  depth/normal pre-pass (`PostFX.ts`, `sceneDepthNode`), **a second render of the scene**, plus the
  march itself, half-resolution and a bilateral upsample. A froxel grid needs compute, a 3D
  texture and a temporal filter. Both cost milliseconds a banner or a phone can't pay, against the
  Smallest Build Possible and Primordial Performance principles.
- The look most scenes want from "volumetric" fog is the height falloff and the bright side toward
  the sun. An exponential height fog (Unreal's, Frostbite's) gives both analytically, in every
  material, for a few ALU.

The part a height fog can't do, shafts of light through gaps, is three's `godrays` addon as a PostFX
pass (D9), built only if its cost passes Phase 6's gate.

## Context (measured 2026-11-26, three r187)

- **No fog in the engine.** `material.fog = false` is set only on the bakes' and override
  materials (`lod/impostors/ImpostorBake.ts`, `skybox/SkyStaticLayers.ts`,
  `surface/RainOcclusion.ts`, `kernel/render/TextureBaker.ts`). p427 lists fog in its world state
  and asks for "height and distance fog as nodes the materials share" (its open question 3).
- **three's fog on the WebGPU renderer** (`src/renderers/common/nodes/NodeManager.js`):
  - `getFogNode(scene)` returns `scene.fogNode`, else a node built from `scene.fog` (a `Fog` or
    `FogExp2`, cached per object in a WeakMap; anything else logs "Unsupported fog
    configuration"). **`scene.fogNode` is the custom fog's hook**, not deprecated in r187, and wins
    over `scene.fog`.
  - The TSL builders (`src/nodes/fog/Fog.js`, on `three/tsl`): `fog(color, factor)` (mixes the
    material's `output` toward `color`), `rangeFogFactor(near, far)` (`smoothstep` over the view
    depth), `densityFogFactor(density)`, `exponentialHeightFogFactor(density, height)` (Y up; the
    height above `positionWorld.y` × the view depth, so not the integral D4 wants).
  - **Trap:** `@types/three` still declares `rangeFog` and `densityFog`, which the r187 JS no
    longer exports: importing either fails the build.
  - The fog node's cache key is part of every draw's key (`NodeManager.getCacheKey`): a uniform
    change costs nothing, **a different fog node (on, off, another graph) recompiles every
    material in the scene.**
  - `NodeMaterial.setupOutput` applies the fog in linear HDR, before tone mapping and the output
    colour space. A material's own `outputNode` replaces the fogged colour (none of the engine's
    has one); a `fragmentNode` is fogged. Sprites, points and fat lines get the right view depth.
  - **The background is never fogged** (`Background.js` sets `fog = false` on its sphere), nor are
    shadow materials.
- **The sky box** (`features/skybox/`, `skyBox()`): the root scene's `backgroundNode` and
  `environmentNode`. A scene names its sky boxes in `skyboxes` (ids of `*.skybox.json`s or inline
  definitions); the gatherer inlines them with the scene's `__saveData` entry (`readSkyBoxes`,
  `devTools/gather/registries.ts`; `resolveSkyBoxes`, `sceneAssets.ts`). `skyBoxSystem` (MAIN,
  order 1) moves the sun and rewrites the atmosphere's uniforms each frame on the day-night cycle.
  - Public: `getSunDirection(out, opts)` and `getSunElevation(opts)` (`SkyDayNight.ts`), CPU,
    null without a sky box. **No horizon colour getter.** The ground layer's
    `useAtmosphereHorizon` isn't one colour: it blends toward the atmosphere in each direction.
  - On the CPU, `computeInscatter(dir, atmosphere, sunDir, out)` (`layers/Atmosphere.ts`) is the
    atmosphere's inscatter (the ambient light's `AUTO` sky colour uses it, at `UP`);
    `composeAtmosphere` adds the transmitted light, the tint and the exposure on the GPU.
  - The sun light is an ECS directional light the sky box manages (`SkyLights.ts`,
    `getSkyLightIds()`), its colour and intensity on the light.
- **Features don't import each other** (only `character()` imports `physics()`). The app wires
  them: `src/AppECSPlugins.ts` calls `setSurfaceSunSource(() => getSunElevation())`.
- **The template for a global render state** is `surfaceConditions()` (`features/surface/`):
  stable uniforms made once (`getSurfaceConditionNodes()`), written in place by a MAIN system, a
  scene's state applied in `worldCleared` and reset in `exit`, a schema part with one scene field,
  a debug tab (`droplet`) loaded through `ctx.onDebug`.
- **PostFX passes** (`postFx()`): a `*.postFx.json` plus a TSL file exporting `fxNode(params, ctx,
  defines)`, listed in the scene's `postFx` in chain order. The context gives the renderer, scene,
  camera, the scene pass and its colour, and lazily the depth and normals (the pre-pass above). The
  app's only pass is `src/app/postFx/ambientOcclusion.*`. The sun's shadow map is reachable only
  through the light object.

## Design

### D1. The feature

`fog()` (`src/_engine/features/fog/`, id `'fog'`, on a new entry `aekasha/fog`), its files like
`features/surface/`: `FogFeature.ts` (the feature, its scene hooks), `Fog.ts` (the state, the
system, the API), `FogNode.ts` (the TSL graph), `FogSchema.ts`, `FogTypes.ts`, `index.ts`,
`CLAUDE.md`, `debug/`. The template lists it right after `rainOcclusion()`, so its system (MAIN,
order 1, default world only) runs after `skyBoxSystem` and reads this frame's sun. The feature is
the build-level switch: an app without it carries none of its code, and a scene naming a fog fails
the boot's feature check (`checkSceneFeatures`).

### D2. The data

- A fog is a `<id>.fog.json` (id defaults to the file name), or an inline definition (its `id`
  required). A scene lists its fogs in its JSON's `fogs` field, like `skyboxes` (ids or inline
  definitions; `fogSchemaPart`, the feature `'fog'`; Decided 3): the one with `isDefault: true`
  is the one it starts with, else the first. A fog only one scene uses sits in that scene's
  folder (`src/app/scenes/<sceneId>/<id>.fog.json`), a shared one in `src/app/fogs/`.
- The definition (Zod, each key `.describe()`d):
  - `id`, `isDefault`, `enabled` (default `true`), `mode` (`LINEAR` | `EXP2` | `HEIGHT`);
  - `colorSource` (`SKY` | `MANUAL`, **default `SKY`**: the sky box's horizon colour through the
    wired source, D5) and `color` (a hex or colour string: the colour of our own under `MANUAL`,
    and `SKY`'s fallback when no source is wired or the sky box gives no horizon colour);
  - `linear: { near, far }`, `exp2: { density }`;
  - `height: { density, baseHeight, falloff, startDistance, maxOpacity }`;
  - `sunScattering: { enabled, strength, exponent }`, the sun glow (D4), for every mode: `enabled`
    defaults by mode (on for `HEIGHT`; off for `LINEAR` and `EXP2`, which then look like three's
    fog), and the reader writes the resolved value, so the debug tab's mode switch doesn't flip it;
  - `background` (`NONE` | `FOG_COLOR`: with `FOG_COLOR` and no sky box showing a background, the
    root scene's clear colour is the fog's colour, so `LINEAR` and `EXP2` fade into it);
  - `debugData`, `__saveData` (per scene, like a sky box's).
- Every mode's parameters can be present at once, so the debug tab switches modes without losing
  values; only `mode` says which one renders.
- The gather pipeline: `fog: '.fog.json'` in `GATHERED_SUFFIXES` and its schema in
  `GATHERED_SCHEMAS` (`devTools/gather/gatheredJson.ts`), `readFog` (`registries.ts`, like
  `readSkyBoxes`: `claimIds`, `__sourcePath`, `$schema` dropped), its registry and id space in
  `context.ts` (and `TYPE_LABELS`), `resolveFogs` (`sceneAssets.ts`: each id → its definition, and
  each inline one, with the scene's `__saveData` entry deep-merged over it, `debugData` dropped in
  production), `fog.schema.json` in `jsonSchemas.ts`, the part in `ENGINE_SCHEMA_PARTS`
  (`devTools/gather/engineSchemas.ts`), the field typed on `SceneData` (`kernel/scene/Scene.ts`,
  `import type` from the feature), the feature in `ENGINE_FEATURE_FACTORIES`
  (`kernel/init/Features.ts`), the entry in `devTools/aliases.ts` and `tsconfig.json`.

### D3. One stable fog node

- `getFogNodes()` makes the uniforms once per page (the `getSurfaceConditionNodes()` pattern):
  the colour, the mode weights, each mode's parameters, the sun's direction and colour, the master
  enable. The system writes their `.value`s in place each frame; nothing allocates.
- `FogNode.ts` builds one graph over them: the three factors weighted by one-hot mode uniforms
  (`LINEAR` from `rangeFogFactor`, `EXP2` from `densityFogFactor`, `HEIGHT` from D4), × the
  enable, into `fog(colorNode, factor)`, where `colorNode` is the fog colour moved toward the sun by
  the sun glow (D4, its `enabled` a uniform weight). **Switching modes, the sun glow or the master
  switch never recompiles**; computing all three factors and the glow costs a few ALU per pixel.
- `rootScene.fogNode` is that node while the current scene has a fog and null otherwise, set in
  `worldCleared` (before the scene's materials compile) and cleared in `exit`. A scene without a
  fog pays nothing; one with a fog switched off pays the few ALU (the master switch's price, for a
  switch without a hitch).
- Only the root scene: viewports, the env ball, snapshots' and bakes' own scenes have no fog node.
  A game that wants the fog in a viewport's scene sets `fogNode` there from `getFogNodes()` (a
  documented recipe, not an API).

### D4. `HEIGHT` mode and the sun glow

- The density at height `y` is `density · exp(−falloff · (y − baseHeight))`. Integrated along the
  ray from the camera to the pixel (the closed form, with the `|Δy| ≈ 0` case's limit taken with a
  small epsilon), from `startDistance` on, the factor is `1 − exp(−∫)`, clamped to `maxOpacity`.
  Three's `exponentialHeightFogFactor` isn't that integral (it's a height mask × the depth), so
  this is our own `Fn`, unit-tested on its CPU twin.
- **The sun glow** (`sunScattering`, every mode): the fog's colour moves toward the sun's colour
  by `enabled · strength · pow(max(dot(viewDir, sunDir), 0), exponent)`, so the fog glows around
  the sun and the side away from it keeps the horizon's colour. It changes the colour, not the
  factor, so it works the same over `LINEAR`, `EXP2` and `HEIGHT`. On by default for `HEIGHT`
  only (D2). Without a sun source the glow is 0.

### D5. Following the sky

- The sky box gains a public `getSkyHorizonColor(out, { direction? })` (`SkyColor.ts`, on
  `aekasha/skybox`): the composite's colour at the horizon in a direction (default: away from the
  sun), on the CPU from `computeInscatter` and `composeAtmosphere`'s transmitted, tint and exposure
  terms (a CPU twin of the GPU composition, tested against it); a `COLOR` base's colour; null for
  a texture-only sky box or without one.
- The fog gains `setFogColorSource((out: Color) => boolean)` and
  `setFogSunSource((dir: Vector3, color: Color) => boolean)`, each read once a frame into the
  uniforms (false: use the definition's `color`, no glow). Under `colorSource: 'MANUAL'` the
  colour source isn't read; the sun source still is, for the glow.
- **The sky's colour is the default** (`colorSource: 'SKY'`), the colour of our own the option.
  The CPU horizon colour can drift from the GPU composite where the horizon tint and the exposure
  move fast (dusk, dawn): Phase 3 measures it at those hours, and a scene whose look needs an exact
  colour there uses `MANUAL` (or a `MANUAL` colour that `updateFog` tweens over the day).
- The template's `appECSPlugins` wires both next to `setSurfaceSunSource`: the horizon colour at the
  camera's azimuth, and `getSunDirection` with the sun light's colour × intensity. (As built,
  Phase 3: the horizon away from the sun, and the sky's horizon toward the sun as the glow's
  colour; the getter is in `SkyHorizonColor.ts`, and measured no drift at dusk.)
- Both colours are linear HDR before tone mapping, like the fog, so the far fog meets the sky's
  horizon band on the day-night cycle. Above the horizon, geometry against the sky keeps its
  silhouette; fogging the sky itself is a non-goal.

### D6. The public API (`aekasha/fog`)

`fog()`, `setFogEnabled(on)` / `isFogEnabled()` (the whole system, kept across scenes),
`setFog(idOrDefinition | null)` (another of the current scene's `fogs` by id, a definition made
in code, or none),
`updateFog(partial, { transitionSec? })` (the numbers and the colour tweened on frame time, the
latest call winning; what p427's weather drives), `getFog()` (the current definition, read-only),
`onFogChange(listener)` (returns its remover), `getFogNodes()`, `setFogColorSource`,
`setFogSunSource`. Each with JSDoc and an `@example` (entry APIs).

### D7. Interactions

- **Debug helpers get `fog = false`:** the 3D symbols (`debug/symbols/3DSymbols.ts`), the env
  ball and the axes gizmo (`features/viewports/`), the lines' debug draws. The bakes, rain
  occlusion and shadow materials already have it.
- **Impostors** are fogged at the billboard plane's depth, not their per-pixel `depthNode`:
  accepted (the error is the billboard's depth spread).
- **The terrain's far surface** (`distance.far`) is unchanged; fog complements it.
- **PostFX AO** darkens fogged distance (it runs after the materials' fog): noted on the Hub page,
  with the AO pass's distance fade as the fix.
- **Transparent and additive materials** are fogged toward the colour like three's fog does; a
  material that shouldn't be (a glow) sets `fog = false`.
- Fog is visual: frame time, no simulation lint, not saved with a game (p425 saves p427's state,
  which sets the fog).

### D8. The debug tab

- `debug/_dbg__Fog.ts`: `createDebuggerTab({ id: 'fogControls', title: 'Fog', icon: 'fog', … })`,
  loaded through `ctx.onDebug` inside `if (IS_DEBUG_ENV)`, its id in
  `DEFAULT_DEBUG_DRAWER_TAB_ORDER` after `surfaceConditionsControls`. A property grid of the UI
  kit's fields: the master switch, the mode (a segmented control), the colour's source (`SKY`, the
  sky's live colour shown; `MANUAL`, the colour field of our own, seeded from the sky's current
  colour when switched), the mode's parameters (only the current mode's shown), the sun glow (its
  switch in every mode, its strength and exponent), the background, and a **fog factor view** (the factor in grey: a debug-only node
  swap, which recompiles, fine in the debugger).
- Edits go through undo and a save source (`registerSaveSource`, after
  `features/skybox/debug/_dbg__SkyBoxSave.ts`): the Æ menu's Save writes the scene's `__saveData`
  entry into its `.fog.json` (or the inline definition into the scene JSON), and Copy JSON copies
  the whole definition.
- **The icon** `fog` (`src/_engine/ui/core/icons/svg/fog.svg`; listed in `BuiltInIcons.ts`, the
  `BuiltInIconName` union and `BUILT_IN_ICONS` in `SvgIcon.ts`, `ui/index.ts`), a line icon in
  the style of `post-fx.svg`: a sun setting behind three staggered haze lines. The draft:

  ```svg
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" class="bi bi-fog" viewBox="0 0 16 16">
    <path stroke="currentColor" stroke-width="1.1" stroke-linecap="round" d="M4.75 6.5a3.25 3.25 0 0 1 6.5 0"/>
    <path stroke="currentColor" stroke-width="0.75" stroke-linecap="round" d="M8 1.25v1M3.4 3.15l.7.7M12.6 3.15l-.7.7"/>
    <path stroke="currentColor" stroke-width="1.3" stroke-linecap="round" d="M1.5 8.75h13M3.5 11.25h11M1.5 13.75h9"/>
  </svg>
  ```

  Checked at 16 px in both themes and densities before it's final; the Hub's component library
  shows it with the other built-in icons (`yarn verify:ui`).

### D9. Sun light shafts (Phase 6, gated)

- `createFogLightShafts(ctx, params)` on `aekasha/fog`: three's `godrays(depth, camera, light)`
  (`three/addons/tsl/display/GodraysNode.js`, `import()`ed on first use, never in the initial
  chunk) at half resolution, composited with `depthAwareBlend`, its density and colour from
  `getFogNodes()` so the shafts belong to the fog. The light is the sky box's sun
  (`getSkyLightIds()` → the directional light, wired by the app like D5's sources).
- The app's `src/app/postFx/lightShafts.postFx.json` and `lightShafts.tsl.ts` wrap it as a pass.
- Its requirements are the addon's: the `postFx()` feature, a sun that casts shadows, receivers.
  It refuses (warns once, renders nothing) without them.

## Phases

### Phase 1: The feature, its data, `LINEAR` and `EXP2` — done

1. `features/fog/` with D1's files, the schema (D2) and `aekasha/fog`'s entry and alias.
2. The gather pipeline (D2): the suffix, `readFog`, `resolveFog`, the schema part, `SceneData`,
   `ENGINE_FEATURE_FACTORIES`; `devTools/gather/CLAUDE.md`'s suffix lists.
3. `getFogNodes()` and `FogNode.ts` with `LINEAR` and `EXP2` (D3); the system; the scene hooks;
   `setFogEnabled`, `setFog`, `getFog`, `onFogChange`; `background`.
4. The template's feature list (`src/index.ts`), and the SBP budgets it needs (Decided 4).
5. Tests: the schema (defaults, refusals), the gather (an id, inline, `__saveData` merged), the
   node is the same object across a mode switch and a toggle, the scene reset, the CPU twins of
   the factors.

As built:

- **A scene's `fogs` list** (Decided 3), each fog with `id` and `isDefault`; the gather fails on an
  id twice in a scene's list. `withIdDefault` (`gatheredJson.ts`) gives a sky box's and a fog's
  file its name as its id (`TYPES_WITH_ID_DEFAULT`). The development data's
  `__inlineAssets.fogs` names a scene's inline fogs, for Phase 4's save.
- **`resolveFogDef`** (`FogSchema.ts`, on `aekasha/schemas`) fills the defaults in at the gather's
  read, so `sunScattering.enabled` is the file's mode's; the scene pass deep merges the scene's
  entry over it (`applyFogSaveEntry`). `FOG_DEFAULTS`: `colorSource: 'SKY'`, `color: '#b4c0cc'`,
  `linear: { near: 10, far: 500 }`, `exp2: { density: 0.005 }`, `height: { density: 0.02,
  baseHeight: 0, falloff: 0.1, startDistance: 0, maxOpacity: 1 }`, `sunScattering: { strength:
  0.5, exponent: 8 }`, `background: 'NONE'`. The schema is strict (an unknown key fails) and
  refuses `linear.far` ≤ `near`. The whole schema is there; `HEIGHT` renders no fog until Phase 2
  (the debug env warns once).
- **The graph stays on the root scene until the scene's exit** (D3 said null without a fog):
  `setFog(null)` and switching fogs write `enabled` and the weights only, so they never recompile.
  A scene that starts without fogs and calls `setFog(definition)` recompiles once.
- **`getFogNodes()`** returns `FogNodes`: `node` (the graph) and its uniforms `color`, `enabled`,
  `modeWeights` (a vec3: x `LINEAR`, y `EXP2`, z `HEIGHT`), `near`, `far`, `exp2Density`
  (`FogNode.ts`, `createFogNodes`). The uniforms are written on a change (`setFog`,
  `setFogEnabled`, a scene's fogs), not every frame; Phase 2's tweens and Phase 3's sources write
  them from `fogSystem`. Kept drawable: no negative distance or density, `far` at least `near` +
  1 mm.
- **`fogSystem`** (MAIN, order 1, default world) does only `FOG_COLOR` so far: while the fog
  renders and the root scene has no `backgroundNode` and no texture background, the background is
  a `Color` of the fog's (over the scene's own `backgroundColor` too), and what was there comes
  back when it lets go (and at the scene's exit).
- **`onFogChange`'s reasons** are `'set' | 'update' | 'enabled' | 'clear'` (lowercase, as the sky
  box's `onSkyBoxChange`'s).
- **SBP** (Decided 4): the fog's group is 990 B gzip, budget 2 KiB; it took the initial to 416.4
  and `assets/index.js` to 412.2 KiB: 417 → 418 and 413 → 414 KiB. The baselines are recorded
  (`api.json` also took main's `keepOverlayWithOwner`, which `db5c995e` didn't record).
- **Not checked in a browser yet:** no scene lists a fog before Phase 5's `fogShowcase`.

### Phase 2: `HEIGHT` mode and transitions — done

1. D4's factor and the sun glow (every mode, `enabled`'s default by mode) in `FogNode.ts`, over
   the sun uniforms (set by hand until Phase 3 wires them), their CPU twins tested (the `Δy → 0`
   limit, the
   `maxOpacity` clamp, `startDistance`).
2. `updateFog(partial, { transitionSec })`: the tween (colour in linear space), the latest call
   winning, a scene exit ending it.

As built:

- **`HEIGHT`'s ray** is the camera-to-fragment one in world space, `cameraWorldMatrix ×
  (positionView, 0)` (right for sprites, fat lines and vertex nodes, as three's view depth is),
  and its length the Euclidean distance: `LINEAR` and `EXP2` keep three's view depth, so `HEIGHT`
  is a little thicker toward the screen's edges. The integral is `density · fogLength ·
  meanDensity`, `meanDensity = (ρ_start − ρ_end) / (falloff · Δy)`, the midpoint `(ρ_start +
  ρ_end) / 2` below `FOG_FLAT_RAY_EPSILON` (1e-3: the closed form's limit to second order), each
  end's exponent at most `FOG_MAX_DENSITY_EXPONENT` (60, so a camera deep below `baseHeight` gets
  full fog, not an overflow; the division takes the clamped exponents, so two clamped ends read
  as the midpoint). `getHeightFogFactor` (CPU, step for step) is tested against a numeric
  integral, up and down, across the epsilon, Beer-Lambert without a falloff, `startDistance`,
  `maxOpacity` and the extremes. A zero-length ray is taken as 1 µm.
- **The sun glow's uniforms:** `sunDirection` (unit, toward the sun; **zero is no sun, no glow**,
  what it starts with), `sunColor` (white until Phase 3), `sunStrength` (0 while `sunScattering`
  is off) and `sunExponent` (at least 1e-3: `pow(0, 0)` is undefined in WGSL). `getFogSunGlow` is
  its twin. Phase 3 writes the direction and the colour; D5's "colour × intensity" is HDR, so with
  a strength near 1 the fog toward the sun nears the sun's radiance: Phase 3 looks at it, and
  normalizes the colour if it's too much.
- **`FogNodes`** gained `heightDensity`, `baseHeight`, `falloff`, `startDistance`, `maxOpacity`,
  `sunDirection`, `sunColor`, `sunStrength`, `sunExponent`. Phase 1's "`HEIGHT` renders no fog
  yet" warning is gone.
- **The transitions** (`FogTransitions.ts`, the model as plain arrays): one channel per number
  the uniforms take (the colour's linear r, g, b, every mode's parameters, the glow's strength
  and exponent), the targets computed from the definition with the drawable clamps. A call moves
  only the channels whose target changed, from where they are; the others keep their running
  transitions (the latest call wins per value, `setSurfaceConditions`' rule). The far is kept
  past the near at the write, since they can move on different clocks. Switching the glow's
  `enabled` fades its strength (the uniform's a number); `mode`, `enabled`, `colorSource` and
  `background` switch at once.
- **The clock** is the sky's day-night one: `getElapsedTime()`'s change in `fogSystem` (stops
  with the master loop's pause and an editor view, scales with the play speed, not with the app
  pause alone), standing still while a scene loads.
- **`updateFog(values, { transitionSec? })`** (`FogUpdate`: a save entry's keys without
  `__meta`; `UpdateFogOpts`): `getFog()` returns the new values at once, only the rendered ones
  move; `'update'` fires once a call. It merges into a new object (the scene's data is never
  changed, so the next visit starts from its JSON), ignores non-finite numbers (and a colour with
  one), and warns and returns null without a fog. `setFog` and a scene's exit end every
  transition (at its target).
- **SBP:** the fog's group is 2083 B gzip (four modules), over Phase 1's 2 KiB: its budget 2 → 3
  KiB (`sbp.config.ts`, with the reason); the initial is 417.4 of 418 KiB. The baselines are
  recorded (`api.json`: `updateFog`, `FogUpdate`, `UpdateFogOpts` on `aekasha/fog`, the rest
  `@internal`).
- **Not checked in a browser yet** (no scene lists a fog before Phase 5): the graph compiles only
  on a GPU, so `HEIGHT` and the glow are checked there first.

### Phase 3: Following the sky — done

1. `getSkyHorizonColor` on `aekasha/skybox` (D5), tested against `computeInscatter` and the
   composite's terms; the sky box's `CLAUDE.md` and Hub page.
2. `setFogColorSource`, `setFogSunSource`; `colorSource: 'SKY'` (the default) and `'MANUAL'`.
3. The wiring in `src/AppECSPlugins.ts`.
4. In a real browser, the horizon colour against the sky's rendered horizon pixels at dawn, noon
   and dusk (`DAY_NIGHT`), the differences recorded here. A large one at dusk is fixed in the CPU
   twin first; if it can't be, the Hub page says to use `MANUAL` there (D5).

As built:

- **`getSkyHorizonColor(out, { direction? })`** (`SkyHorizonColorOpts`) is in its own
  `SkyHorizonColor.ts`, not `SkyColor.ts` (D5): every layer imports `toSkyColor` from there, and
  the getter imports the layers and `SkyBox.ts`. It's the composite at `dir.y = 0` in the
  direction's horizontal part (default: away from `suns[0]`; −z when neither has one), from the
  layers' CPU twins next to their nodes: `addSunGlow` (`layers/Sun.ts`: each enabled sun's halo,
  not its disc), `computeAtmosphereColor` (`layers/Atmosphere.ts`: `atmosphereParts` composed as
  `composeAtmosphere`) and `computeGroundColor` (`layers/Ground.ts`), × `env.backgroundIntensity`.
  A texture base counts as black behind the atmosphere (null without one); the stars, Milky Way,
  nebulae, moons and discs are left out; the clouds draw nothing at the horizon. Allocates nothing.
- **The sources** (`FogSkyColorSource`, `FogSunSource` on `aekasha/fog`): set once, kept across
  scenes, read on every change and every frame (`writeSources`, so an `updateFog` from a later
  stage never renders the fallback colour for a frame). Each writes a scratch copied only on true;
  a sun direction is normalized, none is zero (no glow). The colour channels' transitions still
  run: they're what `MANUAL` and `SKY`'s fallback show, and `colorSource` switches at once.
- **The wiring** (`AppECSPlugins.ts`, decided at the review): the fog's colour is the horizon
  **away from the sun** (the getter's default), not at the camera's azimuth (D5): the camera's
  azimuth brightened the whole fog when looking at the sun, and the glow brightened it again. The
  glow's colour is **the sky's horizon toward the sun** (`getSkyHorizonColor` with the sun's
  direction), not the sun light's colour × intensity (D5) nor its colour × horizon fade (the review's
  first choice): no public API gives the light's fade (its configured intensity's default is the
  sky box's internal 3), and the sky's own colour there can't outshine the sky, goes orange at
  sunset and dark at night by itself. The far fog meets the sky on both sides.
- **Measured** (2026-11-26, Windows Chrome 157, WebGPU, AMD RDNA 3; `skyShowcase`'s `dayNight`,
  hours 0-21; the background node alone rendered into a float target, linear before tone mapping,
  its horizon pixel looking horizontally, against the getter in the same direction):
  - Away from the sun and to its side, by day: equal within 3e-6 absolute (float32 vs float64), at
    dawn and dusk (sun at 0.1°, 2.7°, 5.3°) too. **No drift at dusk**: the horizon tint and the
    exposure are uniforms the twin reads, not something it estimates.
  - Toward the sun: the first run missed the sun's halo (`glowIntensity` 0.4 in `DAY_NIGHT`), so
    after sunset (sun −2.5° to −10°) the sky showed a dim red glow (0.06 linear) where the twin
    gave 0.0003; `addSunGlow` fixed it: now within 5e-4 at every hour but one, the sun 0.1° above
    the horizon, where the pixel is on its disc (11.2 vs 4.9: the disc is left out on purpose).
  - At night, to the side: up to 0.003 linear (the twin 0.0003): the stars and the Milky Way,
    left out. Away from the sun (the fog's colour) equal.
  - No `MANUAL` note is needed on the Hub page for dusk.
- **In the app** (the same run): a `HEIGHT` fog set from code on `skyShowcase` at 18.25 h compiled
  and rendered on WebGPU without an error (Phase 2's graph, first on a GPU), its colour uniform
  equal to `getSkyHorizonColor` in the same frame (`fogSystem` after `skyBoxSystem`), its sun
  direction `getSunDirection`'s, its glow colour the sky's toward the sun (16.2, 4.3, 0.9 at a
  2.7° sun: the sky's brightness there, so the fog toward the sun reads as the sky behind it).
- **Tests:** `SkyHorizonColor.test.ts` (10: against `computeInscatter`, `computeExtinction`,
  SkyMesh's night floor, the exposure, the background intensity, the direction, the halo, the
  ground), one in `SkyBox.test.ts` (the getter through an update and a clear), four in
  `Fog.test.ts` (the sources).

### Phase 4: The debug tab

1. The icon (D8), in the component library.
2. `_dbg__Fog.ts`: the pane, undo, the save source, Copy JSON, the fog factor view.
3. `fog = false` on the debug helpers (D7).

### Phase 5: The `fogShowcase` scene

1. `src/app/scenes/fogShowcase/`: a valley between hills (the toolkit's `rulesTerrain` or
   `generateTerrain`, so no new assets), a lake at the valley floor, a row of posts receding from
   the camera (distance at a glance), the `DAY_NIGHT` sky box standing still at a fixed hour.
2. A `*.fog.json` per mode (`fogShowcaseLinear`, `…Exp2`, `…Height`) and its tab (`_dbg__`):
   switch them, play the day (the colour following the sky), a dense valley fog preset.
3. Its `devTools/verify/scenes.config.ts` entry, a configuration per mode, baselines on the
   Windows Chrome (real GPU).

### Phase 6: Sun light shafts (gated)

1. Measure first: `godrays` on `fogShowcase` at 1080p, half resolution, through the PostFX
   profiler, on the dev GPU, with and without the depth pre-pass it needs.
2. **Go** when the pass costs ≤ 1 ms there and looks right with the engine's shadow settings
   (VSM, a reversed depth buffer): build D9, add it to `fogShowcase`'s chain (off by default, its
   tab's switch).
3. **No go**: record the figures in this plan, move the idea to p990's Rendering with them, mark
   the phase dropped.

### Phase 7: The Hub, the docs, the budgets, the version

1. The Hub: a feature page `hub/pages/features/fog/` (group World, after Surface conditions;
   `aek:covers` naming the new `CLAUDE.md`'s `##` sections), the API with `@example`s, an example
   page with `fogShowcase` and its `fogShowcase.hub.png`; `yarn hub:build`.
2. `features/fog/CLAUDE.md`; the root `.claude/CLAUDE.md` (the map, the Bootstrap flow's feature
   list: seventeen, the Architecture's `features/` line), `kernel/init/CLAUDE.md` (the count),
   `readme.md` (Features, the `*.fog.json` asset type).
3. `sbp.config.ts`: the `app` profile's `_engine/features/fog` budget and the raised `initial`
   budget, each with its reason; the banner budgets the folder at 0 by itself.
4. p427: fog is this plan's, p427 drives `updateFog` (its Related line, Grounding and open
   question 3 already say so).
5. Versions: engine minor (a new feature, the sky box's getter), app minor (the scene, the wiring),
   the toolkit untouched; `CHANGELOG.md`; `yarn checkVersions --against main`.

## Verification

- `yarn test` (the schema, the gather, the node's stability, the factors' CPU twins, the horizon
  colour against the composite).
- `yarn verify:scenes --only fogShowcase` (each mode's configuration) and the existing scenes
  unchanged (no fog without a `fog` field).
- `yarn verify:baselines` (no `_dbg__` code in production; the API baseline gains `aekasha/fog`
  and `getSkyHorizonColor`).
- `yarn sbp` (the fog feature only where it's installed, the light shafts' addon never in the
  initial download), `yarn verify:ui` (the icon), `yarn hub:build`.
- In a real browser (headless WebGPU doesn't render under WSL2): the day-night cycle on
  `fogShowcase` with `colorSource: 'SKY'`, the far fog meeting the horizon at dawn, noon and dusk;
  no hitch when switching modes, the sun glow or the master switch (the frame graph); the WebGL backend
  (`--webgl`) renders the same.

## Non-goals

- A raymarched or froxel volumetric fog (see "Why not"), local fog volumes, fog in the sky itself
  (the background), animated or noise-driven fog (a later `HEIGHT` option, if a scene asks),
  regional fog (p427's open question 6), fog in viewports' scenes (D3's recipe covers it).

## Decided (2026-11-26)

1. **The fog's colour:** the sky box's horizon colour is the default (`colorSource: 'SKY'`), a
   colour of our own the option (`MANUAL`); D2, D5. How close the CPU colour is at dusk is
   Phase 3's measurement, not a blocker: `MANUAL` covers a scene that needs exact colours there.
   (The GPU alternative, the env bake's PMREM sampled at the horizon,
   `getActiveEnvironmentTexture()`, would change the node on each sky box activation; not
   planned.)
2. **The sun glow in every mode:** `LINEAR` and `EXP2` take `sunScattering` too, off by default so
   they keep three's look; on by default for `HEIGHT` (D2, D4). It's a uniform weight in D3's one
   graph, so it costs nothing extra and switching it doesn't recompile.
3. **A scene lists its fogs** (`fogs`, like `skyboxes`), not one `fog` field: `setFog(id)` can
   only switch to fogs the scene's data holds, and Phase 5 switches three files in one scene
   (D2, D6).
4. **Phase 1 sets the SBP budgets** (`_engine/features/fog` and the raised `initial`), since the
   template lists `fog()` from then on and `yarn build` runs `yarn sbp`; Phase 7 only revisits
   them.
