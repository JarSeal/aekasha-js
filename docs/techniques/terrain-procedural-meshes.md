# Procedural terrain meshes

Terrain made by the engine instead of an artist: `generateTerrain` builds a block's grid from seeded noise, a height function or a heightmap, with normals that agree across blocks, the terrain material's rules laid into its vertex colours on the CPU, a horizon AO, and its `HEIGHTFIELD` collider. A `*.terrainBlock.json` names a generator (`noiseTerrain`, `rulesTerrain`, or your own) so a scene lists generated blocks like Blender ones ([Terrain blocks from Blender](terrain-blocks-blender.md)); from code, `generateTerrainAsync` does the work on the toolkit's terrain worker.

The block conventions are the same as Blender's (square, `2^n + 1` vertices a side, centred, placed at `grid × size`): [What it is](terrain-blocks-blender.md#what-it-is).

## What it is

```text
 heights: seeded simplex octaves at the WORLD (x, z)  │  heightFn(x, z)  │  a heightmap (R16, R32F)
          then heightModifier(x, z, h)                 (sampled past the block's edge where needed)
        │
        ├─► positions (the grid, centred), indices (two triangles a cell along the collider's diagonal), UVs
        ├─► normals: GEOMETRY (the triangles) or HEIGHT_FN (central differences, past the edge: seamless)
        ├─► ao: horizon AO, 8 directions within a radius ──────────────┐
        ├─► vertexColors: the terrain rules on the CPU ─► COLOR_0 RGB(A), A = the AO for RGB_AO
        └─► collider: true ─► heightfield (HEIGHTFIELD params, the mesh's cells)
```

- **World continuity:** the heights are sampled at the world's `center + (x, z)`, and everything that looks at neighbours (the `HEIGHT_FN` normals, the AO's march) reads the same function past the block's edge. So blocks of one seed side by side agree on their shared edge's heights, normals, AO and colours: no crack, no light seam.
- **Rules on the CPU:** the terrain material's rule type (`TerrainRule`: slope, height, facing, noise) evaluated per vertex with the material's own math (`evaluateTerrainRulesCPU`), into the vertex colours a `VERTEX_COLOR` material reads. The same rules work per pixel in the shader ([Procedural rules](terrain-procedural-rules.md)); which to use is below.
- **The AO is HBAO on the height grid:** per vertex, the horizon above each of 8 directions within `radius`, measured from the surface's own slope, so a plain slope stays unoccluded and a valley floor darkens. It's the large-scale occlusion a tiling layer's AO can't carry.

## Best for

|                      | Good fit                                                                                                         | Poor fit                                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Art style            | Any; rules read naturally on photoreal and stylized PBR                                                          | Art-directed hero areas: shape them in Blender, or mix (generated blocks around Blender ones) |
| Game type and camera | Procedural, sandbox and survival worlds, roguelites, prototypes, infinite runners, flight and racing backgrounds | A quest valley whose every rock matters                                                       |
| World size           | Any: a block is generated where it's needed, from a seed, nothing stored                                         | –                                                                                             |

## Performance

- **Generation** (Node 22, a 257² block, 3 octaves, the median of 9): the defaults 11 ms, `HEIGHT_FN` normals 10 ms, with 3 rules 17 ms, with the AO (16 m) 40 ms, everything with a collider and a skirt 48 ms. A 129² block is about a quarter of that.
- **On the main thread that's a dropped frame;** on the worker none. Measured in the browser (Windows Chrome, a 256 m / 257² `rulesTerrain` block, 3 rules, AO 16 m; the longest frame during the work, idle about 9-11 ms):

  | Where                 | The work | Longest frame meanwhile |
  | --------------------- | -------- | ----------------------- |
  | The worker, cold      | 94 ms    | 9.8 ms (idle)           |
  | The worker, warm      | 72-78 ms | 8.8-11.4 ms (idle)      |
  | The main thread       | 69-94 ms | **69-93 ms**            |
  | A block's whole spawn | 55-88 ms | 7.0-14.3 ms (idle)      |

  `generateTerrainAsync` and the toolkit's generators use the worker; `generateTerrain` is the synchronous one, for small blocks or tools.

