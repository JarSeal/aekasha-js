Status: draft | not-implemented
Category: Terrain, Rendering, Assets
Blocked by: p306_terrain-blocks-and-procedural-terrain-meshes.md
Blocks: p310_terrain-preview-scenes.md
Epic: p301_terrain-texturing-epic.md
Related: \_DONE_p370_static-mesh-merging-and-texture-atlas-systems.md (merging item types per cell, §3 decision table), \_DONE_p350_lod-system-research.md (instancing/batching layer, LOD selection), \_DONE_p348_ecs-lod-selection.md (§4.3 defines the LOD contract for this plan's cells, built in its Phase 4: a cell is an `InstancedMesh` entity with `LOD`, measured by its bounds over all its instances, and `cullScreenSize` replaces `maxDistance`), \_DONE_p346_spatial-domains.md (shared cell keys), p307_wet-and-dry-surface-states.md (scatter gets wet too), \_DONE_p354_gpu-driven-culling.md (instance sets: GPU culled and LOD-selected instances with no entity each, the large static case; whether `createStaticInstances` creates one for its large cases is this plan's decision, p354 §5)

# Terrain Scatter (rocks, pebbles, ground details)

GPU-instanced detail on terrain blocks: pebbles, rocks, boulders and leaf-litter cards. Grass blades are out of scope (p301).

Instances come from two sources:

- **Blender**: Geometry Nodes, exported as GPU instances (`EXT_mesh_gpu_instancing`), which the importer doesn't handle yet.
- **The engine**: mask-driven procedural scatter from the block's splat weights and rules, seeded per block.

Static scatter renders as **cell-chunked instanced meshes without per-instance entities**. Scatter assets are owned by their terrain block (p306), so they stream with it later.

---

## Context (grounded)

- **`toolkit/geometry/scatter/ScatterOnSurface.ts`** (`aekasha/toolkit/geometry`):
  - `scatterOnSurface({ surface: Mesh, count, seed?, minSpacing?, maxAttemptsPerPoint?, scaleRange?, alignToNormal?, randomYRotation? })` → `ScatterPlacement[]` (`{ position, normal, quaternion, scale }`). Area-weighted `MeshSurfaceSampler`, seeded; it may return fewer than `count` under `minSpacing`.
  - `minSpacing` is rejection sampling (up to `maxAttemptsPerPoint`, default 30, per point) against a grid hash of the accepted positions (p620 T11; the placements for a seed are pinned by `ScatterOnSurface.test.ts`). Each placement is an object with its own vectors and quaternion.
  - `bakeScatterToInstancedMesh(mesh, placements, startIndex)` bakes what fits after `startIndex` (a warning for the rest), sets `mesh.count` and undoes the mesh's world matrix; `spawnScatterAsMeshEntities` makes one entity per placement.
