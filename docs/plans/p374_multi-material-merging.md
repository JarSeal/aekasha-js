Status: in progress | Phases 0-2 implemented
Category: Merging, Materials, Texture atlas
Epic: p370_static-mesh-merging-and-texture-atlas-systems.md (Tier 2.1)
Blocked by: p299_texture-arrays-and-atlases.md (only its Phases 2 and 4, done: build-time arrays, `sampleArrayLayer`)
Related: p302_material-and-texture-system-refactor.md (was a blocker, dropped 2026-11-11: see §1), p303_texture-sets-and-terrain-texture-library.md (layer arrays: the terrain case of the same idea), p305_terrain-material-generator.md (binding budget), \_DONE_p345_gpu-memory-and-draw-call-debugger.md, \_DONE_p085_material-editor-params-and-persistence.md

# Multi-Material Merging (Merge Materials)

Lets meshes with **different materials** share one draw. A merge material stands in for a palette
of materials:

- every merged vertex carries the index of its source material (`aekMatIndex`);
- a parameter table holds each source material's scalar inputs (colour, roughness, metalness,
  emissive, UV transform);
- one texture array per map slot holds each source material's map as a layer (p299), so normal,
  ORM, AO and emissive maps each have their own array, all linked to the palette.

It only merges materials that can share one shader (a compatibility class). Everything else falls
back to one group per material (p372).

---

## 1. Grounding

- **Materials** (`kernel/assets/Material.ts`): classic types (`STANDARD`, `PHONG`, …) with
  `params`, where texture map keys (`TextureMapKeys`, on `aekasha`: `map`, `normalMap`, `aoMap`,
  `roughnessMap`, `metalnessMap`, `emissiveMap`, …) are texture ids; and TSL node materials with
  per-socket `nodes` (a TSL material's file loads with its scene's assets, `devTools/gather/CLAUDE.md`).
  `createMaterial` caches by id and stores its `props`; variants are `${baseId}#hash`
  (`getMaterialVariant`).
- **p302 is not a blocker (decided 2026-11-11).** p302 (`setup` entry, `registerTslMaterial`,
  input resolvers) is still `draft | not-implemented`. p374 used only `registerTslMaterial` (D3,
  to register the merge material as `aek:merge`) and none of the resolvers. The merge material is
  built in code, one per palette, with no JSON, variants or editor params, so `MergeMaterial.ts`
  makes a `MeshStandardNodeMaterial`, sets its sockets and registers it with `saveMaterial` (as
  the p299 scenes do). Once p302 lands it may move onto `registerTslMaterial`; open question 3
  still waits on p302's Phase 3 spike.
- **p299 (Phases 0-4 built; Phase 5, the JSON binding, isn't needed here):** build-time KTX2 arrays (`*.textureArray.json`, layers resized to
  one size, `ktx create --layers`), runtime assembly for same-sized members (`buildTextureArray`),
  `sampleArrayLayer` (`kernel/assets/TextureArray.ts`), and their debug views (the Assets tab's
  info window). Its JSON binding (Phase 5) waits for p302 D4, as this plan does.
- **p372 (built):** groups of same-material members (`MergeGroupData._material`, the first
  member's; `getMergeRefusal` refuses another material and a material array, the latter's text
  naming p374), `mergeGeometryParts` with a part table (`MergePart`: `geo`, `matrix`,
  `materialSlot`, `key`; `userData.mergeParts`: `MergePartRange`), `AUTO` buckets keyed by the
  material's `userData.id` (`getAutoCompatibilityKey`). The in-place writes (`MergeRanges.ts`)
  rewrite only position, normal and tangent, so `aekMatIndex` survives them.
- **Binding budget:** WebGPU's default is 16 sampled textures per stage, and shadow maps and the
  environment PMREM count against it (p301 §6).
- **WebGL2 backend:** array textures work; storage buffers don't (Phase 0: three r187's PBO path
  for a storage read in a fragment shader fails the draw, "Vertex buffer is not big enough").
- **Draw behaviour** (p370 §2.1): a multi-material mesh is one draw per group, so a material array
  is no draw-count win; only one material is.

## 2. Design

### D1 — Compatibility classes

A palette may only hold materials that agree on:

| Property            | Why                                                                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Shading model       | one node graph: `MeshStandardNodeMaterial`-equivalent (`STANDARD` classic or a standard node material without custom sockets)           |
| Alpha mode          | opaque, or alpha-test with one `alphaTest` threshold; never `transparent`                                                               |
| `side`              | culling is per draw                                                                                                                     |
| Vertex requirements | normal-mapped members need tangents (or the analytic/derivative frame)                                                                  |
| Feature set         | the merged shader is the **union** of features; the palette warns when one member drags a feature (emissive, clearcoat) into the others |

`PHYSICAL` features (clearcoat, sheen, transmission) are out of the first version. Custom TSL
materials don't merge automatically (open question 1).

### D2 — Palettes (`*.mergeMaterial.json`, engine asset type)

```json
{
  "id": "ruinsPalette",
  "materials": ["ruinStone", "ruinBrick", "ruinMoss", "ruinPlaster"],
  "slots": {
    "map": { "size": [1024, 1024] },
    "normalMap": { "size": [1024, 1024] },
    "orm": { "size": [1024, 1024], "from": ["aoMap", "roughnessMap", "metalnessMap"] }
  },
  "optimize": { "profile": "prop" }
}
```

