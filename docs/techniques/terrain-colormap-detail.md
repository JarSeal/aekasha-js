# Colour map + detail

A block's own colour map, one texture at its UVs, gives the ground its unique large-scale colour (painted paths, burn marks, the bands of a slope, baked occlusion); the tiled layers on top supply only the close-up detail: a grey brightness variation, the normal and the roughness. The same colour map is also the cheapest far surface: past a distance the layers aren't sampled at all.

Everything on [Single-layer terrain](terrain-single-layer.md) applies to the layers, and any blend works under a colour map ([Vertex-colour splat](terrain-vertex-color-splat.md), [Splat map](terrain-splat-map.md), [Procedural rules](terrain-procedural-rules.md)).

## What it is

```text
 DETAIL:   colour map (mesh UV, 1 fetch) × Σ wᵢ · (layerᵢ's albedo luminance ÷ its set's average luminance)
           the detail fades to 1 over detailDistance; normal and roughness from the layers as usual

 far surface past distance.fade[1] (a dynamic branch: the layers aren't sampled there)
           COLOR_MAP:      the colour map (1 fetch)
           AVERAGE_COLOR:  Σ wᵢ · averageColorᵢ · tintᵢ (0 fetches)
           farBlend:       a band of metres where both are sampled and mixed, so no line moves with the camera

 bakeTerrainColorMap: the block's terrain material rendered at the block's UVs ──► <id>.color
```

- **Unique colour without unique-texture VRAM:** a unique texture at full detail (5 cm a texel over a 1 km world) would be gigabytes. A colour map carries only what changes over metres (1K over a 64 m block: 6.25 cm a texel, 1.40 MB compressed), and the shared layers carry the centimetres.
- **The detail is grey:** each layer's albedo divided by its set's average colour, as a luminance (about 1 on average), so the colour map's colour survives untinted. The layers' own colour and `tint` don't reach a `DETAIL` surface.
- **`FAR_ONLY`:** the colour map is only the far surface's colour, a far LOD for any technique.
- **The bake:** the block's own terrain material (rules, paint, macro and all) rendered in the block's UV space, so the map lines up with the detail over it texel for texel.

## Best for

|                      | Good fit                                                                                                                                       | Poor fit                                                                                |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Art style            | Photoreal and painterly: hand-painted large-scale colour, baked occlusion, colour variation no tiling can give                                 | Purely procedural looks that change at runtime: a colour map is a snapshot              |
| Game type and camera | Top-down, isometric and RTS (the colour map is most of what the camera sees); flight and racing (fast, far views); any open world's far ground | A world whose ground colour changes in play (seasons, scorched ground) without a rebake |
| World size           | Blocks with authored UVs; any world as the far surface                                                                                         | Thousands of blocks each with its own map at 1K: memory and download per block          |

## Performance

