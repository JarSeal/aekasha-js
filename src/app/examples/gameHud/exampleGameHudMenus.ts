import { createActionMap, loadScene, setActionContextEnabled } from 'aekasha';
import type { ActionBinding, ActionMap } from 'aekasha';
import {
  CMP,
  createControlsPage,
  createGameMenu,
  createInputPrompt,
  createInventoryGrid,
  createItemDetails,
  createItemDragGroup,
  createSettingsMenu,
  getKitPreferences,
  setKitPreferences,
} from 'aekasha/ui';
import type {
  ControlsAction,
  CrosshairShape,
  GameItem,
  GameMenuPage,
  InventoryGrid,
  InventoryMove,
  KitPreferences,
} from 'aekasha/ui';

// The game HUD example's pause menu: the inventory (two grids and the focused item's details),
// the settings menu (display, subtitles and the controls page) and a restart, a game menu the
// keyboard, the mouse and the gamepad all move through. The settings and the bindings are saved
// in the browser and read back on the next visit.

const MENU_CONTEXT = 'MENU';
const SETTINGS_KEY = 'exampleGameHud.settings';
const BINDINGS_KEY = 'exampleGameHud.bindings';

/** The player's settings: what the settings menu edits and the browser keeps */
export type GameHudSettings = {
  theme: 'system' | 'dark' | 'light';
  uiScale: number;
  reducedMotion: 'system' | 'on' | 'off';
  crosshair: CrosshairShape;
  subtitles: boolean;
  subtitleSize: 'md' | 'lg' | 'xl' | '2xl';
};

const DEFAULT_SETTINGS: GameHudSettings = {
  theme: 'system',
  uiScale: 1,
  reducedMotion: 'system',
  crosshair: 'cross',
  subtitles: true,
  subtitleSize: 'xl',
};

/** A row of the controls page: an action of one of the game's maps */
type ControlsRow = { map: ActionMap; actionId: string; rowId: string };

const readStorage = (key: string): unknown => {
  // Private windows and blocked site data throw, or keep nothing
  try {
    const text = localStorage.getItem(key);
    return text ? (JSON.parse(text) as unknown) : null;
  } catch {
    return null;
  }
};

const writeStorage = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not kept: the setting still applies for this visit
  }
};

/** The saved settings over the defaults, each key kept only when it has the default's type */
const loadSettings = (): GameHudSettings => {
  const settings = { ...DEFAULT_SETTINGS };
  const saved = readStorage(SETTINGS_KEY);
  if (!saved || typeof saved !== 'object') return settings;
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof GameHudSettings)[]) {
    const value = (saved as Record<string, unknown>)[key];
    if (typeof value === typeof DEFAULT_SETTINGS[key]) {
      (settings as Record<string, unknown>)[key] = value;
    }
  }
  return settings;
};

// #region game-hud-inventory (shown in the Hub: hub/pages/examples/game-hud/)
const IRON_SWORD: GameItem = {
  id: 'ironSword',
  name: 'Iron sword',
  icon: 'gameHudSword',
  rarity: 'common',
  description: 'Plain, sharp, reliable.',
  stats: [
    { id: 'damage', label: 'Damage', value: 12 },
    { id: 'speed', label: 'Attack time', value: 1.2, format: (s) => `${s} s`, lowerIsBetter: true },
    { id: 'weight', label: 'Weight', value: 3, format: (kg) => `${kg} kg`, lowerIsBetter: true },
  ],
};

