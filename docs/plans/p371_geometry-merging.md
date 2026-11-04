Status: draft | not-implemented
Category: Merging, Geometry, Assets
Epic: p370_static-mesh-merging-and-texture-atlas-systems.md (Tier 1.1)
Blocks: p372_mesh-merge-groups.md
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

- **Transforms baked**: positions by `matrix`, normals and tangents by its normal matrix
  (tangent `w` kept), and the triangle winding flipped for a part whose matrix has a negative
  determinant (mirrored scale), so it isn't back-face culled.
- **Attribute unification:** `UNION` fills a missing attribute with defaults (uv 0, colour 1,
  tangent from `computeTangents` if any part has a normal map and uvs, else dropped with a dev
  warning); `INTERSECTION` drops attributes not every part has. Mismatched item sizes or array
  types (eg. quantized `Int16` positions from a meshopt GLB) are converted to `Float32` first.
- **Index:** non-indexed parts get a trivial index; the result is `Uint16` while it fits, else
  `Uint32` (past 65 535 vertices).
- **Part table** (`userData.mergeParts`):
  `{ key, vertexStart, vertexCount, indexStart, indexCount, materialSlot }[]`. p372 rewrites a
  part's range in place with it; p373 maps a picked face to its part.
- **Bounds:** box and sphere computed once at the end.
- Returns an unregistered geometry; `registerMergedGeometry(id, parts, opts)` merges and
  registers through `saveBufferGeometry`, taking a ref on nothing it doesn't own (the source
  geometries are only read).

### D2 — `MERGED` geometry JSON

`GeometrySchema.ts` gets a new union member:

```json
{
  "id": "ruinWallSection",
  "type": "MERGED",
  "params": {
    "parts": [
      { "geo": "ruinKit/wallStraight", "position": [0, 0, 0] },
      { "geo": "ruinKit/wallStraight", "position": [4, 0, 0], "rotation": [0, 3.1416, 0] },
      { "geo": "ruinKit/pillar", "position": [2, 0, 0], "scale": [1, 1.2, 1] }
    ],
    "groups": "NONE"
  }
}
```

- Parts reference registered geometry ids, including imported pieces (`assetId/nodeName`).
  `createGeometry` loads the parts first (imported assets and other geometries load before
  geometries in `loadNextSceneAssets`' order, `kernel/scene/SceneDataLoader.ts`), loads
  `GeometryMerge.ts` with an `import()` on the first `MERGED` geometry, merges, registers, and
  releases the parts it loaded only for this merge.
- `gatherAppData` validates that each part id exists; the scene dependency closure (p302 D6, when
  it lands) follows part ids.
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

### Phase 1 — Core utility (D1)

`mergeGeometryParts`, `registerMergedGeometry`, part table, transforms, attribute unification.
**Exit:** in `testDebugScene`, a merged box + sphere + mirrored cylinder renders like the three
separate meshes (normals, winding, shadows), with one draw (profiler). Unit tests next to the
module (`GeometryMerge.test.ts`, in Node): transforms, winding, attribute unification, index
type, the part table.

### Phase 2 — JSON type (D2)

Schema, gatherer validation, `createGeometry` path, compiled `.schemas/`. **Exit:** a `MERGED`
geometry of three imported pieces is used by two scene meshes; `yarn sbp`: the app's first
download doesn't grow by the merge code (it loads with the first `MERGED` geometry).

### Phase 3 — GLB option (D3)

`merge` in `importedAssetSchema`, the pipeline step, lock entry stats. **Exit:** a test GLB of 20
pieces imports as one `__merged` node; its collider nodes and excluded nodes stay separate; a
cached re-run is a cache hit.

### Phase 4 — Worker and adoption (D4, D5)

**Exit:** largeWorld, the gym's stairs and the foliage generator use the new utility with
unchanged visuals (`yarn verify:scenes`' snapshots); a 100k-vertex merge doesn't block a frame for
more than its transfer.

### Phase 5 — Docs and versioning

1. The Hub: the asset optimization feature page (`hub/pages/features/asset-optimization/`):
   "Merging a model's pieces" (D3 and its trade-off), and the scenes and assets page for the
   `MERGED` type; `docs/techniques/asset-optimization.md` if it still mirrors the page; `yarn
   hub:build`.
2. `devTools/gather/CLAUDE.md` and `devTools/assetPipeline/CLAUDE.md` (the `MERGED` type, the GLB
   `merge` step), `readme.md` if asset types are listed.
3. Engine minor, toolkit patch (foliage), app patch (largeWorld, the gym); `CHANGELOG.md`.

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
2. A JSON with both `merge` and `lodChain` (the pipeline builds chains into the GLB since p347):
   is the chain built from the joined mesh, so the join runs before the chain step? Decide in
   Phase 3.
