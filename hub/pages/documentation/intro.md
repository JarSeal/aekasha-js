The engine's (`src/_engine/`) and the toolkit's (`src/toolkit/`) public API, generated from their
JSDoc: a page per public entry (below), with each name it exports, its signature, comment,
parameters and a link to its source, grouped by the module it comes from. `aekasha`, the largest,
has a page per source folder. Names without a JSDoc comment are listed too, marked "No
description", and each page shows how much of it is documented. What no entry exports is internal
and has no page.

The debug implementations (the `_dbg__*` files in the `debug/` folders) and the generated app data
aren't part of the API, so they aren't listed. For how the parts fit together, start with
[Architecture](hub:documentation/architecture).

::: dev-only
The Hub's code block syntax (fences, highlights, snippet includes) is on the
[Code blocks](hub:project/aekasha/code-blocks) page, under Project.
:::

## Importing the engine

Apps and the toolkit import the engine through its public entries, never by a path into
`src/_engine/`:

```ts
import { InitEngine, createMeshEntity, ECSSystemStage } from 'aekasha';
import { createPhysicsEntity } from 'aekasha/physics';
```

| Entry                                                                      | What it holds                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`aekasha`](hub:documentation/aekasha)                                     | Init, features, config and the environment flags, the ECS and its stages, scenes and the scene loader, the renderer and snapshots, geometries, materials, textures, meshes and groups, imported assets, cameras, lights, input, views, the main loop and helpers. |
| [`aekasha/physics`](hub:documentation/aekasha/physics)                     | Physics entities, the physics API, joints and simulation tiers.                                                                                                                                                                                                   |
| [`aekasha/character`](hub:documentation/aekasha/character)                 | Characters and their controllers.                                                                                                                                                                                                                                 |
| [`aekasha/skybox`](hub:documentation/aekasha/skybox)                       | Sky boxes, the day-night cycle and environment bakes.                                                                                                                                                                                                             |
| [`aekasha/lod`](hub:documentation/aekasha/lod)                             | Levels of detail, LOD chains and impostors.                                                                                                                                                                                                                       |
| [`aekasha/spatial`](hub:documentation/aekasha/spatial)                     | The spatial index and its domains.                                                                                                                                                                                                                                |
| [`aekasha/instancing`](hub:documentation/aekasha/instancing)               | Instanced mesh pools.                                                                                                                                                                                                                                             |
| [`aekasha/lines`](hub:documentation/aekasha/lines)                         | Lines and their segment builders.                                                                                                                                                                                                                                 |
| [`aekasha/postfx`](hub:documentation/aekasha/postfx)                       | PostFX passes.                                                                                                                                                                                                                                                    |
| [`aekasha/viewports`](hub:documentation/aekasha/viewports)                 | Viewports.                                                                                                                                                                                                                                                        |
| [`aekasha/ui`](hub:documentation/aekasha/ui)                               | The HUD root, `CMP`, toasts and icons.                                                                                                                                                                                                                            |
| [`aekasha/ui/fonts`](hub:documentation/aekasha/ui/fonts)                   | The UI kit's fonts, IBM Plex Sans and Mono: a stylesheet entry, imported for its styles (`import 'aekasha/ui/fonts'`).                                                                                                                                            |
| [`aekasha/debug`](hub:documentation/aekasha/debug)                         | Debugger tabs and debug toasts, for an app's own debug tools.                                                                                                                                                                                                     |
| [`aekasha/schemas`](hub:documentation/aekasha/schemas)                     | The asset JSON schemas, for tools.                                                                                                                                                                                                                                |
| [`aekasha/toolkit/ecs`](hub:documentation/aekasha/toolkit/ecs)             | The toolkit's ECS effects, camera rig and moving platform.                                                                                                                                                                                                        |
| [`aekasha/toolkit/geometry`](hub:documentation/aekasha/toolkit/geometry)   | The toolkit's procedural geometry and scattering.                                                                                                                                                                                                                 |
| [`aekasha/toolkit/materials`](hub:documentation/aekasha/toolkit/materials) | The toolkit's material helpers (`triplanarProjection`).                                                                                                                                                                                                           |

- Each feature's entry exports its factory, named after it: `physics()`, `character()`,
  `skyBox()`, `lod()`, `spatial()`, `instancing()`, `lines()`, `postFx()` and `viewports()`. A
  feature is installed only when [`InitEngine`](api:InitEngine)'s `features` lists it (see
  [How the app starts](hub:examples/quick-start#how-the-app-starts)), and a production build holds
  only what's listed.
- Each entry lists its exports by name: `src/_engine/index.ts`,
  `src/_engine/features/<name>/index.ts`, `src/toolkit/<category>/index.ts` and so on. What no
  entry exports is internal and can change in any version.
- The lint enforces the boundary: outside the engine, a path into `src/_engine/` is an error, and
  so is a path into another toolkit category's files. The engine imports neither the toolkit nor
  the app.
- The API pages follow the entries: `aekasha/physics`'s page is
  [`documentation/aekasha/physics/`](hub:documentation/aekasha/physics), and `aekasha`'s names are
  under its source folders (`kernel/scene/` → [`documentation/aekasha/scene/`](hub:documentation/aekasha/scene)).
  Each name shows the module it comes from.

## The API

Good places to start are [`loadScene`](api:loadScene), [`createMeshEntity`](api:createMeshEntity),
[`createPhysicsEntity`](api:createPhysicsEntity) and [`ECSWorld`](api:ECSWorld). The search
(⌘K, Ctrl+K or `/`) finds every entry, public name and class member by name.
