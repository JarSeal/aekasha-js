# Procedural textures

A procedural texture is a surface written as code: a TSL node graph of noise that gives a colour, a height and a roughness at any point. Ækasha runs such a graph three ways. **Baked**, it's rendered once into mipmapped textures (`bakeTexture`, in the engine) and sampled like any texture. **Exported**, that bake is saved as a PNG, committed and encoded to KTX2, so it ships as a compressed texture with no bake at load. **Live**, the graph runs in the material itself for every pixel of every frame, and never repeats.

The toolkit has ten surface generators (sand, mud, rocks, strata, snow, ice, grass, concrete), a noise library that tiles, and two shared generated textures (macro noise, a rain ripple atlas). A procedural texture set is a `*.textureSet.json` that names a generator in place of image files, and behaves like any [texture set](texture-sets.md) from there on.

The Hub's [Terrain page](../../hub/pages/features/terrain/guide.md) has the API; this page is how to choose between the three ways, what each costs, and how to write a generator.

## What it is

```text
                                   ┌─ baked ───── bakeTexture() once ──► RGBA8 textures + mips ──► sampled (2 fetches, LITE)
 <id>.generator.ts                 │              (at load, or from code)        │
 build(ctx, params) ──► albedo ────┤                                              └─ exported ─► PNG ─► KTX2 (yarn assets)
   noise in cells        height    │                                                             an imported set from here on
   (aekasha/toolkit/     roughness └─ live ────── the graph in the material ───► every pixel, every frame, never repeats
    terrain)             ao?, normal?
```

- **A generator** (`defineSurfaceGenerator`) is one `build` function: from a point and its params it returns the surface's albedo, height and roughness, and optionally an AO and a normal (by default both are derived from the height). It never knows which way it runs.
- **Baked**, the point is a texture's uv and the noise is periodic over the tile, so the texture tiles without a seam. The surface is packed into a texture set packing's slots (`LITE`: `albedoRough` and `normalHeight`), channel for channel what an imported set holds: a material can't tell them apart.
- **Live**, the point is the world's position and the noise has no period.
- **The baker** is not only for surfaces: `bakeTexture` renders any node graph into one to four textures (one MRT render), with layers (an array texture) and mips.

## Best for

