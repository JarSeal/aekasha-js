**Title:** Pool instances in the `DEFAULT` spatial domain never count as light receivers: a light near only them is culled

Status: open | documented in p616, not fixed
Category: Spatial, Instancing, Rendering
Found: 2026-10-19, p616 §1.4 S8 (read from the code)
Our workaround: give a pool a spatial domain of its own (as largeWorld's tree pool joins `FOLIAGE`), or leave object culling off for the lights whose only receivers are pool instances

## What happens

An instanced mesh pool's `spatialDomain: 'DEFAULT'` (`createInstancedMeshPool`,
`createInstancedLodPool`) joins every instance to `DEFAULT`, which adds `SPATIAL_INDEXED`: the
instances are in the grid that light (contribution) culling queries, at their `Transform`
position with the pool geometry's radius. But the culling's receiver test
(`meshIsVisibleReceiver`, `features/spatial/LightObjectCullingSystem.ts`) measures a candidate with
`getMeshWorldBoundingSphere` (`kernel/ecs/ObjectFrustumCullingSystem.ts`), which reads the entity's
`OBJECT3D` and returns undefined for one without: a pool instance has none (the pool's
`InstancedMesh` is its mesh entity's). So every instance is rejected.

An object-culled light (`OBJECT_CULLING_ENABLED`) whose only nearby, on-screen meshes are pool
instances then gets `TAG_OBJECT_CULLED`, and those instances go unlit. With a plain mesh in range
too, the light stays on. The instances only add candidates the light queries reject.

Nothing in the template does this: largeWorld's tree pool joins `FOLIAGE`, and its other pools and
lodShowcase's join no domain.

## Why it's not a one-line fix

The receiver test shares its bounding sphere with object frustum culling, one implementation by
design (`_DONE_p080`, `_DONE_p050` §7). Measuring pool instances some other way means a second
source of a candidate's sphere, and the natural one, the grid's own position and radius, would
change the result for plain meshes too: the grid holds the `Transform` position as of its last
rebuild and the radius provider's conservative radius, not the `Object3D`'s world position and its
geometry's sphere. Which lights are culled could then move in the scene runner's hashes.

## A way out

- Give the receiver test a fallback for an entity without `OBJECT3D`: the grid member's position
  and radius (a slot-indexed read on `SpatialGrid`, which the candidate visit already knows), and
  for a pool instance, that it's drawn (`INSTANCED_MESH_SLOT.index >= 0`: a LOD-culled instance
  lights nothing). Plain meshes keep today's test, so no scene changes.
- Or a `BoundingVolumeProvider` per component type, as frustum culling's providers are, with the
  pool registering one for `INSTANCED_MESH_SLOT`.

Either is an engine minor: no API changes, only which lights a scene with pools in `DEFAULT`
culls.