- **`features/instancing/InstancedMeshPool.ts`** (the `instancing()` feature, `aekasha/instancing`; `src/_engine/features/instancing/CLAUDE.md`):
  - `createInstancedMeshPool` / `createInstancedLodPool`: every instance is an ECS entity with a `Transform` and `INSTANCED_MESH_SLOT`.
  - `instancedMeshPoolSyncSystem` re-bakes changed instances at `APP_RENDER_SYNC`.
  - The pool mesh must be added to the scene by the caller.
  - Right for dynamic instances (largeWorld's trees); wasteful for 10 000 static pebbles.
- **No public static cell** (`docs/issues/no-public-instanced-mesh-entity.md`, p620 N2): nothing public makes one entity of an `InstancedMesh` with static instances. `src/app/scenes/lodShowcase/lanes/instanceCell.ts` builds it by hand in five steps that must match `createMeshEntity` (the `InstancedMesh` and its matrices; `incGeometryRef` / `incMaterialRef`; the entity and `mesh.userData.entityId`; `OBJECT3D`, which tags it `TAG_IS_MESH`; the root scene). A step left out fails quietly. D1 is the way out the issue names.
- **`src/app/scenes/largeWorld/largeWorld.ts`** scatters trees and bushes off its terrain into instanced LOD pools (`createInstancedLodPool`, cross-quad impostors at the far end), the trees in a `FOLIAGE` spatial domain (`registerSpatialDomain`, `aekasha/spatial`).
- **Import** (`src/_engine/kernel/assets/import/`):
  - `EXT_mesh_gpu_instancing` is **not handled**, and extraction only walks `isMesh` nodes (`GLTFExtract.ts`). three's `GLTFLoader` turns that extension into `InstancedMesh`; we'd register its geometry and lose the instance matrices.
  - `GeometryTransfer.ts` serializes geometry attributes generically, but has no instance-matrix path.
  - The kernel spawns what a feature owns through an import extension (`ImportExtensions.ts`, `FeatureContext.registerImportExtension`: physics' bodies, LOD's chains), one provider per member.
- **Rocks:** `toolkit/geometry/generate/Asteroid.ts`' `generateAsteroid` builds seeded displaced icospheres: faceted (non-indexed) by default, indexed with smooth normals on request, with `hullVertices` / `hullVolume` for a `CONVEXHULL` collider. A base for procedural rocks.
- **Ray casts against meshes:** the engine's `castRayFrom*` (`kernel/render/Raycast.ts`) are `@internal` and on no entry (`docs/issues/three-ray-casting-not-public.md`), so toolkit code casts with three's own `Raycaster`, or reads heights from a grid.
- **p350:** LOD should be an ECS selection feeding the instancing/batching layer, not `THREE.LOD`. This plan's cell chunks are designed to be that layer's static case.

---

## Design

### D1 — Static instance chunks (engine: `features/instancing/StaticInstances.ts`, on `aekasha/instancing`)

- **`createStaticInstances({ id, geometry, material, placements | matrices, cellSize = 16, castShadow, receiveShadow, instanceColors?, lod? })`** splits instances into a grid of cells.
  - Each cell is one `InstancedMesh` with its own `boundingSphere` (computed from its instances), so three's per-object frustum culling skips whole cells.
  - Each cell is an entity with `OBJECT3D` + `TAG_IS_MESH`, and disposal follows the normal mesh path. A block's cells are owned by the block (p306's `spawnTerrainBlock` handle).
  - It's built on a public `createInstancedMeshEntity` next to the pools (the issue's way out): the five steps of `createMeshEntity`'s path for an `InstancedMesh` (refs, the entity and `userData.entityId`, `OBJECT3D`, the root scene, `castShadow` and the rest) in one call. `lodShowcase`'s `instanceCell` lane moves onto it, and the issue file is marked `fixed`.
  - A cell is placed through its `Transform` (an `InstancedMesh` entity's `Transform` is synced onto the mesh every frame, `src/_engine/features/lod/CLAUDE.md`), not `mesh.position`.
- **`lod`** (a `LodDef`, `_DONE_p348` §4.3; `src/_engine/features/lod/CLAUDE.md`'s `InstancedMesh` entity) is set on every cell with `setMeshLod`: the cell switches levels as a whole and hides below `cullScreenSize`, with hysteresis, by its screen size. Both cross-fade instead of popping (`_DONE_p351` Phase 2's plain-mesh fade, which covers an `InstancedMesh` cell as a whole; its copy builds its own shaders, 11-14 ms at a fade's start, so measure a scatter of many cells fading at once): `lod.fadeSeconds`, default 0.25 s from `AppConfig.lod.fadeSeconds`, 0 = an instant switch. Cell materials get `enableLodDither`. This replaces the draft's `maxDistance`; a scatter without levels uses one level and `cullScreenSize`. The contract (`_DONE_p348` Phase 4, built): the cell mesh gets `userData.entityId` (it holds refs), its matrices are written before `setMeshLod`, and `refreshLodBounds` follows any later change. Don't opt cells into ECS frustum culling or spatial indexing: those read one instance's geometry at the mesh's origin (`_DONE_p348` Phase 4 As built).
- **No per-instance entities, no per-frame sync.** Matrices are uploaded once.
- **`instanceColors`** (tint variation) use `InstancedMesh.instanceColor`.
- **Ownership:** registered geometries and materials are ref counted like other meshes (`createMeshEntity` path), so a shared rock material is released when the last cell goes.

### D2 — `*.scatter.json` (engine asset type, in `instancing()`)

```json
{
  "id": "showcaseCoast_rocks",
  "items": [
    { "geometry": "rockSmall_a", "material": "rockWet_rocks01", "weight": 3 },
    { "geometry": "rockSmall_b", "material": "rockWet_rocks01", "weight": 2 },
    {
      "geometry": "boulder_a",
      "material": "rockWet_cliffs01",
      "weight": 0.2,
      "collider": "CONVEXHULL",
      "castShadow": true
    }
  ],
  "source": {
    "type": "PROCEDURAL",
    "generator": "terrainScatter",
    "params": {
      "density": 0.6,
      "minSpacing": 0.4,
      "mask": { "layers": { "rocks01": 1, "sand01": 0.1 }, "slope": [0, 35] },
      "scale": [0.6, 1.4],
      "alignToNormal": 0.7,
      "sink": 0.15,
      "tint": 0.08
    },
    "seed": 3
  },
  "cellSize": 16,
  "lod": { "levels": [{ "screenSize": 0 }], "cullScreenSize": 0.01 }
}
```

- **Where:** the schema (`features/instancing/ScatterSchema.ts`, on `aekasha/schemas`), the suffix (`GATHERED_SUFFIXES`), the generator registry and `spawnScatter` sit with the static instances in `instancing()`, so a scatter works without terrain. `spawnTerrainBlock` reaches it the way p306 D2 decides for the terrain feature's dependencies (`requires: ['instancing']` and a direct import, or a kernel registry).
- **`source.type`:**
  - `PROCEDURAL`: a generator from `registerScatterGenerator(id, fn)`; the toolkit registers `terrainScatter` from an install the app calls (never at module load).
  - `IMPORTED`: `{ "importedAsset": "showcaseCoast_scatter", "nodes": ["Rocks*"] }`, the Blender GPU instances (D3).
  - `PLACEMENTS`: inline or file list, for hand placement or tools.
- **Items:** an item picks a geometry and material and may have a collider (`CONVEXHULL` / `BALL` / `NONE`).
  - Collider items become FIXED physics entities, one per instance, through `physics()` (the same dependency question as above; without it, a warning and no colliders). Use them only for large pieces; the gatherer warns above 200 colliders per block.
- **Ownership and seeding:** spawned by `spawnTerrainBlock` (p306's `scatter` ids) or on their own (`spawnScatter(id, { target })`, re-checking the scene after each `await`). The seed is combined with the block's grid coordinates (p301 §7).

### D3 — Blender GPU instances import (engine: `kernel/assets/import/*`)

- **Extraction:** for nodes that three turned into `InstancedMesh` (`EXT_mesh_gpu_instancing`), store `instanceMatrices: Float32Array` (and `instanceColors` if present) in the manifest per node. Transfer them through the asset worker as transferable buffers (`GeometryTransfer.ts` gets an instance path).
- **Spawn:** `spawnImportedAsset` and the `IMPORTED` scatter source spawn such nodes through `createStaticInstances` (D1), with the node's custom props for item settings (`aekScatterCollider`, `aekCastShadow`). The kernel imports no feature code, so `instancing()` registers a new import extension member (`spawnInstances`, next to physics' `spawnPhysics`); without `instancing()` such a node warns once and spawns its geometry as one plain mesh.
- **Fallback when an exporter version mangles GPU instances:** a **point-cloud** mesh.
  - The points' positions are the instance positions.
  - Custom attributes `_ROT` (quaternion as vec4) and `_SCALE` (vec3) carry the rest, and `_ITEM` (int) picks the item.
  - The importer turns any node with custom prop `aekScatterPoints: 1` into placements.
  - It's documented as the robust path. Geometry Nodes writes those attributes with _Store Named Attribute_.

### D4 — Procedural scatter v2 (toolkit: `src/toolkit/terrain/scatter/TerrainScatter.ts`, on `aekasha/toolkit/terrain`)

- **Poisson-disk sampling** (Bridson, grid-accelerated, O(n)) over the block's XZ area: an even coverage of a regular grid, where `scatterOnSurface`'s area-weighted rejection (grid-hashed since p620) samples triangles. `scatterOnSurface` stays as is for arbitrary meshes. Placements go into typed arrays, not an object per point.
- **Density mask** per candidate point, all CPU-readable:
  - **layer weights** from the block's vertex colours (bilinear on the grid) or from CPU rules (p306's `evaluateTerrainRulesCPU`, `aekasha/toolkit/geometry`);
  - a splat map only if its source is CPU-readable: an uncompressed PNG kept with `codec: none` and a CPU copy. KTX2 can't be read back (p300);
  - slope and height ranges;
  - `macroNoise`-equivalent CPU noise for clustering. The same periodic noise as p304 isn't available on the CPU, so a seeded simplex is used instead, documented as such.
- **Placement:**
  - height from `getHeightAt` (generated) or, for an imported block, the grid heights its heightfield extraction reads (p306 D3), a downward three.js `Raycaster` against the block mesh only for a block that isn't a regular grid (the engine's casts are on no entry, see Context);
  - normal from the height grid;
  - yaw random; tilt = slerp(up, normal, `alignToNormal`); `sink` buries a fraction of the bounding height; scale range; per-instance tint.
