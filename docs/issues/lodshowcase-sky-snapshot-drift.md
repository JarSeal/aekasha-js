**Title:** `lodShowcase`'s snapshot fails against a baseline recorded earlier: its clouds drift

Status: open
Category: Verify, Sky box
Found: 2026-10-13, p609 Phase 2 step 3 (`yarn verify:scenes` against the baselines recorded an hour earlier)
Our workaround: record the scene's baselines again right before a run that should compare it (`yarn verify:scenes --only lodShowcase --update`), and read a failure that differs only in the clouds as this issue

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
