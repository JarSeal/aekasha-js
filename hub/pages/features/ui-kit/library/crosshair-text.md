## Crosshair

`createCrosshair({ shape, gap, length, thickness })` is a reticle fixed at the centre of the HUD's
bounds (here a stage's, as a mounted engine's container): a cross, a dot, a circle or a chevron
drawn with CSS. `setSpread` moves its arms out (a weapon's bloom; nothing written when unchanged),
`setState` puts a ring over a target and a slash over something blocked (a shape, not the colour
alone), `showHitMarker` flashes an X that grows with its kind. Decoration for assistive tech
(`aria-hidden`): the game says the same in its sounds and its feed.

- **States:** in the page: each shape, spread, over a target, blocked. A hit marker lasts 250 ms,
  gone before the screenshot.
