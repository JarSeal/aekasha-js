**Title:** The scene runner waits its whole 180 s on a scene whose first load failed

Status: open | for the scene runner's next change
Category: Dev tools, Debug
Found: 2026-10-22, p620 Phase 5 (the rewritten start scene's first try failed to load; the runner reported a timeout three minutes later)
Our workaround: read the page's console errors in the run's report (the load's error is there) rather than the timeout line

## What happens

The scene runner (`devTools/verify/sceneRun.ts`) waits for the scene through the test bridge's
`whenSceneReady` (`debug/_dbg__TestBridge.ts`), which polls every frame for "the first scene has
loaded and no load is running". A first load that fails resolves `loadScene` with `false` and
leaves no current scene: the first scene never counts as loaded, so the poll runs to
`READY_TIMEOUT_MS` (180 s, `scenes.config.ts`) and the runner reports "the scene didn't finish
loading in 180 s". The load failed in the first seconds; the cause is in the page's console
errors.

On SwiftShader a run of every configuration then loses 12 minutes per broken scene, and the
message points at a slow load rather than a broken one.

## A way out

The bridge records the first load's result (the boot's `loadScene` promise, or a scene hook's
"load finished" with its outcome), and `whenSceneReady` resolves `{ status: 'FAILED', sceneId }`
as soon as it's `false`. The runner reports "the scene failed to load" and goes on. Both are
debug and dev tool code: no production change (`TestBridgeSceneReady` is deprecated on
`aekasha/debug` and goes `@internal` in engine 6.0.0, so a new member is fine).
