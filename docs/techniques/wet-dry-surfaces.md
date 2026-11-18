# Wet and dry surfaces

Ground that darkens and glosses in the rain, puddles in its low spots with rings where the drops land, rivulets down cliffs and walls, a wet band along a shore, snow on the flats and frost on the stones, then all of it drying again under the sun. One global weather state drives it, and any material reads it: the terrain material through its `wet` key, a TSL material of your own through one node.

It comes in two halves:

- **The engine's surface conditions** (`aekasha/surface`): the `surfaceConditions()` feature holds the state (wetness, rain, puddle level, water level, snow cover, temperature, drying rate, wind), simulates it (rain wets, the sun and the wind dry, snow melts) or leaves it to the app, and gives materials stable uniforms. The `rainOcclusion()` feature adds a depth map from above, so what's under a roof stays dry.
- **The toolkit's wet response** (`aekasha/toolkit/terrain`): `applySurfaceWetness` turns a dry surface and its texture set's response into a wet one. The terrain material and structure materials call it for their `wet` key.

## What it is

What water does to a surface (Lagarde, "Water drop 2a/2b", 2012–2013), and what the material copies:

1. **Porous surfaces soak water up first** (sand, soil, concrete). Water in the pores lets light scatter deeper and be absorbed: the albedo **darkens**, strongly on sand and mud, barely on dense stone. The roughness falls only a little.
2. **When the pores are full, a film forms on top.** The film is smooth: the roughness falls toward water's (0.05), and the small bumps fill in, so the detail normal **flattens**. Water's F0 (0.02) is close to a dielectric's (0.04): the specular colour hardly changes, the gloss does.
3. **Puddles stand in the low spots**, between pebbles and in ruts, on flat ground: a water surface (roughness 0.02, the geometry's normal) over a slightly darker floor, with rings while it rains.
4. **Dense surfaces skip the first stage** (ice, polished stone, metal): a film at once. Surfaces that shed water (grass, a cliff face) get little film or none.
5. **Drying runs the other way:** the film first, then the pores; peaks and sunny, windy faces first, cavities and shade last. Sand dries fast, mud slowly.
6. **Rain reaches what faces the sky.** Overhangs and undersides stay dry; vertical faces get no puddles but **streaks** running down.
7. **Snow** covers flat ground first. Above freezing it turns to grey, glossy slush, and its meltwater wets the ground around it. Below freezing, **frost** whitens and roughens dense surfaces, its crystals glinting.

How the material composes it, per pixel, after the layers are blended:

```text
 snow cover        snowCoverage vs slope + relief + drift noise ──► the snow set mixed in (it wets as slush)
       │
 exposure          the geometry's facing (shelter) × open sky (the rain occlusion map, optional)
       │
 wetness           (conditions.wetness × exposure)^dryingSpeed, floored by regional / the shore's damp band
       │            + the relief (low first) + the cavities
       ├─► pores   albedo × (1 − wetDarkening × pores), roughness down to wetRoughness
       ├─► film    × puddleResponse: roughness to 0.05, the normal 60 % flat
       ├─► puddle  puddleLevel × puddleResponse over the relief, flat ground, in patches: 0.02, flat, 15 % darker
       ├─► ripples where water stands while it rains: the normal tilted by two atlas taps
       ├─► streaks steep faces: damp rivulets (pores), running water while it rains (film, 25 % darker)
       └─► shore   along waterLevel: the wash (a puddle), saturated sand (a film), a damp band (regional)
       │
 frost             below 0 °C: 12 % toward white, roughness up to 0.6, × (1 − porosity); sparkle near the camera
```

- **The response is per layer.** Each texture set's `surface` holds five numbers (porosity, darkening, wet roughness, puddle response, drying speed), from its category unless it gives its own. The terrain material blends them by the layers' weights like any other layer output, so a beach blends sand's response with rock's.
- **The state is global and simulated on the CPU.** The material reads its uniforms and the surface clock (ripples, streaks' pulses, the shore's waves), which stops with the app loop and restarts at every scene.
- **Every part compiles only when its key is there.** Ripples, streaks, snow and the sparkle sit in dynamic branches on the weather, so a dry frame samples none of their textures.

## Best for

|                      | Good fit                                                                                                                                                          | Poor fit                                                                                                                          |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Art style            | Photoreal and stylized PBR: the darkening and the gloss read on any lit surface. Stylized games take `SIMPLE` (the darkening and the gloss, no relief or puddles) | Unlit and flat-shaded styles: there's no gloss to show, only a darker tint, which a colour swap gives for less                    |
| Game type and camera | First and third person, where the gloss, puddles and ripples read close-up; weather-driven games: survival, open worlds, racing on wet tracks                     | Top-down and RTS: puddle reflections and rings barely read from above. Take `SIMPLE`, or `wet: {}` with no puddles or ripples     |
| World size           | Any: one state for the world, the cost per pixel; the occlusion map follows the camera                                                                            | Regional weather (rain here, sun there): the state is global. A `regional` wetness keeps places wet, but no zone has its own rain |

## Performance

- **Fetches per pixel** ([the formula](README.md#the-performance-formula)'s `W`):

  | Part                    | Key                    | Fetches                                                                  | Where they happen                                             | Qualities                |
  | ----------------------- | ---------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------- | ------------------------ |
  | Wetness, film, exposure | `wet`                  | 0                                                                        | Every pixel: about 20 ALU                                     | Both                     |
  | Puddles                 | `puddles`              | 0; 1 with `patches` (the macro texture's B)                              | Every pixel                                                   | `FULL`                   |
  | Regional wetness        | `regional`             | 0 (a vertex attribute, or the splat map's A it has already)              | Every pixel                                                   | Both                     |
  | Ripples                 | `ripples`              | 2 (the ripple atlas)                                                     | Only where water stands within 10–30 m, while it rains        | `FULL`                   |
  | Streaks                 | `streaks`              | 1 (the macro texture's R); 2 where a face turns between the x and z axes | Only on faces steeper than 60°, while it's wet or rains       | Both                     |
  | Shoreline               | `shoreline`            | 0                                                                        | Every pixel: about 25 ALU and two value noises                | Both                     |
  | Snow                    | `snow`                 | `P` (the snow set's packing)                                             | Only under the cover, nearer than a far surface               | Both                     |
  | Frost                   | `frost`                | 0                                                                        | Every pixel: a few ALU; the sparkle in a branch within 4–10 m | Both; the sparkle `FULL` |
  | Rain occlusion          | `rainOcclusion: 'MAP'` | 1 (a compare fetch)                                                      | Every pixel                                                   | Both                     |

  The gallery's mud block (`mud02`, `LITE`, one layer, no anti-tiling) with puddle patches, ripples, snow and the map: 2 + 1 + 1 = **4** where it's dry or no water stands, 4 + 2 = **6** where it rains on standing water, 4 + 2 = **6** under snow. The `TAPS` view measured 4 under the gallery's canopy and 6 around it in the rain.

- **ALU:** the parts without a fetch are arithmetic: the wetness and its stages about 20 instructions (the study's estimate), the shoreline about 25 with two value noises, the snow's drift two more, the sparkle a hash and a dot per pixel near the camera.
- **The rain occlusion map** (the gallery's 512² map over 64 m, three small occluders, rendering every frame): 0.26 ms CPU a render on average (three's projection walks the whole scene, so it grows with the scene's object count, not the occluders), 0.005 ms GPU. At the default of one render every 30 frames, about 0.01 ms CPU a frame. Memory: the 512² depth texture (1 MiB) and its R8 colour target (0.25 MiB).
- **CPU:** the state's system runs once a frame in `MAIN`, allocating nothing; the uniforms are written in place.
- **VRAM:** the ripple atlas (256², about 0.09 MB), the macro noise (0.35 MB, shared with the macro variation and the rules' noise) and the snow set (`snow01`, about 2.7 MB at 1K `LITE`).
- **Bindings:** the macro texture 1 (shared), the ripple atlas 1, the snow set `P`; all in the material's [budget](terrain-splat-map.md#storage-and-the-binding-budget). The map's depth texture isn't in that count: leave room for it in `reservedTextures` (default 6, with the shadow maps and the environment).
- **Measured GPU time:** not yet. p310's camera presets time every page.
- **Quality tier:** `SIMPLE` for `LOW` (see Variations).

## Maps

The wet response has no maps of its own per surface: the response is five numbers in each texture set's `surface`. What it samples is shared:

| Map                | Required                     | Packing                                                                                             | Colour space | Codec                    | Size                     |
| ------------------ | ---------------------------- | --------------------------------------------------------------------------------------------------- | ------------ | ------------------------ | ------------------------ |
| Ripple atlas       | With `ripples`               | `rippleAtlas` (`bakeRippleAtlas`): RG the direction from the drop, B the falloff, A the time offset | Linear       | UASTC, RDO off           | 256²                     |
| Macro noise        | With puddle patches, streaks | `macroNoise` (`bakeMacroNoise`): R an fbm (the streaks), B large patches (the puddles)              | Linear       | UASTC, RDO off           | 512²                     |
| Snow set           | With `snow`                  | Any texture set, its own packing (default `snow01`); a far surface needs its `averageColor`         | As its set   | As its set               | 1K                       |
| Regional wetness   | With `regional`              | A float vertex attribute `_WETNESS` (0..1), or the first splat map's A                              | Linear       | The mesh's / the splat's | Per vertex / the splat's |
| Rain occlusion map | With `rainOcclusion: 'MAP'`  | Made at runtime by `rainOcclusion()`                                                                | —            | A depth texture          | 512² (`size`)            |

The macro noise and the ripple atlas are the toolkit's committed KTX2 textures ([Procedural textures](procedural-textures.md)); the code route picks them by default, and a scene with a code-route wet material lists them in its `textures`.

## Blender, step by step

Only the regional wetness is authored: riverbanks, a swamp's floor, the ground under a waterfall, places wet in any weather. Start from any block ([Terrain blocks from Blender](terrain-blocks-blender.md)); there is no template of its own.

1. **A vertex group to paint:** _Object Data → Vertex Groups → +_, named `Wet`. Weight Paint mode paints it: 1 where the ground is always wet, 0 where the weather decides, with the _Blur_ brush (or a _Gradient_) softening the edge over 2–3 m. A weight is easier to paint and blur than a colour channel.
2. **Copy it into `_WETNESS`** with a Geometry Nodes modifier, last in the stack: _Group Input_ → _Store Named Attribute_ (_Float_, _Point_, name `_WETNESS`, its value from a _Named Attribute_ node reading `Wet` as _Float_) → _Group Output_. The leading `_` is glTF's rule for a custom attribute. The modifier keeps the topology, so Validate accepts it.
3. **Check it:** the _Spreadsheet_ editor (_Evaluated_, _Vertex_) shows a `_WETNESS` column in 0..1.
4. **Or paint the splat map's alpha** on a block painted by a splat map of at most 4 layers (the base and R, G, B): the first map's A weighs no layer, so it's free for the wetness. Paint it with the brush's _Add Alpha_ blend ([Splat map](terrain-splat-map.md#blender-step-by-step)), white where it's always wet. No geometry needed, and the edge as fine as the map's texels.

## Export

The add-on's _Export Block_ ([the locked settings](terrain-blocks-blender.md#export)) applies the modifiers and exports `_`-prefixed attributes. By hand: _Data → Mesh_: Apply Modifiers ✓, Attributes ✓. The attribute is `_WETNESS` in the glTF; three's GLTFLoader names it `_wetness` (it lowercases a custom attribute's name), which is the material's default. The asset pipeline keeps it, quantized to a normalized 16-bit integer (a value outside −1..1 is left as a float, with a warning).

**Not checked yet:** no scene loads a `_WETNESS` from a GLB yet: the gallery's riverbank band is written into its generated geometry in code. Check the first painted block with the `WETNESS` view.

## Import into Ækasha

**The features**, listed at boot: `surfaceConditions()` right after `skyBox()`, and `rainOcclusion()` right after it if anything shelters. The template lists both. The sun source makes drying follow the sky box's sun; the template sets it in `appECSPlugins`' install:

```ts
import { InitEngine } from 'aekasha';
import { getSunElevation, skyBox } from 'aekasha/skybox';
import { rainOcclusion, setSurfaceSunSource, surfaceConditions } from 'aekasha/surface';
import { textureSets } from 'aekasha/texturesets';
import { appData } from './generated';

InitEngine({
  data: appData,
  features: [
    skyBox(),
    surfaceConditions(),
    rainOcclusion(),
    textureSets(),
    {
      id: 'app',
      // Drying is fastest under a high sun and slowest at night
      install: () => setSurfaceSunSource(() => getSunElevation()),
    },
  ],
  start: async () => {},
});
```

**A terrain material** (code route), with puddles in patches, ripples, snow, frost and the map, and `SIMPLE` on the `LOW` tier:

```ts
import { createTerrainMaterial, getTerrainQualityPreset } from 'aekasha/toolkit/terrain';

const preset = getTerrainQualityPreset();
createTerrainMaterial({
  id: 'valleyGround',
  layers: [{ set: 'mud02' }, { set: 'rocks01' }],
  blend: { source: 'RULES', rules: [{ layer: 1, slope: { min: 22, softness: 8 } }] },
  wet: {
    puddles: { patches: { scale: 30 } },
    ripples: {},
    snow: {},
    frost: { sparkle: {} },
    rainOcclusion: 'MAP',
  },
  quality: {
    ...preset,
    // A tier's wet replaces the material's whole: SIMPLE takes no puddles, ripples or sparkle
    LOW: { ...preset.LOW, wet: { quality: 'SIMPLE', snow: {}, frost: {}, rainOcclusion: 'MAP' } },
  },
});
```

The code route takes the shared textures by default (`noiseTexture: 'macroNoise'`, `rippleTexture: 'rippleAtlas'`, `snowSet: 'snow01'`), so a scene using it lists `macroNoise` and `rippleAtlas` in its `textures` and `snow01` in its `textureSets`.

**The JSON route** names them as inputs (`macro`, `ripples`, `snow`), the rest in the define:

```json
{
  "mat": "terrain",
  "matOverrides": {
    "inputs": {
      "layer0": { "textureSet": "mud02" },
      "macro": { "texture": "macroNoise" },
      "ripples": { "texture": "rippleAtlas" },
      "snow": { "textureSet": "snow01" }
    },
    "staticDefines": {
      "terrain": {
        "layers": [{}],
        "wet": { "puddles": { "patches": { "scale": 30 } }, "ripples": {}, "snow": {} }
      }
    }
  }
}
```

**Streaks on a structure** (a wall, a boulder; [Structure materials](structure-materials.md)):

```ts
import { createStructureMaterial } from 'aekasha/toolkit/terrain';

createStructureMaterial('concrete02', {
  id: 'damWall',
  wet: { streaks: {}, rainOcclusion: 'MAP' },
});
```

**A scene's starting conditions** in its JSON (the gallery's), applied before its scene code on every visit:

```json
"surfaceConditions": { "mode": "MANUAL", "wetness": 0.6, "puddleLevel": 0.6, "waterLevel": 0.15 }
```

**A TSL material of your own** wets its surface with `applySurfaceWetness`, the node the terrain material calls. A `normal` given to it comes back flattened by the film, in the space it was given (with `geometryNormal` in that space too); without one, the result has none:

```ts
import { getSurfaceConditionNodes } from 'aekasha/surface';
import { applySurfaceWetness } from 'aekasha/toolkit/terrain';

// In the material's setup: dry when the feature isn't installed
const conditions = getSurfaceConditionNodes();
if (conditions) {
  const wet = applySurfaceWetness(
    {
      albedo,
      roughness,
      height,
      response: { porosity: 0.7, wetDarkening: 0.6, wetRoughness: 0.15 },
    },
    conditions,
    { puddles: { maxSlope: 10 } }
  );
  material.colorNode = wet.albedo;
  material.roughnessNode = wet.roughness;
}
```

**At runtime**, the weather:

```ts
import { getSurfaceConditions, setSurfaceConditions, startRain, stopRain } from 'aekasha/surface';

startRain(0.8, { rampSec: 10, durationSec: 90 }); // a shower that stops by itself
stopRain({ rampSec: 20 });
setSurfaceConditions({ temperature: -4, snowCoverage: 0.6 }, { transitionSec: 120 });
const isSlippery = (getSurfaceConditions()?.wetness ?? 0) > 0.5;
```

## Set-up and parameters

**The material's `wet`** (the terrain material and structure materials; a tier override replacing the material's whole):

| Key               | What it is                                                                                                                                                                      | Default                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `quality`         | `FULL`: the relief and the cavities shape the wetness, the film flattens the normal. `SIMPLE`: the response and the exposure only; refuses `puddles`, `ripples` and the sparkle | `FULL`                      |
| `heightInfluence` | How far the relief moves the wetness: low spots wet that much ahead, peaks behind (`FULL`)                                                                                      | 0.5                         |
| `cavityInfluence` | How much wetter a full cavity (1 − the AO) is, × the wetness (`FULL`)                                                                                                           | 0.5                         |
| `shelter`         | Angles from straight up, `[from, to]`: fully wet to `from`, dry past `to` (a wall half, an underside dry)                                                                       | `[60, 120]`                 |
| `puddles`         | `{ maxSlope, edge, patches: { scale, amount } }`: flat ground to `maxSlope`°, the rim over `edge` of the relief; `patches` the macro's B, `scale` metres a tile                 | 15°, 0.05; patches 0.75     |
| `regional`        | `{ attribute }` (a float vertex attribute) or `{ splatChannel: 'A' }`: the least wetness and puddle level shown                                                                 | `_wetness`                  |
| `ripples`         | `{ scale, lifetime, strength, distance }`: metres an atlas tile, seconds a ring, the normal's tilt, the fade `[from, to]` from the camera                                       | 1.5 m, 0.7 s, 0.5, 10–30 m  |
| `streaks`         | `{ minSlope, scale, length, speed }`: the gentlest face, metres across a tile, its stretch down, m/s of the running water's pulses                                              | 60°, 4 m, 8, 1 m/s          |
| `shoreline`       | `{ band, noise, runUp: { height, period } }`: metres damp above `waterLevel` (required), the waterline's wander, the waves' reach and seconds apart                             | —, 0.3 m; 0.5 m every 6 s   |
| `snow`            | `{ maxSlope, noiseScale, edge, tiling }`: the steepest slope it rests on, the drift noise's cell, the cover's edge, the set's tiling                                            | 55°, 3 m, 0.08, 1           |
| `frost`           | `{ temperature: [from, to], strength, sparkle: { density, strength, distance } }`: none at `from` °C, full at `to`; crystals a metre, their glint, the fade                     | `[0, −5]`, 1; 50, 3, 4–10 m |
| `rainOcclusion`   | `NORMAL_Y`: the facing alone. `MAP`: also the `rainOcclusion()` map (one fetch): no rain, puddles, ripples or snow under cover                                                  | `NORMAL_Y`                  |

Every number is a uniform in the material's `userData.uniforms` (`terrain_wetShelter`, `terrain_wetPuddleMaxSlope`, …). The code route's `noiseTexture`, `rippleTexture` and `snowSet` name the textures (refused when nothing reads them). The occlusion map scales the exposure, the puddle level, the ripples' rain and the snow cover, never a regional wetness, the shoreline or the meltwater: they aren't rain.

**A texture set's response** (`surface` in its `*.textureSet.json`; the gatherer fills a missing field from the category, `TEXTURE_SET_WET_RESPONSES`):

| Category   | `porosity` | `wetDarkening` | `wetRoughness` | `puddleResponse` | `dryingSpeed` | What it does                                           |
| ---------- | ---------- | -------------- | -------------- | ---------------- | ------------- | ------------------------------------------------------ |
| `SAND`     | 0.9        | 0.55           | 0.45           | 0.3              | 1.6           | Darkens strongly, stays rough, few puddles, dries fast |
| `MUD`      | 0.7        | 0.6            | 0.15           | 1                | 0.4           | Glossy soon, puddles in every low spot, dries slowly   |
| `ROCKS`    | 0.4        | 0.35           | 0.2            | 0.6              | 1             | Puddles between the stones                             |
| `CLIFF`    | 0.2        | 0.25           | 0.15           | 0                | 1.2           | No film or puddles; streaks                            |
| `SNOW`     | 0.5        | 0.25           | 0.3            | 0.5              | 0.6           | Wet means slush                                        |
| `ICE`      | 0          | 0.1            | 0.02           | 1                | 1             | A film at once: a mirror when it melts                 |
| `GRASS`    | 0.6        | 0.35           | 0.35           | 0.2              | 0.8           | Sheds water, stays rough                               |
| `CONCRETE` | 0.5        | 0.45           | 0.15           | 0.7              | 0.9           | Puddles in low spots; streaks on walls                 |
| `OTHER`    | 0.5        | 0.5            | 0.3            | 0.5              | 1             | The flat defaults                                      |

- `porosity` sets the stages: the pores fill over the first `porosity / 2` of the local wetness, the film over the rest; 0 films at once. Frost takes `1 − porosity`: ice fully, sand little.
- `wetDarkening` is how much full pores darken the albedo; `wetRoughness` the roughness with them full (never above the dry roughness).
- `puddleResponse` is how readily water stands: × the film and × the puddle level.
- `dryingSpeed` is a power on the wetness the surface shows (`wetness ^ dryingSpeed`): 0 and 1 stay, sand shows less of the same weather and mud more.

**The surface conditions** (`setSurfaceConditions`, a scene's `surfaceConditions`; reset to these at every scene's exit):

| Field          | What it is                                                                                    | Default     |
| -------------- | --------------------------------------------------------------------------------------------- | ----------- |
| `wetness`      | 0..1, the overall wetness                                                                     | 0           |
| `rain`         | 0..1, the rain's intensity: wets in `SIMULATED`, ripples and runs down streaks in either mode | 0           |
| `puddleLevel`  | 0..1, how full the puddles are: follows the wetness with a lag in `SIMULATED`                 | 0           |
| `waterLevel`   | The world Y of a shore's water, or `null` for none                                            | `null`      |
| `snowCoverage` | 0..1                                                                                          | 0           |
| `temperature`  | °C: snow melts above 0 (into wetness), slush to 3, frost below 0                              | 15          |
| `dryingRate`   | Wetness dried a minute in full sun and still air                                              | 0.1         |
| `wind`         | `[x, z]` m/s: faster drying (× 1 still to × 3 at 20 m/s)                                      | `[0, 0]`    |
| `mode`         | `SIMULATED`: the system moves the values. `MANUAL`: only the app does                         | `SIMULATED` |

- **The simulation** (per minute of the surface clock): rain wets at its intensity (dry to soaked in a minute at 1); drying is `dryingRate × sun × wind × (1 − rain)`, the sun factor `clamp(sin(elevation), 0.2, 1)` from the sun source (1 without one); puddles rise toward the wetness at 0.5 and drain at half the drying; snow melts 0.02 a °C above 0, all of it into the wetness.
- **Transitions:** `setSurfaceConditions(values, { transitionSec })` moves each number linearly; a value set while one moves restarts from where it is, and the simulation leaves a moving value alone. `mode` and a water level from or to `null` switch at once. Out-of-range values are clamped.
- **The time source:** `surfaceConditions({ timeSource })`: `APP` (default) stops the clock and the simulation with the app loop's pause, `MAIN` only with the master loop's. Neither advances while a scene loads.

**The rain occlusion map** (`rainOcclusion(opts)`; out of range throws at the call):

| Option         | What it is                                                                         | Default |
| -------------- | ---------------------------------------------------------------------------------- | ------- |
| `size`         | Texels a side, 16–4096                                                             | 512     |
| `extent`       | Metres a side, centred on the camera (snapped to the texels)                       | 64      |
| `height`       | Metres above and below the camera the map covers                                   | 100     |
| `updateFrames` | Frames between renders; 0 renders only on a move or `requestRainOcclusionUpdate()` | 30      |
| `bias`         | Metres a surface may sit under the map's depth and stay open                       | 0.05    |

- **Occluders** are what casts shadows (`castShadow`), overridden per object by `userData.rainOccluder` (`true` or `false`). Roofs, trees and bridges usually cast shadows; water planes and helpers usually don't.
- **It renders** only once a material reads it: first, then when the camera has moved an eighth of the extent (or of the height), every `updateFrames` frames, and on request. `setRainOcclusionEnabled(false)` makes every material read open sky and stops the renders.

## Variations

- **`SIMPLE` for the `LOW` tier:** `wet: { quality: 'SIMPLE', … }` in the tier. It reads no relief, cavity or normal: no puddles, ripples or sparkle (refused), the film without the flattened normal. Streaks, the shoreline, snow, frost, a regional wetness and the map stay. Why: the darkening and the gloss are most of the look; the puddles' and the film's math and the ripples' taps are the cost. Effect: the wetness at 0 fetches.
- **Puddles without ripples:** leave `ripples` out. The puddles still stand flat and glossy. Why: a game without rain on screen (the morning after), or a camera too far for the rings (they're a few pixels from 5 m). Effect: 2 gated fetches and a binding fewer.
- **Wetness only, for top-down:** `wet: {}` (or `SIMPLE`). From above, a puddle reflects a flat patch of sky and the rings are pixels: the darkening and the gloss are what read. Effect: no fetch at all.
- **Streaks only on structures:** `streaks` on the walls' and cliffs' materials, not the ground's. The ground has few faces past 60°, and its material then binds no macro texture for them. Effect: one gated fetch on steep faces of the materials that have it.
- **Places wet in any weather:** `regional`, painted ([Blender](#blender-step-by-step)). Riverbanks and swamps stay wet and their puddles full while the rest dries. Effect: none (a vertex attribute, or the splat map's A already fetched).
- **Weather from the game:** `mode: 'MANUAL'`. Nothing is simulated; the app (a weather system, a mission script) sets every value, with transitions. The gallery runs `MANUAL` so nothing dries it.
- **Shelter by facing or by map:** `NORMAL_Y` (the default) keeps overhangs and undersides dry for free; `MAP` keeps the ground under roofs, bridges and trees dry too, for one fetch a pixel and the map's renders. Open terrain needs only the facing.
- **A still shore:** `shoreline: { band }` without `runUp`: a waterline that wanders along the shore but doesn't move.
- **Winter without rain:** `wet: { snow: {}, frost: { sparkle: {} } }` and a temperature below 0: the snow covers dry ground, no wetness shows on frozen snow.

## Pitfalls and checklist

- [ ] `surfaceConditions()` is listed (else every wet material builds dry, warned once), and `rainOcclusion()` after it for `MAP` (else `MAP` falls back to the facing, warned once).
- [ ] The sun source is set, or drying runs at night as fast as at noon.
- [ ] A scene with a code-route wet material lists `macroNoise` and `rippleAtlas` in its `textures` and the snow set in its `textureSets`.
- [ ] `TAPS` in the rain stays where the material's budget planned it (ripples on standing water, snow under the cover).
- [ ] The occluders cast shadows or have `userData.rainOccluder`.
- **A bright or dense set hardly darkens on screen:** its gloss reflects the sky back. Snow, ice and cliffs read wet by their gloss, not their colour (measured on the gallery at wetness 1: 4–5 % darker, mud 43 %).
- **Puddles read little against a full film from far away** (0.02 against 0.05 roughness): the ripples are what mark them in the rain.
- **Puddles that look like holes:** there are no screen-space reflections (a p990 follow-up), so a puddle reflects only the environment. Keep them in the open, under the sky; their darkening is capped at 15 % for this.
- **Snapshots are stable:** the rings, the streaks' pulses and the waves run on the surface clock, which restarts at every scene and which the test bridge's `freeze()` holds, so the scene runner's snapshots of a wet scene are the same on every run.
- **A material in `OBJECT` space** streaks and tiles its snow in its own space (it sticks to the piece), but its gates read the world's up, and the shoreline and the map the world's position.
- **A far surface and snow:** past the far band the snow is its set's `averageColor` (the reader refuses a set without one there).
- **The colour-map bake** strips `wet`: a block's colour map is the dry surface.
- **The map renders the whole scene's projection:** its CPU cost grows with the scene's object count. Raise `updateFrames` on a large scene, or set it to 0 and request a render when something moves.
- **Not seen yet:** a shadow-casting ground in the map (the gallery's row casts no shadows; the bias and a 1.5-texel push along the normal are meant to keep the ground open over itself).
- **Gameplay:** the state is visual and runs at frame time. Wet friction or anything else that changes the simulation needs the step clock and seeded random streams, as the engine's physics code does (not part of this).

## Template file and example asset ids

- **Blender template:** none of its own; any block and the steps above. The add-on's _Export Block_ exports the attribute.
- **The gallery's Wet/dry row** (`terrainGallery`, `?isDebug=true&startScene=terrainGallery`; `src/app/scenes/terrainGallery/wetRow.ts`): a 3 × 3 of library blocks left of the Splatting row, `sand02`, `mud02`, `rocks01` / `cliffs01`, `snow01`, `ice01` / `grass01`, `concrete02` and a beach (`sand02` with `rocks01` on slopes past 22°), each with puddles in patches, ripples, snow, frost and the map, a `LOW` tier with `SIMPLE`. The grass block has a regional riverbank band, the beach a shoreline under a water plane; a concrete wall and a cliff boulder streak; a concrete canopy over the mud keeps it dry. Its tab section ("Wet/dry row") has the wetness, rain, puddle level, snow cover, temperature and water level, the row's quality and view (shaded, `WETNESS`, `TAPS`), the map's switch and each block's response.
- **The debug drawer's Surface conditions tab:** a rain shower (10 s up, 60 s, 10 s down), stop rain, dry now, soak, snowfall; every value and the mode; the surface clock, the sun and wind factors; the map's switch, update frames and its render's CPU and GPU time.
- **Assets:** `rippleAtlas`, `macroNoise` and `snow01` (the toolkit's); every library set's category gives its response.
- **The code:** `src/_engine/features/surface/` (the state, the map), `src/toolkit/terrain/nodes/Wet.ts` and the parts beside it (`Ripples.ts`, `Streaks.ts`, `Shoreline.ts`, `Snow.ts`, `Frost.ts`), `src/toolkit/terrain/material/TerrainWet.ts` (the terrain material's wiring).
