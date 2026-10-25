## Motion

Motion says what changed and where it went, and it's short. `motion-fast` is for hover, press and
toggles, `motion-base` for something opening or arriving (a folder, a menu, a toast),
`motion-slow` for a large piece moving (a drawer, a page-level change). `ease-standard` suits
almost everything; `ease-emphasized` is for something entering the screen.

- The hints: a folder's chevron turns as it opens, a value changed from outside flashes once, a
  toast slides in from its corner, a dragged item lifts, a loading button keeps its width while
  its text fades into a spinner.
- Reduced motion (the system's setting, or the app's `--aek-motion: 0` on the kit root) makes
  every duration 0. A longer animation of its own multiplies its time by `var(--aek-motion, 1)`,
  and one timed in JS by the element's motion factor (`getMotionFactor`). Where a change still has
  to be noticed (the value flash), it changes colour or opacity instead of moving.
- Nothing on a per-frame path animates: monitors and running graphs redraw without transitions.

::: do
`transition: transform var(--aek-motion-fast) var(--aek-ease-standard);` on a folder's chevron.
:::

::: dont
`transition: all 0.3s` on a monitor's value: it animates every frame's change, ignores reduced
motion, and transitions properties nobody meant to.
:::
