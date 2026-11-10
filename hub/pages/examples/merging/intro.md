::: scene exampleMerging
A ruined courtyard of 282 pieces from a kit of four geometries and two materials: floor tiles,
wall blocks, pillars and a gate. Space switches between the merged meshes and each piece on its
own, G swings the gate and R topples a pillar; the line at the bottom counts the draw calls.
:::

Drawn piece by piece, the courtyard costs 423 draw calls a frame (the main pass and the sun's
shadow pass). Merged, it's five meshes and 16 draw calls, and every piece is still an entity.
