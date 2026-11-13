Status: implemented (Phases 1-5)
Category: Merging, Geometry, Assets
Epic: \_DONE_p370_static-mesh-merging-and-texture-atlas-systems.md (Tier 1.1)
Blocks: \_DONE_p372_mesh-merge-groups.md
Related: \_DONE_p347_lod-chain-generation.md (same worker path; merged geometry can get a chain), \_DONE_p300_asset-optimization-pipeline-plan.md (the GLB step D3 extends), p308_terrain-scatter.md (merging item types per cell)

# Geometry Merging

The "merge geometries" tool: several geometries with their transforms become one registered
geometry, with a table that remembers which vertex and index range came from which part. It works
at three levels:

- **code**: `mergeGeometryParts(parts)`;
- **asset JSON**: a `MERGED` geometry type listing parts;
- **imported GLBs**: a build-time `merge` option that joins a model's static pieces.

The result is an ordinary geometry id any mesh can use. Keeping the members as entities (the
"merge meshes" tool) is p372, which is built on this plan's part table.

---

## 1. Grounding

- **Ad hoc merges** call three's `mergeGeometries` directly and register the result with
  `saveBufferGeometry` (`kernel/assets/Geometry.ts`; checked 2026-11-04):
  `app/scenes/largeWorld/largeWorld.ts` (its merged props, without groups),
  `app/scenes/thirdPersonGymScene/gymStairsAndWall.ts` (the stairs, with groups) and
  `toolkit/geometry/generate/Foliage.ts` (the tree with groups, for a material array; the bush
  without).
- **`mergeGeometries`** (`three/examples/jsm/utils/BufferGeometryUtils.js`) requires every input to
  have the same attribute set and the same indexed-ness, and returns `null` otherwise. It doesn't
  apply transforms: callers bake them into each input first.
- **Registry** (`kernel/assets/Geometry.ts`): ref counted by id; `warnIfUnregistered`
  (`kernel/mesh/Mesh.ts`) warns in debug about a mesh geometry that isn't registered, since
  nothing would dispose it.
- **Geometry JSON** (`src/_engine/schemas/GeometrySchema.ts`): a union of `BOX`, `SPHERE`,
  `CYLINDER`, `CAPSULE`, `CONE`. No buffer or merged type.
- **GLB pipeline** (`devTools/assetPipeline/gltf.ts`, `devTools/assetPipeline/CLAUDE.md`):
  `encodeGLTFAsset` runs `weld`, `simplify`, `meshopt`/`draco` and `quantize`, and builds a
  JSON's `lodChain` (`lodChains.ts`). `flatten` and `join` from the installed
  `@gltf-transform/functions` 4.5.1 are not used. Collider nodes are forced lossless
  (`settings.ts`'s `COLLIDER_LEVEL`), since a reordered mesh breaks HEIGHTFIELD and CONVEXHULL
  colliders.
- **Import** (`kernel/assets/import/`): scene meshes reference imported geometry as
  `${assetId}/${nodeName}`; all pieces of an imported asset share one engine material.
- **Placement** (p370 §13): the utility is the kernel's (`kernel/assets/GeometryMerge.ts`, on
  `aekasha`), since the kernel's `MERGED` type needs it, and loads with an `import()` there, so a
  build that merges nothing doesn't carry it (`yarn sbp`).

## 2. Design

### D1 — `mergeGeometryParts` (`kernel/assets/GeometryMerge.ts`)

```ts
type MergePart = {
  geo: string | BufferGeometry; // registered id or a geometry
  matrix?: Matrix4; // local → merged space; identity when omitted
  materialSlot?: number; // becomes a geometry group when opts.groups is 'BY_SLOT'
  key?: string; // caller's id for the part (an entity id in p372)
};

mergeGeometryParts(parts: MergePart[], opts?: {
  groups?: 'NONE' | 'BY_SLOT'; // default 'NONE'
  attributes?: 'UNION' | 'INTERSECTION'; // default 'UNION'
  indexed?: boolean; // default true
}): MergedGeometry; // a BufferGeometry with userData.mergeParts
```

