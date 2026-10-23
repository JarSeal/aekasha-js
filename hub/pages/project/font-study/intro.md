p801's Phase 0 font study ([p801 D8](repo:docs/plans/p801_design-foundation.md#d8-fonts),
[p800 D5](repo:docs/plans/p800_debugger-ui-overhaul.md#d5-fonts)): which sans and which mono the
kit, the debugger and the Hub share. The candidates are the Latin variable subsets of three sans
and three monos from Fontsource, added as dev dependencies for the study and removed after it.
This page loads them from the dev server's `node_modules`, so it works only there; the pick's files
are copied into `src/_engine/ui/fonts/` in Phase 4.

- **Sans:** Inter (the Hub's font today), Geist, IBM Plex Sans.
- **Mono:** JetBrains Mono, Geist Mono, IBM Plex Mono (static only: no variable build, so its
  size is three weights and an italic, not one file).
- **References:** the debugger's font today (`page.scss`' Lucida Sans / Geneva / Verdana stack)
  and the system UI stack, D8's default token for an app that doesn't opt in.

## How to judge

Each candidate is set in a mock debugger panel (a label column, number fields, a live monitor, a
table of figures, an id line in the mono) at 11, 12 and 13 px, and at the Hub's body and heading
sizes, in the dark and light themes side by side. Look for:

- **Readability at 11-13 px**: labels and numbers in the dense panel, in both themes.
- **Tabular figures**: the numbers in a column line up, and the tabular monitor holds still while
  the proportional one jitters.
- **Distinct glyphs**: `0O`, `1lI|`, `rn m` in the glyph rows and the id line.
- **Width**: how many characters of a typical label fit in the 280 px label column (the summary
  table, measured in this browser), and where a label is cut off in the panel.
- **Weight range** and the "subtle" feel (p800's look: quiet panels, a sparing accent).
- **Size**: the woff2 of each face, in the summary table. A font that only the debugger uses
  costs production nothing (a debug chunk); one the full page or the Hub uses is paid by every
  visit.

The pairing controls set the sans, the mono and whether numbers use the sans' tabular figures or
the mono.

## Devices

Rendering differs between platforms, so look at it on each: macOS and Windows in a desktop
browser, and an Android phone through `yarn dev:https` (the phone opens
`https://<this machine's LAN address>:8443/hub/project/font-study/` and accepts the self-signed
certificate). Screenshots of the pairing and of each font's panels at 11 px are the record; the
pick and its reasons go into p801's D8.
