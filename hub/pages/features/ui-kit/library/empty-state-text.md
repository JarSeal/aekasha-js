## Empty state

`createEmptyState({ title, text?, icon?, action? })` is what a list, a panel or a search shows
when there's nothing in it: a large muted icon, the title, a text saying what to do about it, and
an action button made with `createButton` from the `action` props (the handle's `action`).
The title is a paragraph, or a heading at `headingLevel` where it starts a section. It isn't live:
a list that empties while the player watches says so in a live region of the app's, if it should.

- **States:** drawn in the page: one with an icon and an action (its click in the status line),
  and one with a title and a text only.
