## Radio group and segmented control

`createRadioGroup({ label, options, … })` picks one value of a few: native radios in a
`radiogroup` named by the label, bound the same three ways as the other fields and written on each
pick (one `onChange` with `last: true`). An option is `{ value, label, disabled? }`, its value a
string, a number or a boolean. `orientation: 'horizontal'` lays them out in a row.
`createSegmentedControl` is the same radios drawn as a row of segments, each its text, an icon
with its text, or an icon alone (`iconOnly`: its label is then its name and its tooltip); `fill`
shares the field's width between them. It's for a value: a row of tool buttons is the button
group.

- **Keys:** the browser's own: the group is one tab stop (at the picked radio), the arrows move to
  the next or previous one and pick it, wrapping and skipping a disabled one, and Space picks.
- **States:** drawn in the page, in a kit root of its own, bound to one object: a column with a
  hint, a row with a disabled option, a segmented control filling its width, one of icons alone,
  and a disabled group of each. The status line says what each pick was.

Each radio and segment is a 24 px target in both densities. A segment's radio lies over it,
transparent, so the focus ring is the segment's; the picked segment is in the accent colour.
