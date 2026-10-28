## Graph monitor

[What it is and its states](hub:features/ui-kit/library#graph-monitor), on the public page.

::: note For a later plan
p805 Phase 5 section 3 (p804 D1's move): `forms/GraphMonitor.ts` on `Monitor.ts`'
`buildGraphMonitor` (the shell with an empty line for the graph, which the grid's
`view: 'graph'` item shows at once) and the field shell's `onSample` (every read, changed or not).
The grid loads `GraphMonitor.ts` with `import()`: static, it would add 3.1 kB gzip to every
declarative grid. p806 ports the debugger's graph monitors by renaming (`view`, `bufferSize`).
:::
