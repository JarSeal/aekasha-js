# Vertex-colour splat

Up to five texture set layers blended by the mesh's vertex colour: each colour channel is one layer's weight, the base layer takes what the channels leave, and the height blend makes the borders follow the surfaces' relief instead of the triangles. No texture is fetched for the weights, so it's the cheapest way to paint a terrain.

Everything on [Single-layer terrain](terrain-single-layer.md) applies to each layer here (the routes, a layer's settings, anti-tiling, macro, the tiers, the debug views); this page adds the blend.

## What it is

```text
 COLOR_0 (per vertex, interpolated)          RGB_AO: R G B → layers 1-3, A → vertex AO
        │                                    RGBA:   R G B A → layers 1-4
        ▼
 raw weights w1..wn, w0 = max(0, 1 − Σ) ──► height blend (each layer's height × contrast + offset)
                                                     │
 every layer sampled ──► albedo, normal, roughness, AO, height ──► blended by the final weights
                                                     │
                     macro, distance fade ──► one view-space normal, aoNode = texture AO × vertex AO
```

- **The weights** are the mesh's `COLOR_0` attribute (glTF's vertex colour, linear), interpolated across each triangle. Layer 0 is the base: where the colour is black, it's all layer 0.
- **The height blend** (Mishkinis, the default `blend.mode: 'HEIGHT'`) turns a soft painted gradient into a crisp border that follows the surfaces: across a pebbles-to-sand transition the pebbles' tops stay pebbles while the sand fills between them. `LINEAR` mixes by the weights alone, a smear.
- **Border resolution is the mesh's.** A weight can't change faster than from one vertex to the next, so a border is about one vertex spacing wide (25 cm on a 96-segment 24 m block). The height blend sharpens it far below that, but a painted shape can't be narrower than the mesh can carry.
- **`RGB_AO`** gives up a layer for a baked AO in the alpha: large-scale occlusion (hollows, the foot of a slope or a wall) at no cost, applied to indirect light only.

## Best for

|                      | Good fit                                                                                                                     | Poor fit                                                                                                                               |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Art style            | Any; painterly and stylized looks need only the linear blend                                                                 | –                                                                                                                                      |
| Game type and camera | Third person, top-down and RTS on Blender-authored blocks; any camera on generated terrain (rules baked into vertex colours) | Sharp painted paths, roads and decals on a coarse mesh: the shape is limited to the vertex spacing ([splat map](terrain-splat-map.md)) |
| World size           | Any: the weights travel with the mesh, no per-block texture; large worlds with a block per cell                              | –                                                                                                                                      |

## Performance

