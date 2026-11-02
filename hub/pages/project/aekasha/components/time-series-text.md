## Time series

[What it is and its states](hub:features/ui-kit/library#time-series), on the public page.

::: note For a later plan
p805 Phase 5 section 3: `data/graphs/TimeSeries.ts` on `core/ThemeWatch.ts` (the colours read
again on a theme or density change) and `ChartScale.ts`' nice ceiling. Phase 0's renderer: a
shifted bitmap by whole device pixels, the new segments stroked; the whole drawn on a resize, a
rescale, a theme change, a resume or a show. p807's stats panels are made of it (a panel per
figure, pushed at 30 Hz, `summary: false`, `ticks: false`); "Time series under load" below is its
perf pass. Left (p807 Phase 5): after each draw it schedules one more animation frame, which finds
nothing at a rate under every frame.
:::
