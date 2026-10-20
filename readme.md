# Ækasha

**A high-performance WebGPU game engine framework for the web, built on Three.js and Rapier.**

Ækasha (`aekasha-js`) is the "fifth element" and the invisible medium where complex data turns into immersive, real-time 3D. It pairs Three.js's WebGPU renderer with a bitwise-packed ECS, a threaded Rapier physics core and a data-driven scene pipeline. Scenes are authored as validated JSON and extended with TypeScript, and a full in-browser debug suite tree-shakes out of production builds.

The repository is a template. It holds the engine, a toolkit of reusable modules and an example app, so you can clone it and start building your own game or interactive experience.

---

## Why Ækasha?

Building a serious 3D app on the web usually means gluing together a renderer, a physics engine, an asset loader, a game loop and a pile of debug UI, and then fighting the main thread for every millisecond. Ækasha puts those pieces together around a few principles:

- **Primordial performance.** Built for WebGPU from the ground up, with WebGL as the fallback. The GPU is the main canvas for logic and rendering.
- **Modular infinity.** A small ECS kernel, and the features you list at boot (physics, sky box, LOD, PostFX, …). You only bring in what you need, and nothing else ends up in the bundle.
- **Threaded reality.** Physics runs in a Web Worker by default, and transforms come back through a `SharedArrayBuffer`. Asset decoding can be moved off the main thread too, so the frame keeps flowing.
- **Smallest build possible.** Every byte before the first frame is a wait. A build carries only what the app uses: features opt in, Rapier and the loaders load on first use, and debug code never ships. `yarn sbp` measures every build, says why each part is in it and fails the build over a budget, and a scene is light enough to embed in any page with one call.
- **Data-driven, type-safe content.** Scenes, meshes, cameras, lights, materials, textures, skyboxes and PostFX passes are JSON files, checked against Zod schemas at build time and autocompleted in your editor.
- **Deterministic by design.** A scene simulates identically on every load, in both physics thread modes, and a built-in probe proves it.
- **Debug everything, ship nothing extra.** A rich debug drawer, a fly camera, undo/redo and physics visualizers load lazily in debug builds only.

---

## Features

Each feature has a page in the Ækasha Hub's Features section (`/hub/features/`: run `yarn dev` and open `http://localhost:8080/hub/features/`), with how it works, its key APIs, the issues that affect it and its example scene.

### Engine (`src/_engine/`)

