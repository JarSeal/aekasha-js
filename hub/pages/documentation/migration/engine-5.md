## Engine 4 → 5

::: note Not released yet
Engine 5.0 and toolkit 2.0 are in development. This section lists their breaking changes so far,
and grows until they're released.
:::

In short: the engine stops importing your app. Your configuration, your gathered data and your
ECS plugins are handed to it, your component types join its component map from your own files,
and your code imports the engine through its public entries (`aekasha`, `aekasha/physics`, …),
which the lint now enforces.

### Before you start

1. Commit, so each step below is a diff of its own.
2. Take the new `src/_engine/`, `src/toolkit/` and `devTools/` from the template, and the root
   configs that wire the entries up, keeping your own changes to them: `tsconfig.json` (`paths`),
   `vite.config.ts` (`resolve.alias`, and `build.rollupOptions.treeshake.moduleSideEffects`, without
   which your main chunk takes in everything an entry re-exports), `vitest.config.ts` and
   `eslint.config.js` (the boundary rules). The aliases all come from one list,
   `devTools/aliases.ts`.
3. Run `yarn`, then `yarn gatherAppData`: it writes `src/generated/` (see below).

### `InitEngine` takes options

`InitEngine` took the start callback alone, and the engine imported `src/CONFIG.ts`, the gathered
data and `src/AppECSPlugins.ts` itself. Now `src/index.ts` hands them over:

```ts title="src/index.ts"
import { InitEngine } from './_engine/InitApp'; // [!code --]
import { createRenderer } from './_engine/core/Renderer'; // [!code --]
import { loadScene } from './_engine/core/SceneLoader'; // [!code --]
import { InitEngine, createRenderer, loadScene } from 'aekasha'; // [!code ++]
import './AppECSPlugins'; // [!code ++]
import config from './CONFIG'; // [!code ++]
import { appData } from './generated'; // [!code ++]

InitEngine(async () => { // [!code --]
InitEngine({ // [!code ++]
  config, // [!code ++]
  data: appData, // [!code ++]
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
- **`start`** is the callback `InitEngine` took before.
- **`./AppECSPlugins`** registers your systems and the toolkit's. Import it right after the engine
  (the line after `aekasha`'s), so the systems register in the order they did.
- **The `IS_*` flags** (`IS_DEBUG_ENV`, `IS_PROD_TEST_MODE`, `IS_PROD_ENV`, `IS_PROD_TEST_ENV`,
  `CUR_ENV`) are set by `InitEngine` from the env vars and the URL params; before it they read as
  a production build. A value computed from one at a module's top level now always sees
  production: read the flag inside a function, when it's called.

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
