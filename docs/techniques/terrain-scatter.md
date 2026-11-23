# Terrain scatter

Pebbles, rocks, boulders and leaf litter on terrain blocks: thousands of small static meshes drawn as instances in cells, placed by Blender's Geometry Nodes or by the engine from the block's own paint, and owned by the block that spawns them. A `*.scatter.json` names the items (a geometry and a material each) and the source that places them; a terrain block lists its scatters in `scatter`, or scene code spawns one with `spawnScatter`. The toolkit adds the generator (`terrainScatter`), procedural rocks, imported rocks, a rock material that matches the ground, and leaf cards.

Checked with **Blender 5.3** (its glTF exporter's GPU instances and point clouds).

## What it is

```text
 *.scatter.json ── items: [{ geometry, material, weight?, collider?, castShadow? }]
                   source: PROCEDURAL  terrainScatter: Poisson-disk points on the block,
                   │                   masked by its layers, slope, height, noise
                   │       IMPORTED    Blender's Geometry Nodes: GPU instances or a point cloud
                   │       PLACEMENTS  a hand-made list
                   ▼
 matrices (+ an item and a tint each) ─► per item, a grid of cells (cellSize, 16 m)
                                         └► each cell one InstancedMesh entity: its own bounds,
                                            its own LOD (levels, cullScreenSize), no per-frame cost
                                         └► a FIXED collider per instance of a collider item
```

**Why instances, and why cells.** A pebble as an entity (a `Transform`, an `Object3D`, a sync each frame) costs CPU time and memory for something that never moves and nothing addresses. A cell is one entity and one `InstancedMesh` per item: its matrices upload once, three culls it whole by its bounds over every instance, and the LOD switches or hides it whole by its screen size. The cell is the unit a block owns, a scene exit deletes and a streamer would load. An instanced mesh pool (an entity per instance) is for things that move or that gameplay picks one by one; an instance set (`createInstanceSetAsync`, culled per instance on the GPU) for static content past about 20-50k instances that nothing addresses, where cells would draw too much.

- **Static instances** (`aekasha/instancing`): `createInstancedMeshEntity` makes one `InstancedMesh` entity (the refs, the root scene, the shadows and the LOD as `createMeshEntity`'s); `createStaticInstances` splits instances into cells of them. A scatter is built on them, and the GPU instances of any import are spawned through them.
- **Owned by the block:** a terrain block's scatters spawn with it (after its collider) and go with its `dispose()` or the scene's exit; their seed mixes in the block's grid place, so every block gets its own placements, the same on every visit and in any load order.

## Best for

|                      | Good fit                                                                                                                                                                                                                                                        | Poor fit                                                                                                                  |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Art style            | Any. Photoreal: the rock material over the ground's own texture set, or imported scans; stylized and low-poly: procedural rocks, faceted, few triangles                                                                                                         | –                                                                                                                         |
| Game type and camera | **Always useful**: scatter breaks up terrain repetition more than any texture trick. First and third person: dense pebbles and rocks near the camera, culled per cell by `cullScreenSize`. Top-down, RTS: fewer, bigger rocks, often with colliders for pathing | Unique hero meshes in large numbers (each its own mesh, merged per block with merge groups); anything that moves (a pool) |
| World size           | Any: placements are made per block at its spawn from a seed, nothing stored but the JSON                                                                                                                                                                        | Hundreds of thousands of instances on one block: an instance set, or fewer items with a larger `minSpacing`               |

## Performance

- **Draw calls:** one per item per cell in view, and the same again in each shadow pass for an item with `castShadow`. A 64 m block in 16 m cells with three pebble items is up to 48 draws; the gallery's Scatter row (24 m, three items each) draws 12 cells of pebbles, 8 of rocks, 2 of boulders, and its 12 m leaf block 4. Fewer items or larger cells cut draws; smaller cells cull finer.
- **Vertices:** instances × triangles. Keep to the budgets (`ROCK_TRIANGLE_BUDGETS`): a pebble 80 triangles, a rock 400, a boulder 1,500; a leaf card 4. The gallery's procedural half: 570 pebbles (45.6k triangles), 21 rocks (6.7k), 2 boulders (2.6k); its leaves 2,703 cards (10.8k).
- **Memory:** 64 bytes an instance (its matrix) and 12 more with a tint (`instanceColor`): 20,000 pebbles 1.5 MB, besides one copy of each item's geometry.
- **Fetches per pixel** (the [formula](README.md#the-performance-formula)): the rock material's `TRIPLANAR` × `DUAL_SCALE` over a `LITE` set is 2·2·3 = **12**, with the macro 13; `antiTiling: 'NONE'` 6; a `FULL` set 18. `tiling: 'UV'` (an imported rock's own maps) samples once: 3 for its `FULL` set, 4 with the macro. Leaf cards: 1 (the atlas). Wet effects add the `W` term as on the ground.
- **Card overdraw:** leaf cards are alpha-tested (`alphaTest` 0.5, opaque in the depth pass: no sorting, no blending), with `alphaToCoverage` smoothing the edges under MSAA. Tens of thousands of small cards still shade their transparent corners; keep `minSpacing` at the card's size or above.
- **Colliders:** a `FIXED` body per instance of a collider item (`CONVEXHULL` or `BALL`). Only for large pieces: past 200 on a target the gather (for `PLACEMENTS`) and the spawn warn.
- **The generator's cost:** `terrainScatter` runs on the main thread during the block's spawn, about **4 µs a Poisson candidate**: a dense 64 m block at `minSpacing` 0.4 m is 15.6k candidates and about 70 ms (Windows Chrome; 60 ms in Node), most of it the Poisson sampling. The candidates depend on `minSpacing` alone (the mask and `density` only drop them), so `minSpacing` is the knob: twice the spacing, a quarter of the time. A block of 20k+ candidates during play is a hitch; at a scene's load it's part of the load.
- **The build:** the generator's code is a lazy chunk (5.4 kB gzip, with the terrain material's define reader, 8.1 kB, which it shares) loaded with the first scatter using it; the `IMPORTED` source's and the colliders' code load with their first use. A scene without scatters loads none of it.
- **`cellSize` against `cullScreenSize`:** a cell hides below `cullScreenSize` of the screen's height, measured by its own bounds: `cellRadius × k / distance`, `k` about 1.7 for a 60° vertical field of view, a 16 m cell's radius about 11 m. So the distance a cell hides at is about `11 × 1.7 / cullScreenSize`: pebbles in 16 m cells gone past 50 m take `cullScreenSize` 0.4, past 100 m 0.2. Smaller cells hide nearer for the same value (an 8 m cell at 0.4: 24 m) and pop less visibly, at more draws. Rocks and boulders, which show from further, take smaller values or none. The hide and show cross-fade over `lod.fadeSeconds` (default 0.25 s).
- **Measured:** the gallery as a whole runs at 132 FPS on Windows Chrome with an AMD RDNA 3 GPU (debug mode), with the Scatter row's 4,000 instances in it. Measured in the gallery's Scatter row ([how](README.md#how-the-figures-are-measured): RDNA 3, WebGPU, 1920 × 1080; the block's own GPU ms, the frame less the frame without it): the 24 m rocks block (procedural pebbles, rocks and boulders and the imported ones) 0.36 ms and 85 draws over the frame without it, 0.53 ms and 81 draws from a third person's camera; the 12 m leaf litter block (2,703 cards) 0.31 ms and 11 draws, 0.34 from the third person. The draws are the cells' (an item a cell, the shadow passes' none: the gallery casts no shadows).

## Maps

The scatter has no maps of its own: the items' materials have theirs.

| Item                 | Material                              | Maps                                                                                                                                                                  |
| -------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Procedural rocks     | `rockScatter` (`tiling: 'TRIPLANAR'`) | **The ground's texture set** (`rocks01` by default): no texture memory of their own; `macroNoise` for the tint by world position                                      |
| Imported rocks       | `rockScatter<Id>` (`tiling: 'UV'`)    | The model's own 1K maps as a texture set (`FULL`, the `prop` profile: UASTC, about 1 MB a map), `physicalSize` `[1, 1]` (the UV's 0..1)                               |
| Leaf cards           | `leafLitter`                          | The `leafLitter` atlas (`*.textureAtlas.json`): ambientCG LeafSet024's nine leaves, colour with the opacity as A, `alphaCoverage` 0.5 so distant cards don't thin out |
| A splat-mapped block | –                                     | `terrainScatter` reads the block's splat maps back from the GPU once (`params.splatMaps`: a material doesn't keep its inputs)                                         |

## Blender, step by step

The template `terrain_scatter.blend` has all of this built: a painted block, three rocks and the scatter, ready to export both ways. Start from it, or:

1. **The block:** shaped and painted as any block ([Terrain blocks from Blender](terrain-blocks-blender.md)). The scatter reads its `Splat`, so paint the layer the rocks go on (here rocks01 in R).
2. **The items:** a collection (`ScatterRocks`) of rock variants, each a separate object:
   - at its real size in metres, its **rotation and scale applied** (_Ctrl A_);
   - its **origin at its base's centre** (the lowest point, x and y centred): an instance stands on the point it's put on;
   - within the budgets (a rock 400 triangles; Statistics overlay); smooth or flat shaded as the look wants; UVs only for a rock with its own maps.
   - Anywhere in the file: _Collection Info_'s _Reset Children_ draws them at their origins.
3. **The scatter object:** an empty mesh object at the world origin (_Add → Mesh → Plane_, then delete its vertices) with a Geometry Nodes modifier. Not a modifier on the block: Export Block writes the block as it is, and a block can have several scatters (pebbles, rocks, boulders), each its own object. The group (`AekTerrainScatter` in the template):
   - _Object Info_ (the block, **Relative**) → _Distribute Points on Faces_, **Poisson Disk**: _Distance Min_ the spacing (the engine's `minSpacing`), _Density Max_ the points a square metre where the mask is 1, _Seed_.
   - The mask into _Density Factor_: _Named Attribute_ `Splat` (Color) → _Separate Color_, each channel × its factor, summed (the base layer is 1 − R − G − B). The same as the engine's `mask.layers`. A block painted by a splat map: an _Image Texture_ node (the map, _Extend_) at a _Named Attribute_ `UVMap` (Vector) in place of the `Splat` read (`terrainShowcase`'s alpine boulders: the template's group with that swap, its G the scree).
   - Rotation: _Align Rotation to Vector_ (Axis Z, the point's _Normal_, Factor 0 upright to 1 along the ground), then _Rotate Rotation_ (Local) by a _Random Value_ yaw (0..2π about Z).
   - Scale: a _Random Value_ (Float, min..max) into a uniform vector.
   - Item: a _Random Value_ (Integer, 0 to the collection's child count − 1: _Domain Size_ on the _Collection Info_'s instances).
   - Sink: _Set Position_ moves each point down its own up by the sink × its scale (_Rotate Vector_ of (0, 0, −sink)), so the GPU instances and the point cloud both carry it.
   - _Store Named Attribute_ on the points (Point domain): `_ROT` (Quaternion), `_SCALE` (Vector), `_ITEM` (Integer).
   - _Instance on Points_: the points, the _Collection Info_ (_Separate Children_, _Reset Children_) as the instance, **Pick Instance** on with `_ITEM` as the index, `_ROT` the rotation, `_SCALE` the scale (each read back with _Named Attribute_).
   - A _Switch_ (Geometry) on a `Points` input outputs the stored points instead of the instances: the point-cloud export.
4. **Don't realize instances.** _Realize Instances_ (or _Object → Apply → Visual Geometry to Mesh_) turns every rock into mesh data: a huge GLB, and the engine draws it as one plain mesh, no cells.
5. **Several scatters on one block:** an object each (pebbles, rocks, boulders), each its own group copy or the same group with other inputs in its modifier panel, exported into one GLB (a node each) or several.

## Export

_File → Export → glTF 2.0_, the scatter object and the rock objects selected (the items name the rocks' own nodes, `<importId>/RockA`):

| Exporter section    | Setting                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| Format              | glTF Binary (`.glb`)                                                                           |
| Include             | Limit to: Selected Objects; Data: Custom Properties ✓                                          |
| Transform           | +Y Up ✓                                                                                        |
| Data → Scene Graph  | **Geometry Nodes Instances (Experimental) ✓**, **GPU Instances ✓**                             |
| Data → Mesh         | Apply Modifiers ✓, UVs (a rock with its own maps), Normals ✓; Attributes ✓ for the point cloud |
| Data → Point Clouds | ✓ for the point cloud (on by default)                                                          |
| Data → Material     | Materials: No Export                                                                           |
| Data → Compression  | Off: the asset pipeline encodes                                                                |

- **GPU instances** (the default path): the scatter object's node gets a child per item (`scatterBlockRocks.0`, `.1`, …, in no fixed order), each a copy of a rock's mesh with its instances in `EXT_mesh_gpu_instancing`. The template's export: 498 instances, 67 kB.
- **The point cloud** (when an exporter version mangles GPU instances): the modifier's `Points` on, the object's custom prop **`aekScatterPoints` = 1** (_Object Properties → Custom Properties_), then Geometry Nodes Instances, Point Clouds and Attributes on. The object's node gets a child `GN Instance`, a `POINTS` primitive with `_ROT`, `_SCALE`, `_ITEM` (and Blender's `_RADIUS`, ignored), in Blender's Z-up axes, which the importer turns. The template's export: 49 kB.
- **The block at grid (0, 0), the scatter object at the origin:** the engine places the file's root at the block's centre. For a block at another grid place, move the block and the scatter object to the origin for the export, then back (the rocks' place doesn't matter: _Reset Children_ and the items read their meshes).
- **Rocks with their own maps:** UVs ✓, and the items' material is the model's (`rockScatterNamaqualandBoulder02` for the toolkit's boulder, imported into the `.blend` from its GLB; several shapes of one model, each its scale applied, are several items and draws).

## Import into Ækasha

### The items

- **Procedural rocks** (`aekasha/toolkit/geometry`): `generateRock({ kind, seed, … })` builds a seeded lumpy rock, indexed with smooth normals, its base cut flat and its origin at the base's centre; no UVs (the material is triplanar). `saveRockGeometries()` registers the toolkit's variants for the scene: `rockPebble_a..c` (`PEBBLE`: about 13 × 6 cm, 80 triangles), `rockSmall_a..c` (`ROCK`: 55 × 28 cm, 320), `boulder_a..b` (`BOULDER`: 2.4 × 1.3 m, 1,280). No geometry JSON makes a rock: call it in the scene's code before the spawn (a scatter throws on an item that isn't registered).
- **Imported rocks** (the toolkit's `models/nature/`, Poly Haven, CC0): `namaqualandStones01` (pieces `StoneA`-`E`, pebbles of 7-14 cm at 80 triangles; `RockA`-`C`, three of them × 4 at 400) and `namaqualandBoulder02` (`Boulder`, 2.5 m, 1,500), each with its material `rockScatter<Id>` over its own maps. The scene lists the import (`importedAssets`); the items name the pieces (`namaqualandStones01/StoneA`).
- **Your own model as scatter rocks:** `devTools/toolkit/buildNatureRocks.ts` downloads a Poly Haven model's 1K glTF, takes each piece from a node, scales it, moves its base's centre to the origin and decimates it to its budget with meshoptimizer (normal and UV weighted, the UV seams kept, so the model's maps still fit), and writes a GLB of the pieces. Add a `MODELS` entry (the model id, Poly Haven's asset id, each piece's source node, budget and scale), run `npx tsx devTools/toolkit/buildNatureRocks.ts`, then: the `*.importedAsset.json` (`"optimize": { "mesh": { "quantize": false } }`), the maps as a texture set (`src/toolkit/textures/<id>/`, a `source.json` naming Poly Haven's maps, `yarn fetchTextureSources --scaffold --only <id>`, `FULL`, `physicalSize` `[1, 1]`), a material JSON with `tiling: 'UV'` over that set, and `yarn assets`.
  - **A scan with fragmented UVs needs a bake.** A decimation that keeps the maps fitting can't collapse a UV seam, so a scan cut into many small islands stops far above the budget (Poly Haven's `boulder_01`: 84 % of its vertices on seams, stuck at 54k triangles), and one that collapses the seams smears the maps into swirls. The script throws naming this. Decimate such a model freely in Blender, unwrap the low poly again, and bake the scan's colour, normal and roughness onto it (_Cycles → Bake_, _Selected to Active_), then make the texture set from the baked maps; or pick a model with few seams (`namaqualand_boulder_02`: 16 %).
- **Leaf cards:** `generateLeafCard({ size: 0.14, curl: 0.12 })`, a square folded along its midrib, 4 triangles, its origin the midrib's centre; `saveLeafCardGeometry()` registers it as `leafCard`. The `leafLitter` material picks a leaf of its atlas per instance (`hash12(instanceIndex)`: one material, one draw a cell) and turns a share of them brown. No shadows.
- **From Blender:** the rocks' own nodes in the scatter's GLB (`<importId>/RockA`), drawn by the item that names them.

### The scatter

Procedural, on the block's layers (`"1": 1` is layer 1, the material's R; the mask takes layer indices, not set ids): **pebbles on sand**, thinned in clusters:

```json
{
  "$schema": "../../../../../.schemas/scatter.schema.json",
  "items": [
    { "geometry": "rockPebble_a", "material": "beachPebbles" },
    { "geometry": "rockPebble_b", "material": "beachPebbles" },
    { "geometry": "rockPebble_c", "material": "beachPebbles" }
  ],
  "source": {
    "type": "PROCEDURAL",
    "generator": "terrainScatter",
    "params": {
      "minSpacing": 0.5,
      "density": 0.5,
      "mask": {
        "layers": { "0": 1 },
        "slope": { "max": 20 },
        "noise": { "scale": 6, "amount": 0.8 }
      },
      "scale": [0.7, 1.4],
      "alignToNormal": 0.8,
      "sink": 0.25,
      "tint": 0.2
    },
    "seed": 1
  },
  "lod": { "levels": [{ "screenSize": 0 }], "cullScreenSize": 0.4 }
}
```

`beachPebbles` is a `rockScatter` material JSON over the sand's own set (an app's material JSON and its two-line TSL file, `export const setup = setupRockMaterial;` from `aekasha/toolkit/terrain`). **Boulders at a cliff's foot**, on the debris layer where the ground is gentle (not on the face), with colliders and shadows:

```json
{
  "items": [
    {
      "geometry": "boulder_a",
      "material": "rockScatter",
      "collider": "CONVEXHULL",
      "castShadow": true
    },
    {
      "geometry": "boulder_b",
      "material": "rockScatter",
      "collider": "CONVEXHULL",
      "castShadow": true
    }
  ],
  "source": {
    "type": "PROCEDURAL",
    "generator": "terrainScatter",
    "params": {
      "minSpacing": 4,
      "density": 0.6,
      "mask": { "layers": { "2": 1 }, "slope": { "max": 30, "softness": 8 } },
      "scale": [0.6, 1.2],
      "alignToNormal": 0.3,
      "sink": 0.3,
      "tint": 0.1
    }
  }
}
```

**Leaf litter on a forest floor** (grass the base, mud in R, thinner there), lying along the ground, 8 m cells:

```json
{
  "items": [{ "geometry": "leafCard", "material": "leafLitter" }],
  "source": {
    "type": "PROCEDURAL",
    "generator": "terrainScatter",
    "params": {
      "minSpacing": 0.12,
      "density": 0.8,
      "mask": { "layers": { "0": 1, "1": 0.6 }, "noise": { "scale": 3, "amount": 0.7 } },
      "scale": [0.7, 1.3],
      "alignToNormal": 1,
      "tint": 0.15
    },
    "seed": 5
  },
  "cellSize": 8,
  "lod": { "levels": [{ "screenSize": 0 }], "cullScreenSize": 0.3 }
}
```

**From Blender** (its scatter object's node by name; the import lossless here, for instances exact to the source, though the default encode works too):

```json
{
  "items": [
    { "geometry": "valleyScatter/RockA", "material": "rockScatter" },
    { "geometry": "valleyScatter/RockB", "material": "rockScatter" },
    { "geometry": "valleyScatter/RockC", "material": "rockScatter" }
  ],
  "source": { "type": "IMPORTED", "importedAsset": "valleyScatter", "nodes": ["scatterBlockRocks"] }
}
```

```json
{
  "$schema": "../../../../../.schemas/importedAsset.schema.json",
  "id": "valleyScatter",
  "fileName": "./valleyScatter.glb",
  "optimize": { "mesh": { "quantize": false } }
}
```

A GPU-instanced node is drawn by the item whose geometry is that node's mesh (Blender copies each rock's mesh under the scatter's node: the items name the rock's own node, and the engine matches them by the glTF mesh); a point by its `_ITEM` (else the items' weights pick). **Hand-placed** instances: `"source": { "type": "PLACEMENTS", "placements": [{ "position": [x, y, z], "yaw": 0.4, "scale": 1.2, "item": 0 }] }`, relative to the block's centre.

### The block and the scene

1. The app registers the generator once, from an install (the template's `appECSPlugins` does): `registerTerrainScatter()` from `aekasha/toolkit/terrain`. `instancing()` is in `features` (the template lists it), and `physics()` for collider items.
2. The block names its scatters: `"scatter": ["valleyPebbles", "valleyBoulders"]` in its `*.terrainBlock.json`. The gather adds each scatter, its items' geometry and material JSONs and an `IMPORTED` source's import to the scene, and puts `instancing` (and `physics` for a collider item) in the scene's feature manifest.
3. The scene's code registers code-made items, then spawns the block:

   ```ts
   import { spawnTerrainBlock } from 'aekasha/terrain';
   import { saveLeafCardGeometry, saveRockGeometries } from 'aekasha/toolkit/geometry';

   export const scene = async () => {
     saveRockGeometries({ kinds: ['PEBBLE', 'BOULDER'] });
     saveLeafCardGeometry();
     const block = await spawnTerrainBlock('valley');
     if (!block) return; // the scene was left meanwhile: nothing was kept
   };
   ```

   `block.scatterIds` are the cells (each scatter's, then its colliders); `block.dispose()` deletes them first.

4. **Without a block:** list the scatter in the scene's `scatters` and spawn it on any target: `await spawnScatter('courtyardGravel', { target: { position: { x: 0, y: 0, z: 0 }, size: 32, grid: { x: 0, z: 0 }, entityId: groundMeshId } })` (`aekasha/instancing`; without an `entityId` `terrainScatter` places on a flat square at the position's height). It resolves `null` when the scene was left meanwhile.
5. **Your own generator:** `registerScatterGenerator(id, (input) => ({ matrices, items?, colors? }))` from an install: world-space matrices (16 floats each), an item index and a linear RGB colour per instance; draw every number from `input.seed` (`createSeededRandom(input.seed)`).

## Set-up and parameters

`*.scatter.json` (the `instancing()` feature's asset, `.schemas/scatter.schema.json`):

| Field      | What it is                                                                                                                                                  | Default       |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `id`       | The scatter's id                                                                                                                                            | The file name |
| `items`    | 1-256 items: `geometry`, `material` (registered ids), `weight` (1), `castShadow` (false), `receiveShadow` (true), `collider` (`CONVEXHULL`, `BALL`, `NONE`) | –             |
| `source`   | `PROCEDURAL` (`generator`, `params`, `seed`), `IMPORTED` (`importedAsset`, `nodes` globs, `seed`) or `PLACEMENTS` (`placements`, `seed`)                    | –             |
| `cellSize` | A cell's side in metres: one draw per item per cell                                                                                                         | 16            |
| `lod`      | Every cell's `LodDef`: `levels` (coarser geometries swap a whole cell) and `cullScreenSize`, `fadeSeconds`                                                  | None          |

`terrainScatter`'s `params` (each error names the scatter and the param):

| Param           | What it is                                                                                                                                                                                                            | Default         |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `minSpacing`    | Metres between any two instances: the Poisson-disk radius, and the cost. The block's square is inset by half of it, so neighbouring blocks keep it across their seam                                                  | 0.5             |
| `density`       | The share of candidates kept where the mask is 1, 0..1                                                                                                                                                                | 1               |
| `mask.layers`   | `{ "<layer index>": factor }`: the block's terrain material's layer weights (its vertex colours, splat maps and rules, normalized; no height blend) × each factor, summed. Not a terrain material: layer 0 everywhere | None            |
| `mask.slope`    | `{ min?, max?, softness? }` in degrees, as a terrain rule's range                                                                                                                                                     | None (5° soft)  |
| `mask.height`   | `{ min?, max?, softness? }` in metres                                                                                                                                                                                 | None (2 m soft) |
| `mask.noise`    | `{ scale, amount?, seed? }`: clusters from a seeded simplex over the world's (x, z) / `scale`, `1 − amount × (1 − noise)`; continues across blocks                                                                    | None            |
| `scale`         | A number or `[min, max]`                                                                                                                                                                                              | 1               |
| `alignToNormal` | 0 upright, 1 along the ground's normal                                                                                                                                                                                | 0               |
| `sink`          | The share of an item's bounding height under the surface, 0..1, along its tilted up                                                                                                                                   | 0               |
| `tint`          | The most an instance is darkened (its colour `1 − tint × random`); 0: no colours                                                                                                                                      | 0               |
| `splatMaps`     | The block's splat map texture ids (`splat0`, `splat1`), for a splat-mapped material's layer mask                                                                                                                      | None            |
| `noiseTexture`  | The texture the material's rules' noise reads                                                                                                                                                                         | `macroNoise`    |

The mask's parts multiply. The rock material `rockScatter` (`setupRockMaterial`; its JSON's `staticDefines` and `inputs`):

| Setting                                 | What it is                                                                                                                                   | Default                |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `surface`                               | The texture set (`{ "textureSet": "rocks01" }`): the ground's for procedural rocks                                                           | `rocks01`              |
| `tiling`                                | `TRIPLANAR` in the rock's own space (each instance keeps its texture; texel density follows its scale) or `UV` (an imported rock's own maps) | `TRIPLANAR`            |
| `antiTiling`                            | `DUAL_SCALE` (a second sample at `farScale` 0.23 of the scale, blended in from 3 to 20 m) or `NONE`; `UV` takes none                         | `DUAL_SCALE`           |
| `macro`                                 | A macro texture: a tint by world position, so neighbouring rocks differ                                                                      | `macroNoise`           |
| `dustColor`, `dustAmount`, `dustFacing` | The faces turned up blend toward the ground's colour (the set's `averageColor`), seating the rocks in it                                     | 0.2 over [0.4, 0.9]    |
| `wet`, `frost`, `rainOcclusion`         | Wet by the surface conditions as the ground (`FULL`, `SIMPLE`, `NONE`), frost's sparkle, `NORMAL_Y` or `MAP`                                 | `FULL`, on, `NORMAL_Y` |

The instance's colour (the scatter's `tint`) multiplies in. `leafLitter`: `albedo` the atlas slot, `autumn` (0.6) and `autumnColor`, `tint`, `roughness`, `wet` (`SIMPLE`, `NONE`) with `porosity`, `wetDarkening`, `wetRoughness`.

**Seeds and determinism.** A scatter's seed is FNV-1a over its id, the target's grid place and the source's `seed`, from a basis mixed with the world seed (`getRandomSeed()`): every block its own placements, the same on every machine, visit and load order. Change `seed` to reroll one scatter; `setRandomSeed` changes every block's with the world. Each candidate draws its five numbers (keep, yaw, scale, item, tint) from its own stream, so a change to the mask moves no other instance. Never a named stream (`getRandomStream` restarts each load and depends on the draw order).

## Variations

- **Rocks in the ground's texture set or their own:** the ground's set (`rockScatter` triplanar over `rocks01`) costs no texture memory and matches the ground by construction; its 12 fetches a pixel are the price of triplanar. Imported rocks with their own maps look like real stones (a 1K `FULL` set, about 3 MB a model) and sample once at their UV (3-4 fetches). The gallery's Scatter row shows both on one ground.
- **Colliders only on boulders:** a `CONVEXHULL` per boulder (its points, scaled) keeps the player off it; pebbles and rocks a character walks over need none (the ground's collider holds). `BALL` is cheaper for round pieces. Past 200 a block, a heightfield bump or a merged collider is cheaper.
- **Tint variation against more meshes:** `tint` (12 bytes an instance, no extra draw) and the macro tint make three meshes read as many; each extra item is another draw per cell. Three variants a kind is usually enough.
- **Cards or meshes for litter:** cards (4 triangles, alpha-tested, no shadows) for thousands of flat leaves; meshes (a few dozen triangles, opaque) for twigs or pinecones that stand up and should cast.
- **Procedural or from Blender:** the generator follows the block's paint and rules with nothing to export and rerolls per block; Blender's Geometry Nodes are for art-directed placement (a rock line along a path, a cairn), and a mix splits a block's layers between them (a mask layer each).
- **LOD levels:** `lod.levels` with coarser geometries (a 320-triangle rock to 80) swap a whole cell; most scatters need only `cullScreenSize`.
- **Shadows:** pebbles and cards don't cast (no visible shadow at their size, and it doubles their draws); rocks and boulders do.

## Pitfalls and checklist

- [ ] `registerTerrainScatter()` called once from an install; `instancing()` (and `physics()` for colliders) in `features`.
- [ ] Code-made items (`saveRockGeometries`, `saveLeafCardGeometry`) registered before `spawnTerrainBlock`.
- [ ] An import a scatter draws is the asset pipeline's output (quantized or lossless: the import makes the pipeline's quantized positions floats again) or lossless; a file another tool quantized keeps its scale in its nodes, which a cell doesn't draw, and the spawn throws naming `"quantize": false`.
- [ ] `cullScreenSize` set from the distance each kind should hide at (Performance), not left at a value that never hides.
- [ ] Shadows on the large pieces only.
- [ ] In Blender: the rocks' rotation and scale applied, their origin at the base's centre, instances never realized.
- **"the item … names the geometry …, which isn't registered":** a code-made rock without `saveRockGeometries` before the spawn, or an import's piece whose import the scene doesn't list.
- **Instances under the terrain or floating:** an item's origin not at its base (Blender), or a `sink` too large; a `TRIMESH` block's overhangs throw (the generator reads the mesh as a grid).
- **Rocks with the wrong texture scale:** the triplanar's texel density follows the instance's scale; a rock scaled × 3 has texels three times larger. Keep `scale` within about 0.5-2 or make larger variants.
- **Everything spawns at the block's centre or twice as far out (Blender):** the scatter object wasn't at the world origin, or the block wasn't at grid (0, 0) at the export.
- **A huge GLB:** instances realized, or GPU Instances off (the exporter then writes every instance as a node).
- **The density ignores the paint:** the mask names layer indices (`"1"` is the material's R), not texture set ids; a splat-mapped block needs `splatMaps`.
- **A dropped frame when a block spawns during play:** the generator's cost (Performance). Raise `minSpacing`, or spawn at a load.

## Template file and example asset ids

- **The template** `src/toolkit/terrain/blender/terrain_scatter.blend` (made by `devTools/blender/buildTerrainTemplates.py`, which also exports it both ways as a check; its README text block in the Layout workspace): `scatterBlock` (64 m / 129, rocks01 in R over sand01), `ScatterRocks` (`RockA`-`C`), `scatterBlockRocks` with the `AekTerrainScatter` group: 498 rocks on the painted patches.
- **The gallery's Scatter row** (`?isDebug=true&startScene=terrainGallery`; `src/app/scenes/terrainGallery/scatterRow.ts`, `scatter/*.scatter.json`): one 24 m block, the procedural rocks (pebbles, rocks, boulders in `rockScatter` over rocks01) on its left half and the imported ones on its right, on one ground; a 12 m block of leaf litter beside it. Its tab's Scatter section switches the weather (dry, wet, soaked) and has three camera poses.
- **`scatterTest`** (`?isDebug=true&startScene=scatterTest`): 20,000 pebbles on a flat 64 m block by a test generator, culled per cell; six hand-placed boulders; the Blender scatter exported both ways (`devTools/blender/buildScatterTest.py`), each instance checked against the other's; a `rulesTerrain` block with `terrainScatter` pebbles on its rock and slabs with colliders, a box dropped on one.
- **The API:** `createInstancedMeshEntity`, `createStaticInstances`, `spawnScatter`, `getScatter`, `registerScatterGenerator`, `unregisterScatterGenerator`, `getScatterGenerator` (`aekasha/instancing`); `registerTerrainScatter`, `setupRockMaterial` (`aekasha/toolkit/terrain`); `generateRock`, `saveRockGeometries`, `ROCK_TRIANGLE_BUDGETS`, `generateLeafCard`, `saveLeafCardGeometry` (`aekasha/toolkit/geometry`); the toolkit's materials `rockScatter`, `leafLitter`, models `namaqualandStones01`, `namaqualandBoulder02`; the schemas `scatter.schema.json` and the terrain block's `scatter`.
- **`terrainShowcase`** (`?isDebug=true&startScene=terrainShowcase`): the coast's procedural pebbles and cliff-foot rocks, the alpine slope's Blender boulders over its splat map's scree (`src/app/scenes/terrainShowcase/blocks/showcaseAlpine/`, GPU instances, convex hulls), the wetlands' leaf litter and path pebbles.