- **Fetches per pixel** ([the formula](README.md#the-performance-formula)): `P × L × A + M`, no splat fetch. `LITE`, 5 layers, no anti-tiling: 2·5 = **10**; with `DUAL_SCALE` and the macro 2·5·2 + 1 = **21**. Every layer is sampled on every pixel unless [sparse sampling](terrain-splat-map.md#sparse-sampling) keeps the top few.
- **ALU:** the height blend is a few operations per layer, measured as free (below). The vertex AO is one multiply.
- **Measured GPU time** (p305 Phase 3, 2026-11-16: Windows Chrome 157 on an AMD RDNA 3 GPU, WebGPU, 1280 × 800, a 24 m block filling the frame from 17 m up, the median of 90 frames; empty frame 0.14 ms): 5 layers `RGBA` 0.24 ms, `LINEAR` and `HEIGHT` alike; 4 layers `RGB_AO` with the vertex AO 0.22 ms. The tiers on the 5-layer block (Phase 6, the same machine; the block's own fields 0.23 ms): `LOW` 0.20, `MEDIUM` 0.31, `HIGH` 0.37, `ULTRA` 0.82. WebGL2 renders within 0.6 / 255 of WebGPU at the same cost.

  Measured in the gallery's Splatting row ([how](README.md#how-the-figures-are-measured): RDNA 3, WebGPU, 1920 × 1080; the block's own GPU ms, the frame less the frame without it), 24 m blocks; own fields, `LOW`, `MEDIUM`, `HIGH`, `ULTRA`:

  | ms                        | Own  | `LOW` | `MEDIUM` | `HIGH` | `ULTRA` |
  | ------------------------- | ---- | ----- | -------- | ------ | ------- |
  | 5 layers `RGBA`, `LINEAR` | 0.23 | 0.17  | 0.36     | 0.48   | 0.94    |
  | 5 layers `RGBA`, `HEIGHT` | 0.23 | 0.17  | 0.32     | 0.40   | 0.95    |
  | 4 layers `RGB_AO` + AO    | 0.19 | 0.18  | 0.32     | 0.40   | 0.75    |
  | The same, third person    | –    | –     | 0.56     | 0.72   | –       |

  The third person row is the [matrix](README.md#which-technique-for-my-game)'s (the camera 6 m behind and 2.5 m over a player, 60°): the third person's recommendation at `MEDIUM` and `HIGH`; a stylized low-end game's 5-layer block at `LOW` from there is 0.27 ms.

- **VRAM:** the layers' sets (2.67 MB each for 1K `LITE`: 13.3 MB for five) and the mesh's colour attribute (4 bytes a vertex as unsigned bytes, 16 as floats).
- **Bindings:** `P` per layer, plus the macro: 5 `LITE` layers bind 10, the default budget ([Storage](terrain-splat-map.md#storage-and-the-binding-budget)). More and the code route's `AUTO` storage uses a set array.
- **Draw calls:** one per block per material.
- **Quality tier:** any; the preset's `LOW` keeps 2 layers a pixel (with a set array), `MEDIUM` and `HIGH` 3.

## Maps

| Map                      | Required | Packing                              | Colour space                 | Codec                  | Size           |
| ------------------------ | -------- | ------------------------------------ | ---------------------------- | ---------------------- | -------------- |
| Each layer's texture set | Yes, 2–5 | One packing for all (`LITE` default) | Albedo sRGB, the rest linear | UASTC (`terrainLayer`) | 1K             |
| The vertex colour        | Yes      | `COLOR_0`, RGBA                      | Linear (glTF)                | The mesh's (meshopt)   | One per vertex |
| Macro noise              | No       | `macroNoise`                         | Linear                       | UASTC                  | 512²           |

Height blending needs the layers' heights: every packing has one (`LITE` in `normalHeight`'s B, `FULL` and `MINIMAL` in the albedo's A).

## Blender, step by step

The block workflow (set-up, the grid, shaping, validating, exporting) is [Terrain blocks from Blender](terrain-blocks-blender.md); start from `terrain_vertexColorSplat.blend` (`src/toolkit/terrain/blender/`): hills painted in four layers (rocks01 on the slopes, mud01 in the hollows, snow01 on the peaks over grass01), the AO baked. Painting:

1. **The preview** (sidebar → Preview Material): the splat layout (`RGB + AO`: the base and layers 1-3; `RGBA`: 1-4), each layer's texture set in the material's order (the base is `layer0`, R `layer1`, …), then _Update Preview_. It blends with the engine's height blend, so a border looks roughly as it will.
2. **Vertex Paint mode** on the block, the `Splat` attribute active (Object Data → Color Attributes; Add makes it so).
3. **One channel a layer, with pure colours:** the brush colour (1, 0, 0) paints layer 1, (0, 1, 0) layer 2, (0, 0, 1) layer 3, black back to the base. Strength 1 and the **Mix** blend: mixing towards a pure colour lowers the other channels as it raises one, so the weights keep summing to 1 at most. Add or Lighten blends push the sum over 1. A soft brush's falloff paints the in-between weights the height blend turns into a natural border.
4. **Layer 4 (`RGBA`)** is the alpha: the brush's _Add Alpha_ blend paints it, _Erase Alpha_ removes it. The block's and the preview's layout must both be `RGBA`, and there's no AO then.
5. **Over-painted?** _Normalize Splat_ scales every vertex whose weights sum over 1 back to 1, in the stored bytes; Validate warns where they're over.
6. **Resolution:** a weight changes from one vertex to the next (0.5 m on a 64 m / 129 block). A road or a sharp path wants a [splat map](terrain-splat-map.md), or a denser block.
7. **_Bake AO → Splat Alpha_ last** (`RGB_AO`): it rewrites A and keeps every painted RGB byte; bake again after reshaping. Neighbouring blocks in the file occlude too.

What the material reads: the first colour attribute, as glTF stores it (linear 0..1). Black is the base layer; a channel at 1 is its layer alone. Channels that sum over 1 are normalized, so a vertex painted half red and fully green is one third layer 1 and two thirds layer 2. A colour picked in the picker's sRGB is stored linear: half strength there is about 0.21 in the GLB (0 and 1 are exact).

## Export

_Export Block_ ([the locked settings](terrain-blocks-blender.md#export)): `Splat` as `COLOR_0` (the active colour; _Export All Vertex Colors_ off, so no `COLOR_1`), linear, 16 bits a channel in the GLB. The asset pipeline keeps it (the `terrainBlock` profile's meshopt without quantization).

## Import into Ækasha

The layers' sets are the inputs `layer0` … `layer4`; the blend is the define's `blend`. A mesh variant of the toolkit's `terrain` (the routes: [Single-layer terrain](terrain-single-layer.md#import-into-ækasha)):

```json
{
  "mat": "terrain",
  "matOverrides": {
    "inputs": {
      "layer0": { "textureSet": "grass01" },
      "layer1": { "textureSet": "rocks01" },
      "layer2": { "textureSet": "sand01" },
      "layer3": { "textureSet": "mud01" },
      "layer4": { "textureSet": "snow01" }
    },
    "staticDefines": {
      "terrain": {
        "layers": [{}, {}, {}, { "heightOffset": -0.1 }, {}],
        "blend": { "source": "VERTEX_COLOR", "vertexColor": { "layout": "RGBA" } }
      }
    }
  }
}
```

From code, with the vertex AO (`RGB_AO`, so 4 layers):

```ts
import { createTerrainMaterial, getTerrainQualityPreset } from 'aekasha/toolkit/terrain';

const valley = createTerrainMaterial({
  id: 'valley',
  layers: [{ set: 'grass01' }, { set: 'rocks01' }, { set: 'sand01' }, { set: 'mud01' }],
  blend: { source: 'VERTEX_COLOR', heightBlendDepth: 0.15 },
  ao: { vertex: true },
  antiTiling: { mode: 'DUAL_SCALE' },
  quality: getTerrainQualityPreset(),
});
```

The code route picks the storage (`storage: 'AUTO'`): separate textures while they fit the budget, else a set array, which must be built first (a scene's `textureSetArrays` entry with the same sets and packing, or `await buildTextureSetArray({ sets, packing })` from `aekasha/texturesets`). The preset's sparse sampling makes `AUTO` choose the array too. In the JSON route the array is the input `layers`, `{ "textureSetArray": ["grass01", …], "packing": "LITE" }`, in place of `layer0` … (the gather builds it), on a material JSON of its own rather than a variant of `terrain`: [Storage](terrain-splat-map.md#storage-and-the-binding-budget) and the [splat map's import](terrain-splat-map.md#import-into-ækasha).

**As a terrain block** (the stub Export Block wrote): the material is the world's, so blocks of one biome share its shader; a block's colours travel in its GLB, so it needs no inputs of its own:

```json
{
  "geometry": { "importedAsset": "valleyA", "node": "valleyA" },
  "material": "valley",
  "grid": { "x": 0, "z": 0, "size": 64, "resolution": 129 },
  "collider": { "type": "HEIGHTFIELD" }
}
```

A mesh without a colour attribute reads white: with `RGBA` that's layers 1–4 equally and no base.

## Set-up and parameters

`blend` for this technique:

| Field              | What it is                                                                                                                                    | Default  |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `source`           | `VERTEX_COLOR` ([rules on top](terrain-procedural-rules.md): `VERTEX_COLOR_AND_RULES`)                                                        | `SINGLE` |
| `vertexColor`      | `{ layout }`: `RGB_AO` (R, G, B weigh layers 1–3, A is a baked AO; 2–4 layers) or `RGBA` (layers 1–4; 2–5 layers)                             | `RGB_AO` |
| `mode`             | `HEIGHT`: by the layers' heights; `LINEAR`: by the weights alone                                                                              | `HEIGHT` |
| `heightBlendDepth` | The height blend's transition, 0.02–0.5 of the heights' range: smaller is a sharper border. `HEIGHT` only. Uniform `terrain_heightBlendDepth` | 0.2      |

Per layer, for the height blend (ignored with `LINEAR`, so a tier can switch to it):

| Field            | What it is                                                                                           | Default | Uniform                       |
| ---------------- | ---------------------------------------------------------------------------------------------------- | ------- | ----------------------------- |
| `heightContrast` | × the set's `heightContrast`: the height's contrast about its middle; over 1 sharper borders         | 1       | `terrain_l<i>_heightContrast` |
| `heightOffset`   | Added to the height, −1..1: over 0 the layer rises through its neighbours' borders, under 0 it sinks | 0       | `terrain_l<i>_heightOffset`   |

The height a layer blends with is `(h − 0.5) × contrast + 0.5 + offset`, multiplied by its weight (a layer nobody painted never rises through a border on its height alone). Where the top layer's weight is near zero the blend falls back to the linear weights, so unpainted ground never shows a stray layer.

`ao` for the vertex AO:

| Field                  | What it is                                                                                                                                                           | Default |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `vertex`               | The colour's A as AO into `aoNode` (indirect light). `RGB_AO` only                                                                                                   | false   |
| `bakedAlbedoInfluence` | The vertex AO's strength on a `LITE` or `MINIMAL` material, 0..1, whose albedo has its own AO baked in; `FULL` applies it whole. Uniform `terrain_aoVertexInfluence` | 0.5     |

## Variations

- **`RGB_AO` vs `RGBA`:** `RGBA` paints one more layer (5 against 4); `RGB_AO` keeps A for a baked AO. Choose `RGB_AO` when the blocks have large-scale relief (valleys, cliffs' feet, walls) and four surfaces are enough, `RGBA` for flat painted ground with variety.
- **Vertex AO vs texture AO:** the vertex AO is large-scale (metres: a hollow, the shade under an overhang), baked once into the mesh (Blender's AO bake into A, p306), free per pixel, and correct where it lands: `aoNode` darkens indirect light only, so direct sun still lights a hollow. Texture AO is small-scale (centimetres: a set's crevices), from a `FULL` set's map into the same `aoNode` (`ao.textureInfluence`), or baked into a `LITE` or `MINIMAL` set's albedo. They multiply. On `LITE` the albedo's AO already darkens everything, so the vertex AO is halved by default (`bakedAlbedoInfluence`).
- **`HEIGHT` vs `LINEAR`:** the height blend costs nothing measurable and is the reason a painted border reads as real; `LINEAR` for a painterly or stylized look, or for surfaces whose heights don't mean relief (a flat colour's).
- **Tuning a layer's height:** `heightOffset` over 0 makes a layer win the borders (rocks poking through sand, snow capping), under 0 lose them (mud settling into hollows). `heightContrast` over 1 for crisper borders on a layer whose height map is soft.
- **Rules on top** (`VERTEX_COLOR_AND_RULES`): paint where it matters, slope and height rules everywhere else ([Procedural rules](terrain-procedural-rules.md)).
- **Rules baked into the colours:** a generated mesh can get its vertex colours from the same rules evaluated on the CPU (p306's `generateTerrain` v2), trading the rules' per-pixel ALU for the attribute. The [rules page](terrain-procedural-rules.md#performance) measures both.
- **More layers** than five: a [splat map](terrain-splat-map.md) (9 painted) or rules (16).

## Pitfalls and checklist

- [ ] The mesh is dense enough for the shapes you paint: a border is about one vertex spacing.
- [ ] Black is the base layer: paint the most common surface as layer 0.
- [ ] All layers in one packing; the sets of a set array the same size and codec.
- [ ] `ao.vertex` with `RGB_AO` only, and A actually holds the AO (else it darkens the indirect light at random).
- [ ] The `WEIGHTS` debug view shows each layer where you painted it (layer 0 white, 1 red, 2 green, 3 blue, 4 yellow).
- **Blotchy borders that follow the triangles:** `LINEAR` blending on a coarse mesh. Use `HEIGHT`, or more vertices.
- **A layer that shows through everywhere at a low weight:** its `heightOffset` is too high; lower it, or lower `heightBlendDepth`.
- **Colours off after export:** the material reads glTF's linear values. A colour attribute painted as sRGB bytes is converted by the exporter; one written by hand must be linear.
- **"blend.source VERTEX_COLOR (RGBA) takes 2 to 5 layers":** the layer count doesn't suit the layout (`RGB_AO` 2–4, `RGBA` 2–5).
- **"over its budget":** 5 `LITE` layers plus a macro bind 11. Use a set array ([Storage](terrain-splat-map.md#storage-and-the-binding-budget)) or the code route's `AUTO`.

## Template file and example asset ids

- **Blender template:** `src/toolkit/terrain/blender/terrain_vertexColorSplat.blend` (its README text block mirrors this page's Blender steps; the block workflow: [Terrain blocks from Blender](terrain-blocks-blender.md)). The orientation block (`src/app/terrainBlocks/terrainBlockTestBlender/`, `terrainBlockTest`'s and the gallery's) is an add-on export drawn through its `COLOR_0`.
- **The material:** `terrain` (a mesh variant), or `createTerrainMaterial` with `blend.source: 'VERTEX_COLOR'`.
- **The gallery's Splatting row** (`terrainGallery`, `?isDebug=true&startScene=terrainGallery`; `src/app/scenes/terrainGallery/splattingRow.ts`): 24 m generated blocks with one painted pattern, `LINEAR` left of `HEIGHT`: 5 layers `RGBA` (`grass01`, `rocks01`, `sand01`, `mud01`, `snow01`) and 4 layers `RGB_AO` with the vertex AO darker in the hollows. Its tab section has sliders for the height blend depth, `rocks01`'s `heightOffset` and the vertex AO's influence, and the Debug view select shows `WEIGHTS`.
- **Worked blocks:** `terrainShowcase`'s coast and wetlands (`src/app/scenes/terrainShowcase/blocks/showcaseCoast/`, `showcaseWetlands/`): `RGB_AO` vertex colours painted by `devTools/blender/buildShowcaseBlocks.py`, the AO baked.
