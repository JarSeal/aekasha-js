**Title:** A `HEIGHTFIELD` collider's grid layout is documented only by the import's conversion

Status: fixed | 2026-11-17, p306 (D3, Phase 1)
Category: Physics, API
Found: 2026-10-22, p620 §1.4 N4 (T9: the toolkit's `generateTerrain` returns its `heights` row-major)
Our workaround: the toolkit's `GeneratedTerrain.heights` says it's row-major and the collider column-major; `topDownTestScene` gives its terrain a `TRIMESH` of the geometry, which matches the mesh exactly

## What happens

A `HEIGHTFIELD` collider (`aekasha/physics`' shape params, `HeightFieldData`) takes `nrows`,
`ncols`, `scale` and `heights`, "`nrows` × `ncols`, column-major". What that means for a grid an
app builds isn't written down anywhere but in the glTF import's conversion
(`features/physics/import/MeshColliderGeometry.ts`):

- `nrows` and `ncols` count cells, so `heights` holds (`nrows` + 1) × (`ncols` + 1) values (the
  import's own comment), not `nrows` × `ncols` as the type's docs say;
- which of x and z runs along the rows, and that the import flips z, is only in that loop;
- where the grid sits on the body (the import sizes `scale` from the mesh's bounds).

The toolkit's terrain is row-major (row r along z, column c along x), so handing its `heights` to
the collider as they are gives another surface than the mesh, with no error.

## A way out

- The docs of `HeightFieldData.heights` and the shape param: the count, which axis the rows run
  along, the order, the centring, with a two-by-two example.
- A helper next to the shape params that takes a row-major grid (the terrain's layout, which is
  what a generator or an image gives) and returns the shape params, used by the import too, so
  the conversion lives in one place and gets a test. A non-square grid included: the import's
  loop counts `nRows + 1` along x and strides `heights` by `nCols + 1`, which a square grid can't
  tell from the other way round, and no non-square terrain has been through it.
- Then `generateTerrain` can return the collider's params as well (a toolkit minor).

## The fix (p306 D3, Phase 1)

- `HeightFieldData` and the `HEIGHTFIELD` shape params document the layout: (`nrows` + 1) ×
  (`ncols` + 1) heights, column-major, `nrows` cells along +z and `ncols` along +x, centred, each
  cell split along the diagonal from (row + 1, col) to (row, col + 1), with a two-by-two example.
  Checked against Rapier 0.19.3 by raycasts (`HeightfieldColliderParams.test.ts`, a 9 × 5 grid
  with a spike near one corner).
- `toHeightfieldColliderParams` (`aekasha/physics`) takes a row-major grid and its size; the
  import reads the grid by vertex position and calls it. Its custom props `nCols` / `nRows`
  count the cells along x / z (the old loop had it the other way round, which no square grid
  showed). `generateTerrain`'s collider params are p306 Phase 3.
