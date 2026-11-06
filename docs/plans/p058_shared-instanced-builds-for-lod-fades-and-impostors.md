Status: draft | not-implemented
Category: Rendering, LOD, Performance
Related: \_DONE_p057_three-r187-migration.md (D3: the fix this replaces), \_DONE_p351_impostor-billboard-lod.md, p354_gpu-driven-culling.md (its per-instance buffers bind the same way), p302_material-and-texture-system-refactor.md (`NodeMaterialInstance`)

# Shared Instanced Builds for LOD Fades and Impostors — Plan

three r187 shares one node build between `InstancedMesh`es with the same material and attribute
layout (#35007): the instance matrix is a `referenceAttribute('instanceMatrix', 'mat4')`, which
binds each object's own attribute at draw time. Two engine nodes bind a per-mesh buffer when the
shader is built instead, so p057 D3 marked their `InstancedMesh` builds object-specific: every
dithered or impostor `InstancedMesh` builds its own shaders again, as on r186 (11-14 ms per build,
measured for a fade's copy on r186, `features/lod/CLAUDE.md`). This plan binds both per object, so
those meshes share builds like every other instanced mesh, and takes two smaller r187 gains on the
way.

## Grounding (2026-11-05, three r187)

- `nodes/accessors/ReferenceAttributeNode.js` (new in r187, on `three/tsl`):
  `referenceAttribute(property, type)` reads `object[property]` (a `BufferAttribute`) per object
  through `BufferAttributeNode.getObjectAttribute(object)`; `RenderObject.getAttributes()` binds
  what it returns for each object sharing the build.
- `nodes/accessors/Instance.js`: `instancedMesh()` binds `referenceAttribute('instanceMatrix',
  'mat4')` (and `instanceColor`), and still applies the matrix to `positionLocal` before
  `positionNode` runs.
- `RenderObject.getDynamicCacheKey` / `getMaterialCacheKey` and the geometry's attribute names make
  the build key; nothing in it says whether a mesh has a `lodFade` attribute.
- `kernel/render/LodFade.ts`: `LodFadeMaskNode.setup` binds `instancedBufferAttribute` of the
  mesh's `lodFade` attribute (`createLodFadeAttribute`), or `objectFade` (a per-object uniform) for
  a plain mesh; since p057 it sets `builder.objectSpecific` for every `InstancedMesh`.
- `features/lod/impostors/OctahedralImpostorMaterial.ts`: `ImpostorInstanceMatrixNode` binds a
  second `InstancedInterleavedBuffer` over the instance matrix array, version-synced per draw in
  `updateBefore`; object-specific since p057.
- `features/lod/impostors/ImpostorBake.ts`' `createAtlasTarget` (`generateMipmaps: true`) takes
  one dilate copy per frame and pass, and WebGPU's `finishRender` regenerates a mipped target's
  mips after every render into it: frames² × passes mip chains per atlas (a 12 × 12 bake takes
  40-115 ms today).

## Design

### D1 — The impostor reads three's own instance matrix

`impostorInstanceMatrix` becomes `referenceAttribute('instanceMatrix', 'mat4')` on an
`InstancedMesh` and the identity otherwise. That drops the second buffer, its version sync and the
`updateBefore`, and the build is shared. Check that the node reads the raw matrix
(`positionGeometry` stays the quad's corners), on both backends, and in the shadow pass
(`Renderer._getShadowNodes` reuses `positionNode`).

### D2 — The fade binds per object

Two candidates, the spike picks:

1. A fade attribute on the mesh as a property (`mesh.lodFade`, set by `createLodFadeAttribute`)
   and `referenceAttribute('lodFade', 'float')`. A dithered `InstancedMesh` without a fade needs
   a different build key (or a fade attribute of its own that stays at 1): the build must never be
   shared between meshes with and without one.
2. A `BufferAttributeNode` subclass whose `getObjectAttribute(object)` returns that object's fade
   attribute, with the same rule for meshes without one.

Either way every pool level on one material shares one build, and a dithered `InstancedMesh`
without a fade stops paying for its own.

### D3 — The impostor bake builds its mips once

`createAtlasTarget`'s texture gets `mipmapsAutoUpdate = false` (r187, #34630) for the bake's
frames and `true` before the last copy, so the mips are generated once per atlas.

### D4 — Impostor materials as instances (note)

Every octahedral impostor material has the same graph with its own atlases: as
`NodeMaterialInstance`s of one base (p302 D2's variants as instances) they'd share one build.
Decide after p302's Phase 3 spike.

## Phases

1. **Spike** (half a day): D1 and D2's candidates in lodShowcase. p057 D3's probe (wrap
   `renderer._nodes._createNodeBuilder`, count builds per `InstancedMesh`) shows the sharing, and a
   two-pool test (one material, different fades, a known screen position) shows each pool draws
   its own fades.
2. **D1 and D2** in `OctahedralImpostorMaterial.ts` and `LodFade.ts`, `objectSpecific` removed; a
   unit test for the build key rule where it can run without a GPU; `yarn verify:scenes` (the
   lodShowcase and largeWorld snapshots unchanged). Re-measure a fade's start on an InstancedMesh
   entity and replace the 11-14 ms in `features/lod/CLAUDE.md`.
3. **D3** with the bake time before and after (`features/lod/impostors/CLAUDE.md`'s timing).
4. **Docs and versioning:** the LOD and impostor `CLAUDE.md`s (the second binding and the
   object-specific builds go), the Hub's LOD page if it mentions either, an engine patch.
