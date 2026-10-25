## Icons

`getSvgIcon(name, size?)` returns a registered icon as HTML (`<span class="aekIcon">` around the
SVG, `1em` square so it follows its text, or `'sm'`, `'md'` or `'lg'` from the type scale's
`--aek-icon-size-*`; p803 D5); `registerIcon(name, svg)` registers one. The built-ins are registered by the boot only in
the debug env and prodTest: a production app registers the ones it shows, or gets `??` and a
warning. Every built-in is listed in the [design document](hub:project/aekasha/design#built-in-icons).

- **States:** icons at `1em`, the three sizes, an icon in a button with its text, and an
  unregistered name.
- `'small'` is the deprecated name of `'sm'` (removed in engine 6.0.0). The icon also carries the
  debugger's `uiIcon` (and `smallIcon` at `'sm'`), which the debugger's styles size until p806.
