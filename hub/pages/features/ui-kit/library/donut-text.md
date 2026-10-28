## Donut

`createDonut({ value? | parts?, label? })` is a ring that fills to one value (0 to 1) or shows the
parts of a whole, each in the chart series' colours by default. It's a conic gradient, so a
value set every frame writes one custom property. With a `label` one value is a meter
(`aria-valuenow`) and parts an image whose label lists them, with a legend beside it; without a
label it's decorative, for a figure that already says it. `total` makes the parts shares of a
budget (the rest the track), `centre` puts a short text in the middle, and
`--aek-donut-thickness: 100%` makes it a pie.

- **States:** drawn in the page on a panel: three measuring windows' progress beside their figures
  (the ray cast tab's), a meter at 62 % (**Fill to 90 %**), GPU memory's parts against a 512 MB
  budget with a legend, and a pie of a frame's stages.
