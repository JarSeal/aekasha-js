## Installing it

List [`textureSets()`](api:textureSets), from `aekasha/texturesets`, in `InitEngine`'s `features`
(see [How the app starts](hub:examples/quick-start#how-the-app-starts)). Without it, a scene whose
data names a set fails the boot, naming the feature (see
[the feature manifest](hub:features/scenes-and-assets#the-feature-manifest)), and a material made
in code with a `{ textureSet }` input fails to build. The lookups and loads below work without it.

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
  `heightContrast` and the wet response (`porosity`, `wetDarkening`, `wetRoughness`).
- **`category`** (`SAND`, `MUD`, `ROCKS`, `CLIFF`, `SNOW`, `ICE`, `GRASS`, `CONCRETE`, `OTHER`)
  is for the terrain tools' defaults and grouping.
- **`averageColor`** is measured by the [asset pipeline](hub:features/asset-optimization) from the
  default packing's albedo; give one in the JSON to override it.

### The packings

| Packing   | Textures | Slots and channels                                                                              | For                                                     |
| --------- | -------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `FULL`    | 3        | `albedoHeight` (RGB albedo, A height), `normal` (RGB), `orm` (AO, roughness, metalness)         | Hero surfaces close to the camera; structures           |
| `LITE`    | 2        | `albedoRough` (RGB albedo × AO, A roughness), `normalHeight` (RG normal XY, B height)           | The terrain default: every camera, height blending      |
| `MINIMAL` | 1        | `albedoHeight` (RGB albedo × AO, A height); the normal a bump from the height, or flat          | Stylized, top-down, low-end                             |

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
  arrays by slot, `layerCount`, and every layer's fields as one uniform array
  ([`TextureSetArrayInput`](api:TextureSetArrayInput); read a layer's with
  [`getTextureSetLayerParams`](api:getTextureSetLayerParams)).
- **From code:** [`buildTextureSetArray`](api:buildTextureSetArray) builds one (two builds of the
  same list share it); a `swappable` one changes a layer with
  [`setTextureSetArrayLayer`](api:setTextureSetArrayLayer), at the cost of a CPU copy as large as
  its VRAM.
- **Every layer** needs the packing, and every slot the same size, mip count and codec: the build
  fails naming the slot and each layer's set otherwise.

## Writing a terrain material

`aekasha/toolkit/terrain` has the pieces `textureSetSurface` is made of, for a material of your
own:

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

| Set          | Surface               | Source                           | Tile          | Relief  | Packings              |
| ------------ | --------------------- | -------------------------------- | ------------- | ------- | --------------------- |
| `sand01`     | Dry dunes             | ambientCG Ground080              | 3 m           | 0.057 m | `LITE` `FULL` `MINIMAL` |
| `sand02`     | Coastal ripples       | ambientCG Ground093C             | 3 m           | 0.033 m | `LITE`                |
| `mud01`      | Soil                  | Poly Haven brown_mud_02          | 1.3 m         | 0.04 m  | `LITE`                |
| `mud02`      | Forest mud            | ambientCG Ground071              | 1.75 m        | 0.009 m | `LITE`                |
| `rocks01`    | Gravel                | ambientCG Ground079S             | 2 m           | 0.018 m | `LITE`                |
| `rocks02`    | Stony mud             | Poly Haven brown_mud_rocks_01    | 1.3 m         | 0.037 m | `LITE`                |
| `cliffs01`   | Grey mountain         | ambientCG Rock051                | 6 m           | 0.16 m  | `LITE` `FULL` `MINIMAL` |
| `cliffs02`   | Dark veined           | ambientCG Rock058                | 6 m           | 0.25 m  | `LITE`                |
| `snow01`     | Clean                 | ambientCG Snow010A               | 3 m           | 0.048 m | `LITE`                |
| `snow02`     | Wind-shaped           | ambientCG Snow008A               | 4 m           | 0.058 m | `LITE`                |
| `ice01`      | Lake                  | ambientCG Ice002                 | 4 m           | 0.006 m | `LITE`                |
| `ice02`      | Dark lake             | ambientCG Ice003                 | 4 m           | 0.004 m | `LITE`                |
| `grass01`    | Lawn ground           | ambientCG Grass004               | 1.4 m         | 0.002 m | `LITE` `FULL` `MINIMAL` |
| `grass02`    | Forest floor          | ambientCG Ground037              | 2.1 m         | 0.027 m | `LITE`                |
| `concrete01` | Smooth concrete       | ambientCG Concrete034            | 1.1 × 0.55 m  | 0.012 m | `LITE`                |
| `concrete02` | Damaged concrete      | ambientCG Concrete044D           | 2 m           | 0.013 m | `LITE`                |

- **The cost:** a `LITE` set is 2.67 MB of GPU memory with its mips (`FULL` 4.00 MB, `MINIMAL`
  1.33 MB) and a 1.4–2.5 MB download. A material pays only for the sets it samples, and a
  production build carries only the sets its scenes use.
- **The grass sets are ground**, the soil the blades stand on, not blades. The concretes are for
  structures: `concrete01` isn't square, so it can't join a set array with the others.
- **Visible repetition:** `mud01`, `rocks02` and `concrete01` repeat noticeably at a few tiles,
  which anti-tiling (a later terrain material's) hides.

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

**Two shared textures** for the terrain materials to come, each committed as KTX2 (list it by id)
and bakeable (another seed or size):

- `macroNoise` (512², [`bakeMacroNoise`](api:bakeMacroNoise)): four tileable noises in RGBA, for
  large-scale brightness, hue, patch masks and dithering.
- `rippleAtlas` (256², [`bakeRippleAtlas`](api:bakeRippleAtlas)): 4 × 4 rain drops;
  [`decodeRippleAtlas`](api:decodeRippleAtlas) animates their rings.

The baked or live data is visual only: GPUs round floats differently, so never read gameplay or a
collider from it. The baker itself is the engine's, for any graph:
[Texture bakes](hub:features/rendering#texture-bakes).

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
- **The verification scenes:** `proceduralSurfaces` checks every generator in every packing, that
  each bake tiles and its live surface doesn't, and that a procedural set's bake equals the code's;
  `noiseLibrary` tiles each noise 3 × 3 beside its live twin, and checks the shared textures and
  their committed copies. A failure is a console error, so `yarn verify:scenes` fails on it.
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

## Related issues

- [VSM stripes on unshadowed slopes](hub:issues/vsm-stripes-on-unshadowed-slopes): why the
  gallery's blocks cast and receive no shadows.
- [Texture array image layers premultiplied](hub:issues/texture-array-image-layers-premultiplied):
  a set array of PNG sets can be off by 2 / 255 where the roughness is under 1.
- [Heightfield grid layout](hub:issues/heightfield-grid-layout): `generateTerrain`'s heights and a
  `HEIGHTFIELD` collider.

## Read more

- The handbook: [Texture sets](repo:docs/techniques/texture-sets.md) (choosing a packing, AO,
  texel density, your own set in Blender, KTX2 settings, the checklist),
  [Procedural textures](repo:docs/techniques/procedural-textures.md) (baked, exported or live,
  what each costs, writing a generator, tiling and seeds) and the
  [techniques index](repo:docs/techniques/README.md) (which technique for which game).
- The API reference: [`aekasha/texturesets`](hub:documentation/aekasha/texturesets) and
  [`aekasha/toolkit/terrain`](hub:documentation/aekasha/toolkit/terrain).
- The [toolkit](hub:features/toolkit#terrain): the library and the baseline material among the
  rest.

::: claude-md
:::