- **Two modules** (decided 2026-11-10, so Phase 4's worker job reuses the merge as it is):
  `kernel/assets/GeometryMergeCore.ts` is worker-safe (three only: no `Logger`, `Config` or
  registry), takes geometries and returns the merge and its warnings; `GeometryMerge.ts` resolves
  string ids through the registry, logs the warnings (debug env) and registers, and is what
  `aekasha` exports.
- **Transforms baked**: positions by `matrix`, normals by its normal matrix (inverse transpose),
  tangents' `xyz` by its upper 3×3 (surface directions, as three's `applyMatrix4`), both
  normalized. For a part whose matrix has a negative determinant (mirrored scale) the triangle
  winding is flipped within its index range, so it isn't back-face culled, and tangent `w` is
  negated, so the shader's rebuilt bitangent keeps pointing the right way.
- **Attribute reads** go through `getX`/`getY`/`getZ`/`getW`, so interleaved and normalized
  (quantized meshopt) attributes read as their values. Positions, normals and tangents are written
  `Float32`; any other attribute keeps its array type when every part has the same type and
  `normalized` flag, else `Float32` with denormalized values. One attribute with different item
  sizes across parts throws.
- **Attribute unification:** `UNION` fills a missing attribute with defaults (uv 0, colour 1 with
  the parts' item size, anything else 0); a missing tangent is computed for that part
  (`computeTangents`: it needs an index, normals and uvs), and when it can't be, the tangent is
  dropped from the result with a warning. `INTERSECTION` drops attributes not every part has.
- **Refused:** a part with morph attributes, `skinIndex` or `skinWeight` throws (p370 §4). A
  part's own groups and draw range are ignored: the whole part is merged.
- **Index:** non-indexed parts get a trivial index; the result is `Uint16` while it fits, else
  `Uint32` (past 65 535 vertices). `indexed: false` returns a non-indexed geometry.
- **`BY_SLOT`** sorts the parts by `materialSlot` (stable: a slot's parts keep their order;
  a part without one is slot 0) before merging, so each slot is one contiguous group with its
  `materialIndex`.
- **Empty:** no parts gives an empty geometry with a `position` attribute, not a throw (the
  bush generator's zero clusters, D5).
- **Part table** (`userData.mergeParts`):
  `{ key, vertexStart, vertexCount, indexStart, indexCount, materialSlot }[]`, in the merged
  order. p372 rewrites a part's range in place with it; p373 maps a picked face to its part.
- **Bounds:** box and sphere computed once at the end.
- Returns an unregistered geometry; `registerMergedGeometry(parts, { id, groups, attributes,
indexed, isPersistent, preWarm, debugData })` (an options object: coding standards) merges and
  registers through `saveBufferGeometry`, and returns the registered geometry without merging
  when `id` is registered already. It takes a ref on nothing it doesn't own (the source
  geometries are only read).

### D2 — `MERGED` geometry JSON

`GeometrySchema.ts` gets a new union member:

```json
{
  "geoProps": {
    "id": "ruinWallSection",
    "type": "MERGED",
    "params": {
      "parts": [
        { "geo": "ruinKit/wallStraight" },
        {
          "geo": "ruinKit/wallStraight",
          "position": { "x": 4, "y": 0, "z": 0 },
          "rotation": { "x": 0, "y": 3.1416, "z": 0 }
        },
        {
          "geo": "ruinKit/pillar",
          "position": { "x": 2, "y": 0, "z": 0 },
          "scale": { "x": 1, "y": 1.2, "z": 1 }
        }
      ],
      "groups": "NONE"
    }
  }
}
```

- A part's transform is a mesh's: `position`, `rotation` (Euler radians) or `quaternion` (wins),
  `scale` as `{x,y,z}` objects; plus `materialSlot` and `key`. The merge options are `groups`,
  `attributes` and `indexed` (D1).
- Parts reference registered geometry ids: a geometry JSON's (not another `MERGED` one) or an
  imported piece (`assetId/nodeName`). The scene loader (`loadSceneAssetsAsync`,
  `kernel/scene/SceneDataLoader.ts`) merges a scene's `MERGED` geometries after its other
  geometries, so the imports and primitives are registered; it loads `GeometryMerge.ts` with an
  `import()` on the first one. The parts stay as they were (decided 2026-11-10): the merge takes
  no ref on them, and they're released with the scene or cell that loaded them.
- `gatherAppData` validates the part ids; the scene dependency closure (p302 D6, when it lands)
  follows part ids.
- Useful for kit-bashed props: a wall section made from kit pieces, one draw wherever it's used.

### D3 — GLB `merge` option (build time)

`*.importedAsset.json` gets `merge`:

```json
{
  "id": "ruinKitLevel",
  "fileName": "./ruinKitLevel.glb",
  "merge": { "mode": "BY_MATERIAL", "exclude": ["door_*"] }
}
```

- In `encodeGLTFAsset`, before compression: `flatten` (bakes the node hierarchy) then `join`
  (joins primitives with compatible attributes and the same material), on every node that isn't
  excluded, isn't a physics node (a `colliderType` custom prop, `kernel/assets/import/CustomProps.ts`) and
  isn't skinned or morph-targeted. Excluded nodes keep their names, so code can still find doors and levers.
- `mode`: `BY_MATERIAL` (one primitive per glTF material; the default, since p302/p303 may import
  materials later) or `ALL` (everything into one primitive, since the engine uses one material per
  imported asset today).
- The joined node is named `__merged` (`__merged_<material>` per material) and extracted like any
  node, so scenes reference `ruinKitLevel/__merged`.
- The pipeline records the part count in the lock entry; a merge that leaves more than 1 node
  per material logs why (attribute mismatch, excluded, collider).
- **Trade-off, documented:** a build-time join loses the pieces as separate nodes, so they can't
  be entities. When the pieces must stay selectable and editable, use p372 groups instead.

### D4 — Worker path

Merging tens of thousands of vertices is CPU work. `mergeGeometryPartsAsync` runs D1 in the asset
worker (`AppConfig.assets.workerTarget`), transferring attribute buffers, with a main-thread
fallback (`fallbackToMainThread`). The same worker plumbing p347 uses for runtime LOD chains: a
job module in `kernel/assets/worker/` (`AssetsSwitchMerge`) that the worker `import()`s on its
first merge job, as LOD's `AssetsSwitchSimplify`.

### D5 — Adoption

Replace the ad hoc merges (§1) with `registerMergedGeometry` / `mergeGeometryParts`, imported from
`aekasha`. The two `groups: true` callers (the gym's stairs, the foliage tree) use
`groups: 'BY_SLOT'`.

## 3. Phases

### Phase 1 — Core utility (D1) — done

`mergeGeometryParts`, `registerMergedGeometry`, part table, transforms, attribute unification.
**Exit:** in `testDebugScene`, a merged box + sphere + mirrored cylinder renders like the three
separate meshes (normals, winding, shadows), with one draw (profiler). Unit tests next to the
module (`GeometryMerge.test.ts`, in Node): transforms, winding, attribute unification, index
type, the part table.

As built:

- Two modules (D1): `kernel/assets/GeometryMergeCore.ts` (`mergeGeometryPartsCore`,
  `@internal`, worker-safe, returns `{ geometry, warnings }`; the types `MergeGeometryOptions`,
  `MergePartRange`, `MergedGeometry`) and `kernel/assets/GeometryMerge.ts` (`mergeGeometryParts`,
  `registerMergedGeometry`, `MergePart`, `RegisterMergedGeometryOptions`), all public names on
  `aekasha`. Tests: `GeometryMergeCore.test.ts` (transforms, non-uniform scale, the mirrored
  winding and tangent `w`, UNION / INTERSECTION, computed and dropped tangents, quantized and
  interleaved reads, a shared normalized type's fill, the refusals, the index type, the part
  table, `BY_SLOT`, non-indexed output, empty, bounds) and `GeometryMerge.test.ts` (ids, the
  registration and a taken id).
- `registerMergedGeometry` returns `THREE.BufferGeometry` (what's registered under a taken id
  may not be a merge); a fresh merge has its `userData.mergeParts`.
- `indexed: false` merges indexed, then `toNonIndexed()`: each part's `vertexStart` /
  `vertexCount` become its index range.
- `testDebugScene`'s bottom row is the check (`createMergeCheck`): the three parts as meshes on
  the left, `p371_merged` on the right, each group on a slab; the sun (`p300Sun.light.json`) casts
  shadows now, and only this row casts and receives them, so the p300 rows look as before.
  Measured (2026-11-10, Chrome on macOS, `onBeforeRender` per frame): the merged mesh draws twice
  a frame (main and the sun's shadow pass), as each separate mesh does, so 2 draws where the parts
  took 6. The scene runner's `testDebugScene` baselines (its snapshot and debugger shots: the
  entity, asset and light lists) change with it: record them again (`--update`) with this phase.

### Phase 2 — JSON type (D2) — done

Schema, gatherer validation, `createGeometry` path, compiled `.schemas/`.

Found 2026-11-10 (before Phase 1): `createGeometry` is synchronous and `loadSceneAssetsAsync`
(`kernel/scene/SceneDataLoader.ts`) calls it in a plain loop, so D2's "createGeometry loads
`GeometryMerge.ts` with an `import()`" can't be done inside `createGeometry`. The `MERGED` path
goes in the loader: after the scene's other geometries (a part can be one of them), it `import()`s
`GeometryMerge.ts` once for the first `MERGED` entry and runs each through
`registerMergedGeometry` in the owner scope (`owned`). A direct `createGeometry({ type: 'MERGED' })`
throws, naming `registerMergedGeometry`. Decide whether the merged geometry keeps a ref on parts
that this scene loaded only for the merge, or releases them right after (D2 says release).

**Exit:** a `MERGED`
geometry of three imported pieces is used by two scene meshes; `yarn sbp`: the app's first
download doesn't grow by the merge code (it loads with the first `MERGED` geometry).

As built:

- Schema (`schemas/GeometrySchema.ts`): `MERGED` is in `GeoAssetPropsSchema` (the primitives
  and `MERGED`), which a `*.geometry.json`'s `geoProps` and a scene's `geometries` use.
  `GeoPropsSchema` stays the primitives: a mesh's inline `geo` (which goes to `createGeometry`)
  and the save entries' params. A part's transform is a mesh's (`{x,y,z}` objects, D2's example).
- Runtime (`kernel/assets/Geometry.ts`): `MergedGeoPart` and `MergedGeoProps`, on `aekasha`;
  `SceneData.geometries` and the streaming manifest's `assets.geometries` take them.
  `createGeometry` throws for `MERGED`, naming `registerMergedGeometry`.
- Loader (`loadSceneAssetsAsync`): the `MERGED` entries are set aside in the geometry loop (a part
  listed after its merge still works) and merged after it: one `import()` of `GeometryMerge.ts`,
  then `registerMergedGeoProps` (`@internal` there: the JSON's transforms to matrices, kept in
  the lazy chunk) per entry in the owner scope, so a streaming cell's merge is the cell's. A merge
  that throws is logged (`lerror`) and left out: a mesh using it is skipped as for any missing
  geometry, and the load goes on. The parts are kept (D2).
- A save entry's `params` are the primitives': a `MERGED` geometry takes only its `debugData`.
- The gather (`devTools/gather/mergedGeometries.ts`): pass 1 fails on a geometry JSON's part that
  names no geometry JSON nor an import's piece (`<importId>/…`), or a `MERGED` one (merges don't
  nest); the scene pass checks inline `MERGED` geometries alike, and warns (only) for a part
  whose geometry or import the scene doesn't list (a persistent asset can still provide it). Node
  names aren't known before the import runs, so a wrong one fails at load (the `lerror` above).
