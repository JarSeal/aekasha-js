## Notification feeds

[`createNotificationFeed`](api:createNotificationFeed) shows short lines a game adds as things
happen ("+25 gold", "Quest updated"), in a corner of the HUD, newest on top.

```ts
const feed = createNotificationFeed({ placement: 'top-right', max: 5 });
getHUDRootCMP().add(feed.cmp);
feed.add({ text: '+25 gold', spokenText: '25 gold', key: 'gold', tone: 'warning' });
feed.add({ text: 'Quest updated', icon: 'info', tone: 'info' });
```

::: demo notificationFeed
:::

- **Merging.** A line with the `key` of a shown one merges into it: "+25 gold ×3", said "25 gold,
  3 times", its time started again.
- **Fading.** Each goes after its `durationMs` (the feed's, 4 s by default), held while the feed
  is hovered or holds the focus, or the page is hidden; past `max` the oldest goes at once.
- **Not the toaster.** No close button, no actions, many at once, game-styled. A message the
  player must act on is a [toast](hub:features/ui-kit/overlays#toasts) or a dialog.
- **Placement.** `'top-right'` (the default), `'top-left'`, `'bottom-right'`, `'bottom-left'`, or
  `'inline'` in your own panel's flow.

| Notification feed |                                                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Props             | [`NotificationFeedProps`](api:NotificationFeedProps), [`NotificationFeedItem`](api:NotificationFeedItem)               |
| Parts             | `.aekNotificationFeed` (a `ul`, `data-placement`) of `__item`s (`data-tone`, `data-state`) holding `__icon`, `__text`, `__count` and `__spoken` |
| Custom properties | `--aek-notification-feed-width`, `--aek-notification-feed-inset`, `--aek-notification-feed-z`                          |
| Keys              | None                                                                                                                    |
| Assistive tech    | A list named by its `label` ("Notifications"); a line's text and count `aria-hidden`, its `__spoken` text read politely once (lines that come together as one) |

## Objective trackers

[`createObjectiveTracker`](api:createObjectiveTracker) lists what the player is doing, with a
count or steps; it shows what you give it (a quest system is the app's).

```ts
const tracker = createObjectiveTracker({ title: 'Objectives', placement: 'top-left' });
getHUDRootCMP().add(tracker.cmp);
tracker.setObjective('crystals', { text: 'Collect crystals', count: { value: 0, total: 5 } });
// On a pickup: rewritten in place
tracker.setObjective('crystals', { text: 'Collect crystals', count: { value: 3, total: 5 } });
tracker.complete('crystals'); // checked and struck through, then removed
```

::: demo objectiveTracker
:::

- **In place.** `setObjective(id, …)` adds an objective at the end or rewrites the one with that
  id; `steps` (`{ text, done }`) are rewritten by index. `complete` checks it, holds it
  `completeHoldMs` (2.5 s), then fades it out; `removeObjective` takes it out at once.
- **Read once.** A new objective ("New objective: Collect crystals, 0 of 5"), a changed count, a
  step newly done and a completion are read; a text change alone isn't.
- It's `hidden` while empty, and its title can be a heading (`headingLevel`).

| Objective tracker |                                                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Props             | [`ObjectiveTrackerProps`](api:ObjectiveTrackerProps), [`ObjectiveTrackerObjective`](api:ObjectiveTrackerObjective)                   |
| Parts             | `.aekObjectiveTracker` holding `__head` (`__title`) and `__list` of `__objective`s (`__check`, `__text`, `__count`, `__steps`, `__spoken`) |
| Custom properties | `--aek-objective-tracker-width`, `--aek-objective-tracker-inset`, `--aek-objective-tracker-check-color`, `--aek-objective-tracker-z` |
| Keys              | None                                                                                                                                  |
| Assistive tech    | A `role="list"` named by the title; a count and a check `aria-hidden`, said by the row's hidden text; the changes read politely      |

## Subtitles

[`createSubtitles`](api:createSubtitles) shows what's said, a line at a time at the bottom of the
HUD, the speaker's name first.

```ts
const subtitles = createSubtitles({ maxLines: 2 });
getHUDRootCMP().add(subtitles.cmp);
// A speaker's colour needs its contrast on the background in both themes: a status role's
subtitles.show({ text: 'Over here!', speaker: 'Mara', speakerColor: 'var(--aek-warning)' });
subtitles.show({ text: '[Thunder in the distance]' }); // a sound
```

::: demo subtitles
:::

- **Read once.** The element is a polite live region, so a line is read as it's added, speaker
  first ("Mara: Over here!"), also under a modal menu.
- **Its time** is `durationMs`, else its length's (about 15 characters a second, at least 2 s);
  past `maxLines` the oldest goes.
- **The player's setting.** Its size is `--aek-subtitles-font-size` (default `--aek-font-size-xl`)
  and its background `--aek-subtitles-bg`: a settings menu's subtitle size writes the first. The
  speaker's name is bold in its own colour, so the colour isn't the only sign of who speaks.
- **Above the hotbar.** A hotbar at the bottom reaches over the subtitles' default inset: raise
  `--aek-subtitles-inset`.

| Subtitles         |                                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Props             | [`SubtitlesProps`](api:SubtitlesProps), [`SubtitleLine`](api:SubtitleLine)                                                                       |
| Parts             | `.aekSubtitles` (`data-placement`) of `__line`s holding `__speaker`, `__separator` (the ': ') and `__text`                                       |
| Custom properties | `--aek-subtitles-font-size`, `--aek-subtitles-bg`, `--aek-subtitles-color`, `--aek-subtitles-speaker-color`, `--aek-subtitles-width`, `--aek-subtitles-inset`, `--aek-subtitles-z` |
| Keys              | None                                                                                                                                             |
| Assistive tech    | `aria-live="polite"` with `aria-relevant="additions"`: each line read once                                                                       |

## Dialogue boxes

[`createDialogueBox`](api:createDialogueBox) holds a conversation: a speaker, a portrait, a line
typed out and the player's choices. Your conversation's data and its tree are yours; the box shows
a line and reports.

```ts
const dialogue = createDialogueBox({
  onAdvance: () => showLine(next), // Enter, Space or a click after the line is whole
  onChoice: (index) => showLine(answers[index]),
});
getHUDRootCMP().add(dialogue.cmp);
dialogue.setLine({
  speaker: 'Mara',
  portrait: maraPortrait, // an element or a CMP of yours
  text: 'Will you climb up and light it?',
  choices: [{ label: 'I’ll go now.' }, { label: 'Fly there', disabled: true }],
});
dialogue.focus(); // so Enter reaches the box
```

::: demo dialogueBox
:::

- **The typewriter** reveals the line at `charsPerSecond` (40; 0 shows it whole). Enter, Space or
  a click shows the whole line, then goes on (`onAdvance`); `confirm()` does the same, for a
  gamepad's `SOUTH`. Under reduced motion the line shows at once.
- **Choices** show once the line is whole, as buttons in a group: the arrows between them
  (skipping a disabled one), Home and End, 1-9 picking one. A pick is reported once per line.
- `setLine(null)` empties the box between lines; the focus inside it stays inside.

| Dialogue box      |                                                                                                                                                                               |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Props             | [`DialogueBoxProps`](api:DialogueBoxProps), [`DialogueLine`](api:DialogueLine)                                                                                                |
| Parts             | `.aekDialogueBox` (`data-state`) holding `__portrait`, `__body` (`__speaker`, `__line` with `__shown` and `__rest`), `__choices` of `__choice`s (`__choiceKey`, `__choiceLabel`), `__next` and `__spoken` |
| Custom properties | `--aek-dialogue-box-font-size`, `--aek-dialogue-box-portrait-size`, `--aek-dialogue-box-speaker-color`, `--aek-dialogue-box-width`, `--aek-dialogue-box-inset`, `--aek-dialogue-box-z` |
| Keys              | Enter, Space (the whole line, then on); in the choices ↑ ↓ ← →, Home, End; 1-9                                                                                               |
| Assistive tech    | A `role="group"` named by `label` (default 'Dialogue'); the whole line ("Mara: Over here!") read when it starts, the reveal `aria-hidden`; a choice's number in `aria-keyshortcuts`                       |
