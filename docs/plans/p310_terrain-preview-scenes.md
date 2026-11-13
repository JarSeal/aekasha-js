Status: draft | not-implemented
Category: App, Terrain, Docs
Blocked by: p305_terrain-material-generator.md, p306_terrain-blocks-and-procedural-terrain-meshes.md, p307_wet-and-dry-surface-states.md, p308_terrain-scatter.md, p309_terrain-decals.md
Epic: p301_terrain-texturing-epic.md
Related: \_DONE_p370_static-mesh-merging-and-texture-atlas-systems.md (merged dressing and modular kit terrain, for the matrix and the measurements)

# Terrain Preview Scenes (gallery + showcase) and the Final Handbook Pass

Two app scenes to preview, compare and measure every technique of the epic:

- **`terrainGallery`** (`src/app/scenes/terrainGallery/`): isolated, engine-generated blocks. One block per material, one row per technique, camera presets per game type, and a **measurement mode** that produces the GPU-ms tables for the handbook. Its skeleton comes from p303, and p304–p309 add rows to it. This plan completes it.
- **`terrainShowcase`** (`src/app/scenes/terrainShowcase/`): blended, art-directed blocks built in Blender:

  - a coast;
  - an alpine slope;
  - wetlands;
  - plus an engine-generated procedural block and a concrete structure;
  - scatter, decals, day-night and a rain-shower scenario.

  The **step-by-step Blender build of each block** is in this plan.

The plan ends with the final handbook and Hub pass: the decision matrix with measured numbers, the terrain feature page's showcase, and the `readme.md` highlight.

