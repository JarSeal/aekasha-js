# Single-layer terrain

One texture set tiled over the ground, its repetition broken up by anti-tiling and a macro variation. It's the simplest terrain material and the base of every other technique: a blended terrain is several of these layers mixed by weight, so everything on this page (the two routes, the layer's settings, the tiers, the debug views) applies to the other pages too.

The material is the toolkit's terrain material generator, `createTerrainMaterial` on `aekasha/toolkit/terrain` (and its JSON route, the material `terrain`). The Hub's [Terrain page](../../hub/pages/features/terrain/guide.md) has the API; this page is how to set up one layer, what it costs and what it suits.

## What it is

```text
 world (x, −z) or mesh UV ──► ÷ (physicalSize × tiling), turned by rotation ──► the layer's UV
                                                                                   │
 anti-tiling ─────────────── NONE: 1 tap │ DUAL_SCALE: 2 taps │ HEX: 3 taps ◄──────┘
                                                   │
 the set's packing ──────────► albedo, normal, roughness, height (AO: FULL's map, or in the albedo)
                                                   │
 macro (1 fetch at the world's XZ / scale) ──► brightness, hue, roughness
 distance ──────────────────────────────────► the detail normal fades to the mesh's far away
                                                   │
                                     colorNode, normalNode (view space), roughnessNode, aoNode
```

