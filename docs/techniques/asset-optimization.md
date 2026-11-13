# Asset optimization

Ækasha turns the textures and models your asset JSONs point at into GPU-ready files at build time: KTX2 textures (Basis Universal) and meshopt-compressed GLBs. The point is GPU memory as much as download size. A PNG or JPEG is decoded to raw RGBA on the GPU, so a 2048² texture costs about 22 MB of VRAM with mips, whatever its file size. A KTX2 texture stays block-compressed on the GPU (BC7, ASTC or ETC2, whichever the device reads), which is 1 byte per pixel or less.

Measured on this repo's test assets (four 1K textures and a prop with 2K maps), the default codec (UASTC with RDO) cut texture VRAM by 75% at the same resolutions (85 MB → 21 MB), with no visible difference at screen resolution.

Optimization is on by default and never required: you can switch it off for the whole project, per asset, or for one page load (see [Opting out](#opting-out)).

## How it works

```text
src/app/textures/rock.texture.json ──┐
src/app/textures/source/rock.png ────┤   yarn assets / yarn dev / yarn build
assets.config.json (profiles) ───────┘             │
                                                   ▼
                    src/public/aek-assets/app/textures/source/rock.3fa9c21b.ktx2
                    assets.lock.json (cache key → output)
                    generatedAppData.json ("__url": "/aek-assets/…")
                                                   │
                                                   ▼
                    loadTextureAsync / importAssetAsync load the __url
```

- The pipeline reads every `*.texture.json` and `*.importedAsset.json` under `src/`. There is no separate asset list: an asset's settings live in its own JSON (`optimize`), and shared settings live in `assets.config.json` at the repo root.
- Outputs go to `src/public/aek-assets/`, named by a hash of their content. **Commit them, together with `assets.lock.json`.** The lock maps each cache key (the source bytes, the resolved settings and the tool versions) to its output, so someone who clones the project gets cache hits and never needs the encoder.
- The dev server rebuilds only what a save touched (the asset JSON, its source file, `assets.config.json`, or `assets.optimization` in `src/CONFIG.ts`). Everything else is a cache lookup.
- At runtime nothing needs configuring. The KTX2 transcoder and the meshopt decoder load only when a KTX2 file or a meshopt GLB is loaded.

### The encoder

Textures are encoded by the `ktx` CLI from KTX-Software (≥ 4.4.0). You only need it when you add or change an asset. The pipeline downloads the pinned release into the gitignored `.tools/` the first time it needs to encode. `yarn setupAssetTools` does the same thing by hand.

- Supported: Linux x64/arm64 (glibc ≥ 2.34: Ubuntu 22.04+, Debian 12+, Fedora 35+), WSL2 and macOS (arm64 and x64). On native Windows, run the project in WSL2.
- Already have a `ktx`? A `ktx` ≥ 4.4.0 on your `PATH` is used as is, and `AEK_KTX=/path/to/ktx` picks a specific one.
- Without a working `ktx`, the pipeline still runs. Committed and cached outputs are used. An asset that needs an encode is reported as `encoder missing`, and the dev server loads its source file instead, with a warning. A production build fails on it (see [Builds](#builds-and-ci)).

## Add a texture

Put the source image next to its JSON and refer to it with a path that starts with `./` or `../`:

```jsonc
// src/app/textures/rock.texture.json
{
  "$schema": "../../../.schemas/texture.schema.json",
  "id": "rock",
  "fileName": "./source/rock_albedo.png",
  "texOpts": { "colorSpace": "srgb", "wrapS": 1000, "wrapT": 1000 },
  "optimize": { "slot": "baseColor" },
}
```

Save it, and the dev server encodes it. Then commit the source, the new file in `src/public/aek-assets/` and `assets.lock.json`.

- **`slot`** tells the pipeline what the texture is (see [Slots](#slots)). It defaults to `default`.
- **Colour space:** set `texOpts.colorSpace: "srgb"` on colour textures (albedo, emissive). The KTX2 is encoded with the colour space your JSON says, so it looks the same as the PNG loaded with the same JSON.
- **Orientation:** standalone textures are stored flipped in the KTX2, because a compressed texture can't be flipped at load. They look the same as the source loaded through `TextureLoader`. You don't need to do anything. A texture whose `texOpts.flipY` is `false` (UVs with the origin at the top, as a glTF's) is stored as the source is instead: its own encode, keyed apart (p302 D1). A texture array or atlas slot is always stored flipped, so its schema refuses `flipY: false`, and a merge palette fails on a member texture that has it.
- **Relative sources** must stay inside `src/` and can't be combined with `path`. A production build doesn't ship `src/`, only the outputs.
- **A `src/public` path** (`"/textures/rock.png"`) still works, and that file is optimized too. A remote URL is loaded as it is.
- HDR sources (`.hdr`, `.exr`) and `.ktx2` / `.basis` sources are passed through as they are: UASTC and ETC1S are LDR formats.

## Add a model

```jsonc
// src/app/importedAssets/crate.importedAsset.json
{
  "$schema": "../../../.schemas/importedAsset.schema.json",
  "id": "crate",
  "fileName": "./source/crate.glb",
  "importTextures": true,
  "optimize": { "profile": "prop" },
}
```

- The geometry is meshopt-compressed and quantized (smaller download and smaller vertex buffers). The embedded textures are encoded to KTX2, each by the material slot that uses it.
- **Without `importTextures`, the output has no textures.** The engine discards glTF materials and registers a GLB's textures only with `importTextures`, so the pipeline drops the textures instead of shipping them. If code imports the file with `importTextures` but the JSON doesn't set it (or a scene's save entry doesn't), the textures are gone: set it in the JSON.
- `.gltf` files with external buffers and images work; the output is always a `.glb`.
- **`"lodChain": true`** (or its options: `ratios`, `maxError`, `compactVertices`, …) builds the LOD levels into the output, so the client never runs the simplifier. They are extra meshes no node uses, so glTF viewers show the model as before. Every use of a file shares one output: if the JSON and a scene's save entry ask for different options, the first one wins and the run warns. With the mesh side off (`"optimize": { "mesh": false }`, or a pass-through), the chains are generated at runtime after the load instead. Changing the options re-encodes the file, and so does a three.js update (the simplifier welds with its `mergeVertices`).

### Merging pieces

A model made of many static pieces (a level, a kit-bashed ruin) costs a draw per piece. `merge` joins them at build time:

```jsonc
{
  "id": "ruinKitLevel",
  "fileName": "./ruinKitLevel.glb",
  "merge": { "mode": "ALL", "exclude": ["door_*"] },
}
```

- **`mode`**: `BY_MATERIAL` (the default; `"merge": true` is the same) gives one node per glTF material, named `__merged_<material>`, also when the file has one material, so a second one never renames the first. `ALL` gives one node, `__merged`. The engine uses one material per imported asset, so `ALL` is one draw. Scenes reference the node like any other (`ruinKitLevel/__merged`).
- **Names** are sanitized as three's GLTFLoader names nodes: `stone wall` → `__merged_stone_wall`, `wood.001` → `__merged_wood001`; an unnamed material is `material<index>`, no material `nomaterial`. Pieces whose attribute set differs from the others' (one has `COLOR_0`) can't join them and make `_2`, `_3`, …, with a warning naming each node's attributes. A merged name the file already uses gets a suffix and a warning.
- **The merged node** is a new child of the import root with no transform: each piece's transform is baked into the root's space (normals by the normal matrix; a mirrored piece's winding and tangent `w` flipped, so it isn't drawn inside out), and quantized pieces are dequantized first. A scene mesh at the origin draws the file's layout.
- **Kept as they are, with their subtrees:** nodes an `exclude` glob names (the config's glob syntax, on node names), physics nodes (`isPhysObj` or `colliderType` in the node's or its mesh's extras), joints and animated nodes. **Kept alone, with a warning:** skinned and GPU-instanced (`EXT_mesh_gpu_instancing`) nodes, and nodes with a morph target or a non-triangle primitive. A merged piece's node is removed when nothing kept hangs on it, and so is a parent it leaves empty; the file's own empty nodes stay.
- **Order:** the merge runs before the compression and the `lodChain` step, so a chain is built from the merged mesh (one per merged node).
- **Always written.** A file with `merge` is written even when both its geometry and its textures would pass through (`"optimize": false`, `AEK_ASSETS_OPTIMIZE=false`), with a warning, since scenes name the merged nodes.
- **Every use of the file** is merged with the JSON's own `merge`. Changing it re-encodes the file (it's in the cache key, with the merge step's version).
- **Stats:** the run's line reads `merged 20 pieces into __merged (kept 3 excluded, 2 physics)`; the lock entry and `.cache/asset-pipeline/last-run.json` hold each merged node's pieces, vertices and triangles and the kept nodes by reason.
- **Remote files** (an `https://` `fileName`) can't be merged: the gather fails on it. `merge` is build time only, so it isn't in a save entry or a scene's inline import, and the generated data drops it.

The trade-off: the pieces are no longer nodes, so they can't be entities, moved, hidden or picked one by one. Keep what must stay addressable (doors, levers) out with `exclude`, or merge at runtime instead: mesh merge groups (`merging()`) draw the pieces as one mesh while each stays an entity (see [Modular kits and tile-chunk worlds](terrain-modular-kits.md)).

Gaps:

- A runtime that loads the source instead of an output has no `__merged` node: the dev server's fallback when the pipeline has no output (a failed encode, `ktx` missing with `importTextures`) and the Assets tab's "Load source files". A scene mesh naming the node isn't created, and the load logs the missing geometry.
- `meshIndex` counts the merged file's nodes.
- A mesh several nodes share is copied into the merge once per node, so the vertex count grows (the test kit's six pillars of one mesh: 16.8 → 21.0 KB of GPU memory). Unmerged, nodes that share a glTF mesh get one geometry id at import, the first node's.

`testDebugScene`'s `p371MergeKit` is the example: 20 pieces in two materials joined with `ALL`, its doors excluded and its colliders kept (its GLB is built by `devTools/assetPipeline/fixtures/mergeKitFile.ts`).

### Collider sources

Quantized positions break CONVEXHULL and HEIGHTFIELD colliders, and the meshopt vertex reorder scrambles a heightfield's grid. So a GLB with a node that has `colliderType` in its extras, or in its mesh's extras (the custom property the importer reads, which three's loader merges from both), gets **lossless** meshopt: compressed, but not quantized, reordered or simplified. You don't need to set anything.

The pipeline can't see colliders that only code adds (`ImportPhysicsParams`). For those sources, set it yourself:

```jsonc
"optimize": { "mesh": { "quantize": false } }
```

If a quantized mesh ends up under a HEIGHTFIELD anyway, the collider is skipped with an error that names this fix. TRIMESH, BOX and CONVEXHULL handle quantized positions.

## Profiles and settings

Settings are resolved per texture slot, from these levels, deep-merged, later wins:

1. the built-in defaults (`devTools/assetPipeline/settings.ts`);
2. `defaults` in `assets.config.json`;
3. every `rules` entry whose `glob` matches the source path (from the repo root), in order;
4. the profile (the JSON's `profile`, else the last matching rule's);
5. the collider default, for collider sources;
6. the asset JSON's own `optimize`.

Within each level, a slot's entry merges over that level's `textures.default`. So a profile's `default.maxSize` reaches every slot, while `normal: { rdo: 1 }` changes only the normal maps' RDO.

### Profiles

The ones `assets.config.json` ships with. Add your own there.

| Profile        | What it changes                                                                                     | Use it for                                                                 |
| -------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| (none)         | The defaults: UASTC, 1024 px, RDO λ 2 for colour and λ 1 for normal / ORM, `data` slots not encoded | Most assets                                                                |
| `prop`         | Textures up to 1024 px, VRAM budget 8 MB                                                            | Ordinary props                                                             |
| `hero`         | Textures up to 2048 px, VRAM budget 24 MB                                                           | Assets the camera gets close to                                            |
| `compact`      | ETC1S for the `baseColor` and `emissive` slots                                                      | Distant and background assets, mobile VRAM budgets                         |
| `terrainLayer` | Encodes the `data` slot as UASTC λ 1                                                                | Terrain layer textures (packed normal + height)                            |
| `terrainBlock` | Lossless meshopt                                                                                    | Terrain meshes, colliders the pipeline can't detect                        |
| `data`         | No texture is encoded                                                                               | Textures that must stay exact (LUTs, splat maps, anything read on the CPU) |

### Slots

| Slot                                    | Meaning                                                 | Default             |
| --------------------------------------- | ------------------------------------------------------- | ------------------- |
| `baseColor`, `emissive`                 | Colour                                                  | UASTC λ 2           |
| `normal`                                | Normal map (resized as unit vectors, mips renormalized) | UASTC λ 1           |
| `orm`, `occlusion`, `metallicRoughness` | Packed or single PBR data maps                          | UASTC λ 1           |
| `data`                                  | Splat maps, masks, LUTs, height                         | `none` (kept exact) |
| `default`                               | Anything else                                           | UASTC λ 2           |

A GLB's textures are classified by the material slot that uses them: a normal map is `normal`, a texture used for both occlusion and metallic-roughness is `orm`, and a texture in one core slot gets that slot.

### Per-asset overrides

`optimize` takes `profile`, `slot` (textures), and `textures`, `mesh` and `budget` overrides:

```jsonc
"optimize": {
  "profile": "hero",
  "textures": {
    "default": { "maxSize": 512 },
    "normal": { "rdo": 0 }
  },
  "mesh": { "simplify": 0.5 }
}
```

The JSON Schema in `.schemas/` autocompletes and explains every key in your editor, and a misspelt key fails the gather.

### Rules

A rule applies settings by source path, without touching the JSONs. It only affects assets that a JSON references:

```jsonc
// assets.config.json
"rules": [
  { "glob": "src/app/props/**/*.glb", "profile": "prop" },
  { "glob": "src/app/ui/**", "optimize": false }
]
```

## Pack channels

A texture JSON can build its image from several sources with `pack`, in place of `fileName`. Each output channel (`r`, `g`, `b`, `a`, or a group like `rgb`) is a source channel or a constant, with optional `remap`, `invert` and `multiply`. For example, a glTF ORM map:

```jsonc
// src/app/textures/metal_orm.texture.json
{
  "$schema": "../../../.schemas/texture.schema.json",
  "id": "metal_orm",
  "pack": {
    "channels": {
      "r": { "src": "./source/metal_ao.png" },
      "g": { "src": "./source/metal_roughness.png" },
      "b": { "src": "./source/metal_metallic.png" },
    },
  },
  "optimize": { "slot": "orm" },
}
```

- A greyscale source has its grey in r, g and b, so `channel` can be left out here. Taking alpha from an image without alpha is an error.
- Colour channels of an sRGB texture (`texOpts.colorSpace: "srgb"`) are read as sRGB, everything else as linear. Override it per channel with `colorSpace`.
- `normal: true` marks a normal map source: it's resized as unit vectors first. `invert: true` flips a channel, eg. a DirectX normal map's green.
- `multiply: { "src": "./source/ao.png", "strength": 0.8 }` bakes AO into an albedo.
- Sources of different sizes need `size: [width, height]`. The result is then resized to the slot's `maxSize`.

With optimization off, a pack is still built and written as a PNG, since it has no single source file.

## Texture arrays and atlases

Both put many images behind one texture binding. WebGPU gives a shader stage 16 sampled textures by default, and shadow maps and the environment map take some of them, so a material that blends eight ground layers or a scatter of twenty card types needs one of these.

### Which one

|              | Texture array (`*.textureArray.json`)                                             | Atlas (`*.textureAtlas.json`)                                                      |
| ------------ | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Images       | Layers, all resized to one `size`                                                 | Cells of any size, packed into one layout                                          |
| Tiling       | Yes: each layer wraps and mips on its own                                         | No: a UV past a cell reads its padding, then its neighbour                         |
| Map types    | One array per map type (an albedo array, a normal array), the layers in one order | One JSON, a texture per `slots` entry, all on one layout                           |
| Mip chain    | Full                                                                              | Stops at the last level the padding keeps the cells apart                          |
| Use for      | Terrain and ground layers, material sets, merge material palettes                 | Decals, scatter and leaf cards, sprites, impostors                                 |
| Sampled with | `sampleArrayLayer`, or a material input `{ "textureArray", "layer" }`             | `sampleAtlasCell`, remapped UVs, or a material input `{ "atlas", "slot", "cell" }` |

Group an array's layers by size: every layer takes the array's `size`, so a 256² image in a 1024² array takes 16 times its memory (the run warns when it upscales). Images of mixed sizes that don't tile belong in an atlas.

Textures that already share a size, a mip count and a codec can also be built into an array at runtime (`buildTextureArray`), with no JSON and no encode: the Hub's [asset optimization page](../../hub/pages/features/asset-optimization/guide.md) has both kinds' runtime side.

### A texture array

```jsonc
// src/app/textures/groundLayers.textureArray.json
{
  "$schema": "../../../.schemas/textureArray.schema.json",
  "id": "groundLayers",
  "layers": ["grass", "dirt", "./source/rock.png"],
  "size": [1024, 1024],
  "texOpts": { "colorSpace": "srgb", "wrapS": 1000, "wrapT": 1000 },
  "optimize": { "slot": "baseColor" },
}
```

- **`layers`**, in layer order: a texture asset's id (its source file or `pack`, never its output or its `optimize`) or a source image. A layer's name is its texture id, or a file's name without its extension; two layers can't share one.
- **`size`** defaults to the layers' common size (they must agree). It's then fit to the slot's `maxSize` and to multiples of 4 like a texture's. A layer with alpha makes the whole array RGBA.
- **`optimize`** is the array's: one codec for every layer. `texOpts` is its one sampler.
- Output: `aek-assets/<json path>.array.<hash>.ktx2`, one file for every layer.

### An atlas

```jsonc
// src/app/textures/decals.textureAtlas.json
{
  "$schema": "../../../.schemas/textureAtlas.schema.json",
  "id": "decals",
  "size": [1024, 1024],
  "padding": 16,
  "slots": {
    "albedo": { "texOpts": { "colorSpace": "srgb" }, "optimize": { "slot": "baseColor" } },
    "normal": { "fill": [0.5, 0.5, 1], "optimize": { "slot": "normal" } },
  },
  "cells": [
    {
      "id": "tyreTracks",
      "rect": [0, 0, 512, 256],
      "sources": { "albedo": "./source/tyre.png", "normal": "./source/tyreNormal.png" },
    },
    { "id": "crack", "size": [128, 128], "sources": { "albedo": "crackAlbedo" } },
  ],
}
```

- **Cells:** a `rect` (x, y, width, height in the layout's px, top-left origin, the padding included) places a cell; the rest are packed, tallest first, at their `size` (by default their first source's). A source is a texture asset's id or an image. A cell that doesn't fit fails the run, naming it. `data` is passed through to the cell table (a decal's physical size).
- **Slots:** each is a texture of its own, `<atlas>.<slot>` (`decals.albedo`), with its own `texOpts` and `optimize`. A cell without a source in a slot gets the slot's `fill` (RGB(A), linear 0..1, by default transparent black; a normal map wants `[0.5, 0.5, 1]`).
- **`padding`** (default 8 px) extends each cell's edge pixels outwards. The pipeline builds the mip levels itself with an exact 2 × 2 box and stops at the last level that keeps the cells apart: `2^level ≤ padding`, so 16 px keeps levels 0-4. A level's 4 × 4 compression blocks must not hold two cells either, so packed cells go on a grid of `4 · 2^⌊log2 padding⌋` px (64 px at padding 16). A `rect` off that grid shortens the chain, with a warning naming it and the alignment it needs.
- **The grid costs space:** a packed cell's padded size is rounded up to it, so a 64² cell with 16 px of padding takes 128². An atlas of many small cells can lower its padding (fewer levels) or place its cells with `rect`.
- **`mipChain: "FULL"`** builds every level down to 1 × 1, letting the cells mix past the protected ones: only for cells that look alike, as an impostor's views (see [Impostor atlases](#impostor-atlases)).
- Output: `aek-assets/<json path>.atlas.<slot>.<hash>.ktx2`, one file per slot. An edit to one slot's sources rebuilds only that slot, unless it moves the layout.

### Codecs

- **KTX2 only.** An array or an atlas slot is always encoded: a `codec: "none"` file can't hold an array's layers or an atlas's short mip chain. A slot that resolves to `none` (`data` does) fails the gather; give it a codec, as `"optimize": { "slot": "data", "textures": { "data": { "codec": "uastc" } } }`.
- **One codec per map type.** An array's layers share its codec. Every slot of an atlas has its own, so the albedo can be UASTC λ 2 and a mask UASTC with RDO off. For arrays built at runtime, encode every member with the same codec: UASTC and ETC1S transcode to different GPU formats on some devices, and `buildTextureArray` throws on a mix.
- **Never passed through.** With optimization off for the asset or the project, an array or a slot has no output, and nothing to fall back to (a texture would load its source). `yarn build` fails on one a shipped scene uses, even with `AEK_ASSETS_ALLOW_UNOPTIMIZED=true`. The cache and the lock work as for textures, so a clone with committed outputs needs no `ktx`.
- **`maxSize`** resizes an array. On an atlas slot it drops top mip levels instead (exact halving keeps the cells on their grid), and warns when that leaves fewer levels than the layout protects.

### Sizes and budgets

- **GPU memory:** an array is its layers' sum, at 1 B/px with mips for UASTC: a 1024² layer is 1.40 MB, so an eight-layer ground array is 11.2 MB in one binding. An atlas slot is its layout at the codec's rate, counting only the levels it stores: a 512² slot with 5 levels is 349 KB.
- **Budgets:** the per-texture ceiling (see [Budgets](#budgets)) counts every layer of an array, and an atlas slot against the full chain at its profile's `maxSize`. Each slot is checked on its own. A large array gets its own `budget` in its JSON, like any asset that needs more.
- **`yarn assets --only`** takes an array's id, an atlas's id (every slot) or a slot's id (`decals.albedo`). The run lists a slot with its cell count, and its warnings (an upscaled or stretched layer or cell, dropped levels) are kept with the cached output.

### At runtime

A scene lists an array by its id in its `textures`, and an atlas by its id (every slot) or a slot's id. A material JSON that names a layer or a cell needs neither: the gather adds the array or the slot it names. The gather also fails on a layer, slot or cell the asset doesn't have:

```text
Scene "myScene": the material "groundMat"'s input "dirt": the texture array "groundLayers" has no layer "sand" (layers: grass, dirt, rock).
```

## Alpha-cut textures

A mip level averages alpha, so a material with `alphaTest` loses thin features with distance: a leaf card's edge or a trunk falls below the cut and breaks up. `alphaCoverage` fixes that at build time. Set it to the material's `alphaTest`, and each mip level's alpha is scaled so the same share of it passes the cut as at level 0:

```jsonc
// src/app/textures/leafCard.texture.json
{
  "$schema": "../../../.schemas/texture.schema.json",
  "id": "leafCard",
  "fileName": "./source/leafCard.png",
  "texOpts": { "colorSpace": "srgb" },
  "optimize": { "slot": "baseColor", "alphaCoverage": 0.5 },
}
```

An atlas slot takes it the same way:

```json
"albedo": {
  "image": "./tree.albedo.png",
  "optimize": { "slot": "baseColor", "alphaCoverage": 0.5 }
}
```

- **Where:** a `*.texture.json`'s `optimize` (a file or a `pack`) and an atlas slot's `optimize`. It belongs to the asset, so profiles and rules don't take it. Texture arrays don't either.
- **Only for coverage alpha:** an albedo cut by `alphaTest`. A `normal` or `data` slot, or `normalMode`, is refused: their alpha is data. Without an alpha channel or mipmaps, or with `codec: "none"` (a PNG, whose mips the GPU makes), it does nothing (with a warning).
- **The mips are the pipeline's:** a texture with `alphaCoverage` gets its levels from the pipeline's 2 × 2 box filter (area-filtered past an odd size) instead of `ktx`'s default (lanczos4), colour included. The target is the source's coverage before `maxSize`, so a resized level 0 is scaled too.
- **Per cell:** an atlas keeps each cell's own coverage on the levels its padding keeps apart, and the whole image's on a full chain's levels past them.
- **What it can't fix:** a level only a few texels across moves in coarse steps. Below that, UASTC's alpha error near the cut (up to about 18/255 on small levels) can still move the edge by a few percent.

## Impostor atlases

An impostor (a far LOD level drawn with a few textured quads) bakes its atlases at load, or is exported once and loaded from the repo. You don't write these files by hand: the LOD debug tab's Impostors folder writes them while `yarn dev` runs (or downloads them, with the paths to put them at). An export is four files, in `src/app/impostors/` by default (`AppConfig.lod.impostorExportDir`):

```text
rock.impostor.json        what the material needs: kind, layout, shading, alpha test, fingerprint
rock.textureAtlas.json    the atlas: one image slot per atlas, one cell per frame
rock.albedo.png           the baked albedo, alpha cut, transparent texels dilated
rock.normalDepth.png      object-space normal + depth (octahedral; cross-quads: rock.normal.png)
```

The pipeline encodes the atlas's slots like any texture, into `src/public/aek-assets/`. A scene loads the impostor by listing it, `"impostors": ["rock"]` in its `*.scene.json`, and code calls the generator with the same `id` as before. Re-export after changing the source mesh: a debug build warns when the export's fingerprint no longer matches it.

The atlas JSON uses two texture atlas keys that exist for exports like this:

- **`slots.<name>.image`**: a ready-made image of the whole layout (the atlas's `size`), relative to the JSON. The slot isn't composed from its cells (no resize, no edge extension, no fill), so every cell needs a `rect` and has no `sources`. The image's size is checked by the gather and again by the encode.
- **`mipChain: "FULL"`**: every mip level down to 1 × 1 (an exact 2 × 2 box, area-filtered past an odd size). The default, `"PROTECTED"`, stops the chain at the last level the padding keeps apart, so cells never mix. An impostor's neighbouring cells are neighbouring views of the same object, so mixing them is harmless, and a short chain would shimmer at distance.

The codecs per slot, as an export writes them:

| Slot                       | Contents                                                | Settings                                                                                             |
| -------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `albedo`                   | sRGB colour, alpha cut                                  | `slot: "baseColor"` (UASTC λ 2), `alphaCoverage` set to the impostor's alpha test (see above)        |
| `normalDepth` (octahedral) | Object-space normal in RGB, depth in alpha, linear      | `slot: "data"` with `{ "codec": "uastc", "rdo": 0 }`: depth error moves the parallax and the shadows |
| `normal` (cross-quads)     | Normal in the plane's frame (as the bake camera saw it) | `slot: "normal"` (resized as unit vectors)                                                           |

A 12 × 12 octahedral atlas (864²) is about 1 MB of GPU memory per slot as UASTC, against about 4 MB baked at load (RGBA8 with mips).

## Budgets

A build fails when a shipped asset goes over its budget, so a texture that grew to 4K or slipped into `none` doesn't reach production unnoticed.

- **`budget: { vramMB, downloadMB }`**, on any settings level (defaults, a profile, a rule, the asset's own `optimize`). It's checked against the whole asset: its textures (KTX2 at 1 B/px, the most any device uses) plus a GLB's geometry. `null` clears a limit an earlier level set. MB are 10⁶ bytes.
- **A per-texture ceiling, with no key:** every encoded texture must fit its slot's `maxSize`² at its codec's rate, plus mips, as set by the levels without the asset's own JSON. For example, 1.40 MB for a 1K UASTC texture, 5.59 MB for a 1K `none` one. So raising `maxSize` or switching to `none` in an asset's own JSON fails the build.
- **To allow a bigger asset**, give it its own `budget` in its JSON. That replaces the ceiling, and it's an explicit line a reviewer sees.
- Where it shows: `yarn build` fails for assets that a shipped scene uses (debug-only scenes don't count), `yarn assets` lists them and exits 1, and `yarn gatherAppData` and the dev server only warn.
- Passed-through assets aren't checked.
- The whole scene's GPU memory is checked at runtime instead, by the profiler's GPU memory tab, since a build can't see what code loads.

## Opting out

On by default, at three levels:

1. **The whole project**, in `src/CONFIG.ts` (build time only; the runtime never reads it):

   ```ts
   assets: {
     optimization: {
       enabled: true, // master switch
       textures: true, // KTX2 encoding
       meshes: true, // meshopt / Draco, quantize, simplify
     },
   },
   ```

   Off means no encoding and no `ktx`. Each asset is **passed through**: a relative source is copied into `aek-assets/` and a `src/public` source keeps its own URL, so loading works the same either way. `AEK_ASSETS_OPTIMIZE=false` turns `enabled` off for one run.

2. **One asset:** `"optimize": false` in its JSON, or `{ "glob": "…", "optimize": false }` as a rule. A GLB can keep one side as it is: `"optimize": { "textures": false }` or `{ "mesh": false }`.

3. **One page load (dev / test builds):** the Assets debug tab's "Asset loading" folder has a "Load source files (boot)" checkbox. After a reload, assets load their source files instead of the outputs, for an A/B comparison. Packed textures have no source and stay optimized. A production build ignores it.

## Codec cheat sheet

**Textures**

| Codec   | VRAM                                                         | Download                        | Use for                                                                           | Avoid for                                 |
| ------- | ------------------------------------------------------------ | ------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------- |
| `uastc` | 1 B/px everywhere (BC7 on desktop, ASTC 4×4 on mobile)       | About the source's (RDO + Zstd) | Everything: the default                                                           | —                                         |
| `etc1s` | 1 B/px on desktop; 0.5 B/px on mobile for maps without alpha | 2.5–4× smaller than UASTC       | Colour maps of distant or background assets (`compact`)                           | Normal maps, ORM, terrain, detailed props |
| `none`  | 4 B/px (RGBA8)                                               | The source's                    | Data that must stay exact: LUTs, splat maps, masks, anything read back on the CPU | Large colour textures                     |

UASTC keys: `level` (0–4, encode effort, default 2), `rdo` (λ: 0 off, higher is smaller and blurrier; λ 4 is visibly softer) and `zstd` (0–22). ETC1S: `quality` (1–255). All codecs: `maxSize` (`null` keeps the source size) and `mipmaps`. Block-compressed sizes are rounded to multiples of 4, with a warning when that changes the aspect ratio.

`normalMode` (two-channel normals) is in the schema but in no profile: the material has to unpack it, and the engine has no flag for that yet.

**Geometry**

| `mesh.codec` | Effect                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------ |
| `meshopt`    | The default. Quantized: smaller download and smaller vertex buffers. `quantize: false`: lossless |
| `draco`      | Smaller download only, slower to decode, always quantized                                        |
| `none`       | No compression (`quantize: true` still quantizes)                                                |

`simplify` (0–1, a target triangle ratio) is off by default, and always off for collider sources.

## Builds and CI

- **`yarn assets`** runs the whole pipeline and is the only command that deletes stale outputs and lock entries, and only after a run that has an output for every asset: an asset that failed or got none for want of `ktx`, a missing source, or an asset JSON left out (not JSON, failing its schema, a source that doesn't resolve) keeps every output and lock entry, and the run lists why. It leaves alone what another process is writing (a running process's temp file, an output newer than the run), and its prune and lock write hold `.cache/asset-pipeline/run.lock`, which the dev server's lock write waits on. The dev server and `yarn gatherAppData` never delete anything. **Run it before you commit asset changes.** `yarn assets --only <id|glob>` builds only the matching assets (by id, or by JSON or source path).
- **`yarn build`** runs the cached pipeline and fails when a shipped scene uses an asset with no output (no `ktx`, or a failed encode) or over its budget. The error names the asset, its scenes and the fix. `dist/aek-assets/` gets only the outputs the build loads.
- **`AEK_ASSETS_ALLOW_UNOPTIMIZED=true yarn build`** ships the assets that need `ktx` unoptimized instead of failing (a GLB still gets its geometry compressed). A broken asset still fails.
- **CI:** with the outputs and the lock committed, a build needs no `ktx`. An app that doesn't commit its outputs can run `yarn setupAssetTools` in CI and cache `.cache/asset-pipeline/` between runs.

## Troubleshooting

- **"N assets need ktx and got no output":** run `yarn setupAssetTools`, or put a `ktx` ≥ 4.4.0 on your `PATH`, or set `AEK_KTX`. The line before it says why the lookup failed (eg. a `ktx` 4.3 on `PATH` that was skipped). After a failed download, the dev server waits 5 minutes before trying again; `yarn setupAssetTools --force` retries now.
- **An output changed after a re-encode on another machine:** `ktx` encodes are byte-reproducible per platform, not across platforms (macOS arm64 and Linux x64 differ by a few bytes). The lock decides, so this only happens when an asset is actually re-encoded. Commit the new output and lock.
- **What did this page load actually load?** The Assets debug tab's info windows show the loaded file and what it is (pipeline output, pass-through, source), plus an "Asset pipeline" section with the codec and the download and VRAM figures, before and after. The profiler's GPU memory tab counts KTX2 textures at their real size.
- **Run stats:** every run writes `.cache/asset-pipeline/last-run.json` (totals, cache hit rate, slowest assets, budget violations). Deleting `.cache/asset-pipeline/` is always safe.
