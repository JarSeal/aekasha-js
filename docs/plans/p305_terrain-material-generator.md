Status: draft | not-implemented
Category: Materials, Terrain, Toolkit
Blocks: p306_terrain-blocks-and-procedural-terrain-meshes.md, p307_wet-and-dry-surface-states.md, p310_terrain-preview-scenes.md
Epic: p301_terrain-texturing-epic.md

# Terrain Material Generator

One toolkit module, `createTerrainMaterial(config)`, plus a JSON route (`src/toolkit/materials/terrain/terrain.tsl.ts` `setup` entry), that builds a single `MeshStandardNodeMaterial` from a declarative config. It implements every texturing technique of the epic:

- single tiled layer;
- anti-tiling (dual-scale, hex);
- macro variation and distance fade;
- vertex-colour splat;
- splat maps;
- procedural rules (slope / height / noise / aspect);
- height blending;
- planar, biplanar, triplanar and slope-gated projection;
- sparse top-K sampling;
- colour map + detail (with an in-engine colour-map bake);
- structure mode (concrete, object space);
- live procedural layers;
- quality variants;
- debug views.

**Only what the config enables is compiled.** Every feature is a build-time branch on the config, never a runtime uniform switch, so a single-layer material costs what a single-layer material should.

Wet/dry hooks are reserved here and implemented in p307. The Blender sides of the techniques (templates and the "Blender / Export / Import" sections of the handbook pages) are finished in p306, which owns the block workflow.

---

## Context (grounded)

- **After p302:**
  - `setup(inputs, material, staticDefines)` sets several sockets from one graph;
  - `registerTslMaterial(id, fns)` registers code graphs;
  - input resolvers produce bundles;
  - variants override `inputs` / `staticDefines` (shallow merge).
- **After p303:**
  - texture sets (`physicalSize`, `heightScale`, `surface`, packings FULL/LITE/MINIMAL);
  - `buildTextureSetArray` and the `textureSetArray` resolver;
  - `sampleTextureSet(bundle, uv, { packing, grad })`;
  - the `textureSetSurface` baseline;
  - the `terrainGallery` skeleton.
