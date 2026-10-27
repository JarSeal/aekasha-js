## Folder

`createFolder({ title, children })` is a disclosure: a button over a group of fields, which opens
and shuts with its height animated and its chevron turning. Folders nest, each level indented. A
shut folder's fields aren't read; when it opens, its `scheduler` reads them once, without a flash.
The folder writes no storage: `expanded` starts it open or shut, and `onExpandedChange` reports
each change for the owner to keep.

- **Keys:** Enter or Space on the button opens or shuts it. Shut from code with the focus inside,
  the focus goes to the button.
- **`hidden`:** a value or a function, re-read on its scheduler's `refresh()` (the "Shadow" folder
  is hidden while the light casts no shadows).
- **States:** drawn in the page, in a kit root of its own: a light's folder, open, with a nested
  one, shut. "Change the values from outside" changes the intensity and the bias and refreshes:
  the intensity flashes, the bias is read when "Shadow" opens. The status line says each open and
  shut.

The height eases over `--aek-motion-base`, at once under reduced motion.
