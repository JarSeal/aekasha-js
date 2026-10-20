## The pieces

| Piece          | Made with                                                          | For                                                              |
| -------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Component      | [`CMP`](api:CMP)                                                   | Any element: a panel, a button, a readout                        |
| HUD root       | [`getHUDRootCMP`](api:getHUDRootCMP)                               | Where the app's UI goes, over the canvas                         |
| Window         | [`openDraggableWindow`](api:openDraggableWindow)                   | A panel the player moves, resizes, collapses and closes          |
| Window kind    | [`registerDraggableWindowKind`](api:registerDraggableWindowKind)   | One window per thing (an entity, an item), each with its data    |
| Dialog         | [`openDialog`](api:openDialog)                                     | A modal window over a backdrop: a pause menu, a confirmation     |
| Drop-down      | [`createDropDown`](api:createDropDown)                             | A choice from a list, with the keyboard                          |
| Toaster, toast | [`createToaster`](api:createToaster), [`addToast`](api:addToast)   | Short messages that come and go                                  |
| Icon           | [`registerIcon`](api:registerIcon), [`getSvgIcon`](api:getSvgIcon) | SVG icons by name, in the text colour                            |

## Components

A component (a CMP) is an element made from props, and its handle
([`TCMP`](api:TCMP)) adds children, updates it and removes it. It's in the page once it's added
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

With `closeOnEscape`, Escape closes the top such dialog and nothing else gets that press or its
release: no key binding or action map sees it. So Escape can open the menu through an action map
and close it through the dialog. A menu that turns gameplay input off while it's open does it
with [action contexts](hub:features/input#contexts-and-scenes).

## Drop-downs

[`createDropDown`](api:createDropDown) makes a trigger button and an in-page list (not a native
`<select>`): arrows, Home and End move, Enter, Space or a click picks, and Escape, Tab or a click
outside closes it without a change. Its keys reach no key binding. Add its `cmp` where it goes.

```ts
const quality = createDropDown({
  options: [
    { value: 'low', label: 'Low' },
    { value: 'high', label: 'High' },
  ],
  value: () => settings.quality, // Re-read on every open and refresh()
  onChange: (value) => {
    setQuality(value);
    quality.refresh(); // The trigger shows the new label
  },
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

## Styles

The kit's components bring their own styles with their modules (a window's, a drop-down's, a
toaster's), and the engine adds two global rules: the editor views' hiding of the HUD and the
icons' size. Nothing styles your page's `html` or `body` except the full-page template's own
page styles. Give your components classes of their own and style them as usual: the drop-down's
default styles have zero specificity, so any class overrides them.

In debug mode, the editor views (the material editor) hide the HUD root's children, except one
with [`KEEP_IN_VIEWS_CLASS`](api:KEEP_IN_VIEWS_CLASS).

::: warning The kit in an embed
The kit's sizes are `rem`s on the full-page template's root font size (62.5 %, so 1 rem is
10 px). An engine [mounted into a host page](hub:features/smallest-build#embedding) doesn't
load the page styles, so there the kit renders at the host's root size (1.6 × larger at the
browser's default), and windows measure the browser window, not the mount's container. No embed
profile shows kit UI yet; a later version picks units that work in both
([the issue](repo:docs/issues/ui-kit-in-an-embed.md)).
:::

## Key APIs

- [`CMP`](api:CMP), [`TCMP`](api:TCMP), [`TProps`](api:TProps) and
  [`getHUDRootCMP`](api:getHUDRootCMP).
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

## Read more

- [The UI kit example](hub:examples/ui-kit): every piece in one scene.
- [Input](hub:features/input#contexts-and-scenes): the action contexts a menu switches.
- The API reference: [CMP](hub:documentation/engine/ui/CMP) and
  [DraggableWindow](hub:documentation/engine/ui/DraggableWindow).

::: claude-md
:::