|                      | Good fit                                                                                                                                                                 | Poor fit                                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Art style            | Stylized PBR; clean, graphic or painterly surfaces; anything where "designed" reads better than "scanned"                                                                | Photoreal up close: a scan holds detail no ten-line graph has                                                                           |
| Game type and camera | Top-down, isometric and RTS (baked, `MINIMAL` or `LITE`); third person (baked); any camera for the shared macro noise                                                    | First-person photoreal on low-end hardware with a **live** surface: 8–20 ms a frame for a full view on an M2 ([measured](#performance)) |
| World size           | Procedural worlds (a seed per biome or per planet, baked when it's entered); game jams and prototypes with no texture budget; large surfaces that must not repeat (live) | A world with dozens of baked sets alive at once: 10.7 MB each at 1K `LITE`, four times an imported set                                  |

### Which way

|                        | Baked at load                                              | Exported (committed KTX2)                    | Live                                                             |
| ---------------------- | ---------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------- |
| What ships             | The generator's code and a set JSON                        | Compressed textures                          | The generator's code                                             |
| Download               | Code only, no texture                                      | As an imported set (1.4–2.5 MB at 1K `LITE`) | Code only, no texture                                            |
| VRAM (1K `LITE`)       | 10.7 MB (uncompressed RGBA8)                               | 2.67 MB (block-compressed)                   | None                                                             |
| At load                | One bake: a pipeline compile and a render (tens of ms)     | A texture load                               | The material's pipeline compile (a larger shader)                |
| Every frame            | 2 fetches, as an imported set                              | 2 fetches                                    | The whole graph per covered pixel                                |
| Tiles                  | Yes, every `physicalSize`                                  | Yes                                          | Never repeats                                                    |
| Mips and anisotropy    | Yes                                                        | Yes                                          | None: fine detail shimmers at a distance                         |
| Changing it at runtime | Set params or the seed and rebake (one bake a frame)       | No                                           | Params and seed are uniforms: the next frame                     |
| In a set array         | No (an array's layers are assembled from compressed files) | Yes                                          | No                                                               |
| Use it for             | Prototypes, jams, seeded worlds, surfaces a player changes | **Shipping a look you've settled on**        | Comparison, large stylized surfaces, never-repeating hero ground |

The usual path: tune a generator baked (the gallery does it with sliders), ship it baked while the look moves, and [export](#export) it once it's settled. The export is the bridge: a unique surface, made in the engine, compressed in VRAM, with no bake at load.

## Performance

- **Fetches per pixel:** baked or exported, a procedural set is a set: `P` per layer (`LITE` 2), in the [formula](README.md#the-performance-formula). Live, none: the cost is ALU.
- **ALU, live:** every noise call is a hash or several per pixel: value and gradient noise 4 corners, an fbm that many per octave, a Worley 9 cells. `sandRipples`, the cheapest, is two fbms and a grain (24 hashes); the cracked and pebbled surfaces add Worley searches. The normal is a bump from the height's screen-space derivatives by default (no extra evaluation); `normal: 'TAPS'` evaluates the height 4 more times and `ao: 'CAVITY'` 8 more, which is what a bake does once per texel and what makes "Live + taps" below two to five times dearer.
- **Measured GPU time** (the gallery's Procedural row, 2026-11-14: an M2, WebGPU, a 1920 × 1080 canvas, one 12 m block filling the view; the mean of 120 frames; an empty frame is the sky alone):

  | Frame GPU ms    | Empty | Imported set | Baked | Live | Live + taps |
  | --------------- | ----- | ------------ | ----- | ---- | ----------- |
  | `sandRipples`   | 2.3   | 3.1          | 2.9   | 10.1 | 40.5        |
  | `sandFlat`      | 1.9   | 3.0          | 2.9   | 10.1 | 29.3        |
  | `mudCracked`    | 2.2   | 3.0          | 2.9   | 15.3 | 78.0        |
  | `mudSmooth`     | 2.0   | 2.9          | 2.8   | 13.9 | 55.1        |
  | `rockyGround`   | 2.0   | 3.0          | 2.9   | 16.0 | 51.2        |
  | `cliffStrata`   | 2.2   | 3.3          | 3.2   | 20.3 | 83.7        |
  | `snowDrift`     | 2.1   | 3.0          | 2.8   | 13.9 | 55.4        |
  | `iceSheet`      | 2.0   | 3.1          | 3.0   | 20.6 | 89.9        |
  | `grassGround`   | 2.0   | 3.0          | 3.2   | 21.6 | 67.4        |
  | `concretePores` | 1.9   | 2.9          | 2.9   | 13.3 | 23.5        |

  A baked surface costs what an imported one does, about 1 ms over the empty frame. A live one costs 8–20 ms: a 60 fps frame's whole budget on this machine, for one layer. Numbers compare within one machine only; measure yours with the gallery's "Measure block".

- **VRAM** (a bake is uncompressed RGBA8, 4 bytes a texel; the mip chain adds a third; an exported set transcodes to 1 byte a texel):

  | One set at 1024²                     | Baked    | Exported (KTX2) |
  | ------------------------------------ | -------- | --------------- |
  | `LITE`                               | 10.7 MB  | 2.67 MB         |
  | `FULL`                               | 16.0 MB  | 4.00 MB         |
  | `MINIMAL`                            | 5.3 MB   | 1.33 MB         |
  | `LITE` at 512²                       | 2.7 MB   | 0.67 MB         |
  | 16 `LITE` sets (the library's count) | 170.7 MB | 41.3 MB         |

  `getBakedTextureMemoryBytes({ size, outputs })` gives a bake's figure before it's made, `bake.memoryBytes` after; the profiler's GPU memory tab lists baked textures with the others. A baked set at 512² takes what an exported one takes at 1024²: on a top-down camera that's the trade to make.

- **The bake itself:** a 1024² `LITE` bake of `sandRipples` takes 25–30 ms of GPU time on the M2, once; its pipeline compiles before it (`compileAsync`, off the frame). The gallery's ten 1024² bakes run inside its load, which is ready in about 2 s. During a scene load a bake renders at once and the loader shows "Baking textures, n / m"; outside a load, bakes queue at one a frame, and rebakes of one id at most every 150 ms (the last request always runs), so a slider can rebake on every change.
- **Download:** baked and live ship no texture. Exported, the 512² `sandRipples` `LITE` round trip was 180 kB and 230 kB of KTX2.
- **Bindings and draw calls:** as an imported set (`P` textures a set); none of its own.
- **Quality tier:** bake size and packing are the tiers (`MINIMAL` at 512² for `LOW`); a live surface is `HIGH`–`ULTRA` only, and only where the measurement says so.

## Maps

What a generator returns, and where a bake stores it (the packings are the [texture sets'](texture-sets.md#the-packings)):

| Output      | Required | What it is                                                                                                 | `LITE`                         | `FULL`             | `MINIMAL`               |
| ----------- | -------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------ | ------------------ | ----------------------- |
| `albedo`    | Yes      | Linear colour, without lighting                                                                            | `albedoRough` RGB, × AO (sRGB) | `albedoHeight` RGB | `albedoHeight` RGB × AO |
| `height`    | Yes      | 0..1; 1 stands for the set's `heightScale` metres                                                          | `normalHeight` B               | `albedoHeight` A   | `albedoHeight` A        |
| `roughness` | Yes      | 0..1                                                                                                       | `albedoRough` A                | `orm` G            | Not stored              |
| `ao`        | No       | 0..1, 1 open. Default: the height's cavity (`heightToCavity`, an 8-tap ring of `cavity.radius` metres)     | In the albedo                  | `orm` R            | In the albedo           |
| `normal`    | No       | Tangent space, +Y along +v. Default: central differences on the height (`heightToNormal`, one texel apart) | `normalHeight` RG              | `normal`           | Not stored              |

Baked textures are RGBA8 with mips, `REPEAT`, the albedo slot sRGB and the others linear. No codec: nothing is compressed until an [export](#export).

## Blender, step by step

None: nothing is authored outside the engine. To use a procedural surface on a Blender-built terrain, export it and use the set as any other.

## Export

A bake's PNGs, written into the repo by the dev server (debug env; `exportBakedTexture` on `aekasha`, or a button):

1. **Tune it in the gallery:** `yarn dev`, `/?isDebug=true&startScene=terrainGallery`, the "Terrain gallery" tab. Click a generator under "Procedural surfaces": the camera flies to its block and its params appear as fields. Pick the packing ("Packing") and the size ("Bake size") you'll ship.
2. **Export:** set "Export folder" to the new set's `source/` (`src/app/textures/sand03/source`) and press "Export PNGs": one PNG per slot (`sandRipples_albedoRough.png`, `sandRipples_normalHeight.png`), level 0, the bytes as baked. A PNG already there with other pixels asks before it's replaced; without the dev file server (a phone on the LAN, a build) the browser downloads the files instead.
3. **Commit the PNGs.** Unlike a library set's fetched maps (`source/raw/`, gitignored), they can't be downloaded again.
4. **Write the set** (next section): the bake is already packed, so each texture JSON names its PNG with `fileName`. No pack recipe.
5. **Encode:** the dev server's gather encodes the new textures at once; run `yarn assets` before committing (it prunes stale outputs) and commit `assets.lock.json` and the outputs.

Export from one backend, WebGPU: the ripple atlas exports byte for byte the same from WebGL2, the macro noise doesn't (its fbm rounds differently in places), so a re-export from the other backend shows up as a changed file.

What the compression costs, measured on that round trip against the exported PNGs: the albedo 1.5 bytes off on average, the roughness 2.3, the normal and the height 3.5 (at most 32, at sharp crests). Nothing a lit surface shows.

## Import into Ækasha

**A procedural set** (baked at load) is a set JSON with `procedural` in place of `packings`, here `src/app/textures/duneSand/duneSand.textureSet.json`:

```json
{
  "$schema": "../../../../.schemas/textureSet.schema.json",
  "id": "duneSand",
  "category": "SAND",
  "physicalSize": [2, 2],
  "heightScale": 0.02,
  "procedural": {
    "generator": "sandRipples",
    "params": { "wavelength": 0.12, "warp": 0.5, "light": "#e0cb98" },
    "seed": 11,
    "size": 1024,
    "packing": "LITE"
  }
}
```

The gallery's "Copy JSON" writes the `procedural` block of the generator you tuned. Use the set like any other: a scene's `"textureSets": ["duneSand"]`, or a material input `{ "textureSet": "duneSand" }`. It's baked with the scene's load (the `textureSets()` feature; its textures are `duneSand.albedoRough` and `duneSand.normalHeight` in the registry) and released with the scene. From code, `loadTextureSetAsync('duneSand')` bakes it; a material made in code must call that first.

The generator's module is loaded on first need, a chunk of its own: an app without a procedural set ships no generator, and a production build only those its shipped scenes' sets name.

**An exported set** is an ordinary imported set whose textures name the exported PNGs. In `src/app/textures/sand03/`, `sand03_albedoRough.texture.json` (and `sand03_normalHeight.texture.json`: the same with `"slot": "data"` and no `colorSpace`):

```json
{
  "id": "sand03_albedoRough",
  "fileName": "./source/sandRipples_albedoRough.png",
  "optimize": { "profile": "terrainLayer", "slot": "baseColor" },
  "texOpts": { "wrapS": "REPEAT", "wrapT": "REPEAT", "colorSpace": "srgb", "anisotropy": "MAX" }
}
```

and `sand03.textureSet.json`:

```json
{
  "id": "sand03",
  "category": "SAND",
  "physicalSize": [2, 2],
  "heightScale": 0.02,
  "defaultPacking": "LITE",
  "packings": {
    "LITE": { "albedoRough": "sand03_albedoRough", "normalHeight": "sand03_normalHeight" }
  }
}
```

Give it the generator's `physicalSize` and `heightScale` (the fields the bake was made with: the normal's depth is baked in). The slots and codecs are the [texture sets' encode](texture-sets.md#the-encode-ktx2-per-slot).

**From code**, without a JSON:

```ts
import { bakeSurfaceGenerator, sandRipples } from 'aekasha/toolkit/terrain';

const sand = await bakeSurfaceGenerator({
  id: 'beachSand',
  generator: sandRipples,
  packing: 'LITE',
  size: 512,
  seed: 7,
});
// sand.bake.textures.albedoRough, .normalHeight: registered as beachSand.<slot>, the scene's
sand.setParams({ wavelength: 0.2 });
await sand.bake.rebake();
```

and live, in a material you build:

```ts
import { bumpNormalView, createLiveSurface, sandRipples } from 'aekasha/toolkit/terrain';

const sand = createLiveSurface(sandRipples, { seed: 7 });
material.colorNode = sand.albedo;
material.roughnessNode = sand.roughness;
material.normalNode = bumpNormalView(sand.height.mul(sand.heightScale));
```

## Set-up and parameters

A set's `procedural`:

| Field       | What it is                                                                                   | Default  |
| ----------- | -------------------------------------------------------------------------------------------- | -------- |
| `generator` | The generator's id: its module is `<id>.generator.ts`. An unknown one fails the gather       | Required |
| `params`    | Values by param name: a number, an sRGB `"#rrggbb"`, or a boolean. The generator checks them | Its own  |
| `seed`      | A whole number: another seed, another surface of the same kind                               | 0        |
| `size`      | Texels, one side or `[w, h]`, 1–8192; a power of two for mips and a later export             | 1024     |
| `packing`   | `LITE`, `FULL` or `MINIMAL`: the set's only packing                                          | `LITE`   |

The set's own `physicalSize` and `heightScale` are required as for any set, and its `surface` fields (tint, normal strength, …) apply as usual.

The toolkit's generators (`aekasha/toolkit/terrain`; each `physicalSize` in metres):

| Generator       | Category | Tile | The surface                                            | Its params (besides its colours)                                      |
| --------------- | -------- | ---- | ------------------------------------------------------ | --------------------------------------------------------------------- |
| `sandRipples`   | SAND     | 2    | Wind ripples over a fine grain                         | `angle`, `wavelength`, `warp`, `grain`                                |
| `sandFlat`      | SAND     | 2    | Beach sand: grain, soft mottling, dark specks          | `grain`, `mottling`, `mottleSize`, `specks`                           |
| `mudCracked`    | MUD      | 2    | Dried plates parted by cracks, curled at the rims      | `plateSize`, `crackWidth`, `curl`, `moisture`                         |
| `mudSmooth`     | MUD      | 3    | Soft lumps, glossy low spots (for puddles, p307)       | `scale`, `lumpiness`, `wetLevel`                                      |
| `rockyGround`   | ROCKS    | 2    | Pebbles on soil, each its own size and colour          | `pebbleSize`, `density`, `colourSpread`                               |
| `cliffStrata`   | CLIFF    | 4    | Bands of rock with bedding lines and cracks, for walls | `strata` and `crackDensity` (static), `undulation`, `bandContrast`    |
| `snowDrift`     | SNOW     | 4    | Soft drifts, blue hollows, sparse glints               | `driftSize`, `sparkle`                                                |
| `iceSheet`      | ICE      | 4    | Deep and pale patches, cracks at two scales, bubbles   | `crackSize`, `fineCrackSize`, `bubbles`                               |
| `grassGround`   | GRASS    | 2    | Clumps of greens over soil, blade streaks              | `clumpSize`, `soilShow`, `streaks`                                    |
| `concretePores` | CONCRETE | 2    | Pores, stains, optional form-work seams                | `poreDensity`, `poreSize`, `stains`, `seams` and `seamCount` (static) |

Every param, with its range, is a field in the gallery's tab. A param marked "(rebuilds)" there is **static**: a build-time value (an octave count, a toggle), so changing it builds the graph again instead of setting a uniform.

## Writing a generator

A generator is a module named `<id>.generator.ts` that exports `generator`: in the toolkit under `src/toolkit/terrain/procedural/<id>/`, in an app anywhere under `src/app/` (next to the set that names it). The gatherer finds it by its file name. Here is `sandRipples` (`src/toolkit/terrain/procedural/sandRipples/sandRipples.generator.ts`), piece by piece (its type casts left out).

```ts
export const generator = defineSurfaceGenerator({
  id: 'sandRipples',
  category: 'SAND',
  physicalSize: [2, 2],
  heightScale: 0.02,
  cavity: { radius: 0.012, strength: 1.2 },
```

The facts a bake uses when a call or a set gives none: a tile covers 2 × 2 m, and a height of 1 is 2 cm of relief, which sets the depth of the default normal. `cavity` tunes the default AO: a 1.2 cm ring, gentle, because ripples have no deep holes.

```ts
  params: {
    angle: { default: 30, min: 0, max: 180, step: 1, label: 'Direction (°)' },
    wavelength: { default: 0.09, min: 0.03, max: 0.4, step: 0.005, label: 'Wavelength (m)' },
    warp: { default: 0.35, min: 0, max: 1.5, step: 0.05, label: 'Warp' },
    grain: { default: 0.35, min: 0, max: 1, step: 0.05, label: 'Grain' },
    light: { type: 'color', default: '#d8c393', label: 'Crest colour' },
    dark: { type: 'color', default: '#a98d61', label: 'Trough colour' },
  },
```

A plain spec per param (no schema library ships with a generator). A number becomes a float uniform and a colour a linear colour uniform, so a slider rebakes without a rebuild; `isStatic: true` or `type: 'boolean'` makes a build-time value instead. `min`, `max` and `step` are checked when the graph is built and give the debug tools their sliders. Write lengths in metres, so the surface keeps its look when `physicalSize` changes.

```ts
  build: (ctx, params) => {
    const radians = params.angle.mul(Math.PI / 180);
    // The waves across the tile along u and v; baked, whole numbers, so the ridges tile
    const waves = vec2(cos(radians), sin(radians)).mul(ctx.tileSize).div(params.wavelength);
    const k = ctx.isLive ? waves : round(waves);
```

`ctx.uv` is the point in tiles. A ripple pattern is a wave along a direction, and a wave only tiles when a whole number of them crosses the tile on each axis: so, baked, the count is rounded (the direction and wavelength you ask for move to the nearest that fit). This is the one place a generator looks at `ctx.isLive`; noise never needs to.

```ts
const broad = ctx.cells(3);
const warp = fbm(broad.p, { period: broad.period, octaves: 3, seed: ctx.seed(1) });
const swell = toUnit(fbm(broad.p, { period: broad.period, octaves: 2, seed: ctx.seed(2) }));
```

`ctx.cells(3)` gives the point in 3 cells a tile, and the period that makes noise there tile: 3 baked, none live. Pass both to every noise. `ctx.seed(i)` is the surface's seed stepped per noise, so two noises of one surface don't line up. Here: a warp that bends the crests, and a swell that varies their height. (`toUnit` maps the fbm's −1..1 to 0..1.)

```ts
const phase = fract(dot(ctx.uv, k).add(warp.mul(params.warp).mul(3)));
// Up the windward slope to the crest, down the lee: 0 at both ends of the cycle
const ridge = smoothstep(0, CREST, phase).mul(float(1).sub(smoothstep(CREST, 1, phase)));
```

The ripple's profile: where in its cycle the point is, then a slow rise to the crest at 72 % and a steep fall, which is what wind does to sand.

```ts
const grains = ctx.cells(ctx.tileSize.x.mul(GRAINS_PER_METRE) as Node<'float'>);
const grain = toUnit(valueNoise(grains.p, { period: grains.period, seed: ctx.seed(3) }));
```

A cell count can be a node: 250 grains a metre times the tile's width, rounded in the shader when baked.

```ts
    const relief = ridge.mul(swell.mul(0.4).add(0.6));
    const height = relief.mul(0.85).add(grain.mul(params.grain).mul(0.15));
    const shade = smoothstep(0.1, 0.9, ridge).mul(0.6).add(0.2)
      .add(grain.sub(0.5).mul(params.grain).mul(0.5)).clamp(0, 1);
    return {
      albedo: mix(params.dark, params.light, shade),
      height,
      roughness: float(0.9).sub(ridge.mul(0.04)).add(grain.sub(0.5).mul(0.08)),
    };
  },
});
```

The outputs. No `normal` and no `ao`: the defaults take them from the height. The albedo holds no lighting, only the material's colour (crests paler than troughs because the grains sort, not because the sun hits them).

**The rules `build` lives by:**

- Build the surface from `ctx` and `params` alone. `build` is called again at other points for the default normal's and AO's taps.
- All noise through `ctx.cells(n)` with its `period`. A noise with no period, or a pattern that doesn't close over the tile, leaves a seam.
- Height in 0..1 using most of the range; albedo linear and unlit; roughness 0..1.
- The noise library is 2D and hashed with integers (no `mx_*` noise: three's fractal noise hangs SwiftShader's WebGL2, and none of it is periodic).

**The noise library** (`aekasha/toolkit/terrain`; `p` in cells, `period` optional):

| Function                                  | Gives                                                     | For                                        |
| ----------------------------------------- | --------------------------------------------------------- | ------------------------------------------ |
| `valueNoise`, `gradientNoise`             | −1..1, one octave                                         | Grain, mottling                            |
| `fbm(p, { octaves, lacunarity?, gain? })` | −1..1 (mostly ±0.5), each octave tiling at its own period | Swells, stains, drifts                     |
| `worley(p, { jitter? })`                  | `f1`, `f2` (cell distances), `cellId` (0..1 per cell)     | Pebbles (`f1`), cracks (`f2 − f1`), plates |
| `domainWarp(p, { strength })`             | The point, bent by an fbm                                 | Wandering cracks, bent bands               |
| `hash12`, `hash22`                        | 0..1 per cell                                             | A per-cell colour, size or toggle          |
| `heightToNormal`, `heightToCavity`        | A normal and an AO from a height function                 | The defaults; your own bakes               |

## Tiling

A baked texture tiles when its graph has the same value at uv and at uv + 1. The noise library guarantees it for a whole-number `period`: the cell lattice wraps at the period, an fbm's octaves each wrap at theirs (period × lacunarityⁱ, rounded), a Worley search wraps its neighbours. A fraction or a negative period throws, since it can't tile.

What it can't guarantee is yours to hold: a wave needs a whole count per axis (`sandRipples`), bands that differ can't be tilted (`cliffStrata` bends them with a periodic noise instead and leaves a tilt to the material's UV), and a seam-count or similar must divide the tile. The `proceduralSurfaces` scene bakes each generator's difference against itself a whole tile away and fails on any texel that differs.

Tiling at `physicalSize` means the surface repeats every 2–4 m, like an imported set: on a wide view, break it up with the terrain material's anti-tiling (p305), or run the surface live.

## Seeds and determinism

- The same generator, params, seed and size give the same texture on one GPU and backend, every time: a seed is a way to name a surface (`seed: 11` is that sand).
- Across GPUs, drivers and backends, float rounding differs. The textures look the same and are not the same bytes (the macro noise differs between WebGPU and WebGL2 on one machine).
- So baked and live procedural data is **visual only**. Never read gameplay, a collider, a spawn point or anything networked from it. Derive those on the CPU from the seed (`getRandomStream`).
- An exported set is the same bytes for everyone: export when it has to be.

## Variations

- **`MINIMAL` at 512²:** one texture, 1.3 MB baked. For a top-down or RTS camera, where 64–128 px a metre is enough. The normal becomes a bump from the height in the material.
- **`FULL`:** the AO in its own map, a full-precision normal. 16 MB baked at 1K: export it rather than baking it at load.
- **Rebaking at runtime:** `bakeSurfaceGenerator` returns the controls (`setParams`, `setSeed`, `bake.rebake()`). A surface that dries, a biome that changes with a seed: one bake a frame at most, no rebuild. Static params need a new bake under a new id.
- **Live with a bake's normal and AO:** `createLiveSurface(generator, { normal: 'TAPS', ao: 'CAVITY' })`. Matches the bake's look close up at two to five times the live cost. For stills and comparison.
- **The shared textures:** `macroNoise` (512², four tileable noises in RGBA for a terrain's large-scale variation and dithering) and `rippleAtlas` (256², 4 × 4 drops for rain rings; `decodeRippleAtlas` animates it). Each is a committed KTX2 texture (list `"textures": ["macroNoise"]`: 0.35 MB of VRAM) and a bake (`bakeMacroNoise()`, registered as `macroNoise.data`: 1.4 MB, exact texels, another seed or size). A material that needs the alpha's exact texels (an ordered dither) bakes; anything else uses the committed one.
- **Your own bake:** `bakeTexture({ id, size, outputs, build })` for anything that isn't a surface: a lookup table, a mask, a flow map, several layers (`layers`, read `ctx.layer`), up to four outputs in one render, `HALF_FLOAT` outputs. The same ownership and queue.

## Pitfalls and checklist

- [ ] Every noise takes `period` from `ctx.cells`; the pattern closes over the tile (check it tiled 3 × 3, or in `proceduralSurfaces`).
- [ ] Lengths are params in metres, not in tiles.
- [ ] The albedo is unlit and in a plausible range: nothing pure black, snow not pure white (compare it with the imported set of its category in the gallery).
- [ ] `heightScale` matches the relief you mean: the default normal's strength is `heightScale / physicalSize`.
- [ ] The bake size is a power of two.
- [ ] The VRAM is counted: baked sets alive at once × their size. Export what you ship in numbers.
- [ ] Exported PNGs are committed, exported on WebGPU, and the set has the generator's `physicalSize` and `heightScale`.
- [ ] Nothing in gameplay reads a baked or live texture.
- **A seam every tile:** a noise without its period, or a count that isn't whole. A seam only in the normal: a height that jumps at the tile's edge.
- **A procedural set in a set array is refused** (at the gather and at run time): an array's layers are assembled from compressed files. Export the set, or keep it on its own binding.
- **"A bake of that id is alive":** `bakeTexture` and `bakeSurfaceGenerator` return the live bake for an id and ignore the new options. Dispose it first, or rebake it.
- **White surface after a scene load:** the bake failed (the console names the set and the generator: an unknown param, a value out of its range); the load goes on without it.
- **Shimmer on a live surface far away:** nothing filters it. Fade to a flat colour or a baked layer with distance, or bake.
- **A queued bake that never renders:** queued bakes run in the main loop, so they wait while the loop is paused or an editor view is open.

## Template file and example asset ids

No Blender template file.

- **The generators:** `src/toolkit/terrain/procedural/<id>/<id>.generator.ts`: `sandRipples`, `sandFlat`, `mudCracked`, `mudSmooth`, `rockyGround`, `cliffStrata`, `snowDrift`, `iceSheet`, `grassGround`, `concretePores`. Copy one into your app to start your own (give it a new id and file name).
- **The noise library:** `src/toolkit/terrain/nodes/noise/`.
- **The shared textures:** `macroNoise` and `rippleAtlas` (`src/toolkit/textures/<id>/`), their bakes in `src/toolkit/terrain/textures/`.
- **The gallery's Procedural row:** `terrainGallery` (`?isDebug=true&startScene=terrainGallery`): each generator on a 12 m block, switched between baked, live, live with taps and an imported set of its category; its params, "Copy JSON", "Export PNGs" and the GPU measurement in the "Terrain gallery" tab.
- **The verification scenes:** `proceduralSurfaces` (every generator in every packing, the tiling and live checks; the procedural sets `p304ProcRipples` and `p304ProcCracks`) and `noiseLibrary` (each noise tiled 3 × 3 beside its live twin, the shared textures and their committed copies).
- **The bake check:** `testDebugScene`'s "Texture bakes" tab (an MRT, layered bake with a rebake slider and its stats).
