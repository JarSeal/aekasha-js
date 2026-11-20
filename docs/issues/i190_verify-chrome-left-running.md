**Title:** A killed verify or bench run leaves its headless Windows Chrome rendering on the GPU

Status: open
Category: Dev tools, Verify
Found: 2026-11-19, p309 Phase 4 section 5 (the terrain decals bench, `devTools/bench/terrainBlockTestDecals.ts`)
Our workaround: after a run that didn't end on its own (a killed process, WSL2 shut down), end the Chrome by hand: `powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { $_.CommandLine -match 'aekasha-verify-chrome' } | Select-Object ProcessId,CommandLine"`, then `taskkill.exe /PID <the browser's pid> /T /F`

## What happens

On WSL2, `launchVerifyChromiumAsync` (`devTools/verify/browser.ts`) starts the Windows Chrome headless on a fresh profile in `%TEMP%\aekasha-verify-chrome\<time>-<WSL pid>\`. The scene runner, the embed check and the benches (`devTools/bench/`) use it. It ends at `closeAsync`, and a `process.exit()` that skips that still ends it (`killSync` on `'exit'`, `taskkill`). A process that's killed outright (SIGKILL, WSL2 shut down or crashed) runs no exit handler, so its Chrome keeps going: the page it had open keeps rendering its scene on the GPU, with no one connected to it. The next run's `removeStaleProfiles` removes only profile folders a day old, and fails on one a running Chrome holds; it never ends a process.

Found when WSL2 went down during the decal bench's 10-minute churn: that page (the `terrainBlockTest` scene stamping 60 footprints a simulated second) went on rendering for hours. Every later GPU measurement shared the GPU with it (the bench's WebGL2 timer queries read about 2 ms where a free GPU read 0.56, and one run lost its WebGL2 device), and the user's own dev server page dropped to 4-5 frames a second until the process was ended.

## A fix

At launch, before `removeStaleProfiles`: for each profile folder whose name's WSL pid isn't a live process of this WSL2 instance (`process.kill(pid, 0)` throws; a pid's start time later than the folder's timestamp means it was reused), end the Chrome processes whose command line names that folder (`Get-CimInstance Win32_Process` through `powershell.exe`, `taskkill /T /F` on each browser process), then remove the folder. A run then cleans up after a killed one as it starts, and a measurement never shares the GPU with a page nobody is watching. The launcher's `@remarks` then says so.

Until then, a bench or verify run whose GPU figures look wrong is worth checking for one first.
