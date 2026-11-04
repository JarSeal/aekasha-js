/**
 * The component library's game text pieces (the Hub's `features/ui-kit/game/` page, p808): the
 * notification feed, the objective tracker, the subtitles and the dialogue box, each `inline` in
 * the page (in a HUD they place themselves at the bounds' edges).
 */
import {
  CMP,
  createDialogueBox,
  createNotificationFeed,
  createObjectiveTracker,
  createSubtitles,
  createSwitch,
} from 'aekasha/ui';
import type { DialogueBox, DialogueLine } from 'aekasha/ui';
import { ID_PREFIX, addButton, addGroup, addKitRoot } from './page';
import type { Demo } from './page';
import { createStatusLine } from './game';

/** Long enough that a line is still there when the runner takes its screenshot */
const HELD_MS = 60_000;

// --- Notification feed ---

const FEED_ID = (name: string) => `${ID_PREFIX}Feed${name}`;

/** In the page: an inline feed; the Hub buttons add lines as a game's events would, a repeat of
 * a key merging into its line's count */
const initNotificationFeedDemo: Demo = (box) => {
  const root = addKitRoot(box);
  const feed = createNotificationFeed({
    id: FEED_ID('Feed'),
    placement: 'inline',
    max: 4,
    durationMs: HELD_MS,
    class: 'hubDemoFeed',
  });
  feed.add({ text: 'Quest updated: The beacon', icon: 'info', tone: 'info' });
  const group = addGroup(root, 'Newest on top; held while hovered or focused');
  group.append(feed.cmp.elem);
  const events = addGroup(root, 'A game’s events');
  addButton(events, '+25 gold (merges by key)', () =>
    feed.add({ text: '+25 gold', spokenText: '25 gold', key: 'gold', tone: 'warning' })
  );
  addButton(events, 'Level up', () =>
    feed.add({ text: 'Level 4 reached', icon: 'circleCheckCutout', tone: 'success' })
  );
  addButton(events, 'Inventory full', () =>
    feed.add({ text: 'Inventory full', icon: 'warning', tone: 'danger' })
  );
  addButton(events, 'Five lines (past max)', () => {
    for (let i = 1; i <= 5; i++) feed.add({ text: `Crate ${i} opened` });
  });
  addButton(events, 'Clear', () => feed.clear());
};

// --- Objective tracker ---

const TRACKER_ID = (name: string) => `${ID_PREFIX}Tracker${name}`;

/** In the page: an inline tracker with a count and steps; the Hub buttons move the quest on */
const initObjectiveTrackerDemo: Demo = (box) => {
  const root = addKitRoot(box);
  const tracker = createObjectiveTracker({
    id: TRACKER_ID('Tracker'),
    title: 'Objectives',
    headingLevel: 3,
    placement: 'inline',
  });
  tracker.setObjective('crystals', { text: 'Collect crystals', count: { value: 3, total: 5 } });
  tracker.setObjective('beacon', {
    text: 'Light the beacon',
    steps: [{ text: 'Find the key', done: true }, { text: 'Climb the tower' }],
  });
  const group = addGroup(root, 'A count and steps; a completion is checked, then goes');
  group.append(tracker.cmp.elem);
  const quest = addGroup(root, 'The quest');
  addButton(quest, 'Collect a crystal', () =>
    tracker.setObjective('crystals', { text: 'Collect crystals', count: { value: 4, total: 5 } })
  );
  addButton(quest, 'Climb the tower', () =>
    tracker.setObjective('beacon', {
      text: 'Light the beacon',
      steps: [
        { text: 'Find the key', done: true },
        { text: 'Climb the tower', done: true },
      ],
    })
  );
  addButton(quest, 'Complete the crystals', () => tracker.complete('crystals'));
  addButton(quest, 'A new objective', () =>
    tracker.setObjective('ferry', { text: 'Talk to the ferryman' })
  );
};

// --- Subtitles ---

const SUBTITLES_ID = (name: string) => `${ID_PREFIX}Subtitles${name}`;