- **One material, built from a config.** Every technique is a build-time branch: a single-layer material without anti-tiling compiles to two texture samples and nothing else, and each feature you turn on adds only its own code. The numbers (tiling, tint, the anti-tiling's distances, the macro's strength) are uniforms, so they change live without a rebuild.
- **World tiling by default.** The layer's UV is the world's `(x, −z)` over the set's `physicalSize`, so the texture runs on across separate meshes without a seam, and a mesh needs no UVs. `uv: 'MESH_UV'` uses the mesh's UVs instead, in metres (walls, authored blocks).
- **The other techniques** are each a page of their own, and they combine in one material:

  | Page                                                                            | Adds                                                                     |
  | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
  | [Vertex-colour splat](terrain-vertex-color-splat.md)                            | Up to 5 layers painted as vertex colours, the height blend, vertex AO    |
  | [Splat map](terrain-splat-map.md)                                               | Up to 9 layers painted in splat textures; set arrays and sparse sampling |
  | [Procedural rules](terrain-procedural-rules.md)                                 | Layers by slope, height, facing and noise, with no painting              |
  | [Triplanar cliffs](terrain-triplanar-cliffs.md)                                 | Biplanar, triplanar and slope-gated projection for steep faces           |
  | [Colour map + detail](terrain-colormap-detail.md)                               | A block's unique colour map under tiled detail; the far surface          |
  | [Structure materials](structure-materials.md)                                   | Concrete and large structures in object space, wear layers               |
  | [Procedural textures](procedural-textures.md#live-layers-in-a-terrain-material) | A layer that runs its generator live                                     |

## Best for

|                      | Good fit                                                                                                                                         | Poor fit                                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Art style            | Any; stylized and flat-textured looks need no anti-tiling at all                                                                                 | A photoreal open landscape from one surface: real ground changes every few metres                                                           |
| Game type and camera | Small arenas, top-down and RTS cameras at height, side-view platformers, a ground under everything else (a parking lot, a sports field, a beach) | First person over a wide single surface without anti-tiling and macro: the tiles line up into a grid within 30 m                            |
| World size           | Arenas and levels up to a few hundred metres; any world as one layer of a blend                                                                  | An open world without macro variation: one surface repeats at the same contrast to the horizon. Blend layers, or at least turn the macro on |

## Performance

- **Fetches per pixel** ([the formula](README.md#the-performance-formula)): `P × A + M`. `LITE` (2 textures) with `DUAL_SCALE` (2 taps) and the macro: 2·2 + 1 = **5**. `NONE` without the macro is 2; `HEX` with the macro 7. The `TAPS` debug view shows the count per pixel.
- **ALU:** `NONE` and `DUAL_SCALE` are a few multiplies. `HEX` hashes a random offset and angle for each of its three lattice vertices, turns each tap's UV and normal, and weighs the taps by height through a contrast curve: about 1 ms more than `NONE` on a block filling the frame (below). The macro is one fetch and a hue turn. A `rotation` adds a sine and a cosine, and is compiled only when given.
- **Measured GPU time.** Anti-tiling (p305 Phase 2, 2026-11-16: Chrome headless, WebGPU, a 1280 × 800 canvas, one 48 m flat block of `grass01` 30 m below the camera; the frame's GPU time with and without the macro; the repetition figure is the screenshot's high-passed luminance autocorrelation at a shift of 8 px or more, so 0.27 means the tiles line up):

  |              | Repetition                   | Frame GPU ms, macro off / on |
  | ------------ | ---------------------------- | ---------------------------- |
  | Empty frame  | –                            | 1.36 / 1.42                  |
  | `NONE`       | 0.27 (32 px: one 1.4 m tile) | 1.59 / 1.86                  |
  | `DUAL_SCALE` | 0.03                         | 1.69 / 2.03                  |
  | `HEX`        | 0.02                         | 2.59 / 2.75                  |

  Both modes take the repetition out; the macro doesn't change the figure (the high-pass drops its broad variation) but breaks up the large-scale sameness the eye still sees. WebGL2 renders the same within 0.04 / 255 on average.

  The quality tiers on one layer (p305 Phase 6: Windows Chrome 157 on an AMD RDNA 3 GPU, WebGPU, 1280 × 800, a 12 m block of `rocks01` close up, the median of 90 frames; empty frame 0.12 ms): the block's own fields (`NONE`) 0.19 ms, `LOW` 0.19, `MEDIUM` 0.20, `HIGH` 0.25, `ULTRA` 0.25 (both `HEX`: with one layer `DOMINANT` is `HEX`).

  Numbers compare within one machine only. p310 measures every page in the gallery with fixed camera presets.

- **VRAM:** the set (a `LITE` set at 1K is 2.67 MB with its mips, `FULL` 4.00 MB, `MINIMAL` 1.33 MB) and the macro texture (`macroNoise`, 0.35 MB). Anti-tiling costs no memory.
- **Bindings:** the packing's textures plus the macro: 2–4 of a shader stage's 16.
- **Draw calls:** one per mesh per material, plus the shadow passes, which use the position alone (the material never touches `positionNode`, so shadows cost nothing extra).
- **Quality tier:** `NONE` on `LOW`, `DUAL_SCALE` on `MEDIUM`, `HEX` on `HIGH` and `ULTRA` ([Variations](#variations)).

## Maps

| Map                     | Required | Packing                               | Colour space                 | Codec                  | Size                                |
| ----------------------- | -------- | ------------------------------------- | ---------------------------- | ---------------------- | ----------------------------------- |
| The layer's texture set | Yes      | `LITE` (default), `FULL` or `MINIMAL` | Albedo sRGB, the rest linear | UASTC (`terrainLayer`) | 1K from 2K sources                  |
| Macro noise             | No       | One RGBA texture: R, G, B used        | Linear                       | UASTC (`data`)         | 512² (`macroNoise`), tiled 40–300 m |

The set is any of the [library's 16](../../hub/pages/features/terrain/guide.md#the-library), your own ([Texture sets](texture-sets.md)), or a procedural set baked at load ([Procedural textures](procedural-textures.md)). The macro texture is the toolkit's `macroNoise` (R and G two fbms around 0.5, B soft-edged patches), or a bake of it with another seed (`bakeMacroNoise()`, registered as `macroNoise.data`).

## Blender, step by step

The block workflow (set-up, the grid, shaping, validating, exporting) is [Terrain blocks from Blender](terrain-blocks-blender.md); start from `terrain_singleLayer.blend` (`src/toolkit/terrain/blender/`), a 64 m / 129 block shaped by a live Displace with grass01 as its preview. What's particular to one layer:

1. **Shape only:** nothing to paint. The `Splat` attribute stays black (the export writes it; a single-layer material doesn't read it).
2. **The Displace modifier** is the quickest heightfield-safe shape: Texture Coordinates _Global_ (the next block with the same modifier continues the hills), Direction _Z_, Midlevel 0, Strength the hills' height. Validate warns that it's unapplied and checks the block with it applied, as the export writes it.
3. **The preview** (sidebar → Preview Material): the base layer alone, the set you'll use, tiled at its real size at the world position, as the material's world UVs tile it. No anti-tiling or macro in the preview: judge the repetition in the engine.

What the material needs from a mesh: nothing beyond positions and normals with world tiling (`uv: 'WORLD'`, the default). With `uv: 'MESH_UV'`, UVs in metres (1 UV unit = 1 m), so the set's `physicalSize` keeps its scale (a block's 0..1 UVs don't: scale them, or stay in world space); the tangent frame comes from the UVs' derivatives, so the mesh needs no tangent attribute.

## Export

_Export Block_ ([the locked settings](terrain-blocks-blender.md#export)): the GLB and the two JSON stubs. Any glTF mesh with normals works too (a plain `*.mesh.json` or import); no vertex colour or second UV set is read by a single-layer material.

## Import into Ækasha

Three ways to give a mesh a terrain material: a variant of the toolkit's `terrain`, a material JSON of your own, or code. All three build the same shader for the same config.

**A variant of the toolkit's `terrain`** (no new files): a scene lists the material `terrain`, and a mesh's `matOverrides` gives its set as the input `layer0` and its config as the static define `terrain`:

```json
{
  "materials": ["terrain"],
  "textures": ["macroNoise"],
  "meshes": [
    {
      "id": "meadowBlock",
      "geo": "meadowBlockGeo",
      "mat": "terrain",
      "matOverrides": {
        "inputs": {
          "layer0": { "textureSet": "grass01" },
          "macro": { "texture": "macroNoise" }
        },
        "staticDefines": {
          "terrain": {
            "layers": [{ "tiling": 1.5, "rotation": 20 }],
            "antiTiling": { "mode": "DUAL_SCALE" },
            "macro": { "scale": 64 },
            "distance": { "fade": [40, 120] }
          }
        }
      }
    }
  ]
}
```

The gather loads what the inputs name (the set's packing, the macro texture). A variant's `staticDefines` replace the base's key by key, so the `terrain` define is always the whole config: restate it in every variant. Meshes with the same overrides share one material and shader; meshes with another set in `layer0` and the same define share the shader.

**A material JSON of your own**, when several scenes use the same config. A `tslFile` resolves from the JSON's own top folder (`src/app/`), so the app gives the generator a two-line TSL file next to its JSON. `src/app/materials/meadowGround/meadowGround.tsl.ts`:

```ts
import { setupTerrainMaterial } from 'aekasha/toolkit/terrain';

export const setup = setupTerrainMaterial;
```

and `meadowGround.material.json`:

```json
{
  "$schema": "../../../../.schemas/material.schema.json",
  "id": "meadowGround",
  "tslFile": "materials/meadowGround/meadowGround.tsl.ts",
  "type": "STANDARDNODEMATERIAL",
  "staticDefines": {
    "terrain": {
      "layers": [{ "tiling": 1.5, "rotation": 20 }],
      "antiTiling": { "mode": "DUAL_SCALE" },
      "macro": { "scale": 64 }
    }
  },
  "inputs": {
    "layer0": { "textureSet": "grass01" },
    "macro": { "texture": "macroNoise" }
  }
}
```

A mesh swaps the set per block with `"matOverrides": { "inputs": { "layer0": { "textureSet": "sand01" } } }`, without another shader. The define's fields are the code route's config without `id`, the layers' `set` and the texture ids (those are inputs); the material's build checks it and throws naming the field.

**From code:**

```ts
import { ensureMaterialDependencies } from 'aekasha';
import {
  createTerrainMaterial,
  getTerrainMaterialProps,
  type TerrainMaterialConfig,
} from 'aekasha/toolkit/terrain';

const config: TerrainMaterialConfig = {
  id: 'meadow',
  layers: [{ set: 'grass01', tiling: 1.5, rotation: 20 }],
  antiTiling: { mode: 'DUAL_SCALE' },
  macro: { texture: 'macroNoise', scale: 64 },
};
// Only when the scene doesn't list grass01 and macroNoise
await ensureMaterialDependencies(getTerrainMaterialProps(config));
const meadow = createTerrainMaterial(config);
```

`createTerrainMaterial` is synchronous: the set's textures must be loaded (a scene that lists the set or a material naming it, else `ensureMaterialDependencies` as above; a missing texture samples white, warned). An id that's registered already returns that material. `getTerrainMaterialProps(config)` gives the JSON route's fields for the same config (`staticDefines.terrain` and the inputs), which is also how to see what a config becomes. Every route needs the `textureSets()` feature.

**As a terrain block** (the stub Export Block wrote, its material replaced): the toolkit's `terrain` as it is (one `grass01` layer), or a layer of the block's own through `materialInputs`, a variant per set:

```json
{
  "geometry": { "importedAsset": "meadow", "node": "meadow" },
  "material": "terrain",
  "materialInputs": { "layer0": { "textureSet": "sand02" } },
  "grid": { "x": 0, "z": 0, "size": 64, "resolution": 129 },
  "collider": { "type": "HEIGHTFIELD" }
}
```

## Set-up and parameters

**A layer** (`layers[i]`; in the JSON route without `set`). Each number multiplies the set's own `surface` field of that name, so the defaults look like the set:

| Field            | What it is                                                                       | Default        | Uniform                       |
| ---------------- | -------------------------------------------------------------------------------- | -------------- | ----------------------------- |
| `set`            | The texture set's id (code route; the JSON route's input `layer<i>`)             | Required       | –                             |
| `tiling`         | × the set's `physicalSize`: 2 tiles twice as large                               | 1              | `terrain_l<i>_tiling`         |
| `rotation`       | Degrees the tiling turns, counter-clockwise from above; compiled only when given | None           | `terrain_l<i>_rotation`       |
| `tint`           | × the set's `tint`, an sRGB `"#rrggbb"` (it can only darken)                     | `#ffffff`      | `terrain_l<i>_tint`           |
| `normalStrength` | × the set's `normalStrength`: the normal's slope, or `MINIMAL`'s bump            | 1              | `terrain_l<i>_normalStrength` |
| `roughnessScale` | × the set's `roughnessScale`; the roughness is capped at 1                       | 1              | `terrain_l<i>_roughnessScale` |
| `antiTiling`     | The layer's own, in place of the material's whole object                         | The material's | –                             |

**The material** (the fields this page uses; the other pages add theirs):

| Field              | What it is                                                                                                                                                        | Default                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `packing`          | The packing every layer samples (code route; the JSON route's in the inputs, `{ textureSet, packing }`)                                                           | The set's `defaultPacking` |
| `uv`               | `WORLD`: the world's `(x, −z)` over the tile; `MESH_UV`: the mesh's UVs in metres                                                                                 | `WORLD`                    |
| `antiTiling`       | `{ mode: 'NONE' }`, `{ mode: 'DUAL_SCALE', farScale?, distance? }` or `{ mode: 'HEX', hexContrast?, hexRotation? }` ([Variations](#variations))                   | `NONE`                     |
| `macro`            | `{ texture, scale, brightness?, hue?, roughness? }`: `scale` the metres one macro tile covers (40–300), then ±20 % brightness, ±8° hue and ±15 % roughness        | None                       |
| `distance`         | `{ fade: [from, to] }`: the detail normal fades to the mesh's normal over these view distances (metres); [the far surface](terrain-colormap-detail.md) adds `far` | None                       |
| `ao`               | `{ textureInfluence }`: `FULL`'s AO map into `aoNode`, × each set's `aoStrength`, 0..1                                                                            | 1                          |
| `reservedTextures` | The sampled textures kept for the rest of the shader (shadow maps, the environment), 0..15: the material may bind the stage's limit less these                    | 6                          |
| `quality`          | Each tier's overrides (`LOW`, `MEDIUM`, `HIGH`, `ULTRA`), usually `getTerrainQualityPreset()`                                                                     | None                       |
| `debugView`        | A debug view in place of the surface (debug builds only)                                                                                                          | None                       |

The material-wide uniforms are `terrain_<name>`: `terrain_macroScale`, `terrain_macroBrightness`, `terrain_macroHue`, `terrain_macroRoughness`, `terrain_distanceFade` (a vec2), `terrain_aoTextureInfluence` (`FULL` only); the anti-tiling's are per layer (`terrain_l<i>_farScale`, `terrain_l<i>_antiTilingDistance`, `terrain_l<i>_hexContrast`, `terrain_l<i>_hexRotation`, only those of its mode). They're in the material's `userData.uniforms`: set a uniform's `.value` from code (the gallery's sliders do). The debug drawer's material editor doesn't list them: it edits a material's declared inputs. A uniform exists only where its technique is compiled.

**Quality tiers.** A material's `quality` table holds config overrides per tier, and `getTerrainMaterialVariant(id, level)` returns the tier's variant, its own shader (made on first use, shared after):

```ts
import {
  createTerrainMaterial,
  getTerrainMaterialVariant,
  getTerrainQualityPreset,
} from 'aekasha/toolkit/terrain';

createTerrainMaterial({
  id: 'meadow',
  layers: [{ set: 'grass01' }],
  macro: { texture: 'macroNoise', scale: 64 },
  quality: getTerrainQualityPreset(),
});
const meadowLow = getTerrainMaterialVariant('meadow', 'LOW');
```

`getTerrainQualityPreset({ cliffLayers?, cliffGate?, liveLayers?, far? })` is the suggested table: anti-tiling (`LOW` `NONE`, `MEDIUM` `DUAL_SCALE`, `HIGH` `HEX` on the dominant layer, `ULTRA` `HEX` on all), the layers sampled per pixel, the cliff layers' projection, the live layers' source and the far surface; the pages that use each say what it does there. A tier's material-wide `antiTiling` doesn't reach a layer that has its own: a tier's `layers[i]` entry does. In the JSON route, the tier is the define's `qualityLevel` (`"qualityLevel": "LOW"` beside `quality`).

### Debug views

`debugView` replaces the shading with a view (unlit, in the emissive), in debug builds only; elsewhere it's ignored. From code, `await loadTerrainDebugViewsAsync()` first: the views are a debug chunk, and a material asking for one before it's loaded builds without it, warned. In the gallery, the "Terrain gallery" tab's Debug view select switches every terrain block.

| View            | Shows                                                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TEXEL_DENSITY` | Texels per metre of the colour slot, in bands over a 1 m checker: under 128 blue, 128 cyan, 256 green, 512 yellow, 1024 orange, 2048+ red         |
| `NORMALS`       | The shaded world normal × 0.5 + 0.5 (the distance fade shows here)                                                                                |
| `WEIGHTS`       | Each layer's false colour by its weight ([Vertex-colour splat](terrain-vertex-color-splat.md))                                                    |
| `PROJECTION`    | The planes' weights and the slope gate's band ([Triplanar cliffs](terrain-triplanar-cliffs.md))                                                   |
| `TAPS`          | The material's texture fetches at the pixel, heat-mapped: up to 2 dark blue, 4 blue, 8 cyan, 12 green, 16 yellow, 24 orange, 32 red, more magenta |
| `LAYER_COUNT`   | How many layers weigh in at the pixel, striped where sparse sampling drops one ([Splat map](terrain-splat-map.md#sparse-sampling))                |

## Variations

- **Tiling multiplier** (`tiling`): what a set's tile covers. The set's `physicalSize` is measured to look right at its texel density; over 1 for a camera far away (fewer visible tiles, a coarser look), under 1 for close-ups that need finer detail. The `TEXEL_DENSITY` view says whether you're still in your camera's band ([Texture sets' texel density](texture-sets.md#choosing-physicalsize-and-texel-density)). Free: a uniform.
- **Rotation per layer** (`rotation`): a layer's pattern turned by degrees. With one layer it hides the sources' axis alignment (a scan's grain running exactly along the world's X). With several layers of the same tile size it keeps their tiles from lining up, which would make the grid stand out. A sine and a cosine per pixel, compiled only when given.
- **`DUAL_SCALE`** (`{ mode: 'DUAL_SCALE', farScale?, distance? }`): a second tap at the UV × `farScale` (default 0.23: tiles 4.3 × as large), turned 37° and offset, mixed in by distance: its share grows from 0 to half over `distance` (default `[6, 40]` m). With a macro texture, the macro's B patches add up to another half, so the large tap shows through in soft patches near the camera too. Why: the two scales never line up, so neither grid survives. It's the default choice: 2 taps, 0.1–0.2 ms over `NONE` on a full frame, and it also takes the tiling out of the distance, where repetition is most visible. The large tap is the same texture stretched: a close-up sees its softer detail in the patches.
- **`HEX`** (`{ mode: 'HEX', hexContrast?, hexRotation? }`): Mikkelsen's practical hex tiling. Three taps on a hex lattice (a hex about half a tile across), each with its own random offset and turn, blended by height so the higher texel wins, sampled with the UV's own gradients so the hexes' borders have no mip seams at grazing angles. `hexContrast` (0.05–0.95, default 0.5) sharpens the borders over 0.5, softens them under; `hexRotation` (0–1 of a full turn, default 1) limits the turn, for directional sets: lower it for ripples (`sand02`) and strata, 0 for none. Why: no repetition at any distance and none of `DUAL_SCALE`'s stretched patches, for first and third person on strongly patterned surfaces (gravel, rocks, cliffs, grass ground). Cost: 3 taps and the ALU above, about 1 ms over `NONE` on a full frame: the `HIGH` and `ULTRA` tiers.
- **Macro variation** (`macro`): one fetch of `macroNoise` at the world's `(x, −z) / scale`, varying the albedo's brightness (R), hue (G, a turn about the grey axis) and roughness (G). Why it beats bigger textures: a 2K set doesn't repeat less, it repeats at the same `physicalSize` with finer detail and four times the memory (10.7 MB for `LITE`). The repetition the eye catches at a distance is the large-scale sameness, which the macro breaks for 0.35 MB and one fetch, shared by every layer, continuous across blocks. Pick `scale` from the view: about a block's worth (64 m) for a third-person camera, 150–300 m for flight. Its B channel drives `DUAL_SCALE`'s patches, and the [rules](terrain-procedural-rules.md) read its channels as noise.
- **Distance fade** (`distance: { fade: [from, to] }`): the detail normal fades to the mesh's normal over the view distances. Far away a tiled normal map only adds shimmer and the mipped normal flattens anyway; the fade makes it clean. ALU only. The [far surface](terrain-colormap-detail.md) builds on it and stops sampling the layer altogether past `to`.
- **Packing:** `LITE` is the default (2 textures, the AO in the albedo). `MINIMAL` (1 texture, the normal a bump of the height) for top-down, stylized and low-end; the bump takes two derivatives, no fetch. `FULL` (3 textures) for close hero surfaces: the AO goes to `aoNode` (indirect light only), which is the correct place for it ([AO into albedo](texture-sets.md#ao-into-albedo-step-by-step)).
- **The quality tiers** (`quality: getTerrainQualityPreset()`): `LOW` drops the anti-tiling, `MEDIUM` `DUAL_SCALE`, `HIGH` and `ULTRA` `HEX`. A tier the app picks once (eg. from p240's quality settings) is one more shader per material, compiled on first use.

## Pitfalls and checklist

- [ ] The set's `physicalSize` reads right in the gallery's 1 m checker, and `TEXEL_DENSITY` sits in your camera's band.
- [ ] Anti-tiling is on for any camera that sees more than a few tiles at once: `DUAL_SCALE` by default, `HEX` for close-ups of patterned ground.
- [ ] A macro on any ground wider than about 50 m, its `scale` matched to the view.
- [ ] `hexRotation` lowered for a directional set (ripples, strata, a scan with a grain).
- [ ] A world-tiled material on steep faces: `uv: 'WORLD'` projects from above, so a 60° slope stretches its tiles 2 ×, a wall streaks. Use a projection on the steep layer ([Triplanar cliffs](terrain-triplanar-cliffs.md)) or `MESH_UV` on authored walls.
- [ ] The scene lists the textures a code-made material needs, or the code awaits `ensureMaterialDependencies` first.
- **A white surface:** a texture that isn't loaded (warned in the console: the set's packing or the macro texture).
- **"[terrain] … refused":** the material's build checks the define by hand and throws naming the field (`antiTiling.hexContrast`) and why: another mode's field (`farScale` under `HEX`), a value out of its range, an unknown key.
- **A changed field doesn't rebuild:** the define is build time. A variant with another define is another shader; the uniforms are what changes live.
- **Dark or wrongly lit back faces:** the material shades front faces only (the geometry normal isn't flipped on a back face). Give a two-sided piece real geometry.
- **Baked AO and screen-space AO stack:** a `LITE` or `MINIMAL` set's AO is in its albedo and darkens all light; the GTAO PostFX pass multiplies the final colour on top. Lower the pass's strength over such ground, or use `FULL`, whose AO goes to indirect light alone.

## Template file and example asset ids

- **Blender template:** `src/toolkit/terrain/blender/terrain_singleLayer.blend` (its README text block mirrors this page's Blender steps; the block workflow: [Terrain blocks from Blender](terrain-blocks-blender.md)).
- **The materials:** `terrain` (`src/toolkit/materials/terrain/`: the JSON route, one `grass01` layer by default); `createTerrainMaterial` and the rest on `aekasha/toolkit/terrain` (`src/toolkit/terrain/material/`).
- **The sets:** any of the library's (`src/toolkit/textures/<setId>/`); `grass01`, `rocks01` and `sand02` show the anti-tiling best. The macro texture `macroNoise` (`src/toolkit/textures/macroNoise/`).
- **The gallery** (`terrainGallery`, `?isDebug=true&startScene=terrainGallery`): every library set on a block of `terrain` (each block a variant of it); the Anti-tiling row, three 48 m blocks of `grass01` in `NONE`, `DUAL_SCALE` and `HEX` with the macro switch, sliders for the modes' and the macro's uniforms and camera poses (30 m up, grazing, close), in the "Terrain gallery" tab (`src/app/scenes/terrainGallery/antiTilingRow.ts`); the tab's Debug view and Quality selects.
