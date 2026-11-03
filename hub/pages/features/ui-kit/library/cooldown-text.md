## Cooldown

`createCooldown({ target, onReady })` covers an ability's button or a hotbar slot: a sweep uncovers
it clockwise with the seconds left, then it flashes when it's ready. The sweep is a CSS animation
from the start time (no script per frame); the seconds and the target's "Ready in 3 seconds"
description are written once a second, and the target is `aria-disabled` while it runs. It blocks
nothing: the action checks `isRunning()`. Under reduced motion the sweep steps once a second.

- **States:** in the page: two ability buttons, and runs started from the Hub buttons, which end
  before the screenshot (a running sweep moves: the keyboard scripts check it).
