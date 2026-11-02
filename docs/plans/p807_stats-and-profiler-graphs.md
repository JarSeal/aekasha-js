Status: in progress | Phases 0-4 implemented
Category: Debug, UI, Performance
Epic: p800_debugger-ui-overhaul.md
Related: \_DONE_p806_debugger-migration.md (D1: what it left here; its §4: what this plan can count on; Phase 6's "As built": the perf-auditor's findings and the debug chunks' sizes), \_DONE_p805_data-display.md (§4's p807 lines: the tables, bars, sparklines and the time series for the stats panels; Phase 5 section 3's time series figures; D14's "Debugger parity" box), \_DONE_p344_profiler-mega-window.md and \_DONE_p345_gpu-memory-and-draw-call-debugger.md (the profiler and GPU memory as built), p622_engine-6-major.md (the unreleased engine 6.0.0 entry this plan's changelog section may join: D2)

# Stats and Profiler Graphs

p800's seventh child: the on-screen stats panels and the profiler's live figures on the UI kit.
stats-gl goes if Phase 0's gate passes (our panels as accurate, no more costly per frame, and
the GPU timestamps with one owner); otherwise the plan records why and restyles stats-gl's panels
instead. The profiler's Overview, Objects and GPU memory tabs move from HTML strings to p805's
table, stacked bar, sparkline and list, so a refresh writes the changed figures instead of
rebuilding the tab (keeping the focus and the scroll). After this plan nothing in the debugger
draws its own HTML tables or SVG, and `Stats.scss`, the last debugger stylesheet off the tokens,
goes.

