The engine's (`src/_engine/`) and the toolkit's (`src/toolkit/`) public API, generated from their
JSDoc: a page per module, with each export's signature, comment, parameters and a link to its
source. Exports without a JSDoc comment are listed too, marked "No description", and each folder
shows how much of it is documented.

The debug implementations behind `debug/*.ts` (the `_dbg__*` files) and the generated app data
aren't part of the API, so they aren't listed.

## Importing the engine

Apps and the toolkit import the engine through its public entries, never by a path into
`src/_engine/`:

```ts
import { InitEngine, createMeshEntity, ECSSystemStage } from 'aekasha';
import { createPhysicsEntity } from 'aekasha/physics';
```

| Entry                       | What it holds                                                                                                                                                                                                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aekasha`                   | Init, features, config and the environment flags, the ECS and its stages, scenes and the scene loader, the renderer and snapshots, geometries, materials, textures, meshes and groups, imported assets, cameras, lights, input, views, the main loop and helpers. |
| `aekasha/physics`           | Physics entities, the physics API, joints and simulation tiers.                                                                                                                                                                                                   |
| `aekasha/character`         | Characters and their controllers.                                                                                                                                                                                                                                 |
| `aekasha/skybox`            | Sky boxes, the day-night cycle and environment bakes.                                                                                                                                                                                                             |
| `aekasha/lod`               | Levels of detail, LOD chains and impostors.                                                                                                                                                                                                                       |
| `aekasha/spatial`           | The spatial index and its domains.                                                                                                                                                                                                                                |
| `aekasha/instancing`        | Instanced mesh pools.                                                                                                                                                                                                                                             |
| `aekasha/lines`             | Lines and their segment builders.                                                                                                                                                                                                                                 |
| `aekasha/postfx`            | PostFX passes.                                                                                                                                                                                                                                                    |
| `aekasha/viewports`         | Viewports.                                                                                                                                                                                                                                                        |
| `aekasha/ui`                | The HUD root, `CMP`, toasts and icons.                                                                                                                                                                                                                            |
| `aekasha/debug`             | Debugger tabs and debug toasts, for an app's own debug tools.                                                                                                                                                                                                     |
| `aekasha/schemas`           | The asset JSON schemas, for tools.                                                                                                                                                                                                                                |
| `aekasha/toolkit/ecs`       | The toolkit's ECS effects, camera rig and moving platform.                                                                                                                                                                                                        |
| `aekasha/toolkit/geometry`  | The toolkit's procedural geometry and scattering.                                                                                                                                                                                                                 |
| `aekasha/toolkit/materials` | The toolkit's material helpers (`triplanarProjection`).                                                                                                                                                                                                           |

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
- The API pages below are still per module, with the module's path: an export is public when its
  entry exports it.

## The API

Good places to start are [`loadScene`](api:loadScene), [`createMeshEntity`](api:createMeshEntity),
[`createPhysicsEntity`](api:createPhysicsEntity) and [`ECSWorld`](api:ECSWorld). The search
(⌘K, Ctrl+K or `/`) finds every module, export and class member by name.