- **From p304** (`docs/plans/_DONE_p304_procedural-texture-baker.md`, done; the handbook `docs/techniques/procedural-textures.md`):
  - `bakeTexture` (`aekasha`; `src/_engine/kernel/render/CLAUDE.md`'s Texture bakes): a TSL graph into a mipmapped texture, MRT and array layers, baked inside a scene load or queued one a frame. D7's colour-map bake (Phase 7) uses it.
  - The noise library on `aekasha/toolkit/terrain` (`valueNoise`, `gradientNoise`, `fbm`, `domainWarp`, `worley`, `hash12` / `hash22`, `heightToNormal`, `heightToCavity`; 2D, an optional `period`, none for world-space live use).
  - `macroNoise` (512², linear RGBA8: R and G two fbms around 0.5, B soft-edged Worley patches, A a high-passed noise): `bakeMacroNoise()` registers `macroNoise.data`, and the committed KTX2 copy is the texture `macroNoise` (UASTC, a few bytes off the bake; a material that needs A's exact texels bakes). Phase 2's macro variation samples either.
  - Ten surface generators, `bakeSurfaceGenerator` (a set's packing) and `createLiveSurface(generator, { uv?, seed?, params?, physicalSize?, heightScale?, normal?, ao? })`, which returns `sampleTextureSet`'s sample names (`albedo`, `height`, `roughness`, `normalTS`, `ao`, `isAoBaked: false`): Phase 8's `PROCEDURAL_LIVE` layer blends it as a sampled one, passing its own point for a layer's tiling, rotation or a triplanar plane. Its normal is null by default (bump the height with `bumpNormalView`; `normal: 'TAPS'` costs 4 height evaluations a pixel), and it has no mips: the gallery measured a live block at 8-20 ms of GPU against about 1 ms baked for a 1080p view.
  - Procedural texture sets (a set JSON's `procedural`), baked on load into ordinary slots; set arrays refuse them, so a terrain material's arrays are all imported, or an all-procedural array is one layered `bakeTexture` of p305's own.
  - **Open for Phase 8:** a layer names a procedural set, but the engine's generator loader (`features/texturesets/TextureSetBakes.ts`' `loadGeneratorAsync`) is internal: add a public `loadTextureSetGeneratorAsync(id)` on `aekasha/texturesets` (in the lazy chunk), and check that what it loads is a toolkit generator (`build`) before running it live.
- **Where the code lives** (p301 §2): `src/toolkit/terrain/`, a toolkit category of its own with the entry `aekasha/toolkit/terrain` (created by p303 Phase 5: a rule per subfolder in `devTools/layout/layoutRules.ts`' `getToolkitRules`, `TOOLKIT_CATEGORIES` in `eslint.config.js`, the alias in `devTools/aliases.ts` and `tsconfig.json`). The generator, its nodes and the code-registered graph (`aek.terrain`) are there; the JSON route's material is in the materials category's per-id folders, `src/toolkit/materials/terrain/` (`terrain.tsl.ts`, a thin `setup` over the entry's builder, and `terrain.material.json`), like p303's `materials/textureSetSurface/`. A world's terrain materials (layer choice, tuning) are app JSONs in its scene's folder. Module files are PascalCase (the layout check); an asset-id file keeps its id (`terrain.tsl.ts`). Another category is imported only through its entry (the layering lint), and `terrain` → `geometry` is the one direction between the two (see D1's `TerrainRule`).
- **Projection code:** `src/toolkit/materials/TriplanarProjection.ts` has `triplanarProjection` (`positionWorld` + `normalWorldGeometry`; `alignToObject`, `fitToBounds`, `dominantAxis`), `blendProjections`, `blendProjectionGradients` and `readBooleanDefines`, all on `aekasha/toolkit/materials` (p620). Reuse and extend it through that entry rather than writing a second triplanar.
- **Normal space:** socket functions return a **view-space** normal for `normalNode` (`toolkit/materials/triplanarGrid/triplanarGrid.tsl.ts:269-273`: the world gradient through `cameraViewMatrix`, then `normalView.sub(tangentGradient).normalize()`). The generator computes in world space and converts once at the end the same way.
- **The TSL socket contract** (`(inputs, material, staticDefines)`, uniforms named `<socket>_<input>`) is the Hub's "Writing a TSL material" (`hub/pages/features/toolkit/guide.md`).
- **Smallest build:** the generator is toolkit code, so only the chunks of the scenes that use a terrain material carry it (`yarn sbp` shows it under `toolkit`, never in the first download of a scene without terrain); its debug views load through `import()` (D10).
- **`aoNode`** on node materials applies to indirect light only, which is the composition rule of `docs/analysis/ambient-occlusion-options.md`. Texture AO (FULL) and vertex AO go there. AO baked into albedo (LITE/MINIMAL) can't, so the generator lowers `aoNode`'s influence for those layers.
- **The GTAO PostFX pass** (`src/app/postFx/ambientOcclusion.tsl.ts`) multiplies the final colour, not indirect light. Baked AO and GTAO therefore stack; the handbook notes it.
- **Binding budget:** the WebGPU default is 16 sampled textures per stage, shared with shadow maps and the environment (p301 §6). `renderer.backend.device.limits` gives the real limits on WebGPU.
- **Quality scale:** `LOW | MEDIUM | HIGH | ULTRA` (p240 proposal, shadow presets).

---

## Design

### D1 — Config (`src/toolkit/terrain/TerrainMaterialConfig.ts`, Zod + types)

```ts
type TerrainMaterialConfig = {
  id: string;
  layers: TerrainLayer[]; // 1..16
  packing?: 'FULL' | 'LITE' | 'MINIMAL'; // shared by all layers; default: the sets' defaultPacking (must agree)
  storage?: 'AUTO' | 'SEPARATE' | 'ARRAY'; // AUTO: ARRAY when separate bindings exceed the budget (D9)
  space?: 'WORLD' | 'OBJECT'; // OBJECT for structures that move (D8)
  uv?: 'WORLD' | 'MESH_UV'; // tiling coordinates (MESH_UV needs authored UVs; tangents from derivatives)
  blend?: {
    source:
      | 'SINGLE'
      | 'VERTEX_COLOR'
      | 'SPLAT_MAP'
      | 'RULES'
      | 'VERTEX_COLOR_AND_RULES'
      | 'SPLAT_MAP_AND_RULES';
    vertexColor?: { layout: 'RGB_AO' | 'RGBA' }; // p301 §4.4
    splatMaps?: 1 | 2; // 1 = layers 1-4 (+ base), 2 = layers 1-8 (+ base)
    rules?: TerrainRule[];
    mode?: 'LINEAR' | 'HEIGHT'; // default HEIGHT when the packing has height
    heightBlendDepth?: number; // 0.02..0.5, transition softness in height units
    sparse?: { maxLayers: 2 | 3 | 4 }; // ARRAY only (D6)
  };
  antiTiling?: {
    mode: 'NONE' | 'DUAL_SCALE' | 'HEX';
    farScale?: number;
    distance?: [number, number];
    hexContrast?: number;
    apply?: 'ALL' | 'DOMINANT';
  };
  projection?: {
    mode: 'PLANAR' | 'BIPLANAR' | 'TRIPLANAR';
    slopeGate?: [number, number];
    sharpness?: number;
    normalBlend?: 'WHITEOUT' | 'UDN' | 'RNM';
  };
  macro?: { texture: string; scale: number; brightness?: number; hue?: number; roughness?: number };
  colorMap?: { texture: string; mode: 'DETAIL' | 'FAR_ONLY'; detailDistance?: [number, number] };
  distance?: { fade: [number, number]; far: 'AVERAGE_COLOR' | 'COLOR_MAP' | 'NONE' };
  ao?: { vertex?: boolean; textureInfluence?: number; bakedAlbedoInfluence?: number };
  wet?: WetConfig; // reserved, p307
  quality?: Partial<Record<'LOW' | 'MEDIUM' | 'HIGH' | 'ULTRA', TerrainQualityOverrides>>;
  debugView?: TerrainDebugView; // debug env only (D10)
};

type TerrainLayer = {
  set: string; // texture set id (imported or procedural)
  source?: 'TEXTURE' | 'PROCEDURAL_LIVE'; // PROCEDURAL_LIVE = p304 generator evaluated per pixel
  tiling?: number; // multiplier on the set's physicalSize
  rotation?: number; // degrees, breaks alignment between layers
  tint?: string;
  normalStrength?: number;
  roughnessScale?: number;
  heightContrast?: number;
  heightOffset?: number;
  antiTiling?: TerrainMaterialConfig['antiTiling'];
  projection?: TerrainMaterialConfig['projection']; // eg. TRIPLANAR on cliffs only
};

// Defined in `geometry/generate/TerrainRules.ts` next to its CPU evaluation (p306 D4) and
// imported from `aekasha/toolkit/geometry`, so `geometry` never imports `terrain`
type TerrainRule = {
  layer: number;
  slope?: [number, number]; // degrees, with softness
  height?: [number, number]; // world Y metres
  aspect?: { direction: [number, number]; range: number }; // eg. north-facing snow
  noise?: { scale: number; amount: number; channel?: 'R' | 'G' | 'B' | 'A' }; // macroNoise channel
  softness?: number;
  strength?: number; // 0..1
};
```

- **Static config** goes in `staticDefines.terrain` (JSON route) or the `createTerrainMaterial` argument (code route). It's build time: the graph branches on it.
- **Per-layer tunables** (tint, normal strength, roughness scale, height contrast and offset, tiling) become **uniforms**, registered in `mat.userData.uniforms` as `terrain_l<i>_<name>`. The gallery tab and the material editor (`_DONE_p085`, `src/_engine/debug/editors/CLAUDE.md`) can live-edit them without rebuilding.
- **Textures** (layer arrays, splat maps, macro, colour map) are **inputs**, so material variants swap them per block (p306) without a new graph.

### D2 — Graph outline (`src/toolkit/terrain/TerrainMaterial.ts`' `setup`, which `materials/terrain/terrain.tsl.ts` re-exposes; nodes in `src/toolkit/terrain/nodes/`)

```
coords      = space/uv → worldPos, worldNormal(geometry), slope, height, viewDistance
weights     = blend source (vertexColor | splat | rules | combos) → w[0..N)        (Weights.ts, Rules.ts)
weights     = HEIGHT ? heightBlend(w, layerHeights) : w                         (HeightBlend.ts)
selection   = sparse ? topK(weights) : all non-zero layers                         (Sparse.ts)
for each selected layer:
  proj      = PLANAR | BIPLANAR | TRIPLANAR (slope-gated)                         (Projection.ts)
  sample    = antiTiling(NONE | DUAL_SCALE | HEX) of sampleTextureSet(...)        (AntiTiling.ts)
  accumulate albedo, normal(world), roughness, ao, height by weight
surface     = macro(…) → colorMap(…) → distance fade/far mode → wet(…) [p307]      (Macro.ts, ColorMap.ts, Distance.ts)
outputs     → colorNode, normalNode (world → view once), roughnessNode, metalnessNode = 0, aoNode
```

- **Height blending** (Mishkinis): `w'_i = max(h_i + w_i − (max_j(h_j + w_j) − depth), 0)`, normalized.
  - `h_i` is the layer's height × `heightContrast` + `heightOffset`.
  - With HEX or TRIPLANAR, `h_i` is the layer's blended height across taps.
  - With `sparse`, the heights of the selected layers only.
- **Normals:**
  - Planar world tiling uses an analytic frame (T = +X, B = +Z, then Gram–Schmidt against the geometry normal).
  - Biplanar and triplanar use Golus's whiteout (default), UDN or RNM per projection.
  - The per-layer normals are blended by weight in world space, renormalized, and converted to view space once.
  - `MESH_UV` uses derivative-based TBN (no tangent attribute).
- **The shadow pass** uses only the position graph. The generator never touches `positionNode`, so shadows cost nothing extra.

### D3 — Anti-tiling (`nodes/AntiTiling.ts`)

| Mode         | Taps | How                                                                                                                                                                                                                  | Best for                                                                                     |
| ------------ | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `NONE`       | 1    | plain tiling                                                                                                                                                                                                         | Top-down/RTS at height, low tier, stylized flat textures                                     |
| `DUAL_SCALE` | 2    | Sample at `uv` and `uv × farScale` (≈ 0.23, non-integer, rotated 37°); mix by distance (`distance` range) and by `macroNoise.B` patches                                                                              | Default for everything; also kills repetition at distance                                    |
| `HEX`        | 3    | Mikkelsen's practical hex tiling: 3 hex-lattice taps with random offsets and rotations, gradients via `texture().grad()` (no mip seams), contrast-preserving weights (`hexContrast`); normals rotated with their tap | First- and third-person close-ups of strongly patterned layers (rocks, cliffs, grass ground) |

- `apply: 'DOMINANT'` runs HEX only on the highest-weight layer and DUAL_SCALE on the rest. That cuts the cost from 3·L to 3 + 2·(L−1) taps per slot.

### D4 — Blend sources (`nodes/Weights.ts`, `nodes/Rules.ts`)

- **`VERTEX_COLOR`:** reads `COLOR_0` (TSL vertex colour attribute).
  - `RGB_AO`: layers 1–3 from RGB; layer 0 = `max(0, 1 − (r + g + b))`; A = AO, which goes to `aoNode` when `ao.vertex`.
  - `RGBA`: layers 1–4; no vertex AO.
- **`SPLAT_MAP`:** 1 or 2 RGBA textures in mesh UV (block-local, set per block through variants). Base layer = remainder.
  - Splat maps are `data` slot textures: `codec: none` or UASTC (p300).
  - Filtering is linear. A 1K splat on a 64 m block = 6.25 cm per texel, and the height blend sharpens the transitions far below that.
- **`RULES`:** each rule computes a mask:
  - smoothstep ranges on slope (degrees from `normalWorldGeometry.y`), height (`positionWorld.y`) and aspect (the horizontal normal's direction);
  - optionally perturbed by a `macroNoise` channel;
  - multiplied by `strength`.
  - Rules composite **over** the incoming weights in order: `w = mix(w, onehot(layer), mask)`. So "snow above 40 m on slopes under 30°" can sit on top of painted splat weights.
- **Combos:** `VERTEX_COLOR_AND_RULES` and `SPLAT_MAP_AND_RULES` = painted base + rules on top. This is what a large world wants: rules everywhere, paint only where it matters.
- **Generated meshes:** the same rules can be evaluated **on the CPU at mesh generation** into vertex colours (p306 `generateTerrain` v2), which trades per-pixel ALU for a vertex attribute. The handbook compares both.

### D5 — Projection (`nodes/Projection.ts`, extends `triplanarProjection` from `aekasha/toolkit/materials`)

- **`PLANAR`:** world XZ; 1 tap per set sample.
- **`BIPLANAR`:** Quilez: the two most significant axes, with gradients; 2 taps. Its seams are less visible than a slope-gated planar, at 2/3 of triplanar's cost.
- **`TRIPLANAR`:** 3 taps, weights `pow(|n|, sharpness)` normalized.
- **`slopeGate: [a, b]`:** below `a` degrees, PLANAR; above `b`, the configured mode; in between, blended.
  - It's implemented with a dynamic `If` on the slope, so flat pixels never pay for the extra taps.
  - Divergence happens only along the band.
  - Remember the TSL trap the sky box layers hit (`src/_engine/features/skybox/CLAUDE.md`, its two traps): a TSL `If` must not be the first to build a node that other branches share, so build the shared coordinates before the branch.
- **Per layer:** `projection` overrides the material's, so typically only the cliff layer is TRIPLANAR.

### D6 — Sparse top-K (`nodes/Sparse.ts`, ARRAY storage only)

- For L ≤ 16 weights, a fixed compare-exchange network keeps the top `maxLayers` (2–4) indices and weights.
- Only those are sampled from the arrays (dynamic layer index into the array textures), and the kept weights are renormalized.
- Most terrain pixels have 1–2 non-trivial layers, so 8-layer terrains cost about what 2–3 layers would.
- Artifacts: popping where a third layer crosses the cut-off. The height blend hides most of it; `maxLayers: 3` hides the rest.

### D7 — Macro, distance, colour map (`nodes/Macro.ts`, `Distance.ts`, `ColorMap.ts`)

- **Macro:** `macroNoise` sampled at `positionWorld.xz / scale` (large scales, 1 fetch for all layers) modulates brightness, hue (a small rotation in YIQ) and roughness. Continuous across blocks (p301 §7).
- **Distance:**
  - Beyond `fade[0]`, detail normals fade toward the geometry normal.
  - Beyond `fade[1]`, per-layer sampling stops (`If` on view distance) and the colour comes from:
    - `AVERAGE_COLOR`: Σ wᵢ · averageColorᵢ, zero layer fetches; each set's `averageColor` comes from p303 D1 (computed by the encode step);
    - or `COLOR_MAP`: 1 fetch.
  - Far terrain then costs the weights plus 0–1 fetches.
  - **No popping line** (p350 §3): a `farBlend` band (metres past `fade[1]`, default 4) samples both and mixes them, so the switch to the far colour has no visible edge moving with the camera; 0 = a hard switch. Only pixels in the band pay for both.
- **Colour map + detail** (`colorMap.mode: 'DETAIL'`):
  - A unique per-block colour map (mesh UV) supplies the albedo.
  - Layers supply **detail** only: albedo divided by its set's `averageColor` (≈ 1 on average), normal and roughness.
  - That gives unique large-scale colour (painted paths, burn marks, baked large-scale AO) plus close-up detail.
  - `FAR_ONLY` uses the colour map only beyond `distance.fade[1]` (a far LOD for any technique).
- **In-engine colour-map bake:** `bakeTerrainColorMap(blockMesh, material, size)`.
  - It renders the block's terrain material top-down (orthographic, albedo output only through an MRT variant of the material) into a texture with p304's baker.
  - Large-scale AO from the vertex AO can be multiplied in.
  - Exportable through p304 D5, then committed and KTX2-encoded per block.
  - Blender's bake path is documented in p306.

### D8 — Structure mode

- **For concrete walls, bunkers, rock faces and other large structures:** `space: 'OBJECT'` (the texture sticks to a moving or instanced object; `triplanarProjection`'s `alignToObject`) or `'WORLD'` (static, seamless across pieces).
- **Defaults:** `TRIPLANAR` projection and `DUAL_SCALE` anti-tiling, macro on.
- **`blend.source: 'VERTEX_COLOR'`** with the `RGBA` layout can drive wear layers: clean / stained / damaged concrete.
- **Decals** (p309) add unique detail.
- **Helper:** `createStructureMaterial(setId | layers, opts)` is a thin preset over `createTerrainMaterial`.

### D9 — Storage and the binding budget

- **`SEPARATE`:** each layer's packing textures are bound individually (`textureSet` resolver bundles).
- **`ARRAY`:** one array per packing slot (`textureSetArray`), plus splat/macro/colour map.
- **`AUTO`** computes the bindings and picks `ARRAY` when `SEPARATE` would exceed `budget = deviceLimit − reserved`.
  - `reserved` defaults to 6: shadow maps, environment, PostFX-irrelevant extras. Configurable.
  - WebGL2 uses its texture unit limit (also 16).
- Over budget even with arrays: a clear error listing what is bound.
- **Mixed sources:** procedural (baked, uncompressed) and imported (compressed) sets can't share an array (p304 D3), so AUTO splits them into two arrays and says so in a dev log.

### D10 — Quality variants and debug views

- **Quality:** `quality.LOW` etc. are config overrides. `getTerrainMaterialVariant(id, level)` returns them through `getMaterialVariant` with a `staticDefines` override, so each tier is its own pipeline.
- **Suggested defaults** (tuned in Phase 6 from gallery measurements):

| Tier   | Anti-tiling                      | Projection                          | Sparse | Macro | Far mode                |
| ------ | -------------------------------- | ----------------------------------- | ------ | ----- | ----------------------- |
| LOW    | NONE (or DUAL_SCALE beyond 20 m) | PLANAR; cliffs BIPLANAR slope-gated | top-2  | on    | AVERAGE_COLOR from 60 m |
| MEDIUM | DUAL_SCALE                       | cliffs TRIPLANAR slope-gated        | top-3  | on    | from 120 m              |
| HIGH   | DUAL_SCALE; HEX on DOMINANT      | cliffs TRIPLANAR slope-gated        | top-3  | on    | from 200 m              |
| ULTRA  | HEX on ALL                       | cliffs TRIPLANAR                    | top-4  | on    | none                    |

- **Debug views** (`debugView`, compiled only when `IS_DEBUG_ENV`). Their node code lives in `src/toolkit/terrain/debug/_dbg__DebugViews.ts` (a debug folder holds nothing that ships) and is reached only by an `import()` behind `IS_DEBUG_ENV` in `createTerrainMaterial` (never a static import, never inside a `try`), so a production build folds it away; the JSON route uses it once the gallery tab has preloaded it:
  - `WEIGHTS`: false colour per layer;
  - `LAYER_COUNT`: how many layers a pixel sampled (sparse check);
  - `TEXEL_DENSITY`: a 1 m checker with px/m colour bands;
  - `MIP`: the mip level the GPU picked;
  - `PROJECTION`: triplanar weights, plus the slope-gate band;
  - `NORMALS`;
  - `HEIGHT`;
  - `TAPS`: the estimated texture fetches for that pixel, heat-mapped, which makes the p301 §6 formula visible;
  - `WETNESS` (p307).

---

## Phases

Each phase adds a gallery row (or extends one) so it can be checked and measured: the app's `terrainGallery` scene (`src/app/scenes/terrainGallery/`, p303's skeleton, its tab the scene-scoped `_dbg__terrainGallery.ts` there). Each module gets its `*.test.ts` next to it (`yarn test`, Node, no GPU: the config schema, and which branches a config builds).

### Phase 1 — Scaffold and single layer

1. Config schema/types, `createTerrainMaterial`, `registerTslMaterial('aek.terrain', { setup })`, JSON route (`src/toolkit/materials/terrain/terrain.tsl.ts` + `terrain.material.json`, importing the builder from `aekasha/toolkit/terrain`), all exported from `aekasha/toolkit/terrain` with JSDoc and `@example`s (the docs ratchet).
2. `SINGLE` source, PLANAR world tiling, all three packings, surface uniforms, AO routing (D2 rules), world→view normal.
3. Quality variant mechanism; debug view framework with `TEXEL_DENSITY` and `NORMALS`.

**Exit:** gallery blocks switch from `textureSetSurface` to the terrain material with identical looks, a JSON material and a code-created one render the same, and the shader only contains enabled features (inspect the WGSL).

### Phase 2 — Anti-tiling, macro, distance (D3, D7 minus colour map)

**Gallery row "Anti-tiling":** three 48 × 48 m flat blocks of `grass01` with NONE / DUAL_SCALE / HEX, plus macro on/off.

**Exit:** HEX shows no mip seams at grazing angles, and DUAL_SCALE hides repetition from a 30 m camera height.

### Phase 3 — Blending (D4 minus rules, D9)

1. `VERTEX_COLOR` (both layouts), `SPLAT_MAP` (1–2), LINEAR/HEIGHT blend.
2. SEPARATE and ARRAY storage, AUTO with budget errors.
3. `WEIGHTS` debug view.
4. Test meshes get procedural vertex colours and splat `DataTexture`s generated in code. Blender versions come in p306.

**Gallery row "Splatting":**

- 5-layer vertex-colour block;
- 5-layer splat-map block;
- the same with LINEAR vs HEIGHT;
- a 9-layer ARRAY block.

### Phase 4 — Rules (D4 rules and combos)

**Gallery row "Rules":** a 64 m generated block with grass → rocks by slope → snow by height and aspect → cliffs on steep faces, plus the same block with a painted splat + rules combo.

### Phase 5 — Projection (D5)

**Gallery row "Cliffs":** one block with PLANAR / BIPLANAR / TRIPLANAR / slope-gated, plus `PROJECTION` and `TAPS` views.

### Phase 6 — Sparse sampling and the performance pass (D6, D10 tiers)

1. Sparse top-K; `LAYER_COUNT` view.
2. Measure every gallery row per tier (p310 defines the measurement method; here, the stats panels' GPU readout from a fixed camera, `src/_engine/debug/CLAUDE.md`'s GPU timing).
3. Set the default tier table.

**Exit:** an 8-layer HIGH-tier terrain stays under the agreed budget (proposal: ≤ 3 ms GPU at 1080p on the reference machine; record the machine).

### Phase 7 — Colour map + detail, far modes, structures (D7, D8)

1. `colorMap` DETAIL / FAR_ONLY, `distance.far` (using p303's `averageColor`), `bakeTerrainColorMap`.
2. Structure mode, `createStructureMaterial`, `concrete01` / `concrete02` on a wall and bunker piece.

**Gallery rows "Colour map" and "Structures".**

### Phase 8 — Live procedural layers

1. `source: 'PROCEDURAL_LIVE'` using p304's live mode.

**Gallery:** the "Procedural" row gains a live toggle inside a blended terrain.

### Phase 9 — Handbook pages and versioning

1. **Pages:** write `terrain-single-layer.md`, `terrain-vertex-color-splat.md`, `terrain-splat-map.md`, `terrain-procedural-rules.md`, `terrain-triplanar-cliffs.md`, `terrain-colormap-detail.md` and `structure-materials.md`, following the page template (p301 §5), with measured numbers from Phase 6.
   - Their sections 5–7 (Blender, Export, Import) get a placeholder linking `terrain-blocks-blender.md`, completed in p306.
2. **Content each page must carry:**
   - **Single layer:** "Best for" small arenas, stylized, top-down; poor fit for open worlds without macro. Variations: tiling multiplier, rotation per layer, DUAL_SCALE vs HEX (why, cost), macro (why it beats bigger textures).
   - **Vertex-colour splat:**
     - Mesh density sets the border resolution (≈ vertex spacing); the height blend hides it.
     - Layouts `RGB_AO` vs `RGBA`.
     - Variation: vertex AO (why: large-scale AO for free, indirect-only and correct) vs texture AO.
     - Best for: Blender-authored blocks, third-person and RTS; poor fit for sharp painted paths on coarse meshes.
   - **Splat map:** resolution-independent borders, 4 vs 8 layers (2 maps), memory per block, `data` codec choice; best for first-person hero areas and roads/paths.
   - **Procedural rules:** zero authoring, works on generated meshes; CPU-baked rules into vertex colours vs per-pixel rules (cost table); best for procedural worlds, survival/sandbox, prototypes; poor fit for art-directed hero spots without a painted combo.
   - **Triplanar cliffs:** planar stretching explained; triplanar vs biplanar vs slope-gated (taps and seams); normal blend options; best for mountain/canyon worlds, first and third person; top-down rarely needs it.
   - **Colour map + detail:**
     - Unique colour without unique-texture VRAM.
     - Bake in engine or in Blender.
     - Variation: AO and large-scale lighting baked into the colour map. Why: one fetch for all large-scale shading. Cost: static lighting assumptions; don't bake direct sunlight if day-night runs.
     - Best for: top-down/RTS/isometric, flight/racing (fast, far views), far LOD.
   - **Structures:** world vs object space, triplanar defaults, wear via vertex colours, decals; concrete examples; best for brutalist/industrial levels and large architecture.
3. **Hub** (`hub/CLAUDE.md`): the terrain feature page (`hub/pages/features/terrain/`, p303 creates it): what the generator does, the config, the JSON route, the budget and the tiers, `api:` links to `aekasha/toolkit/terrain`, a `::: scene terrainGallery` panel, links to the handbook pages; the toolkit feature page (`features/toolkit/guide.md`) lists the new category. Then `yarn hub:build`.
4. **Repo docs:**
   - `readme.md` Features (toolkit: terrain material generator) and a short example.
   - A nested `src/toolkit/terrain/CLAUDE.md` (created by the first plan that needs it, if p303 hasn't; a line in the root's Architecture map) gets a `## Terrain materials` section: config, JSON route, budget, tiers, debug views. The feature page's `aek:covers` names it. The root's toolkit catalogue (Three-folder split) names the `terrain/` category.
5. **Versions:** toolkit minor; app minor (gallery rows); `CHANGELOG.md`.

---

## Risks

| Risk                                                                    | Mitigation                                                                                                                                                                     |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Shader permutations explode (config × tiers × variants)                 | Permutations are only created on use; the gallery is the worst case; `compileAsync` at load; document "one material per biome" (p301 §7)                                       |
| Dynamic array indexing (sparse) is slow or unsupported on a backend     | It's WGSL-legal and GLSL ES 3.0-legal for `sampler2DArray` layer coordinates. If it measures slow, fall back to fixed-count sampling of all layers with zero-weight early-outs |
| HEX `grad` sampling with compressed arrays shows artifacts on some GPUs | Gallery check on both backends; `apply: 'DOMINANT'` default; LOW tier avoids HEX                                                                                               |
| Height blend needs height in all layers                                 | MINIMAL and LITE carry height; procedural sets always do; LINEAR is chosen automatically when a set lacks it (warning)                                                         |
| `If` branches in TSL build shared nodes inside a branch (sky box trap)  | Build shared coordinates and weights before any `If`; covered in the code comments                                                                                             |
| Splat textures per block multiply pipelines                             | Verified by p302 Phase 3's spike: a variant with another texture id adds a node build but no pipeline; `NodeMaterialInstance`s would save the builds too (p990, Rendering)     |