/** In the page: inline subtitles (a HUD's sit at the bottom); the Hub buttons say lines */
const initSubtitlesDemo: Demo = (box) => {
  const root = addKitRoot(box);
  const subtitles = createSubtitles({
    id: SUBTITLES_ID('Lines'),
    placement: 'inline',
    maxLines: 2,
    class: 'hubDemoSubtitles',
  });
  const group = addGroup(root, 'Newest last, two lines at most; the speaker bold, in its colour');
  group.append(subtitles.cmp.elem);
  const lines = addGroup(root, 'Lines');
  addButton(lines, 'Mara speaks', () =>
    subtitles.show({
      text: 'Over here! The beacon went dark again.',
      speaker: 'Mara',
      speakerColor: 'var(--aek-warning)',
      durationMs: HELD_MS,
    })
  );
  addButton(lines, 'Ivo answers', () =>
    subtitles.show({
      text: 'Not my turn to climb it.',
      speaker: 'Ivo',
      speakerColor: 'var(--aek-info)',
      durationMs: HELD_MS,
    })
  );
  addButton(lines, 'A sound', () =>
    subtitles.show({ text: '[Thunder in the distance]', durationMs: HELD_MS })
  );
  addButton(lines, 'Three lines (past maxLines)', () => {
    for (const text of ['One.', 'Two.', 'Three.']) {
      subtitles.show({ text, speaker: 'Pell', durationMs: HELD_MS });
    }
  });
};

// --- Dialogue box ---

const DIALOGUE_ID = (name: string) => `${ID_PREFIX}Dialogue${name}`;

/** Mara's portrait: a coloured initial (an app's would be an image or a render) */
const createPortrait = () =>
  CMP({ class: 'hubDemoPortrait', text: 'M', attr: { 'aria-hidden': 'true' } });

/** The conversation: each line's index in it, the choices' next lines */
const LINES: (DialogueLine & { next?: number[] })[] = [
  {
    speaker: 'Mara',
    text: 'You came! The beacon on the hill went dark again last night.',
    next: [1],
  },
  {
    speaker: 'Mara',
    text: 'Will you climb up and light it?',
    choices: [
      { label: 'I’ll go now.' },
      { label: 'What’s in it for me?' },
      { label: 'Fly there', disabled: true },
    ],
    next: [2, 3],
  },
  { speaker: 'Mara', text: 'Thank you. Take the key: the door sticks.', next: [] },
  { speaker: 'Mara', text: 'Twenty-five gold, and my thanks.', next: [] },
];

/**
 * In the page: an inline dialogue box with Mara's portrait. Its lines show whole at the start
 * (a screenshot of a typewriter would depend on its timing); the switch in the box makes a new
 * box that types them out at 40 characters a second, as a game's would.
 */
const initDialogueBoxDemo: Demo = (box) => {
  const root = addKitRoot(box);
  const status = createStatusLine(DIALOGUE_ID('Status'));
  const holder = addGroup(root, 'Enter, Space or a click: the whole line, then on; 1-9 pick');
  let index = 0;
  let dialogue: DialogueBox | null = null;
  const show = (i: number) => {
    index = i;
    const line = LINES[i];
    dialogue?.setLine({ ...line, portrait: createPortrait() });
  };
  const make = (charsPerSecond: number) => {
    dialogue?.cmp.remove();
    dialogue = createDialogueBox({
      id: DIALOGUE_ID('Box'),
      label: 'Conversation',
      placement: 'inline',
      charsPerSecond,
      onAdvance: () => {
        const next = LINES[index].next?.[0];
        if (next === undefined) {
          status.textContent = 'The conversation ended';
          dialogue?.setLine(null);
        } else show(next);
      },
      onChoice: (choice) => {
        status.textContent = `Chose: ${LINES[index].choices?.[choice]?.label ?? ''}`;
        const next = LINES[index].next?.[choice];
        if (next !== undefined) show(next);
      },
    });
    holder.append(dialogue.cmp.elem);
    show(index);
  };
  make(0);
  const typewriter = createSwitch({
    label: 'Type the lines out',
    value: false,
    onChange: (on) => make(on ? 40 : 0),
  });
  root.append(typewriter.cmp.elem, status);
  const lines = addGroup(root, 'Lines');
  addButton(lines, 'The question (choices)', () => show(1));
  addButton(lines, 'Start again', () => show(0));
  addButton(lines, 'Empty (between lines)', () => dialogue?.setLine(null));
};

/** The game text group's demos by their box's key (`data-hub-demo`) */
export const GAME_TEXT_DEMOS: Record<string, Demo> = {
  notificationFeed: initNotificationFeedDemo,
  objectiveTracker: initObjectiveTrackerDemo,
  subtitles: initSubtitlesDemo,
  dialogueBox: initDialogueBoxDemo,
};
