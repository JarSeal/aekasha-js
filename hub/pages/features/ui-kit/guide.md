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
(see [Styling](hub:features/ui-kit/styling#the-tokens-the-whole-look)), which the engine's boot makes. [`getHUDRootCMP`](api:getHUDRootCMP)
returns it, and each panel added under it places itself. The windows, dialogs, toasts and the
overlays open in it too.

In debug mode, the editor views (the material editor) hide the HUD root's children, except one
with [`KEEP_IN_VIEWS_CLASS`](api:KEEP_IN_VIEWS_CLASS).

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

Every component brings its own styles with its module, on the kit's design tokens: a dark and a
light theme, a compact density, a UI scale that follows the player's browser font size, and
reduced motion. Restyle it in plain CSS, in three ways from the broadest: the tokens, a
component's custom properties, and rules on its parts. The kit's styles are in a cascade layer
with no specificity, so any rule of yours wins. [Styling the UI kit](hub:features/ui-kit/styling)
has each way, the tokens, the themes, the fonts and a worked example.

## In a build

A build carries only the pieces the app imports, with their styles, and loads them with the code
that uses them. From the last `yarn sbp` report (gzip), for the `uiKit` embed profile, a scene
with a window, a dialog, a toast, a button, a drop-down and a tooltip over one box:

- **The kit in the first download:** {{sbp:uiKit.group:_engine/ui}}: the HUD root and CMP, which
  the engine's boot needs.
- **What that HUD costs,** loaded with its scene: {{sbp:uiKit.chunk:assets/uiKitEmbed.js}} of
  code (the six pieces, the overlay layer and the scene's own code) and
  {{sbp:uiKit.chunk:assets/uiKitEmbed.css}} of styles.

The [smallest build](hub:features/smallest-build) page shows how the numbers are measured and
kept under their budgets.

## Key APIs

- [`CMP`](api:CMP), [`CMPHandle`](api:CMPHandle), [`CMPProps`](api:CMPProps),
  [`getHUDRootCMP`](api:getHUDRootCMP), [`createHudRoot`](api:createHudRoot) and
  [`hasHudRoot`](api:hasHudRoot).
- [`createDropDown`](api:createDropDown) ([`DropDownProps`](api:DropDownProps)).
- The components: [Core components](hub:features/ui-kit/core#key-apis) and
  [Windows and overlays](hub:features/ui-kit/overlays#key-apis).
- [`KIT_ROOT_CLASS`](api:KIT_ROOT_CLASS) and the tokens: [Styling the UI kit](hub:features/ui-kit/styling).

## Read more

- [The UI kit example](hub:examples/ui-kit): every piece in one scene.
- [The component library](hub:features/ui-kit/library): every piece in every state, in both
  themes and densities.
- The API reference: [`aekasha/ui`](hub:documentation/aekasha/ui).

::: claude-md
:::
