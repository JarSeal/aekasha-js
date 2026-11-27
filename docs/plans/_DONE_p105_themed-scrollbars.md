Status: implemented (Phases 1-3)
Category: UI kit, Hub
Related: _DONE_p103_small-bug-fixes-and-tweaks.md (the list this item came from)

# Themed Scrollbars — Plan

The UI kit's scrolling components and the Hub show the browser's scrollbars, tinted at most by
`color-scheme` and a `scrollbar-color` here and there. They should belong to the theme: in both
themes, a track the colour of the surface it's on with a thin line along its middle that shows the
track's length, and a thumb and end buttons in theme colours. The scrollbar becomes a documented part
of the design: its tokens in the token tables, its look in the Ækasha design document.

## Context

- **The kit today** (`src/_engine/ui/`) uses the standard properties only, no `::-webkit-scrollbar`:
  - `scrollbar-color: var(--aek-border-strong) transparent; scrollbar-width: thin` in the window
    content (`overlays/DraggableWindow.scss`), the toaster (`overlays/Toaster.scss`) and the
    drop-down (`forms/DropDown.scss`);
  - `scrollbar-width: thin` alone in the tabs list (`components/Tabs.scss`, which hides it behind its
    fade mask), the debugger's tab content (`DebuggerGUI.module.scss`), `MaterialEditor.module.scss`,
    `About.module.scss`, `DebugKeyShortcuts.module.scss`, `Profiler.module.scss`;
  - nothing on the menu, popover, command palette, list, tree, table, splitter panes, chart,
    game menu and the textareas (monitor, text field): they get the native bar, which follows
    `color-scheme` (each theme block of `ui/styles/tokens.css` sets it).
- **The Hub** sets only its code blocks' (`hub/_assets/scss/_code.scss`, `thin`); the page, the
  mobile nav, the layout's panes, the prose tables and the roadmap use the defaults. The Hub's
  `<html>` is a kit root, so a kit rule reaches it.
- **The docs** say the native scrollbars follow `color-scheme`:
  `hub/pages/project/aekasha/design/colours-text.md` and `hub/pages/features/ui-kit/styling/guide.md`.
- **The browsers:**
  - Chromium and Safari style the parts with `::-webkit-scrollbar`, `-track`, `-thumb`, `-button`,
    `-corner`: everything the look needs (the centre line as a gradient on the track, the buttons'
    colour, with their arrows drawn as background images).
  - **Since Chrome 121, an element whose `scrollbar-color` or `scrollbar-width` isn't `auto` ignores
    its `::-webkit-scrollbar*` rules**, and `scrollbar-color` inherits. So the existing declarations
    above must go, or they switch the new style off for their whole subtree.
  - Firefox has only `scrollbar-color` (thumb and track) and `scrollbar-width`: no line, no buttons.
    It gets the colours through `@supports not selector(::-webkit-scrollbar)`.
  - `::-webkit-scrollbar` turns macOS's overlay scrollbars into classic ones in Chromium and Safari:
    a visible change for Mac users, accepted as the price of the look.

## Decisions

**D1. Tokens** (in `ui/styles/tokens.css`, all three theme copies, which `Tokens.test.ts` keeps
equal):

- Theme colours: `--aek-scrollbar-track` (the surface: `transparent`, so it is the colour of what it
  sits on, or an explicit surface where `transparent` shows the content under an overlay bar),
  `--aek-scrollbar-line` (the centre line: near `--aek-border`), `--aek-scrollbar-thumb` (near
  `--aek-border-control`), `--aek-scrollbar-thumb-hover` (towards `--aek-text-muted`, or the accent:
  decide on screen), `--aek-scrollbar-button` and `--aek-scrollbar-button-glyph` (the end buttons and
  their arrows). Start as aliases of the existing tokens; give a value of its own only where the alias
  doesn't look right in one theme.
- A root size, `--aek-scrollbar-size` (the bar's width: the kit's compact density may want thinner),
  and `--aek-scrollbar-line-width` (1px).
- Each new colour token gets a contrast pair or a `CONTRAST_UNCHECKED` entry with its reason
  (`ui/styles/TokenSheet.ts`); the thumb against the track should reach 3:1 (a non-text UI part).
- The root sizes need a group in `devTools/hub/generated/design.ts`' `ROOT_GROUPS`, or
  `findUnshownTokens` warns; the colours show in the Colours table by themselves.

**D2. One kit-wide rule.** In `ui/styles/kit.scss`, under the kit root, with `:where()` so a
component's own rule wins without a fight:

- `::-webkit-scrollbar` (size), `-track` (the track token, and the centre line as a linear gradient
  across the bar's thickness: transparent, the line colour for `--aek-scrollbar-line-width`,
  transparent; for the vertical and horizontal bars both), `-thumb` (a rounded thumb inset by a
  transparent border with `background-clip: padding-box`, so it doesn't touch the bar's edges),
  `-thumb:hover`, `-button` (the button colour, the arrows as small SVG data URIs or `mask-image` with
  the glyph colour, for `:vertical:decrement`, `:vertical:increment`, `:horizontal:decrement`,
  `:horizontal:increment`; `:single-button` only, hide `:double-button`), `-corner`.
- `@supports not selector(::-webkit-scrollbar)`: `scrollbar-color: var(--aek-scrollbar-thumb)
  var(--aek-scrollbar-track); scrollbar-width: thin` for Firefox.
