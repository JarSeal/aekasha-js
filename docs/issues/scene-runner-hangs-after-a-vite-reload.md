**Title:** The scene runner can hang for good after Vite reloads a page mid-run

Status: open | not reproduced since
Category: Verify, Tooling
Found: 2026-11-09, p354 Phase 1 step 6 (`yarn verify:scenes --only instanceStress`, the first run of its variants)
Our workaround: stop the run and start it again: Vite's dependency cache then has the module, and the page doesn't reload

## What happens

The first page of the run (`instanceStress@pools`, `workerSab`, on WebGPU, macOS) loaded a
dependency Vite hadn't optimized yet (three's `MeshletDrawingPipeline`, imported by the scene's
debug module behind `?stressPipeline=meshlet`). The progress log's last lines were
`[vite] ✨ new dependencies optimized: …` and `[vite] ✨ optimized dependencies changed. reloading`,
then nothing for 43 minutes, with the tsx process and Chrome alive (Chrome's GPU process busy).
The runner's own timeouts (the bridge's, the probe's: at most about 6 minutes) never fired, so
something on the reload's path waits without one: the re-run in a fresh context
(`RELOAD_RERUN_NOTE`, `sceneRun.ts`), or the first attempt's page or context close on a page that
navigated away mid-call.

Run again right after, with the dependency cached, the same page passed in 6 s, and all eight
pages of both variants in 34 s.

## A way out

Reproduce it with a module Vite hasn't optimized (clear `node_modules/.vite-verify`), find the
await that has no timeout, and give it one (`withTimeout`, `browser.ts`), so a hung page fails its
run instead of the whole command.
