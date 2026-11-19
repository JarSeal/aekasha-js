Status: in progress | Phases 1-2 implemented
Category: App, Terrain, Docs
Epic: p301_terrain-texturing-epic.md
Related: \_DONE_p309_terrain-decals.md (the decals this plan's scenes and blocks use; its As built lists have what landed, which differs from this plan's text in places: the strip cell is `tireTracks`, the structure leaks `leak01`-`leak03`; the add-on's Add Decal conforms with a 0.015 m offset and a subdivision level of its own, Export Decal Set writes the GLB and stubs; the gallery already has a Decals row, a Decals stage with the weathers and a bake bench for the decal generators, and `terrainBlockTest` a runtime decal walk; the handbook is `docs/techniques/terrain-decals.md`), \_DONE_p307_wet-and-dry-surface-states.md (the surface conditions and the wet response this plan's scenes show: its As built lists have the API that landed, the gallery's Wet/dry row and the measurements; the handbook's `wet-dry-surfaces.md`), \_DONE_p370_static-mesh-merging-and-texture-atlas-systems.md (merged dressing and modular kit terrain, for the matrix and the measurements)

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
| — Orientation | A block with a corner-marker splat: `terrainBlockTest`'s (`blenderBlock/`, p306 Phase 5)  | Splat/UV orientation check (p306)                                             |

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
  - reads the frame's GPU time from the engine's one frame record (`debug/_dbg__GPUFrameTimes.ts`: `_acquireGpuFrameTimes('RENDER')`, `_onGpuFrameTime`, `src/_engine/debug/CLAUDE.md`'s GPU timing), which sums every render context of the frame; it's `@internal` debug code, so the gallery reaches it through `onGpuFrameTime(listener)` on `aekasha/debug` (p304 Phase 6 added it: a RENDER hold while it's listened to, the frame's render ms to the listener, never called without timer queries), which the Procedural row's measurement (`_dbg__terrainGalleryProcedural.ts`: `measureBlocksAsync`, a block alone in a fixed pose, an empty frame and each mode, 120 frames after 30, a markdown table copied) already uses: generalize that to every row, with the canvas size and the tiers;
  - averages 120 frames after a 30-frame warm-up;
  - records `{ row, block, technique, tier, packing, taps estimate, gpuMs, backend, adapter info }`.
- **Measure row:** runs every block of a row × every quality tier.
- **Copy results:** writes a markdown table to the clipboard to paste into the handbook pages. The machine (GPU, browser, OS) is in the table header. Numbers are only comparable within one machine; the handbook says so.
- On WebGL2 three's pool times one context at a time and loses the queries opened while a resolve polls, so only about two frames in three get a figure (the GPU timing notes): measurements are WebGPU-only for the tables and the tab says why.

---

## 3. `terrainShowcase`

**Scene:**

- `src/app/scenes/terrainShowcase/terrainShowcase.scene.json` + `terrainShowcase.ts`, sky box `terrainShowcaseSky` (the DAY_NIGHT preset as the shared `dayNight`, standing still at 10:30 for the snapshot; the shared one starts at 17:30 playing, dusk within seconds; Phase 3's tab plays the day).
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
    showcaseCoastTracks.material.json + .tsl.ts  (the tracks' decal material, tinted)
    showcaseCoast_pebbles.scatter.json, showcaseCoast_rocks.scatter.json
    terrainCoast.material.json + .tsl.ts    (terrain material: layers, techniques, wet)
```

A block another scene starts using moves to a shared `src/app/terrainBlocks/` (p306 D2), keeping its ids.

The Alpine block adds `showcaseAlpine_splat0.png` / `_splat1.png` + `.texture.json` (`data` slot, `codec: none`).

### 3.2 Common Blender steps (every block)

These follow `docs/techniques/terrain-blocks-blender.md` (p306). Summary:

`devTools/blender/buildShowcaseBlocks.py` follows these steps (a block per name argument; its header has the command).

1. **Open the template:** `src/toolkit/terrain/blender/terrain_blockTemplate.blend`. _Save As_ into the block folder in `src/app/scenes/terrainShowcase/blocks/<id>/<id>.blend`. Run `yarn fetchTextureSources` first so the preview material finds its images.
2. **Add the block:** delete the template's empty block first (`terrainBlock`, at grid (0, 0): _Add_ refuses a grid place a block has). Ækasha sidebar → _Add Terrain Block_: its id, size 64, resolution 129, grid (x, z) per the table. The object is named by its id.
3. **Set the preview material's layers** to the block's sets (sidebar → Preview Material, then _Update Preview_; it finds the sets' fetched `source/raw/` maps).
4. **Shape, paint and bake** (per-block steps below).
5. **Finish:** _Validate Block_, then _Export Block_. It writes the GLB and the JSON stubs.
6. **Fill in the JSON stubs** (`material`, `materialInputs`, `scatter`, `decals`) and create the terrain material JSON. An app material JSON (a terrain material, a tinted decal material) needs its own two-line TSL file beside it (`export const setup = setupTerrainMaterial;`, or `setupDecalMaterial`, from `aekasha/toolkit/terrain`): its `tslFile` resolves from `src/app/`. A `macro` in the define needs its `scale`.

### 3.3 `showcaseCoast`: step by step

1. **Shape** (Displace modifiers: Direction _Z_, Midlevel 0, _Global_ coordinates):
   - Dune swells: a _Clouds_ texture, size 18 m, depth 3, **contrast 1.6** (Clouds stays near its middle, 0.3-0.7, so 2.5 m read flat), strength 3 m, its _Vertex Group_ `Dunes` (Weight Paint's _Gradient_: 1 inland, fading to 0 over the 14 m before the south edge), so the beach under them stays smooth (without it the dunes reached the waterline and broke the beach band into blotches).
   - A second Displace with _Clouds_ size 4 m, strength 0.4 m.
   - Tilt toward the sea (the engine's +z, Blender's −Y): a Displace with a _Blend_ texture, **_Quadratic_**, strength −2 m, its _Texture Coordinates_ an **empty** scaled 32 and turned −90° about Z (a Blend texture spans −1..1 of its coordinates, which _Global_ can't scale; the empty's +x along −Y). The south edge sits about 1.8 m below the water level (0.5 m), the waterline about 22 m from it; a dune trough opened into an inlet that crosses the waterline, kept (the sea fills it).
   - Apply all modifiers.
2. **Cliff band** along the north edge:
   - Sculpt mode, Symmetry popover: **Lock X and Y** (checked in Blender 5.3: a _Draw_ stroke over a slope moved vertices 4.4 cm sideways unlocked, none locked).
   - _Draw_ / _Clay Strips_ upward to 6–9 m over about 4 m of run (its foot about 12 m from the north edge, winding; steep, but no overhang, so the heightfield stays valid). Built: 69° at the face's middle, 74° at its steepest.
   - _Smooth_ the top lip.
3. **Paint `Splat`** (Vertex Paint, _Mix_ blend, pure colours; the preview material shows the result; checked: pure red at strength 1 stores exactly 1 in the stroke's core, the other channels 0):
   - **R (`sand02`, beach sand):** a band from about 0.45 m over the water level to 0.35 m under it, soft edged: 6–10 m wide on this beach (about 0.1 m a metre).
   - **G (`rocks01`, gravel):** patches at the cliff foot and three islands in the dunes; strength 0.6–1 for broken edges.
   - **B (`cliffs01`):** the whole cliff face. Cliffs also get triplanar by slope, so paint loosely; the slope gate does the rest.
   - Leave everything else black (= `sand01`, dunes).
   - _Normalize Splat_.
4. **AO:** _Bake AO → Splat Alpha_ (distance 8 m, 64 samples). It darkens the cliff foot and the dune troughs.
5. **Custom props:** already set by the add-on. Add friction 1.0 in the `terrainBlock.json` collider.
6. **Decals** (the add-on's Decal Sets panel):
   - Select the block, _Add Decal Set_ (`showcaseCoast_decals`, atlas `decalsGround`).
   - _Add Decal_ → `tireTracks`, twice: each a strip along its own path; give the second the first's path (its Array's and Curve's object) and move each strip's mesh 0.85 m aside in Edit mode. The path runs out of the dunes onto the beach and ends at the waterline, west of the inlet (lowest ground under it 0.55 m).
   - The tracks' own albedo read blue-grey on `sand01` (a decal's albedo replaces the ground's): the set's material is `showcaseCoastTracks`, `decalsGround_blend` with `"tint": "#d2ad7c"` (and its TSL file).
   - _Export Decal Set_: `showcaseCoast_decals.glb` and its stubs.
7. **Scatter:** no Blender scatter here. It's procedural, two scatters (a scatter has one source): `showcaseCoast_pebbles` (pebbles on layer 2, `rocks01`, slopes under 30°, in clusters) and `showcaseCoast_rocks` (rocks where the ground turns up into the cliff: slope 24–45°, 1.2–5 m high, so not on the dunes' flanks or the waterline; casting shadows), both `rockScatter` over `rocks01`.
8. **Material** `terrainCoast.material.json`:
   - layers `sand01`, `sand02`, `rocks01`, `cliffs01`, as a set array (`inputs.layers`: `{ textureSetArray, packing: LITE }`, and the scene's `textureSetArrays` entry): `HEX` on `DOMINANT` samples in slots, which needs `ARRAY`;
   - `blend.source: VERTEX_COLOR`, `RGB_AO`, HEIGHT blend; `ao.vertex`;
   - `antiTiling: { mode: HEX, apply: DOMINANT }` (the other layers `DUAL_SCALE`);
   - cliffs layer `projection: TRIPLANAR` with `slopeGate: [35, 50]`;
   - `macro: { scale: 64 }` (the input `macro`: `macroNoise`);
   - `wet: { shoreline: { band: 1.5, noise: 0.5, runUp: {} }, puddles: {}, ripples: {} }` (the input `ripples`: `rippleAtlas`).
9. **Scene:** `waterLevel: 0.5`, plus a still sea plane (a simple dark material) 160 m square around the coast (its inlet included; the plateau stands over it), short of the other blocks. Water rendering is out of scope; the plane only shows the shoreline.

### 3.4 `showcaseAlpine`: step by step

1. **Shape** (_Add Terrain Block_ with Splat Layout **RGBA**: two splat maps make 8 painted layers, the first map's A layer 4):
   - A Displace with a large _Clouds_ (size 40 m, contrast 1.4, strength 18 m) and a _Blend_ (_Linear_ through an empty, the Coast's way, strength 8 m) for one main ridge rising toward +X, both with the _Vertex Group_ `Ridge` (1 north of z −2, fading to 0 by z +26: a slope of about 28 m down to a flat south part; a fade over 12 m made a cliff wall across the block, which the cliff rule painted).
   - A second Displace (size 8 m, strength 2 m), its group `Relief` (0.3 on the flat part).
   - Sculpt (X/Y locked):
     - a steep rock band (26 m long, 8 m high) facing north: a **scarp**, the ground north of it lowered to the north edge, its ends ramping back up over 12 m (a carve that faded out on every side made a rectangular quarry walled by cliffs). Built: 69° on its face, 74° at its steepest;
     - a shallow bowl (12 m across, 0.6 m deep, flat-bottomed with a sharp rim) on the flat south part for the frozen pond.
2. **UVs:** done by the add-on. Verify against the orientation block.
3. **Splat maps** (Texture Paint):
   - _New Splat Map_ (1024²), then _New Splat Map_ with _Map_ **Layers 5-8**: `showcaseAlpine_splat0` and `_splat1`, Non-Color, black, RGBA, alpha 0, both drawn by the block's preview material (the add-on's second map, this phase's addition; the preview's layers 5-8 under layer 4).
   - Paint with pure-colour brushes, one channel per layer:
     - **`splat0.R` (`grass02`):** forest-floor patches on the lower slope.
     - **`splat0.G` (`rocks02`):** scree below the rock band.
     - **`splat0.B` (`cliffs02`):** the rock band.
     - **`splat0.A` (`snow01`):** snow drifts in a few hollows. Painting alpha: brush blend _Add Alpha_ (checked in Blender 5.3: A to 1, RGB untouched). The rest of the snow comes from rules.
     - **`splat1.R` (`snow02`):** wind-swept crest.
     - **`splat1.G` (`ice01`):** the pond bowl, sharp edge.
   - **Save as 8-bit PNG** next to the `.blend` (_Image → Save As_): Export writes the PNGs beside the GLB too, but the `.blend` keeps a map's paint only as a file.
4. **No vertex AO** on this block. The splat technique demo keeps vertex colours empty; the colour-map variation (§5) bakes AO into a colour map instead.
5. **Scatter** (Blender GN, to demonstrate the imported path; the handbook's way: a scatter object of its own, not a modifier on the block, which Export writes as it is):
   - A collection of 3 boulders: the toolkit's `namaqualandBoulder02` (its GLB imported, 1,500 triangles, its own maps) in three shapes (scaled and applied: as is, 0.8 × 1.35 × 1.4, 1.25 × 0.9 × 1.2).
   - The template's `AekTerrainScatter` group (`terrain_scatter.blend`) on an empty mesh object at the block's place, its `Splat` read swapped for an _Image Texture_ of `splat0` at the `UVMap` (Layer G 1, R 0):
     - _Distribute Points on Faces_ (Poisson, min 2.5 m, density 0.3 where the scree is 1);
     - _Instance on Points_ (random pick);
     - random Z rotation, scale 0.8–1.6;
     - aligned to the normal by 0.5;
     - sunk 0.3 m × the scale.
     - 13 boulders.
   - The colliders are the scatter JSON's items' `collider: "CONVEXHULL"` (there's no custom prop for it).
   - Export with GPU instances as `showcaseAlpine_scatter.glb` (UVs on: the boulder's own maps), the block and the scatter object moved to the origin for it (the block's at x 128 in the file).
6. **Decals:** _Add Decal Set_, two `iceCrack` quads (_Add Decal_) on the pond, exported as `showcaseAlpine_decals.glb`.
7. **Material** `terrainAlpine.material.json`:
   - 7 layers, `SPLAT_MAP_AND_RULES` (two maps: the inputs `splat0`, `splat1`), HEIGHT blend;
   - rule: `snow01` above 18 m, slope < 35°, aspect north ±70°, noise 0.3 (scale 24 m);
   - rule: `cliffs02` above 45° slope;
   - `ARRAY` storage (the input `layers`, a set array of the 7, and the scene's `textureSetArrays` entry), `sparse: { maxLayers: 3 }`, `DUAL_SCALE` (sparse sampling takes one anti-tiling mode for every layer);
   - TRIPLANAR slope-gated (35-50°) on `cliffs02`;
   - `macro: { scale: 64 }` (the rule's noise reads it);
   - `wet: { snow: {} }` with the input `snow: { textureSet: 'snow01' }` (the code route's `snowSet`, default `snow01`), so `snowCoverage` (p307) adds snow everywhere.

### 3.5 `showcaseWetlands`: step by step

1. **Shape:**
   - Almost flat: Displace _Clouds_ 25 m / 0.8 m plus 5 m / 0.15 m (applied: 0-0.7 m).
   - Sculpt (locked) a meandering shallow channel (0.3–0.5 m deep, 2–3 m wide, north to south) and two hollows for puddles (0.25 m deep).
   - Flatten a pad for the bunker (§3.6; Sculpt's _Flatten_, locked): 18 × 12 m at the engine's local (15, −15), 9 m from the channel, 0.58 m high.
2. **Paint `Splat`:**
   - **R (`mud02`):** the channel, its banks and the hollows.
   - **G (`grass02`):** the raised areas.
   - **B (`rocks01`):** a gravel path crossing the channel (a ford), west to east, and the bunker's pad.
   - Base: `mud01`.
   - _Normalize Splat_.
3. **AO:** _Bake AO → Splat Alpha_ (distance 4 m).
4. **Regional wetness** (`_WETNESS`, float, point domain; `wet-dry-surfaces.md`'s way, not a colour attribute):
   - Weight Paint a vertex group `Wet`: 1 in and by the channel and the hollows, blurred out over 3-4 m.
   - Geometry Nodes modifier, last in the stack: _Store Named Attribute_ (_Float_, _Point_) `_WETNESS` from a _Named Attribute_ `Wet` (Float). Keep it: Validate warns of an unapplied modifier and accepts it, Export applies it.
   - Export keeps `_`-prefixed attributes (_Attributes_ ✓): the GLB's `_WETNESS` a float scalar a vertex, kept a float by the lossless `terrainBlock` profile.
5. **Decals:**
   - _Add Decal Set_; tyre ruts along the path through the ford (two `tireTracks` strips on one path, as the Coast's; the puddle mask in the cell's A makes them fill with water).
   - Three `mudSplatter` quads on the channel's banks.
   - The ruts' own albedo barely showed on the pale `rocks01`: the set's material is `showcaseWetlandsRuts`, `decalsGround_blend` with `"tint": "#7a6e60"` (the splatters share it).
   - _Export Decal Set_: `showcaseWetlands_decals.glb`.
6. **Scatter:** procedural `showcaseWetlands_litter.scatter.json` (leaf cards on `grass02`, layer 2, and thinner on `mud02`, layer 1; `minSpacing` 0.3, 8 m cells) and `_rocks.scatter.json` (pebbles and a few small rocks on `rocks01`, layer 3: the path and the pad).
7. **Material** `terrainWetlands.material.json`:
   - `VERTEX_COLOR` `RGB_AO`, HEIGHT blend, `ao.vertex`, DUAL_SCALE;
   - `wet: { puddles: { maxSlope: 8 }, ripples: {}, regional: {} }` (the input `ripples`: `rippleAtlas`): the attribute is `_wetness`, the default (three's GLTFLoader lowercases glTF's `_WETNESS`, so naming it `_WETNESS` would read nothing). This block is the first `_WETNESS` loaded from a GLB (the gallery's band is made in code): checked in the `WETNESS` view (section 3's As built).

### 3.6 `showcaseBunker`: step by step (structure)

1. **Open** `src/toolkit/terrain/blender/structure_concrete.blend` and _Save As_ `src/app/scenes/terrainShowcase/blocks/showcaseWetlands/showcaseBunker.blend`; delete the template's pieces (its preview materials stay).
2. **Model** a 6 × 4 × 2.6 m bunker (walls and roof 0.4 m, a 1 × 2 m doorway toward −Y, the engine's +z) and a 12 m wall segment (0.4 m thick, 2.5 m high), with simple bevels (Bevel modifier, 0.03 m, 2 segments, limit by angle, then apply).
   - **Vertices for the wear** (`structure-materials.md` step 3): faces cut every 0.35 m, as the template's pieces (built from its extruded profiles, `extrude_piece`, joined).
   - **No UVs needed:** world/object triplanar.
   - Apply scale; origin at the bottom centre.
3. **Wear** (vertex colours: the template's `Wear`, byte, on vertices, the active colour; its layers `concrete01`, then R, G, B):
   - **R (`concrete02`, damaged):** corners and edges. _Dirty Vertex Colors_ as a starting point (its brightest tenth, the convex edges: the colour reads back linear, so take its own percentiles), broken up, then paint.
   - **G (`mud01`):** stains running down from the roof edge and grime at the foot. A layer, not a "multiply tint" (the structure material has none), at partial weights (0.75 at most): full weights read as black rot, half ones vanish under the height blend.
   - **B (`rocks02`):** a few chips.
4. **Decals:** two leak quads under the roof edge (`leak01`, `leak03` from `decalsStructure`, 2 × 2 m), 0.01 m off the front wall. Not _Add Decal_ (it needs a block and projects along Z): the add-on's decal mesh by hand, a plane with `UVMap` in the cell and `DecalUV` 0..1, turned onto the wall; exported with the decal sets' settings in the bunker's space (`showcaseBunker_leaks.glb`), a decal set of the scene's own spawned at the bunker's transform.
5. **Collider:** box nodes under each piece, colliders only (custom props `isPhysObj`, `colliderType: "CUBOID"`, `index`; the first of each index `rigidType: "FIXED"`): the bunker's roof, back, sides, the front either side of the doorway and its lintel (index 0, the doorway open), the wall's (index 1). Not the pieces themselves: a box is centred on its node's origin, at the piece's foot.
6. **Export** the pieces and their boxes (_Selected Objects_; the add-on's locked settings without UVs) as `showcaseBunker.glb`. They're placed on the Wetlands block's pad by the scene code (`spawnImportedAsset` with `structureBunker`; or with a `parentBlock` in a structures list, a follow-up).

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

**Showcase tab** (scene-scoped, `_dbg__terrainShowcase.ts`: `createDebuggerTab({ …, sceneId: 'terrainShowcase' })`, removed on the scene's exit): block list (the player put on the block), Rain shower / Dry / Snowfall scenarios, time of day and the day playing, per-block technique toggles (material variants), the quality tier and debug views (`WEIGHTS`, `TAPS`, `WETNESS`). No camera presets (decided in Phase 3): the follow camera on the player is the showcase's view, the gallery has §2.2's.

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

### Phase 1 — Gallery completion (§2) — done

1. Rows A–L (whatever previous plans haven't added), signposts, camera presets, solo + measurement mode with copy-out.
2. The scene runner: `terrainGallery` in `devTools/verify/scenes.config.ts` (its camera poses, the tab it opens), its baseline recorded (`yarn verify:scenes --only terrainGallery --update`).

Found when it started (2026-11-19), and decided:

- **The rows p303-p309 built:** A Library (`terrainGallery.ts`, with the tab's Terrain / Terrain (code) / Baseline switch), C Anti-tiling, D Splatting (vertex colour and splat map, `LINEAR` beside `HEIGHT`, `RGB_AO`, 9 layers; sparse through the quality tiers), E Rules (`rulesRow.ts`; the CPU-against-shader A/B is the Blocks patch's, `patchRow.ts`), F Cliffs, G Procedural, H Colour map, I Structures (no leak decals yet), J Wet/dry, K Scatter, L Decals (the atlas panels, the stage and the bake bench; no footprint pad), plus the Live block and the Blocks patch. **Missing:** B Packing as a row (today a switch on the library's three sets, one packing at a time), I's leak decals, L's footprint pad, the Orientation block, the signposts, the camera presets, and a measurement every row shares (the Procedural row's `measureBlocksAsync` and the Live block's measure their own blocks only).
- **The layout isn't rows along +Z:** p303-p309 placed each row where it fit (the library in the middle, rows on every side, the patch behind). It stays; the signposts and a Rows list in the tab say what's where.
- **One registry of the rows** (`_dbg__terrainGalleryRows.ts`, debug only): each row's letter, title, bounds and blocks (key, label, app ids, centre, size, whether the quality tiers apply), read by the signposts, the presets and the measurement, so a row added later is one entry.
- **Signposts without entities:** one world anchor layer (`createWorldAnchorLayer`) under the HUD root, an anchor per row placed by `setPosition` at the row's front edge, projected by `registerWorldAnchorSync` (it updates every anchor of its layer, not only the entities'); removed on the scene's exit (`unregisterWorldAnchorSync`, the layer's CMP).
- **The canvas:** the engine owns its size, so the measurement doesn't resize it: it sets the pixel ratio to 1 while it runs, records the canvas's size in the table's header and warns when it isn't 1920 × 1080 (a bench script sets the viewport). PostFX: the gallery has none. Shadows: off (`NO_SHADOWS`, `docs/issues/vsm-stripes-on-unshadowed-slopes.md` still open), which the table's header says. The sky already stands still.
- **The Orientation block** (`terrainBlockTest`'s `blenderBlock/`) becomes a second scene's asset, so it moves to the shared `src/app/terrainBlocks/` (p306 D2: a new `APP_ASSET_FOLDERS` entry), its ids kept.

Sections:

1. The row registry, the signposts and the Rows list — done. As built:
   - **`_dbg__terrainGalleryRows.ts`:** `GALLERY_ROWS` (`GalleryRow`: `id`, `letter`, `title`, `shows`, `bounds`, `getY()`, `getBlocks()` returning `GalleryRowBlock`s `{ key, label, x, y, z, size }`), by letter: A Library, C Anti-tiling, D Splatting, E Rules and E Blocks patch, F Cliffs, G Procedural and G Live block, H Colour map, I Structures, J Wet/dry, K Scatter, L Decals (the stage's two blocks and the bench; the atlas panels are in the row's bounds). B and the Orientation block join in section 3. `getGalleryRow(id)`, `getRowPose(row)`.
   - **Signposts:** `setGallerySignposts(isShown)` / `hideGallerySignposts()`: a world anchor layer (class `terrainGallerySignposts`) under the HUD root, an anchor per row (`A · Library`, `align: 'above'`) 2 m above the middle of its front edge (+z), and `registerWorldAnchorSync` with no entities; the tab's exit cleanup removes both. From the overview a row whose front edge is behind the camera hides its sign, as an anchor does.
   - **The tab:** a "Signposts" switch (saved, on by default) and a "Rows" list (the letter and title, what it shows, its block count) above the Texture sets list, flying to the row's overview; its selection clears with the other lists'. `getBoundsPose` (the Decals section's overview pose) moved to `_dbg__terrainGalleryCamera.ts` for both. The overview doesn't allow for the open drawer, which covers a wide row's right side.
   - Checked on WebGPU (Windows Chrome, RDNA 3; `.cache/look/p310s1.mts`): the gallery loads without new warnings, the signposts in view show, and the Rules and Scatter rows' flights frame them. `yarn test` passes.
2. The camera presets (§2.2): the six poses and FOVs relative to the selected block, the flyover — done. As built:
   - **`_dbg__terrainGalleryPresets.ts`:** the tab's Camera presets section after the Rows list: a Block select (every block of `GALLERY_ROWS`, `A Library: grass01`), a button per preset with its FOV in its text (`First person (75°)`; a button with a grid `label` takes it as its accessible name, so the FOV can't go there), Overview (50°, the scene camera's pose) and a Why line. The library and Rows lists' clicks select their block (`setPresetBlock`; the Rows list its row's first); the other rows' lists don't yet, the select does.
   - **Poses** (the block's front is +z, as the overview's): the ground under a point is a ray down onto the highest visible mesh. First person: the eye 1.7 m over the ground 0.35 of the block in front of its centre, 10° down. Third person: a player 0.15 in front of the centre, the camera 6 m behind and 2.5 m over it, looking 1 m over its feet. Top-down: 30 m over the centre at 55°. Isometric: 120 m out at 35°, turned 45° toward +x. Side view: level at the middle of the centre's and the +x edge's heights plus 1 m, 15 m out from the +x edge, looking −x (the Cliffs row's mesa faces +x with its steep face). Flight: `startGalleryFlyover`, along −z at the block's x from 300 m in front to 300 m behind, 15 m over the centre's ground at 60 m/s, looking 60 m ahead, looping until another flight.
   - **The camera module:** every flight eases the FOV too (`GalleryCameraPose.fov`, default `GALLERY_DEFAULT_FOV` 50, so a list's flight after a preset puts it back), a hold sets the pose's FOV and its restore the one it found, and the flyover is the flight's looper (`stopGalleryFlight` and any flight end it).
   - Checked on WebGPU (`.cache/look/p310s2.mts`, `p310s2side.mts`): each preset's pose and FOV on grass01, the side view on the Cliffs row's slope-gated block (its steep face head-on), the flyover over the Rules row's 8-layer block. Under the test bridge's clock (1/60 s a frame) a flight over a slow row takes longer than 0.8 s of wall time.

3. The missing rows: B Packing (3 sets × 3 packings side by side), I's leak decals, L's footprint pad (click to stamp, wet toggle), the Orientation block (moved to `src/app/terrainBlocks/`) — done. As built:
   - **B Packing** (`packingRow.ts`): sand01, grass01 and cliffs01 (a row each from the back) in `FULL`, `LITE` and `MINIMAL` (left to right) on 12 m library blocks, one seed a set (310-312), cliffs01 with the library's wall, at x −144…−96, z −96…−48 (left of the Anti-tiling row, behind the Wet/dry row; the ground's back edge follows it). The scene's load loads the six other packings (`loadTextureSetAsync`: the scene's). The tab swaps their variants with the library's (material, debug view, tier; `swapSurface` takes the block's packing) and covers them with the checker. A **Time of day** slider (5-20 h, the scene's 10:00 on each visit) in the main pane shows the AO-in-albedo difference under a low sun: at 17:30 `MINIMAL` reads flattest, `FULL` deepest.
   - **I's leaks** (`structuresRow.ts`): `decalsStructure`'s leak01-03 on the wall's front under its top (2 m, the cells' size; across the joint) and leak02-03 at 1.5 m beside the bunker's doorway under its roof (its front narrows), quads from the Decals stage (`getDecalQuadGeometry`, `getDecalCellSize` now exported, `DECAL_RENDER_ORDER`) in `decalsStructure_blend`, coplanar with the faces (the wear's impacts paint colour only). Their own app ids (`getStructuresLeakAppIds`), so the row's material swap leaves them alone. (Invisible, it turned out: the grey streaks taken for them were the wall's wear; the atlas's leak cells were nearly transparent until Phase 2 section 4 fixed their recipes.)
   - **L's footprint pad** (`padBlock.ts`, `pad/terrainGalleryPad.terrainBlock.json`, `pad/terrainGalleryPad.material.json` and its TSL file; `_dbg__terrainGalleryPad.ts`): `spawnDecal` needs a terrain block, so the pad is one: a 16 m `noiseTerrain` block (0.5 m, 65 vertices a side, no collider) at grid (9, 2), in front of the Decals stage, in a terrain material of mud02 with puddles and ripples (the JSON route needs the `ripples` input named). The tab's Footprint pad section: "Stamp on click" (a press and release within 4 px on the canvas, a ray onto the pad's mesh; the toe away from the camera, the walk's rotation), the cell (the four footprints), Wet (the Decals section's dry and wet), the count of a 64-decal pool made with the first stamp, Clear, and the camera over the pad.
   - **The Orientation block** (`orientationBlock.ts`, `_dbg__terrainGalleryOrientation.ts`): `terrainBlockTest`'s `blenderBlock/` moved to `src/app/terrainBlocks/terrainBlockTestBlender/` (`git mv`; `terrainBlocks` in `APP_ASSET_FOLDERS`; the JSONs' `$schema` and `tslFile`, `exportOrientationBlock.py`'s folder, the comments, the terrain feature's `CLAUDE.md`, `terrain-blocks-blender.md` and the root `CLAUDE.md`'s app layout updated; `yarn assets` moved the outputs, same hashes, and pruned the old). A block has no spawn place but its grid, and the splat map twin's (−2, 3) is on the Rules row, so the gallery spawns the vertex colour block alone at (−3, 3) (x −112…−80, z 80…112, free) and the section switches its material to the twin's (`terrainBlockTestBlenderSplat`, which the scene lists); `terrainBlockTest` is unchanged. Its registry row is `—` Orientation.
   - Checked on WebGPU (`.cache/look/p310s3.mts`, `p310s3pad.mts`, `p310s3orient.mts`): the Packing row at 10:00 and 17:30; the leaks on the wall and the bunker; six clicks stamp six prints where they land and a drag none, dry and wet; the Orientation block from above in both sources, the markers on the same corners; `terrainBlockTest` loads its moved block. No new console messages. `yarn test` passes.
4. The measurement mode (§2.3): solo, a block × the tiers, a row, the copied table with the machine; the Procedural and Live measurements on the same sampler — done. As built:
   - **`_dbg__terrainGalleryMeasure.ts`:** the sampler (`sampleFrameGpuMsAsync`, 120 frames after 30 of `onGpuFrameTime`, moved from the Procedural module with `hideMeshes`), the conditions every gallery measurement shares (`startMeasureConditions`: the pixel ratio 1, the day-night cycle paused; both put back) and the heading (`getMeasureHeading`: the backend, the GPU as the adapter names it, the browser with Chromium's full version from its client hints, the canvas, "no PostFX, no shadows, the sky still", and a line when the canvas isn't 1920 × 1080: the engine owns its size, so a bench sets the viewport). The Procedural row's and the Live block's measurements use all three.
   - **What a block is** (no app id list per row: scatter cells, decals and walls have none): the scene root's children whose world box's middle stands on the block's square, under 200 m wide; wider ones (the ground, the sky) stay in every frame, with the lights and cameras, and the rest is hidden. The pose is `getMeasurePose` (the Procedural row's, scaled by the block's side and lifted to its ground).
   - **The section** (after the camera presets; its block is the presets' Block): Solo (the block alone in its pose, all put back when off), Measure block and Measure row (each block: the frame with it hidden, then shown at each tier when its row `takesTiers`, the library, Packing, Splatting, Rules, Colour map and Live rows, through the tab's own Quality, put back after; the others once at their own), Copy results and Clear results (every result of the visit as one table: row, block, tier, packing, the frame, the empty frame and the block's difference; a block measured again replaces its rows), the status, and the backend: on WebGL2 the buttons are disabled with why (the GPU timing notes: about two frames in three get a figure). `window.__terrainGalleryMeasure` (`measureBlockAsync(rowId, key)`, `measureRowAsync(rowId)`, `getTable()`, `results`) runs on either backend, for a bench.
   - **No taps column:** `estimateTerrainFetches` builds the `TAPS` view's node, not a CPU figure; the section's hint points at the view.
   - **Measured** (the exit's check; Windows Chrome 157, RDNA 3, 1920 × 1080; `.cache/look/p310s4.mts`): the Packing row's nine blocks × the empty frame and five tiers in 61 s, the table returned and copied. A 12 m block in its pose costs 0.12-0.17 ms at Own, LOW and MEDIUM whatever its packing, 0.21-0.27 ms at HIGH and ULTRA (`HEX`); the empty frame 0.21. Phase 4's tables come from these runs. The Anti-tiling `HEX` block alone 0.15; the Procedural row's `sandRipples` on the moved sampler (imported and baked 0.23, live 0.46, live with taps 3.10). Solo on the Rules row's 8-layer block shows it alone, and off puts the rest and the camera back. `yarn test` passes.
5. The scene runner's entry and baseline, the exit's checks on WebGPU and WebGL2, the docs (the scene's description, `src/toolkit/terrain/CLAUDE.md`'s verification line) — done. As built:
   - **The scene runner:** `terrainGallery`'s entry was there (p303: `debugger: { tabs: ['terrainGallery'] }`); the runner has no camera poses of its own (the snapshot is the scene camera's overview), so nothing was added. The local WebGPU baselines dated from 2026-11-17, before p309's last sections, so they were recorded on this branch: `yarn verify:scenes --only terrainGallery,terrainBlockTest --update`, all nine configurations without an error or an axe violation (the `debugger` configuration's shot and axe check of the longer tab), 186 s. `terrainBlockTest`'s probe hash is its 11-17 one (`97177281`): the moved block changed nothing there. Main's baselines weren't recorded first: a PR run compares against these.
   - **WebGL2:** every row's overview on three's WebGL2 backend, forced in the Windows Chrome (the localStorage key `debugRenderer`, `{ forceWebGL: true }`; `Renderer.ts`' JSDoc says `AEK_debugRenderer`) on the real GPU: all 15 render, no console error, the measure buttons disabled with the reason (`.cache/look/p310s5gl.mts`). The Procedural row's own Measure row stays enabled there (p304's, which warns when no frame times come).
   - **Docs:** the scene JSON's name and description (the Packing row, the leaks, the pad, the Orientation block, the tab's additions), the scene file's header, and `src/toolkit/terrain/CLAUDE.md`'s Verification line (the rows by letter, the presets, the measurement mode and its handle).

**Exit:** every row renders on WebGPU and WebGL2, and a full row measurement completes and copies a table. Met: every row on WebGPU (sections 1-4's shots, the scene runner) and WebGL2 (section 5); the Packing row's full measurement (9 blocks × the empty frame and 5 tiers) completed in 61 s and copied its table (section 4).

### Phase 2 — Showcase Blender blocks (§3.3–3.6) — done

1. Build Coast, Alpine, Wetlands and Bunker in Blender exactly as written. Where a step proves wrong, fix both this plan and the handbook page.
2. Export, JSONs, materials, scatter, decals.

3. `terrainShowcase` in `scenes.config.ts` with its baseline (sky paused, rain off, so the snapshot is stable; `?physicsProbe=N` checks the blocks' determinism).

**Exit:** all blocks spawn with colliders matching the wireframe; the character (if added) walks every block; `yarn verify:scenes --only terrainShowcase` passes in both worker targets. Met: the colliders match the meshes within 0.02 mm (rays, section 5; the boulders' hulls and the bunker's boxes where they should be); the player lands and walks on every block; the scene runner passes in all four configurations.

Found when it started (2026-11-19), and decided:

- **Every Blender asset so far is a build script** (the templates, `buildTerrainTemplates.py`; `terrainBlockTest`'s orientation and decal blocks, `exportOrientationBlock.py`, `buildDecalTest.py`; `buildScatterTest.py`): a background Blender (`.tools/blender-mcp/blender-path`, the Windows Blender 5.3) running the add-on's operators as an artist would, its sculpt and paint strokes as height and colour functions, so the asset can be made again. **Decided (asked):** the showcase blocks are built the same way, by `devTools/blender/buildShowcaseBlocks.py` (a block per name argument, as the template builder's), following §3.3-3.6 (the add-on's Add, Displace modifiers with Blender's textures, Normalize, Bake AO, Validate, Export, the decal operators; the strokes as functions), saving each `.blend` beside its block. The steps only a person does (Sculpt with X and Y locked, Vertex Paint, Texture Paint's _Add Alpha_, a Geometry Nodes density from an image) are tried once in the open Blender through the MCP on a scratch file (the open file was empty and unsaved), and a step that fails is fixed in this plan and its handbook page.
- **§3.3-3.6 predate p309's decal tools:** the add-on's _Add Decal Set_ / _Add Decal_ (a strip along its own path for `tireTracks`, the Array, AEK Decal, Curve and Shrinkwrap made for you) / _Export Decal Set_ replace "a plane UV'd to the cell, Array, Curve, Shrinkwrap, apply". The cells are `tireTracks` (not `tyreTracks`), `iceCrack`, `mudSplatter`, `leak01`-`leak03`. The decal set exports in its block's space; a wall's decals (the bunker's leaks) aren't what Add Decal makes (it projects along Z onto the block): the handbook's structure route is a set of the scene's own, exported by hand.
- **The add-on makes one splat map:** _New Splat Map_ makes `<id>_splat0` and the preview draws the base and four layers; Export already saves an `<id>_splat1` when the file has one (`BLOCK_IMAGES`). §3.4's "two _Image Texture_ nodes on the preview material" don't exist. **Decided (asked):** the add-on grows a second map: _New Splat Map_ takes the map (`splat0`, `splat1`), and a block with both draws layers 5-8 from the second (a toolkit patch; `verify:blender`'s splat map check covers it).
- **Material facts against §3.3-3.6:** `HEX` with `apply: 'DOMINANT'` (Coast) samples in slots, which needs `ARRAY` storage, so Coast's material is an array material too (a `layers` `{ textureSetArray, packing }` input and the scene's `textureSetArrays` entry, as the gallery's); one projected layer (`cliffs01`'s slope-gated `TRIPLANAR`) beside planar ones is allowed under slots. Rules have `aspect` (`{ direction, … }`), so Alpine's north-facing snow rule is expressible. There's no `aekScatterCollider` custom prop: a scatter item's collider is its `collider` in the `*.scatter.json` (`CONVEXHULL`). The structure material has no "multiply tint": the wear's channels are layers (§3.6's G becomes a stain layer, as the template's `Wear`: concrete, then stains, grime, chips).
- **Boulders:** Poly Haven's `boulder_01` doesn't decimate (`terrain-scatter.md`: 84 % of its vertices on UV seams); the toolkit's `namaqualandBoulder02` (1,500 triangles, its own maps, `rockScatterNamaqualandBoulder02`) is Alpine's boulder, imported into the `.blend` from its committed GLB, its scatter GLB exported with UVs.
- **Regional wetness:** §3.5 paints a `WetPaint` colour and applies a GN modifier; `wet-dry-surfaces.md` paints a vertex group `Wet` and keeps the modifier last (Export applies it). The handbook's is the one built and checked; this plan's text follows it. The block profile's handling of `_WETNESS` (`terrainBlock`, lossless) is checked on the output.
- **Texture sources:** `sand02`, `cliffs02`, `snow02`, `ice01` and `mud02` aren't fetched on this machine; `yarn fetchTextureSources --only …` first (§3.2 step 1), for the previews.
- **The scene** (§3.7) is made in this phase as far as the exit needs it: the blocks, the bunker, the sea plane and `waterLevel`, the sky box (`dayNight`, standing still for the snapshot), the surface conditions dry; the scenarios, the procedural block and the day-night playing are Phase 3's. **Decided (asked):** the third-person character comes in this phase (the gym's dynamic controller, player brain and `FollowObjectCameraRig`, `src/app/shared/characterVisual.ts`), walking every block and stamping footprints into a pool on the block under it; its determinism checked on `MAIN_THREAD` as the gym's.
- **Where:** `src/app/scenes/terrainShowcase/blocks/<id>/` as §3.1 (the layout's scene rule covers any depth inside the scene's folder); the bunker in `blocks/showcaseWetlands/`.

Sections:

1. The build script's frame (§3.2: the template, Add, the preview's layers, Validate, Export, the stubs) and **`showcaseCoast`** (§3.3): shaped, the cliff band, the splat, the AO, its tyre-track decal set; its import, block, `terrainCoast` material (array, `HEX` dominant, the slope-gated cliffs, shoreline, puddles, ripples) and TSL file, the pebble and rock scatter; the interactive steps tried in the open Blender; the scene's first form (the Coast block, the sea plane, `waterLevel` 0.5) to look at it in the engine. §3.3 and the handbook pages corrected where a step proved wrong. As built:
   - **`devTools/blender/buildShowcaseBlocks.py`** (`blender -b --factory-startup --python-exit-code 1 --python buildShowcaseBlocks.py -- <addon.py> <repo root> <renders dir> [<block>...]`, about 20 s for the Coast): imports the template builder's helpers (`Grid`, `fbm`, `set_preview`, `validate`, `save`, `render`, `set_up_views`), so `buildTerrainTemplates.py`'s `main()` now runs only as the script (`if __name__ == "__main__"`; its arguments start as this script's). Per block: the template opened and saved as `<id>.blend` in its folder (its block and README dropped, its images no layer uses dropped, `//` paths with `/`: a Windows Blender's relative remap wrote `\`), Add, Update Preview, the plan's steps, Validate, a README text block, save, Export Block and Export Decal Set, a render pair into the renders folder. It prints the heights by row, the cliff's slopes, the splat's coverage and the lowest ground under a track's path. The block's GLB comes out byte for byte the same on a rebuild (the asset pipeline's cache hit).
   - **§3.2 and §3.3 corrected** to what was built (above): the template's block in the way of Add; the dunes' contrast and their vertex group; the tilt's Blend texture through an empty (Quadratic); the beach band's heights; the decal tools; the tracks' tint; two scatters; the array, the macro's scale; the TSL files. The Coast's numbers: 0.77 MB `.blend`, the GLB 864 KB → 303 KB (lossless meshopt), its decal set 133 KB → 30 KB; the splat over 0.5 on 11 % (sand02), 5 % (rocks01), 6 % (cliffs01) of its vertices.
   - **Checked in the open Blender 5.3** (a fresh empty file, put back empty): a Sculpt _Draw_ stroke with X and Y locked moves vertices in Z only, unlocked it moved them 4.4 cm sideways on a slope; a Vertex Paint stroke of pure red, _Mix_, strength 1 stores exactly 1 in R and 0 in G and B (the brush's falloff at the edge).
   - **The scene's first form:** `terrainShowcase.scene.json` (not a debug scene: the Hub shows it), `terrainShowcaseCamera`, `terrainShowcaseSky` (DAY_NIGHT still at 10:30: the shared `dayNight` starts at 17:30 and plays, so the coast was at dusk within seconds), `surfaceConditions` `SIMULATED`, dry, `waterLevel` 0.5, the Coast's set array; `terrainShowcase.ts` registers the toolkit's pebbles and rocks, spawns the block and lays the sea plane (160 m square, 0.75 opaque, no shadows).
   - **Looked at on WebGPU** (Windows Chrome 157, RDNA 3; `.cache/look/p310p2s1.mts`): the block loads without a warning of its own; the cliff triplanar, the shoreline's waves running up the beach and the inlet, the pebbles on the gravel and the rocks at the cliff foot, the tracks pressed into the sand to the waterline. `yarn test` passes.
   - **Handbook:** `terrain-blocks-blender.md` (a template's block at grid (0, 0) in the way of Add; a Displace masked by a vertex group, a Blend texture through an empty), `terrain-decals.md` (a tinted decal set material needs its own TSL file).
   - **The edges:** the blocks aren't "islands with sunk edges" (§3): the Coast's plateau ends in a 9 m cut at its north edge, seen from the north or above; the plan has no step for it. Decided in section 3: they stay as they are.
2. **The add-on's second splat map** (New Splat Map's map choice, the preview's layers 5-8, `verify:blender`) and **`showcaseAlpine`** (§3.4): the ridge, the rock band and the pond bowl, both splat maps, the Geometry Nodes boulder scatter exported as GPU instances (`namaqualandBoulder02`, colliders), the ice-crack decals, `terrainAlpine` (7 layers, `SPLAT_MAP_AND_RULES`, `ARRAY`, sparse top 3, snow). As built:
   - **The add-on (1.2.0, a toolkit change):** the preview's layers 5-8 (`layer5`-`layer8`, shown under layer 4 with the `RGBA` layout; `PREVIEW_LAYERS`, four more `FALLBACK_COLORS`), the preview group's inputs `Splat 2` and `Splat 2 Alpha` (its nodes for layers 5-8 built only when one is set); _New Splat Map_'s _Map_ (`Layers 1-4` → `<id>_splat0`, `Layers 5-8` → `<id>_splat1`; warns when the layout isn't `RGBA`); `ensure_splat_map_material` links both maps (the material's props `aekSplatMap`, `aekSplatMap1`, each image node tagged `aekSplatMapIndex`; a material made before keeps its one node as the first map's), the map just made the paint target, a relink (`update_splat_map_materials`) keeping the target. **A bug fixed:** Export skipped a block image that wasn't in memory (`has_data` false: a map saved as a file that nothing drew since, eg. a reopened `.blend`), silently: the second map and its stub weren't written. It reads the pixels first now, and warns of an image without any.
   - **`verify:blender`:** `check_splat_map` adds the second map (its stub, both maps feeding their inputs, the layer 6 quarter rendered beside the first map's layers, the target across a relink) and its export from its file with its buffers freed (fails without the fix). All checks pass, 13 s.
   - **`showcaseAlpine`** (`build_alpine`, about 25 s): its numbers in §3.4; the ridge to 22.4 m, 9 % of the block over 18 m; the splat maps over 0.5 on 10 % (grass02), 2 % (rocks02), 3 % (cliffs02), 2 % (snow01), 7 % (snow02), 2 % (ice01); 13 boulders. The GLB 864 KB → 272 KB, the scatter 296 KB → 255 KB (lossless; three boulder meshes and their GPU-instanced copies), the decals 10 → 5 KB, the maps 215 and 94 KB as they are (`data`, no codec; 5.6 MB VRAM each with mips).
   - **Its JSONs:** the material (`terrainAlpine`, its TSL file; the splat maps as the material's own inputs, not the block's `materialInputs`: one block draws it), the block (`scatter`, `decals`), the scatter (`IMPORTED`, `showcaseAlpine_scatter`'s node `showcaseAlpineBoulders`, three items in `rockScatterNamaqualandBoulder02` with `CONVEXHULL` colliders and shadows) and its lossless import, the decal set (`decalsGround_blend`), the maps' texture stubs. The scene lists the block and its set array; the scene file spawns it (`BLOCK_IDS`).
   - **Looked at on WebGPU** (`.cache/look/p310p2s2.mts`): the scarp in triplanar `cliffs02` with the scree and boulders at its foot, the rule's snow on the high north-facing slopes and the crest's `snow02`, the forest floor patches, the frozen pond; no warning of its own. `yarn test` passes.
   - **Checked in the open Blender 5.3:** Texture Paint's _Add Alpha_ on a Non-Color channel-packed map raises A to 1 and leaves RGB at 0.
   - **Handbook and docs:** `terrain-splat-map.md` (the second map's steps; save a painted map as a file), `terrain-scatter.md` (a splat-mapped block's mask in Geometry Nodes; rocks with their own maps; which objects move for the export), `terrain-blocks-blender.md` (eight preview layers), the Hub's terrain guide (the second map), the terrain feature's `CLAUDE.md` (New Splat Map's map, Export's fix), `devTools/verify/CLAUDE.md` (the check).
3. **`showcaseWetlands`** (§3.5): the channel and hollows, the splat and AO, `_WETNESS` from a painted vertex group (checked in the `WETNESS` view: the first one loaded from a GLB), the ruts and mud-splatter decals, the leaf litter and path rocks, `terrainWetlands`. As built:
   - **Decided (asked):** the blocks' edges stay as they are (no sunk edges; §3's "islands with sunk edges" isn't built).
   - **`build_wetlands`** (about 20 s; `add_track_pair` now takes the block's centre as the 3D cursor, since a strip's path sits there): §3.5 as written above, plus the bunker's pad (§3.6 needs a flat place). Its numbers: heights −0.17-0.70 m, the splat over 0.5 on 12 % (mud02), 15 % (grass02), 12 % (rocks01), `_WETNESS` over 0.5 on 15 % of the vertices and over 0 on 23 %. The GLB 930 KB → 317 KB (lossless; `_WETNESS` 66 KB of it), the decals 255 KB → 52 KB.
   - **Its JSONs:** the material and its TSL file, the block (`scatter`, `decals`), the litter and rocks scatters, the decal set in `showcaseWetlandsRuts` (its JSON and TSL file). The scene lists the block; its file registers the leaf card (`saveLeafCardGeometry`) and spawns it.
   - **Looked at on WebGPU** (`.cache/look/p310p2s3.mts`, which also swaps the block to its `WETNESS` variant): `_wetness` arrives as a `Float32Array` of 16 641 values, the view wet along the channel and in the hollows, fading; shaded, the channel stays glossy with standing water in dry weather; the leaf cards on the grass, pebbles on the path, the ruts through the ford, the splatters on the banks; no warning of its own.
   - **Handbook:** `wet-dry-surfaces.md` (the regional wetness checked from Blender to the engine; the encode keeps a float under `terrainBlock`, 16-bit only under the default encode; the worked block).
4. **`showcaseBunker`** (§3.6): from `structure_concrete.blend`, the bunker and the wall segment with their wear, the leak decals (a set of the scene's own), the colliders, its structure material, placed on the Wetlands block. As built:
   - **`build_bunker`** (about 15 s): §3.6 as written above. The bunker's wear over 0.25 on 5 % (damage), 24 % (stains), 3 % (chips) of its vertices, the wall's 5, 36, 1 %. The GLB 296 KB → 49 KB (the default encode), the leaks 2 KB.
   - **Its JSONs:** `structureBunker` (the JSON route with the structure preset's defaults written out: `WORLD`, `TRIPLANAR`, `DUAL_SCALE`, a 12 m macro; `VERTEX_COLOR` `RGBA` over `concrete01`, `concrete02`, `mud01`, `rocks02`; `wet: { streaks: {} }`) and its TSL file, the two imports, the leaks' decal set (`decalsStructure_blend`). The scene lists them (`importedAssets`, `decalSets`, `materials`); its file spawns the bunker at (12, 0.58, 114), 3 m left of and 1 m in front of the pad's middle, and the leaks at the same transform.
   - **A toolkit bug fixed (asked):** the `decalsStructure` leak cells were nearly transparent, here and in the gallery (Phase 1's check took the wall's wear for them). Their opacity came from ambientCG height maps that are almost black (at the 480 px cell, 97 % of the texels ≤ 6-11 of 255, maxima 11-87) through `remap: "auto"` over the full range. Found by elimination: the quads drew (an opaque test material), their UVs were the cell table's, forcing the opacity to 1 showed the leak's streaks. `decalLeak01`-`03_albedoAlpha` now remap `[0, 0.05]`, `[0, 0.09]`, `[0, 0.02]` (about the 99th percentile at the cell's size; past it clamps after the resize, which keeps a streak some width); `decalsStructure.albedoAlpha` re-encoded (393 KB; the `normalRough` slot unchanged). The leaks show as dark drips under the bunker's roof edge and on the gallery's wall. A toolkit patch for Phase 5.
   - **Looked at on WebGPU** (`.cache/look/p310p2s4.mts`; `p310p2s4dbg.mts` and `p310p2s4gal.mts` the leak hunt): the bunker and the wall on the pad, the stains from the roof edge, the grime, the chipped edges, the leaks, and in rain (`MANUAL`, wetness 1, rain 0.9) the streaks down the walls; no warning of its own. The colliders are checked with the others in section 5.
   - **Handbook:** `terrain-decals.md` (a faint scan's height range at the cell's size; a structure's decals by hand), `structure-materials.md` (the bunker as a worked import: its wear, material, colliders and leaks).
5. **The scene and the exit:** the character (walk, footprints), the colliders against the wireframes on every block, `terrainShowcase` in `scenes.config.ts` (the sky and the rain still, `?physicsProbe`), its baseline in both worker targets; the scene's description, the handbook pages' "Template file" lines naming the showcase blocks. As built:
   - **The player** (`showcasePlayer.ts`, `createShowcasePlayerAsync`): the gym's dynamic character (1.6 m, radius 0.5, `TANK` brain on WASD, Space, Shift, Ctrl and a gamepad), dropped onto the coast's beach at (−14, 3.5, 6) at the load (a load write: the physics hold covers it), `createFollowObjectCameraRig` on `terrainShowcaseCamera` (world offset (0, 4.5, 9) behind it from the south, with the scene). Its footprints: a pool of 128 (`decalsGround_blend`, which the scene JSON lists) and an `APP_LOGIC` system stamping a `footprintBoot` every 0.7 m it walks on the ground, left and right across its heading, on the block under it (by grid place from `getTerrainBlock`), tinted per block (the coast's `#d2ad7c`, the wetlands' `#666666`), gone after 60 s; nothing per frame allocated; the system removed on the scene's exit. The scene file keeps its blocks' spawn results for it.
   - **The colliders against the meshes** (`.cache/look/p310p2s5.mts`, not by eye: the wireframes are per entity now, the physics entity window's "Show wireframe"): 400 rays down each block through the physics world (`castRay`, both worker targets) against three's raycast on its mesh: the coast's and the wetlands' heightfields within 0.02 mm, the alpine slope's too but for one ray 12.7 mm over it on its scree (a boulder's convex hull rising over the ground at its rim); one wetlands ray on the bunker. The bunker's boxes: its roof at 3.18 m, the wall's top at 3.08 m, a ray through the doorway on the back wall's inside (z 112.4) and one at the front wall on its face (z 116).
   - **The player walked:** on the coast's beach (its prints trailing behind it), and dropped onto the alpine slope, the wetlands and the coast's plateau: landed and grounded on each (walked on the first two). The blocks are islands with nothing between them (the edges stay, decided in section 3): walking off one falls, as the first try at the plateau did.
   - **The scene runner:** `terrainShowcase` in `scenes.config.ts` with `probeSteps: 180` (the player lands and settles before the freeze). Its WebGPU baselines recorded (`--update`) and then passed against them in all four configurations, both worker targets included (37 s). The probe hash is FNV-1a's empty `811c9dc5`: every body is fixed and the character isn't in the hash, so the probe has nothing moving to check; the snapshot is the follow camera on the player.
   - **Docs:** the scene JSON's description and the scene file's header (each block, the bunker, the player); the handbook pages' "Template file" sections (`terrain-blocks-blender.md`, `terrain-splat-map.md`, `terrain-scatter.md`, `terrain-decals.md`, `terrain-vertex-color-splat.md`, `terrain-triplanar-cliffs.md`, `terrain-procedural-rules.md`) name the showcase's blocks as worked examples.

### Phase 3 — Procedural block and scenarios

1. `showcaseProcedural`; Rain shower, Dry and Snowfall scenarios; day-night playing.

**Exit:** a full rain shower cycle (dry → soaked → puddles → drying) reads plausibly on every block, and the GPU cost of the wettest state is recorded. Each category's look at wetness 0.3, 0.6 and 1 is judged against 1–2 CC0 reference photos (p307 Phase 2's exit, left to here), linked from the handbook's `wet-dry-surfaces.md`.

Found when it started (2026-11-19), and decided:

- **The scene has no tab yet:** no `_dbg__terrainShowcase.ts`; the scene file spawns the three Blender blocks, the bunker, its leaks, the sea and the player. §3.7's tab isn't in any phase's list. **Decided (asked):** this phase builds it without the camera presets: the scenarios, the time of day and the day playing, the procedural block's CPU / shader rules, a blocks list that puts the player on a block, the quality tier and the debug views (`WEIGHTS`, `TAPS`, `WETNESS`) on every block. The follow camera on the player is the showcase's view; the presets are the gallery's.
- **The rules into vertex colours weigh at most 5 layers** (`rulesTerrain`'s `layout`: `RGB_AO` 4 with the horizon AO in A, `RGBA` 5 without), so "Alpine's layers" (7) can't all be the CPU's. `showcaseProcedural` takes four of them, the ones its rules lay: `grass01` (base), `rocks02` (slopes past about 26°, the scree the Alpine paints), `snow01` (the Alpine's snow rule: above 18 m, under 35°, facing north within 70°, noise 0.3 at 24 m) and `cliffs02` (past 45°, triplanar slope-gated 35-50°), `RGB_AO` with the AO. The shader's variant evaluates the same rules (the block JSON's, the one source, as the gallery's patch does: `patchRow.ts`), so the A/B is the vertex spacing's, never the math's; the Alpine block beside it is the authored side of the comparison.
- **Heights:** `noiseTerrain`'s heights run ±`maxHeight` (the octaves' sum normalized), world-continuous at the block's place (128, 128); the seed and octaves are tuned so the block reaches over the 18 m snow line with a cliff or two (the alpine ridge is 22 m), checked by a script before the JSON.
- **Storage:** four `LITE` layers bind 8 separately; with the macro, the ripples and the snow set (2) that's 12, over WebGPU's 16 less the 6 reserved. The procedural material is an array material (its own set array of the four, the scene's fourth `textureSetArrays` entry).
- **Snow covers the Alpine only:** the other blocks' materials have no `wet.snow`, so a Snowfall scenario would whiten one block of four. Snow and frost go into every block's material (the coast, the wetlands, the procedural block), the decal sets' tinted materials (`showcaseCoastTracks`, `showcaseWetlandsRuts`: the toolkit's decal JSONs have no `snow`, so a mesh decal shows over snow unless an app JSON adds it) and the bunker's structure material, each within its binding budget (the wetlands' `SEPARATE` four layers, 8 + the ripples + the snow set's 2 = 11, go to a set array; the bunker's four `RGBA` layers likewise or a lower `reservedTextures`, decided in section 3 on the numbers). The footprints' toolkit `decalsGround_blend` stays: a print over snow is what a print in snow looks like.
- **The surface conditions' drying is slow for a demo:** `dryingRate` 0.1 a minute in full sun, so at 10:30 (sun factor about 0.6) a soaked block takes about 15 minutes to dry and its puddles longer. The Rain shower scenario sets a faster `dryingRate` (and a breeze) so the cycle plays out within a few minutes; its numbers are tuned and written in section 3. Dry is the engine tab's "Dry now" (no rain, wetness and puddles 0, the snow gone, 15 °C); Snowfall its −5 °C and the cover over 30 s.
- **Shelter:** no showcase material reads the rain occlusion map (`wet.rainOcclusion: 'MAP'`), so the wetlands' ground inside the bunker's doorway gets wet and puddles in rain; `rainOcclusion()` is in the template's features. The wetlands' material takes `MAP` (one compare fetch a pixel) if the doorway shows it.
- **The wettest state's GPU cost** uses the gallery's sampler (`_dbg__terrainGalleryMeasure.ts`: `sampleFrameGpuMsAsync`, `startMeasureConditions`, `getMeasureHeading`), which moves to `src/app/shared/` (code two scenes use), the gallery importing it from there.
- **Reference photos:** CC0 photos (Wikimedia Commons' CC0 and public-domain ones; Unsplash's and Pexels' licences aren't CC0), linked from the handbook, not committed. The categories are judged on the gallery's Wet/dry row (a block per category, `MANUAL`, its own wetness slider), not on the showcase's blended blocks.

Sections:

1. **`showcaseProcedural`** (§3, grid (2, 2)): the `rulesTerrain` block JSON (heights tuned, the four layers' rules, the horizon AO, a heightfield collider), its material `terrainProcedural` (a set array of the four, `VERTEX_COLOR` `RGB_AO`, the slope-gated cliffs, the macro) and TSL file, a procedural rock scatter on its `rocks02` layer; the scene lists and spawns it; the player's footprints tinted on it. Looked at on WebGPU beside the Alpine block. As built:
   - **The heights** (tuned with `generateTerrain` over seeds in a throwaway Vitest file: the layers' shares a vertex, the rules without their noise): a 64 m window of world-continuous simplex can't sit on a gentle summit 18 m up. At `maxHeight` 28-50 the relief was 28-65 m and the cliff rule took 25-65 % of the block; no seed of 400 gave a minimum above −10 m. So the block keeps the Alpine's rule shapes with **its own snow line, 10 m**, over a gentler terrain: `maxHeight` 18, octaves `[0.008, 1]`, `[0.025, 0.3]`, `[0.07, 0.08]`, `[0.16, 0.02]`, seed 13: −12.1 to 13.5 m, over 0.5 rocks 29 %, snow 9 %, cliffs 8 % of the vertices.
   - **The rules** (the block JSON's, the one source): `rocks02` past 30° (softness 8; at 26° it took half of any block of this relief), broken by the macro's A at 18 m (0.35); `snow01` above 10 m, under 35°, facing north within 70°, the R noise at 24 m (0.3); `cliffs02` past 45°. **The snow's ramps are softer than the Alpine's** (height 3 m, slope 8°, facing 35°, the handbook's example): with the Alpine's (2 m and the defaults, 5° and 15°) the CPU's weights went from 0 to 1 within a vertex, and the height blend drew the snow's edge as a staircase along the 0.5 m grid, seen from above. Horizon AO radius 8, strength 0.8 (the gallery patch's).
   - **Its files** (`blocks/showcaseProcedural/`): the block (`HEIGHTFIELD`, friction 1, no decals), `terrainProcedural` (a set array of `grass01`, `rocks02`, `snow01`, `cliffs02`, `LITE`: the scene's fourth `textureSetArrays` entry; `VERTEX_COLOR` `RGB_AO`, `HEIGHT`, `ao.vertex`, `DUAL_SCALE`, the cliffs' slope-gated `TRIPLANAR`, `macro` 64 m, `wet: { snow: {} }`) and its TSL file, two scatters on layer 1 (`rocks02`): `showcaseProcedural_rocks` (the toolkit's `rockSmall_*`, 1.2 m apart, density 0.6 in clusters, under 42°) and `showcaseProcedural_boulders` (`boulder_a`, `_b`, 5 m apart, density 0.35, under 38°, `CONVEXHULL` colliders: the generated counterpart of the Alpine's Blender boulders), both in `showcaseProceduralRocks` (`rockScatter` over `rocks02`) and its TSL file. The scene file spawns it fourth and registers the toolkit's boulders too. Its footprints stay untinted, as the Alpine's.
   - **Looked at on WebGPU** (`.cache/look/p310p3s1.mts`, `--tag=b` after the softer snow): grass on the gentle ground, scree with rocks and boulders on the slopes, the cliffs triplanar on the steepest faces, snow on the high north-facing slopes, its edge broken by the noise; beside the Alpine block the same sets, authored against generated. No warning of its own.
   - **The collider** (`.cache/look/p310p3s1c.mts`, Phase 2's rays): 400 rays down through the physics world against three's raycast on the mesh, within 0.03 mm, one ray on a boulder's hull. The player dropped on the block lands and walks; on a face past its slope limit it tumbles down, as on the Alpine's scarp.
2. **The showcase tab** (`_dbg__terrainShowcase.ts`, §3.7 without the presets): the blocks list (the player put on a block, at its centre's ground, in an `APP_PHYSICS_STEP`), the time of day and the day playing (its speed), the procedural block's CPU / shader rules, the quality tier and the debug views on every block's material (variants, put back on the scene's exit). As built:
   - **`_dbg__terrainShowcase.ts`** (`createTerrainShowcaseTab`, imported by the scene file in the debug env once the player exists): one scene-scoped tab, "Terrain showcase", saving `debugView`, `quality` and `rules` (`AEK_debugTerrainShowcase`). **Blocks** (a list: each block's techniques, Blender or engine): a click puts the player over the block's start point (a ray down onto its mesh, 1.2 m over the ground: the coast's beach (−14, 6), the alpine's flat south part (116, 22), the wetlands' west of the channel (−16, 136), the procedural block's grass (113, 139)), written in the next physics step (`APP_PHYSICS_STEP`, the position and a zero velocity; the gameHud example's pending-write pattern), the follow camera gliding after it. **Day**: the time of day (0-24 h), Play the day (`playDayNight` / `pauseDayNight`) and its speed (0.25-40 ×; the cycle is 20 minutes a day at 1), read through getters, the tab refreshing every 500 ms. **Materials**: the debug view (None, Weights, Taps, Wetness, Texel density, Normals, Projection, Layer count) on every block and the bunker (found by its material at the tab's start), the quality tier (Own, or the toolkit's `getTerrainQualityPreset` with each block's cliff layer at Low to Ultra; not the bunker) and the procedural block's rules (CPU, or Shader: `RULES` over the block JSON's rules, its `HEIGHT` mode kept, no vertex AO). Each is a `getMaterialVariant` of the block's material over its define, one shader per combination used. No camera presets (decided at the phase's start).
   - **The scene's exit list:** `registerOnSceneExit` keeps one function per scene, so the scene file runs a list (`addShowcaseExitCleanup`, the gallery's pattern) holding the player's cleanup and the tab's (its step system, its visit); the tab is created only while the visit is current.
   - **The wetlands' material is an array material** (`terrainWetlands`' `layers` input, the scene's fifth `textureSetArrays` entry: `mud01`, `mud02`, `grass02`, `rocks01`): a tier's sparse sampling and `HEX` on the dominant layer sample in slots, which need `ARRAY` (section 3 would have needed it for the snow set's budget too). Every block's material is an array material now; the bunker's structure material stays `SEPARATE`, so it takes the views only.
   - **CPU against shader rules:** the procedural block's two `WEIGHTS` shots from above differ on 0.9 % of the pixels, all at the layers' edges (the shaded view from the north on 1.8 %, the vertex AO with it): at 0.5 m spacing the rules laid per vertex and the same rules per pixel draw the same layers, the CPU's edges a little blockier. Checked that the shader's variant was on the mesh (its define's `blend.source` `RULES`), not the same material twice.
   - **Checked on WebGPU** (`.cache/look/p310p3s2.mts`, a page per saved view): each view and each tier on all four blocks and the bunker with no warning of their own (`low`, `ultra`, `wetness`, `taps` with `HIGH`, `cpuWeights`, `shaderWeights`, `shader`); the list put the player on each block, grounded ((113, 7.9, 139), (116, 1.2, 22), (−16, 1.25, 136), back to (−14, 2.1, 6)); the day at speed 20 went from 10:30 to 13:23 in 3 s. `yarn test` passes.
3. **The scenarios and the weather's look:** Rain shower, Dry and Snowfall in the tab (the drying sped up), snow and frost in every block's material and the decal sets' (the storage changes the budget needs), the rain occlusion map where shelter shows; the full cycle looked at on every block (dry → soaked → puddles → drying, and snow); the wettest state's GPU cost recorded per block (the sampler moved to `src/app/shared/`). As built:
   - **The tab's Weather section** (`_dbg__terrainShowcaseWeather.ts`, after the Blocks list): Rain shower (`startRain(1)`, 10 s up, 60 s, 10 s down, with `dryingRate` 0.6 and a 3 m/s wind), Dry (the scene's start at once: no rain, wetness, puddles or snow, 15 °C, `dryingRate` 0.1, still air), Snowfall (−5 °C, the cover over 30 s), a Now line (wetness, rain, puddles, snow, temperature) and the measurement. The buttons take no hint (a property grid button has none), so the Now and Status rows' hints explain them.
   - **The cycle** (`.cache/look/p310p3s3.mts`: the tab's own Rain shower button, each block shot at stages read from the conditions; the surface clock's seconds): soaked at 76 s (wetness 0.98, puddles 0.51), the rain over at 91 s (the puddles' peak 0.64), wetness 0.5 at 141 s and 0.1 at 183 s, everything dry at 271 s; the snowfall full in 44 s. So the shower plays out in about 4.5 minutes, the puddles drying last. Every block wets and dries back to its dry look: the alpine grass and scree darken 20-23 % soaked, the coast's sand 13 %, the procedural block's grass top keeps its brightness (its gloss reflects the bright sky at that angle: the handbook's pitfall), the wetlands' channel stays glossy through the cycle (its regional wetness), the bunker's walls darken and streak. The snowfall covers every block, the decal sets' tracks and ruts with them; the scatter rocks stay bare, sticking out (the rock material has no snow input).
   - **Snow and frost in every block's material**, the rain parts where they were missing: `terrainCoast` (`snow`, `frost`), `terrainAlpine` (`puddles`, `ripples`, `frost`; the input `ripples`), `terrainWetlands` (`snow`, `frost`, `rainOcclusion: 'MAP'`, and its puddles in **patches** at 20 m, the input `macro`: at the cycle's puddle levels its flat mud stood under water almost everywhere, a lake rather than puddles), `terrainProcedural` (`puddles`, `ripples`, `frost`); the decal materials `showcaseCoastTracks` and `showcaseWetlandsRuts` take the input `snow`. Every block's material was an array material already (section 2), so the snow set's two bindings fit.
   - **The bunker's material stays `SEPARATE` with `reservedTextures: 5`:** its four layers' 8 bindings, the macro and the snow set's 2 are 11, over the default 16 less 6, and **`concrete01`'s maps are 1024 × 512**, so a set array of the four (1024² the others) fails to build (`buildTextureSetArray` refuses members of two sizes; the material sampled white, warned). The scene has one shadow-casting sun, so one texture fewer reserved fits. Its `wet` takes `snow` and `frost`: the roof whitens, the walls keep their streaks.
   - **Shelter:** the bunker cast no shadows (`spawnImportedAsset` without `castShadow`), so it wasn't an occluder of the rain occlusion map and the ground inside its doorway puddled in the rain. The scene file spawns it with `castShadow` and `receiveShadow`; the `WETNESS` view in the rain shows the floor inside dry with a crisp edge at the threshold (`p310p3s3door.mts`).
   - **The weather's GPU cost** (the tab's Measure, `window.__terrainShowcaseMeasure.measureWeatherAsync()`, on the sampler moved to `src/app/shared/_dbg__gpuFrameMeasure.ts` with the gallery's other measurement helpers; `getMeasureHeading` takes the conditions' text, the gallery's the default): each block alone (the scene's children off its square hidden) in two poses, from above and from a first person's eye 0.35 of the block in front of its centre (the first pose is past the ripples' 30 m fade, so the second is where their taps run), the frame without it and dry, wettest (wetness, rain and puddles 1) and under full snow, `MANUAL`, the weather put back after. Windows Chrome 157, RDNA 3, 1920 × 1080:

     | Block | Pose | Empty frame | Dry | Wettest | Snow | Wettest − dry | Snow − dry |
     | --- | --- | --- | --- | --- | --- | --- | --- |
     | Coast | overview | 0.11 | 0.97 | 0.97 | 1.04 | -0.00 | 0.07 |
     | Coast | first person | 0.25 | 1.95 | 1.99 | 2.19 | 0.05 | 0.24 |
     | Alpine slope | overview | 0.11 | 0.78 | 0.78 | 0.85 | -0.01 | 0.06 |
     | Alpine slope | first person | 0.16 | 1.20 | 1.21 | 1.39 | 0.01 | 0.19 |
     | Wetlands | overview | 0.11 | 1.02 | 1.03 | 1.07 | 0.01 | 0.05 |
     | Wetlands | first person | 0.26 | 2.18 | 2.20 | 2.44 | 0.02 | 0.27 |
     | Procedural | overview | 0.24 | 0.89 | 0.88 | 0.92 | -0.00 | 0.04 |
     | Procedural | first person | 0.27 | 1.15 | 1.15 | 1.30 | -0.00 | 0.14 |

     **The wettest state costs what the dry one does** (−0.04 to +0.05 ms over two runs): the wet response's arithmetic runs on every pixel in either state, and the ripples' two taps on standing water near the camera (the rings show in the shaded shots) are within the noise on this GPU. **Snow costs 0.04-0.27 ms**, the most from a first person's eye (the set's taps under the cover on most of the frame). The `TAPS` view's bands (16-24 there) are too coarse to show the ripples' two fetches.
   - **A test bridge finding:** `focusDebuggerControl({ name })` with a property grid button's text (the shower's) focused the next button in the pane (Dry), so the first two cycle runs pressed Dry; the script clicks the button found by its text. Not fixed here (the engine's test bridge; a property grid button whose row has a label).
   - `yarn test`, `tsc` and lint pass.
4. **The reference photos:** each category on the gallery's Wet/dry row at wetness 0.3, 0.6 and 1 against 1-2 CC0 photos; a category that reads wrong gets its response corrected (`TEXTURE_SET_WET_RESPONSES` or the set's own `surface`, a toolkit change); the photos and the judgement in `wet-dry-surfaces.md`.
5. **The exit:** the scene runner's baseline recorded again (the fourth block, the materials), the scene JSON's description and the scene file's header, the sky box's description, `terrain-procedural-rules.md` (the procedural block as the CPU-against-shader worked example), §3's table and §3.7 corrected to what was built.

### Phase 4 — Measurements, the handbook and the Hub (§4)

1. §4's steps 1-3 and 6 (the Hub), the Hub images saved.
2. `yarn sbp`: in the app's first download only the features' installs and runtime state (`terrain()`'s factory, `surfaceConditions()` and `rainOcclusion()`, which the template lists), no terrain material, wet response or scatter code, and the banner's feature groups at 0.

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
