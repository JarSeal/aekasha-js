# Modular kits and tile-chunk worlds

Terrain and levels built from a kit of modules (cliff faces, ledges, walls, floor tiles, pillars) instead of a heightfield, drawn as a few merged meshes per area with [mesh merge groups](../../hub/pages/features/mesh-merging/guide.md) (`merging()`, `aekasha/merging`). The same technique builds tile-chunk worlds: hex or square tiles, merged per chunk. The Hub's [Mesh merging page](../../hub/pages/features/mesh-merging/guide.md) has the API; this page is how to build a world with it.

## What it is

A kit is a small set of modules, each one mesh, snapped together on a grid: a few geometries placed hundreds of times. Every placed piece is an entity (its transform, its collider, its data), and the pieces that share a material are drawn as one merged mesh per cell. Hand-built shapes a heightfield can't express (overhangs, caves, stairs, walls, arches) cost a few draws per area instead of one per piece.

```text
 kit (4 modules)          placed (282 entities)          drawn (5 merged meshes)
 ┌──┐ ┌────┐ ║ ▭      →   ▭▭▭▭▭▭  ║   ║  ┌────┐     →   floor group   (144 tiles)
 └──┘ └────┘ ║          ▭▭▭▭▭▭  ║   ║  └────┘         stone, cell -1,-1 · cell 0,-1
 tile  block  pillar gate                                stone, cell -1,0  · cell 0,0
```

A tile-chunk world is the same with a grid of tiles: each chunk's tiles of one material are one group (the `AUTO` cell size is the chunk size), and changing a tile changes its group.

## Best for

