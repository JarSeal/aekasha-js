Status: in progress | Phases 1-3 implemented
Category: Terrain, Assets, Physics, Toolkit
Blocks: p307_wet-and-dry-surface-states.md, p308_terrain-scatter.md, p309_terrain-decals.md, p310_terrain-preview-scenes.md
Epic: p301_terrain-texturing-epic.md
Related: \_DONE_p370_static-mesh-merging-and-texture-atlas-systems.md (merging a block's static dressing, modular kit terrain, HLOD far blocks: its §10)

# Terrain Blocks & Procedural Terrain Meshes

The geometry side of the epic. It covers:

- **Block conventions** that make each terrain block a self-contained, streamable unit. Stitching blocks into a world is a future plan; this one keeps it possible.
- **`*.terrainBlock.json`**: an engine asset type tying together geometry (imported or generated), terrain material plus per-block inputs (splat map, colour map), collider, scatter (p308) and decals (p309).
- **`spawnTerrainBlock`**, plus **robust heightfield extraction**. This fixes the known importer mismatch from p990.
- **`generateTerrain` v2** (toolkit):
  - world-continuous noise and edge-correct normals;
  - CPU rules → vertex-colour splat;
  - CPU horizon AO;
  - collider params for generated terrain.
- **The Blender workflow:** an add-on (`aekasha_terrain_tools.py`), the block template, and the technique templates.
- **Handbook:** `terrain-blocks-blender.md` and `terrain-procedural-meshes.md`, plus the Blender / Export / Import sections of p305's pages.

---

## Context (grounded)

- **`toolkit/geometry/generate/Terrain.ts`** (`aekasha/toolkit/geometry`):
  - `generateTerrain({ width, depth, widthSegments, depthSegments, maxHeight, noiseOctaves?, seed?, heightModifier? })` builds a centred, indexed grid. Vertex (row, col) sits at `x = col/wS·width − width/2`, `z = row/dS·depth − depth/2`. The segment counts are rounded and at least 1, and returned as used.
  - Seeded `SimplexNoise` (`createSeededRandom` from `aekasha`) sampled in **block-local** coordinates. `heightModifier(x, z, h)` reshapes the noise height per vertex before the geometry is built (the same local x, z).
  - Attributes: `position`, `uv` (0..1), `normal` from `computeVertexNormals()`. No colour, no tangents.
  - Returns `{ geometry, width, depth, widthSegments, depthSegments, getHeightAt, heights }`. `getHeightAt` follows the mesh's triangles (each cell split along its b–c diagonal), and `heights` is **row-major** (X fastest), while the `HEIGHTFIELD` collider reads column-major (its `@remarks`).
  - Used by `src/app/scenes/largeWorld/largeWorld.ts`' `createTerrain`: 200 × 200, 150 segments, a PHONG material, **no collider**. `topDownTestScene` gives its terrain a `TRIMESH` of the geometry, which matches the mesh exactly.
- **Imports** (`src/_engine/kernel/assets/import/`):
  - `importAssetAsync` (`ImportRegistry.ts`) registers one geometry per primitive as `${id}/${nodeName}` and returns a manifest of node transforms and parsed Blender custom props (`CustomProps.ts`).
  - `spawnImportedAsset(manifestOrId, { transform, material, castShadow, receiveShadow, meshProps, physicsParams, filter, entityOpts })` (`SpawnImported.ts`, on `aekasha`) creates mesh entities, and physics from custom props through the `physics()` feature's import extension (`registerImportExtension`; without `physics()` the physics nodes spawn no bodies, with a warning). A `material` string resolves to a registered material.
  - `GeometryTransfer.ts` keeps every attribute (`color`, extra UVs, `_CUSTOM`) through the worker hop.
- **Custom props** (`CustomProps.ts`): `isPhysObj`, `rigidType`, `colliderType` (including `HEIGHTFIELD` with `nCols`/`nRows`, `TRIMESH`, `CONVEXHULL`), `keepMesh`, `index`, friction etc. Template: `src/_engine/kernel/assets/import/customPropTemplates.blend`.
- **Heightfield extraction** (`deriveColliderFromGeometry`, `src/_engine/features/physics/import/MeshColliderGeometry.ts`, on `aekasha/physics`; `src/_engine/features/physics/CLAUDE.md`'s imported physics):
  - `mergeVertices` on a scratch copy (the registered geometry is never changed);
  - assumes a square grid when `nrows`/`ncols` are absent, and skips the collider with an error when the grid gives no whole number of rows and columns;
  - indexes `heights[i*sizeZ + j] = posY[(sizeZ−1−j)*sizeX + i]` (column-major, Z flipped), i.e. **by vertex order**;
  - `scale = {bboxX, scale.y, bboxZ}`;
  - refuses Draco and quantized positions (both reorder the vertices); the asset pipeline keeps a GLB with a `colliderType` node lossless.
  - **Known bug** (the former p990 item "Heightfield importer mismatches", p125, moved here on 2026-10-02): the collider is centred on the node origin, but a mesh whose bbox isn't centred sits ~0.5 units off. Up to ~190 heights near one edge differ from the mesh by ≤ 0.22 units, probably from the vertex order after `mergeVertices`.
  - **The layout is undocumented** (`docs/issues/heightfield-grid-layout.md`, p620 N4): `nrows`/`ncols` count cells, so `heights` holds (`nrows` + 1) × (`ncols` + 1) values, not the `nrows` × `ncols` the type's docs say; which axis runs along the rows, the Z flip and the centring are only in the import's loop; no non-square grid has been through it.
- **Physics:** `createPhysicsEntity({ type: 'HEIGHTFIELD', nrows, ncols, heights, scale }, { rigidType: 'FIXED' }, target)` (`aekasha/physics`). Rapier's `HeightFieldData` is column-major (`paramsToShape`'s `HEIGHTFIELD` case, `features/physics/backends/rapier/RapierShapes.ts`).
- **Scene loads hold physics stepping** until every `createPhysicsEntity` settles (p101), so blocks spawned in the scene file's `scene()` are deterministic.
- **Engine layout:** an engine asset type with its own spawner is opt-in code, so it's a feature (`src/_engine/kernel/init/CLAUDE.md`, Engine features): `features/<name>/` with its `<Name>Feature.ts`, its entry, its schema next to it, and its scene field as a `FeatureSchemaPart` (`schemas/FeatureSchemas.ts`, composed for the gatherer in `devTools/gather/engineSchemas.ts`; `devTools/gather/CLAUDE.md`). A feature reaches the kernel only through its `FeatureContext`; the only feature → feature runtime import today is character → physics.

---

## Design

### D1 — Block conventions (binding; p301 §4.4 in detail)

| Property        | Rule                                                                                                                                         | Why                                                                                     |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Shape           | Square, edge `size` = 32 / 64 / 128 / 256 m                                                                                                  | Power-of-two grids line up with LOD and streaming later                                 |
| Grid            | `resolution = 2^n + 1` vertices per side (65, 129, 257); a regular grid in X/Z, vertices move only in Y                                      | Heightfield colliders; shared edge vertices                                             |
| Spacing         | `size / (resolution − 1)`; 0.5 m (64/129) for close-up, 1 m (128/129 or 256/257) for worlds                                                  | Vertex-colour splat resolution = spacing                                                |
| Origin          | Block centre in X/Z, Y = 0; heights are absolute world Y                                                                                     | Rapier heightfields are centred on the body; blocks stack in a grid by translation only |
| World placement | `position = (gridX · size, 0, gridZ · size)`                                                                                                 | Grid coordinates are the streaming key                                                  |
| Edges           | Neighbours share edge vertex positions exactly; normals at edges come from the continuous surface (D4, D5)                                   | No cracks, no lighting seams                                                            |
| UV0             | Top-down 0..1 over the block, U along +X, V along +Z (world)                                                                                 | Splat / colour maps (block-local data)                                                  |
| `COLOR_0`       | `RGB_AO` or `RGBA` (p305 D4), Byte Color, vertex domain                                                                                      | Splat weights + vertex AO                                                               |
| Extras          | Custom attributes prefixed `_` (glTF rule), e.g. `_WETNESS` (p307 regional wetness)                                                          | Optional                                                                                |
| Tangents        | None                                                                                                                                         | World-space tiling has an analytic frame (p301 §4.1)                                    |
| Materials       | Not exported; the engine assigns the terrain material                                                                                        | Swappable maps (p301 goal 3)                                                            |
| Custom props    | `colliderType: "HEIGHTFIELD"`, `nCols`, `nRows`, `isPhysObj: 1`, `rigidType: "FIXED"`, `aekBlockSize`, `aekBlockRes`, `aekGridX`, `aekGridZ` | Collider and metadata travel with the GLB                                               |

### D2 — `*.terrainBlock.json` (engine asset type, the `terrain()` feature)

**Why an engine asset type, not just a mesh JSON plus code:**

- A block is the unit a future world streamer loads and unloads. Today it's 3–6 files (GLB, imported asset, splat, colour map, scatter, decals) plus a material variant and a collider. Without a manifest, that unit only exists in scene code.
- **Alternative considered:** a `*.mesh.json` with `matOverrides` plus custom-prop colliders spawned through `spawnImportedAsset`. It works today but has no single manifest and no generated-geometry path. Rejected for the reasons above.
- The engine spawner stays generic: generated geometry goes through a generator **registry** that the toolkit fills. The engine never imports toolkit code.
- **Opt-in (SBP):** the asset type, its spawner and the registry are a feature, `terrain()` (`src/_engine/features/terrain/`: `TerrainFeature.ts`, the entry `index.ts` as `aekasha/terrain` in `devTools/aliases.ts`, `TerrainBlockSchema.ts` next to it and on `aekasha/schemas`, its nested `CLAUDE.md`), listed in the template's `features` after `physics()`. Its `terrainBlocks` scene field is its `FeatureSchemaPart`, so a scene listing blocks names the feature in its manifest (`__features`) and a missing `terrain()` is the boot's error, not a silent no-op. The banner profile budgets the new feature group at 0 by itself (`FEATURE_GROUPS`, `devTools/sbp/CLAUDE.md`).
- **Its collider goes through `physics()`:** either `requires: ['physics']` and a direct import, as `character()` does (the one feature → feature runtime import today), or `isInstalled('physics')` and a kernel registry like the import extensions, so a block without a collider needs no physics. Decide in Phase 2; an imported block's custom-prop collider already spawns through `spawnImportedAsset`'s physics extension.

```json
{
  "$schema": "../../../../../../.schemas/terrainBlock.schema.json",
  "id": "showcaseCoast",
  "geometry": { "importedAsset": "showcaseCoast", "node": "TerrainBlock" },
  "material": "terrainCoast",
  "materialInputs": { "splatMap": "showcaseCoast_splat" },
  "grid": { "x": 0, "z": 0, "size": 64, "resolution": 129 },
  "collider": { "type": "HEIGHTFIELD", "friction": 1.2 },
  "shadows": { "cast": true, "receive": true },
  "scatter": ["showcaseCoast_rocks"],
  "decals": ["showcaseCoast_decals"]
}
```

- **Where a block's files live** (p301 §2): in its scene's folder (`src/app/scenes/<sceneId>/`, eg. `terrainShowcase/blocks/showcaseCoast/`, which the `$schema` path above assumes), or in a shared `src/app/terrainBlocks/` (a new entry in `layoutRules.ts`' `APP_ASSET_FOLDERS`) once a second scene uses the block. The world's terrain material JSON sits with it the same way.
- **Generated geometry:** `"geometry": { "generator": "noiseTerrain", "params": { "maxHeight": 6, "octaves": [[0.02, 1], [0.08, 0.3]] }, "seed": 11 }`. The generator is looked up in `registerTerrainGenerator(id, fn)`; the toolkit registers `noiseTerrain` and `rulesTerrain`. Seeds combine with `grid.x`/`grid.z` (p301 §7).
- **`materialInputs`** become a material variant (`getMaterialVariant(material, { inputs })`, `kernel/assets/Material.ts`; p302 D2 adds the `inputs` override). Blocks of one biome share a pipeline (p302 Phase 3 verifies).
- **`collider.type`:**
  - `HEIGHTFIELD` (default; from geometry, D3);
  - `TRIMESH` (overhangs, caves; costlier);
  - `NONE` (background blocks).
- **`scatter` / `decals`** are ids of p308/p309 assets, spawned with the block and owned by it.
- **Loading:** the scene schema gets `terrainBlocks: string[]` (the feature's schema part; asset preloading through a `beforeAssets` scene hook: geometry, textures through p302's dependency closure). **Spawning stays in scene code** (`await spawnTerrainBlock(id, opts?)`, re-checking the scene after each `await`) so this plan doesn't anticipate "physics objects in scene JSON" (a roadmap item). That plan can later make the scene load spawn listed blocks automatically.
- **`spawnTerrainBlock`** returns `{ meshEntityId, physicsEntityId?, scatterIds, decalIds, dispose() }`. Everything is deleted on scene exit like any non-persistent entity.

### D3 — Robust heightfield extraction (`features/physics/import/MeshColliderGeometry.ts`)

- **Index by position, not vertex order.**
  - After `mergeVertices`, compute the bbox and spacing (`dx = sizeX / (ncols − 1)`).
  - Bucket each vertex by `col = round((x − minX) / dx)`, `row = round((z − minZ) / dz)`.
  - Fill `heights` in Rapier's column-major layout with the same Z flip as today.
  - Validate that every cell got exactly one vertex. Otherwise error with the first offending cell ("not a regular grid: was a vertex moved in X/Z?").
- **Centre offset:** offset the collider by the bbox centre relative to the node origin (rigid body translation), instead of assuming a centred mesh. Warn when the offset is non-zero for a `terrainBlock` (the convention says centred).
- **One conversion, on `aekasha/physics`** (`docs/issues/heightfield-grid-layout.md`'s way out): a helper next to the shape params, `toHeightfieldColliderParams({ heights, rows, cols, width, depth })`, takes a **row-major** grid (the terrain's layout, what a generator or an image gives) and returns the `HEIGHTFIELD` params; the import's position-bucketed extraction above fills its row-major grid and calls it, so the layout lives in one place with a test, a non-square grid included. The mapping proposed by the p301 survey (`nrows = depthSegments`, `ncols = widthSegments`, transposed, `scale = {width, 1, depth}`) is **unverified**. Verify it with the Physics API controls tab's collider wireframes over a strongly asymmetric test terrain (a single spike near one corner), then pin it in the helper's test.
- **Docs:** `HeightFieldData.heights` and the shape param say the count ((`nrows` + 1) × (`ncols` + 1)), which axis the rows run along, the order and the centring, with a two-by-two example; `features/physics/CLAUDE.md`'s imported physics says the same. That closes the issue file (mark it `fixed`).
- **Fixes the former p990 item** "Heightfield importer mismatches" (p125), which moved here on 2026-10-02. Its full text is in the Context section above. Re-check the Gym terrains (`terrainSpiked`, `terrainSmooth`, `thirdPersonGymScene`) with the wireframes.

### D4 — `generateTerrain` v2 (toolkit, backwards compatible)

New optional fields on `TerrainOptions`:

| Option                                                                                     | Effect                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `center?: [x, z]`                                                                          | Noise is sampled at **world** coordinates `center + local`, so neighbouring blocks continue each other; `heightModifier` (already an option) gets the same world x, z. Default `[0, 0]` reproduces today's output exactly                   |
| `heightFn?: (x, z) => number`                                                              | Replaces the octave noise (custom shapes, heightmaps)                                                                                                                                                                                        |
| `normals?: 'GEOMETRY' \| 'HEIGHT_FN'`                                                      | `HEIGHT_FN`: central differences of the height function, including samples beyond the block edge. The result is seamless normals across blocks                                                                                               |
| `vertexColors?: { layout: 'RGB_AO' \| 'RGBA'; rules?: TerrainRule[]; ao?: HorizonAOOpts }` | CPU evaluation of p305's rules into `COLOR_0` (same `TerrainRule` type and math; one shared pure-TS implementation, `evaluateTerrainRulesCPU`, in `geometry/generate/TerrainRules.ts` with the type, so `terrain` imports both from `aekasha/toolkit/geometry` and never the reverse; unit-tested, and checked against the TSL output on the gallery's rules block; the type and its defaults are there since p305 Phase 4, whose As built has the shape: a range per test as `{ min?, max?, softness? }`, the noise a `macroNoise` channel, which the CPU side reads as texels). AO goes into A for `RGB_AO` |
| `ao?: { directions: 8; radius: number; strength: number }`                                 | Horizon-based AO on the height grid (max elevation angle per direction, averaged). Large-scale occlusion (valleys, under cliffs), the part a tiling layer can't carry                                                                        |
| `collider?: boolean`                                                                       | Also returns `heightfield: ColliderParams`, from D3's `toHeightfieldColliderParams` (`aekasha/physics`; a pure function, so the geometry chunk carries only it)                                                                             |
| `skirt?: number`                                                                           | Optional skirt depth (hides cracks between blocks of different resolution later; off by default)                                                                                                                                             |

- **Cost** on the main thread, to be measured in Phase 3: a 257² block with 3 octaves takes ~10–30 ms; horizon AO (8 directions × 16 steps) is ~50–150 ms.
- **Threaded option:** if a block exceeds 16 ms, Phase 4 moves generation off the main thread, returning transferable buffers. The assets worker can't be handed code and `import()`s only the engine's own job modules (`src/_engine/kernel/init/CLAUDE.md`), and the engine never imports the toolkit, so it's a module worker of the toolkit's own (`new Worker(new URL('./TerrainWorker.ts', import.meta.url), { type: 'module' })`, loaded on first use), unless the engine has gained a way to register an app or toolkit job by then. Rule closures (`heightFn`, `heightModifier`) can't cross into a worker, so worker generation supports the declarative options only.
- **Heightmap import (Phase 4, optional):** `terrainFromHeightmap({ url, format: 'R16' | 'R32F', size, heightRange })` for heightmaps from Gaea, World Machine or World Creator, as a Blender-less path.
  - Raw little-endian files, fetched as an `ArrayBuffer`.
  - 16-bit PNGs aren't used: browsers decode them to 8 bits through `ImageBitmap`.

### D5 — Blender add-on (`src/toolkit/terrain/blender/aekasha_terrain_tools.py`)

A single-file add-on (Blender ≥ 4.2; installable with _Edit → Preferences → Add-ons → Install from Disk_; check against the current LTS at implementation time). It adds an "Ækasha" sidebar tab with these operators:

| Operator                  | What it does                                                                                                                                                                                                                                         |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Add Terrain Block**     | Grid of `size` × `resolution` (exact vertex count), origin at centre, UV projected top-down with the engine's orientation, `Splat` colour attribute (vertex, byte, black), custom props pre-filled (D1), the "AEK Terrain Preview" material assigned |
| **Validate Block**        | Regular X/Z grid (no vertex moved off its column/row), vertex count, origin, applied transforms, no loose geometry, splat sums ≤ 1, and edge heights equal to any neighbouring block in the file                                                     |
| **Normalize Splat**       | Rescales RGB(A) so the sum is ≤ 1 (fixes over-painting)                                                                                                                                                                                              |
| **Bake AO → Splat Alpha** | Cycles AO bake into a temporary colour attribute (samples, distance), then copies R into `Splat`.A                                                                                                                                                   |
| **Bake Colour Map**       | Bakes the preview material's diffuse colour (and optionally AO) to an image (p305 D7, the Blender path)                                                                                                                                              |
| **Split Into Blocks**     | Cuts a large terrain into N × N blocks with shared edges; custom normals transferred from the unsplit mesh (Data Transfer: Face Corner Data → Custom Normals); grid props set. Prepares the future world plan; used now only for a 2 × 2 test        |
| **Export Block**          | Exports glTF with locked settings (below) to the block folder, saves the splat/colour images, and writes `<id>.importedAsset.json` and `<id>.terrainBlock.json` stubs if missing                                                                     |

**Locked export settings** (also documented for manual export):

- Format: glb.
- Include: Selected Objects, Custom Properties ✓.
- Transform: +Y Up ✓.
- Mesh: Apply Modifiers ✓, UVs ✓, Normals ✓, Tangents ✗, Vertex Colors: Active (Blender 4.2+ naming), Attributes ✓ (`_`-prefixed), Loose Edges/Points ✗.
- Materials: No export. Images: None.
- Compression ✗: p300 applies meshopt (the `terrainBlock` profile keeps it lossless, so neighbouring blocks' shared edge vertices stay exactly equal; colliders no longer need it, Phase 1's As built).
- Animation ✗.

**"AEK Terrain Preview" node group:** a Blender shader approximation of p305 (up to 5 layers, height blend via Math nodes, world-space tiling from the Object/Geometry position, colour-attribute weights). Artists see roughly the engine result while painting. It's documented as an approximation.

### D6 — Templates (`src/toolkit/terrain/blender/`)

| File                             | Content                                                                                                   | Doc                             |
| -------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `terrain_blockTemplate.blend`    | Empty 64 m / 129 block, preview material, custom props, export preset, a README text block                | `terrain-blocks-blender.md`     |
| `terrain_singleLayer.blend`      | A shaped block, single layer, world tiling                                                                | `terrain-single-layer.md`       |
| `terrain_vertexColorSplat.blend` | 5-layer painted vertex splat + baked vertex AO                                                            | `terrain-vertex-color-splat.md` |
| `terrain_splatMap.blend`         | 1K splat image painted in Texture Paint, 5 layers                                                         | `terrain-splat-map.md`          |
| `terrain_triplanarCliff.blend`   | Block with a steep cliff band (heightfield-safe: steep, not overhanging); trimesh variant for an overhang | `terrain-triplanar-cliffs.md`   |
| `terrain_colormapDetail.blend`   | Splat block + colour map bake set-up                                                                      | `terrain-colormap-detail.md`    |
| `structure_concrete.blend`       | Wall + bunker pieces, wear vertex colours                                                                 | `structure-materials.md`        |

- **Rules for all templates** (p301 §2):
  - compressed save;
  - no packed images;
  - relative image paths into the texture sets' `src/toolkit/textures/<setId>/source/raw/` (fetched by `yarn fetchTextureSources`);
  - a README text block mirroring the handbook page;
  - ~1–3 MB each.
- **Repo hygiene:** Blender's backups are already ignored (`.gitignore`'s `*.blend[0-9]`) and none is tracked; `terrain/blender/` gets its rule in `devTools/layout/layoutRules.ts` (the `.py` and `.blend` files aren't modules, so the PascalCase rule doesn't apply).

