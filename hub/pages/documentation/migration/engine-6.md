## Engine 5 → 6

Engine 6.0.0 "Sunset" and toolkit 3.0.0 "Gibbous", released together. From engine 5.x this is the
only section to follow.

In short: the debugger is built on the [UI kit](hub:features/ui-kit), the simulation tiers are a
feature of their own, the functions that took several optional parameters take an options object
(an ECS world goes first when it's required and last when it's optional), and what the 5.x minors
deprecated is gone. A codemod rewrites most of it and reports the rest.

### Before you start

1. Commit, so each step below is a diff of its own.
2. Take the new `src/_engine/`, `src/toolkit/` and `devTools/` from the template, and from the
   root: `package.json`'s dependencies (`tweakpane`, `@tweakpane/core` and `stats-gl` are gone:
   keep them only if your app imports them itself) and `eslint.config.js` (the simulation lint's
   allow-list entry for `PhysicsWallClock.ts` went with the file). Run `yarn`, then
   `yarn gatherAppData`.
3. Run the codemod with the repo's Node version (`.nvmrc`), over every folder of your TypeScript:

   ```bash
   npx tsx devTools/migrate/migrateEngine6.ts --check src  # lists what would change, writes nothing
   npx tsx devTools/migrate/migrateEngine6.ts src
   ```

4. `yarn build` (the type check) and `yarn lint` show what's left: the reports' fixes, and the
   code blocks of your own Markdown, which the codemod doesn't read.

