import {
  CMP,
  createHotbar,
  createInputPrompt,
  createNotificationFeed,
  createResourceBar,
  registerIcon,
} from 'aekasha/ui';
import type { GameItem } from 'aekasha/ui';

/**
 * The uiKit embed's game window (p808 D12): a health bar, a hotbar of two items with a cooldown
 * on each slot, a notification feed and an input prompt, all `inline` in the window (a game's
 * HUD fixes them to the HUD's corners instead). Its own module, which the window's button imports
 * on its first press, so a build gives the game pieces their own chunk
 * (`assets/uiKitEmbedGame.js`): what a small game HUD costs on top of the kit's HUD.
 */

/** The hotbar's icons: the kit's built-in icons register only in the debug env, so an app brings
 * its own */
const ICONS = {
  uiKitEmbedPotion:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 1.5h4M6.5 1.5v3.2L3.6 9.6a3.8 3.8 0 0 0 3.3 4.9h2.2a3.8 3.8 0 0 0 3.3-4.9L9.5 4.7V1.5"/><path d="M4.2 9.5h7.6"/></svg>',
  uiKitEmbedWard:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 1.5 2.5 3.5v4c0 3.4 2.4 5.9 5.5 7 3.1-1.1 5.5-3.6 5.5-7v-4Z"/></svg>',
};

/** The hotbar's items, and the empty slot after them */
const ITEMS: (GameItem | null)[] = [
  { id: 'potion', name: 'Health potion', icon: 'uiKitEmbedPotion', count: 3, rarity: 'common' },
  { id: 'ward', name: 'Ward', icon: 'uiKitEmbedWard', rarity: 'rare' },
  null,
];
const HEAL = 25;
const POTION_COOLDOWN_MS = 3000;
const WARD_COOLDOWN_MS = 5000;
/** How long the feed's lines show: long enough for `yarn verify:embed` to measure the first */
const FEED_LINE_MS = 30_000;

/**
 * The game window's content: the health bar the potion fills, the hotbar whose slots use their
 * item on a click, Enter or Space (each slot's cooldown then runs, and a use during it does
 * nothing), the feed that says what happened, and the prompt for the use. Made anew on each open:
 * the health and the potions start over.
 */
export const createGameHud = () => {
  for (const name in ICONS) registerIcon(name, ICONS[name as keyof typeof ICONS]);

  const health = createResourceBar({
    label: 'Health',
    max: 100,
    value: 40,
    showValue: 'fraction',
    // A state and a word, not the colour alone
    thresholds: [
      { below: 0.25, state: 'danger', text: 'Low' },
      { below: 0.5, state: 'warning', text: 'Hurt' },
    ],
  });
  const feed = createNotificationFeed({ placement: 'inline', max: 3, durationMs: FEED_LINE_MS });
  let potions = 3;

  const hotbar = createHotbar({
    label: 'Items',
    slots: ITEMS,
    cooldowns: true,
    placement: 'inline',
    size: 'sm',
    // The embed binds no number keys: the prompt says how to use a slot
    keyHints: false,
    onUse: (index, item) => {
      const cooldown = hotbar.slots[index].cooldown;
      if (!item || cooldown?.isRunning()) return;
      if (item.id === 'potion') {
        if (!potions) return feed.add({ text: 'No potions left', key: 'empty', tone: 'warning' });
        if (health.getValue() >= 100) {
          return feed.add({ text: 'Health is full', key: 'full', tone: 'info' });
        }
        health.setValue(Math.min(100, health.getValue() + HEAL));
        potions--;
        hotbar.slots[index].setCount(potions);
        cooldown?.start(POTION_COOLDOWN_MS);
        // Merged by its key: a second use shows '×2'
        feed.add({ text: `+${HEAL} health`, key: 'heal', tone: 'success' });
      } else {
        cooldown?.start(WARD_COOLDOWN_MS);
        feed.add({ text: 'Ward raised', key: 'ward' });
      }
    },
  });

  const panel = CMP({
    class: 'uiKitEmbedGameHud',
    style: { display: 'flex', flexDirection: 'column', gap: 'var(--aek-space-3)' },
  });
  panel.add(health.cmp);
  panel.add(hotbar.cmp);
  panel.add(
    createInputPrompt({
      label: 'Use',
      // The prompt shows the binding of the device the player uses (the mouse by default)
      bindings: [
        { device: 'MOUSE', button: 'LEFT' },
        { device: 'GAMEPAD', button: 'SOUTH' },
      ],
    }).cmp
  );
  panel.add(feed.cmp);
  feed.add({ text: 'Use the potion: the bar fills', key: 'hint' });
  return panel;
};