- Streaming (`gather/streamingManifest.ts`): a mesh's `MERGED` geometry brings its parts' refs (one
  level), so a cell that loads the merge loads its parts, unless the base has them. A mesh with a
  `MERGED` geometry has no extent the gather can measure: it's placed as a point, so a large one
  needs a `streaming.radii` entry (Phase 5 documents it).
- The check (`testDebugScene`): `p371SymbolTrio.geometry.json`, three pieces of the toolkit's
  `aekashaSymbol` import (one plain, one mirrored, one tilted), on two JSON meshes in a row below
  Phase 1's (`p371_symbolTrioA` / `B`, the second turned); the camera moved back to frame it.
  Checked 2026-11-10 in Chrome on macOS, debug and prod test: both meshes alike, the mirrored
  piece not inside out, no console errors.
- `yarn sbp` (2026-11-10): the merge code is a lazy chunk of its own, `assets/GeometryMerge.js`
  (2.5 kB gzip); the first download grows by 0.1 kB (`_engine/kernel/scene`: the loader's
  loop and `import()`). `yarn verify:baselines --update`: `bundle.json`, `api.json` (the two
  types, `registerMergedGeoProps`, `GeoAssetProps` / `GeoAssetPropsSchema`) and `docs.json`.

### Phase 3 — GLB option (D3) — done

