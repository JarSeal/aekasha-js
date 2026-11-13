## A scene

<<< src/app/examples/quickStart/exampleQuickStart.scene.json

- `sceneFile` is the scene's code, from `src/app/`. It exports `scene`, which the engine calls
  once the JSON's assets are loaded.
- The lists name assets by their id (or hold one inline): `cameras`, `lights`, `geometries`,
  `textures`, `materials`, `meshes`, `importedAssets`, `skyboxes` and `postFx`. The cameras are
  created first, before the assets load; the lights and meshes right after the scene file runs,
  so its code reaches them on the scene's enter. The textures its materials, spot lights and
  background name needn't be listed: the gather adds them (see
  [a scene's textures](hub:features/scenes-and-assets#a-scene-s-textures)).
- Other keys set up the scene itself: `postFxEnabled`, `backgroundColor`, `spatialDomains` (see
  [Spatial index](hub:features/spatial-index)), `impostors` (see
  [LOD and impostors](hub:features/lod#exporting-an-impostor)) and `mergeGroups` (see
  [Mesh merging](hub:features/mesh-merging#auto)).
- `name` is the scene's name in the debugger's scene lists.

## The asset types

The engine finds every file with one of these suffixes under `src/` by itself:

| Suffix                 | What it is                                                                  |
| ---------------------- | --------------------------------------------------------------------------- |
| `*.scene.json`         | A scene.                                                                    |
| `*.camera.json`        | A perspective or orthographic camera.                                       |
| `*.light.json`         | A light of any three.js type.                                               |
| `*.geometry.json`      | A geometry: a three.js type and its params, or a merge of other geometries. |
| `*.texture.json`       | A texture, and how the asset pipeline encodes it.                           |
| `*.textureArray.json`  | Textures of one size as the layers of one array texture.                    |
| `*.textureAtlas.json`  | Images packed into one atlas, each a named slot.                            |
| `*.material.json`      | A material: a three.js one, or a TSL node material with its `tslFile`.      |
| `*.mesh.json`          | A mesh: its geometry, material, transform, shadows and levels of detail.    |
| `*.importedAsset.json` | A glTF or GLB model to import, and how the asset pipeline optimizes it.     |
| `*.skybox.json`        | A [sky box](hub:features/sky-box).                                          |
| `*.postFx.json`        | A [PostFX pass](hub:features/rendering#post-effects), with its `*.tsl.ts`.  |
| `*.impostor.json`      | An exported [impostor](hub:features/lod#impostors), written by its export.  |

Each has a Zod schema in `src/_engine/schemas/`. Start a file with a `$schema` line pointing at
`.schemas/<type>.schema.json`, and your editor checks and autocompletes it as you type.

The gather fails, naming the file, on a JSON that doesn't parse or fails its schema, on an id two
files give, and on an id a scene lists that no asset JSON has. In `yarn dev` the page then stays
as it was until the next save fixes it, and `yarn build` stops.

## Textures

A `*.texture.json` names an image and how it's sampled:

```json
{
  "$schema": "../../../.schemas/texture.schema.json",
  "id": "rockAlbedo",
  "fileName": "./rockAlbedo.png",
  "texOpts": {
    "colorSpace": "srgb",
    "wrapS": "REPEAT",
    "wrapT": "REPEAT",
    "minFilter": "LINEAR_MIPMAP_LINEAR",
    "anisotropy": "MAX",
    "repeat": [4, 4]
  }
}
```

- **`texOpts`** sets three's texture properties over the loader's. Your editor lists each one with
  three's default, from the `$schema`.
- **three's constants** (`mapping`, `wrapS`, `wrapT`, `magFilter`, `minFilter`, `type`, `format`)
  take a name (`"REPEAT"`, `"LINEAR_MIPMAP_LINEAR"`, `"CLAMP_TO_EDGE"`) or three's number
  (`1000`). The gather writes the number, so the names cost the build nothing.
- **The UV transform:** `repeat`, `offset` and `center` as `[x, y]`, and `rotation` in radians
  around `center`. A repeat past 1 needs `"REPEAT"` wrapping. Changing one after the first frame
  (in the material editor, say) needs no new shader.
- **`anisotropy`** is a sample count from 1 (off), or `"MAX"` for the device's most.
- **The upload:** `flipY`, `generateMipmaps` and `premultiplyAlpha`, and `colorSpace`: `"srgb"`
  for a colour map, `"srgb-linear"` or `""` for data (a normal or roughness map).
- **`flipY: false`** is for an image whose UVs start at the top, as a glTF's do. The
  [asset pipeline](hub:features/asset-optimization) encodes such a texture unflipped, apart from
  the flipped one. A texture array's layer and an atlas's slot are always stored flipped, so
  their `texOpts` refuse it.
- **`isPersistent: true`** keeps the texture loaded past every scene's release: only
  [`deleteTexture`](api:deleteTexture) removes it.

## Merged geometries

A `MERGED` geometry is several geometries, each with its own transform, joined into one: a wall
section kit-bashed from pieces draws once wherever a mesh uses it.

```json
{
  "geoProps": {
    "id": "ruinWallSection",
    "type": "MERGED",
    "params": {
      "parts": [
        { "geo": "ruinKit/wallStraight" },
        {
          "geo": "ruinKit/wallStraight",
          "position": { "x": 4, "y": 0, "z": 0 },
          "rotation": { "x": 0, "y": 3.1416, "z": 0 }
        },
        {
          "geo": "ruinKit/pillar",
          "position": { "x": 2, "y": 0, "z": 0 },
          "scale": { "x": 1, "y": 1.2, "z": 1 }
        }
      ]
    }
  }
}
```

- **A part** is a geometry id and a mesh's transform: `position`, `rotation` (Euler radians) or
  `quaternion` (which wins), and `scale`. A mirroring scale is fine: its triangles are turned
  round, so it isn't drawn inside out. `materialSlot` and `key` are optional.
- **The id** is a geometry JSON's or an imported model's piece (`<importId>/<nodeName>`), never
  another `MERGED` geometry: merges don't nest. List the parts' geometries and imports in the
  scene too, so they load with it. The merge only reads them: they stay loaded with the scene.
- **The options**: `groups: "BY_SLOT"` makes a geometry group per `materialSlot`, for a mesh with
  a material array (`"NONE"`, the default, for one material); `attributes: "INTERSECTION"` drops
  the attributes not every part has (`"UNION"`, the default, fills them in); `indexed: false`
  gives a non-indexed geometry. A morphed or skinned part can't be merged.
- **It's merged when the scene loads**, after its other geometries, in the assets worker, so a
  large merge doesn't hold up a frame. `AppConfig.assets.mergeWorkerTarget` (or
  `VITE_ASSETS_MERGE_WORKER_TARGET`) moves it to the main thread; it defaults to
  `WORKER_THREAD`, whatever the other assets' target. The merge's code is a chunk of its own,
  loaded with a scene's first `MERGED` geometry.
- **The gather checks the ids:** it fails on a part that names no geometry JSON and no import, or
  names a `MERGED` geometry, and warns about a part whose geometry or import the scene doesn't
  list (a persistent asset can still provide it). An import's node names aren't known until it
  loads: a wrong one fails at load, where the merge is logged and left out, the meshes using it
  aren't created, and the load goes on.
- **In a streaming scene**, a cell that loads a merge loads its parts too. The gather can't
  measure a merged geometry, so a mesh using one is placed at its position as a point: give a large
  one a radius in [`streaming.radii`](hub:features/streaming#content-from-the-scene-json), or it won't be
  kept by the cells it reaches.

From code, [`registerMergedGeometry`](api:registerMergedGeometry) merges registered ids or
geometries, each with a `matrix`, and registers the result;
[`mergeGeometryParts`](api:mergeGeometryParts) returns it unregistered. Their `*Async` versions,
[`registerMergedGeometryAsync`](api:registerMergedGeometryAsync) and
[`mergeGeometryPartsAsync`](api:mergeGeometryPartsAsync), merge in the assets worker: use them
for a large merge (100k vertices block a slow device's frame for tens of milliseconds). For a few
thousand vertices the round trip costs more than the merge, and a scene's first worker request
waits for the worker to start. Either way the geometry's `userData.mergeParts` lists each part's
vertex and index range.

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
scene loads, and a TSL material's or a PostFX pass's with the scene that lists it. A material
your code creates at another time needs its file and textures loaded first:
[`ensureMaterialDependencies`](api:ensureMaterialDependencies) loads both.

The textures and models the JSONs point at go through the
[asset pipeline](hub:features/asset-optimization) first.

### A scene's textures

A scene lists the materials it uses, and the gather adds the textures they name to its
`textures`. It reads the listed materials, each mesh's inline `mat` and its `matOverrides`: their
`params` texture slots (`map`, `normalMap`, …) and their TSL `inputs` and `nodes` (a texture id,
`{ "texture": … }`); and the scene's spot lights' cookies (`map`) and its `backgroundTexture`. The
added textures come after the listed ones, each once, and load, release and stream with the
scene as listed ones do.

- **An id no texture JSON has** fails the gather, naming what names it:

  ```text wrap
  Scene "myScene": the material "rockMat" names the texture "rockAlbedo", which no asset JSON (or only an invalid one) has, and the scene doesn't list it inline.
  ```

- **List a texture yourself** when only your code names it, or a value of your own
  [input resolver](hub:features/toolkit#graphs-and-input-forms-from-code), which the gather can't
  read. A listed texture stays listed: the gather only adds.
- The debugger's Assets tab shows the added textures as listed ones.

### The feature manifest

Some scene and mesh fields belong to a feature: `skyboxes` to the sky box (`skyBox()`), `postFx`
and `postFxEnabled` to PostFX (`postFx()`), `spatialDomains` to the spatial index (`spatial()`),
`impostors` and a mesh's `lod` to LOD (`lod()`), and `mergeGroups` and a mesh's `merge` to mesh
merging (`merging()`). The gatherer writes the features each scene's
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
by key: `params` (a geometry's, a material's, a PostFX pass's), a TSL material's `inputs` and
`nodes`, a sky box's whole definition, and a mesh's `geo` and `mat` props when they keep the type
(props over a geometry or material id, or of another type, must be complete). An entry's `__meta` records the
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
  id, after the scene's own hook.

## Key APIs

- [`loadScene`](api:loadScene) and [`createSceneLoader`](api:createSceneLoader).
- [`registerOnSceneEnter`](api:registerOnSceneEnter),
  [`registerOnSceneExit`](api:registerOnSceneExit),
  [`registerOnAllSceneEnters`](api:registerOnAllSceneEnters),
  [`createSceneAppLooper`](api:createSceneAppLooper) and
  [`createSceneMainLooper`](api:createSceneMainLooper).
- [`getMaterial`](api:getMaterial), [`getTexture`](api:getTexture) and
  [`getGeometry`](api:getGeometry): the assets a scene loaded, by id.
- [`registerMergedGeometry`](api:registerMergedGeometry) and
  [`registerMergedGeometryAsync`](api:registerMergedGeometryAsync): a merged geometry from code.
- [`createMeshEntity`](api:createMeshEntity), [`createMaterial`](api:createMaterial),
  [`loadTextureAsync`](api:loadTextureAsync) and [`importAssetAsync`](api:importAssetAsync): the
  same assets from code ([`ensureMaterialDependencies`](api:ensureMaterialDependencies) before a
  material: its textures and TSL file).

## Read more

- The [quick start](hub:examples/quick-start).
- The API reference: [`scene/`](hub:documentation/aekasha/scene) and [`assets/`](hub:documentation/aekasha/assets) of
  `aekasha`, and [`aekasha/schemas`](hub:documentation/aekasha/schemas).

::: claude-md
:::
