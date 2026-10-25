## Badge

`createBadge({ label, tone? })` is a short count or status word next to what it's about ("Inbox
3", "Beta"): a status colour (`neutral`, `accent`, `info`, `success`, `warning`, `danger`) on its
`-soft` background, sized in `em` so it follows its text. Where the label alone says too little
(a count), `spokenLabel` is what assistive tech hears in its place ("3 unread"). `setLabel` and
`setTone` write it in place. It isn't live: a count that changes while the player watches is
announced by a live region of the app's, if it should be.

- **States:** drawn in the page: the six tones, a count whose Hub button adds one, and a badge in a
  button (part of its name).
