## Rotation and quaternion fields

`createRotationField({ label, … })` edits an Euler's angles (a `THREE.Euler`, written in place)
in degrees, though they're bound in radians: each axis is a vector field's part, wrapping at
±180°, and a typed angle takes `deg`, `°`, `rad` or `turn`. `step` is in radians, so Tweakpane's
`Math.PI / 8` keeps working and shows as 22.5°. `showOrder` adds a select for the Euler's order.

`createQuaternionField({ label, … })` edits a quaternion (a `THREE.Quaternion`) as Euler angles in
degrees (`order`, default XYZ) or, with `edit: 'axisAngle'`, an axis and an angle, and writes it
normalised. The numbers shown stay the user's own while the quaternion is the one they made, so
an angle past 90° on the middle axis isn't re-derived into an equivalent set; one changed from
outside is shown derived. `showRaw` puts its components under the parts as text.

- **States:** drawn in the page, in a kit root of its own: an Euler with `step: Math.PI / 8` and
  its order, a quaternion as Euler angles with its raw components and a button that turns it from
  outside (its boxes flash), one as an axis and an angle, and a disabled rotation. The status line
  says each write (radians and components to 3 decimals).
