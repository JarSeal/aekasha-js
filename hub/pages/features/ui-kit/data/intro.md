The pieces that show an app's data: [lists](#lists) of its objects, which the player selects,
acts on and filters, [trees](#trees) of nested ones (a scene's outline, folders that load their
files when opened), [tables](#tables) of figures in columns, which the player sorts, selects and
opens, small [graphs](#graphs) beside a figure (a sparkline, a donut, a stacked bar),
[charts](#charts) of a few series, [time series](#time-series) of figures that change every
frame, and [stat tiles](#stat-tiles). Each collection keeps its rows
by key, so when the data changes (every frame, or at a scheduler's rate) a row stays the same
element, keeping its focus and selection, and only the text that changed is written:
[showing live data](#showing-live-data) says which way fits which rate.

Like every kit piece, each is a `createX(props)` that returns its handle: add its `cmp` where it
goes and remove it with `cmp.remove()`. Each section has a live demo, the piece's parts and custom
properties for [styling](hub:features/ui-kit/styling), its keys, and a link to its props.
