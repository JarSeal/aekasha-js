## Stacked bar

`createStackedBar({ parts, label, total? })` shows the parts of a whole side by side in one bar,
each its share's width in the chart series' colours by default, or one part against a budget
(`total`, the rest the empty track). Parts past the total are cut at the end and the bar is marked
over (`data-over`, a danger outline); the figure beside it says so in words. It's an image named
by its label and every part's amount; `legend` adds the swatches under it, and each segment's
tooltip gives its part.

- **States:** drawn in the page on a panel: a frame by stage with its legend, and GPU memory
  against its budget with its figure beside it (**Go over the budget**).
