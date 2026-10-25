## The pieces

| Piece          | Made with                                                          | For                                                           |
| -------------- | ------------------------------------------------------------------ | ------------------------------------------------------------- |
| Component      | [`CMP`](api:CMP)                                                   | Any element: a panel, a button, a readout                     |
| HUD root       | [`getHUDRootCMP`](api:getHUDRootCMP)                               | Where the app's UI goes, over the canvas                      |
| Window         | [`openDraggableWindow`](api:openDraggableWindow)                   | A panel the player moves, resizes, collapses and closes       |
| Window kind    | [`registerDraggableWindowKind`](api:registerDraggableWindowKind)   | One window per thing (an entity, an item), each with its data |
| Dialog         | [`openDialog`](api:openDialog)                                     | A modal window over a backdrop: a pause menu, a confirmation  |
| Drop-down      | [`createDropDown`](api:createDropDown)                             | A choice from a list, with the keyboard                       |
| Toaster, toast | [`createToaster`](api:createToaster), [`addToast`](api:addToast)   | Short messages that come and go                               |
| Icon           | [`registerIcon`](api:registerIcon), [`getSvgIcon`](api:getSvgIcon) | SVG icons by name, in the text colour                         |

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

## Windows

A draggable window has a header to drag, collapse and close it, and resize handles. Opening an id
again reopens or updates that window, and a reopen keeps where the player left it.

```ts
import { openDraggableWindow } from 'aekasha/ui';

openDraggableWindow({
  id: 'inventory',
  title: 'Inventory',
  content: () => createInventoryPanel(), // Built on every mount
  position: { x: 200, y: 72 }, // px: the top left corner; a % position is its centre
  size: { w: 360, h: 480 },
  closeOnSceneChange: true,
});
```

- [`closeDraggableWindow`](api:closeDraggableWindow) keeps its state, so a reopen restores the
  layout; [`removeDraggableWindow`](api:removeDraggableWindow) drops it.
- `saveToLS` keeps a window in the browser's storage: open after a reload, where it was. Its
  content then comes from a registered content function, since a function can't be stored.
- On a scene load, `removeOnSceneChange` removes a window and `closeOnSceneChange` closes it,
  unless its kind's `sceneTargetResolver` finds what it shows in the next scene.
- [`toggleDraggableWindow`](api:toggleDraggableWindow) is a list row's click: it opens the
  window, brings it to the front when it's under another one, and closes it when it's on top.
- Double-clicking a header fits the window to the screen
  ([`fitDraggableWindowToScreen`](api:fitDraggableWindowToScreen)).
- The debug tools' windows (`isDebugWindow`) are a layer above the app's, and open only in debug
  mode.

### One window per thing: kinds

An edit window per entity, an info window per item: a window kind. Register the kind once with
what its windows share, then open each window with the kind's id for its key and the data its
content is built from.

```ts
import { getKindWindowId, registerDraggableWindowKind, toggleDraggableWindow } from 'aekasha/ui';

registerDraggableWindowKind('enemyInfo', {
  content: (data) => createEnemyPanel(data?.entityId as number),
  sceneTargetResolver: (data) => isEntityAlive(data?.entityId as number),
});

toggleDraggableWindow({
  id: getKindWindowId('enemyInfo', entityId), // 'enemyInfo_<entityId>'
  kind: 'enemyInfo',
  data: { entityId },
  title: 'Enemy',
  closeOnSceneChange: true,
});
```

- A new window of a kind opens where the kind's last one was, cascaded by the kind's open
  windows, and closing one removes it.
- [`getDraggableWindowsOfKind`](api:getDraggableWindowsOfKind) lists them (eg. to mark a list's
  open rows), and [`updateDraggableWindowsOfKind`](api:updateDraggableWindowsOfKind) rebuilds
  their content.
- A single window registers its content function with
  [`registerDraggableWindow`](api:registerDraggableWindow), by its id.

::: tip Where to register
A registration has to be in place before the engine restores the saved windows, which it does
right after your `start` function: register in `start` or in your own feature's `install`, not
at a module's top level (a module with side effects at load can't be left out of a build). A
kind whose windows aren't `saveToLS` can also be registered by the scene that opens them, as the
example does.
:::

## Dialogs

[`openDialog`](api:openDialog) is a window centred over a backdrop that dims the page and takes
its clicks. It doesn't move or resize, and every open resets it.

