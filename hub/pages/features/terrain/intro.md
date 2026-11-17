Terrain texturing starts with the surfaces: dry sand, a grey cliff, lake ice. A texture set is one
surface as a few packed PBR maps plus what a material needs to draw it at the right size: the
metres one tile covers, the metres of relief its height stands for, and defaults for its tint,
normal strength and roughness. Materials name a set by id. The toolkit ships 16 of them, CC0 scans
from ambientCG and Poly Haven, compressed to KTX2, and a baseline material that draws one. A set
can also be generated: ten procedural surfaces, baked into a set's textures at load, exported as
an ordinary set, or run live in the material.

The terrain material puts the sets on the ground. One material built from a config blends up to 16
layers by vertex colour, splat maps or rules of slope, height and facing, breaks up their tiling,
projects the cliffs, samples only the layers that matter at each pixel, and switches to a colour
map or a flat far surface in the distance. Only what the config turns on is compiled, and quality
tiers trade the techniques for speed.

::: scene terrainGallery
Every set of the toolkit's library on a 12 m block of generated terrain with a 35° ramp, the cliffs
with a wall, under a still 10:00 sky. Its debug tab ("Terrain gallery") flies the camera to a
set, switches `sand01`, `grass01` and `cliffs01` between their three packings, and lays a 1 m
checker over the ground for judging each set's scale. Around the library, a row per technique of
the terrain material (anti-tiling, splatting, rules, cliffs, colour maps, structures, a live
procedural layer), each with its sliders and measurement, and the Procedural row: each generator
on a block, baked, live or beside an imported set of its category. The tab's Quality and Debug
view selects switch every terrain block to a tier or a debug view.
:::