- Remove every per-component `scrollbar-color` and `scrollbar-width` listed in Context (they'd switch
  the WebKit style off in Chrome). `Tabs.scss` keeps its hidden bar: its rule becomes
  `::-webkit-scrollbar { display: none }` plus `scrollbar-width: none` (which is fine there: nothing
  is shown).
- A component that must look different (a game-UI menu over the scene, if it wants none) sets its own
  rule; that's the only reason to.

**D3. The Hub** uses the same rule through the kit root, with the Hub's `--hub-*` aliases only where a
Hub surface needs a different track (`devTools/hub/tokens.test.ts`: every `--hub-*` colour is an
`--aek-*` alias). The page's own scrollbar (on `<html>`) and the code blocks' included.

**D4. The design document.** A Scrollbars section in the Ækasha design document
(`hub/pages/project/aekasha/design/`: the colours page or patterns page, whichever describes
component parts) with the anatomy (track, centre line, thumb, buttons), the tokens, the browsers'
differences (Firefox: colours only) and the macOS overlay note. The two `color-scheme` sentences in
the colours and styling pages are rewritten. The component library page (`hub/_assets/ts/_components.ts`)
gets a scrolling demo (a list or a fixed-height panel) in both themes, so `verify:ui` sees it.

## Phases

### Phase 1: The tokens and the kit rule — done

1. The tokens (D1), their contrast entries, `Tokens.test.ts`.
2. The kit rule and the removals (D2).
3. Check in Chrome, Firefox and (if reachable) Safari, both themes: a draggable window, the
   drop-down, a list, a table, the command palette, the debugger's drawer tab, the material editor.
4. `yarn verify:ui --update` after looking at the changed screenshots (every scrolled demo changes);
   `yarn verify:scenes` (the debugger's windows are in the scene shots: update after a look).

As built:

- The rule is its own stylesheet, `ui/styles/scrollbars.scss`, which `kit.scss` `@use`s: the Hub
  loads only `tokens.css`, so D3 `@use`s the rule alone (the Hub's `<html>` is a kit root, but
  `kit.scss` reaches a Hub page only through the component library's script).
- The buttons are `:start:decrement` and `:end:increment`, not `:single-button`, which matches
  nothing on macOS (no platform buttons there); the arrows are conic gradients, so they take the
  glyph token. The line is `border-strong` in the dark theme (`border` was nearly invisible on
  `surface-raised`), `border` in the light; the thumb's hover is `text-muted`.
- The tabs' list keeps a visible bar (the kit's): it was a visible thin bar, not hidden as Context
  said, and the tabs have no wheel handling, so a hidden bar would leave a mouse no way to scroll
  them.
- The compact density keeps the 10 px bar: `Tokens.test.ts` keeps the density to the type and
  space scales.
- The design document's size table and its slot (`generated-design-scrollbars`) came in Phase 1:
  `design.test.ts` fails on a root token no table shows.
- Playwright's headless Chromium hides scrollbars (`--hide-scrollbars`): `devTools/verify/
  browser.ts` launches without it, so `verify:ui`'s and the scene runner's shots show them. The
  window demo's key script expects 555 px, not 560 (the page's own bar takes 10 px).
- The scene runner's baseline was stale (recorded before the fog, surface and rain systems): it
  was recorded again at the branch's last commit before the comparison. Its About setting pressed
  a control that had moved into the Æ button's menu: the test bridge's `focusDebuggerControl` now
  finds an open menu's items, and the setting presses the menu, then About Ækasha.
- Firefox's colours were checked by their computed values (headless Firefox draws no scrollbar);
  Safari wasn't reachable.

### Phase 2: The Hub, the design document, the component library — done

1. The Hub's surfaces (D3); `yarn hub:build`, `yarn hub:preview` in both themes, the mobile nav.
2. The design document's Scrollbars section and the rewritten sentences (D4); the root token group.
3. The component library's scrolling demo; `yarn verify:ui` for it.

As built:

- No `--hub-*` alias: a transparent track works on every Hub surface.
- The design document's scrollbar slot also shows a live scroller in each theme; the styling guide
  has a Scrollbars section of its own with the demo and the Chrome 121 warning.
- With the mobile nav open, its bar and the page's sit side by side at the right edge (overlay bars
  hid it before): left for a later plan on the mobile navigation.

### Phase 3: Versions and the changelog — done

1. `src/_engine/ui/CLAUDE.md` (tokens and units: the scrollbar tokens; the styles).
2. Versions: engine minor (new public tokens and a new look); the `CHANGELOG.md` entry (Engine,
   Project for the Hub); `yarn checkVersions --against main`; mark the plan done.

## Risks

- Every scrolling component changes look at once; a contrast or a hit-area mistake shows everywhere.
  The thumb's minimum length (`::-webkit-scrollbar-thumb { min-height }`) and the bar's width must
  stay usable with a mouse.
- Chrome's precedence rule: one `scrollbar-color` left anywhere up the tree (a component, an app's
  stylesheet, an embed's host page on `html`) switches the WebKit style off below it. The kit rule
  can't prevent a host page's; the styling guide says so.
- macOS: classic scrollbars take space where overlay ones didn't, so a layout sized to the pixel may
  wrap. Check the windows' and the drawer's widths.

## Verification

- `yarn test` (`Tokens.test.ts`, the Hub's token tests), `yarn lint`, `tsc`.
- `yarn verify:ui`, `yarn verify:scenes`, `yarn verify:embed` (the `uiKit` embed: no host style
  changed).
- `yarn hub:build` (no unshown-token warning), `yarn hub:preview`.
- The browser checks of Phase 1.
