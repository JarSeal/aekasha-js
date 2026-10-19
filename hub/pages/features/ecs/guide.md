## Entities

[`createEntity`](api:ECSWorld.createEntity) returns an id that packs the entity's slot and a
generation. When an entity is deleted and its slot reused, the old id no longer matches
([`isAlive`](api:ECSWorld.isAlive)), so a stale id can't reach the new entity.

Most entities come from the managers, which create them with their components:
[`createMeshEntity`](api:createMeshEntity), [`createLightEntity`](api:createLightEntity),
[`createPhysicsEntity`](api:createPhysicsEntity) and the others. Their options include:

- `appId`: a name of yours, to find the entity with [`getEntityIdByAppId`](api:getEntityIdByAppId)
  (one lookup, each world keeps a map). Keep it unique: when two entities have it, the first one
  created keeps it until it's deleted, and the debug env warns about the second.
- `persistent`: the entity survives scene switches. Everything else a scene creates is deleted
  when it exits.
- `disabled`: created switched off, hidden and with its physics body disabled.
  [`setDisabled`](api:ECSWorld.setDisabled) switches it later.

## Components

A component is a type key and its data:
[`addComponent`](api:ECSWorld.addComponent), [`getComponent`](api:ECSWorld.getComponent),
[`hasComponent`](api:ECSWorld.hasComponent) and [`removeComponent`](api:ECSWorld.removeComponent).
[`getStorage`](api:ECSWorld.getStorage) gives every entity that has a component, with its data,
which is what a system loops over.

