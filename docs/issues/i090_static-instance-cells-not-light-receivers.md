**Title:** Static instance cells never count as light receivers: a light near only scatter cells is culled

Status: open | documented in p308, not fixed
Category: Spatial, Instancing, Rendering
Found: 2026-11-18, p308 Phase 5 (read from the code; no scene has such a light)
Our workaround: keep a plain mesh in the light's range (a terrain block under its scatter is one), or leave object culling off for the lights whose only receivers are scatter cells

## What happens

A static instance cell (`createInstancedMeshEntity`, and so every cell of `createStaticInstances`,
a scatter and an import's GPU instances, `features/instancing/StaticInstances.ts`) is made with
`spatialIndex: false`, whatever its options say: it isn't `SPATIAL_INDEXED`, so it isn't in the
`DEFAULT` domain's grid. Light (contribution) culling
(`features/spatial/LightObjectCullingSystem.ts`) looks for a light's receivers only among
`DEFAULT`'s members, so it never finds a cell.

An object-culled point or spot light (`OBJECT_CULLING_ENABLED`) whose only nearby, on-screen
meshes are cells then gets `TAG_OBJECT_CULLED`, and the cells go unlit near it: a lamp over a
scatter of pebbles on a floor that isn't a mesh entity, or a scatter spawned with `spawnScatter`
on a target without a mesh. With a plain mesh in range too, the light stays on: a terrain block
is one, so a block's own scatter is lit as long as the block is in the light's range and on
screen.

Nothing in the template does this: no scene with cells (`scatterTest`, `terrainGallery`'s
Scatter row, `lodShowcase`'s cell lane) has a point or spot light.

## Why it's not a one-line fix

The flag is off because both readers of a mesh's size measure one instance at the mesh's origin:
the grid's radius (`getMeshRadius`, `features/spatial/SpatialIndexSystem.ts`: the geometry's
conservative radius) and the receiver test's sphere (`getMeshWorldBoundingSphere`,
`kernel/ecs/ObjectFrustumCullingSystem.ts`: the geometry's bounding sphere at the object's world
position). A 16 m cell of 12 cm pebbles would be a 12 cm sphere at the cell's centre: turning the
flag on would make a light near the cell's edge miss it, and ECS frustum culling (the same
provider) would hide a cell whose centre is off screen. The receiver test's sphere is shared with
frustum culling by design (p080, `_DONE_p050` §7), so changing how a mesh is measured
changes both, for every mesh.

## A way out

- Measure an `InstancedMesh` by its own bounds: three's `InstancedMesh.boundingSphere` is over
  every instance (`createInstancedMeshEntity` computes it), so `getMeshWorldBoundingSphere` and
  `getMeshRadius` take it, in the mesh's world space, when the object is an `InstancedMesh`, and
  the geometry's otherwise. Plain meshes keep today's measure, so no other scene changes.
- Then drop the forced `spatialIndex: false` (and `ecsFrustumCullingEnabled: false`) from
  `createInstancedMeshEntity`, keeping them as options. The pools' meshes (`TAG_IS_MESH`, their
  bounds grown as instances move) would be measured the same way; their instances are
  `docs/issues/i100_pool-instances-not-light-receivers.md`.
- Check with a point light over a scatter on a target without a mesh (`scatterTest` can take one),
  and `yarn verify:scenes` for the scenes with cells (`lodShowcase`, `scatterTest`,
  `terrainGallery`): which lights are culled can change their hashes.

An engine minor: no API changes, only which lights a scene with cells culls.
