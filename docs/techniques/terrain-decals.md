# Terrain decals

Unique detail where it matters: tyre tracks, cracks, stains, leaks, footprints, scorch marks, wet patches. A decal is a small mesh lying on the surface, UV'd into a cell of a decal atlas and drawn in a decal material over the ground. Decals break up tiling more cheaply than any shader technique, because they cost only where they lie. They come three ways: **decal sets** made in Blender and spawned with their terrain block, **runtime pools** that stamp decals during play (footprints, impacts, tyre tracks behind a vehicle), and decals projected onto any mesh.

Checked with **Blender 5.3** (its glTF exporter, the Array modifier's UV offset).

## What it is

```text
 DECAL atlas (*.textureAtlas.json: two KTX2 slots, cells of 512 with 16 px of padding)
   albedoAlpha   RGB albedo (sRGB), A opacity
   normalRough   RG normal XY, B roughness, A puddle mask
   cells: imported decals (pack recipes over ambientCG maps) or baked ones (decal generators)
        │
        ▼
 decal material (decalsGround_blend / _cutout, decalsStructure_blend / _cutout)
   samples the mesh's uv (atlas space: one material draws every cell),
   fades by its uv1 (0..1 over the decal), wet by the surface conditions, polygon offset
        │
        ▼
 the meshes, three ways
   decal set (*.decalSet.json)  Blender planes conformed to a block, one GLB, spawned
                                with the block (its "decals") or by spawnDecalSet
   runtime pool                 createDecalPool: a BATCHED merge group, one render object;
                                spawnDecal (a patch of the block's own grid),
                                spawnRibbonDecal / createDecalTrail (strips along a path),
                                spawnMeshDecalAsync (three's DecalGeometry on any mesh)
```

**Why mesh decals, not screen-space ones.** Ækasha renders forward (`WebGPURenderer`): there's no G-buffer to project a decal into, and the depth prepass a screen-space decal reads lives only inside the PostFX chain, out of a material's reach. A mesh decal is an ordinary mesh drawn after the ground: lit, shadowed and wet like any surface, culled by its bounds, merged or batched like any mesh. Its normal and roughness replace the ground's inside its opacity, which is exactly right for a forward decal.

**Two modes**, set by the material:

| Mode     | Render state                                                                         | Use                                      | Cost                                                        |
| -------- | ------------------------------------------------------------------------------------ | ---------------------------------------- | ----------------------------------------------------------- |
| `BLEND`  | Transparent, no depth writes, polygon offset (factor −1, units −4), `renderOrder` 10 | Soft decals: stains, wet patches, tracks | Sorted with the transparents; overdraw where decals overlap |
| `CUTOUT` | Opaque, `alphaTest` 0.5, alpha to coverage under MSAA, the same polygon offset       | Footprints, cracks, leaves: hard edges   | Cheaper: the opaque pass, no sorting                        |

## Best for

|                      | Good fit                                                                                                                                                                                                                                 | Poor fit                                                                                                                                  |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Art style            | Any: photoreal from scanned decals (ambientCG), stylized from the generators or hand-painted atlases                                                                                                                                     | –                                                                                                                                         |
| Game type and camera | **Every camera.** First and third person gain most (close-up, unique detail: prints, cracks, the tracks a player leaves). Top-down and RTS: roads, scorch marks and tracks, very visible from above. Racing: skid marks and tyre ribbons | Thousands of overlapping `BLEND` decals in one spot (overdraw): use `CUTOUT`, or paint them into a colour map ([Variations](#variations)) |
| World size           | Any: a decal set belongs to its block and goes with it; a pool holds a fixed number of decals and recycles the oldest                                                                                                                    | Detail that covers the whole ground evenly: that's the terrain material's job (a layer, the macro), not a decal per square metre          |

## Performance

- **Fetches per pixel** (the [formula](README.md#the-performance-formula)): the decal material samples both slots once, `P` = 2 with no anti-tiling or projection: **2**. Wet effects add `W` as on the ground (2 for ripples where water stands while it rains; 1 with `rainOcclusion: 'MAP'`; a snow set's `P` when a material adds `snow`). On top of the ground's own fetches, only where a decal lies.
- **`BLEND` against `CUTOUT`:** `BLEND` draws in the transparent pass, sorted, and blends every pixel it covers, transparent corners included; `CUTOUT` draws in the opaque pass with the depth test, no sort. Overlapping decals shade a pixel once each in both modes, but only `BLEND` blends: a pile of soft decals in one place is the overdraw case.
- **Draw calls:** a decal set draws a mesh per decal (a node of its GLB) unless the nodes are merged: `CUTOUT` decals into a `BAKED` merge group (one draw per material per group), `BLEND` ones into a `BATCHED` group (one render object). A runtime pool is one `BATCHED` group: **one render object for every decal**, which is one multi-draw on WebGL2 and a draw per decal on WebGPU (three r187 merges only instances of one geometry, and every patch is its own). The win is the CPU's: render objects, not draws.
- **Measured** (`terrainBlockTest`'s decal walk and `devTools/bench/terrainBlockTestDecals.ts`; Windows Chrome 157, AMD RDNA 3): 128 footprints and 64 track segments are 2 render objects (192 drawn as their own meshes). The CPU frame at a walk's rate: 0.75 ms against 1.74 (WebGPU), 0.61 against 1.66 (WebGL2). The spawns and fades (66 footprints and 86 segments a second): 0.05 ms a frame, p90 0.10. WebGL2's GPU time is the same as separate meshes at a walk's rate (0.56 ms the whole render) and 5 % more under constant rewrites (0.59). The batch's buffers stayed the same size over 10 minutes of 60 spawns a second.
- **The spawn's cost:** `spawnDecal` on a block reads the block's grid once (its first decal on that block), then writes a patch of the cells under the decal: O(the decal's cells), never the block's, and no allocation. `spawnMeshDecalAsync` runs three's `DecalGeometry`, which clips every triangle of the target mesh against the decal's box: fine on props, costly on a large or dense mesh; its code loads with the first call (an `import()`).
- **Atlas VRAM:** UASTC is 8 bits a texel, so a 2K slot with mips is 5.6 MB and an atlas of two slots 11.2 MB. `decalsGround` (2048²) 5.59 MB a slot, `decalsStructure` (2048 × 1024) 2.79 MB a slot; on disk 0.89 + 1.00 MB and 0.32 + 0.23 MB.
- **Measured GPU time per technique:** p310 (the gallery's timings).

## Maps

The `DECAL` packing: two textures, the same channels for imported and generated decals.

| Slot          | Channels                                     | Colour space | Codec (profile `hero`)     | Fill (a cell without a source) |
| ------------- | -------------------------------------------- | ------------ | -------------------------- | ------------------------------ |
| `albedoAlpha` | RGB albedo, A opacity                        | sRGB         | UASTC (`baseColor` slot)   | Transparent black              |
| `normalRough` | RG normal XY, B roughness, A **puddle mask** | Linear       | UASTC, RDO 1 (`data` slot) | `[0.5, 0.5, 1, 0]`: flat       |

- **The atlas** is an ordinary texture atlas ([Asset optimization](asset-optimization.md)): a `*.textureAtlas.json` with the two slots, cells placed by `rect` (the padding inside it) on the packer's 64 px grid, so the mip chain keeps levels 0-4. A cell's `data` is free-form, passed through to the cell table: the toolkit's cells give `physicalSize` (metres), `tileAlong` (`U` for a strip that repeats along its length, else `NONE`), `opacitySource` (`MAP`, `HEIGHT`, `CONSTANT`, `GENERATED`) and, for a generated cell, its recipe (`generator`, `seed`, `params`).
- **Opacity:** an opacity map when the decal has one (AsphaltDamage001), else derived in the pack recipe from the height or the colour with `remap: [t0, t1]`, a soft threshold (the tyre tracks: the inverted height, so the grooves are opaque and the tread's tops show the ground through).
- **The puddle mask, and why:** where water collects first, 1 in a rut or a print's heel, 0 for most decals. The material treats it as a relief under the puddles of the [wet response](wet-dry-surfaces.md): a full mask fills from a puddle level of 0.1, an unmasked texel never (the flat ground's relief). So in a shower the ruts and prints fill long before the ground has puddles of its own. Imported decals take it from the inverted height; generated ones give it themselves.
- **The albedo over the whole cell:** the atlas stores straight alpha, and its padding, mips and bilinear taps mix the RGB of transparent texels into the decal's edge. Give the decal's colour everywhere, never black where the opacity is 0, or every decal gets a dark fringe.
- **The roughness is the dry surface's:** the wet response brings the gloss. A dry print at 0.5 glinted white under a low sun from a few metres off; dry mud is 0.75 or more.

The toolkit's atlases (`src/toolkit/textures/`):

| Atlas                           | Cells                                                                                                                                                                                                                                                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `decalsGround` (2048²)          | `tireTracks` (ambientCG TireTracks001: a 1024 × 256 strip, 1.8 × 0.45 m a tile, `tileAlong: 'U'`), `asphaltDamage` (AsphaltDamage001, 1.2 m), and generated: `crack`, `mudSplatter`, `wetPatch`, `stain01`, `stain02`, `scorch`, `footprintBoot`, `footprintBare`, `footprintPaw`, `footprintSnowBoot`, `leafPatch`, `iceCrack` |
| `decalsStructure` (2048 × 1024) | `leak01`-`leak03` (ambientCG Leaking012A, 017B, 019A: a stain colour, the opacity from the displacement), and generated: `formworkMarks`, `crack01`, `crack02`, `stain01`, `stain02`                                                                                                                                            |

### Your own decals

- **From a scan** (ambientCG, Poly Haven, your photos): a source folder beside the atlas (`decalsGround/decalAsphaltDamage01/`) with a `source.json` naming the maps (`yarn fetchTextureSources --only <folder>` downloads them into its gitignored `source/raw/`) and two pack recipes, `*.texture.json` with `"sourceOnly": true` (an atlas cell's source, never encoded on its own):

  ```json
  {
    "id": "decalAsphaltDamage01_normalRough",
    "sourceOnly": true,
    "pack": {
      "channels": {
        "rg": { "src": "./source/raw/normal.jpg", "channel": "rg", "normal": true },
        "b": { "src": "./source/raw/roughness.jpg" },
        "a": {
          "src": "./source/raw/height.jpg",
          "channel": "r",
          "remap": [0.2, 0.6],
          "invert": true
        }
      }
    }
  }
  ```

  The `albedoAlpha` recipe packs `rgb` from the colour and `a` from the opacity map (`"channel": "r"`: a greyscale JPG's A would read its own alpha). Without an opacity map, paint a mask in Krita or GIMP (white the decal, black around it, soft at the edge) and pack it as `a`; or derive it from the height. Then name the recipes in the cell's `sources` and run `yarn assets`.

- **From the generators** (`aekasha/toolkit/terrain`): nine decal generators (`decalCracks`, `decalStain`, `decalScorch`, `decalMudSplatter`, `decalFootprint` with its `shape` `BOOT`, `BARE`, `PAW`, `SNOW_BOOT`, `decalWetPatch`, `decalIceCrack`, `decalLeafPatch`, `decalFormwork`), TSL graphs over the noise library baked on the GPU. The terrain gallery's Decals tab is the tool (`/?isDebug=true&startScene=terrainGallery`): pick a generated cell, bake it onto the bench (as `BLEND` and `CUTOUT` decals on wet mud, beside the atlas's own copy), edit its seed and params, _Copy cell data_ (the cell's `data` as JSON for the atlas) and _Export cell_ (`source/<cellId>_albedoAlpha.png` and `_normalRough.png`, 480², already in the `DECAL` packing); then `yarn assets`. A cell's `data` is its recipe, so _Export all_ bakes every generated cell again from the committed data. In code: `bakeDecalGenerator({ id, generator, size: 480, seed, params })` and `exportBakedTexture`. Your own generator: `defineDecalGenerator({ id, params, physicalSize, heightScale, build })`, whose `build` returns `{ albedo, opacity, height, roughness, puddle?, normal? }` (without a `normal`, it's made from the height).
- **From Blender:** sculpt the crack or the print in a plane (or model it), then bake it onto a flat plane of the cell's aspect (_Cycles → Bake_, _Selected to Active_): the colour, the normal (tangent space, OpenGL's green up) and the height. The height becomes the opacity (`remap` its depth) and the puddle mask (inverted), as for a scan.

## Blender, step by step

The template `terrain_decals.blend` has all of this built: a block of low hills, its decal set, two tyre tracks along a curve and a quad of nine cells. Start from it, or with the add-on (sidebar → **Ækasha** → _Decal Sets_):

1. **The block:** shaped as any block ([Terrain blocks from Blender](terrain-blocks-blender.md)), then select it: _Add Decal Set_. A decal set is a collection (`<blockId>_decals`): every decal in it goes into one GLB in the block's space. Its _Atlas_ (`decalsGround`) gives the cells, its _Material_ the decal material the export's stub names (`decalsGround_blend`, or `decalsGround_cutout` for hard-edged decals).
2. **A quad decal:** put the 3D cursor where it goes, _Add Decal_, pick a cell (a search). It comes at the cell's `physicalSize` with two UV maps: `UVMap`, the cell in the atlas (the exporter's `TEXCOORD_0`), and `DecalUV`, 0..1 over the whole decal (`TEXCOORD_1`, the engine's `uv1`: the material's edge fade reads it, and **without it the decal draws nothing**). Turn and move it freely (rotation Z, location X/Y); scale it in X/Y only (the cell stretches).
3. **A strip decal** (a cell with `tileAlong: 'U'`, `tireTracks`): _Add Decal_ makes it a strip along its own path (`<name>_path`, a Bézier curve): edit the path in Edit mode and the strip follows. A second wheel: duplicate the strip (_Shift D_), give its Array and Curve the first's path, and move its mesh aside in Edit mode (_G Y_).
4. **The modifiers,** in this order (made for you): _Array_ (a strip: its tile repeated, _Fit Curve_ to the path's length), the group **AEK Decal** (Geometry Nodes: subdivides by its _Level_, then writes `DecalUV` from the bounds; after the Array, whose UV offset would move every UV map), _Curve_ (a strip, along the path's X), _Shrinkwrap_ (Target the block, _Project_ along Z both ways, _Above Surface_, Offset **0.015 m**). Nothing to apply: the export takes each decal as its modifiers make it.
5. **Conforming:** between its vertices a decal face is flat, while the block folds along its own triangles. _Add Decal_ sets the Level to a face of at most half the block's grid spacing, which kept tracks on 0.25 m bumps 0.7-32 mm over the ground; at the grid spacing they cut 6 mm in. Floating or cutting in on steep or bumpy ground: raise the Level. Keep the offset at 1-2 cm: the engine's polygon offset does the rest.
6. **The UV check:** with the material preview (**AEK Decal Preview**, a dark stain faded by `DecalUV`, a stand-in: Blender can't read the atlas's KTX2 outputs) every decal shows a soft edge; one with a hard edge has lost its `DecalUV`. The real look is the engine's: the gallery's Decals row shows every cell.
7. **Merging** (optional): a decal's custom prop `merge` (_Object Properties → Custom Properties_) puts it in a merge group: `CUTOUT` decals in a `BAKED` group, `BLEND` ones in a `BATCHED` group.

## Export

**Export Decal Set** (the add-on) writes into the block's _Folder_ (or the set's own):

- `<setId>.glb`: each decal baked as its modifiers make it (its UV maps checked in order), placed from the block's centre, with its custom props; then read back (a node per decal, `TEXCOORD_0` in its cell, `TEXCOORD_1` 0..1).
- Only where no such file is: `<setId>.importedAsset.json` (the default mesh encode: meshopt, quantized; positions within 2 mm on a 35 m strip, well inside the 1.5 cm offset; UVs within a quarter texel at 2K) and `<setId>.decalSet.json` (the set's material, render order 10).

**For a manual export** (_File → Export → glTF 2.0_, the decals selected, the block at the world origin): the [block's locked settings](terrain-blocks-blender.md#export) with **Apply Modifiers ✓**, **UVs ✓** (both maps, `UVMap` first: the exporter writes them in order and flips V), Normals ✓, Vertex Color **None**, Attributes ✗, no materials, no compression.

## Import into Ækasha

### A decal set

1. **The files** beside the block's (its folder): the GLB, its `*.importedAsset.json` and the set:

   ```json
   {
     "$schema": "../../../../../.schemas/decalSet.schema.json",
     "importedAsset": "valley_decals",
     "material": "decalsGround_blend"
   }
   ```

2. `yarn assets --only valley_decals`.
3. **With its block:** `"decals": ["valley_decals"]` in the block's `*.terrainBlock.json`. The gather adds the set, its import and its material to every scene listing the block; `spawnTerrainBlock` spawns the set last, at the block's place (`block.decalIds`), and the block's `dispose()` deletes it.
4. **On its own** (a set of the scene's: a yard's stains, a structure's leaks): list it in the scene's `"decalSets"` and spawn it in the scene's code:

   ```ts
   import { spawnDecalSet } from 'aekasha/terrain';

   export const scene = async () => {
     const stains = await spawnDecalSet('yardStains', {
       transform: { position: { x: 12, y: 0, z: -4 } },
     });
     if (!stains) return; // the scene was left while it spawned
   };
   ```

A node with physics custom props or GPU instances isn't a decal: the spawn skips it with a warning; one without `uv1` is warned of. `terrain()` is in `features` (the template lists it).

### Runtime decals

A pool is made in the scene's code after its load (the cells are read from the atlas's loaded slots), and belongs to that scene: its exit deletes the decals and the pool. The scene JSON lists the pool's material; `merging()` and `terrain()` are in `features`.

```ts
import { spawnTerrainBlock } from 'aekasha/terrain';
import { createDecalPool, createDecalTrail, spawnDecal } from 'aekasha/toolkit/terrain';

export const scene = async () => {
  const block = await spawnTerrainBlock('meadow');
  if (!block) return;
  const prints = createDecalPool({
    id: 'prints',
    material: 'decalsGround_blend',
    atlas: 'decalsGround',
  });
  const tracks = createDecalPool({
    id: 'tracks',
    material: 'decalsGround_blend',
    atlas: 'decalsGround',
    maxDecals: 64,
  });

  // A step's print, left or right of the walker, gone after 20 s
  spawnDecal(prints, {
    target: block,
    position: foot,
    rotation: heading,
    cell: 'footprintBoot',
    lifetimeSec: 20,
    fadeSec: 4,
  });

  // A wheel's track, darkened for this ground: a segment stamped every 2 m of path
  const wheel = createDecalTrail(tracks, {
    target: block,
    cell: 'tireTracks',
    color: '#666666',
    lifetimeSec: 30,
    fadeSec: 5,
  });
  // …then each frame (an APP_LOGIC system): wheel.addPoint(wheelPos.x, wheelPos.z);
};
```

- **`spawnDecal`:** a patch of the block's own grid under the decal (its triangles the block's, so it follows the ground exactly at any spacing), lifted 5 mm, its UVs projected along `normal` (default the block's at the centre). `cell` may be a list: the pool's random stream (`decals`) draws one, and a missing `rotation`, so a replayed scene stamps the same decals. Returns the decal's entity, or `null` when its centre is off the block. A decal is cut at the block's edge: stamp one on each block for a decal across two.
- **`spawnRibbonDecal`** (`points`, `width`, `cell`): a strip along a path, the cell repeating every `tileLength` (default its `physicalSize`), its ends faded over `endFadeMeters` (0.5 m). **`createDecalTrail`** stamps one every `segmentLength` (2 m) of a moving point's path, each joined to the last: the track lags the point by up to a segment; `end()` stamps the rest. A point off the block ends the track.
- **`spawnMeshDecalAsync`** (`target: { entityId }`, a world `position` and `normal`, `depth`): projects onto any plain mesh (not instanced, batched or skinned): a scorch where a shot hit a crate, a leak on a wall. Asynchronous: its code loads with the first call; resolves `null` when the decal misses the mesh or the pool went meanwhile.
- **Lifetimes and the FIFO:** a decal with `lifetimeSec` fades over its last `fadeSec` and frees its place; a full pool takes its oldest decal's place, the oldest `fifoFade` (default an eighth) fading out by their place in line, so a recycled decal is already gone.
- **Wet footprints:** a footprint cell's puddle mask fills in the rain (the print's heel and ball first, the lugs last), with `surfaceConditions()` installed: in a shower from dry the boot print's water climbed from 2 % of it at a puddle level of 0.06 to 41 % at 0.81, while the mud around it had no puddles below 0.48. `footprintSnowBoot` has no mask: a print in snow. Tyre ruts fill the same way.

### A mesh JSON's `renderOrder`

Any mesh draws in its pass by `renderOrder` (a mesh JSON's `props.renderOrder`, `createMeshEntity`'s `renderOrder`; default 0), kept by its LOD's swaps and fades. The bands: **terrain 0, decals 10, other transparents 20 and up**, so a decal draws over the ground and under water or particles.

## Set-up and parameters

`*.decalSet.json` (the `terrain()` feature's asset, `.schemas/decalSet.schema.json`):

| Field           | What it is                                   | Default       |
| --------------- | -------------------------------------------- | ------------- |
| `id`            | The set's id                                 | The file name |
| `importedAsset` | The import whose meshes are the decals       | –             |
| `material`      | The decal material                           | –             |
| `renderOrder`   | The meshes' draw order within a pass         | 10            |
| `receiveShadow` | The meshes receive shadows (they never cast) | true          |

The decal material (`setupDecalMaterial`; a material JSON's `staticDefines` and `inputs`, over the toolkit's TSL file `materials/decal/decal.tsl.ts`):

| Setting                                    | What it is                                                                                                                   | Default (toolkit JSONs)         |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `mode`                                     | `BLEND` or `CUTOUT` (the render state above; `params` give `alphaTest` and the polygon offset's numbers)                     | `BLEND`                         |
| `edgeFade`                                 | `UV1`: the opacity fades by the second UV set at each edge; `NONE`                                                           | `UV1`                           |
| `wet`, `frost`, `rainOcclusion`            | Wet by the surface conditions (`FULL`: puddles in the puddle mask, ripples; `SIMPLE`; `NONE`), frost, `NORMAL_Y` or `MAP`    | `FULL`, on, `NORMAL_Y`          |
| `albedoAlpha`, `normalRough`               | The atlas's slots (`{ "texture": "decalsGround.albedoAlpha" }`)                                                              | –                               |
| `ripples`, `snow`                          | The ripple atlas (`rippleAtlas`); a snow set (`{ "textureSet": "snow01" }`) to cover the decal as the snow covers the ground | `rippleAtlas` (ground); no snow |
| `tint`, `opacity`                          | × the albedo (`"#666666"`), × the opacity                                                                                    | White, 1                        |
| `normalStrength`, `roughnessScale`         | × the normal's XY (0 flat), × the roughness                                                                                  | 1, 1                            |
| `edgeFade` (input)                         | The fade's width at each side, a share of `uv1` (`[u, v]`; 0: none on that axis)                                             | `[0.1, 0.1]`                    |
| `puddleDepth`, `puddleResponse`            | How far below flat a full mask lowers the relief; how readily water stands                                                   | 0.5, 0.5                        |
| `porosity`, `wetDarkening`, `wetRoughness` | The decal's own wet response                                                                                                 | 0.5, 0.5, 0.2                   |

`createDecalPool` (`aekasha/toolkit/terrain`):

| Option                         | What it is                                                                                                                                | Default         |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `id`                           | The pool's id, also its merge group's                                                                                                     | –               |
| `material`, `atlas`            | A decal material the scene lists; the atlas whose cells the decals name                                                                   | –               |
| `maxDecals`                    | The most decals at once; past it the oldest's place is taken                                                                              | 128             |
| `maxPatchVertices`             | Every slot's reserve in the batch: 169 is a 13 × 13 window (a 3 m decal at 45° on a 0.5 m grid). A larger window skips grid lines, warned | 169             |
| `lift`                         | A patch's lift along the block's normals (m)                                                                                              | 0.005           |
| `fifoFade`                     | How many of the oldest decals fade by their place in line                                                                                 | `maxDecals / 8` |
| `renderOrder`, `receiveShadow` | The decals' draw order; shadows received                                                                                                  | 10, true        |
| `transparentOrder`             | A `BLEND` pool's order: `JOIN` (the newest on top) or `DEPTH` (back to front)                                                             | `JOIN`          |
| `randomStream`                 | The named stream a cell list and a missing rotation draw from                                                                             | `decals`        |

A spawn's look: `size` (a pair, or a width with the cell's aspect; default its `physicalSize`), `rotation`, `color` (× the material's colour), `opacity`, `lifetimeSec`, `fadeSec` (1 s).

## Variations

- **`CUTOUT` instead of `BLEND`:** opaque, no sorting, no blending: cheaper wherever decals pile up, and the only mode for a `BAKED` merge group. Its edge is the alpha test's (softened by alpha to coverage under MSAA), so soft stains and wet patches look cut out; prints, cracks and leaves don't. A pool's FIFO and lifetime fades erode a `CUTOUT` decal's shape rather than fading it.
- **Painting static decals into a colour map:** a decal that never changes can be painted into the block's colour map ([Colour map + detail](terrain-colormap-detail.md)) instead: zero runtime cost, no draw, no overdraw, but no lighting response of its own (no normal, roughness or puddle mask) and the colour map's resolution (2K over 64 m is 3 cm a texel). No tool does it: stamp the decal's image into the colour map in Blender's Texture Paint (a stencil brush) or an image editor. For distant, flat detail: road paint seen from an RTS camera, a scorch on a far hillside.
- **Variety without repetition:** several cells from one generator with other seeds (the toolkit's `stain01` / `stain02`, `crack01` / `crack02`), given to `spawnDecal` as a list; each spawn's own rotation does the rest. The walk's 128 copies of one boot print showed no repetition. A runtime path that bakes a variant per seed into a texture array was considered and not built.
- **A tint, not another atlas:** a decal's albedo replaces the ground's, so a decal reads only on grounds it suits ([Pitfalls](#pitfalls-and-checklist)). Tint it to its ground: a spawn's `color` for runtime decals, a material JSON of your own with `"tint"` for a decal set (cheap: no texture). Another atlas cell only when the shape differs too.
- **Decals on structures:** `decalsStructure` (leaks, formwork marks, cracks, stains) on walls: a set of the scene's own (`spawnDecalSet`, exported by hand: the add-on places a set from a block's origin) or `spawnMeshDecalAsync` onto the wall's mesh. See [Structure materials](structure-materials.md).
- **A strip's ends:** the toolkit materials fade a tenth of `uv1` at each edge, so a 35 m Blender strip fades over 3.5 m at each end. A strip material of your own with `"edgeFade": [0.01, 0.1]` fades it over 35 cm. Runtime ribbons fade in metres (`endFadeMeters`) whatever the material.

## Pitfalls and checklist

- [ ] Every decal mesh has `uv1`, 0..1 over the decal (Blender's `DecalUV`, second): without it the decal draws nothing.
- [ ] Decals at `renderOrder` 10, `castShadow` off (the decal sets and pools do it).
- [ ] `terrain()` for decal sets and `spawnDecal`'s blocks, `merging()` for pools, `surfaceConditions()` for the wet response (without it the material builds dry, warned once).
- [ ] The pool's material listed in the scene JSON; the pool made after the scene's load.
- [ ] A decal tinted to its ground, checked on that ground.
- **Z-fighting** (a decal breaking up or vanishing at a distance): the polygon offset is on in both modes (factor −1, units −4); a JSON's `params` that set them to 0 turn it off. Blender decals keep their 1-2 cm offset, runtime patches 5 mm (ribbons 15 mm: their faces aren't the block's). A logarithmic depth buffer writes the fragment's depth, which the polygon offset doesn't move.
- **Dark or bright fringes, mip bleeding:** the cell's padding (16 px at 2K) protects levels 0-4, and a texel's RGB under opacity 0 still bleeds in: give the albedo over the whole cell.
- **Floating or cutting in on slopes (Blender):** raise the AEK Decal modifier's Level. Runtime patches on a block follow it exactly; a `normal` far off the block's can leave a corner of the decal uncovered.
- **Sorting with other transparents:** keep the bands (terrain 0, decals 10, other transparents 20 and up). A `BATCHED` group draws all its members at one place in the order, so its members must share `renderOrder` (the group refuses a member that doesn't).
- **A pale strip instead of a track:** the decal's own albedo on a darker ground. The tyre tracks read pressed into the gallery's `mud02` but as pale lines on `mud01`, lit 2.6 times as bright; a tint of `#666666` fixes it there (`#4d4d4d` read as black lines from afar). A decal mode that keeps the ground's colour is a follow-up.
- **A thin `CUTOUT` strip thinning out in the distance:** under two pixels tall, alpha to coverage drops it (a 0.45 m track at 200 m through a 50° lens). Use `BLEND` for strips seen far off.
- **A decal under the snow-covered ground:** the toolkit materials have no `snow` (it would pull `snow01` into every scene); add it in your own material JSON.
- **A left foot on both sides:** `footprintBare` is a left foot and `spawnDecal` has no mirror (a follow-up). The boot prints are symmetric and don't show it.
- **A hitch on a pool's first spawns:** its first decal on a block reads the block's grid, and its first `maxDecals` spawns each make an entity; stamp a few at the scene's load if it shows.
- **WebGL2's GPU time read high for a batch:** the stats panel's timer and per-object queries mismeasure it. Measure with timer queries around the whole render on an otherwise idle GPU (the bench's `gpu` cases).

## Template file and example asset ids

- **The template** `src/toolkit/terrain/blender/terrain_decals.blend` (made by `devTools/blender/buildTerrainTemplates.py`; its README text block in the Layout workspace): `decalsBlock` (64 m / 129, low hills, mud01), its decal set `decalsBlock_decals`, `tireTracksLeft` and `tireTracksRight` along `tireTracksPath` 1.7 m apart, and quads of `asphaltDamage`, `crack`, `stain01`, `mudSplatter`, `wetPatch`, `scorch` and three footprints.
- **The gallery** (`/?isDebug=true&startScene=terrainGallery`, its tab's Decals sections): the Decals row (both atlases' slots, every cell named), the Decals stage (every cell on a flat mud block and a concrete wall, `BLEND` left and `CUTOUT` right, with the weathers, the polygon offset and edge fade switches, cameras at 1, 50 and 200 m) and the bake bench (the generators).
- **`terrainBlockTest`** (`/?isDebug=true&startScene=terrainBlockTest`): the decal block `terrainBlockTestDecals` (a ridge with bumps, `devTools/blender/buildDecalTest.py`) with its Blender decal set (two tyre tracks over the ridge), and a seeded walk stamping boot prints into a pool of 128 and two cart tracks (`?tbtDecals=blend|cutout|off`, `?tbtDecalRate`); the bench `devTools/bench/terrainBlockTestDecals.ts`.
- **The toolkit:** the atlases `decalsGround`, `decalsStructure`; the materials `decalsGround_blend`, `decalsGround_cutout`, `decalsStructure_blend`, `decalsStructure_cutout`.
- **The API:** `spawnDecalSet`, `getDecalSet` (`aekasha/terrain`); `createDecalPool`, `spawnDecal`, `spawnRibbonDecal`, `createDecalTrail`, `spawnMeshDecalAsync`, `setupDecalMaterial`, `defineDecalGenerator`, `bakeDecalGenerator` and the nine generators (`aekasha/toolkit/terrain`); `MeshProps.renderOrder` (`aekasha`); the schemas `decalSet.schema.json`, the terrain block's `decals`, the scene's `decalSets`.