---

## Handbook content

**Merging (p370 §10, after p372):** a block's static props and cutout mesh decals can be merged per block and material with p372 groups (a group id per block, or `AUTO` with a cell size that divides the block size), so they never cross the block that owns them. `terrain-blocks-blender.md` mentions it under step 9 once p372 has landed. Terrain built from modules instead of a heightfield grid (cliffs with overhangs, caves, tile worlds) has its own page, `terrain-modular-kits.md` (p372).

### `docs/techniques/terrain-blocks-blender.md` (the common workflow every technique page links)

1. **Set-up:** Blender version; Units (Metric, scale 1.0, metres); clip end 1000 m; install the add-on; run `yarn fetchTextureSources` so templates find their images.
2. **Create a block:** with the add-on (size, resolution, grid position), or manually.
   - Manual: _Add → Mesh → Grid_, size 64, subdivisions until the Statistics overlay shows 16 641 vertices (129²). Name it, origin to the world origin, then apply rotation and scale.
3. **Shape it, heightfield-safe:**
   - **Displace modifier:** Texture Coordinates _Global_, so neighbouring blocks continue each other; Direction Z; Midlevel 0.
   - **Sculpting:** in the Symmetry popover, **lock X and Y**, so vertices only move vertically.
   - **A.N.T. Landscape** (extension): set its grid to the block resolution.
   - No overhangs on HEIGHTFIELD blocks; use TRIMESH (and say why) when you need one.
   - Apply the modifiers.
