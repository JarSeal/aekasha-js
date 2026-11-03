/**
 * The component library's game navigation and menus (the Hub's `features/ui-kit/game/` page,
 * p808): the spatial navigation, the radial menu, the game menu, the settings menu and the
 * controls page.
 */
import {
  CMP,
  createButton,
  createControlsPage,
  createGameMenu,
  createInputPrompt,
  createRadialMenu,
  createSettingsMenu,
  createSpatialNavigation,
  getHUDRootCMP,
} from 'aekasha/ui';
import type {
  ControlsAction,
  ControlsBinding,
  GameMenu,
  NavigationDirection,
  RadialMenu,
} from 'aekasha/ui';
import { ID_PREFIX, addButton, addGroup, addKitRoot } from './page';
import type { Demo } from './page';
import { createStatusLine } from './game';

/** A Hub button that keeps the focus where it is (its `mousedown` prevented), as a gamepad's
 * button does: the piece acts from the element that has it */
const addPadButton = (parent: HTMLElement, label: string, onClick: () => void) => {
  const button = addButton(parent, label, onClick);
  button.addEventListener('mousedown', (e) => e.preventDefault());
  return button;
};

// --- Spatial navigation ---

const NAV_ID = (name: string) => `${ID_PREFIX}Nav${name}`;

/**
 * In the page: an uneven layout of kit buttons in two focus groups (a side list and a grid) and
 * a field, under one spatial navigation; the arrows move by position, and the Hub's "D-pad"
 * buttons call `move` without taking the focus, as a gamepad's map would.
 */
const initSpatialNavigationDemo: Demo = (box) => {
  const root = addKitRoot(box);
  const status = createStatusLine(NAV_ID('Status'));
  const panel = document.createElement('div');
  panel.id = NAV_ID('Panel');
  panel.className = 'hubDemoNavPanel';
  const side = document.createElement('div');
  side.className = 'hubDemoNavSide';
  side.dataset.aekFocusGroup = 'tabs';
  for (const label of ['Bag', 'Map', 'Journal']) {
    side.append(createButton({ label, id: NAV_ID(label), variant: 'ghost' }).cmp.elem);
  }
  const grid = document.createElement('div');
  grid.className = 'hubDemoNavGrid';
  grid.dataset.aekFocusGroup = 'cards';
  const cards = ['Sword', 'Shield', 'Bow', 'Potion', 'Rope', 'Lantern (wide)'];
  for (const label of cards) {
    const button = createButton({ label, id: NAV_ID(label.split(' ')[0]) });
    if (label.includes('wide')) button.cmp.elem.classList.add('hubDemoNavWide');
    grid.append(button.cmp.elem);
  }
  panel.append(side, grid);
  const group = addGroup(
    root,
    'Two focus groups: the arrows move by position, inside a group first'
  );
  group.append(panel);
  root.append(status);
  const navigation = createSpatialNavigation({
    root: panel,
    wrap: false,
    onBack: () => (status.textContent = 'Back'),
  });
  panel.addEventListener('focusin', (e) => {
    const target = e.target as HTMLElement;
    status.textContent = `Focused: ${target.textContent ?? ''}`;
  });
  const pad = addGroup(root, 'A gamepad (the focus stays in the panel)');
  const directions: NavigationDirection[] = ['up', 'down', 'left', 'right'];
  for (const direction of directions) {
    addPadButton(pad, `D-pad: ${direction}`, () => navigation.move(direction));
  }
  addPadButton(pad, 'Shoulder: next group', () => navigation.nextGroup());
  addPadButton(pad, 'EAST: back', () => navigation.back());
};

// --- Radial menu ---

const RADIAL_ID = (name: string) => `${ID_PREFIX}Radial${name}`;

const EMOTES = [
  { id: 'wave', label: 'Wave', icon: 'personArmsUp', description: 'Say hello' },
  { id: 'cheer', label: 'Cheer', icon: 'rocket', description: 'Celebrate' },
  { id: 'point', label: 'Point', icon: 'pin', description: 'Show the way' },
  { id: 'rest', label: 'Rest', icon: 'pause', description: 'Sit down a while' },
  { id: 'dance', label: 'Dance', icon: 'infinity', disabled: true, description: 'Not learnt yet' },
];

/** Over the HUD's bounds: one radial menu of emotes, opened by the Hub buttons; a pick shows in
 * the box's status line */
