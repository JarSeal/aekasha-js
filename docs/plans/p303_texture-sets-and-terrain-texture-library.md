Status: draft | not-implemented
Category: Assets, Materials, Terrain
Blocks: p304_procedural-texture-baker.md, p305_terrain-material-generator.md
Epic: p301_terrain-texturing-epic.md

# Texture Sets & the Terrain Texture Library

This plan delivers:

- **Texture sets**: a new engine asset type (`*.textureSet.json`). A texture set is a named group of packed PBR maps plus the physical facts about the surface (tile size, height relief, wet response).
- **Layer arrays**: several sets of one packing assembled into array textures, so a terrain material binds 2–3 textures however many layers it uses.
- **The toolkit terrain library**: 16 CC0 sets (2 each of sand, mud, rocks, cliffs, snow, ice, grass ground, plus 2 optional concrete). They have a fetch script and packing recipes, and ship as KTX2 through p300.
- **The `terrainGallery` scene skeleton**: one isolated, engine-generated block per set.
- **The handbook**: `docs/techniques/README.md` and `docs/techniques/texture-sets.md`.

---

## Context (grounded, re-grounded 2026-11-04)

- After p300:
  - texture JSONs may have relative `fileName`s and `pack` sources (`TexturePackSchema`, `schemas/AssetsConfigSchema.ts`: per target channel a `src`, `channel`, `remap`, `invert` and a `multiply` by a constant or another image's channel with a `strength`);
  - outputs are KTX2 in `src/public/aek-assets/`, recorded in `assets.lock.json`, with the profiles and slots of `assets.config.json` (its `terrainLayer` and `terrainBlock` profiles exist already);
  - `loadTextureAsync` loads `.ktx2` through a shared `KTX2Loader` on the main thread (`kernel/assets/import/KTX2.ts`).
  - The pipeline's commands and checks: `devTools/assetPipeline/CLAUDE.md`.
- After p302:
  - material inputs go through a resolver registry (`registerMaterialInputResolver`, with `dependencies`), registered from an install or a first call, never at module load;
  - `setup` TSL entries take shared `inputs`;
  - scenes get a per-scene dependency closure in the gather.
- **The gather** handles 14 suffixes (p299 and p374 added `textureArray`, `textureAtlas` and `mergeMaterial`) (`GATHERED_SUFFIXES`, `devTools/gather/gatheredJson.ts`). A new suffix needs: a schema in `src/_engine/schemas/` on `aekasha/schemas` (each field documented twice: JSDoc on the key and a `.describe()`), an entry in `GATHERED_SUFFIXES` / `GATHERED_SCHEMAS`, its registry and id space (`devTools/gather/context.ts`), a scene list resolved in `devTools/gather/sceneAssets.ts`, a `generatedAppData` section (`devTools/gather/output.ts`), its JSON Schema (`devTools/gather/jsonSchemas.ts`) and a runtime-type pair in `schemas/RuntimeTypes.test.ts`. `devTools/gather/CLAUDE.md` has the steps; the gather fails on an invalid file, a duplicate id and an id a scene lists that no asset JSON has.
- Asset ownership and release are in `kernel/assets/AssetOwners.ts` and `kernel/assets/SceneAssetRelease.ts`. Textures are released when no material uses them (`isTextureUsedByAnyMaterial`, `kernel/assets/Material.ts`), unless `getKeptTextures` keeps them (a scene's `retainedTextures` hook, the root scene's background and environment).
- After p299 (Phases 0-5): `buildTextureArray` (`kernel/assets/TextureArray.ts`, on `aekasha`) assembles same-sized KTX2 members into a `CompressedArrayTexture` (uncompressed fallback: `DataArrayTexture`). An array is a registered texture owned by the scene that built it (no ref counts: the engine releases by owner and material use); `swappable: true` keeps its CPU copy so `setTextureArrayLayer` can swap a layer. Build-time `*.textureArray.json` arrays, `sampleArrayLayer` and `getArrayLayerIndex` exist too, and the Assets tab shows an array's layers with a GPU preview.
- After p299 Phase 5 (its D5, the JSON binding): a material input `{ "textureArray": id, "layer": name | index }` samples a layer of a texture array asset at the mesh UV, and `{ "atlas": id, "slot", "cell", "clampToCell"? }` an atlas cell. How p299 kept them out of every build is the pattern for this plan's resolvers (D1, D4):
  - **Only the import-free parts are in the kernel:** the forms' types, predicates and dependency functions in `kernel/assets/MaterialInputRefs.ts` (`getBuiltInInputDependencies`, which `getMaterialInputDependencies` falls back to when no registered resolver matches). The gather's `INPUT_DEPENDENCY_FNS` (`devTools/gather/textureClosure.ts`) imports the same functions, so the scene closure adds the textures, and checks a layer, slot or cell against the asset (a missing one fails the gather).
  - **The resolvers are `import()`ed and registered by the async paths that load what they sample** (`Texture.ts`' `loadTextureInputResolversAsync`, awaited by the array and atlas slot loads and `buildTextureArray`), never by `installKernel`: registered there, they would have pulled `sampleArrayLayer` and `sampleAtlasCell` into every build (the banner's `_engine/kernel/assets` group had 255 B of headroom). Its chunk is 0.7 kB gzip.
  - **So a form's dependencies must not need its resolver:** a lazily registered resolver isn't there when `ensureMaterialDependencies` asks, which is why the dependency functions are built-in forms. Without the resolver, `createTslInputNode` (`MaterialTsl.ts`) samples the white texel with the missing texture's warning.
  - A runtime array (D4's `buildTextureArray` output) can't be named by a material JSON: the gather fails on an id no asset JSON has. Code can pass `{ "textureArray": <its id>, "layer" }` to `createMaterial`, but a JSON material still needs D4's own resolver.
- WebGPU's default `maxSampledTexturesPerShaderStage` is 16. Shadow maps and the environment PMREM count against it (p301 §6).
- `generateTerrain` (`toolkit/geometry/generate/Terrain.ts`, on `aekasha/toolkit/geometry`) builds an indexed grid with `position`, `uv` and `normal` (no tangents, no colour), seeded simplex noise, and returns `getHeightAt` (bilinear over the grid's triangles) / `heights` (row-major; Rapier's HEIGHTFIELD is column-major: `docs/issues/heightfield-grid-layout.md`).
- **Where things go** (p301 §2): the sets are toolkit assets in `src/toolkit/textures/<setId>/`, the code in the toolkit's `terrain` category (`aekasha/toolkit/terrain`), the TSL materials in `src/toolkit/materials/<id>/`, the gallery in `src/app/scenes/terrainGallery/`.

---

## Design

### D1 — The `*.textureSet.json` asset

**Schema:** `src/_engine/schemas/TextureSetSchema.ts` (on `aekasha/schemas`), the set folder `src/toolkit/textures/<setId>/`.

```json
{
  "$schema": "../../../../.schemas/textureSet.schema.json",
  "id": "sand01",
  "category": "SAND",
  "physicalSize": [3, 3],
  "heightScale": 0.03,
  "defaultPacking": "LITE",
  "packings": {
    "LITE": { "albedoRough": "sand01_albedoRough", "normalHeight": "sand01_normalHeight" },
    "FULL": {
      "albedoHeight": "sand01_albedoHeight",
      "normal": "sand01_normal",
      "orm": "sand01_orm"
    },
    "MINIMAL": { "albedoHeight": "sand01_albedoHeightAO" }
  },
  "surface": {
    "tint": "#ffffff",
    "normalStrength": 1,
    "roughnessScale": 1,
    "aoStrength": 1,
    "heightContrast": 1,
    "porosity": 0.85,
    "wetDarkening": 0.55,
    "wetRoughness": 0.4
  },
  "debugData": { "name": "Sand 01 (dry dunes)", "description": "ambientCG Ground080, CC0" }
}
```

- **`category`**: `SAND | MUD | ROCKS | CLIFF | SNOW | ICE | GRASS | CONCRETE | OTHER`. p305 uses it for defaults, p307 for wet-response defaults, p310 for the gallery's grouping.
- **`physicalSize`**: metres covered by one tile. **`heightScale`**: metres of relief that height = 1 represents. Used for height blending, puddles and parallax-free depth cues.
- **`packings`**: at least one. Each slot is a texture id. Slot names are fixed per packing (D2).
- **`surface`**: defaults the terrain material copies into uniforms. Each layer of a terrain material can override any of them.
- **`averageColor`** (the linear-averaged albedo of the shipped map) is **computed by the asset pipeline's pack/encode step** (new: `devTools/assetPipeline/textures.ts`, recorded in the lock entry, so a cache hit has it). It's stored as generated metadata of the albedo texture (`__averageColor`, a field of `GeneratedAssetFieldsSchema` set in `devTools/assetPipeline/generated.ts`) and exposed through `getTextureSet(id).averageColor`. An optional `averageColor` in the set JSON overrides it. The source JSON is never written back. p305 uses it for the zero-fetch far mode and for colour map + detail.
- **Runtime** (decided 2026-11-13, Phase 1's drift: the `textureSets()` feature, `features/texturesets/TextureSet.ts`, on `aekasha/texturesets`; was `kernel/assets/TextureSet.ts` on `aekasha`): `getTextureSet(id)`, `loadTextureSetAsync(id, packing?)` (loads only that packing's textures) and `getTextureSetPackingTextures(id, packing)`.
- **SBP:** nothing registers at load. The resolvers (D1's, D4's) are the only part every build would carry once the kernel's install registers them. p299 Phase 5 avoided that without a feature (see Grounding: import-free dependency functions in the kernel, the resolvers `import()`ed by the loads that need them); try that first. Phase 1 measures them with `yarn sbp` and, if they still show in the kernel's group, makes texture sets an opt-in feature (`features/textureSets/` with `TextureSet.ts`, since the kernel imports no feature code; its install registering the resolvers through its `FeatureContext`, a `FeatureSchemaPart` for the scene's `textureSets` so the scene's feature manifest names it; `src/_engine/kernel/init/CLAUDE.md`'s Engine features).
- **Ownership:** texture sets are owned and released like other assets. A set is plain data; its textures are what get released.
- **Scenes:** the scene schema (`schemas/SceneSchema.ts`) gets an optional `textureSets: string[]` for code-only use, resolved in the gather's scene pass (`devTools/gather/sceneAssets.ts`) into the sets' packing textures. p302 D6 adds sets referenced by materials automatically.

### D2 — Packings (binding conventions)

| Packing   | Slot           | R         | G         | B         | A         | Colour space    | Codec (p300 slot)                          |
| --------- | -------------- | --------- | --------- | --------- | --------- | --------------- | ------------------------------------------ |
| `FULL`    | `albedoHeight` | albedo    | albedo    | albedo    | height    | sRGB (A linear) | UASTC (`baseColor`)                        |
|           | `normal`       | N.x       | N.y       | N.z       | –         | linear          | UASTC (`normal`)                           |
|           | `orm`          | AO        | roughness | metalness | –         | linear          | UASTC (`orm`)                              |
| `LITE`    | `albedoRough`  | albedo×AO | albedo×AO | albedo×AO | roughness | sRGB (A linear) | UASTC (`baseColor`)                        |
|           | `normalHeight` | N.x       | N.y       | height    | –         | linear          | UASTC (`data`, not normal mode: B isn't Z) |
| `MINIMAL` | `albedoHeight` | albedo×AO | albedo×AO | albedo×AO | height    | sRGB (A linear) | UASTC or ETC1S (`baseColor`)               |

- **Normals** use the OpenGL convention (+Y), as three.js does: ambientCG `NormalGL`, Poly Haven `nor_gl`. Never the DX variants.
- **LITE** reconstructs N.z = √(1 − x² − y²).
- **MINIMAL** gets its normal from screen-space height derivatives (a bump from `dFdx/dFdy`, no extra fetch) or uses a flat normal, per material option.
- **Height** is remapped per set to the full 0..1 range when packing. The real relief is `heightScale`.
- **Missing AO** (the Ice and Concrete034 sources have none) is derived when packing as a **cavity term** from height: `ao = 1 − k·max(0, blur(height, r) − height)`. Constant 1 is the fallback. This is a new pack-recipe option (`TexturePackSchema`'s channel source, `devTools/assetPipeline/pack.ts`), not a code path at runtime.
- **AO into albedo** (LITE, MINIMAL), with `aoStrength` applied at pack time:
  - **Why:** it saves the AO fetch (and in LITE, all of ORM) per layer, per anti-tiling tap, per projection, which is the biggest multiplier in p301 §6. Pebble-scale crevice AO looks the same whether it darkens all light or only indirect light.
  - **Cost:**
    - AO now darkens direct sunlight too. That's wrong for large-scale occlusion: never bake valley- or rock-scale AO into a tiling layer (that belongs in vertex AO or a colour map, p306/p305).
    - It stacks with screen-space GTAO (the app's `src/app/postFx/ambientOcclusion.tsl.ts`, a `postFx()` pass), so p305 lowers the material's AO influence when the layer's AO is baked (`docs/analysis/ambient-occlusion-options.md` rule: combine with `min()` or split by scale).
- **Metalness** is constant 0 for terrain. FULL keeps the channel for glTF compatibility, since structures may use it.
- **Mipmaps:** all mip levels are generated at encode time (p300). Height and roughness in alpha are mipmapped as linear data; sRGB applies to RGB only.

### D3 — Pack recipes in texture JSON (uses p300's `pack`)

The LITE `albedoRough` of `sand01`:

```json
{
  "id": "sand01_albedoRough",
  "pack": {
    "size": [2048, 2048],
    "channels": {
      "rgb": {
        "src": "./source/raw/color.jpg",
        "multiply": { "src": "./source/raw/ao.jpg", "channel": "r", "strength": 0.8 }
      },
      "a": { "src": "./source/raw/roughness.jpg", "channel": "r" }
    }
  },
  "optimize": { "profile": "terrainLayer", "slot": "baseColor" },
  "texOpts": { "wrapS": "REPEAT", "wrapT": "REPEAT", "colorSpace": "srgb", "anisotropy": "MAX" }
}
```

- `./source/raw/` holds the downloaded maps renamed to fixed names (`color`, `normal`, `roughness`, `ao`, `height`; D5). So recipes are identical across sets apart from the strengths.
- The p300 resize step makes the 1K output from the 2K source.

### D4 — Layer arrays

**`buildTextureSetArray({ id, sets: string[], packing, swappable? }): TextureSetArray`**, in `kernel/assets/TextureSet.ts`, a thin layer over p299's `buildTextureArray` (p299 D1 owns the assembly: KTX2 per-mip concatenation, the uncompressed fallback, format validation and layer swaps; its Phase 0 rejected GPU assembly):

- Returns one array texture per slot of the packing (2 for LITE): one `buildTextureArray` call per slot, with `members` = that slot's texture id of each set. Layer `i` = `sets[i]`.
- A per-layer uniform array holds `physicalSize`, `heightScale` and the surface defaults.
- **Requirements** (checked by p299 D1, errors name the set): all sets have the packing; every slot has the same resolution and mip count; the transcoded format is the same, which holds when every slot was encoded with the same codec.
- **Runtime assembly, not p299's build-time arrays**, so the debug tab and p310's gallery can swap a member: `setTextureSetArrayLayer(arrayId, i, setId)` calls p299's `setTextureArrayLayer` per slot. Only a `swappable` array can (it keeps its CPU copy, about its VRAM size again in memory); a shipped material's array isn't, so its copy is dropped after the upload.
- **Resolver** (p302 D4): `{ "textureSetArray": ["sand01", "grass01", "rocks01", "cliffs01"], "packing": "LITE" }` → a bundle `{ arrays: { albedoRough, normalHeight }, layerCount, layerParams }`. Its `dependencies` list every member texture.
- Array ids are derived from the member list and packing, so two materials with the same palette share one array (`buildTextureArray`'s `arr:<hash>` does this for a non-swappable array; a swappable one gets a unique id). The array is owned and released like any registered texture.

### D5 — The fetch tool

- **`devTools/fetchTextureSources.ts`** (`yarn fetchTextureSources [--only <setId>] [--force]`; a dev tool by the root `CLAUDE.md`'s coding standards: the repo's folders from `devTools/paths.ts`, `sha256` and atomic writes from `devTools/files.ts`, `main()` only when run as the script, promises named `*Async`). It reads every `source.json` in a texture set folder (`src/toolkit/textures/*/`, and an app set's folder):

```json
{
  "provider": "ambientCG",
  "assetId": "Ground080",
  "download": "2K-JPG",
  "license": "CC0-1.0",
  "page": "https://ambientcg.com/view?id=Ground080",
  "maps": {
    "color": "_Color",
    "normal": "_NormalGL",
    "roughness": "_Roughness",
    "ao": "_AmbientOcclusion",
    "height": "_Displacement"
  }
}
```

- **ambientCG:** `https://ambientcg.com/get?file=<assetId>_<download>.zip`. This URL pattern is what the ambientCG v2 API (`/api/v2/full_json?id=…&include=downloadData`) returns as `downloadLink`.
- **Poly Haven:** `https://api.polyhaven.com/files/<assetId>` → per-map URLs (`Diffuse`, `nor_gl`, `Rough`, `AO`, `Displacement`; `arm` is a ready-made AO/rough/metal pack).
- **Behaviour:**
  - Downloads are cached in `.cache/texture-downloads/` (gitignored).
  - Maps are matched by file-name suffix, extracted with a zip reader added to `devTools/assetPipeline/archives.ts` (Node's `zlib.inflateRawSync`, as its `ar` / `tar` / `cpio` / `xar` readers: no new dependency; `fflate` only if that proves bigger) and written to `<setDir>/source/raw/<map>.<ext>`.
  - A set's `source/raw/` (the fetched maps) is gitignored, a pattern for the set folders only: the other assets' `source/` folders are committed, and so are a set's own sources beside `raw/` (p304's exported PNGs).
  - A missing optional map (`ao`) is logged as such, never as an error.
- **Download size:** use `2K-JPG` by default (≈ 20–40 MB per zip, ≈ 0.5 GB for all 16 sets, one-off and cached). `2K-PNG` (≈ 55–75 MB) is worth it only for a set whose normal map shows JPEG blocking at 1K, typically cliffs.
- **Why 2K sources for 1K output:** downsampling averages out JPEG artifacts and gives clean mips. 4K is unnecessary for tiling layers. 2K output is kept for an optional `terrainLayerHero` profile (cliffs, first-person close-ups).
- **Credits:** `src/toolkit/textures/CREDITS.md` is generated from the `source.json` files (asset, provider, licence, page), written only when it changed (`writeFileIfChanged`). CC0 requires no attribution, but the record keeps provenance clear. The layout check needs a rule for it (`devTools/layout/layoutRules.ts`' toolkit rules: `textures/` has only its per-id folders).

### D6 — The library (toolkit, 16 sets)

These are candidates checked against the providers' APIs (2026-10-02): the ids exist and the maps are as listed. **Pick by eye in Phase 4**: open each candidate's page and keep it, or swap in the alternate. `physicalSize` for assets whose API dimension is 0 is an estimate; confirm it with the gallery's 1 m texel-density overlay (p305 debug view, or a temporary checker in Phase 5).

| Set          | Look                               | Primary (ambientCG) | Alternate                | physicalSize       | Maps         | Notes                                               |
| ------------ | ---------------------------------- | ------------------- | ------------------------ | ------------------ | ------------ | --------------------------------------------------- |
| `sand01`     | dry beige sand                     | `Ground080`         | PH `aerial_sand`         | 3 m                | C N R AO H   |                                                     |
| `sand02`     | coastal sand, accumulation ripples | `Ground093C`        | PH `coast_sand_05`       | 3 m                | C N R AO H   | Wet-response showcase                               |
| `mud01`      | soil mud                           | `Ground036`         | PH `brown_mud_02`        | 2.5 m              | C N R AO H   |                                                     |
| `mud02`      | forest mud with sticks             | `Ground071`         | PH `brown_mud_leaves_01` | 1.75 m (API)       | C N R AO H   | Puddle showcase                                     |
| `rocks01`    | gravel / rocky ground              | `Ground079S`        | PH `aerial_rocks_02`     | 2 m                | C N R AO H   |                                                     |
| `rocks02`    | mossy stony ground                 | `Ground068`         | PH `brown_mud_rocks_01`  | 2 m                | C N R AO H   |                                                     |
| `cliffs01`   | grey mountain cliff                | `Rock051`           | PH `cliff_side`          | 6 m                | C N R AO H M | Triplanar showcase; candidate for 2K                |
| `cliffs02`   | dark cave cliff                    | `Rock035`           | ambientCG `Rock058`      | 6 m                | C N R AO H   |                                                     |
| `snow01`     | clean snow                         | `Snow010A`          | PH `snow_02`             | 3 m                | C N R AO H   |                                                     |
| `snow02`     | wind-shaped snow                   | `Snow008A`          | PH `snow_field_aerial`   | 4 m                | C N R AO H   |                                                     |
| `ice01`      | lake ice                           | `Ice002`            | ambientCG `Snow014`      | 4 m                | C N R H      | AO derived (D2)                                     |
| `ice02`      | lake ice, variant                  | `Ice004`            | ambientCG `Ice003`       | 4 m                | C N R H      | AO derived                                          |
| `grass01`    | lawn-grass ground, top-down        | `Grass004`          | ambientCG `Grass005`     | 1.4 m (API)        | C N R AO H   | Ground layer only, no blades                        |
| `grass02`    | forest floor with grass            | `Ground037`         | PH `forrest_ground_01`   | 2.1 m (API)        | C N R AO H   |                                                     |
| `concrete01` | smooth concrete                    | `Concrete034`       | PH `brushed_concrete`    | 1.1 × 0.55 m (API) | C N R H      | Non-square: structures only, never in a layer array |
| `concrete02` | damaged concrete                   | `Concrete044D`      | —                        | 2 m                | C N R AO H M | Structures                                          |

Map key: C colour, N normal (GL), R roughness, AO ambient occlusion, H height/displacement, M metalness (ignored).

**What ships:**

- Every set: `LITE` at 1K (KTX2 UASTC + Zstd, ≈ 0.6–1.2 MB per map; ≈ 2.7 MB of VRAM per set with mips).
- `sand01`, `grass01` and `cliffs01` also ship `FULL` and `MINIMAL`, for the packing comparison in the gallery.
- `cliffs01` ships an optional 2K LITE (`terrainLayerHero`).
- Committed outputs ≈ 16 × 2 × ~0.9 MB + extras ≈ 35–40 MB.

### D7 — `textureSetSurface` toolkit material (baseline and preview)

- `src/toolkit/materials/textureSetSurface/` (`textureSetSurface.material.json`, `textureSetSurface.tsl.ts`): a `setup` TSL material that renders **one** texture set with world-space tiling (`positionWorld.xz / physicalSize`), any packing, and `surface` uniforms. No anti-tiling, no splat.
- It is the baseline every technique in p305 is compared against, the gallery's isolated-block material and the simplest structure material.
- **Decode helper** `src/toolkit/terrain/nodes/SampleTextureSet.ts` (the toolkit's modules are PascalCase), on `aekasha/toolkit/terrain`: `sampleTextureSet(bundle, uv, { packing, grad? }) → { albedo, normalTS, roughness, ao, height }`. It is shared by p305 (array and non-array variants); the material's TSL file imports it through the entry (a toolkit category imports another only so).

### D8 — `terrainGallery` skeleton (app)

- `src/app/scenes/terrainGallery/` (`terrainGallery.scene.json`, `terrainGallery.ts`, the scene's own asset JSONs; p609's scene folder rule). Its sky box needs the `skyBox()` feature (the scene's feature manifest names it).
- **Blocks:** a 4 × 4 grid of 12 × 12 m blocks with 4 m gaps, one per set, all from `generateTerrain`:
  - 48 segments, gentle 0.4 m noise;
  - one edge raised into a 35° ramp, so normals and later triplanar can be judged;
  - a distinct seed per block.
- **Look:** sky box `dayNight` (`src/app/skyboxes/dayNight.skybox.json`), paused at 10:00. `cliffs*` blocks get a vertical 6 m wall piece.
- **Scene-scoped debug tab** `src/app/scenes/terrainGallery/_dbg__terrainGallery.ts` (pattern: `scenes/space/_dbg__spaceDemo.ts` and the Hub's debug tab example, `src/app/examples/debugTab/`): a `createDebuggerTab` from `aekasha/debug`, its pane items the UI kit's fields (compact density):
  - a list of sets (`debuggerListCMP`), where clicking one flies the camera to it;
  - a packing selector (a segmented control, for the 3 sets that ship all packings);
  - a "1 m checker" switch for checking `physicalSize`.
- p305 adds the technique rows, p307 the wet controls, and p310 the camera presets and measurements.

---

## Phases

### Phase 1 — Asset type and runtime (D1, D2)

1. Schema (both documentation layers), the gather's suffix, registry, scene list and generated section, JSON Schema, the runtime-type pair, `gatheredJson.test.ts` passing on the repo's JSONs.
2. `kernel/assets/TextureSet.ts` (summaries and `@example`s: it's on `aekasha`), ownership, scene `textureSets`; unit tests next to it.
3. Resolver `{ "textureSet": id }` with dependencies (its dependency function in a module the gather may import, p302 D6).
4. `yarn sbp`: the kernel's group against its budget; the feature decision of D1's SBP note.
5. The Assets tab (`kernel/assets/debug/`): a texture's info window names the set and slot it belongs to.

**Exit:** a hand-made set (PNG sources, no pipeline) loads through a material input and is released on scene exit.

Branch `p303_texture-sets-and-terrain-texture-library`, from `main` at p299's merge (`4d325077`, engine 6.12.0).

**Drift found (2026-11-13, against `main` after p302 and p299 Phases 5-6):**

- **SBP headroom:** `yarn sbp --profile all` on `main`: the banner's (and uiKit's) `_engine/kernel/assets` group is 11,249 B gzip against 11 KiB (11,264 B): 15 B left, not p299's 255 B (its Phase 5 took 0.2 kB). `MaterialInputRefs.ts` ships in the banner (252 B gzip), so a built-in `textureSet` dependency form there fails the banner. The app: initial 398.7 kB of 399 KiB (301 B left), `_engine/kernel/assets` 14,054 of 14,336 B.
- **p299's lazy pattern doesn't carry over:** its resolvers are `import()`ed by the loads of an array or atlas slot. A set has no load of its own in a scene load (the gather turns it into plain texture ids in the scene's `textures`), so something must register the `{ textureSet }` resolver for a scene's JSON materials: a feature's install.
- **A set's dependencies need its data:** a slot's texture id is any id, not derivable from the set's. The dependency function takes a lookup (`(value, getSet)`); the gather's `INPUT_DEPENDENCY_FNS` (one-argument functions in a module-level list) changes to take it.
- **Production data holds only scenes:** `getTextureSet(id)` in a build reads the set from a scene's data, so the gather writes the set inline into each scene that lists it or whose material names it (as impostor definitions), and the development data gets a `textureSets` section.
- **Streaming:** the manifest's `addTextureRefs` finds a material's texture ids among its strings; a set's maps aren't strings in `{ textureSet }`, so a cell-only material's set textures would stay in the base. Handled as p299 handled atlas cells (its section 2).
- **A 13th feature:** `ENGINE_FEATURE_FACTORIES` and its test, `src/index.ts`'s list, "twelve" in the root and `kernel/init` `CLAUDE.md`, `readme.md` and the Hub, an alias (`devTools/aliases.ts`, `tsconfig.json`). Feature folders and entries are lowercase: `features/texturesets/`, `aekasha/texturesets`, id `texturesets`, factory `textureSets()`. The asset schema is `schemas/TextureSetSchema.ts` (D1's place: the material schema checks the input form, and a schema imports no feature, the layout check), the scene part the feature's (`features/texturesets/TextureSetsSchema.ts`, as `spatial()`'s part beside `schemas/SpatialDomainSchema.ts`); both on `aekasha/schemas`.
- **The Assets tab** (kernel debug) reads the set and slot of a texture from the development data's `textureSets` section: no feature import.

**Decided (2026-11-13, in review):**

1. **Texture sets are the opt-in `textureSets()` feature from the start** (D1's SBP note's fallback, by the numbers above): its install registers the resolver; nothing of it reaches the banner. The app's budgets: measured in section 3, changed only after asking.
2. **The resolver's bundle:** each slot's texture node of the packing, plus uniforms `physicalSize` (vec2), `heightScale` and each `surface` field (`tint` a colour, the rest floats), flat in one bundle (the slot names and the field names don't collide).
3. **A scene's `textureSets: ["sand01"]` loads the set's default packing only;** code needing another packing in a production build lists its textures in the scene, as for any texture only code uses. A material's `{ textureSet, packing? }` adds that packing's textures (the closure).
4. **The gather fills the defaults** into the generated set (`defaultPacking`: the JSON's, else `LITE` when the set has it, else `FULL`, else `MINIMAL`, `TEXTURE_SET_PACKING_PREFERENCE`: zod keeps no JSON key order; `surface`: every field, `TEXTURE_SET_SURFACE_DEFAULTS` for the missing ones), so the runtime has no defaults table. The wet response's defaults (`porosity` 0.5, `wetDarkening` 0.5, `wetRoughness` 0.3) are provisional: p307 sets them per category.

Sections:

1. **The asset in the gather:** `TextureSetSchema.ts` (asset, the scene part `textureSets`, both documentation layers), the suffix, its registry and id space, pass 1's checks (each slot a texture asset, `defaultPacking` one of `packings`, a colour-space warning per D2's table), the scene pass (the set inline, its default packing's textures appended), the development section, the JSON Schema, `gatheredJson.test.ts` and `gather.test.ts` cases.
2. **The input form:** the import-free refs module (on `engineImports.test.ts`' list), the closure (the set inline and the packing's textures; an unknown set or a packing it lacks fails the gather naming the material and the input), the streaming manifest, the feature manifest.
3. **The feature and runtime:** `textureSets()`, the resolver at install, `getTextureSet` / `loadTextureSetAsync` / `getTextureSetPackingTextures`, the runtime-type pair, the entry and alias, the factory list, the template, the feature's `CLAUDE.md` and the docs naming twelve features, unit tests; `yarn sbp` (budgets: ask first).
4. **The Assets tab and the exit:** a texture's info window names its set and slot; a debug scene `textureSets` with a hand-made PNG set drawn through `{ textureSet }`, on WebGPU and WebGL2, its textures released on exit; this phase's "As built" and the status line.

#### Section 1: The asset in the gather — done

As built (2026-11-13; `yarn test`, `tsc` both, lint, `yarn verify:baselines --docs`, `yarn gatherAppData`: the repo's generated data gains only the empty development section `textureSets: {}`):

- `schemas/TextureSetSchema.ts` (section 1 put it in the feature's folder; section 2 moved it, keeping the scene part there as `features/texturesets/TextureSetsSchema.ts`), on `aekasha/schemas`: `TextureSetAssetSchema` (strict packings and `surface`, each key with a JSDoc and a `.describe()`; `packings` refined to at least one), `TEXTURE_SET_CATEGORIES`, `TEXTURE_SET_PACKINGS` (each packing's slots in order: the order a packing's textures are listed and loaded), `TEXTURE_SET_PACKING_PREFERENCE`, `TEXTURE_SET_SURFACE_DEFAULTS`, `isTextureSetColorSlot` (`albedo*`), the types `TextureSetAsset`, `TextureSetDef` (the gathered form: `id`, `defaultPacking` and every `surface` field required), `TextureSetPacking`, `TextureSetSlot`, `TextureSetSurface`, and `textureSetsSchemaPart` (feature `texturesets`, the scene's `textureSets: string[]`), last in `ENGINE_SCHEMA_PARTS`.
- **The default packing:** zod rebuilds an object in its schema's key order, so "the JSON's first packing" isn't knowable: without `defaultPacking` it's `LITE` when the set has it, else `FULL`, else `MINIMAL` (`TEXTURE_SET_PACKING_PREFERENCE`).
- `averageColor` is in the schema now (the JSON's override, sRGB like every JSON colour); the pipeline's measured value is Phase 2's.
- The gather (`devTools/gather/textureSets.ts`): `readTextureSets` after `readTextureAssets` (its own id space `textureSets`, no `__saveData`: in `TYPES_WITHOUT_SAVE_DATA`). Errors: a slot naming no `*.texture.json`, or a texture array, an atlas or its slot, or a merge material slot (`packings.<packing>.<slot>: …`); a `defaultPacking` the set lacks. Warnings: a colour slot's texture without `texOpts.colorSpace: "srgb"`, a data slot's with it. `resolveTextureSets` runs after the meshes, before the texture closure: each listed id once, replaced by the set's `TextureSetDef` (production: no `debugData`), its default packing's textures appended to `textures` unless listed by id; an unknown id fails as any unknown id. `getTextureSetPackingTextureIds` and `appendSceneTextureIds` are exported for section 2's closure. The development data's `textureSets` section is the registry (with `__sourcePath`).
- `.schemas/textureSet.schema.json` (new) and `scene.schema.json` (the `textureSets` field). The JSON Schema doesn't say "at least one packing" (a zod refinement): the gather does.
- Tests: `TextureSetSchema.test.ts` (now in `schemas/`, its scene part case in `features/texturesets/TextureSetsSchema.test.ts`; the example, a one-packing set, twelve bad values at their paths, the packings' slots against `TEXTURE_SET_PACKINGS`, the scene part); `gather.test.ts`' "p303 D1" (8: the set inline with its defaults and `__features`, `defaultPacking`'s slot order, production and the dev section, an unknown set, a missing slot texture, an array as a slot, a bad `defaultPacking`, the colour-space warnings, a duplicate id); `engineSchemas.test.ts` lists the new field. `gatheredJson.test.ts` gets the repo's set with section 4's debug scene.
- `devTools/gather/CLAUDE.md`: the suffix, the schema's place, the part, `textureSets.ts` and the scene pass's order.

#### Section 2: The input form — done

As built (2026-11-13; `yarn test`, `tsc` both, lint, `yarn verify:baselines --docs`, `yarn gatherAppData`: the repo's generated data unchanged):

- **The schema moved** (the layout check: `schemas → feature` at runtime is an error, and `MaterialSchema.ts` must import the input form): the asset schema and the form are `schemas/TextureSetSchema.ts` (D1's original place), the scene part `features/texturesets/TextureSetsSchema.ts` (as `spatial()`'s), both on `aekasha/schemas`.
- `features/texturesets/TextureSetRefs.ts` (import-free; on `engineImports.test.ts`' list): `TextureSetInputRef` (`{ textureSet, packing? }`, for section 3's entry), `isTextureSetInputRef`, `TextureSetPackingData` / `TextureSetLookup` (what the dependencies read: `defaultPacking` and `packings`), `getTextureSetSlotTextures` and `getTextureSetInputDependencies(value, getSet)`: the packing's textures in the data's slot order (the gathered data's, which is the schema's), none for an unknown set or a packing it lacks. Section 3's resolver passes the app data's lookup.
- `schemas/TextureSetSchema.ts`' `TextureSetInputSchema` (strict, `packing` the three names), one of `MaterialSchema.ts`' checked forms (`checkInputRefs`' key `textureSet`) and offered in the inputs' and sockets' unions (their JSON Schemas' `anyOf`); the `inputs` and `nodes` descriptions name it. `RuntimeTypes.test.ts`: the form's type equals `TextureSetInputRef`.
- **The closure** (`textureClosure.ts`): `INPUT_DEPENDENCY_FNS` take `(value, reg)`, the set's reading `reg.textureSets`; `getInputRefError` fails a set no JSON has and a packing the set lacks (`Scene "a": the material "m"'s input "x": the texture set "sand" has no packing "MINIMAL" (packings: FULL, LITE).`); the named sets go into the scene's `textureSets` after its own, each once (`appendSceneTextureSets`), without their default packing (only the packing an input samples is added, as textures). So `__features` names `texturesets` for a scene whose material names a set.
- **Streaming** (`streamingManifest.ts`): a set input's packing textures are refs (read from the scene's resolved `textureSets`), so a cell-only material's set textures move into its cell; the set's data stays in the scene. **Beyond the plan:** a set the scene lists for its code keeps its default packing in the base though a cell material uses it too: the scene pass reads the listed ids before it resolves them (`getListedTextureSetTextureIds`) and hands them to `buildStreamingManifest`'s new `baseTextureIds`.
- Tests: `TextureSetRefs.test.ts` (the predicate; the default and an input's packing in slot order, none for an unknown set, a packing it lacks or another value); `MaterialSchema.test.ts` (the form with and without `packing` beside the others, a bad packing, an extra key); `gather.test.ts`' "p303 D1: texture set inputs" (6: the set and the packing's textures with `__features`, the default packing and a set listed and named once, an unknown set, a missing packing, a cell-only material's textures in its cell, a listed set's kept in the base).
- `.schemas/`: `material`, `mesh` and `scene` regenerated (the form's definition).
- `devTools/gather/CLAUDE.md`: the set's dependency function, its errors, the closure's sets and the streaming rules.

### Phase 2 — Fetch tool and recipes (D3, D5)

1. `fetchTextureSources.ts` (and its `package.json` script), the zip reader in `archives.ts` (unit-tested like its other readers, `archives.test.ts`), gitignore entries, `CREDITS.md` generation.
2. Pack recipe templates (FULL/LITE/MINIMAL), cavity-AO derivation, `averageColor` (D1).

**Exit:** `yarn fetchTextureSources --only sand01 && yarn assets --only 'sand01*'` produces the three packings as KTX2.

### Phase 3 — Layer arrays (D4)

1. `buildTextureSetArray` and `setTextureSetArrayLayer` on p299's `buildTextureArray` / `setTextureArrayLayer` (assembly, validation, ref counting and the GPU assembly spike are p299's).
2. The per-layer uniform array and the resolver.
3. Verify on WebGPU and WebGL2: sample layer `i` in a test material and compare against the single-texture path.

**Exit:** a 4-set LITE array renders identically to 4 separate sets, using 2 bindings.

### Phase 4 — The library (D6)

1. Create the 16 set folders (`source.json`, set JSON, texture JSONs).
2. Fetch, choose by eye, tune `physicalSize` / `heightScale` / `surface`.
3. Encode and commit the outputs.

**Exit:** all sets load; VRAM total measured and recorded in this plan.

### Phase 5 — Baseline material and gallery skeleton (D7, D8)

1. The toolkit's `terrain` category (p301 §2; the first code in it): its entry `src/toolkit/terrain/index.ts` (named `export … from` lines only), `TOOLKIT_CATEGORIES` in `eslint.config.js`, the alias in `devTools/aliases.ts` and `tsconfig.json`'s `paths` (`aliases.test.ts` checks the copy), its folders' rules in `devTools/layout/layoutRules.ts`' `getToolkitRules`, a row in the Hub's entry table (`hub/pages/documentation/intro.md`), the API baseline (`yarn verify:baselines --update`).
2. `textureSetSurface` + `sampleTextureSet` (summary and `@example`, a `*.test.ts` for what runs in Node).
3. `terrainGallery` scene and tab; a `devTools/verify/scenes.config.ts` entry if the scene runner needs settings for it.

**Exit:** 16 blocks render with correct scale and orientation (no mirrored normals, sun-lit relief matches light direction), on both backends.

### Phase 6 — Handbook and Hub

1. **`docs/techniques/README.md`:** index table (p301 §5), the page template, the "which technique for my game" matrix skeleton (rows: game type/camera; columns: recommended technique, packing, anti-tiling, projection), and a "start here" path.
2. **`docs/techniques/texture-sets.md`** (page template), covering:
   - what each map does and which are optional (table: required = colour; strongly recommended = normal, roughness; optional = AO, height, metalness);
   - the three packings with exact channel layouts and when to choose each (art style / camera / tier);
   - **AO into albedo, step by step** (recipe option, strength, what it costs, how it interacts with GTAO);
   - deriving AO from height;
   - choosing `physicalSize` and texel density per camera type;
   - sources: ambientCG and Poly Haven, which download to pick (2K JPG/PNG), why 2K → 1K;
   - making your own set in Blender: baking a tileable PBR set from a sculpted or procedural Blender material (Cycles bake of colour, normal, roughness and AO to a 2K image on a plane, with seam checking via a 2×2 tiled preview);
   - adding a set to the library (folder, JSON, fetch or commit sources, `yarn assets`);
   - KTX2 settings per slot.
3. The Hub (p301 §5): the terrain feature page (`hub/pages/features/terrain/`, created here) with texture sets, the library and the baseline material, linking the two handbook pages with `repo:` links; the scenes-and-assets page's asset type table gets `*.textureSet.json` (`hub/pages/features/scenes-and-assets/guide.md`); the toolkit page (`hub/pages/features/toolkit/guide.md`) the `terrain` category and `textureSetSurface`; ask whether `terrainGallery` gets a Hub scene block. `yarn hub:build`.
4. `readme.md` Features: "Texture sets" (engine) and "Terrain texture library" (toolkit); the new command. The root `CLAUDE.md`: `yarn fetchTextureSources` in Commands, the toolkit's `terrain` category and `textures/` content in the Three-folder split; `devTools/gather/CLAUDE.md` the new suffix; `devTools/assetPipeline/CLAUDE.md` the fetch tool, the cavity AO and `averageColor`.

### Phase 7 — Versioning

1. Versions: engine minor (asset type, arrays), toolkit minor (library, baseline material, the `terrain` entry), app minor (gallery); `CHANGELOG.md`, with a Project section for the fetch tool.
2. Mark the plan done (`docs/plans/CLAUDE.md`).


---

## Risks

| Risk                                                                                                                        | Mitigation                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| UASTC transcodes to different GPU formats on different devices, so an array can mix formats if members use different codecs | One codec per packing slot (profile), validated at assembly                                                                                    |
| CPU mip data is not retained after upload                                                                                   | Members are fetched for assembly and never uploaded on their own; assembly happens before any material uses them                               |
| Committed outputs make the repo heavy (~40 MB)                                                                              | LITE only by default; FULL and MINIMAL only for 3 sets; revisit LFS (p301 Open questions)                                                      |
| A resized source doesn't encode byte for byte the same on another machine (`devTools/assetPipeline/CLAUDE.md`), and every set is resized 2K → 1K | The lock keys are the inputs', so a clone takes the committed outputs from the lock; re-encode only on a cache miss, and compare outputs on one machine |
| Provider ids or download URL patterns change                                                                                | `source.json` records the page URL; the fetch tool fails per set with a clear message; committed outputs keep the repo working without a fetch |
| Photo-scanned layers have baked-in lighting or strong large-scale features that repeat visibly                              | Choose by eye (Phase 4); p305's anti-tiling and macro variation                                                                                |
| Sets differ in brightness, so a blend shows seams in tone                                                                   | `surface.tint` per set and per layer; gallery side-by-side tuning                                                                              |