`merge` in `importedAssetSchema`, the pipeline step, lock entry stats. **Exit:** a test GLB of 20
pieces imports as one `__merged` node; its collider nodes and excluded nodes stay separate; a
cached re-run is a cache hit.

As built:

- Schema (`ImportedAssetSchema.ts`): `merge` is `true` or an object of `mode` (`BY_MATERIAL`,
  the default, or `ALL`) and `exclude` (globs), the type `ImportedAssetMerge` on
  `aekasha/schemas`. Build time only, like
  `optimize`: not in a save entry or a scene's inline import; the gather drops it from the
  generated data and fails on `merge` with a remote `fileName`.
- Not `flatten` + `join` (D3's wording): `flatten` moves every node, the kept ones too, to the
  scene root and prunes empty nodes, which changes the runtime's import root (the single empty
  root, `GLTFExtract.ts`) and the kept nodes' transforms and parent paths; `join` keeps the first
  piece's node, name and transform; gltf-transform's `transformPrimitive` transforms a tangent
  wrong (it reads a component it has already written) and never negates a mirrored piece's `w`.
  The step (`devTools/assetPipeline/gltfMerge.ts`, `mergeGLTFNodes`) copies each piece's
  primitives (`compactPrimitive`), dequantizes them, bakes its transform into the import root's
  space with D1's maths (normal matrix, winding and tangent `w` flipped for a mirrored piece) and
  joins them with `joinPrimitives`. A merged node is a new child of the import root with no
  transform, so a scene mesh at the origin draws the file's layout.
