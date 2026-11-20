**Title:** A page can't mount the engine again after `unmount()`: the boot's registrations are static

Status: won't fix | until an app needs it
Category: Init, Embed
Found: 2026-10-14, p611 Phase 3 (the embed's `mountAekasha`); decided in p612 D8
Our workaround: one mount per page load. Hide the container instead of unmounting it (`pause()` stops the loop), or reload the page

## What happens

`mountAekasha` boots the engine into an element of a page it doesn't own, and its handle's
`unmount()` takes it out again: the loop stops for good, the input listeners, the assets worker
and the renderer go, and the container leaves the page (`kernel/init/Mount.ts`' `teardown`). A
second `mountAekasha` in the same page load then throws, as does `InitEngine` after a mount or a
mount after `InitEngine`: `bootEngineAsync` (`kernel/init/Boot.ts`) runs once per page load
(`isEngineBooted`), and the mount keeps its own `hasMounted`.

That's on purpose. The boot fills state that lives at module level and has no way back:

- The ECS's static registries (`ECSWorld` in `kernel/ecs/ECS.ts`): the core and global plugins,
  the add, remove and delete hooks per component type, the transform reset listeners, the worlds
  and their listeners.
- The install seams the features fill through their `FeatureContext`
  (`kernel/init/Features.ts`): the scene hooks (`kernel/scene/SceneHooks.ts`), the fixed-step
  driver and the action sampler (`kernel/loop/MainLoop.ts`), the render pipeline provider and the
  after-render hooks (`kernel/render/RenderHooks.ts`), the import extensions
  (`kernel/assets/import/ImportExtensions.ts`), and the two setters off the context
  (`setSpatialDomainMembership`, `setAutoLodResolverLoader`). The single-provider seams (the
  fixed-step driver, the render pipeline, the import extensions) throw on a second one; the lists
  (the scene hooks, the after-render hooks) would run each entry twice.
- The scenes (`kernel/scene/Scene.ts`: the registry, the root scene, the all-scenes enter and exit
  callbacks) and the app's data (`kernel/scene/AppData.ts`).
- Every module's own state: the cameras (the active and main camera), the lights, the assets'
  caches, the HUD root, the draggable window kinds, the icons, the input devices, and each
  feature's (the physics world and its worker, the character and brain kinds, LOD's queues, the
  spatial domains, the instanced pools, the lines, the PostFX chain, the viewports' layer, the sky
  box). In the shipping engine modules (no debug or worker code) that's 361 module-level `let`s and
  collections in 75 files.
- The configuration and the environment flags (`kernel/config/Config.ts`), read once at boot.

A mount after `unmount()` would install every feature again on top of the first install's
registrations: each hook and system twice, a second provider for each single-provider seam (a
throw), the scenes registered again.

## Why it isn't fixed

No app has asked to unmount and mount again in one page load. The embeds we build (the banner,
the Hub's live examples) mount once and stay, pausing out of view. A reset would be machinery in
every module for a case nobody has, and every byte of it ships in every build, the embeds' first
of all.

## What a fix would need

1. A reset per module that holds state, called in reverse install order: each registration's
   remover (the ECS hooks and plugins, the scene hooks, the seams), each feature's own state
   (an `uninstall` next to `install` on `EngineFeature`, or a remover list the `FeatureContext`
   fills as the feature registers), the kernel's (`uninstallKernel`), then the scene registry, the
   app data, the configuration and `isEngineBooted`.
2. A stop for anything that starts a worker or a timer at boot. `physics()` has one since p614
   (`FeatureContext.onUnmount`, `stopPhysics`), but it's for good: a reset would have to start
   physics again. `skyBox()` has one since p615 (`stopSkyBox`: the sky box cleared, its bakes and
   lights gone, its listeners dropped); its registered definitions stay.
3. A test that boots, unmounts and boots again in one module graph, and compares every
   registry's size with the first boot's, so a new registration without its remover fails. Today
   `moduleSideEffects.test.ts` guarantees nothing registers at module load, which is what makes
   such a reset possible at all.
4. The size measured with `yarn sbp` (the embed profiles), since the reset code ships where
   mounting does.

Until then `mountAekasha`'s JSDoc and `yarn verify:embed` (a second mount throwing) state the
rule, and the throw's message says why.
