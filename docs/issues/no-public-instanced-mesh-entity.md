**Title:** No public way to make an entity of an `InstancedMesh` with static instances

Status: fixed | 2026-11-18, p308 (D1, Phase 1)
Category: Instancing, ECS, API
Found: 2026-10-22, p620 §1.4 N2 (W5: `testDebugScene` and the LOD showcase built one by hand)
Our workaround: build it by hand, as `src/app/scenes/lodShowcase/lanes/instanceCell.ts` does

## What happens

A whole `InstancedMesh` can be one entity: a cell of static instances that gets a level of detail,
frustum culling and its transform as a unit (the readme's "a whole `InstancedMesh` (a cell of
static instances)"). Nothing public makes one. `createMeshEntity` builds a `THREE.Mesh`, and the
instanced pools (`aekasha/instancing`) give every instance an entity of its own. So the app builds
it by hand, in steps that must match what `createMeshEntity` does for a mesh:

1. `new THREE.InstancedMesh(geometry, material, count)` and the instance matrices;
2. a ref on the geometry and the material (`incGeometryRef`, `incMaterialRef`): the mesh delete
   hook (`disposeMesh`, `kernel/mesh/Mesh.ts`) gives them back, and the LOD's level swaps move
   them;
3. `world.createEntity(…)`, and `mesh.userData.entityId = entityId`;
4. the `OBJECT3D` component (`{ value: mesh, _lastVersion: -1 }`), which tags it `TAG_IS_MESH`
   (an `InstancedMesh` is a mesh), so the delete hook and the spatial index treat it as one;
5. adding the mesh to the root scene.

A step left out fails quietly: without the refs, deleting the entity gives back refs it never
took, and a geometry or material another mesh still uses can be released under it. p620 removed
`testDebugScene`'s copy, so the showcase's lane is the one left.

## A way out

An `instances` option on `createMeshEntity`'s props (a count and the matrices, or a function
writing them), building an `InstancedMesh` through the same path as a mesh: the refs, the
components, the scene, `castShadow` and the rest. Or a `createInstancedMeshEntity` next to the
pools in `aekasha/instancing`. Either way the lane becomes one call, and its LOD keeps working.

## Fix

p308 D1 took the second way out: `createInstancedMeshEntity(props, opts?)` on `aekasha/instancing`
(`features/instancing/StaticInstances.ts`), its props `createMeshEntity`'s without `merge`, plus the
`instances` (placements or matrices) and their `colors`. Both calls make the entity through one
kernel helper (`addMeshEntity`, `kernel/mesh/Mesh.ts`, `@internal`), so a step can't be left out
of one: the refs, the entity and `userData.entityId`, `OBJECT3D` and `TAG_IS_MESH`, the root scene,
the shadows, the transform, `preWarm` and the LOD, set after the matrices and bounds are written.
It joins neither the spatial index nor ECS frustum culling (both read one instance at the origin).
`createStaticInstances` splits many instances into a grid of such cells. The showcase's
`instanceCell` lane is one call per cell now.
