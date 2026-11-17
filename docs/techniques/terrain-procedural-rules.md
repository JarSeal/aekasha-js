# Procedural rules

Layers laid down by the surface itself: rocks where it's steep, snow above a height on the slopes facing away from the sun, cliffs on vertical faces, each border broken up by a noise. Nothing is painted, so it works on any mesh, generated ones included, and on top of painted weights for the spots that need art direction.

Everything on [Single-layer terrain](terrain-single-layer.md) applies to each layer, the height blend works as on [Vertex-colour splat](terrain-vertex-color-splat.md#set-up-and-parameters), and many layers need a set array and sparse sampling as on [Splat map](terrain-splat-map.md#storage-and-the-binding-budget).

## What it is

```text
 incoming weights: layer 0 everywhere (RULES), or the paint (VERTEX_COLOR_AND_RULES, SPLAT_MAP_AND_RULES)
        │
        ▼  for each rule, in order:
 coverage = slope test × height test × facing test,   moved by a macro noise channel, × strength
 w = w × (1 − coverage) + onehot(rule's layer) × coverage
        │
        ▼
 height blend (or linear) ──► the layers sampled and blended as any blend
```

- **A rule** names a layer and tests the surface: its **slope** in degrees (0 flat, 90 a wall, from the geometry's normal), its **height** in world metres, its **facing** (the downhill direction within some degrees of a direction), each a range that fades out past its ends. Its coverage is the product of the tests it gives, moved up or down by a **noise** (a channel of the macro noise texture) and scaled by its **strength**.
- **Rules composite in order:** each lays its layer over the weights so far, so a later rule covers an earlier one (snow over rocks, cliffs over both). The height blend afterwards gives the soft masks crisp borders that follow the surfaces.
- **Combos:** `VERTEX_COLOR_AND_RULES` and `SPLAT_MAP_AND_RULES` start from the paint instead of layer 0: paint where it matters (a path, a clearing), rules everywhere. This is what a large world wants.
- **Everything is per pixel:** the rules' numbers are uniforms, so a snow line moves live; the tests are build-time, so a rule without a facing test pays nothing for one.

## Best for

|                      | Good fit                                                                                                         | Poor fit                                                                                    |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Art style            | Photoreal and stylized landscapes whose surfaces follow the land (rock on slopes, snow on tops, sand in hollows) | Hand-placed detail with no relation to the shape: a road, a camp, a burn mark (use a combo) |
| Game type and camera | Procedural worlds, survival and sandbox, flight; any camera; prototypes that need a believable ground on day one | Art-directed hero spots without a painted combo                                             |
| World size           | Any, and the larger the better: zero authoring per block, continuous across blocks, one material per biome       | –                                                                                           |

## Performance

- **Fetches per pixel** ([the formula](README.md#the-performance-formula)): the layers' (`P × L × A × T`) plus one per rule with noise (each at its own scale), plus the paint's splat maps in a combo. 4 `LITE` layers, 3 rules of which 2 with noise: 2·4 + 2 = **10**.
- **ALU:** a rule is a few smoothsteps on values measured once for all rules (the slope's `acos`, the height, the facing's direction), and a multiply-add per layer to composite. No branch: every rule runs on every pixel.
- **Measured GPU time** (p305 Phase 4, 2026-11-16: Windows Chrome 157 on an AMD RDNA 3 GPU, 1280 × 800, a 64 m block filling the frame from 30 m over its top, the median of 90 frames):

  | ms                                                 | WebGPU | WebGL2 |
  | -------------------------------------------------- | ------ | ------ |
  | Empty frame                                        | 0.08   | 0.10   |
  | The block, one layer (`grass01`)                   | 0.10   | 0.12   |
  | Its 4 sets by vertex colour, no rules              | 0.14   | 0.14   |
  | `RULES`, 4 layers, 3 rules (2 noise fetches)       | 0.15   | 0.16   |
  | `SPLAT_MAP_AND_RULES`, 6 layers (`ARRAY`), 3 rules | 0.19   | 0.19   |

  **The rules cost about 0.01 ms over the same layers painted**: per-pixel rules against rules baked into vertex colours on the CPU (the second row is what such a bake costs) are a wash on the GPU. The tiers on the rules blocks and the 8-layer combo (sparse sampling, anti-tiling, gated cliffs): [Splat map's Performance](terrain-splat-map.md#performance); `MEDIUM` costs what the dense layers do, the 8-layer `HIGH` terrain 1.68 ms of a 1080p frame. p310 measures every page with fixed camera presets.

- **VRAM:** the layers' sets and the macro noise (0.35 MB, shared with the macro variation); no per-block texture.
- **Bindings:** the layers' plus the macro texture. 4 `LITE` layers bind 9 separately; more need a set array.
- **Draw calls:** one per block per material.
- **Quality tier:** any. A tier can swap its rules (`quality.LOW.blend`, the whole object), eg. fewer noise fetches.

### Per-pixel rules or rules baked into vertex colours

|                      | Per pixel (this page)                                   | Baked into vertex colours (p306's `generateTerrain` v2, CPU)          |
| -------------------- | ------------------------------------------------------- | --------------------------------------------------------------------- |
| GPU                  | The rules' ALU and noise fetches: about 0.01 ms (above) | None for the weights                                                  |
| Layers               | Up to 16                                                | Up to 5 (`RGBA`)                                                      |
| Border detail        | Per pixel; the noise breaks it up at any distance       | Per vertex, sharpened by the height blend                             |
| Tuning               | Live (uniforms); a moved snow line needs no rebuild     | A rebake of the mesh                                                  |
| Gameplay can read it | No (GPU only)                                           | Yes: the CPU knows each vertex's layer (footstep sounds, spawn rules) |

Same spec either way: the rule type (`TerrainRule`, on `aekasha/toolkit/geometry`) is shared, and p306's CPU evaluation reads the same defaults.

## Maps

| Map                      | Required        | Packing                                                      | Colour space                 | Codec                  | Size |
| ------------------------ | --------------- | ------------------------------------------------------------ | ---------------------------- | ---------------------- | ---- |
| Each layer's texture set | Yes, 2–16       | One packing for all (`LITE` default)                         | Albedo sRGB, the rest linear | UASTC (`terrainLayer`) | 1K   |
| Macro noise              | With rule noise | `macroNoise`: R and G fbms, B patches, A a high-passed noise | Linear                       | UASTC                  | 512² |
| The paint (combos)       | Combos          | Vertex colour or splat maps                                  | Linear                       | As their pages         | –    |

Pick the noise channel by the border you want: R or G for broad, wandering edges (fbm), A for fine, grainy breakup, B for patches with soft but cell-shaped edges.

## Blender, step by step

None for the rules: they're the engine's, on any mesh. The combos' painting is p306's (`terrain-blocks-blender.md`), and generated meshes are p306's `terrain-procedural-meshes.md`.

## Export

None for the rules. A combo's mesh or splat maps: as [vertex colours](terrain-vertex-color-splat.md#export) or [splat maps](terrain-splat-map.md#export).

## Import into Ækasha

From code (the gallery's Rules row, simplified):

```ts
import { createTerrainMaterial, getTerrainQualityPreset } from 'aekasha/toolkit/terrain';

createTerrainMaterial({
  id: 'highlands',
  layers: [
    { set: 'grass01' },
    { set: 'rocks02' },
    { set: 'snow01' },
    { set: 'cliffs01', projection: { mode: 'TRIPLANAR', slopeGate: [35, 50] } },
  ],
  blend: {
    source: 'RULES',
    rules: [
      // Rocks from 26°, their edge broken by the macro noise's fine A channel
      {
        layer: 1,
        slope: { min: 26, softness: 8 },
        noise: { scale: 18, amount: 0.35, channel: 'A' },
      },
      // Snow above 40 m on slopes under 38° that face within 70° of north (−z)
      {
        layer: 2,
        height: { min: 40, softness: 3 },
        slope: { max: 38, softness: 8 },
        aspect: { direction: [0, -1], range: 70, softness: 35 },
        noise: { scale: 40, amount: 0.25 },
      },
      // Cliffs on the steep faces, over everything
      { layer: 3, slope: { min: 46, softness: 6 } },
    ],
  },
  quality: getTerrainQualityPreset({ cliffLayers: [3] }),
});
```

The rules' noise reads the macro texture: the material's `macro.texture` when it has a macro, else `noiseTexture` (code route, default `macroNoise`). The scene lists it, or `ensureMaterialDependencies(getTerrainMaterialProps(config))` loads it.

The JSON route: the same `blend` in `staticDefines.terrain`, the layers' sets as inputs, and the input `macro` (`{ "texture": "macroNoise" }`) for the noise. A combo adds the paint's fields:

```json
"blend": {
  "source": "SPLAT_MAP_AND_RULES",
  "paintedLayers": 3,
  "rules": [{ "layer": 3, "slope": { "min": 26, "softness": 8 } }]
}
```

`paintedLayers` is how many layers the paint weighs, from layer 0 (default: the source's most, 4 for `RGB_AO`, 5 for `RGBA`, 9 for splat maps); every layer past them must be some rule's, or the material refuses it ("nothing weighs it"). The splat maps follow the painted layers (one per four past the base).

## Set-up and parameters

`blend`:

| Field                      | What it is                                                                                        | Default           |
| -------------------------- | ------------------------------------------------------------------------------------------------- | ----------------- |
| `source`                   | `RULES` (layer 0 under the rules), `VERTEX_COLOR_AND_RULES` or `SPLAT_MAP_AND_RULES`; 2–16 layers | `SINGLE`          |
| `rules`                    | 1–16 rules, in compositing order                                                                  | Required          |
| `paintedLayers`            | Combos: the layers the paint weighs from layer 0, 2 or more                                       | The source's most |
| `vertexColor`              | `VERTEX_COLOR_AND_RULES`: `{ layout }`, `RGB_AO` or `RGBA`; `ao.vertex` works with `RGB_AO`       | `RGB_AO`          |
| `mode`, `heightBlendDepth` | As on [Vertex-colour splat](terrain-vertex-color-splat.md#set-up-and-parameters)                  | `HEIGHT`, 0.2     |

A rule (`TerrainRule`); it needs at least one of `slope`, `height`, `aspect` or `noise` (one with none would cover everything):

| Field      | What it is                                                                                                                                                                       | Default softness |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `layer`    | The layer it lays down, by index                                                                                                                                                 | Required         |
| `slope`    | `{ min?, max?, softness? }` in degrees, 0..90: whole between the given ends, fading out over `softness` past each; an end not given is open (`{ max: 30 }`: flat ground)         | 5°               |
| `height`   | `{ min?, max?, softness? }` in world metres (a block's lift moves its snow line)                                                                                                 | 2 m              |
| `aspect`   | `{ direction: [x, z], range, softness? }`: the downhill direction within `range` degrees of `direction`; flat ground has no facing and passes (fading in from 1° to 6° of slope) | 15°              |
| `noise`    | `{ scale, amount, channel? }`: the macro texture's channel at the world's `(x, −z) / scale` moves the coverage by up to `amount` either way, before `strength`                   | Channel `R`      |
| `strength` | The coverage's scale, 0..1: under 1 the layers under it show through                                                                                                             | 1                |

Uniforms per rule, its tests' only: `terrain_r<i>_slopeMin`, `_slopeMax`, `_slopeSoftness`, `_heightMin`, `_heightMax`, `_heightSoftness` (the given ends), `_aspectDirection`, `_aspectRange`, `_aspectSoftness`, `_noiseScale`, `_noiseAmount`, `_strength`. The layer and the noise channel are build-time.

## Variations

- **Combos** (`*_AND_RULES`): paint the few things the land doesn't explain (a path, a camp, a field), rules for the rest. The paint's layers come first; rules can also cover painted layers (snow over a painted path at altitude).
- **Noise on every border:** a rule without noise draws a contour line, which reads as computer-made. 0.2–0.4 of R or G at 30–60 m breaks a snow line; A at 10–20 m roughens a rock edge.
- **Facing:** snow and moss on the shaded side, dry grass on the sunny one. The direction is a world direction: give the one your sun doesn't come from.
- **Strength under 1:** a thin layer over another (dust on rock, frost on grass) without hiding it.
- **Per-pixel vs baked:** bake into vertex colours (p306) when gameplay must know the surface or the GPU budget is tight on many rules with noise; keep them per pixel to tune live and for up to 16 layers.
- **A tier's rules:** `quality.LOW.blend` replaces the whole blend: drop the noise (one fetch a rule) or a rule.

## Pitfalls and checklist

- [ ] Each layer past the painted ones is some rule's.
- [ ] Rules in the order they should cover each other: the cliffs last.
- [ ] Every rule has noise unless a hard edge is the point.
- [ ] Height rules match the world: a block lifted 10 m moves its snow line 10 m.
- [ ] Steep-face layers projected ([Triplanar cliffs](terrain-triplanar-cliffs.md)): world tiling streaks down a cliff.
- [ ] `WEIGHTS` shows every rule laying its layer where it should.
- **"is neither painted nor a rule's layer: nothing weighs it":** a layer past `paintedLayers` with no rule.
- **"give min, max or both":** a range without an end.
- **"give slope, height, aspect or noise":** a rule with no test, which would cover everything.
- **Snow on the wrong side:** the facing is the downhill direction. North-facing slopes are those whose downhill points north.
- **Flat tops getting a facing rule's layer:** flat ground passes the facing test, by design (a flat top has no facing). Add a `slope: { min: 6 }` if it shouldn't.

## Template file and example asset ids

- **Blender template:** none (the engine evaluates the rules); the combos' painting templates are p306's.
- **The rule type:** `TerrainRule`, `TERRAIN_RULE_DEFAULTS` (`src/toolkit/geometry/generate/TerrainRules.ts`, `aekasha/toolkit/geometry`).
- **The gallery's Rules row** (`terrainGallery`, `?isDebug=true&startScene=terrainGallery`; `src/app/scenes/terrainGallery/rulesRow.ts`): three 64 m blocks on one generated terrain with a cliff band: `RULES` (`grass01`, `rocks02`, `snow01`, `cliffs01`), the splat map combo (a sandy path and mud in the hollows painted) and the 8-layer combo (`grass02` patches and ice on south-facing tops added), the toolkit's tier preset on each. Its tab has sliders for the rocks' slope and noise, the snow line and facing, the cliffs' slope and the height blend.
