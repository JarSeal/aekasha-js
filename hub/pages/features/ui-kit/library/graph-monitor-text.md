## Graph monitor

`createGraphMonitor({ label, … })` is a number monitor with a graph of its reads under its text
(Tweakpane's monitor with `view: 'graph'`): every read is a sample, on its scheduler's tick every
`interval` ms (200 by default) and on each refresh. The graph is a time series with no ticks and
no summary (the text is the value), from `min` to `max` or a nice range over the reads, with
`thresholds`. A property grid item with `view: 'graph'` makes one, its graph loaded on first use
(every grid doesn't carry a canvas), the text shown until then.

- **States:** drawn in the page, from fixed reads: a frame time with a hitch and a 60 fps line,
  its 64 reads filled by refreshes, and a property grid's `view: 'graph'` item beside a plain
  monitor of the same value. The **Live** switch runs both schedulers' ticks.
- **Assistive tech:** a monitor's: the text is read after the label, not announced; the graph is
  hidden.
