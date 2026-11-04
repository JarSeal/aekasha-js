The plans in `docs/plans/` and the issues in `docs/issues/`, read when the Hub builds: nothing on
this page is written by hand. A plan's header lines (`Status`, `Category`, `Blocks`,
`Blocked by`, `Epic`) give its row, its badge and its dependencies, so a saved plan shows here
right away. A header line the generator can't follow (a missing file, a `_DONE_` name that
disagrees with its `Status`, a cycle) is a warning at its file and line, in `yarn hub:build` and
in the dev server's log.

Each graph draws the blockers above the plans that wait on them. The tables are the whole list:
a row's plan opens its file, and "Waits on" and "Unblocks" jump to the rows of the plans they
name. The app's plans are on [the app's roadmap](hub:project/app/roadmap).
