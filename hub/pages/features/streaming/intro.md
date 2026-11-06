An open world doesn't fit in memory at once, and it doesn't need to: only what's around the
player has to exist. World streaming cuts a scene into square cells and keeps the ones near a
focus (the main camera, or your player) loaded, loading the next ones a ring ahead as the focus
moves and unloading what it leaves behind, a little each frame, so streaming never stalls one.

::: scene streamingGrid
A 1 km square of 16 × 16 cells, each a terrain block with scattered rocks and crates, and beacons
and a long wall from the scene's JSON, cut into cells when it's gathered. The camera flies across
it; the scene's tab hovers it on a cell boundary instead, and the Streaming tab's
overlay shows each cell's state.
:::
