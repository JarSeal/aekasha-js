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

::: demo window
:::

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

### Keys and assistive tech

Every pointer action on a window has a key. A window is a `dialog` named by its title (or by
`ariaLabel` when it has none), and its header is a tab stop with its keys described:

| Key           | Where                | Does                                                                     |
| ------------- | -------------------- | ------------------------------------------------------------------------ |
| Arrows        | the header           | Moves the window a step (16 px at the defaults)                          |
| Alt+arrows    | the header           | Resizes it (left and up shrink)                                          |
| Shift         | with either          | Four steps at once                                                       |
| Enter         | the header           | Collapses or expands it                                                  |
| F6 / Shift+F6 | anywhere on the page | Moves the focus to the next / previous window and brings it to the front |

F6 goes through the open windows in the order they were opened, the app's first and then the
debug tools', from the canvas as well as from inside a window. In an embed it works inside the
mount's container only, so the host page keeps its own F6. If your game binds F6, move the cycle
keys or turn them off:

```ts
import { setWindowCycleKeys } from 'aekasha/ui';

setWindowCycleKeys({ next: 'Ctrl+F6', previous: 'Ctrl+Shift+F6' }); // or null: none
```

The collapse and close buttons have their labels and tooltips, a title cut by the window's width
shows whole in a tooltip, and a content with no control in it is a tab stop itself, so it scrolls
with the keys too.

| Window            |                                                                                                                                                                                                    |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Props             | [`OpenDraggableWindowProps`](api:OpenDraggableWindowProps)                                                                                                                                         |
| Parts             | `.aekWindow` with `__header`, `__title`, `__button` (`__collapse`, `__close`), `__content` and the resize handles `__resizeV`, `__resizeH`, `__resizeHV`; a dialog's backdrop `.aekWindowBackdrop` |
| States            | `data-state="collapsed"` / `"expanded"`, `data-draggable`, `data-resizable`, `data-resizing`                                                                                                       |
| Custom properties | `--aek-window-header-height`, `--aek-window-radius`, `--aek-window-bg`, `--aek-window-header-bg`, `--aek-window-border-color`, `--aek-window-shadow`, on the window or any ancestor                |

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

::: demo dialog
:::

