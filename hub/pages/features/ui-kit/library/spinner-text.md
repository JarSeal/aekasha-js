## Spinner

`createSpinner({ size?, label? })` is a turning ring for a wait of unknown length. It's `1em` by
default, so it follows its text as an icon does; `size` takes the icon sizes (`sm`, `md`, `lg`)
and `--aek-spinner-size` any other. Standing alone it's a `role="status"` with its label
(default "Loading") in a visually hidden copy, so a `setLabel` is read; `decorative: true` hides
it from assistive tech, for a spinner inside something that already says it's loading. It turns
on the kit's `aekSpin`, the button's loading mark's keyframes, and pulses slowly under reduced
motion instead.

- **States:** drawn in the page: the sizes, one in text, one in the accent
  (`--aek-spinner-color`) and a large one (`--aek-spinner-size`).
