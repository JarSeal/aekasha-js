## Link

`createLink({ href, label })` is an `<a>`. One to another origin (or `external: true`) opens in a
new tab (`target="_blank"`, `rel="noopener noreferrer"`) with the external mark, and assistive
tech hears "(opens in a new tab)". `appearance: 'button'` draws it as a button, with the button's
`variant` and `size`: a navigation that looks like a button stays a link. An action that looks
like a link is the other way round, `createButton({ variant: 'link' })`, so each look keeps the
right element. `onClick` runs before the browser follows it (a router calls `preventDefault()`).

- **States:** drawn in the page: a link whose click an app's handler takes, an external one, a
  link in text, and two links drawn as buttons.
