## Draggable window

`openDraggableWindow` opens a window by its id, or reopens and updates the one with that id;
`toggleDraggableWindow` is a list row's (open, bring to the front, close when it's on top), and
`registerDraggableWindowKind` makes one window per entity, each built from its data. Two layers:
the app's windows, and the debug windows above them (`isDebugWindow`), which open only in the
debug env.

- **States:** the defaults (320 × 320 px at the screen's centre; closed, it keeps its place and
  size), an icon before the title, opening collapsed, fixed (no drag, resize or collapse), content
  that scrolls, and a backdrop whose click closes the window.
- **Behaviour:** the toggle, a kind's windows (each starts where the kind's last one was,
  cascaded, and closing one removes it), fitting every window to the screen (a header's
  double-click fits one), and closing them all.
- **Not shown here,** since they need the boot: a debug window, the restore from storage after a
  reload, and the scene-load rules (`closeOnSceneChange`, `removeOnSceneChange`, a kind's
  `sceneTargetResolver`). The [UI kit example](hub:examples/ui-kit) runs them in the app.

::: note For p803
The header clips its title's descenders, the content has no padding of its own (an app's panel
brings it: here the page's), and the module imports three kernel hooks and the env flags
([`src/_engine/ui/CLAUDE.md`](repo:src/_engine/ui/CLAUDE.md#ui-kit)), which this page stands in
for or leaves unrun.
:::
