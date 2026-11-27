The fog fades what's far away into the air between it and the camera. A scene lists its fogs in
its JSON and starts with one of them: a linear fog between two distances, an exponential one, or
a height fog that lies thick in the valleys, thins out over the hills and glows toward the sun.
Its colour is the sky's own at the horizon, so on a day-night cycle the far fog meets the sky at
dawn, noon and dusk without a colour set by hand.

Every material in the scene reads the fog through one graph whose uniforms the engine writes in
place: switching the mode, the sun glow or the whole fog off, and moving any value over time,
never recompiles a material. A scene without a fog pays nothing.

::: scene fogShowcase
A valley 800 m long between hills 35 to 55 m high, a lake on its floor and a row of posts every
25 m out to 700 m (a red one every 100 m), under a `DAY_NIGHT` sky at 16:30. Three fogs, one per
mode, all in the sky's colour: `HEIGHT` (the default: the floor fogged, the hilltops clear),
`LINEAR` (30 to 600 m) and `EXP2`. The debug drawer's Fog showcase tab switches them, plays the
day and fills the valley with a dense fog over a few seconds; the Fog tab edits every value.
:::
