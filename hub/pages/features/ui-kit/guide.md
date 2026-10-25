## The pieces

| Piece                                                                       | Made with                                                          | For                                                            |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------- |
| [Component](#components)                                                    | [`CMP`](api:CMP)                                                   | Any element: a panel, a button, a readout                      |
| [HUD root](#the-hud-root)                                                   | [`getHUDRootCMP`](api:getHUDRootCMP)                               | Where the app's UI goes, over the canvas                       |
| [Drop-down](#drop-downs)                                                    | [`createDropDown`](api:createDropDown)                             | A choice from a list, with the keyboard                        |
| [Button](hub:features/ui-kit/core#buttons)                                  | [`createButton`](api:createButton)                                 | An action: a toggle, a loading save, a hold to confirm         |
| [Button group](hub:features/ui-kit/core#groups-and-toolbars)                | [`createButtonGroup`](api:createButtonGroup)                       | Buttons joined; a toolbar of toggles with one pressed          |
| [Link](hub:features/ui-kit/core#links)                                      | [`createLink`](api:createLink)                                     | A navigation: in text, to another site, or as a button         |
| [Badge, tag](hub:features/ui-kit/core#badges-and-tags)                      | [`createBadge`](api:createBadge), [`createTag`](api:createTag)     | A count or a status word; a kind, a filter chip, a picked item |
| [Key hint](hub:features/ui-kit/core#key-hints-and-input-glyphs)             | [`createKbd`](api:createKbd)                                       | A shortcut's keys, with each platform's names                  |
| [Input glyph](hub:features/ui-kit/core#key-hints-and-input-glyphs)          | [`createInputGlyph`](api:createInputGlyph)                         | One key or mouse input in a prompt: "Press E"                  |
| [Icon](hub:features/ui-kit/core#icons)                                      | [`registerIcon`](api:registerIcon), [`getSvgIcon`](api:getSvgIcon) | SVG icons by name, in the text colour                          |
| [Spinner](hub:features/ui-kit/core#spinners-and-progress-bars)              | [`createSpinner`](api:createSpinner)                               | A wait of unknown length, in text or alone                     |
| [Progress bar](hub:features/ui-kit/core#spinners-and-progress-bars)         | [`createProgressBar`](api:createProgressBar)                       | How far a task is, or that it's going on; a segmented gauge    |
| [Skeleton](hub:features/ui-kit/core#skeletons-dividers-and-empty-states)    | [`createSkeleton`](api:createSkeleton)                             | A placeholder shaped like content that's still loading         |
| [Divider](hub:features/ui-kit/core#skeletons-dividers-and-empty-states)     | [`createDivider`](api:createDivider)                               | A line between two groups, across a column or down a row       |
| [Empty state](hub:features/ui-kit/core#skeletons-dividers-and-empty-states) | [`createEmptyState`](api:createEmptyState)                         | What an empty list or search shows, and what to do             |
| [Loading overlay](hub:features/ui-kit/core#loading-overlays)                | [`createLoadingOverlay`](api:createLoadingOverlay)                 | A scene loader's screen, or a panel's while it loads           |
| [Window](hub:features/ui-kit/overlays#windows)                              | [`openDraggableWindow`](api:openDraggableWindow)                   | A panel the player moves, resizes, collapses and closes        |
| [Window kind](hub:features/ui-kit/overlays#one-window-per-thing-kinds)      | [`registerDraggableWindowKind`](api:registerDraggableWindowKind)   | One window per thing (an entity, an item), each with its data  |
| [Dialog](hub:features/ui-kit/overlays#dialogs)                              | [`openDialog`](api:openDialog)                                     | A modal window over a backdrop: a pause menu, a confirmation   |
| [Toaster, toast](hub:features/ui-kit/overlays#toasts)                       | [`createToaster`](api:createToaster), [`addToast`](api:addToast)   | Short messages that come and go                                |
| [Tooltip](hub:features/ui-kit/overlays#tooltips)                            | [`createTooltip`](api:createTooltip)                               | A short text describing a control, on hover or focus           |
| [Popover](hub:features/ui-kit/overlays#popovers)                            | [`createPopover`](api:createPopover)                               | Interactive content next to its trigger: filters, a detail     |
| [Menu](hub:features/ui-kit/overlays#menus-and-split-buttons)                | [`createMenu`](api:createMenu)                                     | A button's list of actions, on / off items and choices         |
| [Split button](hub:features/ui-kit/overlays#menus-and-split-buttons)        | [`createSplitButton`](api:createSplitButton)                       | An action, with its variants in a menu                         |

The kit is in three pages, with a [component library](hub:features/ui-kit/library) that shows
every piece in every state:

::: cards features/ui-kit
:::

## Components

A component (a CMP) is an element made from props, and its handle
([`CMPHandle`](api:CMPHandle)) adds children, updates it and removes it. It's in the page once it's added
under a component that is: the app's UI goes under the HUD root, which the engine makes at boot.

```ts
import { CMP, getHUDRootCMP } from 'aekasha/ui';

const panel = getHUDRootCMP().add({ class: 'scorePanel' });
const score = panel.add({ tag: 'span', text: '0' });
panel.add({ tag: 'button', text: 'Reset', onClick: () => score.updateText('0') });

// Each frame or on change: written in place, with no allocation
score.updateText(String(points));
score.updateStyle({ '--accent': points > 100 ? '#e8833a' : '#8fa1c4' });

// Another CMP inside an html template (the html must be a function: an update makes it again)
const star = CMP({ tag: 'span', class: 'star', text: '★' });
panel.add(CMP({ html: () => `<h2>${star} High scores</h2>` }));
```

- The HUD root is a fixed, zero-size element at the canvas's top left, so each panel places
  itself (`position: fixed` and its offsets).
- Props are copied when a component is made. `updateText`, `updateStyle`, `updateClass` and
  `updateAttr` write that copy and the element in place, so a readout can update every frame;
  `update(newProps)` makes the element again and keeps the children added to it.
- `onCreateCmp` runs when the component is mounted and after each `update()`, and `onRemoveCmp`
  after `remove()`: where a component's own listeners, timers or module state are cleaned up.
- `text` is set as text. `html` is raw HTML: never put user input in it, unless the root's
  `settings.sanitizer` is set.
- A style key that starts with `--` is a custom property, which your CSS reads with `var()`.

::: warning Listeners run in the capture phase
Every listener prop (`onClick`, `onInput`, …) is added in the capture phase, and so is a
`listeners` entry unless its options say otherwise. A parent's `onClick` runs before its
child's, and a child's `stopPropagation()` doesn't stop it.
:::

## The HUD root

The HUD root is where the app's UI goes: a fixed, zero-size element over the canvas, a kit root
(see [Styling](#styling)), which the engine's boot makes. [`getHUDRootCMP`](api:getHUDRootCMP)
returns it, and each panel added under it places itself. The windows, dialogs, toasts and the
overlays open in it too.

### Without the engine

The kit works on a page that doesn't run the engine: a menu shown before the engine starts, or a
page of your site. Make the HUD root there yourself with [`createHudRoot`](api:createHudRoot),
once per page (the engine's boot makes it in an app, and a second one throws). Each kit module
brings the kit's global styles, so there's no stylesheet to import. Register the icons the pieces
show (the windows' buttons, the toasts' kinds): [`registerBuiltInIcons`](api:registerBuiltInIcons)
registers every built-in, as the boot does in debug mode.

```ts
import { addToast, createHudRoot, createToaster, registerBuiltInIcons } from 'aekasha/ui';

registerBuiltInIcons();
const hud = createHudRoot({ slot: document.querySelector<HTMLElement>('#menuHud') ?? undefined });
hud.add(createToaster({ id: 'menuToasts' }));
addToast({ message: 'Settings saved' });
```

## Drop-downs

[`createDropDown`](api:createDropDown) makes a trigger button and an in-page list (not a native
`<select>`): arrows, Home and End move, Enter, Space or a click picks, and Escape, Tab or a click
outside closes it without a change. Its keys reach no key binding, and a pick or Escape gives the
focus back to the trigger when the list was opened from it. The list opens over everything (the
browser's top layer), so a window doesn't clip it: on `placement`'s side when it fits there, else
the other, and inside the page or the embed's container. Add its `cmp` where it goes.
The trigger re-reads `value` after a pick; when the value changes elsewhere, call `refresh()`.

```ts
const quality = createDropDown({
  options: [
    { value: 'low', label: 'Low' },
    { value: 'high', label: 'High' },
  ],
  value: () => settings.quality, // Re-read on every open and after every pick
  onChange: (value) => setQuality(value), // Then the trigger shows the new label
  title: 'Quality',
});
settingsPanel.add(quality.cmp);
```

For a long list, `searchable: true` puts a filter field over it. Typing filters the options by
their labels and marks the match, the arrows move through what's left, and Enter picks:

```ts
const level = createDropDown({
  options: levels.map((l) => ({ value: l.id, label: l.name })),
  value: () => currentLevelId,
  onChange: (id) => loadLevel(id),
  title: 'Level',
  searchable: true,
  searchPlaceholder: 'Find a level',
});
```

::: demo dropDown
:::

| Drop-down      |                                                                                                                                                                                        |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Props          | [`DropDownProps`](api:DropDownProps)                                                                                                                                                   |
| Parts          | `.aekDropDown` (`_top` when it opens upward) with `.aekDropDownTrigger`; the list `.aekDropDownList` of `.aekDropDownItem`s; searchable, `.aekDropDownPopup` with `.aekDropDownSearch` |
| States         | The highlighted option `data-active`; a match `<mark class="aekDropDownMatch">`                                                                                                        |
| Keys           | The arrows, Home and End move; Enter or Space picks; Escape, Tab or a click outside closes it without a change; searchable: typing filters, Enter picks                                |
| Assistive tech | A listbox with `aria-activedescendant`; searchable, a `combobox` filter field                                                                                                          |

A later version makes it the forms' select field, with the other fields.

## Styling

The kit's components bring their own styles with their modules (a window's, a drop-down's, a
toaster's), and the engine adds the design tokens, a focus ring and two rules: the editor views'
hiding of the HUD and the icons' size. Nothing styles your page's `html` or `body` except the
full-page template's own page styles. Give your components classes of their own and style them
as usual: the drop-down's default styles have zero specificity, so any class overrides them.

In debug mode, the editor views (the material editor) hide the HUD root's children, except one
with [`KEEP_IN_VIEWS_CLASS`](api:KEEP_IN_VIEWS_CLASS).

A window is the class `aekWindow` with its parts `aekWindow__header`, `aekWindow__title`,
`aekWindow__button` (`aekWindow__collapse`, `aekWindow__close`) and `aekWindow__content`, its state
in `data-state="collapsed"` / `"expanded"`, and a dialog's backdrop `aekWindowBackdrop`. Its custom
properties, read on the window or any ancestor (the HUD root for every window):
`--aek-window-header-height`, `--aek-window-radius`, `--aek-window-bg`, `--aek-window-header-bg`,
`--aek-window-border-color` and `--aek-window-shadow`. The kit's styles are in the CSS layer
`aek.components` with zero specificity, so any rule of yours wins, a broad one too: scope a
`button { … }` of your own page to your own UI.

### The kit root and its tokens

The design tokens are CSS custom properties (`--aek-*`) on a kit root, an element with the class
`aekUi` ([`KIT_ROOT_CLASS`](api:KIT_ROOT_CLASS)). The HUD root is one, so everything under it can
read them. For UI of your own outside the HUD (a title screen in the page's own markup), put the
class on its container. The tokens are never on `:root`, so an engine embedded in a page leaves
the page's own styles alone. Under a kit root the text takes the theme's colour, and buttons and
fields take the kit's font and colour instead of the browser's defaults.

```ts
const scorePanel = getHUDRootCMP().add({ class: 'scorePanel' });
```

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

| Group   | Tokens                                                                                                                                                                                                                                                                                                                                                                                   |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Colours | `--aek-bg`, `--aek-surface`, `-surface-raised`, `-surface-hover`; `--aek-border`, `-border-strong` (emphasis), `-border-control` (a control's edge); `--aek-text`, `-text-muted`, `-text-disabled`; `--aek-accent`, `-accent-hover`, `-accent-soft`, `--aek-on-accent` (text on the accent); `--aek-danger`, `-warning`, `-success`, `-info`, each with a `-soft` tint; `--aek-backdrop` |
| Type    | `--aek-font-sans`, `--aek-font-mono`; `--aek-font-size-xs`, `-sm`, `-md`, `-lg`, `-xl`, `-2xl` (11, 12, 14, 16, 20, 24 px); `--aek-font-weight-regular`, `-medium`, `-semibold`, `-bold`; `--aek-line-height-tight`, `-base`, `-relaxed`; `--aek-numeric-tabular` (figures that don't jitter as they change)                                                                             |
| Space   | `--aek-space-1` to `--aek-space-7` (2, 4, 8, 12, 16, 24, 32 px)                                                                                                                                                                                                                                                                                                                          |
| Radii   | `--aek-radius-sm`, `-md`, `-lg`, `-full` (4, 6, 8 px, a pill)                                                                                                                                                                                                                                                                                                                            |
| Shadows | `--aek-shadow-sm`, `--aek-shadow-lg`                                                                                                                                                                                                                                                                                                                                                     |
| Motion  | `--aek-motion-fast`, `-base`, `-slow` (120, 200, 320 ms); `--aek-ease-standard`, `--aek-ease-emphasized`                                                                                                                                                                                                                                                                                 |
| Focus   | `--aek-focus-ring-width`, `-offset`, `-color`                                                                                                                                                                                                                                                                                                                                            |
| Layers  | `--aek-z-window`, `-loading`, `-dialog`, `-debug-window`, `-debug-dialog`, `-toast`, `-tooltip` (z-index values: 100, 1000, 5000, 20000, 30000, 31000, 32000)                                                                                                                                                                                                                            |

The sizes are at the defaults: a 16 px browser font size and a UI scale of 1 (see below). In both
themes the text, the accent and the status colours have a contrast of at least 4.5:1 on every
surface, and `--aek-border-control` and the focus ring 3:1 (WCAG AA).

### Themes and density

The colours have a dark and a light theme. A kit root is dark, or light when the player's system
prefers light; `data-aek-theme="dark"` or `"light"` on any element forces its subtree's theme.
The theme sets `color-scheme` too, so the browser's own scrollbars and form controls follow it:

```ts
getHUDRootCMP().updateAttr({ 'data-aek-theme': 'light' }); // The whole HUD
settingsPanel.updateAttr({ 'data-aek-theme': 'dark' }); // One panel in it
```

`data-aek-density="compact"` on any element makes the type and space scales smaller in its
subtree (12 px text and tighter spacing at the defaults), for dense panels.

::: note The kit's own colours come later
The windows and dialogs, the drop-downs, the tooltips and the popovers follow the themes and
densities. The toasts keep their own colours for now: a later version moves them onto the tokens.
The UI scale, the font size, the fonts, reduced motion and the focus ring below apply to the
whole kit already.
:::

### UI scale and font size

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

### Fonts

The kit's text is in the system's UI font unless you opt into the kit's own, IBM Plex Sans and
IBM Plex Mono:

```ts
import 'aekasha/ui/fonts';
```

- The full-page template and the debug tools import it; an embed or an app of your own chooses.
- The entry exports nothing: it's a stylesheet. The font files load later: a browser fetches a
  face only when text uses it, and the sans is one variable file for every weight.
- To use a font of your own, set the family tokens on the kit root in your stylesheet. A plain rule
  of yours beats both the default and the opt-in:

```css
.aekUi {
  --aek-font-sans: 'Your Font', system-ui, sans-serif;
}
```

### Motion, focus and layers

- **Reduced motion:** the kit's transitions and the toaster's animations take their durations from
  the motion tokens, which are 0 when the player's system asks for reduced motion. Set
  `--aek-motion: 0` on the kit root to turn them off from a setting of your own. Your own
  transitions follow too when they use the tokens; for an animation timed in code, multiply its
  durations by [`getMotionFactor`](api:getMotionFactor). A component's `anim` phases don't scale
  on their own, since an animation can carry meaning: scale the ones that shouldn't play.
- **Focus:** keyboard focus under a kit root shows a ring in the accent colour (`:focus-visible`,
  so a click shows none). Don't remove `outline` in your styles; change the ring with its tokens.
- **Cascade layers:** the tokens are in the layer `aek.tokens` and the focus ring in `aek.base`, so
  any rule of yours beats them, whatever its specificity. The components' own styles aren't in a
  layer yet: override them with a class.

::: tip In an embed
An engine [mounted into a host page](hub:features/smallest-build#embedding) shows the kit as the
full page does: its sizes come from the browser's font size, not the host's root, and windows,
dialogs and toasts stay inside the mount's container. A window's `%` position and size are of the
container; `vw` and `vh` are the browser window's, as in CSS.
:::

## Key APIs

- [`CMP`](api:CMP), [`CMPHandle`](api:CMPHandle), [`CMPProps`](api:CMPProps),
  [`getHUDRootCMP`](api:getHUDRootCMP), [`createHudRoot`](api:createHudRoot) and
  [`hasHudRoot`](api:hasHudRoot).
- [`createDropDown`](api:createDropDown) ([`DropDownProps`](api:DropDownProps)).
- The components: [Core components](hub:features/ui-kit/core#key-apis) and
  [Windows and overlays](hub:features/ui-kit/overlays#key-apis).
- [`aekasha/ui/fonts`](hub:documentation/aekasha/ui/fonts): the kit's fonts, a stylesheet entry.

## Read more

- [The UI kit example](hub:examples/ui-kit): every piece in one scene.
- [The component library](hub:features/ui-kit/library): every piece in every state, in both
  themes and densities.
- The API reference: [`aekasha/ui`](hub:documentation/aekasha/ui).

::: claude-md
:::
