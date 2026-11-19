## Installing it

List [`textureSets()`](api:textureSets), from `aekasha/texturesets`, in `InitEngine`'s `features`
(see [How the app starts](hub:examples/quick-start#how-the-app-starts)). Without it, a scene whose
data names a set fails the boot, naming the feature (see
[the feature manifest](hub:features/scenes-and-assets#the-feature-manifest)), and a material made
in code with a `{ textureSet }` input fails to build. The lookups and loads below work without it.

Terrain blocks are a feature of their own: [`terrain()`](api:terrain), from `aekasha/terrain`
(the template lists it last). A scene listing blocks names it in its manifest, and one whose
blocks have a collider names `physics()` too; the collider's code loads with the first block that
has one, so an app without physics (a landscape embed) loads no Rapier for its blocks. The
toolkit's block generators register from an install with
[`registerTerrainGenerators()`](api:registerTerrainGenerators) (the template's `appECSPlugins`).
A block with a [scatter](#terrain-scatter) needs [`instancing()`](api:instancing) too, and the
toolkit's scatter generator registers the same way, with
[`registerTerrainScatter()`](api:registerTerrainScatter). [Decal sets](#terrain-decals) are
`terrain()`'s; the toolkit's runtime decal pools are merge groups, so they need
[`merging()`](api:merging).

## A texture set

A `*.textureSet.json` names its textures per packing and slot, and holds the surface's physical
facts. The toolkit's `sand01`:

<<< src/toolkit/textures/sand01/sand01.textureSet.json

- **`physicalSize`** is the metres one tile covers, `[width, height]`: sets from different scans
  line up in scale because of it.
- **`heightScale`** is the metres of relief a height of 1 stands for (the height is stretched to
  0..1 when packing).
- **`packings`** names a texture asset's id per slot, in one to three packings. A material
  samples one; `defaultPacking` (else `LITE`) is the one a scene listing the set loads.
- **`surface`** holds the defaults a material copies into uniforms: `tint` (sRGB, multiplied into
  the albedo, so it can only darken), `normalStrength`, `roughnessScale`, `aoStrength`,
  `heightContrast` and the wet response (`porosity`, `wetDarkening`, `wetRoughness`,
  `puddleResponse`, `dryingSpeed`; the set's category's when not given).
- **`category`** (`SAND`, `MUD`, `ROCKS`, `CLIFF`, `SNOW`, `ICE`, `GRASS`, `CONCRETE`, `OTHER`)
  is for the terrain tools' defaults and grouping.
- **`averageColor`** is measured by the [asset pipeline](hub:features/asset-optimization) from the
  default packing's albedo; give one in the JSON to override it. A material gets it as a uniform
  (linear), for a colour map's detail and a far surface's colour. A procedural set has none.

### The packings

| Packing   | Textures | Slots and channels                                                                      | For                                                |
| --------- | -------- | --------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `FULL`    | 3        | `albedoHeight` (RGB albedo, A height), `normal` (RGB), `orm` (AO, roughness, metalness) | Hero surfaces close to the camera; structures      |
| `LITE`    | 2        | `albedoRough` (RGB albedo × AO, A roughness), `normalHeight` (RG normal XY, B height)   | The terrain default: every camera, height blending |
| `MINIMAL` | 1        | `albedoHeight` (RGB albedo × AO, A height); the normal a bump from the height, or flat  | Stylized, top-down, low-end                        |

Normals are OpenGL (+Y), as three.js's. `LITE` and `MINIMAL` bake the AO into the albedo when
packing, which saves a texture per layer per sample: it then darkens direct light too, and stacks
with a screen-space AO pass. The handbook's
[AO into albedo](repo:docs/techniques/texture-sets.md#ao-into-albedo-step-by-step) says when that's
fine and what to do when it isn't.

## Packing the maps

Each slot is an ordinary `*.texture.json` whose `pack` builds it from the source maps (see
[Pack channels](repo:docs/techniques/asset-optimization.md#pack-channels)), encoded to KTX2 by
the asset pipeline. The `LITE` albedo of `sand01` multiplies the colour by the AO and puts the
roughness in its alpha:

<<< src/toolkit/textures/sand01/sand01_albedoRough.texture.json

- **Every slot uses the `terrainLayer` profile:** UASTC at 1024 px, from 2K sources (the resize
  averages out JPEG artifacts and gives clean mips). Its `data` slot is UASTC λ 1, for `LITE`'s
  `normalHeight`, which isn't a `normal` slot: its B is the height, not Z.
- **A source without an AO map** gets one from its height: a `cavity` on the multiply (or a
  channel) darkens the texels lower than their blurred surroundings (`radius`, `strength`).
- **`yarn fetchTextureSources`** downloads a set's maps from ambientCG or Poly Haven, named by the
  `source.json` beside its JSON, into its gitignored `source/raw/` (cached in
  `.cache/texture-downloads/`); `--scaffold` writes the recipes its packings name. A clone needs
  neither: it uses the committed outputs, matched by their recipe.

Making a set, [from a provider](repo:docs/techniques/texture-sets.md#from-a-provider) or
[from your own Blender bake](repo:docs/techniques/texture-sets.md#blender-step-by-step), and
[tuning its size, relief and tint](repo:docs/techniques/texture-sets.md#set-up-and-parameters),
is the handbook's.

## Using a set

**In a TSL material:** an input `{ "textureSet": "sand01" }` (with `"packing": "FULL"` for another
than the default) gets the packing's textures by slot and the set's fields as uniforms, as one
object ([`TextureSetInput`](api:TextureSetInput)). A scene lists only the material: the gather
adds the packing's textures (see
[a scene's textures](hub:features/scenes-and-assets#a-scene-s-textures)).

**The baseline material**, the toolkit's `textureSetSurface`, draws one set: albedo × `tint`,
the normal, roughness × `roughnessScale` (at most 1), `FULL`'s AO through `aoStrength`. Give a
mesh its set with `matOverrides`, which shares the material's shader:

```json
{
  "mat": "textureSetSurface",
  "matOverrides": { "inputs": { "surface": { "textureSet": "rocks01" } } }
}
```

Its static defines: `tiling` is `"WORLD_XZ"` (the default: the world's `(x, −z)` over
`physicalSize`, so a set tiles on across meshes, for terrain) or `"UV"` (the mesh's UVs, in
metres, for walls and structures); `minimalNormal` is `"BUMP"` (the default) or `"FLAT"` for
`MINIMAL`. It has no anti-tiling: it's the baseline the terrain techniques are compared against.

**In a scene:** `"textureSets": ["sand01", "grass01"]` loads each set's default packing with the
scene, for code that uses them.

**From code:** [`loadTextureSetAsync`](api:loadTextureSetAsync) loads a packing's textures (owned
by the calling scene, released with it),
[`getTextureSetPackingTextures`](api:getTextureSetPackingTextures) returns them by slot once
loaded, and [`getTextureSet`](api:getTextureSet) the set's data. A production build has only the
sets its scenes list or their materials name.

```ts
import { getTextureSet, loadTextureSetAsync } from 'aekasha/texturesets';

const textures = await loadTextureSetAsync('cliffs01', { packing: 'FULL' });
const { physicalSize, heightScale } = getTextureSet('cliffs01')!;
```

## Set arrays

A terrain material that blends many layers runs out of texture bindings (a shader stage has 16,
shadow maps and the environment included). A set array puts several sets of one packing into one
array texture per slot, so `LITE` binds 2 textures for up to 16 layers:

- **In a material:** `{ "textureSetArray": ["sand01", "grass01", "rocks01"], "packing": "LITE" }`
  is built with the scene's load; a scene's `textureSetArrays` lists one by `id` (with
  `swappable`), which an input names as `{ "textureSetArray": "<id>" }`. The material gets the
  arrays by slot, `layerCount`, and every layer's fields (its `averageColor` too, mid-grey for a
  set without one) as one uniform array
  ([`TextureSetArrayInput`](api:TextureSetArrayInput); read a layer's with
  [`getTextureSetLayerParams`](api:getTextureSetLayerParams)).
- **From code:** [`buildTextureSetArray`](api:buildTextureSetArray) builds one (two builds of the
  same list share it); a `swappable` one changes a layer with
  [`setTextureSetArrayLayer`](api:setTextureSetArrayLayer), at the cost of a CPU copy as large as
  its VRAM.
- **Every layer** needs the packing, and every slot the same size, mip count and codec: the build
  fails naming the slot and each layer's set otherwise.

## Writing a terrain material

The [terrain material generator](hub:features/terrain#terrain-materials) covers most terrains.
For a material of your own, `aekasha/toolkit/terrain` has the pieces `textureSetSurface` is made
of:

- [`sampleTextureSet`](api:sampleTextureSet) decodes a `{ textureSet }` input, or a layer of a
  `{ textureSetArray }` input, at a UV, into `albedo`, `normalTS`, `roughness`, `ao`, `height` and
  the `packing` (null where the packing has none; `isAoBaked` says whether the albedo holds it).
  It applies none of the `surface` fields: the material decides.
- [`transformTangentNormalToView`](api:transformTangentNormalToView) shades a tangent-space normal
  in the frame of the UV it was sampled at. three's `normalMap()` without a `tangent` attribute
  builds its frame from the mesh's own UV, so a normal map sampled at world UVs would be lit from
  the wrong side.
- [`bumpNormalView`](api:bumpNormalView) is `MINIMAL`'s normal: a bump from a height in metres.

## The library

In `src/toolkit/textures/<setId>/`, each with its recipes and `source.json`; the sources and
licences are in `src/toolkit/textures/CREDITS.md`. All `LITE`, three in every packing for
comparing them:

| Set          | Surface          | Source                        | Tile         | Relief  | Packings                |
| ------------ | ---------------- | ----------------------------- | ------------ | ------- | ----------------------- |
| `sand01`     | Dry dunes        | ambientCG Ground080           | 3 m          | 0.057 m | `LITE` `FULL` `MINIMAL` |
| `sand02`     | Coastal ripples  | ambientCG Ground093C          | 3 m          | 0.033 m | `LITE`                  |
| `mud01`      | Soil             | Poly Haven brown_mud_02       | 1.3 m        | 0.04 m  | `LITE`                  |
| `mud02`      | Forest mud       | ambientCG Ground071           | 1.75 m       | 0.009 m | `LITE`                  |
| `rocks01`    | Gravel           | ambientCG Ground079S          | 2 m          | 0.018 m | `LITE`                  |
| `rocks02`    | Stony mud        | Poly Haven brown_mud_rocks_01 | 1.3 m        | 0.037 m | `LITE`                  |
| `cliffs01`   | Grey mountain    | ambientCG Rock051             | 6 m          | 0.16 m  | `LITE` `FULL` `MINIMAL` |
| `cliffs02`   | Dark veined      | ambientCG Rock058             | 6 m          | 0.25 m  | `LITE`                  |
| `snow01`     | Clean            | ambientCG Snow010A            | 3 m          | 0.048 m | `LITE`                  |
| `snow02`     | Wind-shaped      | ambientCG Snow008A            | 4 m          | 0.058 m | `LITE`                  |
| `ice01`      | Lake             | ambientCG Ice002              | 4 m          | 0.006 m | `LITE`                  |
| `ice02`      | Dark lake        | ambientCG Ice003              | 4 m          | 0.004 m | `LITE`                  |
| `grass01`    | Lawn ground      | ambientCG Grass004            | 1.4 m        | 0.002 m | `LITE` `FULL` `MINIMAL` |
| `grass02`    | Forest floor     | ambientCG Ground037           | 2.1 m        | 0.027 m | `LITE`                  |
| `concrete01` | Smooth concrete  | ambientCG Concrete034         | 1.1 × 0.55 m | 0.012 m | `LITE`                  |
| `concrete02` | Damaged concrete | ambientCG Concrete044D        | 2 m          | 0.013 m | `LITE`                  |

- **The cost:** a `LITE` set is 2.67 MB of GPU memory with its mips (`FULL` 4.00 MB, `MINIMAL`
  1.33 MB) and a 1.4–2.5 MB download. A material pays only for the sets it samples, and a
  production build carries only the sets its scenes use.
- **The grass sets are ground**, the soil the blades stand on, not blades. The concretes are for
  structures: `concrete01` isn't square, so it can't join a set array with the others.
- **Visible repetition:** `mud01`, `rocks02` and `concrete01` repeat noticeably at a few tiles,
  which the terrain material's anti-tiling hides (see
  [Terrain materials](hub:features/terrain#terrain-materials)).

## Procedural textures

A surface can also be code: a TSL graph of noise that gives an albedo, a height and a roughness at
any point. The toolkit has ten such **surface generators** (`aekasha/toolkit/terrain`), a
category's worth each: `sandRipples`, `sandFlat`, `mudCracked`, `mudSmooth`, `rockyGround`,
`cliffStrata`, `snowDrift`, `iceSheet`, `grassGround` and `concretePores`. A generator runs three
ways:

| Way      | How                                                                        | Every frame                     | GPU memory (1K `LITE`) |
| -------- | -------------------------------------------------------------------------- | ------------------------------- | ---------------------- |
| Baked    | Rendered once into textures, at the scene's load or from code              | 2 fetches, as an imported set   | 10.7 MB, uncompressed  |
| Exported | The bake saved as PNGs, committed and encoded to KTX2 like any set         | 2 fetches                       | 2.67 MB                |
| Live     | The graph itself in the material, its noise not periodic: it never repeats | The whole graph for every pixel | None                   |

On an M2, a block filling a 1080p view costs about 1 ms of GPU time baked, as an imported set
does, and 8–20 ms live: the handbook's
[measurements](repo:docs/techniques/procedural-textures.md#performance) have every generator's.

**A procedural set** names a generator in place of its textures, and is baked with the scene that
lists it:

<<< src/app/scenes/proceduralSurfaces/p304ProcRipples.textureSet.json

- **`procedural`** takes `generator` (its module is `<id>.generator.ts`; an unknown one fails the
  gather), `params` by name (a number, an sRGB `"#rrggbb"` or a boolean, checked by the generator),
  a whole-number `seed`, a `size` in texels (default 1024) and one `packing` (default `LITE`). Its
  `physicalSize` and `heightScale` are required, as any set's.
- **From there it's a set:** its textures are `<setId>.<slot>` (`p304ProcRipples.albedoRough`),
  a `{ textureSet }` input or `loadTextureSetAsync` gets them, and they're released with the
  scene. The loader shows the bakes ("Baking textures, n / m").
- **Its generator is a chunk of its own**, loaded on the set's first bake: an app without a
  procedural set ships none, and a production build only those its scenes' sets name.
- **A set array refuses one**: an array's layers are assembled from compressed files. Export the
  set to put it in one.

**From code,** [`bakeSurfaceGenerator`](api:bakeSurfaceGenerator) bakes a generator into a
packing and returns the bake with its controls: set params or the seed and rebake, without a
rebuild (the baker renders one bake a frame).
[`createLiveSurface`](api:createLiveSurface) gives the generator's nodes for a material of your
own, at the world's `(x, −z)` over the tile by default, its normal a bump from the height
(`normal: 'TAPS'` and `ao: 'CAVITY'` take a bake's, four and eight more evaluations a pixel):

```ts
import {
  bakeSurfaceGenerator,
  bumpNormalView,
  createLiveSurface,
  sandRipples,
} from 'aekasha/toolkit/terrain';

const sand = await bakeSurfaceGenerator({ id: 'beachSand', generator: sandRipples, seed: 7 });
sand.setParams({ wavelength: 0.2 });
await sand.bake.rebake();

const live = createLiveSurface(sandRipples, { seed: 7 });
material.colorNode = live.albedo;
material.roughnessNode = live.roughness;
material.normalNode = bumpNormalView(live.height.mul(live.heightScale));
```

**Writing a generator:** [`defineSurfaceGenerator`](api:defineSurfaceGenerator) in a
`<id>.generator.ts` module that exports `generator`, anywhere under `src/app/`. Its `build` gets
the point and its params, and writes its noise in cells through `ctx.cells(n)`, which gives the
period that makes the noise tile when baked and none when live, so it never branches on the mode.
The normal and the AO default to the height's. `sandRipples` whole (inside the toolkit it
imports by path; an app's generator imports the same names from `aekasha/toolkit/terrain`):

<<< src/toolkit/terrain/procedural/sandRipples/sandRipples.generator.ts collapse

The noise it's made of is the toolkit's, each function 2D, hashed with integers (safe on
SwiftShader) and tiling at a whole-number `period`: [`valueNoise`](api:valueNoise),
[`gradientNoise`](api:gradientNoise), [`fbm`](api:fbm), [`domainWarp`](api:domainWarp),
[`worley`](api:worley) (F1, F2 and a cell id), [`hash12`](api:hash12) and
[`hash22`](api:hash22), and [`heightToNormal`](api:heightToNormal) and
[`heightToCavity`](api:heightToCavity) for a normal and an AO from a height. The handbook's
[Writing a generator](repo:docs/techniques/procedural-textures.md#writing-a-generator) walks
`sandRipples` line by line.

**Exporting a bake** is the bridge to an imported set: tune a generator in the gallery, press
"Export PNGs" (the engine's [`exportBakedTexture`](api:exportBakedTexture), through the dev file
server), and write a set over the PNGs with two plain texture JSONs. The bake is already packed,
so no recipe: the [steps](repo:docs/techniques/procedural-textures.md#export).

**Two shared textures** for the terrain materials, each committed as KTX2 (list it by id)
and bakeable (another seed or size):

- `macroNoise` (512², [`bakeMacroNoise`](api:bakeMacroNoise)): four tileable noises in RGBA, for
  large-scale brightness, hue, patch masks and dithering.
- `rippleAtlas` (256², [`bakeRippleAtlas`](api:bakeRippleAtlas)): 4 × 4 rain drops;
  [`decodeRippleAtlas`](api:decodeRippleAtlas) animates their rings.

The baked or live data is visual only: GPUs round floats differently, so never read gameplay or a
collider from it. The baker itself is the engine's, for any graph:
[Texture bakes](hub:features/rendering#texture-bakes).

## Terrain materials

[`createTerrainMaterial`](api:createTerrainMaterial) (`aekasha/toolkit/terrain`) builds one
`MeshStandardNodeMaterial` from a config: up to 16 layers of texture sets, how they're weighed and
how each is sampled. Every technique is a build-time branch, so the shader holds only what the
config turns on (one layer without anti-tiling is two texture samples), and every number (tiling,
tint, a rule's slope, a fade distance) is a uniform that changes live.

```ts
import { createTerrainMaterial, getTerrainQualityPreset } from 'aekasha/toolkit/terrain';

const highlands = createTerrainMaterial({
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
      { layer: 1, slope: { min: 26 }, noise: { scale: 18, amount: 0.35, channel: 'A' } },
      { layer: 2, height: { min: 40 }, slope: { max: 38 } },
      { layer: 3, slope: { min: 46 } },
    ],
  },
  antiTiling: { mode: 'DUAL_SCALE' },
  macro: { texture: 'macroNoise', scale: 64 },
  quality: getTerrainQualityPreset({ cliffLayers: [3] }),
});
```

It needs the `textureSets()` feature and is synchronous: the sets' textures must be loaded (a
scene that lists the sets, or `await ensureMaterialDependencies(getTerrainMaterialProps(config))`
first). The handbook has a page per technique, linked from each part below.

### The techniques

| Part         | Config                                                                                                       | What it does                                                                                                                                        | Handbook                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| A layer      | `layers[i]`: `set`, `tiling`, `rotation`, `tint`, `normalStrength`, `roughnessScale`                         | One texture set, tiled at the world's `(x, −z)` over its `physicalSize` (or the mesh's UVs in metres, `uv: 'MESH_UV'`); each number × the set's own | [Single layer](repo:docs/techniques/terrain-single-layer.md)                                                                |
| Anti-tiling  | `antiTiling`: `NONE`, `DUAL_SCALE`, `HEX`                                                                    | A second tap at another scale and angle (2 taps), or Mikkelsen's hex tiling (3 taps, no mip seams)                                                  | [Single layer](repo:docs/techniques/terrain-single-layer.md#variations)                                                     |
| Macro        | `macro`: `{ texture, scale }`                                                                                | One fetch of `macroNoise` at the world's XZ: brightness, hue and roughness over tens of metres, for every layer                                     | [Single layer](repo:docs/techniques/terrain-single-layer.md#variations)                                                     |
| Paint        | `blend.source`: `VERTEX_COLOR` (`RGB_AO`, `RGBA`), `SPLAT_MAP`                                               | Weights from the vertex colour (up to 5 layers, no fetch) or one or two splat maps (up to 9)                                                        | [Vertex colour](repo:docs/techniques/terrain-vertex-color-splat.md), [splat map](repo:docs/techniques/terrain-splat-map.md) |
| Height blend | `blend.mode: 'HEIGHT'` (default), `heightBlendDepth`; a layer's `heightContrast`, `heightOffset`             | Borders that follow the surfaces' relief instead of the weights' gradient                                                                           | [Vertex colour](repo:docs/techniques/terrain-vertex-color-splat.md#set-up-and-parameters)                                   |
| Rules        | `blend.source`: `RULES`, `VERTEX_COLOR_AND_RULES`, `SPLAT_MAP_AND_RULES`; `rules`                            | Layers by slope, height and facing, broken up by a noise channel, composited in order over layer 0 or the paint                                     | [Procedural rules](repo:docs/techniques/terrain-procedural-rules.md)                                                        |
| Projection   | `projection`: `PLANAR`, `BIPLANAR`, `TRIPLANAR`; `slopeGate`, `normalBlend`                                  | Steep faces without streaks: the planes the surface faces, gated by slope so flat ground pays one tap                                               | [Triplanar cliffs](repo:docs/techniques/terrain-triplanar-cliffs.md)                                                        |
| Sparse       | `sparse: { maxLayers }` (2–4)                                                                                | Only the layers weighing most at a pixel are sampled, from a set array                                                                              | [Splat map](repo:docs/techniques/terrain-splat-map.md#sparse-sampling)                                                      |
| Colour map   | `colorMap`: `DETAIL`, `FAR_ONLY`                                                                             | A block's own colour at its UVs under the layers' grey detail, or only far away                                                                     | [Colour map + detail](repo:docs/techniques/terrain-colormap-detail.md)                                                      |
| Distance     | `distance`: `fade`, `far` (`AVERAGE_COLOR`, `COLOR_MAP`), `farBlend`                                         | The detail normals fade out; past the fade the layers aren't sampled at all                                                                         | [Colour map + detail](repo:docs/techniques/terrain-colormap-detail.md#set-up-and-parameters)                                |
| Space        | `space`: `WORLD`, `OBJECT`                                                                                   | Object space for pieces that move or turn                                                                                                           | [Structures](repo:docs/techniques/structure-materials.md)                                                                   |
| Live layers  | a layer's `source: 'PROCEDURAL_LIVE'`, `live`                                                                | Its procedural set's generator in the material: never repeats, no texture memory                                                                    | [Procedural textures](repo:docs/techniques/procedural-textures.md#live-layers-in-a-terrain-material)                        |
| Wet and dry  | `wet`: `quality`, `puddles`, `regional`, `ripples`, `streaks`, `shoreline`, `snow`, `frost`, `rainOcclusion` | The surface conditions on the layers: darker and glossier in the rain, puddles with rings, streaks, a shore, snow and frost                         | [Wet and dry surfaces](repo:docs/techniques/wet-dry-surfaces.md)                                                            |

### The JSON route

The material `terrain` (`src/toolkit/materials/terrain/`) is the same generator for scene JSON:
its static define `terrain` is the config without the id and the texture ids, and the textures are
inputs, so a mesh's variant swaps a block's sets or splat maps without another shader
([`getTerrainMaterialProps`](api:getTerrainMaterialProps) shows what a config becomes):

```json
{
  "mat": "terrain",
  "matOverrides": {
    "inputs": {
      "layer0": { "textureSet": "grass01" },
      "macro": { "texture": "macroNoise" }
    },
    "staticDefines": {
      "terrain": {
        "layers": [{ "tiling": 1.5 }],
        "antiTiling": { "mode": "DUAL_SCALE" },
        "macro": { "scale": 64 }
      }
    }
  }
}
```

- **The inputs:** `layer0`, `layer1`, … (`{ textureSet, packing? }`), or one set array `layers`
  (`{ textureSetArray: [ids], packing }`); `splat0` and `splat1`, `macro` and `colorMap`
  (`{ texture }`).
- **A variant's `staticDefines` replace the base's key by key**, so `terrain` is always the whole
  define. A variant's inputs merge over the base's, so a material with a set array is a material
  JSON of its own, its TSL file the two lines `export const setup = setupTerrainMaterial`
  ([`setupTerrainMaterial`](api:setupTerrainMaterial); a `tslFile` resolves from its JSON's own top
  folder).
- **The define is checked when the material builds**, by hand (no zod in a build), and refused
  naming the field and why.

### The budget and the tiers

- **The texture budget:** a shader stage binds 16 sampled textures, shadow maps and the environment
  included. The material counts its own (the layers' slots, the splat maps, the macro, the colour
  map) against the limit less `reservedTextures` (default 6) and throws listing them. `storage`
  (code route, default `AUTO`) binds each layer's textures (`SEPARATE`) while they fit, else one
  array per slot for all layers (`ARRAY`, a [set array](hub:features/terrain#set-arrays)): `LITE`
  binds 2 for up to 16 layers. A procedural set's layer keeps its own input beside the array.
- **Quality tiers:** a config's `quality` holds overrides per tier (`LOW`, `MEDIUM`, `HIGH`,
  `ULTRA`), and [`getTerrainMaterialVariant(id, level)`](api:getTerrainMaterialVariant) returns a
  tier's material, its own shader. [`getTerrainQualityPreset`](api:getTerrainQualityPreset) is the
  suggested table:

  | Tier     | Anti-tiling                 | Layers a pixel | `cliffLayers`      | `far` from | `liveLayers` |
  | -------- | --------------------------- | -------------- | ------------------ | ---------- | ------------ |
  | `LOW`    | `NONE`                      | 2              | `BIPLANAR`, gated  | 60 m       | The bake     |
  | `MEDIUM` | `DUAL_SCALE`                | 3              | `TRIPLANAR`, gated | 120 m      | The bake     |
  | `HIGH`   | `HEX` on the dominant layer | 3              | `TRIPLANAR`, gated | 200 m      | Live         |
  | `ULTRA`  | `HEX` on all                | 4              | `TRIPLANAR`        | None       | Live         |

  On an 8-layer terrain at 1080p (Windows Chrome, an AMD RDNA 3 GPU), `LOW` cost about half of
  `MEDIUM`, `HIGH` about a fifth more than `MEDIUM` (1.7 ms for the whole frame) and `ULTRA` 1.7–2.6
  × `HIGH`. A tier reaches a layer's own anti-tiling, projection and source through its `layers`
  entries; its material-wide fields replace the material's.

### Wet and dry surfaces

A material with `wet` follows the weather of the
[surface conditions](hub:features/surface-conditions) feature: the rain darkens the layers as
their pores fill and glosses them as a water film forms, puddles stand in the low spots with rings
while it rains, rivulets run down steep faces, a shoreline washes along the water level, snow
covers the flat ground and frost the stones. Each layer responds by its texture set's `surface`
(`porosity`, `wetDarkening`, `wetRoughness`, `puddleResponse`, `dryingSpeed`, from its category
unless the set gives its own), blended by the layers' weights, so sand soaks and dries fast, mud
glosses and holds puddles, and a cliff only streaks.

```ts
import { createTerrainMaterial } from 'aekasha/toolkit/terrain';

createTerrainMaterial({
  id: 'valleyGround',
  layers: [{ set: 'mud02' }, { set: 'rocks01' }],
  blend: { source: 'RULES', rules: [{ layer: 1, slope: { min: 22, softness: 8 } }] },
  wet: {
    puddles: { patches: { scale: 30 } }, // puddles fill some places first
    ripples: {}, // rain rings on standing water
    snow: {}, // the toolkit's snow01 over the flats
    frost: { sparkle: {} },
    rainOcclusion: 'MAP', // dry under roofs (the rainOcclusion() feature)
  },
});
```

- **Every part compiles only when its key is there,** and the fetches sit in branches on the
  weather: the ripples' two only where it rains on standing water, the streaks' one on steep faces
  while it's wet, the snow set's under the snow. The wetness itself fetches nothing.
- **`quality: 'SIMPLE'`** (a low tier's) keeps the darkening, the gloss, streaks, snow, frost and
  the shoreline, without the relief, the flattened normal, puddles or ripples.
- **A regional wetness** (`regional`) keeps riverbanks and swamps wet in any weather: a float
  vertex attribute painted in Blender (`_WETNESS`) or a splat map's alpha.
- **A TSL material of your own** gets the same response from
  [`applySurfaceWetness`](api:applySurfaceWetness).

The handbook's [Wet and dry surfaces](repo:docs/techniques/wet-dry-surfaces.md) has each key, what
each part costs, the sets' responses, the Blender side and the variations for each kind of game.

### Colour maps, structures and live layers

- [`bakeTerrainColorMap({ id, mesh, size?, ao? })`](api:bakeTerrainColorMap) renders a block's
  own terrain material at its UVs into `<id>.color`: the block's colour map for `DETAIL` or the far
  surface, used as baked or exported (`exportBakedTexture`) and encoded per block.
- [`createStructureMaterial(layers, opts)`](api:createStructureMaterial) is the material with a
  structure's defaults (object space, `TRIPLANAR`, `DUAL_SCALE`, a macro at 12 m), wear layers
  painted in the vertex colour; [`getStructureMaterialConfig`](api:getStructureMaterialConfig)
  returns the config.
- A **live layer** runs its procedural set's generator per pixel, its set's bake the low tiers'
  fallback; its generator loads with the set's bake, or with
  [`loadTextureSetGeneratorAsync`](api:loadTextureSetGeneratorAsync).

What a technique costs in fetches, the measured GPU time, the maps and the pitfalls are its handbook
page's; the [techniques index](repo:docs/techniques/README.md#which-technique-for-my-game) matches
techniques to game types.

## Terrain blocks

A block is a square grid of the ground (32, 64, 128 or 256 m, `2^n + 1` vertices a side), centred
on its place `(x · size, 0, z · size)`, its vertices moving in height only so its collider is a
heightfield. Neighbours share their edge vertices, so blocks tile a world by their grid
coordinates. The block conventions in full, with the reasons, are the
[block workflow's](repo:docs/techniques/terrain-blocks-blender.md#what-it-is).

### A block's JSON

A `*.terrainBlock.json` ties the block's parts together: its geometry (an imported node, or a
registered generator with its params and seed), its terrain material, the inputs that are the
block's own (its splat map, its colour map, a layer's set: a material variant per block, so blocks
of one biome share the shader), its grid, its collider and its shadows:

```json
{
  "$schema": "../../../../../../.schemas/terrainBlock.schema.json",
  "geometry": { "importedAsset": "valley", "node": "valley" },
  "material": "valleyTerrain",
  "materialInputs": { "splat0": { "texture": "valley_splat0" } },
  "grid": { "x": 0, "z": 0, "size": 64, "resolution": 129 },
  "collider": { "type": "HEIGHTFIELD", "friction": 1.2 },
  "shadows": { "cast": true, "receive": true }
}
```

- **`collider.type`:** `HEIGHTFIELD` (the default: from the geometry's grid, or the generator's),
  `TRIMESH` (the triangles: overhangs and cave mouths, costlier) or `NONE` (a background block).
  The collider is a `FIXED` body on the block's mesh entity.
- **`scatter`:** the block's [scatters](#terrain-scatter) (`*.scatter.json` ids), spawned on it
  after its collider and owned by it.
- **`decals`:** the block's [decal sets](#decal-sets-from-blender) (`*.decalSet.json` ids),
  spawned last at its place and owned by it (`block.decalIds`).
- **The gather** writes each block a scene lists into its data and adds its import, material and
  textures to the scene's lists, so the load brings everything the block needs. Its id is its file
  name.

### Spawning a block

A scene lists its blocks (`"terrainBlocks": ["valley"]`) and its code spawns them with
[`spawnTerrainBlock`](api:spawnTerrainBlock):

```ts
import { spawnTerrainBlock } from 'aekasha/terrain';

const block = await spawnTerrainBlock('valley');
if (!block) return; // the scene was left during the spawn: nothing was kept
// block.meshEntityId, block.physicsEntityId, block.dispose()
```

- The mesh is placed by the block's grid; an imported node's own transform is ignored, with a
  warning. A generated geometry is registered for the scene and disposed with its last mesh.
- The scene's exit deletes the block, its body included, like any entity of the scene; `dispose()`
  deletes it earlier.
- It throws when the scene doesn't list the block, its import has no single mesh for `node`, its
  generator isn't registered, or its collider needs a `physics()` that isn't installed. An imported
  block whose positions are quantized is refused, naming the fix: its importedAsset JSON's
  `"optimize": { "profile": "terrainBlock" }` (lossless, so neighbours' edges stay equal).

### Blocks from Blender

The toolkit's Blender add-on (`src/toolkit/terrain/blender/aekasha_terrain_tools.py`, one file:
_Install from Disk_, Blender 5.3) makes blocks that follow the conventions: _Add Terrain Block_
(the exact grid, triangles along the heightfield's diagonal, top-down UVs, the vertex colour
`Splat`, the custom props), a preview material of the terrain material's layers, _New Splat Map_
for Texture Paint (a second map for layers 5-8), _Bake AO → Splat Alpha_, _Bake Colour Map_, _Split Into Blocks_ (one large
grid into neighbours with shared edges and normals), _Validate_ and _Export Block_ (the glTF
settings locked, the images, and the JSON stubs), and the [decal](#decal-sets-from-blender) tools
(_Add Decal Set_, _Add Decal_, _Export Decal Set_). Nine templates beside it start a block or a
technique, each with a README:

| Template                         | What it shows                                                         |
| -------------------------------- | --------------------------------------------------------------------- |
| `terrain_blockTemplate.blend`    | An empty 64 m block, the preview material, its custom props           |
| `terrain_singleLayer.blend`      | A block shaped by a Displace in world coordinates, one layer          |
| `terrain_vertexColorSplat.blend` | Four layers painted in the vertex colour, the AO baked into its alpha |
| `terrain_splatMap.blend`         | Five layers in a 1K splat map painted in Texture Paint                |
| `terrain_triplanarCliff.blend`   | A heightfield cliff, and a `TRIMESH` neighbour with an overhang       |
| `terrain_colormapDetail.blend`   | A painted block ready to bake its colour map                          |
| `terrain_scatter.blend`          | Rocks scattered by Geometry Nodes on a block's paint, both exports    |
| `terrain_decals.blend`           | A block's decal set: tyre tracks along a curve, quads of nine cells   |
| `structure_concrete.blend`       | Walls and a bunker worn by a vertex colour (structures, not blocks)   |

The workflow step by step, from the set-up to the collider check in the engine, is the
[block workflow](repo:docs/techniques/terrain-blocks-blender.md); each technique's own Blender
steps are on its page.

### Generated blocks

A block's geometry can come from a generator: `"geometry": { "generator": "rulesTerrain",
"params": { … }, "seed": 306 }`. The toolkit's two run on its terrain worker during the spawn:

- **`noiseTerrain`:** seeded simplex octaves (`maxHeight`, `octaves` as `[frequency, amplitude]`
  pairs, `normals`, `skirt`).
- **`rulesTerrain`:** the same heights, with the terrain material's rules evaluated per vertex into
  its vertex colours (`layout`, `rules`) and a horizon AO in `RGB_AO`'s alpha (`ao`), for a
  `VERTEX_COLOR` material.

The noise is sampled at the block's world place with its seed as it is, so blocks of one seed
continue each other in their heights, normals, AO and colours. Your own generator registers with
[`registerTerrainGenerator(id, fn)`](api:registerTerrainGenerator) from an install: it gets the
block's params, seed and grid and returns the geometry (centred, `resolution` vertices a side) and,
when it has the grid at hand, its heightfield.

From code, [`generateTerrain`](api:generateTerrain) (this thread) and
[`generateTerrainAsync`](api:generateTerrainAsync) (the worker; options without functions) build a
grid with world-continuous noise (`center`), a height function or a heightmap
([`loadTerrainHeightmapAsync`](api:loadTerrainHeightmapAsync): raw `R16` or `R32F` from Gaea, World
Machine or World Creator), seamless `HEIGHT_FN` normals, rules into vertex colours
([`evaluateTerrainRulesCPU`](api:evaluateTerrainRulesCPU), the material's math), the horizon AO and
the collider's params (`collider: true`). A 257² block with everything takes about 50 ms, a dropped
frame on the main thread and none on the worker. Options, seeds, costs and when to bake rules into
the colours rather than run them in the shader: [procedural terrain
meshes](repo:docs/techniques/terrain-procedural-meshes.md).

## Terrain scatter

Pebbles, rocks, boulders and leaf litter break up a ground's repetition more than any texture
trick. A block names its scatters (`"scatter": ["valleyPebbles"]`), each a `*.scatter.json`: its
items (a geometry and a material each, with a weight, shadows and an optional collider per
instance) and the source that places them. The block spawns them after its collider, as
[static instances](hub:features/lod#static-instances) in cells of `cellSize` (16 m): an
`InstancedMesh` entity per item and cell, culled and hidden by `lod.cullScreenSize` as a whole,
nothing per frame, deleted with the block.

The toolkit's generator `terrainScatter` places on the block's own mesh:

```json
{
  "items": [
    { "geometry": "rockSmall_a", "material": "rockScatter", "castShadow": true },
    { "geometry": "rockSmall_b", "material": "rockScatter", "castShadow": true }
  ],
  "source": {
    "type": "PROCEDURAL",
    "generator": "terrainScatter",
    "params": {
      "minSpacing": 1.2,
      "density": 0.7,
      "mask": {
        "layers": { "1": 1 },
        "slope": { "max": 35 },
        "noise": { "scale": 8, "amount": 0.6 }
      },
      "scale": [0.6, 1.6],
      "alignToNormal": 0.5,
      "sink": 0.2,
      "tint": 0.15
    },
    "seed": 2
  },
  "lod": { "levels": [{ "screenSize": 0 }], "cullScreenSize": 0.2 }
}
```

Boulders go in a scatter of their own, with a spacing past their size, `"collider": "CONVEXHULL"`
(a `FIXED` body per instance, through `physics()`) and their shadows.

- **Placement:** Poisson-disk candidates `minSpacing` apart over the block (inset by half the
  spacing, so neighbours keep it across their seam), each kept by `density` × its mask: the
  block's terrain material's layer weights (by layer index: its vertex colours, splat maps and
  rules, evaluated on the CPU as the material does), slope and height ranges, and a clustering
  noise that continues across blocks. Each lands on the mesh's own triangle, tilted toward its
  normal by `alignToNormal`, sunk by `sink` of its height, darkened by up to `tint`.
- **Seeds:** the world seed, the block's grid place and the scatter's id, so every block gets its
  own placements, the same on every visit and in any load order.
- **Cost:** about 4 µs a candidate on the main thread during the block's spawn (a dense 64 m
  block at 0.4 m: about 70 ms). `minSpacing` sets it.
- **From Blender:** a Geometry Nodes scatter exported as GPU instances or a point cloud is an
  `IMPORTED` source (`terrain_scatter.blend` has one, masked by the block's paint); hand
  placements are `PLACEMENTS`.

The items:

- **Procedural rocks:** [`generateRock`](api:generateRock) (`PEBBLE` 80 triangles, `ROCK` 320,
  `BOULDER` 1,280), registered as `rockPebble_a..c`, `rockSmall_a..c` and `boulder_a..b` by
  [`saveRockGeometries()`](api:saveRockGeometries) in the scene's code before the spawn.
- **Imported rocks:** Poly Haven's Namaqualand stones and boulder, decimated to the same budgets
  (`namaqualandStones01/StoneA`, …, `namaqualandBoulder02/Boulder`), each with its own maps.
- **The rock material** `rockScatter` ([`setupRockMaterial`](api:setupRockMaterial)): the
  ground's own texture set, triplanar in the rock's own space and anti-tiled, so rocks match the
  ground and cost no texture memory; a macro tint by world position, dust toward the ground's
  colour on top, and the [surface conditions'](hub:features/surface-conditions) wetness and frost.
  An imported rock's material draws its own maps at its UV (`tiling: 'UV'`).
- **Leaf litter:** [`generateLeafCard`](api:generateLeafCard)'s folded card (4 triangles,
  [`saveLeafCardGeometry()`](api:saveLeafCardGeometry)) in the `leafLitter` material: a leaf of its
  atlas per instance, alpha-tested, a share turned brown, wet with the ground.

Without a block, a scene lists a scatter in its `scatters` and spawns it with
[`spawnScatter`](api:spawnScatter) on any target. Choosing the items, tuning the spacing and the
cells, colliders, the Blender steps and the pitfalls: [Terrain
scatter](repo:docs/techniques/terrain-scatter.md).

## Terrain decals

Decals add the unique detail no tiling has, and cost only where they lie: tyre tracks, cracks,
stains, scorch marks, footprints, wet patches. A decal is a small mesh on the surface, UV'd into a
cell of a decal atlas, drawn after the ground (`renderOrder` 10) in a decal material. Ækasha
renders forward, with no G-buffer to project screen-space decals into, so its decals are meshes:
lit, shadowed, culled, merged and wet like any surface.

### Decal atlases and the material

A decal atlas is a [texture atlas](hub:features/asset-optimization) in the `DECAL` packing:
`albedoAlpha` (the albedo in sRGB, the opacity in A) and `normalRough` (the normal's XY, the
roughness, and a **puddle mask** in A: where water collects first, a rut or a print's heel). The
toolkit ships two, each cell's `data` giving its `physicalSize`:

- **`decalsGround`** (2048², 11.2 MB of VRAM): `tireTracks` and `asphaltDamage` from ambientCG
  scans, and twelve generated cells: `crack`, `mudSplatter`, `wetPatch`, `stain01`, `stain02`,
  `scorch`, `footprintBoot`, `footprintBare`, `footprintPaw`, `footprintSnowBoot`, `leafPatch`,
  `iceCrack`.
- **`decalsStructure`** (2048 × 1024): `leak01`-`leak03` from ambientCG, and `formworkMarks`,
  `crack01`, `crack02`, `stain01`, `stain02` generated.

The decal material ([`setupDecalMaterial`](api:setupDecalMaterial); the toolkit's
`decalsGround_blend`, `decalsGround_cutout`, `decalsStructure_blend`, `decalsStructure_cutout`)
samples the mesh's UV in atlas space, so one material draws every cell of its atlas:

- **`BLEND`** (soft decals: stains, tracks): transparent, no depth writes, sorted.
  **`CUTOUT`** (prints, cracks): opaque, alpha-tested, alpha to coverage under MSAA, no sort. Both
  with a polygon offset (factor −1, units −4) against z-fighting.
- **The edge fade** reads the mesh's second UV set, `uv1`, 0..1 over the decal, so a quad's edge
  never shows: **a decal mesh without `uv1` draws nothing**.
- **Wet** by the [surface conditions](hub:features/surface-conditions): its own darkening and
  gloss, frost, rain ripples, and puddles that fill the puddle mask long before the ground's own
  (a boot print 41 % under water at a puddle level of 0.81, the mud around it dry of puddles until
  0.48).
- **A decal's albedo replaces the ground's**, so tint it to its ground: a spawn's `color`, or a
  material JSON of your own with a `tint` input.

The procedural cells come from nine decal generators (`decalCracks`, `decalStain`,
`decalScorch`, `decalMudSplatter`, [`decalFootprint`](api:decalFootprint), `decalWetPatch`,
`decalIceCrack`, `decalLeafPatch`, `decalFormwork`): TSL graphs over the noise library, baked into
both slots by [`bakeDecalGenerator`](api:bakeDecalGenerator) and exported as a cell's PNGs; a
cell's `data` is its recipe (`generator`, `seed`, `params`). Write your own with
[`defineDecalGenerator`](api:defineDecalGenerator).

### Decal sets from Blender

A `*.decalSet.json` is an import's meshes drawn as decals: the add-on's _Add Decal_ makes a plane
UV'd into a cell (a strip along a curve for a cell that tiles, `tireTracks`), subdivided and
shrinkwrapped onto the block, and _Export Decal Set_ writes the GLB and the stubs:

```json
{
  "$schema": "../../../../../.schemas/decalSet.schema.json",
  "importedAsset": "valley_decals",
  "material": "decalsGround_blend"
}
```

A block lists it in `decals` and spawns it with itself; a set of the scene's own goes in the
scene's `decalSets` and spawns with [`spawnDecalSet`](api:spawnDecalSet). Its meshes draw at
`renderOrder` (default 10), receive shadows and never cast; a node's `merge` custom prop merges
them (`CUTOUT` into a `BAKED` group, `BLEND` into a `BATCHED` one).

### Runtime decals

A pool ([`createDecalPool`](api:createDecalPool)) is a [`BATCHED` merge
group](hub:features/mesh-merging#pools-decals-and-other-short-lived-members) of up to `maxDecals`
decals (128), drawn as **one render object**, which recycles its oldest decal when it's full:

```ts
import { spawnTerrainBlock } from 'aekasha/terrain';
import { createDecalPool, createDecalTrail, spawnDecal } from 'aekasha/toolkit/terrain';

const block = await spawnTerrainBlock('meadow');
if (!block) return;
const prints = createDecalPool({
  id: 'prints',
  material: 'decalsGround_blend',
  atlas: 'decalsGround',
});
spawnDecal(prints, {
  target: block,
  position: foot,
  rotation: heading,
  cell: 'footprintBoot',
  lifetimeSec: 20,
});

const tracks = createDecalPool({
  id: 'tracks',
  material: 'decalsGround_blend',
  atlas: 'decalsGround',
  maxDecals: 64,
});
const wheel = createDecalTrail(tracks, {
  target: block,
  cell: 'tireTracks',
  color: '#666666',
  lifetimeSec: 30,
});
// each frame: wheel.addPoint(x, z)
```

- [`spawnDecal`](api:spawnDecal) stamps a patch of the block's own grid under the decal, so it
  follows the ground exactly, without reading more than the cells under it.
  [`spawnRibbonDecal`](api:spawnRibbonDecal) lays a strip along a path, its cell repeating along
  it, and [`createDecalTrail`](api:createDecalTrail) stamps one every 2 m behind a moving point.
  [`spawnMeshDecalAsync`](api:spawnMeshDecalAsync) projects onto any plain mesh with three's
  `DecalGeometry` (loaded on first use; fine on props, costly on large meshes).
- A decal with `lifetimeSec` fades out over its last `fadeSec`; a full pool fades its oldest
  eighth out by their place in line. The pool belongs to its scene: the exit deletes it.
- Visual only: a cell drawn from a list and a missing rotation come from the named stream
  `decals`, so a replayed scene stamps the same decals.
- **Measured** (Windows Chrome, RDNA 3): 128 footprints and 64 track segments are 2 render
  objects; the CPU frame 0.75 ms against 1.74 with a mesh per decal (WebGPU), 0.61 against 1.66
  (WebGL2, one multi-draw a pool); the batch's buffers the same size after 10 minutes of 60
  spawns a second.

Choosing a mode, the atlases' maps and your own decals, the Blender steps, the parameters and
the pitfalls: [Terrain decals](repo:docs/techniques/terrain-decals.md).

## Debugging

- **The gallery** (above): `?isDebug=true&startScene=terrainGallery`. Its packing switch is also
  the check that a normal map is lit from the right side: `MINIMAL`'s bump has no tangent frame,
  so `FULL` and `MINIMAL` disagreeing means a mirrored map or frame.
- **The gallery's Procedural row:** click a generator in its tab's "Procedural surfaces" list to
  fly to its block and tune it: its seed and params as fields, rebaking as they move. "Shows"
  switches the row between the bakes, the generators live (with or without the taps) and an
  imported set of each category; the tab shows the bake's GPU time and memory, "Copy JSON" gives
  the values as a set's `procedural` block, "Export PNGs" writes the bake, and "Measure block"
  times the frame in each mode.
- **The gallery's terrain material rows**, each with a section in the tab: Anti-tiling (`NONE`,
  `DUAL_SCALE`, `HEX`, the macro), Splatting (vertex colours and splat maps, `LINEAR` beside
  `HEIGHT`, 9 layers in a set array), Rules (rules alone, a splat map combo, the 8-layer terrain),
  Cliffs (each projection and the slope gate), Colour map (`DETAIL` and both far surfaces, each
  block's map baked at load), Structures (world and object space, wear, moving pillars), the
  Live block (a procedural layer live or baked) and Wet/dry (a block of each category and a beach
  under the [surface conditions](hub:features/surface-conditions), with streaking pieces and a
  canopy). The tab's Quality select switches every terrain
  block to a tier, and its Debug view select to a view.
- **The debug views** (a config's `debugView`, debug builds only; from code, after
  [`loadTerrainDebugViewsAsync`](api:loadTerrainDebugViewsAsync)): `TEXEL_DENSITY` (texels a metre
  in colour bands over a 1 m checker), `NORMALS`, `WEIGHTS` (each layer's false colour),
  `PROJECTION` (the planes' weights and the slope gate's band), `TAPS` (the texture fetches at the
  pixel, heat-mapped; the wet response's rain ripples count only where it rains on standing
  water, its streaks only on a steep face while it's wet or rains), `LAYER_COUNT` (striped where sparse sampling drops a layer) and `WETNESS`
  (the wet response's stages: red the pores filling, yellow under a film, the blue of a puddle
  over either; needs `wet`). Their code
  is a debug chunk, so a production build has none.
- **The uniforms** are in a terrain material's `userData.uniforms` (`terrain_l<i>_tiling`,
  `terrain_r<i>_slopeMin`, `terrain_macroScale`, …): set a uniform's `value` from code, as the
  gallery's sliders do.
- **The verification scenes:** `proceduralSurfaces` checks every generator in every packing, that
  each bake tiles and its live surface doesn't, and that a procedural set's bake equals the code's;
  `noiseLibrary` tiles each noise 3 × 3 beside its live twin, and checks the shared textures and
  their committed copies. A failure is a console error, so `yarn verify:scenes` fails on it.
- **The blocks' scene:** `?isDebug=true&startScene=terrainBlockTest`: an imported block, a
  generated one with its heightfield, a generated `TRIMESH`, a block from a committed `.r16`
  heightmap, and the add-on's orientation block (red at the engine's −x, −z corner, green at +x,
  −z) through its vertex colour and its splat map, boxes dropped on each. Its tab spawns a 256 m
  block and measures its generation on either thread.
- **A block's collider:** the debug drawer's Physics API tab draws the collider wireframes over the
  blocks; a `HEIGHTFIELD` lies on the mesh between its vertices too.
- **The Blender side:** the add-on's _Validate_ lists what Export refuses and why.
  ::: dev-only
  `yarn verify:blender` runs every operator of the add-on in a background Blender and reads its GLBs
  as the engine does; `devTools/blender/buildTerrainTemplates.py` makes the templates again.
  :::
- **The gallery's Scatter row** (its tab's Scatter section: the weather, dry, wet or soaked, and
  three camera poses): the toolkit's procedural rocks on one half of a block and the imported ones
  on the other, and leaf litter beside it. The LOD tab's boxes show each cell's level and
  culling. `?isDebug=true&startScene=scatterTest` checks scatters as it loads: 20,000 pebbles in
  cells, a Blender scatter exported both ways compared instance by instance, `terrainScatter` on a
  rules block's rock, and a box dropped on a slab's collider.
- **The gallery's decals** (its tab's Decals sections): the Decals row (both atlases' slots, each
  cell outlined and named), the Decals stage (every cell on a mud block and a concrete wall,
  `BLEND` beside `CUTOUT`, with the weathers, switches for the polygon offset and the edge fade,
  and cameras at 1, 50 and 200 m), and the bake bench: a generated cell baked from its data as
  decals on wet mud beside the atlas's copy, its seed and params edited, its data copied and its
  PNGs exported.
- **`terrainBlockTest`'s decal block:** its Blender decal set (two tyre tracks over a ridge) and a
  walk stamping boot prints and cart tracks into two pools (`?tbtDecals=blend|cutout|off`); its
  tab's Runtime decals pane shows each pool's decals and batch. The Merging tab shows a pool as
  any batched group (and unmerged, a mesh per decal).
- **The Assets tab**'s texture info window names the sets, packings and slots a texture fills.
- **The material editor** builds a material's set arrays before previewing it, so a
  `{ textureSetArray }` material shows outside the scene that builds them.

## Key APIs

- [`textureSets`](api:textureSets): the feature.
- [`getTextureSet`](api:getTextureSet), [`loadTextureSetAsync`](api:loadTextureSetAsync) and
  [`getTextureSetPackingTextures`](api:getTextureSetPackingTextures): a set from code.
- [`buildTextureSetArray`](api:buildTextureSetArray),
  [`setTextureSetArrayLayer`](api:setTextureSetArrayLayer) and
  [`getTextureSetLayerParams`](api:getTextureSetLayerParams): set arrays.
- [`sampleTextureSet`](api:sampleTextureSet),
  [`transformTangentNormalToView`](api:transformTangentNormalToView) and
  [`bumpNormalView`](api:bumpNormalView): a terrain material of your own.
- [`defineSurfaceGenerator`](api:defineSurfaceGenerator),
  [`bakeSurfaceGenerator`](api:bakeSurfaceGenerator) and
  [`createLiveSurface`](api:createLiveSurface): procedural surfaces; [`fbm`](api:fbm),
  [`worley`](api:worley) and the rest of the noise; [`bakeMacroNoise`](api:bakeMacroNoise) and
  [`bakeRippleAtlas`](api:bakeRippleAtlas): the shared textures.
- [`createTerrainMaterial`](api:createTerrainMaterial),
  [`getTerrainMaterialProps`](api:getTerrainMaterialProps),
  [`getTerrainMaterialVariant`](api:getTerrainMaterialVariant) and
  [`setupTerrainMaterial`](api:setupTerrainMaterial): the terrain material, its config
  [`TerrainMaterialConfig`](api:TerrainMaterialConfig) and define
  [`TerrainMaterialDefine`](api:TerrainMaterialDefine).
- [`terrain`](api:terrain) (the feature), [`spawnTerrainBlock`](api:spawnTerrainBlock) and
  [`getTerrainBlock`](api:getTerrainBlock): blocks; [`registerTerrainGenerator`](api:registerTerrainGenerator)
  and [`registerTerrainGenerators`](api:registerTerrainGenerators): their generators.
- [`generateTerrain`](api:generateTerrain), [`generateTerrainAsync`](api:generateTerrainAsync),
  [`loadTerrainHeightmapAsync`](api:loadTerrainHeightmapAsync) and
  [`evaluateTerrainRulesCPU`](api:evaluateTerrainRulesCPU): generated terrain;
  [`toHeightfieldColliderParams`](api:toHeightfieldColliderParams): a heightfield from a grid.
- [`spawnScatter`](api:spawnScatter) and [`registerScatterGenerator`](api:registerScatterGenerator)
  (`aekasha/instancing`): scatters; [`registerTerrainScatter`](api:registerTerrainScatter): the
  toolkit's generator; [`setupRockMaterial`](api:setupRockMaterial): the rock material;
  [`generateRock`](api:generateRock), [`saveRockGeometries`](api:saveRockGeometries),
  [`generateLeafCard`](api:generateLeafCard) and
  [`saveLeafCardGeometry`](api:saveLeafCardGeometry): the items.
- [`spawnDecalSet`](api:spawnDecalSet) and [`getDecalSet`](api:getDecalSet) (`aekasha/terrain`):
  decal sets; [`createDecalPool`](api:createDecalPool), [`spawnDecal`](api:spawnDecal),
  [`spawnRibbonDecal`](api:spawnRibbonDecal), [`createDecalTrail`](api:createDecalTrail) and
  [`spawnMeshDecalAsync`](api:spawnMeshDecalAsync): runtime decals;
  [`setupDecalMaterial`](api:setupDecalMaterial): the decal material;
  [`defineDecalGenerator`](api:defineDecalGenerator) and
  [`bakeDecalGenerator`](api:bakeDecalGenerator): decal generators.
- [`getTerrainQualityPreset`](api:getTerrainQualityPreset): the tiers;
  [`bakeTerrainColorMap`](api:bakeTerrainColorMap): a block's colour map;
  [`createStructureMaterial`](api:createStructureMaterial): structures;
  [`applySurfaceWetness`](api:applySurfaceWetness): the wet response;
  [`loadTerrainDebugViewsAsync`](api:loadTerrainDebugViewsAsync): the debug views.

## Related issues

- [Static instance cells aren't light receivers](hub:issues/static-instance-cells-not-light-receivers):
  a point or spot light with object culling over a scatter alone is culled; a block in range keeps
  it on.
- [VSM stripes on unshadowed slopes](hub:issues/vsm-stripes-on-unshadowed-slopes): why the
  gallery's blocks cast and receive no shadows.
- [Texture array image layers premultiplied](hub:issues/texture-array-image-layers-premultiplied):
  a set array of PNG sets can be off by 2 / 255 where the roughness is under 1.
- [Heightfield grid layout](hub:issues/heightfield-grid-layout) (fixed): `generateTerrain`'s
  row-major heights and a `HEIGHTFIELD` collider's layout, now one conversion,
  `toHeightfieldColliderParams`.

## Read more

- The handbook: [Texture sets](repo:docs/techniques/texture-sets.md) (choosing a packing, AO,
  texel density, your own set in Blender, KTX2 settings, the checklist),
  [Procedural textures](repo:docs/techniques/procedural-textures.md) (baked, exported or live,
  what each costs, writing a generator, tiling and seeds, live terrain layers), the terrain
  material's techniques ([single layer](repo:docs/techniques/terrain-single-layer.md),
  [vertex-colour splat](repo:docs/techniques/terrain-vertex-color-splat.md),
  [splat map](repo:docs/techniques/terrain-splat-map.md),
  [procedural rules](repo:docs/techniques/terrain-procedural-rules.md),
  [triplanar cliffs](repo:docs/techniques/terrain-triplanar-cliffs.md),
  [colour map + detail](repo:docs/techniques/terrain-colormap-detail.md) and
  [structure materials](repo:docs/techniques/structure-materials.md)), the weather
  ([wet and dry surfaces](repo:docs/techniques/wet-dry-surfaces.md)), the geometry
  ([terrain blocks from Blender](repo:docs/techniques/terrain-blocks-blender.md) and
  [procedural terrain meshes](repo:docs/techniques/terrain-procedural-meshes.md)), its dressing
  ([terrain scatter](repo:docs/techniques/terrain-scatter.md),
  [terrain decals](repo:docs/techniques/terrain-decals.md)) and the
  [techniques index](repo:docs/techniques/README.md) (which technique for which game).
- The API reference: [`aekasha/texturesets`](hub:documentation/aekasha/texturesets),
  [`aekasha/terrain`](hub:documentation/aekasha/terrain),
  [`aekasha/toolkit/terrain`](hub:documentation/aekasha/toolkit/terrain) and
  [`aekasha/toolkit/geometry`](hub:documentation/aekasha/toolkit/geometry).
- The [toolkit](hub:features/toolkit#terrain): the library and the baseline material among the
  rest.

::: claude-md
:::