The codemod follows the type checker, not names: a call is rewritten only when its function is the
engine's or the toolkit's, so a local function of the same name is left alone. It runs on code that
no longer compiles against the new engine, which is the point. It rewrites what has one answer (a
renamed or moved name, a reshaped call, a component key's `typeof`) and formats what it rewrote
with Prettier. What needs a person it reports, one line each on stderr: the file and line, what to
do, and the section of this page (`documentation/migration/#the-scene-functions`). `--report`
prints only the reports.

- **A module it can't migrate** is left as it was, with the reason listed: a reshaped call whose
  arguments would run in another order, or a renamed name that a local would shadow. It then exits
  2; `--check` exits 1 when there's something to change, otherwise 0.
- **Run it over the folder with `src/index.ts`** too: it reports the tiers' API when no module it
  reads calls `physicsTiers()` (see [below](#physicstiers)).

Each section says what the codemod does with its changes.

### The debugger on the UI kit

**By hand:** the codemod doesn't change a tab's bindings; `yarn build` finds the type errors.

The debugger no longer uses Tweakpane: every drawer tab, edit window and debug window is built
from the [UI kit](hub:features/ui-kit), and its panes are
[property grids](hub:features/ui-kit/forms#property-grids). Most tabs keep working unchanged:

- The functions keep their names and signatures: `createDebuggerTab`, `openDebuggerTab`,
  `updateDebuggerTab`, `removeDebuggerTab`, `isDebuggerTabOpen`, `persistDebuggerTabValue`,
  `debuggerListCMP` and the profiler's. (`createDebuggerTab`'s second parameter went:
  [the debug entry's names](#the-debug-entry-s-names).)
- Every field of `DebuggerTabDef` stays, and so do the sections (`{ pane: true, … }`, a CMP, a
  list) and the item types' names (`DebuggerPaneBinding`, `DebuggerPaneFolder`, …), now defined
  over the kit's property grid items.
- What a 5.x debugger saved in localStorage loads in 6.0: a tab's `lsKey` values, its `uiLsKey`
  folder states and the drawer's state.

What breaks is a binding's Tweakpane side:

| 5.x                                                                         | 6.0                                                                                                       |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| A binding's other fields go to Tweakpane's `addBinding` (anything is typed) | The kit's field props only: an unknown one is a type error, and at run time the tab's error line names it |
| `view: 'color'`, or a `color` param, on a number                            | `kind: 'color'`; an `{ r, g, b }` object is always floats, so `color: { type: 'float' }` goes             |
| `onChange(value, { prev, last, api })`, `api` a `BindingApi`                | `onChange(value, { prev, last, source, field })`, `field` the field's handle                              |
| `onCreate(api: BindingApi)`                                                 | `onCreate(field)`                                                                                         |
| `custom.build(parent: Pane \| FolderApi)`                                   | `build(container: CMPHandle)`; a returned function still runs on every refresh                            |
| `prev` on the `last: true` call is the last step's value                    | The value before the gesture                                                                              |
| A `THREE.Euler` is a point in radians                                       | A rotation field in degrees; the bound value stays in radians                                             |
| A typed number reaches the target unrounded (`1.0999999999999999`)          | Rounded to the step's decimals (`1.1`)                                                                    |
| `tweakpane` and `@tweakpane/core` are dependencies                          | Gone: an app that imports Tweakpane itself adds them to its `package.json`                                |

For example:

```ts
{
  key: 'tint',
  label: 'Tint',
  view: 'color', // [!code --]
  kind: 'color', // [!code ++]
  onCreate: (api) => (tintApi = api), // [!code --]
  onCreate: (field) => (tintField = field), // [!code ++]
  onChange: (value, e) => {
    if (e.last) recordTintChange(e.prev, value); // e.prev: the value before the drag
  },
},
{
  type: 'custom',
  build: (parent) => { // [!code --]
    const element = parent.element.appendChild(document.createElement('p')); // [!code --]
  build: (container) => { // [!code ++]
    const element = container.add({ tag: 'p' }).elem; // [!code ++]
    return () => (element.textContent = describeTint()); // Every refresh
  },
},
```

`interval: 0` still reads a monitor only when the tab refreshes (the kit's `interval: 'refresh'`),
and `view: 'graph'` with `bufferSize` is still a graph monitor.

#### What reads differently

Not type errors, but a tab may look or behave differently:

- **`onChange` hears `setValue` too:** a field's `setValue` (on the handle `onCreate` gives) calls
  `onChange` with `source: 'api'`, where a 5.x binding's handler heard only the user. A handler
  that records an undo step or writes back checks `e.source === 'user'`, or the write passes
  `silent`.
- **Monitors:** a boolean reads "On" / "Off" (Tweakpane wrote "true" / "false"), and a monitor
  with `options` reads the option's label, not the value.
- **Rotations** show in degrees, with Tweakpane's `step: Math.PI / 8` as 22.5°.
- **A list** is one tab stop with the arrows inside, where every row and toggle was a Tab stop.
- **Keys:** a key pressed on a debugger control is the debugger's: your app's action maps and
  key bindings don't see it, so Enter and Space click a focused debugger button.
- **During a scene load** the drawer and the on-screen tools are disabled.
- **The look:** the debugger is the kit's compact density, dark by default.
  `AppConfig.debugDrawer.theme` sets `'light'`, or `'app'` to follow your app's theme.
- **Restyling it:** the debugger's own stylesheets and their classes changed, and the Sass
  variables are gone. Set the kit's tokens on its roots (`[data-aek-debugger]`) instead
  ([Styling the UI kit](hub:features/ui-kit/styling)).

#### New in a tab

- `content(ctx)`: `ctx.scheduler` is the tab's refresh scheduler, for the UI kit's own fields in a
  CMP section ([Kit components in a tab](hub:features/debug-suite#kit-components-in-a-tab)).
- `keepOnSceneChange` keeps the open tab across a scene change and refreshes it, after
  `onSceneChange`.
- `uiLsKey` also keeps the label column's width.

### `physicsTiers()`

**Codemod:** reports the tiers' API when no module calls `physicsTiers()`
(`requires:physicsTiers`, `requires:physicsTiersOption`); adding the feature is by hand.

The [simulation tiers](hub:features/physics#simulation-tiers) (`requestPhysicsTier`, the tier
policies, `createPhysicsEntity`'s `tierPolicy`) were part of `physics()`. Now they're a feature of
their own, so an app that doesn't use them doesn't download them. An app that does lists it right
after `physics()`, which keeps every system in the order it had:

```ts title="src/index.ts"
import { physics } from 'aekasha/physics'; // [!code --]
import { physics, physicsTiers } from 'aekasha/physics'; // [!code ++]

InitEngine({
  features: [
    physics(),
    physicsTiers(), // [!code ++]
    character(),
    // …
  ],
});
```

Without it:

- `requestPhysicsTier`, `setPhysicsTierPolicy` and `setPhysicsTierPolicyMember` throw, naming the
  feature.
- `createPhysicsEntity`'s `tierPolicy: true` warns once and is ignored.
- `getPhysicsTier` answers `'FULL'`, and the policy getters `null`.

A scene's JSON can't ask for it (the tiers are code only), so a missing `physicsTiers()` doesn't
fail the boot.

### The entity creators and `createPhysicsEntity`

**Codemod:** rewrites the calls (`reshape:createPhysicsEntity`, `reshape:createMeshEntity`,
`reshape:createCameraEntity`, `reshape:createGroupEntity`, `reshape:createLightEntity`,
`reshape:createLineEntity`, `reshape:createEntity`). An object literal of options is merged in
place, an options variable is spread (`{ ...opts, world }`), and an `undefined` placeholder goes.

`createPhysicsEntity` took five positional parameters. Now it takes the physics props and the
entity's options:

```ts
await createPhysicsEntity(colliders, body, ballId, { tierPolicy: true }, world); // [!code --]
await createPhysicsEntity( // [!code ++]
  { colliders, body, target: ballId }, // [!code ++]
  { tierPolicy: true, world } // [!code ++]
); // [!code ++]
```

- **The props** ([`PhysicsEntityProps`](api:PhysicsEntityProps)): `colliders` (one or an array,
  attached to the body), `body` (without one, the colliders alone) and `target` (the `Object3D` to
  move, or an existing entity's id).
- **The options:** the entity's options (`id`, `appId`, …), `tierPolicy` and the `world`.

The entity creators took the world as a third parameter. Now it's in their options, a
[`CreateEntityOpts`](api:CreateEntityOpts) (the entity's options and `world`):

```ts
createMeshEntity(props, { appId: 'ball' }, world); // [!code --]
createMeshEntity(props, { appId: 'ball', world }); // [!code ++]
createEntity(undefined, world); // [!code --]
createEntity({ world }); // [!code ++]
```

The same for `createCameraEntity`, `createGroupEntity`, `createLightEntity` and `aekasha/lines`'
`createLineEntity`. A call without a world doesn't change, and neither does a scene JSON's
`entityOpts` (`world` is code only).

### The scene functions

**Codemod:** rewrites the calls (`reshape:getScene`, `reshape:createSceneLoader`); a flag typed
`any` is reported.

`getScene`'s flags and `createSceneLoader`'s `isCurrent` are options:

```ts
getScene('menu', true, false); // [!code --]
getScene('menu', { silent: true, throwOnError: false }); // [!code ++]
createSceneLoader(loader, false); // [!code --]
createSceneLoader(loader, { isCurrent: false }); // [!code ++]
```

### The spatial, LOD and pool functions

**Codemod:** rewrites the calls (`reshape:joinSpatialDomain`, `reshape:leaveSpatialDomain`,
`reshape:isInSpatialDomain`, `reshape:refreshSpatialRadius`, `reshape:getLodWorldSphere`, and
`reshape:InstancedMeshPool.spawn` / `.despawn` and the LOD pool's). An omitted world becomes
`getECSWorld()`, imported when the module doesn't import it. A pool's world argument that does
something (a call) is reported, and so is a call whose arguments would run in another order.

The world is required and comes first, as in the rest of these modules:

```ts
joinSpatialDomain(entityId, 'enemies'); // [!code --]
joinSpatialDomain(getECSWorld(), entityId, 'enemies'); // [!code ++]
refreshSpatialRadius(lightId, world); // [!code --]
refreshSpatialRadius(world, lightId); // [!code ++]
getLodWorldSphere(entityId, lod, world, out); // [!code --]
getLodWorldSphere(world, entityId, lod, out); // [!code ++]
```

- `joinSpatialDomain`, `leaveSpatialDomain`, `isInSpatialDomain` and `refreshSpatialRadius` on
  `aekasha/spatial`, and `getLodWorldSphere` on `aekasha/lod`.
- The callbacks your code implements keep their parameters (a `SpatialRadiusProvider`, a
  `LodTarget`).

An instanced pool's `spawn` and `despawn` (`createInstancedMeshPool`'s and
`createInstancedLodPool`'s) took a world. Now they use the pool's own, the `world` it was made
with: an instance spawned into another world outlived the mesh's scene there.

```ts
pool.spawn(world, placements); // [!code --]
pool.spawn(placements); // [!code ++]
pool.despawn(world, entityId); // [!code --]
pool.despawn(entityId); // [!code ++]
```

A pool whose instances went into another world than its own is made with that world now.

### The light setters

**Codemod:** rewrites the calls (`reshape:setLightEnabled`, `reshape:getLightTargetId`) when the
arguments that change places have no side effects, or one is a literal. Otherwise it reports the
call and leaves it: move the arguments by hand, keeping the order they run in (one in a `const`
first).

The world is required, so it comes first:

```ts
setLightEnabled(lightId, false, world); // [!code --]
setLightEnabled(world, lightId, false); // [!code ++]
getLightTargetId(lightId, world); // [!code --]
getLightTargetId(world, lightId); // [!code ++]
```

### The sky box functions

**Codemod:** rewrites the calls (`reshape:setActiveSkyBox`, `reshape:getSunDirection`,
`reshape:getMoonDirection`, `reshape:getSunElevation`, `reshape:getMoonPhase`).

`setActiveSkyBox`'s scene and the sun or moon's index are options. `SkyBodyOpts` (on
`aekasha/skybox`) is `{ index }`, 0 by default:

```ts
setActiveSkyBox('night', 'myScene'); // [!code --]
setActiveSkyBox('night', { sceneId: 'myScene' }); // [!code ++]
getSunDirection(out, 1); // [!code --]
getSunDirection(out, { index: 1 }); // [!code ++]
getMoonPhase(1); // [!code --]
getMoonPhase({ index: 1 }); // [!code ++]
```

The codemod writes the options in place, an object each call. A call left without an index
allocates nothing; a per-frame call of another sun or moon keeps its options in a constant:

```ts
const SECOND_SUN = { index: 1 }; // Once, at the module's top
getSunDirection(sunDir, SECOND_SUN); // Every frame
```

### The physics leftovers

**Codemod:** renames the setter (`rename:setMaxCcdSubstepsSync`) and reports the hooks' imports
(`removed:physicsHooks`).

- **`WorldAPI.setMaxCcdSubstepsSync(n)` is `setMaxCcdSubsteps(n)`,** on the worker proxy too
  (its `Sync` name dropped it from the proxy's type). A value set on the running world lasts until
  the next scene load; `AppConfig.physics.maxCcdSubsteps` (default 1, Rapier's; 0 turns CCD off)
  goes to every new world, and the Physics API debug tab has a field for it.
- **`PhysicsHooks` and `SolverFlags` are gone, with `WorldAPI.step`'s `hooks`:** no collider
  could ask for the hooks (no `ColliderParams` field set its active hooks), so they never ran.
  `ActiveHooks`, `ActiveCollisionTypes`, `ActiveEvents` and `CoefficientCombineRule` went too,
  though they were on no entry. A `step(queue, hooks)` call is a type error.

### Removed deprecations

**Codemod:** renames what has a replacement of the same meaning (marked "codemod" below), adds the
`typeof` to a component key named as a type (`typeof:ComponentType`), and reports the rest
(`removed:textureSync`, `removed:kernelMembers`, `removed:groupDeleteFlags`,
`removed:characterInput`, `removed:characterMembers`, `removed:legacySkyBox`,
`removed:legacySkyBoxShape`). It doesn't read JSON.

What the 5.x minors deprecated "until engine 6.0.0" is gone. The UI kit's names, the debug
entry's and the toolkit's have sections of their own below.

**The kernel** (`aekasha`):

| 5.x                                                                               | 6.0                                                                                         |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `CoreComponentType`                                                               | `ComponentType` (codemod), an `as const` object now (below)                                 |
| `registerOnAllSceneEnterings`                                                     | `registerOnAllSceneEnters` (codemod)                                                        |
| `loadTexture`, `loadTextures`                                                     | `await loadTextureAsync(…)`, several in one `Promise.all`                                   |
| `SceneHooks.sceneDeleted`                                                         | Gone: never called                                                                          |
| `removeFromGroupEntity`'s `deleteGeometries`, `deleteMaterials`, `deleteTextures` | Gone: never read (`deleteMeshes` releases a mesh entity's geometry, materials and textures) |
| `LoadSceneProps.updateLoaderStatusFn`                                             | Gone: never read (give the loader its own in `createSceneLoader`)                           |
| `AppConfig.draggableWindows`                                                      | `registerDraggableWindow` or `registerDraggableWindowKind` (`aekasha/ui`)                   |

`CoreComponentType` was an enum, so its keys were types. `ComponentType` is an `as const` object
with the same values, so a key named as a type takes `typeof` (the codemod writes it with the
rename):

```ts
type Moved = CoreComponentType.TRANSFORM; // [!code --]
type Moved = typeof ComponentType.TRANSFORM; // [!code ++]
```

`ComponentType` alone is still the type of every engine key, and a `declare module 'aekasha'`
block's `[ComponentType.X]` keys work as they are.

**Physics** (`aekasha/physics`):

| 5.x                                                 | 6.0                                                                                                   |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `PhysicsState`'s `pausedTime`, `pauseDurationTotal` | Gone with the internal wall clock: count fixed steps (`getPhysicsSubStepIndex()`, times the timestep) |

**Characters** (`aekasha/character`):

| 5.x                                                                                                                                                        | 6.0                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `createDynamicCharacter`'s `input`, `createCharacter`'s `controls`                                                                                         | A brain: `brain: { kind: 'TANK', params: { bindings } }`, a player brain on an action map |
| `CharacterInputOpts`, `CharacterInputCommonOpts`, `CharacterActionMappings`, `TankInputMappings`, `WorldFixedInputMappings`, `CameraRelativeInputMappings` | Gone with `input`: a brain's params                                                       |
| `CharacterInputHoldMode`                                                                                                                                   | `PlayerBrainHoldMode` (codemod)                                                           |
| `createDynamicCharacter`'s `charData`                                                                                                                      | `config` (its keys without the `_`)                                                       |
| `createCharacter`'s `data`, `CharacterObject.data`, `DynamicCharacter.data`, the `CharacterData` type                                                      | The controller's `state`, `config.values` and `internal`                                  |
| `CharacterObject.kind`, a body plan's `kind` (`HUMANOID_CAPSULE`'s)                                                                                        | `bodyKind`                                                                                |
| `CharacterObject.keyBindingIds`, `mouseBindingIds`                                                                                                         | Gone with `controls`: the brain's action map                                              |
| `CharacterObject.initialConfig`                                                                                                                            | The controller's `config.initial` (its keys without the `_`)                              |
| `CharacterCastRecord.resolvedAt`                                                                                                                           | `resolvedAtStep` (a step index)                                                           |

**The sky box** (`aekasha/skybox`):

| 5.x                                                                                  | 6.0                                                                                             |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| The pre-3.0 `{ type, params }` sky box, in a JSON or `createSkyBox`                  | A layered definition (`base`, `env`): the old shape fails the schema (`A sky box needs a base`) |
| `LegacySkyBoxProps`, `isLegacySkyBoxProps`, `LEGACY_SKYBOX_WARNING`                  | Gone with the shape                                                                             |
| A sky box `__saveData` entry in the flat pre-3.0 shape (`{ colorSpace, roughness }`) | Parses, but nothing applies: move its values into the entry's layers (`base`, …) by hand        |

5.x converted an old sky box when it loaded, with an equirect's `rotate: π` and a cube's
`flipY: true` (its old look in the standard orientation): a hand-converted one adds them for the
same look.

### The debug entry's names

**Codemod:** reports them (`removed:debugEntry`, `removed:debuggerTabOpts`).

On `aekasha/debug`:

| 5.x                                                                                                                                                                                      | 6.0                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `DEV_FILES_ROUTE_BASE`, `DEV_FILES_TOKEN_HEADER`, `DEV_FILES_TOKEN_META`, `DEV_FILES_HASH_HEADER`, `AEK_GATHER_EVENT`, `DevFilesStageBody`, `DevFilesSaveDataWrite`, `DevFilesErrorBody` | Internal (the dev server's protocol): `writeDevFiles`, `readDevFile` and `onDevDataGathered`     |
| `TestBridgeProbeResult`, `TestBridgeSceneReady`, `TestBridgeSnapshot`                                                                                                                    | Internal (the scene runner's): no replacement                                                    |
| `createDebuggerTab(def, opts)`, `DebugGUIOpts`                                                                                                                                           | `createDebuggerTab(def)`: the drawer's button stays in the middle of its edge (move it with CSS) |

The protocol types the client API names stay public (`DevFilesStatusBody`, `DevFilesCommitBody`,
`DevFilesConflicts`, `DevFilesSchemaIssues`, `DevFilesErrorCode`, `DevFilesWriteStatus`,
`DevFilesSaveData`, `DevDataGatheredEvent`).

### The UI kit's names

**Codemod:** renames the aliases (`rename:TCMP`, …, `rename:TDropDown`), rewrites `getSvgIcon`'s
`'small'` (`rewrite:svgIconSmall`) and reports the rest (`removed:uiKitMembers`,
`removed:stringKbd`).

On `aekasha/ui`:

| 5.x                                                                                                                                             | 6.0                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `TCMP`, `TProps`, `TSettings`, `TListener`, `TListenerCache`, `TListenerCreator`, `TStyle`, `TAttr`, `TClassAction`, `TAnimChain`, `TAnimState` | `CMPHandle`, `CMPProps`, `CMPSettings`, and each other's `CMP` name: `CMPListener`, … (codemod) |
| `TDropDown`                                                                                                                                     | `DropDown` (codemod)                                                                            |
| `getSvgIcon(name, 'small')`                                                                                                                     | `getSvgIcon(name, 'sm')` (codemod)                                                              |
| A string `kbd` on `ButtonProps`, `SplitButtonProps`, `MenuActionItem` and `MenuCheckboxItem`                                                    | A Kbd: `kbd: createKbd({ keys: 'Ctrl+S' })`, which its owner removes with itself                |
| `AddToastResponse.timeout`                                                                                                                      | `removeToast(id)` removes a toast early                                                         |
| `CMPSettings.doCheckIsInDom`                                                                                                                    | Gone: never read                                                                                |

- **The icon classes:** `getSvgIcon` no longer writes the `uiIcon` and `smallIcon` classes. A
  style of yours on them targets `.aekIcon` (and `[data-size='sm']`) instead.
- The command palette's `kbd` stays text.

### Toolkit 3.0.0

**Codemod:** moves and renames the imports (`move:createSeededRandom`, `rename:PhysicsParams`),
writes the component keys' `typeof` (`typeof:HoverToolComponentType`, …) and reports the moving
platform's delete options (`removed:deleteMeshOptions`, `removed:movingPlatformMembers`).

| 2.x                                                                                                                    | 3.0                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `createSeededRandom` from `aekasha/toolkit/geometry`                                                                   | From `aekasha` (codemod): the toolkit's was a copy                                              |
| `PhysicsParams`                                                                                                        | `MovingPlatformPhysicsParams` (codemod)                                                         |
| `DeleteMeshOptions`, `MovingPlatformOptions.deleteMeshOptions`                                                         | Gone: never read (the platform's `controls.delete()` deletes its entity, its mesh and its body) |
| The enums `HoverToolComponentType`, `FollowToolComponentType`, `SunShadowFitComponentType`, `WorldAnchorComponentType` | `as const` objects with the same values (below)                                                 |

Like the engine's `CoreComponentType`, the four keys were enums and are `as const` objects now, so
a key named as a type takes `typeof`. The key alone as a type was the enum's union of its values,
now written out:

```ts
type Hover = HoverToolComponentType.HOVER; // [!code --]
type Hover = typeof HoverToolComponentType.HOVER; // [!code ++]
type AnyHoverKey = HoverToolComponentType; // [!code --]
type AnyHoverKey = (typeof HoverToolComponentType)[keyof typeof HoverToolComponentType]; // [!code ++]
```

The codemod writes both. The `declare module 'aekasha'` blocks' `[HoverToolComponentType.HOVER]`
keys work as they are, and so does code that only uses a key's values.
