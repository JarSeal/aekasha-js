# Techniques

Long-form how-to pages: how to build something with Ækasha from the source file to the running scene, with what it costs and what it suits. The Ækasha Hub's feature pages say what each API does and link here for the workflow; these pages say how to use it in a real project.

Most pages are about texturing terrain and large structures (the terrain texturing epic, p301). Two are general:

- [Asset optimization](asset-optimization.md): the KTX2 and meshopt pipeline, its profiles and slots, pack channels, texture arrays and atlases, and the codec cheat sheet. Every texture on the other pages goes through it.
- [Writing Ækasha Hub pages](hub-authoring.md): authoring the Hub.

## Start here

New to terrain in Ækasha? Read in this order:

1. [Asset optimization](asset-optimization.md), its [Add a texture](asset-optimization.md#add-a-texture) and [Pack channels](asset-optimization.md#pack-channels): how a source image becomes a compressed GPU texture, and how one texture is packed from several maps.
2. [Texture sets](texture-sets.md): the surfaces themselves, packed maps with their real-world size. Pick one from the toolkit's library of 16, or add your own.
3. Open the gallery: `yarn dev`, then `/?isDebug=true&startScene=terrainGallery`. Every library set on its own block, its debug tab ("Terrain gallery") switching packings and laying a 1 m checker over the ground.
4. Pick a technique for your game from the [matrix](#which-technique-for-my-game), then read its page. Until p305's pages exist, the toolkit's `textureSetSurface` material (one set, world tiling) is the baseline: [Texture sets' Import into Ækasha](texture-sets.md#using-a-set).
5. Hand-built levels rather than a heightfield: [Modular kits and tile-chunk worlds](terrain-modular-kits.md).

## The pages

The plan that implements a technique writes its page, in its last phase. Pages not written yet are listed with their plan.

| Page                                                 | Technique                                                                                                  | Status                                         |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| [`asset-optimization.md`](asset-optimization.md)     | KTX2 / meshopt pipeline, profiles, codec cheat sheet                                                       | Written (p300)                                 |
| [`texture-sets.md`](texture-sets.md)                 | Maps (required / optional), packings, AO into albedo, height, texel density, sources, sizes, KTX2 settings | Written (p303)                                 |
| `procedural-textures.md`                             | Live vs baked procedural, the baker, seeds, VRAM trade-off                                                 | Planned: p304                                  |
| `terrain-single-layer.md`                            | One tiled layer, anti-tiling (dual-scale, hex), macro variation                                            | Planned: p305 (Blender sections: p306)         |
| `terrain-vertex-color-splat.md`                      | Up to 5 layers painted as vertex colours, height blend                                                     | Planned: p305 (Blender sections: p306)         |
| `terrain-splat-map.md`                               | Painted splat textures (4 / 8 layers), resolution-independent borders                                      | Planned: p305 (Blender sections: p306)         |
| `terrain-procedural-rules.md`                        | Slope / height / noise rules, no painting; also for generated meshes                                       | Planned: p305                                  |
| `terrain-triplanar-cliffs.md`                        | Triplanar / biplanar / slope-gated projection for steep faces                                              | Planned: p305 (Blender sections: p306)         |
| `terrain-colormap-detail.md`                         | A unique baked colour map with tiled greyscale detail; also the far-distance mode                          | Planned: p305 (Blender sections: p306)         |
| `structure-materials.md`                             | Concrete and large structures: world-space / triplanar, macro, edge wear, decals                           | Planned: p305 (Blender sections: p306)         |
| `terrain-blocks-blender.md`                          | The block workflow: grid, shaping, normals, custom props, export, import                                   | Planned: p306                                  |
| `terrain-procedural-meshes.md`                       | Engine-generated terrain: noise, rules to vertex splat, CPU AO, colliders                                  | Planned: p306                                  |
| `wet-dry-surfaces.md`                                | Wetness, puddles, rain ripples, drying, shoreline, snow coverage                                           | Planned: p307                                  |
| `terrain-scatter.md`                                 | GPU-instanced rocks and details from Blender and procedural masks                                          | Planned: p308                                  |
| `terrain-decals.md`                                  | Mesh decals with an atlas, projected decals, procedural decals                                             | Planned: p309                                  |
| [`terrain-modular-kits.md`](terrain-modular-kits.md) | Terrain from kit modules and tile-chunk worlds, merged per cell                                            | Written (p372; array-material variation: p374) |

p310 adds the measured GPU times to every page (the gallery's camera presets and timings).

## Which technique for my game

A skeleton: the packing and texel density columns hold now (from [Texture sets](texture-sets.md)); p305 fills the technique, anti-tiling and projection columns as its pages land, and p310 checks every row against the gallery's measurements.

| Game type and camera      | Recommended technique | Packing                                    | Texel density near the camera | Anti-tiling | Projection |
| ------------------------- | --------------------- | ------------------------------------------ | ----------------------------- | ----------- | ---------- |
| First person              | p305                  | `LITE`; `FULL` for hero cliffs             | 256–512 px/m                  | p305        | p305       |
| Third person              | p305                  | `LITE`                                     | ~256 px/m                     | p305        | p305       |
| Top-down, isometric, RTS  | p305                  | `LITE`, or `MINIMAL` (a 512 set is enough) | 64–128 px/m                   | p305        | p305       |
| Side-view platformer      | p305                  | `LITE`; `MINIMAL` for a stylized look      | p305                          | p305        | p305       |
| Racing, flight            | p305                  | `LITE`                                     | p305                          | p305        | p305       |
| Stylized, low-end, mobile | p305                  | `MINIMAL`                                  | 64–128 px/m                   | p305        | p305       |

## The page template

Every technique page has these sections, in this order. A section that doesn't apply says so in a line rather than being left out (the texture sets page has no Blender template file, the modular kits page no maps of its own).

1. **What it is.** Two or three sentences, and a diagram when it helps.
2. **Best for:** the art style (photoreal, stylized PBR, painterly, low-poly flat), the game type and camera (first person, third person, top-down, isometric / RTS, side-view platformer, racing / flight) and the world size. A "poor fit" row is required.
3. **Performance:** fetches per pixel (the formula below, with a worked example), ALU notes, VRAM, draw calls, the quality tier, and the **measured** GPU time from the gallery (p310).
4. **Maps:** a required / optional table with the packing, colour space, codec and size.
5. **Blender, step by step.**
6. **Export:** the exact exporter (or image) settings.
7. **Import into Ækasha:** the files to create, with JSON examples.
8. **Set-up and parameters:** a table.
9. **Variations:** each with what to do, why, and its performance effect.
10. **Pitfalls and checklist.**
11. **Template file and example asset ids.**

### The performance formula

Every page states its cost in the same terms (p301 §6). Texture fetches per pixel ≈ `P × L × A × T + S + M + W`:

| Term | Meaning                      | Values                                                                    |
| ---- | ---------------------------- | ------------------------------------------------------------------------- |
| `P`  | Textures per layer (packing) | `FULL` 3, `LITE` 2, `MINIMAL` 1                                           |
| `L`  | Layers actually sampled      | All layers, or the top few with sparse sampling (p305)                    |
| `A`  | Anti-tiling taps             | None 1, dual-scale 2, hex 3                                               |
| `T`  | Projection                   | UV / world 1, biplanar 2, triplanar 3 (slope-gated: only on steep pixels) |
| `S`  | Splat fetches                | 0 for vertex colours and rules, 1 per 4 layers for splat maps             |
| `M`  | Macro variation              | 1                                                                         |
| `W`  | Wet effects                  | 0–2 (a ripple atlas)                                                      |

`LITE`, 4 layers, dual-scale anti-tiling, world UVs, a splat map and macro variation: 2·4·2·1 + 1 + 1 = **18**, a good default. `FULL`, 4 layers, hex, always triplanar: 3·4·3·3 + 2 = **110**: don't.

The binding budget matters as much: WebGPU gives a shader stage 16 sampled textures by default, and shadow maps and the environment map take some, so a terrain material binds about 10 at most (3 `FULL` or 4 `LITE` layers with a splat and a macro texture). Past that, a texture set array binds one array per slot (2–3 bindings for up to 16 layers; [Texture sets' Variations](texture-sets.md#set-arrays)).