- **Fetches per pixel** ([the formula](README.md#the-performance-formula)): `DETAIL` adds 1 to the layers' fetches (and saves nothing near the camera). Past the far start: `COLOR_MAP` 1, `AVERAGE_COLOR` 0, plus the weights' own (splat maps, rules' noise); the `farBlend` band pays both.
- **ALU:** the far surface is a struct built before the branch and the near surface inside it, so a far pixel pays the weights and nothing of the layers.
- **Measured GPU time** (p305 Phase 7, 2026-11-16: Windows Chrome 157 on an AMD RDNA 3 GPU, the median of three 90-frame medians of the whole frame; the Rules row's 8-layer material on a 64 m block, the four materials swapped onto one block; third person: 1 m over its top at the near edge looking across, the far surface from 40 m):

  | ms                                                        | own         | `LOW`       | `MEDIUM`    | `HIGH`      | `ULTRA`     |
  | --------------------------------------------------------- | ----------- | ----------- | ----------- | ----------- | ----------- |
  | WebGPU 1280 × 800, third person (empty 0.52): the source  | 1.23        | 0.76        | 1.11        | 1.28        | 1.93        |
  | `DETAIL`                                                  | 1.23        | 0.77        | 1.12        | 1.28        | 1.89        |
  | far `COLOR_MAP`                                           | 0.95        | 0.76        | 1.08        | 1.25        | 1.89        |
  | far `AVERAGE_COLOR`                                       | 0.94        | 0.76        | 1.08        | 1.26        | 1.89        |
  | WebGPU 1920 × 1080, third person (empty 0.87): the source | 1.83        | 1.19        | 1.72        | 1.98        | 3.10        |
  | far `COLOR_MAP` / `AVERAGE_COLOR`                         | 1.59        | 1.20        | 1.63        | 1.91        | 3.08        |
  | WebGL2 1280 × 800 (empty 0.42): the source / far          | 0.95 / 0.74 | 0.62 / 0.62 | 0.86 / 0.85 | 0.98 / 0.99 | 1.56 / 1.56 |

  The far surface from 40 m takes about 40 % off the block's own cost in the third person (0.71 → 0.43 ms at 1280, 0.96 → 0.72 at 1080p); the two far modes cost alike; `DETAIL` costs what the source does. The tiers' own far starts (`getTerrainQualityPreset({ far })`: 60, 120 and 200 m) lie mostly past a 64 m block, so the gallery shows their saving only a little on `MEDIUM` and `HIGH`: they're for open worlds. From above every material costs about the same (0.40–0.44 ms).

  Measured in the gallery's Colour map row ([how](README.md#how-the-figures-are-measured): RDNA 3, WebGPU, 1920 × 1080; the block's own GPU ms, the frame less the frame without it), 64 m, the 8-layer source; own fields, `LOW`, `MEDIUM`, `HIGH`, `ULTRA`:

  | ms                                          | Own  | `LOW` | `MEDIUM`  | `HIGH` | `ULTRA`   |
  | ------------------------------------------- | ---- | ----- | --------- | ------ | --------- |
  | From above (51 m up): the source            | 0.62 | 0.32  | 0.86      | 1.13   | 1.97      |
  | `DETAIL`                                    | 0.63 | 0.33  | 0.87      | 1.17   | 1.96      |
  | far `COLOR_MAP`                             | 0.17 | 0.17  | 0.19      | 0.22   | 1.98      |
  | far `AVERAGE_COLOR`                         | 0.19 | 0.19  | 0.21      | 0.24   | 1.97      |
  | Third person: the source                    | 1.15 | 0.43  | 1.01      | 1.34   | 2.58      |
  | `DETAIL`                                    | 1.20 | 0.45  | 1.02      | 1.36   | 2.54      |
  | far `COLOR_MAP` / `AVERAGE_COLOR`           | 1.16 | 0.45  | 0.89–0.91 | 1.26   | 2.58–2.61 |
  | Top-down (30 m up, 55°): `DETAIL`           | 0.83 | 0.41  | –         | –      | –         |
  | Isometric (120 m out, 20°): `DETAIL`        | 0.92 | 0.42  | –         | –      | –         |
  | Flight (15 m up, 60 m out): far `COLOR_MAP` | 0.17 | –     | 0.18      | –      | –         |

  Seen from above, the whole block lies past the far start: the far surface takes 70 % off (`ULTRA` has none). In the third person most of the ground is nearer than 40 m, so it saves 0.1 ms at `MEDIUM` and `HIGH` and nothing at its own fields. The last three rows are the [matrix](README.md#which-technique-for-my-game)'s cameras.

- **VRAM:** a colour map per block: 1K UASTC 1.40 MB, 512² 0.35 MB; a runtime bake is uncompressed RGBA8 with mips, 5.6 MB at 1K. `AVERAGE_COLOR` needs no texture.
- **Bindings:** 1 for the colour map.
- **Draw calls:** none of its own. A block's map is a variant input: no new shader.
- **Quality tier:** `getTerrainQualityPreset({ far: 'COLOR_MAP' | 'AVERAGE_COLOR' })` gives every tier a far surface: `LOW` from 60 m, `MEDIUM` 120 m, `HIGH` 200 m (the normals fading from half that), `ULTRA` none (its normals fading by 200 m).

## Maps

| Map                      | Required                  | Packing                | Colour space  | Codec                    | Size            |
| ------------------------ | ------------------------- | ---------------------- | ------------- | ------------------------ | --------------- |
| The colour map           | `DETAIL`, `COLOR_MAP` far | RGB at the block's UVs | sRGB          | UASTC (`baseColor` slot) | 512²–1K a block |
| The layers' texture sets | Yes                       | One packing for all    | As their sets | UASTC                    | 1K              |

`DETAIL` and `AVERAGE_COLOR` read each layer's set's `averageColor`, which the asset pipeline measures for an imported set; a procedural set has none, and the material refuses such a layer there, naming the input. A set array carries each layer's average (mid-grey, warned, for a set without).

## Blender, step by step

The block workflow (set-up, the grid, shaping, validating, exporting) is [Terrain blocks from Blender](terrain-blocks-blender.md); start from `terrain_colormapDetail.blend` (`src/toolkit/terrain/blender/`): rolling hills painted in four layers from their shape, the AO baked, ready to bake. The material needs the block's UVs 0..1 over it, without overlaps (each texel one place on the block): the add-on's top-down UVs are.

1. **Paint the block's look** with the preview material: vertex colours or a splat map, as on their pages. The colour map is a picture of that look.
2. Set the block's _Folder_, then **_Bake Colour Map_**: Cycles bakes the preview's colour (the albedo, no light) through the UVs into `<id>_colorMap` and saves `<id>_colorMap.png`. **Size: 2K for a 64-128 m block** (3-6 cm a texel), 4K for 256 m; 1K for a far-only map.
3. **_Include AO_:** off when the engine applies the vertex AO itself (an `RGB_AO` block with `ao.vertex`), on for a map that stands alone (a `FAR_ONLY` surface past the splat).
4. **What not to bake:** light and shadow. The engine lights the map; with day-night, a baked sun is wrong most of the day, and a baked shadow doubles the real one. Bake the albedo, and at most the AO.
5. **Unique detail** (a road, scorch marks, a field's rows): paint on the baked image in Texture Paint (it's sRGB), then save it.

The preview is an approximation of the engine's material (no anti-tiling or macro): for a map that matches the engine exactly, bake it in the engine instead (below).

## Export

**From Blender:** _Export Block_ ([the locked settings](terrain-blocks-blender.md#export)) saves `<id>_colorMap.png` beside the GLB and writes its texture JSON stub where none is: slot `baseColor`, `texOpts` `{ "flipY": false, "colorSpace": "srgb" }` (glTF's V 0 is the image's top row).

**From the engine:** bake the block's material (below), then `exportBakedTexture({ id, output: 'color', dir })` (on `aekasha`, debug builds) writes the PNG into the repo through the dev file server, ready for a texture JSON.

## Import into Ækasha

**Bake a block's colour map in the engine** (from its own terrain material: the paint, the rules, the macro, everything but the distance effects, at its near look):

```ts
import { getMeshByAppId } from 'aekasha';
import { bakeTerrainColorMap } from 'aekasha/toolkit/terrain';

const block = getMeshByAppId('valleyBlockA');
if (block) {
  // valleyBlockA.color: sRGB, mipmapped; ao: true multiplies the vertex and texture AO in
  const baked = await bakeTerrainColorMap({
    id: 'valleyBlockA',
    mesh: block,
    size: 1024,
    ao: true,
  });
}
```

Bake on the block's own mesh where it stands: the macro and the rules' noise are in world space, so a map baked on another placement doesn't line up with the detail over it. The bake is a texture like any other (`valleyBlockA.color`, owned by the scene unless `isPersistent`); use it as it is, or export it, add a texture JSON and commit it so no bake runs at load:

```json
{
  "$schema": "../../../../.schemas/texture.schema.json",
  "id": "valleyBlockA_color",
  "fileName": "./source/valleyBlockA_color.png",
  "optimize": { "slot": "baseColor" },
  "texOpts": { "colorSpace": "srgb", "wrapS": "CLAMP_TO_EDGE", "wrapT": "CLAMP_TO_EDGE" }
}
```

A map baked in Blender has `"flipY": false` in its texture JSON (Export Block's stub).

**The material**, its colour map the input `colorMap` (each block a variant with its own: a terrain block's `"materialInputs": { "colorMap": { "texture": "valleyBlockA_colorMap" } }`):

```ts
import { createTerrainMaterial, getTerrainQualityPreset } from 'aekasha/toolkit/terrain';

createTerrainMaterial({
  id: 'valleyDetail',
  layers: [{ set: 'grass01' }, { set: 'rocks02' }, { set: 'snow01' }],
  blend: { source: 'VERTEX_COLOR' },
  colorMap: { mode: 'DETAIL', texture: 'valleyBlockA_color', detailDistance: [30, 90] },
  distance: { fade: [24, 40], far: 'COLOR_MAP' },
  quality: getTerrainQualityPreset({ far: 'COLOR_MAP' }),
});
```

In the JSON route, `staticDefines.terrain.colorMap` holds the settings without the texture (`{ "mode": "DETAIL", "detailDistance": [30, 90] }`) and the input `colorMap` the texture (`{ "texture": "valleyBlockA_color" }`).

**A far surface alone** (any material, no colour map):

```ts
distance: { fade: [60, 120], far: 'AVERAGE_COLOR', farBlend: 8 },
```

## Set-up and parameters

`colorMap` (code route: with its `texture`):

| Field            | What it is                                                                                                                      | Default                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `mode`           | `DETAIL`: the colour map gives the albedo, the layers their detail; `FAR_ONLY`: only the far surface's colour                   | Required                 |
| `detailDistance` | `DETAIL`: `[from, to]` metres over which the detail fades out; past `to` the colour map alone. Uniform `terrain_detailDistance` | None (detail everywhere) |
| `texture`        | The colour map's texture id (code route; the JSON route's input `colorMap`)                                                     | Required                 |

`distance`:

| Field      | What it is                                                                                                                                                         | Default  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| `fade`     | `[from, to]` metres: the detail normals fade to the mesh's; `to` is where the far surface starts. Uniform `terrain_distanceFade`                                   | Required |
| `far`      | `NONE`, `AVERAGE_COLOR` (the layers' average colours by weight) or `COLOR_MAP` (needs `colorMap`)                                                                  | `NONE`   |
| `farBlend` | Metres past `fade[1]` over which the near surface gives way to the far one (both sampled there); 0 a hard switch. With a far mode only. Uniform `terrain_farBlend` | 4        |

`bakeTerrainColorMap({ id, mesh, material?, size?, ao?, isPersistent? })`: the texture is `<id>.color` (sRGB, mipmapped, clamped), 1024² by default, the mesh's own material unless given; `ao` multiplies the material's `aoNode` in; `rebake()` uses the uniforms of the bake's time (bake again after edits). A texel no triangle covers stays transparent black (no dilation).

**The far surface** in detail: the albedo is the colour map or `Σ wᵢ · averageColorᵢ · tintᵢ`, with the raw weights normalized linearly (the height blend needs the layers' heights, which the far surface doesn't sample; the band hides the difference); the roughness `Σ wᵢ · min(1, 0.8 × the set's and the layer's scales)`; the normal the mesh's; no texture AO, the vertex AO kept; the macro varies the `AVERAGE_COLOR` albedo and both roughnesses, never a colour map's colour.

## Variations

- **AO and large-scale lighting in the colour map:** `ao: true` bakes the vertex AO (and `FULL`'s texture AO) into the colour; a Blender bake can add sky occlusion and bounce light. Why: one fetch then carries all the large-scale shading. Cost: static lighting assumptions. The material applies its own AO again, so bake it or keep it, not both; and **don't bake direct sunlight if the sky's day-night cycle runs**, or the shadows stay put while the sun moves.
- **`DETAIL` distance:** a `detailDistance` that fades the detail out makes far ground the colour map alone (flat but correct colour); without it the detail tiles to the horizon.
- **`FAR_ONLY` as a far LOD:** keep any technique near the camera and switch to the colour map past `fade[1]`: one fetch for the far ground of a splat map, rules or live layers.
- **`AVERAGE_COLOR`:** a far surface with no texture at all, from the sets' measured averages: soft blended patches. For worlds without per-block maps, and for blocks without UVs.
- **`farBlend`:** wider (8–16 m) on a fast camera to hide the switch; 0 for a hard switch (cheaper: no band pays both).
- **Bake size:** 1K on 64 m for third person, 512² for top-down at height and for far-only maps (the far surface is seen small).

## Pitfalls and checklist

- [ ] The block's UVs cover it 0..1 without overlaps.
- [ ] The colour map is baked on the block where it stands (world-space macro and noise).
- [ ] `DETAIL` and `AVERAGE_COLOR` layers are imported sets (they have an average colour).
- [ ] AO baked into the colour map or applied by the material, not both.
- [ ] No direct sunlight baked in a scene with day-night.
- [ ] Looked at the far band from the camera's height: no line, no pop.
- **"is AVERAGE_COLOR with a DETAIL colour map … use COLOR_MAP":** a `DETAIL` surface's far mode must keep its colour map's colour.
- **"is FAR_ONLY: give distance.far COLOR_MAP":** nothing would read the colour map.
- **`distance.farBlend` "is for a far mode":** a `farBlend` without `far`.
- **A cliff streaked far away under `COLOR_MAP`:** a colour map at a planar block UV stretches on steep faces as planar tiling does. Give the cliffs' UVs room, or use `AVERAGE_COLOR`.
- **Black seams in a baked map:** texels no triangle covers. Pad the UV islands in Blender, or keep the block's UVs one island.
- **A debug view hides the far surface:** a material with a `debugView` is built without the far branch (the views read the layers).

## Template file and example asset ids

- **Blender template:** `src/toolkit/terrain/blender/terrain_colormapDetail.blend` (its README text block mirrors this page's Blender steps; the block workflow: [Terrain blocks from Blender](terrain-blocks-blender.md)).
- **The bake:** `bakeTerrainColorMap` (`src/toolkit/terrain/material/TerrainColorMapBake.ts`), on the engine's `bakeTexture` with its `mesh` option.
- **The gallery's Colour map row** (`terrainGallery`, `?isDebug=true&startScene=terrainGallery`; `src/app/scenes/terrainGallery/colorMapRow.ts`): four 64 m blocks on the Rules row's terrain, the 8-layer material, then with a `DETAIL` colour map (`detailDistance` 30–90 m), with the far `COLOR_MAP` surface (`FAR_ONLY`) and with the far `AVERAGE_COLOR` one (their fade 24–40 m, their tiers the preset's far column). Each block's colour map is baked during the load from the source material on the block's own mesh. Its tab has the camera above or a third person across the band, sliders for the fade, the far start, the band and the detail fade, and a rebake.
