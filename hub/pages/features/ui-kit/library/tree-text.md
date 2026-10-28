## Tree

`createTree({ roots, getChildren, title })` shows an app's nested nodes as rows the user opens
and closes: a title, and optionally an icon, a badge, a suffix at the end and a tooltip (or a CMP of
`render`). Rows are kept by key, so new nodes write only the parts whose text changed. A node's
children are `getChildren`'s, or loaded on its first open (`loadChildrenAsync`): a loading row
meanwhile, and an error row with a retry if the load fails. The tree is one tab stop: Up and Down
move between the shown rows without wrapping, Right opens a node or goes to its first child, Left
closes it or goes to its parent, `*` opens its siblings, Home, End, PageUp and PageDown move
further, a letter goes to the next title starting with it; Enter activates (or opens and closes),
Space selects. A `filter` shows the matches with their ancestors, opened, the matches marked, and
`virtual: createVirtualRows()` renders only the rows the box shows.

- **States:** drawn in the page: a scene outline (single selection, a filter field, the world
  open, the box scrolling past its height), asset folders whose files load on the first open (the
  remote library fails every other try, the archive takes a minute) and 5,040 tiles in 40 chunks
  (virtual rows, a multiple selection: `*` opens every chunk, End goes to the last tile).
  **Filter by “ro”** shows the matches with their ancestors and the count, **Open the slow and
  the failing folders** a loading row and an error row. The status line says what the user
  selected or opened.
- **What the page can't show:** a context menu over the nodes is the app's (`createContextMenu`
  on the tree's element, the node found with `getKeyAt`); the context menu box shows one.
