## What's in it

The toolkit is sorted by kind. Its code has three entries, `aekasha/toolkit/ecs`,
`aekasha/toolkit/geometry` and `aekasha/toolkit/materials`; its assets (the materials' and
models' JSONs) are found by id, like the app's:

```text
src/toolkit/
  ecs/                      aekasha/toolkit/ecs
    effects/                FollowTool, HoverEffect, MutualGravity, SunShadowFit,
                            WorldAnchorSync
    gameplay/               FollowObjectCameraRig, movingPlatform/
  geometry/                 aekasha/toolkit/geometry
    generate/               Asteroid, Foliage, Terrain
    scatter/                ScatterOnSurface
  materials/                aekasha/toolkit/materials
    <id>/                   <id>.material.json and <id>.tsl.ts
    TriplanarProjection.ts
  models/<category>/<id>/   the model next to its *.importedAsset.json
```

A piece that grows a second file gets a folder of its own inside its kind, as the moving
platform did.

### ECS effects

In `ecs/effects/`. Each is a system you register once per world, in the app's feature in
`src/AppECSPlugins.ts` (see [ECS](hub:features/ecs#plugins-and-hooks)); a second call on the same
world does nothing. Three of them act on the entities that have their component; the gravity
keeps a list of bodies instead. The world anchor sync is the exception: it updates the UI pieces
a scene makes, so the scene registers it with them.

- [`registerHoverToolEffect`](api:registerHoverToolEffect): an entity with a `HOVER` component
  ([`HoverToolData`](api:HoverToolData)) bobs on a sine around `baseY`, at `speed` and
  `amplitude`. Its `time` is the phase: give entities different ones and they don't bob in step.
- [`registerFollowToolEffect`](api:registerFollowToolEffect): an entity with a `FOLLOW` component
  ([`FollowToolData`](api:FollowToolData)) moves toward another entity plus an offset, at the
  same speed at any frame rate. A follower with a target link (a directional or spot light) moves
  its target too, so the light keeps shining on the leader from the same angle.
- [`registerSunShadowFitEffect`](api:registerSunShadowFitEffect): a directional light with a
  `SUN_SHADOW_FIT` component ([`SunShadowFitData`](api:SunShadowFitData)) fits its shadow camera
  to the main camera's view every frame, out to `maxDistance`, snapped to the shadow map's
  texels so the edges don't shimmer. A light the sky box drives is skipped with a warning (it
  follows the camera on its own).
- [`registerMutualGravityEffect`](api:registerMutualGravityEffect): Newtonian gravity between the
  bodies you add with [`addGravityBody`](api:addGravityBody) (an entity and its mass), on every
  physics step, for zero-g scenes. Each pair is computed once and pushed equal and opposite, so
  the cost grows with the square of the bodies: fine for tens. The settings
  ([`setMutualGravityConfig`](api:setMutualGravityConfig)) are global; the bodies are dropped on
  every scene exit. Deterministic with physics on the main thread only.
- [`registerWorldAnchorSync`](api:registerWorldAnchorSync): feeds the UI kit's
  [world anchors and compass](hub:features/ui-kit/game#world-anchors) from the ECS. An entity with
  a `WORLD_ANCHOR` component ([`WorldAnchorData`](api:WorldAnchorData): an anchor of the layer,
  raised by `offsetY`) keeps its anchor on its drawn position: one `LATE_MAIN` system, after the
  render, moves the anchors, projects the layer with the active camera and turns the compass, also
  while the app is paused. Removing the component, or the entity, removes its anchor. A scene
  registers it with its own layer and compass (a second call replaces them) and
  [`unregisterWorldAnchorSync`](api:unregisterWorldAnchorSync) on its exit.
  [`getCompassBearing`](api:getCompassBearing) turns a direction on the ground into the compass's
  bearing, for a waypoint's marker. The [game HUD example](hub:examples/game-hud#ui-in-the-world)
  puts nameplates, health bars and a waypoint on it.

### Gameplay

In `ecs/gameplay/`, each with a system to register once per world:

- [`createFollowObjectCameraRig`](api:createFollowObjectCameraRig): a camera that follows an
  object at an offset, smoothed, reading the pose that's drawn. It can keep its view direction
  (`orientation: 'FIXED'`) and look ahead of where the object is going (`lookAhead`), as in the
  [character example](hub:examples/character#the-camera). With `getMouseMoveInput` (the pointer's
  or a stick's movement each frame, in pixels) it orbits the object at `offset`'s length instead,
  starting from `offset`'s direction, as in the
  [game HUD example](hub:examples/game-hud#the-camera). Give it the scene's `sceneId` and it's
  deleted when the scene exits.
- [`createMovingPlatform`](api:createMovingPlatform): a kinematic platform moving along a closed
  path of points, on every physics step, so characters ride it: the body's user data carries the
  segment's velocities, which the dynamic character reads. It plays forward forever by default;
  `opts` sets the loops, the direction and the speed, and the returned
  [`controls`](api:MovingPlatformControls) pause, play, stop and play single segments. The
  controls write the body when you call them, not in the physics step: a scene that must replay
  exactly calls them from an `APP_PHYSICS_STEP` system.

### TSL materials

In `materials/<id>/`, each a `*.material.json` with its `*.tsl.ts`, so a scene lists it by id like
any material:

- **`triplanarCheckerboard`** and **`triplanarGrid`**: a checkerboard (with an optional "+" in
  every cell) and a grid of major and minor lines (with optional grooves along them), both in
  meters and projected from the three axes, so they need no UVs. Their switches are static
  defines: `alignToObject` (the pattern turns with the mesh; off, it's in world space and runs on
  across separate meshes), `fitToBounds` (a whole number of cells across the mesh's bounds),
  `dominantAxis` (one projection per surface instead of a blend: no doubled lines on ramps, hard
  seams on curves), and the checkerboard's `plusSigns`, the grid's `minorLines` and
  `seamNormals`. They share [`triplanarProjection`](api:triplanarProjection) and its helpers.
- **`asteroid`**: a rock surface in object space: mottled colours, pits, mineral speckles, and the
  roughness and a bump from the same noise. Every input is on its `colorNode`, and a mesh gives it
  a `seed` of its own (`matOverrides: { nodes: { colorNode: { seed: 7 } } }`) for a different rock.
  The `octaves` define sets the mottling's detail.

The [material editor](hub:features/debug-suite#editor-views) edits their inputs live. Writing
one of your own is [below](hub:features/toolkit#writing-a-tsl-material).

### Procedural geometry

In `geometry/`. Every generator takes a seed (an integer) and gives the same result for it, and
returns a geometry that isn't registered: save it with `saveBufferGeometry`, or hand it to an
instanced pool, which owns it.

- [`generateTerrain`](api:generateTerrain): a noise terrain grid, with its `heights` and a
  `getHeightAt(x, z)` that gives the height of the mesh's own triangle under the point, so what you
  place with it sits on the mesh. `heights` is row-major, and a `HEIGHTFIELD` collider reads
  column-major ([an open issue](hub:issues/heightfield-grid-layout)): give the body a `TRIMESH` of
  the geometry, which matches the mesh exactly.
- [`generateTreeGeometry`](api:generateTreeGeometry) and
  [`generateBushGeometry`](api:generateBushGeometry): low-poly foliage. A tree is one geometry
  with two material groups (`materialGroups`: the trunk's and the canopy's).
- [`scatterOnSurface`](api:scatterOnSurface): placements on a mesh's surface, each with its
  position, normal, rotation and scale in world space, kept `minSpacing` apart (it may return
  fewer than `count` then). The app hands them to an instanced pool
  ([`createInstancedMeshPool`](api:createInstancedMeshPool) or
  [`createInstancedLodPool`](api:createInstancedLodPool)'s `spawn`), as `largeWorld` does for its
  trees, bushes and rocks. For a plain `InstancedMesh`,
  [`bakeScatterToInstancedMesh`](api:bakeScatterToInstancedMesh) writes them in;
  [`spawnScatterAsMeshEntities`](api:spawnScatterAsMeshEntities) makes a mesh entity of each, for
  a few.
- [`generateAsteroid`](api:generateAsteroid): a rocky body with craters. Next to its geometry it
  returns `hullVertices` for a `CONVEXHULL` collider and `hullVolume`, the volume the physics
  engine gives that collider, so a gravity mass of density × `hullVolume` matches the simulated
  body. The `asteroid` material dresses it.

The generators draw from the engine's
[`createSeededRandom`](api:utils/SeededRandom.createSeededRandom) (on `aekasha`), which an app
imports from there too.

### Models

By category, in `models/<category>/<id>/`. The Ækasha symbol (`brand/aekashaSymbol/`): the Æ
glyph extruded with a small bevel, a Draco GLB with its `*.importedAsset.json`, ready for a
scene's `importedAssets`.

## Writing a TSL material

A TSL material is two files: the `*.material.json` that a scene lists by id, and the `*.tsl.ts`
whose functions build its nodes. The file exports a `setup` function, which sets any of the
material's sockets from one graph, or a function per socket, or both.

### One graph: `setup`

TSL reuses a node object, not an equal expression built twice: two socket functions that each
sample a texture sample it twice in the shader. A `setup` function builds the shared work (the
samples, the coordinates, the blend weights) once and sets every socket from it. The app's
`testTslMat` samples its texture once for its colour, roughness and glow:

::: code-group

<<< src/app/scenes/sceneTestECS/testTslMat.material.json title="testTslMat.material.json"

<<< src/app/scenes/sceneTestECS/testTslMat.tsl.ts title="testTslMat.tsl.ts" collapse

:::

- **The JSON.** `type` is a node material (`STANDARDNODEMATERIAL` and the like), `tslFile` its TSL
  file (relative to `src/app/`, or to `src/toolkit/` for the toolkit's), `params` three's own
  material props, `staticDefines` its switches, and `inputs` the values `setup` gets.
- **`setup`** is called as `(inputs, material, staticDefines)` when the material is created, and
  sets the sockets on `material` (`material.colorNode = …`, `material.roughnessNode = …`). It
  returns nothing.

### A function per socket

The checkerboard has a function per socket instead:

::: code-group

<<< src/toolkit/materials/triplanarCheckerboard/triplanarCheckerboard.material.json title="triplanarCheckerboard.material.json"

<<< src/toolkit/materials/triplanarCheckerboard/triplanarCheckerboard.tsl.ts title="triplanarCheckerboard.tsl.ts" collapse

:::

- **`nodes`** in the JSON is an object per socket, keyed by the material's node property it sets
  (`colorNode`, `normalNode`, `roughnessNode`, …), holding that socket's inputs.
- **The TSL file** exports a function named after each socket in `nodes`, called as
  `(inputs, material, staticDefines)`; what it returns goes into the socket (`null` leaves the
  material's own). A socket the file doesn't export is skipped with a warning, and so is a
  `setup` under `nodes`: it isn't a socket, its inputs are the material's `inputs`.
- **With both,** `setup` runs first, then the socket functions, which may set a socket again (the
  debug build warns when one replaces what `setup` set).

The toolkit's other two share work the older ways: the grid's `normalNode` reads its
`colorNode`'s inputs from `material.userData.uniforms` (so its JSON lists `colorNode` first), and
the asteroid's `colorNode` sets its `roughnessNode` and `normalNode` itself. A new material does
both with `setup`.

### The inputs

Each value of `inputs`, or of a socket under `nodes`, reaches the function as a node:

| In the JSON                                                                     | The function gets                                                                    |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `0.6`, `true`                                                                   | A uniform.                                                                           |
| `"#ffaa00"`                                                                     | A colour uniform.                                                                    |
| `[x, y]` to `[x, y, z, w]`, `{ x, y, z }`, `{ r, g, b }`                        | A vector or colour uniform.                                                          |
| `"testTexture"` (any other string)                                              | The texture with that id: `.sample(uv)` it, or use it as is (sampled at the uv).     |
| `{ "texture": "testTexture" }`                                                  | The same.                                                                            |
| `{ "texture": "testTexture", "channel": "r" }`                                  | Its sample at the uv, those channels: one to four of `r`, `g`, `b` and `a` (`"rg"`). |
| `{ "textureArray": "groundLayers", "layer": "dirt" }` (or the layer's index)    | That layer of a texture array, at the uv.                                            |
| `{ "atlas": "decals", "slot": "albedo", "cell": "crack" }`                      | The atlas slot's sample of that cell, the uv mapped into it.                         |
| A form a [resolver](hub:features/toolkit#graphs-and-input-forms-from-code) adds | What the resolver makes of it: a node, or an object of nodes.                        |

- **Each is kept** as `material.userData.uniforms['<socket>_<input>']` (`colorNode_checkerSize`),
  `setup`'s as `setup_<input>` (`setup_glow`): the material editor changes them there, live, and
  your code can too.
- **A texture that isn't loaded** warns and samples one white texel, so the function still gets
  a texture.
- **An array layer** stays that layer through `.sample(uv)`, so the function can sample it at
  UVs of its own. **An atlas cell** is a sample already: `.sample(uv)` on it would read the whole
  slot, so sample other UVs with [`sampleAtlasCell`](api:sampleAtlasCell). A cell is kept half a
  texel inside its rect; `"clampToCell": false` leaves the UVs as they map. The gather fails on a
  layer, slot or cell the asset doesn't have, naming what it has (see
  [texture arrays](hub:features/asset-optimization#texture-arrays) and
  [atlases](hub:features/asset-optimization#texture-atlases)).
- **An input named `staticDefines`** merges over the material's static defines for that one
  function.
- Check the inputs a function needs and throw naming the missing one, as the toolkit's do.
- **The static defines** are plain values, resolved when the shader is built: branch on them in
  JavaScript ([`readBooleanDefines`](api:readBooleanDefines) fills in the defaults), so only the
  used paths are in the shader. A mesh's `matOverrides.staticDefines` makes its own variant of
  the material, with its own shader; `matOverrides.inputs` and `matOverrides.nodes` change only
  inputs, so their variants share one (see [`getMaterialVariant`](api:getMaterialVariant)). An
  override merges `inputs` and `staticDefines` key by key, one level: a define holding an object
  is replaced whole.
- **Types.** `import type { Node, NodeMaterial } from 'three/webgpu'` gives the typed
  `Node<'float'>` and the rest, which `three/tsl`'s loose `Node` doesn't. A texture input is
  `three/tsl`'s `TextureNode`, whose `sample` takes `three/tsl`'s `uv()`. Type the inputs by key
  (`inputs: { glow: Node<'float'>; texture: TextureNode }`), as `testTslMat` does.

### Loading

A scene load loads the TSL files of the materials it lists, and the textures they name (see
[a scene's textures](hub:features/scenes-and-assets#a-scene-s-textures)). Code that creates one
at another time awaits [`ensureMaterialDependencies`](api:ensureMaterialDependencies) with its
props first: it loads the textures that aren't loaded yet and the TSL file
([`loadTslMaterialFileAsync`](api:loadTslMaterialFileAsync) loads the file alone). A production
build has the data of the textures its scenes name only, so list a texture only your code uses in
a scene's `textures`.

### Graphs and input forms from code

[`registerTslMaterial`](api:registerTslMaterial) registers a material's functions under an id,
with no file, and [`registerMaterialInputResolver`](api:registerMaterialInputResolver) adds a form
of input value. The app's `testDebugScene` uses both: an input `{ "gradient": [from, to] }` that
becomes two colour uniforms, and a graph that blends them from the bottom up:

<<< src/app/scenes/testDebugScene/testDebugScene.ts#tsl-from-code

Then, in the function that makes the material, never at the module's load (the next visit
registers the same functions again, which does nothing):

<<< src/app/scenes/testDebugScene/testDebugScene.ts#tsl-from-code-use

- **A registered graph** is named by `createMaterial`'s `tslMaterialId` (by default the
  material's `id`), with no `tslFile`, and is found before the TSL files. The material gets
  variants, release and the material editor like a JSON one. Give it a namespaced id
  (`'myGame.stripes'`). Registering the same functions again does nothing; other functions under
  a taken id are ignored (the debug build warns).
- **A resolver** has a `kind` (unique: namespace it too), `match(value)`, `resolve(value, ctx)`
  and, optionally, `dependencies(value)`. The resolvers are asked in the order they registered,
  before the built-in rules, and the first that matches resolves the value. `resolve` returns a
  node, or a bundle: an object of nodes, which the function gets as it is (`inputs.band.from`)
  and whose nodes are kept as `<group>_<input>_<field>` (`setup_band_from`). `ctx` holds the
  material, where the input is, and `getTexture(id)`, which samples the white texel for a missing
  id, as a texture id input does. `dependencies` names the textures a value needs, which
  `ensureMaterialDependencies` loads. The material editor shows a resolver's value, without
  editing it.
- **Register on the first call** of the code that creates the material, never at a module's load:
  a top-level registration would keep the code in every build that imports the module. A resolver
  your JSON materials use registers from your app's feature's `install`
  (`ctx.registerMaterialInputResolver`; see [ECS](hub:features/ecs#features)), since a
  scene's JSON materials are created before its scene file runs.
- **The gather doesn't know your resolver's values,** so it can't add the textures they name: list
  them in the scene's `textures`.

To start from a toolkit material, copy its folder into your app, give the JSON a new `id`, fix its
`$schema` and `tslFile` paths, and import the triplanar helpers from `aekasha/toolkit/materials`
in place of `../TriplanarProjection`.

## Using it

- **Import it.** Toolkit code is imported like the engine's, and its asset JSONs are found and
  checked like the app's: a scene lists the `triplanarCheckerboard` material or the
  `aekashaSymbol` model by id.
- **Copy it.** Copy a file into your app (into the folder of the scene that uses it, or
  `src/app/shared/` when several do: see
  [where the files go](hub:features/scenes-and-assets#where-the-files-go)), rename its ids (a
  JSON's `id`, a component's key) so they don't clash with the toolkit's, change its imports from
  the toolkit's own files to its entries, and change what you need. Your copy is yours; the
  toolkit's keeps getting fixes.
- The toolkit has its own version, next to the engine's and the app's, on the
  [Version](hub:version) page.

## See it

- The [toolkit example](hub:examples/toolkit): the model, two materials and `HoverEffect`.
- The [game HUD example](hub:examples/game-hud): the world anchor sync and the follow rig's
  orbit.
- The app's `space` scene: toolkit asteroids under `MutualGravity`, at zero world gravity. Open it
  with `?isDebug=true&startScene=space`.
- The app's `largeWorld` scene: a generated terrain with scattered trees, bushes and rocks, and
  eight ruin sites whose 398 pieces are drawn in 28 [merge groups](hub:features/mesh-merging);
  `thirdPersonGymScene`: moving platforms and the follow camera.

## Read more

- The API reference: [`aekasha/toolkit`](hub:documentation/aekasha/toolkit), an entry per category.
