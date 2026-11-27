Names over heads, signs, damage numbers, scores and labels are text in the 3D world, and the text
feature draws them from fonts made for the GPU. A font is a `*.font.json` beside a TTF, OTF or
WOFF: the asset pipeline encodes it into a distance field atlas, each glyph's shape stored as the
distance to its outline, so it stays sharp at any size and angle and takes outlines and glows as
shader maths. The atlas holds only the characters you ask for, and a scene loads its fonts with
its assets.

::: note Fonts first
This page covers the fonts: the asset, `yarn importFont`, the encode and the load. Drawing text
with them comes next, and the page grows with it.
:::
