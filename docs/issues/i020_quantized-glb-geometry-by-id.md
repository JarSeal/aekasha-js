**Title:** A quantized GLB's geometry used by its id lacks its dequantization, and a mesh node with children loses its id

Status: open | for the asset pipeline's or the import's next plan
Category: Assets, Asset pipeline
Found: 2026-11-17, p306 Phase 1 step 3 (`yarn verify:scenes`: `testDebugScene` after its `p371MergeKit` lost its collider-source lossless default)
Our workaround: an asset whose geometries a scene or code names by id sets `"optimize": { "mesh": { "quantize": false } }` in its importedAsset JSON (`p371MergeKit` does); `spawnImportedAsset` is unaffected

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
