## Three layers

```text noLineNumbers
src/
  _engine/    the kernel, nine opt-in features, the UI kit, the debugger
  toolkit/    ready-made pieces: ECS effects and gameplay, geometry,
              materials, and assets (models, textures, sky boxes)
  app/        your game: its scenes, assets and code
  generated/  the scenes' and assets' data, gathered from their JSON
```

- **Engine ← toolkit ← app.** The engine imports neither the toolkit nor the app, and the toolkit
  doesn't import the app. The app's configuration and data reach the engine through
  [`InitEngine`](api:InitEngine), never by an import.
- **Outside the engine, only entries:** `aekasha`, a feature's (`aekasha/physics`, …),
  `aekasha/ui`, `aekasha/debug`, `aekasha/schemas` and the toolkit's (`aekasha/toolkit/ecs`, …).
  What no entry exports is internal (the [entries](hub:documentation#importing-the-engine)).
- **The lint enforces both**, and `yarn test` checks the folder layout: a file outside a known
  folder, or an import across a forbidden boundary, fails. The rules are in the
  [coding standards](hub:documentation/coding-standards#layering).

## The kernel and the features

The **kernel** is what every app runs: the ECS, the main loop, the configuration, scenes and the
scene loader, assets, the renderer, cameras, lights, meshes and input. A **feature** is
everything else, opt-in: `physics()`, `character()`, `skyBox()`, `lod()`, `spatial()`,
`instancing()`, `lines()`, `postFx()` and `viewports()`, each from its own entry, and the app's
own (`appECSPlugins`). `InitEngine` boots in this order:

```text noLineNumbers
InitEngine({ config, data, features, start })
  1. the environment (env vars, ?isDebug, ?isProdTest), then config
  2. the checks: features (ids, requires), each scene's data too
  3. the kernel: root scene, ECS, cameras, lights, the HUD, assets
  4. each feature's install, in list order: physics(), …, appECSPlugins
  5. the scenes, registered from data
  6. debug env: the debugger, then each feature's onDebug
  7. await start(): your renderer, scene loader and first scene
  8. the main loop
```

- A feature is an id and an `install` function ([`EngineFeature`](api:EngineFeature)), which
  reaches the kernel only through its [`FeatureContext`](api:FeatureContext): ECS plugins and
  component hooks, the scene load's phases, the fixed-step driver (physics'), the render pipeline
  (PostFX') and after-render hooks (viewports'), import extensions, and its debug and unmount
  hooks. The [ECS page](hub:features/ecs#features) shows them.
- **Nothing registers when its module is imported.** A feature not listed isn't installed, and a
  production build doesn't hold it: without `physics()`, no Rapier.
- **The list's order is the registration order**, which breaks ties between systems in the same
  stage. `requires` names a feature that must come earlier (`character()` needs `physics()`).
- A scene's data names the features it uses (its manifest, written by the gatherer), and
  `InitEngine` fails naming the scene and the feature when `features` lacks one
  ([the feature manifest](hub:features/scenes-and-assets#the-feature-manifest)).
- [`mountAekasha`](api:mountAekasha) runs the same boot into an element of a page it doesn't own
  (an [embed](hub:features/smallest-build#embedding)), and its `unmount()` runs the features'
  unmount hooks.

## A frame

```text noLineNumbers
MAIN → APP_PRE_PHYSICS
  → [ APP_PHYSICS_STEP → physics step ] × 0..N
  → APP_POST_PHYSICS → APP_LOGIC → APP_RENDER_SYNC
  → render → LATE_MAIN
```

- Physics steps at a fixed rate, zero or more times a frame. `APP_PHYSICS_STEP` systems run right
  before each step with the fixed step as their delta: what must move in lockstep with the
  simulation goes there ([stepping](hub:features/physics#stepping)).
- `APP_POST_PHYSICS` writes the physics poses into the ECS transforms, and `APP_RENDER_SYNC` the
  transforms into the Three.js objects (then culling and levels of detail). The render runs the
  scene's PostFX and then the viewports.
- Every ECS world runs the stages; within a stage, a system's `order` and then its registration
  decide ([systems and stages](hub:features/ecs#systems-and-stages)). A scene's app
  loopers ([`createSceneAppLooper`](api:createSceneAppLooper)) run right after the worlds'
  `APP_RENDER_SYNC`, before the render.
- Pausing the app stops physics and the stages from `APP_POST_PHYSICS` to `APP_RENDER_SYNC`. An
  editor view (debug env) suspends the whole scene and renders its own.

## A scene load

[`loadScene`](api:loadScene) runs one load at a time: it holds physics, tears the previous scene
down (the features' part first, in reverse install order), starts a fresh physics world, loads
the next scene's assets, runs its scene file, creates its lights and meshes, releases what only
the previous scene used, and runs the enter hooks. Stepping resumes once every physics entity of
the load exists, so a scene simulates the same on every visit
([loading scenes](hub:features/scenes-and-assets#loading-scenes),
[deterministic scene loads](hub:features/physics#deterministic-scene-loads)).

A scene is JSON (validated by the gatherer, see
[the gatherer](hub:features/scenes-and-assets#the-gatherer)) plus an optional scene file of code.
A feature takes part through its scene hooks, so its objects go with the scene.

## Threads

- **Physics** runs in a worker by default (`AppConfig.physics.workerTarget`), or on the main
  thread with the same API. Every message goes through one transport as plain data, and the
  transforms come back through one shared buffer, never a message per body
  ([where the simulation runs](hub:features/physics#where-the-simulation-runs)).
- **Assets** load on the main thread by default; `AppConfig.assets` moves glTF and texture loads
  into the assets worker, and LOD chains are simplified there by default. The worker starts on
  its first request, and loads each job's code on its first job.
- KTX2 textures are transcoded in three's transcoder workers.

## Simulation and presentation

The **simulation** is the game's state as the physics steps it: physics, character controllers
and brains, AI and gameplay systems at `APP_PHYSICS_STEP`. It must run the same on every machine
and visit:

- Time is the step index ([`getPhysicsSubStepIndex`](api:getPhysicsSubStepIndex)), never the
  clock or the frame delta.
- Random numbers come from a named, seeded stream ([`getRandomStream`](api:getRandomStream)),
  restarted by every scene load.
- Input arrives as intents and action maps sampled at the step, and the simulation reads its own
  state at the step, never the synced transforms or interpolated poses.

The **presentation** (rendering, interpolation, animation, UI, audio, debug) reads the simulation
and changes it only through intents and commands. The
[coding standards](hub:documentation/coding-standards#the-simulation) have the full list, which
the lint enforces in the simulation files.

## Debug code

Debug tools live in `_dbg__` modules next to the code they debug (a feature's `debug/` folder),
and load only through [`loadDebugModuleAsync`](api:loadDebugModuleAsync) behind
[`IS_DEBUG_ENV`](api:IS_DEBUG_ENV). A production build folds that flag to `false`, so neither the
call nor the module is in it, and `yarn verify:baselines` fails if any debug code is left.
`?isDebug=true` turns the tools on in a development or test build, `?isProdTest=true` runs it as
production with a few of them ([the debug suite](hub:features/debug-suite#load-it-only-in-debug-builds)).

## The build

- **The entries are aliases** (`devTools/aliases.ts`), shared by Vite, Vitest and TypeScript; an
  entry file only re-exports names.
- **Every module but the stylesheets is side-effect free** (`package.json`'s `sideEffects`), so a
  build keeps only what's used and drops a module none of whose names are used.
- **Heavy parts load on first use:** Rapier, the glTF, Draco and HDR loaders, each TSL material
  and PostFX file, each scene's code, and the assets worker's jobs. Workers are ES modules, so
  they can split too.
- `yarn sbp` measures every build against its budgets and says why each part is in it
  ([the smallest build](hub:features/smallest-build)).

## Where your feature goes

| You're adding                                           | It goes                                                                                                                                                               |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Game logic one scene needs                              | That scene's folder: its scene file, a system added there and removed on exit.                                                                                        |
| A component and its system for your game                | `src/app/shared/` (or the scene's folder), its key added to the component map, its system registered in `appECSPlugins` ([the ECS example](hub:examples/ecs)).        |
| A bigger part of your game (combat, inventory)          | A feature of its own: components, systems, hooks and a debug tab installed together, listed before `appECSPlugins`.                                                   |
| Something several games could reuse                     | The toolkit, in its category (`ecs/`, `geometry/`, `materials/`), imported through its entry or copied into the app ([the toolkit](hub:features/toolkit)).            |
| A system that moves bodies                              | `APP_PHYSICS_STEP`, reading step time and a random stream.                                                                                                            |
| What a character wants to do (AI, script, network peer) | A brain kind ([`registerBrainKind`](api:registerBrainKind)) that writes the intent ([your own brain](hub:features/characters#your-own-brain)).                        |
| A new way to move a body                                | A controller kind ([`registerControllerKind`](api:registerControllerKind), [controllers](hub:features/characters#controllers)).                                       |
| Player controls                                         | An action map ([`createActionMap`](api:createActionMap)) in the `GAMEPLAY` context, read at the step ([action maps](hub:features/input#action-maps)).                 |
| A debug panel                                           | A `_dbg__` module loaded with `loadDebugModuleAsync`, with a tab from [`createDebuggerTab`](api:createDebuggerTab) ([the debug tab example](hub:examples/debug-tab)). |
| An engine subsystem every app could opt into            | `src/_engine/features/<name>/`: its entry, its `<Name>Feature.ts`, its debug folder and a Hub page (the engine's own features are the pattern).                       |

### Actors, controllers, brains and intents

Characters are built on four contracts, the pattern for vehicles and NPCs to come:

- **An actor** is an ECS entity whose record names its controller and brain (the `CHARACTER`
  component for characters). No class hierarchy: what it can do is the components it has.
- **A controller** ([`ActorController`](api:ActorController)) moves the actor's body, once per
  physics step, from its intent. Only its tick writes the body; collision callbacks record what
  happened for the next tick.
- **A brain** ([`ActorBrain`](api:ActorBrain)) decides what the actor wants and writes the intent,
  once per step before the controllers. It never touches the body, and doesn't know whether a
  player, an AI, a replay or the network is behind it.
- **An intent** ([`CharacterIntent`](api:CharacterIntent)) is that want as plain data: move, turn,
  jump, run, crouch.

Controllers and brains are registered kinds made from `{ kind, params }`, so a save or a network
message can rebuild them. The [Characters page](hub:features/characters) has the detail.
