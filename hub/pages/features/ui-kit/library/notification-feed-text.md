## Notification feed

`createNotificationFeed({ max, durationMs, placement })` shows short lines a game adds as things
happen ("+25 gold", "Quest updated"), newest on top, each with an optional icon and tone; a repeat
of a line's `key` merges into its count ("×3"), said in words ("25 gold, 3 times"). Each fades
after its time, held while the feed is hovered or holds the focus; past `max` the oldest goes. The
lines are read politely, the ones that come together as one text. Not the toaster: no close, no
actions, many at once. In a HUD it sits in a corner; here `inline`.

- **States:** in the page: a merged count, a level up, a warning, five lines past the maximum, and
  cleared.