- **Feature modules**: `InitEngine({ features })` installs the kernel (ECS, meshes, cameras, lights, input, scenes) and then only the features the app lists, each from its entry (`physics()`, `skyBox()`, `lod()`, …), plus the app's own. A feature reaches the kernel through one install context (ECS registrations, scene load phases, the fixed-step driver, the render pipeline, import extensions, debug hooks). Nothing registers itself on import, and a scene whose JSON needs a feature the app left out fails at boot with its name.
- **Smallest build possible**: `yarn sbp` reports each build's first download and what loads later, each feature's size and the import chain that put it there, and checks the budgets in `sbp.config.ts` (`yarn build` fails over one). A profile is a build to measure: the template app, and embeds like the banner, one scene made in code with no engine feature, the measured floor.
- **Embedding**: `mountAekasha({ target, width, height, layout })` mounts the engine into an element of a page it doesn't own (a hero, a product view, a background behind the content), without touching the page's styles or input. The canvas follows its container, the scene pauses out of view and respects reduced motion, and the handle loads scenes, pauses and unmounts (which stops the workers, physics' with its world). An embed profile builds as an ES module a site imports.
- **Rendering**: Three.js `WebGPURenderer` with automatic WebGL fallback, configurable tone mapping, color space and shadow maps.
- **ECS**: entity ids pack an index and a generation. Plugins and component hooks can be registered at runtime, systems run in fixed stages, and transform storage is either a `Map` or a typed-array (SoA) store.
- **Physics API**: an engine-agnostic facade with Rapier as the backend. It covers rigid bodies, colliders (including heightfields, and the bodies and colliders an imported glTF node's custom properties describe), impulse joints, ray casts and shape casts, contact and collision events, and fixed-timestep stepping with render interpolation.
- **Threaded physics**: `WORKER_THREAD` or `MAIN_THREAD` mode. The worker syncs every body's transform through one shared buffer per frame, never one message per body. The buffer is a lock-free triple buffer, so every system in a frame reads the same complete physics step. Every message between the threads goes through one transport, as plain data and in order: the seam a network channel will plug into.
- **Deterministic scene loads**: physics is held during a scene load, the world is recreated fresh, and stepping resumes only after every body exists. Simulation code draws its random numbers from named, seeded streams (`getRandomStream`) that every load restarts, so a scene draws the same numbers on every visit.
- **Physics simulation tiers**: a large world doesn't keep every body simulated. A dynamic body can be frozen in place but still collidable, disabled, or taken out of the physics world with its state kept, and comes back where it left off. A distance policy picks each body's tier from rings around a focus (the camera, an entity or a point), on fixed physics steps, so a scene driven by it stays deterministic in both thread modes.
- **Scene system**: JSON scenes with per-scene overrides (`__saveData`), a customizable scene loader with progress callbacks that runs one load at a time and leaves the current scene running when a load fails, and persistent or scene-scoped entities.
- **Assets**: glTF/GLB import (with meshopt and Draco), textures (including KTX2), HDR environment maps, per-scene asset ownership and release, and optional worker-thread loading.
- **LOD chains**: `generateLodChain` simplifies a registered geometry into a chain of lighter levels with meshoptimizer, in the asset worker. Each level records its triangle count and error, and shares the base's vertex buffer (only its index differs) unless asked for its own. Material groups are kept, and the chain is released with its base geometry. An imported asset asks for chains with `"lodChain": true` in its JSON: the asset pipeline builds them into the optimized GLB, so the client loads them instead of simplifying (and generates them after the load when the mesh isn't optimized). A mesh with `lod: "AUTO"` uses its chain's levels.
- **LOD selection**: a mesh (`lod` in its JSON or `createMeshEntity`'s props), an instanced-pool instance or a whole `InstancedMesh` (a cell of static instances) gets a level of detail from its projected screen size, so it holds its detail when the camera zooms in, perspective or orthographic. Each level can swap the geometry, the material and shadow casting, and the entity hides past its last level. Hysteresis keeps an entity on a boundary from flipping, and a global bias trades detail for speed. Levels are hand-made, or `"AUTO"`, from the geometry's LOD chain within a pixel error you choose. Nothing pops: every level change, and hiding or showing, cross-fades with a screen-space dither (0.25 s by default, 0 for an instant switch). The fade stays opaque, so shadows and post effects work through it. The example app's `lodShowcase` scene shows each kind of LOD in its own lane, every level on screen at once.
- **Impostors**: far LOD levels for instanced LOD pools that draw an object with a few textured quads. `generateCrossQuads` bakes it (a tree, a bush) onto two or three intersecting alpha-cut planes. `generateOctahedralImpostor` bakes it from a grid of directions on a sphere (or the upper half, for objects never seen from below) and draws one quad that faces the camera from any angle, overhead included, blending the three nearest views with a depth parallax so nothing pops as the camera moves. Only albedo, normals and depth are baked, never light, so impostors are lit by the scene's sun, shadows and day-night cycle like the real mesh, and they cast their silhouette's shadow. An octahedral impostor also writes its surface's depth, so it meets the ground and shadows itself like the mesh (`surfaceDepth: false` trades that for a cheaper flat quad). Impostors bake at load, or are exported once from the LOD debug tab into the repo (an `*.impostor.json`, its atlas and PNGs) and encoded as KTX2 by the asset pipeline: a scene that lists them in its `impostors` loads them instead of baking, at about a quarter of the GPU memory, and the debug build warns when the source mesh has changed since the export.
- **Asset optimization**: a build-time pipeline that turns the textures and models your asset JSONs point at into KTX2 textures, which stay block-compressed on the GPU (about a quarter of the VRAM of a PNG), and meshopt-compressed GLBs. Profiles and per-asset settings live in the JSONs, it can pack channels (eg. ORM maps from separate images), it keeps alpha-cut textures (leaf cards, impostors) from thinning out in their mip levels, and it gets colliders right (lossless geometry for collider meshes). A content-hash cache and a committed lock file mean a clone runs and builds without the encoder, and per-asset VRAM and download budgets fail the build when an asset grows past them. Optimization can be switched off for the whole project or one asset.
- **Cameras and lights**: ECS-managed perspective and orthographic cameras, all Three.js light types, frustum culling for objects and lights, and a follow-camera rig.
- **PostFX**: an ordered, per-scene chain of TSL passes (`*.postFx.json` + `*.tsl.ts`), switchable per pass at runtime, with ambient occlusion (GTAO) included.
- **Viewports**: extra render rectangles with their own scene and camera (picture-in-picture, minimaps, item previews), placed by the DOM and working with or without PostFX.
- **Snapshots**: render any scene through any camera into an image off screen, at any size (thumbnails, example images, save game pictures); by default what the canvas shows, through its PostFX, without the HUD, viewports or debug helpers.
- **Instanced mesh pools**: one `InstancedMesh` draws many instances, each of them an ECS entity with its own `Transform`. Instances can be moved, despawned (their slot is reused) and indexed in a spatial domain. An instanced LOD pool keeps one `InstancedMesh` per level and moves each instance to its level's, one draw call per level.
- **Lines**: line segments drawn 1px or at any pixel width (the thick-line backend loads on first use), in a colour or a pulse, solid or with screen-space dashes. A line is built once or refilled every frame without allocating, and lives on its own (gone with its scene unless persistent) or with an entity.
- **Spatial index**: uniform grids with an oversized tier for "what's near this point/volume" queries. Each ECS world can hold several named domains, each with its own cell size, capacity and update policy (rebuilt every frame, only when its members change, or on demand), and an entity can join several of them. A scene can register its own domains and settings (in code or in its scene JSON), dropped when it exits, and the default grid is built per scene only when something is indexed. Instanced-pool instances can be indexed too.
- **Ray casting**: physics ray and shape casts with per-frame statistics and debug helpers; the input picking casts Three.js rays the same way.
- **Input**: action maps bind named actions (buttons, 1D and 2D axes, mouse and drag deltas) to the keyboard, mouse, touch and gamepad, as plain data a settings screen can rebind. The simulation reads them once per fixed physics step, so a tap shorter than a step still lands on exactly one, while UI and debug keys get a callback at the press itself, also while the game is paused. Contexts switch whole sets of maps on and off (gameplay, debug, a menu), and a map's input can be recorded and replayed step by step (a ghost, a demo, a test). Gamepads use the standard mapping, with buttons named by position and radial stick deadzones. Under the action layer, the device bindings stay: key chords, picking on mouse clicks and hovers, touch gestures.
- **Characters**: a dynamic, physics-driven character controller that handles slopes and moving platforms, with swappable body plans (a humanoid capsule built in). Characters are driven through an intent object, which a brain writes once per physics step: the player brains (tank, world-fixed in 8 directions, camera-relative) read an action map, your own kinds (an AI, a script, a network peer) register by name, and code can write it too. Controllers are registered kinds as well, so a character can be rebuilt from data. On the main thread a character simulates the same way on every run: step-index time, a seeded random stream and synchronous probes. A locomotion state (idle, walk, run, jump, fall, slide, tumble, …) reports what each one is doing, and a physics-only control mode hands the body to physics, eg. for a ragdoll.
- **Sky box**: a layered sky that is both the background and the scene's environment lighting, so reflections match what you see. The base is a colour, an equirectangular (including HDR) or a cube map, and procedural layers go on top: a physically based atmosphere, up to four suns and two phased moons (each can drive a shadow-casting light), stars with a Milky Way, baked nebulae, clouds, a ground and ambient light. A day/night cycle moves the suns, moons and stars from a time of day you can play, pause, speed up or set from code. Presets (`DAY_SKY`, `NIGHT_SKY`, `DAY_NIGHT`, `SPACE`) give a starting point for a definition.
- **UI kit** (`aekasha/ui`): the DOM UI the debug tools are built from, for the app's own HUD: a lightweight component helper (`CMP`) that updates in place, a HUD layer over the canvas, draggable windows (one per entity or item as a window kind, kept over reloads and scene changes), modal dialogs that close on Escape before any key binding sees it, keyboard-driven drop-downs, toasts and an icon registry (a build keeps only the icons something registers). The Hub has a page and an example scene for it.

### Toolkit (`src/toolkit/`)

These are ready-made modules you can import as they are, or copy into your app and change. They're sorted by kind: the code through three entries (`aekasha/toolkit/ecs`, `aekasha/toolkit/geometry`, `aekasha/toolkit/materials`), the assets by id like the app's.

- **ECS effects** (`ecs/effects/`): `HoverEffect` (bobbing), `FollowTool` (follow a target), `SunShadowFit` (fits a directional light's shadow to the camera's view) and `MutualGravity` (gravity between bodies, for zero-g scenes).
- **Gameplay** (`ecs/gameplay/`): a camera rig that follows an object (looking at it, or keeping a fixed view direction, with an optional look-ahead in the direction of travel), and kinematic moving platforms that characters ride.
- **TSL materials** (`materials/<id>/`): triplanar checkerboard, triplanar grid and asteroid materials, each a material JSON with its TSL file.
- **Procedural geometry** (`geometry/`): seeded noise terrain, foliage, asteroids and scattering on surfaces, all from one seeded random generator.
- **Models** (`models/<category>/<id>/`): the Ækasha symbol, the Æ glyph extruded with a soft bevel, as a Draco-compressed GLB with its asset JSON, ready for `importAssetAsync`.

### Debug suite (debug builds only)

- A tabbed **debug drawer** (`h`) built on Tweakpane, with tabs for stats, main loop, renderer, physics, ECS, assets, PostFX (with a GPU profiler), skybox, spatial index, LOD, ray casting and characters. Its state is saved to localStorage.
- A **profiler window**, opened from the on-screen stats panels, the stats tab, the top on-screen tools or `F8`. Its tabs: an overview of frame, GPU, physics and memory figures; an objects breakdown (in view and total, with bars and short history); GPU memory (memory by category and owner, draw calls, a budget and leak-hunting snapshots); and settings. It measures only while it is open, and it can be enabled in production test mode.
- A **debug fly camera** (`F1`), an axes gizmo (`F10`), an environment ball (`F9`) and a debug scene loader.
- **Editor views**, switched from the top on-screen tools: an editor takes over the whole canvas with its own scene, orbit camera and drawers, while the game scene is suspended and resumes exactly where it was. The first is the **material editor**: every project material on a preview ball in a studio stage, picked from a filterable list. Its params and TSL inputs are edited live with undo/redo, and each material's edits, stage settings and camera pose, and the editor's layout, are kept over reloads.
- **Undo/redo** for changes made in the debugger.
- A **dev file server** in `yarn dev`, so debug tools can write files into the repo (exported impostors and textures, scene save entries in an asset JSON's `__saveData`, stamped with the versions): token-protected, limited to the asset folders and to the server's machine (`AEK_DEV_FILES_LAN=true` allows the LAN, `AEK_DEV_FILES=false` turns it off), all or nothing per batch. A write reloads the page with the regenerated data.
- **Physics visualizers**: collider wireframes colored by body state and simulation tier, ray helpers, query statistics, and live body, slot and tier counts.
- **Edit windows per entity** (lights, cameras, ECS worlds, PostFX passes, physics entities, assets, characters), several open at a time, kept over reloads and scene changes. Double-clicking a window's header (or the Debug tools tab's "Center and fit all windows") brings windows back to the top of the screen, fitted to it.
- **Ray tester windows** for firing Three.js or physics rays at the scene.
- A **character state window** per character, showing its live data grouped and formatted, with freeze and copy. Its configuration values can be **edited live** (with undo, reset, copy-out as code and saving across reloads). It also toggles in-world **character gizmos** for the vectors and probes its controller decides from (velocity, facing, ground normal, floor ray and sensor, wall cast, trail), which can be pinned to stay after the window closes.
- A **determinism probe** (`?physicsProbe=N`) that hashes and diffs the physics state after N fixed steps.
- **Production test mode** (`?isProdTest=true`), which runs a production build with a subset of the debug tools.
- **Stress tests** for the ECS and physics.

---

## Technical highlights

| Area                   | How it works                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frame pipeline         | Fixed stage order every frame: `MAIN → APP_PRE_PHYSICS → [APP_PHYSICS_STEP × N] → APP_POST_PHYSICS → APP_LOGIC → APP_RENDER_SYNC → LATE_MAIN`. `APP_PHYSICS_STEP` runs once per fixed sub-step, in lockstep with the simulation.                                                                                                                                                                                                                                                                                                      |
| Physics ↔ render sync | A physics-owned transform buffer, which is a real `SharedArrayBuffer` when the page is cross-origin isolated (the dev server sends COOP/COEP headers) and falls back to one batched message per frame otherwise.                                                                                                                                                                                                                                                                                                                      |
| Worker commands        | The commands issued in `APP_PHYSICS_STEP` are captured per sub-step, carried in that frame's single STEP message, and replayed in order in the worker.                                                                                                                                                                                                                                                                                                                                                                                |
| Input at the step      | Action maps are sampled right before each fixed physics sub-step, with the presses and releases since the last sample counted, so brains and `APP_PHYSICS_STEP` systems read the same input whatever the frame rate, and a recording replays step for step. The layer installs its loop hook on the first map, so an app without one bundles none of it.                                                                                                                                                                              |
| Content pipeline       | `devTools/gatherAppData.ts` walks `src/`, validates every asset JSON file with Zod, generates typed runtime data and emits JSON Schema for editor autocomplete. It runs on every file save through a Vite plugin.                                                                                                                                                                                                                                                                                                                     |
| Asset pipeline         | Textures are encoded to KTX2 (Basis UASTC or ETC1S) and transcoded at load to whatever the device reads (BC7, ASTC, ETC2), in the transcoder's own workers. GLBs get meshopt geometry. Outputs are content-hashed, cached and committed.                                                                                                                                                                                                                                                                                              |
| LOD selection          | One distance and one multiply per entity (the camera terms are computed once per frame), after frustum culling. Only an entity whose level changed is touched; a pool instance moves between level meshes by a swap-remove. An optional cap spreads the selection over frames. A cross-fade keeps a pool instance in both level meshes, so it adds no draw call, and its per-frame work touches only the fading entities.                                                                                                             |
| Editor views           | An editor view takes over the frame: no ECS stage, scene looper or physics step runs, and physics resumes without catching up, so a visit to an editor keeps a scene deterministic. The editor renders its own scene and camera, with the viewports on top.                                                                                                                                                                                                                                                                           |
| Public entries         | The app and the toolkit reach the engine through 16 named entries (`aekasha`, `aekasha/<feature>`, `aekasha/toolkit/<category>`), and the engine takes the app's config and data through `InitEngine` instead of importing them. The lint makes a deep path an error, and the entries are side-effect free, so a build keeps only what the app uses.                                                                                                                                                                                  |
| Tree-shaking           | Debug implementations live in `_dbg__*` files that are loaded only through a dynamic `import()` behind `IS_DEBUG_ENV`, which a production build folds to `false` (`__AEK_DEBUG__`), so its bundle has no debug code, and `yarn verify:baselines` fails if any is left.                                                                                                                                                                                                                                                                |
| Smallest build         | A production bundle holds what the app lists and uses: features install only when listed, nothing registers at module load (a unit test checks it), `package.json`'s `sideEffects` lets the bundler drop unused modules, and Rapier, the glTF / Draco / HDR loaders, each TSL material and PostFX file, and the assets worker's jobs load on demand. `yarn sbp` measures it against per-profile budgets in `sbp.config.ts` on every `yarn build`; the Hub's Smallest build page shows the current numbers, generated from its report. |
| Save data              | Each asset file stores per-scene override history stamped with the engine, toolkit and app versions, and the gatherer warns when an entry comes from another major version.                                                                                                                                                                                                                                                                                                                                                           |
| Versioning             | Engine, toolkit and app are versioned independently, with release tags and a checksum meta tag in the built HTML.                                                                                                                                                                                                                                                                                                                                                                                                                     |

---

## Getting started

### Requirements

- Node.js `>= 22.13.0` and Yarn `>= 1.22.15`
- A browser with WebGPU (recent Chrome, Edge or Safari; Firefox with WebGPU enabled). Other browsers fall back to WebGL 2.
- Only to add or change optimized assets: the `ktx` encoder (KTX-Software ≥ 4.4.0), which the pipeline downloads by itself on Linux, WSL2 and macOS. Running and building the committed assets doesn't need it.

### Install and run

```bash
git clone https://github.com/JarSeal/aekasha-js.git my-game
cd my-game
yarn
yarn dev            # http://localhost:8080
```

Open `http://localhost:8080/?isDebug=true` to get the full debug suite, then press `h` to open the drawer.

### Commands

| Command                                       | Description                                                                                                                                                                                                                                                                                               |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `yarn dev`                                    | Dev server (development env) with hot scene/asset regeneration.                                                                                                                                                                                                                                           |
| `yarn dev:https`                              | `yarn dev` over HTTPS (self-signed) on port 8443, for testing on a phone.                                                                                                                                                                                                                                 |
| `yarn dev:test`                               | Dev server with `VITE_APP_ENV=test`.                                                                                                                                                                                                                                                                      |
| `yarn dev:production`                         | Dev server with production env vars.                                                                                                                                                                                                                                                                      |
| `yarn build`                                  | Type-check and production build to `dist/` (bundle treemap in `dist-stats/`). Fails on a shipped asset with no optimized output or over its budget.                                                                                                                                                       |
| `yarn build:test`                             | Production build with `VITE_APP_ENV=test`.                                                                                                                                                                                                                                                                |
| `yarn lint`                                   | ESLint with Prettier.                                                                                                                                                                                                                                                                                     |
| `yarn test` / `yarn test:watch`               | Unit tests (Vitest) for the engine's pure modules and the asset schemas.                                                                                                                                                                                                                                  |
| `yarn verify:scenes [--only <id>] [--update]` | Loads every scene in every physics configuration and compares console errors, determinism hashes and snapshots with the last good run (kept locally). Runs for up to an hour; `--config quick` is one configuration, and `--browser firefox` checks the determinism hashes in Firefox against Chromium's. |
| `yarn verify:baselines [--update]`            | Diffs bundle sizes, the API surface and JSDoc coverage against the committed baselines in `devTools/verify/baselines/`. A folder's undocumented exports may not grow; `--docs` checks only that, without the build.                                                                                       |
| `yarn docs`                                   | TypeDoc's own HTML API docs for the engine and toolkit, written to `docs-api/`.                                                                                                                                                                                                                           |
| `yarn sbp [--profile <id>,… \| all]`          | The Smallest Build Possible report: builds the profiles in `sbp.config.ts`, reports what loads before the first frame and later, each feature's size and why it's in the build (`--why <x>`), and fails over a budget. `yarn build` runs it (`AEK_SBP=false` skips it).                                   |
| `yarn verify:embed [--profile <id>]`          | Mounts each embed profile's build into a plain page in Chromium, inline and as a background, and checks its size, the page's styles and errors.                                                                                                                                                           |
| `yarn hub:build`                              | Builds the Ækasha Hub (guides, examples, API reference, issues, changelog) into `dist-hub/`. `yarn build` runs it too.                                                                                                                                                                                    |
| `yarn hub:preview [--base /hub/]`             | Serves `dist-hub/` locally (port 8090) the way a static host would.                                                                                                                                                                                                                                       |
| `yarn gatherAppData`                          | Runs the JSON → generated data pipeline by hand.                                                                                                                                                                                                                                                          |
| `yarn setupAssetTools [--force]`              | Downloads the KTX2 texture encoder into `.tools/` (Linux, WSL2, macOS).                                                                                                                                                                                                                                   |
| `yarn assets [--only <id\|glob>]`             | Optimizes the asset JSONs' textures and models (KTX2, meshopt), with a cache.                                                                                                                                                                                                                             |
| `yarn checkVersions [--against main]`         | Checks the versioning rules (run it with `--against main` before opening a PR).                                                                                                                                                                                                                           |
| `yarn tagRelease`                             | Tags the engine, toolkit and app versions after a merge to `main`.                                                                                                                                                                                                                                        |

### URL flags (development and test builds)

| Flag                    | Effect                                                                                                                           |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `?isDebug=true`         | Full debug tooling.                                                                                                              |
| `?isProdTest=true`      | Production behavior with a subset of the debug tools.                                                                            |
| `?startScene=<sceneId>` | With either of the above, starts in that scene instead of the usual start scene (eg. `?isDebug=true&startScene=examplePhysics`). |
| `?physicsProbe=N`       | Freezes physics N steps after each scene load and logs a state hash diff.                                                        |
| `?aekTest=true`         | Installs the test bridge (`window.__AEK_TEST__`) that `yarn verify:scenes` drives, and a fixed 1/60 s frame clock.               |

---

## Project structure

```text
.
├── src/
│   ├── _engine/            # The engine: stable library code
│   │   ├── index.ts        # The aekasha entry: the kernel's public API
│   │   ├── kernel/         # What every app runs, a folder per area: ECS, loop, config,
│   │   │                   # init, scenes, assets (and their worker), rendering, cameras,
│   │   │                   # lights, meshes, input
│   │   ├── features/       # A folder per opt-in feature, with its entry (aekasha/physics,
│   │   │                   # …), worker and debug/: physics, character, skybox, lod,
│   │   │                   # spatial, instancing, lines, postfx, viewports
│   │   ├── ui/             # The UI kit (aekasha/ui): CMP, HUD, windows, dialogs, toasts, icons
│   │   ├── debug/          # The debugger framework (aekasha/debug); the kernel's and the
│   │   │                   # features' own _dbg__* modules sit in their debug/ folders
│   │   ├── schemas/        # Zod schemas for every asset JSON type
│   │   ├── utils/          # Pure helpers: logging, storage, asserts
│   │   └── types/          # Global type declarations
│   ├── toolkit/            # Reusable modules by kind, each code kind an entry
│   │   ├── ecs/            # (aekasha/toolkit/ecs) effects/ and gameplay/
│   │   ├── geometry/       # (aekasha/toolkit/geometry) generate/, scatter/, a seeded random
│   │   ├── materials/      # (aekasha/toolkit/materials) a TSL material per folder
│   │   └── models/         # Models by category: brand/aekashaSymbol/
│   ├── app/                # Your game
│   │   ├── scenes/         # A folder per scene: its JSON, code and the assets only it uses
│   │   ├── examples/       # The Hub's example scenes
│   │   ├── shared/         # Code several scenes use
│   │   ├── profiles/       # An embed profile per folder: its entry and scene (banner/)
│   │   └── cameras/, lights/, textures/, …  # The assets several scenes use, by type
│   ├── generated/          # The gathered scene and asset data, handed to InitEngine
│   │                       # (written by yarn gatherAppData, committed); profiles/<id>/
│   │                       # holds each embed profile's
│   ├── AppECSPlugins.ts    # The app's own feature: wires app and toolkit systems into the ECS
│   ├── AppECSRegistry.ts   # The app's own component keys (added to the engine's component map)
│   ├── CONFIG.ts           # App configuration (physics, debug keys, debug camera…)
│   ├── index.ts            # App entry: renderer, scene loader, first scene
│   ├── public/aek-assets/  # Optimized asset outputs (generated, committed)
│   └── index.html
├── hub/                    # The Ækasha Hub's sources: pages (HTML + Markdown), shell, styles
├── devTools/               # Data gatherer, asset pipeline, Hub generator, yarn sbp, the
│                           # verify commands, version checks, release tagging
├── docs/
│   ├── issues/             # Known issues and their workarounds (also on the Hub)
│   ├── plans/              # Feature plans and specs (priority-ordered)
│   └── techniques/         # How-to guides (eg. asset optimization, writing Hub pages)
├── .schemas/               # Generated JSON Schemas for editor autocomplete
├── assets.config.json      # Asset optimization defaults, profiles and rules
├── assets.lock.json        # Asset pipeline cache index (generated, committed)
├── sbp.config.ts           # The builds yarn sbp measures and their budgets
├── CHANGELOG.md
└── vite.config.ts
```

The engine stays stable, the toolkit ships with it, and `app` is yours to change. The split is a lint rule: the engine imports neither the toolkit nor the app, and everything outside the engine imports it through its public entries (`aekasha`, `aekasha/physics`, …, `aekasha/toolkit/ecs`), never by a path into `src/_engine/`.

---

## Examples

### 1. Boot the engine

```ts
// src/index.ts
import * as THREE from 'three/webgpu';
import { InitEngine, createRenderer, createSceneLoader, loadScene } from 'aekasha';
import { physics } from 'aekasha/physics';
import { skyBox } from 'aekasha/skybox';
import { postFx } from 'aekasha/postfx';
import config from './CONFIG';
import { appData } from './generated'; // written by yarn gatherAppData
import { appECSPlugins } from './AppECSPlugins';

InitEngine({
  config,
  data: appData,
  // Installed after the kernel, in this order; a feature not listed isn't in the build
  features: [physics(), skyBox(), postFx(), appECSPlugins],
  start: async () => {
    await createRenderer({
      antialias: true,
      toneMapping: THREE.ACESFilmicToneMapping,
      enableShadows: true,
      shadowMapType: THREE.VSMShadowMap,
    });
    createSceneLoader({ id: 'main-scene-loader' /* loader UI callbacks… */ });
    await loadScene({ sceneId: 'myScene' });
  },
});
```

### 2. Author a scene in JSON

Each file is validated against its schema, and the `$schema` line gives you autocomplete in the editor.

```jsonc
// src/app/scenes/myScene/myScene.scene.json
{
  "$schema": "../../../../.schemas/scene.schema.json",
  "id": "myScene",
  "sceneFile": "./scenes/myScene/myScene.ts",
  "name": "My scene",
  "cameras": ["mainCamera"],
  "lights": ["ambientLight"],
  "materials": ["triplanarCheckerboard"],
  "meshes": ["testMesh"],
  "skyboxes": ["basicSkybox"],
}
```

```jsonc
// src/app/scenes/sceneTestECS/testMesh.mesh.json
{
  "$schema": "../../../../.schemas/mesh.schema.json",
  "props": {
    "appId": "testMesh",
    "geo": "testSphere",
    "mat": "triplanarCheckerboard",
    "castShadow": true,
    "position": { "x": 4, "y": 1, "z": 2 },
  },
}
```

A mesh can have levels of detail. Each level starts at a screen size (the mesh's bounding-sphere diameter over the viewport height) and can swap the geometry, the material and shadow casting. Below `cullScreenSize` the mesh is hidden. Changes cross-fade over `fadeSeconds` (default 0.25, 0 switches at once). `"lod": "AUTO"` reads the levels from the geometry's LOD chain instead.

To see it all at work, load the `lodShowcase` scene (`src/app/scenes/lodShowcase/lodShowcase.ts`). Its lanes run away from the start camera with an object in every level band: hand-made levels in a `*.mesh.json`, a generated chain with `AUTO`, an instanced tree pool ending in cross-quads, an instanced pool ending in an octahedral impostor, a baked and an exported impostor side by side, and a static instance cell. In a debug build its "LOD demo" tab has camera stops on both sides of every switch, a dolly down the lanes, the time of day and each lane's levels and triangles.

```jsonc
// in testMesh.mesh.json's "props"
"lod": {
  "levels": [
    { "screenSize": 0.1 },
    { "screenSize": 0.03, "geo": "testSphereLow", "castShadow": false },
  ],
  "cullScreenSize": 0.005,
},
```

### 3. Optimize textures and models

Put the source next to its asset JSON and choose a profile. On save, the dev server encodes it into `src/public/aek-assets/`, and the scene loads the KTX2 instead of the PNG. Commit the output and `assets.lock.json` with the source.

```jsonc
// src/app/textures/rock.texture.json
{
  "$schema": "../../../.schemas/texture.schema.json",
  "id": "rock",
  "fileName": "./source/rock_albedo.png",
  "texOpts": { "colorSpace": "srgb" },
  "optimize": { "profile": "hero", "slot": "baseColor" },
}
```

`*.importedAsset.json` files take the same `optimize` key. See [`docs/techniques/asset-optimization.md`](docs/techniques/asset-optimization.md) for profiles, channel packing, budgets, colliders and opting out.

### 4. Add code-driven content and physics

The `sceneFile` exports a `scene` function that runs while the scene loads.

```ts
// src/app/scenes/myScene/myScene.ts
import { createGeometry, createMaterial, createMeshEntity } from 'aekasha';
import { createPhysicsEntity } from 'aekasha/physics';

export const scene = async () => {
  const position = { x: 0, y: 5, z: 0 };
  const geo = createGeometry({ id: 'ball', type: 'SPHERE', params: { radius: 0.4 } });
  const mat = createMaterial({ id: 'ball', type: 'STANDARD', params: { color: 0xff5533 } });

  const ballId = createMeshEntity({ geo, mat, position, castShadow: true }, { appId: 'ball' });

  // Attach a dynamic rigid body. Its transform syncs back to the mesh every frame.
  await createPhysicsEntity(
    { type: 'BALL', radius: 0.4, restitution: 0.6 },
    { rigidType: 'DYNAMIC', translation: position },
    ballId
  );
};
```

### 5. Write your own component and system

```ts
// src/app/shared/Spin.ts
import * as THREE from 'three/webgpu';
import { ComponentType, ECSSystemStage } from 'aekasha';
import type { ECSWorld } from 'aekasha';

// The component's key, and its data's type added to the engine's component map
export const SpinComponentType = { SPIN: 'APP_SPIN' } as const;
declare module 'aekasha' {
  interface ComponentDataMap {
    [SpinComponentType.SPIN]: { speed: number };
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const step = new THREE.Quaternion(); // reused scratch, no per-frame allocation

const spinSystem = (world: ECSWorld, dt: number) => {
  for (const [entityId, { speed }] of world.getStorage(SpinComponentType.SPIN)) {
    const transform = world.getComponent(entityId, ComponentType.TRANSFORM);
    if (!transform) continue;
    transform.quaternion.multiply(step.setFromAxisAngle(UP, speed * dt));
    transform.setDirty();
    world.commitTransform(entityId, transform); // needed in both storage modes
  }
};

export const registerSpinSystem = (world: ECSWorld) =>
  world.addSystem(ECSSystemStage.APP_LOGIC, 'spinSystem', spinSystem);
```

```ts
// src/AppECSPlugins.ts: the app's own feature, listed last in InitEngine's features
export const appECSPlugins: EngineFeature = {
  id: 'app',
  install: (ctx) => {
    ctx.registerPlugin((world) => registerSpinSystem(world));
  },
};

// Anywhere in scene code:
ecsWorld.addComponent(ballId, SpinComponentType.SPIN, { speed: 2 });
```

> Anything that moves physics bodies (poses, velocities, impulses, kinematic targets) goes in an `APP_PHYSICS_STEP` system, so it stays in lockstep with the simulation and deterministic.

### 6. Configure the app

`InitEngine`'s `config` (example 1): every key is optional, and one you leave out keeps its default, set by the part of the engine that reads it (`physics.workerTarget`: `'WORKER_THREAD'`).

```ts
// src/CONFIG.ts
const config: AppConfig = {
  physics: {
    enabled: true,
    gravity: { x: 0, y: -9.81, z: 0 },
    timestep: 60,
    workerTarget: 'WORKER_THREAD', // or 'MAIN_THREAD'
    useSAB: true,
    interpolationMode: 'RENDERER',
  },
  debugKeys: [{ id: 'sc-toggle-debug-drawer', chord: { key: 'h' } }],
};
```

### 7. Embed a scene in a site

An embed profile (`sbp.config.ts`) builds into `dist-embed/<id>/` with `yarn sbp --profile <id>`. Its entry binds the profile's data and features; the site copies the folder and mounts it into any element:

```ts
// src/app/profiles/banner/banner.embed.ts: the profile's entry
export const mount = (opts: BannerMountOptions) =>
  mountAekasha({
    data: appData, // src/generated/profiles/banner/: only the profile's scenes
    features: [],
    assetBaseUrl: new URL('.', import.meta.url).href,
    ...opts,
  });
```

```html
<!-- The site's page, with the build copied to /aekasha/ -->
<div id="heroScene"></div>
<script type="module">
  import { mount } from '/aekasha/banner.embed.js';
  const scene = await mount({ target: '#heroScene', height: '28rem' });
</script>
```

The page keeps its own styles and input; the scene pauses out of view, and `scene.pause()`, `resume()`, `loadScene()` and `unmount()` drive it.

The Ækasha Hub's Examples section (`/hub/examples/`) walks through nine examples: eight scenes, each in [`src/app/examples/`](src/app/examples/) and named "Example: …" in the scene dropdowns (the quick start, physics, a keyboard-driven character with a look-ahead follow camera, the toolkit's model and materials, the sky box and day-night, a component and system of your own, LOD and instancing, and a debug tab of your own; each page opens its scene with `?startScene`), and embedding the banner in a site, which runs live on its page.

The other example scenes, a folder each in [`src/app/scenes/`](src/app/scenes/), cover more: a physics and joints test, a physics simulation tiers demo (686 crates and a plough), a large procedural world with instancing and culling, a third-person character gym, a top-down character scene (world-fixed controls, hills, and sun shadows fitted to the view), and an ECS stress test.

---

## Roadmap

Planned work is specified in [`docs/plans/`](docs/plans/), where a lower number means a higher priority. Highlights:

- Saving the material editor's edits to the material JSON, and editing textures and more material properties there
- Physics objects in the scene JSON schema, physics world bounds, multibody joints and physics snapshot restore
- Component query caching
- A client device capability sniffer and GPU-driven culling

---

## Versioning and changelog

The engine, toolkit and example app each have their own semantic version and codename in `package.json`. The engine's codenames follow the sun's path, the toolkit's follow the moon's phases, and the app's follow life stages. The project version always matches the engine version. See [`CHANGELOG.md`](CHANGELOG.md) for the release history.

## Documentation

- **Ækasha Hub**: run `yarn dev` and open `http://localhost:8080/hub/` for the getting-started guide, a page per feature, examples, known issues and the changelog, all searchable (⌘K / Ctrl+K), or build it as a static site with `yarn hub:build`. To add or edit its pages, see [writing Hub pages](docs/techniques/hub-authoring.md).
- **API reference**: the Hub's Documentation section (`/hub/documentation/`): every engine and toolkit export with its signature, JSDoc and source link, searchable and linked from the other Hub pages. `yarn docs` still writes TypeDoc's own HTML to `docs-api/`.
- **Migration guide**: the Hub's `/hub/documentation/migration/`: what changes for an app in each major version, with the `migrateToEntries.ts` codemod for the entry imports.
- **Guides**: [`docs/techniques/`](docs/techniques/), eg. [asset optimization](docs/techniques/asset-optimization.md).
- **Design docs**: [`docs/plans/`](docs/plans/). Files prefixed `_DONE_` describe features that are already implemented.
- **Contributor and agent guide**: [`.claude/CLAUDE.md`](.claude/CLAUDE.md).

## Built with

[Three.js](https://threejs.org/) (WebGPU + TSL) · [Rapier](https://rapier.rs/) · [Vite](https://vitejs.dev/) · [TypeScript](https://www.typescriptlang.org/) · [Zod](https://zod.dev/) · [glTF Transform](https://gltf-transform.dev/) · [KTX-Software](https://github.com/KhronosGroup/KTX-Software) · [Tweakpane](https://tweakpane.github.io/docs/) · [stats-gl](https://github.com/RenaudRohlinger/stats-gl)

## License

MIT © JarSeal
