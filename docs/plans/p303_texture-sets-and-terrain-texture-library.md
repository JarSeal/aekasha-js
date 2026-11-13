Status: in progress | Phases 1-2 implemented
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

### Phase 1 — Asset type and runtime (D1, D2) — done

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

#### Section 3: The feature and runtime — done

As built (2026-11-13; `yarn test`, `tsc` both, lint, `yarn verify:baselines --docs` (the entry's 14 exports documented), `yarn hub:build`, `yarn sbp --profile all`: the banner and uiKit unchanged against their baselines; the app's `_engine/features/texturesets` group 749 B gzip (1,469 B minified, 3 modules, all in the first download: the template lists the feature), the initial 408,817 B against 399 KiB (408,576 B, 241 B over) and `assets/index.js` 404,487 B against 395 KiB (7 B over); decided in review: `sbp.config.ts`' app budgets 399 → 400 KiB (initial) and 395 → 396 KiB (`assets/index.js`), and a new group budget `_engine/features/texturesets: 1 * KIB`, all within after):

- `features/texturesets/TextureSets.ts`: `getTextureSet(id)` (the development data's `textureSets` section, else the first scene whose `SceneData.textureSets` has it), `loadTextureSetAsync(id, { packing? })` and `getTextureSetPackingTextures(id, { packing? })`. **Drift:** the packing is an options object, not a second positional parameter (the coding standards: an optional parameter goes in the options). The load reads each slot's declaration (`findTextureDeclaration`) as `ensureMaterialDependencies` does, but in the feature (no kernel bytes), starts every load before its first await (the caller's owner scope) and rejects for an unknown set, a packing it lacks, a texture no data declares or a failed load; the getter returns undefined unless every texture is registered. Both type their result by packing (`TextureSetTextures<P>`).
- The resolver (kind `textureSet`, registered by `textureSets()`' install, `installTextureSets`): decision 2's flat bundle (`TextureSetInput`: the packing's texture nodes, `physicalSize` vec2, `heightScale`, each `surface` field, `tint` a linear colour from the JSON's sRGB); an unknown set or a missing packing throws naming the input; its `dependencies` pass `getTextureSet` to `getTextureSetInputDependencies`. Without the feature, a code-made material with the input fails with the kernel's "Unknown object footprint" (no kernel bytes name the feature); JSON is caught by the feature manifest at boot.
- `SceneData.textureSets?: TextureSetDef[]` (a type import from `schemas/`: nothing of the feature in the kernel).
- The entry `aekasha/texturesets` (`index.ts`: the three functions, the factory, `TextureSetInput`, `TextureSetTextures`, `TextureSetInputRef`, and the schema's `TextureSetDef`, `TextureSetPacking`, `TextureSetSlot`, `TextureSetSurface`, also on `aekasha/schemas`, as merging's `SceneMergeMaterial`), the alias (`devTools/aliases.ts`, `tsconfig.json`), `ENGINE_FEATURE_FACTORIES`, the template (`src/index.ts`, after `merging()`) and `InitEngine`'s example.
- Tests: `TextureSets.test.ts` (12: the lookup's order and a production build's, the load by slot with a re-tag and a load, another packing, its three rejections, the registered textures and undefined, the install, the match, the bundle and its values, a `{ r, g, b }` tint, another packing's bundle, the resolver's two errors, its dependencies); `RuntimeTypes.test.ts`' pair: a scene's set is `TextureSetDef`, which fits the lookup's `TextureSetPackingData`, and the asset has only the tooling keys more.
- Docs: `features/texturesets/CLAUDE.md` (new, its section "Texture sets"), the root `CLAUDE.md` (the map, "thirteen", the feature list), `kernel/init/CLAUDE.md`, `merging/CLAUDE.md` (no longer last), the Hub's entry table and feature lists (`documentation/intro.md`, `architecture/guide.md`, `quick-start/setup.md`, `smallest-build/guide.md`). The section's Hub coverage is the scenes-and-assets page's `aek:covers` until Phase 6's terrain page takes it over. `readme.md`'s Features line is Phase 6's.

#### Section 4: The Assets tab and the exit — done

As built (2026-11-13; `yarn test`, `tsc` both, lint, `yarn verify:baselines --docs`, `yarn verify:scenes --only textureSets --config quick,prodTest,mainThread`: no errors, NEW (no local baseline); the scene driven by hand on WebGPU and WebGL2 (SwiftShader), the same picture and results on both, its six textures registered and none left after leaving it):

- **The Assets tab:** a texture's info window has a Texture set folder (after the Texture folder), a row per set naming the packings and slots the texture fills (`stone`: `FULL albedoHeight, MINIMAL albedoHeight`), none when no set names it. `getTextureSetSlotsOf(id)` (`kernel/assets/debug/_dbg__AssetsData.ts`) reads the development data's `textureSets` section, else every scene's inline sets (once each): no feature import. Its test is `_dbg__Assets.test.ts`' (dev data, the scenes' sets, no set).
- **The hand-made set:** `p303TestSet` (`src/app/scenes/textureSets/`, category `OTHER`, `physicalSize` [1, 1], `heightScale` 0.04, all three packings, `defaultPacking` `LITE`): six 256² PNGs (4 × 4 bevelled stones in mortar, the top left one orange) from `devTools/assetPipeline/fixtures/textureSetsFiles.ts` (run by hand, as p374's), packed by hand as D2's table. Their texture JSONs pass the PNGs through (`optimize: false`: a content-hashed copy in `src/public/aek-assets/`, made by any gather; not in `assets.lock.json`, which records encodes only). The mortar's height is 0, so `albedoHeight`'s and `albedoHeightAO`'s alpha is 0 there: its colour shows on both backends, so the PNG decode doesn't premultiply (`premultiplyAlpha: 'none'`).
- **The scene** `textureSets` (`isDebugScene`; lists the set, its three materials name it): `p303SetLiteMat` (no packing: the default), `p303SetFullMat` and `p303SetMinimalMat` share `p303TextureSetMat.tsl.ts`, which branches on the bundle's slots (only the sampled packing's are there) and uses `physicalSize`, `tint`, `normalStrength`, `roughnessScale`, `aoStrength` and `heightScale`. Lit 2 m quads with UVs in metres, a grazing sun from the upper left. `window.__textureSets.results`: the backend, the gathered defaults, each packing's registered textures by slot, `loadIsCacheHit` (a load of a registered packing returns the registered textures), the unknown set's rejection, the LITE material's `setup_surface_*` uniforms; `checkReleaseAsync(sceneId?)` leaves the scene and lists the set's textures still registered (none). Read by hand, as p299's scenes.
- **Found: three's `bumpMap` doesn't scale in metres.** It normalizes the surface derivatives, so its scale is height per screen pixel (MINIMAL's quad looked flat at `heightScale` 0.04). The scene's TSL uses the unnormalized form (`bumpNormal`, as the toolkit's asteroid material), height × `heightScale` in view units. p305's MINIMAL path needs the same (`features/texturesets/CLAUDE.md`'s trap).
- **What it shows:** LITE and MINIMAL's mortar is darker than FULL's, their AO baked into the albedo (D2's cost: it darkens the sun too). Stones' top and left bevels lit: the normals are OpenGL's in every packing.
- **Found: `yarn assets --only` matches an id whole;** its glob is for paths. Phase 2's exit uses a path glob now; `devTools/assetPipeline/CLAUDE.md` says so.
- Not changed: the info window's "Used by materials" counts only a material's map properties, so a set texture (sampled by a TSL bundle) shows 0; it already says ref counts aren't tracked.
- Docs: `features/texturesets/CLAUDE.md` (Debugging, the trap), `debug/CLAUDE.md` (the info window's folder), `devTools/assetPipeline/CLAUDE.md` (the fixture, `--only`).

### Phase 2 — Fetch tool and recipes (D3, D5) — done

1. `fetchTextureSources.ts` (and its `package.json` script), the zip reader in `archives.ts` (unit-tested like its other readers, `archives.test.ts`), gitignore entries, `CREDITS.md` generation.
2. Pack recipe templates (FULL/LITE/MINIMAL), cavity-AO derivation, `averageColor` (D1).

**Exit:** `yarn fetchTextureSources --only sand01 && yarn assets --only 'src/toolkit/textures/sand01/**'` produces the three packings as KTX2 (`--only` matches an id whole, a glob against paths only: Phase 1 section 4).

Sections:

1. **The fetch tool:** `fetchTextureSources.ts` and its script, the zip reader, the gitignore entries, `CREDITS.md`.
2. **Recipes and the clone fallback:** the sources-free key (option (a) below), the scaffold writing a set's texture JSONs, `sand01`'s folder, the exit.
3. **Cavity AO and `averageColor`:** D2's derived AO as a pack channel source (the scaffold uses it for a set without an `ao` map), D1's measured average colour in the lock entry and the generated data.

**Decided in section 1's review (2026-11-13):** the clone fallback is option (a); the recipe templates are a scaffold (a set's texture JSONs written from its `packings` and `source.json`'s maps, never overwriting a JSON); step 2 is sections 2 and 3.

**Found in section 1 (2026-11-13), for section 2: a clone without the fetched sources can't use the committed outputs.** A pack's lock key hashes its source bytes (`cache.ts`), and `resolvePackFile` (`sources.ts`) throws for a missing `src`. The sets' `source/raw/` is gitignored, so on a fresh clone every set texture fails its key: the dev server warns and loads nothing for it (a pack has no `__sourceUrl` to fall back to), and `yarn build`'s production gather fails ("no asset pipeline output"). The Risks table's "the lock keys are the inputs', so a clone takes the committed outputs from the lock" holds only for committed sources. Options:

- **(a) A sources-free key in the lock entry** (recommended): each pack entry also records the key computed without the source bytes (the recipe, settings, versions, output path, and each source's path). When every file a pack reads is missing, the pipeline looks that key up and uses its entry's output when it's on disk ("sources not fetched: the committed output"), and the prune keeps it. An edited recipe without its sources finds no entry and fails naming `yarn fetchTextureSources`. Only packs whose files are all missing take this path; a partly missing set still fails.
- **(b) The newest lock entry whose `source` is the JSON:** simpler, but an edited recipe silently keeps the old output.
- Either way, a missing pack `src` under `source/raw/` names `yarn fetchTextureSources` in its error.

**Open for section 2: the "recipe templates".** D3's recipes are identical across sets but the strengths, and Phase 4 writes 16 sets' texture JSONs (2 each, 6 for three sets). Either hand-copied JSONs from a documented template (`docs/techniques/texture-sets.md`, Phase 6), or a scaffold (eg. `yarn fetchTextureSources --scaffold <setId>`, or a `devTools/` script) writing a set's texture JSONs from its `packings` and `source.json`'s maps (the AO multiply only when there's an `ao` map, else the cavity term).

#### Section 1: The fetch tool — done

As built (2026-11-13; `yarn test` (3,497), `tsc`, lint; a live run against ambientCG's `Ground080` 2K-JPG in a temporary `sand01` folder, removed after: 24.9 MB downloaded and read, the five maps written, a second run "up to date", `git status` showing no `source/raw/` file, an unknown `--only` id exiting 1):

- `devTools/assetPipeline/archives.ts`' `readZip`: the end record (scanned back over a comment), the central directory, stored and deflated entries (`zlib.inflateRawSync`), each checked against its size and CRC-32 (`zlib.crc32`, Node ≥ 22.2), so a cut-short download throws; the central directory's sizes, so a data descriptor's zeroed local sizes don't matter; a Unix-made entry's mode. Throws for Zip64, encryption, several disks and another method. No dependency. Tests: `archives.test.ts`' two zip cases (built byte by byte).
- `devTools/assetPipeline/textureSources.ts` (the logic, tested) and `devTools/fetchTextureSources.ts` (the command, `yarn fetchTextureSources [--only <setId>[,…]] [--force]`, `main` only as the script; the download with a 10 min timeout and a generic User-Agent, no project name):
  - **A set folder** is one with a `source.json` beside its `*.textureSet.json`, under `src/toolkit/` or `src/app/` (`findTextureSetSources`); `--only` matches the set JSON's `id`. A `source.json` alone or beside two sets fails that set; a set without one is hand-made and skipped.
  - **`source.json`** (`TextureSourceSchema`, strict, zod in the tool, no JSON Schema): D5's fields; `provider` `ambientCG` or `polyHaven`; `download` `<n>K-JPG|PNG` (Poly Haven's `2k` / `jpg` from it); `maps` the fixed names `color` (required), `normal`, `roughness`, `ao`, `height`, `metalness`, `arm` (Poly Haven's pack).
  - **ambientCG** (the URL pattern confirmed against its v2 API, 2026-11-13): one zip cached as `.cache/texture-downloads/ambientCG/<assetId>_<download>.zip`, a map the `.jpg`/`.png` whose stem ends with its suffix (two matches fail: `_NormalGL` vs `_NormalDX` is why it's a suffix, not a substring). A cached zip that doesn't read is downloaded once more. **Poly Haven** (confirmed: `files/<id>` → map → resolution → format → `{ url, md5, size }`): the listing and each map cached under `polyHaven/<assetId>/`, each map checked against its MD5.
  - **The raw folder:** `<map>.<ext>` (`jpeg` → `jpg`), the folder's other files removed, `.fetched.json` recording the source's provider, id, download and maps and each file's SHA-256 (an unchanged set with intact files is "up to date": no download). Nothing is written until every map is in hand. A missing `color`, `normal` or `roughness` fails the set; another is reported as optional.
  - **Gitignore:** `src/toolkit/textures/*/source/raw/` and `src/app/**/source/raw/` (an app set lives in any app folder); the command fails a set whose raw folder git doesn't ignore (`git check-ignore`).
  - **Credits:** `src/toolkit/textures/CREDITS.md` from the toolkit's sets (an app set's aren't listed), written when it changed, every run (no download needed), not while a toolkit `source.json` is invalid. Its layout rule: `layoutRules.ts`' toolkit rules.
  - Output also to `.cache/texture-downloads/progress.log`; exit 1 when a set failed.
- Tests: `textureSources.test.ts` (8: the schema's refusals, discovery and its errors, ambientCG's maps with an optional one missing, the up-to-date check and `force`, stale raw files and a missing required map writing nothing, two matches and a corrupt cached zip, Poly Haven with its MD5, the credits).
- Docs (Phase 6's, done now): `devTools/assetPipeline/CLAUDE.md` (the tool) and the root `CLAUDE.md`'s Commands line.

#### Section 2: Recipes and the clone fallback — done

As built (2026-11-13; `yarn test` (3,512), `tsc` both, lint, `yarn verify:baselines --docs`; **the exit:** `yarn fetchTextureSources --scaffold --only sand01 && yarn assets --only 'src/toolkit/textures/sand01/**'` wrote the six texture JSONs and encoded them, UASTC at 1024² with mips: `albedoRough` 862 KB, `normalHeight` 1.17 MB, `albedoHeight` 836 KB, `normal` 1.12 MB, `orm` 744 KB, `albedoHeightAO` 858 KB, each 1.40 MB of VRAM, so LITE is ≈ 2.0 MB on disk and 2.8 MB of VRAM, within D6's estimates; **the clone:** `source/raw/` moved away, a full `yarn assets` took all six from the recipe key (cache hits, nothing pruned, no error) and `yarn gatherAppData` wrote generated data byte for byte the same as with the sources):

- **The clone fallback** (option (a)): a fetched source is a file in a `source/raw/` folder (`isFetchedSourceFile`, `sources.ts`). A pack reading one records `recipeKey` in its lock entry (`getRecipeKey`, `cache.ts`: `getCacheKey` with the fetched files left out and the params wrapped as `{ recipe }`; the `src` paths are in the params). `pipeline.ts`' `lookUp` (both the encode and the pack pass-through): with a fetched source missing, `cache.getByRecipe(recipeKey)` (through `get`: the store's copy restored, the prune keeps it) or the error "no committed output has this recipe, and its fetched sources aren't there (…): run yarn fetchTextureSources". `resolvePackFile(…, { allowUnfetched })` returns a missing fetched source's path (the key's files, the gather's `checkPackSources`), and names the command in its error otherwise. Only entries whose pack reads a fetched source get the field: no other lock entry changed.
- **Beyond the plan: the generated data's `__bytes.in`** (committed) is a texture's source bytes. Without the sources `getSourceBytes` is undefined and the run takes the encode's recorded `textures[0].source.bytes` (`run.ts`, packs only), so a clone's gather writes what a fetched machine's does.
- **The scaffold** (`textureSetScaffold.ts`, `yarn fetchTextureSources --scaffold`): the texture JSONs the set's `packings` name and no file has (the set folder's `<id>.texture.json`, or an id another `*.texture.json` gives: kept), never overwritten, Prettier-formatted with the root's config (`devFiles/format.ts`). D2's layouts from `./source/raw/<map>.<ext>` (the `download`'s format): LITE `albedoRough` RGB colour × AO (strength `surface.aoStrength`, default 1), A roughness; `normalHeight` RG the normal (`normal: true`), B height (`remap: "auto"`); FULL `albedoHeight` RGB colour, A height; `normal` RGB; `orm` AO (or 1), roughness, metalness 0; MINIMAL `albedoHeight` colour × AO, height. A missing height is 0.5; a missing AO no multiply (section 3 puts the cavity term there). Profile `terrainLayer`, slots `baseColor` / `data` / `normal` / `orm`, `REPEAT`, anisotropy `MAX`, `colorSpace: "srgb"` on the albedo slots only (the gather's colour-space check agrees). No `pack.size`: a set's maps share their size. It needs `normal` and `roughness` maps; `arm` isn't read by any recipe. The JSONs' `debugData` names the set, packing, layout and the provider's asset.
- **`sand01`** (`src/toolkit/textures/sand01/`): D1's example set (`SAND`, 3 m, `heightScale` 0.03, all three packings, D1's `surface`) on ambientCG `Ground080` 2K-JPG (it has every map), its six scaffolded JSONs, `source.json`; `CREDITS.md` lists it. Its outputs and lock entries are committed with this section (Phase 4 tunes it by eye). It's in no scene yet: only the development data has it.
- Tests: `fetchedSources.test.ts` (temp root, as `prune.test.ts`: the recorded key; the clone's hit kept by a full run's prune; an edited recipe and a changed committed source failing with the hint; a missing committed source failing as before), `textureSetScaffold.test.ts` (4: every recipe valid against `TextureAssetSchema` with D2's channels; PNG, no AO and no height; kept files and ids, missing maps; `listTextureIds`).
- Not covered: a build-time `*.textureArray.json` whose layers are such packs still needs the sources (its key reads them); p303's arrays are runtime ones (Phase 3).
- Docs: `devTools/assetPipeline/CLAUDE.md` (the scaffold, the clone), the root `CLAUDE.md`'s command line.

#### Section 3: Cavity AO and `averageColor` — done

As built (2026-11-13; `yarn test` (3,524), `tsc` both, lint, `yarn verify:baselines --docs`; a full `yarn assets`: all 38 cache hits, so no existing key changed; `sand01`'s three albedos encoded again with their colour, their outputs byte for byte the same):

- **Cavity AO** (D2): `cavity: { radius?, strength? }` on a pack channel and on a `multiply` factor (`PackCavitySchema`, `schemas/AssetsConfigSchema.ts`; not with `normal: true`). `pack.ts`' `applyCavity`: the height remapped to 0..1, then `1 − strength × max(0, blur(h) − h)` clamped, after `remap` / `invert`, before `multiply`; `blurWrapped` is a Gaussian (sigma `radius` px at the pack size) as three box passes each way, wrapping at the edges (a tiling map).
- **The defaults were measured, not guessed:** Ground080's 2K height against its own AO map. Sigma 8 px gave a correlation of 0.67 but a mean of 0.99 (the real 0.88): far too light. Sigma 24-32 at strength 4 correlate best (0.76); `PACK_CAVITY_DEFAULTS` is 24 px and 4 (mean 0.91, slightly lighter than the scan: it stacks with GTAO, D2). 24 px at 2K on a 3 m tile is 3.5 cm, pebble scale. One ground scan: Phase 4 checks the ice sets (the ones that need it) by eye.
- **The key:** `getPackKeyParams(pack)` (every pack key: the encode, the pass-through, an array layer's) adds `PACK_CAVITY_VERSION` only for a pack that uses a cavity, so no other key changed.
- **The scaffold:** a set without an `ao` map but with `height` gets the cavity as its AO, written out (`cavity: { radius, strength }`, the radius scaled from 2K by the `download`'s resolution: 12 at 1K) in the albedo's multiply (LITE, MINIMAL) and FULL's `orm` R; without both, no multiply and R 1.
- **`averageColor`** (D1), **drift: development data only on the texture.** The encode records `EncodedTexture.averageColor` for an sRGB standalone texture (the stored level 0's mean RGB, linear, 4 decimals; `textures.ts`' `getAverageColor`), so it's in the lock entry. The texture's `__averageColor` (`GeneratedAssetFieldsSchema`, omitted from the import, array and atlas schemas) is written into the development data only: in production it would have cost every shipped texture bytes, and only the set needs it. The gather gives the set `averageColor` as sRGB `#rrggbb` from its default packing's colour slot (`getMeasuredAverageColor`, `devTools/gather/textureSets.ts`); the JSON's own wins. So `getTextureSet(id).averageColor` is the default packing's albedo (LITE's has the AO baked in, darker than FULL's: `sand01` LITE `#ab966b`).
- **An output encoded before this has no measure** until it encodes again (the key didn't change, so a cache hit keeps the entry). `sand01`'s three albedo entries (this branch's) were dropped from the lock and the store and encoded again; `yarn assets` has no force flag.
- Tests: `pack.test.ts` (new: the wrapping blur, the cavity's pit, bump, normalization, clamp and strength 0, the key version, a real pack as a channel and as a factor, the schema), `textures.test.ts` (new: the mean), `textureSetScaffold.test.ts` (the cavity AO and the radius at 1K and 2K), `gather.test.ts`' "p303 D1: a set's average colour" (a fake run: the set's colour in both modes, the texture's only in development data, the JSON's own, none without a run), `RuntimeTypes.test.ts` (`__averageColor` a tooling key).
- Docs: `docs/techniques/asset-optimization.md`' Pack channels (`cavity`, the average colour), `devTools/assetPipeline/CLAUDE.md` (Cavity AO, Average colour, the scaffold), `devTools/gather/CLAUDE.md`, `features/texturesets/CLAUDE.md`. Phase 6's handbook still explains them for set authors.

### Phase 3 — Layer arrays (D4)

1. `buildTextureSetArray` and `setTextureSetArrayLayer` on p299's `buildTextureArray` / `setTextureArrayLayer` (assembly, validation, ref counting and the GPU assembly spike are p299's).
2. The per-layer uniform array and the resolver.
3. Verify on WebGPU and WebGL2: sample layer `i` in a test material and compare against the single-texture path.

**Exit:** a 4-set LITE array renders identically to 4 separate sets, using 2 bindings.

**Found while grounding (2026-11-13):**

- **D4's code is the feature's**, `features/texturesets/TextureSetArrays.ts` on `aekasha/texturesets` (Phase 1's drift; D4 said `kernel/assets/TextureSet.ts`).
- **One uniform array, not one per field:** three makes each `uniformArray` its own uniform buffer binding (`NodeUniformBuffer`, both backends), and a stage has 12 by default (WebGPU's `maxUniformBuffersPerShaderStage`; WebGL2's minimum too). Ten fields would have used ten. So `layerParams` is one vec4 array, four per layer, and a TSL helper reads it by name. (Each element is padded to a vec4 anyway.)
- **The resolver's bundle is flat** (`resolveRegisteredInput` takes a node or an object of nodes): the slots' array texture nodes, `layerParams` and `layerCount`, not D4's `{ arrays, layerCount, layerParams }`.
- **A scene's JSON materials are created synchronously right after its textures load** (`SceneDataLoader.ts`' `loadSceneAssetsAsync`), and the resolver is synchronous, so a material's set arrays must be built before that. No scene hook sits between the two: `beforeAssets` (awaited) is before the textures, `assetsLoaded` after the materials. `worldCleared` (synchronous) has the next scene's data, after `beginLoad` set the asset owner to it.
- **In production, a member's declaration must be in the scene's data without the scene loading it:** a member listed in `textures` would be loaded, registered and uploaded on its own (D4's Risks: never), and `buildTextureArray`'s own lookup of an id reads only the development registry.

Sections:

1. **The runtime:** `buildTextureSetArray`, `getTextureSetArray`, `setTextureSetArrayLayer`, the layer params and `getTextureSetLayerParams`, the entry, unit tests, the feature's `CLAUDE.md`.
2. **The input form and the scene load:** `{ "textureSetArray": [ids] | id, "packing" }`: its schema in `MaterialSchema.ts`, the import-free predicate, the resolver, the gather (closure, errors, the members' declarations in the scene's data), the scene load's builds, streaming, `yarn sbp`.
3. **The exit:** the verification scene (a 4-set LITE array against the 4 sets through `{ textureSet }`, on WebGPU and WebGL2), this phase's "As built" and the status line.

#### Section 1: The runtime — done

As built (2026-11-13; `yarn test` (3,535), `tsc` both, lint, `yarn verify:baselines --docs` (the entry's 22 exports documented)):

- `features/texturesets/TextureSetArrays.ts`, on `aekasha/texturesets`:
  - **`buildTextureSetArray({ id?, sets, packing, swappable?, isPersistent? })`** → `TextureSetArray<P>` (`id`, `packing`, `sets`, `arrays` by slot, `layerCount`, `layerParams`, `swappable`). One `buildTextureArray` per slot, registered as `<id>.<slot>`. A registered slot texture is borrowed by id; another goes in as its declaration's props (`findTextureDeclaration`), so it's loaded for the array alone. Every member is resolved before any build starts, so an undeclared texture throws with nothing started (the test caught the first version starting slot 0). A failed slot deletes the arrays this call registered; the error is `Texture set array "ground" (LITE: 0 sand, 1 rock), slot normalHeight: <p299's message>`.
  - **The id:** `tsa:<FNV-1a of [packing, sets]>`, a UUID for a swappable one. A build of a registered id returns its set array, re-tagged by `buildTextureArray`; with other sets or packing it throws. **Beyond the plan:** a swappable one need only match the packing and layer count, since its layers may have been swapped.
  - **The registry:** a map by id, an entry dropped when any of its arrays fires `dispose` (deleted, or released with its scene). `getTextureSetArray(id)` also checks that each `<id>.<slot>` is still the entry's array.
  - **`setTextureSetArrayLayer(id, layer, setId)`:** throws at once without a swappable set array, for a layer out of range or a set without the packing. Swaps are queued per set array. Each slot goes through `setTextureArrayLayer`, then the layer's `sets` entry and params are written. When a slot fails, the slots already swapped get the previous set back (best effort), and it rejects naming the slot. A set array deleted meanwhile is left alone.
  - **`layerParams`** (`TextureSetLayerParamsNode`, a `uniformArray` of `Vector4`, four per layer): `[physicalSize.x, physicalSize.y, heightScale, heightContrast]`, `[tint (linear) r, g, b, normalStrength]`, `[roughnessScale, aoStrength, porosity, wetDarkening]`, `[wetRoughness, 0, 0, 0]`. **`getTextureSetLayerParams(layerParams, layer)`** (an index or an int node) returns the ten fields as TSL nodes by name. The node is the set array's, shared by every material that samples it, so a swap updates them all. A material that wants its own per-layer values makes its own uniforms; p305 decides.
- Tests: `TextureSetArrays.test.ts` (11): the slot arrays and their members, the params; the derived id, a re-build and two overlapping ones; the swappable ids; the drop on dispose; the refusals before any build; a failed slot's clean-up; the swap and a re-build after it; the restore; the swap's refusals; a swap after the delete; the params' nodes.
- Docs: `features/texturesets/CLAUDE.md` (Set arrays).

**Decided in section 1's review (2026-11-13):** section 2 as proposed (the form with `packing` required and an id in code, the flat bundle, the scene load through `worldCleared` / `beforeAssets` with no kernel bytes, the members declared outside the scene's `textures`, a white stand-in for an array that isn't built). What changed while building it is in its "As built".

#### Section 2: The input form and the scene load — done

As built (2026-11-13; `yarn test` (3,553), `tsc` both, lint, `yarn verify:baselines --docs` (the entry's 27 exports, the schemas' 113, documented), `yarn gatherAppData` (the repo's generated data unchanged; `.schemas/` regenerated), `yarn sbp --profile all`: every budget within. The app's first download is 408,981 B of 409,600 B (+164 B against Phase 1 section 3), and its `_engine/features/texturesets` group 976 B of 1,024 B (+227 B: the two hooks and the `import()`'s preload wrapper; 48 B left). The banner and uiKit are unchanged. Lazy: the new `TextureSetArrays` chunk is 2.7 kB, and the kernel's `TextureArray.ts` is now its own 3.1 kB chunk, shared by p299's resolvers and this one (it was 0.5 kB). `bundle.json`'s baseline isn't recorded yet: the phase's end runs `yarn verify:baselines --update`.):

- **The form** (`schemas/TextureSetSchema.ts`' `TextureSetArrayInputSchema`, a union, in `MaterialSchema.ts`' `INPUT_REF_FORMS` and both unions): `{ textureSetArray: string[] (≥ 1), packing }` (strict, `packing` required) or `{ textureSetArray: string }` (strict). `TextureSetRefs.ts`' `TextureSetArrayInputRef` and `isTextureSetArrayInputRef` (a string or an array); `RuntimeTypes.test.ts` pairs them.
- **Beyond the plan: a scene lists set arrays.** The scene part has `textureSetArrays: [{ id?, sets, packing, swappable? }]` (`SceneTextureSetArraySchema`, on `aekasha/schemas`), built with the scene's load like the materials' lists. So **an id works in JSON** (proposal 1 had the gather fail it): `{ "textureSetArray": "gallery" }` names a set array the scene lists with that `id`, eg. p310's swappable gallery array, which its debug tab swaps. In code, an id names any built set array.
- **The bundle** (`TextureSetArrayInput`): the packing's array texture nodes by slot, `layerParams` (the set array's node, shared) and `layerCount` (`int(n)`).
- **The resolver** (kind `textureSetArray`, in `TextureSetArrays.ts` to avoid an import cycle) registers with the first `buildTextureSetArray` call, through the kernel's public `registerMaterialInputResolver`, as p299's resolvers do. Its `dependencies` are none. A list finds its array by `getTextureSetArrayId(packing, sets)` (`@internal`, also the build's derived id). A list whose array isn't built gets a white stand-in, warned: a shared 1 × 1 `DataArrayTexture` per layer count (the kernel's white texel is 2D: `.depth()` wouldn't compile) and the sets' own params, so the load goes on. An id that isn't built throws naming the input.
- **The scene load:** `installTextureSets` adds `worldCleared` (it starts `buildSceneTextureSetArraysAsync(nextSceneData)`) and `beforeAssets` (it awaits that). The first time, the build goes through `import('./TextureSetArrays')`. After that it starts synchronously in `worldCleared`, so a set array the next scene shares is re-tagged before the previous scene's assets are released. A failed build is logged (`Scene "b": the texture set array (LITE: rock) could not be built.`) and the load goes on. The cost, as proposed: the scene's own textures start loading only after its arrays are built.
- **The members' declarations** (proposal 4's place changed): not on the scene's inline set (`TextureSetDef` stays the set's type) but on the scene's set array entries: `SceneData.textureSetArrays[i].__textures`. Each member the scene's `textures` doesn't hold is written once, in the first array naming it. `getMember` reads `findTextureDeclaration`, then the scenes' `__textures`.
- **The gather** (`devTools/gather/textureSetArrays.ts`, called from the closure):
  - **Checks:** a listed entry's sets (known, with the packing) and its `id` once (`textureSetArrays[i]: …`); an input's list (its sets) or id (one the scene lists): `Scene "a": the material "m"'s input "x": the scene's textureSetArrays has no set array with the id "gallery"`.
  - **Writes `textureSetArrays`:** the listed entries, then the lists the inputs name, each once. A list equal to a listed entry that has no `id` and isn't swappable is that entry.
  - **Writes the sets:** they go into `textureSets`, without their textures.
  - **Declares the members:** after the textures, `declareTextureSetArrayMembers` resolves each one with `resolveTextureAsset` (factored out of `resolveTextures`: the save entry, generated fields, ship check), so a production build without a member's output fails as a listed texture does.
  - The feature manifest names `texturesets` from both fields; `engineSchemas.test.ts` lists the new one.
- **Streaming** (proposal 6 dropped): nothing needed. The arrays are the scene's, built with its load, and the closure sees a cell's materials before the cut, so a cell-only material moves into its cell as any other. The members aren't in `textures`, so the cut never sees them.
- **Found: zod in the lazy chunk.** The first build of `TextureSetArrays.ts` imported `TEXTURE_SET_PACKINGS` (a value) from `schemas/TextureSetSchema.ts`, so the chunk was 24.5 kB gzip, 22 kB of it zod. It now imports only types from there, and a packing's slots come from the gathered set (`Object.keys(slots)`, in the schema's order). An unknown packing is now the set's "has no packing" error. `features/texturesets/CLAUDE.md` records the trap.
- **Tests:**
  - `TextureSetArrays.test.ts` (+5): the resolver by list and id, sharing `layerParams`; the stand-in, its warning and errors; the scene builds with a failed one; a member from `__textures`.
  - `TextureSets.test.ts` (+2): the hooks; a scene without arrays awaits nothing.
  - `TextureSetRefs.test.ts`: the predicate. `TextureSetsSchema.test.ts`: the scene field. `MaterialSchema.test.ts`: both forms and three bad values.
  - `gather.test.ts`' "p303 D4" (7): a list with its sets and members declared, not loaded; listed arrays, the dedupe, an id and the members already in `textures`; the three input errors; a listed entry's errors; a cell-only material.
- Docs: `features/texturesets/CLAUDE.md` (the input, the scene load, the trap), `devTools/gather/CLAUDE.md` (`textureSetArrays.ts`, the scene pass's order).

**Open for section 3: the exit's four sets.** The exit needs four sets whose slots match in size, mips and codec. Only `sand01` (KTX2, 1024²) and `p303TestSet` (PNG, 256², uncompressed path) exist until Phase 4. Proposed: three more hand-made sets from `devTools/assetPipeline/fixtures/textureSetsFiles.ts` (other colours and patterns, 256²), so all four go through the uncompressed path. Each set and the array also get encoded to KTX2 (`optimize` with the `terrainLayer` profile, small outputs at 256²), so the compressed path is checked too. Both are drawn in the `textureSets` scene: four quads through `{ textureSet }` beside four through one `{ textureSetArray }` material (layer per quad), on WebGPU and WebGL2. The scene's results record the array's binding count (2) and a pixel comparison.

### Phase 4 — The library (D6)

1. Create the 16 set folders (`source.json`, set JSON; the texture JSONs by `yarn fetchTextureSources --scaffold`, Phase 2 section 2; `sand01` exists).
2. Fetch, choose by eye, tune `physicalSize` / `heightScale` / `surface`, and the cavity AO of the sets without an AO map (`ice01`, `ice02`, `concrete01`: Phase 2 section 3 fitted its defaults on one sand scan).
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
| A resized source doesn't encode byte for byte the same on another machine (`devTools/assetPipeline/CLAUDE.md`), and every set is resized 2K → 1K | A clone without the fetched sources takes the committed outputs by their recipe key (Phase 2 section 2); re-encode only on a cache miss, and compare outputs on one machine |
| Provider ids or download URL patterns change                                                                                | `source.json` records the page URL; the fetch tool fails per set with a clear message; committed outputs keep the repo working without a fetch |
| Photo-scanned layers have baked-in lighting or strong large-scale features that repeat visibly                              | Choose by eye (Phase 4); p305's anti-tiling and macro variation                                                                                |
| Sets differ in brightness, so a blend shows seams in tone                                                                   | `surface.tint` per set and per layer; gallery side-by-side tuning                                                                              |
