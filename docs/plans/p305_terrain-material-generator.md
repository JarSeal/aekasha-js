Status: in progress | Phases 1-4 implemented
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

### Phase 1 — Scaffold and single layer — done

1. Config schema/types, `createTerrainMaterial`, `registerTslMaterial('aek.terrain', { setup })`, JSON route (`src/toolkit/materials/terrain/terrain.tsl.ts` + `terrain.material.json`, importing the builder from `aekasha/toolkit/terrain`), all exported from `aekasha/toolkit/terrain` with JSDoc and `@example`s (the docs ratchet).
2. `SINGLE` source, PLANAR world tiling, all three packings, surface uniforms, AO routing (D2 rules), world→view normal.
3. Quality variant mechanism; debug view framework with `TEXEL_DENSITY` and `NORMALS`.

**Exit:** gallery blocks switch from `textureSetSurface` to the terrain material with identical looks, a JSON material and a code-created one render the same, and the shader only contains enabled features (inspect the WGSL).

**As built:**

- **Where:** the generator is `src/toolkit/terrain/material/` (a folder, not files at `terrain/`'s root: the layout's "a piece that grows a second file gets its own folder", one rule in `layoutRules.ts`): `TerrainMaterialConfig.ts` (Zod schemas and types), `TerrainDefine.ts` (the define read by hand), `TerrainMaterial.ts` (the graph and both routes), `TerrainDebugViews.ts` (the views' loader). The normals are `nodes/TerrainNormals.ts`, the debug views `debug/_dbg__DebugViews.ts` (its own layout rule). The later phases' modules: nodes in `nodes/`, the rest of the generator in `material/`.
- **The sets are inputs, not part of the define.** The gather's texture closure reads a material's `inputs` and `nodes`, never `staticDefines`, so a layer's set is the input `layer<i>: { textureSet, packing? }` (later phases: a `{ textureSetArray }` input for ARRAY storage). The static define (`staticDefines.terrain`, `TerrainMaterialDefine`) is the config without `id`, `packing` and the layers' `set`; `getTerrainMaterialProps(config)` makes both, and a variant swaps a block's set through `inputs.layer<i>` without another shader. The packing lives in the inputs; the setup refuses layers in different packings.
- **No zod in a build.** The graph imports only types from the schema; `readTerrainDefine` checks the define by hand (unknown keys refused, enums, ranges, the error naming the path) and `TerrainDefine.test.ts` keeps it and the schema in step (keys, values, a shared list of defines both take and refuse). A new field goes in both.
- **The schema grows per phase and is strict:** Phase 1's fields are `layers` (`source: 'TEXTURE'`, `tiling`, `rotation`, `tint`, `normalStrength`, `roughnessScale`), `packing` (code route), `uv` (`WORLD` | `MESH_UV`), `blend.source: 'SINGLE'`, `ao.textureInfluence`, `quality`, `qualityLevel`, `debugView` (`TEXEL_DENSITY` | `NORMALS`). D1's other fields are refused until their phase adds them (`heightContrast` / `heightOffset` with Phase 3's height blend, `ao.vertex` / `bakedAlbedoInfluence` with Phase 3's vertex AO, `space` with Phase 7).
- **A layer's values multiply the set's** (`tiling` × `physicalSize`, `tint`, `normalStrength`, `roughnessScale` × the set's `surface` field), so the defaults look like `textureSetSurface`. Uniforms: `terrain_l<i>_<name>` (`tiling`, `tint`, `normalStrength`, `roughnessScale`; `rotation` only when given) and `terrain_aoTextureInfluence` (only when a layer has texture AO). MINIMAL's roughness is 0.8 (the baseline's), its normal always the bump.
- **Normals:** world space per layer (planar: the analytic frame, U along `(cos, 0, −sin)` of the rotation, Gram–Schmidt against `normalWorldGeometry`, a safe normalize on vertical faces; `MESH_UV`: the derivative frame on world vectors; MINIMAL: `bumpNormalWorld`), converted once (`cameraViewMatrix`). Front faces only (the geometry normal isn't flipped on a back face). Measured against the baseline (2026-11-16, WebGPU, the gallery, every packing): identical walls, at most 2-10 / 255 on the blocks, and up to 25 / 255 on 0.06 % of cliffs01's pixels, on the 35° ramp: the planar frame is unit length where the baseline's derivative frame keeps the slope's stretch (D2's choice, kept).
- **AO:** FULL's map to `aoNode` as `mix(1, ao, aoStrength × ao.textureInfluence)`; LITE and MINIMAL get none (their AO is in the albedo). Phase 3's vertex AO adds `bakedAlbedoInfluence` for those.
- **`createTerrainMaterial` stays synchronous** (it registers `aek.terrain` and calls `createMaterial`): the sets' textures must be loaded (a scene that lists them, or `await ensureMaterialDependencies(getTerrainMaterialProps(config))`). The debug views load with a public preload, `loadTerrainDebugViewsAsync()` (the `import()` behind `IS_DEBUG_ENV`); a material asking for a view before it builds without the view, warned, and starts the load.
- **Quality:** the define's `quality` table (each tier `TerrainQualityOverrides`: `uv`, `blend`, `ao` so far, shallowly over the material's) and `qualityLevel`, which the reader applies first. `getTerrainMaterialVariant(id, level)` is `getMaterialVariant(id, { staticDefines: { terrain: { ...define, qualityLevel } } })` with the material's own define (the setup keeps it at `userData.terrainDefine`), so a block's variant gets its tier with its own sets. Phase 6 adds the tiers' fields as their techniques land.
- **Debug views** are unlit (black albedo, roughness 1, the view in `emissiveNode`): `TEXEL_DENSITY` the colour slot's width over the tile's metres (`textureSize`) in bands (under 128 texels a metre blue, 128 cyan, 256 green, 512 yellow, 1024 orange, 2048+ red) over a 1 m checker of the tiling's coordinates; `NORMALS` the shaded world normal × 0.5 + 0.5. With more layers (Phase 3) the views read the blended values.
- **The gallery:** the library blocks are variants of the JSON route's `terrain` (`inputs.layer0`; the walls `uv: 'MESH_UV'`), the Procedural row's imported mode too. The tab's Material control switches the library between the JSON route, the code route (`createTerrainMaterial`, a material per set, packing, wall and view) and the baseline, and its Debug view select shows a view on the terrain modes (it preloads the views); both saved.
- **The exit, measured (2026-11-16, WebGPU, Chrome headless, the gallery's overview and close-ups of sand01, cliffs01 and grass01):** JSON and code routes byte-identical in every packing and both views; the baseline as above. WGSL of a block (three's lighting adds 3 samples and 1 `dpdx`): LITE planar 2 own samples and no derivatives, FULL 3, MINIMAL 1 and the bump's 2 `dpdx`, a wall's `MESH_UV` 2 `dpdx`; no `cos` without a rotation; `TEXEL_DENSITY` adds `textureDimensions` and `log2`, and drops the colour sample with the view.

### Phase 2 — Anti-tiling, macro, distance (D3, D7 minus colour map) — done

**Gallery row "Anti-tiling":** three 48 × 48 m flat blocks of `grass01` with NONE / DUAL_SCALE / HEX, plus macro on/off.

**Exit:** HEX shows no mip seams at grazing angles, and DUAL_SCALE hides repetition from a 30 m camera height.

**As built:**

- **Distance is the detail normals' fade only** (decided 2026-11-16): `distance: { fade: [from, to] }`, the shaded world normal mixed to `normalWorldGeometry` by a smoothstep of the view distance (`nodes/Distance.ts`, uniform `terrain_distanceFade`), before the one conversion to view space (the `NORMALS` view shows it). `distance.far` and `farBlend` are refused until **Phase 7**, which adds `AVERAGE_COLOR` with `COLOR_MAP`: it needs the `textureSets()` feature's `{ textureSet }` bundle to carry the set's `averageColor` as a uniform (an engine change on `aekasha/texturesets`: the graph sees bundles, never set ids; the colour is only in `TextureSetDef`).
- **The config** (`TerrainMaterialConfig.ts`, the hand reader in step): `antiTiling` is a discriminated union by `mode`, each mode's own fields only (another mode's field is refused): `NONE`; `DUAL_SCALE` `farScale` (0..1 exclusive, default 0.23) and `distance` (`[from, to]` m, default `[6, 40]`); `HEX` `hexContrast` (0.05..0.95, default 0.5) and **`hexRotation`** (0..1 of a full turn either way, default 1; not in D1: a directional set, ripples or strata, wants less). Material-wide and per layer, a layer's own replacing the material's whole object; a tier's `antiTiling` replaces the material's, **not a layer's own** (Phase 6 decides whether a tier reaches the layers). **`apply: 'DOMINANT'` isn't built**: it needs several layers' weights (Phase 3), so the schema refuses it until Phase 3 or 6 adds it. `macro: { scale, brightness?, hue?, roughness? }` (defaults 0.2, 8°, 0.15), its texture the input `macro` (`{ texture }`, made by `getTerrainMaterialProps` from the code route's `macro.texture`), like the layers' sets: the gather's closure loads it. `macro` isn't a tier override (its texture is an input). The quality overrides take `antiTiling` and `distance` besides Phase 1's.
- **Anti-tiling** (`nodes/AntiTiling.ts`, `sampleAntiTiled`, internal): one `TextureSetSample` back, its tangent normal in the layer's UV frame (each tap's turned back by its angle, `R(−a)`), so the layer's frame and surface code are unchanged. Uniforms per layer, the mode's only: `terrain_l<i>_farScale`, `terrain_l<i>_antiTilingDistance` (vec2); `terrain_l<i>_hexContrast`, `terrain_l<i>_hexRotation`.
  - `DUAL_SCALE`: the second tap at `uv × farScale` turned 37° and offset `(0.37, 0.61)`; its share `mix(p, p + 0.5, smoothstep(distance))` with `p` the macro's B patches (`smoothstep(0.3, 0.7, B) × 0.5`), 0 without a macro. Its normal is the blend, not rescaled for the larger tap.
  - `HEX`: Heitz–Neyret's triangle grid at `2√3` a tile (a hex about half a tile), per vertex an offset (`hashCell22`) and an angle (`hashCell12`, another seed; the layer's index seeds both), the tap's UV turned about its hex's centre, sampled with `dFdx`/`dFdy` of the layer's UV turned alike (`grad`); weights `w⁷ × mix(1, h, 0.6)` (the tap's height, not Mikkelsen's luminance: every packing has it), normalized, through Mikkelsen's `Gain3` (`k = −log2(1 − hexContrast)`), normalized again. **The weight is clamped to 0..1 before the gain**: one normalized to a hair over 1 gave `pow` a negative base, a NaN, a black pixel (a few hundred a frame before the clamp).
