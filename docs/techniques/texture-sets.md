# Texture sets

A texture set is one surface (dry sand, a grey cliff, lake ice) as a named group of packed PBR maps plus the physical facts a material needs to draw it at the right size: the metres one tile covers, the metres of relief its height stands for, and the surface defaults (tint, normal strength, roughness, wet response). Terrain and structure materials name a set by id and never deal with its files. The asset type is `*.textureSet.json`, the runtime the `textureSets()` feature (`aekasha/texturesets`), and the toolkit ships a library of 16 CC0 sets with a baseline material to draw one.

The Hub's [Terrain page](../../hub/pages/features/terrain/guide.md) has the API; this page is how to choose, make and tune a set. The [Asset optimization](asset-optimization.md) page has the pipeline every map goes through; the [index](README.md) has the techniques that blend several sets on a terrain.

## What it is

```text
 source maps (2K)           packed textures (1K KTX2)            the set                    a material
 color   ─┐                 ┌─ sand01_albedoRough  RGB albedo×AO  sand01.textureSet.json   { "textureSet": "sand01" }
 ao      ─┼─ pack recipe ──►│                      A   roughness   physicalSize  [3, 3]     → albedo, normal,
 rough   ─┤  (yarn assets)  └─ sand01_normalHeight RG  normal XY   heightScale   0.057        roughness, height,
 normal  ─┤                                        B   height      packings      LITE, …      physicalSize, tint, …
 height  ─┘                                                        surface       tint, …
```

