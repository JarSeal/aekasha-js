## Lists

[`createList`](api:createList) shows your items as rows. You pass the items and a function per
part: its `title`, and optionally an `icon`, a `badge`, a `subTitle` above the title, a
`description` under it, a `suffix` at the row's end and a `tooltip`. Each row is kept by its key
(`getKey`, by default the item's `id`), so new items write only the parts whose text changed.

```ts
type Light = { id: string; name: string; kind: string; visible: boolean };

const lights = createList<Light>({
  heading: 'Lights', // with the count: "Lights 12", "Lights 3 of 12" while filtered
  items: () => getSceneLights(), // a function: read again on refresh and on the scheduler
  title: (light) => light.name,
  badge: (light) => light.kind,
  selection: 'single',
  onActivate: (light) => openLightWindow(light.id), // a click or Enter
  actions: [
    {
      key: 'visible',
      label: 'Visible',
      icon: getSvgIcon('lightBulb'),
      pressed: (light) => light.visible, // a toggle: aria-pressed
      onPress: (light) => setLightVisible(light.id, !light.visible),
    },
  ],
  filter: { field: true },
  empty: 'No lights in this scene',
  scheduler, // the panel's: read every 500 ms while it shows
  interval: 500,
});
lightsPanel.add(lights.cmp);
```

::: demo list
:::

- **Three kinds.** With no `selection`, `onActivate` or `actions` it's a plain list (`<ul>`), for
  rows to read. With a `selection` (`'single'` or `'multiple'`) or an `onActivate` it's a listbox:
  one tab stop, the arrows between the rows. With `actions`, a button on every row (a visibility
  toggle, a lock), it's a grid: each row's content and its buttons are its cells, Left and Right
  move between them.
- **Selecting and activating.** A click or Space selects; a click or Enter activates
  (`onActivate`: open the object's window), which selects in a single selection too. With
  `'multiple'`, Ctrl / ⌘ + click and Space toggle a row, Shift + click or Shift + an arrow
  selects the range from the last row picked, and Ctrl / ⌘ + A every row (again: none).
  `onSelectionChange` gets the user's changes and the selected rows the items lost; `setSelected`
  sets it from code without calling it. Keeping the selection across visits is yours.
- **Actions.** An action's `pressed` makes it a toggle, read again after each press, so an
  `onPress` that changes the item in place shows the change; `iconOff` is its icon while not
  pressed. `hidden` leaves a row's cell empty, keeping the other buttons aligned, and `disabled`
  disables it (a disabled row's actions are disabled too).
- **Filtering.** `filter` shows only the rows matching a query: by default every word of it is
  in the row's text (the title, sub title, description, suffix and badge), case and accents
  ignored, the matches marked. `field: true` puts a search field above the list (ArrowDown enters
  the list, Escape empties it); without it, call `setQuery` from a search box of your own.
  `match` replaces the matching, and the count ("3 of 12", "No matches for …") is announced to
  screen readers.
- **Live data.** `setItems` replaces the items, `setItem(key, item)` one of them: a figure that
  changes every frame writes one text node. Give `items` as a function and a `scheduler` (with
  `interval` for a live list) and the list reads it on the scheduler's tick while it shows.
- **A context menu** is yours to add, over the whole list: `createContextMenu` on `cmp.elem`,
  finding the row with `getKeyAt` (a list without one carries none of the menu's code).

```ts
createContextMenu({
  target: lights.cmp.elem,
  items: (elem) => {
    const key = lights.getKeyAt(elem); // the row right-clicked or focused
    return key ? [{ label: 'Focus', onSelect: () => focusLight(key) }] : [];
  },
});
```

| List              |                                                                                                                                                                                                                                                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Props             | [`ListProps`](api:ListProps), an action's [`ListAction`](api:ListAction), the filter's [`ListFilter`](api:ListFilter)                                                                                                                                                                                                                |
| Parts             | `.aekList` with `__header` (`__heading`, `__headingText`, `__count`), `__filter` (`__search`), `__rows`, each `__row` (`__main` in a grid, `__content`: `__icon`, `__badge`, `__text` with `__subTitle`, `__title`, `__description`; `__suffix`; a grid's `__actionCell` and `__action`), `__empty`, `__noMatch` (`__clear`); the matches' `.aekMark` |
| States            | the rows' `data-mode` (`static`, `listbox`, `grid`); a row's `data-key`, `aria-selected`, `aria-disabled` (`data-disabled` in a plain list), `hidden` while filtered out; a title's `data-placeholder`; an action's `aria-pressed`, `disabled`, `hidden`                                                                             |
| Custom properties | `--aek-list-max-height` (the rows' box scrolls past it), `--aek-list-selected-color` (the selected row's bar)                                                                                                                                                                                                                         |
| Keys              | One tab stop; Up and Down between the shown rows (no wrapping), Home, End, PageUp, PageDown, a letter to the next title starting with it; Space selects, Enter activates; Shift + a move, Ctrl / ⌘ + A (multiple); Left and Right between a grid row's cells; the search field's ArrowDown into the list and Escape empties it        |
| Assistive tech    | `role="listbox"` of `option`s (`aria-multiselectable`), or `role="grid"` of `row`s and `gridcell`s, named by the heading or `label`; `aria-selected`, `aria-disabled`; a toggle's `aria-pressed`; the filter's count read politely                                                                                                   |

## Key APIs

- [`createList`](api:createList) ([`List`](api:List), [`ListProps`](api:ListProps),
  [`ListAction`](api:ListAction), [`ListFilter`](api:ListFilter)).
- [`createContextMenu`](api:createContextMenu) for a menu over the rows, and
  [`createBindingScheduler`](api:createBindingScheduler) for a panel's live lists.

## Read more

- [The UI kit](hub:features/ui-kit): components, the HUD root, styling.
- [Core components](hub:features/ui-kit/core): the badges, the tabs and the empty states a list
  sits among.
- [Windows and overlays](hub:features/ui-kit/overlays): the context menu.
- [The component library](hub:features/ui-kit/library): every piece in every state.
