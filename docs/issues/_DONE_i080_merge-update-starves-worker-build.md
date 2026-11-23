**Title:** `updateMergeMember` every frame keeps a worker-built merge group from ever building

Status: fixed | 2026-11-23, a worker build is kept through a member's updates and joins, and the members updated meanwhile are written once it lands
Category: Merging
Found: 2026-11-11, p375 Phase 0's spike (its Results, item 3)
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

## The fix

The fix idea, with two differences and two more ways in found on the way:

- **An update during a worker build marks the member** (`MERGE_MEMBER._isMovedInBuild`) instead of
  dropping the build. `applyBuild` writes each marked member for its pose now, after the build is
  applied (`rewriteMember`, from the `_bakedMatrix` the build set, its start's pose). A build
  clears the mark when it reads the member's pose. A built member updated during a rebuild is
  written in the mesh drawn now too, as before. The writer reaches `MergeBuild.ts` through
  `setMovedMemberRewriter`, which `updateMergeMember` calls before it marks one: an import would
  have shipped the in-place writes with every `merging()` app, where they're tree-shaken unless an
  app calls `updateMergeMember`.
- **A geometry whose vertex count changed doesn't drop the build** (the fix idea's): a member
  waiting for the build has no range to compare with when it's updated. The build lands, the
  write after it finds the range doesn't fit (`rewriteMember`'s check), warns and marks the group,
  which builds again.
- **A member joining dropped it too:** `addToMergeGroup` marks the group, and the build system's
  next run started a new build, whose token dropped the running one. A group a member joined
  every frame (spawns, a streamed cell's meshes) never built either, nor one a
  `rebuildMergeGroup` or a removal past the waste share marked during a build. `buildPendingGroups`
  now leaves a group whose worker build runs pending until it lands, and returns the running
  build's promise, so the scene step awaits it and builds the group in its next round. Only a
  leaving member or the group's deletion drops a build.
- **An edit session ended during a worker build** returned before its write for a member waiting
  for that build, so a build started before the move landed at the old pose. `endMergeMemberEdit`
  calls `updateMergeMember` first now, which marks it.
- Tests: `MergeWorkerBuilds.test.ts` (the worker build tests out of `MergeGroups.test.ts`, which
  was at its size: a member updated every frame, a rebuild's moves, a geometry replaced, members
  joining every frame and a build asked for meanwhile) and `MergeMemberEdit.test.ts` (a session
  begun and ended during a worker build). Each fails with its part of the fix taken out.
