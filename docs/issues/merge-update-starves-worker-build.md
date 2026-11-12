**Title:** `updateMergeMember` every frame keeps a worker-built merge group from ever building

Status: open
Category: Merging
Found: 2026-11-11, p375 Phase 0's spike (`docs/plans/_DONE_p375_batched-mesh-batches.md` §2 Results, item 3)
Our workaround: don't call `updateMergeMember` on a group's members until it has built (`MERGE_MEMBER.partIndex >= 0`), or keep moving content out of merge groups (a `BatchedMesh` batch, p375)

## What happens

`updateMergeMember` drops a running worker build (`MergeGroups.ts`: `group._isBuilding` →
`_buildToken++`, `markPending`), so the build system starts another one in the next frame. A group
over `WORKER_BUILD_VERTICES` (65 536) always builds in the assets worker, which takes more than a
frame, so a member updated every frame drops every build before it lands: the group never builds,
and all its members stay drawn on their own.

Seen in the spike's `batchedMeshSpike` scene (`?bmsWay=baked&bmsMove=0.1`): 2 000 members, about
1 M vertices in one explicit group, 10% of them moved each frame with `setTransform` and
`updateMergeMember` from the first app frame. It drew 2 003 draws and never built. The scene step
builds a load's groups before `entered`, but the app's loopers ran 2 frames before the group's
first build was in, enough for the first update to drop it. With the moves held until the first
build (`partIndex >= 0`), the group drew in 4.

The same holds for a rebuild (a compaction, `rebuildMergeGroup`) of a group whose members are
updated every frame: the old mesh keeps drawing, but the rebuild never lands.

## Fix idea

Don't drop a running build for a pose change. A member not built yet has nothing to rewrite, and
the build reads the pose at its start, so a member updated during a build is marked (a flag on
`MERGE_MEMBER`), and once `applyBuild` lands it rewrites the marked members in place (the
`rewriteMember` write). A built member updated during a rebuild is rewritten in the current mesh
now and marked for the new one. A member leaving, or a geometry whose vertex count changed, still
drops the build as now. Test it in `MergeGroups.test.ts` with the async merge mocked (an update
every frame while the build is held, then the build lands with the latest pose).
