::: scene exampleTerrain
A 64 m block of generated terrain: grass, scree on the slopes, a snow cap and triplanar cliff
faces, laid by rules, with rocks on the scree. Balls dropped on it roll down its slopes to the
valley; Space drops another one.
:::

A terrain block is the ground as one unit: its mesh, material, collider and scatter, spawned
together from a `*.terrainBlock.json`. This one isn't modelled: the toolkit's `rulesTerrain`
generator makes it from seeded noise and paints it by rules, so the whole terrain is three JSON
files and a call. The [terrain feature](hub:features/terrain) has the rest: blocks painted in
Blender, the material's techniques, decals and the weather.
