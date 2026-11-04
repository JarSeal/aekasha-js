/**
 * The game text pieces' checks (`gameText.ts`' demos): the notification feed, the objective
 * tracker, the subtitles and the dialogue box.
 */
import type { UiDemoChecks } from '../_componentChecks';

const FEED = '#hubDemoFeedFeed';
const FEED_FIRST = `${FEED} .aekNotificationFeed__item:first-child`;
const TRACKER = '#hubDemoTrackerTracker';
const SUBTITLES = '#hubDemoSubtitlesLines';
const DIALOGUE = '#hubDemoDialogueBox';
const CHOICE = (n: number) => `${DIALOGUE} .aekDialogueBox__choice:nth-child(${n})`;
const CONTINUE = `${DIALOGUE} .aekDialogueBox__next`;
const DIALOGUE_STATUS = '#hubDemoDialogueStatus';

/** The game text group's checks by their demo's key (`data-hub-demo`) */
export const GAME_TEXT_CHECKS: Record<string, UiDemoChecks> = {
  notificationFeed: {
    keyboard: [
      {
        name: 'no keys; a repeat of a key merges into its line’s count, said in words',
        steps: [
          { click: '+25 gold (merges by key)' },
          { expectText: `${FEED_FIRST} .aekNotificationFeed__text`, text: '+25 gold' },
          { click: '+25 gold (merges by key)' },
          { expectText: `${FEED_FIRST} .aekNotificationFeed__count`, text: '×2' },
          { expectText: `${FEED_FIRST} .aekNotificationFeed__spoken`, text: '25 gold, 2 times' },
          { click: 'Five lines (past max)' },
          {
            expectCount: `${FEED} .aekNotificationFeed__item:not([data-state="leaving"])`,
            count: 4,
          },
        ],
      },
    ],
  },
  objectiveTracker: {
    keyboard: [
      {
        name: 'no keys; a list named by its title; a completion checked, then removed',
        steps: [
          { expectAttr: `${TRACKER} .aekObjectiveTracker__list`, name: 'role', value: 'list' },
          { click: 'Collect a crystal' },
          { expectText: `${TRACKER} .aekObjectiveTracker__count`, text: '4 / 5' },
          { click: 'Complete the crystals' },
          { expectCount: `${TRACKER} .aekObjectiveTracker__objective`, count: 1 },
        ],
      },
    ],
  },
  subtitles: {
    keyboard: [
      {
        name: 'no keys; the element is a polite live region; past maxLines the oldest goes',
        steps: [
          { expectAttr: SUBTITLES, name: 'aria-live', value: 'polite' },
          { click: 'Mara speaks' },
          { expectText: `${SUBTITLES} .aekSubtitles__speaker`, text: 'Mara' },
          { click: 'Three lines (past maxLines)' },
          { expectCount: `${SUBTITLES} .aekSubtitles__line`, count: 2 },
        ],
      },
    ],
  },
  dialogueBox: {
    keyboard: [
      {
        name: 'Continue goes on; the choices by the arrows and by number; a disabled one skipped',
        steps: [
          { focusInBox: CONTINUE },
          { press: 'Enter' },
          { expectFocus: CHOICE(1) },
          { press: 'ArrowDown' },
          { expectFocus: CHOICE(2) },
          { press: 'ArrowDown' },
          { expectFocus: CHOICE(1) },
          { press: '2' },
          { expectText: DIALOGUE_STATUS, text: 'Chose: What’s in it for me?' },
        ],
      },
      {
        name: 'typed out: Enter shows the whole line first, then goes on',
        steps: [
          { clickInBox: '[role="switch"]' },
          { click: 'Start again' },
          { focusInBox: CONTINUE },
          { press: 'Enter' },
          { expectText: `${DIALOGUE} .aekDialogueBox__rest`, text: '' },
          { press: 'Enter' },
          {
            expectText: `${DIALOGUE} .aekDialogueBox__spoken`,
            text: 'Mara: Will you climb up and light it?',
          },
        ],
      },
    ],
  },
};
