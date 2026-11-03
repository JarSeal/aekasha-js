## Minimap frame

`createMinimapFrame({ label, playerHeading, onZoom })` is the frame for a minimap: an app appends
it into a viewport's `slotElem`, which renders the map there. A north mark, the player's arrow at
its centre (`setPlayerHeading`; `setMapHeading` for a map that turns with the player), and zoom
buttons that report (`setZoomEnabled` at a limit). A group named by its label, the heading a
hidden text. Square: the viewport's render can't be clipped to a circle. Here the map is a
picture.

- **States:** in the page: north up, the player facing east, and a map that turns with the
  player.
