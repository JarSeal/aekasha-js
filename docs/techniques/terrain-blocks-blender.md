# Terrain blocks from Blender

A terrain block is a square heightfield grid that the engine loads as one unit: its mesh, its terrain material and the block's own inputs (a splat or colour map), and its collider, named by a `*.terrainBlock.json` and spawned with `spawnTerrainBlock`. This page is the workflow every technique page starts from: making a block in Blender with Ækasha's terrain add-on, shaping and painting it, exporting it, and bringing it into a scene. The technique pages add their own painting and material on top.

Checked with **Blender 5.3** (the add-on's minimum: its export reads the glTF exporter's option names and refuses on one it doesn't know).

## What it is

```text
 Blender (the add-on)                            Ækasha
 ───────────────────                             ──────
 Add Terrain Block ─► shape (Z only) ─► paint ─► Export Block ─► <id>.glb ──── yarn assets ─► the import
                                    │                          ├ <id>_splat0.png, <id>_colorMap.png
                    Bake AO ─► Splat.A                         ├ <id>.importedAsset.json   (stub)
                                    │                          └ <id>.terrainBlock.json    (stub: the material, the inputs)
                         Validate ──┘                                        │
                                                       scene: "terrainBlocks": ["<id>"], await spawnTerrainBlock('<id>')
```

**The block conventions** (they make each block a self-contained, streamable unit; the add-on follows them and Validate checks them):

| Property      | Rule                                                                                                                                                 | Why                                                                                        |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Shape         | Square, an edge of 32, 64, 128 or 256 m                                                                                                              | Power-of-two grids line up for LOD and streaming                                           |
| Grid          | `resolution = 2^n + 1` vertices a side (33, 65, 129, 257); a regular grid in X / Z, the vertices moving in height only                               | A heightfield collider; neighbours share their edge vertices                               |
| Spacing       | `size / (resolution − 1)`: 0.5 m (64 m / 129) up close, 1 m (128 / 129, 256 / 257) for large worlds                                                  | A vertex colour's resolution is the spacing                                                |
| Origin        | The block's centre in X / Z, height 0; heights are absolute world heights                                                                            | A heightfield is centred on its body; blocks tile by translation alone                     |
| World place   | `(gridX · size, 0, gridZ · size)`                                                                                                                    | The grid coordinates are the streaming key                                                 |
| Edges         | Neighbours share their edge vertices exactly; the normals at the edges come from the continuous surface                                              | No cracks, no lighting seams                                                               |
| UVs           | Top-down, 0..1 over the block: U along +x, V along +z (the engine's), V 0 at the −z edge                                                             | A block's own splat and colour maps                                                        |
| Vertex colour | `COLOR_0`: `RGB_AO` (R, G, B weigh layers 1-3, A the baked AO) or `RGBA` (layers 1-4)                                                                | The weights and the AO                                                                     |
| Extra data    | Custom attributes named with a leading `_` (glTF's rule), eg. `_WETNESS`                                                                             | Optional, for later techniques                                                             |
| Tangents      | None                                                                                                                                                 | World-space tiling has an analytic frame                                                   |
| Materials     | Not exported: the block's JSON names the terrain material                                                                                            | Swappable looks                                                                            |
| Custom props  | `isPhysObj`, `keepMesh`, `rigidType: FIXED`, `colliderType: HEIGHTFIELD`, `nCols` / `nRows` (cells), `aekBlockSize`, `aekBlockRes`, `aekGridX` / `Z` | The collider travels with the GLB for a plain import; the block's JSON decides its own one |

**The axes:** the engine's (x, y, z) is Blender's (x, −z, y): the engine's +y is Blender's +Z (up), its +z Blender's −Y. Seen from Blender's top view, the engine's −z edge is the top, so a block's row 0, its V 0 and a splat image's top row are all the top view's top edge.

## Best for

|                      | Good fit                                                                                         | Poor fit                                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Art style            | Any                                                                                              | –                                                                                                                                                        |
| Game type and camera | Art-directed, hand-shaped places: hero areas, levels, a valley a quest walks through             | Endless or seed-driven worlds ([generated terrain](terrain-procedural-meshes.md)); caves and arches everywhere ([modular kits](terrain-modular-kits.md)) |
| World size           | A few blocks to a few dozen; larger worlds from one large grid split into blocks, or a heightmap | Hundreds of blocks authored one by one                                                                                                                   |

## Performance

- **The GLB** (64 m / 129, 16 641 vertices, `COLOR_0`): 864 KB from Export Block, 324 KB after the asset pipeline's lossless meshopt (the `terrainBlock` profile); a 32 m / 33 block 57 → 17 KB.
- **VRAM:** about 40 bytes a vertex (positions and normals 12 each, UVs 8, `COLOR_0` 8: the exporter writes 16-bit colours) plus 2-byte indices: about 0.9 MB for a 129² block.
- **The collider:** a `HEIGHTFIELD` keeps one float a vertex (67 KB for 129²) and is cheaper to collide against than a `TRIMESH` of the same triangles.
- **Draw calls:** one per block. **Fetches per pixel:** the material's (the technique pages).
- **In Blender:** Validate of a 257² block 0.11 s; Bake AO on a 129² block with 128 samples 2.2 s (Cycles on the CPU, Windows); Export 0.3 s.

## Maps

| What                      | Where                              | Colour space      | Notes                                                                    |
| ------------------------- | ---------------------------------- | ----------------- | ------------------------------------------------------------------------ |
| `Splat`                   | The mesh, exported as `COLOR_0`    | Linear in the GLB | Byte colour, on vertices (not face corners), the active colour           |
| `<id>_splat0` (`_splat1`) | `<id>_splat0.png` beside the GLB   | Non-Color, 8-bit  | A splat map painted in Texture Paint ([Splat map](terrain-splat-map.md)) |
| `<id>_colorMap`           | `<id>_colorMap.png` beside the GLB | sRGB, 8-bit       | Bake Colour Map's ([Colour map + detail](terrain-colormap-detail.md))    |
| The layers' sets          | `src/toolkit/textures/<setId>/`    | The sets'         | The material's, not the block's; the preview reads their fetched maps    |

## Blender, step by step

1. **Set-up** (once).
   - Blender 5.3. Units: Metric, Unit Scale 1.0, Length metres (the templates have them). The 3D view's clip end at 1000 m (sidebar → View), so a 256 m block isn't cut off.
   - Install the add-on: _Edit → Preferences → Add-ons_, the drop-down at the top right → _Install from Disk_ → `src/toolkit/terrain/blender/aekasha_terrain_tools.py`. Its tab is **Ækasha** in the 3D view's sidebar (N). In its preferences, _Repo Folder_ is the repo (empty: the folder above a `.blend` saved inside the repo).
   - Run `yarn fetchTextureSources` in the repo: the preview material and the templates read the texture sets' fetched maps (`source/raw/`, by relative path).
   - Start from a template (below) or an empty file. A template's block sits at grid (0, 0), and _Add Terrain Block_ refuses a grid place another block has: delete it first (`terrain_blockTemplate.blend`'s empty `terrainBlock`), or add yours at another place.
2. **Create a block.**
   - **With the add-on:** _Add Terrain Block_ (the sidebar, or _Add → Mesh → Ækasha Terrain Block_): its id (the object's name and the files' names), size, resolution, grid place, splat layout and collider. It makes the grid at its exact positions, two triangles a cell along the heightfield collider's diagonal, the top-down UVs, a black `Splat` (A 1 for `RGB_AO`: unoccluded), the custom props and the preview material, and puts the block at its grid place in the file, so neighbours line up while you shape them (the export moves it to the origin).
   - **By hand, then Split:** _Add → Mesh → Grid_, size 64, subdivisions until the Statistics overlay shows 16 641 vertices (129²), its corners on a block corner (centred at the origin for grid (0, 0)), rotation and scale applied; then _Split Into Blocks_ with one block a side turns it into a block (the same for an A.N.T. Landscape grid of the block's vertex count). Split takes any square regular grid of N × N blocks.
3. **Shape it, heightfield-safe.** A vertex may move in height only: a heightfield has one height per grid point.
   - **Sculpt:** in the Symmetry popover, **lock X and Y**, so the brushes move vertices along Z only.
   - **Displace modifier:** Texture Coordinates _Global_ (a neighbouring block with the same modifier continues the shape), Direction **Z** (the default, Normal, moves the vertices beside a raised one sideways and Validate refuses them), Midlevel 0 (the texture's 0..1 lifts the ground by 0..Strength). Validate and Export read the block with its modifiers applied, so applying them is optional.
     - Blender's _Clouds_ stays near its middle (about 0.3-0.7): raise its _Contrast_ (1.5 or so) for relief that reads.
     - Its _Vertex Group_ fades it out where a group's weight falls (painted with Weight Paint's _Gradient_): dunes that calm down before a beach, hills that flatten toward a road.
     - A tilt or a ramp: a _Blend_ texture (_Linear_, or _Quadratic_ for a drop that steepens), whose gradient spans −1..1 of its coordinates, which _Global_ can't scale: set Texture Coordinates to _Object_ with an empty scaled to half the block and turned so its +x points down the slope.
   - **A script** writing the vertices' Z (the templates are made that way: `devTools/blender/buildTerrainTemplates.py`).
   - **No overhangs** on a `HEIGHTFIELD` block: set its Collider to **Trimesh** for an overhang, an arch or a cave mouth (Validate then skips the grid checks; [Triplanar cliffs](terrain-triplanar-cliffs.md)).
4. **UVs:** Add makes them. If a mesh lost them: the top view, _UV → Project from View (Bounds)_; Validate refuses UVs off the top-down projection. Check the orientation with a corner marker (red painted at the top view's top left must come out at the engine's −x, −z corner: `terrainBlockTest`'s orientation block shows it).
5. **Paint** with the preview material (sidebar → _Preview Material_: the base and up to four layers (eight with a block's second splat map), each a texture set at its real size, the engine's height blend, the AO; _Update Preview_ after a change). How depends on the technique: vertex colours in Vertex Paint ([Vertex-colour splat](terrain-vertex-color-splat.md)), or _New Splat Map_ and Texture Paint ([Splat map](terrain-splat-map.md)). Over-painted (weights summing over 1)? _Normalize Splat_. The preview is an approximation: no normal maps, anti-tiling, macro variation or roughness, and Blender's lighting.
6. **Bake AO → Splat Alpha** (`RGB_AO` blocks): Cycles' AO (samples, distance: about the size of the hollows to darken, 8-16 m) into `Splat`'s A, every painted RGB byte kept. Why: valley-scale occlusion (hollows, the foot of a slope, under a cliff) that a tiling layer's own AO can't carry, applied by the engine to indirect light only, at no cost per pixel (`ao.vertex`). Every object the render sees occludes, neighbouring blocks included: bake with the neighbours in the file.
7. **Custom props:** written by the add-on from the block's settings (Object Properties → Custom Properties), again at every export. By hand (a mesh made without the add-on, for a plain import): copy them from `src/_engine/kernel/assets/import/customPropTemplates.blend`, the table above.
8. **Validate, then Export Block.** Validate lists errors (what Export refuses: a vertex off its grid point, the vertex count, the object off its grid place or rotated, scaled or parented, holes, loose vertices, UVs, a neighbour's edge heights) and warnings (unapplied modifiers, quads, cells split along the other diagonal, sums over 1, a float `Splat`). Export validates first, then writes the block's files into its _Folder_ (below).
9. **Several blocks.** Neighbours share their edge vertices exactly, and their edge normals must agree too, or the light shows a seam:
   - Shape one large grid covering N × N blocks (its corners on block corners), then _Split Into Blocks_: each block gets its slice's heights and splat, its grid place, and **the large grid's vertex normals as custom normals**, so the edges agree in light (without them a shared edge's normals differ by about 2.6°). **Split last:** a block reshaped after the split keeps the old normals.
   - Shaping blocks separately: Validate compares each block's edges with the neighbours in the file (0.01 mm), and Bake AO lets them occlude each other.
   - The grid coordinates are the blocks' places in the world (`gridX · size`, `gridZ · size`); a future world streamer loads them by those keys.

## Export

**Export Block** (the add-on) is the only export that needs no care: it uses the locked glTF settings below on a copy of the block at the origin named by its id (the block in the file stays where it is), and refuses when the running Blender's exporter lacks one of them. It writes into the block's _Folder_:

- `<id>.glb`, then reads it back: one node named by the block at the origin with its custom props, `resolution²` vertices (a `HEIGHTFIELD` block) with `POSITION`, `NORMAL`, `TEXCOORD_0`, `COLOR_0`, no `TANGENT`, no other colour, no materials or images.
- `<id>_splat0.png` / `_splat1.png` and `<id>_colorMap.png` when the file has those images, their bytes as they are (a splat map must be Non-Color before painting: below).
- Only where no such file is (your edits are never overwritten): `<id>.importedAsset.json` (`"optimize": { "profile": "terrainBlock" }`: lossless meshopt, so the shared edge vertices stay exactly equal), `<id>.terrainBlock.json` (a placeholder material, `textureSetSurface`, its description naming the splat layout and the images to wire), and each image's `*.texture.json` (`flipY: false`: glTF's V 0 is the image's top row; the colour map sRGB, a splat map `data`).

**The locked settings, for a manual export** (_File → Export → glTF 2.0_; the add-on's `LOCKED_EXPORT_SETTINGS` by Blender 5.3's names):

| Exporter section           | Setting                                                                                                                                            |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Format                     | glTF Binary (`.glb`)                                                                                                                               |
| Include                    | Limit to: Selected Objects (only); Data: Custom Properties ✓; no cameras, lights, instancing                                                       |
| Transform                  | +Y Up ✓ (the block at the origin: the engine ignores a node's transform, with a warning)                                                           |
| Data → Mesh                | Apply Modifiers ✓, UVs ✓, Normals ✓, Tangents ✗, Attributes ✓ (`_` ones), Loose Edges ✗, Loose Points ✗, Shared Accessors ✗                        |
| Data → Mesh → Vertex Color | Use Vertex Color: **Active** (the `Splat` attribute active); Export All Vertex Colors ✗ (else every other colour attribute goes out as `COLOR_1…`) |
| Data → Material            | Materials: No Export; Images: None                                                                                                                 |
| Data → Compression         | Off (Draco ✗, meshopt ✗): the asset pipeline encodes                                                                                               |
| Animation                  | Off (animations, shape keys, skinning)                                                                                                             |

What the exporter does with the attributes (measured on 5.3): a byte colour is stored as sRGB bytes but exported linear (a half-strength stroke picked in the colour picker's sRGB is about 0.21 in the GLB; 0 and 1 are exact), as 16-bit `COLOR_0`; the object's custom props become the node's `extras` (the mesh's become the mesh's, which the engine doesn't read); a smooth-shaded grid exports `resolution²` vertices, a flat-shaded one splits them.

## Import into Ækasha

1. **The files** in the scene's folder (`src/app/scenes/<sceneId>/blocks/<id>/`, the block's _Folder_), or in a shared `src/app/terrainBlocks/` once a second scene uses the block.
2. **The import** (the stub as written; `"node"` names the GLB's node, the block id):

   ```json
   {
     "$schema": "../../../../../../.schemas/importedAsset.schema.json",
     "id": "valley",
     "fileName": "./valley.glb",
     "optimize": { "profile": "terrainBlock" }
   }
   ```

3. **The block:** replace the stub's placeholder material with the world's terrain material, and give the block's own maps as its inputs (a material variant per block; blocks of one biome share the shader):

   ```json
   {
     "$schema": "../../../../../../.schemas/terrainBlock.schema.json",
     "geometry": { "importedAsset": "valley", "node": "valley" },
     "material": "valleyTerrain",
     "materialInputs": { "splat0": { "texture": "valley_splat0" } },
     "grid": { "x": 0, "z": 0, "size": 64, "resolution": 129 },
     "collider": { "type": "HEIGHTFIELD", "friction": 1.2 },
     "shadows": { "cast": true, "receive": true }
   }
   ```

   The material is a terrain material JSON (an app one needs its two-line TSL file: [Single-layer terrain](terrain-single-layer.md#import-into-ækasha)), its layers in the order base, R, G, B (A); the technique pages have each one's define.

4. **`yarn assets --only valley`** encodes the GLB (and the images) into `src/public/aek-assets/` and gathers; commit the sources, the outputs and `assets.lock.json`.
5. **The scene** lists the block and spawns it (the gather adds its import, material and textures to the scene's lists; the `terrain()` feature is in the template's `features`, and `physics()` for a collider):

   ```json
   { "terrainBlocks": ["valley"] }
   ```

   ```ts
   import { spawnTerrainBlock } from 'aekasha/terrain';

   const block = await spawnTerrainBlock('valley');
   if (!block) return; // the scene was left meanwhile: nothing was kept
   ```

   The mesh is placed at `(x · size, 0, z · size)`, its collider a `FIXED` body on it, both deleted with the scene (or by `block.dispose()`).

6. **Check the collider:** `?isDebug=true`, the debug drawer (`h`), the Physics API tab's collider wireframes over the block. A `HEIGHTFIELD` matches the mesh to the millimetre, between vertices too (the add-on's triangles follow the collider's diagonal).

## Set-up and parameters

The add-on's block settings (sidebar → Ækasha, the active block):

| Setting      | What it is                                                                                                                              | Default        |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| Id           | The asset id: `<id>.glb`, `<id>.importedAsset.json`, `<id>.terrainBlock.json`, the GLB's node. A letter, then letters, digits, `_`, `-` | `terrainBlock` |
| Size         | 32, 64, 128 or 256 m                                                                                                                    | 64             |
| Resolution   | 33, 65, 129, 257, 513 vertices a side                                                                                                   | 129            |
| Grid X / Z   | The block's column (along +x) and row (along the engine's +z, Blender's −Y)                                                             | 0, 0           |
| Splat Layout | `RGB + AO` or `RGBA`                                                                                                                    | `RGB + AO`     |
| Collider     | `Heightfield` (from the grid), `Trimesh` (the triangles: overhangs; costlier; the grid, UV and edge checks skipped), `None`             | `Heightfield`  |
| Folder       | Where Export Block writes (`//` is the `.blend`'s folder)                                                                               | `//`           |

The preview (sidebar → Preview Material, the scene's): the layout, the base and layers 1-4 (texture set ids, a set not fetched a flat colour), the height blend and its depth (the engine's 0.2), the AO strength. One preview a scene: a world has one terrain material.

`*.terrainBlock.json` (the `terrain()` feature's asset; its schema in `.schemas/terrainBlock.schema.json`):

| Field            | What it is                                                                                                                                                             | Default       |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `id`             | The block's id                                                                                                                                                         | The file name |
| `geometry`       | `{ importedAsset, node? }` (a Blender block: `node` the GLB's node, else its only mesh) or `{ generator, params?, seed? }` ([generated](terrain-procedural-meshes.md)) | –             |
| `material`       | The terrain material's id                                                                                                                                              | –             |
| `materialInputs` | The block's own inputs over the material's (`splat0`, `colorMap`, a layer's `textureSet`): a variant per block                                                         | None          |
| `grid`           | `{ x, z, size, resolution }`: centred at `(x · size, 0, z · size)`                                                                                                     | `x`, `z` 0    |
| `collider`       | `{ type, friction?, restitution? }`: `HEIGHTFIELD`, `TRIMESH`, `NONE`                                                                                                  | `HEIGHTFIELD` |
| `shadows`        | `{ cast, receive }`                                                                                                                                                    | Both true     |

## Variations

- **A splat map instead of vertex colours:** _New Splat Map_ on the block, Texture Paint; resolution independent of the mesh ([Splat map](terrain-splat-map.md)).
- **A colour map:** _Bake Colour Map_ bakes the preview's colour through the UVs, for a unique colour or a far surface ([Colour map + detail](terrain-colormap-detail.md)).
- **A `TRIMESH` block** for an overhang or a cave: costlier in physics, no grid rules; keep its edge vertices where its neighbours' are ([Triplanar cliffs](terrain-triplanar-cliffs.md)).
- **A heightmap from a terrain tool** (Gaea, World Machine, World Creator): no Blender at all, `loadTerrainHeightmapAsync` and `generateTerrainAsync` ([Procedural meshes](terrain-procedural-meshes.md#variations)); or import the heightmap into Blender as a displaced grid and continue here to paint it.
- **Generated blocks beside Blender ones:** a `noiseTerrain` block with the same world seed continues its own neighbours, not a Blender block; give a hand-shaped area its own blocks and blend at a flat border.
- **Static dressing on a block:** its props and cutout mesh decals merged per block and material with merge groups (a group id per block, or `AUTO` with a cell size that divides the block size), so they never cross the block that owns them ([Mesh merging](../../hub/pages/features/mesh-merging/guide.md)).
- **Rocks and litter on a block:** its scatters, from Geometry Nodes in Blender or the engine's generator over the block's paint ([Terrain scatter](terrain-scatter.md)).
- **Terrain from modules** (cliffs with overhangs, caves, tile worlds) instead of a heightfield grid: [Modular kits](terrain-modular-kits.md).

## Pitfalls and checklist

- [ ] The block validates with no error (Validate; Export refuses otherwise).
- [ ] Shaped in height only: Sculpt with X and Y locked; a Displace in Direction Z.
- [ ] Rotation and scale applied, no parent, the object at its grid place (Export moves the copy, not you).
- [ ] `Splat` is a byte colour on vertices, the active one.
- [ ] A splat map is Non-Color before the first stroke.
- [ ] Neighbours validated together (their edges), baked together (their AO), split last (their normals).
- [ ] The importedAsset keeps `"profile": "terrainBlock"`.
- [ ] The collider wireframes lie on the block in the engine.
- **"N vertices moved off their grid point in X/Z":** a sculpt without the X / Y lock, or a Displace along the normal. Undo it, or set the block's Collider to Trimesh when the overhang is meant.
- **The block comes out mirrored or turned:** Blender's −Y is the engine's +z. Don't rotate a block to fix it: check the UVs and the corner marker (step 4).
- **Forgot to apply the scale:** Validate refuses a scaled block; apply it (_Ctrl A → Scale_), the heights stay.
- **Draco on:** the exporter's compression must be off: Draco quantizes positions, so neighbours' edges drift apart (and the engine refuses quantized positions on a block, naming the `terrainBlock` profile).
- **A float colour attribute:** doubles the `.blend` for nothing (the GLB is the same: the exporter writes 16-bit colours either way). Validate warns.
- **Painting over 1:** an Add blend, or two channels at 1. _Normalize Splat_ (it keeps the stored bytes' sums within 1).
- **A splat map painted in sRGB:** a half weight stored as 188, not 128. Set its Color Space to Non-Color before painting: changing it later reloads the image and drops the unsaved paint.
- **Quads after an edit:** Validate warns; the exporter splits quads its own way, maybe across the collider's diagonal (the collider then differs from the mesh between vertices). Add and Split make triangles.
- **A light seam between blocks:** their normals differ at the edge. Split Into Blocks after shaping, or shape them with `HEIGHT_FN`-like continuity (one Displace with Global coordinates on all of them, applied before Split).
- **`.blend1` backups:** ignored by git, but a renamed copy isn't; don't commit Blender's backups.

## Template file and example asset ids

- **The add-on:** `src/toolkit/terrain/blender/aekasha_terrain_tools.py` (one file; its header and sections say how it works). `yarn verify:blender` checks it in a real Blender and reads its GLBs as the engine does.
- **The templates** (`src/toolkit/terrain/blender/`, made by `devTools/blender/buildTerrainTemplates.py`; each has a README text block, shown in the Layout workspace):
  - `terrain_blockTemplate.blend`: an empty 64 m / 129 block, the preview material, its custom props: this page.
  - `terrain_singleLayer.blend`: [Single-layer terrain](terrain-single-layer.md).
  - `terrain_vertexColorSplat.blend`: [Vertex-colour splat](terrain-vertex-color-splat.md).
  - `terrain_splatMap.blend` (with `splatMap_splat0.png`): [Splat map](terrain-splat-map.md).
  - `terrain_triplanarCliff.blend`: [Triplanar cliffs](terrain-triplanar-cliffs.md).
  - `terrain_colormapDetail.blend`: [Colour map + detail](terrain-colormap-detail.md).
  - `terrain_scatter.blend`: [Terrain scatter](terrain-scatter.md) (rocks scattered by Geometry Nodes on a block's paint).
  - `structure_concrete.blend`: [Structure materials](structure-materials.md).
- **The orientation block** (`src/app/terrainBlocks/terrainBlockTestBlender/`, `?isDebug=true&startScene=terrainBlockTest`, and the terrain gallery's Orientation block): the add-on's export (`devTools/blender/exportOrientationBlock.py`), 32 m / 33, a mound towards the engine's +x, +z corner, red at −x, −z and green at +x, −z, drawn twice: through its `COLOR_0` (`terrainBlockTestBlender`) and through its splat map (`terrainBlockTestBlenderSplatMap`). Its test pins the orientation in the files.
- **The API:** `spawnTerrainBlock`, `getTerrainBlock` on `aekasha/terrain`; the asset's schema `terrainBlock.schema.json`.
- **Worked blocks:** `terrainShowcase` (`?isDebug=true&startScene=terrainShowcase`; `src/app/scenes/terrainShowcase/blocks/`), built from `terrain_blockTemplate.blend` by `devTools/blender/buildShowcaseBlocks.py` with this page's steps (p310 §3.3-3.6): a coast (Displace modifiers with a vertex group and a Blend tilt, a sculpted cliff band, vertex colours, AO), an alpine slope (two splat maps, a Blender scatter), wetlands (a painted `_WETNESS`) and a bunker on them; a player character walks them.