- Kept as they are, with their subtrees: `exclude` globs on node names (the config's glob
  syntax), physics nodes (`isPhysObj` or `colliderType` in the node's or its mesh's extras),
  joints and animated nodes; kept alone, with a warning: skinned and GPU-instanced nodes and
  nodes with a morph-target or non-triangle primitive. A merged piece's node is removed when
  nothing kept hangs on it, and so is an empty parent it leaves childless; a file's own empty
  nodes stay.
- Names: `ALL` → `__merged`; `BY_MATERIAL` → `__merged_<material>` always (one material too, so a
  second one doesn't rename the first; D3's example `ruinKitLevel/__merged` is `ALL`'s),
  sanitized as GLTFLoader names nodes (`stone wall` → `__merged_stone_wall`, `wood.001` →
  `__merged_wood001`), `material<index>` for an unnamed material, `nomaterial` for none. Pieces
  that can't join (another attribute set) make `_2`, `_3`, … with a warning naming each node's
  attributes; a name the file already uses gets a suffix and a warning.
- Open question 2, decided: the merge runs before the compression and the LOD chain step, so a
  `lodChain` is built from the merged mesh (one chain per `__merged` primitive).
- Pipeline: the JSON's own `merge` applies to every use of the file (`assets.ts`). The options
  and `GLTF_MERGE_VERSION` (`gltfMergeOptions.ts`, apart from the step so a key doesn't load
  gltf-transform) are in the cache key only when set. A file with `merge` is written even when
  both sides are kept as they are (`optimize: false`, `AEK_ASSETS_OPTIMIZE=false`), with a
  warning, since scenes name the merged nodes. The stats (each merged node's parts, vertices,
  triangles; the kept nodes by reason) go into the lock entry and `last-run.json`, and the run's
  line reads `merged 20 pieces into __merged (kept 3 excluded, 2 physics)`.
- Not covered, for Phase 5's docs: a runtime that loads the source instead of an output (no
  output, eg. `ktx` missing with `importTextures`) has no `__merged` node; `meshIndex` counts the
  merged file's nodes; a merge of meshes several nodes share grows the vertex count (each use is
  a copy: the kit's six pillars, 16.8 → 21.0 KB of VRAM). Found while checking it: nodes that
  share a glTF mesh get one geometry id at import, the first node's (`ImportRegistry.ts`), which
  is the import's rule, not the merge's.
