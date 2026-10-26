## Tooltip

`createTooltip({ anchor, text, side? })` describes its anchor (the anchor's `aria-describedby`
names it) with a short text: shown after `--aek-tooltip-delay` (500 ms) of hover and at once on
keyboard focus, hidden when the pointer leaves (it can move onto the tooltip), on blur, on a press
of the anchor and on Escape. It's on the kit's overlay stack, in the browser's top layer, on its
side when it fits there (else the opposite one) and inside the HUD's bounds. Never interactive:
content with a control in it is a popover. `cmp.remove()` disposes of it.

- **States:** a window of buttons with a tooltip each (hover or Tab to them), the four sides shown
  at once (`show()`), and a long text, which wraps at about 32 characters a line.
