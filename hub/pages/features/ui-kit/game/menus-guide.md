## Spatial navigation

A gamepad has no Tab key: its d-pad moves the focus up, down, left and right.
[`createSpatialNavigation`](api:createSpatialNavigation) does that among the tab stops under a
root, by where they are on the screen, and reads the arrow keys itself. It's a behaviour on a
root, not a component: `dispose()` removes it.

```ts
const navigation = createSpatialNavigation({ root: panel, onBack: () => closePanel() });
navigation.focus();
// The app's menu map, in its MENU context
menuMap.onPressed('down', () => navigation.move('down'));
menuMap.onPressed('back', () => navigation.back());
menuMap.onPressed('nextTab', () => navigation.nextGroup());
```

::: demo spatialNavigation
:::

- **By position.** The next element is the one ahead in that direction with the smallest distance
  along it plus twice the gap across it. `wrap` goes round at an edge.
- **Focus groups.** An element with `data-aek-focus-group` is a group: a move stays in the focused
  element's group first, then goes to the nearest group's last focused element. `nextGroup` and
  `previousGroup` jump between groups (a shoulder button).
- **An override.** `data-aek-nav-up` (`-down`, `-left`, `-right`) names the id to go to, where
  the layout picks a surprising neighbour.
- **Composites keep their arrows.** A tab list, a radio group, a slider, a grid or a text field
  uses the arrow keys itself; `move` (the gamepad's) walks it and leaves it from its edge.
- **Back.** Escape and `back()` call `onBack`, or without it close the topmost overlay.

| Spatial navigation |                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------ |
| Props              | [`SpatialNavigationProps`](api:SpatialNavigationProps), [`NavigationDirection`](api:NavigationDirection)    |
| Attributes         | `data-aek-focus-group` on a group's element, `data-aek-nav-<direction>` (an id) on an element              |
| Keys               | ↑ ↓ ← → (`handleKeys`, default on), Escape with `onBack`                                                    |
| Assistive tech     | Moves the real focus (`focusVisible`); adds no ARIA                                                         |

## Radial menus

[`createRadialMenu`](api:createRadialMenu) puts items round a ring over the HUD (an emote wheel,
quick items), opened while a key or a shoulder button is held.

```ts
const wheel = createRadialMenu({
  label: 'Emotes',
  items: [
    { id: 'wave', label: 'Wave', icon: 'wave', description: 'Say hello' },
    { id: 'dance', label: 'Dance', disabled: true, description: 'Not learnt yet' },
  ],
  onSelect: (id) => playEmote(id),
});
getHUDRootCMP().add(wheel.cmp);
// Held: open; each frame the stick; released: pick
map.onPressed('radial', () => wheel.open());
wheel.setDirection(stick.x, stick.y);
map.onReleased('radial', () => wheel.select() || wheel.close());
```

::: demo radialMenu
:::

- **Picking.** The pointer's angle from the centre highlights an item (item 0 at the top,
  clockwise) and a click picks it; a stick's `setDirection(x, y)` (the Gamepad API's axes, y down)
  highlights past a dead zone and keeps it inside, so `select()` on the release picks it; the arrow
  keys go round and Enter picks.
- **Closing.** Escape, Tab, a click on the centre, or `close()`. It opens with nothing
  highlighted, so a stick's release right after opening picks nothing.
- The centre shows the highlighted item's label and description.

| Radial menu       |                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Props             | [`RadialMenuProps`](api:RadialMenuProps), [`RadialMenuItem`](api:RadialMenuItem)                                         |
| Parts             | `.aekRadialMenu` (the layer) holding `__ring` of `__item`s (`__icon`, `__label`, `__description`) and `__centre`         |
| Custom properties | `--aek-radial-menu-radius`, `--aek-radial-menu-centre-size`, `--aek-radial-menu-highlight-color`, `--aek-radial-menu-z`  |
| Keys              | ← → ↑ ↓ round the ring, Enter and Space pick, Escape and Tab close                                                       |
| Assistive tech    | A `role="menu"` named by `label`, each item a `menuitem` (the real focus on the highlighted one, `aria-disabled`, its description) |

## Game menus

[`createGameMenu`](api:createGameMenu) is a pause menu or a title screen: large buttons in a modal
panel (or full screen), which the keyboard, the mouse and a gamepad all move through. An item runs
or opens a page: more items, or your content (a settings menu, an inventory).

```ts
const pause = createGameMenu({
  title: 'Paused',
  onBack: () => pause.close(), // without onBack the first page has no Back (a title screen)
  items: [
    { id: 'resume', label: 'Resume', onSelect: () => pause.close() },
    { id: 'settings', label: 'Settings', page: { title: 'Settings', content: settings.cmp } },
    { id: 'quit', label: 'Quit to the title', onSelect: () => quit() },
  ],
  onOpen: () => setActionContextEnabled('GAMEPLAY', false),
  onClose: () => setActionContextEnabled('GAMEPLAY', true),
});
map.onPressed('menu', () => pause.open());
```

::: demo gameMenu
:::

- **Modal.** Its panel is a dialog on the overlay stack: the focus trapped inside, the rest of the
  HUD inert, the focus back where it was on close.
