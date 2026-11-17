# Splat map

Up to nine texture set layers blended by one or two RGBA textures painted over a block: each channel is one layer's weight, the base layer takes what they leave. The borders are as sharp as the splat map's texels, whatever the mesh's density, so it's the technique for painted paths, roads and hero areas. This page also covers what any material of many layers needs: set arrays, the binding budget and sparse sampling.

Everything on [Single-layer terrain](terrain-single-layer.md) applies to each layer, and the height blend works as on [Vertex-colour splat](terrain-vertex-color-splat.md#set-up-and-parameters).

## What it is

```text
 mesh UV ──► splat0 (RGBA: layers 1-4) ─┐
         └─► splat1 (RGBA: layers 5-8) ─┴─► raw weights, w0 = max(0, 1 − Σ) ──► height blend
                                                                                    │
 the layers (one array per slot) ──► sparse: the top K by weight ──► sampled, blended by weight
                                                                                    │
                                              macro, distance fade ──► the surface's outputs
```

- **The splat maps** are linear data textures at the mesh's first UV set, 0..1 over the block, so each block has its own (a variant's input). One map weighs layers 1–4, two weigh 1–8; the count follows the painted layers.
- **Resolution-independent borders:** a 1K splat over a 64 m block is 6.25 cm a texel, filtered linearly, and the height blend sharpens the transitions far below that. The mesh can be as coarse as its shape allows.
- **Many layers** soon run out of texture bindings. A set array puts all the layers of a packing into one array texture per slot, and sparse sampling samples only the few that weigh most at each pixel, so a 9-layer terrain costs about what 3 layers do.

## Best for

|                      | Good fit                                                                                           | Poor fit                                                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Art style            | Photoreal and stylized PBR with hand-placed detail                                                 | –                                                                                                                  |
| Game type and camera | First-person hero areas, roads and paths, third person; RTS maps with painted features             | Huge procedural worlds: a splat per block is authoring and memory per block ([rules](terrain-procedural-rules.md)) |
| World size           | Levels and hero areas; a large world's painted blocks with rules elsewhere (`SPLAT_MAP_AND_RULES`) | Thousands of blocks each with two 1K maps: 2.8 MB a block adds up                                                  |

## Performance

