# Triplanar cliffs

World tiling projects a texture straight down, so a steep face stretches it into vertical streaks. Projection samples the texture along the axes the surface faces instead: triplanar along all three, biplanar along the two that matter most, and slope-gated only where the ground is steep enough to need it. Usually only the cliff layer is projected.

Everything on [Single-layer terrain](terrain-single-layer.md) applies to each layer; a projected layer blends with the others as any layer does ([Procedural rules](terrain-procedural-rules.md) puts cliffs on steep faces by slope).

## What it is

```text
 PLANAR       the top plane only, the world's (x, −z): a 60° slope stretches 2 ×, a wall streaks
 BIPLANAR     the two planes the surface faces most, per pixel (Quilez): 2 taps
 TRIPLANAR    all three planes, weighted by |normal|^sharpness: 3 taps
 slope gate   below gate[0] planar, past gate[1] the projection, mixed between; a dynamic branch,
              so flat pixels pay 1 tap and only steep ones pay the projection's
```

- **The planes:** X samples the world's `(−z, y)`, Y `(x, −z)` (planar tiling's own UV, so the top plane matches a `PLANAR` layer exactly), Z `(x, y)`, each over the layer's tile size and turned by its `rotation`.
- **The normals:** each plane's normal map is blended into the geometry's normal in that plane's frame (`WHITEOUT` by default, `UDN` or `RNM`), weighted, summed and normalized once per layer, in world space, before the material's one conversion to view space.
- **The height** is the planes' blend too, so the height blend between a projected cliff layer and planar grass works across the gate.
- **Explicit gradients:** every projected tap samples with the world position's derivatives on its plane (`textureSampleGrad`), since biplanar picks its planes per pixel and the gate's branch can't take derivatives. No mip seams where planes switch.

## Best for

|                      | Good fit                                                               | Poor fit                                                                                                 |
| -------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Art style            | Any with steep relief: photoreal rock faces, stylized mesas            | Strongly directional textures (strata, writing): a face turned away from an axis sees its plane mirrored |
| Game type and camera | Mountain and canyon worlds, first and third person, flight past cliffs | Top-down and RTS cameras rarely see a face at a grazing angle: the gate's planar is enough               |
| World size           | Any; the gate keeps open ground at planar cost                         | –                                                                                                        |

## Performance