const createBag = (): (GameItem | null)[] => [
  IRON_SWORD,
  {
    id: 'dagger',
    name: 'Swift dagger',
    icon: 'gameHudDagger',
    rarity: 'rare',
    description: 'Quick in the hand.',
    stats: [
      { id: 'damage', label: 'Damage', value: 7 },
      {
        id: 'speed',
        label: 'Attack time',
        value: 0.6,
        format: (s) => `${s} s`,
        lowerIsBetter: true,
      },
      { id: 'weight', label: 'Weight', value: 1, format: (kg) => `${kg} kg`, lowerIsBetter: true },
    ],
  },
  {
    id: 'shield',
    name: 'Oak shield',
    icon: 'gameHudShield',
    rarity: 'uncommon',
    stats: [
      { id: 'block', label: 'Block', value: 40, format: (n) => `${n} %` },
      { id: 'weight', label: 'Weight', value: 5, format: (kg) => `${kg} kg`, lowerIsBetter: true },
    ],
  },
  { id: 'gem', name: 'Ember gem', icon: 'gameHudGem', count: 2, rarity: 'epic' },
  null,
  { id: 'coin', name: 'Gold coin', icon: 'gameHudCoin', count: 25 },
  {
    id: 'key',
    name: 'Beacon key',
    icon: 'gameHudFlag',
    rarity: 'legendary',
    description: 'A quest item: it stays in the bag.',
  },
  ...Array<null>(8).fill(null),
];

const createChest = (): (GameItem | null)[] => [
  { id: 'coin', name: 'Gold coin', icon: 'gameHudCoin', count: 10 },
  { id: 'gem', name: 'Ember gem', icon: 'gameHudGem', count: 1, rarity: 'epic' },
  ...Array<null>(6).fill(null),
];

/**
 * The bag and a chest, one drag group so an item moves between them (a click, Enter or Space
 * picks it up and drops it, the gamepad's SOUTH is a click on the focused slot; a drag works
 * too), and the details of the focused item beside them, compared with the sword in hand. The
 * grids move nothing: `onMove` changes the records and `setItems` shows them.
 */
const createInventoryPanel = () => {
  const items = new Map<InventoryGrid, (GameItem | null)[]>();
  const group = createItemDragGroup();
  const panel = CMP({ class: 'exampleGameHudInventory' });
  const grids = panel.add({ class: 'exampleGameHudInventory__grids' });

  const applyMove = (move: InventoryMove) => {
    const from = items.get(move.from);
    const to = items.get(move.to);
    if (!from || !to) return;
    if (move.kind === 'merge' && move.target) {
      to[move.toIndex] = {
        ...move.target,
        count: (move.target.count ?? 1) + (move.item.count ?? 1),
      };
      from[move.fromIndex] = null;
    } else {
      // A move's target is null, a swap's goes back where the item was
      from[move.fromIndex] = move.target;
      to[move.toIndex] = move.item;
    }
    move.from.setItems(from);
    if (move.to !== move.from) move.to.setItems(to);
    showFocused();
  };
  const makeGrid = (label: string, columns: number, start: (GameItem | null)[]) => {
    const grid = createInventoryGrid({
      label,
      columns,
      items: start,
      group,
      onMove: applyMove,
      // A slot's rule is the target's: the quest item stays in the bag
      canMove: (move) => !(label === 'Chest' && move.item.id === 'key'),
    });
    items.set(grid, start);
    grids.add({ tag: 'h3', text: label });
    grids.add(grid.cmp);
    return grid;
  };
  const bag = makeGrid('Bag', 5, createBag());
  makeGrid('Chest', 4, createChest());

  // A gamepad hovers nothing: the details follow the focused slot (and the pointer)
  const details = createItemDetails({
    item: null,
    compareLabel: (other) => `Compared with ${other.name}, in hand`,
  });
  panel.add(details.cmp);
  const showSlotOf = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return;
    for (const [grid, gridItems] of items) {
      const index = grid.slots.findIndex((slot) => slot.cmp.elem.contains(target));
      if (index < 0) continue;
      const item = gridItems[index];
      const isWeapon = item?.stats?.some((stat) => stat.id === 'damage') ?? false;
      details.setItem(item, isWeapon ? IRON_SWORD : null);
      return;
    }
  };
  const showFocused = () => showSlotOf(document.activeElement);
  panel.elem.addEventListener('focusin', (e) => showSlotOf(e.target));
  panel.elem.addEventListener('pointerover', (e) => showSlotOf(e.target));
  return { panel, group, focus: () => bag.focus(0) };
};
// #endregion game-hud-inventory