const initRadialMenuDemo: Demo = (box) => {
  const root = addKitRoot(box);
  const status = createStatusLine(RADIAL_ID('Status'));
  root.append(status);
  let radial: RadialMenu | null = null;
  const get = () => {
    if (radial) return radial;
    radial = createRadialMenu({
      id: RADIAL_ID('Menu'),
      label: 'Emotes',
      items: EMOTES,
      onSelect: (id) => (status.textContent = `Emote: ${id}`),
      onClose: () => {
        if (!status.textContent?.startsWith('Emote')) status.textContent = 'Closed';
      },
    });
    getHUDRootCMP().add(radial.cmp);
    return radial;
  };
  const opens = addGroup(root, 'Opened by a held key or a shoulder button');
  addButton(opens, 'Open the emotes', () => {
    status.textContent = '';
    get().open();
  });
  addButton(opens, 'Open with Cheer highlighted', () => get().open({ highlight: 1 }));
  addButton(opens, 'Stick to the lower right', () => {
    const menu = get();
    menu.open();
    // The Gamepad API's axes: y grows downwards
    menu.setDirection(0.7, 0.7);
  });
};

// --- Game menu ---

const MENU_ID = (name: string) => `${ID_PREFIX}GameMenu${name}`;

/** A page's text content (a function: made on each open, removed on Back) */
const createPageText =
  (...lines: string[]) =>
  () => {
    const panel = CMP({ class: 'hubDemoTextPanel' });
    for (const line of lines) panel.add({ tag: 'p', text: line });
    return panel;
  };

/** Over the HUD's bounds: a pause menu with pages, in a panel or full screen; Escape, Back and a
 * gamepad's EAST go back a page, then close it */
const initGameMenuDemo: Demo = (box) => {
  const root = addKitRoot(box);
  const status = createStatusLine(MENU_ID('Status'));
  root.append(status);
  const menus = new Map<string, GameMenu>();
  const get = (layout: 'panel' | 'fullscreen') => {
    const existing = menus.get(layout);
    if (existing) return existing;
    const footer = CMP({ class: 'hubDemoMenuFooter' });
    footer.add(
      createInputPrompt({
        label: 'Select',
        bindings: [
          { device: 'KEYBOARD', keys: ['Enter'] },
          { device: 'GAMEPAD', button: 'SOUTH' },
        ],
      }).cmp
    );
    const menu: GameMenu = createGameMenu({
      id: MENU_ID(layout === 'panel' ? 'Panel' : 'Full'),
      title: 'Paused',
      layout,
      footer,
      onBack: () => menu.close(),
      onClose: () => (status.textContent = 'The menu closed'),
      items: [
        { id: 'resume', label: 'Resume', onSelect: () => menu.close() },
        {
          id: 'options',
          label: 'Options',
          description: 'Audio and video',
          page: {
            title: 'Options',
            items: [
              {
                id: 'audio',
                label: 'Audio',
                page: { title: 'Audio', content: createPageText('Music, effects and voices.') },
              },
              {
                id: 'video',
                label: 'Video',
                disabled: true,
                description: 'Not on this machine',
              },
            ],
          },
        },
        {
          id: 'help',
          label: 'How to play',
          page: {
            title: 'How to play',
            content: createPageText('Move with W A S D or the left stick.', 'E talks and opens.'),
          },
        },
        {
          id: 'quit',
          label: 'Quit to the title',
          onSelect: () => {
            status.textContent = 'Quit';
            menu.close();
          },
        },
      ],
    });
    menus.set(layout, menu);
    return menu;
  };
  const opens = addGroup(root, 'Opened by Escape or a gamepad’s START');
  addButton(opens, 'Open the pause menu', () => get('panel').open());
  addButton(opens, 'Full screen', () => get('fullscreen').open());
  addButton(opens, 'On the Options page', () => {
    const menu = get('panel');
    menu.open();
    menu.cmp.elem.querySelector<HTMLElement>('[data-id="options"]')?.click();
  });
};

// --- Settings menu ---

const SETTINGS_ID = (name: string) => `${ID_PREFIX}Settings${name}`;

/** In the page: a settings menu of two pages over one settings object; each change shows in the
 * status line, as its owner would save it */