Both are ordinary app scenes (`hub/CLAUDE.md`'s Scenes and examples): one folder each, holding the scene JSON, the scene file, its `_dbg__` module, its Hub image and every asset only that scene uses (blocks, splat and colour maps, world materials, scatter and decal data); the layout check (`devTools/layout/layoutRules.ts`) fails on a file elsewhere.

---

## 1. Downloads (all assets of the epic, one place)

All are CC0. Source sizes are what to download. Shipped sizes are what p300 produces. The fetch tool (`yarn fetchTextureSources`, p303 D5) downloads every texture source from its `source.json`. Models are downloaded by hand once (glTF zip), decimated in Blender, and committed.

| What                                                                                                       | Where from                                   | Download                                                     | Ships as                                                                                          | Location                                             |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 16 terrain/structure texture sets (p303 D6 table)                                                          | ambientCG (primary), Poly Haven (alternates) | 2K-JPG zip (2K-PNG for cliffs if JPEG blocking shows)        | 1K LITE KTX2 (+FULL/MINIMAL for `sand01`, `grass01`, `cliffs01`; 2K LITE optional for `cliffs01`) | `src/toolkit/textures/<set>/`                        |
| Decals: `TireTracks001`, `AsphaltDamage001`, `Leaking012A`, `Leaking017B`, `Leaking019A`                   | ambientCG                                    | 1K-PNG zip (decals live in 512-px atlas cells; 1K is enough) | Atlas cells in `decalsGround` / `decalsStructure` (2K KTX2)                                       | `src/toolkit/textures/decalsGround/` / `decalsStructure/` (`source/<id>/`) |
| Leaf litter: `LeafSet024`                                                                                  | ambientCG                                    | 1K-PNG zip                                                   | Scatter-card atlas (1K KTX2)                                                                      | `src/toolkit/textures/leafLitter/`                   |
| Rocks (optional realism): `rock_moss_set_01`, `namaqualand_stones_01`, `sand_rocks_small_01`, `boulder_01` | Poly Haven (models)                          | glTF, 1K textures                                            | Decimated GLBs (meshopt) + 1K KTX2 (`prop` profile)                                               | `src/toolkit/models/nature/<id>/`                    |
| Procedural sets, decals, macro noise, ripple atlas                                                         | Generated (p304)                             | —                                                            | Baked at load, or exported → committed PNG → KTX2                                                 | `src/toolkit/textures/<id>/`, decal atlas sources    |

**Disk budget for the downloads:**

- ≈ 0.5 GB of source zips, cached in `.cache/texture-downloads/` and gitignored;
- ≈ 40–50 MB of committed KTX2/GLB outputs;
- the `.blend` templates (~15–20 MB) and showcase `.blend` files (~10–15 MB).

---

## 2. `terrainGallery` (completed)

### 2.1 Layout

All blocks come from `terrainBlock` JSONs with generated geometry (p306), kept in the scene's folder, so the gallery needs no Blender. Rows run along +Z and are labelled by the tab and world-space signposts (the UI kit's world anchors, `createWorldAnchorLayer` on `aekasha/ui`, moved by the toolkit's `registerWorldAnchorSync` (`aekasha/toolkit/ecs`); created by the debug module only).

| Row           | Blocks                                                                                    | Shows                                                                         |
| ------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| A Library     | 16 × 12 m                                                                                 | Every set alone (`textureSetSurface` vs `terrain` single-layer toggle)        |
| B Packing     | 3 sets × FULL / LITE / MINIMAL                                                            | What each packing costs and looks like (AO-into-albedo visible under low sun) |
| C Anti-tiling | 3 × 48 m (NONE / DUAL_SCALE / HEX) + macro toggle                                         | Repetition at 2, 30 and 120 m                                                 |
| D Splatting   | vertex colour (5 layers), splat map (5), LINEAR vs HEIGHT, a 9-layer ARRAY, sparse on/off | Borders, height blend, binding budget                                         |
| E Rules       | 64 m rules block; CPU-rules vs shader-rules A/B                                           | Zero-authoring blending; cost difference                                      |
| F Cliffs      | PLANAR / BIPLANAR / TRIPLANAR / slope-gated                                               | Stretching vs taps                                                            |
| G Procedural  | One block per generator; imported / baked / live toggle                                   | p304 trade-offs                                                               |
| H Colour map  | DETAIL and FAR_ONLY; `AVERAGE_COLOR` far mode                                             | Unique colour, far LOD                                                        |
| I Structures  | Concrete wall + bunker (`concrete01`/`02`), wear, leak decals                             | Structure mode                                                                |
| J Wet/dry     | One block per category + a blended beach; global wetness slider                           | p307 responses                                                                |
| K Scatter     | Procedural vs imported rocks, leaf cards, colliders                                       | p308                                                                          |
| L Decals      | Atlas showcase quads; a footprint pad (click to stamp, toggle wet)                        | p309                                                                          |
| — Orientation | A block with a corner-marker splat                                                        | Splat/UV orientation check (p306)                                             |

### 2.2 Camera presets per game type

Buttons in the gallery tab (the scene-scoped `src/app/scenes/terrainGallery/_dbg__terrainGallery.ts`: one `createDebuggerTab({ id, title, icon, sceneId, content })` from `aekasha/debug`, a declarative pane of the UI kit's fields, like `space`'s "Space demo" tab). Each preset sets the pose relative to the selected block and FOV, and shows a one-line description. Movement is the debug camera's controls.

| Preset                      | Pose                                                      | FOV | Why                                            |
| --------------------------- | --------------------------------------------------------- | --- | ---------------------------------------------- |
| First person                | Eye 1.7 m above ground, looking 10° down                  | 75° | Texel density, anti-tiling and HEX matter most |
| Third person                | 6 m behind, 2.5 m up, looking at a point 1 m above ground | 60° | The common open-world view                     |
| Top-down                    | 30 m high, 55° pitch                                      | 50° | ARPG / twin-stick                              |
| Isometric / RTS             | 120 m away, 35° pitch                                     | 20° | Colour map, far modes, MINIMAL packing         |
| Side view (2.5D platformer) | Perpendicular to a cliff block, 15 m away, level          | 45° | Vertical faces dominate: triplanar/structures  |
| Flight / racing             | An automatic flyover path at 60 m/s, 15 m high            | 70° | Far tiling, distance modes, temporal stability |

### 2.3 Measurement mode (feeds the handbook)

- **Solo:** hide every block except the selected one. The camera goes to the row's **measurement pose**: block filling the screen, 1920 × 1080 canvas, DPR 1, PostFX off, shadows on, sky paused.
- **Measure:**
  - reads the frame's GPU time from the engine's one frame record (`debug/_dbg__GPUFrameTimes.ts`: `_acquireGpuFrameTimes('RENDER')`, `_onGpuFrameTime`, `src/_engine/debug/CLAUDE.md`'s GPU timing), which sums every render context of the frame; it's `@internal` debug code, so the gallery reaches it through a public `aekasha/debug` source (the stats panels' GPU, or a small public reader added for this), not a deep import;
  - averages 120 frames after a 30-frame warm-up;
  - records `{ row, block, technique, tier, packing, taps estimate, gpuMs, backend, adapter info }`.
- **Measure row:** runs every block of a row × every quality tier.
- **Copy results:** writes a markdown table to the clipboard to paste into the handbook pages. The machine (GPU, browser, OS) is in the table header. Numbers are only comparable within one machine; the handbook says so.
- On WebGL2 three's pool times one context at a time and loses the queries opened while a resolve polls, so only about two frames in three get a figure (the GPU timing notes): measurements are WebGPU-only for the tables and the tab says why.

---

## 3. `terrainShowcase`

**Scene:**

- `src/app/scenes/terrainShowcase/terrainShowcase.scene.json` + `terrainShowcase.ts`, sky box `dayNight` (the shared `src/app/skyboxes/` one, 5-minute day, playing).
- Surface conditions `SIMULATED` (the scene JSON's `surfaceConditions`), with a scenario button "Rain shower" (p307).
- Optional: a third-person character as the gym has one (the `character()` feature's dynamic controller and player brain, `src/_engine/features/character/CLAUDE.md`, with the toolkit's `FollowObjectCameraRig`; the visual from `src/app/shared/characterVisual.ts`) to walk on the heightfield colliders, stamp footprints (p309 runtime decals) and test the blocks the way a game would.

**Blocks** (64 m, 129 vertices, 0.5 m spacing), placed as separate islands with sunk edges. Seamless multi-block worlds are the future world plan; p306's _Split Into Blocks_ is tested separately.

| Block                | Grid        | Built in | Layers                                                                          | Technique                                                                                                                                         |
| -------------------- | ----------- | -------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `showcaseCoast`      | (0, 0)      | Blender  | `sand01` (base), `sand02` (R), `rocks01` (G), `cliffs01` (B)                    | Vertex-colour `RGB_AO` + slope-gated triplanar on cliffs + shoreline wetness + pebble/rock scatter + tyre-track mesh decal + runtime footprints   |
| `showcaseAlpine`     | (2, 0)      | Blender  | `grass01` (base), `grass02`, `rocks02`, `cliffs02`, `snow01`, `snow02`, `ice01` | 2 splat maps (8 weights) + snow rules (height/aspect) + ARRAY storage + sparse top-3 + boulders with colliders + ice-crack decals + snow coverage |
| `showcaseWetlands`   | (0, 2)      | Blender  | `mud01` (base), `mud02` (R), `grass02` (G), `rocks01` (B), AO in A              | Vertex-colour `RGB_AO` + `_WETNESS` regional attribute + puddles and ripples + tyre ruts with puddle mask + leaf cards + rocks                    |
| `showcaseProcedural` | (2, 2)      | Engine   | Alpine's layers                                                                 | `rulesTerrain` generator, CPU rules vs shader rules toggle, procedural scatter. Compare with the Alpine block: authored vs generated              |
| `showcaseBunker`     | on Wetlands | Blender  | `concrete01`, `concrete02`                                                      | Structure mode, wear vertex colours, leak decals, streaks in rain                                                                                 |

### 3.1 Files per block (app)

```
src/app/scenes/terrainShowcase/
  terrainShowcase.scene.json, terrainShowcase.ts, _dbg__terrainShowcase.ts, terrainShowcase.hub.png
  blocks/showcaseCoast/
    showcaseCoast.blend                     (app source, committed; not a toolkit template)
    showcaseCoast.glb                       (exported geometry, committed source; p300 → meshopt, lossless for the collider)
    showcaseCoast.importedAsset.json
    showcaseCoast.terrainBlock.json
    showcaseCoast_decals.glb + .importedAsset.json + .decalSet.json
    showcaseCoast_rocks.scatter.json
    terrainCoast.material.json              (terrain material: layers, techniques, wet)
```

A block another scene starts using moves to a shared `src/app/terrainBlocks/` (p306 D2), keeping its ids.

The Alpine block adds `showcaseAlpine_splat0.png` / `_splat1.png` + `.texture.json` (`data` slot, `codec: none`).

### 3.2 Common Blender steps (every block)

These follow `docs/techniques/terrain-blocks-blender.md` (p306). Summary:

1. **Open the template:** `src/toolkit/terrain/blender/terrain_blockTemplate.blend`. _Save As_ into the block folder in `src/app/scenes/terrainShowcase/blocks/<id>/<id>.blend`. Run `yarn fetchTextureSources` first so the preview material finds its images.
2. **Add the block:** Ækasha sidebar → _Add Terrain Block_: size 64, resolution 129, grid (x, z) per the table. The object is `TerrainBlock`.
3. **Set the preview material's layers** to the block's sets (the node group's image slots are pre-wired to the `source/raw/` folders).
4. **Shape, paint and bake** (per-block steps below).
5. **Finish:** _Validate Block_, then _Export Block_. It writes the GLB and the JSON stubs.
6. **Fill in the JSON stubs** (`material`, `materialInputs`, `scatter`, `decals`) and create the terrain material JSON.

### 3.3 `showcaseCoast`: step by step

1. **Shape** (Displace modifier, _Global_ coordinates):
   - Texture 1: _Noise_/_Clouds_, size 18 m, strength 2.5 m (dune swells).
   - Texture 2: a second Displace with _Clouds_ size 4 m, strength 0.4 m.
   - Tilt toward the sea: _Proportional Edit_ is fine before the grid lock. Or, better, a Displace with a _Blend_ texture (linear gradient along −Y, strength −3 m) so the south edge sits about 1 m below `waterLevel` (0.5 m).
   - Apply all modifiers.
2. **Cliff band** along the north edge:
   - Sculpt mode, Symmetry popover: **Lock X and Y**.
   - _Draw_ / _Clay Strips_ upward to 6–9 m over about 4 m of run (steep, ≈ 60–70°, but no overhang, so the heightfield stays valid).
   - _Smooth_ the top lip.
3. **Paint `Splat`** (Vertex Paint, _Mix_ blend, pure colours; the preview material shows the result):
   - **R (`sand02`, beach sand):** a 6–10 m band along the waterline, soft edge.
   - **G (`rocks01`, gravel):** patches at the cliff foot and two or three islands in the dunes; strength 0.6 for broken edges.
   - **B (`cliffs01`):** the whole cliff face. Cliffs also get triplanar by slope, so paint loosely; the slope gate does the rest.
   - Leave everything else black (= `sand01`, dunes).
   - _Normalize Splat_.
4. **AO:** _Bake AO → Splat Alpha_ (distance 8 m, 64 samples). It darkens the cliff foot and the dune troughs.
5. **Custom props:** already set by the add-on. Add friction 1.0 in the `terrainBlock.json` collider.
6. **Decals** (separate object, `showcaseCoast_decals`):
   - Draw a Bézier curve across the beach.
   - Add a plane 0.4 × 1 m, UV'd to the `tyreTracks` atlas cell (duplicate it from the template's atlas quads).
   - Array (fit curve) + Curve modifiers, subdivided to 0.25 m.
   - Shrinkwrap (Project −Z, offset 0.015 m) onto `TerrainBlock`, then apply.
   - Export as `showcaseCoast_decals.glb` (geometry only).
7. **Scatter:** no Blender scatter here. It's procedural (`showcaseCoast_rocks.scatter.json`): pebbles on `rocks01` weight > 0.3, a few rocks at the cliff foot (slope 20–45°).
8. **Material** `terrainCoast.material.json`:
   - layers `sand01`, `sand02`, `rocks01`, `cliffs01`;
   - `blend.source: VERTEX_COLOR`, `RGB_AO`, HEIGHT blend;
   - DUAL_SCALE, HEX on DOMINANT;
   - cliffs layer `projection: TRIPLANAR` with `slopeGate: [35, 50]`;
   - macro on;
   - `wet: { shoreline: { band: 1.5, noise: 0.5, runUp: true }, puddles: {}, ripples: true }`.
9. **Scene:** `waterLevel: 0.5`, plus a flat sea plane (a simple dark material). Water rendering is out of scope; the plane only shows the shoreline.

### 3.4 `showcaseAlpine`: step by step

1. **Shape:**
   - A Displace with a large _Clouds_ (size 40 m, strength 18 m) for one main ridge rising toward +X.
   - A second Displace (size 8 m, strength 2 m).
   - Sculpt (X/Y locked):
     - a steep rock band (20–30 m long, 8 m high) on the north-facing side;
     - a shallow bowl (≈ 12 m across, 0.6 m deep) on the flat south part for the frozen pond.
2. **UVs:** done by the add-on. Verify against the orientation block.
3. **Splat maps** (Texture Paint):
   - Create `showcaseAlpine_splat0` and `_splat1`: 1024², Non-Color, black, RGBA, alpha 0.
   - In the template, two _Image Texture_ nodes on the preview material read them (`splat0` = layers 1–4, `splat1` = layers 5–8).
   - Paint with pure-colour brushes, one channel per layer:
     - **`splat0.R` (`grass02`):** forest-floor patches on the lower slope.
     - **`splat0.G` (`rocks02`):** scree below the rock band.
     - **`splat0.B` (`cliffs02`):** the rock band.
     - **`splat0.A` (`snow01`):** snow drifts in a few hollows. Painting alpha: brush blend _Add Alpha_. The rest of the snow comes from rules.
     - **`splat1.R` (`snow02`):** wind-swept crest.
     - **`splat1.G` (`ice01`):** the pond bowl, sharp edge.
   - **Save as 8-bit PNG** next to the `.blend`. The add-on's export saves them.
4. **No vertex AO** on this block. The splat technique demo keeps vertex colours empty; the colour-map variation (§5) bakes AO into a colour map instead.
5. **Scatter** (Blender GN, to demonstrate the imported path):
   - A collection of 3 boulders (Poly Haven `boulder_01` decimated to 1.5k tris, or `generateRock` exports).
   - GN on `TerrainBlock`:
     - _Distribute Points on Faces_ (Poisson, min 6 m), density from `splat0.G` (scree) via _Image Texture_ in GN, × 0.02;
     - _Instance on Points_ (random pick);
     - random Z rotation, scale 0.8–1.6;
     - _Align Euler to Vector_ (normal, factor 0.5);
     - translate −0.3 m.
   - Set `aekScatterCollider: "CONVEXHULL"` on the collection's objects.
   - Export with GPU instances as `showcaseAlpine_scatter.glb` (or the point-cloud fallback, p308 D3).
6. **Decals:** two ice-crack quads (`iceCrack` cell) on the pond, Shrinkwrapped, exported as `showcaseAlpine_decals.glb`.
7. **Material** `terrainAlpine.material.json`:
   - 7 layers, `SPLAT_MAP_AND_RULES` (`splatMaps: 2`);
   - rule: `snow01` above 18 m, slope < 35°, aspect north ±70°, noise 0.3;
   - rule: `cliffs02` above 45° slope;
   - `storage: ARRAY`, `sparse: { maxLayers: 3 }`;
   - TRIPLANAR slope-gated on `cliffs02`;
   - `wet: { snow: { set: 'snow01' } }`, so `snowCoverage` (p307) adds snow everywhere.

### 3.5 `showcaseWetlands`: step by step

1. **Shape:**
   - Almost flat: Displace _Clouds_ 25 m / 0.8 m plus 5 m / 0.15 m.
   - Sculpt (locked) a meandering shallow channel (0.3–0.5 m deep, 2–3 m wide) and two hollows for puddles.
2. **Paint `Splat`:**
   - **R (`mud02`):** the channel and its banks.
   - **G (`grass02`):** the raised areas.
   - **B (`rocks01`):** a gravel path crossing the channel.
   - Base: `mud01`.
   - _Normalize Splat_.
3. **AO:** _Bake AO → Splat Alpha_ (distance 4 m).
4. **Regional wetness** (`_WETNESS`, float, point domain):
   - Geometry Nodes → _Store Named Attribute_ `_WETNESS` = a smoothstep of the distance to the channel. Or, simpler: paint a second colour attribute `WetPaint` and use GN to copy its R into `_WETNESS`.
   - Apply the GN modifier, delete `WetPaint`.
   - Export keeps `_`-prefixed attributes (_Attributes_ ✓).
5. **Decals:**
   - Tyre ruts across the path (strip decals, `tyreTracks` cell, the puddle mask in the cell's A channel makes them fill with water).
   - Three mud-splatter quads.
   - Export as `showcaseWetlands_decals.glb`.
6. **Scatter:** procedural `showcaseWetlands_litter.scatter.json` (leaf cards on `grass02` and `mud02`) and `_rocks.scatter.json` (small rocks along the path).
7. **Material** `terrainWetlands.material.json`:
   - `VERTEX_COLOR` `RGB_AO`, HEIGHT blend, DUAL_SCALE;
   - `wet: { puddles: { maxSlope: 8 }, ripples: true, regional: { attribute: '_WETNESS' } }`.

### 3.6 `showcaseBunker`: step by step (structure)

1. **Open** `src/toolkit/terrain/blender/structure_concrete.blend` and _Save As_ `src/app/scenes/terrainShowcase/blocks/showcaseWetlands/showcaseBunker.blend`.
2. **Model** a 6 × 4 × 2.6 m bunker (walls 0.4 m) and a 12 m wall segment, with simple bevels (Bevel modifier, 0.03 m, 2 segments, then apply).
   - **No UVs needed:** world/object triplanar.
   - Apply scale; origin at the bottom centre.
3. **Wear** (vertex colours, `RGBA`, a separate `Splat` attribute per object):
   - **R (`concrete02`, damaged):** corners and edges. Use _Dirty Vertex Colors_ as a starting point, then paint.
   - **G:** leak stains below the roof edge (a multiply tint in the structure preset).
4. **Decals:** two leak quads under the roof edge (`leak` cells from `decalsStructure`), offset 0.01 m.
5. **Collider:** custom props `colliderType: "TRIMESH"` (or boxes per wall for cheaper physics, recommended: `CUBOID` children).
6. **Export** both objects (_Selected Objects_) as `showcaseBunker.glb`. They're placed on the Wetlands block by the scene code (or with a `parentBlock` in a structures list, a follow-up).

### 3.7 Scene code (outline)

```ts
// src/app/scenes/terrainShowcase/terrainShowcase.ts: entries only (`aekasha*`, `aekasha/toolkit/*`)
export const scene = async () => {
  const update = getLoaderStatusUpdater();
  for (const id of ['showcaseCoast', 'showcaseAlpine', 'showcaseWetlands', 'showcaseProcedural']) {
    await spawnTerrainBlock(id); // geometry, material variant, collider, scatter, decals (p306/p308/p309)
  }
  await spawnImportedAsset('showcaseBunker', {
    material: getStructureMaterial('concrete') /* … */,
  });
  setSurfaceConditions({ wetness: 0, waterLevel: 0.5 }); // p307 (or the scene JSON's `surfaceConditions`)
  if (IS_DEBUG_ENV) (await import('./_dbg__terrainShowcase')).createTerrainShowcaseTab();
};
```

Each block's physics is created inside the load, so the load's physics hold covers it (p101) and the scene simulates the same on every visit. `terrain()` (p306), `instancing()` with its static instances and scatter (p308) and `surfaceConditions()` (p307) are in the template's `features`; the scene JSON's fields name them in its feature manifest.

**Showcase tab** (scene-scoped, `_dbg__terrainShowcase.ts`: `createDebuggerTab({ …, sceneId: 'terrainShowcase' })`, removed on the scene's exit): block list (fly to), Rain shower / Dry / Snowfall scenarios, time of day, per-block technique toggles (material variants), debug views (`WEIGHTS`, `TAPS`, `WETNESS`), and the camera presets from §2.2.

---

## 4. Final handbook pass

1. **`docs/techniques/README.md` decision matrix**, filled with measured numbers from §2.3 (WebGPU, the recorded machine). The starting recommendations, confirmed or corrected by the measurements:

| Game type / camera          | Blend source                          | Packing                     | Anti-tiling                         | Projection                          | Far mode                  | Wet                 | Scatter / decals                     |
| --------------------------- | ------------------------------------- | --------------------------- | ----------------------------------- | ----------------------------------- | ------------------------- | ------------------- | ------------------------------------ |
| First person (open world)   | Splat map + rules                     | LITE (FULL on hero sets)    | HEX on dominant + DUAL_SCALE        | Triplanar, slope-gated on cliffs    | AVERAGE_COLOR from ~150 m | FULL                | Dense pebbles, rocks, decals         |
| Third person                | Vertex colour or splat + rules        | LITE                        | DUAL_SCALE (HEX dominant on HIGH)   | Triplanar slope-gated               | AVERAGE_COLOR             | FULL                | Rocks, decals                        |
| Top-down (ARPG, twin-stick) | Vertex colour, or colour map + detail | LITE / MINIMAL              | DUAL_SCALE                          | Biplanar on cliffs, or none         | COLOR_MAP                 | SIMPLE              | Larger rocks; decals read strongly   |
| Isometric / RTS             | Colour map + detail                   | MINIMAL                     | NONE / DUAL_SCALE                   | Planar                              | COLOR_MAP                 | SIMPLE              | Sparse big rocks; road/scorch decals |
| Side view (2.5D platformer) | Structure mode on terrain strips      | LITE                        | DUAL_SCALE                          | Triplanar (vertical faces dominate) | —                         | SIMPLE + streaks    | Foreground rocks                     |
| Racing / flight             | Rules + colour map far                | LITE                        | DUAL_SCALE (far scale matters most) | Slope-gated                         | COLOR_MAP early           | FULL near the track | Sparse; roadside decals              |
| Stylized (any camera)       | Vertex colour                         | MINIMAL or baked procedural | NONE                                | Planar / biplanar                   | AVERAGE_COLOR             | SIMPLE              | Low-poly procedural rocks            |
| Low-end tier (any)          | Vertex colour                         | MINIMAL                     | NONE                                | Planar + biplanar cliffs            | AVERAGE_COLOR early       | SIMPLE              | Minimal                              |

If p372 has landed, the matrix gets a "Static dressing" note (merge a block's props and cutout decals per material, `AUTO` groups) and the "start here" path links `terrain-modular-kits.md` for worlds built from modules or tiles; the gallery's measurement mode then records draws with and without merging.

2. **Every page's "Performance" section** gets its measured rows; every page's "Template file" points at existing files.
3. **A "start here" path** in the README: pick your camera → the matrix row → the pages to read, in order.
4. **`readme.md`:**
   - Features: terrain texturing (engine: texture sets, baker, terrain blocks, surface conditions, static instances, decal sets; toolkit: terrain library, material generator, procedural surfaces, scatter, decals, Blender add-on and templates);
   - a **highlight** with a showcase screenshot;
   - a short example (`terrainBlock.json` + `spawnTerrainBlock`);
   - commands (`fetchTextureSources`, `assets`).
5. **`CLAUDE.md`:** the root's Architecture gets a short "Terrain" section summarizing p302–p309 (where things live, binding budget, conventions, debug views) pointing at the nested files (`src/toolkit/terrain/CLAUDE.md`, the terrain, instancing and surface features' own), each listed in the map; the terrain feature's `CLAUDE.md` names the two scenes as the verification scenes for terrain plans, as `features/lod/CLAUDE.md` does `lodShowcase`. A new `###` section needs a Hub page's `aek:covers` (the terrain feature page's).
6. **Hub** (`hub/CLAUDE.md`), the epic's showcase:
   - the terrain feature page (`hub/pages/features/terrain/`, p303's) gets a `::: scene terrainShowcase` panel in its intro, the decision matrix (or a link to it) and a "start here" list of the handbook pages (`repo:` links); `aek:image` `scene:terrainShowcase`, and `aek:featured` only if it replaces one of the homepage's four;
   - the Hub images: `terrainGallery` and `terrainShowcase` join `OTHER_HUB_SCENES` (`src/app/examples/_dbg__exampleHub.ts`), so their drawer gets the "Hub" tab, and **Save Hub image** writes `<sceneId>.hub.png` into each scene's folder;
   - an example page for the geometry half of the toolkit (which has no example scene on the Hub; p620 D1 left it as an alternative): either a small example scene in `src/app/examples/terrain/` (a generated block with its collider, rules colours and a procedural scatter, its regions included by a `hub/pages/examples/terrain/` page), or `exampleToolkit` extended with the same. Ask which before Phase 4;
   - then `yarn hub:build` (a dead `hub:` link, a moved `#region` or an unknown scene id fails it).

---

## Phases

### Phase 1 — Gallery completion (§2)

1. Rows A–L (whatever previous plans haven't added), signposts, camera presets, solo + measurement mode with copy-out.
2. The scene runner: `terrainGallery` in `devTools/verify/scenes.config.ts` (its camera poses, the tab it opens), its baseline recorded (`yarn verify:scenes --only terrainGallery --update`).

**Exit:** every row renders on WebGPU and WebGL2, and a full row measurement completes and copies a table.

### Phase 2 — Showcase Blender blocks (§3.3–3.6)

1. Build Coast, Alpine, Wetlands and Bunker in Blender exactly as written. Where a step proves wrong, fix both this plan and the handbook page.
2. Export, JSONs, materials, scatter, decals.

3. `terrainShowcase` in `scenes.config.ts` with its baseline (sky paused, rain off, so the snapshot is stable; `?physicsProbe=N` checks the blocks' determinism).

**Exit:** all blocks spawn with colliders matching the wireframe; the character (if added) walks every block; `yarn verify:scenes --only terrainShowcase` passes in both worker targets.

### Phase 3 — Procedural block and scenarios

1. `showcaseProcedural`; Rain shower, Dry and Snowfall scenarios; day-night playing.

**Exit:** a full rain shower cycle (dry → soaked → puddles → drying) reads plausibly on every block, and the GPU cost of the wettest state is recorded.

### Phase 4 — Measurements, the handbook and the Hub (§4)

1. §4's steps 1-3 and 6 (the Hub), the Hub images saved.
2. `yarn sbp`: no terrain, scatter or surface code in the app's first download, and the banner's feature groups at 0.

**Exit:** no handbook page has a placeholder left; the README matrix has numbers; `yarn hub:build` passes.

### Phase 5 — Release

1. `readme.md`, `CLAUDE.md` (§4 steps 4-5), `CHANGELOG.md`.
2. App minor bump (scenes); engine/toolkit bumps if this plan touched them.
3. `yarn checkVersions --against main`.
4. Mark the plan done; it's the epic's last child, so the epic's own closing steps follow (p301).

---

## Risks

| Risk                                                   | Mitigation                                                                                                                          |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Blender steps drift from the installed Blender version | The add-on encapsulates the fragile steps; pages name the version they were verified with; Phase 2 corrects the text while building |
| Showcase too heavy for low-end machines                | The tab's tier switch (p305 variants); the gallery documents per-tier cost; the showcase is a demo, not a budget target             |
| Measurement noise                                      | Warm-up, 120-frame averages, fixed poses, PostFX off, one machine per table                                                         |
| Headless WebGPU doesn't render under WSL2              | `yarn verify:scenes` renders in the Windows Chrome on the real GPU there (`devTools/verify/CLAUDE.md`; `--webgl` is SwiftShader, too slow for these scenes); the GPU-ms tables need a headed browser on the recorded machine |