```ts
openDialog({
  id: 'pauseMenu',
  title: 'Paused',
  content: () => createPauseMenu(),
  size: { w: 320, h: 220 },
  closeOnEscape: true,
  onClose: () => resumeGame(),
});
```

A dialog takes the focus when it opens and gives it back when it closes. With `closeOnEscape`,
Escape pressed inside the HUD closes the top dialog, and nothing else gets that press or its
release: no key binding or action map sees it. So Escape can open the menu through an action map
and close it through the dialog. Escape goes to the topmost overlay only: a drop-down's list open
in the dialog closes first. A key pressed outside the HUD (a page that embeds the engine) is the
page's. A menu that turns gameplay input off while it's open does it
with [action contexts](hub:features/input#contexts-and-scenes).

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

## Toasts

A toaster is a fixed spot that lines toasts up. The engine makes one only in debug mode (for its
own messages), so an app that shows toasts makes its own and adds it under the HUD root.

```ts
import { addToast, createToaster, getHUDRootCMP } from 'aekasha/ui';

getHUDRootCMP().add(
  createToaster({
    id: 'gameToasts',
    settings: { verticalPosition: 'top', horizontalPosition: 'right', toastDirection: 'down' },
  })
);
addToast({ title: 'Checkpoint', message: 'Progress saved', toasterId: 'gameToasts' });
addToast({ type: 'warning', message: 'Low fuel', toasterId: 'gameToasts' });
```

The first toaster made is the default one for a toast without a `toasterId`; in debug mode that's
the engine's, so name yours on each toast (or make it the default with `setAsDefaultToaster`).
[`removeToaster`](api:removeToaster) takes it away with its toasts.

## Icons

[`registerIcon`](api:registerIcon) names an SVG and [`getSvgIcon`](api:getSvgIcon) returns it as
HTML, in the text colour. A window's `icon` takes a registered name, a drop-down's `icon` the
HTML. The kit has about 50 built-in icons (`gearIcon`, `infoIcon`, … on `aekasha/ui`).

::: note A production build registers no icons
The engine registers the built-in icons for its debug tools only (debug and prod test mode).
Register the ones your app shows with `registerIcon` (or all of them with
[`registerBuiltInIcons`](api:registerBuiltInIcons), about 10 kB gzip): an unregistered name
shows `??` and logs a warning.
:::

## Styling

The kit's components bring their own styles with their modules (a window's, a drop-down's, a
toaster's), and the engine adds the design tokens, a focus ring and two rules: the editor views'
hiding of the HUD and the icons' size. Nothing styles your page's `html` or `body` except the
full-page template's own page styles. Give your components classes of their own and style them
as usual: the drop-down's default styles have zero specificity, so any class overrides them.

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
| Layers  | `--aek-z-window`, `-debug-window`, `-dialog`, `-toast`, `-tooltip` (z-index values: 100, 20000, 30000, 31000, 32000)                                                                                                                                                                                                                                                                     |

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
The kit's windows, dialogs, drop-downs and toasts keep their own colours for now: the themes and
the colour tokens are for your own UI, and a later version moves the kit onto them. The UI scale,
the font size, the fonts, reduced motion and the focus ring below apply to the kit already.
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
- [`openDraggableWindow`](api:openDraggableWindow) ([`OpenDraggableWindowProps`](api:OpenDraggableWindowProps)),
  [`closeDraggableWindow`](api:closeDraggableWindow),
  [`toggleDraggableWindow`](api:toggleDraggableWindow),
  [`updateDraggableWindow`](api:updateDraggableWindow),
  [`registerDraggableWindowKind`](api:registerDraggableWindowKind) and
  [`getKindWindowId`](api:getKindWindowId).
- [`openDialog`](api:openDialog) and [`createDropDown`](api:createDropDown).
- [`createToaster`](api:createToaster), [`addToast`](api:addToast) and
  [`removeToast`](api:removeToast).
- [`registerIcon`](api:registerIcon) and [`getSvgIcon`](api:getSvgIcon).
- [`aekasha/ui/fonts`](hub:documentation/aekasha/ui/fonts): the kit's fonts, a stylesheet entry.

## Read more

- [The UI kit example](hub:examples/ui-kit): every piece in one scene.
- [Input](hub:features/input#contexts-and-scenes): the action contexts a menu switches.
- The API reference: [`aekasha/ui`](hub:documentation/aekasha/ui).

::: claude-md
:::
