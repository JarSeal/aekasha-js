## Buttons

[`createButton`](api:createButton) makes a native `<button>` and returns its handle, whose setters
write it in place (no rebuild), so a HUD can change it every frame. Its `variant` says what kind of
action it is: `primary` for a group's one main action, `secondary` (the default), `ghost` for a
quiet one, `danger` for a destructive one, and `link` for an action that looks like a link (a
navigation is a real link). `size` is `sm`, `md` or `lg`.

```ts
const save: Button = createButton({
  label: 'Save',
  variant: 'primary',
  kbd: createKbd({ keys: 'Ctrl+S' }), // a hint and aria-keyshortcuts; binding the key is yours
  onClick: () => {
    save.setLoading(true); // the width kept, a spinner, aria-busy, clicks ignored
    saveGameAsync().finally(() => save.setLoading(false));
  },
});
toolbarPanel.add(save.cmp);

// An icon button: the label is its accessible name and its tooltip
toolbarPanel.add(createButton({ label: 'Settings', icon: getSvgIcon('gear'), iconOnly: true }).cmp);

// A toggle (aria-pressed)
const mute = createButton({ label: 'Mute', pressed: false, onPressedChange: (on) => setMuted(on) });

// A destructive action: it acts only after the pointer, Space or Enter is held for 800 ms
createButton({
  label: 'Delete save',
  variant: 'danger',
  holdToConfirmMs: 800,
  onClick: deleteSave,
  // A click with no press (a screen reader's browse mode) can't hold: confirm another way
  onUnheldClick: () => openDeleteDialog(),
});
```

::: demo button
:::

