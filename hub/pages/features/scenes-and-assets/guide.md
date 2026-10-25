## A scene

<<< src/app/examples/quickStart/exampleQuickStart.scene.json

- `sceneFile` is the scene's code, from `src/app/`. It exports `scene`, which the engine calls
  once the JSON's assets are loaded.
- The lists name assets by their id (or hold one inline): `cameras`, `lights`, `geometries`,
  `textures`, `materials`, `meshes`, `importedAssets`, `skyboxes` and `postFx`. The cameras are
  created first, before the assets load; the lights and meshes right after the scene file runs,
  so its code reaches them on the scene's enter.
- Other keys set up the scene itself: `postFxEnabled`, `backgroundColor`, `spatialDomains` (see
  [Spatial index](hub:features/spatial-index)) and `impostors` (see
  [LOD and impostors](hub:features/lod#exporting-an-impostor)).
- `name` is the scene's name in the debugger's scene lists.

## The asset types

The engine finds every file with one of these suffixes under `src/` by itself:

| Suffix                 | What it is                                                                 |
| ---------------------- | -------------------------------------------------------------------------- |
| `*.scene.json`         | A scene.                                                                   |
| `*.camera.json`        | A perspective or orthographic camera.                                      |
| `*.light.json`         | A light of any three.js type.                                              |
| `*.geometry.json`      | A geometry: a three.js type and its params.                                |
| `*.texture.json`       | A texture, and how the asset pipeline encodes it.                          |
| `*.textureArray.json`  | Textures of one size as the layers of one array texture.                   |
| `*.textureAtlas.json`  | Images packed into one atlas, each a named slot.                           |
| `*.material.json`      | A material: a three.js one, or a TSL node material with its `tslFile`.     |
| `*.mesh.json`          | A mesh: its geometry, material, transform, shadows and levels of detail.   |
| `*.importedAsset.json` | A glTF or GLB model to import, and how the asset pipeline optimizes it.    |
| `*.skybox.json`        | A [sky box](hub:features/sky-box).                                         |
| `*.postFx.json`        | A [PostFX pass](hub:features/rendering#post-effects), with its `*.tsl.ts`. |
| `*.impostor.json`      | An exported [impostor](hub:features/lod#impostors), written by its export. |

Each has a Zod schema in `src/_engine/schemas/`. Start a file with a `$schema` line pointing at
`.schemas/<type>.schema.json`, and your editor checks and autocompletes it as you type.

The gather fails, naming the file, on a JSON that doesn't parse or fails its schema, on an id two
files give, and on an id a scene lists that no asset JSON has. In `yarn dev` the page then stays
as it was until the next save fixes it, and `yarn build` stops.

## Where the files go

The gatherer finds an asset JSON anywhere under `src/`, so a folder is a convention, not a rule
the engine reads. The app keeps a folder per scene:

```text
src/app/
  scenes/<sceneId>/   <sceneId>.scene.json, <sceneId>.ts, its debug tab's _dbg__ module, its Hub
                      image, its own modules, and the assets only this scene uses
  examples/<name>/    the Hub's examples, one scene each
  shared/             code several scenes use
  textures/ skyboxes/ impostors/ postFx/ …
                      the assets several scenes use, each in its type's folder
```

- **One scene uses it: its folder.** An asset (and its images or model) that no other scene names
  in its scene JSON, its scene file or one of its assets goes in that scene's folder. When a
  second scene starts using it, move it to its type's folder; `cameras/`, `lights/`,
  `materials/`, `meshes/`, `geometries/` and `importedAssets/` appear with the first shared one.
- **Name a scene's folder and files after its id.** The id is what everything else keys on: the
  `__saveData` entries, `?startScene=`, the debugger's saved state.
- **Moving a file changes no id**, so the scenes that name it don't change. What does is in the
  file itself: its `$schema` (one more `../` per folder), its paths that start `./` or `../`
  (`image`, `fileName`), and the paths from the app's folder: a scene's `sceneFile`
  (`./scenes/myScene/myScene.ts`) and a TSL material's `tslFile`
  (`scenes/myScene/myMaterial.tsl.ts`), which are relative to `src/app/` (to `src/toolkit/` for
  the toolkit's own).

The toolkit's assets sit by kind instead (see [Toolkit](hub:features/toolkit#what-s-in-it)).

## The gatherer

`devTools/gatherAppData.ts` walks `src/`, checks every asset JSON against its schema, and writes
the generated data to `src/generated/`: the JSON, and the scene, TSL material and PostFX files by
id. `src/index.ts` hands it to [`InitEngine`](api:InitEngine) as `data`, and the engine loads its
scenes from it. It runs before `yarn dev` and `yarn build`, and in `yarn dev` on every save: the
page reloads with the change, and an invalid file shows an error overlay naming the file and the
problem. `yarn gatherAppData` runs it by hand.

The code files load on demand, each in a chunk of its own in a build: a scene's file when the
scene loads, and a TSL material's or a PostFX pass's with the scene that lists it. A TSL material
your code creates at another time needs its file loaded first:
[`loadTslMaterialFileAsync`](api:loadTslMaterialFileAsync).

The textures and models the JSONs point at go through the
[asset pipeline](hub:features/asset-optimization) first.

### The feature manifest

Some scene and mesh fields belong to a feature: `skyboxes` to the sky box (`skyBox()`), `postFx`
and `postFxEnabled` to PostFX (`postFx()`), `spatialDomains` to the spatial index (`spatial()`),
and `impostors` and a mesh's `lod` to LOD (`lod()`). The gatherer writes the features each scene's
data uses into the generated data (the scene's `__features`), and `InitEngine` checks every scene,
loaded or not, against its `features` before anything boots:

```text wrap
InitEngine: a scene's data needs a feature `features` doesn't list: the scene 'myScene' needs the feature 'skybox' (skyBox() from 'aekasha/skybox'). List it, or take its fields out of the scene's data.
```

Only the data counts: a sky box or levels of detail your scene code makes aren't in the manifest,
so list their features yourself.

## Per-scene overrides

An asset shared by several scenes can look different in one of them. Its `__saveData` holds,
per scene id, a list of overrides, newest first, and the scene uses the newest:

```json
{
  "__saveData": {
    "myScene": [
      {
        "__meta": { "date": 1779449688109, "engineVersion": "4.14.0" },
        "intensity": 0.5
      }
    ]
  }
}
```

An entry names only what it changes, and most fields replace the asset's whole. A few merge key
by key: `params` (a geometry's, a material's, a PostFX pass's), a TSL material's `nodes`, a sky
box's whole definition, and a mesh's `geo` and `mat` props when they keep the type (props over a
geometry or material id, or of another type, must be complete). An entry's `__meta` records the
versions it was saved with, and the gatherer warns when the entry in use comes from another major
version. Debug tools write these entries through the
[dev file server](hub:features/debug-suite#dev-file-server).

## Loading scenes

[`loadScene`](api:loadScene) switches scenes. A load:

1. Tears the previous scene down: the features' part first (its physics entities, its sky box,
   its post effects, its viewports), then its groups and loopers, then its exit hooks, then every
   other entity it created, except those created with `persistent: true`.
2. Creates the next scene's cameras and starts a fresh physics world (see
   [deterministic scene loads](hub:features/physics#deterministic-scene-loads)).
3. Loads the next scene's assets, then runs its scene file and creates its lights and meshes.
4. Releases what the previous scene loaded and the next one doesn't use. An asset both use is
   kept, not loaded again. (`deletePrevScene: true` releases first instead: a lower peak in
   memory, but shared assets load again.)
5. Runs the next scene's enter hooks.

One load runs at a time. A `loadScene` call while a scene loads waits for that load, then runs,
and a later call meanwhile takes its place (the last request wins):

```ts
const isLoaded = await loadScene({ sceneId: 'level2' });
if (!isLoaded) showMenu(); // It failed, or a later call took its place
```

- It resolves `true` once the scene is current, and `false` when the load failed or another call
  replaced it. It never rejects: a failed load is logged, the input and the debugger come back,
  and the scene that was current stays current (torn down, when the load failed after the
  teardown: load another scene). A broken scene's assets aren't released yet (see
  [the issue](hub:issues/failed-scene-load-keeps-its-assets)).
- Never `await` it in a scene file or a scene hook: the call would wait for the load it runs in.
  Call it without `await` there, and it runs once that load has finished.

[`createSceneLoader`](api:createSceneLoader) gives the load its screen: your functions for its
start and end and its progress, with a HUD element of its own. The UI kit's
[loading overlay](hub:features/ui-kit/core#loading-overlays) is one ready made, with its fades and a
progress bar.

In a scene file, [`registerOnSceneEnter`](api:registerOnSceneEnter) and
[`registerOnSceneExit`](api:registerOnSceneExit) add hooks,
[`createSceneAppLooper`](api:createSceneAppLooper) runs a function every frame while the app
plays (and [`createSceneMainLooper`](api:createSceneMainLooper) also while it's paused), and
scene-scoped features take a `sceneId` to remove themselves on exit. A system that should run
in lockstep with physics goes in the ECS instead (see [ECS](hub:features/ecs#systems-and-stages)).

- A scene has one enter hook and one exit hook: registering again replaces it, so a scene file
  can register on every visit. Each call returns its remover.
- [`registerOnAllSceneEnters`](api:registerOnAllSceneEnters) and
  [`registerOnAllSceneExits`](api:registerOnAllSceneExits) run for every scene, one function per
  id, after the scene's own hook. (`registerOnAllSceneEnterings` is the old name, deprecated.)

## Key APIs

- [`loadScene`](api:loadScene) and [`createSceneLoader`](api:createSceneLoader).
- [`registerOnSceneEnter`](api:registerOnSceneEnter),
  [`registerOnSceneExit`](api:registerOnSceneExit),
  [`registerOnAllSceneEnters`](api:registerOnAllSceneEnters),
  [`createSceneAppLooper`](api:createSceneAppLooper) and
  [`createSceneMainLooper`](api:createSceneMainLooper).
- [`getMaterial`](api:getMaterial), [`getTexture`](api:getTexture) and
  [`getGeometry`](api:getGeometry): the assets a scene loaded, by id.
- [`createMeshEntity`](api:createMeshEntity), [`createMaterial`](api:createMaterial),
  [`loadTextureAsync`](api:loadTextureAsync) and [`importAssetAsync`](api:importAssetAsync): the
  same assets from code ([`loadTslMaterialFileAsync`](api:loadTslMaterialFileAsync) before a TSL
  material). The synchronous `loadTexture` and `loadTextures` are deprecated: they load neither
  the asset pipeline's output nor in the assets worker, and their errors never reach you.

## Read more

- The [quick start](hub:examples/quick-start).
- The API reference: [`scene/`](hub:documentation/aekasha/scene) and [`assets/`](hub:documentation/aekasha/assets) of
  `aekasha`, and [`aekasha/schemas`](hub:documentation/aekasha/schemas).

::: claude-md
:::