`ComponentType` (from `aekasha`) holds the engine's own keys: `ComponentType.TRANSFORM`,
`ComponentType.OBJECT3D` and the rest. An app or toolkit module adds its own next to its code, with a
key object of its own and an augmentation of the engine's `ComponentDataMap` interface
(`declare module 'aekasha'`), so the type checker knows each component's data everywhere. Code
uses each module's key object (`HoverToolComponentType.HOVER`). The
[ECS example](hub:examples/ecs#2-adding-it-to-the-component-map) shows how.

The transform is a component too. Write it with [`setTransform`](api:ECSWorld.setTransform)
(physics bodies included) and the engine syncs it onto the entity's Three.js object before the
frame is drawn. `AppConfig.ecs.storageMode` chooses its storage: `MAP` (the default) or
`TYPED_ARRAY`, a fixed-size typed-array store.

## Systems and stages

[`addSystem`](api:ECSWorld.addSystem) puts a function in a stage, an
[`ECSSystemStage`](api:ECSSystemStage) from `aekasha`. The stages run in this order every frame:

| Stage              | What it's for                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------ |
| `MAIN`             | The engine's own per-frame work.                                                                             |
| `APP_PRE_PHYSICS`  | Input and anything that must happen before physics.                                                          |
| `APP_PHYSICS_STEP` | Zero or more times a frame, right before each fixed physics step: anything that moves in lockstep with it.   |
| `APP_POST_PHYSICS` | Physics poses are written into the transforms.                                                               |
| `APP_LOGIC`        | Gameplay.                                                                                                    |
| `APP_RENDER_SYNC`  | Transforms are written into the Three.js objects; culling and levels of detail. Cameras that follow go here. |
| `LATE_MAIN`        | After the frame is drawn.                                                                                    |

- Pausing the app (`F7` in debug) stops physics and `APP_POST_PHYSICS`, `APP_LOGIC` and
  `APP_RENDER_SYNC`. `MAIN`, `APP_PRE_PHYSICS` and `LATE_MAIN` keep running.
- With a frame rate cap (the `VITE_MAX_FPS` env var, or the debugger's Loop controls tab), a
  frame that isn't drawn still runs every stage up to `APP_RENDER_SYNC`, so no game time is lost:
  it skips only the render and `LATE_MAIN`.
- Within a stage, a higher `order` runs first. The order is resolved when a system is added, so
  a frame never sorts. In `APP_RENDER_SYNC`, use the
  [`APP_RENDER_SYNC_ORDER`](api:APP_RENDER_SYNC_ORDER) constants: a camera that follows an entity
  runs at `POSE_CONSUMERS`, after the poses are written and before culling.
- A system belongs to its world until [`removeSystem`](api:ECSWorld.removeSystem). A system only
  one scene needs is added in its scene file and removed when the scene exits.

## Features

[`InitEngine`](api:InitEngine) installs the engine's kernel (the ECS, meshes, groups, cameras,
lights, raycasting, input and scenes), then each of its `features`, in list order: the engine's
(`physics()`, `skyBox()`, …, see
[How the app starts](hub:examples/quick-start#how-the-app-starts)), then the app's own. A
feature ([`EngineFeature`](api:EngineFeature)) is an id and an `install` function, which gets the
kernel's seams ([`FeatureContext`](api:FeatureContext)): the ECS registrations below, the scene
load's phases, `onDebug` for its debug tools and `onUnmount` for its stop.

- **Nothing registers itself when its module is imported.** A build keeps only the modules whose
  names something uses (`package.json`'s `sideEffects`), so a registration at a module's top level
  wouldn't run in a production build. `yarn test` fails on one.
- **The list's order is the registration order.** Two systems in the same stage with the same
  `order` run in the order their features installed.
- **`requires`** names the features one needs, listed before it: `character()` requires
  `physics()`, and `InitEngine` fails naming both otherwise.
- **`ctx.onDebug(fn)`** runs `fn` only in the debug env, before the app's `start`. Load the
  feature's debug code there with an `import()`, and put the call inside `if (IS_DEBUG_ENV)`:
  a production build then leaves both out.
- **`ctx.onUnmount(fn)`** runs `fn` when an embedded engine's `unmount()` stops it
  ([`mountAekasha`](api:mountAekasha)), right after the loop, in reverse install order: stop
  what the feature started (`physics()` terminates its worker, `skyBox()` clears its sky box). It's synchronous, and a
  full-page app never runs it.

## Plugins and hooks

[`registerPlugin`](api:ECSWorld.registerPlugin) runs a function for every world, now and when
one is created: a feature registers its systems that way, in its install (`ctx.registerPlugin`).
The app's own feature, `appECSPlugins` in `src/AppECSPlugins.ts`, registers the app's systems and
the toolkit's, and `src/index.ts` lists it last:

<<< src/AppECSPlugins.ts#ecs-register-plugin

[`registerComponentHooks`](api:ECSWorld.registerComponentHooks) (`ctx.registerComponentHooks`)
runs code when a component is added or removed, or its entity deleted. The engine uses hooks to
create and free what a component stands for (a mesh's Three.js object, a body's colliders), so
deleting an entity cleans up after it.

A bigger part of your game (a combat system with its components, hooks and debug tab) can be a
feature of its own, listed before `appECSPlugins`.

## Managed entities

An entity a manager creates, drives and deletes itself (the sky box's sun light, for one) is
created with `managedBy`. The debugger then shows it read-only, with a link to its manager's
tab, so a change made by hand can't fight the manager.

## Key APIs

- [`getECSWorld`](api:getECSWorld): the world (the default one without an id).
- [`createEntity`](api:ECSWorld.createEntity), [`deleteEntity`](api:ECSWorld.deleteEntity) and
  [`isAlive`](api:ECSWorld.isAlive).
- [`addComponent`](api:ECSWorld.addComponent), [`getStorage`](api:ECSWorld.getStorage) and
  [`setTransform`](api:ECSWorld.setTransform).
- [`addSystem`](api:ECSWorld.addSystem), [`registerPlugin`](api:ECSWorld.registerPlugin) and
  [`registerComponentHooks`](api:ECSWorld.registerComponentHooks).
- [`EngineFeature`](api:EngineFeature) and [`FeatureContext`](api:FeatureContext): a feature of
  your own.

## Read more

- The [ECS example](hub:examples/ecs): a component and its system, from the type to the scene.
- The [toolkit](hub:features/toolkit)'s effects: more components and systems to read or copy.
- The API reference: [ECS](hub:documentation/engine/kernel/ecs/ECS).

::: claude-md
:::
