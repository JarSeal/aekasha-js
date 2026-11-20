**Title:** A change of the active camera rebuilds the whole PostFX chain: a shader recompile on every camera cut

Status: open
Category: Rendering, PostFX
Found: 2026-10-16, p613 Phase 7 (the `perf-auditor` pass over `getActivePostFxPipeline`)
Our workaround: none. Keep one active camera and move it, rather than switching cameras, in a scene with heavy passes (GTAO)

## What happens

`getActivePostFxPipeline` (`features/postfx/PostFX.ts`) rebuilds the chain whenever the active
camera isn't the one it was built for (`camera !== builtCamera`). A rebuild makes a new scene pass
(`pass(rootScene, camera)`), the depth and normal pre-pass when a pass reads them, and every
enabled pass's node again, so three compiles the chain's shaders again: a hitch of a frame or more
with GTAO. It happens on every gameplay camera cut (`setActiveCamera`), and in the debug env on
every toggle of the debug camera (F1).

Resizing doesn't rebuild (the passes get `onSetSize`), and neither does a param change through a
pass's `setParam`.

## Why it's not a one-line fix

The camera is part of the pass contract: `PostFxPassContext.camera` is handed to each pass's
`fxNode`, and a pass may bake it into its nodes (the app's `ambientOcclusion.tsl.ts` hands it to
three's GTAO node). Swapping the scene pass's camera in place would leave those passes with the
old one.

## A way out

- Give the passes the camera as something they read per frame (a camera reference node, or a
  `setCamera` hook in `PostFxPassApi` next to `setParam`), and swap the scene and pre-pass
  cameras without a rebuild. Passes without the hook keep today's rebuild.
- Or keep one compiled chain per camera used, for scenes that cut between a few fixed cameras
  (GPU memory per chain: its render targets).

Either changes `PostFxPassContext` / `PostFxPassApi`, which are on `aekasha/postfx`: an engine
minor with the hook optional.
