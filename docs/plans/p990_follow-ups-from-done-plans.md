Status: backlog | not-implemented
Category: Backlog

# Follow-ups From Done Plans — Backlog

Not a plan. The open follow-ups, known limitations and deliberately deferred items of implemented plans whose files were removed (2026-10-01; the character debugging plans p067-p069 and the Ækasha Hub epic p550-p555 on 2026-10-09; the p600 and p800 epics (p600-p621, p800-p809) and p063, p066, p094, p200, p344 on 2026-11-04), kept here so they aren't lost. Items that belong to an open plan were moved into that plan instead (p059's probe method → p063 and p555's readme question → p621, both done since; p101's open questions → p500; the p027/p140/p142 stats sources → the p220 profiler prompt, which p344 built; p804's form-level error → p355; p345's and p344's device budgets → p240). The LOD epic p350 left its Tier 4 research here when it was marked done (2026-11-10); its file is kept (`_DONE_p350_lod-system-research.md`).

Each item names the plan it came from; the full plan text is in git history (e.g. `git log --all -- 'docs/plans/_DONE_p059_*'`, then `git show <commit>^:<path>`). `_DONE_p050_spatial-index.md` was kept as is: the engine's runtime warnings link to it, and it holds the deferred spatial index optimizations. Re-check an item against the code before acting on it. When an item gets its own plan or is fixed, delete it here; delete this file when it's empty.

## Physics and interpolation

- **`NONE` interpolation shows each step one frame late** (p059). `object3DSyncSystem` copies TRANSFORM → Object3D at `MAIN`, before physics writes that frame's pose. Syncing the mesh after physics would remove it; it was left as is so `NONE` stays byte-identical to the old behaviour.
- **The Physics API tab's position editor streaks once under interpolation** (p059). It doesn't go through `setTransform`, so the interpolation history isn't reset.
- **`FIXED_PHYSICS` + worker at matched 60/60 Hz has ~17% jitter** (p059, headless). The pairing is unsupported and warned about.
- **Unchanged p059 non-goals**: `FollowTool`'s write-direction lag, smoothing `camera.lookAt`, an `EXTRAPOLATION` interpolation mode.
- **The other shared buffers can tear** (p063 non-goal): the debug-state buffer (wireframe colour states) and the step-stats buffer are `SharedArrayBuffer`-backed like the transform buffer, but read without its triple-buffer latch. Debug-only, per field, and right again on the next write; the same latch fixes them if they ever matter.
- **`MESSAGE_BATCH` still copies each push** (p063 non-goal): it carries only the used slots (`copyUsedBank`), but a transfer-and-return ping-pong would drop the copy. A protocol change with its own trade-offs.
- **A reused slot shows the deleted body's pose for up to a frame** (p063 risk): a slot reused in a bank latched before the new body's first write-back still holds the old pose. If it shows, the fix is at body creation (the creation pose as a pending write visible from the creation step), not in the buffer.

## Ray casting and physics queries

- **A batched physics query message** (`WORLD_QUERY_BATCH`, p142/p143) if gameplay or a multi-ray tester needs many queries per frame in `WORKER_THREAD` mode.
- **Ray tester extensions** (p143): multi-ray fire patterns (fan, grid, cone) on the existing `rays[]` state, a shape-cast tester (`castShape`) with a shape outline helper, and `countInStats` on `PickOpts` (`kernel/input/InputPicking.ts`) so a tester's pick click isn't counted as a Three.js ray.

## Debugger undo/redo

- Physics-object and character pose undo restores the pose only (p061): velocity isn't rolled back, and whatever drives the body keeps doing so (e.g. `thirdPersonGym`'s `dummyCharLooper`).
- Undo doesn't refresh the staged position/rotation fields of the physics-object and character edit windows (p061).
- Entities with generated app ids aren't recorded, since they can't be found again after a reload (p061).
- The 800 ms coalescing window is an untuned default (p061).
- Recordable but not wired (p061): the renderer's tone mapping exposure and device pixel ratio, and the physics global timestep (open question: do global perf/timing knobs belong in undo history at all?).
- The Debug Tools tab's "clear LS" button clears `AEK_debugTools` but not `AEK_debugUndoRedoSettings` (p062).
- "History size (per scene)" is per bucket, so the merged timeline (scene bucket + `'_global'`) can hold up to twice that many entries (p062).
- Toasts stack on rapid repeated undo/redo, one per action, with no collapsing (p062).

