Status: implemented (Phases 1-4)
Category: Rendering, LOD, Performance
Epic: p350_lod-system-research.md (Tier 2, before p353)
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

### Phase 1 — Spike — done

D1 and D2's candidates in lodShowcase. p057 D3's probe (wrap
`renderer._nodes._createNodeBuilder`, count builds per `InstancedMesh`) shows the sharing, and a
two-pool test (one material, different fades, a known screen position) shows each pool draws its
own fades.

As built (2026-11-06):

- The probe wraps `NodeBuilder.prototype.build` / `buildAsync` in the page's own three instance
  (the `three_webgpu.js` dependency URL from the resource entries, imported as soon as the app
  fetches it, before the first build) and records each build's object, material and
  `objectSpecific`. The fade test renders, with the app's renderer into a target of its own while
  the loop is frozen, six slots on one dithered `MeshBasicNodeMaterial` and reads their coverage
  back: an InstancedMesh with its own fade at 1, one with two instances at 0.5 and 0.1, one
  without a fade attribute at a per-object 0.25, a plain mesh at a per-object -0.75, and an
  InstancedMesh whose fade attribute is created after its first draw, then set to 0.5. The scripts
  stayed in the session's scratchpad; this is their method.
- D2 took neither candidate as written: `LodFadeAttributeNode` subclasses three's
  `ReferenceAttributeNode` (`'lodFade'`, `'float'`) and overrides `getAttribute(object)` to return
  the mesh's `createLodFadeAttribute` attribute, else an opaque one made once per mesh
  (`getDrawnFadeAttribute`). So every dithered InstancedMesh binds a fade attribute and they all
  share one build; no build key rule is needed. `createLodFadeAttribute` adopts the opaque
  attribute a build already bound, so it can now be called after the first draw (before, a fade
  attribute added after the first draw was ignored: the probe's last slot drew 100 % on `main`).
- Found in the spike: an InstancedMesh **entity** fades through `setLodObjectFade` (its fade copy
  and its cull fade, `LodFades.ts`), and its copy is an InstancedMesh too. So the instanced path
  takes both fades: `lodDither(instanceFade).and(lodDither(objectFade))`, the unused one opaque.
- Results, WebGPU and the WebGL2 fallback alike: the six slots' coverage is exactly 100, 50, 10,
  25, 75 and 50 %; the fade test takes 2 builds (one instanced, shared by the four InstancedMeshes,
  and the plain mesh's) against 5 on `main`. lodShowcase's load takes 49 builds, 18 of them
  instanced and none object-specific, against 69, 38 and 38 on `main`.

### Phase 2 — D1 and D2 — done

In `OctahedralImpostorMaterial.ts` and `LodFade.ts`, `objectSpecific` removed; a unit test for the
build key rule where it can run without a GPU; `yarn verify:scenes` (the lodShowcase and
largeWorld snapshots unchanged). Re-measure a fade's start on an InstancedMesh entity and replace
the 11-14 ms in `features/lod/CLAUDE.md`.

As built:

- D1 as designed: `ImpostorInstanceMatrixNode.setup` returns one module-level
  `referenceAttribute('instanceMatrix', 'mat4')` for an InstancedMesh, `mat4(IDENTITY)` otherwise;
  the second `InstancedInterleavedBuffer`, its version sync and `updateBefore` are gone. three
  dedupes node attributes per node, so the material declares the matrix's four columns a second
  time over the same vertex buffer (no extra vertex buffer).
- `LodFade.test.ts` checks the binding rule on the mask's real graph (its `setup` with a stub
  builder): a plain mesh binds no fade attribute; an InstancedMesh's binds per object (its own, or
  an opaque one of its capacity, the same one each time); `createLodFadeAttribute` adopts the bound
  one; the instanced graph reads the per-object uniform too. The first three fail on `main`'s
  `LodFade.ts`.
- `yarn verify:scenes --only lodShowcase,largeWorld --config quick` against baselines recorded on
  `main` minutes before: both pass (lodShowcase's snapshot within tolerance: mean 0.015, max 5,
  0.00 % changed); lodShowcase on the WebGL2 fallback (`--webgl`) the same way (mean 0.012,
  max 1).
- A fade's start: forcing each level in lodShowcase (`setLodDebugOptions({ forceLevel })`, 0, 1,
  2, 3, then off) builds no shader on the branch, against 3-5 instanced builds per switch on
  `main`. The worst frame doesn't show the difference in this scene (18-25 ms either way, headless:
  r187 builds asynchronously), so `features/lod/CLAUDE.md` states the builds, not a time.

### Phase 3 — D3 — done

With the bake time before and after (`features/lod/impostors/CLAUDE.md`'s timing).

As built: `createAtlasTarget` sets `mipmapsAutoUpdate = false`, and `finishAtlasMips(atlas)`
(`ImpostorBake.ts`, `@internal`) turns it back on right before the last copy into each atlas, in
both bakes (`OctahedralImpostor.ts`, `CrossQuads.ts`); both backends honour the flag at the end
of a render into the target. The one runtime bake in lodShowcase and largeWorld
(`lodShowcaseRockBaked`, octahedral 12 × 12) took 58.8, 60.9, 63.7 and 59.2 ms on `main` and 58.1,
58.4, 57.2 and 55.7 ms on the branch (CPU time, four page loads each); the GPU saves
frames² × passes − 2 mip chains per bake (286 at 12 × 12), not measured.

### Phase 4 — Docs and versioning — done

The LOD and impostor `CLAUDE.md`s (the second binding and the object-specific builds go), the
Hub's LOD page if it mentions either, an engine patch.

Done in Phases 1-3: both `CLAUDE.md`s and `LodFades.ts`' comment; the Hub's LOD pages mention
neither (their bake times still hold). `devTools/verify/baselines/` recorded (`api.json`: the
`@internal` `finishAtlasMips`; `bundle.json`: `OctahedralImpostor.js` 0.2 kB smaller gzip;
`docs.json`).

As built: engine 6.1.0 → 6.1.1 and, for the exported impostors' JSONs, app 1.19.0 → 1.19.1, with
the branch's `CHANGELOG.md` entry. The issue `docs/issues/impostor-export-plan-citation.md` is
fixed here: the LOD tab's export string and the four exports' eight descriptions edited by hand
(the asset lock's keys don't read a description: the gather reports every asset up to date).