4. **UVs:** done by the add-on, or top view → _UV → Project from View (Bounds)_. Check orientation with the corner-marker image (top-left red, top-right green) against the gallery's orientation block.
5. **Paint** (per technique page): vertex colours or splat image, with the preview material.
6. **Bake AO** (optional): _Bake AO → Splat Alpha_. Why: valley-scale AO, applied to indirect light only in the engine, at zero cost.
7. **Custom props:** collider and block metadata (D1 table); copy from `src/_engine/kernel/assets/import/customPropTemplates.blend`.
8. **Validate, then Export Block** (or manual export with the locked settings).
9. **Into Ækasha:**
   - the files written, and what to fill in `terrainBlock.json`;
   - the scene: `terrainBlocks` list plus `await spawnTerrainBlock(id)`;
   - checking the collider with the Physics API controls tab's collider wireframes (debug drawer, `?isDebug=true`).
10. **Multi-block preparation:** shared edges, normal transfer, _Split Into Blocks_, grid coordinates. A preview of the future world workflow.
11. **Pitfalls:**
    - moved X/Z vertices (validator);
    - Blender's Y vs glTF −Z (UV orientation);
    - forgotten Apply Scale;
    - Draco on;
    - Float Color (doubles the size for no gain);
    - painting over 1 (normalize);
    - committing `.blend1` backups (ignored, but a renamed copy isn't).

### `docs/techniques/terrain-procedural-meshes.md`

- `generateTerrain` v2 options with examples: a single block, a 3 × 3 continuous patch (`center`), `HEIGHT_FN` normals.
- **Rules on the CPU (vertex colours) vs in the shader:**
  - CPU: zero per-pixel ALU, resolution = vertex spacing, can't change at runtime without regenerating.
  - Shader: per-pixel crisp, reacts to uniforms (e.g. snow line moving with p307's snow coverage), ALU cost.
  - Measured in the gallery.
- CPU horizon AO: why, cost, settings.
- Colliders for generated terrain (`collider: true`).
- Seeds and determinism: the world seed (`getRandomSeed` / `setRandomSeed`, `aekasha`) hashed with the grid coordinates, never a named stream (`getRandomStream` restarts per scene load and depends on draw order).
- Worker generation (if Phase 4 lands) and heightmap import.
- "Best for": procedural/sandbox/survival worlds, roguelites, prototypes, infinite runners. Poor fit: art-directed hero areas (use Blender or the splat combo).

### Completing p305's pages

Add sections 5–7 (Blender, Export, Import) to the seven p305 pages, each referencing its template and the common workflow, plus that technique's specific steps:

- **Vertex splat:** channel-by-channel painting with pure-colour brushes; why Mix blending keeps sums ≤ 1.
- **Splat map:** image size per block size, Non-Color, painting single channels, saving 8-bit PNG; orientation check.
- **Triplanar cliffs:** cliff bands under heightfield rules; when to switch to TRIMESH; no UV care needed for cliffs (world triplanar).
- **Colour map + detail:** _Bake Colour Map_, image size (2K per 64–128 m), what not to bake (direct sun with day-night).
- **Structures:** UV-free triplanar, wear painted as vertex colours, scale and origin rules for object-space mode.

---

## Phases

### Phase 1 — Heightfield extraction (D3) — done

1. `toHeightfieldColliderParams` on `aekasha/physics` with its test (the asymmetric-spike check, a non-square grid), then the import on it: position-bucketed extraction, centre offset, regular-grid validation; the `HeightFieldData` docs and `features/physics/CLAUDE.md` (D3).
2. Re-check the Gym terrains (the former p990 item); mark `docs/issues/heightfield-grid-layout.md` `fixed`.
3. `yarn test`, and `yarn verify:scenes` for the scenes with heightfields (`thirdPersonGymScene`): a collider that moves changes the probe's hash, so update its baseline in the same commit and say why.

**Exit:** collider wireframe coincides with the mesh (≤ 1 mm) on the Gym terrains and on a generated asymmetric terrain.

**As built:**

- **The layout, verified** against Rapier 0.19.3 by raycasts (`HeightfieldColliderParams.test.ts`): `heights[row + col·(nrows+1)]`, `nrows` cells along +z and `ncols` along +x, both from −scale / 2, no flip. The survey's mapping holds. Each cell is split along the diagonal (row + 1, col)–(row, col + 1), the same as `generateTerrain`'s b–c diagonal, so a generated terrain's collider can match its mesh between vertices too (Phase 3's `collider: true` keeps that diagonal). rapier.js can't choose the diagonal per cell.
- **`toHeightfieldColliderParams({ heights, rows, cols, width, depth })`**: `rows` / `cols` count heights (vertices), not cells; returns `HeightFieldData & { type: 'HEIGHTFIELD' }` with `scale.y` 1 (heights already in the body's units). Throws on a grid that doesn't fit.
- **The import** (`import/HeightfieldFromGeometry.ts`): buckets the raw positions (node space × scale, not rotated: the body carries the rotation), **without `mergeVertices`** (unlike D3): duplicates on one grid point (seams, flat shading) pass when their heights agree within 1 mm. A count not given as `nCols` / `nRows` is counted from the distinct x / z, so non-square grids work without custom props. `nCols` counts the cells along x, `nRows` along z (the old loop had `nRows` along x). Grid tolerance: 1 % of the spacing. The centre offset is the collider's `translation` (`ImportPhysics.ts` composes it with a non-anchor member's node offset); the terrain-block warning keys on the `aekBlockSize` custom prop. A warning counts the cells the mesh splits along the other diagonal, with the worst gap.
- **The refusals are lifted** (Draco, quantized positions): read by position and through the getters, both work. Measured on p300's `terrainSmooth` copies: the Draco and meshopt colliders are within 3–4 mm of the source surface (their height quantization); the visible quantized mesh sits up to 1.6 cm from the collider on slopes (its x / z jitter at 14 bits over 100 m).
- **The asset pipeline** no longer keeps collider sources lossless: `COLLIDER_LEVEL` is `{ mesh: { simplify: null } }` (never simplified, quantized like any mesh). The one collider source, `testDebugScene`'s `p371MergeKit`, re-encoded (9.8 KB). The `terrainBlock` profile stays lossless, for the shared edges.
- **The Gym terrains:** `terrainSmooth` was off by up to 0.216 m near its z = 49 edge (the p990 bug: the vertex-order read); `terrainSpiked`'s bounds sit 0.03 / 0.52 m off its origin. `terrainSpiked.glb` split 899 of its 10 000 cells along the other diagonal: re-triangulated onto the collider's (the index only; its normals are Blender's quad normals, independent of the split). Both now match their `TRIMESH` within 0.2 mm over 400 × 400 raycasts. The Gym loads without a HEIGHTFIELD error or warning.
- **Step 3, `yarn verify:scenes`** (`thirdPersonGymScene`, `testDebugScene`, `assetCompare`, against baselines recorded on `main` at `4b039343`): the Gym's probe hash and character paths are **unchanged** (the probe hashes dynamic bodies only, and the input script's characters never reach the terrains), so no baseline moved. `testDebugScene` broke on the quantized `p371MergeKit`: quantization moves a mesh's dequantization into its node (a new unnamed child for a node with children), which its scene's meshes, made from the geometries' ids, never get. Not a collider matter: the kit opts out (`"optimize": { "mesh": { "quantize": false } }`, back to `main`'s output) and the gap is `docs/issues/quantized-glb-geometry-by-id.md`, with a line in `asset-optimization.md`. `yarn verify:baselines` recorded the new `aekasha/physics` names and the lazy `ImportPhysics` chunk's +0.8 kB gzip (the bucketing, its messages and the diagonal check; `BufferGeometryUtils` −0.3 kB).