- **Fetches per pixel** ([the formula](README.md#the-performance-formula)): a projected layer's `P × A × T`, `T` the planes: `BIPLANAR` 2, `TRIPLANAR` 3, gated `TRIPLANAR` 1 on flat pixels and 3 past the gate (its top plane is the planar tap). `LITE` `TRIPLANAR` with `DUAL_SCALE`: 2·2·3 = 12; `HEX` × `TRIPLANAR` is 9 taps a slot. The `TAPS` debug view shows it per pixel, the gate's branch counted where it runs.
- **ALU:** the planes' weights and frames. `BIPLANAR`'s per-pixel plane choice compiles to some 37 small `if`s (ALU only, no sample in them); `RNM` costs a little more than `WHITEOUT` and `UDN`.
- **Measured GPU time** (p305 Phase 5, 2026-11-16: Windows Chrome 157 on an AMD RDNA 3 GPU, 1280 × 800, a 40 m block with a 9 m mesa of `cliffs01` `LITE`, the median of 90 frames of the whole gallery frame; above: straight down from 30 m over the mesa, mostly flat ground; face: 6 m off the steep face, filling the view):

  | ms                           | WebGPU above | WebGPU face | WebGL2 above | WebGL2 face |
  | ---------------------------- | ------------ | ----------- | ------------ | ----------- |
  | Empty frame                  | 0.10         | –           | 0.17         | –           |
  | `PLANAR`                     | 0.15         | 0.18        | 0.18         | 0.22        |
  | `BIPLANAR`                   | 0.16         | 0.23        | 0.22         | 0.27        |
  | `TRIPLANAR`                  | 0.21         | 0.24        | 0.27         | 0.32        |
  | `TRIPLANAR` gated `[30, 50]` | 0.17         | 0.22        | 0.21         | 0.26        |

  From above the gate costs about what `PLANAR` does and `TRIPLANAR` the most; at the face the gate lies between `BIPLANAR` and `TRIPLANAR` (its planar tap plus two planes). In the shader, a gated `TRIPLANAR` `LITE` layer has 2 plain samples before its branch and 4 `textureSampleGrad` inside; ungated `TRIPLANAR` 6, `BIPLANAR` 4. p310 measures every page with fixed camera presets.

- **VRAM, bindings:** none of its own: the layer's set.
- **Draw calls:** none of its own.
- **Quality tier:** the preset's `cliffLayers` (below): `LOW` `BIPLANAR` gated, `MEDIUM` and `HIGH` `TRIPLANAR` gated, `ULTRA` `TRIPLANAR` ungated.

## Maps

The layer's texture set, any packing. A rock set with a large `physicalSize` (`cliffs01`, `cliffs02`: 6 m) reads well on faces tens of metres high; `MINIMAL` projects too (its normal a bump of the planes' blended height). No other texture.

## Blender, step by step

The block workflow (set-up, the grid, shaping, validating, exporting) is [Terrain blocks from Blender](terrain-blocks-blender.md); start from `terrain_triplanarCliff.blend` (`src/toolkit/terrain/blender/`): a `HEIGHTFIELD` block with a winding cliff 14 m high, and its neighbour, a `TRIMESH` block whose rim overhangs. What's particular to cliffs:

1. **Cliff bands under heightfield rules:** a cliff can be as steep as you like (85°, a 3 m wide band rising 14 m) as long as every vertex moves in height only: sculpt with X and Y locked, or a Displace in Direction Z. A heightfield block's spacing sets how sharp the rim can be (0.5 m on 64 / 129): a denser block for a crisper edge.
2. **When to switch to `TRIMESH`:** an overhang, an arch, a cave mouth, a rim that leans out. Set the block's _Collider_ to _Trimesh_ (sidebar): Validate then skips the grid, UV and edge checks, so vertices may move in X / Y or be added. The cost is the collider (the triangles, not a height grid) and the edges: keep a trimesh block's edge vertices where its neighbours' are (the template fades its overhang out before the shared edge). Many caves and arches: [modular kits](terrain-modular-kits.md).
3. **No UV care for the cliffs:** the cliff layer is projected from the world (triplanar or biplanar), so the stretched top-down UVs over the faces don't matter. The preview tiles top-down, so the faces stretch in Blender: the engine won't.
4. **Paint the cliff layer** where the faces are (the template paints cliffs01 by slope, rocks01 as debris at the foot), or leave it to a slope rule ([Procedural rules](terrain-procedural-rules.md)); bake the AO, which darkens the cliff's foot.

## Export

_Export Block_ ([the locked settings](terrain-blocks-blender.md#export)); a `TRIMESH` block's stub says `"collider": { "type": "TRIMESH" }`, and its GLB isn't held to `resolution²` vertices. Smooth normals across a cliff's rim give a smooth gate band; a hard edge gives a hard switch.

## Import into Ækasha

A layer's `projection` replaces the material's, so typically only the cliff layer has one. From code:

```ts
import { createTerrainMaterial, getTerrainQualityPreset } from 'aekasha/toolkit/terrain';

createTerrainMaterial({
  id: 'canyon',
  layers: [
    { set: 'sand01' },
    { set: 'cliffs01', projection: { mode: 'TRIPLANAR', slopeGate: [35, 50] } },
  ],
  blend: { source: 'RULES', rules: [{ layer: 1, slope: { min: 40, softness: 8 } }] },
  quality: getTerrainQualityPreset({ cliffLayers: [1] }),
});
```

In the JSON route, the layer's settings in `staticDefines.terrain.layers[1]`:

```json
"layers": [{}, { "projection": { "mode": "BIPLANAR", "slopeGate": [30, 45], "normalBlend": "RNM" } }]
```

A material-wide `projection` projects every layer (a structure's, a rock's). Projection needs `uv: 'WORLD'` (the default): it's refused under `MESH_UV`.

## Set-up and parameters

`projection` (material-wide or a layer's):

| Field         | What it is                                                                                                                                | Default                     |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `mode`        | `PLANAR`, `BIPLANAR` or `TRIPLANAR`                                                                                                       | `PLANAR`                    |
| `sharpness`   | The facing weights' sharpness, 1..32: higher narrows the bands where planes blend. Uniform `terrain_l<i>_projectionSharpness`             | `BIPLANAR` 8, `TRIPLANAR` 4 |
| `slopeGate`   | `[from, to]` degrees, 0..90: planar under `from`, projected past `to`, mixed between. Uniform `terrain_l<i>_slopeGate`                    | None (projected everywhere) |
| `normalBlend` | `WHITEOUT` (Golus's whiteout), `UDN` (cheapest, flattens strong normals a little) or `RNM` (reoriented normal mapping, the most accurate) | `WHITEOUT`                  |

**Tiers:** a tier's material-wide `projection` doesn't reach a layer that has its own; its `layers[i]` entry does. `getTerrainQualityPreset({ cliffLayers, cliffGate? })` writes those entries: `LOW` `BIPLANAR` gated, `MEDIUM` and `HIGH` `TRIPLANAR` gated, `ULTRA` `TRIPLANAR` ungated, the gate `[35, 50]` by default.

**With sparse sampling** ([Splat map](terrain-splat-map.md#sparse-sampling)) every projected layer's projection must be alike (its mode and normal blend); planar layers mix in (their gate closed), and an ungated projected layer gets a gate that's always open. An ungated `BIPLANAR` layer in a gated slot pays the planar tap too (3 taps, not 2).

## Variations

- **Triplanar vs biplanar:** `TRIPLANAR` blends all three planes, smooth everywhere, 3 taps. `BIPLANAR` keeps the two that matter (2/3 of the cost) and switches the third out where it weighs nothing; the gallery shows no seam where it switches. `BIPLANAR` for `LOW` and wide views, `TRIPLANAR` for close faces.
- **The slope gate:** the right default for terrain. Below the gate the layer costs a planar tap, so a cliff layer that also covers gentle ground (scree at a cliff's foot) doesn't pay three taps there. Pick the gate from the land: start where planar's stretch begins to show (about 30–35°) and end where the faces are (45–50°). The `PROJECTION` debug view shows the band in light diagonal stripes.
- **Sharpness:** higher for sharp-edged rock (narrow blends, less ghosting where planes overlap), lower for soft, rounded forms.
- **Normal blend:** `WHITEOUT` is the default; `RNM` for strong rock normals seen close (it keeps their depth), `UDN` when every instruction counts.
- **HEX on a projected layer:** the planes × the hex taps, 9 samples a slot for `TRIPLANAR`. Gate it, or keep `HEX` on the dominant layer (`apply: 'DOMINANT'`, [Splat map](terrain-splat-map.md#hex-on-the-dominant-layer)).
- **Everything projected:** a material-wide `TRIPLANAR` for rocks, boulders and structures that face every way ([Structure materials](structure-materials.md)).

## Pitfalls and checklist

- [ ] Only the layers on steep faces projected; their gate set from the land.
- [ ] `uv: 'WORLD'`: projection refuses `MESH_UV`.
- [ ] A directional set (strata) checked on faces turned away from an axis: there its plane is mirrored (the normal stays right).
- [ ] The preset's `cliffLayers` names the projected layers, so every tier projects them.
- [ ] `PROJECTION` shows the gate's band at the cliffs' foot and rim, not across open ground.
- **"is BIPLANAR: it projects the world, which needs uv WORLD (not MESH_UV)":** the material, a layer or a tier has `MESH_UV`.
- **"… sparse sampling and DOMINANT project every projected layer alike, so they take one mode and normal blend":** two projected layers in different modes or normal blends under sparse sampling; planar layers are fine.
- **Streaks on a cliff face:** the face's layer is planar (or its gate starts too steep): a rule-laid cliff layer needs its own `projection`.
- **Soft ghosting on faces at 45° to two axes:** `TRIPLANAR`'s blend band; raise `sharpness`.

## Template file and example asset ids

- **Blender template:** `src/toolkit/terrain/blender/terrain_triplanarCliff.blend` (its README text block mirrors this page's Blender steps; the block workflow: [Terrain blocks from Blender](terrain-blocks-blender.md)). `terrainBlockTest`'s `terrainBlockTestTrimesh` is a generated `TRIMESH` block.
- **The projection helpers** the material builds on: `triplanarProjection` and `blendProjections` on `aekasha/toolkit/materials`.
- **The gallery's Cliffs row** (`terrainGallery`, `?isDebug=true&startScene=terrainGallery`; `src/app/scenes/terrainGallery/cliffsRow.ts`): four 40 m blocks on one generated mesa (a face of about 85° facing +x down to 48° facing −x), `cliffs01` in `PLANAR`, `BIPLANAR`, `TRIPLANAR` and `TRIPLANAR` gated `[30, 50]`. Its tab switches the normal blend and the gated block's mode, has sliders for both sharpnesses and the gate, camera poses above, off the steep face and off the gentle one, and lists each block's fetches; the Debug view select shows `PROJECTION` and `TAPS`. The Rules row's `cliffs01` layer is gated `TRIPLANAR` `[35, 50]`.