- **Per pixel:** the material's, as for any block ([Vertex-colour splat](terrain-vertex-color-splat.md#performance) for a `rulesTerrain` block's `VERTEX_COLOR` material). Rules baked into the colours cost nothing per pixel; the same rules in the shader about 0.01 ms ([Procedural rules](terrain-procedural-rules.md#performance)).
- **VRAM:** the mesh's (about 40 bytes a vertex with colours: 1 MB for 129², 4 MB for 257²); nothing else is stored.
- **The build:** the generator code is a lazy chunk (3.8 kB gzip) and the worker a lazy 5.6 kB file, loaded with the first generated block.

## Maps

None of its own: the heights, the colours and the AO are made, not loaded. A heightmap (optional) is a raw file:

| Map          | Required              | Format                                                          | Colour space | Codec | Size                                                            |
| ------------ | --------------------- | --------------------------------------------------------------- | ------------ | ----- | --------------------------------------------------------------- |
| A heightmap  | No                    | Raw `R16` (unsigned 16-bit) or `R32F`, little-endian, no header | –            | None  | A block's `resolution` texels a side gives its vertices exactly |
| `macroNoise` | For a rule with noise | The toolkit's texture, read back once to the CPU                | Linear       | UASTC | 512²                                                            |

16-bit PNGs aren't used for heights: browsers decode them to 8 bits.

## Blender, step by step

Not used: a generated block never passes through Blender. To hand-shape part of a generated world, make those blocks in Blender ([Terrain blocks from Blender](terrain-blocks-blender.md)) and keep them away from generated blocks' edges (a Blender block doesn't continue the noise), or export a heightmap from a terrain tool (below).

## Export

Nothing to export. A heightmap from Gaea, World Machine or World Creator: export it as a raw 16-bit (or 32-bit float) file of the block's (or the world's) resolution, and note its height range; that's `loadTerrainHeightmapAsync`'s options.

## Import into Ækasha

**A generated block in JSON** (the toolkit's generators, registered by `registerTerrainGenerators()` from an install: the template's `appECSPlugins` calls it). `rulesTerrain`, three rules into `RGB_AO`'s RGB and the AO into A:

```json
{
  "$schema": "../../../../../.schemas/terrainBlock.schema.json",
  "geometry": {
    "generator": "rulesTerrain",
    "params": {
      "maxHeight": 10,
      "octaves": [
        [0.016, 1],
        [0.05, 0.35],
        [0.14, 0.1]
      ],
      "layout": "RGB_AO",
      "rules": [
        {
          "layer": 1,
          "slope": { "min": 26, "softness": 8 },
          "noise": { "scale": 30, "amount": 0.35, "channel": "G" }
        },
        {
          "layer": 2,
          "height": { "min": 5, "softness": 3 },
          "aspect": { "direction": [0, -1], "range": 70, "softness": 35 }
        },
        { "layer": 3, "slope": { "min": 46, "softness": 6 } }
      ],
      "ao": { "radius": 8, "strength": 0.8 }
    },
    "seed": 306
  },
  "material": "patchTerrain",
  "grid": { "x": -1, "z": -6, "size": 32, "resolution": 65 },
  "collider": { "type": "HEIGHTFIELD" }
}
```