### Phase 2 — Terrain block asset (D2) — done

1. The `terrain()` feature (D2): its folder, `TerrainFeature.ts`, the `aekasha/terrain` entry and alias, a layout rule, listed in the template's `features` (`src/index.ts`) after `physics()`.
2. Schema (next to the feature, on `aekasha/schemas`), the `*.terrainBlock.json` suffix (`GATHERED_SUFFIXES`), the generated section, the scene's `terrainBlocks` as its `FeatureSchemaPart`.
3. Generator registry, `spawnTerrainBlock` (imported and generated geometry, material variant inputs, collider, shadows), every API with JSDoc and an `@example`.
4. p308/p309 hooks stay empty until those plans.
5. `yarn sbp`: no terrain code in the app's first download or in the banner (its feature group at 0).

**Exit:** a JSON-only block (imported Gym terrain re-used as a test) and a generated block spawn, collide and are released on scene exit.

**As built** (the feature's notes: `src/_engine/features/terrain/CLAUDE.md`):

- **The collider (D2's open decision):** no `requires`. The install records `ctx.isInstalled('physics')`, and the collider code (`TerrainCollider.ts`: `createPhysicsEntity`, `deriveColliderFromGeometry`) is `import()`ed with the first block that has one, so a physics-free app (a landscape embed) loads no Rapier for its blocks. The gather adds `physics` to the manifest (`__features`) of a scene listing a block with a collider, so a missing `physics()` is the boot's error; `spawnTerrainBlock` throws naming it as a backstop. The second feature → feature runtime import after character → physics (lazy). The collider is a `FIXED` body on the mesh entity: `physicsEntityId` is the mesh entity's id, and `dispose()` or the scene's exit removes both.
- **Code moved since the plan:** `terrain()` is the fourteenth feature (Phase 6's "tenth" is stale), listed last in the template (after `textureSets()`, so no install order moved); no layout rule was needed (`features/` is one rule); the banner's 0 budget is automatic (`FEATURE_GROUPS` reads the folders). The app's `_engine/features/terrain` group is budgeted at 1 KiB (`sbp.config.ts`): only `TerrainFeature.ts`, 0.1 KiB gzip, is in the first download.
- **Preloading through the gather, not a `beforeAssets` hook:** the scene pass (`devTools/gather/terrainBlocks.ts`, before the materials) writes each listed block inline and appends its import and material to the scene's `importedAssets` and `materials`; the texture closure reads its `materialInputs` like a mesh's `matOverrides`. The scene load then loads them like listed assets (a streaming scene keeps them in its base). Pass 1 fails on an unknown import or material id.
- **The schema** (`TerrainBlockSchema.ts`): `materialInputs` reuses the material inputs' schema; the block conventions (32-256 m, `2^n + 1`) aren't enforced (the Gym terrain test block is 100 m / 101; Phase 5's validator checks them); no `__saveData`; `scatter` / `decals` aren't fields until p308 / p309 (the strict schema refuses them; the result's `scatterIds` / `decalIds` are empty). The runtime reads a block from the spawning scene's data only (no development-data section).
- **The spawn:** an imported block uses its node's registered geometry (`node` optional: the import's only mesh), placed by its grid; a node transform is ignored with a warning, and quantized positions (whose dequantization is the node's) are refused naming the fix, the `terrainBlock` asset profile (`"optimize": { "profile": "terrainBlock" }` in the importedAsset JSON). The GLB's own custom-prop colliders are the plain import path's: a block's JSON decides its collider. A spawn whose scene is left across an `await` (a counter the install's `exit` hook bumps) deletes what it made and resolves with `null`.
- **The exit check, `terrainBlockTest`** (`src/app/scenes/terrainBlockTest/`, a debug scene): three 100 m blocks, the Gym's `terrainSmooth.glb` node (`HEIGHTFIELD` read from the geometry, grass through `materialInputs`), a generated one with the generator's heightfield (`toHeightfieldColliderParams`) and a generated `TRIMESH` one (rocks, no shadow), over the scene's own generator wrapping today's `generateTerrain` (Phase 3's `noiseTerrain` replaces it). 27 boxes fall on them; at step 340 the scene logs an error for a box not resting on its block (fell through, caught on nothing, slid off: the Gym terrain's slopes sent one off the edge at 25 m spacing, so they drop on a 15 m grid from 35 m, the closest 6.4 m from an edge). `yarn verify:scenes --only terrainBlockTest` (`probeSteps: 360`): no errors, one probe hash in all three targets, its baseline recorded. A switch to another scene leaves no block mesh, generated geometry or import geometry (checked once from a script).

### Phase 3 — `generateTerrain` v2 (D4) — done

1. Options, CPU rules, horizon AO, collider params.
2. `noiseTerrain` and `rulesTerrain` generators, registered by a toolkit `registerTerrainGenerators()` that the app calls from an install (`appECSPlugins`, `src/AppECSPlugins.ts`), never at module load (`moduleSideEffects.test.ts`).
3. Gallery isolated blocks become `terrainBlock` JSONs with generated geometry.
4. `src/app/scenes/largeWorld/largeWorld.ts`'s terrain stays identical with the default options (the `Terrain.test.ts` and `ScatterOnSurface.test.ts` hashes and its scene baseline unchanged); optionally give it a collider in a separate commit.

**Exit:** a 3 × 3 generated patch has no visible seams in geometry or lighting, and CPU-rule colours match the shader rules on the same block.

**As built:**

- **`generateTerrain` v2** (`geometry/generate/Terrain.ts`, `TerrainAo.ts`): the heights are sampled once on a grid with a border past the block's edge where `HEIGHT_FN` normals (1 cell) or the AO (its march) look past it, from the same height function (noise or `heightFn`, then `heightModifier`, both at world x, z), so neighbouring blocks agree on their shared edge's heights, normals, AO and colours. The defaults build the same geometry as before: largeWorld's geometry hash and a small grid's with a modifier are pinned in `Terrain.test.ts` (recorded on `d5469387`).
  - Changed from D4's table: **`ao` is a top-level option only** (`{ radius, strength?, steps? }`, no `directions`: always 8), returned as the result's `ao` and written into `RGB_AO`'s A (1 without it); `vertexColors` is `{ layout, rules?, noise? }`. **The AO is HBAO** (the horizon above each direction's own tangent, `sin(h) − sin(t)`): measured above the horizontal it darkened every plain slope (13 % on a 17° plane). **`maxHeight` is optional** (required without `heightFn`). **`getHeightAt` takes the mesh's own (x, z)** (the world's less `center`). The colours are normalized `Uint8` (D1's Byte Color). The result also returns `center`.
- **CPU rules** (`TerrainRules.ts`): `evaluateTerrainRulesCPU` and `getTerrainRuleCoverageCPU`, `Rules.ts`' math line by line; the noise reads `TerrainRuleNoiseTexels` (RGBA8, row 0 at v = 0) bilinear and repeating at `(x, −z) / scale`, at full resolution (the GPU's mips blur it in the distance).
- **Noise texels: `readTextureTexelsAsync(textureOrId, { size? })`** (`terrain/textures/ReadTexels.ts`, on `aekasha/toolkit/terrain`): a bake draws the texture into an RGBA8 target, read back (WebGL2's rows flipped), so the KTX2 `macroNoise` works; kept per texture and size.
- **The generators** (`terrain/blocks/`, a layout rule): `registerTerrainGenerators()` (`RegisterTerrainGenerators.ts`, called from `appECSPlugins`, so the Hub's `ecs-register-plugin` region shows it) registers `noiseTerrain` and `rulesTerrain`, whose code (`TerrainBlockGenerators.ts`) is `import()`ed with the first block using one. Params are checked by hand, each error naming the generator, the block and the param; a rule through `checkTerrainRule` (`TerrainDefine.ts`, `@internal`), so a block and the material refuse the same rules. Both always return the heightfield (a transpose; a `TRIMESH` block ignores it). `noiseTerrain`: `maxHeight` (8), `octaves` (`[frequency, amplitude]` pairs), `normals` (`HEIGHT_FN` default), `skirt`; `rulesTerrain` adds `rules`, `layout` (`RGB_AO`), `ao`, `noiseTexture` (`macroNoise`, read only when a rule has noise). **Seeds:** the block's seed as it is, sampled at its world place (`grid × size`), so blocks of one seed continue each other (p301 §7: block noise in world space); a block's own randomness (p308's scatter) mixes the seed with the grid. `TerrainGenerators.ts`' and the feature's `CLAUDE.md` say so. The schema's `seed` description still says "combines with the grid coordinates": Phase 6's docs pass.
- **`terrainBlockTest`** uses `noiseTerrain` (its own generator went): new hills (world-continuous), probe hash `4248205c` → `87e986cc` in all three targets, every box resting on its block.
- **Step 3 changed: the library stays in code.** Its 12 m blocks sit on a 16 m pitch at x = −24, −8, 8, 24, which no integer `grid × size` reaches, and its gaps are the gallery's design. In their place, **the Blocks patch** (`terrainGallery/patchRow.ts`): 3 × 3 `rulesTerrain` blocks of 32 m / 65 (`patch/*.terrainBlock.json`, grid x −1..1, z −6..−4) behind the Anti-tiling row, past the ground's back edge (a block stands at y = 0 and its valleys go under the ground's top); one seed, 10 m noise, rocks by slope, snow by height and north facing, cliffs on steep faces, 8 m AO; the load logs an error if the nine files' geometry ever differ. Its material is the app's `terrainGalleryPatch.material.json` (`VERTEX_COLOR`, `RGB_AO`, vertex AO; two-line TSL file). **The A/B is in place**: the tab's Blocks patch section switches the same meshes between the patch material and its `RULES` variant built from the blocks' own JSON rules (one source; the `macro` input), with the vertex AO switch and two camera poses; the gallery's debug view reaches it. A block's meshes swapping to a variant released the JSON material (refs count meshes): the row holds one with `incMaterialRef` for the visit.
- **The exit, on the real GPU** (Windows Chrome, AMD RDNA 3): no seam between the nine blocks in the lit or the Normals view; the CPU and shader rules lay the same layers in the same places, the Weights view's borders the same but a little softer on the CPU (0.5 m between vertices). On WSL2's SwiftShader WebGL2 the gallery doesn't load (a shader fails to link, the context is lost); not checked whether it did before this branch.
- **Main-thread cost** (Node 22, 257² block, 3 octaves, median of 9): the defaults 29 ms, `HEIGHT_FN` normals 22 ms, + 3 rules with noise 29 ms, + AO (16 m, 16 steps) 32 ms, everything 85 ms. Every configuration is over 16 ms, so Phase 4's worker is warranted by its own rule.
- **largeWorld:** unchanged with the defaults: its geometry hash in `Terrain.test.ts`, the `ScatterOnSurface.test.ts` hashes, and `yarn verify:scenes --only largeWorld` against a baseline recorded on `main` (`4b039343`) all pass. The optional collider wasn't added.
- **The build** (`yarn verify:baselines`, recorded): the first download +0.3 kB gzip (the registration and the engine's generator registry it calls), the generators a lazy 2.9 kB chunk, `generateTerrain`'s chunk +2.5 kB, `bakeTexture` a shared 2.9 kB chunk (the readback uses it; the texture set bakes' chunk −2.7 kB). The app's initial reached 400.04 KiB: `sbp.config.ts`' budget 400 → 401 KiB, with the reason in its history.

### Phase 4 (optional) — Worker generation, heightmap import (D4)

**Exit:** a 257² block with AO generates without a frame over 16 ms.

### Phase 5 — Blender add-on (D5)

**Exit:** _Add → paint → bake AO → Validate → Export_ produces a block that spawns correctly, with the splat orientation matching the gallery's orientation block.

### Phase 6 — Templates, handbook, Hub, versioning

1. The 7 templates (D6).
2. The two new pages, plus sections 5–7 of p305's pages.
3. **Hub** (`hub/CLAUDE.md`): the terrain feature page (`hub/pages/features/terrain/`) gets terrain blocks, `spawnTerrainBlock` and generated terrain (`api:` links, `aek:covers` for the terrain feature's `CLAUDE.md` sections); the toolkit feature page's `generateTerrain` lines (`features/toolkit/guide.md`: the new options and the collider helper in place of its "give the body a `TRIMESH`" workaround and its link to the open issue); the physics guide's heightfield lines (`features/physics/guide.md`). Then `yarn hub:build`.
4. **Repo docs:**
   - `readme.md` Features: terrain blocks (engine) and procedural terrain v2 (toolkit); a new asset JSON type (`*.terrainBlock.json`); commands if any.
   - The root `CLAUDE.md`: the tenth feature in Bootstrap flow and Three-folder split, the map line for `src/_engine/features/terrain/CLAUDE.md`; `devTools/gather/CLAUDE.md`'s suffix list.
5. Versions: engine minor, toolkit minor, app minor; `CHANGELOG.md`.

---

## Risks

| Risk                                                                  | Mitigation                                                                                                                                           |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Blender exporter option names change between versions                 | The add-on owns export (one place to fix); the docs name the Blender version they were checked with                                                  |
| A vertex-colour export option exports the wrong attribute             | The add-on sets the active colour attribute before export; the validator checks for `COLOR_0` in the written GLB (gltf-transform inspect in Phase 5) |
| Heightfield extraction rejects real-world sculpted meshes (X/Z drift) | Clear error naming the cell; the add-on's validator catches it in Blender first; TRIMESH as an explicit opt-out                                      |
| CPU rules drift from TSL rules                                        | One shared spec; a gallery A/B block                                                                                                                 |
| Generated blocks hitch the main thread                                | Measured; worker path (Phase 4)                                                                                                                      |
