Status: stub — not-implemented
Category: Rendering, LOD, GPU
Epic: p350_lod-system-research.md (Tier 3)
Related: \_DONE_p346_spatial-domains.md, \_DONE_p351_impostor-billboard-lod.md (impostor levels are bins too), p240_client-device-capability-sniffer.md (whether the GPU path is worth enabling on a device)

# GPU-Driven Culling & Per-Instance LOD — Stub

**This is a stub.** It records the target and what's known, so the real plan can be written once
p348 has shipped and its numbers show where the CPU path stops scaling.

## Goal

Move instance culling and LOD selection for instanced content off the CPU:

1. A compute pass reads every instance's bounds from a storage buffer, tests it against the camera
   frustum, picks its LOD level with p348's rules (screen size, bias), and appends its index to
   that level's visible list.
2. Each level draws with an indirect draw whose instance count the compute pass wrote. The vertex
   stage fetches the instance's matrix through the visible list.
3. No per-instance CPU work per frame: ten thousand or a million trees cost one dispatch and one
   indirect draw per level.

This is the realistic end state for the engine (p350 §7): "Nanite-lite" at instance granularity,
without meshlets or software rasterization.

## What's known (2026-10-02)

- three r186's WebGPU backend supports indirect draws (`geometry.indirect`, an
  `IndirectStorageBufferAttribute`; `renderers/common/Geometries.js:286`,
  `WebGPUBackend.js:2187`) and indirect compute dispatch (`WebGPUBackend.js:1925`).
- The engine has no compute passes yet (checked 2026-11-04). The only compute-related code is
  debug: the GPU timer (`src/_engine/debug/_dbg__GPUTimer.ts`) times compute dispatches with the
  frame's render contexts, and the stats panels show them (`src/_engine/debug/CLAUDE.md`, GPU
  timing), so the spike's dispatch cost is readable without new tooling.
- **The WebGL2 fallback (`forceWebGL`) has no compute.** The CPU path (p348) must stay and is
  chosen per backend.
- ECS state: GPU-culled instances have no ECS visibility tags (`TAG_FRUSTUM_CULLED`,
  `TAG_LOD_CULLED`). That's fine for instanced content, which has none of the per-entity hooks
  anyway, but anything gameplay-side reading "is this visible" can't use the GPU path.
- **The CPU path's cost, measured** (p616 Phase 2, largeWorld's 3,800 `LOD` entities and pool
  instances, debug env): LOD selection about 0.12-0.17 µs per entity a frame
  (`features/lod/CLAUDE.md`); `instancedMeshPoolSyncSystem` about 35 ns per instance with nothing
  moving (130-150 µs for 3,500). These are the numbers the GPU path has to beat, and the point
  where the CPU path stops scaling is somewhere above them: the real plan measures it first.
- **The pieces it builds on** (`features/instancing/CLAUDE.md`, `features/lod/CLAUDE.md`): the
  instanced LOD pool (`createInstancedLodPool`, one `InstancedMesh` per level, instances moved
  between them through `registerLodTarget`), its per-instance `lodFade` attribute
  (`createLodFadeAttribute`, `enableLodDither`, on `aekasha/lod`), and pool bounds that grow
  with their instances and never shrink.
- **Where it goes** (SBP, `devTools/sbp/CLAUDE.md`): the GPU path is part of `instancing()` (with
  `lod()`'s rules ported), opted into per pool, and its compute code loads with an `import()` on
  the first pool that asks for it on a WebGPU backend, so a build or a device that doesn't use it
  downloads none of it; `yarn sbp`'s `instancing` and `lod` groups stay within their budgets.
- Known leak to keep in mind when measuring memory across scene visits:
  `docs/issues/three-instanced-node-attribute-leak.md` (three r186 never deletes a removed
  `InstancedMesh`'s instance attributes).

## Open questions for the real plan

1. **Shadow passes.** Each shadow-casting light needs its own cull against its own frustum (or a
   conservative union). How many dispatches per frame is that with the sky's sun plus a few spot
   lights?
2. **Where instance data lives.** Pool transforms are on the ECS side today, synced into
   `instanceMatrix` by `instancedMeshPoolSyncSystem`. A GPU path wants them in a storage buffer
   written once (static instances) or from a dirty list (dynamic).
3. **Occlusion culling.** A Hi-Z pyramid from the previous frame's depth is the usual next step.
   Worth it only for dense scenes (cities, forests seen from inside); measure first.
4. **Interaction with three's own culling.** Instanced meshes on the GPU path must have
   `frustumCulled = false` (the whole batch is one object to three).
5. **Debugging.** A readback of per-level visible counts (async, debug only) for the LOD drawer
   tab (`features/lod/debug/_dbg__LOD.ts`), and the GPU memory tab's view of the storage
   buffers (a `registerGPUMemorySource`, `aekasha/debug`, if three's `info.memory` doesn't place
   them under an owner).
6. **Cross-fades** (p351 Phase 2, no popping). An instance changing level is appended to both
   levels' visible lists for `fadeSeconds`, each with its signed fade for `lodDither`, and fades
   out to culled the same way; the fade state per instance moves to the GPU. `fadeSeconds: 0`
   keeps instant switches. The GPU path must match the CPU path here, or a pool would pop only
   on one backend.

## Rough phases (to be refined)

0. **Spike.** A TSL compute pass that frustum-culls 100k instances into one indirect draw, on
   WebGPU, with p345's frame numbers before and after.
1. **Frustum culling + indirect draw** for one instanced pool type, behind a per-pool flag.
2. **Per-instance LOD** binned into per-level indirect draws (p348's rules ported to TSL).
3. **Shadow passes.**
4. **Occlusion culling**, if measured as worth it.
5. **Hub and docs** (second-to-last, per the plans' convention): the LOD feature page
   (`hub/pages/features/lod/`, which covers the pools too) and the instancing and LOD nested
   `CLAUDE.md` files, a `lodShowcase` lane for the GPU path
   (`features/lod/CLAUDE.md`'s lanes), then versioning.

## Not in scope

Cluster-level (meshlet) LOD stays research (p350 §8, Tier 4): a timeboxed spike, and only if huge
single meshes (terrain chunks, large architecture) need finer detail than per-object LOD gives.