// #region game-hud-settings (shown in the Hub: hub/pages/examples/game-hud/)
/**
 * The settings menu: pages of property grid items bound to the settings object. Each change
 * applies at once (the kit's preferences on the HUD root, the game's through `onApply`); a
 * finished one is saved, the menu reports and its owner persists.
 */
const createSettings = (
  settings: GameHudSettings,
  controls: { cmp: ReturnType<typeof CMP>; reset: () => void },
  apply: () => void
) =>
  createSettingsMenu({
    label: 'Settings',
    pages: [
      {
        key: 'display',
        label: 'Display',
        items: [
          {
            target: settings,
            key: 'theme',
            label: 'Theme',
            default: DEFAULT_SETTINGS.theme,
            options: [
              { label: 'System', value: 'system' },
              { label: 'Dark', value: 'dark' },
              { label: 'Light', value: 'light' },
            ],
          },
          {
            target: settings,
            key: 'uiScale',
            label: 'UI scale',
            default: DEFAULT_SETTINGS.uiScale,
            min: 0.75,
            max: 1.5,
            step: 0.05,
          },
          {
            target: settings,
            key: 'reducedMotion',
            label: 'Reduced motion',
            kind: 'segmented',
            default: DEFAULT_SETTINGS.reducedMotion,
            options: [
              { label: 'System', value: 'system' },
              { label: 'On', value: 'on' },
              { label: 'Off', value: 'off' },
            ],
          },
          {
            target: settings,
            key: 'crosshair',
            label: 'Crosshair',
            kind: 'segmented',
            default: DEFAULT_SETTINGS.crosshair,
            options: [
              { label: 'Cross', value: 'cross' },
              { label: 'Dot', value: 'dot' },
              { label: 'Circle', value: 'circle' },
              { label: 'Chevron', value: 'chevron' },
            ],
          },
        ],
      },
      {
        key: 'subtitles',
        label: 'Subtitles',
        items: [
          {
            target: settings,
            key: 'subtitles',
            label: 'Subtitles',
            kind: 'switch',
            default: DEFAULT_SETTINGS.subtitles,
          },
          {
            target: settings,
            key: 'subtitleSize',
            label: 'Size',
            kind: 'segmented',
            default: DEFAULT_SETTINGS.subtitleSize,
            options: [
              { label: 'S', value: 'md' },
              { label: 'M', value: 'lg' },
              { label: 'L', value: 'xl' },
              { label: 'XL', value: '2xl' },
            ],
          },
        ],
      },
      // The controls page's own reset is the page's "Reset page"
      { key: 'controls', label: 'Controls', content: controls.cmp, onReset: controls.reset },
    ],
    onChange: ({ change }) => {
      apply();
      if (change.last) writeStorage(SETTINGS_KEY, settings);
    },
    onReset: () => {
      apply();
      writeStorage(SETTINGS_KEY, settings);
    },
  });
// #endregion game-hud-settings

// #region game-hud-controls (shown in the Hub: hub/pages/examples/game-hud/)
/**
 * The controls page over the game's maps: a row per action, each rebinding reported as the
 * action's whole new list, which the map takes as it is and the browser keeps. The defaults are
 * the maps' bindings before the saved ones are applied, so "Reset page" goes back to them.
 */