The material is a terrain material with `blend.source: 'VERTEX_COLOR'`, `RGB_AO`, `ao.vertex`, its layers base, R, G, B ([Vertex-colour splat](terrain-vertex-color-splat.md#import-into-ækasha)). The scene lists the block in `terrainBlocks` and spawns it with `await spawnTerrainBlock(id)`, as a Blender block; the generation runs on the worker during the spawn. A rule with noise reads `macroNoise`, which the scene lists in its `textures`.

**From code** (`aekasha/toolkit/geometry`), a 3 × 3 patch of 64 m blocks that continue each other:

```ts
import { createMeshEntity, getCurrentSceneId, saveBufferGeometry } from 'aekasha';
import { createPhysicsEntity } from 'aekasha/physics';
import { generateTerrainAsync } from 'aekasha/toolkit/geometry';

const sceneId = getCurrentSceneId();
for (let gz = -1; gz <= 1; gz++) {
  for (let gx = -1; gx <= 1; gx++) {
    const center: [number, number] = [gx * 64, gz * 64];
    const block = await generateTerrainAsync({
      width: 64,
      depth: 64,
      widthSegments: 128,
      depthSegments: 128,
      maxHeight: 12,
      seed: 7, // one seed for the patch: the noise is sampled at the world place
      center,
      normals: 'HEIGHT_FN',
      ao: { radius: 12 },
      vertexColors: { layout: 'RGB_AO', rules: [{ layer: 1, slope: { min: 30, softness: 8 } }] },
      collider: true,
    });
    if (getCurrentSceneId() !== sceneId) return; // the scene was left meanwhile
    const meshId = createMeshEntity({
      geo: saveBufferGeometry(block.geometry, { id: `patch_${gx}_${gz}` }),
      mat: 'patchTerrain',
      position: { x: center[0], y: 0, z: center[1] },
    });
    await createPhysicsEntity({
      colliders: [block.heightfield!],
      body: { rigidType: 'FIXED' },
      target: meshId,
    });
  }
}
```

The geometry stays centred on its origin: place the mesh at `center`. `getHeightAt(x, z)` gives the mesh's height under a point of its own space (the triangle's, so a body placed with it sits on the mesh); `heights` and `ao` are the row-major grids.

**A heightmap** (code only for now: a heightmap isn't an asset the gather knows yet):

```ts
import { generateTerrainAsync, loadTerrainHeightmapAsync } from 'aekasha/toolkit/geometry';

const map = await loadTerrainHeightmapAsync({
  url: new URL('./valley.r16', import.meta.url).href,
  format: 'R16',
  size: 129, // texels a side (or [columns, rows])
  heightRange: [-4, 36], // R16's 0..65535 onto these metres
  extent: 64, // the world size it covers: the corner texels on its corners
});
const block = await generateTerrainAsync({
  width: 64,
  depth: 64,
  widthSegments: 128,
  depthSegments: 128,
  heightmap: map,
  normals: 'HEIGHT_FN',
  collider: true,
});
```

One map can cover many blocks (its `extent` the world's, each block its `center`): the worker gets it once.

**Your own generator** for JSON blocks: `registerTerrainGenerator(id, ({ params, seed, grid, blockId }) => ({ geometry, heightfield }))` (`aekasha/terrain`) from an install; the geometry centred, `grid.resolution` vertices a side, y = 0 its base. It may return a promise (`generateTerrainAsync` inside).

## Set-up and parameters

`generateTerrain` / `generateTerrainAsync`:

| Option                           | What it is                                                                                                                                                                                              | Default                         |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `width`, `depth`                 | The size in world units, centred on the origin                                                                                                                                                          | –                               |
| `widthSegments`, `depthSegments` | Cells along x and z (a block: `resolution − 1`)                                                                                                                                                         | –                               |
| `maxHeight`                      | The noise's peak: heights within ±`maxHeight` (required unless `heightFn` or `heightmap`)                                                                                                               | –                               |
| `noiseOctaves`                   | `{ frequency, amplitude }[]`: cycles a metre and weight (normalized)                                                                                                                                    | 1/50 at 1, 1/18 at 0.35         |
| `seed`                           | An integer: the same seed, the same terrain                                                                                                                                                             | 1                               |
| `center`                         | The block's centre in the world, `[x, z]`: where the noise is sampled                                                                                                                                   | `[0, 0]`                        |
| `heightFn`                       | `(x, z) => height` at the world place, in place of the noise (main thread only)                                                                                                                         | –                               |
| `heightmap`                      | `loadTerrainHeightmapAsync`'s map, bilinear at the world place (the edge's height past it)                                                                                                              | –                               |
| `heightModifier`                 | `(x, z, h) => h'` after the noise, the function or the map: flatten a building site, sink edges (main thread only)                                                                                      | –                               |
| `normals`                        | `GEOMETRY` (the triangles) or `HEIGHT_FN` (central differences past the edge: seamless across blocks)                                                                                                   | `GEOMETRY`                      |
| `ao`                             | `{ radius, strength?, steps? }`: the horizon AO's reach in metres, the darkening at a hidden sky (0..1), the samples per direction                                                                      | None (`strength` 1, `steps` 16) |
| `vertexColors`                   | `{ layout, rules?, noise? }`: `RGB_AO` or `RGBA`, the rules laid over the base in order, the noise texels a rule with `noise` reads (`readTextureTexelsAsync('macroNoise')`, `aekasha/toolkit/terrain`) | None                            |
| `collider`                       | Also return `heightfield`, the `HEIGHTFIELD` params, the mesh's cells                                                                                                                                   | false                           |
| `skirt`                          | A strip this deep down from each edge: hides the cracks between blocks of different resolutions                                                                                                         | 0                               |
| `workerTarget` (async only)      | `WORKER_THREAD` (the toolkit's terrain worker) or `MAIN_THREAD`                                                                                                                                         | `WORKER_THREAD`                 |

The generators' `params` (a block's `geometry.params`; each error names the generator, the block and the param):

| Param          | Generators     | What it is                                                 | Default             |
| -------------- | -------------- | ---------------------------------------------------------- | ------------------- |
| `maxHeight`    | both           | The noise's peak                                           | 8                   |
| `octaves`      | both           | `[frequency, amplitude]` pairs                             | The default octaves |
| `normals`      | both           | `HEIGHT_FN` or `GEOMETRY`                                  | `HEIGHT_FN`         |
| `skirt`        | both           | The skirt's depth                                          | 0                   |
| `layout`       | `rulesTerrain` | `RGB_AO` or `RGBA`                                         | `RGB_AO`            |
| `rules`        | `rulesTerrain` | 1 to 16 terrain rules, checked as the material checks them | –                   |
| `ao`           | `rulesTerrain` | `{ radius, strength?, steps? }`                            | None                |
| `noiseTexture` | `rulesTerrain` | The texture a rule's noise reads                           | `macroNoise`        |

Both always return the heightfield (a `TRIMESH` or `NONE` block ignores it).

**Seeds and determinism.** A block's height noise uses its `seed` as it is, sampled at its world place (`grid × size`): blocks of one seed continue each other, and the same seed gives the same world on every machine and every visit. A block's own randomness (its scatter: [Terrain scatter](terrain-scatter.md#set-up-and-parameters)) mixes the seed with `grid.x` / `grid.z`. For worlds that vary per save, derive the seed from the world seed (`getRandomSeed()`, `setRandomSeed()` on `aekasha`), never from a named stream: `getRandomStream` restarts with each scene load and depends on the draw order, so two blocks spawned in another order would differ.

## Variations

- **Rules in the vertex colours or in the shader** (the same `TerrainRule`s either way):

  |                      | Baked into the colours (`vertexColors.rules`, `rulesTerrain`)         | Per pixel (`blend.source: 'RULES'`)                  |
  | -------------------- | --------------------------------------------------------------------- | ---------------------------------------------------- |
  | GPU                  | Nothing for the weights                                               | About 0.01 ms; noise fetches                         |
  | Layers               | Up to 5 (`RGBA`), 4 with the AO                                       | Up to 16                                             |
  | Border detail        | Per vertex (0.5 m on 64 / 129), sharpened by the height blend         | Per pixel, the noise breaking it up at any distance  |
  | Changing it          | Regenerate the block                                                  | Live: a uniform (a snow line moving with the season) |
  | Gameplay can read it | Yes: the CPU knows each vertex's layer (footstep sounds, spawn rules) | No (GPU only)                                        |

  The gallery's Blocks patch switches the same nine blocks between the two (below): the layers land in the same places, the colours' borders a little softer.

- **`HEIGHT_FN` vs `GEOMETRY` normals:** `HEIGHT_FN` for any block with a neighbour (seamless light across the edge, and slightly faster); `GEOMETRY` for a lone block whose triangles should shade faceted (a low-poly look with few segments).
- **The AO's radius:** about the size of the hollows to darken: 8 m for small dells on a 32 m block, 16-24 m for valleys. `strength` under 1 keeps valleys from going too dark under a bright sky. The engine applies it to indirect light (`ao.vertex`).
- **A collider or not:** `collider: true` costs a transpose of the heights on this thread; a background block takes `collider: { type: 'NONE' }` in its JSON. A `TRIMESH` block reads its triangles instead (costlier; generated terrain has no overhangs, so rarely needed).
- **A heightmap from a terrain tool:** erosion, rivers and terraces that noise can't make; `heightModifier` (main thread) for local edits on top.
- **A skirt** hides cracks where blocks of different resolutions meet (a far ring at half resolution), at the cost of a strip of vertices per edge.
- **Low poly:** few segments (a 64 m block of 16 cells), `GEOMETRY` normals, flat-shaded material: the grid's facets are the style.

## Pitfalls and checklist

- [ ] One seed for the blocks that should continue each other, and each block's `center` (or `grid`) its real place.
- [ ] `HEIGHT_FN` normals on blocks with neighbours.
- [ ] The mesh placed at `center`: the geometry is centred on its own origin.
- [ ] Re-check the scene after every `await` (`spawnTerrainBlock` does it and resolves `null`).
- [ ] A rule with `noise` gets the noise texels, and the scene lists `macroNoise`.
- [ ] `generateTerrainAsync` for anything over a small block: the main thread drops a frame.
- **"generateTerrainAsync: heightFn can't go to a worker":** a function can't be sent to a worker. Use a `heightmap`, or `generateTerrain` on the main thread.
- **Seams in the light between blocks:** `GEOMETRY` normals. Use `HEIGHT_FN`.
- **Blocks don't continue each other:** different seeds, a wrong `center`, or a `heightModifier` that doesn't depend on the world place only.
- **A different world on the second visit:** a seed drawn from `getRandomStream`, or `Math.random`. Use a fixed seed or the world seed.
- **A heightmap's "length isn't the size's":** the file's texel count doesn't match `size` at its format (2 bytes a texel for `R16`, 4 for `R32F`), or it has a header.
- **A heightmap block mirrored:** row 0 is the map's −z edge, column 0 its −x edge, as the terrain tools write them; a flipped export shows as a mound in the wrong corner.

## Template file and example asset ids

- **Blender template:** none (generated in the engine).
- **The API:** `generateTerrain`, `generateTerrainAsync`, `loadTerrainHeightmapAsync`, `evaluateTerrainRulesCPU`, the `TerrainRule` type (`aekasha/toolkit/geometry`); `registerTerrainGenerators`, `readTextureTexelsAsync` (`aekasha/toolkit/terrain`); `registerTerrainGenerator`, `spawnTerrainBlock` (`aekasha/terrain`); `toHeightfieldColliderParams` (`aekasha/physics`).
- **The gallery's Blocks patch** (`terrainGallery`, `?isDebug=true&startScene=terrainGallery`; `src/app/scenes/terrainGallery/patchRow.ts`, `patch/*.terrainBlock.json`): 3 × 3 `rulesTerrain` blocks of 32 m / 65, one seed, rocks by slope, snow by height and north facing, cliffs on steep faces, 8 m AO; its tab switches the same meshes between the vertex colour material and its `RULES` variant built from the blocks' own rules, with the vertex AO switch.
- **`terrainBlockTest`** (`?isDebug=true&startScene=terrainBlockTest`): a `noiseTerrain` block with its heightfield, a generated `TRIMESH` block, a block from the committed `terrainBlockTestHeightmap.r16` (64 m, its heights checked against the texels), and a 256 m / 257² `rulesTerrain` block its tab spawns and measures on either thread.
- **largeWorld** (`src/app/scenes/largeWorld/`): `generateTerrain` with the defaults on a large single mesh.
