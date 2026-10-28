The pieces that show an app's data: [lists](#lists) of its objects, which the player selects,
acts on and filters, [trees](#trees) of nested ones (a scene's outline, folders that load their
files when opened), and [tables](#tables) of figures in columns, which the player sorts, selects and opens. Each keeps its rows by key, so when the data changes (every frame, or at a
scheduler's rate) a row stays the same element, keeping its focus and selection, and only the text
that changed is written.

Like every kit piece, each is a `createX(props)` that returns its handle: add its `cmp` where it
goes and remove it with `cmp.remove()`. Each section has a live demo, the piece's parts and custom
properties for [styling](hub:features/ui-kit/styling), its keys, and a link to its props.