const createControls = (rows: ControlsRow[], onBindingsChange: () => void) => {
  const defaults = new Map(rows.map((row) => [row.rowId, row.map.getBindings(row.actionId)]));
  const saved = readStorage(BINDINGS_KEY) as Record<string, readonly ActionBinding[]> | null;
  const kept: Record<string, readonly ActionBinding[]> = {};
  for (const row of rows) {
    const bindings = saved?.[row.rowId];
    if (!Array.isArray(bindings)) continue;
    // A wrong kind of binding from the browser's copy is left out by the map, with a warning
    row.map.setBindings(row.actionId, bindings);
    kept[row.rowId] = bindings;
  }
  const page = createControlsPage<ActionBinding>({
    label: 'Controls',
    showReset: false,
    actions: rows.map(
      (row): ControlsAction<ActionBinding> => ({
        id: row.rowId,
        name: row.map.actions[row.actionId].name ?? row.actionId,
        type: row.map.actions[row.actionId].type,
        bindings: row.map.getBindings(row.actionId),
        defaults: defaults.get(row.rowId),
      })
    ),
    onRebind: ({ action, bindings }) => {
      const row = rows.find((r) => r.rowId === action);
      if (!row) return;
      row.map.setBindings(row.actionId, bindings);
      kept[action] = bindings;
      writeStorage(BINDINGS_KEY, kept);
      onBindingsChange();
    },
    // A gamepad capture's press reaches the maps too: the menu's map is off while it waits
    onCaptureChange: (capturing) => setActionContextEnabled(MENU_CONTEXT, !capturing),
  });
  return page;
};
// #endregion game-hud-controls

/** The pause menu's handle */
export type GameHudMenus = ReturnType<typeof createGameHudMenus>;

/**
 * Makes the pause menu (opened by the game: Escape, the gamepad's START, or I for the
 * inventory), its own map in the `MENU` context (the gamepad's d-pad, SOUTH, EAST, the
 * shoulders and START; the keyboard's keys are the kit's), the settings (read from the browser
 * and applied) and the controls page over `maps`.
 */
