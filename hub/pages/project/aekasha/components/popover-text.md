## Popover

`createPopover({ anchor, content, label? })` anchors interactive content to its trigger, which
opens and closes it (`aria-haspopup`, `aria-expanded` and `aria-controls` on it). The focus moves
in (its first focusable element); Escape closes it and gives the focus back to the trigger, and a
press outside, or the focus leaving it and its trigger, closes it and leaves the focus there. It's
a non-modal `role="dialog"` on the kit's overlay stack, in the browser's top layer, kept inside
the HUD's bounds with the space left as its maximum size. `content` can be a function, built on
every open. `cmp.remove()` disposes of it.

- **States:** a window with the trigger; its checks open the popover.
