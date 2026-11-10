A world built from many small static pieces (a ruin kit, a dungeon's tiles, a city block's
props) costs a draw call per piece, in the main pass and again in every shadow pass. Mesh
merging draws the pieces that share a material as one merged mesh, while each piece stays an
entity with its own transform, physics body and data: you can still find it, move it, disable it
or take it out of its group, and only its part of the merged mesh is rewritten.

::: scene exampleMerging
A ruined courtyard of 282 pieces from a four-piece kit, drawn as five merged meshes: 16 draw calls
in all, against 423 with each piece on its own. Space switches between the two, G swings the gate
and R topples a pillar. The [mesh merging example](hub:examples/merging) walks through its code.
:::