const initSettingsMenuDemo: Demo = (box) => {
  const root = addKitRoot(box);
  const status = createStatusLine(SETTINGS_ID('Status'));
  const settings = {
    theme: 'system',
    uiScale: 1,
    subtitles: true,
    subtitleSize: 'lg',
    music: 70,
    effects: 90,
  };
  const menu = createSettingsMenu({
    id: SETTINGS_ID('Menu'),
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
            default: 'system',
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
            default: 1,
            min: 0.75,
            max: 1.5,
            step: 0.05,
          },
          {
            target: settings,
            key: 'subtitles',
            label: 'Subtitles',
            kind: 'switch',
            default: true,
          },
          {
            target: settings,
            key: 'subtitleSize',
            label: 'Subtitle size',
            kind: 'segmented',
            default: 'lg',
            options: [
              { label: 'S', value: 'md' },
              { label: 'M', value: 'lg' },
              { label: 'L', value: 'xl' },
            ],
          },
        ],
      },
      {
        key: 'audio',
        label: 'Audio',
        items: [
          { target: settings, key: 'music', label: 'Music', default: 70, min: 0, max: 100 },
          { target: settings, key: 'effects', label: 'Effects', default: 90, min: 0, max: 100 },
        ],
      },
    ],
    onChange: ({ page, item, value, change }) => {
      if (change.last) status.textContent = `Saved ${page}: ${item.label} ${String(value)}`;
    },
    onReset: (page) => (status.textContent = `Saved the reset of ${page ?? 'every page'}`),
  });
  const group = addGroup(root, 'Pages on tabs, each a property grid; Reset page and Reset all');
  group.classList.add('hubDemoSettings');
  group.append(menu.cmp.elem);
  root.append(status);
  const pages = addGroup(root, 'From code (a gamepad’s shoulders call selectNext)');
  addButton(pages, 'The Audio page', () => menu.select('audio'));
  addButton(pages, 'Changed from outside', () => {
    settings.music = 20;
    settings.uiScale = 1.25;
    menu.refresh();
  });
};

// --- Controls page ---

const CONTROLS_ID = (name: string) => `${ID_PREFIX}Controls${name}`;

const CONTROLS_ACTIONS: ControlsAction[] = [
  {
    id: 'move',
    name: 'Move',
    type: 'AXIS_2D',
    bindings: [
      { device: 'KEYBOARD', up: ['w'], left: ['a'], down: ['s'], right: ['d'] },
      { device: 'GAMEPAD', stick: 'LEFT' },
    ],
  },
  {
    id: 'jump',
    name: 'Jump',
    bindings: [
      { device: 'KEYBOARD', keys: [' '] },
      { device: 'GAMEPAD', button: 'SOUTH' },
    ],
  },
  {
    id: 'interact',
    name: 'Interact',
    description: 'Talk, open, pick up',
    bindings: [
      { device: 'KEYBOARD', keys: ['e'] },
      { device: 'GAMEPAD', button: 'WEST' },
    ],
  },
  {
    id: 'fire',
    name: 'Fire',
    bindings: [
      { device: 'MOUSE', button: 'LEFT' },
      { device: 'GAMEPAD', button: 'RIGHT_TRIGGER' },
    ],
  },
  {
    id: 'menu',
    name: 'Menu',
    rebindable: false,
    bindings: [
      { device: 'KEYBOARD', keys: ['Escape'] },
      { device: 'GAMEPAD', button: 'START' },
    ],
  },
];

/** In the page: the controls page over a map's actions; a rebinding is applied to the page's
 * copy (an app's `map.setBindings`) and shows in the status line */
const initControlsPageDemo: Demo = (box) => {
  const root = addKitRoot(box);
  const status = createStatusLine(CONTROLS_ID('Status'));
  const page = createControlsPage<ControlsBinding>({
    id: CONTROLS_ID('Page'),
    label: 'Controls',
    actions: CONTROLS_ACTIONS,
    showReset: true,
    onRebind: ({ action, bindings, reason }) => {
      page.setBindings(action, bindings);
      status.textContent = `${reason}: ${action}`;
    },
  });
  const group = addGroup(root, 'A slot per binding: Enter or a click, then the new key or button');
  group.classList.add('hubDemoControls');
  group.append(page.cmp.elem);
  root.append(status);
  const labels = addGroup(root, 'The gamepad column’s labels');
  addButton(labels, 'PlayStation labels', () => page.setFamily('PLAYSTATION'));
  addButton(labels, 'Nintendo labels', () => page.setFamily('NINTENDO'));
};

/** The game navigation and menus group's demos by their box's key (`data-hub-demo`) */
export const GAME_MENUS_DEMOS: Record<string, Demo> = {
  spatialNavigation: initSpatialNavigationDemo,
  radialMenu: initRadialMenuDemo,
  gameMenu: initGameMenuDemo,
  settingsMenu: initSettingsMenuDemo,
  controlsPage: initControlsPageDemo,
};