**The mantra (p800): USER FIRST.** For the developer: panels that measure what they say
(labelled, the same definitions as the profiler's rows), a click that opens the profiler from the
keyboard too, settings that apply without a reload, a profiler whose figures can be read and
navigated while they change. For the player: none of it ships (the debug modules fold, p607 D7).

---

## 1. As found (2026-11-01, `main` at `dc2b28ad`, engine 5.14.0)

### 1.1 Branches

- p806 merged into `main` (PR #73, `dc2b28ad`), not into `engine-6` as p800 §6 and p806 D2 had
  it: `engine-6` (`3adfac2b`) is an ancestor of `main`, and `main` carries p806's unreleased
  engine 6.0.0 work under `CHANGELOG.md`'s "Unreleased — engine-6" entry, with `package.json`
  still at engine 5.14.0, toolkit 2.2.1, app 1.18.0.
- Nothing this plan touches is a public type (§1.2): by p800 §6 it merges into `main`. D2 says
  what that means for the versions.

### 1.2 The stats panels (`debug/_dbg__Stats.ts` 433 lines, `Stats.ts` 112, `Stats.scss` 29)

- `stats-gl` 4.2.3 (dependency, used only here; 34.0 kB of the debug chunks, p806 Phase 6): FPS,
  CPU, GPU and CPT (compute) panels from stats-gl, PHY and TFPS added with `addPanel`, and the Hz
  readout (`trackHz`, stats-gl's vsync detection drawn over the CPU panel).
- It reaches into stats-gl's private fields (`fpsPanel`, `msPanel`, `gpuPanel`,
  `gpuPanelCompute`, `vsyncPanel`), always builds FPS and CPU and detaches the one switched off,
  reorders the canvases by hand (`applyPanelOrder`, `PANEL_ORDER`: TFPS, FPS, CPU, PHY, GPU, CPT,
  top to bottom, `column-reverse`), and moves the Hz canvas out of the flow with an inline
  `!important` (`positionVSyncOverlay`).
- `Stats.scss`: hex colours, a `grayscale` / `brightness` filter and `opacity: 0.45` over
  stats-gl's coloured canvases, `!important` on stats-gl's inline styles. The container has
  `DEBUGGER_ROOT_ATTR` but no theme or density (p806 D8 left it here).
- A click on the container opens the profiler when `openFromStatsPanels` is on: a `click`
  listener on a `div`, with a `title` and `cursor: pointer`. No keyboard path, no role.
- The Statistics tab (`createDebuggerTab`, `AEK_debugStats`): the panel toggles, Horizontal,
  "Track PHY" (a boot override, `setBootOverride`), the GPU memory button and the profiler folder.
  Every toggle but PHY's reloads the page (`RELOAD_NOTE`): the panels are built once, at boot.
- The main loop's calls (`kernel/loop/MainLoop.ts`): `getStats()?.update()` before
  `renderScene()`, `updateRestOfStats(renderer)` after the late loopers (which resolves the
  render and compute timestamps for stats-gl's GPU and CPT panels itself, and feeds TFPS),
  `startCustomMeasurements()`, `initStats()` in `initMainLoop`. PHY is fed by
  `features/physics/PhysicsStepStats.ts`' `updatePhysicsPanel`. The boot reads `getStatsCmp()`
  (`kernel/init/Boot.ts:244`).
- **What stats-gl measures** (Phase 0 step 2, read in `node_modules/stats-gl/dist/main.js` and
  `core.js`, 4.2.3, with three r186's `Renderer`, `Animation`, `Backend` and
  `WebGPUTimestampQueryPool`). The engine's renderer is a `WebGPURenderer` on either backend, so
  stats-gl takes its `handleWebGPURenderer` path on both:
  - **CPU:** stats-gl patches `renderer.info.reset` to start its clock (`beginProfiling`), and
    `update()` stops it (`endProfiling`). three calls `info.reset()` in its own animation loop
    (`Animation.start`'s `requestAnimationFrame` callback, `info.autoReset`), a second rAF beside
    the main loop's, and the main loop calls `update()` before `renderScene()`. So stats-gl's
    "CPU" is from three's rAF callback to the main loop's pre-render work's end: the render's
    submission left out, and what runs between the two callbacks (another rAF's work) in. Not
    the main loop's CPU time, which the frame probe measures (`runFrame` from its start to its
    end, the render included).
  - **GPU and CPT:** `processWebGPUTimestamps` reads `info.render.timestamp` and
    `info.compute.timestamp`, which three's `Backend.resolveTimestampsAsync` writes with the
    pool's total for the last frame of the batch it resolved (`framesDuration` keyed by the
    uids' `:f<frame>`). stats-gl resolves nothing itself on this path: `updateRestOfStats`
    resolves RENDER and COMPUTE for it every frame, which is what takes the batches from
    `_dbg__GPUTimer.ts`' listeners. Whichever resolver ran last sets the figure.
  - **FPS:** the count of `update()` calls in the last second (`frameTimes`, `push` and `shift`),
    a whole number, averaged over the last 40 updates (`samplesLog`) and shown smoothed
    (`0.7 · shown + 0.3 · new`) at 4 Hz.
  - **Hz:** the mean of the last 120 frame intervals matched to 60, 75, 90, 120, 144, 165 or
    240 Hz when their deviation is at most 2 ms and the match within 5 %; else none.
  - **Per frame it allocates:** `Math.max(...logs)` (40 arguments) and
    `averageArray.graph.slice(-samplesGraph)` per panel, `String(panel.id)`, the arrays' `shift`,
    and the Hz history's `reduce` (no allocation, 120 reads).
- No engine code dispatches compute (`renderer.compute` / `computeAsync` appear only in
  `_dbg__GPUTimer.ts`' tap), so the CPT panel reads 0 in every scene; D3's CPT check needs a
  scratch compute pass.
- Every `Stats` export is `@internal` (`StatsOptions`, `initStats`, `getStats`, …); the public
  `registerStatsSource` and `StatsSource` (`aekasha/debug`) are the profiler's and don't change.

### 1.3 GPU timing

- `debug/_dbg__GPUTimer.ts` (222): one render context tap (an `InspectorBase` forwarding to the
  previous inspector), one resolve at a time handed to every listener, holders refcounted. RENDER
  timestamps only.
- Its users: the profiler's GPU frame time (`profiler/_dbg__ProfilerSources.ts`: a record per
  frame of its render contexts, summed once a resolved batch has them all, a pool of 10 records,
  a record dropped after 8 frames), the PostFX profiler (`features/postfx/debug/_dbg__PostFXProfiler.ts`)
  and the sky box's bake stats (`features/skybox/debug/_dbg__BakeStats.ts`).
- stats-gl's GPU and CPT panels resolve on their own (`updateRestOfStats`), which replaces the
  pool's batch: four files carry a comment and a retry for "a batch another resolver took (eg.
  the stats-gl GPU panel's)" (the three users above and `_dbg__GPUTimer.ts`' header), and
  `_releaseGpuTimer` can't see that stats-gl switched `trackTimestamp` on.
- Compute timestamps (CPT) have no owner but stats-gl.

### 1.4 The profiler's content (`debug/profiler/`, `debug/gpuMemory/`)

p805 §4.1's census, rechecked by file: every table is an HTML string through `CMP({ html })`,
rebuilt whole on each refresh (the profiler's rate: 1, 2, 4 or 10 Hz; GPU memory 500 ms).

- **Overview** (`_dbg__ProfilerOverview.ts` 621): one table, label `<th>`, value, sub line and an
  action button per row (`data-metric`, one click handler), an "App" `<tbody>` for the app's
  sources, `isNA` / `isWarn` row classes; 14 rows by default.
- **Objects** (`_dbg__ProfilerObjects.ts` 533): the "Bars" measure switch (HTML buttons), the
  by-kind and by-owner breakdowns (one template, a two-segment bar per row, a Total row in the
  body), the ECS worlds table, the component types' key-value grid, the heaviest objects (rank,
  object, kind, triangles, instances, an Edit button opening the entity's window), the "Over
  time" SVG sparklines (`renderSparkline`, three series).
- **GPU memory** (`gpuMemory/_dbg__GPUMemory.ts` 593): the total, the budget bar (a `div` fill),
  nine tables (categories, peaks, frame, sources, by owner with a two-level hierarchy, untracked,
  and the snapshot's three diffs with "+N more" `colspan` rows), headings and notes. Its
  Tweakpane sections were ported by p806 (kit fields and buttons).
- p806 Phase 6: each empty `<th>` holds its name as hidden text (axe 0); the `debugger`
  configuration masks the Overview's figures ("p807 rewrites that tab",
  `devTools/verify/scenes.config.ts`).
- The dev component library's "Debugger parity" box (`hub/_assets/ts/_library/parity.ts`,
  `parityTables.ts`) shows each of these shapes built from the kit: the profiler's 4 tables, GPU
  memory's 9, the budget bar, the sparklines, the component types' list.

### 1.5 What p805 and p806 leave ready

- `createTimeSeries` (p805 D9): a canvas shifted by whole pixels, no allocation per push or draw,
  `summary: false` for a panel showing its own figure; about 0.3 ms a frame for 8 panels at DPR 2
  in Chromium (p805 Phase 5 section 3).
- `createTable` (`setCell` writes one text node; `setRows` keeps rows by key; groups, a footer,
  `kind: 'bar'` cells, a `cell` renderer, `captionHidden`), `createStackedBar`, `createSparkline`
  (`area`), `createList` (static, `suffix`), `createSegmentedControl`.
- The profiler window's shell on `createTabs`, each tab's `ctx.scheduler`, `keepOnSceneChange`,
  `getDebuggerRootProps()` for a debugger root's theme and density, the `debugger` scene runner
  configuration with shots of every profiler tab.
- p806 Phase 6's perf-auditor findings left as "candidates for p807's pass, which reworks the live
  figures": the Physics tab's 500 ms poll allocating per body (`getPhysicsEntitiesListData`,
  `refreshTiersReadout` with its folder shut), the character window's `OTHER` rows'
  `JSON.stringify` and vector text, the light window's managed colour string.

---

## 2. Decisions (decided 2026-11-01: the user took every recommendation)

### D1. Scope

- **In:**
  - Phase 0's gate (D3) and, by its verdict, our stats panels (D4) or stats-gl's restyle.
  - GPU timing with one owner, compute included (D5).
  - The profiler's Overview, Objects and GPU memory content on the kit (D6-D8), updated in place
    (D9).
  - `stats-gl` out of `package.json` and every comment about its resolver (if the gate passes);
    `Stats.scss` gone either way (a CSS module on the tokens).
  - The dev library's "Debugger parity" box, whose last rows this plan ports (D11).
  - The perf-auditor's pass over the new live figures, and p806's three leftover findings (§1.5,
    decided in scope),
    each fixed when a profile shows it, else recorded as measured and left.
- **Out:**
  - New profiler figures or tabs (a stats source an app registers keeps working as it is).
  - The Settings tab (p806 ported it), the 3D debug drawing.
  - A public stats panel API: the panels stay the debugger's (`@internal`). An app that wants a
    frame graph in its HUD uses `createTimeSeries` (the Hub shows how, D11).

### D2. Branch and versions

- **Branch:** `p807-stats-and-profiler-graphs` from `main` (p806 is there, §1.1). No public type
  changes (§1.2), so `main` is its target (p800 §6).
- **Versions (decided):** `main` now holds unreleased engine 6.0.0 work, so a 5.x bump on top of
  it would misstate what `main` is. This plan's changelog sections join the "Unreleased —
  engine-6" entry (Engine, App if the app changes, Project), with no bump here, as p806 did; the
  bump is the one p622 makes. So `yarn checkVersions --against main` fails at the PR as p806's
  did (engine files changed, version unchanged), on purpose. (Not taken: a 5.15.0 entry and bump
  of its own, which would date p806's breaking changes under a minor.) p806's merge into `main`
  was intended.
- p800 §6's table row and §5's p807 entry are updated in Phase 0 to say where p807 merged and
  why.

### D3. The gate (Phase 0)

Our figures against stats-gl's, both on in the same run reading the same frames, before anything
is removed. In two parts (decided in Phase 0, so nothing is written twice): **part A** in Phase 0
compares the sources our panels would read (the frame probe, the profiler's GPU frame time) with
stats-gl's figures, the timestamp coverage and stats-gl's own cost; **part B** checks what needs
this plan's code while stats-gl is still in place: CPT in Phase 1 (D5's compute side), our panels'
cost in Phase 2 section 1 against part A's stats-gl figures, before section 3 removes stats-gl.

- **What's compared, per panel:**
  - **FPS:** rendered frames per second. Ours from the frame probe's intervals
    (`_dbg__FrameProbe.ts`). Pass: within 1 FPS of stats-gl's at a steady rate.
  - **CPU:** stats-gl's span is read from its source first (§1.2). Ours is the main loop's CPU
    time per rendered frame (the frame probe's `cpuTimes`: the Overview's "Main loop CPU" row),
    labelled so (Phase 0: the panel's label is "CPU", its tooltip "Main loop CPU per frame, the
    render's submission included"). When the two spans differ by definition, the gate compares ours with a
    `performance.now()` pair around the same span and records stats-gl's as measuring something
    else; the panel's label and tooltip say what it spans.
  - **GPU:** ours through `_dbg__GPUTimer` (every render context of the frame summed, the
    profiler's GPU row) against stats-gl's render timestamps. Pass: within 10 % or 0.1 ms
    (whichever is larger) on WebGPU. On WebGL, where three's pool times one context at a time
    (`_getGpuTimerSupport`), the gate records what each shows. (Phase 0: stats-gl shows a figure
    there and ours none, so Phase 1 adds a WebGL path, checked against stats-gl's in part B; n/a
    with its reason only where a frame's contexts nest.)
  - **CPT** (part B, Phase 1): compute timestamps (D5) against stats-gl's, on a scratch compute
    pass dispatched each frame (no scene dispatches compute, §1.2).
  - **Hz:** the display's refresh rate from the frame intervals (the nearest common rate to the
    shortest steady interval) against stats-gl's detection.
  - **PHY, TFPS:** already ours; carried over as they are, their figures unchanged.
- **Cost:** p806's method (`.cache/p806/measure.mts`: main-thread ms per second, three 10 s
  windows, `yarn verify:scenes`' Windows Chrome on the real GPU), each panel set on: none,
  stats-gl's default three (TFPS, FPS, CPU) and all six (part A); ours the same (part B). Pass:
  ours within the noise of stats-gl's or below it, and nothing allocated per frame in a sampling
  heap profile (stats-gl's bytes per second recorded in part A).
- **The timestamp budget:** with the GPU panel, the Overview's GPU row and the PostFX profiler all
  on, count the GPU frame records dropped (`GPU_MAX_PENDING_FRAMES`) and the PostFX profiler's
  retries. Pass: none dropped with ours (one resolver), against what stats-gl causes.
- **Where:** three scenes (a quiet one, the gym, a heavy one such as `lodShowcase` or `space`),
  WebGPU and WebGL 2 (the renderer's saved `forceWebGL` in the same Windows Chrome, so both on the
  real GPU; the runner's `--webgl` is SwiftShader, whose GPU times mean nothing), DPR 1 and 2.
- **Verdict:** part A passing lets Phase 1 start; part B's failure stops before stats-gl is
  removed. All of the above pass, or the plan records which failed and why, and Phase 2 is
  stats-gl's restyle instead: its colours from the tokens (its `Panel` takes colours), the filter
  and `!important`s gone, the container a debugger root with a real button for the profiler.

### D4. Our stats panels (if the gate passes)

- **One debugger root** in the bottom-left corner as today (`getDebuggerRootProps()`: the
  debugger's theme and the compact density, `KEEP_IN_VIEWS_CLASS`), a CSS module on the tokens
  (`Stats.module.scss`) in place of `Stats.scss`, its background `surface` at 80 % as the
  on-screen tools' (so it reads over any scene, p806 D7).
- **A panel per figure**, in `PANEL_ORDER` (vertical, the default, or a row with Horizontal): its
  label (`FPS`, `CPU ms`, …, the unit said), its figure (one text node written at 4 Hz, tabular
  figures), the window's min and max as small text, and a time series of the figure
  (`createTimeSeries` with `summary: false` and `ticks: false`; `push`, nothing allocated).
  Phase 0's cost bar (stats-gl's, about 0.08 ms a frame for three panels) is under p805's figure
  for its time series (8 panels at DPR 2 about 0.3 ms a frame), so the graphs push at stats-gl's
  30 Hz (each sample the worst frame since the last, so a spike still shows) unless Phase 2's
  measure says every frame costs no more. The line is the
  muted text colour: no accent (p800 D6), the status colours only for a threshold that says so in
  text (eg. TFPS under the target).
- **Accessibility:** the graphs are `aria-hidden` (the time series' own deviation, p800 D8); the
  figures are text (not live: they change 4 times a second). With `openFromStatsPanels` on, the
  root is a `<button>` "Open the profiler" holding the panels (a keyboard path, a focus ring, the
  F8 hint in its tooltip); off, a `role="group"` named "Frame statistics".
- **Settings apply live:** each panel toggle, Horizontal and the GPU and CPT tracking build or
  remove their panel at once (the GPU timer held only while a GPU panel exists, D5); the "(reloads
  the app)" note goes. PHY stays a boot setting (physics' step stats are configured at boot) and
  keeps its note. `AEK_debugStats` loads unchanged (`persistKeys` the same).
- **The main loop's calls:** `getStats()?.update()` and stats-gl's resolves go; the panels read
  the frame probe and the GPU frame results (D5) in one `LATE_MAIN` step (draw calls and
  timestamps are read after the render, p805 §4). `startCustomMeasurements` /
  `updateRestOfStats` keep their names if TFPS still needs them.
- Phase 2 section 1 settles the sizes (a panel's width and the time series' capacity: one
  sample per CSS px is the start) with a shot for review.

### D5. GPU timing has one owner

- The per-frame GPU record (the render contexts opened between two frames, summed once
  resolved) moves out of `_dbg__ProfilerSources.ts` into `debug/_dbg__GPUFrameTimes.ts`, holder
  counted, with a listener per resolved frame: the Overview's GPU row and the GPU panel read the
  same results.
- `_dbg__GPUTimer.ts` gains COMPUTE: its tap reports compute contexts (`beginCompute`), and the
  resolve takes both pools in one request (one at a time, as now); the CPT panel is a
  `_dbg__GPUFrameTimes.ts` holder of the compute side.
- With stats-gl gone, the "another resolver took the batch" retries stay (they are harmless and
  an app's own resolve can still take a batch), but their comments name an app's resolve, not
  stats-gl. `_releaseGpuTimer`'s note about stats-gl's `trackTimestamp` goes.

### D6. The Overview on `createTable`

- One table, `captionHidden` "Overview", columns Metric (row header), Value, Detail and an action
  column (header text hidden, as p806 did), rows keyed by metric id, built once at the tab's
  mount; a refresh is `setCell` on the figures that changed (no rebuild: the focus on a row's
  button and the scroll stay).
- The app's sources are a table group ("App"). `isWarn` is the value cell's `tone: 'warning'`
  with its word; `isNA` a muted "n/a" with its reason as the cell's text, not a colour alone.
- The row actions are a `cell` button, one per row that has one; the click handler by
  `data-metric` goes. The Settings tab's reorder (`overviewMetrics`) changes the rows with
  `setRows` (kept by key).
- The scene runner's mask on the Overview's figures stays (they change by frame), applied to the
  table's value cells.

### D7. Objects on the kit

- The "Bars" measure switch: `createSegmentedControl` (objects, triangles, vertices).
- The by-kind and by-owner breakdowns: `createTable` with `kind: 'bar'` (in view against culled)
  and the Total as the footer row; the name and its dimmed sub line a `cell` renderer.
- The ECS worlds: a table with column labels (it has none today); the component types: a static
  `createList` with each count as the row's `suffix`.
- The heaviest objects: a table, the Edit button a `cell` button opening the entity's window
  (`registerEntityWindowOpener`'s, as now).
- "Over time": three `createSparkline({ area: true, min: 0 })` with the latest and the max as text
  beside each (p805 §4).

### D8. GPU memory on the kit

- The budget bar: `createStackedBar` of one part against the budget (`data-over` past it, the
  text beside it kept).
- The nine tables: `createTable`, keyed by category, owner, source, asset or allocation; the
  two-line cells a `cell` renderer; the "+N more" rows the footer; the by-owner hierarchy a
  `cell` renderer with the rows unsorted (p805 D1: no treegrid); the frame table's "(main loop
  paused)" and the asset diff's counts on a line beside their table (a caption is fixed at
  creation).
- The headings and notes stay paragraphs on the tokens. `GPUMemory.module.scss` keeps only the
  layout.

### D9. Updated in place

- Each tab's sections are built once in `content(ctx)` (the tables on `ctx.scheduler`) and its
  `onRefresh` writes the figures (`setCell`, `setRows`, `setParts`, a sparkline's `setValues`).
  No `CMP({ html })` is rebuilt per refresh. A row's focus, a sort the user picked and the scroll
  survive a refresh, which the strings lost.
- The three tabs keep across a scene change (`keepOnSceneChange`, their `onSceneChange` clearing
  what's scene-bound: the census' history, a snapshot's diff stays).
- The profiler's rate (1-10 Hz) and GPU memory's 500 ms stay.

### D10. Removals

- If the gate passes: `stats-gl` from `package.json` and `yarn.lock`, `getStats` /
  `_getStats` and the stats-gl types, `StatsOptions`' stats-gl-only fields (`logsPerSecond`,
  `graphsPerSecond`, `samplesLog`, `samplesGraph`, `precision`, `mode`), the readme's credit, and
  the stats-gl comments in `OnScreenTools.module.scss`, `_dbg__PostFXProfiler.ts`,
  `_dbg__BakeStats.ts`, `_dbg__ProfilerSources.ts` and `_dbg__GPUTimer.ts`. The About dialog lists
  `dependencies` by itself.
- Either way: `Stats.scss`; the profiler's and GPU memory's HTML table builders, `renderSparkline`,
  `escapeProfilerHtml` once nothing writes HTML; the table rules in `Profiler.module.scss` and
  `GPUMemory.module.scss` the kit's table replaces.

### D11. Checks and docs

- **Tests:** the panels' module (built from the settings, a toggle adding and removing a panel
  live, the order and the orientation, the button with the setting, nothing per frame but the
  pushes and the 4 Hz text), `_dbg__GPUFrameTimes.ts` (records, sums, a missing uid, the pool, a
  holder's release), the compute side of `_dbg__GPUTimer.ts`, the Overview's rows (`setCell`
  only for a changed figure, the app group, the reorder), and the existing
  `_dbg__ProfilerOverview.test.ts` / `GPUMemory.test.ts` kept passing.
- **The scene runner:** the `debugger` configuration's profiler shots changed on purpose, before
  and after shown for review; the stats panels in a shot of their own (their figures masked);
  axe 0 on every root.
- **Size:** the debug chunks measured as p806 did (`.cache/p806/debugChunks.mts`): stats-gl's
  34.0 kB minified gone, ours added; production's `yarn sbp --profile all` and
  `yarn verify:baselines` unchanged (no debug code ships).
- **Docs:** the Hub's debug suite page (the stats panels, what each figure spans, the live
  settings; the profiler's tabs), the UI kit's time series section a "frame graph in your HUD"
  example if it has none (decided: no example scene, the panels and the profiler being the
  debugger's), the dev library's "Debugger parity" box removed (its rows are ported),
  `src/_engine/debug/CLAUDE.md` (the stats panels, the GPU timer's one owner, the profiler's
  tables; `Stats.scss`' line), `readme.md`'s credits, p800 §5.

---

## 3. Phases

Branch `p807-stats-and-profiler-graphs` from `main` (D2). Every phase is verified with `yarn test`,
`yarn verify:scenes` (baselines recorded on `main` before the first run; the `debugger`
configuration), `yarn verify:baselines`, `yarn verify:ui` where the kit changed and
`yarn sbp --profile all`, plus the phase's own checks. Each phase stops after each section for
review.

### Phase 0: grounding and the gate — done

1. **Baselines:** `yarn verify:scenes --config all --update` on `main` (`dc2b28ad`), then the
   branch; `yarn sbp --profile all` and the debug chunks' sizes (p806's script copied to
   `.cache/p807/`).
2. **stats-gl read:** what each of its panels spans and when it samples, its GPU paths on WebGPU
   and WebGL, its per-frame allocations, written into §1.2.
3. **The gate's part A** (`.cache/p807/gate.mts`, scratch): D3's comparisons of the sources,
   the coverage, stats-gl's cost and allocation, on its scenes and backends; the figures and the
   verdict written into this plan.
4. p800 §5 / §6 updated with D2's outcome.

As built (2026-11-01, `p807-stats-and-profiler-graphs` at `d5ab9bc4`, its `src/` `main`'s `dc2b28ad`):

- **Baselines:** the scene runner's 110 runs recorded on `main` (`--config all --update`,
  687 s, WebGPU in the Windows Chrome); `yarn sbp --profile all` and the debug chunks
  (`.cache/p807/debugChunks.mts`, p806's script copied, after `yarn build:test`) in
  `.cache/p807/debugChunks-phase0.json` and `.cache/sbp/`: first downloads app 384.4, banner
  287.4, uiKit 286.6 kB gzip, every budget within (the app group's "well under" note was there
  before); the debug chunks 53 files, 512.5 kB, 205.1 kB gzip, stats-gl 34.0 kB minified,
  `_dbg__Stats` 10.9 kB gzip (38.5 kB).
- **stats-gl read:** §1.2's "What stats-gl measures".
- **p800:** §5's p806 entry says it merged into `main`; §5's p807 entry and §6's table row and
  last paragraph say p807 branches from `main` and joins the unreleased `engine-6` entry.
- **The gate's part A** (`.cache/p807/gate.mts`; `gate-<scene>-<backend>-dpr<n>.json`,
  `summary.mts` prints them): `exampleQuickStart` (quiet), `thirdPersonGymScene` (DPR 1 and 2)
  and `lodShowcase` (heavy), WebGPU and WebGL 2 in the Windows Chrome on the real GPU (the
  display at 132 Hz), 10 s per measure, stats-gl's figures read from its averages beside ours
  every 250 ms. No page error anywhere. The CPT check is part B (Phase 1): no scene dispatches
  compute, so both read 0.

  | Scene, backend       | FPS ours / sgl | CPU ours / sgl (its span) | GPU ours / sgl | Cost none / 3 / 6 panels (ms/s) | Loop CPU +3 / +6 | sgl allocates |
  | -------------------- | -------------- | ------------------------- | -------------- | ------------------------------- | ---------------- | ------------- |
  | quickStart, WebGPU   | 132.1 / 132.6  | 0.37 / 0.04 (0.03)        | 0.11 / 0.11    | 58.2 / 65.0 / 75.6              | 0.03 / 0.06      | 1.11 MB/s     |
  | gym, WebGPU          | 132.8 / 133.3  | 0.94 / 0.12 (0.12)        | 0.94 / 0.94    | 130.3 / 143.6 / 149.9           | 0.07 / 0.08      | 1.05 MB/s     |
  | gym, WebGPU, DPR 2   | 131.8 / 132.3  | 0.95 / 0.12 (0.12)        | 2.22 / 2.22    | 129.2 / 141.6 / 155.3           | 0.08 / 0.12      | 1.20 MB/s     |
  | lodShowcase, WebGPU  | 136.0 / 134.8  | 1.00 / 0.07 (0.07)        | 0.29 / 0.29    | 129.4 / 145.3 / 152.1           | 0.08 / 0.14      | 0.94 MB/s     |
  | quickStart, WebGL 2  | 131.9 / 132.4  | 0.28 / 0.03 (0.03)        | n/a / 0.47     | 40.3 / 47.1 / 58.1              | 0.03 / 0.06      | 1.19 MB/s     |
  | gym, WebGL 2         | 132.4 / 132.8  | 0.91 / 0.11 (0.11)        | n/a / 0.85     | 114.1 / 125.4 / 135.6           | 0.06 / 0.09      | 1.05 MB/s     |
  | lodShowcase, WebGL 2 | 132.5 / 132.9  | 0.94 / 0.06 (0.06)        | n/a / 2.81     | 123.1 / 131.0 / 140.1           | 0.02 / 0.09      | 1.03 MB/s     |

  Cost is main-thread task ms per second, the mean of three windows; 3 panels is stats-gl's
  default set (TFPS, FPS, CPU), 6 adds GPU, CPT and Hz. Loop CPU is the frame probe's ms a frame
  over none. Allocation is the sampling heap profiler with the collected objects, stats-gl's code
  only, all panels on (the page allocates 5-24 MB/s in all).

  **Verdict: part A passes, with findings that change the plan.**

  1. **FPS** agrees within 0.5 everywhere but `lodShowcase` on WebGPU (1.3, 1 %: its LODs still
     settling, the two averaging over different windows). Pass.
  2. **CPU:** stats-gl's figure is exactly the span §1.2 read (its value and the span measured
     beside it agree to 0.01 ms), 7-15 % of the main loop's CPU: it leaves the render's
     submission out. Not a mismatch to fix but a figure that misleads; ours shows the main loop's
     CPU with D3's label.
  3. **GPU on WebGPU:** identical to 0.01 ms in every scene and at DPR 2. **On WebGL 2, stats-gl
     shows a figure and ours reads n/a** (the profiler's GPU source is WebGPU only,
     `_getGpuTimerSupport`): as it is, the GPU panel would lose WebGL. So Phase 1 (part B) gives
     D5's frame times a WebGL path and checks it against stats-gl's figures above.
  4. **The timestamp budget:** our GPU records resolved for 99-100 % of the rendered frames with
     stats-gl's resolves on and off: in these scenes stats-gl's resolves don't take our batches
     (three's pool shares a resolve in flight). One resolver (D5) is a cleanup, and what makes
     compute and WebGL timing one module's, not a fix of dropped figures.
  5. **Hz:** stats-gl detected nothing on this 132 Hz display (not in its list of rates), so its
     readout stayed empty; ours reads the rate from the frame intervals.
  6. **Cost, part B's bar:** stats-gl's three panels cost 7-16 ms/s of main-thread time (about
     0.08 ms a frame at 132 Hz) and its six 15-26 ms/s, with 1 MB/s allocated (about 8 KB a
     frame). Ours must stay within that and allocate nothing per frame (D4's 30 Hz graphs).

### Phase 1: one owner for GPU timing — done

D5, with stats-gl still in place (its resolves still steal batches until Phase 2; the retries
cover it): `_dbg__GPUFrameTimes.ts`, the compute side, a WebGL path (Phase 0's finding 3: the
timestamps' uids summed per frame as on WebGPU when no context nests, else the pool's frame
totals; the Overview's GPU row gains WebGL with it), the Overview's GPU row on it, the tests.
Non-breaking: the Overview's GPU figure unchanged (checked against Phase 0's run). The gate's CPT
check (part B) on a scratch compute pass.

As built (2026-11-02; two sections: the code and its tests, `eff8d363`, then the gate's part B):

- **The WebGL path needs no frame totals.** three r186's WebGL pool begins a context's query only
  when none is active (`beginQuery`) and resolves only the `'ended'` ones, so a context opened
  inside another (the scene pass inside PostFX's composite) has no query, and its GPU time is in
  the outer context's. The sum of a frame's started contexts is its whole GPU time (and what the
  pool's own frame total, stats-gl's figure, adds up), nested or not: `_keepTimedUids` drops the
  uids whose query stayed `'inactive'` when the frame closes, and the record sums the rest as on
  WebGPU. No "pool's frame totals" fallback.
- **`_dbg__GPUTimer.ts`:** the tap reports compute contexts (`_onComputeContext`); one resolve
  request takes the render pool and, once it exists, the compute pool (`Promise.all`); the
  listeners get `(render, compute)` (the PostFX profiler and the bake stats read the first only,
  unchanged); `_keepTimedUids(uids)` (in place, a no-op on WebGPU). Handing only a new batch to
  the listeners was tried and left out: with another resolver taking every batch, the PostFX
  profiler's pending frames would stop ageing and grow; every batch is handed, as before.
- **`debug/_dbg__GPUFrameTimes.ts`** (D5): `_acquireGpuFrameTimes('RENDER' | 'COMPUTE')` (true,
  false without timestamp queries, null without a renderer; holder counted per side, the first
  hold of either takes the GPU timer), `_releaseGpuFrameTimes(side)`, `_onGpuFrameTime(listener)`
  (a reused `{ renderMs, computeMs }`, null for a side nobody holds, `computeMs` 0 for a frame
  without a dispatch), `_getGpuFrameTimesCounts()` (completed and dropped, for the tests and the
  gate). It closes the frames itself: its own `LATE_MAIN` system at order -10000 and an
  `'AFTER_RENDER'` view frame listener, as the profiler's sampler. A record completes once a
  batch has every uid of the held sides; the pool of 10 records and the 8 batches a record waits
  are the profiler's figures, moved.
- **The profiler:** the GPU frame source is a RENDER holder (`_dbg__ProfilerSources.ts` lost its
  records and the sampler's `gpu` flag); its availability is "no GPU timer queries" in place of
  "WebGPU with timestamp queries only", so the Overview's GPU and TFPS rows read WebGL too.
- **Tests:** `_dbg__GPUFrameTimes.test.ts` (8, a fake renderer and pools): nothing held without a
  renderer or timestamps, a frame's contexts summed, a missing uid waiting then dropped after 8
  batches, the pool dropping its oldest (the open record and 9 pending), the compute side without
  and with its pool, the timer kept while either side is held, the WebGL rule.
- **Not changed:** the PostFX profiler and the bake stats keep their own records (D5 moves only
  the frame record); on WebGL they could time their outer contexts with `_keepTimedUids`, left
  out. `debug/CLAUDE.md`'s profiler line ("GPU frame time through `_dbg__GPUTimer`") is Phase 6's
  (D11).
- **The gate's part B** (`.cache/p807/gate.mts --tag p1 --only accuracy,coverage,cpt`, run by
  `runB.sh`, `summaryB.mts` prints `gate-p1-*.json` beside Phase 0's): Phase 0's seven
  configurations in the Windows Chrome on the real GPU (the display at 143 Hz this time), 10 s a
  measure. CPT: a scratch compute kernel (2^20 invocations of a 512-step `sin` loop, TSL from the
  page's own three) dispatched in `MAIN` every frame, our COMPUTE side beside stats-gl's CPT
  panel. No page error anywhere.

  | Scene, backend      | GPU ours P0 / P1 / sgl | GPU frames resolved | Dropped / completed | CPT ours / sgl | CPT frames/s |
  | ------------------- | ---------------------- | ------------------- | ------------------- | -------------- | ------------ |
  | quickStart, WebGPU  | 0.11 / 0.11 / 0.11     | 100 %               | 0 / 1395            | 0.33 / 0.33    | 140          |
  | gym, WebGPU         | 0.94 / 0.95 / 0.95     | 100 %               | 0 / 1391            | 0.33 / 0.33    | 139          |
  | gym, WebGPU, DPR 2  | 2.22 / 2.25 / 2.25     | 100 %               | 0 / 1384            | 0.33 / 0.33    | 136          |
  | lodShowcase, WebGPU | 0.29 / 0.28 / 0.28     | 98 %                | 0 / 1305            | 0.33 / 0.33    | 139          |
  | quickStart, WebGL 2 | n/a / 0.47 / 0.45      | 73 %                | 374 / 1015          | 1.04 / 1.04    | 67           |
  | gym, WebGL 2        | n/a / 0.82 / 0.82      | 65 %                | 483 / 908           | 1.04 / 1.04    | 29           |
  | lodShowcase, WebGL 2| n/a / 2.60 / 2.54      | 65 %                | 487 / 902           | 1.04 / 1.04    | 34           |

  GPU and CPT in ms per frame (P0: Phase 0's run, P1: this one, sgl: stats-gl in the same run);
  frames resolved is the share of rendered frames with a GPU figure; dropped / completed counts
  the accuracy run's records.

  **Verdict: part B's Phase 1 checks pass.** The Overview's GPU figure is unchanged on WebGPU
  and equals stats-gl's to 0.01 ms; on WebGL ours now reads within 0.06 ms of stats-gl's (D3's
  10 % / 0.1 ms); CPT equals stats-gl's on both backends. Findings for Phase 2:

  1. **WebGL resolves 65-73 % of the frames**, about the same with stats-gl's resolves on or off
     (64-73 %): three's WebGL pool clears its offsets when a resolve ends, so the queries opened
     while one was in flight (it polls each query until available) are lost. Each figure is
     still a whole frame's; a 1 s window has 90+ of them.
  2. **WebGL with both sides held resolves fewer frames** (29-67 a second): a record needs its
     render and compute uids, each pool loses its own. Enough for a 4 Hz panel; if the CPT
     panel's graph needs more, Phase 2 can complete each side of a record on its own.
  3. With the scratch compute on, WebGPU dropped 0-11 records in about 1650 (its first frames'
     compile).

- **Verified:** `yarn test` (265 files), `tsc`, lint, the docs ratchet; `yarn verify:baselines`
  and `yarn sbp --profile all` unchanged; `yarn verify:scenes --config all` 109 of 110 against
  Phase 0's baselines. The one failure is old: `testDebugScene`'s `profiler.gpuMemory` shot
  (0.12 % changed) differs only in the peak table's "Reached" cells, a wall-clock time
  (`toLocaleTimeString`) that `DEBUGGER_LIVE_MASKS` doesn't mask, so the shot passes or fails by
  how wide the time's digits come out. Phase 4, which rebuilds that table, masks those cells.

### Phase 2: the stats panels — done

D4 (or D3's restyle on a failed gate), in sections:

1. The panels, their module stylesheet, the main loop's calls, the tests; D4's sizes with a shot
   for review; the gate's cost check (part B) against Phase 0's stats-gl figures.
2. The Statistics tab's live settings, the button to the profiler, `AEK_debugStats` loading.
3. D10's removals (stats-gl, its comments, `Stats.scss`), the About dialog checked.

As built, section 1 (2026-11-02, not committed):

- **`debug/_dbg__StatsPanels.ts`** (the root, the panels, the frame step; `_createStatsPanels`,
  `_removeStatsPanels`, `_onStatsFrameStart`, `_onStatsFrameEnd`, `_recordPhysicsStep`) and
  **`Stats.module.scss`**; `_dbg__Stats.ts` keeps the init and the Statistics tab and no longer
  imports stats-gl. The package, `Stats.scss` (no longer imported) and the stats-gl comments
  elsewhere are section 3's. `getStats` / `_getStats` went now, not in section 3: their one caller,
  the main loop's `update()`, went with the panels (D4).
- **The frame step is `startCustomMeasurements` / `updateRestOfStats`**, not a `LATE_MAIN`
  system: `LATE_MAIN` doesn't run in an editor view, where the panels show (`KEEP_IN_VIEWS_CLASS`);
  `updateRestOfStats()` (it lost its renderer parameter) runs at every rendered frame's end in
  every view, after the render and the late loopers.
- **The figures:** FPS and CPU from the frame probe's summary (held while either panel exists:
  the Overview's rows); GPU and CPT as `_dbg__GPUFrameTimes` holders, their mean over 1 s by the
  profiler's `SampleWindow` (its GPU row); PHY the last step; TFPS unchanged (1000 / the mean
  logic span of the last 60 frames). No GPU or CPT panel without timestamp queries (as before).
  **Hz moved to the FPS panel** (a line beside its range; the toggle now needs FPS: "Track Hz
  (shown in the FPS panel)"): the lower quartile of the last 120 animation frame intervals (the
  limiter's skipped frames included), matched to a common rate within 3 %, else as measured (the
  143 Hz display reads 144 Hz, a 132 Hz one 132).
- **The graphs and the range:** a sample every 33 ms, the worst frame since the last (FPS the
  longest interval's); the small text is the graph's lowest and highest sample (its 96 samples,
  3.2 s), so it shows the load's hitches until they scroll out. The CPU graph's per-frame span is
  the rendered frame's (the frame probe also adds the limiter's skipped frames' CPU: the two differ
  only with `VITE_MAX_FPS`).
- **Labels:** "CPU" with a muted "ms" after the figure (D3's label and D4's unit); each panel's
  tooltip says what it spans. No threshold line (no TFPS target is defined).
- **Sizes:** a panel `--aek-space-7` × 4 wide (96 px compact: one graph sample per CSS px), its
  graph `--aek-space-7` tall with a 1 px line in `text-muted`; six panels make the root 103 × 336 px
  vertical (stats-gl's 90 × 288) and 643 × 59 horizontal. Shots: `.cache/p807/phase2-s1/` (both
  debugger themes, vertical, horizontal, the default three; `panelsShot.mts`). At 1280 px the
  horizontal row reaches under the bottom-centre switch tools (stats-gl's 560 px row did too).
- The root's CMP id `_statsContainer` isn't written to the element (as before): scripts select
  `.statsContainer`, which the on-screen tools' click-through rule also reads.
- **Tests:** `_dbg__StatsPanels.test.ts` (10): the panels in order, the group and orientation,
  the holds and their release, no GPU / CPT panel without timestamps, the figures at 4 Hz from
  the probe in the same text node, the 30 Hz pushes taking the worst frame, TFPS' 60 frames, the
  GPU and compute means, PHY with its gap, the refresh rate matched and as measured, nothing
  measured without panels.
- **The gate's part B, cost** (`.cache/p807/runC.sh`: `gate.mts --tag p2 --only cost,alloc`,
  Phase 0's seven configurations, the display at 143 Hz; `summaryC.mts` prints it beside Phase
  0's). Main-thread task ms per second over "none" in the same run (the "none" figures differ
  between the runs, so the deltas are compared):

  | Scene, backend      | 3 / 6 panels, stats-gl (P0) | 3 / 6 panels, ours | Loop CPU ours +3 / +6 | Allocated stats-gl / ours |
  | ------------------- | --------------------------- | ------------------ | --------------------- | ------------------------- |
  | quickStart, WebGPU  | +6.8 / +17.4                | +6.4 / +42.0 (1)   | +0.00 / +0.10         | 1.11 MB/s / 59 kB/s       |
  | gym, WebGPU         | +13.3 / +19.6               | +3.9 / +16.6       | +0.00 / +0.10         | 1.05 MB/s / 65 kB/s       |
  | gym, WebGPU, DPR 2  | +12.4 / +26.1               | +5.2 / +13.8       | +0.00 / +0.10         | 1.20 MB/s / 51 kB/s       |
  | lodShowcase, WebGPU | +15.9 / +22.7               | +4.8 / +15.7       | -0.10 / +0.00         | 0.94 MB/s / 55 kB/s       |
  | quickStart, WebGL 2 | +6.8 / +17.8                | +6.5 / +17.3       | +0.00 / +0.00         | 1.19 MB/s / 63 kB/s       |
  | gym, WebGL 2        | +11.3 / +21.5               | +11.9 / +25.2      | +0.10 / +0.10         | 1.05 MB/s / 58 kB/s       |
  | lodShowcase, WebGL 2| +7.9 / +17.0                | -6.4 / +14.0       | +0.00 / +0.10         | 1.03 MB/s / 53 kB/s       |

  (1) Warm-up: its windows read 155, 105 and 77 ms/s, the third +7 over none. Ours allocated
  counts `_dbg__Stats*` and `TimeSeries.ts`; layout is a new 0.6 ms/s (the 4 Hz text; stats-gl
  drew only canvases).

  **Verdict: the cost passes** (within stats-gl's noise or below everywhere). **Allocation is
  95 % under stats-gl's but not zero per frame.** By function (`allocDetail.mts`, gym, WebGPU):
  most is the 4 Hz text writes (`writeFigure` 35-38 kB/s: the range's scan of 96 samples, each read
  boxed by the interpreter in a function that never gets hot, and the frame probe's summary
  7-8 kB/s), which D11 allows; the time series' draws and rescans 9-11 kB/s (the kit's: p805 D14
  measured none per draw); and about 70 B a frame in the frame step, the GPU listener and the
  30 Hz pushes (doubles V8 boxes: `performance.now()`'s result, arguments to calls not yet
  optimized). Moving the frame step's numbers and the frame probe's into a `Float64Array`
  measured the same, so it was dropped.
- **Verified:** `yarn test` (266 files), `tsc`, lint.
- **Decided at the review (2026-11-02):** the remaining ~70 B a frame passes D3's "nothing
  allocated per frame" (95 % under stats-gl's; Phase 5's perf pass checks it again), and the
  horizontal row stays as it is (vertical is the default).

As built, section 2 (2026-11-02, not committed):

- **Live settings:** `_createStatsPanels` became `_setStatsPanels(options)`: it builds the root
  (and adds it to the HUD root itself) when there's none or it changes between a button and a
  group, else adds a panel in its place in `STATS_PANEL_ORDER` (its own measures start again, its
  figure written on the next frame) or removes one, and changes the orientation and the Hz line in
  place; the frame probe and each GPU side are held only while a panel reads them, the GPU frame
  listener only while a side is held. "Enable measuring" off removes the root
  (`_removeStatsPanels`). Every toggle applies at once and refreshes the tab (the Hz toggle follows
  FPS); the "(reloads the app)" notes went; "Track PHY (after a reload)" keeps a boot setting's
  note. The GPU and CPT toggles are disabled without GPU timer queries (`_getGpuTimerSupport`).
- **The button:** with `openFromStatsPanels` on (its default), the root is a `<button>`: named
  by its content, a visually hidden "Open the profiler:" and then the panels (an `aria-label`
  failed axe's `label-content-name-mismatch`, WCAG 2.5.3: the visible figures weren't in its name;
  this way a screen reader gets the figures too), its tooltip "Open the profiler (F8)" on its
  right (the key from `getDebugKeyChordLabel`, CONFIG.ts' rebinding; the panels' own tooltips are
  above them) describing it, a press keeping the focus where it was (the on-screen tools' rule,
  p806 D12), the ring inside (the viewport's edges would cut it). Off, a group "Frame statistics"
  with no click. Switching builds the root again (its graphs start over); the profiler's setting
  change reaches it through `updateStatsProfilerEntryPoint`. The panels are `span`s (a button's
  content); the time series inside stays a `div`. The Statistics tab's Profiler button reads the
  same tooltip text.
- **The debug toaster** sits above the panels through `--aek-debug-stats-height` on `<body>`
  (the drawer's `--aek-debug-drawer-width` precedent), which a `ResizeObserver` on the root writes
  and `_removeStatsPanels` removes; `Boot.ts`' toaster offset is
  `calc(-16px - var(--aek-debug-stats-height, 0px))`, so a live change moves it. `getStatsCmp` /
  `_getStatsCmp`, the boot's one-off measure, went.
- **`AEK_debugStats`** loads unchanged (the same `persistKeys`; the saved object after the live
  check read back as set).
- **Tests:** 14 (4 new): a change applied live with the root, the kept panel and its figure
  unchanged, the Hz line shown and hidden, the button (its parts, name, description, click,
  press) and back to a group built anew with no listener left, the height on `<body>` and its
  removal.
- **In the app** (`.cache/p807/liveCheck.mts`, gym, WebGPU, Windows Chrome; shots in
  `.cache/p807/phase2-s2/`): Tab reaches the button and Enter opens the profiler; each toggle
  (GPU, Hz, TFPS, Horizontal, FPS with the Hz toggle disabled, Enable measuring off and on, the
  profiler's setting off and on) applied without a reload (a page marker kept); a debug toast sits
  above the panels; axe finds nothing on the button or the group; no page error.
- **Verified:** `yarn test` (266 files), `tsc`, lint, the docs ratchet (100 %).

As built, section 3 (2026-11-02, not committed):

- **Removed:** `stats-gl` from `package.json` and `yarn.lock` (`yarn remove`), `Stats.scss`,
  `StatsOptions`' stats-gl-only fields (`logsPerSecond`, `graphsPerSecond`, `samplesLog`,
  `samplesGraph`, `precision`, `mode`; `horizontal` and `enabled` got their summaries), the
  readme's credit. The comments: the "another resolver" retries in `_dbg__GPUTimer.ts`' header,
  `_dbg__GPUFrameTimes.ts`, `_dbg__PostFXProfiler.ts` and `_dbg__BakeStats.ts` now name an app's
  own resolve (D5); `_releaseGpuTimer`'s note about stats-gl's `trackTimestamp` went;
  `OnScreenTools.module.scss`' click-through note names the stats panels' canvases;
  `_dbg__StatsPanels.ts`' four mentions (its rates' history) went. `_dbg__ProfilerSources.ts`
  (on D10's list) had none left: Phase 1 moved its records out. `getStats` went in section 1,
  `getStatsCmp` in section 2. Nothing outside `docs/plans/` and `CHANGELOG.md` names stats-gl.
- **The About dialog** lists `dependencies` itself (`devTools/projectMetadata.ts`): stats-gl's
  row went (the `debugger` configuration's `window.about` shot, its rows after it moved up).
- **Verification (Phase 2's):**
  - `yarn verify:baselines`: the three bundles unchanged, no debug code in production or the
    embeds; `api.json` lost `getStats` and `getStatsCmp` (`@internal`, on no entry) and
    `docs.json` the two from its counts, both recorded with `--update` (its rewrite of
    `bundle.json`, byte shifts only, restored as the baselines' notes say).
  - `yarn sbp --profile all`: unchanged from Phase 0 (app 384.4, banner 287.4, uiKit 286.6 kB
    gzip; the app group's "well under" note as before).
  - The debug chunks (`yarn build:test`, `debugChunks.mts --out phase2`): 54 lazy JS chunks,
    485.1 kB, 199.5 kB gzip (Phase 0: 53, 512.5 kB, 205.1 kB gzip); stats-gl 0 (34.0 kB
    before); `_dbg__Stats` 8.9 kB, 4.1 kB gzip (38.5 kB, 10.9 kB gzip before; the time series
    and tooltip come from shared chunks).
  - `yarn verify:scenes --config all`: 108 of 110; the two failures were the changes on
    purpose: `drawer.statsControls` in `testDebugScene` and `thirdPersonGymScene` (the tab's
    labels: no reload notes, Hz in the FPS panel, PHY after a reload, the profiler button's
    tooltip text) and `testDebugScene`'s `window.about` (stats-gl's row). Recorded with
    `--only testDebugScene,thirdPersonGymScene --config debugger --update` (local baselines).
  - The Stop hook's unit run once failed `devTools/hub/buildGuard.test.ts` while this run's
    `yarn build:test` built the Hub at the same time (their staging folders): 9 / 9 alone after,
    and `yarn test` 266 files.

### Phase 3: the profiler's Overview and Objects — done

D6, D7, D9, a section each; their shots changed on purpose.

As built, section 1 (D6, 2026-11-02, not committed):

- **The table:** `createOverviewTable` in `_dbg__ProfilerOverview.ts`: one `createTable`
  (`captionHidden` "Overview", class `profilerOverview`, striped), columns Metric (row header),
  Value (`align: 'end'`, the warning tone) and Detail; its empty text "No rows are shown. Pick them
  in the Settings tab." Built in `content()` (each mount) and filled there; `onRefresh` (the
  profiler's rate, and `overviewMetrics`' change through `_updateProfilerTab`) holds the shown
  rows' sources and writes. A row is a kept object per metric id holding its label and figures as
  last written: a refresh compares each and calls `setCell` only for a changed one (the tone read
  from the row when its value cell is written); a changed list of shown rows (the Settings tab's
  reorder or visibility, an app source registered) is `setRows` and `setGroups` (the "App" group,
  none without app rows), which keep the rows by key. Not on `ctx.scheduler`: the rows aren't
  functions (a scheduler refresh would read every row again, which `setCell` avoids).
- **n/a and warnings:** an n/a metric's value is the word "n/a", its reason the detail's first
  words (then its secondary text). A warning is the value's `tone: 'warning'` with its words first
  in the detail (`MetricValue.warn` is now a string: physics "sub-steps at the N ceiling", long
  tasks "the main thread was blocked"). **The kit's `TableTone` gained `'muted'`** (decided at the
  review, 2026-11-02): the muted text at the regular weight, no mark, for a figure that isn't one;
  the n/a value takes it. With it: `Table.scss`' rule (the marks' `::before` rule skips it), the
  type's JSDoc, `Table.test.ts`' tone test, the UI kit data page's columns text, the library's
  table text and its overview demo (a missing budget is a muted "none" in place of "–"), the kit's
  `CLAUDE.md` line.
- **No action column:** no metric has had a row action since the file was written (its
  `MetricAction` was never returned), so the type, the click handler by `data-metric` and the
  column went; a metric that needs one later adds a `cell` column.
- `escapeProfilerHtml` moved into `_dbg__ProfilerObjects.ts` (its last user, section 2's).
  `Profiler.module.scss` lost the Overview's rules (`.profilerGroup`, `.profilerGroupHead`,
  `.isNA`, `.isWarn`, `.profilerAction`'s margins) and gained `.profilerOverview`'s (tabular
  figures, the value semibold, the detail muted and small, taking the rest of the width).
- **The scene runner's mask:** `DEBUGGER_LIVE_MASKS` adds `.profilerOverview td` (the value and
  detail cells); `.profilerValue` / `.profilerSub` stay for Objects until section 2.
- **Tests:** `_dbg__ProfilerOverview.test.ts` (9, 5 new; the kit's `createTable` wrapped by
  `vi.mock` to record `setCell`): the caption, columns and rows by id; a refresh writing nothing
  when nothing changed, then only the changed value in the same row and text node, n/a's value and
  detail (its value muted); the reorder keeping the row elements, a hidden row going, the App
  group; the empty text.
- **Verified:** `yarn test`, `tsc`, lint, the docs ratchet; `yarn verify:ui --only table` (the
  overview demo's muted "none": its shots recorded, axe and the scripts clean); the `debugger`
  configuration's `profiler.profilerOverview` shot changed on purpose (a header row, the kit's
  rows), axe 0.

As built, section 2 (D7, 2026-11-02, not committed):

- **The sections** (`_dbg__ProfilerObjects.ts`, its small parts in `_dbg__ProfilerObjectsParts.ts`
  so it stays under 800 lines: the formats, a text written in place, a section, a note, a table's
  empty text, a row header's two lines): a factory per section returning `{ cmp, update }`, built
  once in `content(ctx)` on `ctx.scheduler`. `onRefresh` reads the census once, then each
  section's `update` writes its texts and the row objects its parts read (functions of the rows);
  the host's `scheduler.refresh()` right after writes the kit's parts (D9's "the tables on
  `ctx.scheduler`").
- **The head:** "Bars" a `createSegmentedControl` bound to `settings.objectsBarMeasure`
  (`{ get, set }`, `set` the profiler's `setSettings`, whose apply refreshes the tab), hint "What
  the bars measure"; the census line a `p.profilerObjectsNote` written in place ("measuring…" or
  the n/a reason before a census).
- **By kind / by owner:** `createTable` each (caption hidden: the `h4` says it), columns Kind or
  Owner (row header, a `cell` of the name and its dimmed line, the line's `Text` written in place),
  Objects, Triangles, Vertices ("in view / total" in compact figures, no bold part: a cell is one
  text; a measure the row lacks is a muted "—") and "In view / culled" (`kind: 'bar'` of the
  measure's in view and culled, its text the share of the scene, "34.5 %", which the old bar's
  `title` held; its header a fixed label with a tooltip, since a header can't follow the switch);
  the Total the footer, so every bar is its share (the kit's default `barMax`). Rows kept by key
  (the kind, the owner's key); the empty text a CMP written as the census comes ("measuring…", "The
  scene is empty.").
- **ECS:** the worlds a table (World, Entities: the column labels it lacked); the component types a
  static `createList` (title the type, `suffix` the count) laid out in columns by CSS; "(all
  worlds)" and the editor view's note written in place.
- **The heaviest objects:** a table (#, Object with its entity line, Kind, Triangles, Instances,
  Edit). Rows are kept by the object (world, entity, kind and name, numbered when two share one),
  not by rank: the census reuses its entry objects, and a row (its focus, its button) stays with
  its object as the ranks change. Edit is an icon-only ghost button (`tools`), named and tooltipped
  by the opener's label and the object ("Edit physics entity: Crate"), made with the row; no
  button without an opener.
- **Over time:** three `createSparkline({ area: true, min: 0, capacity: 60 })` in the muted text
  (`--aek-sparkline-color`, as the stats panels' graphs), each with its label, the latest (bold)
  and "max …" on a line above it; a census walk pushes one sample, a reset (a view switch, the tab
  closed) or missed samples set the kept history again (`historyPushes` / `historyResets`).
- **Removed:** the HTML builders, `renderSparkline`, `escapeProfilerHtml` (nothing writes HTML in
  the profiler now), the click handlers by `data-measure` / `data-heavy`, `Profiler.module.scss`'
  string tables' rules (`.profilerTable`, `.profilerValue`, `.profilerSub`, `.profilerAction`,
  `.profilerSegmented`, the bar, the component grid, the SVG sparkline).
- **The scene runner's masks:** `.profilerValue` / `.profilerSub` went; `.profilerObjectsNote` (the
  census time) and `.profilerSpark` (the samples kept depend on timing) came.
- **The dev library's "Debugger parity" box** lost its ported rows (the profiler's tables section,
  the sparklines and the component types' list, as p806 did for its ports); GPU memory's tables and
  the budget bar stay for Phase 4, its text says so.
- **Tests:** `_dbg__ProfilerObjects.test.ts` (4, new; fake census and draw sources): "measuring…"
  until the first census, then the rows, the footer, the cells' texts and the bar's share, a muted
  dash; the segmented control writing the setting and the bars following; a heaviest row kept (the
  same `tr` and sub `Text`) through a rank change; a sample per walk in the sparklines with the
  latest and the max, the sparkline hidden from assistive tech.
- **Verified:** `yarn test` (267 files), `tsc`, `tsc -p hub`, lint, the docs ratchet; the
  `debugger` configuration's `profiler.profilerObjects` shot changed on purpose (with the
  Overview's), axe 0, the other shots unchanged; unmasked shots of both tabs in the gym
  (`.cache/p807/phase3Shots.mts`, `.cache/p807/phase3/`), no page error. The changed shots aren't
  recorded at the review (2026-11-02, with the Overview's).

As built, section 3 (D9, 2026-11-02, not committed):

- **D9's in-place updates** were sections 1 and 2's (each tab's sections built once in
  `content(ctx)`, `onRefresh` writing the figures, no `CMP({ html })` rebuilt per refresh). No
  Overview or Objects column is sortable (none was, and the kinds and the heaviest objects have
  their own order), so "a sort the user picked" is GPU memory's (Phase 4).
- **The profiler never heard of a scene change:** its window stays open across loads and its host
  never got `sceneChanged()` (only the drawer's did, through `updateDebuggerSceneTitle`), so its
  tabs were neither rebuilt nor told, and the Objects history mixed two scenes. Now `Scene.ts`'
  `setCurrentScene` calls `updateProfilerScene()` (`debug/Profiler.ts`, `@internal`, a no-op until
  the profiler loads) beside the drawer's title, under `IS_DEBUG_ENV || IS_PROD_TEST_MODE` (the
  profiler loads in prod test mode too; a production build folds it), and `_dbg__Profiler.ts`'
  `_updateProfilerScene` passes it to the host: the drawer's contract, so an app's profiler tab
  (`createProfilerTab`, "the same definition as `createDebuggerTab`") is now rebuilt on a scene
  change unless it has `keepOnSceneChange`, as the Hub's debug suite page already said.
- **Kept:** the Overview (nothing of a scene's), Objects (`onSceneChange: resetHistory`: the
  sparklines start again, the tables' rows follow the next census), Settings (nothing of a
  scene's) and GPU memory (its peaks and a snapshot's diff span scenes; Phase 4 reworks it), so
  none of the built-in tabs is rebuilt, as before. The rates stay.
- The scene change comes at `setCurrentScene`, mid-load (as the drawer's): the new history's first
  samples can be the load's last frames.
- **Tests:** Objects kept with its history starting again (the same elements, the old max gone);
  the Overview's `keepOnSceneChange`.
- **In the app** (`.cache/p807/phase3SceneChange.mts`, Windows Chrome): the Objects tab open with
  the focus on the Bars control, `loadScene` to another scene: the same table element, the focus
  kept, the history's max from the new scene only (testDebugScene → gym: 6,748 → 5,466), no page
  error.
- **Verified:** `yarn test` (267 files), `tsc`, `tsc -p hub`, lint, the docs ratchet;
  `yarn verify:baselines`: no debug code in production or the embeds, the bundles unchanged (their
  rewrite's byte shifts restored), `api.json` and `docs.json` recorded with the new `@internal`
  `updateProfilerScene` (191 / 191 documented in `engine/debug`); the `debugger` configuration on
  `testDebugScene` and `thirdPersonGymScene` passes against the recorded shots; `yarn sbp
  --profile all` unchanged from Phase 0 (app 384.4, banner 287.4, uiKit 286.6 kB gzip; the app
  group's "well under" note as before).

### Phase 4: GPU memory — done

D8, D9; its shots changed on purpose. The peak table's "Reached" cells (a wall-clock time) join
`DEBUGGER_LIVE_MASKS` (Phase 1's verification: the shot flips on them). In sections (decided at
the start, 2026-11-02):

1. The live sections on the kit: the total with its budget bar, the categories and the peaks, the
   frame, by owner with the untracked, the sources; the "Reached" mask; their tests.
2. The snapshot's sections (the three diffs), the removals (the HTML strings, the stylesheet's table
   rules), the dev library's "Debugger parity" box (no rows left).
3. D9 in the app (a sort, the focus and the scroll through the refreshes) and the phase's
   verification.

Decided at the start (2026-11-02, the recommendations taken): the budget bar's part in the kit's
default series colour (the old green fill was a status colour no text said; over the budget it's
`data-over` and "(over budget)"); categories (size and count, by size at the start, as before),
the untracked (size) and the sources (size and GPU objects, `sortUnset` for their registration
order) sortable, by owner and the diffs not (levels; rows cut at 12); a source's or an asset's id,
a hover-only `title` before, on its name's second line; the current scene a "current" badge, not
bold alone; the untracked a muted last body row in By owner, the Total its footer; an empty diff
table its kit empty text with its headers, not a note in its place.

The scene runner's baselines on this machine (a Mac, macOS's Chromium on WebGPU) were recorded on
the branch at `37c1709c` (`--config all --update`, 110 runs, 494 s): Phases 0-3 were reviewed on
the desktop's, so a `main` baseline here would show their changes again.

As built, section 1 (2026-11-02, not committed):

- **`gpuMemory/_dbg__GPUMemoryView.ts`** (new, 622 lines): `createGPUMemoryView(opts, scheduler)`,
  the live sections built once per mount on the tab's scheduler, each a factory returning
  `{ cmp, update, tables }`; `update` reads `info.memory`, the assets and the sources once and
  writes the rows the tables read (kept by key, `createRowPool`) and the texts in place.
  `MEMORY_CATEGORIES`, `FRAME_METRICS`, `getOwnerLabel` and `formatTime` moved there.
  `_dbg__GPUMemory.ts` keeps the sampling, the peaks, the budget toast, the tab and (until section
  2) the snapshot's string; it passes the view what it reads (`GPUMemoryViewOpts`: the renderer,
  the scene id, the budget, the peaks, the frame arrays, whether paused), so the view's test needs
  no kernel state.
- **The total:** "Total" and the figure, a `createStackedBar` ("GPU memory against the budget",
  one part, `total` the budget, its amount in bytes), the share under it (`data-over` past the
  budget: the danger colour, with "(over budget)").
- **The tables** (each `captionHidden`, a global class the masks and the tests read):
  `gpuMemoryCategories` (Category, Size, Count; render targets and geometries in a "Counted
  elsewhere" group, their size a muted word), `gpuMemoryPeaks`, `gpuMemoryFrame` (Counter, Last,
  Min, Avg, Max: values read from the sampler's arrays), `gpuMemoryOwners` (an owner's cells
  indented by `data-level`, the badge shown and hidden in place as the scene changes; the cell's
  name and badge have a space between them, for the row header's name), `gpuMemoryUntracked`
  ("Nothing untracked." when empty), `gpuMemorySources` (the name a two-line cell, "owner · id";
  a source holding nothing muted; the Total footer only with rows).
- **The frame's "(main loop paused)"** is a note above the table ("The main loop is paused: the
  figures are its last frames'"), the window's note under it written in place.
- **The first figures at the mount:** the tab host mounts a tab and starts its interval, with no
  refresh until the first tick (500 ms here), so a table showed the empty rows it was made with
  (the scene runner's shot, taken sooner, had every category at 0 B). The view refreshes its own
  tables once after its first `update`.
- **`profiler/_dbg__ProfilerObjectsParts.ts` is now `_dbg__ProfilerParts.ts`** (GPU memory uses its
  section, note, text writer and two-line cell too); `createSection` takes a class for a tab's own.
- **`GPUMemory.module.scss`:** the bar's, the over-budget, the current owner's and the cell rows'
  rules went; `.gpuMemorySection` (the kit tables across the tab, tabular figures, the row headers
  regular), `.gpuMemoryBudgetText`, `.gpuMemoryOwner` came. The snapshot's string rules stay for
  section 2.
- **The mask:** `DEBUGGER_LIVE_MASKS` adds `.gpuMemoryPeaks td:last-child` (the "Reached" times).
- **Tests:** `_dbg__GPUMemoryView.test.ts` (8; the assets' and the sources' walks mocked): the
  total, bar and budget line, the categories by size with their group, the peaks, the backend; the
  figures at the build before any refresh; a changed figure in the same text node and the
  over-budget state; a sort picked kept through a refresh; the frame and the paused line; the
  owners, their cells, the badge moving in place, the untracked and its table; a source's name,
  its muted state and the empty table; no renderer.
- **`_dbg__DebugKeyShortcuts.test.ts` pins the key platform** (`navigator.platform` set to Linux in
  its `beforeAll`): Node says the host's, so on macOS the hint was `⌃+M` and the test failed (on
  the clean branch too).
- **Verified:** `yarn test` (268 files), `tsc`, lint, the docs ratchet (100 %); the `debugger`
  configuration on `testDebugScene` and `thirdPersonGymScene`: only `profiler.gpuMemory` changed
  (on purpose, not recorded), axe 0 on every shot, the gym's unchanged; full-height unmasked shots
  of the tab in both debugger themes in both scenes (`.cache/p807/gpuMemoryShots.mts`, in
  `.cache/p807/phase4/`), no page error.

As built, section 2 (2026-11-02, not committed):

- **`gpuMemory/_dbg__GPUMemorySnapshotView.ts`** (new, 349 lines, out of the live view for its
  size): `createGPUMemorySnapshotView(opts, scheduler)`, the snapshot section built once per mount;
  `update` reads the diff once (as the strings did, each refresh) and writes the rows and texts.
  Its heading is written in place ("Snapshot", or "Since the snapshot in … at …"); with no snapshot
  a note says how to take one and the rest is `hidden`. Under the heading: the total's change, then
  three tables (`captionHidden`): `gpuMemorySnapshotCategories` (the categories that changed,
  signed; "No category changed."), `gpuMemoryLeftBehind` (the allocation and its scene, visit,
  site and collected count a two-line cell, rows kept by kind, scene, visit, label and site; at most
  12, then "+N more (Log diff lists all)", muted, and the Total in the footer) and
  `gpuMemoryAssetDiff` (the asset with its kind and owner, Then ("new"), Now ("gone"), Change; the
  counts, "N new, N gone, net …", on a line above, since a column's label is fixed; "+N more" in the
  footer), each with its kit empty text and headers when it has no rows; the closing note, its
  "Call sites" hint read from the setting. `createRowPool` is the live view's, exported.
- **An asset's key isn't on its second line** (a change from the decision at the start): the key
  is its kind and its id (`texture:${id}`, a material's texture `texture:${material}.${slot}` with
  the id `${material} › ${slot}`), so it repeated the line. The second line is "kind, owner", as
  before. A source's id stays on its line (it's the `registerGPUMemorySource` id, not its label).
- **`_dbg__GPUMemory.ts`** (304 lines) lost the snapshot's string, `esc`, `DIFF_MAX_ROWS` and the
  diff's formats; its tab builds both views in `content` and updates both in `onRefresh`.
- **`GPUMemory.module.scss` keeps only the layout** (D8): the sections' tables across the tab (the
  row headers regular and broken anywhere, the figures tabular and on one line: a long asset name
  had squeezed "480.5 KB" onto two), the hidden totals and snapshot, the total's row, the budget's
  share, the owner's cell. Every string table's rule went (`gpuMemorySummary`, `gpuMemoryTable`,
  `gpuMemoryHeading`, `gpuMemoryNote`, `gpuMemoryUntracked`, `gpuMemoryDim`, `gpuMemoryWrap`).
  Nothing in the debugger writes table or SVG HTML now.
- **The dev library's "Debugger parity" box went** (no rows left): `_library/parity.ts`,
  `parityTables.ts`, `debugger-parity-text.md`, the dev components page's box and its keywords,
  `_components.ts`' merge, `_components.scss`' `.hubDemoParitySection` and `.hubDemoParityCell`
  (`hubDemoTableWide` and `hubDemoTwoLines` stay: the data page's), `graphs.ts`' mention and
  `hub/CLAUDE.md`'s line.
- **Tests:** `_dbg__GPUMemorySnapshotView.test.ts` (3; the snapshot and its diff mocked): the note
  without a snapshot; the heading, the total, the changed categories, 12 left-behind rows with
  "+1 more" and the Total, the assets' counts line, a new and a gone asset and their second line,
  the "Call sites" hint; a row kept through a refresh with its new figures, an empty table's text
  without a footer, the note again once the snapshot is cleared.
- **Verified:** `yarn test` (269 files), `tsc`, `tsc -p hub`, lint, `yarn hub:build` (101 pages);
  the `debugger` configuration on `testDebugScene` and `thirdPersonGymScene`: only
  `profiler.gpuMemory` changed (as in section 1; the snapshot section is below the window's shot),
  axe 0 on every shot; shots of the tab with a snapshot's diff (a snapshot in the gym, then
  `testDebugScene` and the gym again: `.cache/p807/gpuMemorySnapshotShot.mts`, in
  `.cache/p807/phase4/gpuMemory.snapshot.*.png`), both themes, no page error.

As built, section 3 (2026-11-02, not committed):

- **D9 in the app** (`.cache/p807/gpuMemoryD9.mts`, the gym, macOS's Chromium on WebGPU): the
  GPU memory tab open, the sources sorted by size from the keyboard (Enter twice on the Size
  header's button: ascending, then descending), the focus left on that button and the tab
  scrolled 600 px; after three of the tab's 500 ms refreshes the sort is still descending with the
  rows in its order, the focus on the same button (Enter there goes on to the registration order,
  `sortUnset`), the scroll at 600 and the rows (the sources', a category's) the same elements; no
  page error. No code changed.
- **Verified (Phase 4's):** `yarn verify:baselines`: every baseline unchanged (the three bundles,
  `api.json`, `docs.json` 100 %), no debug code in production or the embeds; `yarn sbp --profile
  all`: first downloads app 384.4, banner 287.4, uiKit 286.6 kB gzip, unchanged from Phase 0, every
  budget within (the app group's "well under" note as before); the `debugger` configuration's
  `testDebugScene` recorded with the new `profiler.gpuMemory` shot (`--update`, local), then
  `testDebugScene` and `thirdPersonGymScene` pass against it (the "Reached" mask holds from run to
  run), axe 0.

### Phase 5: verification

- The `debugger` configuration (all its scenes): shots, axe 0, the tab order, the undo / redo
  scripts.
- The perf-auditor's pass over the panels, the three tabs' refreshes and p806's leftovers (§1.5),
  against Phase 0's figures; the fixes it calls for.
- The debug chunks and production's `yarn sbp` / `yarn verify:baselines`.
- Every scene runner baseline updated on purpose.

Notes from Phase 4 (on a Mac, where the desktop's scratch files aren't):

- The scene runner's baselines here (`.cache/verify/scenes/webgpu/`) are Phase 3's end
  (`37c1709c`, all 110 runs) plus Phase 4's `testDebugScene` `debugger` shots; on the desktop they
  are as Phase 3 left them, so there `profiler.gpuMemory` fails until recorded.
- `.cache/p806/` and `.cache/p807/`'s Phase 0-3 scripts (`gate.mts`, `measure.mts`,
  `debugChunks.mts`, `allocDetail.mts`) are on the desktop only: on another machine the debug
  chunks' and the cost measures' scripts are written again (`yarn build:test`, then the lazy JS
  chunks' bytes and gzip by name; Phase 0's method for the cost) or the phase runs on the desktop.
  Phase 4's scripts (`gpuMemoryShots.mts`, `gpuMemorySnapshotShot.mts`, `gpuMemoryD9.mts`) are on
  the Mac, run with `npx tsx` from the repo root.
- Phase 4's perf candidates: `_dbg__GPUMemoryView.ts`' `update` allocates at 2 Hz (the owner
  groups, the asset and source walks, as the strings did), and the snapshot's diff is read on each
  refresh while there's a snapshot (`getGPUMemoryDiff`, as before).

### Phase 6: the Hub, `CLAUDE.md`, readme

D11's docs. `yarn hub:build` in both modes.

### Phase 7: done

- `CHANGELOG.md` (D2's entry), the versions as D2 decides, `yarn checkVersions --against main`.
- The plan marked done and renamed, with the references: p800's Blocks line and §5,
  `_DONE_p806`'s Blocks line.
- **Time for the PR:** `p807-stats-and-profiler-graphs` → `main`.

---

## 4. Risks

- **Accuracy that looks wrong:** a CPU figure that spans less than stats-gl's reads "faster".
  Mitigation: D3 compares spans, not just numbers, and the label says what's measured.
- **WebGL's GPU timing:** three's pool times one context at a time; ours may show less there than
  stats-gl. Mitigation: the gate records it per backend, an n/a with its reason over a wrong
  figure.
- **Per-frame cost:** six canvases updated every frame. Mitigation: p805's renderer (whole-pixel
  shifts, no allocation), the 4 Hz text, Phase 0's measure against stats-gl's and Phase 5's pass.
- **The tables' first build:** a kit table builds more DOM than a string. Mitigation: built once
  per mount (D9), measured with the tabs' build times as p806 did.
- **The versioning on `main`** (D2): settled at the review (no bump; the unreleased engine-6
  entry).

---

## Done when

- The gate's figures and verdict are in this plan; with a pass, `stats-gl` is out of
  `package.json` and nothing imports it; with a fail, its panels are on the tokens with the reason
  recorded.
- The stats panels are a debugger root in its theme and density, their settings apply without a
  reload, and the profiler opens from them by keyboard.
- GPU timestamps have one resolver; compute timing is the GPU timer's.
- The Overview, Objects and GPU memory tabs are kit tables, bars, sparklines and lists, updated in
  place; no debugger module writes table or SVG HTML.
- `Stats.scss` is gone; every debugger stylesheet is on the tokens.
- The `debugger` configuration passes (shots, axe 0); production's `yarn sbp` is unchanged; the
  perf-auditor's pass shows no regression against Phase 0.
- The Hub, `debug/CLAUDE.md`, the readme and p800 are current; `yarn hub:build` passes in both
  modes.