export const createGameHudMenus = ({
  sceneId,
  maps,
  onApply,
  onBindingsChange,
}: {
  sceneId: string;
  /** The maps the controls page rebinds */
  maps: ActionMap[];
  /** The game's side of the settings (the crosshair, the subtitles) */
  onApply: (settings: GameHudSettings) => void;
  /** After a rebinding: the prompts read their bindings again */
  onBindingsChange: () => void;
}) => {
  const kitBefore: Required<KitPreferences> = getKitPreferences();
  const settings = loadSettings();
  const apply = () => {
    setKitPreferences({
      theme: settings.theme,
      uiScale: settings.uiScale,
      reducedMotion:
        settings.reducedMotion === 'system' ? 'system' : settings.reducedMotion === 'on',
    });
    onApply(settings);
  };
  const rows = maps.flatMap((map) =>
    Object.keys(map.actions).map((actionId) => ({ map, actionId, rowId: `${map.id}/${actionId}` }))
  );
  const controls = createControls(rows, onBindingsChange);
  const settingsMenu = createSettings(settings, controls, apply);
  const inventory = createInventoryPanel();
  apply();

  const inventoryPage: GameMenuPage = { title: 'Inventory', content: inventory.panel };
  const settingsPage: GameMenuPage = { title: 'Settings', content: settingsMenu.cmp };
  const footer = CMP({ class: 'exampleGameHudMenuFooter' });
  footer.add(
    createInputPrompt({
      label: 'Select',
      bindings: [
        { device: 'KEYBOARD', keys: ['Enter'] },
        { device: 'GAMEPAD', button: 'SOUTH' },
      ],
    }).cmp
  );
  const menu = createGameMenu({
    title: 'Paused',
    footer,
    onBack: () => menu.close(),
    items: [
      { id: 'resume', label: 'Resume', onSelect: () => menu.close() },
      {
        id: 'inventory',
        label: 'Inventory',
        description: 'Your bag and the chest',
        page: inventoryPage,
      },
      {
        id: 'settings',
        label: 'Settings',
        description: 'Display, subtitles and controls',
        page: settingsPage,
      },
      {
        id: 'restart',
        label: 'Restart the arena',
        onSelect: () => void loadScene({ sceneId }),
      },
    ],
    // Gameplay off while it's open, its own map on
    onOpen: () => {
      setActionContextEnabled('GAMEPLAY', false);
      setActionContextEnabled(MENU_CONTEXT, true);
    },
    onClose: () => {
      controls.cancelCapture();
      inventory.group.cancel();
      setActionContextEnabled(MENU_CONTEXT, false);
      setActionContextEnabled('GAMEPLAY', true);
    },
  });

  // #region game-hud-menu-gamepad (shown in the Hub: hub/pages/examples/game-hud/)
  // The gamepad in the menus: the d-pad moves the focus by position (the menu's spatial
  // navigation), SOUTH clicks what has it, EAST goes back (or puts a held item back), the
  // shoulders turn the settings' tabs. The keyboard's arrows, Enter and Escape are the kit's own.
  const menuMap = createActionMap({
    id: `${sceneId}:menu`,
    sceneId,
    context: MENU_CONTEXT,
    actions: {
      up: { type: 'BUTTON', name: 'Up' },
      down: { type: 'BUTTON', name: 'Down' },
      left: { type: 'BUTTON', name: 'Left' },
      right: { type: 'BUTTON', name: 'Right' },
      select: { type: 'BUTTON', name: 'Select' },
      back: { type: 'BUTTON', name: 'Back' },
      previousTab: { type: 'BUTTON', name: 'Previous tab' },
      nextTab: { type: 'BUTTON', name: 'Next tab' },
      close: { type: 'BUTTON', name: 'Close' },
    },
    bindings: {
      up: [{ device: 'GAMEPAD', button: 'DPAD_UP' }],
      down: [{ device: 'GAMEPAD', button: 'DPAD_DOWN' }],
      left: [{ device: 'GAMEPAD', button: 'DPAD_LEFT' }],
      right: [{ device: 'GAMEPAD', button: 'DPAD_RIGHT' }],
      select: [{ device: 'GAMEPAD', button: 'SOUTH' }],
      back: [{ device: 'GAMEPAD', button: 'EAST' }],
      previousTab: [{ device: 'GAMEPAD', button: 'LEFT_SHOULDER' }],
      nextTab: [{ device: 'GAMEPAD', button: 'RIGHT_SHOULDER' }],
      close: [{ device: 'GAMEPAD', button: 'START' }],
    },
  });
  menuMap.onPressed('up', () => menu.navigation.move('up'));
  menuMap.onPressed('down', () => menu.navigation.move('down'));
  menuMap.onPressed('left', () => menu.navigation.move('left'));
  menuMap.onPressed('right', () => menu.navigation.move('right'));
  menuMap.onPressed('select', () => {
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && menu.cmp.elem.contains(focused)) focused.click();
  });
  menuMap.onPressed('back', () => {
    if (inventory.group.isHolding()) inventory.group.cancel();
    else menu.back();
  });
  const isSettingsShown = () =>
    settingsMenu.cmp.elem.isConnected && !settingsMenu.cmp.elem.closest('[hidden]');
  menuMap.onPressed('previousTab', () => isSettingsShown() && settingsMenu.selectNext(-1));
  menuMap.onPressed('nextTab', () => isSettingsShown() && settingsMenu.selectNext(1));
  menuMap.onPressed('close', () => menu.close());
  setActionContextEnabled(MENU_CONTEXT, false);
  // #endregion game-hud-menu-gamepad

  return {
    settings,
    isOpen: menu.isOpen,
    open: () => menu.open(),
    /** Opens the menu on the inventory, its bag's first slot focused */
    openInventory: () => {
      if (!menu.isOpen()) menu.open();
      // From another page: back to the first, then the inventory (its Back returns there)
      while (menu.getDepth() > 0) menu.back();
      menu.openPage(inventoryPage);
      inventory.focus();
    },
    remove: () => {
      menu.close();
      menu.cmp.remove();
      settingsMenu.cmp.remove();
      inventory.panel.remove();
      menuMap.delete();
      // The kit's preferences back as they were before the visit
      setKitPreferences(kitBefore);
    },
  };
};