## Sky box

- **Retune the default day sky** (p112): with the sun at 30° it is very pale toward the horizon, and the default ground colour (`#3b3a36`) reads as nearly black against it. Both are SkyMesh's defaults and were never retuned. A preset change is a visible change: bump its template version and note it in the changelog.
- **three.js upgrades** (p110): `layers/atmosphere.ts` is a port of `examples/jsm/objects/SkyMesh.js` (r186, recorded in its header). On a three upgrade, diff that file and re-check the sky against SkyMesh side by side. r187 (p057): only docs and the `Fn` layout syntax changed in `SkyMesh.js`; the port needs nothing.
- **Deferred epic ideas** (p110 non-goals): auto-exposure / eye adaptation for night scenes (a PostFX pass), a precomputed-LUT atmosphere layer (Hillaire 2020 multiple scattering), volumetric 3D clouds and weather (the surface side of weather, i.e. wetness, puddles, rain ripples and snow coverage as global state that materials read, is planned in `p307_wet-and-dry-surface-states.md`; precipitation, clouds and a weather driver remain open here), day-night events (`onSunrise` / `onSunset`; today games poll the getters), a JSON write-back endpoint (the Skybox tab's "Copy JSON" covers authoring), the sky in viewports other than the env ball, sky boxes in secondary ECS worlds.
- **A lit material-preview env ball** (p115): a metal and dielectric pair next to the unlit ball. Overlaps with the material editor (p084).
- **Leaving unused sky box layers out of a build** (p612): the eight layers are 12.9 kB before minification (`SkyLights.ts` 3.5, `SkyTime.ts` 1.5, `SkyStaticLayers.ts` 1.0). A feature manifest can't fold them, because a code-made sky can name any layer. It needs an API, e.g. `skyBox({ layers })` listing the layers the app may build (`skyBox()` takes no options today).

## Rendering

- **More PostFX passes** (p070/p071): bloom, DoF, FXAA/SMAA/TRAA, SSR, god rays, … each a small follow-up on the existing pass registry (`features/postfx/PostFX.ts`); an AA pass also fixes the MSAA + screen-space AO edge problem (`docs/analysis/ambient-occlusion-options.md`). A per-pass stats readout fits the profiler: its Overview shows the PostFX total (`debug/profiler/_dbg__ProfilerSources.ts`), the passes one by one only `getPostFxPassStats()` in the console.
- **Cascaded shadow maps** (p066 non-goal): `SunShadowFit` (`aekasha/toolkit/ecs`) fits one shadow camera to the view, enough for a fixed-pitch top-down camera; a free third-person camera over a large world needs CSM.
- **Viewports** (p080): in the scene/asset JSON schema, and a debugger tab listing them.
- **Cluster (meshlet) LOD: evaluate three's `MeshletDrawingPipeline`** (p350's Tier 4, a research spike, no PR unless it leaves code; moved here when the LOD epic was marked done, 2026-11-10). three r187's experimental WebGPU addon (`examples/jsm/pipelines/`, set as `renderer.drawingPipeline`) clusterizes meshes at runtime into 64-triangle clusters with up to six simplified levels (its own bundled meshopt, a duplicate of the engine's `meshoptimizer` if both ship), culls per cluster on the GPU (frustum, normal cone, Hi-Z occlusion), selects LOD by projected error and draws indirectly. It falls back to the standard path for VSM shadow passes and several material features, and has no discrete levels, impostors or cross-fades. **The question:** does it pay for huge single meshes (a high-poly prop, a merged city block, a terrain block) and static `BundleGroup` content, the case it's made for? **Known** (`_DONE_p354` Phase 0, Apple M2): as a drop-in on `instanceStress`' instanced LOD pools it took everything over without errors, but was slower: the GPU frame 4.88 → 7.78 ms at 100k trees, the render submit 2.66 → 4.65 ms, and none of the ECS cost removed (small meshes fill 64-triangle clusters badly). Instanced LOD content stays on instance sets (`features/instancing/CLAUDE.md`). **Not measured:** large single meshes, `BundleGroup`s, its fallback under the VSM shadow, other GPUs. **The spike:** a scene with a few multi-million-triangle meshes (generated, or a GLB), the standard pipeline against the meshlet one, the CPU, GPU and compute frames from the stats panels, with the sun's VSM shadow on and off. Note that the engine owns `renderer.drawingPipeline` through `kernel/render/DrawingPipeline.ts`: setting three's pipeline over it stops the instance sets' dispatch (`instanceStress`' `?stressPipeline=meshlet` refuses on its set path), so using both needs the seam to compose them. Worth running when an app needs huge static meshes; p370's merged groups (p372) and HLOD proxies (p376) are the other answer for that content.
- **Post the two three r187 reports upstream** (p057 Phase 4 step 4, left for later by the user's call): `docs/issues/three-render-list-keeps-lights.md` and `docs/issues/three-cube-render-target-texture-link.md`, both `not filed yet`, each the report's text with a standalone page as the repro (`File at:` in its header). Posting is an outward action: the user does it. Then put the issue numbers in each file's status line and in `_DONE_p057`. Nothing waits on them: the PostFX pre-pass MRT (`prePassMRT`) and the sky box's cube target clears (`initEnvBakeTarget`, `initTarget`) stay until three ships the fixes, and go after a re-measure then. The third, `three-pass-compile-holds-renderer-state.md`, needs no report (fixed on three's `dev` by #35359); its "When a release has #35359" says what to change in `CompileQueue.ts` on the release that has it.

## Debugger

- **The PostFX window guesses a colour param's range** (p806): one with a channel over 1 is read as 0-255 and scaled (`features/postfx/debug/_dbg__PostFX.ts`), so an HDR float colour reads as 0-255 too. A colour space in the pass's `paramsMeta` would say which it is.
- **The 3D debug drawing's colours are off the tokens** (p806 and p801 non-goals): the physics wireframes (`features/physics/debug/_dbg__PhysicsDebugDraw.ts`) and the character gizmos (`_dbg__CharacterGizmos.ts`, see Characters) are colours in `.ts`, the 3D scene's, not the debugger's theme. `_dbg__PhysicsDebugDraw.ts` is over 800 lines and is split when it's next reworked (its header).
- **A debug key for "Center and fit all windows"** (p094): `fitAllDraggableWindowsToScreen` (`aekasha/ui`) exists and the Debug tools tab's button calls it (`debug/_dbg__DebugTools.ts`); a `DefaultDebugKeyBindings.ts` entry with a `category` would add the key. Touch-specific window handling (pointer events make dragging work, nothing more) was out of scope too.

## Profiler

- **More tabs** (p344, p807 left them out): a Physics tab (bodies awake / sleeping from the debug state buffer, contacts), a Frame / passes tab (`getPostFxPassStats` per pass, shadow passes, viewports), Assets / textures, Streaming cells (p353), LOD (p348's figures).
- **Captures and deeper figures** (p344): recording and exporting a capture (CSV / JSON), per-system ECS timings, `performance.measureUserAgentSpecificMemory()`, WASM and worker memory.
- **Detaching the window** into a second browser window (p344).

## UI kit

- **Not in the kit, by decision** (p800, p805 out of scope): a 3D in-world UI renderer (text and panels as meshes; the world anchors are DOM over the canvas), framework adapters (React, Vue, Svelte: the components are plain DOM through CMP), a visual UI editor, and in the table: editing in cells (a cell may hold a field, but there's no edit mode or commit model), a treegrid (a tree with columns; a later plan if p373's member list needs columns), multi-column sort, grouping and aggregation.
- **Virtual rows don't re-measure on a density change** (p805): the list's, the tree's and the table's `virtual` rows measure their height once (`ui/data/VirtualRows.ts`), so a density switch keeps the old height. `ThemeWatch.ts` can tell all three at once.
- **Checks never run by hand** (p803, p804, p805, p808): VoiceOver on the colour picker, the list, the tree and the table's grid mode (only axe in `yarn verify:ui` checks them); whether Firefox opens its Style Editor on Shift+F7 (the main loop's debug key; a browser shortcut a page may not be able to prevent) and the window cycle keys F6 / Shift+F6 on Windows and in Edge; the game UI's gamepad paths with a pad.
- **Small field gaps** (p804): a slider's or range slider's thumb without its input has no copy and paste (the text fields and spin buttons do); a vector field has no scrub on an axis' letter (the keys and typing are its paths).
- **One `aekasha/ui` entry** (p803 D10): revisit sub-entries at about 250 value names.

## Per-frame allocations

- **The ECS storage's `for … of` makes an entry array per entity** (p808): `IComponentStorage` (`kernel/ecs/ECSComponentStorage.ts`) is only `Iterable`, with no `forEach`.
- **`getCanvasSize()` makes two objects a call** (p808, `kernel/render/CanvasSize.ts`): an `out` argument, or a public resize listener, would end it for per-frame callers.
- **The kit tables allocate per render on a scheduler** (p807): `readRows`' arrays and closure, `place`, `placeElems`; 14-18 kB/s in the profiler's Objects and GPU memory tabs at 4 and 2 Hz. A "rows unchanged" path in the kit's table (`ui/data/`) would remove it.
- **The 3D debug symbols and the light helpers allocate every frame** (p807, measured): `debug/symbols/_dbg__Symbols.ts` about 21 kB/s, the light helpers 9 kB/s, in any debug session.
- **The debug tabs' leftovers** (p806, measured by p807): the Physics tab 14 kB/s (its list and the tiers' readout), the character state window 18-22 kB/s (its every-frame default interval and the `OTHER` rows).
- **The time series schedules one empty animation frame after each draw** (p807): p805's design for an app pushing every frame; at the stats panels' 30 Hz about 180 empty callbacks a second for six panels.

## Characters

- **`isMovingTowardsImpossibleSlope` is a dead field** (p067): the dynamic controller's data declares it (`features/character/controllers/dynamic/DynamicCharacterData.ts`), but nothing writes it, and the character state window shows it as it is. Implement it or remove it.
- **Rebuilding the body for baked config keys** (p069's Phase 4, dropped): the character state window keeps the keys baked into the colliders (`config.bakedKeys`, eg. `_radius`) locked. A rebuild swaps the colliders in place (async in `WORKER_THREAD` mode; the physics API (`aekasha/physics`) has no helper that adds colliders to an existing entity), must keep the character on a moving platform, and must rebuild back on undo. Saved values are applied after the colliders exist, so saved baked values would need a rebuild right after creation, or to be read before `getDimensions` and kept out of `initialConfig`. The app owns the visual, so a resized capsule wouldn't match the model.
- **Saving tuned character values into the scene source** (p069): there's no character JSON schema yet, so the state window's copy-out (as code) is the bridge.
- **Configurable character gizmo colours** (p068): they're constants (`GIZMO_COLORS` in `features/character/debug/_dbg__CharacterGizmos.ts`).
- **More controllers and body plans** (p066 non-goals): a flying controller (lift for gravity, a 3D intent, landing for "grounded") and a quadruped body plan next to `HUMANOID_CAPSULE` (`features/character/CharacterBodyPlans.ts`). Each reuses the registry, the component, the intent, the input schemes, the locomotion-state events and the state window. The kinematic controller, the animation state graph and the ragdoll hand-off have plans (p421, p422; p250's joints).
- **A `CameraIntent`** (p603 C3, a direction with no plan): the camera rig's look input as an intent, as `CharacterIntent` is the character's. Today `createFollowObjectCameraRig`'s `getMouseMoveInput` callback pulls a look delta from the app, and nothing passes one; the vehicle side (`VehicleIntent`) is p423's.

## Smallest build

- **A "lite" embed profile without TSL** (p611 §7.3, decided against for now): about 110 KiB gzip less on the banner (three 237.7 → 128.3 KiB), with classic materials only: no sky box, PostFX, viewports, fat lines, impostors, LOD fades or texture arrays. Revisit when three ships its node system apart from `WebGPURenderer`, or when a real embed needs well under 200 KiB. three r187 made `three/tsl` tree-shakeable (#34533) and dropped unused maths classes (#34619): the banner's `three` group went from 251.7 to 231.1 kB gzip (p057), so the gap is smaller; measure it again before deciding. Its shape: a lite flag in `sbp.config.ts` aliasing `three/webgpu` to `three`, a classic `createRenderer`, and the gatherer failing a lite profile's TSL scene.
- **Every scene's JSON is in the first download** (p377 Phase 3, `docs/plans/p377_hlod-streaming-cell-proxies.md`). `src/generated/index.ts` imports `generatedAppData.json` statically, so the app's first download carries every scene's data, a streaming scene's whole manifest included. p377's ruin kit in `streamingGrid` (meshes with their transforms, far groups, cells' lists and bounds) cost about 30 bytes gzip a mesh: 384 meshes in 64 cells were +11.6 KiB on the initial download, so it shipped with 96 in 16 cells (+3.4 KiB, the budgets raised: initial 398, `assets/index.js` 394, the `app` group 19 KiB). Streaming scenes are where it grows fastest: a world's content is in its JSON by design. The fix: the first scene's data in the first download and each other scene's loaded with its scene (a chunk per scene's data, as its `sceneFile` already is, or the manifest fetched by `created`), a gather and boot change (the registries, `__features` checks and the Hub's scene list read the data before a load). Smaller on the way: the cells' `bounds` unrounded (17 digits a number; to the centimetre saves 0.55 KiB of the 64-cell kit's 12.5).

## Ækasha Hub

- **The first real deploy** (p550, p551): check that the host's CDN keys its cache on the `?v=<hash>` query strings the Hub's `_assets/` references carry (`_headers` caches them as immutable). If it ignores them, switch to hashed file names. A host other than Netlify needs its own headers file.
- **A ringed-planet mark?** (p550): the homepage design's logo is a ringed planet, the brand's is the Æ. A combined mark (the Æ inside a ring) is a brand decision.
- **A standalone `yarn hub:dev`** (p551): the Hub's dev plugin in a bare Vite server, for content work without the engine's dev server. Not needed while `yarn dev` starts quickly.
- **A shared nav partial** (p551): every page renders its own copy of the nav. If a full rebuild gets slow with the API pages, the nav could become a partial the pages include.
- **Type hovers in code blocks** (p552): shiki's twoslash, checked against the real types. Heavy (a TS program per block), and the engine's types must resolve from a snippet. Worth a spike.
- **"Open in example scene" on an included snippet** (p552): a dev-only button that opens the scene the snippet comes from (`?startScene`).
- **The API docs** (p553): drop `yarn docs` / `docs-api/` once the Hub's Documentation covers everything it shows. Few engine files have a `@module` comment, so module summaries fall back to the first symbol's. A `@category` tag could group cross-folder APIs (input, UI) by subsystem instead of folder.
- **Leave the example scenes out of production builds?** (p554): they're in the app's scene list in every build. An `isExample` scene flag (like `isDebugScene`) could leave them out of the production data.
- **Live examples in the public Hub** (p554): the public Hub runs no engine, so its scene panels say how to run a scene locally. Hosting the built app next to it would make the "Open" links work there too.
- **The search index is over its warning mark** (p808): 485 KiB gzip at p808 against `SEARCH_INDEX_WARN_GZIP_BYTES` (450 KiB, `devTools/hub/search.ts`), which `yarn hub:build` warns about. Index less (code identifiers, the API pages) or split it.
- **A filter on the roadmaps** (p809): the roadmap pages are static; a client-side filter (status, category) could come as a Hub TS entry if the tables get too long.
- **More examples** (p554, p555): input and key bindings, viewports, PostFX, the material editor, the spatial index. The Input, Spatial index, and Viewports and views feature pages have no example scene (the Spatial index page points at `largeWorld`). Characters has its own (`exampleCharacter`).
