How Ækasha looks and behaves, for the people building it: the UI kit, the debugger and the Hub
share this design. Every new component follows it from its first version, and the existing ones
move onto it as they're restyled (the kit's pieces and the debugger keep their look until then).

The tables are read from the kit's [`tokens.css`](repo:src/_engine/ui/styles/tokens.css) when the
Hub builds, so they always show what the kit ships, and the contrast figures are the ones its test
checks. The rules between them are written by hand: each says what to do and shows a pair, one
to follow and one to avoid. How an app uses the tokens (the kit root, setting a theme, the UI
scale, the font opt-in) is the public guide's: [Styling](hub:features/ui-kit#styling) on the UI
kit page.
