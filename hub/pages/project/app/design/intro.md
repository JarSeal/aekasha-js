This is the app's design document: how its UI looks, moves and talks to its players. In the
template repo it's still empty. Each section says what to decide, in a "To decide" note, and
links the same section of [Ækasha's design document](hub:project/aekasha/design), which is
where the app starts.

To fill it in, replace a section's note with the decisions in that section's file,
`hub/pages/project/app/design/<section>-text.md`. Keep the headings so the sections stay
comparable with Ækasha's. The page is a dev page, so it lives in the repo with the game and never
goes into the public Hub.

**Start from Ækasha's tokens.** The app's HUD is built from the UI kit, so its look is the kit's
tokens. Change a token on the kit root (the HUD root, or the container the app's UI goes in) and
every component follows. Restyle one component only where the tokens can't express the change,
and give the app's own tokens a prefix of its own (`--game-*`), never `--aek-*`.
[Styling the UI kit](hub:features/ui-kit/styling) shows how.
