**Title:** A scene load that fails keeps the assets it loaded until that scene is visited again

Status: open
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
