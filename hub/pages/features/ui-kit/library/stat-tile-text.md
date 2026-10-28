## Stat tile

`createStatTile({ label, value, unit?, delta?, goodDirection? })` shows one figure that matters,
large in tabular figures, with its unit and the change since the last period: its sign, an arrow
and, for assistive tech, the words ("down 4.2 %"). `goodDirection` colours a change that way in
the success colour and the other way in the danger colour; without it a change is neutral. A
`sparkline` the app made goes under the figure. `setValue` writes one text node, so a figure set
every frame is fine; the tile isn't a live region.

- **States:** drawn in the page on a panel: a frame time with a good change and its sparkline,
  draw calls with a neutral one, frames per second with a bad one and a figure not measured yet;
  **Next period** sets them all again.
