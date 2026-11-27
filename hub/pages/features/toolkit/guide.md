## What's in it

The toolkit is sorted by kind. Its code has four entries, `aekasha/toolkit/ecs`,
`aekasha/toolkit/geometry`, `aekasha/toolkit/materials` and `aekasha/toolkit/terrain`; its assets
(the materials', models', texture sets' and fonts' JSONs) are found by id, like the app's:

```text
src/toolkit/
  ecs/                      aekasha/toolkit/ecs
    effects/                FollowTool, HoverEffect, MutualGravity, SunShadowFit,
                            WorldAnchorSync
    gameplay/               FollowObjectCameraRig, movingPlatform/
  geometry/                 aekasha/toolkit/geometry
    generate/               Asteroid, Foliage, LeafCard, Rock, Terrain
    scatter/                ScatterOnSurface
  materials/                aekasha/toolkit/materials
    <id>/                   <id>.material.json and <id>.tsl.ts
    TriplanarProjection.ts
  terrain/                  aekasha/toolkit/terrain
    material/               the terrain material generator: createTerrainMaterial and the rest
    nodes/                  SampleTextureSet, the material's techniques; noise/: the noise library
    debug/                  the terrain material's debug views (debug builds only)
    procedural/             the surface generators' API; <id>/<id>.generator.ts, ten of them
    scatter/                terrainScatter: the terrain scatter generator
    decals/                 the decal material, runtime decals; generators/: nine decal generators
    textures/               MacroNoise, RippleAtlas: the shared textures' bakes
  models/<category>/<id>/   the model next to its *.importedAsset.json
  fonts/<id>/               a font next to its *.font.json and licences; CREDITS.md
  textures/<setId>/         a texture set: its JSON, recipes and source.json; CREDITS.md
  textures/<id>/            macroNoise, rippleAtlas: a texture JSON over its committed PNG;
                            leafLitter, decalsGround, decalsStructure: texture atlases
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
- **`textureSetSurface`**: one [texture set](hub:features/terrain#using-a-set) on a surface, any
  packing, tiled in world space (`tiling: "WORLD_XZ"`) or at UVs in metres (`"UV"`, walls). A mesh
  gives it its set with `matOverrides: { inputs: { surface: { textureSet: "rocks01" } } }`. The
  baseline of the terrain materials, built on `aekasha/toolkit/terrain`.
- **`terrain`**: the [terrain material](hub:features/terrain#terrain-materials) through its JSON
  route: layers of texture sets blended by paint or rules, anti-tiled, projected, with colour maps
  and quality tiers, its config the static define `terrain` and its textures inputs, so a mesh's
  `matOverrides` gives a block its own sets and splat maps.
- **`asteroid`**: a rock surface in object space: mottled colours, pits, mineral speckles, and the
  roughness and a bump from the same noise. Every input is on its `colorNode`, and a mesh gives it
  a `seed` of its own (`matOverrides: { nodes: { colorNode: { seed: 7 } } }`) for a different rock.
  The `octaves` define sets the mottling's detail.
- **`rockScatter`**: scatter rocks ([`setupRockMaterial`](api:setupRockMaterial), over the
  terrain category's nodes). It draws a texture set, the ground's own for the procedural rocks (no
  texture memory of their own), triplanar in each rock's own space so every instance of a cell
  keeps its texture, anti-tiled, with a macro tint by world position, dust toward the set's
  average colour on the faces turned up, and the surface conditions' wetness and frost. `tiling:
"UV"` draws an imported rock's own maps at its UV (`rockScatterNamaqualandStones01`,
  `rockScatterNamaqualandBoulder02`). A rock on another ground set takes a material JSON of its
  own over that set.
- **`leafLitter`**: leaf cards. A leaf of the `leafLitter` atlas per instance (one material and
  one draw a scatter cell), fitted at its aspect, a share of them turned brown (`autumn`),
  alpha-tested with `alphaToCoverage`, wet by the surface conditions.
- **`decalsGround_blend`**, **`decalsGround_cutout`**, **`decalsStructure_blend`** and
  **`decalsStructure_cutout`**: [decals](hub:features/terrain#terrain-decals)
  ([`setupDecalMaterial`](api:setupDecalMaterial), one TSL file) of the two decal atlases, any cell
  at the mesh's UV, faded at its edges by its second UV set, wet by the surface conditions with
  their puddles in the decal's puddle mask; `BLEND` sorted and soft, `CUTOUT` opaque and
  alpha-tested.

The [material editor](hub:features/debug-suite#editor-views) edits their inputs live. Writing
one of your own is [below](hub:features/toolkit#writing-a-tsl-material).

### Procedural geometry

In `geometry/`. Every generator takes a seed (an integer) and gives the same result for it, and
returns a geometry that isn't registered: save it with `saveBufferGeometry`, or hand it to an
instanced pool, which owns it.

- [`generateTerrain`](api:generateTerrain): a terrain grid, with its `heights` and a
  `getHeightAt(x, z)` that gives the height of the mesh's own triangle under the point, so what you
  place with it sits on the mesh. Its heights come from seeded noise sampled at the world place
  (`center`: blocks of one seed continue each other), a `heightFn` or a `heightmap`
  ([`loadTerrainHeightmapAsync`](api:loadTerrainHeightmapAsync), raw `R16` / `R32F`), then a
  `heightModifier`; `normals: 'HEIGHT_FN'` agrees across blocks' edges; `vertexColors` lays the
  terrain material's rules into `COLOR_0` on the CPU
  ([`evaluateTerrainRulesCPU`](api:evaluateTerrainRulesCPU)); `ao` is a horizon AO; `collider:
true` returns the `HEIGHTFIELD` collider's params (`heightfield`, the mesh's cells, for
  `createPhysicsEntity`). [`generateTerrainAsync`](api:generateTerrainAsync) does the same on the
  toolkit's terrain worker (a 257² block takes about 50 ms; options without functions). The
  defaults build the same geometry as before. How to use them: [procedural terrain
  meshes](repo:docs/techniques/terrain-procedural-meshes.md).
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
- [`generateRock`](api:generateRock): a scatter rock, an asteroid without craters, squashed,
  stretched and cut flat at its base, its origin at the base's centre so it stands where it's
  placed. Its `kind` sets the size and detail within [`ROCK_TRIANGLE_BUDGETS`](api:ROCK_TRIANGLE_BUDGETS):
  `PEBBLE` (about 13 cm, 80 triangles), `ROCK` (55 cm, 320), `BOULDER` (2.4 m, 1,280).
  [`saveRockGeometries`](api:saveRockGeometries) registers eight variants for a scene
  (`rockPebble_a..c`, `rockSmall_a..c`, `boulder_a..b`), which a scatter's items name.
- [`generateLeafCard`](api:generateLeafCard): a leaf litter card, a square folded along its
  midrib (4 triangles); [`saveLeafCardGeometry`](api:saveLeafCardGeometry) registers it as
  `leafCard`.

The generators draw from the engine's
[`createSeededRandom`](api:utils/SeededRandom.createSeededRandom) (on `aekasha`), which an app
imports from there too.

### Terrain

The surfaces and the TSL pieces terrain materials are built from (the
[Terrain](hub:features/terrain) page has the whole of it):

- **The terrain material** (`material/`): [`createTerrainMaterial`](api:createTerrainMaterial)
  builds one material from a config of up to 16 layers: weights from vertex colours, splat maps or
  slope / height / facing rules with the height blend, anti-tiling, slope-gated triplanar cliffs,
  sparse sampling from a set array, a colour map and far surface, object space, live procedural
  layers and quality tiers ([`getTerrainQualityPreset`](api:getTerrainQualityPreset)).
  [`createStructureMaterial`](api:createStructureMaterial) is its preset for concrete and large
  structures, [`bakeTerrainColorMap`](api:bakeTerrainColorMap) bakes a block's colour map.
- **Terrain blocks** (`blocks/`, `blender/`): the block generators `noiseTerrain` and
  `rulesTerrain`, which [`registerTerrainGenerators`](api:registerTerrainGenerators) registers
  for the [`terrain()`](hub:features/terrain#terrain-blocks) feature's JSON blocks (from an
  install); and the Blender add-on `aekasha_terrain_tools.py` with nine templates, which make
  blocks by the conventions and export them ([the
  workflow](repo:docs/techniques/terrain-blocks-blender.md)), and scatter rocks and lay decals on
  them.
- **Decals** (`decals/`): the decal material, runtime decal pools
  ([`createDecalPool`](api:createDecalPool), [`spawnDecal`](api:spawnDecal),
  [`spawnRibbonDecal`](api:spawnRibbonDecal), [`createDecalTrail`](api:createDecalTrail),
  [`spawnMeshDecalAsync`](api:spawnMeshDecalAsync)) and nine decal generators
  ([`defineDecalGenerator`](api:defineDecalGenerator), [`bakeDecalGenerator`](api:bakeDecalGenerator)),
  over the decal atlases `decalsGround` and `decalsStructure` (ambientCG scans and generated cells)
  ([Terrain decals](hub:features/terrain#terrain-decals),
  [the handbook](repo:docs/techniques/terrain-decals.md)).
- **Terrain scatter** (`scatter/`): the generator `terrainScatter`, which
  [`registerTerrainScatter`](api:registerTerrainScatter) registers (from an install) for the
  `instancing()` feature's `*.scatter.json`s: Poisson-disk points on a block, kept by its painted
  layers, slope, height and a clustering noise, each placed on the mesh, seeded per block
  ([Terrain scatter](hub:features/terrain#terrain-scatter),
  [the handbook](repo:docs/techniques/terrain-scatter.md)).
  [`readTextureTexelsAsync`](api:readTextureTexelsAsync) reads a texture's texels back to the CPU
  (the rules' noise on generated blocks).
- **The texture library** (`textures/<setId>/`): 16 CC0 texture sets, two each of sand, mud,
  rocks, cliffs, snow, ice and grass ground, and two concretes, packed `LITE` (`sand01`,
  `grass01` and `cliffs01` also `FULL` and `MINIMAL`) and compressed to KTX2. A scene or a
  material names one by id (`{ "textureSet": "snow02" }`); they need the `textureSets()` feature.
  `yarn fetchTextureSources` downloads their source maps, which only re-encoding needs. Beside
  them, the two nature models' own maps as sets (`namaqualandStones01`, `namaqualandBoulder02`)
  and the leaf litter atlas `leafLitter` (ambientCG LeafSet024's nine leaves).
- [`sampleTextureSet`](api:sampleTextureSet) decodes a set (or a set array's layer) at a UV into
  albedo, normal, roughness, AO and height, whatever its packing;
  [`transformTangentNormalToView`](api:transformTangentNormalToView) shades its normal in that
  UV's frame and [`bumpNormalView`](api:bumpNormalView) makes a normal from a height in metres.
- **Procedural surfaces** (`procedural/`): ten generators (sand ripples, flat sand, cracked and
  smooth mud, rocky ground, cliff strata, snow drifts, sheet ice, grass ground, concrete), each a
  TSL graph of an albedo, a height and a roughness.
  [`bakeSurfaceGenerator`](api:bakeSurfaceGenerator) bakes one into a texture set packing, a
  procedural set's JSON names one by id, and [`createLiveSurface`](api:createLiveSurface) runs one
  in a material; [`defineSurfaceGenerator`](api:defineSurfaceGenerator) writes your own.
- **The noise library** (`nodes/noise/`): [`valueNoise`](api:valueNoise),
  [`gradientNoise`](api:gradientNoise), [`fbm`](api:fbm), [`domainWarp`](api:domainWarp),
  [`worley`](api:worley), [`hash12`](api:hash12) and [`hash22`](api:hash22), 2D TSL noise that
  tiles at a whole-number `period` (none: it never repeats), and
  [`heightToNormal`](api:heightToNormal) and [`heightToCavity`](api:heightToCavity).
- **The shared textures** (`textures/`): `macroNoise` (large-scale variation) and `rippleAtlas`
  (rain rings), each a committed KTX2 texture and a bake
  ([`bakeMacroNoise`](api:bakeMacroNoise), [`bakeRippleAtlas`](api:bakeRippleAtlas) with
  [`decodeRippleAtlas`](api:decodeRippleAtlas)).

### Models

By category, in `models/<category>/<id>/`. The Ækasha symbol (`brand/aekashaSymbol/`): the Æ
glyph extruded with a small bevel, a Draco GLB with its `*.importedAsset.json`, ready for a
scene's `importedAssets`. Scatter rocks (`nature/`, Poly Haven, CC0), decimated to the scatter's
budgets by `devTools/toolkit/buildNatureRocks.ts` and imported lossless, each piece a node a
scatter's item names: `namaqualandStones01` (five pebbles `StoneA`-`E` of 7-14 cm at 80
triangles, and three scaled into rocks `RockA`-`C` at 400) and `namaqualandBoulder02` (`Boulder`,
2.5 m, 1,500), each with its `rockScatter` material over its own maps.

### Fonts

In `fonts/<id>/`, each a static WOFF of IBM Plex (SIL Open Font License 1.1) with its
`*.font.json`, its `LICENSE.txt` and the licence's text (`OFL.txt`), encoded into an `MTSDF`
atlas at 48 px: `plexSans` (Plex Sans Medium, ASCII and Latin-1 with typographic punctuation and
`€`), `plexMono` (Plex Mono Regular, ASCII) and `digitsDisplay` (Plex Sans Bold, digits only, for
damage numbers and timers). A scene lists one in its `fonts`; they need the `text()` feature
([Text](hub:features/text#the-toolkit-s-fonts)). `CREDITS.md` names each one's source.

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
  [Versions & Issues](hub:version) page.

## See it

- The [toolkit example](hub:examples/toolkit): the model, two materials and `HoverEffect`.
- The [terrain example](hub:examples/terrain): a block from `rulesTerrain` with its collider, in
  the terrain material, and the toolkit's rocks scattered on it by `terrainScatter`.
- The app's `terrainGallery` scene: every set of the texture library on its own block, a row per
  technique of the terrain material with its measurements, the procedural surfaces, baked or
  live, and the Scatter row: the procedural and imported rocks on one block, and leaf litter (see
  [Terrain](hub:features/terrain)). Open it with
  `?isDebug=true&startScene=terrainGallery`.
- The app's `proceduralSurfaces` and `noiseLibrary` scenes: the generators and the noise, each
  checked as it loads.
- The [game HUD example](hub:examples/game-hud): the world anchor sync and the follow rig's
  orbit.
- The app's `space` scene: toolkit asteroids under `MutualGravity`, at zero world gravity. Open it
  with `?isDebug=true&startScene=space`.
- The app's `largeWorld` scene: a generated terrain with scattered trees, bushes and rocks, and
  eight ruin sites whose 398 pieces are drawn in 28 [merge groups](hub:features/mesh-merging);
  `thirdPersonGymScene`: moving platforms and the follow camera.

## Read more

- The API reference: [`aekasha/toolkit`](hub:documentation/aekasha/toolkit), an entry per category.