- **Fetches per pixel** ([the formula](README.md#the-performance-formula)): `P × L × A + S + M`, `S` one per map. `LITE`, 5 layers, no anti-tiling, one map: 2·5 + 1 = **11**. 9 layers, `DUAL_SCALE`, two maps, the macro: dense 2·9·2 + 2 + 1 = **39**; with sparse sampling of the top 3, 2·3·2 + 3 = **15**.
- **ALU:** the height blend is free in practice; sparse sampling adds a sorting network of compare-exchanges (a few per layer) and a per-pixel array index.
- **Measured GPU time** (Windows Chrome 157 on an AMD RDNA 3 GPU, WebGPU, the median of 90 frames of the whole gallery frame):

  p305 Phase 3, 1280 × 800, a 24 m block filling the frame from 17 m up (empty 0.14 ms): 5 layers, one map, 0.24 ms (the same as the vertex colour: the map is one fetch); 9 layers, two maps, a set array, 0.36 ms. `LINEAR` and `HEIGHT` alike.

  Phase 6, the tiers (sparse sampling and anti-tiling, `getTerrainQualityPreset`); the 8-layer terrain is the gallery's splat map and rules combo ([Procedural rules](terrain-procedural-rules.md)), the budget's reference:

  | ms                                  | empty | own  | `LOW` | `MEDIUM` | `HIGH`   | `ULTRA` |
  | ----------------------------------- | ----- | ---- | ----- | -------- | -------- | ------- |
  | 1280 × 800, 9 layers, from 17 m     | 0.11  | 0.35 | 0.22  | 0.33     | 0.40     | 1.07    |
  | 1280 × 800, 8 layers, third person  | 0.09  | 0.92 | 0.42  | 0.86     | 1.04     | 1.77    |
  | 1920 × 1080, 8 layers, from above   | 0.15  | 0.76 | 0.55  | 1.12     | **1.38** | 2.36    |
  | 1920 × 1080, 8 layers, third person | 0.19  | 1.53 | 0.70  | 1.37     | **1.68** | 2.90    |

  "Own" is dense, no anti-tiling. Sparse sampling pays for the anti-tiling: `MEDIUM` (top 3, `DUAL_SCALE`) costs what the dense 8 layers without anti-tiling do, `LOW` (top 2, none) half of it; `HIGH` adds `HEX` on the dominant layer for 0.15–0.2 ms; `ULTRA` (top 4, `HEX` on all) is 1.7–2.6 × `HIGH`. The 8-layer `HIGH` terrain at 1080p stays under p305's 3 ms budget at 1.68 ms. WebGL2 is within about 0.1 ms. p310 measures every page with fixed camera presets.

- **VRAM:** the layers (2.67 MB per 1K `LITE` set: 24 MB for nine, alike in an array or separate; an array holds its layers once whatever binds it) and the splat maps, per block:

  | One splat map           | UASTC, RDO off | `codec: "none"` (PNG) |
  | ----------------------- | -------------- | --------------------- |
  | 1024² (6.25 cm on 64 m) | 1.40 MB        | 5.59 MB               |
  | 512² (12.5 cm on 64 m)  | 0.35 MB        | 1.40 MB               |

- **Bindings:** separate textures bind `P` per layer, an array `P` for all; plus the maps and the macro. 9 `LITE` layers with two maps and a macro: 21 separately (over any budget), 5 as an array.
- **Draw calls:** one per block per material. A block's own splat map is a variant input: it adds no shader.
- **Quality tier:** any; the tiers are sparse sampling's (`LOW` 2 layers a pixel, `MEDIUM` and `HIGH` 3, `ULTRA` 4).

## Maps

| Map                      | Required               | Packing                              | Colour space                 | Codec                                    | Size                      |
| ------------------------ | ---------------------- | ------------------------------------ | ---------------------------- | ---------------------------------------- | ------------------------- |
| Each layer's texture set | Yes, 2–9               | One packing for all (`LITE` default) | Albedo sRGB, the rest linear | UASTC (`terrainLayer`)                   | 1K, all alike in an array |
| `splat0`                 | Yes                    | RGBA: layers 1–4                     | Linear                       | `data` slot: UASTC with RDO off, or none | 512²–1K a block           |
| `splat1`                 | With 6+ painted layers | RGBA: layers 5–8                     | Linear                       | As `splat0`                              | As `splat0`               |
| Macro noise              | No                     | `macroNoise`                         | Linear                       | UASTC                                    | 512²                      |

## Blender, step by step

Painting the splat maps (texture paint on the block's UVs, a channel per layer, the remainder as the base) is [p306](../plans/p306_terrain-blocks-and-procedural-terrain-meshes.md)'s, on its page `terrain-blocks-blender.md`, with the template `terrain_splatMap.blend`.

What the material reads: the block's first UV set, 0..1 over the block, and each map's RGBA as weights 0..1. Unpainted (black) is the base layer; channels that sum over 1 are normalized.

## Export

p306's (`terrain-blocks-blender.md`): each map an 8-bit RGBA PNG, linear (no colour management), next to the block.

## Import into Ækasha

**A splat map** is a texture JSON with the `data` slot. The default profile leaves `data` uncompressed (a PNG, 4 bytes a texel), so give it UASTC with RDO off (RDO blurs the weights). `src/app/scenes/valley/valleyBlockA_splat0.texture.json`:

```json
{
  "$schema": "../../../../.schemas/texture.schema.json",
  "id": "valleyBlockA_splat0",
  "fileName": "./source/valleyBlockA_splat0.png",
  "optimize": {
    "slot": "data",
    "textures": { "data": { "codec": "uastc", "rdo": 0 } }
  },
  "texOpts": { "wrapS": "CLAMP_TO_EDGE", "wrapT": "CLAMP_TO_EDGE" }
}
```

**The material.** The sets as a set array (the input `layers`, which the gather builds), the maps as `splat0` and `splat1`. An array material needs a material JSON of its own ([the routes](terrain-single-layer.md#import-into-ækasha)), not a variant of the toolkit's `terrain`: a variant's inputs merge over the base's, so it would keep `terrain`'s `layer0`, and a layer with an input of its own is sampled beside the array (the way a procedural set's layer is), which leaves the array a layer short. Here 5 layers with sparse sampling, its TSL file the two lines `export const setup = setupTerrainMaterial`:

```json
{
  "$schema": "../../../../.schemas/material.schema.json",
  "id": "valleyGround",
  "tslFile": "scenes/valley/valleyGround.tsl.ts",
  "type": "STANDARDNODEMATERIAL",
  "staticDefines": {
    "terrain": {
      "layers": [{}, {}, {}, {}, {}],
      "blend": { "source": "SPLAT_MAP" },
      "antiTiling": { "mode": "DUAL_SCALE" },
      "sparse": { "maxLayers": 3 }
    }
  },
  "inputs": {
    "layers": {
      "textureSetArray": ["grass01", "rocks01", "sand01", "mud01", "snow01"],
      "packing": "LITE"
    },
    "splat0": { "texture": "valleyBlockA_splat0" }
  }
}
```

Each block is a mesh with `"mat": "valleyGround"` and `"matOverrides": { "inputs": { "splat0": { "texture": "valleyBlockB_splat0" } } }`: the same shader and array, its own map.

**From code:**

```ts
import { buildTextureSetArray } from 'aekasha/texturesets';
import { createTerrainMaterial, getTerrainQualityPreset } from 'aekasha/toolkit/terrain';

const sets = ['grass01', 'rocks01', 'sand01', 'mud01', 'snow01', 'cliffs01', 'ice01'];
// Only when the scene's textureSetArrays doesn't list these sets in this packing
await buildTextureSetArray({ sets, packing: 'LITE' });
const valley = createTerrainMaterial({
  id: 'valley',
  layers: sets.map((set) => ({ set })),
  blend: { source: 'SPLAT_MAP', heightBlendDepth: 0.15 },
  splatMaps: ['valleyBlockA_splat0', 'valleyBlockA_splat1'],
  macro: { texture: 'macroNoise', scale: 64 },
  quality: getTerrainQualityPreset(),
});
```

`splatMaps` are texture ids (the inputs `splat0`, `splat1`), one per four painted layers past the base: 7 layers take two. `storage: 'AUTO'` (the default) chose the array here (7 `LITE` layers bind 14 separately, and the preset's sparse sampling needs an array anyway).

## Set-up and parameters

`blend` for this technique:

| Field              | What it is                                                                                             | Default  |
| ------------------ | ------------------------------------------------------------------------------------------------------ | -------- |
| `source`           | `SPLAT_MAP` (2–9 layers; [rules on top](terrain-procedural-rules.md): `SPLAT_MAP_AND_RULES`, up to 16) | `SINGLE` |
| `mode`             | `HEIGHT` or `LINEAR`                                                                                   | `HEIGHT` |
| `heightBlendDepth` | 0.02–0.5, `HEIGHT` only ([the height blend](terrain-vertex-color-splat.md#set-up-and-parameters))      | 0.2      |

The code route's `splatMaps` (texture ids, as many as the painted layers need); the JSON route's inputs `splat0`, `splat1` (`{ "texture": id }`).

### Storage and the binding budget

A shader stage binds 16 sampled textures (WebGPU's default, which the engine requests; WebGL2's texture units, 16 on most GPUs), shared with three's lighting: shadow maps and the environment. A terrain material's own textures must fit `16 − reservedTextures` (default 6, so 10), or its build throws, listing what it binds and what would help.

| Storage    | Binds                                                               | How                                                                                                                                                              |
| ---------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SEPARATE` | `P` per layer                                                       | The inputs `layer0`, `layer1`, … (`{ textureSet }` each)                                                                                                         |
| `ARRAY`    | `P` for all layers (`LITE` 2, up to 16 layers)                      | The input `layers` (`{ textureSetArray: [ids], packing }`, layer `i` the material's layer `i`); a scene's `textureSetArrays` or `buildTextureSetArray` builds it |
| `AUTO`     | `SEPARATE` while it fits and nothing samples in slots, else `ARRAY` | The code route's `storage` (default); the JSON route says which by its inputs                                                                                    |

- **What counts:** the layers' slots, the splat maps, the macro texture (also the rules' noise), the colour map. A [live layer](procedural-textures.md#live-layers-in-a-terrain-material) binds none.
- **An array's layers** share their packing, size, mip count and codec (the build fails naming the slot otherwise), and are imported sets: a procedural set's layer keeps its own `layer<i>` input beside the array, the other layers taking the array's in order.
- **`reservedTextures`:** lower it when the scene's lighting binds fewer textures (fewer shadow-casting lights, no environment map), raise it when it binds more. WebGPU's real limit is read from the device.
- **A variant can't switch storage:** its inputs merge over the base's, so a `SEPARATE` base's `layer0` stays. An `ARRAY` material is its own base.

### Sparse sampling

`sparse: { maxLayers: 2 | 3 | 4 }` (material-wide, or a tier's): at each pixel only the layers that weigh most are sampled, sorted by weight, their weights renormalized; the height blend then runs among them.

- **Why:** most terrain pixels have one or two layers that matter. A 9-layer material sampled densely pays for all nine everywhere; top-3 pays for three.
- **Needs** `ARRAY` storage (each kept layer is read from the arrays at a per-pixel index), every layer's anti-tiling mode alike, and the projected layers' projection alike (planar layers can mix in). The material's build refuses otherwise, naming where the setting was given. No effect on a material of no more layers than it keeps.
- **The cost of the cut:** where a third layer crosses into the top K, its weight pops in. The height blend hides most of it; `maxLayers: 3` hides the rest. The `LAYER_COUNT` debug view shows where more layers weigh in than the slots keep (striped).
- **Each kept slot reads its layer's own uniforms**, so the material editor's `terrain_l<i>_*` still reach every layer, and a slot samples with the continuous coordinates' gradients, so there's no mip seam where its layer changes.

### HEX on the dominant layer

`antiTiling: { mode: 'HEX', apply: 'DOMINANT', farScale?, distance? }`: `HEX` on the layer weighing most at the pixel, `DUAL_SCALE` (with `farScale` and `distance`) on the other kept layers: 3 taps for one layer, 2 for each other, instead of 3 for all. It samples in slots too, so it needs `ARRAY`. The preset's `HIGH` tier.

## Variations

- **4 vs 8 painted layers:** one map weighs layers 1–4 (5 with the base), two weigh 1–8 (9). The second map costs a fetch and its memory per block; past 9 surfaces, add [rules](terrain-procedural-rules.md) (`SPLAT_MAP_AND_RULES`: up to 16 layers, `paintedLayers` saying how many the maps weigh).
- **Splat resolution:** 1K on a 64 m block is 6.25 cm a texel, enough for a footpath's edge; 512² (12.5 cm, a quarter of the memory) for third person and RTS. The height blend keeps the borders sharp either way.
- **The `data` codec:** UASTC with RDO off is 1.40 MB at 1K, a few / 255 off the PNG, which the height blend doesn't show. `codec: "none"` (the `data` slot's default) is exact and four times the memory: for maps that a script reads back, or very fine painted detail.
- **Sparse `maxLayers`:** 2 for `LOW` (half the cost, visible popping where three layers meet), 3 the default, 4 for `ULTRA` or a material with many overlapping layers.
- **`DOMINANT` `HEX`:** no repetition on the layer you see most, at little more than `DUAL_SCALE`'s cost.
- **A set array per biome:** one array, one shader, every block of the biome a variant with its own splat maps (p301 §7). A swappable array (`setTextureSetArrayLayer`) changes a layer's set at runtime at the cost of a CPU copy.

## Pitfalls and checklist

- [ ] Each block's splat maps cover its UVs 0..1, `CLAMP_TO_EDGE`, linear, `data` slot.
- [ ] The splat maps are UASTC with RDO off (or deliberately `none`); RDO blurs weights.
- [ ] The layers of an array share packing, size and codec; procedural sets keep their own input.
- [ ] Sparse sampling only with every layer's anti-tiling mode alike; a cliff layer's projection alike with the other projected layers.
- [ ] The budget: `LITE` binds 2 a layer separately. Over 4 layers with a splat map and a macro, use an array.
- [ ] `WEIGHTS` and `LAYER_COUNT` show what you painted, and few stripes.
- **`Missing input "splat1"`:** 6 or more painted layers need two maps.
- **"over its budget of 10":** the message lists every group. An array, fewer extras, or a lower `reservedTextures`.
- **"Sparse sampling and HEX's apply DOMINANT read each layer at a per-pixel index, which needs ARRAY storage":** a material of `layer<i>` inputs with sparse sampling or `DOMINANT` (its own or a tier's). Give it the `layers` input.
- **A white terrain:** the set array isn't built (warned): list it in the scene's `textureSetArrays`, or build it before creating the material.
- **Popping where layers meet:** `maxLayers: 2`; raise it to 3.

## Template file and example asset ids

- **Blender template:** `terrain_splatMap.blend`, p306.
- **The material:** `terrain`, or an app material of its own for an array; `createTerrainMaterial` with `blend.source: 'SPLAT_MAP'` and `splatMaps`.
- **The gallery's Splatting row** (`terrainGallery`, `?isDebug=true&startScene=terrainGallery`; `src/app/scenes/terrainGallery/splattingRow.ts`): 24 m generated blocks with one painted pattern, `LINEAR` left of `HEIGHT`: 5 layers with one 256² splat map (`AUTO`: an array) and 9 layers with two (`cliffs01`, `ice01`, `grass02` and `mud02` added). Its tab lists each block's storage; the Quality select shows the tiers, the Debug view select `WEIGHTS` and `LAYER_COUNT`. The 8-layer terrain of the measurement is the Rules row's third block.
- **Set arrays:** the scene's `textureSetArrays` (`src/app/scenes/terrainGallery/terrainGallery.scene.json`).
