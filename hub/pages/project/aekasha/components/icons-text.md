## Icons

`getSvgIcon(name, size?)` returns a registered icon as HTML (`<span class="uiIcon">` around the
SVG); `registerIcon(name, svg)` registers one. The built-ins are registered by the boot only in
the debug env and prodTest: a production app registers the ones it shows, or gets `??` and a
warning. Every built-in is listed in the [design document](hub:project/aekasha/design#built-in-icons).

- **States:** icons in a box the page sizes, an icon in a button sized `1em` with its text, and an
  unregistered name.

::: note For p803
The kit sizes no icon: `.uiIcon`'s SVG fills its box's width, so each user sizes `.uiIcon` itself
(the window's header, the debugger, the on-screen tools), and `'small'` only adds the class
`smallIcon`, which only the on-screen tools style. The kit's global styles (`.uiIcon`) come with
the boot (`styles/index.scss`), not with `aekasha/ui`: this page imports them by path.
:::
