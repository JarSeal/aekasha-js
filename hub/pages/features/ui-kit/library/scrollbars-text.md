## Scrollbars

Not a component: every scroller under a kit root gets the kit's scrollbar from `kit.scss`, so a
panel, a list, a window's content or a dropped-down list all scroll the same way. A track the
colour of the surface with a line along its middle, a rounded thumb inset from its edges (lighter
under the pointer), and an arrow at each end, drawn from the `--aek-scrollbar-*` tokens (the
[styling guide](hub:features/ui-kit/styling#scrollbars)). Firefox shows the thumb and the track
colours only.

- **States:** drawn in the page: a run log that scrolls down, and a wide one that scrolls both
  ways with the corner between its bars. Each is a tab stop named by its label, so the arrow keys
  scroll it. The pointer's hover on the thumb shows only in a browser.