- The check (`testDebugScene`): `p371MergeKit.glb` (built by
  `devTools/assetPipeline/fixtures/mergeKitFile.ts`): 20 box pieces in two glTF materials (ten
  wall blocks, six pillars sharing one mesh, four blocks on a turned empty, one mirrored), two
  `door_*` nodes (one with a handle child) and two collider nodes, with
  `merge: { mode: "ALL", exclude: ["door_*"] }`. `yarn assets`: one `__merged` node of 480
  vertices, the doors, the handle under its door and the colliders as they were, the emptied
  `upperWall` gone; meshopt lossless (the collider default); a second run a cache hit. In the
  scene, a row below Phase 2's: `p371MergeKit/__merged` and the three door pieces as JSON
  meshes; the camera moved back again. Checked 2026-11-10 in Chrome on macOS, debug and prod
  test: the ruin whole, the mirrored block not inside out, no console errors. Unit tests:
  `gltfMerge.test.ts` (transforms, the import root, naming, `ALL`, kept subtrees, emptied nodes,
  mirroring, tangents, shared meshes, dequantizing, attribute splits, name clashes, unsupported
  pieces, a written file); `gather.test.ts` (no `merge` in the generated data, the remote error).
- Baselines (2026-11-10): `yarn verify:scenes --only testDebugScene --update` (its five
  configurations); `yarn verify:baselines --update`: `api.json` (`ImportedAssetMerge`, the
  schema), `docs.json`, and `bundle.banner.json` / `bundle.uiKit.json`, which Phase 2 left
  unrecorded: the embeds get Phase 2's lazy `assets/GeometryMerge.js` chunk (2.5 kB gzip) and
  +0.1 kB in their main `_engine/kernel/scene`, as the app did. `bundle.json` unchanged (all
  build time), no debug code in any build.

### Phase 4 — Worker and adoption (D4, D5) — done

The scene loader's `MERGED` path (Phase 2: `registerMergedGeoProps` on the main thread) moves to
`mergeGeometryPartsAsync` with the worker job.

**Exit:** largeWorld, the gym's stairs and the foliage generator use the new utility with
unchanged visuals (`yarn verify:scenes`' snapshots); a 100k-vertex merge doesn't block a frame for
more than its transfer.

As built:

- Found 2026-11-10: LOD's `AssetsSwitchSimplify` (D4's pattern) is LOD's own,
  `features/lod/worker/AssetsSwitchSimplify.ts`; the merge job is the kernel's,
  `kernel/assets/worker/AssetsSwitchMerge.ts`, next to the texture and GLTF jobs, loaded by the
  worker on its first merge job (`createJobLoader`).
