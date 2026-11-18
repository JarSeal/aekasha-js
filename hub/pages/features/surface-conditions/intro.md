The surface conditions are the weather as the ground sees it: how wet it is, how hard it rains,
how full the puddles are, where the water's edge is, how much snow lies, how cold it is and how
the wind blows. One state holds them for the whole world. Left to simulate, the rain wets
everything it reaches, the sun and the wind dry it again, puddles fill and drain behind the
wetness, and snow melts into it above freezing. A game can also set every value itself and let
the state move between them smoothly.

Materials read the state through uniforms that never change identity, so a material built once
follows the weather for the rest of the app's life. The toolkit's wet response turns it into
darker, glossier ground, puddles with rain rings, streaks down cliffs, a wet shoreline, snow and
frost ([Terrain](hub:features/terrain#wet-and-dry-surfaces)). A rain occlusion map, rendered from
above around the camera, keeps the ground under roofs, trees and bridges dry.

::: scene terrainGallery
The gallery's Wet/dry row, left of the Splatting row: a block of each library category (sand,
mud, rocks, cliffs, snow, ice, grass, concrete) and a beach, all with puddles, ripples, snow,
frost and the occlusion map. A concrete wall and a cliff boulder streak in the rain, a canopy
keeps the mud under it dry, the grass has a riverbank that stays wet, and the beach has a
shoreline under a water plane. The tab's "Wet/dry row" section sets the wetness, rain, puddle
level, snow, temperature and water level, and switches the row to `SIMPLE` or to the `WETNESS`
and `TAPS` views. The image shows the whole gallery.
:::
