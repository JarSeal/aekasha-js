## World anchors

[What it is and its states](hub:features/ui-kit/library#world-anchors), on the public page.

::: note For a later plan
p808's perf pass (200 anchors, its plan's Phase 7): the toolkit's sync iterates the component
storage with `for … of`, an entry array per entity unless V8 removes it (an `IComponentStorage`
`forEach` is the ECS core's change), and its default `size`, `getCanvasSize()`, makes two small
objects a frame (an `out` argument or a public `onCanvasResize` would be the engine's).
:::
