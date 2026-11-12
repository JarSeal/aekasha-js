## Installing it

List [`lod()`](api:lod), from `aekasha/lod`, in `InitEngine`'s `features` (see
[How the app starts](hub:examples/quick-start#how-the-app-starts)), and
[`instancing()`](api:instancing), from `aekasha/instancing`, for the instanced pools
([Many instances](#many-instances)) and instance sets ([Instance sets](#instance-sets)).
Generating chains and impostors, and a set's backend, load on first use.

- Without `lod()`, a mesh's `lod` does nothing (`"AUTO"` warns once), and an import reads no
  prebuilt chains and builds none.
- A scene whose JSON has a mesh's `lod` or `impostors` fails the boot without it, naming the
  feature (see [the feature manifest](hub:features/scenes-and-assets#the-feature-manifest)).

## A level is a screen size

An object's screen size is its bounding sphere's height on screen, as a fraction of the screen's:
`radius × k / distance`, where `k` comes from the camera's field of view and zoom (an
orthographic camera has no distance). So an object keeps its detail when the camera zooms in.

Levels go from the finest down, each with the smallest `screenSize` it's used at:

<<< src/app/scenes/lodShowcase/lodShowcaseHandMade.mesh.json

- A level's `geo`, `mat` and `castShadow` default to the level before's (level 0's to the mesh's
  own). Here the far levels are the same sphere at fewer segments, and the last stops casting
  shadows.
- Below `cullScreenSize` the object is hidden.
- Hysteresis keeps an object on a boundary from flipping: it moves to a coarser level only below
  `screenSize × (1 − hysteresis)` (0.1 by default).
- [`setLodBias`](api:setLodBias) (or `AppConfig.lod.bias`) trades detail for speed everywhere.

A mesh gets levels from its JSON's `lod`, the `lod` prop of
[`createMeshEntity`](api:createMeshEntity), or [`setMeshLod`](api:setMeshLod).

## Generated levels

[`generateLodChain`](api:generateLodChain) simplifies a registered geometry with meshoptimizer,
in the assets worker, into levels registered as `<id>#lod1`, `<id>#lod2` and so on. Each level
records its triangle count and its error, and shares the base's vertices (only its index is its
own). The chain is released with its base.

- `lod: "AUTO"` uses a geometry's chain: a level is used while its error is at most one pixel on
  a 1080-pixel-high screen (`{ "auto": true, "maxPixelError": 2 }` allows more).
- An `*.importedAsset.json` with `"lodChain": true` has the
  [asset pipeline](hub:features/asset-optimization) build the chain into the GLB, so the client
  loads the levels instead of simplifying.
- Very low-poly meshes have nothing to remove: their chain comes out without levels, with a
  warning. Hand-make theirs.

## Cross-fades

A level change, and hiding or showing, dissolves over `fadeSeconds` (0.25 s by default, 0 for an
instant switch) through a screen-space dither: the old and the new level each draw part of the
pixels. Both stay opaque, so shadows, depth and post effects work through a fade. On the
`lodShowcase` scene's dolly (below), 200 level changes gave no pops, against 176 with fades off.

## Many instances

[`createInstancedMeshPool`](api:createInstancedMeshPool) draws many instances with one
`InstancedMesh`, each instance an ECS entity with its own transform.
[`createInstancedLodPool`](api:createInstancedLodPool) has one mesh per level and moves each
instance into its level's mesh, so a whole forest is a draw call per level. A fading instance is
in two level meshes, which adds no draw call.

Move an instance through its transform, like any entity: the pool writes it into the instance
matrix, and grows the mesh's bounds when the instance leaves them, so three never culls the whole
mesh while a moved instance is on screen.

The pools need `instancing()`, an instanced LOD pool's levels `lod()` too, and a pool's
`spatialDomain` option `spatial()` (without it, the pool warns and indexes nothing). Give a pool
a domain of its own: instances in `DEFAULT` [aren't a light's receivers](hub:issues/pool-instances-not-light-receivers).

The selection costs one distance and one multiply per entity, after frustum culling, and only an
entity whose level changed is touched. `AppConfig.lod.maxSelectionsPerFrame`
([`setLodMaxSelectionsPerFrame`](api:setLodMaxSelectionsPerFrame)) spreads it over frames when
there are very many.

Meshes of different geometries that share a material, each with its own `LOD` (rocks of several
shapes), can be one [batched merge group](hub:features/mesh-merging#per-member-lod) instead: one
object for the renderer, a draw per geometry and level on WebGPU, with the same cross-fades.

## Instance sets

A pool's cost grows with its instances: every instance is an entity, selected and synced on the
CPU each frame, and an ECS world holds 100,000 entities by default. An instance set
([`createInstanceSetAsync`](api:createInstanceSetAsync)) draws the same levels for instances
that are plain data, with no entity per instance. On WebGPU a compute pass selects every
instance's level with the pool's rules (screen size, hysteresis, cross-fades), frustum-culls it
for each camera, and appends it to its level's list, and each level is an indirect draw that the
pass wrote the count of. A hundred thousand or a million trees cost the CPU about the same.

The `lodShowcase` lane next to the pool's draws the same trees as a set:

<<< src/app/scenes/lodShowcase/lanes/instanceSetGrove.ts#instance-set-grove

- The options are an instanced LOD pool's: the same `levels` and `lod`. `maxInstances` is sized
  once, up to 16,777,216.
- It's async because each backend loads on first use, and it resolves `null` when the scene
  exited meanwhile.
- Add `object` directly under the root scene: the instances are in world space. The set's
  owning entity (`entityId`) disposes it, so a scene switch clears it like the rest of the scene.
- `preWarm: true` compiles its shaders once `object` is in the scene, for a set made during
  play. A set made by scene code needs none: the load's own frames build it.

A set gives up what an entity gives a pool's instance: a `Transform`, the ECS visibility tags, a
spatial domain, raycasts and gameplay asking whether an instance is visible. Its scale is
uniform. Instances can move
([`setInstanceMatrices`](api:InstanceSet.setInstanceMatrices), uploaded once a frame), but a set
is meant for content that stays put: a sway or wind belongs in the material.

### A pool or a set

Take a set for static content past about 20-50k instances: a forest, a field of rocks, a
scatter. Keep a pool for instances that gameplay addresses, and below about 20k, where a pool's
selection and sync cost under 2 ms. Measured on the `instanceStress` scene's forest (three mesh
levels and a cull, the camera circling inside it; a minified build, Apple M2, Chrome, WebGPU):

| Trees | Pools: CPU / GPU frame | Set, CPU backend | Set, GPU backend |
| ----- | ---------------------- | ---------------- | ---------------- |
| 5k    | 1.50 / 1.97 ms         | 0.60 / 1.63 ms   | 0.49 / 1.25 ms   |
| 20k   | 3.59 / 2.60 ms         | 1.29 / 2.66 ms   | 0.44 / 1.71 ms   |
| 100k  | 15.92 / 5.08 ms        | 2.70 / 7.04 ms   | 0.54 / 2.92 ms   |
| 1M    | 166 ms CPU             |                  | 1.1 ms CPU       |

The 1M row is the CPU frame alone, from a run without the debug tools (which give the GPU
figures); the pools there need an ECS world past its default size. With the sun's shadow the set's
shadow costs about the same at any count (its shadow camera draws only the casting levels in its
frustum): a GPU frame of 8.6 ms at 100k against the pools' 13.1.

### Two backends

`set.backend` says which one draws it, chosen by the renderer:

- **`'GPU'` (WebGPU)**: the compute pass and the indirect draws above. The CPU does a few
  dispatches and a draw per level and material group, per camera.
- **`'CPU'` (WebGL2, which has no compute)**: the same set and the same rules in a loop over the
  instances' arrays, without entities, and an `InstancedMesh` per level, as a pool has. It costs
  about a tenth of the pool's CPU (12-20 ns an instance against 94-195 ns), and it draws what the
  pool draws: the same levels, the same fades. three culls each level mesh as a whole, so past
  about 20k instances spread around the camera it draws more than tiled pools do (the table's
  GPU frame at 100k).

### Every camera

Every camera that renders the set draws it: the view, a light's shadow, a
[viewport](hub:features/viewports), the debug camera and a [snapshot](hub:features/rendering#snapshots).
On WebGPU each takes a slot on its first render (`maxSlots`, 8 by default) and culls the set
against its own frustum, with the levels chosen for the main camera. A shadow's slot draws only
the levels that cast. A render of another scene (an impostor or sky bake) costs the set nothing.

### Ranges and streamed cells

[`addInstances`](api:InstanceSet.addInstances) returns the instances' range, and
[`removeInstances`](api:InstanceSet.removeInstances) frees it for a later add of its size or
smaller. So one set can serve every cell of a [streamed world](hub:features/streaming#cell-content):
each cell's content adds its range in `load` and removes it in `unload`, and returns no entity.
A range doesn't fade in or out, so load the cells from a ring past the set's cull distance: a
cell then loads before its instances would show, and unloads after the set has culled them.

### Memory

On the GPU backend a set keeps 72 bytes an instance (its matrices, cull spheres and state), plus
its visible lists: `maxSlots` × levels × `maxVisible` × 4 bytes (6 MiB with the defaults and
three levels). At a million instances that's 74.7 MB. The CPU backend's level meshes are each
sized for every instance, about 65 MB a level at a million.

### Seeing a set work

three's draw and triangle counts leave out indirect draws. In debug mode the LOD tab's Instance
sets folder shows each set instead: its backend and instances, each level's drawn and selected
counts, culled, fading, past the visible budget, the triangles drawn and each camera drawing it.
The tab's freeze, forced level and fade time scale drive sets too, and its "CPU backend (next
sets)" box puts the next sets on the CPU backend on WebGPU, to compare both on one device. Each
set is also a source in the GPU memory tab. From code,
[`readInstanceSetStatsAsync`](api:readInstanceSetStatsAsync) reads the counts back (debug and
prod test builds only).

::: dev-only Measuring it
The `instanceStress` scene draws its forest with pools, or with `?stressPath=gpu` a set, at
`?stressInstances=N`. `npx tsx devTools/bench/instanceStress.ts` measures both paths at any
count on a dev server or a `yarn build:test` build, and `devTools/bench/instanceStressLodTab.ts`
drives the LOD tab on both and compares them. Their options are in each file's header.
:::

## Impostors

An impostor is a far level drawn with a few textured quads. Only the albedo, normals and depth
are baked, never light, so it's lit by the scene's sun, shadows and day-night cycle like the
mesh, and it casts its silhouette's shadow.

- **Cross-quads** ([`generateCrossQuads`](api:generateCrossQuads)): two or three crossed,
  alpha-cut planes. Cheap, and right for vegetation seen from the side.
- **Octahedral** ([`generateOctahedralImpostor`](api:generateOctahedralImpostor)): one quad that
  faces the camera, blending the three nearest of a grid of baked views (12 × 12 by default), so
  it holds from any angle, overhead included. `hemi: true` bakes only the upper half, for objects
  never seen from below.
- **`surfaceDepth`** (octahedral, on by default): the impostor writes its surface's depth, so it
  meets the ground and shadows itself like the mesh. Writing depth from a shader turns off the
  GPU's early depth test, so `surfaceDepth: false` draws a cheaper flat quad, fine for objects
  standing on the ground.

An impostor pays off against heavy meshes, not low-poly ones. Measured on WebGPU (an Apple GPU),
400 knots at the impostor's distances add:

| Drawn as                                | GPU time |
| --------------------------------------- | -------- |
| The 16,384-triangle mesh                | 2.3 ms   |
| The chain's last level (982 triangles)  | 0.12 ms  |
| A flat impostor (`surfaceDepth: false`) | 0.07 ms  |
| An impostor with surface depth          | 0.43 ms  |

## Exporting an impostor

An impostor bakes when its scene loads, in about 40-115 ms for an octahedral one. Export it once,
and the scene loads it instead:

1. Run the scene in `yarn dev` with `?isDebug=true`, and open the LOD tab's Impostors folder.
   It lists the impostors made this session.
2. **Export** writes four files through the
   [dev file server](hub:features/debug-suite#dev-file-server): `<id>.impostor.json`,
   `<id>.textureAtlas.json` and two PNGs, into `src/app/impostors/` by default
   (`AppConfig.lod.impostorExportDir`). The asset pipeline encodes the PNGs to KTX2, about a
   quarter of a bake's GPU memory. Move the four into the scene's folder when only that scene
   uses them (see [where the files go](hub:features/scenes-and-assets#where-the-files-go)): a
   later export writes wherever they are.
3. List the id in the scene JSON's `impostors`. The same `generateOctahedralImpostor` /
   `generateCrossQuads` call with that `id` now builds from the export, without baking.

The debug build warns when the source mesh, its material or the options no longer match the
export's fingerprint, and uses the export anyway: export again after changing the mesh.

## Seeing it work

In debug mode, the drawer's LOD tab shows the selection's cost, can freeze the levels or force
one, slows fades down, and draws a box in each object's level colour. An object's LOD window
shows its live screen size and the distance of each switch.

::: scene lodShowcase
**The full demo:** every LOD feature in its own lane, every level of every lane on screen from
the start camera, an instanced pool's trees and the same trees as an instance set side by side,
and hand-made levels on plain meshes and on a batched merge group's members. Its LOD demo tab has camera stops on both sides of every switch and a dolly
down the lanes.
:::

## Key APIs

- [`setMeshLod`](api:setMeshLod), [`setLodBias`](api:setLodBias),
  [`setLodFadeSeconds`](api:setLodFadeSeconds) and
  [`setLodMaxSelectionsPerFrame`](api:setLodMaxSelectionsPerFrame).
- [`refreshLodBounds`](api:refreshLodBounds): after an `InstancedMesh` entity's instance matrices
  change.
- [`generateLodChain`](api:generateLodChain).
- [`createInstancedMeshPool`](api:createInstancedMeshPool) and
  [`createInstancedLodPool`](api:createInstancedLodPool).
- [`createInstanceSetAsync`](api:createInstanceSetAsync) and
  [`readInstanceSetStatsAsync`](api:readInstanceSetStatsAsync).
- [`generateCrossQuads`](api:generateCrossQuads) and
  [`generateOctahedralImpostor`](api:generateOctahedralImpostor).
- [`registerLodTarget`](api:registerLodTarget): levels for entities that aren't plain meshes.
  A target that cross-fades dithers its materials with [`enableLodDither`](api:enableLodDither)
  and gives an instanced level mesh a fade per instance with
  [`createLodFadeAttribute`](api:createLodFadeAttribute).

## Read more

- The [LOD example](hub:examples/lod).
- [Alpha-cut textures](repo:docs/techniques/asset-optimization.md#alpha-cut-textures) and
  [Impostor atlases](repo:docs/techniques/asset-optimization.md#impostor-atlases) in the asset
  optimization guide.
- The API reference: [`aekasha/lod`](hub:documentation/aekasha/lod) and
  [`aekasha/instancing`](hub:documentation/aekasha/instancing).

::: claude-md
:::
