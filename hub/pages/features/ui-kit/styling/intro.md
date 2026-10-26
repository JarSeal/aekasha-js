The UI kit comes styled: its components bring their own styles with their modules, on a set of
design tokens with a dark and a light theme. Restyling it is plain CSS, in three ways from the
broadest to the most precise:

1. **[Set the tokens](#the-tokens-the-whole-look)**: the colours, the font, the radii and the
   spacing of every piece at once.
2. **[Set a component's custom properties](#a-components-custom-properties)**: a window's
   header height, a button's radius, a progress bar's colour.
3. **[Write rules on its parts](#rules-on-its-parts)**: anything else, with a class the kit
   names and documents.

Each way is a rule in your own stylesheet, and [your CSS always wins](#why-your-css-wins). The
[worked example](#make-it-look-like-your-game) uses all three on one HUD.