- **Determinism:** seed = hash(the world seed, `getRandomSeed()` from `aekasha`, `gridX`, `gridZ`, scatter id), never a named stream (those restart per load and depend on draw order). Scatter on a block never depends on load order.
- **Cost:** 5–20k candidates per 64 m block runs in a few ms. Measure it; the worker path is the same as p306 Phase 4 (a toolkit module worker) if it's needed.

### D5 — Scatter assets

- **Procedural rocks** (toolkit `generateRock`, `geometry/generate/Rock.ts` on `aekasha/toolkit/geometry`, wrapping `generateAsteroid` in its indexed, smooth mode):
  - flattening and squash options, seeded variants;
  - indexed with smooth normals;
  - budgets: pebble ≤ 80 tris, rock ≤ 400, boulder ≤ 1500.
  - Registered geometries `rockPebble_a..c`, `rockSmall_a..c`, `boulder_a..b`; a boulder's collider is its `hullVertices` as a `CONVEXHULL`.
- **Rock material** (toolkit `src/toolkit/materials/rockScatter/`: `rockScatter.tsl.ts` with its `rockScatter.material.json`, a `setup` material over the terrain category's nodes through `aekasha/toolkit/terrain`):
  - triplanar in object space, sampling **the same texture set as the terrain layer it sits on** (`rocks01`, `cliffs01`, …), so rocks match the ground and cost **no extra texture memory**;
  - dual-scale anti-tiling;
  - macro tint by world position, so neighbouring rocks differ;
  - `applySurfaceWetness` (p307), so rocks get wet with the ground;
  - a slight top-down "dust/moss" blend toward the ground layer's average colour (`averageColor`) to seat rocks into the terrain.
- **Imported rocks** (optional realism set, Poly Haven, CC0):
  - candidates verified to exist (2026-10-02): `rock_moss_set_01`, `namaqualand_stones_01`, `sand_rocks_small_01`, `boulder_01`;
  - download the **glTF at 1K** textures;
  - decimate in Blender to the budgets above (Decimate modifier, Collapse, then check silhouettes);
  - export geometry with its own 1K texture set (p300 `prop` profile);
  - stored in the toolkit's model catalogue, `src/toolkit/models/nature/<id>/` (the GLB next to its `<id>.importedAsset.json`, the category p450 plans; a layout rule per category in `layoutRules.ts`), with `source.json` records like p303.
- **Leaf litter cards:**
  - ambientCG `LeafSet024` (an Atlas asset with colour, normal, roughness and opacity; download 1K-PNG);
  - small flat quads with random atlas cells, alpha-tested (`alphaTest` + `alphaToCoverage` when MSAA is on); the card atlas is a `*.textureAtlas.json` (p299 D3) in `src/toolkit/textures/leafLitter/` whose albedo slot keeps its coverage down the mips (`optimize.alphaCoverage`, `_DONE_p341`), so distant cards don't thin out;
  - for `grass02` and `mud02`; no shadows.
- **Shadows:** pebbles and cards don't cast; rocks and boulders do. Shadow-casting cells double their draw calls in the shadow pass.

---

## Handbook content (`docs/techniques/terrain-scatter.md`)

1. **What it is:** instanced detail, why instancing, cells, and why it isn't one entity per pebble.
2. **"Best for":**
   - **Always useful.** Scatter does more to break up terrain repetition than any texture trick.
   - First- and third-person: dense pebbles and rocks near the camera, culled per cell by `lod.cullScreenSize`.
   - Top-down/RTS: fewer and bigger rocks, often with colliders for pathing.
   - Stylized: low-poly procedural rocks with flat-shaded variants.
   - **Poor fit:** huge counts of unique hero meshes; use regular meshes for those.
3. **Performance:**
   - draw calls = mesh types × visible cells (+ the shadow pass);
   - vertex cost = instances × triangles;
   - card overdraw;
   - colliders (count limits);
   - measured gallery numbers;
   - the `cellSize` / `cullScreenSize` trade-off.
4. **Blender, step by step** (`terrain_scatter.blend`):
   - a collection of rock variants, applied scale, origin at the bottom centre;
   - a Geometry Nodes modifier on the terrain block:
     - _Distribute Points on Faces_ (Poisson Disk, distance min, density);
     - density from the `Splat` colour attribute through _Named Attribute_ (the layer channel × factor);
     - _Instance on Points_ with the collection (Pick Instance, random index);
     - _Random Value_ rotation (Z) and scale;
     - _Align Euler to Vector_ on the normal with a factor;
     - _Translate Instances_ down for sinking;
   - **don't** realize instances;
   - export with _GPU Instances_ on (the exporter's scene-graph option), or the point-cloud fallback (D3: _Store Named Attribute_ `_ROT`, `_SCALE`, `_ITEM` on the points, then _Mesh to Points_ and export) when GPU instances don't come through;
   - pitfalls: unapplied rock scale, instances under the terrain, realize by accident (huge GLB).
5. **Procedural in the engine:** a `*.scatter.json` example per material (pebbles on sand, boulders at cliff bases with a slope mask, leaf cards on forest floor), tuning density and spacing, deterministic seeds.
6. **Variations, each with why and cost:**
   - rocks sharing the terrain texture set (zero VRAM) vs their own textures (realism);
   - colliders only on boulders;
   - tint variation vs more meshes;
   - cards vs meshes for litter.
7. **Pitfalls and checklist.**

---

## Phases

### Phase 1 — Static instance chunks and the scatter asset (D1, D2)

1. `createInstancedMeshEntity` and `createStaticInstances` on `aekasha/instancing`, with tests (the refs given back on delete, a geometry another mesh shares kept); `lodShowcase`'s `instanceCell` lane on them (a lane module in `src/app/scenes/lodShowcase/lanes/`, the LOD showcase being the LOD plans' verification scene); close `docs/issues/no-public-instanced-mesh-entity.md`.
2. The `*.scatter.json` schema, suffix and spawner in `instancing()`.

**Exit:** 20k pebbles on a 64 m block in 16 cells, culled per cell, released on scene exit; `PLACEMENTS` source works; `yarn verify:scenes --only lodShowcase` unchanged (or its baseline updated with the reason).

### Phase 2 — GPU instances import and the point-cloud fallback (D3)

**Exit:** a Blender GN scatter exported both ways spawns identically, and the worker and main-thread import paths agree.

### Phase 3 — Procedural scatter v2 (D4)

**Exit:** density follows the painted layers on a showcase block; the same seed and grid always give the same placements; boulder colliders work (p101 determinism holds; the probe is unchanged by scatter without colliders).

### Phase 4 — Assets (D5)

1. `generateRock`, the rock material (with wet), the optional Poly Haven set, leaf cards.

**Exit:** the gallery "Scatter" row shows procedural vs imported rocks on the same block, wet and dry.

### Phase 5 — Handbook, template, Hub, versioning

1. The `terrain-scatter.md` page and the `terrain_scatter.blend` template.
2. **Hub** (`hub/CLAUDE.md`): the instancing section of its feature page (static instances, `*.scatter.json`, the GPU instances import, `api:` links; `aek:covers` for the new `##` section of `features/instancing/CLAUDE.md`), the terrain feature page's scatter section, the toolkit page's `generateRock`; the LOD page's static cell lines if they change. Then `yarn hub:build`.
3. **Repo docs:** `readme.md` Features (engine: static instances, GPU instancing import, `*.scatter.json`; toolkit: terrain scatter, rocks); `features/instancing/CLAUDE.md` (a `## Static instances` section) and `features/lod/CLAUDE.md`'s `InstancedMesh` entity line naming the public call; `devTools/gather/CLAUDE.md`'s suffix list.
4. Versions: engine minor, toolkit minor, app minor; `CHANGELOG.md`.

---

## Risks

| Risk                                                                     | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Blender's GPU-instances export option changes or drops custom attributes | Point-cloud fallback (D3); the add-on (p306) can gain an "Export Scatter" operator if needed                                                                                                                                                                                                                                                                                                               |
| Too many cells means too many draw calls                                 | `cellSize` per scatter; for low-poly item types (pebbles, cards), bake all of a cell's instances of one material into one geometry with p371's `mergeGeometryParts` (one draw per material per cell instead of one per item type; costs vertices × instances of memory, so not for high-poly rocks). Geometry groups don't help: one draw per group (p370 §2.1). `BatchedMesh` is p375's spike-gated topic |
| Per-instance colliders hurt physics                                      | Colliders only on flagged items; lint threshold; FIXED bodies only                                                                                                                                                                                                                                                                                                                                         |
| A cell's light culling or bounds read one instance at the origin          | Cells aren't opted into ECS frustum culling or spatial indexing (D1); check that light culling's receiver test sees a cell (pools' case: `docs/issues/pool-instances-not-light-receivers.md`) in the gallery's Scatter row under an object-culled light |
| Raycast placement on imported blocks is slow for large counts            | Use the grid height from the heightfield extraction (p306 D3) instead of raycasts when the block is a regular grid                                                                                                                                                                                                                                                                                         |
