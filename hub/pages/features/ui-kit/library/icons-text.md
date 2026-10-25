## Icons

`getSvgIcon(name, size?)` returns a registered icon as HTML (`<span class="aekIcon">` around the
SVG, `1em` square so it follows its text, or `'sm'`, `'md'` or `'lg'` from the type scale's
`--aek-icon-size-*`); `registerIcon(name, svg)` registers one. The engine registers the built-ins
only for its debug tools (debug and prod test mode): a production app registers the ones it shows,
or gets `??` and a warning. [`BuiltInIconName`](api:BuiltInIconName) lists the built-ins' names.

- **States:** icons at `1em`, the three sizes, an icon in a button with its text, and an
  unregistered name.
- `'small'` is the deprecated name of `'sm'` (removed in engine 6.0.0).
