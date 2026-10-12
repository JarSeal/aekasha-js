## Engine 4 → 5

::: note Not released yet
Engine 5.0 and toolkit 2.0 are in development. This section lists their breaking changes so far,
and grows until they're released.
:::

In short: the engine stops importing your app, and installs only what you list. Your
configuration, your gathered data and your features (the engine's and your app's own) are handed
to it, your component types join its component map from your own files, and your code imports the
engine through its public entries (`aekasha`, `aekasha/physics`, …), which the lint now enforces.

### Before you start

1. Commit, so each step below is a diff of its own.
2. Take the new `src/_engine/`, `src/toolkit/` and `devTools/` from the template, and the root
   configs that wire the entries up, keeping your own changes to them: `tsconfig.json` (`paths`),
   `vite.config.ts` (`resolve.alias`, and the `__AEK_DEBUG__` define, without which the engine
   doesn't start), `vitest.config.ts` (its `__AEK_DEBUG__` too), `eslint.config.js` (the boundary
   rules) and `package.json`'s `sideEffects` (the stylesheets and `devTools/`), without which your
   main chunk takes in everything an entry re-exports. The aliases all come from one list,
   `devTools/aliases.ts`.
3. Run `yarn`, then `yarn gatherAppData`: it writes `src/generated/` (see below).

### `InitEngine` takes options

`InitEngine` took the start callback alone, and the engine imported `src/CONFIG.ts`, the gathered
data and `src/AppECSPlugins.ts` itself. Now `src/index.ts` hands them over, with the features to
install:

```ts title="src/index.ts"
import { InitEngine } from './_engine/InitApp'; // [!code --]
import { createRenderer } from './_engine/core/Renderer'; // [!code --]
import { loadScene } from './_engine/core/SceneLoader'; // [!code --]
import { InitEngine, createRenderer, loadScene } from 'aekasha'; // [!code ++]
import { physics } from 'aekasha/physics'; // [!code ++]
import { skyBox } from 'aekasha/skybox'; // [!code ++]
import config from './CONFIG'; // [!code ++]
import { appData } from './generated'; // [!code ++]
import { appECSPlugins } from './AppECSPlugins'; // [!code ++]

InitEngine(async () => { // [!code --]
InitEngine({ // [!code ++]
  config, // [!code ++]
  data: appData, // [!code ++]
  features: [physics(), skyBox(), appECSPlugins], // [!code ++]
  start: async () => { // [!code ++]
    await createRenderer({ antialias: true });
    await loadScene({ sceneId: 'myScene' });
  }, // [!code ++]
});
```

- **`config`** is `src/CONFIG.ts`'s default export, merged over the engine's defaults as before.
- **`data`** is the gathered data. It moved from `src/_engine/generatedAppData.json` and
  `src/_engine/generatedAppFns.ts` to `src/generated/`, with an `index.ts` that exports `appData`.
  The gatherer writes all three; delete the old files if your copy still has them.