- `gatherAppData` validates the class (D1) from the member material JSONs and generates one
  p299 `*.textureArray.json` job per slot: layer `i` is material `i`'s map, resized to the slot
  size. `orm` packs AO, roughness and metalness through p300's `pack` when the members have
  separate maps.
- **Missing maps** get a neutral layer (white albedo, flat normal `(0.5, 0.5, 1)`, ORM `(1, 1, 1)`
  scaled by the table's scalars: three multiplies the scalar roughness and metalness by the map's
  g and b, so white keeps a member's scalars; Phase 0 verified it with a metalness 0.3 member), or, per slot, `"missing": "SKIP"`: a per-entry flag that skips
  the fetch (a uniform branch per triangle).
- Arrays are built at build time: KTX2 can't be resized or re-encoded in the browser. A palette
  whose member textures already share size and codec can opt into runtime assembly
  (`"assembly": "RUNTIME"`) instead, so the members' own KTX2s are reused (p299 D1).

### D3 — The merge material

- **`aekMatIndex`**: a per-vertex `Uint8` (`Uint16` past 256 materials) attribute with
  `gpuType = IntType` (WebGL2 reads it as an integer only so), read as a `uint` through a flat
  varying. Written by `mergeGeometryParts` from each part's palette index (`MergePart` gains
  `paletteIndex`, kept in its `MergePartRange`), so worker builds carry it too. Flat per triangle by
  construction. Phase 0: `Uint8`, `Uint16`, `Uint32` and `Float32` all render the same on both
  backends (three's WebGPU backend widens 8- and 16-bit integer vertex attributes to 32 bits on
  upload, so `Uint8` saves CPU and transfer memory only there).
- **Parameter table** per palette entry, 5 vec4s: colour rgb + opacity; emissive rgb +
  intensity; roughness, metalness, normal scale xy; UV row 0 (the maps' `texture.matrix`:
  m00, m01, m02) + AO intensity; UV row 1 (m10, m11, m12) + slot flags. The UV transform is the
  member's first map's `matrix` (offset, repeat, rotation, centre), applied as three applies it,
  `(M * vec3(uv, 1)).xy`; a member's maps must share it (Phase 1 validates). Stored as (decide at
  Phase 2's start, from Phase 0's "As built"):
  - one path on both backends: a uniform array (`uniformArray(vec4[])`, capped by the UBO size:
    16 KiB on WebGL2 at least, ~204 entries) or a float `DataTexture` read with `textureLoad`
    (no cap). Both render identically in Phase 0;
  - the plan's first split (a WebGPU storage buffer, a WebGL2 uniform array or texture) isn't
    needed: the storage buffer renders the same as the other two on WebGPU and fails on WebGL2.
