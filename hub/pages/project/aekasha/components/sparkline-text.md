## Sparkline

[What it is and its states](hub:features/ui-kit/library#sparkline), on the public page.

::: note For a later plan
p805 Phase 5 section 1: `data/graphs/Sparkline.ts`. p807 moved the profiler's Objects tab's "Over
time" onto it (three sparklines, `area`, 60 samples at the profiler's rate, the latest and the max
as text beside each), and its Phase 5 made a draw cheaper: each slot's x text made once, the
area's path taken from the line's.
A figure set every frame belongs on the time series (section 3), not here: the sparkline's
points are a string per update.
:::