- A hold to confirm fills across the button while it's held, and an early release cancels. Under
  reduced motion the fill steps instead of sliding: it's information, so it still shows. A click
  without a press, which is how some screen readers activate a button in their browse mode,
  can't hold: it calls `onUnheldClick`, where you confirm another way (a confirmation
  [dialog](hub:features/ui-kit/overlays#dialogs)). Without it, such a click does nothing.
- `kbd` takes a [key hint](#key-hints-and-input-glyphs) you make with `createKbd`: the button
  draws it after the label, names its keys in `aria-keyshortcuts` (a later `setKeys` included)
  and removes it with itself. A button without one carries none of the hint's code. A string
  (`kbd: 'Ctrl+S'`) still works, deprecated until engine 6.0.0: the button loads the hint's code
  for it, so the hint appears a frame later.
- `tooltip` adds a tooltip; an `iconOnly` button gets its label as one.
- An action with variants is a split button: see
  [menus and split buttons](hub:features/ui-kit/overlays#menus-and-split-buttons).

| Button            |                                                                                                                |
| ----------------- | -------------------------------------------------------------------------------------------------------------- |
| Props             | [`ButtonProps`](api:ButtonProps)                                                                               |
| Parts             | `.aekButton` with `__icon`, `__label`, `__kbd`, `__hold` (the hold's fill)                                     |
| States            | `data-variant`, `data-size`, `disabled`, `aria-pressed`, `aria-busy` (loading), `data-holding`                 |
| Custom properties | `--aek-button-radius`, `--aek-button-hold-color`                                                               |
| Keys              | Enter and Space click it; a hold to confirm acts after Space or Enter is held for `holdToConfirmMs`            |
| Assistive tech    | An icon-only button's label is its `aria-label`; `kbd` sets `aria-keyshortcuts`; a hold says "Hold to confirm" |

### Groups and toolbars

[`createButtonGroup`](api:createButtonGroup) joins buttons into a named group. With `exclusive`
its toggles are a toolbar with one pressed at a time and one tab stop: the arrows move between
the buttons, Space or Enter presses one.

```ts
const modes = ['Lit', 'Wireframe', 'Normals'];
const viewMode = createButtonGroup({
  label: 'View mode',
  buttons: modes.map((label, i) => createButton({ label, pressed: i === 0 })),
  exclusive: true,
  onChange: (index) => setViewMode(modes[index]),
});
toolbarPanel.add(viewMode.cmp);
```

::: demo buttonGroup
:::

| Button group   |                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------- |
| Props          | [`ButtonGroupProps`](api:ButtonGroupProps)                                                              |
| Parts          | `.aekButtonGroup` around the buttons                                                                    |
| Keys           | A toolbar (`exclusive`): one tab stop; the arrows along it move (wrapping), Home and End go to the ends |
| Assistive tech | `role="group"` named by `label`; `exclusive` makes it a `toolbar` (`aria-orientation` when vertical)    |

## Links

[`createLink`](api:createLink) is an `<a>`. A link to another site opens in a new tab with the
external mark, and assistive tech hears "(opens in a new tab)". `appearance: 'button'` draws a
link as a button: use it for a navigation ("Open the manual"), and a `link` variant button for an
action that looks like a link, so each keeps the right element.

```ts
aboutPanel.add(createLink({ href: 'https://example.com/manual', label: 'The manual' }).cmp);
menuPanel.add(
  createLink({ href: '/play', label: 'Play', appearance: 'button', variant: 'primary' }).cmp
);
```

::: demo link
:::

| Link           |                                                                                              |
| -------------- | -------------------------------------------------------------------------------------------- |
| Props          | [`LinkProps`](api:LinkProps)                                                                 |
| Parts          | `.aekLink` with `__icon` and `__external` (the external mark); as a button also `.aekButton` |
| Assistive tech | An external link adds a visually hidden "(opens in a new tab)"                               |

## Badges and tags

[`createBadge`](api:createBadge) puts a count or a status word next to what it's about, and
[`createTag`](api:createTag) labels a thing's kind: both in a tone (`neutral`, `accent`, `info`,
`success`, `warning`, `danger`), a status colour on its soft background. A tag can be a filter's
chip (`selectable`, a toggle button) or a picked item the player removes (`removable`: its remove
button, or Backspace or Delete, with the focus moved to the next tag).

```ts
const unread = createBadge({ label: 3, tone: 'accent', spokenLabel: '3 unread' });
inboxTitle.add(unread.cmp);
unread.setLabel(4, '4 unread'); // in place

filters.add(
  createTag({ label: 'Trees', selectable: true, onSelectedChange: (on) => setFilter('trees', on) })
    .cmp
);
picked.add(createTag({ label: 'Sword', removable: true, onRemove: () => unequip('sword') }).cmp);
```

::: demo badge
:::

::: demo tag
:::

A count alone ("3") says little to assistive tech: give it a `spokenLabel`. A badge isn't live; if
a change should be announced, say it in a live region of your own.

| Badge, tag        |                                                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| Props             | [`BadgeProps`](api:BadgeProps), [`TagProps`](api:TagProps)                                                            |
| Parts             | `.aekBadge`; `.aekTag` with `__icon`, `__label` (a toggle button when selectable) and `__remove`                      |
| States            | `data-tone`; a tag's `data-selectable`, `data-selected`, `data-removable`                                             |
| Custom properties | `--aek-tone` and `--aek-tone-soft` (a tone of your own), `--aek-tag-radius`                                           |
| Keys              | A removable tag: Backspace or Delete removes it and moves the focus to the next tag                                   |
| Assistive tech    | A badge's `spokenLabel` replaces its label; a selectable tag is `aria-pressed`; the remove button is "Remove {label}" |

## Key hints and input glyphs

[`createKbd`](api:createKbd) draws a shortcut's keys, a `<kbd>` each with `+` between them, from
the text [`getKeyChordLabel`](api:getKeyChordLabel) writes; several chords joined with `' / '`
are shown with "or". On macOS the modifiers are symbols (⌘ ⇧ ⌥ ⌃), and assistive tech hears the
words ("Command+Shift+P"). [`createInputGlyph`](api:createInputGlyph) draws one input for a
prompt: a key cap, or a mouse with the button, the wheel or its movement in the accent. It takes
an action map binding's shape, so a binding goes in as it is. Both are sized in `em`, so they
follow their text, and both are display only: binding the key is the app's. A button's or a menu
item's `kbd` takes the hint's handle, and names its keys in `aria-keyshortcuts`.

```ts
const hint = panel.add({ tag: 'p', text: 'Command palette: ' });
hint.add(createKbd({ keys: getKeyChordLabel({ key: 'p', ctrl: true, shift: true }) }).cmp);

const prompt = panel.add({ tag: 'p', text: 'Press ' });
const glyph = createInputGlyph({ input: { device: 'KEYBOARD', key: 'e' } });
prompt.add(glyph.cmp);
prompt.add({ tag: 'span', text: ' to open the door' });
glyph.setInput({ device: 'MOUSE', button: 'LEFT' }); // the player rebound it
```

::: demo kbd
:::

::: demo inputGlyph
:::

| Key hint, input glyph |                                                                                                    |
| --------------------- | -------------------------------------------------------------------------------------------------- |
| Props                 | [`KbdProps`](api:KbdProps), [`InputGlyphProps`](api:InputGlyphProps)                               |
| Parts                 | `.aekKbd` with a `.aekKbd__key` per key; `.aekInputGlyph` with its `__active` part                 |
| Custom properties     | `--aek-input-glyph-size` (default `1.6em`)                                                         |
| Assistive tech        | Symbols are read as words; an input glyph is `role="img"` named by its input ("Left mouse button") |

## Icons

[`registerIcon`](api:registerIcon) names an SVG and [`getSvgIcon`](api:getSvgIcon) returns it as
HTML, in the text colour: `1em` square, so it follows the text around it, or at a size from the
type scale (`'sm'`, `'md'`, `'lg'`: `--aek-icon-size-*`). A window's `icon` takes a registered
name, a drop-down's `icon` the HTML. The kit has about 50 built-in icons (`gearIcon`, `infoIcon`,
… on `aekasha/ui`).

```ts
const save = CMP({ tag: 'button', html: `${getSvgIcon('fileCode')} Save` }); // 1em, with its text
const badge = CMP({ html: getSvgIcon('shield', 'lg') }); // 20 px at the defaults
```

::: demo icons
:::

::: note A production build registers no icons
The engine registers the built-in icons for its debug tools only (debug and prod test mode).
Register the ones your app shows with `registerIcon` (or all of them with
[`registerBuiltInIcons`](api:registerBuiltInIcons), about 10 kB gzip): an unregistered name
shows `??` and logs a warning.
:::

## Spinners and progress bars

[`createSpinner`](api:createSpinner) turns a ring for a wait of unknown length. It's `1em` by
default, so it follows its text, or an icon size (`sm`, `md`, `lg`); `--aek-spinner-size` sets
any other. Alone it's a status that says its label ("Loading" by default); inside something that
already says it's loading, make it `decorative`. [`createProgressBar`](api:createProgressBar)
shows how far a task is, or with no `value` that it's going on with no known end. Its setter
writes the bar in place, so a value set every frame (a health bar, a charge) changes no layout,
and `segments` draws the track in parts filled in turn.

```ts
const saving = panel.add({ tag: 'p' });
saving.add(createSpinner({ decorative: true }).cmp); // the text says it
saving.add({ tag: 'span', text: ' Saving…' });

const download = createProgressBar({ label: 'Downloading the level', showValue: true });
panel.add(download.cmp);
onDownloadProgress((loaded: number, total: number) => download.setValue((loaded / total) * 100));

const health = createProgressBar({ label: 'Health', hideLabel: true, max: 5, segments: 5 });
health.cmp.elem.style.setProperty('--aek-progress-color', 'var(--aek-danger)');
hudCorner.add(health.cmp);
health.setValue(player.health); // every frame is fine
```

::: demo spinner
:::

::: demo progressBar
:::

Both follow reduced motion: the spinner pulses slowly instead of turning, and an indeterminate bar
is a still striped one instead of a sliding bar.

| Spinner, progress bar |                                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Props                 | [`SpinnerProps`](api:SpinnerProps), [`ProgressBarProps`](api:ProgressBarProps)                                                                    |
| Parts                 | `.aekSpinner` (its ring the `::before`); `.aekProgress` with `__header` (`__label`, `__value`), `__track`, `__fill`, `__segment`                  |
| States                | A spinner's `data-size`; a bar's `data-indeterminate`, `data-label-hidden`, `data-segments`                                                       |
| Custom properties     | `--aek-spinner-size`, `--aek-spinner-color`; `--aek-progress-color`, `-track-color`, `-height`, `-radius`                                         |
| Assistive tech        | A spinner alone is `role="status"` with its label; the track is the `progressbar`, named by the label, `aria-valuenow` absent while indeterminate |

## Skeletons, dividers and empty states

[`createSkeleton`](api:createSkeleton) holds the place of content that's still loading, shaped
like it (text `lines`, a `block`, a `circle`), so nothing jumps when it comes. Assistive tech
doesn't hear it: mark the container that's loading with `aria-busy="true"` and take it off with
the skeleton. [`createDivider`](api:createDivider) draws a line between two groups, across a
column or (`orientation: 'vertical'`) down a row. [`createEmptyState`](api:createEmptyState) is
what a list or a search shows with nothing in it: an icon, a title, what to do about it, and an
action button.

```ts
const scores = panel.add({ attr: { 'aria-busy': 'true' } });
const placeholder = createSkeleton({ lines: 4 });
scores.add(placeholder.cmp);

const rows = await loadScoresAsync();
placeholder.cmp.remove();
scores.removeAttr('aria-busy');
if (!rows.length) {
  scores.add(
    createEmptyState({
      title: 'No scores yet',
      text: 'Finish a race to set the first one.',
      action: { label: 'Race', variant: 'primary', onClick: () => startRace() },
    }).cmp
  );
}

pauseMenu.add(createDivider().cmp); // before Quit
```

::: demo skeleton
:::

::: demo divider
:::

::: demo emptyState
:::

| Skeleton, divider, empty state |                                                                                                                                     |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Props                          | [`SkeletonProps`](api:SkeletonProps), [`DividerProps`](api:DividerProps), [`EmptyStateProps`](api:EmptyStateProps)                  |
| Parts                          | `.aekSkeleton` (`data-shape`) with its `__line`s; `.aekDivider`; `.aekEmptyState` with `__icon`, `__title`, `__text`, `__action`    |
| Custom properties              | `--aek-skeleton-color`, `-shine`, `-radius`; `--aek-divider-color`, `-spacing`; `--aek-empty-state-icon-size`, `-padding`           |
| Assistive tech                 | A skeleton is `aria-hidden`; a divider is a separator (`decorative`: hidden); an empty state's title is a heading at `headingLevel` |

## Loading overlays

[`createLoadingOverlay`](api:createLoadingOverlay) covers the HUD's bounds (a scene load; a
mounted engine's container in an embed) or, with `cover: 'parent'`, a positioned panel of yours,
while something loads: a spinner, or a progress bar when you give it `progress`, and a text that
assistive tech reads as a status. Add its `cmp` where it goes; it's hidden until
`showAsync()`. `showAsync()` and `hideAsync()` fade it (instantly under reduced motion) and
resolve `true` once done, or `false` when a later call or its removal cut them short, so they
plug into a scene loader as they are. It blocks the pointer while shown, above the app's windows
and below its dialogs (`--aek-z-loading`).

```ts
import { createSceneLoader, getLoaderStatusUpdater } from 'aekasha';
import { createLoadingOverlay, type LoadingOverlay } from 'aekasha/ui';

let overlay: LoadingOverlay | null = null;
await createSceneLoader({
  id: 'main',
  // A new overlay per load: the load removes its container at its end
  loaderContainerFn: () => {
    overlay = createLoadingOverlay({ text: 'Loading the level', progress: 0 });
    return overlay.cmp;
  },
  loadStartFn: () => overlay?.showAsync() ?? Promise.resolve(true),
  loadEndFn: () => overlay?.hideAsync() ?? Promise.resolve(true),
  updateLoaderStatusFn: (_loader, params) => overlay?.setProgress(Number(params?.percent ?? 0)),
});

// In a scene file, as its assets come in:
getLoaderStatusUpdater()({ percent: 40 });
```

::: demo loadingOverlay
:::

The debug scene loader (the Debug tools' start scene) is the same overlay with a spinner.

| Loading overlay   |                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------- |
| Props             | [`LoadingOverlayProps`](api:LoadingOverlayProps)                                            |
| Parts             | `.aekLoadingOverlay` with `__content`, a spinner or `__progress`, and `__text`              |
| States            | `data-cover` (`bounds`, `parent`), `data-state` (`hidden`, `showing`, `shown`, `hiding`)    |
| Custom properties | `--aek-loading-overlay-bg`, `--aek-loading-overlay-z`, `--aek-loading-overlay-spinner-size` |
| Assistive tech    | The text is a `role="status"`, so a `setText` is read; the spinner is decorative            |

## Key APIs

- [`createButton`](api:createButton) ([`Button`](api:Button), [`ButtonProps`](api:ButtonProps)),
  [`createButtonGroup`](api:createButtonGroup) and [`createLink`](api:createLink).
- [`createBadge`](api:createBadge) ([`BadgeTone`](api:BadgeTone)) and [`createTag`](api:createTag).
- [`createKbd`](api:createKbd) ([`Kbd`](api:Kbd)) and [`createInputGlyph`](api:createInputGlyph)
  ([`InputGlyphInput`](api:InputGlyphInput)).
- [`registerIcon`](api:registerIcon) and [`getSvgIcon`](api:getSvgIcon).
- [`createSpinner`](api:createSpinner) and [`createProgressBar`](api:createProgressBar)
  ([`ProgressBar`](api:ProgressBar)).
- [`createSkeleton`](api:createSkeleton), [`createDivider`](api:createDivider) and
  [`createEmptyState`](api:createEmptyState) ([`EmptyState`](api:EmptyState)).
- [`createLoadingOverlay`](api:createLoadingOverlay) ([`LoadingOverlay`](api:LoadingOverlay)), with
  [`createSceneLoader`](api:createSceneLoader).

## Read more

- [The UI kit](hub:features/ui-kit): components, the HUD root, styling.
- [Windows and overlays](hub:features/ui-kit/overlays): what opens over the HUD.
- [The component library](hub:features/ui-kit/library): every piece in every state.