- **Back.** Escape, the Back button and `back()` go to the page before (the focus on the item
  that opened it), then call `onBack`. A gamepad's `EAST` calls `back()`; its d-pad
  `menu.navigation.move` (the menu's [spatial navigation](#spatial-navigation)).
- **Pages.** A page with a CMP `content` is kept between opens; an items page or a function's
  content is made on each open and removed on Back.
- `footer` is a CMP beside Back: input prompts for Select and Back.

| Game menu         |                                                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Props             | [`GameMenuProps`](api:GameMenuProps), [`GameMenuItem`](api:GameMenuItem), [`GameMenuPage`](api:GameMenuPage)                         |
| Parts             | `.aekGameMenu` (`data-layout`) holding `__panel` (`__title`, `__body` of `__page`s with `__items` of `__item`s, `__footer` with `__back`) |
| Custom properties | `--aek-game-menu-width`, `--aek-game-menu-bg`, `--aek-game-menu-backdrop`, `--aek-game-menu-item-font-size`, `--aek-game-menu-z`     |
| Keys              | ↑ ↓ ← → by position, Enter and Space, Escape back, Tab inside the panel                                                              |
| Assistive tech    | A `role="dialog"`, `aria-modal`, named by its title; a page a group named by its title; a disabled item `aria-disabled` with its description |

## Settings menus

[`createSettingsMenu`](api:createSettingsMenu) is a game's settings: pages on tabs, each a
[property grid](hub:features/ui-kit/forms#property-grids) of items bound to your settings object,
so the display, audio and subtitle settings are data. It reports each change; you save it.

```ts
const prefs = { uiScale: 1, subtitles: true, music: 70 };
const settings = createSettingsMenu({
  pages: [
    {
      key: 'display',
      label: 'Display',
      items: [
        { target: prefs, key: 'uiScale', label: 'UI scale', default: 1, min: 0.75, max: 1.5, step: 0.05 },
        { target: prefs, key: 'subtitles', label: 'Subtitles', kind: 'switch', default: true },
      ],
    },
    { key: 'audio', label: 'Audio', items: [{ target: prefs, key: 'music', label: 'Music', default: 70, min: 0, max: 100 }] },
  ],
  onChange: ({ change }) => {
    setKitPreferences({ uiScale: prefs.uiScale });
    if (change.last) save(prefs); // a drag's end, a pick: not every step
  },
  onReset: () => save(prefs),
});
```

::: demo settingsMenu
:::

- **Resets.** "Reset page" and "Reset all" put each item's `default` back (and call a page's
  `onReset`, the controls page's reset); "Reset all" asks first, in its own place, with the focus
  on Cancel. Each field a reset changes is reported, then `onReset` once.
- **Changed elsewhere.** `refresh()` reads every page again, shown or not.
- **A gamepad.** The tabs are a tab list: `selectNext(±1)` for the shoulder buttons.
- Inline content: a [game menu's](#game-menus) page or a window's.

| Settings menu     |                                                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| Props             | [`SettingsMenuProps`](api:SettingsMenuProps), [`SettingsPage`](api:SettingsPage), [`SettingsChange`](api:SettingsChange) |
| Parts             | `.aekSettingsMenu` (`data-orientation`) holding the tabs (`.aekTabs`), a `__page` per page and `__actions` (`__resetPage`, `__resetAll`, the question's `__confirm`) |
| Custom properties | `--aek-settings-menu-gap`; the tabs' and the property grid's                                                     |
| Keys              | The tabs' and the fields' own                                                                                    |
| Assistive tech    | The tabs' and the fields'; a reset from its button announced ("Display reset to defaults")                     |

## Controls pages

[`createControlsPage`](api:createControlsPage) lets the player rebind an action map: a row per
action, a column per device (the keyboard and mouse, a gamepad), a slot per binding. Enter or a
click waits for the next key, mouse button or gamepad button; you apply and save what it reports.

```ts
const controls = createControlsPage<ActionBinding>({
  actions: Object.keys(map.actions).map((id) => ({
    id,
    name: map.actions[id].name ?? id,
    type: map.actions[id].type,
    bindings: map.getBindings(id),
  })),
  onRebind: ({ action, bindings }) => {
    map.setBindings(action, bindings); // the action's whole new list
    save(action, bindings);
  },
  // A gamepad's press reaches the action maps too: the menu's map off while it waits
  onCaptureChange: (capturing) => setActionContextEnabled('MENU', !capturing),
});
```

::: demo controlsPage
:::

- **The capture.** Escape cancels (and can't be bound), and so do a press of the other device,
  the window losing the focus and `captureTimeoutMs` (8 s: a gamepad has no Escape). The key it
  takes goes no further: no action map, overlay or game control sees it.
- **Conflicts.** Another action's input asks under the row: Swap (the other action gets the old
  input), Keep both, or Cancel. `group` limits the search to the actions of one group.
- **Parts.** A keyboard axis has a slot per side, a composite (W A S D) one per direction; a stick
  and an action with `rebindable: false` are shown, not rebound.
- **Reset to defaults** (`showReset`; in a settings menu its page's `onReset` calls `reset()`)
  reports each action that differs from its `defaults`.
- The gamepad column's labels follow the [prompts'](#input-prompts) family; `setFamily` fixes
  them. Its texts are one `texts` object, for your language.

| Controls page     |                                                                                                                                           |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Props             | [`ControlsPageProps`](api:ControlsPageProps), [`ControlsAction`](api:ControlsAction), [`ControlsRebind`](api:ControlsRebind)             |
| Parts             | `.aekControlsPage` holding `__table` (a `__row` per action: `__action`, a `__cell` per column with `__bind` slots), `__conflictRow`, `__footer` (`__reset`) |
| States            | A slot's `data-capturing`, `data-empty`, `data-part`                                                                                      |
| Custom properties | `--aek-controls-page-capture-color`                                                                                                       |
| Keys              | Enter or Space on a slot captures; Escape cancels; the conflict's buttons                                                                 |
| Assistive tech    | A native table, each slot named by its action, column, part and input; the capture's start and its result announced                     |
