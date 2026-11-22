**Title:** The scene runner waits its whole 180 s on a scene whose first load failed

Status: fixed | 2026-11-22, the test bridge's `whenSceneReady` resolves `FAILED` once a load settles with no scene loaded, and the runner reports it at once
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

## The fix

The scene hook way: the bridge never sees the boot's `loadScene` promise (the app's `start` makes
that call; the boot only installs the bridge before it, `Boot.ts`). `TestBridgeSceneReady` had
gone `@internal` with engine 6.0.0 already.

- **The bridge** (`debug/_dbg__TestBridge.ts`): `_installTestBridge` adds two scene hooks for the
  page's life. `loadStart` keeps the scene the load loads (`getNextSceneId()`; `finishLoad` clears
  it before `loadSettled` runs), and `loadSettled` (which runs for a failed load too) records a
  failed first load when no scene has loaded yet (`hasFirstSceneBeenLoaded()`). Each frame,
  `whenSceneReady` waits while a load runs, then resolves `READY` once the first scene has
  loaded, else `FAILED` with the recorded scene id. A load queued behind the failed one starts in
  a microtask, before the next frame's check, so it's waited for, and its success reads `READY`.
- **The result** (`debug/TestBridge.ts`): `TestBridgeSceneReady` has `{ status: 'FAILED';
  sceneId: string | null }`, and `TEST_BRIDGE_VERSION` is 8.
- **The runner** (`devTools/verify/sceneRun.ts`): `FAILED` is the run's failure, `the scene "<id>"
  failed to load (its error is below)`, and the run goes on; the report prints the page's errors
  under the failures, the loader's `Could not load scene "<id>" (phase '…')` among them. A
  `TIMEOUT` keeps "didn't finish loading in 180 s". The bench tools that print the status read
  `(FAILED)`; `devTools/bench/instanceStressPage.ts`, which said "didn't load in N s" for any
  status, says "the scene failed to load".

A load that throws before it starts (`resolveLoadTarget`: an unknown scene id, a scene without
code, an unknown loader) runs no scene hook, so it still times out. The runner doesn't meet it:
`?startScene` falls back to the usual start scene for an id without its data and code. Covering it
would take a change to `SceneLoader.ts`, which ships.

Checked 2026-11-22 on WSL2's Windows Chrome (WebGPU): `exampleQuickStart` with its scene code
throwing first, `yarn verify:scenes --only exampleQuickStart --config quick`, failed in 3.3 s with
the message and the load's error under it; without the throw it loaded and hashed as before (its
local baseline's system order, recorded at `dc2b28ad`, differs the same way with and without the
change).