- **The merge material** (`features/merging/MergeMaterial.ts`, `merging()`'s, loaded with an
  `import()` on the first palette a scene uses (p370 §13)): a `MeshStandardNodeMaterial` built in
  code and registered with `saveMaterial` (no p302: §1). It reads the entry by `aekMatIndex` (a
  flat varying), applies its UV transform, samples each slot's array with
  `sampleArrayLayer(arr, uv, layer)`, and sets `colorNode` (colour × albedo, opacity × alpha),
  `normalNode` (`normalMap(sample, normalScale)`), `roughnessNode` (× ORM g), `metalnessNode`
  (× ORM b), `aoNode` (`(ORM r - 1) × intensity + 1`, as three's `aoMap`), `emissiveNode`. Phase 0's
  `src/app/scenes/mergeMaterials/mergeMaterialPrototype.ts` is its first version.
- One merge material per palette, shared by every group that uses it, so the pipeline compiles
  once.

### D4 — Groups use palettes

- An explicit group with `"palette": "ruinsPalette"` accepts members whose material is in the
  palette; others are refused with a dev warning (p372 §5).
- `AUTO`: the compatibility key uses the palette id instead of the material ref for materials that
  belong to a palette the scene lists (`mergeGroups` `AUTO` entry `"palettes": [...]`), so
  members with different palette materials in one cell land in one group.
- Material variants (`matOverrides`) of a palette material are separate materials: listed in the
  palette or refused.
- **A member with a material array** (geometry groups) is refused today with "multi-material
  merging is p374" (`MergeEligibility.ts`), but D1-D3 merge only members of one material each.
  Decide at Phase 3: merge it when every material of the array is in the palette (each group's
  vertices get that material's palette index), or keep refusing it and reword the refusal.

### D5 — Measurements and the "when not" list

Measured in the profiler (draws, GPU ms, the GPU memory tab's VRAM by owner) on a test scene of
4 materials × 400 meshes in 9 cells, merge material vs per-material groups vs unmerged, both
backends. Recorded here and in the handbook:

- don't palette materials with very different texture sizes (the small ones get upscaled);
- don't palette a feature only one member uses;
- don't merge across alpha modes;
- prefer per-material groups when there are only 2–3 materials per cell (the gain is small).

## 3. Phases

### Phase 0 — Prototype (1 day) — done

Two standard materials, hand-made 2-layer arrays, a hand-written table, one merged geometry with
`aekMatIndex`. **Exit:** same image as two separate meshes on WebGPU and WebGL2, one draw.

As built (verified 2026-11-11 on macOS Chrome, WebGPU and WebGL2 (`navigator.gpu` hidden; ANGLE on
Metal), `?isProdTest=true`, 1200 × 800 screenshots diffed per channel):

- **The scene** `mergeMaterials` (`src/app/scenes/mergeMaterials/`, a debug scene, D5's test scene
  later): two `STANDARD` materials made with `createMaterial` (A: albedo, normal and ORM maps,
  `aoMapIntensity` 0.8; B: albedo and normal maps with a UV transform (offset, repeat, rotation,
  centre), no ORM map, metalness 0.3, emissive, normal scale `(0.6, -0.6)`) on eight members
  (spheres, boxes, tori, cylinders, one mirrored). Textures are made in code (256², RGBA8, GPU
  mips), the same bytes in a material's map and its `DataArrayTexture` layer. Orthographic camera,
  so a variant shown alone at the origin (`window.__mergeMaterials.show(variant)`) is diffable
  pixel for pixel. Variants: `REFERENCE` (eight entities), `BAKED` (the control: the members merged
  with `groups: 'BY_SLOT'`, drawn by the two materials as a material array), and one merged
  geometry with `aekMatIndex` drawn by the merge material per table kind (`UNIFORM`, `TEXTURE`,
  `STORAGE`; `STORAGE` WebGPU only). `?aekMatIndex=uint8|uint16|uint32|float32`; `?aekMips=false`
  and `?aekStrip=normal,ao,orm,emissive` were the bisection switches.
- **One draw:** draws per frame with each variant shown alone, both backends: none 1,
  `REFERENCE` 9, `BAKED` 3, each merge variant 2.
- **Same image:** WebGL2: each merge variant against `BAKED` differs on 3 pixels by 1/255. WebGPU:
  the three table kinds render bit-identical to each other; against `BAKED`, mean 0.007/255,
  855 pixels over 2/255, 27 over 16 (max 52), on internal triangle edges, texel edges and
  silhouettes of the curved members; the bake alone (`REFERENCE` against `BAKED`) is 47 over
  2/255. Bisected: with only the albedo map and no mips it stays (143 over 2/255, the bake alone
  max 49 too), and A's UV transform is the identity there, so it's no UV or table error: two
  pipelines compiled apart (Metal) round interpolation and coverage differently. Phase 2's exit
  ("within compression error") should diff against the `BAKED` control, not the separate meshes.
- **Index types:** all four render the same on both backends with no error (D3).
- **Neutral ORM** is white `(1, 1, 1)`, not D2's first `(1, 1, 0)`: B (no ORM map, metalness 0.3)
  matches with a white layer (D2 corrected).
- **The table:** the storage buffer fails on WebGL2 (§1); the uniform array and the float texture
  match each other bit for bit on both backends (D3 lists the choice).
- Not covered by Phase 0, for later phases: tangents (the members had none, so both sides used the
  derivative frame; a member with a `tangent` attribute and one without in one group get the
  merge's computed tangents: D1's vertex requirements), compressed (KTX2) arrays, and a palette
  of more than two entries.

### Phase 1 — Palette asset and build (D1, D2) — done

Schema, class validation, generated array jobs, `orm` packing, neutral layers. **Exit:**
`yarn assets` builds `ruinsPalette`'s three arrays; a class violation fails the gather with the
material and property named.

Sections (each stopped for review):

1. **Schema and class (D1).** `MergeMaterialAssetSchema` (`features/merging/MergeMaterialSchema.ts`,
   on `aekasha/schemas`), the `*.mergeMaterial.json` suffix in the gather (its JSON Schema in
   `.schemas/`), the class check over the member material JSONs
   (`devTools/assetPipeline/mergeMaterialClass.ts`), and the palette registered in pass 1 after the
   materials (`devTools/gather/mergeMaterials.ts`): a violation fails the gather naming the
   material and the property.
2. **Array jobs (D2).** Each slot one array job (`ArraySource` with its own output name): a
   member's map as its layer, a neutral layer (a pack of constants at the slot size) for a member
   without one, `orm` packed from separate AO, roughness and metalness maps; the pipeline reads
   the palettes and materials (`readAssetJsons`), the dev plugin rebuilds on a member's change,
   the gather registers each slot as the texture `<paletteId>.<slot>` with its `__url`s and writes
   the per-entry flags into the palette's generated entry. Members' textures must agree on their
   sampler state (wrap, filters) per slot: an array has one sampler.
3. **The test palette.** `ruinsPalette` and its four materials in `src/app/scenes/mergeMaterials/`
   (sources from a fixture generator, plus the MetalRust set's separate maps for the `orm` pack),
   `yarn assets` building its three arrays, a class violation checked by hand and in a test.

   Not the MetalRust set after all: its 2048² maps would have committed megabytes of member
   outputs, and Phase 2's comparison is cleaner with members and layers at one size.

Decisions (2026-11-11, at the phase's start):

- **The asset.** `slots` takes four fixed names, the merge material's: `map`, `normalMap`, `orm`
  (`from`: a subset of `aoMap`, `roughnessMap`, `metalnessMap`, default all three) and
  `emissiveMap`. Each needs its `size`; `missing` is `NEUTRAL` (default) or `SKIP`. `materials`
  is 2-256 unique `*.material.json` ids: 256 is both backends' array layer floor (WebGPU's default
  `maxTextureArrayLayers`, WebGL2's minimum `MAX_ARRAY_TEXTURE_LAYERS`). `optimize` is an array's
  without `slot` (each slot's pipeline slot is implied: `baseColor`, `normal`, `orm`, `emissive`).
  `"assembly": "RUNTIME"` (D2) isn't in Phase 1.
- **Ids.** A palette's id is in the materials' id space (Phase 2 registers its merge material),
  its slot arrays in the textures' (`<paletteId>.<slot>`, like an atlas slot). The dev data gets a
  `mergeMaterials` section; nothing ships to production until a scene uses a palette (Phase 3).
- **The class (D1), from each member's own JSON** (a scene's save entry over a member's `params`
  isn't read: warned). Errors: an id that isn't a material JSON's, a TSL material (open question
  1), a type other than `STANDARD` (`PHYSICAL` named for its features), `transparent`, a map with
  no slot (or left out of `orm`'s `from`) and a map the merge material doesn't have (`bumpMap`,
  `alphaMap`, …), and any other parameter the members don't agree on (`side`, `alphaTest`,
  `flatShading`, `envMapIntensity`, …; a missing one counts as three's default). The table's
  parameters (colour, opacity, emissive and its intensity, roughness, metalness, normal scale, AO
  intensity) may differ. Warnings: a slot no member uses (no array is built), and a feature (a
  slot, emissive) only one member uses.
- **The UV transform** isn't in a material or texture JSON (`TexOpts` has no offset or repeat), so
  every JSON member's is the identity and Phase 1 has nothing to validate: the check that a
  member's maps share one moves to Phase 2 (code-made materials).
- **Tangents** (D1's vertex requirements) are the geometry's: Phase 3, when members join a group.

As built, section 2 (the array jobs):

- **The resolver** `resolveMergeMaterial` (`devTools/assetPipeline/mergeMaterials.ts`), shared by the
  gather and the pipeline: the class check, then per slot a member uses one `ArraySource` (layer
  `i` keyed by member `i`'s id) at the slot's `size`. A member without the map gets a neutral layer,
  a pack of constants (`rgb: 1`; the normal map's `0.5, 0.5, 1`; alpha 1 when another layer makes the
  array RGBA). `orm`: a member whose `aoMap`, `roughnessMap` and `metalnessMap` are one texture
  gets it as its layer; else a pack of their r, g and b (a missing map's channel 1, so the scalar
  stays), each from a texture's file (a packed or cube texture there is an error). A slot no
  member uses has no job.
- **Sampler state per slot:** the textures of a slot's members must agree on `mapping`, `wrapS`,
  `wrapT`, `magFilter`, `minFilter` and `anisotropy` (a missing one is three's default: clamp,
  linear, trilinear, 1); the array's `texOpts` carries what one of them sets, plus `srgb` for
  `map` and `emissiveMap`.
- **The pipeline:** each slot is a `textureArray` job (key `mergeMaterial:<json>:<slot>`, id
  `<paletteId>.<slot>`, the palette's `optimize` with the slot's pipeline slot: `baseColor`,
  `normal`, `orm`, `emissive`), its output `<json path>.palette.<slot>.ktx2` (`ArraySource` gained
  `logicalPath` and `jsonFiles`: the members' and packed textures' JSONs, so the dev plugin
  rebuilds a palette when one changes). `readAssetJsons` reads the material and palette JSONs too;
  a palette whose class or layers fail is dropped (no prune). The dev plugin runs the pipeline on
  a `*.material.json` change now (a cache look-up for a material in no palette).
- **The gather:** each slot's array is registered in its own registry (`mergeMaterialSlots`, the
  textures' id space) as an array texture (`MergeMaterialSlotTexture`: `__layers` the member ids,
  so the runtime loads it as an array; `__mergeMaterial: { id, slot }`; the generated fields), and
  the palette gets `__slots` (`MergeMaterialSlotInfo` per slot: its texture, `has` by member, and
  `missing: 'SKIP'`). A scene can list a slot's texture id in `textures` (dev and production, with
  the production output check, `checkMergeMaterialSlot`); how a scene names a palette is Phase 3.

As built, section 3 (the test palette; verified 2026-11-11):

- **`ruinsPalette`** (`src/app/scenes/mergeMaterials/`): `ruinStone`, `ruinBrick`, `ruinMoss`,
  `ruinPlaster` (`STANDARD`), slots `map`, `normalMap`, `orm` at 256², profile `prop`. Each member
  builds its layers another way: `ruinStone` one ORM map as its `aoMap`, `roughnessMap` and
  `metalnessMap` (the layer as it is), `ruinBrick` a separate roughness map (packed r 1, g, b 1),
  `ruinMoss` an albedo only (neutral normal and ORM layers), `ruinPlaster` separate AO, roughness
  and metalness maps (a full pack, a metal trim band) and no normal map. Sources: 11 procedural,
  tileable 256² PNGs (456 KB) in `source/`, from `devTools/assetPipeline/fixtures/mergeMaterialsFiles.ts`
  (deterministic, run by hand). Each member texture has its own JSON and output too (Phase 2's
  reference draws the members with them): 14 KTX2 outputs, 660 KB, committed with the lock.
- **The exit:** `yarn assets` builds the three arrays (256², 4 layers, 9 levels, UASTC + zstd;
  map 117 KB, normalMap 74 KB, orm 107 KB). Each layer transcoded back (`ktx extract`) is what it
  should be: the neutral normals exactly 128/128/255, `ruinMoss`'s ORM white, `ruinBrick`'s r and b
  255, `ruinPlaster`'s metalness 0-255 only in the band. With `side: 2` and a `bumpMap` on
  `ruinMoss`, `yarn gatherAppData` fails naming `materials[2] "ruinMoss" … params.bumpMap` and
  `params.side differs: 0 in "ruinStone", "ruinBrick", "ruinPlaster"; 2 in "ruinMoss"`, and the
  pipeline drops the palette (no prune). A development gather exits 0 on a failure as before
  (only a production gather and `yarn assets` exit 1). `mergeMaterials.test.ts` pins the repo
  palette's layers per slot.

### Phase 2 — Runtime material and table (D3) — done

**Exit:** a 4-material palette renders identically to the 4 materials (screenshot diff within
compression error), with the table on both backends.

Starts from (Phase 1): `ruinsPalette` and its members (their own textures built too, for the
reference); the dev data's `mergeMaterials.<id>` (the JSON, `__slots`: each slot's texture id,
`has` by member, `missing: 'SKIP'`) and each slot's array texture `<id>.<slot>`, which a scene's
`textures` can list today and `loadTextureAsync` loads as a `CompressedArrayTexture` (`__layers`:
the member ids). Still open at its start: the table's storage (D3), the check that a code-made
member's maps share one UV transform (moved from Phase 1), and how the merge material finds its
palette's data at runtime (a production scene carries only what it lists: decide with Phase 3's
`palette` on groups, or have the scene list the slot textures). Diff against the `BAKED` control
(Phase 0).

Decisions (2026-11-11, at the phase's start):

- **The table is a float texture** (`DataTexture`, RGBA32F, `TABLE_VEC4S` texels wide, one row
  per entry, read with `textureLoad`): one path on both backends, no entry cap (the 256 maximum
  stays), no sampler, and a fetch whose index differs across a warp (at member borders) costs
  little. It takes one sampled-texture binding: four arrays and the table are 5 of WebGPU's 16.
- **A scene lists its palettes** (`mergeMaterials: ["ruinsPalette"]`, merging's schema part, so
  the feature manifest names `merging`). The gather inlines each palette into the scene's data
  and adds its slot textures to the scene's `textures` (deduplicated), so production carries a
  palette only for a scene that lists it. Phase 3's group `palette` and `AUTO` `palettes` name a
  palette the scene lists.
- **The gather bakes the table's values** (`__entries`, one per member: the table parameters of
  its material JSON, three's default for a missing one); the runtime converts them (a colour
  string through `THREE.Color`, so into the working colour space). The merge material needs
  neither its members' materials nor their textures. A JSON member's UV transform is always the
  identity (Phase 1), so the shared-UV check is dropped until a code-made palette API exists
  (none in Phase 2). A scene's save entry over a member's `params` isn't read (Phase 1's warning
  stands).

Sections (each stopped for review):

1. **`aekMatIndex` in the merge (kernel).** `MergePart.paletteIndex`, kept in its
   `MergePartRange`; when a part has one, `mergeGeometryPartsCore` writes `aekMatIndex` (`Uint8`,
   `Uint16` past 255; `gpuType = IntType`; a part without one gets 0), the worker path keeps it,
   the in-place writes leave it. Tests.
2. **The palette in a scene's data (gather).** The scene's `mergeMaterials` list (schema part),
   the palette inlined with `__entries`, its slot textures added to the scene's `textures`, the
   production output checks. Tests.
3. **The merge material (runtime).** `features/merging/MergeMaterial.ts`, loaded with an
   `import()` on the first palette: the table texture, the node graph (Phase 0's, plus the
   `emissiveMap` slot and `SKIP`'s per-entry flags), one per palette registered under the
   palette's id with `saveMaterial`, released with its scene; its API on `aekasha/merging`.
   Tests.
4. **The test scene.** `mergeMaterials` on `ruinsPalette`: `REFERENCE` (the members with their
   own materials and textures), `BAKED` and the merge material; the diff on both backends (the
   exit); Phase 0's prototype removed; `features/merging/CLAUDE.md`.

As built, section 1 (`aekMatIndex` in the merge):

- **`MergePart.paletteIndex`** (public, `mergeGeometryParts` and its async and register forms;
  `ResolvedMergePart`, `TransferableMergePart` and the worker job carry it). When any part has
  one, `mergeGeometryPartsCore` writes `MERGE_PALETTE_INDEX_ATTRIBUTE` (`'aekMatIndex'`,
  `@internal`, `GeometryMergeCore.ts`): `Uint8` up to index 255, else `Uint16`, `gpuType =
  IntType`, a part without an index 0; it replaces a part's own `aekMatIndex` (a merged geometry
  merged again), and each `MergePartRange` gets `paletteIndex`. Without any index, no attribute
  and no `paletteIndex` in the ranges (the existing range tests unchanged).
  `assertPaletteIndices` (`@internal`) throws for an index that isn't an integer 0-65 535, in the
  core and, before anything is sent, in `mergeGeometryPartsAsync`.
- **Integer attributes stay integers** (any attribute, not only the palette index): one whose
  every part has `gpuType` `IntType` (not normalized) is copied raw into the widest of its parts'
  integer arrays, keeps `IntType`, and a part without it gets 0. Before, it became a `Float32` and
  lost `gpuType`. three's `toNonIndexed` drops `gpuType`, so a non-indexed merge sets it again.
- **The worker hop:** `TransferableAttribute` (on `aekasha`) gained `isInteger?: true`, so
  `serializeGeometry` / `deserializeGeometry` keep `IntType` both ways.
- The in-place writes (`MergeRanges.ts`) touch position, normal and tangent only: nothing to
  change. A `MERGED` geometry JSON's parts have no `paletteIndex` (Phase 3 decides whether they
  need one).
- `api.json` gains `MERGE_PALETTE_INDEX_ATTRIBUTE` and `assertPaletteIndices`: recorded
  (`yarn verify:baselines --update`) at the phase's end.

As built, section 2 (the palette in a scene's data):

- **The table entries** (`MergeMaterialEntry`, `MergeMaterialSchema.ts`: `color`, `opacity`,
  `emissive`, `emissiveIntensity`, `roughness`, `metalness`, `normalScale` as `[x, y]`,
  `aoMapIntensity`) are read by the class check (`checkMergeMaterialClass` → `entries`, by palette
  index; `ENTRY_DEFAULTS`, three's `MeshStandardMaterial` values, replace the old `ENTRY_PARAMS`
  list and give its keys). A colour stays as the JSON gives it (a string or a hex number, sRGB:
  the runtime converts it with `THREE.Color.set`, as `setValues` does for the member); `normalScale`
  takes `[x, y]` or `{ x, y }`. A value of the wrong kind (a colour array, a number as a string,
  a single-number `normalScale`) is a class error naming the member and the property.
  `resolveMergeMaterial` returns them (`entries`, empty on an error), and pass 1 writes them into
  the palette's `__entries` (the dev data has them too).
- **The scene's list:** `mergeMaterials` in `mergingSchemaPart.scene` (after `mergeGroups`, so the
  JSON Schema's existing order stays; ids, each once), so a scene listing a palette gets
  `merging` in its feature manifest. `resolveSceneMergeMaterials` (`devTools/gather/mergeMaterials.ts`,
  run by `resolveSceneAssets` after the impostors, before the textures) replaces each id with a
  `SceneMergeMaterial` (`id`, `materials`, `throwOnError`, `userData`, `debugData` (not in
  production), `__slots`, `__entries`; no `slots`, `optimize` or `__sourcePath`) and appends its
  slot textures to the scene's `textures` unless the scene lists them already, so they load with
  the scene and `checkMergeMaterialSlot` checks their outputs in a production gather. An unknown
  id fails the gather (`reportUnknownId`). `SceneData.mergeMaterials` (`Scene.ts`, the type
  `import type`d from merging) is the runtime's view; `SceneMergeMaterial`,
  `MergeMaterialEntry` and `MergeMaterialSlotInfo` are on `aekasha/merging` and
  `aekasha/schemas`. No scene lists a palette yet (section 4's does).
- **For section 4:** three's `setValues` copies a `Vector2` only from a `Vector2`, so a material
  JSON's `normalScale: [0.8, 0.8]` (`ruinBrick`) makes the member's `normalScale` a plain array.
  The merge material uses `[0.8, 0.8]` from its entry; the reference member may render with a
  wrong or missing normal scale. Check `ruinBrick` alone in the reference first; if it's wrong,
  `createMaterial` converts a two-number array for a `Vector2` parameter (a kernel fix of its own).

As built, section 3 (the merge material):

- **The members' agreed state** (added to section 2's gather): the class check's
  `checkSharedState` also returns the state parameters the members set and agree on (`state`;
  one set to three's default counts), `resolveMergeMaterial` passes it on and pass 1 writes a
  non-empty one as the palette's `__state` (`SceneMergeMaterial.__state`). The merge material
  takes it with `setValues` (`side`, `alphaTest`, `flatShading`, `envMapIntensity`, …): D1 makes
  the members agree on it, and without it the merge material drew with three's defaults.
- **A kernel scene hook, `assetsLoaded(sceneData)`** (`SceneHooks.ts`, awaited, run by
  `loadNextSceneAsync` right after `loadNextSceneAssets`, before the scene code): `beforeAssets`
  is before the arrays load and `created` after the scene code, and the scene code (and a JSON
  mesh's `mat`) should find the merge material. `kernel/init/CLAUDE.md` and
  `kernel/scene/CLAUDE.md` name it.
- **`MergeMaterialLoad.ts`** (the only part in the first download, with `merging()`, which adds
  the hook): `createSceneMergeMaterialsAsync` does nothing for a scene without palettes; otherwise
  it loads `MergeMaterialRegister.ts` once (`import()`, again after a failed load), which holds
  the rest and imports `MergeMaterial.ts`: one lazy chunk, `MergeMaterialRegister.js`.
- **`MergeMaterialRegister.ts`:** `registerMergeMaterial` per palette finds each slot's array
  (`getTexture(<paletteId>.<slot>)`, an array texture: a stand-in or a missing one warns, or
  fails the load with `throwOnError`, and the slot samples neutral values). A registered merge
  material that samples the same arrays is re-tagged to the loading scene with its table (the
  next scene shares it); one whose arrays were loaded again is replaced; another material under
  the palette's id fails the load. Else `createMergeMaterial`, the table saved as the texture
  `<paletteId>.table` (`getMergeMaterialTableId`) and the material with `saveMaterial` under the
  palette's id, both owned by the loading scene. `getMergeMaterialInfo(material)` (`@internal`,
  here so the first download doesn't carry it; Phase 3 moves it if a group needs it there) reads
  `userData.mergeMaterial` (`MergeMaterialInfo`: `paletteId`, `materials`, `tableId`, `arrays`).
  No public API is new.
- **`MergeMaterial.ts`** (its own chunk): `packMergeMaterialTable` (`MERGE_TABLE_TEXELS` 5 RGBA
  floats per entry as D3; colours through `THREE.Color.set`, the UV rows the identity; texel 4's
  `w` the `SKIP` flags, bit `i` for `MERGE_MATERIAL_RUNTIME_SLOTS[i]` (the schema's slots, which
  the runtime can't import: zod; a test checks they match) when the member has the map),
  `createMergeMaterialTable` (RGBA32F `DataTexture`, nearest, no mips) and `createMergeMaterial`:
  Phase 0's graph, the table read with `textureLoad(table, ivec2(texel, index))`, the index
  attribute's name its own copy (`MERGE_MATERIAL_INDEX_ATTRIBUTE`: importing the merge core's
  split `GeometryMergeCore.js` into a chunk of its own; a test checks they match). A slot without
  an array gives every member its neutral value (no `normalNode` without `normalMap`, no
  `aoNode` without `orm`, the colour and scalars alone); `emissiveNode` only when an entry's
  emissive is above black with a non-zero intensity (times `emissiveMap` when there's one). A
  `SKIP` slot samples in an `If` on the entry's flag inside a `Fn` (`If` needs the builder's
  stack), with `.grad()` from `dFdx` / `dFdy` of the UV taken outside it (the branch is per
  triangle, which WGSL's uniformity analysis treats as non-uniform). The table and arrays go into
  `userData.uniforms` as texture nodes (`mergeMaterial_table`, `mergeMaterial_<slot>`), where the
  scene's asset release (`isTextureUsedByAnyMaterial`), streaming's priming and the GPU memory tab
  look: the release frees the material first, then its table and arrays.
- **Tests:** `MergeMaterial.test.ts` (the slots, the packing, the sockets per slot and emissive,
  the state, `userData`), `MergeMaterialLoad.test.ts` (registration and owners, sharing with the
  next scene and both releases, arrays loaded again, a missing array with and without
  `throwOnError`, an id taken by another material), the hook in `SceneHooks.test.ts` and its place
  in `SceneLoader.test.ts`. They build the node graph only: the GPU compile is section 4's, and
  `ruinsPalette` has no `SKIP` slot, so section 4 also draws a copy of its scene data with
  `missing: 'SKIP'` on `normalMap` and `orm` (the material takes the data, so no second palette
  JSON is needed).
- **The build** (`yarn sbp`, every profile within budget): `merging` in the first download 7.0 →
  7.1 kB gzip; the initial 386.0 KiB, over its 386 KiB budget by bytes (the hook's runner, the
  guard, section 1's transfer flag), so `sbp.config.ts`' `initial` is 387 KiB. Lazy: the new
  `MergeMaterialRegister.js` (2.2 kB), and section 1's growth of `GeometryMerge.js` and the
  assets worker's `AssetsSwitchMerge.js` (+0.4 kB each). `bundle.json` and `api.json` are
  recorded (`yarn verify:baselines --update`) at the phase's end.

As built, section 4 (the test scene; verified 2026-11-11 on macOS Chrome, WebGPU and WebGL2
(`navigator.gpu` hidden; ANGLE on Metal), `?isProdTest=true`, 1200 × 800 canvas screenshots diffed
per channel):

- **The scene** `mergeMaterials` lists `ruinsPalette` (`mergeMaterials`), its four members and
  their 11 textures. Eight meshes (Phase 0's shapes), each member twice, the mirrored torus a
  normal-mapped one (`ruinBrick`). Variants: `REFERENCE` (eight entities with the members' own
  materials and textures), `BAKED` (one geometry, `groups: 'BY_SLOT'` by palette index, the four
  materials as an array: the control), `MERGED` (one geometry with each part's `paletteIndex`,
  drawn by the material the hook registered under `ruinsPalette`) and `SKIP` (the same geometry,
  a merge material made from a copy of the scene data's palette with `missing: 'SKIP'` on
  `normalMap` and `orm`, registered as `ruinsPaletteSkip` with its table). Phase 0's table kinds,
  index types and bisection switches went with `mergeMaterialPrototype.ts` (removed).
- **`createMergeMaterialAsync(palette, tableId)`** (`@internal`, on `aekasha/merging`, in
  `MergeMaterialLoad.ts`; `createMergeMaterialFromData` in the lazy chunk): makes a merge material
  from palette data, unregistered. The app can't reach `createMergeMaterial`, and a scene's list
  takes a palette as its JSON is, so the `SKIP` copy needed an entry point (a second palette JSON
  would have built three more arrays of the same layers). Its user is the scene; tested in
  `MergeMaterialLoad.test.ts`.
- **`ruinBrick`'s `normalScale`** (section 2's note) was wrong in the reference: three's
  `setValues` left the JSON's `[0.8, 0.8]` a plain array, of which three's `ReferenceNode` makes a
  `uniformArray`. `createMaterial` now makes a `normalScale` or `clearcoatNormalScale` given as
  `[x, y]` or `{ x, y }` a `Vector2` (`Material.test.ts`). It took `MERGED` against `BAKED` from
  2 879 pixels over 2/255 to 478 on WebGPU.
- **Draws** with each variant shown alone, both backends: none 1, `REFERENCE` 9, `BAKED` 5,
  `MERGED` 2, `SKIP` 2.
- **The exit** (`MERGED` against `BAKED`): WebGPU mean 0.016/255, 478 pixels over 2/255, 1 over
  16, max 19; WebGL2 mean 0.013/255, 321 over 2/255, none over 16, max 13 (the bake alone,
  `REFERENCE` against `BAKED`: WebGPU 11 over 2/255, WebGL2 max 1). Spread thinly over every
  member: the arrays' layers and the members' own textures are separate UASTC encodes (the packed
  ORM layers of `ruinBrick` and `ruinPlaster` are other images altogether), and the neutral normal
  layer is 128/255, not 0.5, so a member without a normal map tilts by about 1/255 where its
  reference has none. Within compression error on both backends: met.
- **`SKIP`** compiles and draws on both backends with no error. Against `MERGED`: 910 (WebGPU) and
  903 (WebGL2) pixels over 2/255, max 32, on the minified, high-frequency texels of the members
  with the maps (`ruinBrick`'s mortar most), plus 1-2/255 everywhere on the members without them
  (the constant 0.5 normal against the 128/255 layer). Bisected: with `.grad()` from the same
  derivatives on the non-`SKIP` path too, `SKIP` against `MERGED` is 0 pixels over 2/255, so it's
  the explicit gradients' mip selection (`dFdx` / `dFdy` of the UV against the sampler's implicit
  ones), not the table, the flags or the branch. Phase 4's handbook notes it.
- Leaving the scene releases both merge materials, both tables, the arrays and the members'
  textures; a second visit makes them again with the same figures; `?isDebug=true` draws without
  errors.
- `features/merging/CLAUDE.md` gained `## Merge materials` (the asset and the gather, the load, the
  material, the API, the tests), listed in the Mesh merging page's `aek:covers` (the page's
  palette section is Phase 4's) and in the root's map.
- **The build** (`yarn sbp`, every budget met): the initial 386.2 kB gzip (budget 387 KiB),
  `merging` in it 7.1 kB (`createMergeMaterialAsync` adds bytes only), `MergeMaterialRegister.js`
  2.2 kB lazy. The phase's baselines are recorded (`yarn verify:baselines --update`: `api.json`
  gains section 1's and 3's internals and the entry's new names, `bundle*.json`, `docs.json` at
  100 %); no debug code in the production or embed builds.

### Phase 3 — Group integration (D4)

**Exit:** the test scene's `AUTO` groups drop from 36 (4 materials × 9 cells) to 9.

### Phase 4 — Measurements, handbook, versioning (D5)

1. D5's numbers in this file.
2. The array-material variation in `docs/techniques/terrain-modular-kits.md` (p372 Phase 5, with
   `SKIP`'s cost: its explicit gradients pick other mip levels, Phase 2's "As built"), the
   palette section on the Hub's Mesh merging page (p372 Phase 5) and the asset optimization page
   (`hub/pages/features/asset-optimization/`: the generated arrays); `yarn hub:build`.
3. `features/merging/CLAUDE.md` (its Merge materials section: Phase 3's groups and the
   measurements), `devTools/gather/CLAUDE.md` (the
   `*.mergeMaterial.json` suffix), `readme.md` Features.
4. Engine minor; `CHANGELOG.md`.

## 4. Versioning

Engine minor (asset type, merge material, group palettes).

## 5. Risks

| Risk                                                                         | Mitigation                                                                                  |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| The union shader is slower per pixel than the members were                   | Class validation (D1) warns per feature; D5 measures; per-material groups stay the fallback |
| WebGL2 uniform limits                                                        | 64-entry uniform array, `DataTexture` above                                                 |
| Upscaled layers waste VRAM                                                   | Per-slot `size`; budgets flag it; D5 rule                                                   |
| Mip selection differs from the source material (array layers share one size) | Same as a texture resize; mips are generated per layer at encode time                       |
| Members with different UV transforms or tiling                               | The table's UV transform per entry                                                          |
| Material editor (p085) edits a palette member, not the merge material        | Edits to a member update its table entry (a later hook; noted for p085)                     |

## 6. Open questions

1. **Custom TSL materials:** a `mergeable` contract (a material declares its per-entry parameters
   and array slots, and gets the table entry and layer as inputs) would merge them too. Wait for a
   use case.
2. Should palettes be generated automatically per scene from `merge: "AUTO"` meshes? It would need
   build-time scene analysis (and a rebuild when a scene changes); explicit palettes first.
3. **A shared-shader tier for what can't merge** (three r187's `NodeMaterialInstance`, p302 D2's
   variants as instances): meshes whose materials differ only in values could share one node
   build without merging. Fewer builds and pipelines, the same draw count. Decide once p302's
   Phase 3 spike has counted it.
