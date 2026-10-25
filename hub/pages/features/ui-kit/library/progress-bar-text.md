## Progress bar

`createProgressBar({ label, value? })` shows how far a task is, or with `value: null` (the
default) that it's going on with no known end. The track is the `role="progressbar"`, named by
the visible label (`hideLabel` keeps it for assistive tech only), with `aria-valuenow` absent
while it's indeterminate. `setValue` writes the fill's `scaleX` in place, so a value set every
frame changes no layout. `segments: n` draws the track in n parts filled in turn (a health bar of
hearts), and `showValue` the rounded percent. Indeterminate, a bar slides along the track; under
reduced motion it's a still striped bar, as a segmented one always is.

- **States:** drawn in the page: a download at 40 % (its Hub button adds 10 %), an indeterminate
  one, a segmented health bar at 2.5 of 5 in the danger colour (`--aek-progress-color`) with its
  label hidden, and an indeterminate segmented one.