- **Its own target, not `workerTarget`** (D4's wording): kind `MERGE`, `AppConfig.assets.mergeWorkerTarget`
  (env `VITE_ASSETS_MERGE_WORKER_TARGET`, a boot override and a "Geometry merges" row in the
  Assets tab), default `WORKER_THREAD` whatever `workerTarget` is, as `simplifyWorkerTarget`: the
  shared default is `MAIN_THREAD`, which would keep every merge on the main thread.
- Protocol (`AssetsAPITypes.ts`): `MERGE_GEOMETRY` (6). The request sends each geometry once
  (several parts name one by `geometryIndex`; the gym's ten steps send one box), only its
  attributes and index, as copies (`serializeGeometry` with `copy`), never its `userData` (it can
  hold what doesn't clone); matrices as their 16 elements. The response is the merge,
  transferred, with its part table and bounds, and the warnings, logged on the main thread.
- The refusals are one check, `assertMergeableParts` (`GeometryMergeCore.ts`, `@internal`), which
  `mergeGeometryPartsCore` runs first and the async path runs on the main thread before it sends
  anything: a refused merge rejects there, instead of failing in the worker and running again on
  the main thread as a `WORKER_ERROR` fallback.
- Public on `aekasha`: `mergeGeometryPartsAsync(parts, opts?)` and `registerMergedGeometryAsync(parts,
opts)` (not in D4; the loader and p372 need it). The latter returns a taken id's geometry without
  merging, captures the owner scope at its call and registers in it after the await (a streaming
  cell's merge stays the cell's), and of two overlapping calls with one id the first to finish
  registers (the other disposes its own). Its merge's report is `merge:<id>`, which the geometry
  info window shows ("Merged geometry (N parts)", "Merged on", "Merge time"; a synchronous merge
  "Main thread (synchronous)").
- Loader: `registerMergedGeoProps` became `registerMergedGeoPropsAsync` (`@internal`); a scene's
  `MERGED` geometries merge in parallel (a part is never another `MERGED` one), each failure
  logged and left out as before.
- Tests: `GeometryMerge.test.ts` mocks `AssetsAPI` so the worker task's request goes through
  `structuredClone` with its transfer list into the real `assetsSwitchMerge`, and back: the
  worker's merge equals the synchronous one (attributes, index, groups, part table, bounds), a
  geometry two parts name is sent once, a refused merge sends nothing, the owner scope and the
  overlapping calls. `SceneDataLoader.test.ts`'s owner key test now checks the capture (the merge
  registers after an await).
- Measured (2026-11-10, Chrome on macOS, WebGPU, `testDebugScene` on the dev server): its
  `p371SymbolTrio` merges in the worker with no fallback. A 100k-vertex merge (12 spheres of 8,385
  vertices with tangents, 100,620 vertices) at 4× CPU throttling: `mergeGeometryParts` blocks the
  main thread 39-61 ms (frame gaps 41-64 ms, one 62 ms long task); `mergeGeometryPartsAsync`'s
  longest frame gap is 17.4-17.7 ms (idle 20.8 ms), no long task, its result byte-identical.
  Unthrottled a warm 100k merge is about 11 ms on that Mac. The trade-off: a scene whose only
  worker request is a small merge pays the worker's start (51-104 ms of wall time, none on the
  main thread) on its first one; warm, an 8.7k-vertex merge takes 2-5 ms either way.
- Adoption (D5), each checked against the old `mergeGeometries` output (positions, normals, uvs and
  index bit-identical):
  - the gym's stairs: one step box placed ten times by matrix, `registerMergedGeometry`, `groups:
'NONE'`, not D5's `BY_SLOT`: `mergeGeometries(steps, true)` gave each step a group
    (`materialIndex` 0-9), which a single-material mesh never reads;
  - the foliage tree: `mergeGeometryParts` with `BY_SLOT`, the trunk slot 0 and the canopy 1 (the
    same two groups), the parts placed by matrix; the bush: its seeded spheres placed by matrix.
    The bush keeps its own empty geometry for zero clusters (positions, normals and uvs; the
    merge's empty one, D1, has only positions, which a lit material reads as missing);
  - largeWorld: `saveMergedGeometry` takes parts with matrices (the crates one box placed twice,
    the barbell one sphere placed twice) and keeps its `computeVertexNormals()` after the merge, so
    the scene looks the same: it averages normals per vertex index, which differs from the parts'
    own at the spheres' seams and poles.
- Checked (2026-11-10): `yarn verify:scenes --only testDebugScene` (after the loader moved to the
  worker) passes its five configurations; `--only largeWorld,thirdPersonGymScene,lodShowcase,instanceStress`
  passes `largeWorld`, `lodShowcase` and both `instanceStress` variants in every configuration.
  The gym's five fail only on what its local baseline (recorded at `d4decbdf`, before p353 and
  p354 landed) lacks: `streamingSystem` in the system order, the `streamingControls` tab and the
  LOD tab's "Instance sets" folder; its snapshots and character paths match. Record the gym's
  baseline again (`--only thirdPersonGymScene --update`) on `main` or here.
- `yarn sbp --profile all` (2026-11-10): every budget within, the app's first download unchanged.
  Lazy: the worker's `assets/AssetsSwitchMerge.js` (2.3 kB gzip, new) and `assets/GeometryMerge.js`
  2.5 → 3.0 kB (the async path); the worker's chunk that held `GeometryTransfer` and three's
  `BufferGeometryUtils` (1.7 kB) split in two (0.8 + 1.0 kB), since the merge job needs only the
  first. `yarn verify:baselines --update`: `bundle.json`, `bundle.banner.json`, `bundle.uiKit.json`,
  `api.json` (the two public functions, the protocol types, `registerMergedGeoProps` →
  `registerMergedGeoPropsAsync`, `assertMergeableParts`, `mergeGeometryInWorker`,
  `assetsSwitchMerge`) and `docs.json`; no debug code in any build.
- For Phase 5's docs: `mergeGeometryPartsAsync` / `registerMergedGeometryAsync` and when to use
  them (a large merge; a small one costs more as a round trip, and the first one may start the
  worker), `AppConfig.assets.mergeWorkerTarget` and its env var, a scene's `MERGED` geometries
  merged in the worker, and the stairs' groups.

### Phase 5 — Docs and versioning — done

1. The Hub: the asset optimization feature page (`hub/pages/features/asset-optimization/`):
   "Merging a model's pieces" (D3 and its trade-off; Phase 3's As built: the node names, what is
   kept, the file written with optimization off, the gaps it lists), and the scenes and assets
   page for the
   `MERGED` type (its parts' rules, the gather's errors and warning, a wrong node name failing at
   load, `streaming.radii` for a large merged mesh in a streaming scene);
   `docs/techniques/asset-optimization.md` if it still mirrors the page; `yarn hub:build`.
2. `devTools/gather/CLAUDE.md` and `devTools/assetPipeline/CLAUDE.md` (the `MERGED` type, the GLB
   `merge` step), `readme.md` if asset types are listed.
3. Engine minor, toolkit patch (foliage), app patch (largeWorld, the gym); `CHANGELOG.md`.

As built (2026-11-10):

- The Hub: the asset optimization page's "Merging a model's pieces" (the modes and names, what
  is kept, the file written with optimization off, the trade-off, and the gaps in a note), the
  scenes and assets page's "Merged geometries" (the JSON type, the parts' rules and options, the
  load in the worker and `mergeWorkerTarget`, the gather's errors and warning, a wrong node name
  at load, `streaming.radii`, then the code API and when to use the `*Async` versions), its
  asset table row and key APIs; the streaming page's `radii` lines name merged geometries too.
  `docs/techniques/asset-optimization.md` doesn't mirror the page (it's the full reference): it
  got "Merging pieces" under "Add a model" with the pipeline detail, which the page's Read more
  links.
- `devTools/gather/CLAUDE.md` (the part checks in full, `sources.ts`' `merge` drop and remote
  error, the streaming manifest's `MERGED` refs and point placement),
  `devTools/assetPipeline/CLAUDE.md` (a bullet for the merge step, the third fixture generator),
  `features/streaming/CLAUDE.md`'s limits, and the readme (a "Geometry merging" Features bullet,
  the asset optimization bullet and the technique guide line). The readme lists no asset types.
- Engine 6.3.0 → 6.4.0 (project 6.4.0), toolkit 3.0.0 → 3.0.1, app 1.21.0 → 1.21.1, codenames
  unchanged; the `CHANGELOG.md` entry `p371_geometry-merging`.
- Still to do on `main` or here, from Phase 4: record the gym's scene runner baseline again
  (`yarn verify:scenes --only thirdPersonGymScene --update`).

## 4. Risks

| Risk                                                                                      | Mitigation                                                                     |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Parts with different attribute sets (one has `color`, one doesn't) fail `mergeGeometries` | D1 unifies attributes before merging                                           |
| Quantized meshopt attributes (normalized `Int16`) merged with float ones                  | Converted to `Float32` first; the GLB path joins before quantizing             |
| A huge merge defeats frustum culling                                                      | D1/D2 are explicit tools; spatially bounded automatic groups are p372's `AUTO` |
| `join` changes vertex order of collider sources                                           | Collider nodes are never joined (D3)                                           |
| Mirrored parts render inside out                                                          | Winding flip for negative determinants (D1)                                    |

## 5. Open questions

1. Should `MERGED` JSON parts accept p299 atlas cells (`"atlasCell": "…"`, remapping each part's
   UVs)? Only if a kit uses an atlas; p374's arrays need no UV change.
2. ~~A JSON with both `merge` and `lodChain`: is the chain built from the joined mesh?~~ Yes
   (Phase 3): the merge runs before the compression and the chain step.
