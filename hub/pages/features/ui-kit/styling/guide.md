## The tokens: the whole look

The design tokens are CSS custom properties (`--aek-*`) on a kit root, an element with the class
`aekUi` ([`KIT_ROOT_CLASS`](api:KIT_ROOT_CLASS)). The HUD root is one, so everything under it
reads them: every component's colours, font, sizes and spacing come from the tokens. Set one on
the kit root and every piece follows:

```css
.aekUi {
  --aek-accent: #ffb000;
  --aek-accent-hover: #ffc640;
  --aek-on-accent: #1a1200; /* the text on the accent */
  --aek-radius-md: 2px;
}
```

- **Set them on the kit root**, not deeper: some tokens are made from others where they're
  declared (the focus ring's colour from the accent, the shadows), so a value set on a panel
  inside changes that panel's own uses but not those.
- **A forced theme declares its colours again** on its element (`data-aek-theme`, below): a
  palette of yours applies there too when its rule names it, `.aekUi, .myHud [data-aek-theme]`.
- **Keep the contrast:** the kit's own values give text, the accent and the status colours at least
  4.5:1 on every surface, and `--aek-border-control` and the focus ring 3:1 (WCAG AA). Check yours
  against the surfaces they sit on.
- **Your own UI reads them too.** A panel of yours under the HUD root, or a container of your own
  with the class (a title screen in the page's markup), styles with `var(--aek-…)` and follows the
  theme, the density and the UI scale:

```css
.scorePanel {
  position: fixed;
  top: var(--aek-space-5);
  right: var(--aek-space-5);
  padding: var(--aek-space-3) var(--aek-space-4);
  border: 1px solid var(--aek-border);
  border-radius: var(--aek-radius-lg);
  background: var(--aek-surface);
  color: var(--aek-text);
  font-size: var(--aek-font-size-md);
  font-variant-numeric: var(--aek-numeric-tabular);
  box-shadow: var(--aek-shadow-sm);
  transition: border-color var(--aek-motion-base) var(--aek-ease-standard);
}
```

The tokens are never on `:root`, so an engine embedded in a page leaves the page's own styles
alone. Under a kit root the text takes the theme's colour, and buttons and fields take the kit's
font and colour instead of the browser's defaults.

| Group   | Tokens                                                                                                                                                                                                                                                                                                                                                                                   |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Colours | `--aek-bg`, `--aek-surface`, `-surface-raised`, `-surface-hover`; `--aek-border`, `-border-strong` (emphasis), `-border-control` (a control's edge); `--aek-text`, `-text-muted`, `-text-disabled`; `--aek-accent`, `-accent-hover`, `-accent-soft`, `--aek-on-accent` (text on the accent); `--aek-danger`, `-warning`, `-success`, `-info`, each with a `-soft` tint; `--aek-backdrop` |
| Type    | `--aek-font-sans`, `--aek-font-mono`; `--aek-font-size-xs`, `-sm`, `-md`, `-lg`, `-xl`, `-2xl` (11, 12, 14, 16, 20, 24 px); `--aek-font-weight-regular`, `-medium`, `-semibold`, `-bold`; `--aek-line-height-tight`, `-base`, `-relaxed`; `--aek-numeric-tabular` (figures that don't jitter as they change); `--aek-icon-size-sm`, `-md`, `-lg` (12, 16, 20 px)                         |
| Space   | `--aek-space-1` to `--aek-space-7` (2, 4, 8, 12, 16, 24, 32 px)                                                                                                                                                                                                                                                                                                                          |
| Radii   | `--aek-radius-sm`, `-md`, `-lg`, `-full` (4, 6, 8 px, a pill)                                                                                                                                                                                                                                                                                                                            |
| Shadows | `--aek-shadow-sm`, `--aek-shadow-lg`                                                                                                                                                                                                                                                                                                                                                     |
| Motion  | `--aek-motion-fast`, `-base`, `-slow` (120, 200, 320 ms); `--aek-ease-standard`, `--aek-ease-emphasized`; `--aek-motion` (the factor: 1, or 0 for no motion); `--aek-tooltip-delay` (500 ms)                                                                                                                                                                                             |
| Focus   | `--aek-focus-ring-width`, `-offset`, `-color`                                                                                                                                                                                                                                                                                                                                            |
| Layers  | `--aek-z-window`, `-loading`, `-dialog`, `-debug-window`, `-debug-dialog`, `-toast`, `-tooltip` (z-index values: 100, 1000, 5000, 20000, 30000, 31000, 32000)                                                                                                                                                                                                                            |

The sizes are at the defaults: a 16 px browser font size and a UI scale of 1 (see
[UI scale and font size](#ui-scale-and-font-size)).

## A component's custom properties

Each component reads a few custom properties of its own, each defaulting to a token: a window's
header height, a button's radius, a progress bar's colour. They're read on the component or any
ancestor, so one rule sets them for every component of the kind, or a class sets them for one:

```css
.aekUi {
  --aek-window-radius: 0;
  --aek-button-radius: 0;
}

.healthBar {
  --aek-progress-color: var(--aek-danger);
  --aek-progress-height: var(--aek-space-2);
}
```

Every component's are in its reference table on [Core components](hub:features/ui-kit/core) and
[Windows and overlays](hub:features/ui-kit/overlays), and in its API documentation.

## Rules on its parts

Anything the tokens and properties don't reach is a rule on a component's parts. Every part has
a global class of its own, named after its component: the block, then `__` and the part
(`.aekWindow__title`, `.aekButton__label`, `.aekProgress__fill`). A component's variant, size and
state are attributes, so a rule selects them as they are (`[data-variant='primary']`,
`[data-state='collapsed']`, `[aria-pressed='true']`, `[aria-busy='true']`):

```css
.aekWindow__title {
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.aekButton[data-variant='primary'] {
  box-shadow:
    0 0 0 1px var(--aek-accent),
    0 0 12px var(--aek-accent-soft);
}
```

The parts and states are in each component's reference table too. They're the kit's public
names: a version that changes one says so in its changelog.

## Why your CSS wins

Every kit style is in a CSS cascade layer (`@layer aek.page, aek.tokens, aek.base,
aek.components, aek.utilities`), and its selectors are wrapped in `:where()`, which has no
specificity. `aek.page` is the full-page boot's normalize (`InitEngine`; an embed doesn't load it),
below every other kit layer, so the kit's own rules beat it on buttons and form controls. So:

- **A rule of yours that isn't in a layer beats every kit style**, whatever its specificity: a
  plain `.aekWindow__title` beats the kit's.
- **A rule in a layer of yours** beats the kit's when your layer comes later. Name the order once,
  first thing in your first stylesheet: `@layer aek, app;`.
- **A broad rule of yours reaches the kit too.** A page's `button { … }` or `a { … }` restyles
  the kit's buttons and links: scope it to your own markup (`.titleScreen button`), or keep the
  kit out (`button:not(.aekButton)`).

Never remove `outline` in a style that reaches the kit: keyboard focus shows the
[focus ring](#motion-and-focus).

## Make it look like your game

A worked example: a HUD for a dark sci-fi game with amber readouts, square corners and a
condensed font. One stylesheet, imported by the app's entry, does all of it, the three ways in
order.

```css title="hud.css"
/* The game's font, shipped with it: one file for every weight the kit asks for */
@font-face {
  font-family: 'Rajdhani';
  src: url('./fonts/Rajdhani-SemiBold.woff2') format('woff2');
  font-weight: 400 700;
  font-display: swap;
}

/* 1. The tokens: the palette, the font and the corners, on the kit root. The HUD is always dark,
   so it's forced (below) and the colours are given once. */
.aekUi {
  --aek-font-sans: 'Rajdhani', system-ui, sans-serif;
  --aek-ui-font-size: 1em; /* a condensed face reads small: 16 px text */

  --aek-bg: #07090c;
  --aek-surface: #0e1318;
  --aek-surface-raised: #141b22;
  --aek-surface-hover: #1c2630;
  --aek-border: #1f2a35;
  --aek-border-strong: #2e3e4e;
  --aek-border-control: #6a7f93;
  --aek-text: #e6edf3;
  --aek-text-muted: #9aabbb;
  --aek-accent: #ffb000;
  --aek-accent-hover: #ffc640;
  --aek-accent-soft: rgb(255 176 0 / 0.16);
  --aek-on-accent: #1a1200;

  --aek-radius-sm: 0;
  --aek-radius-md: 0;
  --aek-radius-lg: 2px;
}

/* 2. Components' custom properties */
.aekUi {
  --aek-window-header-height: 2.25em;
  --aek-window-border-color: var(--aek-accent-soft);
  --aek-progress-height: var(--aek-space-2);
}

/* 3. Rules on parts: what the properties don't reach */
.aekWindow__title,
.aekButton__label {
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.aekButton[data-variant='primary'] {
  box-shadow: 0 0 12px var(--aek-accent-soft);
}
```

```ts
import { getHUDRootCMP } from 'aekasha/ui';
import './hud.css';

// In the app's `start`: one theme, whatever the player's system prefers
getHUDRootCMP().updateAttr({ 'data-aek-theme': 'dark' });
```

- The forced theme is on the HUD root, which is also the `.aekUi` the palette is on, so the
  palette wins there. A panel of yours that forces the light theme gets the kit's light colours
  back: give it a rule of its own with light values (`.myLightPanel { --aek-surface: …; }`).
- The amber accent is at least 8:1 on every surface, the muted text 6.5:1, the dark text on the
  amber (`--aek-on-accent`) 10:1 and `--aek-border-control` at least 3.7:1: above the 4.5:1 and 3:1
  the kit keeps.
- In debug mode the debug tools force the kit's own dark theme on their roots, so they keep its
  colours; the font, the corners and the UI's text size reach them as they reach everything under
  the HUD root.

Open the [component library](hub:features/ui-kit/library) next to your game while you work: a
rule of yours in the browser's dev tools shows on every piece at once.

## Themes and density

The colours have a dark and a light theme. A kit root is dark, or light when the player's system
prefers light; `data-aek-theme="dark"` or `"light"` on any element forces its subtree's theme.
The theme sets `color-scheme` too, so the browser's own scrollbars and form controls follow it:

```ts
getHUDRootCMP().updateAttr({ 'data-aek-theme': 'light' }); // The whole HUD
settingsPanel.updateAttr({ 'data-aek-theme': 'dark' }); // One panel in it
```

`data-aek-density="compact"` on any element makes the type and space scales smaller in its
subtree (12 px text and tighter spacing at the defaults), for dense panels. The
[component library](hub:features/ui-kit/library) switches both on every piece.

## UI scale and font size

Every kit size follows two settings on the kit root: `--aek-ui-font-size`, the UI's text size
(default `0.875em`, 14 px at the browser's default 16 px), and `--aek-ui-scale`, a factor on all of
it, for a game's "UI scale" setting. The kit starts from the browser's default font size, which
the player sets, never from the page's root size, so it looks the same on any page.

```ts
// 1.25 makes the kit's text and spacing, and every token size, 25 % larger
getHUDRootCMP().updateStyle({ '--aek-ui-scale': uiScale });
```

Set them on the kit root only: the sizes are computed there, and the elements under it inherit
the results. A window's `size` and `position` are what you give it (px by default) and don't
scale; its header and contents do.

## Fonts

The kit's text is in the system's UI font unless you opt into the kit's own, IBM Plex Sans and
IBM Plex Mono:

```ts
import 'aekasha/ui/fonts';
```

- The full-page template and the debug tools import it; an embed or an app of your own chooses.
- The entry exports nothing: it's a stylesheet. The font files load later: a browser fetches a
  face only when text uses it, and the sans is one variable file for every weight.
- A font of your own is the family tokens, `--aek-font-sans` and `--aek-font-mono`, on the kit
  root (as in the [worked example](#make-it-look-like-your-game)). A plain rule of yours beats both
  the default and the opt-in.

## Motion and focus

- **Reduced motion:** the kit's transitions and animations take their durations from the motion
  tokens, which are 0 when the player's system asks for reduced motion. Set `--aek-motion: 0` on
  the kit root to turn them off from a setting of your own. Your own transitions follow too when
  they use the tokens; for an animation timed in code, multiply its durations by
  [`getMotionFactor`](api:getMotionFactor). A component's `anim` phases don't scale on their own,
  since an animation can carry meaning: scale the ones that shouldn't play. A few things keep
  moving because they're information: a hold to confirm still fills (in steps), and a spinner
  pulses instead of turning.
- **Focus:** keyboard focus under a kit root shows a ring in the accent colour (`:focus-visible`,
  so a click shows none). Don't remove `outline` in your styles; change the ring with its tokens
  (`--aek-focus-ring-width`, `-offset`, `-color`).

::: tip In an embed
An engine [mounted into a host page](hub:features/smallest-build#embedding) shows the kit as the
full page does: its sizes come from the browser's font size, not the host's root, its styles
reach nothing of the host's (no token on `:root`, nothing written to the page's `<head>`), and
windows, dialogs and toasts stay inside the mount's container. A window's `%` position and size
are of the container; `vw` and `vh` are the browser window's, as in CSS. The host page's own broad
rules (`button { … }`) reach the kit as yours would.
:::

## Key APIs

- [`KIT_ROOT_CLASS`](api:KIT_ROOT_CLASS), [`getHUDRootCMP`](api:getHUDRootCMP) and
  [`createHudRoot`](api:createHudRoot).
- [`getMotionFactor`](api:getMotionFactor).
- [`aekasha/ui/fonts`](hub:documentation/aekasha/ui/fonts): the kit's fonts, a stylesheet entry.

## Read more

- [The UI kit](hub:features/ui-kit): components and the HUD root.
- [The component library](hub:features/ui-kit/library): every piece in both themes and
  densities.

::: claude-md
:::
