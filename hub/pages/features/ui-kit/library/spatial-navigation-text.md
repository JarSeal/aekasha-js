## Spatial navigation

`createSpatialNavigation({ root, onBack, wrap })` moves the focus by position among the tab stops
under `root`: the arrows (its own listener) and `move('up' | …)`, which a gamepad's d-pad calls.
A `data-aek-focus-group` element is tried first, then the nearest group's last focused element;
`nextGroup` for a shoulder button, `back()` for `EAST` (`onBack`, else the overlay stack's
Escape). A composite that uses the arrows keeps them, and `move` leaves it from its edge. Not a
component: a behaviour on a root.

- **States:** in the page: a side list and a grid of uneven buttons; the Hub's d-pad buttons call
  `move` without taking the focus, as a gamepad does.