- **`features`** is required: the engine's features your app uses, then your own (see
  [Features](#features) and [Your ECS plugins are a feature](#your-ecs-plugins-are-a-feature)).
- **`start`** is the callback `InitEngine` took before.
- **The `IS_*` flags** (`IS_DEBUG_ENV`, `IS_PROD_TEST_MODE`, `IS_PROD_ENV`, `IS_PROD_TEST_ENV`,
  `CUR_ENV`) are set by `InitEngine` from the env vars and the URL params; before it they read as
  a production build. A value computed from one at a module's top level now always sees
  production: read the flag inside a function, when it's called. In a production build the debug
  flags are the constant `false`, so the code behind them isn't in the bundle at all.

### Features

The engine registered all of its parts as their modules loaded. Now `InitEngine` installs its
kernel (the ECS, meshes, groups, cameras, lights, raycasting, input and scenes), then only the
features `features` lists, in list order. Each feature's factory is on its entry:

| Feature        | Entry                | What it installs                                                      |
| -------------- | -------------------- | --------------------------------------------------------------------- |
| `physics()`    | `aekasha/physics`    | The physics API (Rapier), physics entities, simulation tiers.         |
| `character()`  | `aekasha/character`  | Characters and their controllers. Needs `physics()` listed before it. |
| `skyBox()`     | `aekasha/skybox`     | Sky boxes, day-night and the scenes' `skyboxes`.                      |
| `lod()`        | `aekasha/lod`        | Level-of-detail selection, LOD chains and impostors: a mesh's `lod`.  |
| `spatial()`    | `aekasha/spatial`    | The spatial index and the light culling that queries it.              |
| `instancing()` | `aekasha/instancing` | Instanced mesh pools.                                                 |
| `lines()`      | `aekasha/lines`      | Lines, and the debug tools that draw with them.                       |
| `postFx()`     | `aekasha/postfx`     | The scenes' PostFX chains.                                            |
| `viewports()`  | `aekasha/viewports`  | Viewports, and the debug axes gizmo and environment ball.             |

- **To keep everything as it was,** list all nine in this order, then `appECSPlugins`: the
  template's list. The order is the order systems register in, and two systems in the same stage
  with the same `order` run in that order.
- **Leave out what you don't use:** a feature not listed isn't installed, and a production build
  leaves its code out (no Rapier without `physics()`). `physics.enabled: false` still means
  installed, without a world at boot.
- **A scene whose JSON uses a feature you left out fails the boot,** naming the scene and the
  feature's factory: the gatherer writes what each scene's data needs into the generated data
  (`skyboxes`, `postFx`, `spatialDomains`, `impostors`, a mesh's `lod`; see the
  [feature manifest](hub:features/scenes-and-assets#the-feature-manifest)). Scene code isn't
  checked: without its feature, `createLines` and `createViewport` throw and `lod: 'AUTO'` warns.

### Your ECS plugins are a feature

`src/AppECSPlugins.ts` registered its plugin when the engine imported it. Now it exports your
app's own feature, which `src/index.ts` lists last (above):

```ts title="src/AppECSPlugins.ts"
import { ECSWorld } from 'aekasha'; // [!code --]
import type { EngineFeature } from 'aekasha'; // [!code ++]

// [!code --:4]
ECSWorld.registerPlugin((world) => {
  registerHoverToolEffect(world);
  registerSpinSystem(world);
});
// [!code ++:9]
export const appECSPlugins: EngineFeature = {
  id: 'app',
  install: (ctx) => {
    ctx.registerPlugin((world) => {
      registerHoverToolEffect(world);
      registerSpinSystem(world);
    });
  },
};
```

- The install's `ctx` ([`FeatureContext`](api:FeatureContext)) has `registerPlugin`,
  `registerComponentHooks` and the rest of the kernel's seams: register your managers' plugins
  and hooks there. A bigger part of your game can be a feature of its own, listed before
  `appECSPlugins` (see [ECS](hub:features/ecs#features)).
- **Nothing may register at a module's top level any more,** and `import './AppECSPlugins'` must
  not come back: `package.json`'s `sideEffects` tells the bundler that only stylesheets have side
  effects, so a production build drops a module imported only for its effect, registration and
  all, without an error. Move a top-level `ECSWorld.registerPlugin`, `registerComponentHooks`,
  `registerOnAllSceneExits` or `createKeyBinding` into your feature's `install`, or into a
  function your scene calls. The dev server doesn't tree-shake, so only a build shows it.

### Icons

The engine's icons are a registry on `aekasha/ui`. The debug env and prod test mode register every
built-in icon; a production build registers none, so its bundle has no SVG it doesn't show.

```ts
import { gearIcon, registerIcon } from 'aekasha/ui';
import shieldSvg from './icons/shield.svg?raw';

registerIcon('gear', gearIcon); // A built-in your production UI shows
registerIcon('shield', shieldSvg); // Your own, in every build
```

- **A built-in `icon` your app shows in a production build** (a draggable window's) renders `??`
  there, and warns once, until you register it. Each built-in is exported as `<name>Icon`
  (`gear` → `gearIcon`); [`registerBuiltInIcons`](api:registerBuiltInIcons) registers them all.
- **An icon of your own** (a draggable window's, a debug tab's or a view's) needs
  [`registerIcon`](api:registerIcon) in every build. `SvgIconKey` takes any name now, and still
  autocompletes the built-ins.
- [`getSvgIcon`](api:getSvgIcon) renders a registered icon as HTML for your own UI.

### TSL files load with their scene

The generated data imported every `*.tsl.ts` file (TSL materials and PostFX passes) into the main
chunk. Now it loads each on demand: a scene load loads the files of the TSL materials and PostFX
passes its scene lists, and a build puts each file in a chunk of its own.

- **A TSL material created outside a scene load** (in code, from a material JSON no loaded scene
  lists) needs its file loaded first: `createMaterial` throws, naming
  [`loadTslMaterialFileAsync`](api:loadTslMaterialFileAsync), until you await it.

```ts
if (await loadTslMaterialFileAsync('triplanarGrid')) {
  createMaterial({ id: 'wideGrid', tslMaterialId: 'triplanarGrid' /* … */ });
}
```

- **A `nodes` socket its TSL file doesn't export** was a type error in the generated code. Now
  `createMaterial` warns about it at runtime ("Could not locate node").

### Scene and mesh schemas

A feature's scene and mesh JSON fields are its own now, so `aekasha/schemas` builds the scene and
mesh schemas from the features' parts. This matters only to a tool of yours that validates scene
or mesh JSON itself; the gatherer composes them in `devTools/engineSchemas.ts`.

| Was                       | Now                                                                                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SceneAssetSchema`        | `createSceneAssetSchema(parts)`, with the parts `skyBoxSchemaPart`, `postFxSchemaPart`, `spatialSchemaPart` and `lodSchemaPart` (`aekasha/schemas`). |
| `MeshAssetSchema`         | `createMeshAssetSchema(parts)`, with the same parts.                                                                                                 |
| `SceneAsset`, `MeshAsset` | The kernel's fields only: a feature's fields are in its part.                                                                                        |

### System stages

`ECSSystemStage` and `APP_RENDER_SYNC_ORDER` moved from `src/AppECSRegistry.ts` into the engine,
with the same names and values:

```ts
import { ECSSystemStage } from '../../AppECSRegistry'; // [!code --]
import { ECSSystemStage, APP_RENDER_SYNC_ORDER } from 'aekasha'; // [!code ++]
```

`AppECSRegistry.ts` doesn't re-export them.

### Component types

`ComponentType` held every key, the engine's, the app's and the toolkit's, because
`AppECSRegistry.ts` spread the toolkit's key objects into `AppComponentType` and listed their data
types in `AppComponentData`. Now `ComponentType` holds the engine's own keys, and each module that
owns a component adds it to the engine's `ComponentDataMap` interface in its own file:

```ts
export const MyComponentType = { HEALTH: 'APP_HEALTH' } as const;

declare module 'aekasha' {
  interface ComponentDataMap {
    [MyComponentType.HEALTH]: { current: number; max: number };
  }
}
```

[`addComponent`](api:ECSWorld.addComponent), [`getComponent`](api:ECSWorld.getComponent) and
[`getStorage`](api:ECSWorld.getStorage) know the key and its data's type everywhere, so the
`as any` casts on a storage can go. Augment `'aekasha'` only, never a path into the engine: the
same interface augmented through two paths loses keys without an error.

`src/AppECSRegistry.ts` keeps only the app-wide keys, and no imports:

<<< src/AppECSRegistry.ts

Code uses each module's own key object:

| Was                                                                      | Now                                                                                                                  |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `ComponentType.HOVER`                                                    | `HoverToolComponentType.HOVER` (`aekasha/toolkit/ecs`)                                                               |
| `ComponentType.FOLLOW`                                                   | `FollowToolComponentType.FOLLOW` (`aekasha/toolkit/ecs`)                                                             |
| `ComponentType.SUN_SHADOW_FIT`                                           | `SunShadowFitComponentType.SUN_SHADOW_FIT` (`aekasha/toolkit/ecs`)                                                   |
| `ComponentType.HEALTH`                                                   | `AppComponentType.HEALTH` (`src/AppECSRegistry.ts`)                                                                  |
| `ComponentType.SPIN`                                                     | `SpinComponentType.SPIN` (the [ECS example](hub:examples/ecs)'s `SpinComponent.ts`)                                  |
| `HoverComponentData`, `FollowComponentData`, `SunShadowFitComponentData` | Gone: the toolkit adds its keys itself. Its data types are `HoverToolData`, `FollowToolData` and `SunShadowFitData`. |
| `AppComponentData`                                                       | Gone: the augmentation replaces it.                                                                                  |
| `AppComponentType.INSTANCED_STRESS_TEST_DATA`                            | Gone: the ECS stress test has its own debug keys.                                                                    |

In the debug tools, the entity inspector and the profiler list component types by value
(`CORE_TRANSFORM`, `APP_SPIN`) instead of by key name.

### Deep imports → entries

A path into `src/_engine/` is internal now: the app and the toolkit import the engine only through
its [entries](hub:documentation#importing-the-engine), and the app imports the toolkit through
`aekasha/toolkit/*`. A codemod rewrites the imports:

```bash
npx tsx devTools/refactor/migrateToEntries.ts --check src/app src/*.ts  # lists what would change
npx tsx devTools/refactor/migrateToEntries.ts src/app src/*.ts
```

It takes folders and files (add your own toolkit modules' folders), and needs the repo's Node
version (`.nvmrc`). Each imported name goes to the entry that exports it, with one value import
and one `import type` per entry, formatted with Prettier. It leaves two kinds of import alone:
imports of `*.tsl.ts` material files (they're assets) and imports within one toolkit category.

On any error it lists them all and writes nothing:

- **"`name` is in no entry":** the name is internal. Look for what the entry offers instead, or
  copy what you need into your app.
- **"doesn't resolve to a file":** the module moved (below). Point the import at its new place by
  hand, then run the codemod again.
- **A namespace, default, side-effect or dynamic import** of an engine module, or an `export *`
  of one: import the names instead.

### Moved and removed modules

| Was                                                                                                                      | Now                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `src/_engine/utils/cameras/followObjectCameraRig.ts`                                                                     | `aekasha/toolkit/ecs`: `createFollowObjectCameraRig`, `deleteFollowObjectCameraRig`, `registerFollowObjectCameraRigSystem`.              |
| `src/_engine/utils/world/movingPlatform.ts`                                                                              | `aekasha/toolkit/ecs`: `createMovingPlatform`, `registerMovingPlatformSystem`.                                                           |
| `src/_engine/utils/commontTypes.ts`                                                                                      | Removed. Its one type, `XYZObject`, is written out in the camera rig's `offset` option.                                                  |
| `src/_engine/utils/PhysicsStressTest.ts`, `src/_engine/utils/world/characterTestObjects.ts`, `characterTestObstacles.ts` | The example app's gym scene, `src/app/scenes/thirdPersonGymScene/`: test code no entry exports. Copy them into your app if you use them. |
| `src/toolkit/ecs/InstancedMeshPool.ts`, `InstancedMeshPoolTypes.ts`                                                      | Removed (they were deprecated re-exports): `aekasha/instancing`.                                                                         |

### The boundary lint

`yarn lint` makes these errors. The first three are paths, checked in `import type` and `import()`
too:

- Outside the engine, a path into `src/_engine/`.
- In the toolkit, an import of the app, `src/*.ts` or `src/generated/`, or of another toolkit
  category's files (use `aekasha/toolkit/<category>`).
- In the app and `src/*.ts`, a path into `src/toolkit/` (use its entries).
- A static import of a `_dbg__` module outside the debug modules: load it with
  [`loadDebugModuleAsync`](api:loadDebugModuleAsync), so production builds leave it out. An
  `import type` of one is fine.

The generated code's imports of the toolkit's `*.tsl.ts` materials are the one exception.
