## Radial menu

`createRadialMenu({ items, label, onSelect })` puts items round a ring over the HUD's bounds (an
emote wheel, quick items), opened at a point by a held key or a shoulder button. The pointer's
angle highlights, `setDirection(x, y)` takes a stick's axes (its release calls `select()`), the
arrows go round and Enter picks; Escape, Tab or the centre closes. A `role="menu"` of menu items,
the real focus on the highlighted one; the centre shows its label and description.

- **States:** over the HUD's bounds: opened, with an item highlighted, and by a stick to the lower
  right.
