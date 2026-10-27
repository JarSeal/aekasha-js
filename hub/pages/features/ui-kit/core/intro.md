The components a HUD and its panels are built from: [buttons](#buttons) with their groups and
toolbars, [links](#links), [badges and tags](#badges-and-tags),
[key hints and input glyphs](#key-hints-and-input-glyphs) and [icons](#icons), and the pieces that
show a wait: [spinners and progress bars](#spinners-and-progress-bars),
[skeletons, dividers and empty states](#skeletons-dividers-and-empty-states) and
[loading overlays](#loading-overlays); and [tabs](#tabs), which lay out a panel's parts.

Each is a `createX(props)` that returns its handle: `{ cmp, …setters }`. Add its `cmp` where it
goes (under the HUD root, or a panel of yours), and remove it with `cmp.remove()`, which clears
its listeners and timers. The setters write the element in place, with no rebuild, so a HUD can
call them every frame. Each section has a live demo, the component's parts and custom properties
for [styling](hub:features/ui-kit/styling), its keys, and a link to its props.
