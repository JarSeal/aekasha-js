**Title:** A quantized GLB's geometry used by its id lacks its dequantization, and a mesh node with children loses its id

Status: fixed | 2026-11-21, the pipeline records each quantized mesh's dequantization and the import puts it back into the positions
Category: Assets, Asset pipeline
Found: 2026-11-17, p306 Phase 1 step 3 (`yarn verify:scenes`: `testDebugScene` after its `p371MergeKit` lost its collider-source lossless default)
Our workaround: an asset whose geometries a scene or code names by id set `"optimize": { "mesh": { "quantize": false } }` in its importedAsset JSON (`p371MergeKit` did until the fix); `spawnImportedAsset` placed its meshes right, but a mesh node with children lost its custom props there too

## What happens

The asset pipeline's default meshopt encode quantizes positions (gltf-transform's `meshopt()`,
`devTools/assetPipeline/gltf.ts`), and quantized positions are normalized integers whose
dequantization lives in the node: gltf-transform's `quantize()` gives each mesh node a scale and
a translation that take its positions back to their size and place. The import keeps that in the
geometry's `info.transform` and registers the geometry as it is (`kernel/assets/import/`), so:

- `spawnImportedAsset` places each node with its transform and draws it right;
- a mesh made from the geometry's id with its own transform (a scene JSON's `"geo":
"p371MergeKit/door_right"`, a `*.mesh.json`, `createMeshEntity({ geo })`) never gets the node's
  scale and translation: the mesh is drawn at the size and place of its normalized positions
  (`p371MergeKit`'s `__merged` got a scale of 3.35 and a translation of 0.73 in y);
- a node with a mesh _and_ children can't take the scale without scaling its children, so
  `quantize()` moves the mesh into a new unnamed child node, which GLTFLoader names after the
  mesh and makes unique (`door_left` → `door_left_1`): the geometry's id `<importId>/<nodeName>`
  changes, and a scene naming the old one logs "Could not find geometry" and creates nothing.

Nothing says so at the encode or the import: the scene loads, with the meshes wrong or missing.

Until p306, collider sources were encoded lossless (for their colliders' sake), which hid it for
`p371MergeKit`, the one pipeline asset whose geometries a scene names by id today
(`aekashaSymbol` is Draco, whose decoder dequantizes into float positions; `testImport` is a
public-folder file the pipeline doesn't encode).

## A way out

- The import (or the geometry's registration) bakes a quantized node's dequantization into the
  registered geometry's use by id: a geometry made from an import by id would carry the node's
  scale and offset (as a dequantization the mesh applies, or float positions for that use),
  keeping the quantized buffers for `spawnImportedAsset`.
- Or the pipeline quantizes such a file without moving meshes (a `quantize()` that never
  restructures nodes, eg. leaving a node with children unquantized) and the gather warns about a
  scene naming the geometry of a quantized import by id.
- Either way, a test: a scene mesh naming a quantized import's geometry, and a mesh node with a
  child, drawn where the unquantized file draws them.

## The fix

The first way out: the import bakes the dequantization into the geometry, as float positions.
The second (keep the positions quantized and warn) would have kept the workaround the rule, and
every use by id (scene meshes, `*.mesh.json`, scatter items, imported instances) would have
needed it.

- **The pipeline records it** (`devTools/assetPipeline/gltfQuantization.ts`): around `meshopt()`
  and `quantize()`, each mesh's volume (gltf-transform's own maths, which it doesn't export) goes
  into the extras of every node using the mesh, `aekQuantization` (`GLTFQuantizationExtras`, in
  the import-free `src/_engine/kernel/assets/import/GLTFQuantization.ts`), with where `quantize()`
  put it: `NODE` (the node's matrix), `PIVOT` (a new child it moved the mesh into) or `INSTANCES`
  (each GPU instance's matrix). The format version is in a quantizing encode's cache key only.
- **The import puts it back** (`GLTFExtract.ts`): the positions become floats in the node's space
  (morph targets and prebuilt LOD levels too, a level sharing its base's converted attribute; the
  chain's extent scaled), the transform or the instance matrices lose it, and a pivot takes its
  parent's name, custom props and parent path (`door_left` again, with its collider props); a lone
  root whose mesh moved into a pivot isn't unwrapped as the import root. The geometry's info gets
  `isDequantized`. Point clouds and imported GPU instances with a record are read instead of
  refused; a file another tool quantized imports as before.
- **The cost** is VRAM: positions upload as 32-bit floats (normals and UVs stay quantized, the
  download is unchanged). The run's VRAM figure counts them so (`getGeometryBytes`), which raised
  the eight quantized GLBs' figures (`showcaseBunker` 211.4 → 256.0 KB, the decal sets about
  22 %); no budget was crossed.
- **A second lost id, found by the fix's scene run:** `quantize()`'s cleanup `dedup()`s accessors,
  so two identical meshes (`p371MergeKit`'s doors) share theirs, GLTFLoader caches one
  BufferGeometry for both (per primitive, by its accessors), and the registry registered it once,
  under the first node's id: `p371MergeKit/door_right` wasn't found. The extract now gives each
  glTF mesh its own geometry, sharing the attribute objects (`getMeshGeometry`).
- **`testImport` was affected too:** the pipeline does encode it (`box01.glb`), and
  `sceneTestECS`'s `testImportedMesh` names `testImport/Cube` by id: its unit box was drawn twice
  its size (the quantized ±1 without its node's 0.5), and the scene runner's baseline from
  2026-11-01 has it so.
- **Terrain blocks** still refuse the pipeline's quantized positions (`isDequantized`): floats
  again, but only within the encode's precision, so neighbours' edges wouldn't meet exactly.
- Tests: `gltfQuantization.test.ts` (the record against gltf-transform's encoded matrices, for a
  leaf node, a node with a child, a shared mesh and GPU instances, and the VRAM figure's
  positions), `GLTFExtract.test.ts` (each target, a shared mesh, a point cloud, a LOD level, a
  record of another version), `TerrainBlocks.test.ts`. `p371MergeKit` dropped the workaround.