- **The maps are packed** into as few textures as the packing allows: two for `LITE`, the default (albedo with AO baked in and roughness; the normal's X and Y and the height). Each packed texture is an ordinary `*.texture.json` with a `pack` recipe, encoded to KTX2 by the asset pipeline.
- **The set JSON** names the packed textures per packing and slot, and holds the surface's physical facts. A material input `{ "textureSet": "sand01" }` gets all of it as nodes and uniforms; a scene listing the set loads its textures.
- **The library** (`src/toolkit/textures/<setId>/`): sand, mud, rocks, cliffs, snow, ice and grass ground, two each, and two concretes for structures. Each folder holds the set JSON, its texture JSONs (the recipes) and a `source.json` naming where the source maps download from.

## Best for

Texture sets are for **surfaces that tile**: ground, rock, snow, walls, floors, anything drawn by repeating a few metres of material over a large area.

|                      | Good fit                                                                                           | Poor fit                                                                                                                |
| -------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Art style            | Photoreal and stylized PBR from scans or bakes; painterly with `MINIMAL` and a flat or bump normal | Low-poly flat colour (vertex colours, no textures); hand-painted unique textures on one model (a plain material's maps) |
| Game type and camera | Every camera: the packing and the texel density change, not the set                                | —                                                                                                                       |
| World size           | A room to an open world: tiling in world space continues across meshes and blocks                  | A surface seen once and never repeated (a unique colour map, p305's colour map + detail)                                |

Poor fits also: props with UV-unwrapped unique textures (an imported glTF's own maps), and anything with large-scale features baked into the source (a valley's shadow, a path): a tiled layer repeats them every few metres.

### Which packing

| Packing   | Textures | When                                                                                                                                            | Tier (advisory) |
| --------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `LITE`    | 2        | **The terrain default.** Photoreal and stylized PBR at any camera: height blending and wet / dry still work, and 4 layers fit the bindings      | `MEDIUM`–`HIGH` |
| `FULL`    | 3        | A hero surface close to a first-person camera, where AO on indirect light only and a full-precision normal show; structures that need metalness | `HIGH`–`ULTRA`  |
| `MINIMAL` | 1        | Stylized, top-down, RTS, low-end and mobile: one fetch a layer, the normal from the height (or flat)                                            | `LOW`           |

A set ships as many packings as it needs: the library's sets are `LITE` only but `sand01`, `grass01` and `cliffs01`, which ship all three for the gallery's comparison.

## Performance

- **Fetches per pixel:** `P` per layer, per anti-tiling tap, per projection (the [formula](README.md#the-performance-formula)): `FULL` 3, `LITE` 2, `MINIMAL` 1. The baseline material draws one set with no anti-tiling or projection, so it fetches `P`.
- **ALU:** `LITE` reconstructs the normal's Z (`sqrt(max(0, 1 − x² − y²))`). `MINIMAL`'s bump takes the height's screen-space derivatives. The tangent frame of a world-tiled normal map is built from the tiling UV's derivatives (a few instructions; no tangent attribute needed).
- **VRAM** (KTX2 UASTC transcodes to 1 byte a texel, BC7 on desktop and ASTC 4 × 4 on mobile; a full mip chain adds a third):

  | One set at 1024²             | VRAM    | Download (KTX2 + Zstd) |
  | ---------------------------- | ------- | ---------------------- |
  | `LITE`                       | 2.67 MB | 1.4–2.5 MB             |
  | `FULL`                       | 4.00 MB | 2.6–3.6 MB             |
  | `MINIMAL`                    | 1.33 MB | 0.8–1.3 MB             |
  | The library's 16 `LITE` sets | 41.3 MB | 32.9 MB                |

  A material pays only for the sets it samples: four `LITE` layers are about 10.7 MB. A PNG or JPEG of the same size would be 4 bytes a texel on the GPU, four times as much.

- **Bindings:** one per texture, so `P` per set. WebGPU's 16 sampled textures per stage (shadow maps and the environment map included) allow about 3 `FULL` or 4 `LITE` sets in one material; a [set array](#set-arrays) binds `P` arrays for up to 16 layers.
- **Draw calls:** none of its own. A set is data a material samples.
- **Quality tier:** the packing (above). p305's terrain material picks it per tier.
- **Measured GPU time:** p310 adds the gallery's.

## Maps

### What each map does

| Map               | What it does                                                              | Required                    | In the source                                                                                |
| ----------------- | ------------------------------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------- |
| Colour (albedo)   | The surface's colour without lighting                                     | **Yes**                     | ambientCG `_Color`, Poly Haven `Diffuse`                                                     |
| Normal            | The small-scale relief's shading: pebbles, ripples, cracks                | Strongly recommended        | OpenGL (+Y) only: ambientCG `_NormalGL`, Poly Haven `nor_gl`                                 |
| Roughness         | How sharp the highlights are, per texel                                   | Strongly recommended        | ambientCG `_Roughness`, Poly Haven `Rough`                                                   |
| Ambient occlusion | Darkens the crevices                                                      | Optional                    | ambientCG `_AmbientOcclusion`, Poly Haven `AO`; derived from the height when missing (below) |
| Height            | Height blending between layers, puddles, `MINIMAL`'s bump, the derived AO | Optional (0.5 when missing) | ambientCG `_Displacement`, Poly Haven `Displacement`                                         |
| Metalness         | Metal or not                                                              | Optional                    | Ignored for terrain (0); `FULL`'s ORM keeps the channel for structures                       |

`yarn fetchTextureSources` fails a set without a colour, normal or roughness map, and logs a missing AO or height as optional.

### The packings

| Packing   | Slot           | R         | G         | B         | A         | Colour space    | Pipeline slot (`terrainLayer`) |
| --------- | -------------- | --------- | --------- | --------- | --------- | --------------- | ------------------------------ |
| `FULL`    | `albedoHeight` | albedo    | albedo    | albedo    | height    | sRGB (A linear) | `baseColor`: UASTC λ 2         |
|           | `normal`       | N.x       | N.y       | N.z       | –         | linear          | `normal`: UASTC λ 1            |
|           | `orm`          | AO        | roughness | metalness | –         | linear          | `orm`: UASTC λ 1               |
| `LITE`    | `albedoRough`  | albedo×AO | albedo×AO | albedo×AO | roughness | sRGB (A linear) | `baseColor`: UASTC λ 2         |
|           | `normalHeight` | N.x       | N.y       | height    | –         | linear          | `data`: UASTC λ 1              |
| `MINIMAL` | `albedoHeight` | albedo×AO | albedo×AO | albedo×AO | height    | sRGB (A linear) | `baseColor`: UASTC λ 2         |

- **Normals** use the OpenGL convention (+Y up the texture), as three.js does. `LITE` keeps only X and Y and reconstructs Z; `FULL` keeps all three and renormalizes after filtering (a mip-filtered normal is short).
- **Height** is stretched to the full 0..1 when packing (`"remap": "auto"`), so every set uses the channel's whole precision. The real relief is the set's `heightScale`.
- **Metalness** is 0 for terrain.
- **Mipmaps** are generated at encode time. The alpha channel (height, roughness) is mipmapped as linear data: sRGB applies to RGB only.

### AO into albedo, step by step

`LITE` and `MINIMAL` have no AO map: the AO is multiplied into the albedo when packing. It saves a fetch per layer, per anti-tiling tap, per projection (and in `LITE` the whole ORM texture), which is the biggest multiplier in the fetch formula.

1. **The recipe:** the albedo slot's `rgb` channel multiplies the colour by the AO map, with a `strength` (0 leaves the colour as it is, 1 multiplies the full AO):

   ```jsonc
   // sand01_albedoRough.texture.json, its pack
   "rgb": {
     "src": "./source/raw/color.jpg",
     "multiply": { "src": "./source/raw/ao.jpg", "channel": "r", "strength": 1 }
   },
   "a": { "src": "./source/raw/roughness.jpg", "channel": "r" }
   ```

2. **The strength:** `yarn fetchTextureSources --scaffold` writes the set's `surface.aoStrength` (default 1) as the multiply's strength. The library uses 1 everywhere: the scans' AO maps are mild (their 1st percentile is 0.38–0.86). Change it in the recipe, then `yarn assets`: the set's `surface.aoStrength` in the JSON no longer changes a baked AO, only `FULL`'s ORM AO at runtime.
3. **What it costs:**
   - **Baked AO darkens direct sunlight too.** Physically, AO only occludes indirect light (`FULL`'s ORM AO goes to the material's `aoNode`, which three applies to indirect light only). At pebble scale nobody can tell. At rock or valley scale they can: never bake large-scale occlusion into a tiling layer (it belongs in vertex AO or a colour map, p306 and p305).
   - **It stacks with screen-space AO.** The app's `ambientOcclusion` PostFX pass (GTAO, `src/app/postFx/ambientOcclusion.tsl.ts`) multiplies over the whole image, so a crevice darkens twice. `docs/analysis/ambient-occlusion-options.md`'s rule: combine the two with `min()`, or split them by scale (the texture's crevices, GTAO's contact shadows). p305's terrain material lowers its own AO influence when a layer's AO is baked; with GTAO on, a lower recipe strength (0.5–0.7) is the simple fix for a set too dark in the cracks.

### AO from height (cavity)

Some sources have no AO map (the library's `ice01`, `ice02` and `concrete01`). A `cavity` makes one from the height when packing: `ao = 1 − strength × max(0, blur(h) − h)`, `h` the height stretched to 0..1, blurred with wrapping edges (the map tiles). A texel lower than its surroundings gets darker.

```jsonc
// ice01_albedoRough.texture.json, its pack
"rgb": {
  "src": "./source/raw/color.jpg",
  "multiply": {
    "src": "./source/raw/height.jpg",
    "channel": "r",
    "cavity": { "radius": 24, "strength": 1 },
    "strength": 1
  }
}
```

- **`radius`** is the blur's sigma in pixels at the pack size: 24 for a 2K source (the scaffold halves it for a 1K download). It sets the crevice's width.
- **`strength`** is how dark a crevice gets. The default, 4, was fitted on a 2K ground scan (ambientCG Ground080) against its own AO map (mean 0.91 against 0.88). It suits ground; a height map with narrow deep pits clamps to black at 4 (2 % of `ice01`'s texels), where a scanned AO map never reaches 0. The library uses 1 for ice and 2 for `concrete01`, matched to the scanned AO maps' 1st percentile (0.69–0.84).
- **Check it** by eye in the gallery (`yarn dev`, `?isDebug=true&startScene=terrainGallery`): black holes in a lit surface mean the strength is too high.
- `FULL`'s ORM can use one as its R channel: `"r": { "src": "./source/raw/height.jpg", "channel": "r", "cavity": {} }`.

## Blender, step by step

Making your own set: bake a tileable PBR material to images on a plane in Cycles. The same steps work for a procedural material and for a sculpt.

1. **The plane.** Add a plane of the set's `physicalSize` (eg. 2 × 2 m: Add → Mesh → Plane, Size 2). Its default UVs fill 0..1, which is what the bake writes. Keep the scene's units in metres.
2. **A material that tiles.** The edges must match, or every tile shows a seam.
   - **Procedural:** feed the texture nodes periodic coordinates. A Noise or Voronoi texture set to 4D tiles exactly on a torus: from the Texture Coordinate node's UV (u, v), build the Vector (cos 2πu, sin 2πu, cos 2πv) and W = sin 2πv with Math and Combine XYZ nodes, and set the feature size with the node's Scale. Noise on plain UVs never tiles.
   - **Sculpted:** sculpt the detail on a subdivided copy of the plane (or displace it with a tiling height texture), keeping the borders flat or matching, then bake from it onto the flat plane ("Selected to Active", below).
   - **Relief:** a Displacement output or the sculpt gives real relief (the AO and normal bakes see it). A Bump node only bends the shading normal: the normal bake sees it, the AO bake doesn't (it's white): leave the AO out and derive it from the height (above).
3. **Bake settings.** Render Engine: Cycles. For a sculpt, check "Selected to Active" in Render Properties → Bake, with a small Extrusion, and select the sculpt, then the plane.
4. **An image per map.** In the plane's material, add an Image Texture node with a new 2048 × 2048 image (2K, to be resized to 1K: see [the sources](#where-to-get-sets)), and keep it selected (the active node) when you bake. Turn off its Alpha. Set the image's colour space to sRGB for the colour and Non-Color for every other map. For the height, check 32-bit Float.
5. **Bake each map** (Bake Type, then Bake; one image each):
   - **Colour:** Diffuse, with only Color checked (Direct and Indirect off), so no lighting is baked in.
   - **Roughness:** Roughness.
   - **Normal:** Normal, Space Tangent, swizzle +X +Y +Z (the OpenGL convention).
   - **AO:** Ambient Occlusion (a sculpt or real displacement only).
   - **Height:** bake Emit from an Emission shader whose colour is the height mapped to 0..1 (a Map Range node from the lowest to the highest point). A procedural material: the value its displacement uses. A sculpt: give it a material emitting its Geometry → Position's Z (Separate XYZ), and bake Selected to Active. Reconnect the material afterwards.
6. **Check the seams** with a 2 × 2 preview: a second plane with a material sampling the baked images through a Mapping node at Scale 2 (Texture Coordinate → UV → Mapping → each Image Texture), in Material Preview. A seam shows as a line or a jump across the middle. Fix the material, not the image.
7. **Note the relief** for the set's `heightScale`: the height's range in metres (the Map Range's highest minus its lowest point). The pack stretches the height to 0..1, so this range is what a height of 1 stands for.

## Export

Save each baked image (Image → Save As) into the set's folder, in `source/` (not `source/raw/`, which is the fetch tool's and gitignored):

| Map       | Format | Colour depth | Colour space |
| --------- | ------ | ------------ | ------------ |
| Colour    | PNG    | 8-bit        | sRGB         |
| Normal    | PNG    | 16-bit       | Non-Color    |
| Roughness | PNG    | 8-bit        | Non-Color    |
| AO        | PNG    | 8-bit        | Non-Color    |
| Height    | PNG    | 16-bit       | Non-Color    |

The pack reads a 16-bit PNG at 16 bits, so a height with a narrow range is stretched to 0..1 before it's quantized to the texture's 8 bits, with no banding. Name them after the maps (`color.png`, `normal.png`, `roughness.png`, `ao.png`, `height.png`), so the recipes read like the library's.

## Import into Ækasha

A set is a folder: the set JSON, a texture JSON per slot (the pack recipes), and the sources. The toolkit's library is in `src/toolkit/textures/<setId>/`; an app's own set goes in the folder of the scene that uses it, or `src/app/textures/<setId>/` when several do.

```text
src/app/textures/moss01/
  moss01.textureSet.json
  moss01_albedoRough.texture.json      the LITE packing's two recipes
  moss01_normalHeight.texture.json
  source.json                          a provider's set only: where its maps download from
  source/                              your own maps (committed); a provider's in source/raw/ (gitignored)
```

### From a provider

1. **Pick the asset** on ambientCG or Poly Haven (both CC0; [where to get sets](#where-to-get-sets)), and write its `source.json`:

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

   `maps` names each map as the provider does: ambientCG's file-name suffix in its zip, Poly Haven's map name (`Diffuse`, `nor_gl`, `Rough`, `AO`, `Displacement`). Leave out a map the asset doesn't have.

2. **Write the set JSON** (its packings, below), naming the textures by the convention `<setId>_<slot>`.
3. **`yarn fetchTextureSources --only moss01 --scaffold`** downloads the maps into the set's `source/raw/` (cached in `.cache/texture-downloads/`) and writes the texture JSONs the packings name: each a pack of the layout above, the `terrainLayer` profile, the right pipeline slot, sRGB on the albedo slots, `REPEAT` wrapping and anisotropy `MAX`. It never overwrites a recipe: once written, it's yours to tune. A toolkit set also gets its row in `src/toolkit/textures/CREDITS.md`.
4. **`yarn assets --only 'src/app/textures/moss01/**'`\*\* packs and encodes the textures. The dev server does it too, on save.
5. **Look at it** on a mesh with the baseline material ([below](#using-a-set)), tune the set's JSON ([Set-up](#set-up-and-parameters)), and run a full `yarn assets` before you commit (only it prunes the outputs of recipes you changed).

**Commit** the set JSON, the recipes, `source.json` and the outputs in `src/public/aek-assets/` with `assets.lock.json`, never `source/raw/`. A clone without the fetched maps uses the committed outputs: the lock records each output's recipe key (the recipe without the fetched files' bytes), so an unchanged recipe is a cache hit. Changing a recipe then needs the maps: `yarn fetchTextureSources` first.

### From your own maps

The same set JSON, with recipes you write (copy a library set's and change the `src` paths to `./source/color.png` and so on), and the sources committed in `source/`. No `source.json`: the fetch tool skips a set without one. Then `yarn assets`.

### Adding a set to the library

A toolkit set is the same folder in `src/toolkit/textures/<setId>/` (one set per folder), with a `source.json` (the library is all downloadable CC0) and a `debugData` naming the asset and its licence. Follow the naming (`<material><nn>`: `sand03`), give it the `LITE` packing, tune it in the gallery next to the others, and add it to the gallery's blocks (`src/app/scenes/terrainGallery/terrainGallery.ts`' `GALLERY_BLOCKS` and the scene JSON's `textureSets`). `yarn fetchTextureSources` regenerates `CREDITS.md`.

### The encode (KTX2 per slot)

Every recipe uses the `terrainLayer` profile (`assets.config.json`), which differs from the defaults only in the `data` slot:

| Texture                       | Pipeline slot | Codec                                                                  | Why                                                                              |
| ----------------------------- | ------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `albedoRough`, `albedoHeight` | `baseColor`   | UASTC, RDO λ 2, 1024 px                                                | Colour: sRGB RGB, linear alpha                                                   |
| `FULL`'s `normal`             | `normal`      | UASTC, RDO λ 1                                                         | Resized as unit vectors, mips renormalized                                       |
| `FULL`'s `orm`                | `orm`         | UASTC, RDO λ 1                                                         | Data: a lower λ keeps it sharper                                                 |
| `LITE`'s `normalHeight`       | `data`        | UASTC, RDO λ 1 (`terrainLayer`; the default `data` slot isn't encoded) | Not `normal`: its B is the height, not Z, so a unit-vector resize would wreck it |

- **2K sources, 1K outputs:** the profile's `maxSize` is 1024, so a 2K source is resized by the pipeline. Downsampling averages out JPEG artifacts and gives clean mips. A 2K output needs a profile of your own with `maxSize: 2048` (four times the VRAM: 10.7 MB a `LITE` set); a set has one recipe per slot, so a 2K variant is a second set.
- **One codec per slot** across sets, or they can't share a [set array](#set-arrays) (its layers must transcode to one format).
- **ETC1S** (the `compact` profile) shrinks downloads but blurs normals and data: the [codec cheat sheet](asset-optimization.md#codec-cheat-sheet) advises against it for terrain.

### Using a set

The engine feature: list `textureSets()` (from `aekasha/texturesets`) in `InitEngine`'s `features`. A scene whose data names a set fails the boot without it, naming the feature.

**In a material:** an input `{ "textureSet": id }` (optionally `"packing": "FULL"`; default the set's `defaultPacking`) gives a TSL material the set's textures by slot and its fields as uniforms. The scene's gather adds the packing's textures to the scene, so it lists only the material. The toolkit's baseline material, `textureSetSurface`, draws one set; give each mesh its own with `matOverrides`:

```jsonc
// a mesh's JSON
"mat": "textureSetSurface",
"matOverrides": { "inputs": { "surface": { "textureSet": "rocks01" } } }
```

Its static defines: `tiling` `"WORLD_XZ"` (the default: the world's `(x, −z)` over `physicalSize`, for terrain; tiling continues across meshes) or `"UV"` (the mesh's UVs in metres, for walls and structures), and `minimalNormal` `"BUMP"` (default) or `"FLAT"` for `MINIMAL`. Writing your own material: `sampleTextureSet` (`aekasha/toolkit/terrain`) decodes any packing into `{ albedo, normalTS, roughness, ao, isAoBaked, height }`, and `transformTangentNormalToView` shades its normal in the frame of the UV you sampled at.

**In a scene:** `"textureSets": ["sand01", "grass01"]` loads each set's default packing's textures with the scene, for code that uses them.

**From code:** `loadTextureSetAsync(id, { packing })` loads a packing's textures (in the calling scene's ownership: they're released with it), `getTextureSetPackingTextures(id, { packing })` returns them by slot once loaded, and `getTextureSet(id)` returns the set's data (its `averageColor` included). A production build has only the sets its scenes list or name.

## Set-up and parameters

| Field                                              | What it is                                                                                                                 | Default                             |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `id`                                               | The id materials and scenes name it by                                                                                     | The file's name                     |
| `category`                                         | `SAND`, `MUD`, `ROCKS`, `CLIFF`, `SNOW`, `ICE`, `GRASS`, `CONCRETE`, `OTHER`: for the terrain tools' defaults and grouping | Required                            |
| `physicalSize`                                     | Metres one tile covers, `[width, height]`                                                                                  | Required                            |
| `heightScale`                                      | Metres of relief a height of 1 stands for                                                                                  | Required                            |
| `defaultPacking`                                   | The packing a scene listing it, or an input without `packing`, loads                                                       | `LITE`, else `FULL`, else `MINIMAL` |
| `packings`                                         | The texture ids per packing and slot (at least one packing)                                                                | Required                            |
| `surface.tint`                                     | A colour multiplied into the albedo (sRGB)                                                                                 | `#ffffff`                           |
| `surface.normalStrength`                           | Scales the normal's slope                                                                                                  | 1                                   |
| `surface.roughnessScale`                           | Scales the roughness (the baseline caps it at 1)                                                                           | 1                                   |
| `surface.aoStrength`                               | How much of `FULL`'s AO applies; the scaffold's multiply strength for a baked AO                                           | 1                                   |
| `surface.heightContrast`                           | Sharpens (> 1) or softens (< 1) the height for height blending (p305)                                                      | 1                                   |
| `surface.porosity`, `wetDarkening`, `wetRoughness` | The wet response (p307)                                                                                                    | 0.5, 0.5, 0.3                       |
| `averageColor`                                     | The albedo's average (sRGB), for p305's far mode                                                                           | Measured by the asset pipeline      |

The `surface` fields are defaults: a terrain material copies them into uniforms, and each of its layers can override any of them.

### Choosing `physicalSize` and texel density

`physicalSize` is what makes sets from different scans line up in scale. Take it from the provider when it gives one (ambientCG's dimension, Poly Haven's in millimetres; only some assets have it), else estimate it from something of known size in the image (a pebble, a footprint, a brick), then check it in the gallery against the 1 m checker (the debug tab's switch).

The texel density near the camera is the texture's pixels over `physicalSize`: a 1024 px set over 3 m is 341 px/m.

| Camera        | Target density | For example                          |
| ------------- | -------------- | ------------------------------------ |
| First person  | 256–512 px/m   | A 1K set over 2–4 m                  |
| Third person  | ~256 px/m      | A 1K set over 4 m                    |
| Top-down, RTS | 64–128 px/m    | A 512 set is enough (`maxSize: 512`) |

A smaller `physicalSize` is sharper but repeats sooner. The library's 1.3 m sets (`mud01`, `rocks02`) and `concrete01` (1.1 m) show their repetition at 2 × 2 tiles: that's p305's anti-tiling's job, not a larger size's.

### Choosing `heightScale`

The height map's relief must agree with the normal map's, or height blending and the bump disagree with the shading. A Blender bake knows it exactly (step 7 above). For a scan, the library's values were fitted: the slope each texel's normal shows (`−n.xy / n.z`) against the height map's gradient per metre (the 0..1 height over `physicalSize`), least squares, `slope = heightScale × ∇h`. The results range from 0.002 m (`grass01`: its height map is nearly flat, the blades are in the normal only) through 0.04–0.06 m for sand, mud and snow, to 0.16–0.25 m for the cliffs. A guess within a factor of two is fine to start; the gallery's `MINIMAL` view (a bump from `heightScale` alone) next to `FULL`'s normal map shows when it's off.

### Tint

`tint` brings the albedo into a plausible range for its material (linear luminance: wet soil 0.05–0.15, dry sand about 0.3, fresh snow 0.8–0.9), so sets blend without seams in tone. **It can only darken** (a JSON colour is at most white): a set too dark needs its recipe changed (a lower AO strength, say). The library's: `snow01` and `snow02` `#fff2e9` (their scans are blue, sky light baked in, which the scene's own sky light would double: b / r from 1.32 to 1.08), `concrete01` `#eaeaea` (0.46 to 0.38). The asset pipeline's `averageColor` is the albedo's without the tint (a material multiplies the two).

## Variations

- **`FULL` instead of `LITE`:** the AO stays in its own map and hits indirect light only, the normal keeps full precision, and `aoStrength` works at runtime. Costs a third texture per layer (+1 fetch per tap, +1.33 MB VRAM a set). Add a `FULL` packing beside `LITE` (its three recipes) and pick it per material with `"packing": "FULL"`.
- **`MINIMAL`:** one texture per layer. The normal is a bump from the height's screen-space derivatives (`minimalNormal: "BUMP"`, `heightScale` metres of relief) or the mesh's own (`"FLAT"`); roughness is a constant (0.8 in the baseline) times `roughnessScale`. Halves the fetches against `LITE`; loses the fine normal detail the height map doesn't hold.
- **A lower AO strength in the recipe:** for a set that turns too dark under GTAO, or whose AO map holds large-scale shading. No runtime cost; re-encode.
- **Cavity AO instead of the scan's AO:** for a source without one, or one whose AO is too large-scale. Same cost.
- **UV tiling for walls:** `textureSetSurface`'s `tiling: "UV"` tiles the mesh's UVs over `physicalSize`, so a vertical face (where world XZ tiling smears) shows the set at its size. Its UVs must be in metres (the gallery's cliff walls scale their faces' UVs so).

### Set arrays

Several sets of one packing as one array texture per slot: a terrain material binds 2 textures (`LITE`) for up to 16 layers instead of 2 per layer. A material input `{ "textureSetArray": ["sand01", "grass01", "rocks01", "cliffs01"], "packing": "LITE" }` makes one with the scene's load; in code, `buildTextureSetArray({ sets, packing })` (`aekasha/texturesets`). Every set needs the packing, and every slot the same size, mip count and codec (so `concrete01`, 1024 × 512, can't join the others). Each layer's `physicalSize`, `heightScale` and `surface` fields come along as one uniform array (`getTextureSetLayerParams`). A `swappable: true` array can change a layer at runtime (`setTextureSetArrayLayer`), at the cost of a CPU copy as large as its VRAM. p305's terrain material samples them.

## Where to get sets

- **ambientCG** (ambientcg.com) and **Poly Haven** (polyhaven.com): both CC0 (no attribution required; the library records it anyway in `CREDITS.md`), both with ready-made PBR scans. The fetch tool reads both.
- **Download `2K-JPG`** (an ambientCG zip is about 20–40 MB; the library's 15 downloads were 425 MB, cached once). `2K-PNG` (55–75 MB) is worth it only for a set whose normal map shows JPEG blocking at 1K, typically cliffs. 4K is unnecessary for a tiling layer.
- **Prefer close-range scans** (a few metres a tile). Aerial ones (Poly Haven's `aerial_*`, 15–80 m a tile) are too coarse at 1K for a close camera.
- **Pick by eye:** tile the colour 2 × 2 and look for a dark band or a blob that repeats (the library dropped two primaries for that), and light the normal from a grazing angle to see the relief.
- **The OpenGL normal:** ambientCG `_NormalGL`, Poly Haven `nor_gl`, never the DirectX variants (`_NormalDX`, `nor_dx`).

## Pitfalls and checklist

- [ ] The normal map is the OpenGL one. A DirectX map lights the relief from the wrong side (its green is flipped: `invert: true` on that channel fixes a source that has no GL map).
- [ ] The source tiles: no seam at 2 × 2, no feature that repeats as a pattern.
- [ ] No large-scale shading in the colour or AO (a valley's shadow, a sunlit side): tiled, it repeats every few metres.
- [ ] `physicalSize` checked against the gallery's 1 m checker.
- [ ] `heightScale` agrees with the normal map: `MINIMAL`'s bump and `FULL`'s normal light the relief from the same side and about as strongly.
- [ ] No black holes in a lit surface (a cavity strength too high).
- [ ] The albedo in its material's range, with a `tint` if needed; snow without its blue cast.
- [ ] A `LITE` set's `normalHeight` in the `data` slot of `terrainLayer`, never `normal`.
- [ ] Sets meant for one array share the packing, size and codec.
- [ ] A full `yarn assets` before committing; the outputs and `assets.lock.json` committed, `source/raw/` not.
- **Lit from the wrong side?** Open the gallery, pick `FULL` then `MINIMAL` in its tab for `sand01`, `grass01` or `cliffs01`: the bump has no tangent frame, so the two disagreeing means a mirrored frame or map. The world tiling is `(x, −z)` for this reason: `(x, z)` shows the map mirrored from above (`src/_engine/features/texturesets/CLAUDE.md`'s trap: three's `normalMap()` builds its frame from the mesh's UV, not the tiling's).
- **Stripes down a slope** in a scene with shadows: three's VSM, not the set ([`docs/issues/vsm-stripes-on-unshadowed-slopes.md`](../issues/vsm-stripes-on-unshadowed-slopes.md)).
- **A set missing in a production build:** no shipped scene lists or names it, so its data and outputs aren't in the build.

## Template file and example asset ids

No Blender template file: the [Blender steps](#blender-step-by-step) start from a plane.

- **The library** (`src/toolkit/textures/`): `sand01`, `sand02`, `mud01`, `mud02`, `rocks01`, `rocks02`, `cliffs01`, `cliffs02`, `snow01`, `snow02`, `ice01`, `ice02`, `grass01`, `grass02`, `concrete01`, `concrete02` (the sources and licences: `CREDITS.md`). `sand01`, `grass01` and `cliffs01` ship all three packings.
- **The baseline material:** `textureSetSurface` (`src/toolkit/materials/textureSetSurface/`).
- **The gallery:** `terrainGallery` (`src/app/scenes/terrainGallery/`, `?isDebug=true&startScene=terrainGallery`): every library set on a 12 m block with a 35° ramp, the cliffs with a wall, and its "Terrain gallery" tab.
- **The verification scene:** `textureSets` (`src/app/scenes/textureSets/`): a hand-made set in each packing, and four sets as `{ textureSet }` next to the same four as a `{ textureSetArray }`.
