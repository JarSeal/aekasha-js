**Title:** `lodShowcase`'s snapshot fails against a baseline recorded earlier: its clouds drift

Status: fixed | 2026-10-19, p615 (D5, Phase 2)
Category: Verify, Sky box
Found: 2026-10-13, p609 Phase 2 step 3 (`yarn verify:scenes` against the baselines recorded an hour earlier)
Our workaround (until p615): record the scene's baselines again right before a run that should compare it (`yarn verify:scenes --only lodShowcase --update`), and read a failure that differs only in the clouds as this issue

## What happens

`yarn verify:scenes` passed 93 of 96 runs. The three that failed were `lodShowcase` in the three
debug configurations (the physics worker over a `SharedArrayBuffer`, over messages, and on the
main thread), all on the snapshot: 0.12-0.13 % of the pixels differ, by at most 47-49, all in
the clouds. The determinism hash was the same as the baseline's. It isn't the change being
checked (p609's move): the commit before it, run in a worktree against the same baselines, fails
the same way. Shortly after `--update`, the scene passes.

Seen again 2026-10-17 (p614 Phase 7 step 4), in five scenes: `exampleHubHero`, `exampleLod`,
`lodShowcase`, `skyShowcase` and `space`, the three debug configurations each (14 runs), 0.00-0.13 %
of the pixels, against baselines recorded about a day earlier; the commit before the change failed
the same way, and the five passed once recorded again.

## Why

The scene uses the `dayNight` sky box (`src/app/skyboxes/dayNight.skybox.json`), whose clouds
move. In the view, the clouds layer (`features/skybox/layers/Clouds.ts`, `cloudsNode` in `VIEW`
mode) reads three's TSL `time` node: the renderer's node frame time in seconds since it started,
the wall clock. It isn't the engine's elapsed time, and nothing in a run pins it, so where the
clouds stand in the snapshot depends on how long the page took to get to it. The environment
bake freezes its clouds at that same time (`bakeTime` from `getFrameTime()`, `SkyBox.ts`), so the
reflections follow it too. Why a run long after the baseline differs more than back-to-back runs,
and why only the debug configurations fail, isn't pinned down yet.

The physics probe doesn't see it: the clouds are rendering only, outside the simulation.

## Fix directions

- Pin the clouds' time in the scene runner: set three's node frame time to a fixed value (or the
  loop's elapsed time) before the snapshot, so every run renders the same clouds.
- Or drive the clouds from the engine's clock (`getElapsedTime()`, which stands still in editor
  views and while the app is paused) through a uniform, instead of three's `time`. That also
  makes a paused scene's clouds stop, which the Views section of the root `CLAUDE.md` lists
  among the work that keeps going outside the loop.

## Fix

p615 (the sky box review, D5) moved everything the snapshots showed off the wall clock:

- **The clouds** read a `time` uniform of the sky box's own (`skyClockSec`,
  `features/skybox/SkyDayNight.ts`), which `skyBoxSystem` advances by the change in
  `getElapsedTime()` unless a scene is loading, and which a scene's exit restarts at 0. The env
  bake's frozen clouds take `bakeTime` from the same clock; `getFrameTime()` and its read of the
  renderer's private node frame are gone. Under the scene runner the elapsed time is
  frame-counted (`setFixedFrameDelta`), so a snapshot taken at the same frame shows the same
  clouds.
- **The bake schedules**, which is what `space` (no clouds, a throttled nebula bake) showed:
  the day-night re-bake's rate limit and the nebula bake's 150 ms throttle read
  `getElapsedTime()` instead of `performance.now()`, so the bakes before a snapshot, and the sun
  and clouds each one freezes, are the same on every run.

Phase 0's measurement also found that the test bridge already pinned three's `time` node
(`_dbg__TestBridge.ts`, `NodeFrame.prototype.update`), so the clouds weren't on the wall clock
under the runner at the time; the bake schedules were. The stars' twinkle is still on three's
`time`, and that pin covers it.

The evidence:

- After the change, the four scenes with clouds (`exampleLod`, `exampleSkyBox`, `lodShowcase`,
  `skyShowcase`) moved once (0.00-1.49 % of the pixels: the clouds now start from 0 per scene)
  and were recorded again. Right after, the six sky scenes (those four, `exampleHubHero`,
  `space`) passed, 24 runs (macOS, headless Chromium, WebGPU).
- About 55 minutes after a recording (p615 Phase 4, WSL2, headless Chromium, WebGL2 on
  SwiftShader), the six passed in the three debug configurations: no pixel over the 24-level
  threshold in any of the 18 snapshots, 11 identical to the baseline, the rest at most 22 levels
  on a pixel. Before the change the drift didn't reproduce within the hour either (Phase 0 and
  Phase 2's "before" run, 70 minutes), so the run that would show it gone for good is one a day
  after a recording, like p614's: p615 Phase 7's `yarn verify:scenes` is the next. If the drift
  comes back there, open this again with the run's numbers.