- **Macro** (`nodes/Macro.ts`): one fetch at the world's `(x, −z) / scale`, built before the layers; albedo × `1 + R′·brightness`, then **three's TSL `hue`** (a turn about the grey axis, in place of D7's YIQ: the same job, no code of ours) by `G′·hue` degrees; roughness × `1 + G′·roughness`, capped at 1 (`R′`, `G′`: the channel − 0.5, × 2). B goes to `DUAL_SCALE`'s share, so with `DUAL_SCALE` the normal reads the macro fetch too. Uniforms `terrain_macroScale`, `terrain_macroBrightness`, `terrain_macroHue`, `terrain_macroRoughness`. The setup throws for `macro` without the input, an input that isn't a texture node, or the input without `macro`.
- **Tests:** node structure only (taps × slots per mode and packing, gradients on HEX's taps only, the patches' reach, one macro fetch, the uniforms). Three's `Node.traverse` walks a shared node once per path, exponential on a hex graph: the tests walk each node once (`getChildren` and a set).
- **The gallery's Anti-tiling row** (`antiTilingRow.ts`, the tab's section `_dbg__terrainGalleryAntiTiling.ts`): three flat 48 m planes of `grass01`, x −56 / 0 / 56, behind the library **and the Procedural row** (which reaches to z −38; the row's centre z −70), each a variant of the JSON route's `terrain` (mode, macro on/off, debug view in its define; macro scale 64 m, a block's worth); the scene lists `macroNoise`. The tab: the macro switch, live sliders for the modes' and the macro's uniforms (written into whichever variant a block shows), and the blocks' list flying the camera 30 m up, grazing (eye height along the ground) or close (`flyGalleryCamera`, the camera module's pose flight, which the 12 m blocks' flight now uses). The Debug view select and the 1 m checker cover the row; the Procedural measurement hides it.
- **The exit, measured** (2026-11-16, Chrome headless, 1280 × 800 canvas at DPR 1, the row's blocks 30 m up and grazing; the repetition figure is a screenshot crop's high-passed luminance autocorrelation, its highest value at a shift of 8 px or more):

  | grass01, 30 m up | repetition | frame GPU ms (WebGPU), macro off / on |
  | ---------------- | ---------- | ------------------------------------- |
  | empty frame      | –          | 1.36 / 1.42                           |
  | `NONE`           | 0.27 (32 px: one 1.4 m tile) | 1.59 / 1.86          |
  | `DUAL_SCALE`     | 0.03       | 1.69 / 2.03                           |
  | `HEX`            | 0.02       | 2.59 / 2.75                           |

  `DUAL_SCALE` and `HEX` take the repetition out (the macro doesn't change the figure: the high-pass drops its broad variation). `HEX` grazing shows no seam or line at the hexes' borders, its far band like `NONE`'s; its `NORMALS` view shades the pebbles alike in every hex (rocks01, close). WebGL2 (ANGLE on the same GPU) renders all three within 0.04 / 255 of WebGPU on average, nothing over 16, the same repetition figures. Cost, one 48 m block filling most of the frame: `HEX` about 1 ms over `NONE`, `DUAL_SCALE` 0.1-0.2 ms; Phase 6 measures the tiers properly.

### Phase 3 — Blending (D4 minus rules, D9) — done

1. `VERTEX_COLOR` (both layouts), `SPLAT_MAP` (1–2), LINEAR/HEIGHT blend.
2. SEPARATE and ARRAY storage, AUTO with budget errors.
3. `antiTiling.apply: 'DOMINANT'` (D3: HEX on the highest-weight layer, DUAL_SCALE on the rest), refused by Phase 2's schema until the weights exist; or leave it to Phase 6 with the tiers.
4. `WEIGHTS` debug view.
5. Test meshes get procedural vertex colours and splat `DataTexture`s generated in code. Blender versions come in p306.

**Gallery row "Splatting":**

- 5-layer vertex-colour block;
- 5-layer splat-map block;
- the same with LINEAR vs HEIGHT;
- a 9-layer ARRAY block.

**As built:**

- **Blend config** (`TerrainMaterialConfig.ts`, the hand reader in step): `blend` is a discriminated union by `source` (`SINGLE`; `VERTEX_COLOR` with `vertexColor: { layout: 'RGB_AO' | 'RGBA' }` (default `RGB_AO`), `mode`, `heightBlendDepth`; `SPLAT_MAP` with `mode`, `heightBlendDepth`), another source's field refused. The layer count suits the source (`TERRAIN_BLEND_LAYER_COUNTS`: `SINGLE` 1, `RGB_AO` 2-4, `RGBA` 2-5, `SPLAT_MAP` 2-9), checked for the material and each tier. `mode` `HEIGHT` (default) or `LINEAR`; `heightBlendDepth` 0.02..0.5 (default 0.2, Mishkinis's), refused with `LINEAR`. **D1's `splatMaps: 1 | 2` isn't a define field:** the count follows the layers (one map per four past the base), the code route's `splatMaps` is the maps' texture ids (the inputs `splat0`, layers 1-4, and `splat1`, 5-8). Layers take `heightContrast` (≥ 0, × the set's) and `heightOffset` (−1..1); ignored, not refused, without the height blend, so a tier can switch to `LINEAR`. `ao.vertex` (`RGB_AO` only) and `ao.bakedAlbedoInfluence` (0..1, default 0.5: the vertex AO's influence on a `LITE` / `MINIMAL` material, whose albedo has its AO baked in; `FULL` applies it whole).
- **Weights** (`nodes/Weights.ts`): one raw weight per layer from the vertex colour (`vertexColor()`, `COLOR_0`: a mesh without one reads white) or the splat maps (each sampled once at `uv()`); layer 0 `max(0, 1 − Σ)`; only the channels of the layers there are read. **The height blend** (`nodes/HeightBlend.ts`): Mishkinis × the weight (Unity's terrain form: a layer nobody painted never rises through a border on its height alone), normalized, with a floor that falls back to the linear weights where the top layer is unpainted; **the layer's height for it is `(h − 0.5) · contrast + 0.5 + offset`** (about the middle, not D2's `h · contrast + offset`: a contrast would lift a layer over its neighbours). The layers' surfaces (albedo, world normal, roughness, texture AO) blend by the final weights before the macro, the distance fade and the one view-space conversion; `aoNode` = the blended texture AO × `mix(1, vertexAo, terrain_aoVertexInfluence)`. Uniforms: `terrain_heightBlendDepth`, `terrain_l<i>_heightContrast` / `_heightOffset` (height blend only), `terrain_aoVertexInfluence` (`ao.vertex` only).
- **Storage** (D9; `material/TerrainInputs.ts`, `material/TerrainStorage.ts`): the graph takes the layers as `SEPARATE` (the inputs `layer<i>`, a `{ textureSet }` each) or `ARRAY` (one input `layers`, a `{ textureSetArray }` bundle, its layer `i` the layer `i`, each tap `.depth(i)`, the set's values from `getTextureSetLayerParams`): both at once, a non-array `layers` or another layer count throw. **The budget:** the setup counts what it binds (the layers' slots, the splat maps, the macro) against the renderer's limit (WebGPU: the lower of `maxSampledTexturesPerShaderStage` and `maxSamplersPerShaderStage`; WebGL2: `MAX_TEXTURE_IMAGE_UNITS`; 16 before the renderer) less `reservedTextures` (new, 0-15, default 6, both routes) and throws listing it. `storage: 'AUTO' | 'SEPARATE' | 'ARRAY'` is the code route's only (default `AUTO`: `SEPARATE` while it fits, else `ARRAY`; the array's packing is the config's or the sets' default, which must agree). A code-made `ARRAY` material needs its set array built first (`buildTextureSetArray`, or the scene's `textureSetArrays`); the JSON route's arrays are the gather's. **A variant of a `SEPARATE` material can't become `ARRAY`** (a variant's inputs merge over the base's, and the kernel refuses an `undefined` input that would drop `layer0`): an `ARRAY` material is its own base. **D9's split of procedural and imported sets into two arrays isn't built:** Phase 8 (an array refuses a procedural set, the engine's error).
- **`antiTiling.apply: 'DOMINANT'` moves to Phase 6** (still refused): it saves taps only with a per-pixel branch (`select()` evaluates both sides), and that branch costs here: a TSL `If` runs only inside a `Fn` and hands five values to separate sockets, the shared UV, gradients and macro patches must be built before it (the sky box trap), and WGSL forbids implicit-derivative `textureSample` in non-uniform control flow (every `DUAL_SCALE` tap would need `.grad()`). Phase 6's sparse top-K samples the kept slots from the arrays at a dynamic layer index, sorted by weight: slot 0 is the dominant layer, `HEX` there and `DUAL_SCALE` on the rest, no branch (`ARRAY` only).
- **Debug views:** `WEIGHTS` (each layer's false colour, layer 0 white, 1 red, 2 green, 3 blue, 4 yellow, … 16 colours, × the final weights, over a faint 1 m checker); `TEXEL_DENSITY` blends each layer's log2 density by the weights; the views take every layer and the weights (`TerrainDebugViewContext`'s `layers` and `weights`).
- **The gallery's Splatting row** (`splattingRow.ts`, the tab's section `_dbg__terrainGallerySplatting.ts`): six 24 × 24 m `generateTerrain` blocks (96 segments, 1.6 m noise, one seed, lifted so the deepest hollow stands on the ground) left of the library, two columns, `LINEAR` left of `HEIGHT`: the vertex colour (`RGBA`, 5 layers: grass01, rocks01, sand01, mud01, snow01), the splat map (256² RGBA `DataTexture`, mipmapped, 5 layers), then `RGB_AO` with `ao.vertex` (4 layers, A darker in the hollows) left of 9 layers (+ cliffs01, ice01, grass02, mud02; two splat maps). One painted pattern (`paintWeights`: rocks in blobs, a sandy path, mud in the hollows, snow on the tops, a cliff band, an ice pool, a grass patch, a mud ring) feeds the vertex colours and the splat maps. **Code route materials, storage `AUTO`**, not variants of `terrain` (above): the vertex blocks bind 10 textures (`SEPARATE`, at the budget), the 5-layer splat blocks 11 (`AUTO`: `ARRAY`), the 9-layer block `ARRAY`; the scene's `textureSetArrays` lists the two lists. The tab: the camera pose of a click (above, close), live sliders for `terrain_heightBlendDepth`, rocks01's `heightOffset` and `terrain_aoVertexInfluence`, the blocks' list with each block's storage; the Debug view select reaches the row (and gained Weights); the 1 m checker covers it.
- **Found on the way:** three's `BufferGeometry.copy` shares `userData` by reference, so two clones of one generated terrain shared their registry id (the mesh warning "unregistered geometry"): a clone gets its own `userData`.
- **Measured** (2026-11-16, Chrome 157 headless on the Windows GPU, AMD RDNA 3, WebGPU, 1280 × 800, each block filling the frame from 17 m up, the median of 90 frames' GPU time): empty frame 0.14 ms; the 5-layer blocks 0.24 ms (vertex colour and splat map alike, `LINEAR` and `HEIGHT` alike: the height blend is ALU, the splat map one fetch); `RGB_AO` 4 layers 0.22; 9 layers `ARRAY` 0.36. Every block renders its painted layers in place (`WEIGHTS`), `HEIGHT`'s borders crisp and broken by the layers' relief against `LINEAR`'s smear; no console errors. WebGL2 (the same Chrome, `navigator.gpu` hidden: ANGLE on the GPU, 16 texture units) renders every block within 0.6 / 255 of WebGPU on average (0.05-0.23 % of the pixels over 16, scattered: filtering at the height blend's fine borders), the same GPU times (empty 0.18 ms, 5 layers 0.24, 9 layers 0.34), no shader error. **SwiftShader's WebGL2 (WSL2's Chromium) fails to link a gallery program and loses the context during the load, with or without the row and at Phase 2's commit too:** not this phase's (the scene runner's WSL2 runs use the Windows Chrome's WebGPU and don't see it).

### Phase 4 — Rules (D4 rules and combos) — done

**Gallery row "Rules":** a 64 m generated block with grass → rocks by slope → snow by height and aspect → cliffs on steep faces, plus the same block with a painted splat + rules combo.

**As built:**

- **The type** is `geometry/generate/TerrainRules.ts` on `aekasha/toolkit/geometry` (D1's place): `TerrainRule`, `TerrainRuleRange`, `TerrainRuleAspect`, `TerrainRuleNoise`, `TERRAIN_RULE_NOISE_CHANNELS` and `TERRAIN_RULE_DEFAULTS`, plain TS (no zod in `geometry`). `TerrainRuleSchema` is in `TerrainMaterialConfig.ts`, and `TerrainDefine.test.ts` checks its inferred type equals `TerrainRule` (`expectTypeOf`). p306's `evaluateTerrainRulesCPU` goes next to the type and reads the defaults from there.
- **The rule's shape differs from D1:** a range is `{ min?, max?, softness? }` per test, not a `[number, number]` tuple with one rule-wide `softness` (slope is degrees and height metres, so one softness can't serve both, and height needs open ends, "above 40 m"). The range is where the rule is whole; its softness fades it out **past** each given end (an end not given is open), so `slope: { max: 30 }` is whole on flat ground. Defaults: slope softness 5°, height 2 m, aspect 15°. `aspect: { direction: [x, z], range, softness? }`: the downhill direction (the geometry normal's horizontal part) within `range` degrees of `direction`; flat ground has no facing and passes (the test fades in between 1.1° and 5.7° of slope). `noise: { scale, amount, channel? }` (channel default `R`): the macro texture's channel at `(x, −z) / scale` moves the coverage by `(n − 0.5) · 2 · amount`, clamped to 0..1, **before** `strength`. A rule needs at least one of slope, height, aspect or noise (one with none covers everything: a mistake); 1 to 16 rules (`TERRAIN_MAX_RULES`); a rule's `layer` is one of the material's.
- **Sources:** `RULES` (layer 0 everywhere under the rules), `VERTEX_COLOR_AND_RULES` and `SPLAT_MAP_AND_RULES` (D1's), each with `rules`, `mode` and `heightBlendDepth`; up to 16 layers. The paint weighs layers from 0: a combo's **`blend.paintedLayers`** (new, 2 or more; default the source's most, 4 `RGB_AO`, 5 `RGBA`, 9 splat maps, or the layer count), the splat map count following it (one map per four painted layers past the base); every layer past the painted ones must be some rule's ("nothing weighs it" otherwise). `ao.vertex` takes `VERTEX_COLOR_AND_RULES` with `RGB_AO` too. The resolved define's blend always has `rules` (empty for a painted source alone) and `paintedLayers` (null: the default).
- **The graph** (`nodes/Rules.ts`): the incoming weights are the paint's for its layers (only those channels read) and 0 for the rest, or layer 0 alone for `RULES`; each rule composites over them in order, `w = w · (1 − c) + onehot · c`; then the height blend or the linear normalization as before, so the rules' soft masks get the height blend's crisp borders. The slope is `acos(normalWorldGeometry.y)` in degrees, measured once for all rules; the height is `positionWorld.y` (world metres: a block's lift moves its snow line). Softness has a floor (1e-4: `smoothstep` with equal edges is undefined). No `If`: every rule is ALU on every pixel. Uniforms per rule `terrain_r<i>_<name>`, its tests' only (`slopeMin`, `slopeMax`, `slopeSoftness`, `heightMin`, `heightMax`, `heightSoftness`, a range's given ends only; `aspectDirection`, `aspectRange`, `aspectSoftness`; `noiseScale`, `noiseAmount`; `strength`); the layer and the channel are build-time.
- **The noise texture is the input `macro`:** one fetch per rule with noise (each at its own scale, a uniform, so it can't share the macro variation's fetch), the material's `macro` sharing the texture; it counts in the budget. The code route fills the input from `macro.texture`, else **`noiseTexture`** (new, code route only, refused with `macro` or without rule noise; default `macroNoise`). An input `macro` the define doesn't use is still refused, unless a tier's rules have noise (`takesMacroTexture`: a tier's variant shares the base's inputs).
- **The gallery's Rules row** (`rulesRow.ts`, the tab's section `_dbg__terrainGalleryRules.ts`): two 64 × 64 m blocks in front of the library and the Splatting row (z 48..112), on one `generateTerrain` (128 segments, two octaves of 4 m shifted to 0..8 m, a 7 m step along a wavy line for the cliff band, the relief fading to 0 over the outer 10 m so the block stands on the ground). Left `RULES` (grass01, rocks02, snow01, cliffs01: 8 textures and `macroNoise`, `SEPARATE`), right `SPLAT_MAP_AND_RULES` with `paintedLayers: 3` (grass01, sand01 path, mud01 in the hollows, one 256² splat map) and the same rules (6 sets: `AUTO` makes it `ARRAY`, the scene's third `textureSetArrays` entry). The rules: rocks from 26° (`macroNoise` A at 18 m, 0.35), snow above the top less 4 m on slopes under 38° facing within 70° of north (−z), R at 40 m, 0.25; cliffs from 46°. The tab: the camera pose of a click (above, close to the cliff band), live sliders for the rules' uniforms (rocks' slope and noise, the snow line and facing, the cliffs' slope) and the height blend depth, the blocks' list; the Debug view select and the 1 m checker cover the row. Code route materials (`createTerrainMaterial`), a debug view a variant over the material's own define (`userData.terrainDefine`: a slider writes a uniform, never another variant).
- **Measured** (2026-11-16, Chrome 157 headless on the Windows GPU, AMD RDNA 3, 1280 × 800, each block filling the frame from 30 m over its top, the median of 90 frames' GPU time):

  | WebGPU / WebGL2 (ms)                              | WebGPU | WebGL2 |
  | ------------------------------------------------- | ------ | ------ |
  | empty frame                                       | 0.08   | 0.10   |
  | the rules block: one layer (grass01)              | 0.10   | 0.12   |
  | its 4 sets by vertex colour, no rules             | 0.14   | 0.14   |
  | `RULES`, 4 layers, 3 rules (2 noise fetches)      | 0.15   | 0.16   |
  | `SPLAT_MAP_AND_RULES`, 6 layers (`ARRAY`), 3 rules | 0.19   | 0.19   |

  The rules cost about 0.01 ms over the same layers painted. Every rule lays its layer where it should (`WEIGHTS`, both blocks); the snow line breaks up along the noise, the rocks gather at the cliff's foot, the painted path shows on the flat and gives way to rocks where it climbs. WebGL2 (the same Chrome, `navigator.gpu` hidden) renders within 0.1-0.9 / 255 of WebGPU on average (0.1-2.1 % of the pixels over 16: fine filtering in the grass and sand, the stats panels, the clouds), no console errors on either. **The cliff faces stretch** (vertical streaks): planar world tiling on a vertical face, which Phase 5's projection fixes.
- **Found on the way:** the scratch measurement imports the app's modules by their Vite URL; after an edit, Vite serves the changed module under a `?t=` URL, so an import of the plain URL is a second instance (a restart of the dev server makes them one again).

### Phase 5 — Projection (D5)

**Gallery row "Cliffs":** one block with PLANAR / BIPLANAR / TRIPLANAR / slope-gated, plus `PROJECTION` and `TAPS` views.

### Phase 6 — Sparse sampling and the performance pass (D6, D10 tiers)

1. Sparse top-K; `LAYER_COUNT` view.
   - `antiTiling.apply: 'DOMINANT'` (D3, moved from Phase 3, see its As built): with sparse sampling the top slot is the dominant layer, `HEX` there and `DUAL_SCALE` on the other kept slots, no branch; `ARRAY` storage only (refuse it with `SEPARATE`, or decide whether a branchy `SEPARATE` form is worth building after measuring).
2. Measure every gallery row per tier (p310 defines the measurement method; here, the stats panels' GPU readout from a fixed camera, `src/_engine/debug/CLAUDE.md`'s GPU timing).
3. Set the default tier table.

**Exit:** an 8-layer HIGH-tier terrain stays under the agreed budget (proposal: ≤ 3 ms GPU at 1080p on the reference machine; record the machine).

### Phase 7 — Colour map + detail, far modes, structures (D7, D8)

1. `colorMap` DETAIL / FAR_ONLY, `distance.far` (`AVERAGE_COLOR`, `COLOR_MAP`, `NONE`) with D7's `farBlend` band (Phase 2 built only `distance.fade`, the normals' fade), `bakeTerrainColorMap`. `AVERAGE_COLOR` needs the set's `averageColor` (p303) in the `{ textureSet }` bundle as a uniform: an engine change on `aekasha/texturesets` (its nested `CLAUDE.md`, the Hub; an engine minor).
2. Structure mode, `createStructureMaterial`, `concrete01` / `concrete02` on a wall and bunker piece.

**Gallery rows "Colour map" and "Structures".**

### Phase 8 — Live procedural layers

1. `source: 'PROCEDURAL_LIVE'` using p304's live mode.
2. D9's mixed sources (moved from Phase 3): procedural (baked) and imported sets can't share a set array, so `AUTO` splits them into two arrays (a dev log saying so), the graph reading each layer from its array.

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
