## World anchors

`createWorldAnchorLayer({ cullDistance, edgePadding, depthSort })` places HUD content over points
in the world: nameplates, health bars, a waypoint. `layer.addAnchor({ content, align, offScreen,
maxDistance })` makes one and `anchor.setPosition(x, y, z)` moves it; `layer.update(view)` takes
the camera's view-projection as 16 numbers and moves each anchor only when its rounded pixel
position changed. An anchor behind the camera or too far hides; a `'clamp'` one (a waypoint) stays
on the screen's edge with an arrow to it. In an app the toolkit's `registerWorldAnchorSync` feeds
it from entities and the active camera; here the camera is a matrix built by hand.

- **States:** in the page: the camera facing north (the waypoint clamped), turned right, turned to
  the beacon, and 6 m on.