A dialog takes the focus when it opens and gives it back when it closes. With `closeOnEscape`,
Escape pressed inside the HUD closes the top dialog, and nothing else gets that press or its
release: no key binding or action map sees it. So Escape can open the menu through an action map
and close it through the dialog. A menu that turns gameplay input off while it's open does it
with [action contexts](hub:features/input#contexts-and-scenes).

A dialog is modal: assistive tech reads it as a modal dialog named by its title, Tab and Shift+Tab
stay inside it, and the rest of the HUD is `inert` until it closes (nothing outside the HUD: an
embed's host page stays live). `alert: true` makes it an alert dialog, for a question that needs an
answer, and `initialFocus` names the element that takes the focus, its safe choice:

```ts
openDialog({
  id: 'deleteSave',
  title: 'Delete the save?',
  alert: true,
  initialFocus: '.cancelButton',
  content: () => createConfirmPanel(),
  size: { w: 360, h: 200 },
});
```

| Dialog         |                                                                                                    |
| -------------- | -------------------------------------------------------------------------------------------------- |
| Props          | [`DialogProps`](api:DialogProps): a window's, without moving, resizing or collapsing               |
| Parts          | A window's (`.aekWindow` and its parts) over `.aekWindowBackdrop`                                  |
| Keys           | Tab and Shift+Tab wrap inside it; Escape closes it with `closeOnEscape`, and otherwise stops there |
| Assistive tech | `role="dialog"` (`"alertdialog"` with `alert`), `aria-modal="true"`, named by its title            |

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

::: demo toaster
:::

The first toaster made is the default one for a toast without a `toasterId`; in debug mode that's
the engine's, so name yours on each toast (or make it the default with `setAsDefaultToaster`).
[`removeToaster`](api:removeToaster) takes it away with its toasts.

A toast's `type` (`info`, `success`, `warning`, `alert`) gives it its status colour and icon, and
a screen reader reads its title and message once (an alert at once, the others when it's idle).
Its showing time pauses while the player hovers it or its close button holds the focus, and while
the page is hidden; Escape with the focus in it closes it. Under reduced motion toasts fade in
place instead of sliding.

| Toast             |                                                                                                                               |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Props             | [`ToasterProps`](api:ToasterProps) (its `settings`: [`ToasterSettings`](api:ToasterSettings)), [`ToastProps`](api:ToastProps) |
| Parts             | `.aekToaster`; each `.aekToast` with `__icon`, `__content`, `__title`, `__message`, `__close`                                 |
| States            | `data-type` (the kind), `data-phase` (`entering`, `appearing`, `showing`, `removing`)                                         |
| Custom properties | `--aek-toast-min-width`, `-max-width`, `-min-height`, `-max-height` (the settings' sizes, on the toaster), `--aek-toast-time` |
| Keys              | Tab reaches the close button; Escape with the focus in a toast closes it                                                      |
| Assistive tech    | Two live regions per toaster read each toast once: `role="status"`, and `role="alert"` for an alert                           |

## Tooltips

A [tooltip](api:createTooltip) is a short text that describes a control. It shows after
`--aek-tooltip-delay` (500 ms) of hover and at once when the control gets the focus from the
keyboard, and it hides when the pointer leaves (it can move onto the tooltip), on blur, on a press
and on Escape. It's never interactive. Its anchor's `aria-describedby` names it, so a screen reader
reads it as the control's description.

```ts
const save = toolbarPanel.add({ tag: 'button', text: 'Save' });
const saveTip = createTooltip({ anchor: save.elem, text: 'Saves the scene (Ctrl+S)' });
// When the button goes: its listeners and ARIA go with the tooltip
saveTip.cmp.remove();
```

::: demo tooltip
:::

An icon button's tooltip that only repeats its `aria-label` describes nothing more, so it isn't
named in `aria-describedby`. `onlyWhenTruncated: true` shows a label's whole text only while an
ellipsis cuts it (the windows' titles use it). A kit button or link takes a `tooltip` prop instead.

| Tooltip           |                                                            |
| ----------------- | ---------------------------------------------------------- |
| Props             | [`TooltipProps`](api:TooltipProps)                         |
| Parts             | `.aekTooltip`, in the HUD root while it shows              |
| States            | `data-side` (where it opened)                              |
| Custom properties | `--aek-tooltip-delay`, on the anchor or any ancestor       |
| Keys              | Shown on a keyboard focus at once; Escape hides it         |
| Assistive tech    | `role="tooltip"`; the anchor's `aria-describedby` names it |

## Popovers

A [popover](api:createPopover) holds interactive content next to its trigger, which opens and
closes it. The focus moves in when it opens. Escape closes it and gives the focus back to the
trigger, and a press outside it, or the focus leaving it, closes it. `content` can be a function,
built again on every open.

```ts
const filters = toolbarPanel.add({ tag: 'button', text: 'Filters' });
createPopover({ anchor: filters.elem, label: 'Filters', content: () => createFiltersPanel() });
```

::: demo popover
:::

| Popover        |                                                                                                                 |
| -------------- | --------------------------------------------------------------------------------------------------------------- |
| Props          | [`PopoverProps`](api:PopoverProps)                                                                              |
| Parts          | `.aekPopover`, in the HUD root while it's open                                                                  |
| Keys           | The trigger's click, Enter or Space toggles it; the focus moves in; Escape closes it and returns the focus      |
| Assistive tech | A non-modal `role="dialog"` named by `label`; the trigger has `aria-haspopup`, `aria-expanded`, `aria-controls` |

## Menus and split buttons

[`createMenu`](api:createMenu) gives a button a menu: actions, on / off items, one-of choices,
named groups and separators. It works from the keyboard as menus do everywhere: Enter, Space or
ArrowDown opens it, the arrows move, a typed letter jumps, Enter picks, Escape closes, and the
focus goes back to the button. Pass the items as a function to read your state on every open.

```ts
const view = createButton({ label: 'View' });
toolbarPanel.add(view.cmp);
createMenu({
  anchor: view.cmp.elem,
  items: () => [
    { label: 'Reset camera', kbd: createKbd({ keys: 'Home' }), onSelect: () => resetCamera() },
    {
      type: 'checkbox',
      label: 'Grid',
      checked: settings.grid,
      onCheckedChange: (on) => (settings.grid = on),
    },
    {
      type: 'radio',
      label: 'Shading',
      value: settings.shading,
      options: [
        { value: 'lit', label: 'Lit' },
        { value: 'wire', label: 'Wireframe' },
      ],
      onValueChange: (value) => (settings.shading = value),
    },
  ],
});

// An action and its variants
const save = createSplitButton({
  label: 'Save',
  onClick: () => saveGame(),
  items: [{ label: 'Save as…', onSelect: () => openSaveAsDialog() }],
});
```

::: demo menu
:::

An action's `onSelect` runs after the menu closed, so a dialog it opens gives the focus back to
the menu's button when it closes. An item's `kbd` is a key hint you make with `createKbd`, which
the menu removes: a getter's at each close (the getter makes new ones on the next open), an
array's with the menu.

| Menu           |                                                                                                                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Props          | [`MenuProps`](api:MenuProps) (its items: [`MenuItem`](api:MenuItem)), [`SplitButtonProps`](api:SplitButtonProps)                                                                                             |
| Parts          | `.aekMenu` with `__item` (`__icon`, `__label`, `__kbd`, `__check`), `__group`, `__separator`; a split button is `.aekButtonGroup.aekSplitButton`                                                             |
| Keys           | On the trigger: Enter, Space, ArrowDown open on the first item, ArrowUp on the last. In it: the arrows (wrapping), Home, End, typed letters, Enter picks, Space flips a checkable item, Escape and Tab close |
| Assistive tech | `role="menu"` of `menuitem`, `menuitemcheckbox` and `menuitemradio`; the trigger has `aria-haspopup="menu"` and `aria-expanded`                                                                              |

## Escape, focus and stacking

Every open overlay (a dialog, a drop-down's list, a tooltip, a popover, a menu, a toast holding
the focus) is on one stack, and the kit keeps the same rules for all of them:

- **Escape goes to the topmost overlay only**, in the order they opened: a drop-down's list open in
  a dialog closes first, and the next Escape closes the dialog. The press and its release reach
  nothing else, no key binding or action map, so the same key can open a menu through your input
  and close it through the kit.
- **Only inside the HUD:** Escape pressed outside it (a page that embeds the engine) is the page's.
- **The focus comes back:** a closed overlay gives the focus back to what had it when it opened,
  if that's still in the page. A press outside a popover or a menu, or the focus moving away,
  closes it and leaves the focus where it went.
- **Nothing clips them:** the drop-down's list, the tooltip, the popover and the menu open in the
  browser's top layer, on their side when they fit there and else the other, kept inside the page
  or an embed's container. Where the browser has no top layer they open at the HUD root's top.
- **The layers:** the app's windows, then a loading overlay over the HUD, then the app's dialogs,
  the debug tools' windows and dialogs, the toasts and the tooltips (`--aek-z-*`, in the
  [styling tokens](hub:features/ui-kit/styling#the-tokens-the-whole-look)). An app's modal dialog leaves
  the debug tools usable, so a pause menu can still be debugged.

## Key APIs

- [`openDraggableWindow`](api:openDraggableWindow) ([`OpenDraggableWindowProps`](api:OpenDraggableWindowProps)),
  [`closeDraggableWindow`](api:closeDraggableWindow),
  [`toggleDraggableWindow`](api:toggleDraggableWindow),
  [`updateDraggableWindow`](api:updateDraggableWindow),
  [`registerDraggableWindowKind`](api:registerDraggableWindowKind),
  [`getKindWindowId`](api:getKindWindowId) and [`setWindowCycleKeys`](api:setWindowCycleKeys).
- [`openDialog`](api:openDialog) ([`DialogProps`](api:DialogProps)).
- [`createToaster`](api:createToaster), [`addToast`](api:addToast) and
  [`removeToast`](api:removeToast).
- [`createTooltip`](api:createTooltip) ([`Tooltip`](api:Tooltip)) and
  [`createPopover`](api:createPopover) ([`Popover`](api:Popover)).
- [`createMenu`](api:createMenu) ([`MenuItem`](api:MenuItem)) and
  [`createSplitButton`](api:createSplitButton).

## Read more

- [The UI kit](hub:features/ui-kit): components, the HUD root, styling.
- [Core components](hub:features/ui-kit/core): the buttons and the pieces in your panels.
- [The component library](hub:features/ui-kit/library): every piece in every state.
- [Input](hub:features/input#contexts-and-scenes): the action contexts a menu switches.

::: claude-md
:::