|                      | Good fit                                                                                                                                           | Poor fit                                                                                                                                                         |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Art style            | Stylized and low-poly; PBR kits on trim sheets or world-space (triplanar) materials                                                                | Organic, painted ground: a heightfield block with a splat (p305, p306)                                                                                           |
| Game type and camera | Third-person and top-down action in hand-built levels, dungeon crawlers, isometric and RTS maps, city builders, puzzle and strategy games on tiles | Destructible-everything (every piece moving: instancing or `BatchedMesh`, p375); first-person close-ups that need per-piece LOD (a group has no LOD before p376) |
| World size           | A room to a few km²: groups per cell, and per streaming cell in an open world                                                                      | One huge mesh (it's one draw already), or a scene of few large pieces                                                                                            |

Poor fits also: transparent kits (glass, water: refused, drawn sorted per object) and pieces that move every frame (each move rewrites the piece's range).

## Performance

- **Fetches per pixel**: the kit material's own, the same as unmerged. A material with albedo, normal and ORM maps samples 3 per pixel (`P` = 3, `L` = 1, `A` = 1, `T` = 1 in p301 §6's formula); a world-space triplanar kit material 9 (`T` = 3), or about 3-5 slope-gated.
- **ALU**: unchanged. The merged mesh is an ordinary mesh with the members' material.
- **VRAM**: the merged geometry holds every placed piece's vertices (a module placed 100 times is 100 copies, unlike instancing: about 32 bytes a vertex for position, normal and uv, so 10 000 vertices ≈ 320 KB). A module's own geometry is never uploaded when only merged pieces use it (the scene's groups are built during its load, before anything draws).
- **Draw calls**: one per group per pass: the main pass, and every shadow pass whose light reaches the group. Unmerged, one per piece per pass.
- **CPU**: fewer render objects to sort and submit. A move (`updateMergeMember`) rewrites one piece's range; adding or removing pieces in bulk rebuilds the group (a merge, in the assets worker above 65 536 vertices).
- **Quality tier**: none. Merging changes no shader, unless the group is on a palette (the variation below), whose merge material costs more per pixel.
- **Measured** (CPU, not GPU: p310's gallery hasn't measured this technique): `largeWorld`'s 409 static pieces in 28 groups take the main camera's draws from 381 to 38 per pass and the day-night sun's shadow pass from 53 to 15, and the CPU frame from 3.2-3.8 ms to 2.3-2.5 ms, on WebGPU and WebGL2 (Chrome on macOS; the table is on the Hub page). The `exampleMerging` courtyard: 423 draws a frame on its own, 16 merged.

## Maps

The kit's material is any opaque engine material: merging adds no maps of its own.

| Map    | Required          | Packing                               | Colour space | Codec                             | Size                          |
| ------ | ----------------- | ------------------------------------- | ------------ | --------------------------------- | ----------------------------- |
| Albedo | yes (or a colour) | RGB (A only for alpha test)           | sRGB         | UASTC or ETC1S, the `albedo` slot | 1K-2K for a shared trim sheet |
| Normal | optional          | RG (+ derived B)                      | linear       | UASTC, the `normal` slot          | as the albedo                 |
| ORM    | optional          | R occlusion, G roughness, B metalness | linear       | the `orm` slot                    | as the albedo, or half        |

- **One material per group**: a kit that should merge into one draw per cell shares one material, so its pieces share one texture set (a trim sheet, or one tiling set in world space). Each extra material is one more group per cell, unless the materials share a palette (see [Variations](#variations)).
- Vertex colours (tint, baked AO) are fine, but on every piece or none: `AUTO`'s key includes the attributes, so pieces with and without `COLOR_0` make separate groups.
- Several kit materials in one draw: a palette (see [Variations](#variations)). Its slots take these same maps, built into one texture array per slot at one size, so give the kit's materials maps of one size.

## Blender, step by step

1. **Set the grid.** 1 unit = 1 metre, Z up in Blender (Y up after export). Pick the module size (2 m here) and set the snapping increment to it.
2. **Model each module** as one object with one material: its origin at its snap point (a floor tile's centre, a wall block's bottom centre), every module facing the same way. Keep modules closed and their faces on the grid, so neighbours meet without gaps or z-fighting.
3. **Share geometry**: place copies of a module as linked duplicates (Alt+D). The exporter writes one glTF mesh for them, and the import registers it once.
4. **Kit-bash the level** from the modules, snapping to the grid. Rotations and scales are fine (a merge bakes them in, mirrored ones included), but keep each piece's material the kit's.
5. **Mark what merges**: on each object, Object Properties → Custom Properties → New, name `merge`, type String, value `AUTO` (or a group's id). Or mark nothing and pass `merge: 'AUTO'` to the spawn for every piece.
6. **Colliders**: give the level its colliders as their own objects (`isPhysObj`, `colliderType`, a `FIXED` `rigidType`), as the physics page says (the Hub's [From imported models](../../hub/pages/features/physics/guide.md)). A piece whose body isn't `FIXED` is never merged.
7. **Keep out** what moves or opens (doors, levers, platforms): no `merge` property, so they're entities drawn on their own.

## Export

File → Export → glTF 2.0:

- Format: glTF Binary (`.glb`).
- Include: Selected Objects (or the level's collection), **Custom Properties ✓** (the `merge` and physics properties).
- Transform: **+Y Up ✓**.
- Mesh: Apply Modifiers ✓, UVs ✓, Normals ✓, Tangents ✗ (three's normal maps work without them), Vertex Colors only if every piece has them, Loose Edges / Points ✗.
- Materials: no export, unless the kit's textures come with the file (then `importTextures`, see the asset optimization guide). The engine gives an import one material.
- Compression ✗: the asset pipeline compresses (meshopt) and keeps collider sources lossless.
- Animation ✗.

## Import into Ækasha

The model, next to its source (`src/app/scenes/<scene>/` when one scene uses it):

```jsonc
// ruinKitLevel.importedAsset.json
{
  "$schema": "../../../../.schemas/importedAsset.schema.json",
  "id": "ruinKitLevel",
  "fileName": "./ruinKitLevel.glb",
  "optimize": { "profile": "prop" },
}
```

The scene lists it, the kit material and its `AUTO` cells:

```jsonc
{
  "importedAssets": ["ruinKitLevel"],
  "materials": ["ruinStone"],
  "mergeGroups": [{ "id": "AUTO", "cellSize": 24 }],
}
```

The scene code spawns it (the nodes' own `merge` properties, or the spawn's for every piece):

```ts
import { spawnImportedAsset } from 'aekasha';

await spawnImportedAsset('ruinKitLevel', { material: 'ruinStone', merge: 'AUTO' });
```

Or place the modules in code or in the scene JSON, each with `merge` (the `exampleMerging` scene does both):

```json
{
  "props": {
    "geo": "ruinKitLevel/wallBlock",
    "mat": "ruinStone",
    "position": { "x": 4, "y": 0, "z": 12 },
    "merge": "AUTO"
  }
}
```

List `merging()` in `InitEngine`'s `features`, after `physics()`.

## Set-up and parameters

| Setting                       | Where                                                                                                  | Default            | What it does                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------ | --------------------------------------------------------------------------- |
| `merge`                       | a mesh's props (code, mesh JSON, scene mesh), a node's custom property, `spawnImportedAsset`'s `merge` | none               | `'AUTO'`, a group's id, or `{ group?, cellSize?, maxVertices?, palettes? }` |
| `mergeGroups` `AUTO` entry    | scene JSON                                                                                             | —                  | the scene's `cellSize`, `maxVertices` and `palettes` for `AUTO`             |
| `cellSize`                    | `AUTO` entry, a mesh's `merge`                                                                         | 32 m               | square x/z cells; a group never spans two                                   |
| `maxVertices`                 | `AUTO` entry, a mesh's `merge`                                                                         | 262 144            | a full group opens the next one in its cell                                 |
| `castShadow`, `receiveShadow` | a named group's entry, `createMergeGroup`                                                              | the first member's | the group mesh's shadow flags                                               |
| `persistent`                  | `createMergeGroup`                                                                                     | false              | keeps the group across scene switches                                       |
| `streaming.cellSize`          | scene JSON                                                                                             | —                  | the `AUTO` cell size should divide it (warned otherwise)                    |
| `mergeMaterials`              | scene JSON                                                                                             | none               | the palettes (`*.mergeMaterial.json` ids) the scene loads                   |
| `palettes`                    | `AUTO` entry, a mesh's `merge`                                                                         | none               | the palettes whose materials share an `AUTO` group; `[]` none               |
| `palette`                     | a named group's entry, `createMergeGroup`                                                              | none               | the palette whose materials the group takes                                 |

Choosing the cell size: big enough that a cell holds many pieces (a cell of three pieces saves two draws), small enough that most of a group is in view when any of it is (a group is drawn whole). About the distance across a room or a street for third-person, a few chunks for top-down. A group's radius under twice the spatial index's cell size keeps it out of the oversized tier (`largeWorld`: 50 m `AUTO` cells, 24 m spatial cells).

## Variations

- **Tile-chunk worlds.** The `AUTO` cell size is the chunk size, so each chunk's tiles of a material are a group. Raising or turning a tile is `setTransform` then `updateMergeMember` (in place, no rebuild). Changing a tile's type is a new piece: `removeFromMergeGroup` (or delete) the old one and create the new one with `merge`: the new one rebuilds its chunk's group in the next frame. Keep chunks small enough that the rebuild is cheap: p371 measured a warm 100k-vertex merge at about 11 ms on the main thread, so a chunk of a few thousand vertices costs a fraction of a millisecond (above 65 536 vertices the merge goes to the worker). Tile types of different materials share a chunk's group through a palette (next).
- **Several materials in one draw (a palette).** A `*.mergeMaterial.json` lists 2-256 `STANDARD` materials that agree on their state and maps; the pipeline builds each map slot (`map`, `normalMap`, `orm`, `emissiveMap`) as a texture array, a layer per material, and a merge material draws them all, each vertex carrying its material's index and a table holding each material's values. A scene lists the palette (`mergeMaterials`), and an `AUTO` entry's `palettes` (or a named group's `palette`) puts a cell's pieces of those materials into one group: stone, brick, moss and plaster pieces are one draw per cell instead of four. The Hub page's [Palettes](../../hub/pages/features/mesh-merging/guide.md) section has the files and settings.
  - **Fetches per pixel**: every slot the palette has, for every member (a member without the map samples a neutral layer), plus five texel reads of the table; a member's own material samples only its own maps. `"missing": "SKIP"` on a slot skips the sample for the members without the map (a branch per triangle), but its explicit gradients pick slightly other mip levels than a plain sample (on high-frequency texels, up to 32/255 apart in p374's verification scene).
  - **Measured** (p374 D5: 1 600 pieces of four materials in nine cells, Chrome on an Apple M2): 10 draws by palette against 37 by material, but 0.6-0.8 ms more GPU time a frame with the field in view from above and 1.8-1.9 ms with it filling the view, on WebGPU and WebGL2, while the 27 fewer draws saved about 0.03 ms of CPU. A palette pays where the draws are short: many materials a cell, many cells, shadow passes, a device whose draws cost more. With two to four materials a cell, keep a group per material, and measure before switching.
  - **VRAM**: the merged geometry gains the index attribute (4 bytes a vertex on WebGPU, 1 on WebGL2), and a palette group, all its materials' pieces together, passes 65 535 vertices sooner, where its index goes from 16 to 32 bits: `maxVertices: 65535` keeps it at 16. The arrays cost what the members' textures do when the textures share a size; a smaller one is scaled up to the slot's size.
  - Transparent materials, `PHYSICAL` features and custom TSL materials can't share a palette; a `matOverrides` variant of a member is another material, refused by its group.
- **World-space material** (the toolkit's `triplanarProjection`): pieces need no matching UVs, and walls, ledges and cliffs share one material, so one group per cell. Three times the texture fetches (`T` = 3), less with slope gating.
- **Build-time merge** (an imported asset's `merge`, the asset optimization guide's "Merging pieces"): no merge at load and nothing per piece at runtime, but the pieces are no longer entities. Use it for a level section that never changes; keep groups where pieces are picked, moved, destroyed or have colliders of their own.
- **A merged geometry** (`MERGED`, the scenes and assets page): a fixed assembly (a wall section of five modules) registered once and placed as one mesh. It combines with groups: a placed section can join a group.
- **Instancing for repeated dressing**: hundreds of copies of one rock or crate are one instanced draw with per-instance culling and LOD; merge only the varied structure around them.
- **Streaming**: with `streaming` on the scene, an `AUTO` cell size that divides the streaming cell keeps every group inside a streaming cell. A group doesn't fade or prime with its cell (the Hub page's Streaming section).

## Pitfalls and checklist

- [ ] Every piece that should merge shares the material instance (`mat` by the same id; a `matOverrides` variant is another material and another group), or its material is in the palette its group or `AUTO` entry names.
- [ ] The kit's pieces have the same attributes (all with vertex colours, or none).
- [ ] No transparent material, no material array, no `LOD`, no dynamic or kinematic body on a merged piece (each is refused with a warning naming the entity).
- [ ] A piece moved after it merged is followed by `updateMergeMember` (the debug env warns once for each that isn't).
- [ ] Doors, levers and moving platforms aren't merged.
- [ ] The `AUTO` cell size fits the camera: look at the draw count in the profiler (F8) with the groups and dissolved (`dissolveMergeGroup`).
- [ ] `merging()` is in `features`, after `physics()`.
- [ ] In a streaming scene, the `AUTO` cell size divides the streaming cell size.
- [ ] Shadows: a group casts as its first member does unless its entry says otherwise; a light whose shadow covers the kit gains as much as the main pass.

## Template file and example asset ids

No Blender template (decided in p372): a kit is a few modules on a grid, and the `merge` custom property isn't in the engine's `customPropTemplates.blend` yet (it's a String property, step 5).

Examples in the repo:

- `exampleMerging` (`src/app/examples/merging/`): the kit `exampleMergingTile`, `exampleMergingBlock`, `exampleMergingPillar` and `exampleMergingGate`, the materials `exampleMergingTile` and `exampleMergingStone`, a named group and `AUTO` cells of 16 m; the Hub's example page walks through it.
- `largeWorld` (`src/app/scenes/largeWorld/largeWorldRuins.ts`): eight ruin sites from `largeWorldRuin{Floor,Wall,Pillar,Rubble}Geo` in three materials, `AUTO` cells of 50 m.
- `mergeMaterials` (`src/app/scenes/mergeMaterials/`, a debug scene): the palette `ruinsPalette` (`ruinStone`, `ruinBrick`, `ruinMoss`, `ruinPlaster`) on a field of 1 600 pieces in `AUTO` cells of 8 m, merged by palette, by material or not (`window.__mergeMaterials.field(mode)`).
- `testDebugScene`'s `p371MergeKit`: a 20-piece GLB kit merged at build time instead, its doors excluded.
