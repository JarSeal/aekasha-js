## Compass

`createCompass({ heading, markers, fov })` is a strip of the bearings at the top of the HUD (here
`inline`), scrolled by `setHeading(radians)`, with markers at bearings (a waypoint, an NPC) that
stay at the strip's end with an arrow when out of view. Decoration for assistive tech, with the
heading as a hidden text ("Facing north-east") written when the nearest of the eight directions
changes.

- **States:** in the page: facing north, east, the beacon and south, and the beacon's marker
  removed.
