## Command palette

`createCommandPalette({ label, commands })` is a modal search over an app's commands: an input
over the commands grouped and ranked as you type (every word in a command's label, whole or as its
letters in order, `tgdr` for "Toggle the grid"; word starts and runs of letters first), the
matched letters marked. Up and Down move, Enter runs the active command once the palette has
closed, Escape closes with the focus back on what had it. A `source` answers the queries instead,
at once or with a promise (a spinner until it settles), in its own order. The kit reads no key of
its own: an app binds Ctrl / ⌘ + K to `open()`.

- **States:** the editor's commands on an empty query (the recent command first, in its own group,
  then every command by group, a disabled one among them, a key hint at a row's end), the same
  opened with "tog" (one result, its letters marked) and with "zz" (no results), and a search
  through a source with its hint. Choosing a command says so in the status line below the buttons.
- **The search:** its rows are the app's (`renderRow`: a breadcrumb, the title and a line of text,
  both marked) and links to this page's sections; its first query waits for its index to load, as
  the Hub's own search does.
- **Not shown:** the narrow form, which takes the whole HUD below 640 px of it (a phone, a small
  embed).
