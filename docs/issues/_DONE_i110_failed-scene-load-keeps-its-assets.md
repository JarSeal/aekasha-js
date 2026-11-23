**Title:** A scene load that fails keeps the assets it loaded until that scene is visited again

Status: fixed | 2026-11-23, a load that fails after the teardown deletes what it built of its scene and releases its assets
Category: Scenes, Assets
Found: 2026-10-15, p613 Phase 3 (D3: a failed load cleans up)
Our workaround: none. A load fails only on a broken scene (a throw in its scene code, a missing camera, an asset that can't load), which the debug env shows; fix the scene

## What happens

Since p613 D3, a failed `loadScene` resolves `false` and undoes what the load turned off (the
inputs, the canvas's pointer events, the debugger, the loading scene id) and hands the asset
owner back to the scene that is current (`finishLoad`, `kernel/scene/SceneLoader.ts`). It
doesn't release what the failed load had loaded by then: its textures, materials, geometries and
imports stay registered, tagged with the failed scene's id (`setAssetOwnerScene` in
`beginLoad`).

The scene release (`releaseSceneOwnedAssets`, `kernel/assets/SceneAssetRelease.ts`) runs for the
scene a load leaves, so the next load releases the scene that was current, not the failed one.
The failed scene's assets go only when that scene loads successfully later (its load re-uses and
re-tags them) and is left. A failed scene that's never loaded again keeps them for the page's
life: GPU memory and, for textures from the assets worker, their ImageBitmaps.

Also worth knowing: a load that fails after the teardown leaves the scene that was current
current, but torn down (its entities, groups and loopers gone). A failure before the teardown (an
unknown scene, scene code or loader, `resolveLoadTarget`) changes nothing.

## A way out

In `finishLoad`'s failed branch, release the failed scene's assets when it isn't the current one
(`releaseSceneOwnedAssets(load.sceneId)`, which keeps what another scene or a
`retainedTextures` hook still uses). It needs a test that the previous scene's shared assets
survive it (a texture both scenes list) and a check that the entities the failed scene code
created, if any, are deleted first (they hold refs on its materials and geometries).

## The fix

The way out, in engine 6.23.0, with the failed scene's other parts deleted before the release
too: `tearDownFailedLoadAsync` (`kernel/scene/SceneLoader.ts`), a step of the load's promise chain
between its error handler and `finishLoad`.

- It runs when the load failed after the teardown had started (`ActiveLoad.isTornDown`, set by
  `tearDownPrevScene` first) and its scene isn't current. A failure before the teardown (the
  loader's `loadStartFn`) changed nothing, and a scene that became current (a `created` hook or
  `loadEndFn` that threw) stays current with its assets.
- It deletes what the load built of its scene, as a teardown does: the features' `exit` hooks
  with its id (physics entities, characters, lines, PostFX, and its viewports, which the next
  load's teardown, keyed by the previous scene, missed), the groups, its loopers, the ray helpers,
  the secondary worlds and the non-persistent entities, which give back their refs on its
  materials and geometries. `tearDownPrevScene`'s steps became `deleteSceneParts` and
  `deleteSceneEntities` for it. Not its exit listeners (it never entered) nor the `worldCleared`
  hooks (they set up a next scene).
- Then `releaseSceneOwnedAssets(load.sceneId)`: what the current scene shares with it (a texture
  both list, re-tagged by the failed load) only loses the failed scene's key.
- Its loopers went nowhere before: they stayed in its list and ran on its next successful visit,
  next to the ones its scene code adds again.
- It never rejects: a throw (a feature's exit hook) is logged, and the load finishes as failed with
  the page usable.
- Checked by `SceneLoader.test.ts` (the order of the exits, clears and release, the stale looper,
  a failure before the teardown and after the scene became current, a throwing exit hook) and
  `SceneAssetRelease.test.ts` (the shared texture survives, keeping only the current scene).
