Status: draft | not-implemented
Category: Terrain, Rendering, Materials
Blocked by: p299_texture-arrays-and-atlases.md (soft: D1's atlases are p299 D3 atlases, built since its Phase 3; only its Phase 5 JSON binding is open), p306_terrain-blocks-and-procedural-terrain-meshes.md, p304_procedural-texture-baker.md (procedural decals), p307_wet-and-dry-surface-states.md (soft: wet decals)
Blocks: p310_terrain-preview-scenes.md
Epic: p301_terrain-texturing-epic.md
Related: p370_static-mesh-merging-and-texture-atlas-systems.md (mesh merging; §2.1 on `BatchedMesh` draw counts), \_DONE_p372_mesh-merge-groups.md (merging a block's cutout mesh decals), p375_batched-mesh-batches.md (its Phase 0 spike answers this plan's `BatchedMesh` risk)

# Terrain Decals

Decals add unique, non-repeating detail where it matters: tyre tracks, cracks, stains, leaks, footprints, scorch marks, wet patches. They break up tiling more cheaply than any shader technique, because they cost only where they're placed.

This plan delivers:

- **Decal atlases**: imported CC0 decals plus procedural ones exported from p304's baker, as p299 atlases with a `DECAL` packing.
- **A decal material**: alpha-blended or alpha-tested, polygon offset, render order, wet-aware, with an optional puddle-mask channel (ruts that fill with water).
- **Mesh decals** authored in Blender (`*.decalSet.json`, owned by terrain blocks).
- **Runtime decals** projected onto terrain blocks and meshes: footprints, impacts, tyre ribbons. One `BatchedMesh` per atlas, with fade-out.

---

## Context (grounded)

- **No decal support exists** (no `DecalGeometry` usage; p301 survey).
- **`MeshProps`** (`kernel/mesh/Mesh.ts`, on `aekasha`) has no `renderOrder`, nor does the mesh schema (`schemas/MeshSchema.ts`). Lines have one (`LineTypes.ts`), and LOD's fade copies carry the mesh's (`features/lod/LodFades.ts`).
  - `polygonOffset`, `polygonOffsetFactor`/`Units`, `transparent`, `depthWrite`, `alphaTest` and `alphaToCoverage` are material params, so the material JSON can already set them through `params`.
- **The forward renderer** (`WebGPURenderer`) has no G-buffer. Screen-space/deferred decals would need the depth prepass that today lives only inside the PostFX chain (the lazy non-MSAA depth + normal pre-pass in `features/postfx/PostFX.ts`' pipeline, `getPrePass`, built only when a pass reads depth or normals, not reachable from materials). **Mesh decals are the fit.**
- **Atlases exist** (p299 Phase 3, `kernel/assets/TextureAtlas.ts`, `schemas/TextureAtlasSchema.ts`): a `*.textureAtlas.json` with named map slots (one KTX2 output each, built by `yarn assets`), cells placed by `rect` or a shelf packer on the block grid, `padding` with edge extension (the mip chain stops at the level it protects, or `mipChain: "FULL"`), a slot `fill`, `optimize.alphaCoverage` per slot (`_DONE_p341`), a free-form per-cell `data` that the gatherer passes through, and the cell table (`__atlas.cells`: UV rect, pixel size, `data`) in the generated data. A cell's slot source is an image or a texture asset's id, and a texture asset can be packed from several source images (`pack`, `schemas/TextureSchema.ts`). The `textureAtlases` scene (`src/app/scenes/textureAtlases/`) draws the test atlases.
- **Terrain blocks** (p306) are regular grids with `getHeightAt` for generated geometry, or the extracted heightfield (p306 D3) for imported geometry. A small grid patch around a point is cheap to build, so runtime decals never need to clip the whole block.
- **ambientCG decal and atlas assets** (checked via the API, 2026-10-02):

| Asset                                                 | Maps                                        | Use                                         |
| ----------------------------------------------------- | ------------------------------------------- | ------------------------------------------- |
| `TireTracks001` (Decal)                               | colour, normal, roughness, AO, displacement | Tyre tracks                                 |
| `AsphaltDamage001` (Decal)                            | + opacity                                   | Cracks and damage                           |
| `AsphaltDamageSet001` (Atlas)                         |                                             | Crack set                                   |
| `Leaking012A` / `Leaking017B` / `Leaking019A` (Decal) | colour, normal, roughness, metalness        | Streaks on concrete and cliffs              |
| `LeafSet024` (Atlas)                                  |                                             | Leaf litter; p308 uses it for scatter cards |

Searches for footprint, crack and stain decals found nothing, so those come from procedural generators (D5).

---

## Design

### D1 — Decal atlas and packing

- **`DECAL` packing** (2 textures, same channels for imported and procedural):
  - `albedoAlpha`: RGB albedo (sRGB), A opacity;
  - `normalRough`: RG normal XY, B roughness, A **puddle mask** (where water collects, e.g. tyre ruts; 0 for most decals).
- **Built on p299's 2D atlases** (p299 D3, built): the atlas is a `*.textureAtlas.json` with the `albedoAlpha` (`colorSpace: SRGB`) and `normalRough` (`optimize.slot: data`, `fill` `[0.5, 0.5, 1, 0]`) slots, so the composition, padding, 4×4 snapping, per-slot encoding and the generated cell table are p299's. No decal build script and no `*.decalAtlas.json`.
- **Per cell** (the atlas JSON's `cells`):
  - `id`, and a `rect` in the atlas grid (or packed);
  - its slot sources: each a packed texture asset (`pack`) that puts the decal's maps into the `DECAL` channels (colour + opacity → `albedoAlpha`; normal XY + roughness + puddle mask → `normalRough`), from an imported asset's maps or an exported procedural PNG;
  - in its `data`: `physicalSize`, `tileAlong: 'U' | 'NONE'` (tyre tracks tile along their length) and `opacitySource` (an opacity map, or derived from height/colour with a threshold where the asset has none; if `pack` can't threshold, D1's first phase adds that step to the pack, not a separate tool).
- Fetching uses p303's `source.json` + `yarn fetchTextureSources`; `yarn assets` encodes (UASTC) and records the outputs in `assets.lock.json`.
- **Toolkit atlases:**
  - `decalsGround` (2K, 4 × 4 cells of 512): tyre tracks, cracks ×2, mud splatter, wet patch, stains ×2, footprints ×4 (boot, bare, paw, snow-boot), scorch, leaf patch, ice crack.
  - `decalsStructure` (2K): leaks ×4, cracks ×2, stains ×2, form-work marks.

### D2 — Decal material (toolkit: `src/toolkit/materials/decal/`, `decal.tsl.ts` with its `decal.material.json`, `setup` entry; its nodes in `src/toolkit/terrain/decals/`)

- **Sampling:** the atlas cell is sampled with the mesh's UV. Blender decals are UV'd straight into atlas space; runtime decals get UVs computed into their cell's rect from the cell table (`getAtlasCell`); the material samples with `sampleAtlasCell`, which clamps half a texel inside the rect (p299 D4, `kernel/assets/TextureAtlas.ts`; check they're on an entry, since the toolkit can't import kernel paths).
- **Opacity:** opacity × an edge fade (a UV border falloff, so hard quad edges never show) × a per-instance fade (runtime pool).
- **Two modes:**

| Mode              | Settings                                                                                               | Use                         | Cost                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------ | --------------------------- | ------------------------------------------------------------- |
| `BLEND` (default) | `transparent`, `depthWrite: false`, `polygonOffset` (factor −1, units −4), `renderOrder` after terrain | Soft decals: stains, tracks | Sorted with other transparents; overdraw where decals overlap |
| `CUTOUT`          | `alphaTest` + `alphaToCoverage` when MSAA is on                                                        | Footprints, cracks, leaves  | Cheaper: opaque pass, no sorting                              |

- **Lighting:** the decal's normal and roughness replace the surface's inside its opacity, which is correct for a forward mesh decal.
- **Wetness:** `applySurfaceWetness` (p307) with the decal's own response. The **puddle mask** channel raises local puddle level, so ruts fill first.
- **Shadows:** decals don't cast; they receive.
- **Engine addition:** `renderOrder` in `MeshProps` and the mesh schema (`schemas/MeshSchema.ts`; small, generic), applied by `createMeshEntity` and kept by the LOD's level swaps and fade copies.

### D3 — Mesh decals from Blender (`*.decalSet.json`, engine asset type, in `terrain()`)

```json
{
  "id": "showcaseMud_decals",
  "importedAsset": "showcaseMud_decals",
  "material": "decalsGround_blend",
  "renderOrder": 10
}
```

- Spawned with the owning terrain block (p306's `decals` ids) or by `spawnDecalSet(id)`.
- **Merging:** `CUTOUT` mesh decals are opaque, so a block's mesh decals can join a p372 merge group (one draw per decal material per block). `BLEND` decals are transparent and are never merged (p372 §5).
- **Engine-level, but tiny:** a typed wrapper around `spawnImportedAsset` with material, render order and no physics, in p306's `terrain()` feature (`features/terrain/DecalSetSchema.ts` on `aekasha/schemas`, `spawnDecalSet` on `aekasha/terrain`, the suffix in `GATHERED_SUFFIXES`). It exists so a terrain block's manifest can list decals as data.
- **Blender workflow** (`terrain_decals.blend`):
  - **Quad decals:** a plane UV'd onto an atlas cell. The template has one pre-UV'd quad per cell, so you duplicate the cell you want.
  - **Strip decals** (tyre tracks): a plane with Array + Curve modifiers along a path curve, UV'd along the length (`tileAlong: 'U'`).
  - **Conforming:** subdivide to about the terrain grid spacing, then _Shrinkwrap_ (Target: block, Wrap Method: Project along −Z / Nearest Surface Point, Offset 0.01–0.02 m), then apply.
  - **Export:** a separate GLB per block (geometry only, same locked settings as blocks, no colliders), into the block folder.

### D4 — Runtime decals (toolkit: `src/toolkit/terrain/decals/RuntimeDecals.ts`, on `aekasha/toolkit/terrain`)

- **`createDecalPool({ atlas, mode, maxDecals = 128 })`:**
  - one `BatchedMesh` per pool, geometry slots reused FIFO;
  - **note (p370 §2.1):** on WebGPU, three r186 draws a `BatchedMesh` as one draw call per visible member, so a pool of 128 decals is 128 draws, not 1 (it still saves per-object CPU work; the LOD's spike found the same, `src/_engine/features/lod/CLAUDE.md`'s "Not `BatchedMesh`"). For a real single draw, consider one preallocated geometry per pool with fixed-size vertex slots reused FIFO and a per-vertex fade attribute. Decide in Phase 4 with p375's spike numbers;
  - per-instance colour alpha for fades (`setColorAt`);
  - owned per scene: its mesh is an entity (`createMeshEntity`, or p308's `createInstancedMeshEntity` path for a pool mesh made by hand), so the scene's exit deletes it and gives its refs back;
  - per-frame work (the fades) allocates nothing and writes only the slots that changed.
- **`spawnDecal(pool, { target, position, normal, size, rotation, cell, lifetimeSec?, fadeSec? })`:**
  - **On a terrain block:** build a conforming patch from the block's grid (heights in a size-bounded window; spacing = block spacing, or half of it for small decals) and offset it along the normal. O(cells under the decal), not O(block).
  - **On other meshes:** three's `DecalGeometry` (`three/examples/jsm/geometries/DecalGeometry.js`, never the `Addons.js` barrel), loaded by `import()` on the first such decal, clipped against the target mesh. Costly on big meshes, fine on props. Documented.
- **`spawnRibbonDecal(pool, { target, points[], width, cell })`:** a strip conformed along a path. Use it for tyre tracks behind a vehicle, appended in segments.
- **Wet footprints:** the footprint cells' puddle mask × wetness gives wet prints in mud, and snow-boot cells (height-only normal) give prints in snow. This is the "T15" item of p307.
- **Determinism:** runtime decals are visual only and never touch physics. Spawn variation (rotation, cell pick) draws from a named stream (`getRandomStream('decals')`), so a replayed scene stamps the same decals.

### D5 — Procedural decals (toolkit, p304 generators)

| Generator          | Output                                                                                                                      |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `decalCracks`      | Worley F2−F1 edges with radial falloff and branching noise; dark albedo, normal from edges                                  |
| `decalStain`       | fbm blotch, darkening, roughness change                                                                                     |
| `decalScorch`      | Radial burn with soot noise                                                                                                 |
| `decalMudSplatter` | Splat-drop SDFs + fbm                                                                                                       |
| `decalFootprint`   | Boot, bare, paw and snow-boot shapes as SDFs + tread pattern; height-driven normal; puddle mask in the heel/toe depressions |
| `decalWetPatch`    | Soft fbm mask, darkening + low roughness + puddle mask                                                                      |
| `decalIceCrack`    | Thin, bright crack lines + subsurface-looking halo                                                                          |

- **Exported** through p304 D5 into the atlas sources (committed, since they aren't re-downloadable).
- **Optional runtime path:** bake per-seed variants into an array (`bakeTexture` layers) for endless unique footprints. The decal material then has an `ARRAY` source mode. Only if the gallery shows repetition matters.

---

## Handbook content (`docs/techniques/terrain-decals.md`)

1. **What it is:** mesh decals in a forward renderer, and why not screen-space here.
2. **"Best for":**
   - every camera type;
   - first- and third-person benefit most (close-up unique detail);
   - top-down/RTS use them for roads, scorch and tracks (very visible from above);
   - stylized: hand-painted decal atlases.
   - **Poor fit:** thousands of overlapping blend decals in one spot (overdraw). Use CUTOUT or bake them into a colour map (p305 D7) instead.
3. **Performance:**
   - BLEND vs CUTOUT;
   - draw calls (one per decal set or pool);
   - overdraw;
   - runtime spawn cost (patch vs `DecalGeometry`);
   - atlas VRAM (2K UASTC ≈ 5.6 MB for 2 maps with mips);
   - gallery numbers.
4. **Maps:** the `DECAL` packing table; opacity sources; the puddle mask, and why.
5. **Blender, step by step:** atlas cell quads, strips along curves, Shrinkwrap settings, apply, UV check, export.
6. **Import and set-up:** `*.decalSet.json`, block `decals`, materials (BLEND and CUTOUT variants).
7. **Runtime:** pools, `spawnDecal`, ribbons, lifetimes, wet footprints.
8. **Variations, each with why and cost:**
   - baking static decals into a colour map (zero runtime cost, no lighting response);
   - CUTOUT instead of BLEND;
   - procedural arrays for variety.
9. **Making your own decals:** from photos (opacity from a mask painted in Krita/GIMP), from the baker, and from Blender (bake a sculpted crack to a plane: colour, normal, height → opacity).
10. **Pitfalls:**
    - z-fighting (offset and polygon offset);
    - mip bleeding (atlas padding);
    - decals floating on steep slopes (subdivide);
    - sorting with other transparents.

---

## Phases

### Phase 1 — Atlas tooling (D1)

1. The packed texture JSONs per decal (the `DECAL` channels), the two atlas JSONs in `src/toolkit/textures/decalsGround/` and `src/toolkit/textures/decalsStructure/` (p301 §2: shared textures by id), and the `opacitySource` derivation if `pack` lacks it (an asset pipeline change, its test next to it).

**Exit:** `decalsGround` and `decalsStructure` built by `yarn assets` as p299 atlases from the ambientCG sources (procedural cells still placeholders), encoded, with cell tables generated, and drawn in the gallery's Decals row.

### Phase 2 — Decal material (D2)

1. BLEND, CUTOUT, edge fade, wet response, puddle mask; `renderOrder` in `MeshProps` and the mesh schema (an engine minor, with its JSDoc and a test).

**Exit:** decal quads on a gallery block show no z-fighting at 200 m, no visible quad edges, and get wet.

### Phase 3 — Mesh decals from Blender (D3)

1. `*.decalSet.json`, the block hook, the template.

**Exit:** tyre tracks along a curve on a showcase block conform without floating or clipping.

### Phase 4 — Runtime decals (D4)

1. Pool (`BatchedMesh`, or the single-geometry pool), terrain patch projection, `DecalGeometry` for meshes (lazy), ribbons, fades; `perf-auditor` on the per-frame code.

**Exit:** 128 footprints spawned while walking stay at one draw call (with the single-geometry pool; a `BatchedMesh` pool counts one per decal on WebGPU, see D4) and fade FIFO; ribbon tracks follow a moving point.

### Phase 5 — Procedural decals (D5)

**Exit:** the procedural cells replace the placeholders, and wet footprints in mud fill with water during a rain shower.

### Phase 6 — Handbook, template, Hub, versioning

1. `terrain-decals.md`, `terrain_decals.blend`.
2. **Hub** (`hub/CLAUDE.md`): the terrain feature page's decals section (atlases, the material, decal sets, runtime pools; `api:` links), the scenes-and-assets page's asset type list (`*.decalSet.json`) and the rendering page's `renderOrder` line. Then `yarn hub:build`.
3. **Repo docs:** `readme.md` Features (toolkit: decals; engine: `*.decalSet.json`, `renderOrder`); the terrain feature's `CLAUDE.md`; `devTools/gather/CLAUDE.md`'s suffix list.
4. Versions: engine minor, toolkit minor, app minor; `CHANGELOG.md`.

---

## Risks

| Risk                                                                                             | Mitigation                                                                                                                          |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `BatchedMesh` behaviour on the WebGPU backend (per-instance colour, geometry slot reuse) | Answered by p375 Phase 0 (2026-11-11, r187; p375 §2 Results): per-member colour and visibility work on both backends; `deleteGeometry` + `addGeometry` leaks buffer space (ids are reused, ranges never), so a FIFO pool reserves each slot at `addGeometry` and refills it with `setGeometryAt`; re-added instances split r187's merged draws unless a range `customSort` orders them (about 0.6 ms a pass at 2,000). Fallback unchanged: the single-geometry pool (D4) |
| Transparent sorting conflicts with other transparents (water later, particles)                   | `renderOrder` bands documented: terrain 0, decals 10, scatter cards (CUTOUT) opaque, transparents ≥ 20                              |
| Polygon offset differs between depth ranges or backends                                          | Offsets in the material are tunable; the gallery checks at 1, 50 and 200 m                                                          |
| Atlas mip bleeding                                                                               | Cell padding (≥ 16 px at 2K) with edge extension; mips are generated per atlas, so padding scales                                   |
